function normalizeNigerianPhoneNumber(value) {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('234')) {
    digits = digits.slice(3).replace(/^0+/, '');
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  return digits.length === 10 ? `+234${digits}` : '';
}

function normalizeMdcnNumber(value) {
  return String(value || '').trim().toUpperCase();
}

async function persistDoctorRegistration(supabase, {
  phone_number,
  full_name,
  email,
  mdcn_number,
  hospital,
  specialty,
  bank_name,
  bank_account,
  bank_account_name,
  invite_code,
}) {
  const phoneNumber = normalizeNigerianPhoneNumber(phone_number);
  const mdcnNumber = normalizeMdcnNumber(mdcn_number);

  if (!phoneNumber || !full_name || !mdcnNumber) {
    throw new Error('Missing or invalid required doctor fields');
  }

  const authEmail = email || `${phoneNumber}@oncoconnect.local`;
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: authEmail,
    phone: phoneNumber,
    password: require('crypto').randomBytes(16).toString('hex'),
    email_confirm: true,
    phone_confirm: false,
    user_metadata: { phone: phoneNumber, role: 'oncologist' },
  });

  if (authError) throw authError;

  const userId = authData.user.id;
  try {
    const { error: userError } = await supabase.from('auth_user').insert({
      id: userId,
      role: 'oncologist',
      phone_number: phoneNumber,
      full_name,
      email: email || null,
    });
    if (userError) throw userError;

    const { data: doctorProfile, error: profileError } = await supabase
      .from('oncologist_profile')
      .insert({
        user_id: userId,
        mdcn_number: mdcnNumber,
        phone_number: phoneNumber,
        hospital_affiliation: hospital,
        specialty,
        invite_code,
        bank_name,
        bank_account_number: bank_account,
        bank_account_name: bank_account_name || null,
        is_verified: false,
      })
      .select()
      .single();

    if (profileError) throw profileError;

    return { authUser: authData.user, doctorProfile, phoneNumber, mdcnNumber };
  } catch (error) {
    try {
      await supabase.from('auth_user').delete().eq('id', userId);
      await supabase.auth.admin.deleteUser(userId);
    } catch (cleanupError) {
      console.warn('Could not clean up incomplete doctor registration:', cleanupError.message);
    }
    throw error;
  }
}

async function findAndSyncDoctorForLogin(supabase, { mdcn_number, phone_number }) {
  const mdcnNumber = normalizeMdcnNumber(mdcn_number);
  const phoneNumber = normalizeNigerianPhoneNumber(phone_number);
  if (!mdcnNumber || !phoneNumber) return null;

  const { data: doctorProfile, error: profileError } = await supabase
    .from('oncologist_profile')
    .select('id, user_id, mdcn_number, phone_number, hospital_affiliation, specialty, bank_name, bank_account_number, bank_account_name, signature_url, letterhead_url, is_verified')
    .ilike('mdcn_number', mdcnNumber)
    .maybeSingle();

  if (profileError) throw profileError;
  if (!doctorProfile) return null;
  if (normalizeMdcnNumber(doctorProfile.mdcn_number) !== mdcnNumber) return null;

  const { data: authUser, error: userError } = await supabase
    .from('auth_user')
    .select('phone_number, full_name, email, id')
    .eq('id', doctorProfile.user_id)
    .maybeSingle();

  if (userError) throw userError;
  if (!authUser) return null;

  const authPhoneNumber = normalizeNigerianPhoneNumber(authUser.phone_number);
  const profilePhoneNumber = normalizeNigerianPhoneNumber(doctorProfile.phone_number);

  if (authPhoneNumber && profilePhoneNumber && authPhoneNumber !== profilePhoneNumber) return null;
  if ((authPhoneNumber || profilePhoneNumber) !== phoneNumber) return null;

  const { error: userUpdateError } = await supabase
    .from('auth_user')
    .update({ phone_number: phoneNumber })
    .eq('id', authUser.id);
  if (userUpdateError) throw userUpdateError;

  const { error: profileUpdateError } = await supabase
    .from('oncologist_profile')
    .update({ phone_number: phoneNumber })
    .eq('id', doctorProfile.id);
  if (profileUpdateError) throw profileUpdateError;

  const { error: authPhoneUpdateError } = await supabase.auth.admin.updateUserById(
    authUser.id,
    { phone: phoneNumber }
  );
  if (authPhoneUpdateError) throw authPhoneUpdateError;

  return { authUser, doctorProfile, phoneNumber, mdcnNumber };
}

module.exports = {
  findAndSyncDoctorForLogin,
  normalizeMdcnNumber,
  normalizeNigerianPhoneNumber,
  persistDoctorRegistration,
};