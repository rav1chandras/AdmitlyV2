-- Migration 012: Founder Inbox / admin task queue.
-- Persistent tasks let the admin console turn operational signals into a
-- concrete queue for a solo operator.

CREATE TABLE IF NOT EXISTS admin_tasks (
  id SERIAL PRIMARY KEY,
  unique_key VARCHAR(220) UNIQUE,
  type VARCHAR(50) NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'system',
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'snoozed', 'resolved', 'dismissed')),
  priority VARCHAR(10) NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  title VARCHAR(220) NOT NULL,
  details TEXT DEFAULT '',
  action_label VARCHAR(80),
  action_tab VARCHAR(60),
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  counselor_id INTEGER REFERENCES ep_counselors(id) ON DELETE SET NULL,
  assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE SET NULL,
  payment_id INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  premium_request_id INTEGER REFERENCES premium_requests(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_status_priority
  ON admin_tasks(status, priority, due_at NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_user
  ON admin_tasks(user_id);

CREATE INDEX IF NOT EXISTS idx_admin_tasks_payment
  ON admin_tasks(payment_id);
