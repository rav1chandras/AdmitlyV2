-- ═══════════════════════════════════════════════════════════════
-- Phase A — Admin housekeeping
-- Adds the sent_emails audit table used by /api/admin/email.
-- Idempotent: safe to re-run.
-- For fresh-volume installs, the same block lives in docker/init.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sent_emails (
  id              SERIAL PRIMARY KEY,
  sender_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_email    VARCHAR(255),
  recipient_type  VARCHAR(32) NOT NULL, -- 'individual' | 'all_students' | 'all_counselors'
  recipient_email VARCHAR(255) NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  success         BOOLEAN NOT NULL DEFAULT FALSE,
  error           TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at  ON sent_emails(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sender   ON sent_emails(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_recip    ON sent_emails(recipient_email);
