-- ═══════════════════════════════════════════════════════════════
-- Phase B — Webhook hardening + payment-event audit trail
-- Idempotent: safe to re-run.
-- For fresh-volume installs, the same blocks live in docker/init.sql.
-- ═══════════════════════════════════════════════════════════════

-- ── processed_events ────────────────────────────────────────────
-- Idempotency dedupe. Every Stripe webhook insert is keyed on the
-- Stripe event id, so retries (network blips, manual resends) become
-- no-ops instead of re-running side effects.
CREATE TABLE IF NOT EXISTS processed_events (
  stripe_event_id VARCHAR(255) PRIMARY KEY,
  event_type      VARCHAR(64)  NOT NULL,
  outcome         VARCHAR(32)  NOT NULL DEFAULT 'processed',
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_received ON processed_events(received_at DESC);

-- ── payment_events ──────────────────────────────────────────────
-- Per-payment audit trail. One row per Stripe event that touched a
-- known payment (refund issued, refund failed, dispute opened,
-- dispute resolved). Drives the "Details" timeline modal in admin.
CREATE TABLE IF NOT EXISTS payment_events (
  id              SERIAL PRIMARY KEY,
  payment_id      INTEGER REFERENCES payments(id) ON DELETE CASCADE,
  stripe_event_id VARCHAR(255) UNIQUE NOT NULL,
  event_type      VARCHAR(64)  NOT NULL,
  status          VARCHAR(32),
  amount_cents    INTEGER,
  reason          TEXT,
  details         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON payment_events(payment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payment_events_type    ON payment_events(event_type);

-- ── payments.status CHECK constraint expansion ──────────────────
-- The original CHECK on payments.status only allowed
-- (pending, succeeded, failed, refunded, cancelled). The
-- charge.dispute.created handler tries to set status='disputed' but
-- has been silently failing inside a catch block. Drop the old
-- constraint and add one that includes 'disputed'.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'cancelled', 'disputed'));
