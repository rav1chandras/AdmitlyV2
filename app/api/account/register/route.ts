import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createUser, getUserByEmail, getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';
import { sendEmail } from '@/lib/email';
import { validateEmail, validatePassword } from '@/lib/auth-validation';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const { name, email, password, grad_year, role: rawRole, phone, bio, years_experience, specialties } = await request.json();
    // Counselors enter as pending — admin must approve before they get full access
    const role = rawRole === 'counselor' ? 'pending_counselor' : 'student';

    if (!name?.trim() || !email?.trim() || !password) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
    }
    // Email domain allowlist
    const emailCheck = validateEmail(email);
    if (!emailCheck.ok) {
      return NextResponse.json({ error: emailCheck.error }, { status: 400 });
    }
    // Password strength
    const pwCheck = validatePassword(password);
    if (!pwCheck.ok) {
      return NextResponse.json({ error: pwCheck.error }, { status: 400 });
    }

    // Age gate removed — students handle graduation year in settings

    // Check for existing account
    const existing = await getUserByEmail(email.trim().toLowerCase());
    if (existing) {
      // Allow re-application if previously rejected
      if (existing.role === 'rejected' && rawRole === 'counselor') {
        const pool = getPool();
        await pool.query(`UPDATE users SET role='pending_counselor', name=$1 WHERE id=$2`, [name.trim(), existing.id]);
        await pool.query(`
          UPDATE ep_counselors SET display_name=$1, application_note=$2, years_experience=$3, specialties=$4, applied_at=NOW(), reviewed_at=NULL, reviewed_by=NULL
          WHERE user_id=$5
        `, [name.trim(), bio || '', parseInt(years_experience) || 0, specialties || [], existing.id]);
        sendEmail.welcomeCounselor({ to: email.trim().toLowerCase(), name: name.trim() }).catch(() => { });
        return NextResponse.json({ ok: true, id: existing.id, pending: true });
      }
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await createUser(email.trim().toLowerCase(), name.trim(), hashed, role);
    if (!user) {
      return NextResponse.json({ error: 'Failed to create account. Please try again.' }, { status: 500 });
    }

    // Save phone number if provided
    if (phone?.trim()) {
      try { const pool = getPool(); await pool.query('UPDATE users SET phone=$1 WHERE id=$2', [phone.trim(), user.id]); } catch { }
    }

    // Create counselor profile with application details
    if (rawRole === 'counselor') {
      try {
        const pool = getPool();
        await pool.query(
          `INSERT INTO ep_counselors (user_id, display_name, application_note, years_experience, specialties, applied_at)
           VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (user_id) DO NOTHING`,
          [user.id, name.trim(), bio || '', parseInt(years_experience) || 0, specialties || []]
        );
      } catch (e) { console.error('[register] Failed to create counselor profile:', e); }
      sendEmail.welcomeCounselor({ to: email.trim().toLowerCase(), name: name.trim() }).catch(() => { });
    } else {
      sendEmail.welcomeStudent({ to: email.trim().toLowerCase(), name: name.trim() }).catch(() => { });
    }

    return NextResponse.json({ ok: true, id: user.id, pending: rawRole === 'counselor' });
  } catch (err) {
    console.error('[register] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
