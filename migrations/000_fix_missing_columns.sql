-- ═══════════════════════════════════════════════════════════════
-- Run this on an EXISTING database to add missing columns/tables
-- Safe to run multiple times (all statements use IF NOT EXISTS)
-- 
-- Usage:  psql $POSTGRES_URL -f migrations/000_fix_missing_columns.sql
-- Or:     docker exec -i college_planner_db psql -U cpuser -d college_planner < migrations/000_fix_missing_columns.sql
-- ═══════════════════════════════════════════════════════════════

-- Users: last_login column
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- Counselor profile extras
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';

-- Counselor settings table
CREATE TABLE IF NOT EXISTS counselor_settings (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  availability_enabled    BOOLEAN DEFAULT TRUE,
  available_days          TEXT[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}',
  start_time              VARCHAR(20) DEFAULT '9:00 AM',
  end_time                VARCHAR(20) DEFAULT '5:00 PM',
  session_duration        INTEGER DEFAULT 60,
  max_students            INTEGER DEFAULT 15,
  zoom_link               VARCHAR(500) DEFAULT '',
  availability_note       VARCHAR(255) DEFAULT '',
  notify_new_message      BOOLEAN DEFAULT TRUE,
  notify_new_assignment   BOOLEAN DEFAULT TRUE,
  notify_session_reminder BOOLEAN DEFAULT TRUE,
  notify_action_due       BOOLEAN DEFAULT FALSE,
  digest_frequency        VARCHAR(20) DEFAULT 'daily',
  payment_method          VARCHAR(30) DEFAULT 'bank_transfer',
  bank_name               VARCHAR(100) DEFAULT '',
  account_holder          VARCHAR(150) DEFAULT '',
  routing_number          VARCHAR(20) DEFAULT '',
  account_number_encrypted VARCHAR(255) DEFAULT '',
  paypal_email            VARCHAR(255) DEFAULT '',
  payment_note            TEXT DEFAULT '',
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_counselor_settings_user_id ON counselor_settings(user_id);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stripe_session_id       VARCHAR(255) UNIQUE,
  stripe_payment_intent_id VARCHAR(255),
  stripe_customer_id      VARCHAR(255),
  amount_cents            INTEGER NOT NULL DEFAULT 0,
  currency                VARCHAR(10) NOT NULL DEFAULT 'usd',
  status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'cancelled')),
  plan_id                 VARCHAR(100),
  plan_name               VARCHAR(100),
  metadata                JSONB DEFAULT '{}',
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_user_id    ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status     ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

-- Admin user seed
INSERT INTO users (email, name, password, role) VALUES
  ('admin@admitly.com', 'Admitly Admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin'),
  ('student@admitly.com', 'Alex Johnson', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'student'),
  ('counselor@admitly.com', 'Dr. Sarah Mitchell', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'counselor')
ON CONFLICT (email) DO NOTHING;

-- Counselor profile for counselor@admitly.com
INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Dr. Sarah Mitchell', 'Former Yale Admissions Officer', ARRAY['Ivy League','STEM Applications','Essay Strategy'], 200, 12, 'Next available: Tomorrow, 3:00 PM EST'
FROM users WHERE email = 'counselor@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

SELECT 'Migration complete — all columns and tables created.' AS status;
