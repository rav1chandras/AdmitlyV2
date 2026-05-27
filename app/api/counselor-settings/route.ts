import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPool } from '@/lib/db';
import { ensureSchema } from '@/lib/db_schema';
import { encryptPaymentField, decryptPaymentField, maskAccountNumber } from '@/lib/payment-crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const pool = getPool();
    await ensureSchema();

    // Get counselor profile
    const counselorRes = await pool.query(
      `SELECT ec.display_name, ec.title, ec.specialties, ec.years_experience, ec.bio, ec.phone, ec.timezone, ec.availability,
              COALESCE(ec.status, 'active') AS counselor_status, u.email
       FROM ep_counselors ec JOIN users u ON u.id = ec.user_id
       WHERE ec.user_id = $1`, [userId]
    );
    if (!counselorRes.rows.length) {
      return NextResponse.json({ error: 'Not a counselor' }, { status: 403 });
    }

    // Get counselor settings
    const settingsRes = await pool.query(
      `SELECT * FROM counselor_settings WHERE user_id = $1`, [userId]
    );

    // SECURITY: Never return raw ciphertext (or what was historically stored
    // as client-supplied plaintext) to the client. Decrypt the bank account
    // number server-side and return only the last-4 masked form. If the
    // stored value is legacy plaintext and decryption fails, we fall back
    // to masking the stored value directly so the UI still shows something.
    const settingsRow = settingsRes.rows[0] || null;
    if (settingsRow && settingsRow.account_number_encrypted) {
      let plain = '';
      try {
        plain = decryptPaymentField(settingsRow.account_number_encrypted);
      } catch {
        // Legacy rows stored verbatim plaintext; treat the value as-is.
        plain = settingsRow.account_number_encrypted;
      }
      settingsRow.account_number_masked = maskAccountNumber(plain);
    } else if (settingsRow) {
      settingsRow.account_number_masked = '';
    }
    // Strip the raw field before sending over the wire.
    if (settingsRow) delete settingsRow.account_number_encrypted;

    return NextResponse.json({
      profile: counselorRes.rows[0],
      settings: settingsRow,
    });
  } catch (err) {
    console.error('[CounselorSettings GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = parseInt(session.user.id);
    const pool = getPool();
    const data = await request.json();

    // Verify user is a counselor
    const check = await pool.query('SELECT id FROM ep_counselors WHERE user_id = $1', [userId]);
    if (!check.rows.length) return NextResponse.json({ error: 'Not a counselor' }, { status: 403 });

    // Update counselor profile fields
    if (data.profile) {
      const p = data.profile;
      // Phone is required for counselors
      if (!p.phone || !p.phone.trim()) {
        return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
      }
      await pool.query(
        `UPDATE ep_counselors SET
          display_name = COALESCE($1, display_name),
          title = COALESCE($2, title),
          specialties = COALESCE($3, specialties),
          years_experience = COALESCE($4, years_experience),
          bio = COALESCE($5, bio),
          phone = COALESCE($6, phone),
          timezone = COALESCE($7, timezone),
          availability = COALESCE($8, availability)
        WHERE user_id = $9`,
        [p.display_name, p.title, p.specialties, p.years_experience, p.bio, p.phone, p.timezone, p.availability_note, userId]
      );
    }

    // SECURITY: Email changes are NOT allowed via this endpoint.
    // Previously a counselor could set their email to any address (including
    // an ADMIN_EMAILS value), effectively escalating to admin on every route
    // that uses email-based isAdmin() checks. Email changes must go through
    // a separate verified flow (send code to new address, confirm ownership).
    if (data.profile?.email) {
      const { rows: currentUser } = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
      const currentEmail = (currentUser[0]?.email || '').toLowerCase();
      const requestedEmail = String(data.profile.email).trim().toLowerCase();
      if (requestedEmail && requestedEmail !== currentEmail) {
        return NextResponse.json(
          { error: 'Email changes must go through a verified flow. Please contact support.' },
          { status: 400 }
        );
      }
    }

    // Upsert counselor settings
    if (data.settings) {
      const s = data.settings;
      // Sync availability_enabled with ep_counselors.status
      const newStatus = s.availability_enabled ? 'active' : 'on_leave';
      await pool.query(`UPDATE ep_counselors SET status = $1 WHERE user_id = $2`, [newStatus, userId]);

      // SECURITY: Encrypt bank account server-side with AES-256-GCM.
      // Previously the field was named "account_number_encrypted" but the
      // server just stored whatever the client sent, so "encrypted" was a
      // lie. We now accept plaintext via `account_number` (preferred) or
      // legacy `account_number_encrypted` and always run the real cipher
      // before persistence. If the field is not present in the request at
      // all, we preserve the existing DB value (no accidental wipes).
      let accountCipher: string | null = null;
      const rawAccount =
        typeof s.account_number === 'string' && s.account_number.trim()
          ? s.account_number.trim()
          : typeof s.account_number_encrypted === 'string' && s.account_number_encrypted.trim()
            ? s.account_number_encrypted.trim()
            : null;

      if (rawAccount !== null) {
        try {
          accountCipher = encryptPaymentField(rawAccount);
        } catch (err: any) {
          console.error('[CounselorSettings PUT] encryption failed:', err?.message);
          return NextResponse.json(
            { error: 'Payment encryption is not configured on the server. Please contact support.' },
            { status: 503 }
          );
        }
      } else {
        // Preserve existing ciphertext on update if no new value was sent.
        const existing = await pool.query(
          `SELECT account_number_encrypted FROM counselor_settings WHERE user_id = $1`,
          [userId]
        );
        accountCipher = existing.rows[0]?.account_number_encrypted ?? '';
      }

      await pool.query(`
        INSERT INTO counselor_settings (
          user_id, availability_enabled, available_days, start_time, end_time,
          session_duration, max_students, zoom_link, availability_note,
          notify_new_message, notify_new_assignment, notify_session_reminder, notify_action_due, digest_frequency,
          payment_method, bank_name, account_holder, routing_number, account_number_encrypted, paypal_email, payment_note,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET
          availability_enabled=$2, available_days=$3, start_time=$4, end_time=$5,
          session_duration=$6, max_students=$7, zoom_link=$8, availability_note=$9,
          notify_new_message=$10, notify_new_assignment=$11, notify_session_reminder=$12, notify_action_due=$13, digest_frequency=$14,
          payment_method=$15, bank_name=$16, account_holder=$17, routing_number=$18, account_number_encrypted=$19, paypal_email=$20, payment_note=$21,
          updated_at=CURRENT_TIMESTAMP
      `, [
        userId,
        s.availability_enabled ?? true, s.available_days ?? ['Mon','Tue','Wed','Thu','Fri'],
        s.start_time ?? '9:00 AM', s.end_time ?? '5:00 PM',
        s.session_duration ?? 60, s.max_students ?? 15, s.zoom_link ?? '', s.availability_note ?? '',
        s.notify_new_message ?? true, s.notify_new_assignment ?? true, s.notify_session_reminder ?? true,
        s.notify_action_due ?? false, s.digest_frequency ?? 'daily',
        s.payment_method ?? 'bank_transfer', s.bank_name ?? '', s.account_holder ?? '',
        s.routing_number ?? '', accountCipher ?? '', s.paypal_email ?? '', s.payment_note ?? ''
      ]);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[CounselorSettings PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
