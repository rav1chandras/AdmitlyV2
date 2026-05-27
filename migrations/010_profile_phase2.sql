-- ═══════════════════════════════════════════════════════════════
-- Migration 010 — Profile Builder Phase 2.
--
-- Adds:
--   - personal_stories      Up-to-six narrative artifacts per student.
--                           Phase 2 LLM scores each for relevance.
--   - profile_analysis      Single-row-per-user cache of the LLM
--                           analysis output. content_hash gates
--                           re-runs so identical inputs don't burn
--                           tokens twice.
--
-- For fresh-volume installs the same blocks live in docker/init.sql.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS personal_stories (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(120) NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  grade           INTEGER,                       -- 7..12 when the story took place
  theme_tags      TEXT[] DEFAULT '{}',           -- free-form user tags (e.g. 'family','identity')
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_personal_stories_user ON personal_stories(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_stories_user_sort ON personal_stories(user_id, sort_order);

CREATE TABLE IF NOT EXISTS profile_analysis (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- content_hash = SHA-1 of the normalised input (academic + activities + stories)
  -- so we can short-circuit re-analysis when nothing meaningful changed.
  content_hash    VARCHAR(64) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  model           VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_tokens   INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
