-- ════════════════════════════════════════════════════════════════════════════
-- ONCOCONNECT SUPABASE SCHEMA — FIXED VERSION
-- ════════════════════════════════════════════════════════════════════════════
-- This migration creates all core tables with Row-Level Security (RLS) for
-- multi-tenancy. Tables created in correct dependency order.

-- ────────────────────────────────────────────────────────────────────────────
-- ENABLE NECESSARY EXTENSIONS
-- ────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────────
-- 1. AUTH_USER — Base user table (extends Supabase auth)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.auth_user (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('patient', 'oncologist', 'nurse', 'admin')),
  phone_number TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(phone_number)
);

ALTER TABLE public.auth_user ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see only their own profile" ON public.auth_user;
CREATE POLICY "Users see only their own profile" ON public.auth_user
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.auth_user;
CREATE POLICY "Users can update their own profile" ON public.auth_user
  FOR UPDATE USING (auth.uid() = id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ONCOLOGIST_PROFILE — Individual oncologist data
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.oncologist_profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.auth_user ON DELETE CASCADE,
  mdcn_number TEXT UNIQUE NOT NULL,
  phone_number TEXT,
  hospital_affiliation TEXT,
  specialty TEXT,
  invite_code TEXT UNIQUE NOT NULL,
  letterhead_url TEXT,
  signature_url TEXT,
  stamp_url TEXT,
  paystack_subaccount_code TEXT,
  bank_name TEXT,
  bank_account_number TEXT,
  bank_account_name TEXT,
  is_verified BOOLEAN DEFAULT false,
  verification_notes TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.oncologist_profile ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_oncologist_user ON public.oncologist_profile(user_id);

DROP POLICY IF EXISTS "Oncologists see only their own profile" ON public.oncologist_profile;
CREATE POLICY "Oncologists see only their own profile" ON public.oncologist_profile
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Oncologists can update their own profile" ON public.oncologist_profile;
CREATE POLICY "Oncologists can update their own profile" ON public.oncologist_profile
  FOR UPDATE USING (user_id = auth.uid());

-- Add phone_number column if it doesn't exist
ALTER TABLE public.oncologist_profile
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Backfill existing oncologist phone numbers from auth_user
UPDATE public.oncologist_profile op
SET phone_number = au.phone_number
FROM public.auth_user au
WHERE op.user_id = au.id
AND op.phone_number IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. PATIENT_PROFILE — Patient data linked to oncologist
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.auth_user ON DELETE CASCADE,
  assigned_oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE RESTRICT,
  cancer_type TEXT NOT NULL,
  cancer_stage TEXT CHECK (cancer_stage IN ('I', 'II', 'III', 'IV', 'Unknown')),
  diagnosis_date DATE,
  treatment_status TEXT CHECK (treatment_status IN ('active', 'remission', 'palliative', 'discharged')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.patient_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see only their own profile" ON public.patient_profile;
CREATE POLICY "Patients see only their own profile" ON public.patient_profile
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Oncologists see their assigned patients" ON public.patient_profile;
CREATE POLICY "Oncologists see their assigned patients" ON public.patient_profile
  FOR SELECT USING (
    assigned_oncologist_id IN (
      SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Patients can update their own profile" ON public.patient_profile;
CREATE POLICY "Patients can update their own profile" ON public.patient_profile
  FOR UPDATE USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────────────────
-- 4. PAYMENT — Track all transactions (CREATE BEFORE CONSULTATION_WINDOW)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE CASCADE,
  amount_naira INTEGER NOT NULL,
  platform_share INTEGER NOT NULL,
  doctor_share INTEGER NOT NULL,
  payment_type TEXT CHECK (payment_type IN ('consultation_open', 'window_extension', 'video_call', 'prescription', 'referral_commission')),
  paystack_reference TEXT UNIQUE,
  status TEXT CHECK (status IN ('pending', 'success', 'failed')),
  payout_status TEXT CHECK (payout_status IN ('pending', 'completed', 'failed')),
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their own payments" ON public.payment;
CREATE POLICY "Patients see their own payments" ON public.payment
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their earnings" ON public.payment;
CREATE POLICY "Oncologists see their earnings" ON public.payment
  FOR SELECT USING (oncologist_id IN (
    SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 5. CONSULTATION_WINDOW — The 48-hour gated consultation period
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consultation_window (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE CASCADE,
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT CHECK (status IN ('active', 'expired', 'extended')),
  payment_id UUID REFERENCES public.payment ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.consultation_window ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their own consultation windows" ON public.consultation_window;
CREATE POLICY "Patients see their own consultation windows" ON public.consultation_window
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their patients' consultation windows" ON public.consultation_window;
CREATE POLICY "Oncologists see their patients' consultation windows" ON public.consultation_window
  FOR SELECT USING (oncologist_id IN (
    SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 6. MESSAGE — In-app messaging within consultation windows
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  window_id UUID NOT NULL REFERENCES public.consultation_window ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.auth_user ON DELETE CASCADE,
  body TEXT NOT NULL,
  attachment_url TEXT,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.message ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users in a consultation window see messages" ON public.message;
CREATE POLICY "Users in a consultation window see messages" ON public.message
  FOR SELECT USING (
    window_id IN (
      SELECT cw.id FROM public.consultation_window cw
      WHERE cw.patient_id IN (
        SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
      )
      OR cw.oncologist_id IN (
        SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Users can create messages in their windows" ON public.message;
CREATE POLICY "Users can create messages in their windows" ON public.message
  FOR INSERT WITH CHECK (
    window_id IN (
      SELECT cw.id FROM public.consultation_window cw
      WHERE cw.patient_id IN (
        SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
      )
      OR cw.oncologist_id IN (
        SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
      )
    )
    AND sender_id = auth.uid()
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 7. PRESCRIPTION — Digital prescriptions with QR codes
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prescription (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE CASCADE,
  drug_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration TEXT,
  instructions TEXT,
  pdf_url TEXT,
  qr_verification_code TEXT UNIQUE,
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.prescription ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their prescriptions" ON public.prescription;
CREATE POLICY "Patients see their prescriptions" ON public.prescription
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their prescriptions" ON public.prescription;
CREATE POLICY "Oncologists see their prescriptions" ON public.prescription
  FOR SELECT USING (oncologist_id IN (
    SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 8. DIAGNOSTIC_REFERRAL — Referrals to diagnostic centres
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.diagnostic_referral (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE CASCADE,
  diagnostic_centre_name TEXT NOT NULL,
  test_type TEXT NOT NULL,
  referral_code TEXT UNIQUE NOT NULL,
  status TEXT CHECK (status IN ('pending', 'attended', 'results_uploaded', 'reviewed')),
  result_urls TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  attended_at TIMESTAMP WITH TIME ZONE,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.diagnostic_referral ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their referrals" ON public.diagnostic_referral;
CREATE POLICY "Patients see their referrals" ON public.diagnostic_referral
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their referrals" ON public.diagnostic_referral;
CREATE POLICY "Oncologists see their referrals" ON public.diagnostic_referral
  FOR SELECT USING (oncologist_id IN (
    SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 9. SYMPTOM_LOG — Daily symptom check-ins
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  symptoms JSONB NOT NULL,
  overall_severity INTEGER,
  alert_triggered BOOLEAN DEFAULT false,
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.symptom_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their own symptom logs" ON public.symptom_log;
CREATE POLICY "Patients see their own symptom logs" ON public.symptom_log
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their patients' symptom logs" ON public.symptom_log;
CREATE POLICY "Oncologists see their patients' symptom logs" ON public.symptom_log
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE assigned_oncologist_id IN (
      SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
    )
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 10. MEDICATION & MEDICATION_LOG — Medication tracking
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medication (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE CASCADE,
  drug_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  unit TEXT,
  frequency TEXT NOT NULL,
  times_of_day TEXT[] NOT NULL,
  start_date DATE,
  end_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.medication ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their medications" ON public.medication;
CREATE POLICY "Patients see their medications" ON public.medication
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their patients' medications" ON public.medication;
CREATE POLICY "Oncologists see their patients' medications" ON public.medication
  FOR SELECT USING (oncologist_id IN (
    SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
  ));

CREATE TABLE IF NOT EXISTS public.medication_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medication_id UUID NOT NULL REFERENCES public.medication ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT CHECK (status IN ('taken', 'skipped', 'side_effect')),
  notes TEXT,
  logged_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.medication_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their medication logs" ON public.medication_log;
CREATE POLICY "Patients see their medication logs" ON public.medication_log
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their patients' medication logs" ON public.medication_log;
CREATE POLICY "Oncologists see their patients' medication logs" ON public.medication_log
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE assigned_oncologist_id IN (
      SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
    )
  ));

-- ────────────────────────────────────────────────────────────────────────────
-- 11. ALERT — Emergency alerts triggered by high-risk symptoms
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patient_profile ON DELETE CASCADE,
  oncologist_id UUID NOT NULL REFERENCES public.oncologist_profile ON DELETE CASCADE,
  symptom_log_id UUID REFERENCES public.symptom_log ON DELETE SET NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('high_severity', 'medication_concern', 'missed_medication', 'critical_symptom')),
  severity_level INTEGER CHECK (severity_level BETWEEN 1 AND 5),
  message TEXT NOT NULL,
  status TEXT CHECK (status IN ('active', 'acknowledged', 'resolved')),
  triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID REFERENCES public.auth_user ON DELETE SET NULL,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID REFERENCES public.auth_user ON DELETE SET NULL,
  resolution_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.alert ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Patients see their own alerts" ON public.alert;
CREATE POLICY "Patients see their own alerts" ON public.alert
  FOR SELECT USING (patient_id IN (
    SELECT id FROM public.patient_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Oncologists see their patients' alerts" ON public.alert;
CREATE POLICY "Oncologists see their patients' alerts" ON public.alert
  FOR SELECT USING (oncologist_id IN (
    SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS "Users can acknowledge/resolve alerts" ON public.alert;
CREATE POLICY "Users can acknowledge/resolve alerts" ON public.alert
  FOR UPDATE USING (
    acknowledged_by = auth.uid() OR resolved_by = auth.uid() OR
    patient_id IN (SELECT id FROM public.patient_profile WHERE user_id = auth.uid()) OR
    oncologist_id IN (SELECT id FROM public.oncologist_profile WHERE user_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- INDEXES FOR PERFORMANCE
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_patient_oncologist ON public.patient_profile(assigned_oncologist_id);
CREATE INDEX IF NOT EXISTS idx_consultation_patient ON public.consultation_window(patient_id);
CREATE INDEX IF NOT EXISTS idx_consultation_oncologist ON public.consultation_window(oncologist_id);
CREATE INDEX IF NOT EXISTS idx_message_window ON public.message(window_id);
CREATE INDEX IF NOT EXISTS idx_prescription_patient ON public.prescription(patient_id);
CREATE INDEX IF NOT EXISTS idx_symptom_patient ON public.symptom_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_medication_patient ON public.medication(patient_id);
CREATE INDEX IF NOT EXISTS idx_alert_patient ON public.alert(patient_id);
CREATE INDEX IF NOT EXISTS idx_alert_oncologist ON public.alert(oncologist_id);
CREATE INDEX IF NOT EXISTS idx_alert_status ON public.alert(status);
CREATE INDEX IF NOT EXISTS idx_payment_oncologist ON public.payment(oncologist_id);
CREATE INDEX IF NOT EXISTS idx_oncologist_invite_code ON public.oncologist_profile(invite_code);

-- ────────────────────────────────────────────────────────────────────────────
-- GRANT PERMISSIONS
-- ────────────────────────────────────────────────────────────────────────────
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
