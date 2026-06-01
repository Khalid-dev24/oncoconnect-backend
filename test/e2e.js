// E2E test: create doctor+patient, window, then send message as patient and listen as doctor socket
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const io = require('socket.io-client');
const jwt = require('jsonwebtoken');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_BASE = process.env.SOCKET_URL || `http://localhost:${process.env.PORT || 4000}`;
const JWT_SECRET = process.env.JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET in env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function rnd() { return Math.random().toString(36).slice(2, 9); }

(async function run() {
  console.log('E2E test starting...');
  try {
    const stamp = Date.now();
    // 1) Create doctor auth user
    const doctorEmail = `e2e-doctor-${stamp}@example.com`;
    const patientEmail = `e2e-patient-${stamp}@example.com`;

    console.log('Creating doctor auth.user...');
    const { data: docAuthData, error: docAuthErr } = await supabase.auth.admin.createUser({
      email: doctorEmail,
      password: 'E2Epassword!23',
      email_confirm: true,
      user_metadata: { role: 'oncologist' }
    });
    if (docAuthErr) throw docAuthErr;
    const doctorUserId = docAuthData.user.id;

    console.log('Inserting auth_user for doctor...');
    const { data: docUser } = await supabase.from('auth_user').insert([{ id: doctorUserId, role: 'oncologist', phone_number: `0800${stamp}`, full_name: 'E2E Doctor', email: doctorEmail }]).select().single();

    console.log('Creating oncologist_profile...');
    const mdcn = `MD${stamp}`;
    const invite_code = `E2E${rnd()}`;
    const { data: oncProfile } = await supabase.from('oncologist_profile').insert([{ user_id: doctorUserId, mdcn_number: mdcn, invite_code, hospital_affiliation: 'E2E Hospital' }]).select().single();

    // 2) Create patient
    console.log('Creating patient auth.user...');
    const { data: patAuthData, error: patAuthErr } = await supabase.auth.admin.createUser({
      email: patientEmail,
      password: 'E2Epassword!23',
      email_confirm: true,
      user_metadata: { role: 'patient' }
    });
    if (patAuthErr) throw patAuthErr;
    const patientUserId = patAuthData.user.id;

    console.log('Inserting auth_user for patient...');
    const { data: patUser } = await supabase.from('auth_user').insert([{ id: patientUserId, role: 'patient', phone_number: `0811${stamp}`, full_name: 'E2E Patient', email: patientEmail }]).select().single();

    console.log('Creating patient_profile...');
    const { data: patientProfile } = await supabase.from('patient_profile').insert([{ user_id: patientUserId, assigned_oncologist_id: oncProfile.id, cancer_type: 'Test' }]).select().single();

    // 3) Create consultation_window
    console.log('Creating consultation window...');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const { data: window } = await supabase.from('consultation_window').insert([{ patient_id: patientProfile.id, oncologist_id: oncProfile.id, expires_at: expiresAt, status: 'active' }]).select().single();

    // 4) Build JWTs
    const doctorJWT = jwt.sign({ user_id: doctorUserId, doctor_id: oncProfile.id, role: 'oncologist' }, JWT_SECRET, { expiresIn: '1h' });
    const patientJWT = jwt.sign({ user_id: patientUserId, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });

    console.log('Doctor JWT & Patient JWT created');

    // 5) Connect socket as doctor
    console.log('Connecting doctor socket...');
    const socket = io(API_BASE, { auth: { token: doctorJWT }, transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
      socket.on('connect', () => { clearTimeout(t); resolve(); });
      socket.on('connect_error', (e) => reject(e));
    });

    console.log('Doctor socket connected:', socket.id);

    const messagePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Did not receive new_message within timeout')), 10000);
      socket.on('new_message', (msg) => {
        clearTimeout(timeout);
        console.log('Socket received new_message:', msg);
        resolve(msg);
      });
    });

    // 6) Send message as patient via REST
    console.log('Sending message as patient to conversation', window.id);
    const sendResp = await axios.post(`${API_BASE}/api/conversations/${window.id}/messages`, { text: 'E2E test message from patient' }, { headers: { Authorization: `Bearer ${patientJWT}`, 'Content-Type': 'application/json' } });
    console.log('HTTP send response status', sendResp.status);

    // 7) Wait for socket event
    const received = await messagePromise;
    if (!received) throw new Error('No message received');
    if (received.text && received.text.includes('E2E test message')) {
      console.log('E2E test SUCCESS: Doctor received message via socket');
    } else {
      console.warn('E2E test: message content mismatch', received);
    }

    // Cleanup (best-effort)
    console.log('Cleaning up test records...');
    try {
      await supabase.from('message').delete().eq('window_id', window.id);
      await supabase.from('consultation_window').delete().eq('id', window.id);
      await supabase.from('patient_profile').delete().eq('id', patientProfile.id);
      await supabase.from('auth_user').delete().in('id', [patientUserId, doctorUserId]);
      await supabase.from('oncologist_profile').delete().eq('id', oncProfile.id);
      // Note: deleting auth.users via admin may be optional
    } catch (cleanupErr) {
      console.warn('Cleanup error (continuing):', cleanupErr.message || cleanupErr);
    }

    socket.disconnect();
    console.log('E2E test finished successfully');
    process.exit(0);
  } catch (err) {
    console.error('E2E test failed:', err);
    process.exit(2);
  }
})();
