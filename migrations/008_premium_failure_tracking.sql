-- ═══════════════════════════════════════════════════════════════
-- Phase D — Premium failure tracking on premium_requests
-- Adds the three columns the Recoveries tab needs to surface
-- failed Premium payment attempts. Idempotent.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE premium_requests
  ADD COLUMN IF NOT EXISTS last_attempt_failed_at TIMESTAMPTZ;

ALTER TABLE premium_requests
  ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;

ALTER TABLE premium_requests
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;

-- Quick lookup for "show me Premium failures" in the Recoveries tab.
CREATE INDEX IF NOT EXISTS idx_premium_requests_failed
  ON premium_requests(last_attempt_failed_at DESC)
  WHERE last_attempt_failed_at IS NOT NULL;
