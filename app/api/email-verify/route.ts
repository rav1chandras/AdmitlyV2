import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

// ── Disposable / temporary email domains blocklist ──
const DISPOSABLE_DOMAINS = new Set([
  // Major disposable providers
  'mailinator.com','guerrillamail.com','guerrillamail.net','guerrillamail.org','guerrillamail.de',
  'tempmail.com','temp-mail.org','temp-mail.io','throwaway.email','throwawaymail.com',
  'yopmail.com','yopmail.fr','yopmail.net','sharklasers.com','guerrillamailblock.com',
  'grr.la','dispostable.com','mailnesia.com','trashmail.com','trashmail.me','trashmail.net',
  'getnada.com','tempail.com','mohmal.com','emailondeck.com','mytemp.email',
  'tempr.email','discard.email','fakeinbox.com','mailcatch.com','tempinbox.com',
  'maildrop.cc','harakirimail.com','binkmail.com','safetymail.info','tempmailaddress.com',
  'mailtemp.info','mail-temp.com','tempmailo.com','1secmail.com','1secmail.net','1secmail.org',
  'emailfake.com','crazymailing.com','armyspy.com','dayrep.com','einrot.com','fleckens.hu',
  'gustr.com','jourrapide.com','rhyta.com','superrito.com','teleworm.us',
  'burpcollaborator.net','mailsac.com','inboxkitten.com','minutemail.com',
  'tempmailer.com','tmail.com','tmails.net','tmpmail.net','tmpmail.org',
  'mailnator.com','anonbox.net','anonymbox.com','bugmenot.com','mailexpire.com',
  'spamfree24.org','jetable.org','trash-mail.at','kurzepost.de','objectmail.com',
  'proxymail.eu','rcpt.at','wegwerfmail.de','wegwerfmail.net','wegwerfmail.org',
  'wh4f.org','mailzilla.com','thankyou2010.com','antispam.de','bspamfree.org',
  'emz.net','fakemailgenerator.com','getonemail.com','getonemail.net','incognitomail.org',
  'kasmail.com','mailblocks.com','mailmoat.com','mailshell.com','noclickemail.com',
  'nogmailspam.info','spaml.com','spamoff.de','thankyou2010.com','trashemail.de',
  'trashymail.com','trashymail.net','imails.info','sogetthis.com','mailinater.com',
  'mailinator2.com','mailtothis.com','newairmail.com','filzmail.com','letthemeatspam.com',
  'veryreallybad.com','dontreg.com','bouncr.com','10minutemail.com','10minutemail.co.za',
  'boun.cr','disposableemailaddresses.emailmiser.com','disposeamail.com','drdrb.net',
  'e4ward.com','emailias.com','emailigo.de','emailsensei.com','emailtemporario.com.br',
  'ephemail.net','etranquil.com','etranquil.net','etranquil.org','gishpuppy.com',
  'haltospam.com','hidemail.de','incognitomail.com','incognitomail.net','ipoo.org',
  'jetable.fr.nf','jetable.net','kasmail.com','lookugly.com','lortemail.dk',
  'lr78.com','maileater.com','mailexpire.com','mailguard.me','mailmoat.com',
  'mailnull.com','mailshell.com','mailsiphon.com','mailzilla.com','mbx.cc',
  'mega.zik.dj','meltmail.com','mierdamail.com','mintemail.com','mt2015.com',
  'nobulk.com','noclickemail.com','nogmailspam.info','nomail.xl.cx','nospam.ze.tc',
  'nospamfor.us','nowmymail.com','obobbo.com','odaymail.com','pjjkp.com',
  'pookmail.com','proxymail.eu','putthisinyouremail.com','qq.com',
  'quickinbox.com','rcpt.at','recode.me','recursor.net','regbypass.com',
  'rejectmail.com','rhyta.com','rklips.com','rmqkr.net','rppkn.com',
  'safersignup.de','scatmail.com','schafmail.de','selfdestructingmail.com',
  'shiftmail.com','skeefmail.com','slaskpost.se','slipry.net','slopsbox.com',
  'smashmail.de','soodonims.com','spam4.me','spamavert.com','spambob.com',
  'spambob.net','spambob.org','spambog.com','spambog.de','spambog.ru',
  'spambox.us','spamcero.com','spamcorptastic.com','spamcowboy.com','spamcowboy.net',
  'spamcowboy.org','spamday.com','spamex.com','spamfighter.cf','spamfighter.ga',
  'spamfighter.gq','spamfighter.ml','spamfighter.tk','spamfree24.com','spamfree24.de',
  'spamfree24.eu','spamfree24.info','spamfree24.net','spamfree24.org','spamgourmet.com',
  'spamgourmet.net','spamgourmet.org','spamherelots.com','spamhereplease.com',
  'spamhole.com','spamify.com','spaminator.de','spamkill.info','spaml.com',
  'spaml.de','spammotel.com','spamobox.com','spamoff.de','spamslicer.com',
  'spamspot.com','spamstack.net','spamthis.co.uk','spamthisplease.com','spamtrail.com',
  'spamtrap.ro','speed.1s.fr','spoofmail.de','stuffmail.de','supergreatmail.com',
  'tafmail.com','teewars.org','teleworm.com','thankdog.net','thankyou2010.com',
  'thisisnotmyrealemail.com','throwawayemailaddress.com','tittbit.in','tradermail.info',
]);

function isDisposable(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  return DISPOSABLE_DOMAINS.has(domain);
}

function generateCode(): string {
  // SECURITY: crypto.randomInt is a CSPRNG. Math.random is predictable enough
  // that an attacker who observes a few codes could narrow the PRNG state.
  return crypto.randomInt(100000, 1000000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const pool = getPool();

    // Ensure table exists (lightweight — no full schema rebuild)
    await pool.query(`
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
    // SECURITY: purpose column — binds a code to a specific flow.
    await pool.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS purpose VARCHAR(20) DEFAULT 'signup'`).catch(() => {});
    await pool.query(`ALTER TABLE email_verification_codes ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP`).catch(() => {});

    const { action, email, code, purpose } = await request.json();
    const cleanEmail = email?.trim().toLowerCase();

    // SECURITY: Whitelist allowed purposes; default to 'signup'.
    const ALLOWED_PURPOSES = ['signup', 'reset', 'password_change'] as const;
    const cleanPurpose: typeof ALLOWED_PURPOSES[number] =
      ALLOWED_PURPOSES.includes(purpose) ? purpose : 'signup';

    if (!cleanEmail) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
    }

    // Check disposable email
    if (isDisposable(cleanEmail)) {
      return NextResponse.json({ error: 'Disposable or temporary email addresses are not allowed. Please use a permanent email.' }, { status: 400 });
    }

    if (action === 'send') {
      // For signup: check if account already exists (skip for password reset/change)
      if (cleanPurpose === 'signup') {
        const existingUser = await pool.query(`SELECT id FROM users WHERE email=$1`, [cleanEmail]);
        if (existingUser.rows.length > 0) {
          return NextResponse.json({ error: 'An account with this email already exists. Please log in instead.' }, { status: 409 });
        }
      }

      // Rate limit: max 3 codes in 10 minutes
      const rateCheck = await pool.query(
        `SELECT COUNT(*) as cnt FROM email_verification_codes WHERE email=$1 AND created_at > NOW() - INTERVAL '10 minutes'`,
        [cleanEmail]
      );
      if (parseInt(rateCheck.rows[0].cnt) >= 3) {
        return NextResponse.json({ error: 'Too many verification attempts. Please wait 10 minutes.' }, { status: 429 });
      }

      const verificationCode = generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await pool.query(
        `INSERT INTO email_verification_codes (email, code, expires_at, purpose) VALUES ($1, $2, $3, $4)`,
        [cleanEmail, verificationCode, expiresAt, cleanPurpose]
      );

      // SECURITY: HTML-escape the email before interpolating into the template.
      // Without this, a signup email of the form `x"><script>...` would
      // inject into the attacker's own verification email (self-XSS, but brittle).
      const escapeHtml = (s: string) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      const safeEmail = escapeHtml(cleanEmail);

      // Send via Postmark
      const TOKEN = process.env.POSTMARK_SERVER_TOKEN;
      const FROM = process.env.POSTMARK_FROM_EMAIL || 'noreply@admitly.com';

      // DEV workflow: if EMAIL_DEV_MODE=true, log the verification code to
      // the server console instead of sending via Postmark. This lets you
      // test signup/reset flows without consuming Postmark quota while
      // leaving the Postmark token configured for other emails (payment
      // receipts, welcome messages, digests) that still go out normally.
      const DEV_MODE = process.env.EMAIL_DEV_MODE === 'true';

      if (TOKEN && !DEV_MODE) {
        try {
          await fetch('https://api.postmarkapp.com/email', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Postmark-Server-Token': TOKEN },
            body: JSON.stringify({
              From: FROM,
              To: cleanEmail,
              Subject: `${verificationCode} — Your Admitly verification code`,
              HtmlBody: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1c1917;-webkit-font-smoothing:antialiased}</style>
</head><body>
<div style="max-width:560px;margin:0 auto;padding:40px 20px;">
  <div style="background:#fff;border-radius:8px;border:1px solid #e7e5e4;overflow:hidden;">
    <div style="padding:36px 40px 32px;">
      <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;"><tr>
        <td style="vertical-align:middle;width:48px;"><img src="https://admitly.com/raven192.png" alt="Admitly" width="44" height="44" style="border-radius:10px;display:block;"></td>
        <td style="vertical-align:middle;padding-left:12px;"><div style="font-size:15px;font-weight:800;color:#1c1917;letter-spacing:0.08em;text-transform:uppercase;line-height:1.1;">ADMITLY</div><div style="font-size:11px;font-weight:500;color:#a8a29e;margin-top:1px;">Your Common App Copilot</div></td>
        <td style="vertical-align:middle;text-align:right;"><span style="display:inline-block;background:#eff6ff;color:#1e40af;font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px;">Email Verification</span></td>
      </tr></table>
      <h1 style="font-size:22px;font-weight:800;color:#1c1917;margin:0 0 16px;">Verify your email</h1>
      <p style="font-size:14px;color:#57534e;line-height:1.7;margin:0 0 16px;">Enter this code to verify your email and create your Admitly account:</p>
      <div style="background:#f5f5f4;border-radius:8px;padding:22px 24px;text-align:center;margin:24px 0;">
        <span style="font-size:36px;font-weight:800;color:#1c1917;letter-spacing:12px;font-family:'Courier New',monospace;">${verificationCode}</span>
      </div>
      <p style="font-size:13px;color:#a8a29e;line-height:1.7;margin:0;">This code will expire in 10 minutes.</p>
    </div>
    <div style="border-top:1px solid #f5f5f4;padding:24px 40px;">
      <p style="font-size:12px;color:#a8a29e;line-height:1.6;margin:0;">This email was intended for <a href="mailto:${safeEmail}" style="color:#1c1917;text-decoration:underline;">${safeEmail}</a>. If you were not expecting this email, you can safely ignore it.</p>
    </div>
  </div>
  <div style="text-align:center;padding:20px 0 8px;">
    <p style="font-size:11px;color:#a8a29e;margin:0;">Admitly, Inc. · <a href="https://admitly.com" style="color:#a8a29e;text-decoration:underline;">admitly.com</a> · <a href="mailto:support@admitly.com" style="color:#a8a29e;text-decoration:underline;">support@admitly.com</a></p>
  </div>
</div>
</body></html>`,
              TextBody: `Your Admitly verification code is: ${verificationCode}\n\nThis code expires in 10 minutes.`,
              MessageStream: 'outbound',
            }),
          });
        } catch (e) {
          console.error('[email-verify] Postmark send failed:', e);
        }
      } else {
        console.log(`[email-verify] DEV CODE for ${cleanEmail}: ${verificationCode}`);
      }

      return NextResponse.json({ ok: true, message: 'Verification code sent.' });
    }

    if (action === 'verify') {
      if (!code) {
        return NextResponse.json({ error: 'Verification code is required.' }, { status: 400 });
      }

      // SECURITY: Scope the lookup by purpose so a code issued for one flow
      // cannot be used for another. Also exclude consumed codes.
      const result = await pool.query(
        `SELECT id, code, attempts FROM email_verification_codes
         WHERE email=$1 AND purpose=$2 AND expires_at > NOW()
           AND verified=false AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`,
        [cleanEmail, cleanPurpose]
      );

      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'No valid verification code found. Please request a new one.' }, { status: 400 });
      }

      const row = result.rows[0];

      // Max 5 attempts per code
      if (row.attempts >= 5) {
        return NextResponse.json({ error: 'Too many incorrect attempts. Please request a new code.' }, { status: 429 });
      }

      // Increment attempts
      await pool.query(`UPDATE email_verification_codes SET attempts=attempts+1 WHERE id=$1`, [row.id]);

      // Constant-time-ish comparison to avoid timing leak on the 6-digit code.
      const submitted = Buffer.from(String(code).trim().padEnd(6, ' ').slice(0, 6));
      const expected  = Buffer.from(String(row.code).padEnd(6, ' ').slice(0, 6));
      if (submitted.length !== expected.length || !crypto.timingSafeEqual(submitted, expected)) {
        return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 });
      }

      // Mark as verified
      await pool.query(`UPDATE email_verification_codes SET verified=true WHERE id=$1`, [row.id]);

      return NextResponse.json({ ok: true, verified: true });
    }

    return NextResponse.json({ error: 'Invalid action.' }, { status: 400 });
  } catch (err) {
    console.error('[email-verify] error:', err);
    return NextResponse.json({ error: 'Server error.' }, { status: 500 });
  }
}
