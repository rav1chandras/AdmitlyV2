-- =============================================================
--  College Planner – Database Initialization
--  Runs automatically when the Postgres container first starts
-- =============================================================

-- ── Users ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      VARCHAR(255) UNIQUE NOT NULL,
  name       VARCHAR(255)        NOT NULL,
  password   VARCHAR(255)        NOT NULL,
  role       VARCHAR(20)         NOT NULL DEFAULT 'student',
  is_locked  BOOLEAN             DEFAULT false,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Profiles ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  gpa               DECIMAL(3,2) DEFAULT 0,
  sat               INTEGER,
  act               INTEGER,
  ap_offered        INTEGER      DEFAULT 0,
  ap_taken          INTEGER      DEFAULT 0,
  ec_tier           INTEGER      DEFAULT 6,
  leadership_roles  INTEGER      DEFAULT 0,
  major_multiplier  DECIMAL(3,2) DEFAULT 1.0,
  is_ed             BOOLEAN      DEFAULT false,
  is_athlete        BOOLEAN      DEFAULT false,
  is_legacy         BOOLEAN      DEFAULT false,
  final_score       INTEGER      DEFAULT 0,
  candidate_statement TEXT       DEFAULT '',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Colleges ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS colleges (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  bucket      VARCHAR(50)  NOT NULL,
  accept_rate INTEGER      NOT NULL,
  grad_rate   INTEGER      NOT NULL,
  sat_avg     INTEGER      NOT NULL,
  tuition_in  VARCHAR(50)  NOT NULL,
  tuition_out VARCHAR(50)  NOT NULL,
  master_id   INTEGER,
  sat_range   VARCHAR(30)  NOT NULL DEFAULT 'N/A',
  act_range   VARCHAR(30)  NOT NULL DEFAULT 'N/A',
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Essay Drafts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS essay_drafts (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
  college_id       INTEGER REFERENCES colleges(id) ON DELETE SET NULL,
  essay_type       VARCHAR(50)  NOT NULL DEFAULT 'personal_statement',
  college_name     VARCHAR(255),
  topic            VARCHAR(3000) NOT NULL DEFAULT '',
  draft_text       TEXT         NOT NULL DEFAULT '',
  word_count       INTEGER      NOT NULL DEFAULT 0,
  prompt_source    VARCHAR(100) NOT NULL DEFAULT 'Common App',
  audience         VARCHAR(100) NOT NULL DEFAULT 'Admissions Officer',
  tone_chips       VARCHAR(255) NOT NULL DEFAULT 'Reflective',
  formality        INTEGER      NOT NULL DEFAULT 3,
  word_limit       INTEGER      NOT NULL DEFAULT 650,
  narrative_focus  INTEGER      NOT NULL DEFAULT 2,
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft',
  shared_with_counselor BOOLEAN NOT NULL DEFAULT false,
  expert_tag       VARCHAR(50)  DEFAULT NULL,
  source_essay_id  INTEGER      DEFAULT NULL,
  assignment_id    INTEGER      DEFAULT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_essay_drafts_user_id    ON essay_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_essay_drafts_college_id ON essay_drafts(college_id);

-- =============================================================
--  Mock users  (bcrypt hash of "password123", cost=10)
--  Hash generated offline — same hash works every time.
-- =============================================================
INSERT INTO users (email, name, password, role) VALUES
  (
    'student1@example.com',
    'Alex Johnson',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'student'
  ),
  (
    'student2@example.com',
    'Sarah Chen',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'student'
  ),
  (
    'student3@example.com',
    'Marcus Williams',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'student'
  ),
  (
    'student4@example.com',
    'Priya Sharma',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'student'
  ),
  (
    'student5@example.com',
    'Sofia Reyes',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'student'
  ),
  (
    'student@admitly.com',
    'Alex Johnson',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'student'
  ),
  (
    'counselor1@example.com',
    'Dr. Sarah Mitchell',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'counselor'
  ),
  (
    'counselor2@example.com',
    'James Rivera',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'counselor'
  ),
  (
    'counselor3@example.com',
    'Dr. Emily Nguyen',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'counselor'
  ),
  (
    'counselor@admitly.com',
    'Dr. Sarah Mitchell',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'counselor'
  ),
  (
    'admin@admitly.com',
    'Admitly Admin',
    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
    'admin'
  )
ON CONFLICT (email) DO NOTHING;



-- ── Additional mock counselors ───────────────────────────────────────────────
INSERT INTO users (email, name, password, role) VALUES
  ('counselor4@admitly.com', 'Dr. Marcus Webb',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'counselor'),
  ('counselor5@admitly.com', 'Aisha Patel',        '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'counselor'),
  ('counselor6@admitly.com', 'Prof. Leo Tanaka',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'counselor'),
  ('counselor7@admitly.com', 'Sofia Mendes',       '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'counselor')
ON CONFLICT (email) DO NOTHING;



-- ── Seed default profiles for both users ──────────────────────
INSERT INTO profiles (user_id, gpa, sat, ap_offered, ap_taken, ec_tier, leadership_roles, final_score)
SELECT id, 3.85, 1530, 20, 8, 6, 2, 0
FROM users WHERE email = 'student1@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO profiles (user_id, gpa, sat, ap_offered, ap_taken, ec_tier, leadership_roles, final_score)
SELECT id, 3.70, 1420, 18, 6, 8, 3, 0
FROM users WHERE email = 'student2@example.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── Seed sample colleges for student1 ─────────────────────────
INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out, notes)
SELECT
  u.id,
  c.name,
  c.bucket,
  c.accept_rate,
  c.grad_rate,
  c.sat_avg,
  c.tuition_in,
  c.tuition_out,
  c.notes
FROM users u,
(VALUES
  ('Stanford University',      'reach',  4,  97, 1545, '$59k', '$59k', ''),
  ('MIT',                      'reach',  7,  95, 1545, '$59k', '$59k', ''),
  ('UC Berkeley',              'target', 17, 93, 1415, '$15k', '$45k', ''),
  ('Boston University',        'target', 37, 88, 1390, '$62k', '$62k', ''),
  ('University of Arizona',    'safety', 86, 63, 1210, '$13k', '$38k', '')
) AS c(name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out, notes)
WHERE u.email = 'student1@example.com';

-- ── Seed sample colleges for student2 ─────────────────────────
INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out, notes)
SELECT
  u.id,
  c.name,
  c.bucket,
  c.accept_rate,
  c.grad_rate,
  c.sat_avg,
  c.tuition_in,
  c.tuition_out,
  c.notes
FROM users u,
(VALUES
  ('Harvard University',       'reach',  4,  98, 1545, '$57k', '$57k', ''),
  ('Vanderbilt University',    'target', 11, 93, 1505, '$61k', '$61k', ''),
  ('University of Michigan',   'target', 26, 92, 1440, '$16k', '$51k', ''),
  ('Penn State',               'safety', 55, 80, 1250, '$18k', '$37k', '')
) AS c(name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out, notes)
WHERE u.email = 'student2@example.com';

-- ── Seed sample essays for student1 ──────────────────────────
INSERT INTO essay_drafts
  (user_id, essay_type, college_name, topic, draft_text, word_count,
   prompt_source, tone_chips, formality, word_limit, status, updated_at)
SELECT
  u.id,
  e.essay_type,
  e.college_name,
  e.topic,
  e.draft_text,
  e.word_count,
  e.prompt_source,
  e.tone_chips,
  e.formality,
  e.word_limit,
  e.status,
  CURRENT_TIMESTAMP
FROM users u,
(VALUES
  ('personal_statement', NULL,
   'Growth through building my startup',
   'Building a startup at 16 taught me more about leadership than any classroom ever could. When our first product failed, I learned that failure is data, not defeat.',
   32, 'Common App', 'Reflective,Narrative', 3, 650, 'draft'),
  ('why_school', 'Stanford University',
   'Why Stanford''s CS + Human-Computer Interaction',
   'Stanford''s interdisciplinary approach to CS and design aligns directly with my goal of building accessible technology.',
   23, 'Common App', 'Analytical', 4, 650, 'draft'),
  ('activity', NULL,
   'Debate Team Captain — Three Years In',
   'Leading 24 debaters through a state championship season required me to balance individual coaching with team morale.',
   18, 'Common App', 'Narrative', 3, 350, 'draft'),
  ('challenge', NULL,
   'Overcoming math anxiety to tutor peers',
   'In freshman year I failed my first calculus exam. By junior year I was running a peer tutoring program that served 40 students.',
   25, 'Common App', 'Reflective', 3, 650, 'draft')
) AS e(essay_type, college_name, topic, draft_text, word_count,
       prompt_source, tone_chips, formality, word_limit, status)
WHERE u.email = 'student1@example.com';

-- ── Student Settings ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS student_settings (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Personal info
  phone                   VARCHAR(30),
  parent_email            VARCHAR(255),
  bio                     TEXT,

  -- Academic context
  high_school_name        VARCHAR(255),
  high_school_city        VARCHAR(100),
  high_school_state       VARCHAR(50),
  graduation_year         INTEGER,
  intended_major          VARCHAR(150),
  intended_major_alt      VARCHAR(150),
  gpa_scale               VARCHAR(20)  DEFAULT '4.0',

  -- Counselor
  counselor_name          VARCHAR(150),
  counselor_email         VARCHAR(255),

  -- Application preferences
  app_round               VARCHAR(50),   -- 'Early Decision', 'Early Action', 'Regular'
  target_school_count     INTEGER DEFAULT 8,
  preferred_location      VARCHAR(150),
  preferred_size          VARCHAR(50),   -- 'Small (<5k)', 'Medium', 'Large (>15k)'
  financial_aid_needed    BOOLEAN DEFAULT false,

  -- Notifications & opt-outs
  email_reminders         BOOLEAN DEFAULT true,
  deadline_alerts         BOOLEAN DEFAULT true,
  weekly_summary          BOOLEAN DEFAULT false,
  share_data_analytics    BOOLEAN DEFAULT true,
  allow_counselor_access  BOOLEAN DEFAULT true,

  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_settings_user_id ON student_settings(user_id);

-- ── Admin: last_login on users ──────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP;

-- ── LLM Usage Tracking ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_usage (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  essay_id        INTEGER,
  mode            VARCHAR(20)  NOT NULL DEFAULT 'generate',  -- 'generate' | 'improve'
  essay_type      VARCHAR(50),
  model           VARCHAR(50)  NOT NULL DEFAULT 'gpt-4o',
  prompt_tokens   INTEGER      NOT NULL DEFAULT 0,
  completion_tokens INTEGER    NOT NULL DEFAULT 0,
  total_tokens    INTEGER      NOT NULL DEFAULT 0,
  -- cost in USD microcents (millionths of a dollar) for precision without floats
  cost_microcents INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_user_id    ON llm_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at);

-- ── Student Journey ─────────────────────────────────────────────────────────
-- Stored as a single JSONB row per user for flexibility.
-- Structure is validated at the app layer, not the DB layer.
CREATE TABLE IF NOT EXISTS student_journey (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  -- Arrays of structured objects stored as JSONB
  activities   JSONB NOT NULL DEFAULT '[]',   -- Activity[]
  honors       JSONB NOT NULL DEFAULT '[]',   -- Honor[]
  experiences  JSONB NOT NULL DEFAULT '[]',   -- Experience[]
  identity     JSONB NOT NULL DEFAULT '{}',   -- IdentityBlock
  goals        JSONB NOT NULL DEFAULT '{}',   -- GoalsBlock
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_journey_user_id ON student_journey(user_id);


-- ── Colleges Master Data ─────────────────────────────────────────────────────
-- Source of truth for all college data. Loaded from data/colleges_master.csv
-- at container startup. To refresh quarterly, run:
--   python scripts/extract_colleges.py
--   git add data/colleges_master.csv && git commit
--   docker compose up --build -d
CREATE TABLE IF NOT EXISTS colleges_master (
  id                  SERIAL PRIMARY KEY,
  ope6_id        INTEGER UNIQUE NOT NULL,
  name                TEXT NOT NULL,
  city                TEXT,
  state               CHAR(2),
  zip                 TEXT,
  college_url         TEXT,
  ownership           VARCHAR(20),
  locale              VARCHAR(20),
  carnegie_basic      INTEGER,
  acceptance_rate     NUMERIC(5,1),
  sat_25              INTEGER,
  sat_75              INTEGER,
  sat_math_25         INTEGER,
  sat_math_75         INTEGER,
  sat_cr_25           INTEGER,
  sat_cr_75           INTEGER,
  sat_avg             INTEGER,
  sat_range           TEXT,
  act_25              INTEGER,
  act_75              INTEGER,
  act_mid             INTEGER,
  act_range           TEXT,
  enrollment          INTEGER,
  retention_rate      NUMERIC(5,1),
  student_faculty_ratio INTEGER,
  pct_men             NUMERIC(5,1),
  pct_women           NUMERIC(5,1),
  pct_white           NUMERIC(5,1),
  pct_black           NUMERIC(5,1),
  pct_hispanic        NUMERIC(5,1),
  pct_asian           NUMERIC(5,1),
  pct_two_or_more     NUMERIC(5,1),
  tuition_in_state    INTEGER,
  tuition_out_state   INTEGER,
  net_price           INTEGER,
  cost_attendance     INTEGER,
  median_debt         INTEGER,
  pell_rate           NUMERIC(5,1),
  loan_rate           NUMERIC(5,1),
  grad_rate           NUMERIC(5,1),
  earnings_6yr        INTEGER,
  earnings_8yr        INTEGER,
  earnings_10yr       INTEGER,
  last_refreshed      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cm_name        ON colleges_master(name);
CREATE INDEX IF NOT EXISTS idx_cm_state       ON colleges_master(state);
CREATE INDEX IF NOT EXISTS idx_cm_accept_rate ON colleges_master(acceptance_rate);
CREATE INDEX IF NOT EXISTS idx_cm_ope6_id   ON colleges_master(ope6_id);

-- Load from CSV if the file exists and table is empty
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM colleges_master) = 0 THEN
    BEGIN
      COPY colleges_master (
        ope6_id, name, city, state, zip, college_url,
        ownership, locale, carnegie_basic,
        acceptance_rate, sat_25, sat_75, sat_math_25, sat_math_75, sat_cr_25, sat_cr_75, sat_avg, sat_range,
        act_25, act_75, act_mid, act_range,
        enrollment, retention_rate, student_faculty_ratio,
        pct_men, pct_women, pct_white, pct_black, pct_hispanic, pct_asian, pct_two_or_more,
        tuition_in_state, tuition_out_state, net_price, cost_attendance,
        median_debt, pell_rate, loan_rate, grad_rate,
        earnings_6yr, earnings_8yr, earnings_10yr
      )
      FROM '/docker-entrypoint-initdb.d/colleges_master.csv'
      WITH (FORMAT csv, HEADER true, NULL '');
      RAISE NOTICE 'colleges_master loaded from CSV: % rows', (SELECT COUNT(*) FROM colleges_master);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'colleges_master.csv load failed: %. Table will be empty.', SQLERRM;
    END;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS score_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL,
  saved_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_score_history_user_id  ON score_history(user_id);
CREATE INDEX IF NOT EXISTS idx_score_history_saved_at ON score_history(saved_at);

-- ── Key Dates ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS key_dates (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL CHECK (category IN ('sat','act','ap','fafsa','app_deadline','other')),
  title        TEXT NOT NULL,
  description  TEXT,
  event_date   DATE NOT NULL,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_key_dates_event_date ON key_dates(event_date);
CREATE INDEX IF NOT EXISTS idx_key_dates_category   ON key_dates(category);

-- Seed 2025-26 cycle dates
INSERT INTO key_dates (category, title, description, event_date) VALUES
  ('sat','SAT Test Date','College Board SAT','2025-08-23'),
  ('sat','SAT Registration Deadline','Register by this date for Aug 23 test','2025-08-08'),
  ('sat','SAT Test Date','College Board SAT','2025-10-04'),
  ('sat','SAT Registration Deadline','Register by this date for Oct 4 test','2025-09-19'),
  ('sat','SAT Test Date','College Board SAT','2025-11-01'),
  ('sat','SAT Registration Deadline','Register by this date for Nov 1 test','2025-10-17'),
  ('sat','SAT Test Date','College Board SAT','2025-12-06'),
  ('sat','SAT Registration Deadline','Register by this date for Dec 6 test','2025-11-18'),
  ('sat','SAT Test Date','College Board SAT','2026-03-14'),
  ('sat','SAT Registration Deadline','Register by this date for Mar 14 test','2026-02-27'),
  ('sat','SAT Test Date','College Board SAT','2026-05-02'),
  ('sat','SAT Registration Deadline','Register by this date for May 2 test','2026-04-17'),
  ('sat','SAT Test Date','College Board SAT','2026-06-06'),
  ('sat','SAT Registration Deadline','Register by this date for Jun 6 test','2026-05-22'),
  ('act','ACT Test Date','ACT National Test','2025-09-13'),
  ('act','ACT Registration Deadline','Register by this date for Sep 13 test','2025-08-08'),
  ('act','ACT Test Date','ACT National Test','2025-10-25'),
  ('act','ACT Registration Deadline','Register by this date for Oct 25 test','2025-09-19'),
  ('act','ACT Test Date','ACT National Test','2025-12-13'),
  ('act','ACT Registration Deadline','Register by this date for Dec 13 test','2025-11-07'),
  ('act','ACT Test Date','ACT National Test','2026-02-07'),
  ('act','ACT Registration Deadline','Register by this date for Feb 7 test','2026-01-02'),
  ('act','ACT Test Date','ACT National Test','2026-04-18'),
  ('act','ACT Registration Deadline','Register by this date for Apr 18 test','2026-03-13'),
  ('act','ACT Test Date','ACT National Test','2026-06-13'),
  ('act','ACT Registration Deadline','Register by this date for Jun 13 test','2026-05-08'),
  ('ap','AP Exams Begin','AP Exam window opens — check College Board for subject schedule','2026-05-04'),
  ('ap','AP Exams End','AP Exam window closes','2026-05-15'),
  ('ap','PSAT/NMSQT','National Merit Scholarship Qualifying Test','2025-10-15'),
  ('fafsa','FAFSA Opens','2026-27 FAFSA application opens','2025-10-01'),
  ('fafsa','FAFSA Federal Deadline','Last day to submit FAFSA for federal aid','2026-06-30'),
  ('app_deadline','Common App Opens','Common App opens for new cycle','2025-08-01'),
  ('app_deadline','Early Decision I Deadline','Most ED I deadlines fall on this date','2025-11-01'),
  ('app_deadline','Early Decision II / Early Action','Most EA and ED II deadlines','2026-01-01'),
  ('app_deadline','Regular Decision Deadline','Most RD deadlines cluster here','2026-01-01'),
  ('app_deadline','Financial Aid Priority Deadline','Many schools CSS Profile priority deadline','2026-02-01'),
  ('app_deadline','Admission Decision Day','National college decision deadline','2026-05-01')
ON CONFLICT DO NOTHING;

-- ── Admissions News (Admin-managed pulse items) ─────────────────────────────
CREATE TABLE IF NOT EXISTS admissions_news (
  id          SERIAL PRIMARY KEY,
  headline    VARCHAR(255) NOT NULL,
  summary     TEXT NOT NULL,
  tag         VARCHAR(50) NOT NULL DEFAULT 'Trends',
  is_visible  BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ── Expert Portal (Counselor ↔ Student 1-on-1) ─────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════════

-- Counselor profiles
CREATE TABLE IF NOT EXISTS ep_counselors (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  display_name    VARCHAR(255) NOT NULL,
  title           VARCHAR(255),
  specialties     TEXT[] DEFAULT '{}',
  total_students  INTEGER DEFAULT 0,
  years_experience INTEGER DEFAULT 0,
  availability    VARCHAR(255),
  application_note TEXT DEFAULT '',
  applied_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  reviewed_at     TIMESTAMP,
  reviewed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Configurable plan tiers
CREATE TABLE IF NOT EXISTS ep_plans (
  id                      SERIAL PRIMARY KEY,
  name                    VARCHAR(100) NOT NULL UNIQUE,
  sessions                INTEGER NOT NULL DEFAULT 1,
  price_cents             INTEGER NOT NULL DEFAULT 0,
  discounted_price_cents  INTEGER DEFAULT NULL,
  description             TEXT DEFAULT '',
  features                TEXT[] DEFAULT '{}',
  is_active               BOOLEAN DEFAULT TRUE,
  sort_order              INTEGER DEFAULT 0,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ep_plans (name, sessions, price_cents, discounted_price_cents, description, features, sort_order) VALUES
  ('Starter', 1, 9900, NULL, 'One focused session to kickstart your strategy', ARRAY['1 video session (60 min)','Action item follow-up','Session notes'], 1),
  ('Essay Only', 2, 19900, 15900, 'Dedicated essay feedback and narrative coaching', ARRAY['2 video sessions (60 min each)','Essay review & feedback','Messaging access','Shared notes'], 2),
  ('Full Cycle', 5, 49900, 39900, 'Comprehensive admissions support from start to finish', ARRAY['5 video sessions (60 min each)','Unlimited messaging','Essay review & strategy','School list curation','Application timeline planning'], 3)
ON CONFLICT (name) DO NOTHING;

-- Which counselor is assigned to which student, plan info
CREATE TABLE IF NOT EXISTS ep_assignments (
  id              SERIAL PRIMARY KEY,
  counselor_id    INTEGER REFERENCES ep_counselors(id) ON DELETE CASCADE,
  student_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  plan_id         INTEGER REFERENCES ep_plans(id) ON DELETE SET NULL,
  plan            VARCHAR(50) DEFAULT 'Starter',
  sessions_total  INTEGER DEFAULT 3,
  sessions_used   INTEGER DEFAULT 0,
  status          VARCHAR(20) DEFAULT 'active',
  target_schools  TEXT[] DEFAULT '{}',
  start_date      DATE DEFAULT CURRENT_DATE,
  end_date        DATE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  -- No unique constraint: multiple plans per counselor-student pair allowed
);
CREATE INDEX IF NOT EXISTS idx_ep_assignments_counselor ON ep_assignments(counselor_id);
CREATE INDEX IF NOT EXISTS idx_ep_assignments_student   ON ep_assignments(student_id);

-- Messages between counselor and student
CREATE TABLE IF NOT EXISTS ep_messages (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  sender_role     VARCHAR(10) NOT NULL CHECK (sender_role IN ('counselor','student')),
  body            TEXT NOT NULL,
  is_read         BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ep_messages_assignment ON ep_messages(assignment_id, created_at);

-- Scheduled sessions (video calls)
CREATE TABLE IF NOT EXISTS ep_sessions (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  session_date    DATE NOT NULL,
  session_time    VARCHAR(20) NOT NULL,
  duration_min    INTEGER DEFAULT 60,
  status          VARCHAR(20) DEFAULT 'upcoming' CHECK (status IN ('upcoming','completed','cancelled')),
  topic           VARCHAR(255),
  zoom_link       VARCHAR(500),
  notes           TEXT,
  recording_url   VARCHAR(500),
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ep_sessions_assignment ON ep_sessions(assignment_id);

-- Action items (to-dos assigned by either party)
CREATE TABLE IF NOT EXISTS ep_actions (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  is_done         BOOLEAN DEFAULT FALSE,
  due_date        DATE,
  assigned_by     VARCHAR(10) DEFAULT 'counselor' CHECK (assigned_by IN ('counselor','student')),
  category        VARCHAR(50) DEFAULT 'Application',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ep_actions_assignment ON ep_actions(assignment_id);

-- Shared notes (collaborative docs)
CREATE TABLE IF NOT EXISTS ep_notes (
  id              SERIAL PRIMARY KEY,
  assignment_id   INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  content         TEXT DEFAULT '',
  author_role     VARCHAR(10) DEFAULT 'counselor' CHECK (author_role IN ('counselor','student')),
  is_pinned       BOOLEAN DEFAULT FALSE,
  category        VARCHAR(50) DEFAULT 'Session Notes',
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ep_notes_assignment ON ep_notes(assignment_id);

-- ── Payments (Stripe) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stripe_session_id       VARCHAR(255) UNIQUE,
  stripe_payment_intent_id VARCHAR(255),
  stripe_customer_id      VARCHAR(255),
  amount_cents            INTEGER NOT NULL DEFAULT 0,
  currency                VARCHAR(10) NOT NULL DEFAULT 'usd',
  status                  VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded', 'cancelled', 'disputed')),
  plan_id                 VARCHAR(100),
  plan_name               VARCHAR(100),
  metadata                JSONB DEFAULT '{}',
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_user_id    ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status     ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);

-- ── Counselor Settings ────────────────────────────────────────────────────
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';

CREATE TABLE IF NOT EXISTS counselor_settings (
  id                      SERIAL PRIMARY KEY,
  user_id                 INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  availability_enabled    BOOLEAN DEFAULT TRUE,
  available_days          TEXT[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}',
  start_time              VARCHAR(20) DEFAULT '9:00 AM',
  end_time                VARCHAR(20) DEFAULT '5:00 PM',
  session_duration        INTEGER DEFAULT 60,
  max_students            INTEGER DEFAULT 15,
  zoom_link               VARCHAR(500) DEFAULT '',
  availability_note       VARCHAR(255) DEFAULT '',
  notify_new_message      BOOLEAN DEFAULT TRUE,
  notify_new_assignment   BOOLEAN DEFAULT TRUE,
  notify_session_reminder BOOLEAN DEFAULT TRUE,
  notify_action_due       BOOLEAN DEFAULT FALSE,
  digest_frequency        VARCHAR(20) DEFAULT 'daily',
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

-- ── Admin ↔ Counselor Direct Messaging ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_messages (
  id                SERIAL PRIMARY KEY,
  counselor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role       VARCHAR(10) NOT NULL CHECK (sender_role IN ('admin','counselor')),
  body              TEXT NOT NULL,
  is_read           BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_messages_counselor ON admin_messages(counselor_user_id, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- ── COMPREHENSIVE MOCK DATA ─────────────────────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Counselor profiles ──
INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Dr. Sarah Mitchell', 'Former Yale Admissions Officer', ARRAY['Ivy League','STEM Applications','Essay Strategy'], 200, 12, 'Next available: Tomorrow, 3:00 PM EST'
FROM users WHERE email = 'counselor1@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'James Rivera', 'College Admissions Consultant', ARRAY['Public Universities','Financial Aid','Athletic Recruitment'], 85, 6, 'Next available: Wednesday, 2:00 PM EST'
FROM users WHERE email = 'counselor2@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Dr. Emily Nguyen', 'Former Stanford Admissions Reader', ARRAY['West Coast Schools','Pre-Med','Research Narratives'], 150, 9, 'Next available: Thursday, 10:00 AM EST'
FROM users WHERE email = 'counselor3@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Dr. Sarah Mitchell', 'Former Yale Admissions Officer', ARRAY['Ivy League','STEM Applications','Essay Strategy'], 200, 12, 'Next available: Tomorrow, 3:00 PM EST'
FROM users WHERE email = 'counselor@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Dr. Marcus Webb', 'Former Harvard Admissions Director',
       ARRAY['Liberal Arts','Diversity Essays','Financial Aid Negotiation'], 175, 15,
       'Next available: Monday, 10:00 AM EST'
FROM users WHERE email = 'counselor4@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Aisha Patel', 'Pre-Med & Science Admissions Specialist',
       ARRAY['Pre-Med Tracks','Research Essays','UC System'], 120, 8,
       'Next available: Tuesday, 2:00 PM EST'
FROM users WHERE email = 'counselor5@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Prof. Leo Tanaka', 'MIT & STEM Admissions Coach',
       ARRAY['Engineering Programs','STEM Portfolios','Technical Interviews'], 95, 10,
       'Next available: Wednesday, 4:00 PM EST'
FROM users WHERE email = 'counselor6@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability)
SELECT id, 'Sofia Mendes', 'International & Transfer Admissions Expert',
       ARRAY['Transfer Applications','International Students','Community College Pathways'], 60, 5,
       'Next available: Thursday, 11:00 AM EST'
FROM users WHERE email = 'counselor7@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── Student Settings ────────────────────────────────────────────────────────
INSERT INTO student_settings (user_id, phone, high_school_name, high_school_city, high_school_state,
  graduation_year, intended_major, intended_major_alt, gpa_scale, app_round,
  target_school_count, preferred_location, preferred_size, financial_aid_needed,
  bio, email_reminders, deadline_alerts)
SELECT id, '(555) 100-1001', 'Westlake High School', 'Austin', 'TX',
  2026, 'Computer Science', 'Data Science', '4.0', 'Early Decision',
  10, 'West Coast', 'Large (>15k)', false,
  'Passionate builder who started coding at 14. Founded a startup at 16 that taught me more about leadership than any classroom.',
  true, true
FROM users WHERE email = 'student1@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO student_settings (user_id, phone, high_school_name, high_school_city, high_school_state,
  graduation_year, intended_major, intended_major_alt, gpa_scale, app_round,
  target_school_count, preferred_location, preferred_size, financial_aid_needed, bio)
SELECT id, '(555) 100-1002', 'Lincoln Academy', 'Boston', 'MA',
  2026, 'Molecular Biology', 'Biochemistry', '4.0', 'Early Action',
  12, 'East Coast', 'Medium (5k-15k)', true,
  'Pre-med track with published research in molecular biology at MIT summer program. Aspiring physician-scientist.'
FROM users WHERE email = 'student2@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO student_settings (user_id, phone, high_school_name, high_school_city, high_school_state,
  graduation_year, intended_major, gpa_scale, app_round, bio)
SELECT id, '(555) 100-1003', 'Oak Ridge Prep', 'Chicago', 'IL',
  2026, 'Economics', '4.0', 'Regular Decision',
  'Economics enthusiast with internship at a local investment firm. Debate team captain three years running.'
FROM users WHERE email = 'student3@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO student_settings (user_id, phone, high_school_name, high_school_city, high_school_state,
  graduation_year, intended_major, gpa_scale, app_round, bio)
SELECT id, '(555) 100-1004', 'Central High School', 'Houston', 'TX',
  2026, 'Pre-Med', '5.0', 'Early Decision',
  'First-generation college applicant. Volunteered 400+ hours at Houston Methodist Hospital. Research in neuroscience.'
FROM users WHERE email = 'student4@example.com' ON CONFLICT (user_id) DO NOTHING;

-- ── Student Journey: Alex Johnson ───────────────────────────────────────────
INSERT INTO student_journey (user_id, activities, honors, experiences, identity, goals)
SELECT id,
  '[
    {"id":"a1","name":"Startup — StudyTrack App","role":"Founder & CEO","years":"11th–12th","hours_per_week":15,"impact":"Built product used by 12 students. Learned product-market fit the hard way.","story_moment":"The night we launched and refreshed analytics every 5 minutes — 0 signups. Pivoted after talking to actual students.","essay_worthy":true},
    {"id":"a2","name":"Robotics Team","role":"Lead Software Engineer","years":"9th–12th","hours_per_week":10,"impact":"Helped team qualify for state championships. Wrote the autonomous navigation code.","story_moment":"3am before state regionals, code crashed. Fixed it in 45 minutes under pressure.","essay_worthy":false},
    {"id":"a3","name":"CS Tutoring Program","role":"Founder & Lead Tutor","years":"11th–12th","hours_per_week":5,"impact":"Tutored 18 underclassmen in Python and web development.","story_moment":"A student who said she''d never code passed her AP CS exam with a 4.","essay_worthy":true}
  ]'::jsonb,
  '[
    {"id":"h1","name":"AP Scholar with Distinction","level":"national","year":"2025","context":"Scored 4+ on 8 AP exams including CS, Calc BC, and Physics."},
    {"id":"h2","name":"FIRST Robotics Regional Finalist","level":"regional","year":"2025","context":"Our team placed 2nd at the Texas Regional. I wrote the autonomous scoring code."},
    {"id":"h3","name":"Congressional App Challenge — State Finalist","level":"state","year":"2024","context":"App competition for high schoolers. Top 5 in Texas."}
  ]'::jsonb,
  '[
    {"id":"e1","title":"Startup failure and the 12 users who changed everything","timeframe":"Junior year, October","what_happened":"Launched StudyTrack to zero traction. Interviewed our 12 users and discovered we built the wrong thing entirely.","what_changed":"Shifted from building what I thought students needed to listening first. Now I start every project with user interviews.","essay_worthy":true},
    {"id":"e2","title":"Teaching my mom to use a smartphone","timeframe":"8th grade","what_happened":"Spent a summer teaching my immigrant mother to navigate English-language apps for her work.","what_changed":"Realized technology is only as good as its accessibility. Shapes how I think about UI design.","essay_worthy":false}
  ]'::jsonb,
  '{"family_background":"First-generation tech family. Parents immigrated from Taiwan and run a restaurant.","challenge_overcome":"Balancing startup work with academics while supporting family restaurant on weekends.","three_words":"Curious, relentless, empathetic","grades_dont_show":"I learn best by building things, not by test-taking. My GitHub has 200+ commits.","proud_of_outside_school":"Raised $800 for local food bank through a hackathon I organized."}'::jsonb,
  '{"career_direction":"Product-focused software engineer, eventually founder of a company that democratizes education.","intended_college_major":"Computer Science with HCI focus","why_college_now":"Need formal CS foundations and the network to build at scale.","ten_year_vision":"Running a 50-person EdTech startup, having shipped products used by millions of students."}'::jsonb
FROM users WHERE email = 'student1@example.com' ON CONFLICT (user_id) DO NOTHING;

-- ── Student Journey: Sarah Chen ─────────────────────────────────────────────
INSERT INTO student_journey (user_id, activities, honors, experiences, identity, goals)
SELECT id,
  '[
    {"id":"a1","name":"Molecular Biology Research — MIT Summer","role":"Research Intern","years":"11th","hours_per_week":40,"impact":"Co-authored paper on CRISPR-Cas9 applications in zebrafish models.","story_moment":"The moment my Western blot showed the expected band. 3 failed attempts before that.","essay_worthy":true},
    {"id":"a2","name":"Science Olympiad","role":"Team Captain","years":"9th–12th","hours_per_week":8,"impact":"Led team to state championship. Medaled in Forensics and Disease Detectives.","story_moment":"","essay_worthy":false},
    {"id":"a3","name":"Hospital Volunteer — Mass General","role":"Patient Ambassador","years":"10th–12th","hours_per_week":6,"impact":"350+ hours volunteering in pediatric oncology.","story_moment":"A 9-year-old patient taught me more about resilience than any textbook.","essay_worthy":true}
  ]'::jsonb,
  '[
    {"id":"h1","name":"National Merit Semifinalist","level":"national","year":"2025","context":"Top 1% of PSAT scorers in Massachusetts."},
    {"id":"h2","name":"Siemens Competition Regional Finalist","level":"regional","year":"2024","context":"Research project on CRISPR off-target effects."},
    {"id":"h3","name":"AP Scholar with Honor","level":"national","year":"2024","context":""}
  ]'::jsonb,
  '[
    {"id":"e1","title":"The Western blot that finally worked","timeframe":"Summer after junior year","what_happened":"Three weeks of failed experiments at MIT. The 4th attempt produced a clean result that made it into a published paper.","what_changed":"Learned that science is mostly failure. Became comfortable with iteration rather than expecting success.","essay_worthy":true}
  ]'::jsonb,
  '{"family_background":"Parents are both physicians. Grew up in a household where medicine was dinner-table conversation.","challenge_overcome":"Overcoming impostor syndrome as the only high schooler in a college research lab.","three_words":"Methodical, curious, compassionate","grades_dont_show":"I spend 10 hours a week reading medical journals for fun.","proud_of_outside_school":"Started a peer tutoring network serving 60 students at my school."}'::jsonb,
  '{"career_direction":"Physician-scientist focused on oncology and translational research.","intended_college_major":"Molecular Biology / Pre-Med","why_college_now":"Need rigorous science foundation and research opportunities at a research university.","ten_year_vision":"MD-PhD, running my own lab investigating novel cancer therapeutics."}'::jsonb
FROM users WHERE email = 'student2@example.com' ON CONFLICT (user_id) DO NOTHING;

-- ── Student Journey: Marcus Williams ────────────────────────────────────────
INSERT INTO student_journey (user_id, activities, honors, experiences, identity, goals)
SELECT id,
  '[
    {"id":"a1","name":"Varsity Debate Team","role":"Captain & Head Coach","years":"9th–12th","hours_per_week":12,"impact":"Led team to state championship. Coached 8 junior debaters.","story_moment":"Final round of state: partner froze. I kept cross-ex going for 3 extra minutes and we won.","essay_worthy":true},
    {"id":"a2","name":"Investment Firm Internship — Baird Capital","role":"Analyst Intern","years":"12th","hours_per_week":20,"impact":"Built a DCF model for a $40M acquisition target. Presented to senior analysts.","story_moment":"","essay_worthy":false}
  ]'::jsonb,
  '[{"id":"h1","name":"Illinois State Debate Champion","level":"state","year":"2025","context":"Policy debate division."}]'::jsonb,
  '[]'::jsonb,
  '{"family_background":"Grew up in South Side Chicago. First in family to pursue Ivy League.","challenge_overcome":"Balancing 20hr/week internship with debate and academics.","three_words":"Analytical, persuasive, driven","grades_dont_show":"","proud_of_outside_school":"Built a financial literacy curriculum taught at 3 Chicago public schools."}'::jsonb,
  '{"career_direction":"Investment banking, eventually private equity or economic policy.","intended_college_major":"Economics","why_college_now":"","ten_year_vision":"VP at a top PE firm or running economic policy at a think tank."}'::jsonb
FROM users WHERE email = 'student3@example.com' ON CONFLICT (user_id) DO NOTHING;

-- ── Additional colleges for students 3 & 4 ──────────────────────────────────
INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out)
SELECT u.id, c.name, c.bucket, c.ar, c.gr, c.sa, c.ti, c.to_
FROM users u, (VALUES
  ('University of Chicago','reach',7,94,1540,'$63k','$63k'),
  ('Northwestern University','reach',7,95,1520,'$62k','$62k'),
  ('Washington University in St. Louis','target',15,94,1510,'$61k','$61k'),
  ('University of Michigan','target',26,92,1440,'$16k','$51k'),
  ('Indiana University','safety',80,79,1210,'$11k','$37k')
) AS c(name,bucket,ar,gr,sa,ti,to_)
WHERE u.email='student3@example.com' ON CONFLICT DO NOTHING;

INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out)
SELECT u.id, c.name, c.bucket, c.ar, c.gr, c.sa, c.ti, c.to_
FROM users u, (VALUES
  ('Johns Hopkins University','reach',11,94,1540,'$59k','$59k'),
  ('Baylor University','target',38,80,1290,'$50k','$50k'),
  ('University of Texas at Austin','target',32,86,1310,'$11k','$40k'),
  ('Texas A&M University','safety',63,83,1220,'$12k','$37k')
) AS c(name,bucket,ar,gr,sa,ti,to_)
WHERE u.email='student4@example.com' ON CONFLICT DO NOTHING;

-- ── Additional essay drafts ──────────────────────────────────────────────────
INSERT INTO essay_drafts (user_id, essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
SELECT u.id, e.essay_type, e.college_name, e.topic, e.draft_text, e.word_count, e.prompt_source, e.tone_chips, e.formality, e.word_limit, e.status
FROM users u, (VALUES
  ('why_school', 'MIT', 'Why MIT: intersection of CS and product design',
   'MIT''s unique intersection of rigorous computer science and its emphasis on real-world impact aligns with everything I have been building toward. The d.school collaboration model, where engineers work alongside designers and sociologists, is exactly the environment where I built my best work.',
   54, 'MIT Application', 'Analytical', 4, 250, 'draft'),
  ('challenge', NULL, 'The startup that failed and the 12 users who saved it',
   'Three months after launch, StudyTrack had exactly 12 users. I know because I tracked them obsessively. What I didn''t know — not yet — was that those 12 people were about to completely change how I build things. I had spent six weeks coding in isolation, certain I understood what students needed. I was wrong.',
   68, 'Common App', 'Reflective,Narrative', 3, 650, 'draft')
) AS e(essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
WHERE u.email = 'student1@example.com';

INSERT INTO essay_drafts (user_id, essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
SELECT u.id, e.essay_type, e.college_name, e.topic, e.draft_text, e.word_count, e.prompt_source, e.tone_chips, e.formality, e.word_limit, e.status
FROM users u, (VALUES
  ('personal_statement', NULL, 'The Western blot that finally worked — three weeks of failure',
   'The gel image showed nothing. Again. I had run the same experiment three times, and three times the result had been the same: a blank rectangle where a band should have been. My PI said nothing, just nodded and went back to her office. I was the only high schooler in the lab, and I was failing at the most basic technique.',
   72, 'Common App', 'Reflective,Narrative', 3, 650, 'draft'),
  ('why_school', 'Yale', 'Why Yale: Bass Center for Genomics and Computational Biomedicine',
   'Yale''s Bass Center represents exactly the kind of translational research environment I am looking for — where computational tools and wet lab work inform each other daily. Professor Anna Pyle''s work on RNA structure prediction is research I would want to contribute to from day one.',
   52, 'Yale Application', 'Analytical', 4, 250, 'draft')
) AS e(essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
WHERE u.email = 'student2@example.com';

-- ── Score history for students ────────────────────────────────────────────────
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 78, NOW() - INTERVAL '3 weeks' FROM users WHERE email='student1@example.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 81, NOW() - INTERVAL '2 weeks' FROM users WHERE email='student1@example.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 84, NOW() - INTERVAL '1 week' FROM users WHERE email='student1@example.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 65, NOW() - INTERVAL '3 weeks' FROM users WHERE email='student2@example.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 71, NOW() - INTERVAL '1 week' FROM users WHERE email='student2@example.com';

-- ── ep_assignments with real plan_id references ──────────────────────────────
INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, target_schools)
SELECT ec.id, u.id, ep.id, 'Full Cycle', 5, 2, 'active', ARRAY['Stanford','MIT','Harvard']
FROM ep_counselors ec, users u, ep_plans ep
WHERE ec.user_id=(SELECT id FROM users WHERE email='counselor1@example.com')
  AND u.email='student1@example.com' AND ep.name='Full Cycle'


INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, target_schools)
SELECT ec.id, u.id, ep.id, 'Essay Only', 2, 1, 'active', ARRAY['Yale','Princeton','Columbia']
FROM ep_counselors ec, users u, ep_plans ep
WHERE ec.user_id=(SELECT id FROM users WHERE email='counselor1@example.com')
  AND u.email='student2@example.com' AND ep.name='Essay Only'


INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, target_schools)
SELECT ec.id, u.id, ep.id, 'Full Cycle', 5, 1, 'active', ARRAY['UChicago','Northwestern']
FROM ep_counselors ec, users u, ep_plans ep
WHERE ec.user_id=(SELECT id FROM users WHERE email='counselor2@example.com')
  AND u.email='student3@example.com' AND ep.name='Full Cycle'


INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, target_schools)
SELECT ec.id, u.id, ep.id, 'Starter', 1, 0, 'active', ARRAY['Johns Hopkins','Baylor']
FROM ep_counselors ec, users u, ep_plans ep
WHERE ec.user_id=(SELECT id FROM users WHERE email='counselor2@example.com')
  AND u.email='student4@example.com' AND ep.name='Starter'


-- ── ep_messages ──────────────────────────────────────────────────────────────
INSERT INTO ep_messages (assignment_id, sender_role, body, is_read, created_at)
SELECT a.id, m.role, m.body, m.is_read, NOW() + m.offset
FROM ep_assignments a, users u,
(VALUES
  ('counselor', 'Hi Alex! I have reviewed your profile and I am really impressed with the startup experience. That is a rare essay angle — failure that drives growth. Let''s start there.', true, INTERVAL '-5 days'),
  ('student',   'Thanks Dr. Mitchell! I have been struggling with whether to write about the startup or robotics. The startup feels more personal but also more vulnerable.', true, INTERVAL '-5 days 1 hour'),
  ('counselor', 'That vulnerability IS the essay. Admissions officers read thousands of ''I won a competition'' essays. A founder who listened to 12 users and pivoted? That is human and memorable.', true, INTERVAL '-5 days 2 hours'),
  ('student',   'OK, I am convinced. I drafted the opening paragraph last night — want to see it?', true, INTERVAL '-4 days'),
  ('counselor', 'Absolutely, send it over. Also, let''s schedule our session for Thursday to map out the full arc.', true, INTERVAL '-4 days 1 hour'),
  ('student',   'Sent! Also — should I mention the 12 users by name or keep it anonymous?', false, INTERVAL '-1 day')
) AS m(role, body, is_read, offset)
WHERE u.email='student1@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_messages (assignment_id, sender_role, body, is_read, created_at)
SELECT a.id, m.role, m.body, m.is_read, NOW() + m.offset
FROM ep_assignments a, users u,
(VALUES
  ('counselor', 'Hi Sarah! Your research background is exceptional — very few applicants have a co-authored paper. Let''s make sure your essays reflect that depth.', true, INTERVAL '-7 days'),
  ('student',   'Thank you! I am most nervous about the Yale supplement. I keep writing too technically and losing the narrative thread.', true, INTERVAL '-7 days 2 hours'),
  ('counselor', 'Common issue for science applicants. The trick is to anchor in a specific moment — your Western blot result, for instance — and let the science serve the story, not the other way around.', true, INTERVAL '-6 days'),
  ('student',   'That is actually really helpful. I have been starting with the hypothesis and working forward. Let me try starting with the moment the band appeared.', false, INTERVAL '-2 days')
) AS m(role, body, is_read, offset)
WHERE u.email='student2@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

-- ── ep_sessions ──────────────────────────────────────────────────────────────
INSERT INTO ep_sessions (assignment_id, session_date, session_time, duration_min, status, topic, zoom_link, notes)
SELECT a.id, s.sdate, s.stime, 60, s.status, s.topic, 'https://zoom.us/j/mock', s.notes
FROM ep_assignments a, users u,
(VALUES
  ('2026-03-12', '3:00 PM', 'upcoming', 'Essay Arc & Stanford Supplement Strategy', NULL),
  ('2026-03-05', '3:00 PM', 'completed', 'Startup Essay Draft Review', 'Reviewed opening paragraph. Strong hook — the analytics refresh moment lands well. Suggested moving the pivot revelation earlier. Assigned: expand to 400 words by next session.'),
  ('2026-02-20', '3:00 PM', 'completed', 'Profile Review & Strategy Session', 'Reviewed all inputs. Decided on startup story as personal statement. Robotics to be used for supplement. Confirmed Stanford ED intent.')
) AS s(sdate, stime, status, topic, notes)
WHERE u.email='student1@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_sessions (assignment_id, session_date, session_time, duration_min, status, topic, zoom_link)
SELECT a.id, '2026-03-14', '4:00 PM', 60, 'upcoming', 'Yale & Princeton Supplement Deep Dive', 'https://zoom.us/j/mock'
FROM ep_assignments a, users u
WHERE u.email='student2@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

-- ── ep_actions ───────────────────────────────────────────────────────────────
INSERT INTO ep_actions (assignment_id, text, is_done, due_date, assigned_by, category)
SELECT a.id, ac.text, ac.done, NOW() + ac.offset, 'counselor', ac.category
FROM ep_assignments a, users u,
(VALUES
  ('Expand personal statement opening to 400 words — focus on the 12-user conversation scene', false, INTERVAL '5 days', 'Essay'),
  ('Draft Stanford ''Why Stanford'' supplement — mention d.school and HCI focus', false, INTERVAL '7 days', 'Supplements'),
  ('Research 3 specific MIT CS professors whose work aligns with your interests', false, INTERVAL '10 days', 'Supplements'),
  ('Fill out Common App Activities section — all 10 slots with descriptions', true, INTERVAL '-2 days', 'Application'),
  ('Complete FAFSA with parents — due Feb 1', true, INTERVAL '-10 days', 'Application')
) AS ac(text, done, offset, category)
WHERE u.email='student1@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_actions (assignment_id, text, is_done, due_date, assigned_by, category)
SELECT a.id, ac.text, ac.done, NOW() + ac.offset, 'counselor', ac.category
FROM ep_assignments a, users u,
(VALUES
  ('Rewrite Yale supplement opening — start with the Western blot moment, not the hypothesis', false, INTERVAL '4 days', 'Supplements'),
  ('List 5 Princeton research labs in molecular biology with specific connection to your interests', false, INTERVAL '6 days', 'Supplements'),
  ('Request recommendation letter from MIT research supervisor — deadline in 2 weeks', false, INTERVAL '8 days', 'Application'),
  ('Submit Common App activities section', true, INTERVAL '-5 days', 'Application')
) AS ac(text, done, offset, category)
WHERE u.email='student2@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

-- ── ep_notes ─────────────────────────────────────────────────────────────────
INSERT INTO ep_notes (assignment_id, title, content, author_role, is_pinned, category)
SELECT a.id, n.title, n.content, n.author, n.pinned, n.category
FROM ep_assignments a, users u,
(VALUES
  ('Session 1 — Profile Review & Strategy',
   E'Key Decisions:\n• Primary essay: Startup failure → growth narrative (strong, differentiated)\n• Personal statement focus: The 12 users pivot moment\n• Robotics used for MIT/Stanford supplement\n• Targeting Stanford ED — confirm Nov 1 deadline\n\nProfile Strengths:\n• Startup experience is genuinely rare at this age\n• CS tutoring program shows leadership + giving back\n• 3.97 GPA + strong test scores\n\nAreas to strengthen:\n• Yale supplement needs more specific academic tie-ins\n• Activity descriptions on Common App are too vague',
   'counselor', true, 'Session Notes'),
  ('Session 2 — Essay Draft Review',
   E'Personal Statement Draft Feedback:\n• Opening hook lands well — the ''analytics refresh'' scene is vivid\n• Transition to user interviews needs to come earlier (don''t wait until paragraph 4)\n• The pivot moment is the emotional core — expand it\n• Ending feels rushed — add a forward-looking sentence about how this shapes future work\n\nAction items from this session: see Action Items tab',
   'counselor', false, 'Session Notes'),
  ('My Essay Brainstorm Notes',
   E'Ideas I keep coming back to:\n• The night we launched — 0 signups after 6 weeks of work\n• The user interview where the student said "I wouldn''t use this even if it was free"\n• The moment I realized I''d been building for myself, not for users\n• Teaching my mom to use technology (backup essay?)\n\nAngle for Stanford: connect startup to d.school philosophy of human-centered design',
   'student', false, 'Brainstorm')
) AS n(title, content, author, pinned, category)
WHERE u.email='student1@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_notes (assignment_id, title, content, author_role, is_pinned, category)
SELECT a.id, n.title, n.content, n.author, n.pinned, n.category
FROM ep_assignments a, users u,
(VALUES
  ('Sarah — Initial Profile Assessment',
   E'Exceptional candidacy:\n• 4.10 GPA (5.0 scale), 1560 SAT\n• Published research at MIT — genuinely rare\n• 350+ hospital volunteer hours in pediatric oncology\n• National Merit Semifinalist\n\nRisk areas:\n• School list too top-heavy (7/12 schools are extreme reach)\n• Essays currently too technical — needs narrative reframe\n• Yale supplement needs specific academic tie to Bass Center\n\nStrategy:\n• Lead essays with the lab failure story — humanity over credentials\n• Add 2-3 strong target schools (Duke, Emory, Case Western)',
   'counselor', true, 'Session Notes')
) AS n(title, content, author, pinned, category)
WHERE u.email='student2@example.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor1@example.com')
ON CONFLICT DO NOTHING;


-- ── Profiles (academic scores) ─────────────────────────────────────────────
INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, final_score, updated_at)
SELECT id, 3.97, 1500, NULL, 8, 6, 3, 84, NOW()
FROM users WHERE email='student1@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, final_score, updated_at)
SELECT id, 4.10, 1560, NULL, 9, 7, 4, 91, NOW()
FROM users WHERE email='student2@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, final_score, updated_at)
SELECT id, 3.85, 1440, 33, 6, 4, 3, 79, NOW()
FROM users WHERE email='student3@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, final_score, updated_at)
SELECT id, 3.70, NULL, 31, 5, 3, 2, 72, NOW()
FROM users WHERE email='student4@example.com' ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ── ADDITIONAL COMPREHENSIVE MOCK DATA ──────────────────────────────────
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Sofia Reyes (student5) — Full Data ──────────────────────────────────────

INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, final_score, updated_at)
SELECT id, 3.88, 1480, 34, 7, 5, 4, 81, NOW()
FROM users WHERE email='student5@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO student_settings (user_id, phone, high_school_name, high_school_city, high_school_state,
  graduation_year, intended_major, intended_major_alt, gpa_scale, app_round,
  target_school_count, preferred_location, preferred_size, financial_aid_needed, bio)
SELECT id, '(555) 100-1005', 'Miami Arts Academy', 'Miami', 'FL',
  2026, 'Environmental Science', 'Public Policy', '4.0', 'Early Action',
  8, 'Southeast', 'Medium (5k-15k)', true,
  'Environmental activist and debate champion. Founded my school''s sustainability club and led a local wetlands restoration project.'
FROM users WHERE email = 'student5@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out)
SELECT u.id, c.name, c.bucket, c.ar, c.gr, c.sa, c.ti, c.to_
FROM users u, (VALUES
  ('Duke University','reach',6,96,1530,'$63k','$63k'),
  ('Emory University','target',16,91,1470,'$57k','$57k'),
  ('University of Florida','target',23,90,1390,'$6k','$28k'),
  ('University of Miami','target',28,83,1360,'$56k','$56k'),
  ('Florida State University','safety',36,82,1270,'$6k','$21k')
) AS c(name,bucket,ar,gr,sa,ti,to_)
WHERE u.email='student5@example.com' ON CONFLICT DO NOTHING;

INSERT INTO essay_drafts (user_id, essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
SELECT u.id, e.essay_type, e.college_name, e.topic, e.draft_text, e.word_count, e.prompt_source, e.tone_chips, e.formality, e.word_limit, e.status
FROM users u, (VALUES
  ('personal_statement', NULL, 'The wetland that taught me to listen',
   'I spent three months knee-deep in sawgrass before I understood what the Everglades were trying to tell me. What started as a community service project became a lesson in patience, systems thinking, and the cost of ignoring science.',
   42, 'Common App', 'Reflective,Narrative', 3, 650, 'draft'),
  ('why_school', 'Duke University', 'Why Duke: Nicholas School of the Environment',
   'Duke''s Nicholas School of the Environment offers the rare combination of rigorous science and policy training that my work requires. The Bass Connections program, which pairs students with faculty on real-world environmental challenges, is exactly the applied model I thrive in.',
   48, 'Duke Application', 'Analytical', 4, 250, 'draft')
) AS e(essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
WHERE u.email = 'student5@example.com';

INSERT INTO student_journey (user_id, activities, honors, experiences, identity, goals)
SELECT id,
  '[
    {"id":"a1","name":"Everglades Restoration Project","role":"Founder & Project Lead","years":"10th–12th","hours_per_week":8,"impact":"Organized 50+ volunteers. Restored 2 acres of mangrove habitat. Data cited by local EPA office.","story_moment":"Knee-deep in sawgrass at 6 AM, I realized science without action is just observation.","essay_worthy":true},
    {"id":"a2","name":"Debate Team","role":"Captain","years":"9th–12th","hours_per_week":10,"impact":"Led team to state semifinals. Won Best Speaker at 3 regional tournaments.","story_moment":"","essay_worthy":false},
    {"id":"a3","name":"Miami Youth Climate Coalition","role":"Co-founder","years":"11th–12th","hours_per_week":5,"impact":"Coalition of 12 schools advocating for climate education in FL curriculum.","story_moment":"Testified before Miami-Dade school board on climate literacy standards.","essay_worthy":true}
  ]'::jsonb,
  '[
    {"id":"h1","name":"National AP Scholar","level":"national","year":"2025","context":"Scored 4+ on all 5 AP exams including Environmental Science."},
    {"id":"h2","name":"Scholastic Writing Award — Silver Key","level":"regional","year":"2024","context":"Op-ed on climate education in public schools."}
  ]'::jsonb,
  '[
    {"id":"e1","title":"Testifying at the school board","timeframe":"Fall junior year","what_happened":"Presented data on climate literacy gaps to Miami-Dade school board. They adopted a pilot program.","what_changed":"Learned that data moves people, but stories move policy.","essay_worthy":true}
  ]'::jsonb,
  '{"family_background":"Cuban-American family. Parents own a small landscaping business. Grew up watching them navigate climate impacts on their livelihood.","challenge_overcome":"Convincing skeptical adults that a teenager could lead a real environmental project.","three_words":"Tenacious, persuasive, grounded","grades_dont_show":"I spend weekends at Everglades National Park doing unofficial water quality testing.","proud_of_outside_school":"My op-ed on youth climate activism was published in the Miami Herald."}'::jsonb,
  '{"career_direction":"Environmental lawyer or policy director at an agency like the EPA.","intended_college_major":"Environmental Science with Policy minor","why_college_now":"Need the scientific rigor and policy frameworks to scale my impact beyond local advocacy.","ten_year_vision":"Leading environmental policy at the state or federal level, bridging science and legislation."}'::jsonb
FROM users WHERE email = 'student5@example.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 74, NOW() - INTERVAL '4 weeks' FROM users WHERE email='student5@example.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 78, NOW() - INTERVAL '2 weeks' FROM users WHERE email='student5@example.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 81, NOW() - INTERVAL '3 days' FROM users WHERE email='student5@example.com';


-- ── student@admitly.com — Full Demo User Data ──────────────────────────────

INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, leadership_roles, final_score, updated_at)
SELECT id, 3.92, 1510, NULL, 10, 7, 5, 3, 83, NOW()
FROM users WHERE email='student@admitly.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO student_settings (user_id, phone, parent_email, high_school_name, high_school_city, high_school_state,
  graduation_year, intended_major, intended_major_alt, gpa_scale, app_round,
  target_school_count, preferred_location, preferred_size, financial_aid_needed,
  bio, email_reminders, deadline_alerts, counselor_name, counselor_email)
SELECT id, '(555) 200-3000', 'parent.johnson@email.com', 'Westlake High School', 'Austin', 'TX',
  2026, 'Computer Science', 'Data Science', '4.0', 'Early Decision',
  10, 'West Coast', 'Large (>15k)', false,
  'Passionate builder who started coding at 14. Founded a startup at 16 that taught me more about leadership than any classroom.',
  true, true, 'Dr. Sarah Mitchell', 'counselor@admitly.com'
FROM users WHERE email = 'student@admitly.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO colleges (user_id, name, bucket, accept_rate, grad_rate, sat_avg, tuition_in, tuition_out, notes)
SELECT u.id, c.name, c.bucket, c.ar, c.gr, c.sa, c.ti, c.to_, c.notes
FROM users u, (VALUES
  ('Stanford University',      'reach',  4,  97, 1545, '$59k', '$59k', 'ED target — d.school + HCI focus'),
  ('MIT',                      'reach',  7,  95, 1545, '$59k', '$59k', 'Strong CS + entrepreneurship ecosystem'),
  ('Carnegie Mellon University','reach',  15, 93, 1520, '$60k', '$60k', 'SCS program is top-tier'),
  ('UC Berkeley',              'target', 17, 93, 1415, '$15k', '$45k', 'Great CS program, in-state backup'),
  ('University of Michigan',   'target', 26, 92, 1440, '$16k', '$51k', 'Ross School of Business crossover'),
  ('Boston University',        'target', 37, 88, 1390, '$62k', '$62k', ''),
  ('University of Washington', 'target', 44, 84, 1370, '$12k', '$39k', 'Allen School of CS'),
  ('University of Arizona',    'safety', 86, 63, 1210, '$13k', '$38k', ''),
  ('Arizona State University', 'safety', 89, 66, 1215, '$12k', '$30k', '')
) AS c(name, bucket, ar, gr, sa, ti, to_, notes)
WHERE u.email = 'student@admitly.com';

INSERT INTO essay_drafts (user_id, essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
SELECT u.id, e.essay_type, e.college_name, e.topic, e.draft_text, e.word_count, e.prompt_source, e.tone_chips, e.formality, e.word_limit, e.status
FROM users u, (VALUES
  ('personal_statement', NULL,
   'Growth through building my startup',
   'Building a startup at 16 taught me more about leadership than any classroom ever could. When our first product failed, I learned that failure is data, not defeat. Three months after launch, StudyTrack had exactly 12 users. I know because I tracked them obsessively. What I didn''t know — not yet — was that those 12 people were about to completely change how I build things.',
   67, 'Common App', 'Reflective,Narrative', 3, 650, 'draft'),
  ('why_school', 'Stanford University',
   'Why Stanford''s CS + Human-Computer Interaction',
   'Stanford''s interdisciplinary approach to CS and design aligns directly with my goal of building accessible technology. The d.school''s emphasis on human-centered design mirrors how I rebuilt StudyTrack after talking to real users instead of guessing what they needed.',
   46, 'Common App', 'Analytical', 4, 650, 'draft'),
  ('why_school', 'MIT',
   'Why MIT: intersection of CS and product design',
   'MIT''s unique intersection of rigorous computer science and its emphasis on real-world impact aligns with everything I have been building toward. The Sandbox Innovation Fund, where student founders get mentorship and funding, is exactly the environment where my startup instincts would sharpen into something scalable.',
   50, 'MIT Application', 'Analytical', 4, 250, 'draft'),
  ('activity', NULL,
   'Robotics Team — Lead Software Engineer',
   'Writing autonomous navigation code for our competition robot taught me that elegant algorithms mean nothing if the hardware can''t execute them. That lesson in bridging theory and reality shapes how I approach every engineering problem.',
   35, 'Common App', 'Narrative', 3, 350, 'draft'),
  ('challenge', NULL,
   'The startup that failed and the 12 users who saved it',
   'Three months after launch, StudyTrack had exactly 12 users. I spent six weeks coding in isolation, certain I understood what students needed. I was wrong. Those 12 conversations taught me that the best products come from listening, not assuming.',
   50, 'Common App', 'Reflective,Narrative', 3, 650, 'draft')
) AS e(essay_type, college_name, topic, draft_text, word_count, prompt_source, tone_chips, formality, word_limit, status)
WHERE u.email = 'student@admitly.com';

INSERT INTO student_journey (user_id, activities, honors, experiences, identity, goals)
SELECT id,
  '[
    {"id":"a1","name":"Startup — StudyTrack App","role":"Founder & CEO","years":"11th–12th","hours_per_week":15,"impact":"Built product used by 12 students. Learned product-market fit the hard way.","story_moment":"The night we launched and refreshed analytics every 5 minutes — 0 signups. Pivoted after talking to actual students.","essay_worthy":true},
    {"id":"a2","name":"Robotics Team","role":"Lead Software Engineer","years":"9th–12th","hours_per_week":10,"impact":"Helped team qualify for state championships. Wrote the autonomous navigation code.","story_moment":"3am before state regionals, code crashed. Fixed it in 45 minutes under pressure.","essay_worthy":false},
    {"id":"a3","name":"CS Tutoring Program","role":"Founder & Lead Tutor","years":"11th–12th","hours_per_week":5,"impact":"Tutored 18 underclassmen in Python and web development.","story_moment":"A student who said she''d never code passed her AP CS exam with a 4.","essay_worthy":true},
    {"id":"a4","name":"Hackathon Organizer","role":"Lead Organizer","years":"12th","hours_per_week":8,"impact":"Organized HackAustin with 120 participants. Raised $800 for local food bank.","story_moment":"","essay_worthy":false}
  ]'::jsonb,
  '[
    {"id":"h1","name":"AP Scholar with Distinction","level":"national","year":"2025","context":"Scored 4+ on 7 AP exams including CS A, Calc BC, and Physics C."},
    {"id":"h2","name":"FIRST Robotics Regional Finalist","level":"regional","year":"2025","context":"Team placed 2nd at Texas Regional. Wrote autonomous scoring code."},
    {"id":"h3","name":"Congressional App Challenge — State Finalist","level":"state","year":"2024","context":"Top 5 in Texas for an educational technology app."},
    {"id":"h4","name":"National Merit Commended Student","level":"national","year":"2025","context":""}
  ]'::jsonb,
  '[
    {"id":"e1","title":"Startup failure and the 12 users who changed everything","timeframe":"Junior year, October","what_happened":"Launched StudyTrack to zero traction. Interviewed our 12 users and discovered we built the wrong thing entirely.","what_changed":"Shifted from building what I thought students needed to listening first. Now I start every project with user interviews.","essay_worthy":true},
    {"id":"e2","title":"Teaching my mom to use a smartphone","timeframe":"8th grade","what_happened":"Spent a summer teaching my immigrant mother to navigate English-language apps for her work.","what_changed":"Realized technology is only as good as its accessibility. Shapes how I think about UI design.","essay_worthy":false}
  ]'::jsonb,
  '{"family_background":"First-generation tech family. Parents immigrated from Taiwan and run a restaurant.","challenge_overcome":"Balancing startup work with academics while supporting family restaurant on weekends.","three_words":"Curious, relentless, empathetic","grades_dont_show":"I learn best by building things, not by test-taking. My GitHub has 200+ commits.","proud_of_outside_school":"Raised $800 for local food bank through a hackathon I organized."}'::jsonb,
  '{"career_direction":"Product-focused software engineer, eventually founder of a company that democratizes education.","intended_college_major":"Computer Science with HCI focus","why_college_now":"Need formal CS foundations and the network to build at scale.","ten_year_vision":"Running a 50-person EdTech startup, having shipped products used by millions of students."}'::jsonb
FROM users WHERE email = 'student@admitly.com' ON CONFLICT (user_id) DO NOTHING;

INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 72, NOW() - INTERVAL '5 weeks' FROM users WHERE email='student@admitly.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 76, NOW() - INTERVAL '3 weeks' FROM users WHERE email='student@admitly.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 80, NOW() - INTERVAL '2 weeks' FROM users WHERE email='student@admitly.com';
INSERT INTO score_history (user_id, score, saved_at)
SELECT id, 83, NOW() - INTERVAL '4 days' FROM users WHERE email='student@admitly.com';

-- ── Assignment: counselor@admitly.com → student@admitly.com ─────────────────
INSERT INTO ep_assignments (counselor_id, student_id, plan_id, plan, sessions_total, sessions_used, status, target_schools)
SELECT ec.id, u.id, ep.id, 'Full Cycle', 5, 2, 'active', ARRAY['Stanford','MIT','Carnegie Mellon']
FROM ep_counselors ec, users u, ep_plans ep
WHERE ec.user_id=(SELECT id FROM users WHERE email='counselor@admitly.com')
  AND u.email='student@admitly.com' AND ep.name='Full Cycle'


INSERT INTO ep_messages (assignment_id, sender_role, body, is_read, created_at)
SELECT a.id, m.role, m.body, m.is_read, NOW() + m.offset
FROM ep_assignments a, users u,
(VALUES
  ('counselor', 'Hi Alex! Welcome to Admitly. I''ve reviewed your profile and I''m really impressed with the startup experience. That''s a powerful essay angle — failure that drives growth. Let''s start there.', true, INTERVAL '-6 days'),
  ('student',   'Thanks Dr. Mitchell! I''ve been going back and forth on whether to write about the startup or robotics. The startup feels more personal but also more vulnerable.', true, INTERVAL '-6 days 1 hour'),
  ('counselor', 'That vulnerability IS the essay. AOs read thousands of ''I won a competition'' essays. A founder who listened to 12 users and pivoted? That''s human and memorable.', true, INTERVAL '-5 days'),
  ('student',   'OK, I''m convinced. I drafted the opening paragraph last night — want to see it?', true, INTERVAL '-4 days'),
  ('counselor', 'Absolutely! Send it over. Also, let''s schedule our next session for Thursday to map out the full arc.', true, INTERVAL '-4 days 1 hour'),
  ('student',   'Sent! Also — should I mention the 12 users by name or keep it anonymous?', false, INTERVAL '-1 day')
) AS m(role, body, is_read, offset)
WHERE u.email='student@admitly.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor@admitly.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_sessions (assignment_id, session_date, session_time, duration_min, status, topic, zoom_link, notes)
SELECT a.id, s.sdate, s.stime, 60, s.status, s.topic, 'https://zoom.us/j/mock', s.notes
FROM ep_assignments a, users u,
(VALUES
  ('2026-03-15', '3:00 PM', 'upcoming', 'Essay Arc & Stanford Supplement Strategy', NULL),
  ('2026-03-06', '3:00 PM', 'completed', 'Startup Essay Draft Review', 'Reviewed opening paragraph. Strong hook. Suggested moving the pivot revelation earlier. Assigned: expand to 400 words by next session.'),
  ('2026-02-22', '3:00 PM', 'completed', 'Profile Review & Strategy Session', 'Reviewed all inputs. Decided on startup story as personal statement. Robotics for supplement. Confirmed Stanford ED intent.')
) AS s(sdate, stime, status, topic, notes)
WHERE u.email='student@admitly.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor@admitly.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_actions (assignment_id, text, is_done, due_date, assigned_by, category)
SELECT a.id, ac.text, ac.done, NOW() + ac.offset, 'counselor', ac.category
FROM ep_assignments a, users u,
(VALUES
  ('Expand personal statement opening to 400 words — focus on the 12-user conversation scene', false, INTERVAL '5 days', 'Essay'),
  ('Draft Stanford ''Why Stanford'' supplement — mention d.school and HCI focus', false, INTERVAL '7 days', 'Supplements'),
  ('Research 3 specific MIT professors whose work aligns with your interests', false, INTERVAL '10 days', 'Supplements'),
  ('Fill out Common App Activities section — all 10 slots', true, INTERVAL '-2 days', 'Application'),
  ('Complete FAFSA with parents', true, INTERVAL '-10 days', 'Application')
) AS ac(text, done, offset, category)
WHERE u.email='student@admitly.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor@admitly.com')
ON CONFLICT DO NOTHING;

INSERT INTO ep_notes (assignment_id, title, content, author_role, is_pinned, category)
SELECT a.id, n.title, n.content, n.author, n.pinned, n.category
FROM ep_assignments a, users u,
(VALUES
  ('Session 1 — Profile Review & Strategy',
   E'Key Decisions:\n• Primary essay: Startup failure → growth narrative\n• Personal statement focus: The 12 users pivot moment\n• Robotics used for MIT/Stanford supplement\n• Targeting Stanford ED — Nov 1 deadline\n\nProfile Strengths:\n• Startup experience is genuinely rare\n• CS tutoring program shows leadership\n• 3.92 GPA + 1510 SAT\n\nAreas to strengthen:\n• MIT supplement needs specific faculty tie-ins\n• Activity descriptions need more specificity',
   'counselor', true, 'Session Notes'),
  ('My Essay Brainstorm Notes',
   E'Ideas I keep coming back to:\n• The night we launched — 0 signups\n• The user interview where a student said "I wouldn''t use this even if it was free"\n• Teaching my mom to use technology\n\nStanford angle: connect startup to d.school philosophy of human-centered design',
   'student', false, 'Brainstorm')
) AS n(title, content, author, pinned, category)
WHERE u.email='student@admitly.com'
  AND a.student_id=u.id AND a.counselor_id=(SELECT ec.id FROM ep_counselors ec JOIN users cu ON cu.id=ec.user_id WHERE cu.email='counselor@admitly.com')
ON CONFLICT DO NOTHING;


-- ── Admissions News — Seed Data ─────────────────────────────────────────────
INSERT INTO admissions_news (headline, summary, tag, is_visible, created_at) VALUES
  ('More Colleges Reinstating SAT/ACT Requirements for 2026',
   'After years of test-optional policies, a growing number of selective universities are returning to requiring standardized test scores. Students applying in the 2025-26 cycle should plan to submit SAT or ACT scores to maximize their options.',
   'SAT/ACT', true, NOW() - INTERVAL '2 days'),
  ('FAFSA Simplification Act Streamlines Aid Applications',
   'The 2026-27 FAFSA form is now significantly shorter thanks to the FAFSA Simplification Act. Families should submit early — many states and schools award financial aid on a first-come, first-served basis.',
   'Financial Aid', true, NOW() - INTERVAL '5 days'),
  ('Early Decision Applications Hit Record Highs',
   'Colleges report that Early Decision application volumes are up 12% year-over-year. Admissions counselors recommend that students apply ED only to their genuine top-choice school, as the commitment is binding.',
   'Strategy', true, NOW() - INTERVAL '1 week'),
  ('New Common App Essay Prompts for 2025-26 Cycle',
   'The Common Application has refreshed its essay prompts for the upcoming cycle. While the classic "background, identity, or talent" prompt remains, a new option about intellectual risk-taking has been added. Start brainstorming early.',
   'Trends', true, NOW() - INTERVAL '10 days'),
  ('Ivy League Schools Expand Financial Aid Commitments',
   'Several Ivy League institutions have announced expanded financial aid packages, with families earning under $100K now qualifying for free tuition at most programs. This is welcome news for high-achieving students from middle-income families.',
   'Financial Aid', true, NOW() - INTERVAL '2 weeks'),
  ('AP Score Reporting Policy Changes at Top Universities',
   'A number of selective colleges are adjusting how they evaluate AP scores in admissions. While still valued, self-reported scores are becoming more common, and some schools are weighting AP course rigor over raw scores.',
   'Trends', true, NOW() - INTERVAL '3 weeks')
ON CONFLICT DO NOTHING;


-- ── LLM Usage — Mock Data ──────────────────────────────────────────────────
INSERT INTO llm_usage (user_id, essay_id, mode, essay_type, model, prompt_tokens, completion_tokens, total_tokens, cost_microcents, created_at)
SELECT u.id, NULL, m.mode, m.etype, m.model, m.pt, m.ct, m.tt, m.cost, NOW() + m.offset
FROM users u, (VALUES
  ('generate', 'personal_statement', 'gpt-4o', 1250, 680, 1930, 4825, INTERVAL '-14 days'),
  ('improve',  'personal_statement', 'gpt-4o', 1800, 920, 2720, 6800, INTERVAL '-13 days'),
  ('generate', 'why_school',         'gpt-4o', 980,  540, 1520, 3800, INTERVAL '-10 days'),
  ('generate', 'activity',           'gpt-4o', 750,  420, 1170, 2925, INTERVAL '-8 days'),
  ('improve',  'why_school',         'gpt-4o', 1400, 780, 2180, 5450, INTERVAL '-5 days'),
  ('generate', 'challenge',          'gpt-4o', 1100, 620, 1720, 4300, INTERVAL '-3 days'),
  ('improve',  'personal_statement', 'gpt-4o', 1650, 850, 2500, 6250, INTERVAL '-1 day')
) AS m(mode, etype, model, pt, ct, tt, cost, offset)
WHERE u.email = 'student1@example.com';

INSERT INTO llm_usage (user_id, essay_id, mode, essay_type, model, prompt_tokens, completion_tokens, total_tokens, cost_microcents, created_at)
SELECT u.id, NULL, m.mode, m.etype, m.model, m.pt, m.ct, m.tt, m.cost, NOW() + m.offset
FROM users u, (VALUES
  ('generate', 'personal_statement', 'gpt-4o', 1320, 710, 2030, 5075, INTERVAL '-12 days'),
  ('improve',  'personal_statement', 'gpt-4o', 1900, 980, 2880, 7200, INTERVAL '-9 days'),
  ('generate', 'why_school',         'gpt-4o', 1050, 580, 1630, 4075, INTERVAL '-6 days')
) AS m(mode, etype, model, pt, ct, tt, cost, offset)
WHERE u.email = 'student2@example.com';

INSERT INTO llm_usage (user_id, essay_id, mode, essay_type, model, prompt_tokens, completion_tokens, total_tokens, cost_microcents, created_at)
SELECT u.id, NULL, m.mode, m.etype, m.model, m.pt, m.ct, m.tt, m.cost, NOW() + m.offset
FROM users u, (VALUES
  ('generate', 'personal_statement', 'gpt-4o', 1180, 650, 1830, 4575, INTERVAL '-7 days'),
  ('generate', 'why_school',         'gpt-4o', 890,  490, 1380, 3450, INTERVAL '-4 days'),
  ('improve',  'personal_statement', 'gpt-4o', 1550, 810, 2360, 5900, INTERVAL '-2 days')
) AS m(mode, etype, model, pt, ct, tt, cost, offset)
WHERE u.email = 'student@admitly.com';


-- ── Payments — Mock Data ───────────────────────────────────────────────────
INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, amount_cents, status, plan_id, plan_name, created_at)
SELECT u.id, 'cs_mock_' || u.id || '_001', 'pi_mock_' || u.id || '_001', p.price_cents, 'succeeded', p.id, p.name, NOW() - INTERVAL '30 days'
FROM users u, ep_plans p
WHERE u.email = 'student1@example.com' AND p.name = 'Full Cycle';

INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, amount_cents, status, plan_id, plan_name, created_at)
SELECT u.id, 'cs_mock_' || u.id || '_001', 'pi_mock_' || u.id || '_001', p.price_cents, 'succeeded', p.id, p.name, NOW() - INTERVAL '25 days'
FROM users u, ep_plans p
WHERE u.email = 'student2@example.com' AND p.name = 'Essay Only';

INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, amount_cents, status, plan_id, plan_name, created_at)
SELECT u.id, 'cs_mock_' || u.id || '_002', 'pi_mock_' || u.id || '_002', p.price_cents, 'succeeded', p.id, p.name, NOW() - INTERVAL '20 days'
FROM users u, ep_plans p
WHERE u.email = 'student3@example.com' AND p.name = 'Full Cycle';

INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, amount_cents, status, plan_id, plan_name, created_at)
SELECT u.id, 'cs_mock_' || u.id || '_003', 'pi_mock_' || u.id || '_003', p.price_cents, 'succeeded', p.id, p.name, NOW() - INTERVAL '15 days'
FROM users u, ep_plans p
WHERE u.email = 'student4@example.com' AND p.name = 'Starter';

INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, amount_cents, status, plan_id, plan_name, created_at)
SELECT u.id, 'cs_mock_' || u.id || '_004', 'pi_mock_' || u.id || '_004', p.price_cents, 'succeeded', p.id, p.name, NOW() - INTERVAL '10 days'
FROM users u, ep_plans p
WHERE u.email = 'student@admitly.com' AND p.name = 'Full Cycle';

-- A pending payment
INSERT INTO payments (user_id, stripe_session_id, amount_cents, status, plan_name, created_at)
SELECT u.id, 'cs_mock_' || u.id || '_005', 9900, 'pending', 'Starter', NOW() - INTERVAL '2 days'
FROM users u WHERE u.email = 'student5@example.com';

-- A refund
INSERT INTO payments (user_id, stripe_session_id, stripe_payment_intent_id, amount_cents, status, plan_name, created_at)
VALUES (NULL, 'cs_mock_refund_001', 'pi_mock_refund_001', 19900, 'refunded', 'Essay Only', NOW() - INTERVAL '45 days');


-- ── Counselor Settings — Mock Data ─────────────────────────────────────────
INSERT INTO counselor_settings (user_id, availability_enabled, available_days, start_time, end_time,
  session_duration, max_students, zoom_link, notify_new_message, notify_new_assignment,
  notify_session_reminder, digest_frequency)
SELECT id, true, '{Mon,Tue,Wed,Thu,Fri}', '9:00 AM', '5:00 PM',
  60, 20, 'https://zoom.us/j/mock-mitchell', true, true, true, 'daily'
FROM users WHERE email = 'counselor1@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO counselor_settings (user_id, availability_enabled, available_days, start_time, end_time,
  session_duration, max_students, zoom_link, notify_new_message, notify_new_assignment,
  notify_session_reminder, digest_frequency)
SELECT id, true, '{Mon,Wed,Fri}', '10:00 AM', '4:00 PM',
  60, 10, 'https://zoom.us/j/mock-rivera', true, true, true, 'weekly'
FROM users WHERE email = 'counselor2@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO counselor_settings (user_id, availability_enabled, available_days, start_time, end_time,
  session_duration, max_students, zoom_link, notify_new_message, notify_new_assignment,
  notify_session_reminder, digest_frequency)
SELECT id, true, '{Mon,Tue,Wed,Thu,Fri}', '9:00 AM', '5:00 PM',
  60, 20, 'https://zoom.us/j/mock-admitly-counselor', true, true, true, 'daily'
FROM users WHERE email = 'counselor@admitly.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── Mock Pending Counselor (for testing approval workflow) ──────────────────
INSERT INTO users (email, name, password, role) VALUES
  ('pending1@example.com', 'Dr. Rachel Kim', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'pending_counselor'),
  ('pending2@example.com', 'David Okafor', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'pending_counselor')
ON CONFLICT (email) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, title, specialties, years_experience, application_note, applied_at)
SELECT id, 'Dr. Rachel Kim', 'Former Princeton Admissions Reader',
       ARRAY['Ivy League','Humanities','First-Generation Students'], 10,
       'I spent 8 years reading applications at Princeton and now run a boutique consulting practice focused on first-generation students applying to highly selective schools. My students have been admitted to every Ivy League school.',
       NOW() - INTERVAL '2 days'
FROM users WHERE email = 'pending1@example.com'
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO ep_counselors (user_id, display_name, specialties, years_experience, application_note, applied_at)
SELECT id, 'David Okafor',
       ARRAY['STEM Programs','Athletic Recruitment','UC System'], 4,
       'Former D1 athlete and UC Berkeley alum. I specialize in helping student-athletes navigate the dual pressures of admissions and athletic recruitment. I have helped 30+ athletes get recruited to top programs.',
       NOW() - INTERVAL '6 hours'
FROM users WHERE email = 'pending2@example.com'
ON CONFLICT (user_id) DO NOTHING;

-- ── Admin ↔ Counselor Seed Messages ─────────────────────────────────────────
INSERT INTO admin_messages (counselor_user_id, sender_role, body, is_read, created_at)
SELECT u.id, m.role, m.body, m.read, NOW() + m.offset
FROM users u, (VALUES
  ('admin',    'Welcome to Admitly, Dr. Mitchell! You''ve been approved as a counselor. Let me know if you have any questions about the platform.', true, INTERVAL '-5 days'),
  ('counselor','Thank you! I''ve reviewed the dashboard. Quick question — how do I update my Zoom link for sessions?', true, INTERVAL '-5 days' + INTERVAL '2 hours'),
  ('admin',    'Go to Settings → Payment tab. You''ll see a Zoom Link field in the Availability section. You can also set it per-session from the Expert Portal.', true, INTERVAL '-5 days' + INTERVAL '3 hours'),
  ('counselor','Found it, thanks! Also — can we discuss Maya Patel''s essay timeline? I think we need to extend her assignment by 2 sessions.', false, INTERVAL '-2 hours')
) AS m(role, body, read, offset)
WHERE u.email = 'counselor1@example.com'
ON CONFLICT DO NOTHING;

INSERT INTO admin_messages (counselor_user_id, sender_role, body, is_read, created_at)
SELECT u.id, m.role, m.body, m.read, NOW() + m.offset
FROM users u, (VALUES
  ('admin',    'Welcome aboard, Dr. Kim! You have two students assigned. Let me know if the workload works for your schedule.', true, INTERVAL '-3 days'),
  ('counselor','Thanks! The workload is fine. One question — student Marcus Williams missed his last session. What is the policy on missed sessions?', false, INTERVAL '-1 hour')
) AS m(role, body, read, offset)
WHERE u.email = 'counselor2@example.com'
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ── Phase A: Sent emails audit table ────────────────────────────────────────
-- Mirrors migrations/005_admin_phase_a.sql so fresh Postgres volumes get it
-- on first boot. Idempotent: CREATE TABLE IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sent_emails (
  id              SERIAL PRIMARY KEY,
  sender_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_email    VARCHAR(255),
  recipient_type  VARCHAR(32) NOT NULL,
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

-- ═══════════════════════════════════════════════════════════════════════════
-- ── Phase B: Stripe webhook idempotency + payment event audit ───────────────
-- Mirrors migrations/006_phase_b.sql so fresh Postgres volumes get them on
-- first boot. Idempotent: CREATE TABLE IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS processed_events (
  stripe_event_id VARCHAR(255) PRIMARY KEY,
  event_type      VARCHAR(64)  NOT NULL,
  outcome         VARCHAR(32)  NOT NULL DEFAULT 'processed',
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_received ON processed_events(received_at DESC);

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

-- ═══════════════════════════════════════════════════════════════════════════
-- ── Phase C: Premium Manual-Matching Flow ──────────────────────────────────
-- Mirrors migrations/007_premium_requests.sql for fresh-volume parity.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS premium_requests (
  id                     SERIAL PRIMARY KEY,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id                INTEGER REFERENCES ep_plans(id) ON DELETE SET NULL,
  plan_name              VARCHAR(100) NOT NULL,
  amount_cents_quoted    INTEGER NOT NULL,
  amount_cents_invoiced  INTEGER,
  counselor_user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status                 VARCHAR(32) NOT NULL DEFAULT 'pending_review'
                         CHECK (status IN (
                           'pending_review','awaiting_payment','paid',
                           'cancelled_by_student','rejected','voided','expired'
                         )),
  rejection_reason       TEXT,
  stripe_invoice_id      VARCHAR(255),
  stripe_invoice_item_id VARCHAR(255),
  hosted_invoice_url     TEXT,
  invoice_sent_at        TIMESTAMPTZ,
  invoice_expires_at     TIMESTAMPTZ,
  reminder_sent_at       TIMESTAMPTZ,
  paid_at                TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_premium_requests_one_active
  ON premium_requests(user_id)
  WHERE status IN ('pending_review','awaiting_payment');
CREATE INDEX IF NOT EXISTS idx_premium_requests_user    ON premium_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_status  ON premium_requests(status);
CREATE INDEX IF NOT EXISTS idx_premium_requests_invoice ON premium_requests(stripe_invoice_id);
CREATE INDEX IF NOT EXISTS idx_premium_requests_expires ON premium_requests(invoice_expires_at) WHERE status = 'awaiting_payment';

-- ── Phase D: per-attempt failure tracking on premium_requests ───────────────
-- Surfaces in the admin Recoveries tab. Mirrors migrations/008_premium_failure_tracking.sql.
ALTER TABLE premium_requests
  ADD COLUMN IF NOT EXISTS last_attempt_failed_at TIMESTAMPTZ;
ALTER TABLE premium_requests
  ADD COLUMN IF NOT EXISTS last_failure_reason TEXT;
ALTER TABLE premium_requests
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_premium_requests_failed
  ON premium_requests(last_attempt_failed_at DESC)
  WHERE last_attempt_failed_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- Phase: Profile Builder — student_activities
-- Mirrors migrations/009_student_activities.sql for fresh-volume parity.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS student_activities (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(120) NOT NULL,
  category        VARCHAR(40) NOT NULL DEFAULT 'other'
                  CHECK (category IN ('leadership','community','arts','academic','athletics','work','other')),
  role            VARCHAR(80),
  hours_per_week  INTEGER DEFAULT 0,
  start_grade     INTEGER,
  end_grade       INTEGER,
  is_current      BOOLEAN DEFAULT TRUE,
  description     VARCHAR(280),
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_activities_user ON student_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_student_activities_user_sort ON student_activities(user_id, sort_order);

-- ═══════════════════════════════════════════════════════════════
-- Phase: Profile Builder Phase 2 — personal_stories + profile_analysis
-- Mirrors migrations/010_profile_phase2.sql for fresh-volume parity.
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS personal_stories (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(120) NOT NULL,
  summary         TEXT NOT NULL DEFAULT '',
  grade           INTEGER,
  theme_tags      TEXT[] DEFAULT '{}',
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_personal_stories_user ON personal_stories(user_id);
CREATE INDEX IF NOT EXISTS idx_personal_stories_user_sort ON personal_stories(user_id, sort_order);

CREATE TABLE IF NOT EXISTS profile_analysis (
  user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_hash    VARCHAR(64) NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  model           VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
  prompt_tokens   INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  generated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
