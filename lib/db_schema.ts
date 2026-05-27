/**
 * db_schema.ts — Ensures all required tables exist.
 * Import and call ensureSchema() at the top of any API route 
 * that touches the database. Runs once per server lifecycle.
 */
import { getPool } from '@/lib/db';

let ready = false;

export async function ensureSchema(): Promise<void> {
  if (ready) return;
  const db = getPool();
  try {
    // Core user columns — each in its own statement so one failure doesn't block others
    const safeDDL = async (sql: string) => { try { await db.query(sql); } catch(e: any) { /* column/table may already exist or not exist yet — safe to ignore */ } };

    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student'`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'credentials'`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`);
    // Subscription tier: 'free' | 'pro' | 'premium' | 'cancelled'
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'free'`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255)`);
    // Pro: expires 1 year after purchase. Premium: expires per counselor package end_date.
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP`);
    // Premium package details — links to ep_assignments for counselor access
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS premium_package VARCHAR(50)`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP`);
    await safeDDL(`ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_reason VARCHAR(500)`);
    await safeDDL(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS candidate_statement TEXT DEFAULT ''`);

    // Counselor + plan + assignment columns added in CREATE TABLE below
    // Post-create safeDDLs for existing DBs are at the bottom of this function

    // SAT sub-score columns — colleges_master may not exist yet on fresh builds
    await safeDDL(`ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_math_25 INTEGER`);
    await safeDDL(`ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_math_75 INTEGER`);
    await safeDDL(`ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_cr_25 INTEGER`);
    await safeDDL(`ALTER TABLE colleges_master ADD COLUMN IF NOT EXISTS sat_cr_75 INTEGER`);

    await db.query(`

      CREATE TABLE IF NOT EXISTS student_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        phone VARCHAR(30), parent_email VARCHAR(255), bio TEXT,
        high_school_name VARCHAR(255), high_school_city VARCHAR(100), high_school_state VARCHAR(50),
        graduation_year INTEGER, intended_major VARCHAR(150), intended_major_alt VARCHAR(150),
        gpa_scale VARCHAR(20) DEFAULT '4.0',
        counselor_name VARCHAR(150), counselor_email VARCHAR(255),
        app_round VARCHAR(50), target_school_count INTEGER DEFAULT 8,
        preferred_location VARCHAR(150), preferred_size VARCHAR(50),
        financial_aid_needed BOOLEAN DEFAULT false,
        email_reminders BOOLEAN DEFAULT true, deadline_alerts BOOLEAN DEFAULT true,
        weekly_summary BOOLEAN DEFAULT false, share_data_analytics BOOLEAN DEFAULT true,
        allow_counselor_access BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS llm_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        essay_id INTEGER, mode VARCHAR(20) NOT NULL DEFAULT 'generate',
        essay_type VARCHAR(50), model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o',
        prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0, cost_microcents INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS score_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL, saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS key_dates (
        id SERIAL PRIMARY KEY, category TEXT NOT NULL, title TEXT NOT NULL, description TEXT,
        event_date DATE NOT NULL, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admissions_news (
        id SERIAL PRIMARY KEY, headline VARCHAR(255) NOT NULL, summary TEXT NOT NULL,
        tag VARCHAR(50) NOT NULL DEFAULT 'Trends', is_visible BOOLEAN DEFAULT TRUE,
        source_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE admissions_news ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);
      ALTER TABLE admissions_news ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;

      CREATE TABLE IF NOT EXISTS pricing_config (
        id INTEGER PRIMARY KEY DEFAULT 1,
        pro_full_price INTEGER NOT NULL DEFAULT 129,
        pro_discount_price INTEGER NOT NULL DEFAULT 89,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO pricing_config (id, pro_full_price, pro_discount_price) VALUES (1, 129, 89) ON CONFLICT (id) DO NOTHING;

      ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS shared_with_counselor BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS expert_tag VARCHAR(50) DEFAULT NULL;
      ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS source_essay_id INTEGER DEFAULT NULL;
      UPDATE essay_drafts SET topic = LEFT(topic, 3000) WHERE LENGTH(topic) > 3000;
      ALTER TABLE essay_drafts ALTER COLUMN topic TYPE VARCHAR(3000);

      CREATE TABLE IF NOT EXISTS student_deadlines (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        college_name VARCHAR(255) NOT NULL,
        deadline_type VARCHAR(50) NOT NULL,
        due_date DATE NOT NULL,
        description TEXT DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
        notes TEXT DEFAULT '',
        source VARCHAR(20) NOT NULL DEFAULT 'auto',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_student_deadlines_user ON student_deadlines(user_id);
      CREATE INDEX IF NOT EXISTS idx_student_deadlines_date ON student_deadlines(due_date);

      CREATE TABLE IF NOT EXISTS college_deadlines (
        id SERIAL PRIMARY KEY,
        ope6_id INTEGER,
        college_name VARCHAR(255) NOT NULL,
        deadline_type VARCHAR(50) NOT NULL,
        due_date DATE NOT NULL,
        description TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_college_deadlines_ope6 ON college_deadlines(ope6_id);
      CREATE INDEX IF NOT EXISTS idx_college_deadlines_name ON college_deadlines(college_name);

      CREATE TABLE IF NOT EXISTS student_journey (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        activities JSONB NOT NULL DEFAULT '[]', honors JSONB NOT NULL DEFAULT '[]',
        experiences JSONB NOT NULL DEFAULT '[]', identity JSONB NOT NULL DEFAULT '{}',
        goals JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS student_activities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(120) NOT NULL,
        category VARCHAR(40) NOT NULL DEFAULT 'other'
          CHECK (category IN ('leadership','community','arts','academic','athletics','work','other')),
        role VARCHAR(80),
        hours_per_week INTEGER DEFAULT 0,
        start_grade INTEGER,
        end_grade INTEGER,
        is_current BOOLEAN DEFAULT TRUE,
        description VARCHAR(280),
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_student_activities_user ON student_activities(user_id);
      CREATE INDEX IF NOT EXISTS idx_student_activities_user_sort ON student_activities(user_id, sort_order);

      CREATE TABLE IF NOT EXISTS personal_stories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(120) NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        grade INTEGER,
        theme_tags TEXT[] DEFAULT '{}',
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_personal_stories_user ON personal_stories(user_id);
      CREATE INDEX IF NOT EXISTS idx_personal_stories_user_sort ON personal_stories(user_id, sort_order);

      CREATE TABLE IF NOT EXISTS profile_analysis (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        content_hash VARCHAR(64) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}',
        model VARCHAR(50) NOT NULL DEFAULT 'gpt-4o-mini',
        prompt_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ep_counselors (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        display_name VARCHAR(255) NOT NULL, title VARCHAR(255),
        specialties TEXT[] DEFAULT '{}', total_students INTEGER DEFAULT 0,
        years_experience INTEGER DEFAULT 0, availability VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        hourly_rate_cents INTEGER DEFAULT 5000,
        total_earned_cents INTEGER DEFAULT 0,
        application_note TEXT DEFAULT '',
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        bio TEXT DEFAULT '', phone VARCHAR(30) DEFAULT '', timezone VARCHAR(50) DEFAULT 'America/New_York',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '';
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS phone VARCHAR(30) DEFAULT '';
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/New_York';
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS application_note TEXT DEFAULT '';
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS reviewed_by INTEGER;
      ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR(255);

      CREATE TABLE IF NOT EXISTS ep_plans (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, sessions INTEGER NOT NULL DEFAULT 1,
        price_cents INTEGER NOT NULL DEFAULT 0, discounted_price_cents INTEGER DEFAULT NULL,
        session_duration_minutes INTEGER DEFAULT 60,
        description TEXT DEFAULT '',
        features TEXT[] DEFAULT '{}', is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE ep_plans ADD COLUMN IF NOT EXISTS discounted_price_cents INTEGER DEFAULT NULL;

      CREATE TABLE IF NOT EXISTS ep_assignments (
        id SERIAL PRIMARY KEY,
        counselor_id INTEGER REFERENCES ep_counselors(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        plan_id INTEGER, plan VARCHAR(50) DEFAULT 'Starter',
        sessions_total INTEGER DEFAULT 3, sessions_used INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active', target_schools TEXT[] DEFAULT '{}',
        start_date DATE DEFAULT CURRENT_DATE, end_date DATE,
        declined_reason TEXT, accepted_at TIMESTAMP, notified_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ep_messages (
        id SERIAL PRIMARY KEY, assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
        sender_role VARCHAR(10) NOT NULL, body TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ep_sessions (
        id SERIAL PRIMARY KEY, assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
        session_date DATE NOT NULL, session_time VARCHAR(20) NOT NULL,
        duration_min INTEGER DEFAULT 60, status VARCHAR(20) DEFAULT 'upcoming',
        topic VARCHAR(255), zoom_link VARCHAR(500), notes TEXT,
        recording_url VARCHAR(500), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ep_actions (
        id SERIAL PRIMARY KEY, assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
        text TEXT NOT NULL, is_done BOOLEAN DEFAULT FALSE, due_date DATE,
        assigned_by VARCHAR(10) DEFAULT 'counselor', category VARCHAR(50) DEFAULT 'Application',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ep_notes (
        id SERIAL PRIMARY KEY, assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, content TEXT DEFAULT '',
        author_role VARCHAR(10) DEFAULT 'counselor', is_pinned BOOLEAN DEFAULT FALSE,
        category VARCHAR(50) DEFAULT 'Session Notes',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        stripe_session_id VARCHAR(255) UNIQUE, stripe_payment_intent_id VARCHAR(255),
        stripe_customer_id VARCHAR(255), amount_cents INTEGER NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'usd', status VARCHAR(20) NOT NULL DEFAULT 'pending',
        plan_id VARCHAR(100), plan_name VARCHAR(100), metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS counselor_settings (
        id SERIAL PRIMARY KEY, user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        availability_enabled BOOLEAN DEFAULT TRUE,
        available_days TEXT[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}',
        start_time VARCHAR(20) DEFAULT '9:00 AM', end_time VARCHAR(20) DEFAULT '5:00 PM',
        session_duration INTEGER DEFAULT 60, max_students INTEGER DEFAULT 15,
        zoom_link VARCHAR(500) DEFAULT '', availability_note VARCHAR(255) DEFAULT '',
        notify_new_message BOOLEAN DEFAULT TRUE, notify_new_assignment BOOLEAN DEFAULT TRUE,
        notify_session_reminder BOOLEAN DEFAULT TRUE, notify_action_due BOOLEAN DEFAULT FALSE,
        digest_frequency VARCHAR(20) DEFAULT 'daily',
        payment_method VARCHAR(30) DEFAULT 'bank_transfer', bank_name VARCHAR(100) DEFAULT '',
        account_holder VARCHAR(150) DEFAULT '', routing_number VARCHAR(20) DEFAULT '',
        account_number_encrypted VARCHAR(255) DEFAULT '', paypal_email VARCHAR(255) DEFAULT '',
        payment_note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS counselor_payouts (
        id SERIAL PRIMARY KEY,
        counselor_id INTEGER REFERENCES ep_counselors(id) ON DELETE CASCADE,
        assignment_id INTEGER REFERENCES ep_assignments(id) ON DELETE SET NULL,
        amount_cents INTEGER NOT NULL DEFAULT 0,
        hours DECIMAL(5,2) DEFAULT 0,
        rate_cents INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'pending',
        stripe_transfer_id VARCHAR(255),
        paid_at TIMESTAMP,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrations for existing DBs that already have tables without new columns
    // ── Post-create migrations for existing DBs that already have tables ──
    await safeDDL(`ALTER TABLE ep_assignments ADD COLUMN IF NOT EXISTS declined_reason TEXT`);
    await safeDDL(`ALTER TABLE ep_assignments ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP`);
    await safeDDL(`ALTER TABLE ep_assignments ADD COLUMN IF NOT EXISTS notified_at TIMESTAMP`);
    await safeDDL(`ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`);
    await safeDDL(`ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS hourly_rate_cents INTEGER DEFAULT 5000`);
    await safeDDL(`ALTER TABLE ep_counselors ADD COLUMN IF NOT EXISTS total_earned_cents INTEGER DEFAULT 0`);
    await safeDDL(`ALTER TABLE ep_plans ADD COLUMN IF NOT EXISTS session_duration_minutes INTEGER DEFAULT 60`);
    // Drop unique constraint on (counselor_id, student_id) to allow multiple plans
    await safeDDL(`ALTER TABLE ep_assignments DROP CONSTRAINT IF EXISTS ep_assignments_counselor_id_student_id_key`);

    // ── Admin ↔ Counselor direct messaging ──
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_messages (
        id SERIAL PRIMARY KEY,
        counselor_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_role VARCHAR(10) NOT NULL CHECK (sender_role IN ('admin','counselor')),
        body TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_admin_messages_counselor ON admin_messages(counselor_user_id, created_at);
    `);

    ready = true;
    console.log('[db_schema] All tables verified');
  } catch (err) {
    console.error('[db_schema] Schema init failed:', err);
  }
}

/**
 * Seeds mock data for testing — 2 students (premium), 2 counselors, 1 admin, 2 plans, 2 assignments.
 * Only inserts if no data exists (checks user count).
 * Call after ensureSchema().
 */
export async function seedMockData(): Promise<void> {
  // Only seed demo data when explicitly enabled (dev/staging)
  if (process.env.ENABLE_DEMO_ACCOUNTS !== 'true') return;

  const db = getPool();
  try {
    // Check if all 5 demo users already exist with correct data
    const { rows } = await db.query(`SELECT email, role, subscription_status FROM users WHERE email IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com')`);
    const existing = new Set(rows.map((r: any) => r.email));

    // Also check profiles exist for students
    const { rows: profRows } = await db.query(`SELECT u.email FROM profiles p JOIN users u ON u.id=p.user_id WHERE u.email IN ('student1@admitly.com','student2@admitly.com')`);
    const profilesExist = profRows.length === 2;

    // Also check assignments exist
    const { rows: assignRows } = await db.query(`SELECT id FROM ep_assignments LIMIT 1`).catch(() => ({ rows: [] }));

    if (existing.size === 5 && profilesExist && assignRows.length > 0) return; // All good

    const hash = '$2a$10$JRyENx0lVLEPWKHXLZpG5ewjiC6eHv3JMx6r0XXraFii0IoAuLfWy'; // password123

    // ── Clean up ALL test/stale data ──
    await db.query(`DELETE FROM admin_messages`).catch(()=>{});
    await db.query(`DELETE FROM ep_messages`).catch(()=>{});
    await db.query(`DELETE FROM ep_sessions`).catch(()=>{});
    await db.query(`DELETE FROM ep_actions`).catch(()=>{});
    await db.query(`DELETE FROM ep_notes`).catch(()=>{});
    await db.query(`DELETE FROM ep_assignments`).catch(()=>{});
    await db.query(`DELETE FROM ep_counselors`).catch(()=>{});
    await db.query(`DELETE FROM ep_plans`).catch(()=>{});
    // Delete non-admin, non-demo users (test signups)
    await db.query(`DELETE FROM score_history WHERE user_id IN (SELECT id FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM essay_drafts WHERE user_id IN (SELECT id FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM colleges WHERE user_id IN (SELECT id FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM profiles WHERE user_id IN (SELECT id FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM student_settings WHERE user_id IN (SELECT id FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM student_journey WHERE user_id IN (SELECT id FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM users WHERE email NOT IN ('student1@admitly.com','student2@admitly.com','counselor1@admitly.com','counselor2@admitly.com','admin@admitly.com')`).catch(()=>{});
    // Also clean stale demo data
    await db.query(`DELETE FROM profiles WHERE user_id IN (SELECT id FROM users WHERE email IN ('student1@admitly.com','student2@admitly.com'))`).catch(()=>{});
    await db.query(`DELETE FROM student_settings WHERE user_id IN (SELECT id FROM users WHERE email IN ('student1@admitly.com','student2@admitly.com'))`).catch(()=>{});

    // ── Admin logs table ──
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id SERIAL PRIMARY KEY,
        level VARCHAR(10) NOT NULL DEFAULT 'info',
        source VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_logs_created ON admin_logs(created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_admin_logs_level ON admin_logs(level)`);

    // ── Email verification codes ──
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        verified BOOLEAN DEFAULT false,
        attempts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // SECURITY: purpose binds a code to a specific flow (signup / reset / change).
    // Previously any verified code for an email could be used to reset that
    // email's password within a 15-minute window.
    // Use inline try/catch here — safeDDL is only in scope inside ensureSchema.
    // The /api/email-verify route also ensures these columns on first hit,
    // so this block is belt-and-suspenders.
    try { await db.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) DEFAULT 'signup'`); } catch {}
    try { await db.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP`); } catch {}
    await db.query(`CREATE INDEX IF NOT EXISTS idx_evc_email ON email_verification_codes(email, created_at DESC)`);

    // ── Notification queue (batched email digests) ──
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type VARCHAR(30) NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        sent_at TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_nq_unsent ON notification_queue(user_id, sent_at) WHERE sent_at IS NULL`);

    // ── 5 Users: 2 students (premium), 2 counselors, 1 admin ──
    await db.query(`
      INSERT INTO users (email, name, password, role, subscription_status, subscription_expires_at, last_login) VALUES
        ('student1@admitly.com',   'Maya Patel',         '${hash}', 'student',   'pro', NOW() + INTERVAL '1 year', NOW()),
        ('student2@admitly.com',   'James Chen',         '${hash}', 'student',   'free', NULL, NOW()),
        ('counselor1@admitly.com', 'Dr. Sarah Mitchell', '${hash}', 'counselor', 'free', NULL, NOW()),
        ('counselor2@admitly.com', 'Dr. Robert Kim',     '${hash}', 'counselor', 'free', NULL, NOW()),
        ('admin@admitly.com',      'Ravi (Admin)',       '${hash}', 'admin',     'free', NULL, NOW())
      ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, subscription_status=EXCLUDED.subscription_status, subscription_expires_at=EXCLUDED.subscription_expires_at, password=EXCLUDED.password, is_locked=false
    `);

    // ── Student profiles (GPA, SAT scores) ──
    await db.query(`
      INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, leadership_roles, major_multiplier, is_ed, is_athlete, is_legacy, final_score)
      SELECT id, 3.4, 1420, NULL, 20, 6, 3, 2, 1.0, false, false, false, 62
      FROM users WHERE email = 'student1@admitly.com'
      ON CONFLICT (user_id) DO NOTHING
    `);
    await db.query(`
      INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, leadership_roles, major_multiplier, is_ed, is_athlete, is_legacy, final_score)
      SELECT id, 4.7, 1470, NULL, 22, 9, 2, 3, 1.1, false, false, false, 78
      FROM users WHERE email = 'student2@admitly.com'
      ON CONFLICT (user_id) DO NOTHING
    `);

    // ── Student settings ──
    await db.query(`
      INSERT INTO student_settings (user_id, high_school_name, high_school_city, high_school_state, graduation_year, intended_major, gpa_scale, allow_counselor_access)
      SELECT id, 'Phillips Academy', 'Andover', 'MA', 2026, 'Computer Science', '4.0', true
      FROM users WHERE email = 'student1@admitly.com'
      ON CONFLICT (user_id) DO NOTHING
    `);
    await db.query(`
      INSERT INTO student_settings (user_id, high_school_name, high_school_city, high_school_state, graduation_year, intended_major, gpa_scale, allow_counselor_access)
      SELECT id, 'Stuyvesant High School', 'New York', 'NY', 2026, 'Biomedical Engineering', '4.0', true
      FROM users WHERE email = 'student2@admitly.com'
      ON CONFLICT (user_id) DO NOTHING
    `);

    // ── 2 Counselor profiles ──
    await db.query(`
      INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability, hourly_rate_cents, status)
      SELECT id, 'Dr. Sarah Mitchell', 'Former Yale Admissions Officer',
             ARRAY['Ivy League','Essay Strategy','STEM Applications'], 200, 12,
             'Available weekdays, 2-6 PM EST', 7500, 'active'
      FROM users WHERE email = 'counselor1@admitly.com'
      ON CONFLICT (user_id) DO NOTHING
    `);
    await db.query(`
      INSERT INTO ep_counselors (user_id, display_name, title, specialties, total_students, years_experience, availability, hourly_rate_cents, status)
      SELECT id, 'Dr. Robert Kim', 'Stanford Admissions Consultant',
             ARRAY['Pre-Med','Liberal Arts','Interview Prep'], 150, 8,
             'Available Mon-Thu, 10 AM-4 PM PST', 9500, 'active'
      FROM users WHERE email = 'counselor2@admitly.com'
      ON CONFLICT (user_id) DO NOTHING
    `);

    // ── 2 Plans: Basic ($99, 1 session) and Full ($599, 3 sessions) ──
    await db.query(`DELETE FROM ep_plans`);
    await db.query(`
      INSERT INTO ep_plans (name, sessions, price_cents, session_duration_minutes, description, features, sort_order) VALUES
        ('Starter',    3, 19900, 45, 'Targeted help on 1–2 essays or a quick strategy check before deadlines.',
          ARRAY['3 video sessions (45 min each)','Essay review & detailed feedback','Personalized action items','Direct messaging with your counselor'], 1),
        ('Growth',     8, 49900, 45, 'Work through your full Common App — essays, college list, and application strategy.',
          ARRAY['8 video sessions (45 min each)','Full essay review across all applications','College list strategy & curation','Application timeline planning','Direct messaging between sessions'], 2),
        ('Full Cycle', 15, 89900, 60, 'End-to-end support from college list through submission — essays, interviews, and financial aid.',
          ARRAY['15 video sessions (60 min each)','Unlimited essay review & revision','Complete college list building','Interview preparation','Financial aid & scholarship strategy','Priority scheduling & support'], 3)
      ON CONFLICT (name) DO NOTHING
    `);

    // ── Assignments: Student1 → Counselor1 (Basic, 1/1 done), Student2 → Counselor2 (Full, 2/3 done) ──
    await db.query(`
      INSERT INTO ep_assignments (student_id, counselor_id, plan, sessions_total, sessions_used, status, start_date, end_date)
      SELECT
        (SELECT id FROM users WHERE email='student1@admitly.com'),
        (SELECT id FROM ep_counselors WHERE user_id=(SELECT id FROM users WHERE email='counselor1@admitly.com')),
        'Basic', 1, 1, 'completed', NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 days'

    `);

    // ── Completed sessions (past dates) for payment testing ──
    // Student1 → Counselor1: 1 completed session
    await db.query(`
      INSERT INTO ep_sessions (assignment_id, session_date, session_time, duration_min, status, topic, notes)
      SELECT a.id, (NOW() - INTERVAL '14 days')::date, '3:00 PM', 60, 'completed',
             'College list strategy & school selection',
             'Reviewed Maya''s profile (GPA 3.4, SAT 1420). Discussed reach/target/safety balance. Recommended adding 2 more target schools. Action: finalize list by next week.'
      FROM ep_assignments a
      JOIN users u ON u.id = a.student_id
      WHERE u.email = 'student1@admitly.com'
      ON CONFLICT DO NOTHING
    `);

    // Student2 → Counselor2: 2 completed sessions + 1 upcoming
    // ── Messages (recent conversation history) ──
    await db.query(`
      INSERT INTO ep_messages (assignment_id, sender_role, body, is_read, created_at)
      SELECT a.id, role, msg, true, ts FROM ep_assignments a
      JOIN users u ON u.id = a.student_id
      CROSS JOIN (VALUES
        ('counselor', 'Hi Maya! Looking forward to working with you. I''ve reviewed your profile — let''s discuss your college list strategy in our session.', NOW() - INTERVAL '16 days'),
        ('student', 'Thanks Dr. Mitchell! I''m nervous about my reach schools — my SAT is 1420 and I''m worried it''s not competitive enough.', NOW() - INTERVAL '16 days' + INTERVAL '2 hours'),
        ('counselor', 'A 1420 is solid for many excellent schools. We''ll identify where you''re strongest and build a balanced list. See you Thursday!', NOW() - INTERVAL '15 days'),
        ('student', 'The session was really helpful! I feel much better about my chances. Working on finalizing my list now.', NOW() - INTERVAL '13 days'),
        ('counselor', 'Great to hear! Remember to check the deadline dates for your EA schools — Nov 1 is coming up fast.', NOW() - INTERVAL '12 days')
      ) AS msgs(role, msg, ts)
      WHERE u.email = 'student1@admitly.com'
    `);
    // ── Action items ──
    await db.query(`
      INSERT INTO ep_actions (assignment_id, text, is_done, due_date, assigned_by, category)
      SELECT a.id, txt, done, due, role, cat FROM ep_assignments a
      JOIN users u ON u.id = a.student_id
      CROSS JOIN (VALUES
        ('Finalize college list (8-10 schools)', true,  (NOW() - INTERVAL '7 days')::date, 'counselor', 'Application'),
        ('Request teacher recommendations',      false, (NOW() + INTERVAL '7 days')::date,  'counselor', 'Application'),
        ('Complete Common App activities section', false, (NOW() + INTERVAL '14 days')::date, 'counselor', 'Application')
      ) AS acts(txt, done, due, role, cat)
      WHERE u.email = 'student1@admitly.com'
    `);

    // ── Session notes ──
    await db.query(`
      INSERT INTO ep_notes (assignment_id, title, content, author_role, is_pinned, category)
      SELECT a.id, title, content, role, pinned, cat FROM ep_assignments a
      JOIN users u ON u.id = a.student_id
      CROSS JOIN (VALUES
        ('Session 1 Recap', 'College List Strategy — Maya Patel\n\nProfile: GPA 3.4, SAT 1420, 6 APs, CS major\n\nRecommended list:\n- Reach: Brown, CMU, Georgetown\n- Target: BU, Northeastern, UMD\n- Safety: Penn State, UConn\n\nKey insight: Her robotics leadership (3 years, team captain) is her strongest differentiator. Essay should center on this.', 'counselor', true, 'Session Notes')
      ) AS notes(title, content, role, pinned, cat)
      WHERE u.email = 'student1@admitly.com'
    `);

    // ── Counselor payouts (1 paid, 1 pending — for admin earnings testing) ──
    // Counselor1 (Dr. Mitchell): 1 session done at $75/hr = $75 — already paid
    await db.query(`
      INSERT INTO counselor_payouts (counselor_id, assignment_id, amount_cents, hours, rate_cents, status, paid_at, notes)
      SELECT
        (SELECT id FROM ep_counselors WHERE user_id=(SELECT id FROM users WHERE email='counselor1@admitly.com')),
        (SELECT id FROM ep_assignments WHERE student_id=(SELECT id FROM users WHERE email='student1@admitly.com') LIMIT 1),
        7500, 1.0, 7500, 'paid', NOW() - INTERVAL '3 days', 'manual: Payout for Basic plan session with Maya Patel'
    `);

    // Counselor2 (Dr. Kim): 2 sessions done at $95/hr = $190 — not yet paid (balance owed)
    // (no payout record = balance shows in admin earnings tab)

    // ── Seed key dates (admissions calendar) ──
    await db.query(`DELETE FROM key_dates`).catch(()=>{});
    await db.query(`
      INSERT INTO key_dates (category, title, description, event_date, is_active) VALUES
        ('sat','SAT Test Date','College Board SAT','2026-05-02', true),
        ('sat','SAT Registration Deadline','Register by this date for May 2 test','2026-04-17', true),
        ('sat','SAT Test Date','College Board SAT','2026-06-06', true),
        ('sat','SAT Registration Deadline','Register by this date for Jun 6 test','2026-05-22', true),
        ('act','ACT Test Date','ACT National Test','2026-04-18', true),
        ('act','ACT Registration Deadline','Register by this date for Apr 18 test','2026-03-13', true),
        ('act','ACT Test Date','ACT National Test','2026-06-13', true),
        ('act','ACT Registration Deadline','Register by this date for Jun 13 test','2026-05-08', true),
        ('ap','AP Exams Begin','AP Exam window opens — check College Board for subject schedule','2026-05-04', true),
        ('ap','AP Exams End','AP Exam window closes','2026-05-15', true),
        ('fafsa','FAFSA Opens','Free Application for Federal Student Aid opens for 2027–28','2026-10-01', true),
        ('css','CSS Profile Opens','College Board CSS Profile opens for 2027–28','2026-10-01', true),
        ('general','Early Decision Deadline','Common early decision deadline for many schools','2026-11-01', true),
        ('general','Early Action Deadline','Common early action deadline for many schools','2026-11-01', true),
        ('general','Regular Decision Deadline','Most schools regular decision deadline','2027-01-01', true),
        ('general','FAFSA Priority Deadline','Priority filing date for maximum aid consideration','2027-02-01', true)
    `);

    // ── Seed admin logs ──
    await db.query(`
      INSERT INTO admin_logs (level, source, message, details, created_at) VALUES
        ('info', 'seed', 'Database seeded with test data including completed sessions and payment history', '{"students":2,"counselors":2,"admins":1,"plans":2,"assignments":2,"sessions":4,"messages":11,"actions":9,"notes":3,"payouts":1}', NOW())
    `);

    // ── Seed admin ↔ counselor messages ──
    const c1 = await db.query(`SELECT id FROM users WHERE email = 'counselor1@admitly.com'`);
    const c2 = await db.query(`SELECT id FROM users WHERE email = 'counselor2@admitly.com'`);
    if (c1.rows[0] && c2.rows[0]) {
      await db.query(`
        INSERT INTO admin_messages (counselor_user_id, sender_role, body, is_read, created_at) VALUES
          ($1, 'admin', 'Welcome to Admitly, Dr. Mitchell! You have been approved as a counselor. Let me know if you have any questions about the platform.', true, NOW() - INTERVAL '5 days'),
          ($1, 'counselor', 'Thank you! I have reviewed the dashboard. Quick question — how do I update my Zoom link for sessions?', true, NOW() - INTERVAL '5 days' + INTERVAL '2 hours'),
          ($1, 'admin', 'Go to Settings → Payment tab and you will see a Zoom Link field at the top of the Availability section. You can also set it per-session from the Expert Portal.', true, NOW() - INTERVAL '5 days' + INTERVAL '3 hours'),
          ($1, 'counselor', 'Found it, thanks! Also — can we discuss Maya Patel''s essay timeline? I think we need to extend her assignment by 2 sessions.', false, NOW() - INTERVAL '2 hours'),
          ($2, 'admin', 'Welcome aboard, Dr. Kim! You have two students assigned. Let me know if the workload works for your schedule.', true, NOW() - INTERVAL '3 days'),
          ($2, 'counselor', 'Thanks! The workload is fine. One question — student Marcus Williams missed his last session. What is the policy on missed sessions?', false, NOW() - INTERVAL '1 hour')
      `, [c1.rows[0].id, c2.rows[0].id]);
    }

    console.log('[db_schema] Test data seeded: 2 students, 2 counselors, 1 admin, 4 sessions (3 completed), 11 messages, 9 actions, 3 notes, 1 payout, 6 admin messages');
  } catch (err) {
    console.error('[db_schema] Seed failed (non-fatal):', err);
  }
}

/**
 * Ensures the discounted_price_cents column exists on ep_plans
 * (safe to call on existing DBs)
 */
export async function ensureDiscountColumn(): Promise<void> {
  const db = getPool();
  try {
    await db.query(`ALTER TABLE ep_plans ADD COLUMN IF NOT EXISTS discounted_price_cents INTEGER DEFAULT NULL`);
  } catch {}
}
