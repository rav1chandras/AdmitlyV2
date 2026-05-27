-- ═══════════════════════════════════════════════════════════════
-- Subscription status fields for Stripe integration
-- Run against existing databases; handled automatically via
-- db_schema.ts ensureSchema() for fresh installs.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'free';
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);

-- Index for fast lookup by Stripe customer
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_subscription ON users(subscription_status);
