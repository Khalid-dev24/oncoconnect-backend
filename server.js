// ════════════════════════════════════════════════════════════════════════════
// ONCOCONNECT BACKEND SERVER
// ════════════════════════════════════════════════════════════════════════════
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const notificationRoutes = require('./routes/notifications');


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ────────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/api/notifications', notificationRoutes);
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const prescriptionsDir = path.join(uploadDir, 'prescriptions');
if (!fs.existsSync(prescriptionsDir)) {
  fs.mkdirSync(prescriptionsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = path.parse(file.originalname).name;
    const ext = path.extname(file.originalname);
    cb(null, `${originalName}-${timestamp}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'application/pdf'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed: JPG, PNG, PDF`));
    }
  }
});

// ────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// ────────────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY 
);

// ────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE — Verify JWT from Supabase
// ────────────────────────────────────────────────────────────────────────────
function verifyAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('JWT_SECRET is not set in environment variables');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }
  
  try {
    const decoded = jwt.verify(token, secret);
    req.user = {
      id: decoded.user_id,          
      doctor_id: decoded.doctor_id,
      role: decoded.role
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// HELPER: Generate 6-char invite code (e.g. SAL-442)
// ────────────────────────────────────────────────────────────────────────────
function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  let code = '';
  for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 3; i++) code += nums[Math.floor(Math.random() * nums.length)];
  return code;
}

// ────────────────────────────────────────────────────────────────────────────
// HELPER: Calculate risk score for a patient
// ────────────────────────────────────────────────────────────────────────────
async function calculatePatientRiskScore(patientId) {
  // Fetch recent symptoms
  const { data: symptoms } = await supabase
    .from('symptom_log')
    .select('overall_severity')
    .eq('patient_id', patientId)
    .order('logged_at', { ascending: false })
    .limit(7);

  // Fetch medication adherence
  const { data: medLogs } = await supabase
    .from('medication_log')
    .select('status')
    .eq('patient_id', patientId)
    .gte('logged_at', new Date(Date.now() - 7*24*60*60*1000).toISOString());

  let score = 0;
  if (symptoms?.length > 0) {
    const avgSeverity = symptoms.reduce((a, s) => a + (s.overall_severity || 0), 0) / symptoms.length;
    if (avgSeverity >= 7) score += 60;
    else if (avgSeverity >= 5) score += 30;
    else score += 10;
  }

  if (medLogs?.length > 0) {
    const adherenceRate = medLogs.filter(l => l.status === 'taken').length / medLogs.length;
    if (adherenceRate < 0.6) score += 40;
    else if (adherenceRate < 0.8) score += 20;
  }

  return score > 100 ? 100 : score;
}

function getRiskBadge(score) {
  if (score >= 70) return 'Red';
  if (score >= 40) return 'Amber';
  return 'Green';
}

// ────────────────────────────────────────────────────────────────────────────
// HELPER: Generate QR code as data URL for prescription
// ────────────────────────────────────────────────────────────────────────────
async function generatePrescriptionQRCode(prescriptionId) {
  try {
    const qrDataUrl = await QRCode.toDataURL(prescriptionId, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 0.95,
      margin: 1,
      width: 300
    });
    return qrDataUrl;
  } catch (err) {
    console.error('QR code generation failed:', err);
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// HELPER: Generate prescription PDF
// ────────────────────────────────────────────────────────────────────────────
async function generatePrescriptionPDF(prescriptionData) {
  return new Promise((resolve, reject) => {
    try {
      const pdf = new PDFDocument({
        size: 'A4',
        margin: 40
      });

      const chunks = [];
      pdf.on('data', chunk => chunks.push(chunk));
      pdf.on('end', () => {
        const pdfBuffer = Buffer.concat(chunks);
        resolve(pdfBuffer);
      });
      pdf.on('error', reject);

      // Add header
      pdf.fontSize(20).font('Helvetica-Bold').text('PRESCRIPTION', { align: 'center' });
      pdf.moveDown(0.5);
      pdf.fontSize(11).font('Helvetica').text('Digital Prescription from OncoConnect', { align: 'center' });
      pdf.moveTo(40, pdf.y).lineTo(555, pdf.y).stroke();
      pdf.moveDown(1);

      // Prescription details
      pdf.fontSize(12).font('Helvetica-Bold').text('Prescription Details', { underline: true });
      pdf.moveDown(0.5);
      
      pdf.fontSize(10).font('Helvetica');
      pdf.text(`Prescription ID: ${prescriptionData.prescription_id}`);
      pdf.text(`Verification Code: ${prescriptionData.qr_code}`);
      pdf.text(`Date: ${new Date(prescriptionData.issued_at).toLocaleDateString()}`);
      pdf.moveDown(1);

      // Patient info
      pdf.fontSize(12).font('Helvetica-Bold').text('Patient Information', { underline: true });
      pdf.moveDown(0.5);
      pdf.fontSize(10).font('Helvetica');
      pdf.text(`Name: ${prescriptionData.patient_name}`);
      pdf.text(`Phone: ${prescriptionData.patient_phone}`);
      pdf.moveDown(1);

      // Doctor info
      pdf.fontSize(12).font('Helvetica-Bold').text('Prescribed By', { underline: true });
      pdf.moveDown(0.5);
      pdf.fontSize(10).font('Helvetica');
      pdf.text(`Doctor: ${prescriptionData.doctor_name}`);
      pdf.text(`MDCN: ${prescriptionData.mdcn_number}`);
      pdf.text(`Hospital: ${prescriptionData.hospital || 'N/A'}`);
      pdf.moveDown(1);

      // Medication details
      pdf.fontSize(12).font('Helvetica-Bold').text('Medication', { underline: true });
      pdf.moveDown(0.5);
      pdf.fontSize(10).font('Helvetica');
      pdf.text(`Drug Name: ${prescriptionData.drug_name}`);
      pdf.text(`Dosage: ${prescriptionData.dosage}`);
      pdf.text(`Frequency: ${prescriptionData.frequency}`);
      if (prescriptionData.duration) pdf.text(`Duration: ${prescriptionData.duration}`);
      if (prescriptionData.instructions) pdf.text(`Instructions: ${prescriptionData.instructions}`);
      pdf.moveDown(1);

      // QR Code section (if available)
      if (prescriptionData.qr_code_url) {
        pdf.fontSize(10).font('Helvetica').text('Verification QR Code:', { underline: true });
        pdf.moveDown(0.5);
        // Add QR code image if provided
        try {
          pdf.image(prescriptionData.qr_code_url, {
            fit: [150, 150],
            align: 'center'
          });
        } catch (imgErr) {
          console.warn('Could not add QR image to PDF:', imgErr.message);
        }
      }

      pdf.moveDown(2);
      pdf.fontSize(9).font('Helvetica').text('This is a digitally generated prescription. Verify authenticity using the QR code on this document.', { align: 'center', color: '#666666' });

      pdf.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
// DOCTOR ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/doctors/register — Doctor self-onboarding
app.post('/api/doctors/register', async (req, res) => {
  try {
    const { phone_number, full_name, email, mdcn_number, hospital, specialty, bank_name, bank_account } = req.body;

    if (!phone_number || !full_name || !mdcn_number) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email || `${phone_number}@oncoconnect.local`,
      password: crypto.randomBytes(16).toString('hex'),
      email_confirm: true,
      user_metadata: { phone: phone_number, role: 'oncologist' }
    });

    if (authError) throw authError;

    // Create auth_user record
    const { error: userError } = await supabase
      .from('auth_user')
      .insert({
        id: authData.user.id,
        role: 'oncologist',
        phone_number,
        full_name,
        email
      });

    if (userError) throw userError;

    // Generate unique invite code
    let inviteCode;
    let codeExists = true;
    while (codeExists) {
      inviteCode = generateInviteCode();
      const { data } = await supabase
        .from('oncologist_profile')
        .select('id')
        .eq('invite_code', inviteCode)
        .limit(1);
      codeExists = data?.length > 0;
    }

    // Create oncologist_profile
    const { data: doctorProfile, error: profileError } = await supabase
      .from('oncologist_profile')
      .insert({
        user_id: authData.user.id,
        mdcn_number,
        hospital_affiliation: hospital,
        specialty,
        invite_code: inviteCode,
        bank_name,
        bank_account_number: bank_account, // In production, encrypt this
        is_verified: false
      })
      .select()
      .single();

    if (profileError) throw profileError;

    res.status(201).json({
      message: 'Doctor registered successfully. Awaiting MDCN verification.',
      doctor: {
        id: doctorProfile.id,
        name: full_name,
        mdcn: mdcn_number,
        invite_code: inviteCode,
        verified: false
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/doctors/login — Doctor login
app.post('/api/doctors/login', async (req, res) => {
  try {
    const { mdcn_number, phone_number } = req.body;

    if (!mdcn_number || !phone_number) {
      return res.status(400).json({ error: 'MDCN and phone number required' });
    }

    // Find doctor by MDCN
    const { data: doctorProfile, error: profileError } = await supabase
      .from('oncologist_profile')
      .select('id, user_id')
      .eq('mdcn_number', mdcn_number)
      .single();

    if (profileError || !doctorProfile) {
      return res.status(401).json({ error: 'Invalid MDCN or phone number' });
    }

    // Verify phone number matches
    const { data: authUser, error: userError } = await supabase
      .from('auth_user')
      .select('phone_number, id')
      .eq('id', doctorProfile.user_id)
      .single();

    if (userError || authUser.phone_number !== phone_number) {
      return res.status(401).json({ error: 'Invalid MDCN or phone number' });
    }

    // Generate JWT token (use your JWT secret)
    const token = jwt.sign(
      { user_id: authUser.id, doctor_id: doctorProfile.id, role: 'oncologist' },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      doctor: {
        id: doctorProfile.id,
        user_id: authUser.id
      },
      token
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/doctors/:id/dashboard — Doctor dashboard data
app.get('/api/doctors/:id/dashboard', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify doctor owns this profile and fetch user_id and invite_code
    const { data: doctor } = await supabase
      .from('oncologist_profile')
      .select('id, user_id, invite_code')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!doctor) return res.status(403).json({ error: 'Unauthorized' });

    // Get doctor's name from auth_user
    const { data: authUser } = await supabase
      .from('auth_user')
      .select('full_name')
      .eq('id', doctor.user_id)
      .single();

    // Fetch all patients
      const { data: patients } = await supabase
      .from('patient_profile')
      .select(`
        id, 
        user_id, 
        cancer_type, 
        treatment_status,
        auth_user (full_name)
      `)
      .eq('assigned_oncologist_id', id);

    // Calculate risk scores for each patient
    const patientsWithRisk = await Promise.all(
      patients.map(async (p) => {
        const score = await calculatePatientRiskScore(p.id);
        return { ...p, risk_score: score, risk_badge: getRiskBadge(score) };
      })
    );

    // Sort by risk (red first)
    patientsWithRisk.sort((a, b) => b.risk_score - a.risk_score);

    // Fetch recent payments (earnings)
    const { data: payments } = await supabase
      .from('payment')
      .select('amount_naira, doctor_share, status, paid_at')
      .eq('oncologist_id', id)
      .eq('status', 'success')
      .order('paid_at', { ascending: false })
      .limit(30);

    const totalEarnings = payments?.reduce((sum, p) => sum + (p.doctor_share || 0), 0) || 0;
    const monthlyEarnings = payments
      ?.filter(p => {
        const paymentDate = new Date(p.paid_at);
        const now = new Date();
        return paymentDate.getMonth() === now.getMonth() && paymentDate.getFullYear() === now.getFullYear();
      })
      .reduce((sum, p) => sum + (p.doctor_share || 0), 0) || 0;

    res.json({
      doctor: {
        id: id,
        name: authUser?.full_name || 'Doctor',
        invite_code: doctor.invite_code
      },
      patients: patientsWithRisk,
      total_patients: patients.length,
      earnings: {
        total: totalEarnings,
        this_month: monthlyEarnings,
        recent_transactions: payments?.slice(0, 10) || []
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/doctors/:id/prescriptions — Fetch all prescriptions for a doctor
app.get('/api/doctors/:id/prescriptions', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify doctor owns this profile
    const { data: doctor } = await supabase
      .from('oncologist_profile')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!doctor) return res.status(403).json({ error: 'Unauthorized' });

    // Fetch all prescriptions issued by this doctor
    const { data: prescriptions, error: prescriptionError } = await supabase
      .from('prescription')
      .select(`
        id,
        patient_id,
        drug_name,
        dosage,
        frequency,
        duration,
        instructions,
        pdf_url,
        qr_verification_code,
        issued_at,
        is_active,
        patient_profile (
          user_id,
          auth_user (full_name, phone_number)
        )
      `)
      .eq('oncologist_id', id)
      .order('issued_at', { ascending: false });

    if (prescriptionError) throw prescriptionError;

    res.json({
      doctor_id: id,
      total_prescriptions: prescriptions?.length || 0,
      prescriptions: prescriptions || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/doctors/:id/verify-mdcn — Verify doctor's MDCN
app.post('/api/doctors/:id/verify-mdcn', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { mdcn_number } = req.body;

    if (!mdcn_number) {
      return res.status(400).json({ error: 'MDCN number required' });
    }

    // Verify doctor owns this profile
    const { data: doctor } = await supabase
      .from('oncologist_profile')
      .select('id, mdcn_number, is_verified')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!doctor) return res.status(403).json({ error: 'Unauthorized' });

    // Check if MDCN matches
    if (doctor.mdcn_number !== mdcn_number) {
      return res.status(400).json({ error: 'MDCN does not match registered number' });
    }

    // In production, call external MDCN verification API
    // For now, we'll simulate the verification
    let verificationStatus = 'pending';
    let verificationMessage = 'Verification initiated with MDCN registry';

    try {
      // Mock external API call (would be actual MDCN verification service)
      if (process.env.MDCN_API_KEY && process.env.MDCN_API_KEY !== 'to_be_configured') {
        const mdcnResponse = await axios.post(
          'https://mdcn.org.ng/api/verify',
          { mdcn_number },
          {
            headers: { 'Authorization': `Bearer ${process.env.MDCN_API_KEY}` },
            timeout: 10000
          }
        );

        if (mdcnResponse.data.valid === true) {
          verificationStatus = 'verified';
          verificationMessage = 'MDCN verified successfully';
        } else {
          verificationStatus = 'failed';
          verificationMessage = 'MDCN could not be verified';
        }
      }
    } catch (apiError) {
      console.warn('MDCN API verification failed, continuing with pending status:', apiError.message);
    }

    // Update doctor profile
    const { data: updatedDoctor, error: updateError } = await supabase
      .from('oncologist_profile')
      .update({
        is_verified: verificationStatus === 'verified',
        verification_notes: verificationMessage,
        verified_at: verificationStatus === 'verified' ? new Date().toISOString() : null
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      message: verificationMessage,
      doctor: {
        id: updatedDoctor.id,
        mdcn: updatedDoctor.mdcn_number,
        is_verified: updatedDoctor.is_verified,
        verified_at: updatedDoctor.verified_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new prescription
app.post('/api/prescriptions', verifyAuth, async (req, res) => {
  try {
    const { patient_id, drug_name, dosage, frequency, duration, instructions, oncologist_id } = req.body;
    
    const { data, error } = await supabase
      .from('prescription')
      .insert([{
        patient_id,
        drug_name,
        dosage,
        frequency,
        duration,
        instructions,
        oncologist_id,
        created_at: new Date().toISOString(),
      }])
      .select();

    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ prescription: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get doctor's prescriptions
app.get('/api/doctors/:id/prescriptions', verifyAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('prescription')
      .select('*')
      .eq('oncologist_id', req.params.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(400).json({ error: error.message });
    res.json({ prescriptions: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prescriptions/:id/generate-qr — Generate QR code for prescription
app.post('/api/prescriptions/:id/generate-qr', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch prescription
    const { data: prescription, error: prescriptionError } = await supabase
      .from('prescription')
      .select(`
        id,
        patient_id,
        oncologist_id,
        patient_profile (
          assigned_oncologist_id
        ),
        oncologist_profile (
          user_id
        )
      `)
      .eq('id', id)
      .single();

    if (prescriptionError) throw prescriptionError;
    if (!prescription) return res.status(404).json({ error: 'Prescription not found' });

    // Verify user is the oncologist or assigned doctor
    if (prescription.oncologist_profile.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Generate QR code
    const qrDataUrl = await generatePrescriptionQRCode(id);

    // Update prescription with QR verification code if not already set
    const qrCode = crypto.randomBytes(16).toString('hex');
    const { error: updateError } = await supabase
      .from('prescription')
      .update({
        qr_verification_code: qrCode
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({
      prescription_id: id,
      qr_code: qrCode,
      qr_code_url: qrDataUrl,
      message: 'QR code generated successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/prescriptions/:id/generate-pdf — Generate PDF for prescription
app.post('/api/prescriptions/:id/generate-pdf', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch prescription with all related data
    const { data: prescription, error: prescriptionError } = await supabase
      .from('prescription')
      .select(`
        id,
        drug_name,
        dosage,
        frequency,
        duration,
        instructions,
        issued_at,
        qr_verification_code,
        patient_id,
        oncologist_id,
        patient_profile (
          user_id,
          auth_user (full_name, phone_number),
          assigned_oncologist_id
        ),
        oncologist_profile (
          user_id,
          mdcn_number,
          hospital_affiliation
        )
      `)
      .eq('id', id)
      .single();

    if (prescriptionError) throw prescriptionError;
    if (!prescription) return res.status(404).json({ error: 'Prescription not found' });

    // Verify user is the oncologist
    if (prescription.oncologist_profile.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Get doctor details
    const { data: doctorAuth } = await supabase
      .from('auth_user')
      .select('full_name')
      .eq('id', prescription.oncologist_profile.user_id)
      .single();

    // Generate QR code for PDF
    const qrDataUrl = await generatePrescriptionQRCode(id);

    // Prepare PDF data
    const pdfData = {
      prescription_id: prescription.id,
      patient_name: prescription.patient_profile.auth_user.full_name,
      patient_phone: prescription.patient_profile.auth_user.phone_number,
      doctor_name: doctorAuth?.full_name || 'Doctor',
      mdcn_number: prescription.oncologist_profile.mdcn_number,
      hospital: prescription.oncologist_profile.hospital_affiliation,
      drug_name: prescription.drug_name,
      dosage: prescription.dosage,
      frequency: prescription.frequency,
      duration: prescription.duration,
      instructions: prescription.instructions,
      issued_at: prescription.issued_at,
      qr_code: prescription.qr_verification_code,
      qr_code_url: qrDataUrl
    };

    // Generate PDF
    const pdfBuffer = await generatePrescriptionPDF(pdfData);

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="prescription_${id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PATIENT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/patients/register-with-code — Patient joins via invite code
app.post('/api/patients/register-with-code', async (req, res) => {
  try {
    const { phone_number, full_name, invite_code, cancer_type, cancer_stage, email } = req.body;

    if (!phone_number || !full_name || !invite_code || !email ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify invite code exists and get oncologist
    const { data: oncologist } = await supabase
      .from('oncologist_profile')
      .select('id, user_id, invite_code')
      .eq('invite_code', invite_code)
      .single();

    if (!oncologist) return res.status(400).json({ error: 'Invalid invite code' });

    // Get oncologist's full name from auth_user
    const { data: oncologistUser } = await supabase
      .from('auth_user')
      .select('full_name')
      .eq('id', oncologist.user_id)
      .single();

    const oncologistName = oncologistUser?.full_name || 'Your Doctor';

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: crypto.randomBytes(16).toString('hex'),
      email_confirm: true,
      user_metadata: { phone: phone_number, role: 'patient' }
    });

    if (authError) throw authError;

    // Create auth_user
    await supabase
      .from('auth_user')
      .insert({
        id: authData.user.id,
        role: 'patient',
        phone_number,
        email,
        full_name
      });

    // Create patient_profile
    const { data: patientProfile, error: profileError } = await supabase
      .from('patient_profile')
      .insert({
        user_id: authData.user.id,
        assigned_oncologist_id: oncologist.id,
        email,
        cancer_type,
        cancer_stage
      })
      .select()
      .single();

    if (profileError) throw profileError;
    
    // Generate JWT token
    const token = jwt.sign(
      { 
        user_id: authData.user.id, 
        phone: phone_number,
        role: 'patient'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    res.status(201).json({
      message: 'Patient registered successfully',
      token: token,
      patient: {
        id: patientProfile.id,
        name: full_name,
        cancer_type,
        oncologist_id: oncologist.id,
        oncologist_name: oncologistName
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/patients/login', async (req, res) => {
  try {
    const { phone_number } = req.body;

    if (!phone_number) {
      return res.status(400).json({ error: 'Phone number required' });
    }

    // Find user by phone number
    const { data: authUser } = await supabase
      .from('auth_user')
      .select('id, full_name')
      .eq('phone_number', phone_number)
      .single();

    if (!authUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get patient profile
    const { data: patient } = await supabase
      .from('patient_profile')
      .select('id, cancer_type, cancer_stage, assigned_oncologist_id')
      .eq('user_id', authUser.id)
      .single();

    // Get oncologist name
    let oncologist_name = 'Your Doctor';
    if (patient.assigned_oncologist_id) {
      const { data: oncologist } = await supabase
        .from('oncologist_profile')
        .select('user_id')
        .eq('id', patient.assigned_oncologist_id)
        .single();
      
      if (oncologist) {
        const { data: oncologistUser } = await supabase
          .from('auth_user')
          .select('full_name')
          .eq('id', oncologist.user_id)
          .single();
        
        if (oncologistUser) {
          oncologist_name = oncologistUser.full_name;
        }
      }
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        user_id: authUser.id, 
        phone: phone_number,
        role: 'patient'
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token: token,
      patient: {
        id: patient.id,
        name: authUser.full_name,
        cancer_type: patient.cancer_type,
        oncologist_name: oncologist_name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/patients/:id/home — Patient home screen data
app.get('/api/patients/:id/home', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get patient profile
    const { data: patient } = await supabase
      .from('patient_profile')
      .select('*, oncologist_profile(full_name)')
      .eq('id', id)
      .single();

    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    // Check active consultation window
    const { data: window } = await supabase
      .from('consultation_window')
      .select('*')
      .eq('patient_id', id)
      .eq('status', 'active')
      .order('expires_at', { ascending: false })
      .limit(1)
      .single();

    let windowStatus = 'closed';
    let timeRemaining = null;
    if (window) {
      const expiresAt = new Date(window.expires_at);
      const now = new Date();
      if (expiresAt > now) {
        windowStatus = 'open';
        timeRemaining = Math.floor((expiresAt - now) / 1000 / 60); // minutes
      }
    }

    // Get today's medications
    const today = new Date().toISOString().split('T')[0];
    const { data: meds } = await supabase
      .from('medication')
      .select('id, drug_name, times_of_day')
      .eq('patient_id', id)
      .eq('is_active', true);

    // Get latest symptom log
    const { data: latestSymptom } = await supabase
      .from('symptom_log')
      .select('overall_severity')
      .eq('patient_id', id)
      .order('logged_at', { ascending: false })
      .limit(1)
      .single();

    res.json({
      patient: {
        name: patient.auth_user?.full_name || 'Patient',
        cancer_type: patient.cancer_type,
        oncologist: patient.oncologist_profile?.full_name || 'Assigned Doctor'
      },
      consultation_window: {
        status: windowStatus,
        time_remaining_minutes: timeRemaining,
        window_id: window?.id || null
      },
      medications_today: meds?.length || 0,
      latest_symptom: latestSymptom?.overall_severity || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// MESSAGING ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/messages — Send a message in consultation window
app.post('/api/messages', verifyAuth, async (req, res) => {
  try {
    const { window_id, body, attachment_url } = req.body;

    if (!window_id || !body) {
      return res.status(400).json({ error: 'window_id and body are required' });
    }

    // Verify user is part of this consultation window
    const { data: window } = await supabase
      .from('consultation_window')
      .select(`
        id,
        patient_id,
        oncologist_id,
        patient_profile (
          user_id
        ),
        oncologist_profile (
          user_id
        )
      `)
      .eq('id', window_id)
      .single();

    if (!window) return res.status(404).json({ error: 'Consultation window not found' });

    const isPatient = window.patient_profile?.user_id === req.user.id;
    const isOncologist = window.oncologist_profile?.user_id === req.user.id;

    if (!isPatient && !isOncologist) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Create message
    const { data: message, error: messageError } = await supabase
      .from('message')
      .insert({
        window_id,
        sender_id: req.user.id,
        body,
        attachment_url
      })
      .select()
      .single();

    if (messageError) throw messageError;

    res.status(201).json({
      message_id: message.id,
      sent_at: message.sent_at,
      message: 'Message sent successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/consultations/:window_id/messages — Fetch messages for a consultation window
app.get('/api/consultations/:window_id/messages', verifyAuth, async (req, res) => {
  try {
    const { window_id } = req.params;

    // Verify user is part of this consultation window
    const { data: window } = await supabase
      .from('consultation_window')
      .select(`
        id,
        patient_id,
        oncologist_id,
        patient_profile (
          user_id
        ),
        oncologist_profile (
          user_id
        )
      `)
      .eq('id', window_id)
      .single();

    if (!window) return res.status(404).json({ error: 'Consultation window not found' });

    const isPatient = window.patient_profile?.user_id === req.user.id;
    const isOncologist = window.oncologist_profile?.user_id === req.user.id;

    if (!isPatient && !isOncologist) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Fetch messages
    const { data: messages, error: messagesError } = await supabase
      .from('message')
      .select(`
        id,
        sender_id,
        body,
        attachment_url,
        sent_at,
        read_at,
        auth_user (full_name, role)
      `)
      .eq('window_id', window_id)
      .order('sent_at', { ascending: true });

    if (messagesError) throw messagesError;

    res.json({
      window_id,
      total_messages: messages?.length || 0,
      messages: messages || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/messages/:id/read — Mark message as read
app.put('/api/messages/:id/read', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch message
    const { data: message, error: messageError } = await supabase
      .from('message')
      .select('id, window_id, sender_id')
      .eq('id', id)
      .single();

    if (messageError) throw messageError;
    if (!message) return res.status(404).json({ error: 'Message not found' });

    // Verify user is not the sender (only recipients can mark as read)
    if (message.sender_id === req.user.id) {
      return res.status(400).json({ error: 'Cannot mark own message as read' });
    }

    // Update message
    const { error: updateError } = await supabase
      .from('message')
      .update({
        read_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({
      message_id: id,
      read_at: new Date().toISOString(),
      message: 'Message marked as read'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CONSULTATION WINDOW & PAYMENT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/consultations/open-window — Initialize payment for consultation
app.post('/api/consultations/open-window', verifyAuth, async (req, res) => {
  try {
    const { patient_id, amount_naira = 40000 } = req.body;

    // Get patient and oncologist
    const { data: patient } = await supabase
      .from('patient_profile')
      .select('assigned_oncologist_id')
      .eq('id', patient_id)
      .eq('user_id', req.user.id)
      .single();

    if (!patient) return res.status(403).json({ error: 'Unauthorized' });

    // Create payment record (pending)
    const { data: payment, error: paymentError } = await supabase
      .from('payment')
      .insert({
        patient_id,
        oncologist_id: patient.assigned_oncologist_id,
        amount_naira,
        platform_share: Math.floor(amount_naira * 0.3),
        doctor_share: Math.floor(amount_naira * 0.7),
        payment_type: 'consultation_open',
        status: 'pending'
      })
      .select()
      .single();

    if (paymentError) throw paymentError;

    // Return payment reference for frontend to initiate Paystack
    res.json({
      payment_id: payment.id,
      paystack_reference: payment.paystack_reference,
      amount: amount_naira,
      message: 'Proceed to payment page'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consultations/verify-payment — Verify Paystack payment and create window
app.post('/api/consultations/verify-payment', verifyAuth, async (req, res) => {
  try {
    const { reference, payment_id } = req.body;

    if (!reference) return res.status(400).json({ error: 'No reference provided' });
    if (!payment_id) return res.status(400).json({ error: 'No payment_id provided' });

    // Verify payment belongs to authenticated user
    const { data: payment } = await supabase
      .from('payment')
      .select('patient_id, oncologist_id, status')
      .eq('id', payment_id)
      .single();

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    // Verify patient belongs to user
    const { data: patient } = await supabase
      .from('patient_profile')
      .select('id')
      .eq('id', payment.patient_id)
      .eq('user_id', req.user.id)
      .single();

    if (!patient) return res.status(403).json({ error: 'Unauthorized' });

    // Check if this is a mock reference (for testing)
    let isPaymentValid = false;
    
    if (reference.startsWith('mock_')) {
      // Mock payment - for testing only
      console.log('Mock payment reference detected - skipping Paystack verification');
      isPaymentValid = true;
    } else {
      // Real payment - verify with Paystack
      try {
        const paystackResponse = await axios.get(
          `https://api.paystack.co/transaction/verify/${reference}`,
          {
            headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
            timeout: 5000
          }
        );

        if (paystackResponse.data.status === true && paystackResponse.data.data.status === 'success') {
          isPaymentValid = true;
        }
      } catch (paystackError) {
        console.error('Paystack verification error:', paystackError.message);
        return res.status(400).json({ error: 'Payment verification failed with Paystack' });
      }
    }

    if (!isPaymentValid) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Update payment record
    const { error: updateError } = await supabase
      .from('payment')
      .update({
        paystack_reference: reference,
        status: 'success',
        paid_at: new Date().toISOString(),
        payout_status: 'pending'
      })
      .eq('id', payment_id);

    if (updateError) throw updateError;

    // Create consultation window
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const { data: window, error: windowError } = await supabase
      .from('consultation_window')
      .insert({
        patient_id: payment.patient_id,
        oncologist_id: payment.oncologist_id,
        expires_at: expiresAt.toISOString(),
        status: 'active',
        payment_id
      })
      .select()
      .single();

    if (windowError) throw windowError;

    res.json({
      success: true,
      message: 'Consultation window opened',
      window: {
        id: window.id,
        expires_at: window.expires_at
      }
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/doctors/:id/profile — Fetch doctor profile
app.get('/api/doctors/:id/profile', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify doctor owns this profile
    const { data: doctor, error: doctorError } = await supabase
      .from('oncologist_profile')
      .select(`
        id,
        user_id,
        mdcn_number,
        hospital_affiliation,
        specialty,
        profile_photo_url,
        signature_url,
        letterhead_url,
        bank_name,
        bank_account_number,
        bank_account_name,
        is_verified
      `)
      .eq('id', id)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    // Verify authorization (user must be the doctor or admin)
    if (doctor.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Fetch auth_user data for name and email
    const { data: authUser, error: authError } = await supabase
      .from('auth_user')
      .select('full_name, email, phone_number')
      .eq('id', doctor.user_id)
      .single();

    if (authError) throw authError;

    res.json({
      doctor: {
        id: doctor.id,
        full_name: authUser?.full_name,
        email: authUser?.email,
        phone_number: authUser?.phone_number,
        mdcn_number: doctor.mdcn_number,
        hospital: doctor.hospital_affiliation,
        specialty: doctor.specialty,
        profile_photo_url: doctor.profile_photo_url,
        signature_url: doctor.signature_url,
        letterhead_url: doctor.letterhead_url,
        bank_name: doctor.bank_name,
        bank_account_number: doctor.bank_account_number,
        bank_account_name: doctor.bank_account_name,
        is_verified: doctor.is_verified
      }
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/doctors/:id/profile — Update doctor profile
app.put('/api/doctors/:id/profile', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone_number, hospital, specialty, bank_name, bank_account_number, bank_account_name } = req.body;

    // Verify doctor owns this profile
    const { data: doctor, error: doctorError } = await supabase
      .from('oncologist_profile')
      .select('user_id')
      .eq('id', id)
      .single();

    if (doctorError || !doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    if (doctor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Update auth_user table
    if (full_name || email || phone_number) {
      const { error: authUpdateError } = await supabase
        .from('auth_user')
        .update({
          full_name: full_name || undefined,
          email: email || undefined,
          phone_number: phone_number || undefined,
          updated_at: new Date().toISOString()
        })
        .eq('id', doctor.user_id);

      if (authUpdateError) throw authUpdateError;
    }

    // Update oncologist_profile table
    const { data: updatedDoctor, error: updateError } = await supabase
      .from('oncologist_profile')
      .update({
        hospital_affiliation: hospital || undefined,
        specialty: specialty || undefined,
        bank_name: bank_name || undefined,
        bank_account_number: bank_account_number || undefined,
        bank_account_name: bank_account_name || undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({
      message: 'Profile updated successfully',
      doctor: {
        id: updatedDoctor.id,
        full_name,
        email,
        phone_number,
        hospital: updatedDoctor.hospital_affiliation,
        specialty: updatedDoctor.specialty,
        bank_name: updatedDoctor.bank_name,
        bank_account_number: updatedDoctor.bank_account_number,
        bank_account_name: updatedDoctor.bank_account_name
      }
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/doctors/:id/upload-file — Upload profile photo, signature, or letterhead
app.post('/api/doctors/:id/upload-file', verifyAuth, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { file_type } = req.body;

    if (!file_type || !['profile_photo', 'signature', 'letterhead'].includes(file_type)) {
      return res.status(400).json({ error: 'Invalid file_type. Must be: profile_photo, signature, or letterhead' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Verify doctor owns this profile
    const { data: doctor, error: doctorError } = await supabase
      .from('oncologist_profile')
      .select('user_id')
      .eq('id', id)
      .single();

    if (doctorError || !doctor) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    if (doctor.user_id !== req.user.id) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Upload file to Supabase Storage
    const bucket = 'doctor-documents';
    const filePath = `${id}/${file_type}-${Date.now()}${path.extname(req.file.filename)}`;
    
    const fileContent = fs.readFileSync(req.file.path);
    
    const { data: uploadData, error: uploadError } = await supabase
      .storage
      .from(bucket)
      .upload(filePath, fileContent, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      throw uploadError;
    }

    // Get public URL
    const { data: urlData } = supabase
      .storage
      .from(bucket)
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Update database with file URL
    const updateData = {};
    if (file_type === 'profile_photo') {
      updateData.profile_photo_url = publicUrl;
    } else if (file_type === 'signature') {
      updateData.signature_url = publicUrl;
    } else if (file_type === 'letterhead') {
      updateData.letterhead_url = publicUrl;
    }

    updateData.updated_at = new Date().toISOString();

    const { data: updatedDoctor, error: updateError } = await supabase
      .from('oncologist_profile')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      throw updateError;
    }

    // Clean up local temp file
    fs.unlinkSync(req.file.path);

    res.json({
      message: `${file_type.replace(/_/g, ' ')} uploaded successfully`,
      file_type,
      url: publicUrl,
      doctor: {
        id: updatedDoctor.id,
        profile_photo_url: updatedDoctor.profile_photo_url,
        signature_url: updatedDoctor.signature_url,
        letterhead_url: updatedDoctor.letterhead_url
      }
    });
  } catch (err) {
    // Clean up uploaded file if it exists
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error uploading file:', err);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// EMERGENCY ALERT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/alerts/trigger — Trigger emergency alert (via symptom severity or manual)
app.post('/api/alerts/trigger', verifyAuth, async (req, res) => {
  try {
    const { patient_id, alert_type, severity_level, message, symptom_log_id } = req.body;

    if (!patient_id || !alert_type || !severity_level || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get patient details
    const { data: patient } = await supabase
      .from('patient_profile')
      .select('id, user_id, assigned_oncologist_id')
      .eq('id', patient_id)
      .eq('user_id', req.user.id)
      .single();

    if (!patient) return res.status(403).json({ error: 'Unauthorized' });

    // Create alert
    const { data: alert, error: alertError } = await supabase
      .from('alert')
      .insert({
        patient_id,
        oncologist_id: patient.assigned_oncologist_id,
        alert_type,
        severity_level,
        message,
        symptom_log_id,
        status: 'active'
      })
      .select()
      .single();

    if (alertError) throw alertError;

    // Update symptom_log if provided
    if (symptom_log_id) {
      await supabase
        .from('symptom_log')
        .update({ alert_triggered: true })
        .eq('id', symptom_log_id);
    }

    res.status(201).json({
      alert_id: alert.id,
      alert_type,
      severity_level,
      status: alert.status,
      triggered_at: alert.triggered_at,
      message: 'Emergency alert triggered successfully'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts — Fetch alerts (for patient or oncologist)
app.get('/api/alerts', verifyAuth, async (req, res) => {
  try {
    const { status, severity_level } = req.query;

    // Determine if user is patient or oncologist
    const { data: patient } = await supabase
      .from('patient_profile')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    const { data: oncologist } = await supabase
      .from('oncologist_profile')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    let query = supabase.from('alert').select(`
      id,
      patient_id,
      oncologist_id,
      alert_type,
      severity_level,
      message,
      status,
      triggered_at,
      acknowledged_at,
      resolved_at,
      resolution_notes,
      patient_profile (
        auth_user (full_name, phone_number)
      )
    `);

    // Filter based on user role
    if (patient) {
      query = query.eq('patient_id', patient.id);
    } else if (oncologist) {
      query = query.eq('oncologist_id', oncologist.id);
    } else {
      return res.status(403).json({ error: 'User profile not found' });
    }

    // Apply filters
    if (status) query = query.eq('status', status);
    if (severity_level) query = query.gte('severity_level', parseInt(severity_level));

    const { data: alerts, error: alertsError } = await query.order('triggered_at', { ascending: false });

    if (alertsError) throw alertsError;

    res.json({
      total_alerts: alerts?.length || 0,
      alerts: alerts || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/alerts/:id — Get specific alert details
app.get('/api/alerts/:id', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: alert, error: alertError } = await supabase
      .from('alert')
      .select(`
        *,
        patient_profile (
          auth_user (full_name, phone_number)
        ),
        oncologist_profile (
          auth_user (full_name)
        ),
        symptom_log (*)
      `)
      .eq('id', id)
      .single();

    if (alertError) throw alertError;
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Verify access
    if (alert.oncologist_id !== req.user.doctor_id && 
        alert.patient_id !== req.user.patient_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    res.json({ alert });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/alerts/:id/acknowledge — Acknowledge alert
app.put('/api/alerts/:id/acknowledge', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: alert } = await supabase
      .from('alert')
      .select('id, oncologist_id, patient_id')
      .eq('id', id)
      .single();

    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Verify access (must be oncologist or patient)
    const { data: oncologist } = await supabase
      .from('oncologist_profile')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    const { data: patient } = await supabase
      .from('patient_profile')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (oncologist?.id !== alert.oncologist_id && patient?.id !== alert.patient_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { error: updateError } = await supabase
      .from('alert')
      .update({
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: req.user.id
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({
      alert_id: id,
      status: 'acknowledged',
      acknowledged_at: new Date().toISOString(),
      message: 'Alert acknowledged'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/alerts/:id/resolve — Resolve alert with notes
app.put('/api/alerts/:id/resolve', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution_notes } = req.body;

    const { data: alert } = await supabase
      .from('alert')
      .select('id, oncologist_id')
      .eq('id', id)
      .single();

    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    // Verify access (must be oncologist)
    const { data: oncologist } = await supabase
      .from('oncologist_profile')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('id', alert.oncologist_id)
      .single();

    if (!oncologist) return res.status(403).json({ error: 'Only oncologist can resolve alerts' });

    const { error: updateError } = await supabase
      .from('alert')
      .update({
        status: 'resolved',
        resolved_at: new Date().toISOString(),
        resolved_by: req.user.id,
        resolution_notes
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({
      alert_id: id,
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      message: 'Alert resolved'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ════════════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ════════════════════════════════════════════════════════════════════════════
// START SERVER
// ════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀 OncoConnect backend running on http://localhost:${PORT}`);
  console.log(`📚 Supabase: ${process.env.SUPABASE_URL}`);
});

module.exports = app;
