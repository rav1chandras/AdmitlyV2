import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const { role: rawRole, name: userName, phone, bio, years_experience, specialties } = await request.json();

    if (!['student', 'counselor'].includes(rawRole)) {
      return NextResponse.json({ error: 'Invalid role.' }, { status: 400 });
    }

    const pool = getPool();
    const userId = parseInt(session.user.id);
    const role = rawRole === 'counselor' ? 'pending_counselor' : 'student';
    const displayName = userName?.trim() || session.user.name || '';

    // Only allow role set if current role is 'needs_role'
    const { rows } = await pool.query(`SELECT role FROM users WHERE id=$1`, [userId]);
    if (!rows[0] || rows[0].role !== 'needs_role') {
      return NextResponse.json({ error: 'Role already set.' }, { status: 400 });
    }

    // Update role, name, and phone
    await pool.query(`UPDATE users SET role=$1, name=$2, phone=$3 WHERE id=$4`, [role, displayName, phone?.trim() || null, userId]);

    // Create counselor profile if applicable
    if (rawRole === 'counselor') {
      const specs = Array.isArray(specialties) ? specialties : (specialties || '').split(',').map((s: string) => s.trim()).filter(Boolean);
      await pool.query(
        `INSERT INTO ep_counselors (user_id, display_name, application_note, years_experience, specialties, applied_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (user_id) DO NOTHING`,
        [userId, displayName, bio || '', parseInt(years_experience) || 0, specs]
      );
      sendEmail.welcomeCounselor({ to: session.user.email!, name: displayName }).catch(() => {});
    } else {
      sendEmail.welcomeStudent({ to: session.user.email!, name: displayName }).catch(() => {});
    }

    return NextResponse.json({ ok: true, role, pending: rawRole === 'counselor' });
  } catch (err) {
    console.error('[set-role] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
