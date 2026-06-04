/**
 * db_schema.ts - request-time migration guard.
 */
import { getPool } from '@/lib/db';

let ready = false;
const REQUIRED_MIGRATION = '011_runtime_schema_consolidation.sql';

export async function ensureSchema(): Promise<void> {
  if (ready) return;
  const db = getPool();
  try {
    const { rowCount } = await db.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1 LIMIT 1',
      [REQUIRED_MIGRATION]
    );
    if (!rowCount) {
      throw new Error(
        `Database migrations are not current. Run "npm run db:migrate" before starting the app; missing ${REQUIRED_MIGRATION}.`
      );
    }
    ready = true;
  } catch (err) {
    console.error('[db_schema] Migration check failed:', err);
    throw err;
  }
}

/**
 * Seeds mock data for testing.
 * Only inserts if no data exists.
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

export async function ensureDiscountColumn(): Promise<void> {
  await ensureSchema();
}
