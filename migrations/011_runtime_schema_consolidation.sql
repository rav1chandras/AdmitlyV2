-- Migration 011: consolidate schema changes that used to run from request paths.
-- Idempotent and data-preserving: this migration creates missing structures,
-- adds missing columns/indexes, and relaxes/updates compatible constraints.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'credentials';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_package VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(500);
ALTER TABLE users ADD COLUMN IF NOT EXISTS impersonate_token VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS impersonate_expires_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_status);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS candidate_statement TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS student_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  phone VARCHAR(30),
  parent_email VARCHAR(255),
  bio TEXT,
  high_school_name VARCHAR(255),
  high_school_city VARCHAR(100),
  high_school_state VARCHAR(50),
  graduation_year INTEGER,
  intended_major VARCHAR(150),
  intended_major_alt VARCHAR(150),
  gpa_scale VARCHAR(20) DEFAULT '4.0',
  counselor_name VARCHAR(150),
  counselor_email VARCHAR(255),
  app_round VARCHAR(50),
  target_school_count INTEGER DEFAULT 8,
  preferred_location VARCHAR(150),
  preferred_size VARCHAR(50),
  financial_aid_needed BOOLEAN DEFAULT false,
  email_reminders BOOLEAN DEFAULT true,
  deadline_alerts BOOLEAN DEFAULT true,
  weekly_summary BOOLEAN DEFAULT false,
  share_data_analytics BOOLEAN DEFAULT true,
  allow_counselor_access BOOLEAN DEFAULT true,
  voice_samples JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE student_settings ADD COLUMN IF NOT EXISTS voice_samples JSONB DEFAULT '[]';

CREATE TABLE IF NOT EXISTS llm_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  essay_id INTEGER,
  mode VARCHAR(20) NOT NULL DEFAULT 'generate',
  essay_type VARCHAR(50),
  model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost_microcents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS score_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS key_dates (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  event_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admissions_news (
  id SERIAL PRIMARY KEY,
  headline VARCHAR(255) NOT NULL,
  summary TEXT NOT NULL,
  tag VARCHAR(50) NOT NULL DEFAULT 'Trends',
  is_visible BOOLEAN DEFAULT TRUE,
  source_url VARCHAR(500),
  is_custom BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE admissions_news ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);
ALTER TABLE admissions_news ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS pricing_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pro_full_price INTEGER NOT NULL DEFAULT 129,
  pro_discount_price INTEGER NOT NULL DEFAULT 89,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS shared_with_counselor BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS expert_tag VARCHAR(50) DEFAULT NULL;
ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS source_essay_id INTEGER DEFAULT NULL;
ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS assignment_id INTEGER DEFAULT NULL;

CREATE TABLE IF NOT EXISTS student_deadlines (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  college_name VARCHAR(255) NOT NULL,
  deadline_type VARCHAR(50) NOT NULL,
  due_date DATE NOT NULL,
  description TEXT DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  notes TEXT DEFAULT '',
  source VARCHAR(20) NOT NULL DEFAULT 'auto',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_deadlines_user ON student_deadlines(user_id);
CREATE INDEX IF NOT EXISTS idx_student_deadlines_date ON student_deadlines(due_date);

CREATE TABLE IF NOT EXISTS college_deadlines (
  id SERIAL PRIMARY KEY,
  ope6_id INTEGER,
  college_name VARCHAR(255) NOT NULL,
  deadline_type VARCHAR(50) NOT NULL,
  due_date DATE NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_college_deadlines_ope6 ON college_deadlines(ope6_id);
CREATE INDEX IF NOT EXISTS idx_college_deadlines_name ON college_deadlines(college_name);

CREATE TABLE IF NOT EXISTS student_journey (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  activities JSONB NOT NULL DEFAULT '[]',
  honors JSONB NOT NULL DEFAULT '[]',
  experiences JSONB NOT NULL DEFAULT '[]',
  identity JSONB NOT NULL DEFAULT '{}',
  goals JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_activities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other'
    CHECK (category IN ('leadership','community','arts','academic','athletics','work','other')),
  role VARCHAR(80),
  hours_per_week INTEGER DEFAULT 0,
  start_grade INTEGER,
  end_grade INTEGER,
  is_current BOOLEAN DEFAULT TRUE,
  description VARCHAR(280),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_activities_user ON student_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_student_activities_user_sort ON student_activities(user_id, sort_order);

CREATE TABLE IF NOT EXISTS personal_stories (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(120) NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  grade INTEGER,
  theme_tags TEXT[] DEFAULT '{}',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_personal_stories_user ON personal_stories(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_stories_user_sort ON personal_stories(user_id, sort_order);

CREATE TABLE IF NOT EXISTS profile_analysis (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_hash VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ep_counselors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  title VARCHAR(255),
  specialties TEXT[] DEFAULT '{}',
  total_students INTEGER DEFAULT 0,
  years_experience INTEGER DEFAULT 0,
  availability VARCHAR(255),
  status VARCHAR(20) DEFAULT 'active',
  hourly_rate_cents INTEGER DEFAULT 5000,
  total_earned_cents INTEGER DEFAULT 0,
  application_note TEXT DEFAULT '',
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stripe_connect_account_id VARCHAR(255),
  bio TEXT DEFAULT '',
  phone VARCHAR(30) DEFAULT '',
  timezone VARCHAR(50) DEFAULT 'America/New_York',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS application_note TEXT DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR(255);
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS hourly_rate_cents INTEGER DEFAULT 5000;
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS total_earned_cents INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS ep_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  sessions INTEGER NOT NULL DEFAULT 1,
  price_cents INTEGER NOT NULL DEFAULT 0,
  discounted_price_cents INTEGER DEFAULT NULL,
  session_duration_minutes INTEGER DEFAULT 60,
  description TEXT DEFAULT '',
  features TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ep_plans ADD COLUMN IF NOT EXISTS discounted_price_cents INTEGER DEFAULT NULL;
ALTER TABLE ep_plans ADD COLUMN IF NOT EXISTS session_duration_minutes INTEGER DEFAULT 60;

CREATE TABLE IF NOT EXISTS ep_assignments (
  id SERIAL PRIMARY KEY,
  counselor_id INTEGER REFERENCES ep_counselors(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER,
  plan VARCHAR(50) DEFAULT 'Starter',
  sessions_total INTEGER DEFAULT 3,
  sessions_used INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  target_schools TEXT[] DEFAULT '{}',
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  declined_reason TEXT,
  accepted_at TIMESTAMP,
  notified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE ep_assignments ADD COLUMN IF NOT EXISTS declined_reason TEXT;
ALTER TABLE ep_assignments ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
ALTER TABLE ep_assignments ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP;
ALTER TABLE ep_assignments DROP CONSTRAINT IF EXISTS ep_assignments_counselor_id_student_id_key;

CREATE TABLE IF NOT EXISTS ep_messages (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ep_sessions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  session_time VARCHAR(20) NOT NULL,
  duration_min INTEGER DEFAULT 60,
  status VARCHAR(20) DEFAULT 'upcoming',
  topic VARCHAR(255),
  zoom_link VARCHAR(500),
  notes TEXT,
  recording_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ep_actions (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  is_done BOOLEAN DEFAULT FALSE,
  due_date DATE,
  assigned_by VARCHAR(10) DEFAULT 'counselor',
  category VARCHAR(50) DEFAULT 'Application',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ep_notes (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  content TEXT DEFAULT '',
  author_role VARCHAR(10) DEFAULT 'counselor',
  is_pinned BOOLEAN DEFAULT FALSE,
  category VARCHAR(50) DEFAULT 'Session Notes',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stripe_session_id VARCHAR(255) UNIQUE,
  stripe_payment_intent_id VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'usd',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  plan_id VARCHAR(100),
  plan_name VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE payments ALTER COLUMN plan_id TYPE VARCHAR(100) USING plan_id::text;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'cancelled', 'disputed'));
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_session_id);

CREATE TABLE IF NOT EXISTS processed_events (
  stripe_event_id VARCHAR(255) PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  outcome VARCHAR(32) NOT NULL DEFAULT 'processed',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_received ON processed_events(received_at DESC);

CREATE TABLE IF NOT EXISTS payment_events (
  id SERIAL PRIMARY KEY,
  payment_id INTEGER REFERENCES payments(id) ON DELETE CASCADE,
  stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  status VARCHAR(32),
  amount_cents INTEGER,
  reason TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_type ON payment_events(event_type);

CREATE TABLE IF NOT EXISTS sent_emails (
  id SERIAL PRIMARY KEY,
  sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_email VARCHAR(255),
  recipient_type VARCHAR(32) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sender ON sent_emails(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_recip ON sent_emails(recipient_email);

CREATE TABLE IF NOT EXISTS premium_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES ep_plans(id) ON DELETE SET NULL,
  plan_name VARCHAR(100) NOT NULL,
  amount_cents_quoted INTEGER NOT NULL,
  amount_cents_invoiced INTEGER,
  counselor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','awaiting_payment','paid','cancelled_by_student','rejected','voided','expired')),
  rejection_reason TEXT,
  stripe_invoice_id VARCHAR(255),
  stripe_invoice_item_id VARCHAR(255),
  hosted_invoice_url TEXT,
  invoice_sent_at TIMESTAMPTZ,
  invoice_expires_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  last_attempt_failed_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS last_attempt_failed_at TIMESTAMPTZ;
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;
ALTER TABLE premium_requests ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_premium_requests_one_active
  ON premium_requests(user_id)
  WHERE status IN ('pending_review','awaiting_payment');
CREATE INDEX IF NOT EXISTS idx_premium_requests_user ON premium_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_status ON premium_requests(status);
CREATE INDEX IF NOT EXISTS idx_premium_requests_invoice ON premium_requests(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_expires ON premium_requests(invoice_expires_at) WHERE status = 'awaiting_payment';
CREATE INDEX IF NOT EXISTS idx_premium_requests_failed ON premium_requests(last_attempt_failed_at DESC) WHERE last_attempt_failed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS counselor_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  availability_enabled BOOLEAN DEFAULT TRUE,
  available_days TEXT[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}',
  start_time VARCHAR(20) DEFAULT '9:00 AM',
  end_time VARCHAR(20) DEFAULT '5:00 PM',
  session_duration INTEGER DEFAULT 60,
  max_students INTEGER DEFAULT 15,
  zoom_link VARCHAR(500) DEFAULT '',
  availability_note VARCHAR(255) DEFAULT '',
  notify_new_message BOOLEAN DEFAULT TRUE,
  notify_new_assignment BOOLEAN DEFAULT TRUE,
  notify_session_reminder BOOLEAN DEFAULT TRUE,
  notify_action_due BOOLEAN DEFAULT FALSE,
  digest_frequency VARCHAR(20) DEFAULT 'daily',
  payment_method VARCHAR(30) DEFAULT 'bank_transfer',
  bank_name VARCHAR(100) DEFAULT '',
  account_holder VARCHAR(150) DEFAULT '',
  routing_number VARCHAR(20) DEFAULT '',
  account_number_encrypted VARCHAR(255) DEFAULT '',
  paypal_email VARCHAR(255) DEFAULT '',
  payment_note TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_counselor_settings_user_id ON counselor_settings(user_id);

CREATE TABLE IF NOT EXISTS counselor_payouts (
  id SERIAL PRIMARY KEY,
  counselor_id INTEGER REFERENCES ep_counselors(id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  hours DECIMAL(5,2) DEFAULT 0,
  rate_cents INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  stripe_transfer_id VARCHAR(255),
  paid_at TIMESTAMP,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS admin_messages (
  id SERIAL PRIMARY KEY,
  counselor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL CHECK (sender_role IN ('admin','counselor')),
  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_messages_counselor ON admin_messages(counselor_user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_logs (
  id SERIAL PRIMARY KEY,
  level VARCHAR(10) NOT NULL DEFAULT 'info',
  source VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_logs_level ON admin_logs(level);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  verified BOOLEAN DEFAULT false,
  attempts INTEGER DEFAULT 0,
  purpose VARCHAR(20) DEFAULT 'signup',
  consumed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) DEFAULT 'signup';
ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_queue (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type VARCHAR(30) NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  sent_at TIMESTAMP DEFAULT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nq_unsent ON notification_queue(user_id, sent_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS ai_daily_usage (
  user_id INTEGER NOT NULL,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE IF NOT EXISTS colleges_master (
  id SERIAL PRIMARY KEY,
  ope6_id INTEGER UNIQUE NOT NULL,
  name TEXT NOT NULL,
  city TEXT,
  state CHAR(2),
  zip TEXT,
  college_url TEXT,
  ownership VARCHAR(20),
  locale VARCHAR(20),
  carnegie_basic INTEGER,
  acceptance_rate NUMERIC(5,1),
  sat_25 INTEGER,
  sat_75 INTEGER,
  sat_math_25 INTEGER,
  sat_math_75 INTEGER,
  sat_cr_25 INTEGER,
  sat_cr_75 INTEGER,
  sat_avg INTEGER,
  sat_range TEXT,
  act_25 INTEGER,
  act_75 INTEGER,
  act_mid INTEGER,
  act_range TEXT,
  enrollment INTEGER,
  retention_rate NUMERIC(5,1),
  student_faculty_ratio INTEGER,
  pct_men NUMERIC(5,1),
  pct_women NUMERIC(5,1),
  pct_white NUMERIC(5,1),
  pct_black NUMERIC(5,1),
  pct_hispanic NUMERIC(5,1),
  pct_asian NUMERIC(5,1),
  pct_two_or_more NUMERIC(5,1),
  tuition_in_state INTEGER,
  tuition_out_state INTEGER,
  net_price INTEGER,
  cost_attendance INTEGER,
  median_debt INTEGER,
  pell_rate NUMERIC(5,1),
  loan_rate NUMERIC(5,1),
  grad_rate NUMERIC(5,1),
  earnings_6yr INTEGER,
  earnings_8yr INTEGER,
  earnings_10yr INTEGER,
  last_refreshed TIMESTAMP DEFAULT NOW()
);
ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_math_25 INTEGER;
ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_math_75 INTEGER;
ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_cr_25 INTEGER;
ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_cr_75 INTEGER;
CREATE INDEX IF NOT EXISTS idx_colleges_master_ope6_id ON colleges_master(ope6_id);
CREATE INDEX IF NOT EXISTS idx_colleges_master_name ON colleges_master(name);
CREATE INDEX IF NOT EXISTS idx_colleges_master_state ON colleges_master(state);

CREATE TABLE IF NOT EXISTS programs_master (
  id SERIAL PRIMARY KEY,
  ope6_id INTEGER NOT NULL,
  institution_name TEXT,
  control VARCHAR(20),
  cip4 VARCHAR(10) NOT NULL,
  cipcode INTEGER,
  cipdesc TEXT,
  program_normalized TEXT,
  credlev INTEGER,
  ipedscount2 INTEGER,
  earn_mdn_1yr INTEGER,
  earn_mdn_4yr INTEGER,
  earn_mdn_5yr INTEGER,
  earn_gt_threshold_5yr INTEGER,
  debt_all_stgp_eval_mdn INTEGER,
  UNIQUE (ope6_id, cip4, credlev)
);
DO $$ BEGIN
  ALTER TABLE programs_master ADD CONSTRAINT programs_master_ope6_id_cip4_credlev_key UNIQUE (ope6_id, cip4, credlev);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_pm_ope6_id ON programs_master(ope6_id);
CREATE INDEX IF NOT EXISTS idx_pm_cip4 ON programs_master(cip4);
CREATE INDEX IF NOT EXISTS idx_pm_prog_norm ON programs_master(program_normalized);
