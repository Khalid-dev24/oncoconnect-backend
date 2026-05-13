// ════════════════════════════════════════════════════════════════════════════
// ONCOCONNECT BACKEND SERVER
// ════════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ────────────────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT
// ────────────────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Service role for server-side operations
);

// ────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE — Verify JWT from Supabase
// ────────────────────────────────────────────────────────────────────────────
async function verifyAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token', details: err.message });
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

// GET /api/doctors/:id/dashboard — Doctor dashboard data
app.get('/api/doctors/:id/dashboard', verifyAuth, async (req, res) => {
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

    // Fetch all patients
    const { data: patients } = await supabase
      .from('patient_profile')
      .select('id, user_id, cancer_type, treatment_status')
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

// GET /api/doctors/:id/invite-code — Get or regenerate invite code
app.get('/api/doctors/:id/invite-code', verifyAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: doctor } = await supabase
      .from('oncologist_profile')
      .select('invite_code')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (!doctor) return res.status(403).json({ error: 'Unauthorized' });

    res.json({ invite_code: doctor.invite_code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PATIENT ENDPOINTS
// ════════════════════════════════════════════════════════════════════════════

// POST /api/patients/register-with-code — Patient joins via invite code
app.post('/api/patients/register-with-code', async (req, res) => {
  try {
    const { phone_number, full_name, invite_code, cancer_type, cancer_stage } = req.body;

    if (!phone_number || !full_name || !invite_code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify invite code exists and get oncologist
    const { data: oncologist } = await supabase
      .from('oncologist_profile')
      .select('id')
      .eq('invite_code', invite_code)
      .single();

    if (!oncologist) return res.status(400).json({ error: 'Invalid invite code' });

    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: `${phone_number}@oncoconnect.local`,
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
        full_name
      });

    // Create patient_profile
    const { data: patientProfile, error: profileError } = await supabase
      .from('patient_profile')
      .insert({
        user_id: authData.user.id,
        assigned_oncologist_id: oncologist.id,
        cancer_type,
        cancer_stage
      })
      .select()
      .single();

    if (profileError) throw profileError;

    res.status(201).json({
      message: 'Patient registered successfully',
      patient: {
        id: patientProfile.id,
        name: full_name,
        cancer_type,
        oncologist_id: oncologist.id
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
app.post('/api/consultations/verify-payment', async (req, res) => {
  try {
    const { reference, payment_id } = req.body;

    if (!reference) return res.status(400).json({ error: 'No reference provided' });

    // Verify with Paystack
    const paystackResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
      }
    );

    if (paystackResponse.data.status !== true || paystackResponse.data.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Update payment record
    const paymentData = paystackResponse.data.data;
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

    // Get patient and create consultation window
    const { data: payment } = await supabase
      .from('payment')
      .select('patient_id, oncologist_id')
      .eq('id', payment_id)
      .single();

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
