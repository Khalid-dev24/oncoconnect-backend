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
  console.log('E2E bidirectional test starting...');
  try {
    const stamp = Date.now();
    // create doctor
    const doctorEmail = `e2e-doc-${stamp}@example.com`;
    const patientEmail = `e2e-pat-${stamp}@example.com`;

    const { data: docAuthData, error: docAuthErr } = await supabase.auth.admin.createUser({
      email: doctorEmail,
      password: 'E2Epassword!23',
      email_confirm: true,
      user_metadata: { role: 'oncologist' }
    });
    if (docAuthErr) throw docAuthErr;
    const doctorUserId = docAuthData.user.id;
    const { data: docUser } = await supabase.from('auth_user').insert([{ id: doctorUserId, role: 'oncologist', phone_number: `0800${stamp}`, full_name: 'E2E Doctor', email: doctorEmail }]).select().single();
    const { data: oncProfile } = await supabase.from('oncologist_profile').insert([{ user_id: doctorUserId, mdcn_number: `MD${stamp}`, invite_code: `E2E${rnd()}`, hospital_affiliation: 'E2E Hospital' }]).select().single();

    // create patient
    const { data: patAuthData, error: patAuthErr } = await supabase.auth.admin.createUser({
      email: patientEmail,
      password: 'E2Epassword!23',
      email_confirm: true,
      user_metadata: { role: 'patient' }
    });
    if (patAuthErr) throw patAuthErr;
    const patientUserId = patAuthData.user.id;
    const { data: patUser } = await supabase.from('auth_user').insert([{ id: patientUserId, role: 'patient', phone_number: `0811${stamp}`, full_name: 'E2E Patient', email: patientEmail }]).select().single();
    const { data: patientProfile } = await supabase.from('patient_profile').insert([{ user_id: patientUserId, assigned_oncologist_id: oncProfile.id, cancer_type: 'Test' }]).select().single();

    // create window
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const { data: window } = await supabase.from('consultation_window').insert([{ patient_id: patientProfile.id, oncologist_id: oncProfile.id, expires_at: expiresAt, status: 'active' }]).select().single();

    // JWTs
    const doctorJWT = jwt.sign({ user_id: doctorUserId, doctor_id: oncProfile.id, role: 'oncologist' }, JWT_SECRET, { expiresIn: '1h' });
    const patientJWT = jwt.sign({ user_id: patientUserId, role: 'patient' }, JWT_SECRET, { expiresIn: '1h' });

    // connect patient socket and doctor socket
    console.log('connecting patient socket...');
    const pSocket = io(API_BASE, { auth: { token: patientJWT }, transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Patient socket connect timeout')), 5000);
      pSocket.on('connect', () => { clearTimeout(t); resolve(); });
      pSocket.on('connect_error', (e) => reject(e));
    });
    console.log('patient connected', pSocket.id);

    console.log('connecting doctor socket...');
    const dSocket = io(API_BASE, { auth: { token: doctorJWT }, transports: ['websocket'] });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Doctor socket connect timeout')), 5000);
      dSocket.on('connect', () => { clearTimeout(t); resolve(); });
      dSocket.on('connect_error', (e) => reject(e));
    });
    console.log('doctor connected', dSocket.id);

    // join room
    pSocket.emit('join_window', { windowId: window.id });
    dSocket.emit('join_window', { windowId: window.id });

    // prepare promises with message tracking
    let patientMsgs = [];
    let doctorMsgs = [];

    pSocket.on('new_message', (msg) => { patientMsgs.push(msg); });
    dSocket.on('new_message', (msg) => { doctorMsgs.push(msg); });

    // doctor sends message via HTTP
    console.log('Doctor sending message via HTTP...');
    await axios.post(`${API_BASE}/api/conversations/${window.id}/messages`, { text: 'Hello from doctor' }, { headers: { Authorization: `Bearer ${doctorJWT}` } });

    // wait for patient to receive
    await new Promise(resolve => setTimeout(resolve, 500));
    const pdMsg = patientMsgs.find(m => m.text === 'Hello from doctor');
    if (!pdMsg) throw new Error('Patient did not receive doctor message');
    console.log('Patient received:', pdMsg.text);

    // patient sends message via HTTP
    console.log('Patient sending message via HTTP...');
    await axios.post(`${API_BASE}/api/conversations/${window.id}/messages`, { text: 'Hello from patient' }, { headers: { Authorization: `Bearer ${patientJWT}` } });

    // wait for doctor to receive
    await new Promise(resolve => setTimeout(resolve, 500));
    const dpMsg = doctorMsgs.find(m => m.text === 'Hello from patient');
    if (!dpMsg) throw new Error('Doctor did not receive patient message');
    console.log('Doctor received:', dpMsg.text);

    console.log('Bidirectional E2E success');

    // cleanup
    try {
      await supabase.from('message').delete().eq('window_id', window.id);
      await supabase.from('consultation_window').delete().eq('id', window.id);
      await supabase.from('patient_profile').delete().eq('id', patientProfile.id);
      await supabase.from('auth_user').delete().in('id', [patientUserId, doctorUserId]);
      await supabase.from('oncologist_profile').delete().eq('id', oncProfile.id);
    } catch (e) { console.warn('cleanup failed', e); }

    pSocket.disconnect();
    dSocket.disconnect();

    process.exit(0);
  } catch (err) {
    console.error('E2E bidirectional test failed:', err);
    process.exit(2);
  }
})();
