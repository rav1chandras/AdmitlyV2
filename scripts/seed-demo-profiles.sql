-- ═══════════════════════════════════════════════════════════════
--  Seed demo profile data for the Profile Builder mockup walkthrough.
--
--  Populates `profiles`, `student_settings`, `student_activities`, and
--  `personal_stories` for the two seeded students so the redesigned
--  /profile page shows fully-filled content out of the box.
--
--    student1@example.com  → STEM / CS-oriented profile (Maya-equivalent)
--    student2@example.com  → Liberal arts / humanities profile (James-equivalent)
--
--  Safe to re-run: each block clears the user's prior rows first.
--  Run on local Docker:
--    docker compose exec -T postgres psql -U admitly -d college_planner < scripts/seed-demo-profiles.sql
-- ═══════════════════════════════════════════════════════════════

-- ─── STUDENT 1: STEM / CS profile ────────────────────────────────
DO $$
DECLARE
  v_user_id INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE email = 'student1@example.com';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'student1@example.com not found — skipping';
    RETURN;
  END IF;

  -- Profile
  INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, leadership_roles, major_multiplier, final_score)
  VALUES (v_user_id, 3.92, 1510, 33, 20, 8, 2, 3, 0.85, 86)
  ON CONFLICT (user_id) DO UPDATE SET
    gpa = EXCLUDED.gpa, sat = EXCLUDED.sat, act = EXCLUDED.act,
    ap_offered = EXCLUDED.ap_offered, ap_taken = EXCLUDED.ap_taken,
    ec_tier = EXCLUDED.ec_tier, leadership_roles = EXCLUDED.leadership_roles,
    major_multiplier = EXCLUDED.major_multiplier, final_score = EXCLUDED.final_score;

  -- Settings — fully populate so /profile cards render with real values
  INSERT INTO student_settings (
    user_id, phone, parent_email, bio,
    high_school_name, high_school_city, high_school_state, graduation_year,
    intended_major, intended_major_alt, gpa_scale,
    app_round, target_school_count, preferred_location, preferred_size,
    financial_aid_needed, email_reminders, deadline_alerts, weekly_summary
  ) VALUES (
    v_user_id, '+1-415-555-0142', 'parents@example.com',
    'Junior at Lincoln HS heading into senior year. Passionate about ML, debate, and music.',
    'Lincoln High School', 'Palo Alto', 'CA', 2026,
    'Computer Science', 'Data Science', '4.0',
    'Early Decision', 10, 'West Coast', 'Medium',
    true, true, true, true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    phone               = EXCLUDED.phone,
    bio                 = EXCLUDED.bio,
    high_school_name    = EXCLUDED.high_school_name,
    high_school_city    = EXCLUDED.high_school_city,
    high_school_state   = EXCLUDED.high_school_state,
    graduation_year     = EXCLUDED.graduation_year,
    intended_major      = EXCLUDED.intended_major,
    intended_major_alt  = EXCLUDED.intended_major_alt,
    app_round           = EXCLUDED.app_round,
    target_school_count = EXCLUDED.target_school_count,
    preferred_location  = EXCLUDED.preferred_location,
    preferred_size      = EXCLUDED.preferred_size;

  -- Upgrade to Pro so all gated pages light up
  UPDATE users SET
    subscription_status = 'pro',
    subscription_expires_at = NOW() + INTERVAL '1 year',
    last_login = NOW()
  WHERE id = v_user_id;

  -- Clear & re-insert activities
  DELETE FROM student_activities WHERE user_id = v_user_id;
  INSERT INTO student_activities (user_id, name, category, role, hours_per_week, start_grade, end_grade, is_current, description, sort_order) VALUES
    (v_user_id, 'Debate Club',              'leadership', 'Captain',         6, 10, NULL, TRUE,  'Led varsity debate team to state semifinals. Coordinate weekly practice and tournament logistics.', 0),
    (v_user_id, 'Food Bank Volunteer',      'community',  'Shift lead',      4, 9,  NULL, TRUE,  'Coordinate Saturday food distribution for 200+ families. Trained 12 new volunteers this year.',     1),
    (v_user_id, 'Piano & Composition',      'arts',       'Performer',       3, 9,  NULL, TRUE,  'Compose original pieces. Performed in 2 school recitals; awarded state composition prize 2024.',    2),
    (v_user_id, 'CS Research Internship',   'academic',   'Research intern', 8, 11, NULL, TRUE,  'Built an ML model for protein folding under Dr. Lee at State University. Co-author on workshop paper.', 3),
    (v_user_id, 'Math Olympiad Team',       'academic',   'Team member',     5, 10, NULL, TRUE,  'AMC 10 honor roll. Competed in regional Math Olympiad.',                                           4),
    (v_user_id, 'Hackathon Mentor',         'leadership', 'Mentor',          3, 11, NULL, TRUE,  'Mentor middle schoolers in a 6-week intro-to-code program. Built curriculum from scratch.',         5);

  -- Clear & re-insert stories
  DELETE FROM personal_stories WHERE user_id = v_user_id;
  INSERT INTO personal_stories (user_id, title, summary, grade, theme_tags, sort_order) VALUES
    (v_user_id, 'Overcoming stage fright',
     'Stuttered through my first debate round in 10th grade and nearly quit. Two years later I''m team captain and run the new-member training. The shift came from realising the audience was rooting for me, not judging me.',
     10, ARRAY['resilience','growth','leadership'], 0),
    (v_user_id, 'First in my family',
     'My parents emigrated with no English. Watching them learn alongside me — them at night classes, me with AP Lit — taught me that learning is a lifelong act, not a teenage chore. I started a study group at our community center for first-gen kids.',
     11, ARRAY['identity','family','community'], 1),
    (v_user_id, 'Taking care of mom',
     'When my mom had surgery during junior year, I learned to balance grocery runs, sibling pickups, and AP Chem at 5am. The grades didn''t slip, but more importantly I learned how much my family relies on me.',
     11, ARRAY['family','responsibility','resilience'], 2),
    (v_user_id, 'The protein folding bug',
     'Spent three weeks debugging a single matrix dimension mismatch in our research code. My PI didn''t tell me where the bug was; she let me find it. That hunt taught me more about ML than any class.',
     11, ARRAY['curiosity','research','perseverance'], 3);

  -- Wipe any stale analysis so users can re-run with new data
  DELETE FROM profile_analysis WHERE user_id = v_user_id;

  -- Score history — 8 weekly snapshots showing growth
  DELETE FROM score_history WHERE user_id = v_user_id;
  INSERT INTO score_history (user_id, score, saved_at) VALUES
    (v_user_id, 68, NOW() - INTERVAL '8 weeks'),
    (v_user_id, 71, NOW() - INTERVAL '7 weeks'),
    (v_user_id, 74, NOW() - INTERVAL '6 weeks'),
    (v_user_id, 76, NOW() - INTERVAL '5 weeks'),
    (v_user_id, 79, NOW() - INTERVAL '4 weeks'),
    (v_user_id, 82, NOW() - INTERVAL '3 weeks'),
    (v_user_id, 84, NOW() - INTERVAL '2 weeks'),
    (v_user_id, 86, NOW() - INTERVAL '1 week');

  -- Saved colleges (uses colleges_master if loaded; otherwise raw names)
  DELETE FROM colleges WHERE user_id = v_user_id;
  -- Reach
  INSERT INTO colleges (user_id, name, bucket, master_id, created_at)
  SELECT v_user_id, cm.name, 'Reach', cm.ope6_id, NOW() - INTERVAL '20 days'
  FROM colleges_master cm
  WHERE cm.name IN ('Massachusetts Institute of Technology','Stanford University','Carnegie Mellon University','University of California-Berkeley')
  ON CONFLICT DO NOTHING;
  -- Target
  INSERT INTO colleges (user_id, name, bucket, master_id, created_at)
  SELECT v_user_id, cm.name, 'Target', cm.ope6_id, NOW() - INTERVAL '15 days'
  FROM colleges_master cm
  WHERE cm.name IN ('University of California-Los Angeles','University of Michigan-Ann Arbor','Georgia Institute of Technology-Main Campus','University of Washington-Seattle Campus')
  ON CONFLICT DO NOTHING;
  -- Safety
  INSERT INTO colleges (user_id, name, bucket, master_id, created_at)
  SELECT v_user_id, cm.name, 'Safety', cm.ope6_id, NOW() - INTERVAL '10 days'
  FROM colleges_master cm
  WHERE cm.name IN ('San Jose State University','California State University-Long Beach','University of California-Riverside')
  ON CONFLICT DO NOTHING;

  -- Essay drafts (2 — Personal Statement + Why us)
  DELETE FROM essay_drafts WHERE user_id = v_user_id;
  INSERT INTO essay_drafts (user_id, essay_type, college_name, topic, draft_text, word_count, prompt_source, audience, status)
  VALUES
    (v_user_id, 'personal_statement', NULL, 'How my grandmother''s typewriter taught me to listen',
     'In the corner of our living room sits a Smith Corona that crossed the Pacific in 1972 with my grandmother. Every Tuesday she would teach me a new word in Tagalog while the keys clacked through her letters home...',
     312, 'Common App', 'Admissions Officer', 'draft'),
    (v_user_id, 'why_school', 'Stanford University', 'Why Stanford CS',
     'Stanford''s Symbolic Systems program sits at the intersection of the two questions that have driven my high school years: how do machines learn, and how do humans?...',
     128, 'Stanford supplement', 'Admissions Officer', 'draft');

  RAISE NOTICE 'Seeded student1 (user_id=%) with full Pro profile + activities + stories + score history + colleges + essays.', v_user_id;
END $$;


-- ─── STUDENT 2: Liberal arts / humanities profile ────────────────
DO $$
DECLARE
  v_user_id INTEGER;
BEGIN
  SELECT id INTO v_user_id FROM users WHERE email = 'student2@example.com';
  IF v_user_id IS NULL THEN
    RAISE NOTICE 'student2@example.com not found — skipping';
    RETURN;
  END IF;

  -- Profile (slightly different academic shape — humanities tilt)
  INSERT INTO profiles (user_id, gpa, sat, act, ap_offered, ap_taken, ec_tier, leadership_roles, major_multiplier, final_score)
  VALUES (v_user_id, 4.10, 1470, 32, 18, 6, 2, 4, 1.0, 81)
  ON CONFLICT (user_id) DO UPDATE SET
    gpa = EXCLUDED.gpa, sat = EXCLUDED.sat, act = EXCLUDED.act,
    ap_offered = EXCLUDED.ap_offered, ap_taken = EXCLUDED.ap_taken,
    ec_tier = EXCLUDED.ec_tier, leadership_roles = EXCLUDED.leadership_roles,
    major_multiplier = EXCLUDED.major_multiplier, final_score = EXCLUDED.final_score;

  INSERT INTO student_settings (
    user_id, phone, bio,
    high_school_name, high_school_city, high_school_state, graduation_year,
    intended_major, intended_major_alt, gpa_scale,
    app_round, target_school_count, preferred_location, preferred_size,
    financial_aid_needed, email_reminders
  ) VALUES (
    v_user_id, '+1-617-555-0119',
    'Junior at Cambridge Latin. Editor-in-chief of the school paper. Mock trial state champion.',
    'Cambridge Latin School', 'Cambridge', 'MA', 2026,
    'English Literature', 'History', '4.0',
    'Regular Decision', 8, 'East Coast', 'Small',
    false, true
  )
  ON CONFLICT (user_id) DO UPDATE SET
    phone               = EXCLUDED.phone,
    bio                 = EXCLUDED.bio,
    high_school_name    = EXCLUDED.high_school_name,
    high_school_city    = EXCLUDED.high_school_city,
    high_school_state   = EXCLUDED.high_school_state,
    graduation_year     = EXCLUDED.graduation_year,
    intended_major      = EXCLUDED.intended_major,
    intended_major_alt  = EXCLUDED.intended_major_alt;

  UPDATE users SET subscription_status = 'free', last_login = NOW() WHERE id = v_user_id;

  DELETE FROM student_activities WHERE user_id = v_user_id;
  INSERT INTO student_activities (user_id, name, category, role, hours_per_week, start_grade, end_grade, is_current, description, sort_order) VALUES
    (v_user_id, 'School Newspaper',         'leadership', 'Editor-in-chief', 8, 10, NULL, TRUE,  'Lead a 24-person staff. Doubled monthly readership to 1,800 students via a digital revamp.',        0),
    (v_user_id, 'Mock Trial',               'leadership', 'Lead attorney',   5, 9,  NULL, TRUE,  'State champions junior year. Argued opening and closing for the prosecution team.',                1),
    (v_user_id, 'Library Tutor',            'community',  'Tutor',           4, 9,  NULL, TRUE,  'Tutor middle schoolers in reading + writing at the public library every Saturday.',                2),
    (v_user_id, 'Theater Productions',      'arts',       'Lead actor',      6, 9,  NULL, TRUE,  'Lead roles in three school productions. Self-produced a one-act festival of student plays.',         3),
    (v_user_id, 'Poetry Slam Club',         'arts',       'Founder',         3, 11, NULL, TRUE,  'Founded the school''s first poetry slam. Now 28 members; published a spring chapbook.',           4),
    (v_user_id, 'Summer Bookstore Job',     'work',       'Sales associate', 12, 10, NULL, TRUE, 'Buy used inventory, recommend books to customers, curate the staff-picks shelf.',                  5);

  DELETE FROM personal_stories WHERE user_id = v_user_id;
  INSERT INTO personal_stories (user_id, title, summary, grade, theme_tags, sort_order) VALUES
    (v_user_id, 'The book that changed everything',
     'A used copy of Beloved by Toni Morrison sat on my dad''s shelf for years. The summer before 10th grade I finally read it. I''ve never read the same way since — for craft, for the politics of who gets to tell whose story.',
     10, ARRAY['identity','reading','craft'], 0),
    (v_user_id, 'Closing argument',
     'I lost a regional mock trial round on a technicality I should have caught. I spent a month studying our state''s evidence code, then won state two years later on a related motion. Losing taught me what winning could not.',
     11, ARRAY['perseverance','craft','growth'], 1),
    (v_user_id, 'Stage fright at the lectern',
     'Forgot my lines opening night of Romeo & Juliet sophomore year. Improvised the next four lines in iambic pentameter. The audience never knew. Theater taught me to trust that I''ve already done the work.',
     10, ARRAY['resilience','arts','growth'], 2),
    (v_user_id, 'My grandmother''s typewriter',
     'My grandmother brought her Smith Corona from Manila in 1972. She wrote letters back home every week for 40 years. I started using it senior year — every poem I publish is typed on her keys first.',
     12, ARRAY['family','identity','craft'], 3);

  DELETE FROM profile_analysis WHERE user_id = v_user_id;

  RAISE NOTICE 'Seeded student2 (user_id=%) with 6 activities + 4 stories.', v_user_id;
END $$;
