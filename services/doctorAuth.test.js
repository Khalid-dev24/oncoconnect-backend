const {
  findAndSyncDoctorForLogin,
  normalizeNigerianPhoneNumber,
  persistDoctorRegistration,
} = require('./doctorAuth');

function makeSupabase({ authUser, doctorProfile } = {}) {
  const inserted = {};
  const selected = {};
  const updated = {};
  const supabase = {
    auth: {
      admin: {
        createUser: jest.fn(async () => ({ data: { user: { id: 'auth-user-id' } }, error: null })),
        deleteUser: jest.fn(async () => ({ error: null })),
        updateUserById: jest.fn(async () => ({ error: null })),
      },
    },
    from: jest.fn((table) => {
      let operation = '';
      const query = {
        delete: jest.fn(() => {
          operation = 'delete';
          return query;
        }),
        eq: jest.fn(() => (operation === 'update' || operation === 'delete'
          ? Promise.resolve({ error: null })
          : query)),
        ilike: jest.fn(() => query),
        insert: jest.fn((payload) => {
          inserted[table] = payload;
          operation = 'insert';
          return query;
        }),
        maybeSingle: jest.fn(async () => ({
          data: table === 'oncologist_profile' ? doctorProfile || null : authUser || null,
          error: null,
        })),
        select: jest.fn((columns) => {
          selected[table] = columns;
          return query;
        }),
        single: jest.fn(async () => ({ data: doctorProfile, error: null })),
        update: jest.fn((payload) => {
          updated[table] = payload;
          operation = 'update';
          return query;
        }),
        then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
      };
      return query;
    }),
  };

  return { supabase, inserted, selected, updated };
}

describe('doctor auth phone normalization', () => {
  it.each([
    ['0803 555 0123', '+2348035550123'],
    ['+234 803 555 0123', '+2348035550123'],
    ['23408035550123', '+2348035550123'],
    ['8035550123', '+2348035550123'],
  ])('normalizes %s to the canonical Nigerian format', (input, expected) => {
    expect(normalizeNigerianPhoneNumber(input)).toBe(expected);
  });

  it('rejects incomplete phone numbers', () => {
    expect(normalizeNigerianPhoneNumber('0803-555')).toBe('');
  });
});

describe('persistDoctorRegistration', () => {
  it('persists the canonical phone to Supabase Auth and both linked public records', async () => {
    const { supabase, inserted } = makeSupabase({
      doctorProfile: { id: 'doctor-profile-id', user_id: 'auth-user-id' },
    });

    const result = await persistDoctorRegistration(supabase, {
      phone_number: '0803 555 0123',
      full_name: 'Test Doctor',
      email: 'doctor@example.invalid',
      mdcn_number: ' mdcn/test/2026 ',
      invite_code: 'TST-123',
    });

    expect(supabase.auth.admin.createUser).toHaveBeenCalledWith(expect.objectContaining({
      phone: '+2348035550123',
      user_metadata: { phone: '+2348035550123', role: 'oncologist' },
    }));
    expect(inserted.auth_user).toEqual(expect.objectContaining({
      id: 'auth-user-id',
      phone_number: '+2348035550123',
    }));
    expect(inserted.oncologist_profile).toEqual(expect.objectContaining({
      user_id: 'auth-user-id',
      phone_number: '+2348035550123',
      mdcn_number: 'MDCN/TEST/2026',
    }));
    expect(result.doctorProfile.user_id).toBe(result.authUser.id);
    expect(result.phoneNumber).toBe('+2348035550123');
  });
});

describe('findAndSyncDoctorForLogin', () => {
  const doctorProfile = {
    id: 'doctor-profile-id',
    user_id: 'auth-user-id',
    mdcn_number: 'MDCN/TEST/2026',
    phone_number: '23408035550123',
  };

  it('logs in across Nigerian phone formats and repairs all persisted formats', async () => {
    const { supabase, selected, updated } = makeSupabase({
      authUser: { id: 'auth-user-id', phone_number: '08035550123', full_name: 'Test Doctor' },
      doctorProfile,
    });

    const result = await findAndSyncDoctorForLogin(supabase, {
      mdcn_number: ' mdcn/test/2026 ',
      phone_number: '+234 803 555 0123',
    });

    expect(result).toEqual(expect.objectContaining({ phoneNumber: '+2348035550123' }));
    expect(selected.oncologist_profile).not.toContain('profile_photo_url');
    expect(selected.oncologist_profile).toContain('signature_url');
    expect(supabase.from).toHaveBeenCalledWith('auth_user');
    expect(updated.auth_user).toEqual({ phone_number: '+2348035550123' });
    expect(updated.oncologist_profile).toEqual({ phone_number: '+2348035550123' });
    expect(supabase.auth.admin.updateUserById).toHaveBeenCalledWith('auth-user-id', {
      phone: '+2348035550123',
    });
  });

  it('uses the matching profile phone to repair a null auth_user phone', async () => {
    const { supabase, updated } = makeSupabase({
      authUser: { id: 'auth-user-id', phone_number: null },
      doctorProfile: { ...doctorProfile, phone_number: '+2348035550123' },
    });

    const result = await findAndSyncDoctorForLogin(supabase, {
      mdcn_number: 'MDCN/TEST/2026',
      phone_number: '08035550123',
    });

    expect(result).not.toBeNull();
    expect(updated.auth_user.phone_number).toBe('+2348035550123');
  });

  it('rejects accounts when both persisted phone fields are missing', async () => {
    const { supabase, updated } = makeSupabase({
      authUser: { id: 'auth-user-id', phone_number: null },
      doctorProfile: { ...doctorProfile, phone_number: null },
    });

    await expect(findAndSyncDoctorForLogin(supabase, {
      mdcn_number: 'MDCN/TEST/2026',
      phone_number: '08035550123',
    })).resolves.toBeNull();
    expect(updated).toEqual({});
  });

  it('rejects conflicting stored numbers and a mismatched supplied number', async () => {
    const { supabase, updated } = makeSupabase({
      authUser: { id: 'auth-user-id', phone_number: '08031112222' },
      doctorProfile,
    });

    await expect(findAndSyncDoctorForLogin(supabase, {
      mdcn_number: 'MDCN/TEST/2026',
      phone_number: '08035550123',
    })).resolves.toBeNull();
    expect(updated).toEqual({});
  });
});