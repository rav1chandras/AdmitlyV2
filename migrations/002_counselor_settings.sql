-- ═══════════════════════════════════════════════════════════════
-- Counselor Settings table
-- Extends ep_counselors with detailed profile, availability,
-- notification preferences, and payment details
-- ═══════════════════════════════════════════════════════════════

-- Add columns to existing ep_counselors for bio and contact
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';

-- Counselor settings (availability, notifications, payment)
CREATE TABLE IF NOT EXISTS counselor_settings (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Availability
  availability_enabled    BOOLEAN DEFAULT TRUE,
  available_days          TEXT[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}',
  start_time              VARCHAR(20) DEFAULT '9:00 AM',
  end_time                VARCHAR(20) DEFAULT '5:00 PM',
  session_duration        INTEGER DEFAULT 60,
  max_students            INTEGER DEFAULT 15,
  zoom_link               VARCHAR(500) DEFAULT '',
  availability_note       VARCHAR(255) DEFAULT '',

  -- Notifications
  notify_new_message      BOOLEAN DEFAULT TRUE,
  notify_new_assignment   BOOLEAN DEFAULT TRUE,
  notify_session_reminder BOOLEAN DEFAULT TRUE,
  notify_action_due       BOOLEAN DEFAULT FALSE,
  digest_frequency        VARCHAR(20) DEFAULT 'daily',

  -- Payment
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
