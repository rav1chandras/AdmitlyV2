import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { validateEmail } from '@/lib/auth-validation';
import { getProfile, getColleges } from '@/lib/db';
import { getSettings } from '@/lib/db_settings';
import { ensureSchema } from '@/lib/db_schema';
import { isPro } from '@/lib/subscription';
import { sendCustomEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';

function esc(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function bucketLabel(bucket?: string) {
  if (bucket === 'reach') return 'Reach';
  if (bucket === 'safety') return 'Safety';
  return 'Target';
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isPro(session)) return NextResponse.json({ error: 'Pro subscription required' }, { status: 403 });

    const { email } = await request.json();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const emailCheck = validateEmail(cleanEmail);
    if (!emailCheck.ok) return NextResponse.json({ error: emailCheck.error }, { status: 400 });

    await ensureSchema();
    const userId = parseInt(session.user.id, 10);
    const [profile, settings, colleges] = await Promise.all([
      getProfile(userId),
      getSettings(userId),
      getColleges(userId),
    ]);

    const studentName = session.user.name || 'Student';
    const schoolName = settings?.high_school_name || 'High School';
    const gradYear = settings?.graduation_year || '';
    const intendedMajor = settings?.intended_major || 'Undecided';
    const testValue = [profile?.sat ? `SAT ${profile.sat}` : '', profile?.act ? `ACT ${profile.act}` : ''].filter(Boolean).join(' / ') || 'Not provided';
    const ordered = [...(colleges || [])].sort((a: any, b: any) => {
      const rank: Record<string, number> = { reach: 0, target: 1, safety: 2 };
      return (rank[a.bucket] ?? 1) - (rank[b.bucket] ?? 1);
    }).slice(0, 12);

    const collegeRows = ordered.length
      ? ordered.map((college: any) => `
          <tr>
            <td style="padding:8px 10px;border-bottom:1px solid #e7e5e4;font-weight:700;">${esc(college.name)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e7e5e4;text-align:center;">${bucketLabel(college.bucket)}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e7e5e4;text-align:center;">${esc(college.sat_range || '—')}</td>
            <td style="padding:8px 10px;border-bottom:1px solid #e7e5e4;text-align:center;">${esc(college.act_range || '—')}</td>
          </tr>
        `).join('')
      : `<tr><td colspan="4" style="padding:12px 10px;color:#78716c;">No colleges have been selected yet.</td></tr>`;

    const html = `
      <h1 style="font-size:22px;font-weight:800;color:#1c1917;margin:0 0 12px;">School Counselor Report</h1>
      <p style="font-size:14px;color:#57534e;line-height:1.7;margin:0 0 18px;">${esc(studentName)} shared a counselor report from Admitly.</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-bottom:18px;">
        <div style="font-size:18px;font-weight:800;color:#111827;margin-bottom:4px;">${esc(studentName)}</div>
        <div style="font-size:12px;color:#475569;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">${esc(schoolName)}${gradYear ? ` · Class of ${esc(gradYear)}` : ''}</div>
      </div>
      <table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px;margin-bottom:18px;border:1px solid #e7e5e4;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:10px 12px;color:#78716c;border-bottom:1px solid #e7e5e4;">GPA</td><td style="padding:10px 12px;font-weight:800;text-align:right;border-bottom:1px solid #e7e5e4;">${esc(profile?.gpa ? Number(profile.gpa).toFixed(2) : 'Not provided')}</td></tr>
        <tr><td style="padding:10px 12px;color:#78716c;border-bottom:1px solid #e7e5e4;">SAT/ACT</td><td style="padding:10px 12px;font-weight:800;text-align:right;border-bottom:1px solid #e7e5e4;">${esc(testValue)}</td></tr>
        <tr><td style="padding:10px 12px;color:#78716c;border-bottom:1px solid #e7e5e4;">AP Coursework</td><td style="padding:10px 12px;font-weight:800;text-align:right;border-bottom:1px solid #e7e5e4;">${esc(profile?.ap_taken ?? 0)} APs</td></tr>
        <tr><td style="padding:10px 12px;color:#78716c;">Intended Major</td><td style="padding:10px 12px;font-weight:800;text-align:right;">${esc(intendedMajor)}</td></tr>
      </table>
      <h2 style="font-size:14px;font-weight:800;color:#1c1917;margin:0 0 10px;">Selected College List</h2>
      <table cellpadding="0" cellspacing="0" width="100%" style="font-size:12px;border:1px solid #e7e5e4;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#f8fafc;color:#475569;text-transform:uppercase;font-size:10px;letter-spacing:.4px;">
          <th align="left" style="padding:8px 10px;">College</th><th style="padding:8px 10px;">Tier</th><th style="padding:8px 10px;">SAT</th><th style="padding:8px 10px;">ACT</th>
        </tr></thead>
        <tbody>${collegeRows}</tbody>
      </table>
      <p style="font-size:12px;color:#78716c;line-height:1.6;margin:18px 0 0;">For the printable one-page handout, ask the student to download the PDF from Admitly.</p>
    `;

    const sent = await sendCustomEmail(
      cleanEmail,
      `School Counselor Report — ${studentName}`,
      html,
      'This counselor report was sent by Admitly at the student’s request.',
    );

    return NextResponse.json({ ok: true, sent });
  } catch (error) {
    console.error('[counselor-report/email] error', error);
    return NextResponse.json({ error: 'Could not send report.' }, { status: 500 });
  }
}
