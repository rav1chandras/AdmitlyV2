-- ═══════════════════════════════════════════════════════════════
-- Migration 009 — Student activities for the redesigned Profile Builder.
-- Each user can record up to 10 activities. The Profile page surfaces
-- these as cards, derives Top Themes from the category tags, and
-- computes an Impact Score per activity using a heuristic in
-- lib/profile-insights.ts. Phase 2 will layer LLM analysis on top of
-- this same row set (no schema change needed).
-- For fresh-volume installs the same block lives in docker/init.sql.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS student_activities (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  category        VARCHAR(40) NOT NULL DEFAULT 'other'
                  CHECK (category IN ('leadership','community','arts','academic','athletics','work','other')),
  role            VARCHAR(80),
  hours_per_week  INTEGER DEFAULT 0,
  start_grade     INTEGER,                -- 9..12
  end_grade       INTEGER,                -- NULL while current
  is_current      BOOLEAN DEFAULT TRUE,
  description     VARCHAR(280),
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_activities_user ON student_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_student_activities_user_sort ON student_activities(user_id, sort_order);
