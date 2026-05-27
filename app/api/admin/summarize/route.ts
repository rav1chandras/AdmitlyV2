import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { isAdmin } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { date_from, date_to, assignment_id } = await request.json();
  const pool = getPool();

  try {
    // SECURITY: Validate/coerce inputs and use parameterized queries.
    // Previously this built SQL via string interpolation, which was a SQL
    // injection vector (admin-gated, but still unacceptable).
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const validFrom = typeof date_from === 'string' && ISO_DATE.test(date_from) ? date_from : null;
    const validTo   = typeof date_to   === 'string' && ISO_DATE.test(date_to)   ? date_to   : null;
    const validAssignmentId = assignment_id && assignment_id !== 'all'
      ? (Number.isFinite(parseInt(assignment_id)) ? parseInt(assignment_id) : null)
      : null;

    // Build a WHERE clause template with a column-name placeholder we replace
    // per query (column name only — never user input). Params go through pg.
    const buildFilter = (tsCol: string, assignCol: string, startIdx: number): { sql: string; params: any[] } => {
      const parts: string[] = [];
      const params: any[] = [];
      let i = startIdx;
      if (validFrom) {
        parts.push(`AND ${tsCol} >= $${i++}`);
        params.push(validFrom);
      }
      if (validTo) {
        parts.push(`AND ${tsCol} <= $${i++}`);
        params.push(validTo + 'T23:59:59');
      }
      if (validAssignmentId !== null) {
        parts.push(`AND ${assignCol} = $${i++}`);
        params.push(validAssignmentId);
      }
      return { sql: parts.join(' '), params };
    };

    // Get messages
    const mf = buildFilter('m.created_at', 'm.assignment_id', 1);
    const { rows: messages } = await pool.query(`
      SELECT m.sender_role, m.body, m.created_at,
             u_s.name AS student_name, ec.display_name AS counselor_name
      FROM ep_messages m
      JOIN ep_assignments a ON a.id = m.assignment_id
      JOIN users u_s ON u_s.id = a.student_id
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      WHERE 1=1 ${mf.sql}
      ORDER BY m.created_at ASC
      LIMIT 200
    `, mf.params);

    // Get actions
    const af = buildFilter('ac.created_at', 'ac.assignment_id', 1);
    const { rows: actions } = await pool.query(`
      SELECT ac.text, ac.is_done, ac.assigned_by, ac.created_at,
             u_s.name AS student_name, ec.display_name AS counselor_name
      FROM ep_actions ac
      JOIN ep_assignments a ON a.id = ac.assignment_id
      JOIN users u_s ON u_s.id = a.student_id
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      WHERE 1=1 ${af.sql}
      ORDER BY ac.created_at ASC
    `, af.params);

    // Get sessions
    const sf = buildFilter('s.created_at', 's.assignment_id', 1);
    const { rows: sessions } = await pool.query(`
      SELECT s.topic, s.status, s.session_date, s.session_time,
             u_s.name AS student_name, ec.display_name AS counselor_name
      FROM ep_sessions s
      JOIN ep_assignments a ON a.id = s.assignment_id
      JOIN users u_s ON u_s.id = a.student_id
      JOIN ep_counselors ec ON ec.id = a.counselor_id
      WHERE 1=1 ${sf.sql}
      ORDER BY s.created_at ASC
    `, sf.params);

    if (messages.length === 0 && actions.length === 0 && sessions.length === 0) {
      return NextResponse.json({ summary: 'No activity found for the selected date range.' });
    }

    // Build prompt
    const msgText = messages.map(m =>
      `[${new Date(m.created_at).toLocaleDateString()}] ${m.sender_role === 'counselor' ? m.counselor_name : m.student_name}: ${m.body}`
    ).join('\n');

    const actionText = actions.map(a =>
      `[${a.is_done ? 'DONE' : 'PENDING'}] ${a.text} (assigned by ${a.assigned_by})`
    ).join('\n');

    const sessionText = sessions.map(s =>
      `[${s.status}] ${s.topic} — ${s.session_date} ${s.session_time || ''} (${s.student_name} + ${s.counselor_name})`
    ).join('\n');

    const prompt = `You are an admin reviewing counselor-student interactions on a college admissions platform. Summarize the following activity by category. Flag any concerning patterns, personal information sharing (phone numbers, emails, SSNs, addresses), or policy violations.

MESSAGES (${messages.length}):
${msgText || 'None'}

ACTION ITEMS (${actions.length}):
${actionText || 'None'}

SESSIONS (${sessions.length}):
${sessionText || 'None'}

Provide a concise summary with these sections:
1. **Overview** — what happened during this period
2. **Key Topics Discussed** — main themes from messages
3. **Progress** — action items completed vs pending, sessions held
4. **PII Flags** — any personal information detected (phone, email, SSN, addresses)
5. **Concerns** — any red flags or policy issues`;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'sk-your-openai-api-key-here') {
      return NextResponse.json({ summary: `AI summary unavailable (OpenAI not configured).\n\nActivity stats:\n- ${messages.length} messages\n- ${actions.length} action items\n- ${sessions.length} sessions` });
    }

    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = completion.choices[0]?.message?.content || 'No summary generated.';
    return NextResponse.json({ summary });
  } catch (err: any) {
    console.error('[Admin summarize]', err.message);
    return NextResponse.json({ summary: `Error generating summary: ${err.message}` });
  }
}
