-- ═══════════════════════════════════════════════════════════════
-- Phase C — Premium Manual-Matching Flow
-- Drives student "Request Match → admin invoices → student pays"
-- workflow. Idempotent: safe to re-run.
-- For fresh-volume installs the same block lives in docker/init.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS premium_requests (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id              INTEGER REFERENCES ep_plans(id) ON DELETE SET NULL,
  plan_name            VARCHAR(100) NOT NULL,
  -- Quoted amount at request time, in cents. May be overridden by admin
  -- before send_invoice; the live value is amount_cents_invoiced.
  amount_cents_quoted   INTEGER NOT NULL,
  amount_cents_invoiced INTEGER,
  -- Pre-selected counselor (internal-only; not surfaced to student until
  -- the assignment lands). NULL until admin picks one in send_invoice.
  counselor_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Lifecycle:
  --   pending_review       — submitted by student, awaiting admin
  --   awaiting_payment     — admin sent invoice, waiting for student pay
  --   paid                 — invoice.paid webhook fired
  --   cancelled_by_student — student cancelled (any phase)
  --   rejected             — admin rejected with reason
  --   voided               — admin voided invoice after sending
  --   expired              — auto-voided after 72h timer
  status               VARCHAR(32) NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN (
                         'pending_review','awaiting_payment','paid',
                         'cancelled_by_student','rejected','voided','expired'
                       )),
  rejection_reason     TEXT,

  -- Stripe invoice fields, populated by send_invoice
  stripe_invoice_id    VARCHAR(255),
  stripe_invoice_item_id VARCHAR(255),
  hosted_invoice_url   TEXT,

  -- Timer state. invoice_expires_at is set to T+72h when admin sends the
  -- invoice; the cron route uses it to schedule both the 48h reminder
  -- and the 72h auto-void.
  invoice_sent_at      TIMESTAMPTZ,
  invoice_expires_at   TIMESTAMPTZ,
  reminder_sent_at     TIMESTAMPTZ,

  paid_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active request per student. The partial unique index allows
-- multiple historical (paid/rejected/voided/expired/cancelled) rows but
-- guarantees at most one row in flight. UI prevents concurrent submits;
-- this is the DB-level safety net.
CREATE UNIQUE INDEX IF NOT EXISTS uq_premium_requests_one_active
  ON premium_requests(user_id)
  WHERE status IN ('pending_review','awaiting_payment');

CREATE INDEX IF NOT EXISTS idx_premium_requests_user    ON premium_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_status  ON premium_requests(status);
CREATE INDEX IF NOT EXISTS idx_premium_requests_invoice ON premium_requests(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_expires ON premium_requests(invoice_expires_at) WHERE status = 'awaiting_payment';
