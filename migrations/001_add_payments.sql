-- ═══════════════════════════════════════════════════════════════
-- Payments table for Stripe integration
-- Run this migration on your existing database
-- ═══════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS idx_payments_stripe_session ON payments(stripe_session_id);
