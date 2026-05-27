import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Pool } from 'pg';
import { sendEmail } from '@/lib/email';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.POSTGRES_URL, max: 5, idleTimeoutMillis: 30000 });
  return pool;
}

async function uid(email: string) {
  const r = await db().query('SELECT id FROM users WHERE email=$1', [email]);
  return r.rows[0]?.id ?? null;
}

async function getCounselorId(userId: number): Promise<number | null> {
  const r = await db().query('SELECT id FROM ep_counselors WHERE user_id=$1', [userId]);
  return r.rows[0]?.id ?? null;
}

async function verifyAssignment(counselorId: number, assignmentId: number): Promise<any> {
  const r = await db().query('SELECT * FROM ep_assignments WHERE id=$1 AND counselor_id=$2 AND status != $3', [assignmentId, counselorId, 'switched']);
  return r.rows[0] ?? null;
}

/**
 * SECURITY: Central authorization helper for expert-portal mutations.
 *
 * Given the session email and an assignment_id from a request body, resolve
 * the assignment and determine whether the caller is:
 *   - the counselor who owns it ('counselor')
 *   - the student in it ('student')
 *   - neither (→ returns null; caller should 403)
 *
 * Every POST/PATCH branch that touches ep_messages, ep_actions, ep_notes,
 * ep_sessions, or ep_assignments-adjacent rows MUST call this before writing.
 *
 * Returns { assignment, actorRole, userId, counselorId } on success,
 * or null if the caller is not a party to the assignment.
 */
async function authorizeAssignmentAccess(
  email: string,
  assignmentId: any
): Promise<{ assignment: any; actorRole: 'counselor' | 'student'; userId: number; counselorId: number | null } | null> {
  const aid = parseInt(String(assignmentId));
  if (!Number.isFinite(aid) || aid <= 0) return null;

  const userId = await uid(email);
  if (!userId) return null;

  // Fetch the assignment once
  const r = await db().query(
    `SELECT a.*, ec.user_id AS counselor_user_id
     FROM ep_assignments a
     JOIN ep_counselors ec ON ec.id = a.counselor_id
     WHERE a.id = $1 AND a.status != 'switched'`,
    [aid]
  );
  const assignment = r.rows[0];
  if (!assignment) return null;

  // Counselor path: the caller's user_id matches the counselor's user_id
  if (assignment.counselor_user_id === userId) {
    return { assignment, actorRole: 'counselor', userId, counselorId: assignment.counselor_id };
  }

  // Student path: the caller is the student in the assignment
  if (assignment.student_id === userId) {
    return { assignment, actorRole: 'student', userId, counselorId: null };
  }

  return null;
}

/**
 * SECURITY: Verify the caller owns the parent assignment of a specific row
 * (ep_messages, ep_actions, ep_notes, ep_sessions, essay_drafts via assignment_id).
 *
 * Used by PATCH branches that identify the target by row id rather than
 * assignment_id. Returns the authz context or null if unauthorized.
 */
async function authorizeRowAccess(
  email: string,
  table: 'ep_messages' | 'ep_actions' | 'ep_notes' | 'ep_sessions' | 'essay_drafts',
  rowId: any
): Promise<{ assignment: any; actorRole: 'counselor' | 'student'; userId: number; counselorId: number | null; row: any } | null> {
  const id = parseInt(String(rowId));
  if (!Number.isFinite(id) || id <= 0) return null;

  // Table name is whitelisted by the TypeScript literal union above — safe to interpolate
  const { rows } = await db().query(`SELECT * FROM ${table} WHERE id=$1`, [id]);
  const row = rows[0];
  if (!row || !row.assignment_id) return null;

  const ctx = await authorizeAssignmentAccess(email, row.assignment_id);
  if (!ctx) return null;
  return { ...ctx, row };
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = await uid(session.user.email);
  if (!userId) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const entity = req.nextUrl.searchParams.get('entity');
  const assignmentId = req.nextUrl.searchParams.get('assignment_id');
  const studentIdParam = req.nextUrl.searchParams.get('student_id');

  const counselorId = await getCounselorId(userId);

  // ── Student view: return their counselor(s) and assignment(s) ──
  if (!counselorId) {
    // Auto-complete past sessions for this student's assignments
    try {
      const completed = await db().query(`
        UPDATE ep_sessions SET status = 'completed'
        WHERE status = 'upcoming' AND session_date < CURRENT_DATE
          AND assignment_id IN (SELECT id FROM ep_assignments WHERE student_id = $1)
        RETURNING assignment_id
      `, [userId]);
      if (completed.rows.length > 0) {
        const affectedIds = Array.from(new Set(completed.rows.map((r: any) => r.assignment_id)));
        for (const aid of affectedIds) {
          const cnt = completed.rows.filter((r: any) => r.assignment_id === aid).length;
          await db().query('UPDATE ep_assignments SET sessions_used = sessions_used + $1 WHERE id = $2', [cnt, aid]);
        }
      }
    } catch {}

    // Auto-end assignments: sessions exhausted OR end_date passed
    try {
      const { rowCount } = await db().query(`
        UPDATE ep_assignments SET status = 'completed'
        WHERE student_id = $1
          AND status = 'active'
          AND (
            (sessions_used >= sessions_total AND sessions_total > 0)
            OR (end_date IS NOT NULL AND end_date < CURRENT_DATE)
          )
      `, [userId]);
      // If any assignments were auto-completed, check if student should revert to pro
      if (rowCount && rowCount > 0) {
        const { rows: remaining } = await db().query(
          `SELECT id FROM ep_assignments WHERE student_id = $1 AND status IN ('active','paused') LIMIT 1`, [userId]
        );
        if (remaining.length === 0) {
          await db().query(`UPDATE users SET subscription_status = 'pro' WHERE id = $1 AND subscription_status = 'premium'`, [userId]);
        }
      }
    } catch {}

    const assignRes = await db().query(`
      SELECT a.id AS assignment_id, a.plan, a.sessions_total, a.sessions_used, a.status, a.end_date, a.created_at,
             ec.id AS counselor_ep_id, ec.display_name, ec.title, ec.specialties,
             ec.total_students, ec.years_experience, ec.availability,
             u.email AS counselor_email,
             ep.description AS plan_description, ep.features AS plan_features,
             ep.session_duration_minutes AS plan_session_duration
      FROM ep_assignments a
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      JOIN users u ON u.id = ec.user_id
      LEFT JOIN ep_plans ep ON ep.name = a.plan
      WHERE a.student_id = $1 AND a.status NOT IN ('cancelled','switched')
      ORDER BY a.created_at DESC
    `, [userId]);

    if (!assignRes.rows.length) {
      // Check if student has a pending premium payment with no covering assignment
      let needsAssignment = false;
      try {
        const { rows: pmtRows } = await db().query(
          `SELECT created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'premium%' OR LOWER(plan_name) IN ('full cycle','essay only','starter')) ORDER BY created_at DESC LIMIT 1`,
          [userId]
        );
        if (pmtRows.length > 0) {
          // Has premium payment but no valid assignments at all
          needsAssignment = true;
        }
      } catch {}
      return NextResponse.json({ role: 'student', counselor: null, assignment: null, assignments: [], needsAssignment });
    }

    // Entity queries: use assignment_id param if provided, else first assignment
    const activeAid = assignmentId ? parseInt(assignmentId) : assignRes.rows[0].assignment_id;

    if (entity) {
      if (entity === 'messages') {
        const r = await db().query('SELECT * FROM ep_messages WHERE assignment_id=$1 ORDER BY created_at', [activeAid]);
        return NextResponse.json(r.rows);
      }
      if (entity === 'sessions') {
        const r = await db().query('SELECT * FROM ep_sessions WHERE assignment_id=$1 ORDER BY session_date DESC', [activeAid]);
        return NextResponse.json(r.rows);
      }
      if (entity === 'actions') {
        const r = await db().query('SELECT * FROM ep_actions WHERE assignment_id=$1 ORDER BY is_done, created_at DESC', [activeAid]);
        return NextResponse.json(r.rows);
      }
      if (entity === 'notes') {
        const r = await db().query('SELECT * FROM ep_notes WHERE assignment_id=$1 ORDER BY is_pinned DESC, updated_at DESC', [activeAid]);
        return NextResponse.json(r.rows);
      }
    }

    const primary = assignRes.rows[0];

    // Check if student has a pending premium payment not covered by any valid assignment
    let needsAssignment = false;
    try {
      const { rows: pmtRows } = await db().query(
        `SELECT created_at FROM payments WHERE user_id = $1 AND status = 'succeeded' AND (plan_id LIKE 'premium%' OR LOWER(plan_name) IN ('full cycle','essay only','starter')) ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (pmtRows.length > 0) {
        const paymentDate = new Date(pmtRows[0].created_at);
        // Check if any valid assignment (not cancelled) was created after this payment
        const validAssignAfterPayment = assignRes.rows.some((a: any) =>
          ['active','completed','pending_acceptance','paused'].includes(a.status) &&
          a.created_at && new Date(a.created_at) > paymentDate
        );
        if (!validAssignAfterPayment) needsAssignment = true;
      }
    } catch {}

    return NextResponse.json({
      role: 'student',
      needsAssignment,
      counselor: {
        name: primary.display_name,
        title: primary.title,
        initials: primary.display_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase(),
        specialties: primary.specialties || [],
        totalStudents: primary.total_students,
        yearsExp: primary.years_experience,
        availability: primary.availability,
      },
      assignment: {
        id: primary.assignment_id,
        plan: primary.plan,
        sessionsTotal: primary.sessions_total,
        sessionsUsed: primary.sessions_used,
        status: primary.status,
        endDate: primary.end_date || null,
        planDescription: primary.plan_description || '',
        planFeatures: primary.plan_features || [],
        planSessionDuration: primary.plan_session_duration || 60,
      },
      assignments: assignRes.rows.map((a: any) => ({
        id: a.assignment_id,
        plan: a.plan,
        sessionsTotal: a.sessions_total,
        sessionsUsed: a.sessions_used,
        status: a.status,
        endDate: a.end_date || null,
        counselorName: a.display_name,
        counselorTitle: a.title,
        counselorSpecialties: a.specialties || [],
        planDescription: a.plan_description || '',
        planFeatures: a.plan_features || [],
        planSessionDuration: a.plan_session_duration || 60,
      })),
    });
  }

  // ── Student Profile (read-only view of student's journey, settings, colleges, essays) ──
  if (entity === 'student_profile' && studentIdParam) {
    const sid = parseInt(studentIdParam);
    // Verify counselor has access to this student
    const access = await db().query('SELECT id FROM ep_assignments WHERE counselor_id=$1 AND student_id=$2 AND status != $3', [counselorId, sid, 'switched']);
    if (access.rows.length === 0) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Check if student has enabled data sharing
    const sharingRes = await db().query('SELECT allow_counselor_access FROM student_settings WHERE user_id=$1', [sid]);
    const sharingEnabled = sharingRes.rows[0]?.allow_counselor_access !== false; // default true

    if (!sharingEnabled) {
      return NextResponse.json({ restricted: true, message: 'Student has not enabled data sharing with counselors.' });
    }

    // Settings
    // Profile (gpa, sat, act, final_score)
    const profileRes = await db().query('SELECT gpa, sat, act, final_score FROM profiles WHERE user_id=$1', [sid]);

    const settingsRes = await db().query(`SELECT phone, parent_email, bio, high_school_name, high_school_city,
      high_school_state, graduation_year, intended_major, intended_major_alt, gpa_scale,
      counselor_name, counselor_email, app_round, target_school_count, preferred_location,
      preferred_size, financial_aid_needed FROM student_settings WHERE user_id=$1`, [sid]);

    // Journey
    const journeyRes = await db().query('SELECT activities, honors, experiences, identity, goals FROM student_journey WHERE user_id=$1', [sid]);

    // Colleges
    const collegesRes = await db().query(`SELECT c.name, c.bucket, c.accept_rate, c.sat_avg, c.tuition_in, c.tuition_out,
      cm.city, cm.state FROM colleges c LEFT JOIN colleges_master cm ON cm.ope6_id = c.master_id
      WHERE c.user_id=$1 ORDER BY c.bucket, c.name`, [sid]);

    // Essays
    const essaysRes = await db().query(`SELECT id, essay_type, college_name, topic, draft_text, word_count, prompt_source
      FROM essay_drafts WHERE user_id=$1 ORDER BY updated_at DESC`, [sid]);

    // Score history
    const scoresRes = await db().query(`SELECT score, saved_at FROM score_history WHERE user_id=$1 ORDER BY saved_at DESC LIMIT 5`, [sid]);

    return NextResponse.json({
      settings: settingsRes.rows[0] ?? null,
      profile: profileRes.rows[0] ?? null,
      journey: journeyRes.rows[0] ? { activities: journeyRes.rows[0].activities ?? [], honors: journeyRes.rows[0].honors ?? [], experiences: journeyRes.rows[0].experiences ?? [], identity: journeyRes.rows[0].identity ?? {}, goals: journeyRes.rows[0].goals ?? {} } : null,
      colleges: collegesRes.rows,
      essays: essaysRes.rows,
      scores: scoresRes.rows,
    });
  }

  // ── Entity data for a specific assignment ──
  if (entity && assignmentId) {
    const aid = parseInt(assignmentId);
    const assignment = await verifyAssignment(counselorId, aid);
    if (!assignment) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (entity === 'messages') {
      const r = await db().query('SELECT * FROM ep_messages WHERE assignment_id=$1 ORDER BY created_at', [aid]);
      return NextResponse.json(r.rows);
    }
    if (entity === 'sessions') {
      const r = await db().query('SELECT * FROM ep_sessions WHERE assignment_id=$1 ORDER BY session_date DESC', [aid]);
      return NextResponse.json(r.rows);
    }
    if (entity === 'actions') {
      const r = await db().query('SELECT * FROM ep_actions WHERE assignment_id=$1 ORDER BY is_done, created_at DESC', [aid]);
      return NextResponse.json(r.rows);
    }
    if (entity === 'notes') {
      const r = await db().query('SELECT * FROM ep_notes WHERE assignment_id=$1 ORDER BY is_pinned DESC, updated_at DESC', [aid]);
      return NextResponse.json(r.rows);
    }
    if (entity === 'shared_essays') {
      // Ensure assignment_id column exists
      await db().query('ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS assignment_id INTEGER DEFAULT NULL').catch(()=>{});
      // Return: student's shared essays (visible to all counselors)
      //       + expert reviews scoped to THIS assignment only
      const r = await db().query(
        `SELECT id, essay_type, college_name, topic, draft_text, word_count, status, expert_tag, source_essay_id, assignment_id, updated_at
         FROM essay_drafts
         WHERE user_id = $1
           AND shared_with_counselor = true
           AND (
             expert_tag IS NULL
             OR assignment_id = $2
           )
         ORDER BY updated_at DESC`,
        [assignment.student_id, aid]
      );
      return NextResponse.json(r.rows);
    }
  }

  // ── Auto-complete past sessions across all this counselor's assignments ──
  try {
    const completed = await db().query(`
      UPDATE ep_sessions SET status = 'completed'
      WHERE status = 'upcoming' AND session_date < CURRENT_DATE
        AND assignment_id IN (SELECT id FROM ep_assignments WHERE counselor_id = $1)
      RETURNING assignment_id
    `, [counselorId]);
    // Increment sessions_used for each affected assignment
    if (completed.rows.length > 0) {
      const affectedIds = Array.from(new Set(completed.rows.map((r: any) => r.assignment_id)));
      for (const aid of affectedIds) {
        const cnt = completed.rows.filter((r: any) => r.assignment_id === aid).length;
        await db().query('UPDATE ep_assignments SET sessions_used = sessions_used + $1 WHERE id = $2', [cnt, aid]);
      }
    }
  } catch (e: any) { console.warn('[expert-portal] auto-complete failed:', e.message); }

  // ── Auto-end assignments: sessions exhausted OR end_date passed ──
  try {
    await db().query(`
      UPDATE ep_assignments SET status = 'completed'
      WHERE counselor_id = $1
        AND status = 'active'
        AND (
          (sessions_used >= sessions_total AND sessions_total > 0)
          OR (end_date IS NOT NULL AND end_date < CURRENT_DATE)
        )
    `, [counselorId]);
  } catch {}

  // ── Default: counselor overview with all assignments ──
  const counselorRes = await db().query('SELECT * FROM ep_counselors WHERE id=$1', [counselorId]);
  const assignRes = await db().query(`
    SELECT a.*, u.name AS student_name, u.email AS student_email,
           u.last_login AS student_last_login,
           ss.high_school_name, ss.gpa_scale, ss.graduation_year,
           COALESCE(ss.allow_counselor_access, true) AS allow_counselor_access,
           p.gpa AS profile_gpa, p.sat AS profile_sat, p.act AS profile_act,
           ep.description AS plan_description, ep.features AS plan_features,
           ep.session_duration_minutes AS plan_session_duration,
           (SELECT COUNT(*) FROM ep_messages m WHERE m.assignment_id=a.id AND m.sender_role='student' AND NOT m.is_read) AS unread,
           (SELECT COUNT(*) FROM ep_actions ac WHERE ac.assignment_id=a.id AND NOT ac.is_done) AS pending_actions,
           (SELECT MAX(m.created_at) FROM ep_messages m WHERE m.assignment_id=a.id) AS last_message_at
    FROM ep_assignments a
    JOIN users u ON u.id = a.student_id
    LEFT JOIN student_settings ss ON ss.user_id = a.student_id
    LEFT JOIN profiles p ON p.user_id = a.student_id
    LEFT JOIN ep_plans ep ON ep.name = a.plan
    WHERE a.counselor_id = $1 AND a.status NOT IN ('switched')
    ORDER BY a.created_at
  `, [counselorId]);

  // Strip academic data when student has disabled sharing
  const sanitized = assignRes.rows.map((a: any) => {
    if (!a.allow_counselor_access) {
      return { ...a, high_school_name: null, gpa_scale: null, graduation_year: null, profile_gpa: null, profile_sat: null, profile_act: null };
    }
    return a;
  });

  return NextResponse.json({ counselor: counselorRes.rows[0], assignments: sanitized });
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { entity, assignment_id, ...data } = body;

  // SECURITY: Authorize against the assignment for every mutation.
  // Previously these branches blindly trusted assignment_id from the request
  // body, which allowed any authenticated user to write messages, actions,
  // notes, and sessions into any other counselor's assignment (impersonation,
  // phishing via emailed Zoom links, destructive writes).
  const ctx = await authorizeAssignmentAccess(session.user.email, assignment_id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (entity === 'message') {
    // SECURITY: sender_role is derived from the authenticated actor, not the
    // request body. Previously a student could post a message with
    // sender_role='counselor' and impersonate the counselor.
    const senderRole = ctx.actorRole;
    const r = await db().query(
      'INSERT INTO ep_messages (assignment_id, sender_role, body) VALUES ($1, $2, $3) RETURNING *',
      [ctx.assignment.id, senderRole, data.body]
    );
    // Queue notification for digest email (batched every 15 min)
    try {
      const asgn = await db().query(
        `SELECT a.student_id, a.counselor_id, u_s.name AS student_name,
                ec.display_name AS counselor_name, ec.user_id AS counselor_user_id
         FROM ep_assignments a
         JOIN users u_s ON u_s.id = a.student_id
         JOIN ep_counselors ec ON ec.id = a.counselor_id
         WHERE a.id = $1`, [ctx.assignment.id]
      );
      if (asgn.rows[0]) {
        const a = asgn.rows[0];
        const recipientId = senderRole === 'counselor' ? a.student_id : a.counselor_user_id;
        await db().query(
          `INSERT INTO notification_queue (user_id, type, data) VALUES ($1, 'message', $2)`,
          [recipientId, JSON.stringify({ sender_name: senderRole === 'counselor' ? a.counselor_name : a.student_name, sender_role: senderRole, preview: (data.body || '').slice(0, 200), assignment_id: ctx.assignment.id })]
        );
      }
    } catch {}
    return NextResponse.json(r.rows[0]);
  }

  if (entity === 'action') {
    // SECURITY: Only counselors can assign actions to students (the feature's
    // intent). assigned_by is set from the authenticated role, not the body.
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can create actions' }, { status: 403 });
    }
    const r = await db().query(
      'INSERT INTO ep_actions (assignment_id, text, due_date, assigned_by, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [ctx.assignment.id, data.text, data.due_date || null, 'counselor', data.category || 'Application']
    );
    // Queue notification for student
    try {
      const asgn = await db().query(
        `SELECT a.student_id, ec.display_name AS counselor_name
         FROM ep_assignments a JOIN ep_counselors ec ON ec.id = a.counselor_id WHERE a.id = $1`, [ctx.assignment.id]
      );
      if (asgn.rows[0]) {
        await db().query(
          `INSERT INTO notification_queue (user_id, type, data) VALUES ($1, 'action', $2)`,
          [asgn.rows[0].student_id, JSON.stringify({ text: data.text, due_date: data.due_date || 'No due date', assigned_by: asgn.rows[0].counselor_name, assignment_id: ctx.assignment.id })]
        );
      }
    } catch {}
    return NextResponse.json(r.rows[0]);
  }

  if (entity === 'note') {
    // SECURITY: Only counselors write session notes. author_role is derived
    // from the authenticated actor.
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can create notes' }, { status: 403 });
    }
    const r = await db().query(
      'INSERT INTO ep_notes (assignment_id, title, content, author_role, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [ctx.assignment.id, data.title || 'New Note', data.content || '', 'counselor', data.category || 'Session Notes']
    );
    return NextResponse.json(r.rows[0]);
  }

  if (entity === 'session') {
    // SECURITY: Only counselors book sessions.
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can book sessions' }, { status: 403 });
    }
    const r = await db().query(
      'INSERT INTO ep_sessions (assignment_id, session_date, session_time, duration_min, topic, zoom_link) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [ctx.assignment.id, data.session_date, data.session_time, data.duration_min || 60, data.topic || '', data.zoom_link || '']
    );
    // Queue session booking notification for student
    try {
      const asgn = await db().query(
        `SELECT a.student_id, ec.display_name AS counselor_name
         FROM ep_assignments a JOIN ep_counselors ec ON ec.id = a.counselor_id WHERE a.id = $1`, [ctx.assignment.id]
      );
      if (asgn.rows[0]) {
        const fmtDate = new Date(data.session_date).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
        await db().query(
          `INSERT INTO notification_queue (user_id, type, data) VALUES ($1, 'session_booked', $2)`,
          [asgn.rows[0].student_id, JSON.stringify({ counselor_name: asgn.rows[0].counselor_name, date: fmtDate, time: data.session_time, topic: data.topic || 'General', zoom_link: data.zoom_link, assignment_id: ctx.assignment.id })]
        );
      }
    } catch {}
    return NextResponse.json(r.rows[0]);
  }

  // Expert essay: counselor saves an edited version of the student's shared essay
  if (entity === 'expert_essay') {
    // Already authorized above via authorizeAssignmentAccess; must be counselor.
    if (ctx.actorRole !== 'counselor' || !ctx.counselorId) {
      return NextResponse.json({ error: 'Not a counselor' }, { status: 403 });
    }
    const assignment = ctx.assignment;
    const counselorId = ctx.counselorId;

    // Block if plan expired + 2 day grace period passed
    if (assignment.end_date) {
      const grace = new Date(new Date(assignment.end_date).getTime() + 2 * 86400000);
      if (assignment.status === 'completed' && new Date() > grace) {
        return NextResponse.json({ error: 'Plan ended — cannot create essays' }, { status: 403 });
      }
    }

    // Ensure assignment_id column exists on essay_drafts
    await db().query('ALTER TABLE essay_drafts ADD COLUMN IF NOT EXISTS assignment_id INTEGER DEFAULT NULL').catch(()=>{});

    // Get counselor display name for the expert_tag
    const cNameRes = await db().query('SELECT display_name FROM ep_counselors WHERE id=$1', [counselorId]);
    const cName = cNameRes.rows[0]?.display_name || '';
    const cShort = cName.split(' ').length > 1 ? `${cName.split(' ')[0]} ${cName.split(' ').slice(-1)[0][0]}.` : cName;

    // Enforce 1000 character limit
    const essayText = (data.draft_text || '').slice(0, 1000);
    const wordCount = essayText.trim().split(/\s+/).filter(Boolean).length;
    const r = await db().query(
      `INSERT INTO essay_drafts (user_id, essay_type, college_name, topic, draft_text, word_count, expert_tag, source_essay_id, shared_with_counselor, assignment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9) RETURNING *`,
      [
        assignment.student_id,
        data.essay_type || 'personal_statement',
        data.college_name || '',
        data.topic || '',
        essayText,
        wordCount,
        `Expert Review · ${cShort}`,
        data.source_essay_id || null,
        ctx.assignment.id,
      ]
    );
    return NextResponse.json(r.rows[0]);
  }

  return NextResponse.json({ error: 'Unknown entity' }, { status: 400 });
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { entity, id, ...data } = body;

  // SECURITY: Every row-id based mutation must verify the caller owns the
  // parent assignment. Previously these branches allowed any authenticated
  // user to delete/modify any counselor's rows by guessing IDs.

  if (entity === 'action' && id) {
    const ctx = await authorizeRowAccess(session.user.email, 'ep_actions', id);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Only counselors manage action items.
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can modify actions' }, { status: 403 });
    }
    if (data._delete) {
      await db().query('DELETE FROM ep_actions WHERE id=$1', [id]);
      return NextResponse.json({ ok: true });
    }
    if (data.toggle_done !== undefined) {
      const r = await db().query('UPDATE ep_actions SET is_done = NOT is_done WHERE id=$1 RETURNING *', [id]);
      return NextResponse.json(r.rows[0]);
    }
  }

  if (entity === 'essay' && id) {
    // Look up the essay and verify caller owns the parent assignment.
    // Only expert-reviewed essays (expert_tag set) are edited via this route.
    const essayRow = await db().query('SELECT * FROM essay_drafts WHERE id=$1 AND expert_tag IS NOT NULL', [id]);
    if (!essayRow.rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const essayAssignmentId = essayRow.rows[0].assignment_id;
    if (!essayAssignmentId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const ctx = await authorizeAssignmentAccess(session.user.email, essayAssignmentId);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Only counselors edit expert essays.
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can modify expert essays' }, { status: 403 });
    }

    // Grace period: block edits after plan end_date + 2 days.
    if (ctx.assignment.end_date && ctx.assignment.status === 'completed') {
      const grace = new Date(new Date(ctx.assignment.end_date).getTime() + 2 * 86400000);
      if (new Date() > grace) return NextResponse.json({ error: 'Plan ended — cannot edit essays' }, { status: 403 });
    }

    if (data._delete) {
      await db().query('DELETE FROM essay_drafts WHERE id=$1 AND expert_tag IS NOT NULL', [id]);
      return NextResponse.json({ ok: true });
    }
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (data.draft_text !== undefined) {
      const txt = (data.draft_text || '').slice(0, 1000);
      sets.push(`draft_text=$${i++}`); vals.push(txt);
      const wc = txt.trim().split(/\s+/).filter(Boolean).length;
      sets.push(`word_count=$${i++}`); vals.push(wc);
    }
    if (data.topic !== undefined) { sets.push(`topic=$${i++}`); vals.push(data.topic); }
    if (sets.length > 0) {
      sets.push(`updated_at=CURRENT_TIMESTAMP`);
      vals.push(id);
      const r = await db().query(`UPDATE essay_drafts SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
      return NextResponse.json(r.rows[0]);
    }
  }

  if (entity === 'note' && id) {
    const ctx = await authorizeRowAccess(session.user.email, 'ep_notes', id);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Only counselors manage notes.
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can modify notes' }, { status: 403 });
    }
    if (data._delete) {
      await db().query('DELETE FROM ep_notes WHERE id=$1', [id]);
      return NextResponse.json({ ok: true });
    }
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    if (data.title !== undefined) { sets.push(`title=$${i++}`); vals.push(data.title); }
    if (data.content !== undefined) { sets.push(`content=$${i++}`); vals.push(data.content); }
    if (data.is_pinned !== undefined) { sets.push(`is_pinned=$${i++}`); vals.push(data.is_pinned); }
    sets.push(`updated_at=CURRENT_TIMESTAMP`);
    vals.push(id);
    const r = await db().query(`UPDATE ep_notes SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
    return NextResponse.json(r.rows[0]);
  }

  if (entity === 'session' && id) {
    const ctx = await authorizeRowAccess(session.user.email, 'ep_sessions', id);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Only counselors modify sessions (reschedule / status change).
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can modify sessions' }, { status: 403 });
    }

    if (data.status) {
      const r = await db().query('UPDATE ep_sessions SET status=$1 WHERE id=$2 RETURNING *', [data.status, id]);
      if (data.status === 'completed' && r.rows[0]?.assignment_id) {
        const aid = r.rows[0].assignment_id;
        await db().query(
          'UPDATE ep_assignments SET sessions_used = sessions_used + 1 WHERE id = $1 AND sessions_used < sessions_total',
          [aid]
        ).catch(() => {});
        await db().query(
          `UPDATE ep_assignments SET status = 'completed'
           WHERE id = $1 AND status = 'active'
             AND sessions_used >= sessions_total AND sessions_total > 0`,
          [aid]
        ).catch(() => {});
        // Queue session completed notification for student
        try {
          const asgn = await db().query(
            `SELECT a.student_id, ec.display_name AS counselor_name
             FROM ep_assignments a JOIN ep_counselors ec ON ec.id = a.counselor_id WHERE a.id = $1`, [aid]
          );
          if (asgn.rows[0]) {
            await db().query(
              `INSERT INTO notification_queue (user_id, type, data) VALUES ($1, 'session_completed', $2)`,
              [asgn.rows[0].student_id, JSON.stringify({ counselor_name: asgn.rows[0].counselor_name, topic: r.rows[0].topic || 'Session', date: new Date(r.rows[0].session_date).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' }), assignment_id: aid })]
            );
          }
        } catch {}
      }
      if (data.status === 'cancelled' && r.rows[0]?.assignment_id) {
        // Send cancellation emails to both parties
        try {
          const aid = r.rows[0].assignment_id;
          const asgn = await db().query(
            `SELECT u_s.email AS student_email, u_s.name AS student_name,
                    ec.display_name AS counselor_name, u_c.email AS counselor_email
             FROM ep_assignments a JOIN users u_s ON u_s.id = a.student_id
             JOIN ep_counselors ec ON ec.id = a.counselor_id
             JOIN users u_c ON u_c.id = ec.user_id WHERE a.id = $1`, [aid]
          );
          if (asgn.rows[0]) {
            const a = asgn.rows[0];
            const fmtDate = new Date(r.rows[0].session_date).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
            sendEmail.sessionCancelled({ to: a.student_email, name: a.student_name, otherName: a.counselor_name, otherRole: 'Counselor', date: fmtDate, time: r.rows[0].session_time, topic: r.rows[0].topic || 'Session', reason: data.cancel_reason }).catch(() => {});
            sendEmail.sessionCancelled({ to: a.counselor_email, name: a.counselor_name, otherName: a.student_name, otherRole: 'Student', date: fmtDate, time: r.rows[0].session_time, topic: r.rows[0].topic || 'Session', reason: data.cancel_reason }).catch(() => {});
          }
        } catch {}
      }
      return NextResponse.json(r.rows[0]);
    }
    // Edit session fields (date, time, topic, zoom_link, duration)
    if (data.session_date || data.session_time || data.topic || data.zoom_link !== undefined || data.duration_min) {
      const sets: string[] = [];
      const vals: any[] = [];
      let i = 1;
      if (data.session_date) { sets.push(`session_date=$${i++}`); vals.push(data.session_date); }
      if (data.session_time) { sets.push(`session_time=$${i++}`); vals.push(data.session_time); }
      if (data.topic) { sets.push(`topic=$${i++}`); vals.push(data.topic); }
      if (data.zoom_link !== undefined) { sets.push(`zoom_link=$${i++}`); vals.push(data.zoom_link); }
      if (data.duration_min) { sets.push(`duration_min=$${i++}`); vals.push(data.duration_min); }
      if (sets.length > 0) {
        vals.push(id);
        const r = await db().query(`UPDATE ep_sessions SET ${sets.join(',')} WHERE id=$${i} RETURNING *`, vals);
        return NextResponse.json(r.rows[0]);
      }
    }
  }

  if (entity === 'messages_read') {
    // Authorize against the assignment and only allow the counterparty
    // (counselor marking student-sent messages read) — the original behavior.
    const ctx = await authorizeAssignmentAccess(session.user.email, data.assignment_id);
    if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (ctx.actorRole !== 'counselor') {
      return NextResponse.json({ error: 'Only counselors can mark student messages read' }, { status: 403 });
    }
    await db().query('UPDATE ep_messages SET is_read=true WHERE assignment_id=$1 AND sender_role=$2', [ctx.assignment.id, 'student']);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown entity' }, { status: 400 });
}
