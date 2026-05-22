
// Admin Dashboard API Endpoints

const express = require('express');
const router = express.Router();

// ==========================================
// GET ALL DOCTORS (with filters)
// ==========================================
router.get('/api/admin/doctors', async (req, res) => {
  try {
    const { status } = req.query; // all, verified, pending

    let query = supabase
      .from('oncologist_profile')
      .select(`
        id,
        user_id,
        mdcn_number,
        hospital_affiliation,
        specialty,
        invite_code,
        is_verified,
        bank_name,
        bank_account_number,
        created_at,
        auth_user:user_id (
          full_name,
          phone_number,
          email
        )
      `);

    if (status === 'verified') {
      query = query.eq('is_verified', true);
    } else if (status === 'pending') {
      query = query.eq('is_verified', false);
    }

    const { data: doctors, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Get patient count and earnings for each doctor
    const enrichedDoctors = await Promise.all(
      doctors.map(async (doctor) => {
        const { count: patientCount } = await supabase
          .from('patient_profile')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_oncologist_id', doctor.id);

        const { data: earnings } = await supabase
          .from('payment')
          .select('doctor_share')
          .eq('doctor_id', doctor.user_id);

        const totalEarnings = earnings?.reduce((sum, p) => sum + (p.doctor_share || 0), 0) || 0;

        return {
          ...doctor,
          patients: patientCount || 0,
          earnings: totalEarnings,
          name: doctor.auth_user?.full_name,
          phone: doctor.auth_user?.phone_number,
          email: doctor.auth_user?.email,
        };
      })
    );

    res.status(200).json({
      success: true,
      doctors: enrichedDoctors,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GET SINGLE DOCTOR DETAILS
// ==========================================
router.get('/api/admin/doctors/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: doctor, error } = await supabase
      .from('oncologist_profile')
      .select(`
        *,
        auth_user:user_id (
          full_name,
          phone_number,
          email
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    // Get patients
    const { data: patients } = await supabase
      .from('patient_profile')
      .select('*')
      .eq('assigned_oncologist_id', id);

    // Get earnings
    const { data: earnings } = await supabase
      .from('payment')
      .select('*')
      .eq('doctor_id', doctor.user_id)
      .order('created_at', { ascending: false })
      .limit(10);

    res.status(200).json({
      success: true,
      doctor: {
        ...doctor,
        name: doctor.auth_user?.full_name,
        phone: doctor.auth_user?.phone_number,
        email: doctor.auth_user?.email,
        patients: patients || [],
        recentEarnings: earnings || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// VERIFY DOCTOR
// ==========================================
router.put('/api/admin/doctors/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('oncologist_profile')
      .update({ is_verified: true })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    res.status(200).json({
      success: true,
      message: 'Doctor verified successfully',
      doctor: data,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// REJECT DOCTOR
// ==========================================
router.delete('/api/admin/doctors/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;

    // Get user_id first
    const { data: doctor } = await supabase
      .from('oncologist_profile')
      .select('user_id')
      .eq('id', id)
      .single();

    // Delete doctor profile
    await supabase
      .from('oncologist_profile')
      .delete()
      .eq('id', id);

    // Delete auth user
    if (doctor?.user_id) {
      await supabase.auth.admin.deleteUser(doctor.user_id);
    }

    res.status(200).json({
      success: true,
      message: 'Doctor application rejected',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GET ALL PATIENTS
// ==========================================
router.get('/api/admin/patients', async (req, res) => {
  try {
    const { status } = req.query; // all, active, inactive

    let query = supabase
      .from('patient_profile')
      .select(`
        id,
        user_id,
        cancer_type,
        cancer_stage,
        treatment_status,
        risk_score,
        created_at,
        auth_user:user_id (
          full_name,
          phone_number,
          email
        ),
        oncologist:assigned_oncologist_id (
          auth_user:user_id (
            full_name
          )
        )
      `);

    const { data: patients, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const enrichedPatients = patients.map((p) => ({
      ...p,
      name: p.auth_user?.full_name,
      phone: p.auth_user?.phone_number,
      email: p.auth_user?.email,
      doctorName: p.oncologist?.auth_user?.full_name,
      riskBadge: p.risk_score >= 70 ? 'Red' : p.risk_score >= 50 ? 'Amber' : 'Green',
    }));

    res.status(200).json({
      success: true,
      patients: enrichedPatients,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GET SINGLE PATIENT DETAILS
// ==========================================
router.get('/api/admin/patients/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: patient, error } = await supabase
      .from('patient_profile')
      .select(`
        *,
        auth_user:user_id (
          full_name,
          phone_number,
          email
        ),
        oncologist:assigned_oncologist_id (
          auth_user:user_id (
            full_name
          )
        )
      `)
      .eq('id', id)
      .single();

    if (error) throw error;

    // Get symptom logs
    const { data: symptoms } = await supabase
      .from('symptom_log')
      .select('*')
      .eq('patient_id', id)
      .order('logged_at', { ascending: false })
      .limit(10);

    // Get medication logs
    const { data: medications } = await supabase
      .from('medication_log')
      .select('*')
      .eq('patient_id', id)
      .order('logged_at', { ascending: false })
      .limit(10);

    // Get consultation windows
    const { data: consultations } = await supabase
      .from('consultation_window')
      .select('*')
      .eq('patient_id', id)
      .order('created_at', { ascending: false })
      .limit(5);

    res.status(200).json({
      success: true,
      patient: {
        ...patient,
        name: patient.auth_user?.full_name,
        phone: patient.auth_user?.phone_number,
        email: patient.auth_user?.email,
        doctorName: patient.oncologist?.auth_user?.full_name,
        riskBadge: patient.risk_score >= 70 ? 'Red' : patient.risk_score >= 50 ? 'Amber' : 'Green',
        symptoms: symptoms || [],
        medications: medications || [],
        consultations: consultations || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GET ALL EARNINGS/TRANSACTIONS
// ==========================================
router.get('/api/admin/earnings', async (req, res) => {
  try {
    const { doctorId, patientId, timeframe } = req.query;

    let query = supabase
      .from('payment')
      .select(`
        *,
        doctor:doctor_id (
          auth_user:user_id (
            full_name
          )
        ),
        patient:patient_id (
          auth_user:user_id (
            full_name
          )
        )
      `);

    if (doctorId) {
      query = query.eq('doctor_id', doctorId);
    }
    if (patientId) {
      query = query.eq('patient_id', patientId);
    }

    const { data: transactions, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate totals
    const totalAmount = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const platformFee = transactions.reduce((sum, t) => sum + (t.platform_fee || 0), 0);
    const doctorPayouts = transactions.reduce((sum, t) => sum + (t.doctor_share || 0), 0);

    res.status(200).json({
      success: true,
      transactions: transactions.map((t) => ({
        ...t,
        doctorName: t.doctor?.auth_user?.full_name,
        patientName: t.patient?.auth_user?.full_name,
      })),
      totals: {
        totalAmount,
        platformFee,
        doctorPayouts,
        transactionCount: transactions.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// GET PLATFORM STATS
// ==========================================
router.get('/api/admin/stats', async (req, res) => {
  try {
    // Total doctors
    const { count: totalDoctors } = await supabase
      .from('oncologist_profile')
      .select('*', { count: 'exact', head: true });

    // Verified doctors
    const { count: verifiedDoctors } = await supabase
      .from('oncologist_profile')
      .select('*', { count: 'exact', head: true })
      .eq('is_verified', true);

    // Total patients
    const { count: totalPatients } = await supabase
      .from('patient_profile')
      .select('*', { count: 'exact', head: true });

    // Total earnings
    const { data: payments } = await supabase
      .from('payment')
      .select('amount, platform_fee, doctor_share');

    const totalAmount = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
    const platformFee = payments?.reduce((sum, p) => sum + (p.platform_fee || 0), 0) || 0;
    const doctorPayouts = payments?.reduce((sum, p) => sum + (p.doctor_share || 0), 0) || 0;

    // This month earnings
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const { data: monthlyPayments } = await supabase
      .from('payment')
      .select('amount')
      .gte('created_at', startOfMonth.toISOString());

    const monthlyEarnings = monthlyPayments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;

    res.status(200).json({
      success: true,
      stats: {
        totalDoctors: totalDoctors || 0,
        verifiedDoctors: verifiedDoctors || 0,
        pendingDoctors: (totalDoctors || 0) - (verifiedDoctors || 0),
        totalPatients: totalPatients || 0,
        totalEarnings: totalAmount,
        monthlyEarnings: monthlyEarnings,
        platformFee,
        doctorPayouts,
        totalConsultations: payments?.length || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;