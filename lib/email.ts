/**
 * lib/email.ts — Centralized Postmark email service for Admitly
 */

const POSTMARK_URL = 'https://api.postmarkapp.com/email';
const TOKEN = () => process.env.POSTMARK_SERVER_TOKEN || '';
const FROM = () => process.env.POSTMARK_FROM_EMAIL || 'noreply@admitly.com';
const APP_URL = () => process.env.NEXTAUTH_URL || 'http://localhost:3000';
const LOGO = 'https://admitly.com/raven192.png';

function isConfigured(): boolean {
  return !!process.env.POSTMARK_SERVER_TOKEN;
}

async function send(to: string, subject: string, htmlBody: string, footerNote?: string): Promise<boolean> {
  if (!isConfigured()) {
    console.log(`[Email] Would send "${subject}" to ${to}`);
    return false;
  }
  try {
    const res = await fetch(POSTMARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': TOKEN() },
      body: JSON.stringify({ From: FROM(), To: to, Subject: subject, HtmlBody: wrap(htmlBody, footerNote), MessageStream: 'outbound' }),
    });
    if (!res.ok) { console.error(`[Email] Postmark error:`, await res.text()); return false; }
    console.log(`[Email] Sent "${subject}" to ${to}`);
    return true;
  } catch (err: any) { console.error(`[Email] Failed:`, err.message); return false; }
}

// ── Clean minimal wrapper — Papermark-inspired ──
function wrap(content: string, footerNote?: string): string {
  const footerText = footerNote || 'This email was sent by Admitly. If you were not expecting this email, you can safely ignore it.';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#1c1917;-webkit-font-smoothing:antialiased}
  a{color:#1c1917}
</style></head><body>
<div style="max-width:560px;margin:0 auto;padding:40px 20px;">
  <div style="background:#fff;border-radius:8px;border:1px solid #e7e5e4;overflow:hidden;">
    <div style="padding:36px 40px 32px;">
      ${content}
    </div>
    <div style="border-top:1px solid #f5f5f4;padding:24px 40px;">
      <p style="font-size:12px;color:#a8a29e;line-height:1.6;margin:0;">${footerText}</p>
    </div>
  </div>
  <div style="text-align:center;padding:20px 0 8px;">
    <p style="font-size:11px;color:#a8a29e;margin:0;">
      Admitly, Inc. · <a href="https://admitly.com" style="color:#a8a29e;text-decoration:underline;">admitly.com</a> · <a href="mailto:support@admitly.com" style="color:#a8a29e;text-decoration:underline;">support@admitly.com</a>
    </p>
  </div>
</div>
</body></html>`;
}

// ── Components ──
function header(badgeText?: string, badgeColor?: string): string {
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;"><tr>
    <td style="vertical-align:middle;width:48px;"><img src="${LOGO}" alt="Admitly" width="44" height="44" style="border-radius:10px;display:block;"></td>
    <td style="vertical-align:middle;padding-left:12px;"><div style="font-size:15px;font-weight:800;color:#1c1917;letter-spacing:0.08em;text-transform:uppercase;line-height:1.1;">ADMITLY</div><div style="font-size:11px;font-weight:500;color:#a8a29e;margin-top:1px;">Your Common App Copilot</div></td>
    ${badgeText ? `<td style="vertical-align:middle;text-align:right;"><span style="display:inline-block;background:${badgeColor||'#ecfdf5'};color:${badgeColor==='#eff6ff'?'#1e40af':badgeColor==='#fef2f2'?'#991b1b':badgeColor==='#fffbeb'?'#92400e':'#065f46'};font-size:11px;font-weight:700;padding:5px 12px;border-radius:999px;white-space:nowrap;">${badgeText}</span></td>` : ''}
  </tr></table>`;
}

function heading(text: string): string {
  return `<h1 style="font-size:22px;font-weight:800;color:#1c1917;margin:0 0 16px;letter-spacing:-0.3px;">${text}</h1>`;
}

function p(text: string): string {
  return `<p style="font-size:14px;color:#57534e;line-height:1.7;margin:0 0 16px;">${text}</p>`;
}

function code(digits: string): string {
  return `<div style="background:#f5f5f4;border-radius:8px;padding:22px 24px;text-align:center;margin:24px 0;">
    <span style="font-size:36px;font-weight:800;color:#1c1917;letter-spacing:12px;font-family:'Courier New',monospace;">${digits}</span>
  </div>`;
}

function btn(label: string, url: string): string {
  return `<div style="margin:24px 0 8px;"><a href="${url}" style="display:inline-block;padding:12px 28px;background:#1c1917;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">${label}</a></div>`;
}

function table(rows: [string, string][]): string {
  return `<div style="background:#f5f5f4;border-radius:8px;overflow:hidden;margin:20px 0;">
    <table cellpadding="0" cellspacing="0" width="100%" style="font-size:13px;">
      ${rows.map(([l,v], i) => `<tr><td style="padding:11px 16px;color:#78716c;font-weight:600;${i<rows.length-1?'border-bottom:1px solid #e7e5e4;':''}width:40%">${l}</td><td style="padding:11px 16px;color:#1c1917;font-weight:700;text-align:right;${i<rows.length-1?'border-bottom:1px solid #e7e5e4;':''}">${v}</td></tr>`).join('')}
    </table></div>`;
}

function steps(items: { n: string; title: string; desc: string }[]): string {
  return `<div style="margin:20px 0;">${items.map((it,i) => `<div style="display:flex;gap:12px;margin-bottom:${i<items.length-1?'14':'0'}px;">
    <div style="width:24px;height:24px;border-radius:50%;background:#f5f5f4;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:800;color:#78716c;">${it.n}</div>
    <div><div style="font-size:13px;font-weight:700;color:#1c1917;margin-bottom:2px;">${it.title}</div><div style="font-size:12px;color:#78716c;line-height:1.5;">${it.desc}</div></div>
  </div>`).join('')}</div>`;
}

function quote(text: string): string {
  return `<div style="background:#f5f5f4;border-left:3px solid #1c1917;border-radius:0 6px 6px 0;padding:12px 16px;margin:16px 0;font-size:13px;color:#44403c;line-height:1.6;">${text}</div>`;
}

function statusPill(label: string, color: 'green'|'red'|'amber' = 'green'): string {
  const c = { green:{bg:'#ecfdf5',text:'#065f46'}, red:{bg:'#fef2f2',text:'#991b1b'}, amber:{bg:'#fffbeb',text:'#92400e'} };
  return `<span style="display:inline-block;background:${c[color].bg};color:${c[color].text};font-size:11px;font-weight:700;padding:3px 10px;border-radius:6px;">${label}</span>`;
}

function sign(): string {
  return `<p style="font-size:13px;color:#a8a29e;margin:20px 0 0;">— The Admitly Team</p>`;
}

// Badge colors
const GREEN = '#ecfdf5';
const BLUE = '#eff6ff';
const RED = '#fef2f2';
const AMBER = '#fffbeb';

// ═══════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES
// ═══════════════════════════════════════════════════════════════

export const sendEmail = {

  // 1. Welcome Student
  welcomeStudent: (p: { to: string; name: string }) =>
    send(p.to, 'Welcome to Admitly!', `
      ${header('Account Created', GREEN)}
      ${heading('Welcome to Admitly')}
      ${p_(`Hi ${p.name},`)}
      ${p_('Your account is ready. Here\'s how to get started:')}
      ${steps([
        { n:'1', title:'Complete your profile', desc:'Add your GPA, test scores, AP courses, and extracurriculars.' },
        { n:'2', title:'Build your college list', desc:'Get personalized match scores with our recommendation engine.' },
        { n:'3', title:'Start writing essays', desc:'Draft and refine with AI tools that learn your voice.' },
      ])}
      ${btn('Go to Dashboard →', `${APP_URL()}/dashboard`)}
      ${sign()}
    `),

  // 2. Welcome Counselor
  welcomeCounselor: (p: { to: string; name: string }) =>
    send(p.to, 'Application Received — Admitly Counselor', `
      ${header('Application Received', BLUE)}
      ${heading('Application received')}
      ${p_(`Hi ${p.name},`)}
      ${p_('Thank you for applying to join Admitly as an expert counselor. Our team will review your application within 2–3 business days.')}
      ${steps([
        { n:'1', title:'Admin review', desc:'Our team reviews your background and specialties.' },
        { n:'2', title:'Approval notification', desc:'You\'ll receive an email when approved.' },
        { n:'3', title:'Set up your profile', desc:'Complete your profile, set availability, and connect Stripe.' },
      ])}
      ${btn('Check Status →', `${APP_URL()}/pending-approval`)}
      ${sign()}
    `),

  // 3. Counselor Approved
  counselorApproved: (p: { to: string; name: string }) =>
    send(p.to, 'You\'re Approved! Welcome to Admitly', `
      ${header('Approved', GREEN)}
      ${heading('You\'re approved!')}
      ${p_(`Hi ${p.name},`)}
      ${p_('Great news — your counselor application has been approved. Here\'s what to do now:')}
      ${steps([
        { n:'1', title:'Complete your profile', desc:'Add your title, bio, phone number, and specialties.' },
        { n:'2', title:'Set your availability', desc:'Choose your days, hours, and add your Zoom link.' },
        { n:'3', title:'Connect Stripe', desc:'Set up payouts so you get paid automatically.' },
      ])}
      ${btn('Set Up Profile →', `${APP_URL()}/settings/counselor`)}
      ${sign()}
    `),

  // 4. Counselor Rejected
  counselorRejected: (p: { to: string; name: string; reason?: string }) =>
    send(p.to, 'Admitly Counselor Application Update', `
      ${header('Not Approved', AMBER)}
      ${heading('Application update')}
      ${p_(`Hi ${p.name},`)}
      ${p_('After reviewing your application, we\'re unable to approve it at this time.')}
      ${p.reason ? quote(p.reason) : ''}
      ${p_('If your circumstances change, you\'re welcome to re-apply in the future.')}
      ${sign()}
    `),

  // 5. Payment Receipt
  paymentReceipt: (pp: { to: string; name: string; planName: string; amount: string; date: string; invoiceId?: string; transactionId?: string }) =>
    send(pp.to, `Payment Confirmed — ${pp.planName}`, `
      ${header('Payment Confirmed', GREEN)}
      ${heading('Payment confirmed')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('Your payment has been processed successfully.')}
      ${table([
        ['Plan', pp.planName],
        ['Amount', pp.amount],
        ['Date', pp.date],
        ...(pp.invoiceId ? [['Invoice', pp.invoiceId] as [string,string]] : []),
        ...(pp.transactionId ? [['Transaction', `<span style="font-family:monospace;font-size:11px;color:#78716c;">${pp.transactionId}</span>`] as [string,string]] : []),
        ['Status', statusPill('Paid')],
      ])}
      ${pp.planName.toLowerCase().includes('pro') && !pp.planName.toLowerCase().includes('premium')
        ? `${p_('Your Pro features are now active — Explore Colleges, Essay Studio, and Counselor Report are unlocked.')}${btn('Start Exploring →', `${APP_URL()}/colleges`)}`
        : `${p_('Here\'s what happens next:')}${steps([
            { n:'1', title:'Counselor assignment in progress', desc:'Our team is matching you with the best counselor. This takes 24–48 hours.' },
            { n:'2', title:'You\'ll get an email', desc:'We\'ll notify you as soon as your counselor is assigned.' },
            { n:'3', title:'Start your first session', desc:'Your counselor will reach out via the Expert Portal.' },
          ])}${btn('View Status →', `${APP_URL()}/expert-sessions`)}`
      }
      ${sign()}
    `),

  // 6. Refund Processed
  refundProcessed: (pp: { to: string; name: string; planName: string; amount: string; date: string; invoiceId?: string; transactionId?: string; reason?: string }) =>
    send(pp.to, `Refund Processed — ${pp.planName}`, `
      ${header('Refund Processed', BLUE)}
      ${heading('Refund processed')}
      ${p_(`Hi ${pp.name},`)}
      ${p_(`Your refund of <strong>${pp.amount}</strong> for <strong>${pp.planName}</strong> has been processed and will be returned to your original form of payment within 5–10 business days.`)}
      ${table([
        ['Plan', pp.planName],
        ['Refund Amount', pp.amount],
        ['Refund Date', pp.date],
        ...(pp.invoiceId ? [['Original Invoice', pp.invoiceId] as [string,string]] : []),
        ...(pp.transactionId ? [['Original Transaction', `<span style="font-family:monospace;font-size:11px;color:#78716c;">${pp.transactionId}</span>`] as [string,string]] : []),
        ['Payment Method', 'Refunded to original form of payment'],
        ['Status', statusPill('Refunded', 'amber')],
      ])}
      ${pp.reason ? p_(`Reason: ${pp.reason}`) : ''}
      ${p_('If the refund doesn\'t appear after 10 business days, please contact your bank or card issuer.')}
      ${sign()}
    `),

  // 7. Assignment → Student
  assignmentStudent: (pp: { to: string; studentName: string; counselorName: string; counselorTitle: string; planName: string; sessions: number }) =>
    send(pp.to, `Meet Your Counselor — ${pp.counselorName}`, `
      ${header('Counselor Assigned', GREEN)}
      ${heading('Meet your counselor')}
      ${p_(`Hi ${pp.studentName},`)}
      ${p_('You\'ve been paired with an expert admissions counselor.')}
      ${table([
        ['Counselor', pp.counselorName],
        ['Title', pp.counselorTitle],
        ['Plan', pp.planName],
        ['Sessions', `${pp.sessions} sessions`],
      ])}
      ${p_('Your counselor will reach out via the Expert Portal. You can also message them now.')}
      ${btn('Open Expert Portal →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 8. Assignment → Counselor
  assignmentCounselor: (pp: { to: string; counselorName: string; studentName: string; studentEmail: string; planName: string; sessions: number; duration: number }) =>
    send(pp.to, `New Student — ${pp.studentName}`, `
      ${header('New Student', BLUE)}
      ${heading('New student assigned')}
      ${p_(`Hi ${pp.counselorName},`)}
      ${p_('You have been assigned a new student.')}
      ${table([
        ['Student', pp.studentName],
        ['Email', pp.studentEmail],
        ['Plan', `${pp.planName} (${pp.sessions}×${pp.duration}min)`],
      ])}
      ${p_('Please send an introductory message within 48 hours.')}
      ${btn('View Assignment →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 9. Session Booked → Student
  sessionBookedStudent: (pp: { to: string; name: string; counselorName: string; date: string; time: string; topic: string; zoomLink?: string }) =>
    send(pp.to, `Session Confirmed — ${pp.date}`, `
      ${header('Session Booked', GREEN)}
      ${heading('Session confirmed')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('Your session has been confirmed.')}
      ${table([
        ['Counselor', pp.counselorName],
        ['Date', pp.date],
        ['Time', pp.time],
        ['Topic', pp.topic],
        ...(pp.zoomLink ? [['Zoom', `<a href="${pp.zoomLink}" style="color:#1c1917;font-weight:700;">Join Meeting</a>`] as [string,string]] : []),
      ])}
      ${p_('Be ready 5 minutes before the session starts.')}
      ${btn('View Sessions →', `${APP_URL()}/expert-sessions`)}
      ${sign()}
    `),

  // 10. Session Booked → Counselor
  sessionBookedCounselor: (pp: { to: string; name: string; studentName: string; date: string; time: string; topic: string }) =>
    send(pp.to, `New Session — ${pp.studentName}`, `
      ${header('New Session', BLUE)}
      ${heading('Session scheduled')}
      ${p_(`Hi ${pp.name},`)}
      ${p_(`A session has been scheduled with ${pp.studentName}.`)}
      ${table([['Student', pp.studentName], ['Date', pp.date], ['Time', pp.time], ['Topic', pp.topic]])}
      ${btn('View in Portal →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 11. Session Cancelled
  sessionCancelled: (pp: { to: string; name: string; otherName: string; otherRole: string; date: string; time: string; topic: string; reason?: string }) =>
    send(pp.to, `Session Cancelled — ${pp.date}`, `
      ${header('Session Cancelled', RED)}
      ${heading('Session cancelled')}
      ${p_(`Hi ${pp.name},`)}
      ${p_(`The session with ${pp.otherName} (${pp.otherRole}) on <strong>${pp.date}</strong> at <strong>${pp.time}</strong> has been cancelled.`)}
      ${table([[pp.otherRole, pp.otherName], ['Date', pp.date], ['Time', pp.time], ['Topic', pp.topic], ['Status', statusPill('Cancelled', 'red')]])}
      ${pp.reason ? quote(`Reason: ${pp.reason}`) : ''}
      ${btn('Reschedule →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 12. Session Reminder
  sessionReminder: (pp: { to: string; name: string; role: 'student'|'counselor'; otherName: string; date: string; time: string; topic: string; zoomLink?: string }) =>
    send(pp.to, `Session Tomorrow — ${pp.topic}`, `
      ${header('Reminder', AMBER)}
      ${heading('Session tomorrow')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('You have a session scheduled for tomorrow.')}
      ${table([
        [pp.role==='student'?'Counselor':'Student', pp.otherName],
        ['Date', pp.date], ['Time', pp.time], ['Topic', pp.topic],
        ...(pp.zoomLink ? [['Zoom', `<a href="${pp.zoomLink}" style="color:#1c1917;font-weight:700;">Join Meeting</a>`] as [string,string]] : []),
      ])}
      ${btn('View Session →', `${APP_URL()}/${pp.role==='counselor'?'expert-portal':'expert-sessions'}`)}
      ${sign()}
    `),

  // 13. Session Completed
  sessionCompleted: (pp: { to: string; studentName: string; counselorName: string; topic: string; date: string }) =>
    send(pp.to, `Session Notes — ${pp.topic}`, `
      ${header('Session Complete', GREEN)}
      ${heading('Session notes available')}
      ${p_(`Hi ${pp.studentName},`)}
      ${p_(`Your session with ${pp.counselorName} on "${pp.topic}" (${pp.date}) is complete. Notes and action items are now in your Expert Portal.`)}
      ${btn('View Notes →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 14. New Message
  newMessage: (pp: { to: string; recipientName: string; senderName: string; senderRole: string; preview: string }) =>
    send(pp.to, `New message from ${pp.senderName}`, `
      ${header()}
      ${heading('New message')}
      ${p_(`Hi ${pp.recipientName},`)}
      ${p_(`You have a new message from <strong>${pp.senderName}</strong> (${pp.senderRole}):`)}
      ${quote(`"${pp.preview.length > 200 ? pp.preview.slice(0, 200) + '…' : pp.preview}"`)}
      ${btn('Reply Now →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 15. Action Assigned
  actionAssigned: (pp: { to: string; name: string; actionText: string; dueDate: string; assignedBy: string }) =>
    send(pp.to, `New Action Item from ${pp.assignedBy}`, `
      ${header('New Task', BLUE)}
      ${heading('New action item')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('You have a new action item:')}
      ${quote(`<strong>${pp.actionText}</strong>`)}
      ${table([['Due Date', pp.dueDate], ['Assigned By', pp.assignedBy]])}
      ${btn('View Action Items →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 16. Action Due Reminder
  actionDueReminder: (pp: { to: string; name: string; actionText: string; dueDate: string }) =>
    send(pp.to, 'Action Item Due Tomorrow', `
      ${header('Due Tomorrow', AMBER)}
      ${heading('Action item due')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('Reminder: you have an action item due tomorrow.')}
      ${quote(`<strong>${pp.actionText}</strong>`)}
      ${table([['Due Date', pp.dueDate]])}
      ${btn('View Action Items →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `),

  // 17. Plan Expiring
  planExpiring: (pp: { to: string; name: string; planName: string; endDate: string; sessionsRemaining: number }) =>
    send(pp.to, `Your ${pp.planName} Plan Expires Soon`, `
      ${header('Expiring Soon', AMBER)}
      ${heading('Plan expiring soon')}
      ${p_(`Hi ${pp.name},`)}
      ${p_(`Your <strong>${pp.planName}</strong> plan is ending soon.`)}
      ${table([['Plan', pp.planName], ['Expires', pp.endDate], ['Sessions Left', `${pp.sessionsRemaining}`]])}
      ${p_('After expiration, you\'ll keep read-only access to past sessions, messages, and notes.')}
      ${btn('Browse Plans →', `${APP_URL()}/expert-sessions`)}
      ${sign()}
    `),

  // 18. Plan Expired
  planExpired: (pp: { to: string; name: string; planName: string }) =>
    send(pp.to, `Your ${pp.planName} Plan Has Ended`, `
      ${header('Plan Ended', RED)}
      ${heading('Plan ended')}
      ${p_(`Hi ${pp.name},`)}
      ${p_(`Your <strong>${pp.planName}</strong> plan has ended. Thank you for working with your counselor!`)}
      ${p_('<strong>What you keep:</strong> Full read-only access to past sessions, messages, and notes — forever.')}
      ${p_('<strong>What changes:</strong> No new messages or sessions until you purchase a new plan.')}
      ${btn('Start a New Plan →', `${APP_URL()}/expert-sessions`)}
      ${sign()}
    `),

  // 19. Payout Processed
  payoutProcessed: (pp: { to: string; counselorName: string; amount: string; sessions: number; period: string }) =>
    send(pp.to, `Payout Processed — ${pp.amount}`, `
      ${header('Payout Sent', GREEN)}
      ${heading('Payout processed')}
      ${p_(`Hi ${pp.counselorName},`)}
      ${p_('Your payout has been processed and should arrive within 2–3 business days.')}
      ${table([['Amount', pp.amount], ['Sessions', `${pp.sessions}`], ['Period', pp.period], ['Method', 'Stripe → Bank Transfer']])}
      ${btn('View Earnings →', `${APP_URL()}/settings/counselor`)}
      ${sign()}
    `),

  // 20. Account Locked
  accountLocked: (pp: { to: string; name: string; reason?: string }) =>
    send(pp.to, 'Account Locked — Admitly', `
      ${header('Account Locked', RED)}
      ${heading('Account locked')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('Your Admitly account has been temporarily locked due to a policy violation or administrative action.')}
      ${pp.reason ? quote(pp.reason) : ''}
      ${p_('If you believe this is a mistake, please contact <a href="mailto:support@admitly.com" style="color:#1c1917;font-weight:700;">support@admitly.com</a>.')}
      ${sign()}
    `),

  // 21. Admin Manual Email
  adminManual: (pp: { to: string; subject: string; body: string }) =>
    send(pp.to, pp.subject, `
      ${header()}
      <div style="font-size:14px;line-height:1.8;color:#292524;white-space:pre-wrap;">${pp.body}</div>
      ${sign()}
    `),

  // 22. Digest — batched notifications (messages, actions, sessions)
  digest: (pp: { to: string; recipientName: string; senderName: string; count: number; items: { type: string; text: string; time?: string }[] }) =>
    send(pp.to, `Admitly — Update from ${pp.senderName}`, `
      ${header(`${pp.count} Update${pp.count===1?'':'s'}`, BLUE)}
      ${heading('Expert Session Update')}
      <p style="font-size:13px;color:#a8a29e;margin:0 0 24px;">From <strong style="color:#57534e;">${pp.senderName}</strong> · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
      ${digestSection('Messages', pp.items.filter(i=>i.type==='message'))}
      ${digestSection('Action Items', pp.items.filter(i=>i.type==='action'))}
      ${digestSection('Sessions', pp.items.filter(i=>i.type==='session_booked'||i.type==='session_completed'))}
      ${btn('Open Expert Portal →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `, 'You\'re receiving this because you have an active Expert Session. Updates are grouped and sent every 15 minutes.'),

  // 23. Digest — counselor with multiple students
  digestMulti: (pp: { to: string; counselorName: string; count: number; students: { name: string; initials: string; items: { type: string; text: string }[] }[] }) =>
    send(pp.to, `Admitly — ${pp.count} new update${pp.count===1?'':'s'}`, `
      ${header(`${pp.count} Update${pp.count===1?'':'s'}`, BLUE)}
      ${heading('Expert Session Update')}
      <p style="font-size:13px;color:#a8a29e;margin:0 0 24px;">Updates from <strong style="color:#57534e;">${pp.students.length} student${pp.students.length===1?'':'s'}</strong> · ${new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</p>
      ${pp.students.map(s => `
        <div style="margin-bottom:24px;">
          <table cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr>
            <td style="vertical-align:middle;width:36px;"><div style="width:32px;height:32px;border-radius:8px;background:#eff6ff;color:#2563eb;font-size:11px;font-weight:800;text-align:center;line-height:32px;">${s.initials}</div></td>
            <td style="vertical-align:middle;padding-left:8px;"><div style="font-size:14px;font-weight:700;color:#1c1917;">${s.name}</div><div style="font-size:11px;color:#a8a29e;">${s.items.length} update${s.items.length===1?'':'s'}</div></td>
          </tr></table>
          <div style="background:#f5f5f4;border-radius:8px;overflow:hidden;margin-left:40px;">
            ${s.items.map((it,i) => `<div style="padding:10px 14px;${i<s.items.length-1?'border-bottom:1px solid #e7e5e4;':''}font-size:12px;"><span style="color:${it.type==='message'?'#a8a29e':it.type==='action'?'#92400e':'#1e40af'};font-weight:600;">${it.type==='message'?'Message':it.type==='action'?'Action item':'Session'}</span><span style="color:#57534e;margin-left:8px;">${it.text}</span></div>`).join('')}
          </div>
        </div>
      `).join('')}
      ${btn('Open Expert Portal →', `${APP_URL()}/expert-portal`)}
      ${sign()}
    `, 'You\'re receiving this because you have active students. Updates are grouped and sent every 15 minutes.'),

  // 24. Assignment Cancelled
  assignmentCancelled: (pp: { to: string; name: string; otherName: string; planName: string; role: 'student'|'counselor'; reason?: string }) =>
    send(pp.to, `Expert Session Cancelled — ${pp.planName}`, `
      ${header(pp.role==='student'?'Session Cancelled':'Assignment Cancelled', RED)}
      ${heading(pp.role==='student'?'Expert session cancelled':'Assignment cancelled')}
      ${p_(`Hi ${pp.name},`)}
      ${pp.role==='student'
        ? p_(`Your <strong>${pp.planName}</strong> expert session with <strong>${pp.otherName}</strong> has been cancelled.`)
        : p_(`Your assignment with <strong>${pp.otherName}</strong> (${pp.planName}) has been cancelled by the admin team.`)}
      ${pp.reason ? quote(pp.reason) : ''}
      ${pp.role==='student' ? p_('If you have questions, please contact our support team.') : ''}
      ${sign()}
    `),

  // 25. Assignment Paused
  assignmentPaused: (pp: { to: string; name: string; otherName: string; planName: string; role: 'student'|'counselor' }) =>
    send(pp.to, `Expert Session Paused — ${pp.planName}`, `
      ${header(pp.role==='student'?'Session Paused':'Assignment Paused', AMBER)}
      ${heading(pp.role==='student'?'Expert session paused':'Assignment paused')}
      ${p_(`Hi ${pp.name},`)}
      ${pp.role==='student'
        ? p_(`Your <strong>${pp.planName}</strong> expert session with <strong>${pp.otherName}</strong> has been temporarily paused. You'll be notified when it resumes.`)
        : p_(`Your assignment with <strong>${pp.otherName}</strong> (${pp.planName}) has been paused.`)}
      ${sign()}
    `),

  // 26. Assignment Completed
  assignmentCompleted: (pp: { to: string; name: string; otherName: string; planName: string; role: 'student'|'counselor'; sessionsUsed?: number; sessionsTotal?: number }) =>
    send(pp.to, `Expert Session Completed — ${pp.planName}`, `
      ${header(pp.role==='student'?'Session Complete':'Assignment Complete', GREEN)}
      ${heading(pp.role==='student'?'Expert session completed':'Assignment completed')}
      ${p_(`Hi ${pp.name},`)}
      ${pp.role==='student'
        ? p_(`Your <strong>${pp.planName}</strong> expert session with <strong>${pp.otherName}</strong> is now complete. Thank you for using Admitly!`)
        : p_(`Your assignment with <strong>${pp.otherName}</strong> (${pp.planName}) is now complete.${pp.sessionsUsed!==undefined?` ${pp.sessionsUsed}/${pp.sessionsTotal} sessions used.`:''}`)}
      ${pp.role==='student' ? p_('<strong>What you keep:</strong> Full read-only access to past sessions, messages, action items, and notes — forever.') : ''}
      ${pp.role==='student' ? btn('View Your Sessions →', `${APP_URL()}/expert-portal`) : ''}
      ${sign()}
    `),

  // 27. Bulk Import — Account Invitation
  accountInvite: (pp: { to: string; name: string; role: string }) =>
    send(pp.to, 'Your Admitly account is ready', `
      ${header('Account Created', GREEN)}
      ${heading('Your account is ready')}
      ${p_(`Hi ${pp.name},`)}
      ${p_(`An Admitly account has been created for you as a <strong>${pp.role === 'student' ? 'Student' : 'Counselor'}</strong>. To get started, you'll need to set your password.`)}
      ${steps([
        { n:'1', title:'Set your password', desc:'Click the button below to create a secure password for your account.' },
        { n:'2', title:'Complete your profile', desc:pp.role === 'student' ? 'Add your GPA, test scores, and extracurriculars.' : 'Add your title, bio, and specialties.' },
        { n:'3', title:'Start exploring', desc:pp.role === 'student' ? 'Build your college list and start writing essays with AI tools.' : 'Set your availability and connect Stripe for payouts.' },
      ])}
      ${btn('Set Your Password →', `${APP_URL()}/login`)}
      ${p_('On the login page, click <strong>"Forgot password?"</strong> and enter your email (<strong>' + pp.to + '</strong>) to set your password.')}
      ${sign()}
    `),

  // 28. Password Changed Confirmation
  passwordChanged: (pp: { to: string; name: string }) =>
    send(pp.to, 'Password Changed — Admitly', `
      ${header('Password Changed', GREEN)}
      ${heading('Password updated')}
      ${p_(`Hi ${pp.name},`)}
      ${p_('Your Admitly account password was just changed. If you made this change, no further action is needed.')}
      ${p_('If you did not change your password, please reset it immediately and contact our support team.')}
      ${btn('Reset Password →', `${APP_URL()}/login`)}
      ${sign()}
    `),
};

// Alias p_ to avoid conflict with function parameter names
function p_(text: string): string { return p(text); }

// Digest section builder for grouped notifications
function digestSection(title: string, items: { type: string; text: string; time?: string }[]): string {
  if (items.length === 0) return '';
  const badgeColors: Record<string, { bg: string; color: string }> = {
    Messages: { bg: '#f5f5f4', color: '#78716c' },
    'Action Items': { bg: '#fffbeb', color: '#92400e' },
    Sessions: { bg: '#ecfdf5', color: '#065f46' },
  };
  const bc = badgeColors[title] || badgeColors.Messages;
  const label = title === 'Sessions' ? (items.some(i => i.type === 'session_booked') ? 'scheduled' : 'complete') : 'new';
  return `<div style="margin-bottom:24px;">
    <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:10px;"><tr>
      <td style="vertical-align:middle;"><span style="font-size:12px;font-weight:800;color:#1c1917;text-transform:uppercase;letter-spacing:0.06em;">${title}</span></td>
      <td style="vertical-align:middle;text-align:right;"><span style="display:inline-block;background:${bc.bg};color:${bc.color};font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;">${items.length} ${label}</span></td>
    </tr></table>
    <div style="background:#f5f5f4;border-radius:8px;overflow:hidden;">
      ${items.map((it, i) => {
        if (it.type === 'message') {
          return `<div style="padding:12px 16px;${i < items.length - 1 ? 'border-bottom:1px solid #e7e5e4;' : ''}">
            ${it.time ? `<div style="font-size:11px;color:#a8a29e;margin-bottom:4px;">${it.time}</div>` : ''}
            <div style="font-size:13px;color:#44403c;line-height:1.5;">"${it.text}"</div>
          </div>`;
        }
        if (it.type === 'action') {
          return `<div style="padding:12px 16px;${i < items.length - 1 ? 'border-bottom:1px solid #e7e5e4;' : ''}">
            <table cellpadding="0" cellspacing="0" width="100%"><tr>
              <td style="vertical-align:top;width:24px;"><div style="width:16px;height:16px;border-radius:4px;border:2px solid #d6d3d1;margin-top:1px;"></div></td>
              <td style="vertical-align:top;"><div style="font-size:13px;font-weight:600;color:#1c1917;line-height:1.4;">${it.text}</div></td>
            </tr></table>
          </div>`;
        }
        // session_booked or session_completed
        return `<div style="padding:12px 16px;${i < items.length - 1 ? 'border-bottom:1px solid #e7e5e4;' : ''}">
          <div style="font-size:12px;"><span style="color:${it.type === 'session_booked' ? '#1e40af' : '#065f46'};font-weight:600;">${it.type === 'session_booked' ? 'Scheduled' : '✓ Completed'}</span><span style="color:#57534e;margin-left:8px;">${it.text}</span></div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
//  PHASE C — Premium Manual-Matching templates
//
// These extend the `sendEmail` object after its initial declaration.
// The cast to `any` is just to satisfy TypeScript's structural typing —
// the existing object's type was inferred from its initial properties
// and doesn't include these new keys. At runtime nothing changes;
// callers consume them as `sendEmail.adminNewPremiumRequest(...)` etc.
// ═══════════════════════════════════════════════════════════════
const _sendEmailExt = sendEmail as any;

/** Admin gets pinged on every new premium request. Falls back from
 *  ADMIN_NOTIFY_EMAIL → SMTP_FROM at the call site. */
_sendEmailExt.adminNewPremiumRequest = (p: {
  to: string;
  studentName: string;
  studentEmail: string;
  planName: string;
  amount: string;
  requestId: number;
}) =>
  send(p.to, `New Premium Request — ${p.planName} from ${p.studentName}`, `
    ${header('New Request', AMBER)}
    ${heading('New Premium request')}
    ${p_(`A student just submitted a Premium Match request and is awaiting your review.`)}
    ${table([
      ['Student', p.studentName],
      ['Email',   p.studentEmail],
      ['Plan',    p.planName],
      ['Amount',  p.amount],
    ])}
    ${btn('Review in Admin →', `${APP_URL()}/admin?tab=premium_requests`)}
    ${p_(`Request id: <code style="background:#f5f5f4;padding:2px 6px;border-radius:4px;">#${p.requestId}</code>`)}
    ${sign()}
  `);

/** Student gets a branded payment link. Route is /expert-sessions?ref=email
 *  so we own the landing experience and Stripe's redundant hosted-invoice
 *  mail looks like a backup, not the primary CTA. */
_sendEmailExt.premiumInvoiceSent = (p: {
  to: string;
  name: string;
  planName: string;
  amount: string;
  expiresInHours: number;
}) =>
  send(p.to, 'Your Admitly payment link is ready', `
    ${header('Ready to Pay', GREEN)}
    ${heading('Your payment link is ready')}
    ${p_(`Hi ${p.name},`)}
    ${p_(`Your Premium request has been reviewed and we've prepared a secure payment link for you. Once paid, we'll connect you with your matched counselor right away.`)}
    ${table([
      ['Plan',    p.planName],
      ['Amount',  p.amount],
      ['Expires', `In ${p.expiresInHours} hours`],
    ])}
    ${btn('Complete Payment →', `${APP_URL()}/expert-sessions?ref=email`)}
    ${p_(`This payment link expires in ${p.expiresInHours} hours. After that you'll need to start a new request.`)}
    ${sign()}
  `);

/** 48h reminder. Sent at most once per request — reminder_sent_at gates
 *  re-sends so the cron route is safe to run every 15 minutes. */
_sendEmailExt.premiumInvoiceReminder = (p: {
  to: string;
  name: string;
  planName: string;
  amount: string;
  hoursRemaining: number;
}) =>
  send(p.to, 'Reminder: Your Admitly payment link expires soon', `
    ${header('Expires Soon', AMBER)}
    ${heading('Your payment link expires soon')}
    ${p_(`Hi ${p.name},`)}
    ${p_(`Heads up — your payment link for the <strong>${p.planName}</strong> plan expires in about ${p.hoursRemaining} hours. After that the link stops working and you'll need to start a new request.`)}
    ${table([
      ['Plan',    p.planName],
      ['Amount',  p.amount],
    ])}
    ${btn('Complete Payment →', `${APP_URL()}/expert-sessions?ref=email`)}
    ${p_(`If you've changed your mind, you can ignore this email and the link will expire on its own.`)}
    ${sign()}
  `);

/** Sent when admin rejects a request with a reason. Frees the student's
 *  one-active-per-student slot so they can submit a different plan. */
_sendEmailExt.premiumRequestRejected = (p: {
  to: string;
  name: string;
  planName: string;
  reason: string;
}) =>
  send(p.to, 'About your Admitly premium request', `
    ${header('Update', AMBER)}
    ${heading('About your premium request')}
    ${p_(`Hi ${p.name},`)}
    ${p_(`We reviewed your request for the <strong>${p.planName}</strong> plan and unfortunately we won't be moving forward with it at this time.`)}
    ${quote(p.reason)}
    ${p_(`You're welcome to submit a request for a different plan, or reach out to <a href="mailto:support@admitly.com" style="color:#1c1917;">support@admitly.com</a> if you have questions.`)}
    ${btn('Browse Plans →', `${APP_URL()}/expert-sessions`)}
    ${sign()}
  `);

// ═══════════════════════════════════════════════════════════════
//  Recovery — Pro payment failure / abandoned checkout
//
//  Two templates that close the loop when a Pro payment fails or
//  never completes. Student gets a retry link, admin gets an alert
//  pointing at the new Recoveries tab where they can send a manual
//  invoice (same Stripe invoice machinery as Premium).
// ═══════════════════════════════════════════════════════════════

/** Student-facing: card declined, here's how to retry. */
_sendEmailExt.proPaymentFailed = (p: {
  to: string;
  name: string;
  amount: string;
  reason?: string;
}) =>
  send(p.to, 'Your Admitly payment didn\'t go through', `
    ${header('Payment Failed', RED)}
    ${heading('Your payment didn\'t go through')}
    ${p_(`Hi ${p.name},`)}
    ${p_(`We weren't able to process your <strong>Admitly Pro</strong> payment of ${p.amount}. ${p.reason ? `The reason from your bank: <em>${p.reason}</em>.` : 'Your bank declined the charge.'}`)}
    ${p_(`The most common cause is a temporary block from your card issuer. You can retry with the same card or a different one.`)}
    ${btn('Retry Payment →', `${APP_URL()}/subscribe`)}
    ${p_(`If you keep hitting this, our team can send you a direct payment link instead — just reply to this email or write to <a href="mailto:support@admitly.com" style="color:#1c1917;">support@admitly.com</a>.`)}
    ${sign()}
  `);

/** Admin-facing: a payment failed, go check the Recoveries tab. */
_sendEmailExt.adminPaymentFailedAlert = (p: {
  to: string;
  studentName: string;
  studentEmail: string;
  amount: string;
  reason?: string;
  paymentId: number;
}) =>
  send(p.to, `Pro payment failed — ${p.studentName}`, `
    ${header('Payment Failed', RED)}
    ${heading('A Pro payment failed')}
    ${p_(`A student attempted to pay for Admitly Pro and the charge was declined. They've been emailed a retry link, but you can send them a manual payment invoice instead.`)}
    ${table([
      ['Student',     p.studentName],
      ['Email',       p.studentEmail],
      ['Amount',      p.amount],
      ['Reason',      p.reason ?? 'Not provided by Stripe'],
      ['Payment id',  `#${p.paymentId}`],
    ])}
    ${btn('Open Recoveries →', `${APP_URL()}/admin?tab=recoveries`)}
    ${sign()}
  `);

export { isConfigured as isEmailConfigured };

/**
 * Phase A — admin "Compose Email" path.
 *
 * Sends a custom subject + body (HTML) using the same Postmark transport and
 * brand wrapper as the templated emails above. Returned boolean indicates
 * Postmark success; the caller is responsible for audit logging.
 */
export async function sendCustomEmail(
  to: string,
  subject: string,
  htmlBody: string,
  footerNote?: string,
): Promise<boolean> {
  return send(to, subject, htmlBody, footerNote);
}
