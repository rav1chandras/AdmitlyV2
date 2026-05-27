'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { AppShell } from '@/components/AppShell';

const STUDENT_FAQS = [
  { q: 'How is my admissions score calculated?', a: 'Your score is a weighted composite of four factors: GPA (35%), SAT/ACT (35%), AP course rigor (15%), and extracurricular tier (15%). The score ranges from 1–99 and updates in real time as you edit your profile. It\'s a directional indicator — not a guarantee — but it mirrors how many schools holistically assess applications.' },
  { q: 'What do Reach, Target, and Safety mean?', a: 'Reach schools have acceptance rates where your profile is below the typical admitted student range. Target schools are a solid match — your numbers sit at or near the 50th percentile. Safety schools are very likely to admit you based on your profile. A balanced list has 2–3 of each.' },
  { q: 'How does AI essay generation work?', a: 'The Generate and Improve buttons send your essay settings (type, tone, word limit, target college, topic) to an AI model. The response streams directly into your editor. The AI produces a starting draft — you should always personalize it with your own specific experiences and voice before submitting.' },
  { q: 'Is my essay data private?', a: 'Yes. Your essays are stored only in your own database. They are not shared with any third party. When you use the AI generation feature, your essay context is sent to an AI provider under your own API key — please review their privacy policy.' },
  { q: 'What is the Counselor Report?', a: 'The Fit & Readiness report on the Counselor page is a printable one-page summary of your academic profile, college list, and candidacy assessment. Take it to your counselor meetings so they have full context without you having to explain everything from scratch.' },
  { q: 'How do I download my essays?', a: 'In Essay Studio, use the export controls in the editor toolbar to download your draft as a text file.' },
  { q: 'What is the Student Journey?', a: 'Your Journey is where you capture the activities, honors, experiences, and personal identity that make you unique. This data feeds directly into the AI essay generator so your drafts are grounded in your real story — not generic templates.' },
  { q: 'What does Expert Sessions include?', a: 'Expert Sessions pairs you with a professional admissions counselor for one-on-one video sessions, messaging, essay reviews, action items, and shared notes. Plans range from a single session (Starter) to full-cycle support (5 sessions). Your counselor is assigned by the admin after purchase.' },
  { q: 'Can I still view past sessions after my plan expires?', a: 'Yes. Even after your Expert Sessions plan ends, you retain read-only access to the Expert Portal — all your past messages, session notes, action items, and counselor notes remain viewable. You just can\'t send new messages or schedule new sessions until you purchase a new plan.' },
  { q: 'What is the difference between Pro and Premium?', a: 'Pro ($129 one-time) unlocks Explore Colleges, Essay Studio, and the School Counselor Report. Premium is purchased through Expert Sessions plans and adds one-on-one counselor support. Premium includes all Pro features. If your Premium expires, your Pro access continues as long as it hasn\'t expired.' },
];

const COUNSELOR_FAQS = [
  { q: 'How do I set up my counselor profile?', a: 'Go to Settings → Profile. Fill in your display name, professional title, bio (up to 150 words), specialties (up to 6), years of experience, and phone number. Phone is required — students and admin may need to reach you directly for session coordination.' },
  { q: 'Why is my phone number required?', a: 'Your phone number is required so the Admitly admin team can contact you for urgent matters like session rescheduling, student issues, or payout questions. It is not shared with students — only visible to the admin team.' },
  { q: 'How do I get assigned students?', a: 'When a student purchases an Expert Sessions plan, the Admitly admin reviews their profile and assigns them to a counselor whose specialties match. You\'ll see a new student appear in your Expert Portal once assigned. You can set your max student count in Settings → Availability.' },
  { q: 'How do sessions work?', a: 'Sessions are scheduled through the Expert Portal. Each session has a date, time, topic, and Zoom link. After a completed session, add your notes directly in the portal — these are shared with the student. You can also attach action items with due dates.' },
  { q: 'How do I message a student?', a: 'Open the Expert Portal, select a student from the left panel, and click the Messages tab. Messages are delivered in real time within the platform. Both you and the student can see the full conversation history.' },
  { q: 'How do I message the admin?', a: 'Go to Settings → Message Admin. This is a direct channel between you and the Admitly admin team for platform questions, assignment issues, payout inquiries, or any support you need. The admin can also send you broadcast messages.' },
  { q: 'How do I get paid?', a: 'Go to Settings → Payment. Connect your bank account via Stripe Connect for automatic payouts. Once connected, the admin processes payouts based on your completed sessions and hourly rate. You can track all payments in Settings → Earnings.' },
  { q: 'Can I review a student\'s essays?', a: 'Yes. When a student shares an essay with you (via the "Share with Counselor" toggle in their Essay workspace), it appears in your Expert Portal under that student\'s profile. You can add an expert tag and leave feedback.' },
  { q: 'What happens when a plan ends?', a: 'When a student\'s plan ends, there is a 2-day grace period where you can still send messages and finalize notes. After that, the assignment moves to read-only — both you and the student can view the history but can\'t add new content.' },
  { q: 'How do I update my availability?', a: 'Go to Settings → Availability. Set your available days, start/end times, session duration, and max student count. You can also add an availability note (e.g., "On vacation Dec 20–Jan 2") that the admin sees when making assignments.' },
];

const STUDENT_PAGES = [
  { icon: 'fa-user', name: 'Profile', color: '#2563eb', bg: '#eff6ff', desc: 'Enter your GPA, test scores, AP courses, and extracurricular tier. Your admissions probability score updates instantly.' },
  { icon: 'fa-graduation-cap', name: 'Colleges', color: '#059669', bg: '#ecfdf5', desc: 'Search 100+ colleges with real acceptance rates, SAT ranges, tuition, and grad rates. Drag and drop schools into buckets.' },
  { icon: 'fa-pen-nib', name: 'Essay Studio', color: '#7c3aed', bg: '#f5f3ff', desc: 'A dedicated workspace for every essay type. Tune tone, formality, and narrative focus. Use AI to generate or improve drafts.' },
  { icon: 'fa-file-lines', name: 'Counselor Report', color: '#d97706', bg: '#fffbeb', desc: 'A printable one-page report combining your profile score, college list, and institutional fit assessment.' },
  { icon: 'fa-gem', name: 'Expert Sessions', color: '#ec4899', bg: '#fdf2f8', desc: 'Purchase one-on-one counselor support — video sessions, messaging, essay feedback, and personalized action items.' },
];

const COUNSELOR_PAGES = [
  { icon: 'fa-graduation-cap', name: 'Expert Portal', color: '#7c3aed', bg: '#f5f3ff', desc: 'Your student management workspace. View assigned students, send messages, schedule sessions, assign action items, and share notes.' },
  { icon: 'fa-gear', name: 'Settings → Profile', color: '#2563eb', bg: '#eff6ff', desc: 'Update your display name, title, bio, specialties, phone number (required), and timezone.' },
  { icon: 'fa-comment-dots', name: 'Settings → Message Admin', color: '#f59e0b', bg: '#fffbeb', desc: 'Direct messaging channel with the Admitly admin team for support, coordination, and platform questions.' },
  { icon: 'fa-dollar-sign', name: 'Settings → Earnings', color: '#059669', bg: '#ecfdf5', desc: 'Track your assignments, completed sessions, and payment history. Connect Stripe for automatic payouts.' },
  { icon: 'fa-calendar-alt', name: 'Settings → Availability', color: '#ec4899', bg: '#fdf2f8', desc: 'Set your available days, hours, max student count, and Zoom link. Admin uses this when assigning new students.' },
];

const STUDENT_TIPS = [
  { icon: 'fa-bullseye', color: '#2563eb', t: 'Be specific in your essay topics', d: '"Leadership" is vague — "Starting a coding club that grew to 40 members" is specific.' },
  { icon: 'fa-list-check', color: '#059669', t: 'Use the 2-3-3 rule for your college list', d: 'Aim for 2 safeties, 3 targets, and 3 reaches. More than 10 total and application quality usually drops.' },
  { icon: 'fa-sliders', color: '#7c3aed', t: 'Tune before you generate', d: 'Set your tone chips, formality, and narrative focus BEFORE hitting Generate.' },
  { icon: 'fa-print', color: '#d97706', t: 'Print the counselor report early', d: 'Bring it to your first counselor meeting, not your last.' },
  { icon: 'fa-rotate', color: '#e11d48', t: 'Use Improve, not Generate, on existing drafts', d: 'Improve Draft preserves your story while strengthening the writing. Generate replaces everything.' },
  { icon: 'fa-compass', color: '#0ea5e9', t: 'Fill in your Student Journey first', d: 'The more context you add to Activities, Honors, and Experiences, the better your AI-generated essays will be.' },
];

const COUNSELOR_TIPS = [
  { icon: 'fa-phone', color: '#ef4444', t: 'Add your phone number first', d: 'Phone is required before you can save your profile. Admin may need to reach you for urgent session coordination.' },
  { icon: 'fa-notes-medical', color: '#7c3aed', t: 'Add session notes within 24 hours', d: 'Students review session notes between sessions. Timely notes keep momentum going and show professionalism.' },
  { icon: 'fa-list-check', color: '#059669', t: 'Assign clear, dated action items', d: 'Break feedback into concrete tasks with due dates. Students respond better to "Draft 250 words on your robotics experience by Friday" than "Work on your essay."' },
  { icon: 'fa-comment-dots', color: '#0ea5e9', t: 'Use admin messaging for platform issues', d: 'Settings → Message Admin is the fastest way to get help with assignments, payouts, or student concerns.' },
  { icon: 'fa-calendar-check', color: '#d97706', t: 'Keep your availability up to date', d: 'If you\'re going on vacation or reducing hours, update Settings → Availability so admin doesn\'t assign new students during downtime.' },
];

const ss = (o: React.CSSProperties) => o;

function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={ss({borderBottom:'1px solid var(--border-light)'})}>
      <button onClick={() => setOpen(!open)}
        style={ss({width:'100%',textAlign:'left',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:16,padding:'16px 0',background:'none',border:'none',fontFamily:'inherit',cursor:'pointer'})}>
        <span style={ss({fontSize:13,fontWeight:700,color:'var(--stone-800)'})}>{q}</span>
        <i className={`fas fa-chevron-down`} style={{color:'var(--stone-300)',fontSize:10,flexShrink:0,marginTop:4,transition:'transform .2s',transform:open?'rotate(180deg)':'none'}}></i>
      </button>
      {open && <div style={ss({paddingBottom:16,fontSize:13,fontWeight:500,color:'var(--stone-500)',lineHeight:1.8,marginTop:-4})}>{a}</div>}
    </div>
  );
}

export default function HelpPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role || 'student';
  const isCounselor = role === 'counselor';

  const faqs = isCounselor ? COUNSELOR_FAQS : STUDENT_FAQS;
  const pages = isCounselor ? COUNSELOR_PAGES : STUDENT_PAGES;
  const tips = isCounselor ? COUNSELOR_TIPS : STUDENT_TIPS;

  return (
    <AppShell>
      <main style={ss({flex:1,padding:'36px 40px 60px',overflowY:'auto',maxWidth:900,margin:'0 auto'})}>

        {/* Header */}
        <div className="a1" style={ss({marginBottom:28})}>
          <h1 style={ss({fontSize:24,fontWeight:800,letterSpacing:'-0.3px'})}>Help Center</h1>
          <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>
            {isCounselor ? 'Everything you need to manage your Admitly counseling practice' : 'Everything you need to get the most out of Admitly'}
          </div>
        </div>

        {/* Quick start */}
        <div className="a2" style={ss({background:'var(--yellow)',borderRadius:'var(--radius)',padding:24,marginBottom:24})}>
          <div style={ss({display:'flex',alignItems:'center',gap:12,marginBottom:18})}>
            <div style={ss({width:40,height:40,borderRadius:14,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
              <i className="fas fa-bolt" style={{color:'var(--yellow)',fontSize:14}}></i>
            </div>
            <div>
              <h2 style={ss({fontSize:16,fontWeight:900})}>Quick Start — {isCounselor ? '4' : '4'} steps</h2>
              <p style={ss({fontSize:11,fontWeight:600,color:'rgba(0,0,0,.4)',marginTop:1})}>{isCounselor ? 'Get your counselor practice set up' : 'Get your full plan set up in under 15 minutes'}</p>
            </div>
          </div>
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:12})}>
            {(isCounselor ? [
              { n: '01', t: 'Complete your Profile', d: 'Add your title, bio, specialties, phone number (required), and timezone' },
              { n: '02', t: 'Set your Availability', d: 'Choose your available days, hours, session duration, and add your Zoom link' },
              { n: '03', t: 'Connect Stripe', d: 'Go to Settings → Payment and connect your bank account for automatic payouts' },
              { n: '04', t: 'Check the Expert Portal', d: 'Once admin assigns students, they appear here with messaging, sessions, and notes' },
            ] : [
              { n: '01', t: 'Fill in your Profile', d: 'GPA, SAT/ACT, AP courses, EC tier — your score updates live' },
              { n: '02', t: 'Build your College List', d: 'Search schools, check their data, drag into Reach / Target / Safety' },
              { n: '03', t: 'Draft in Essay Studio', d: 'Use the workspace + AI to write every essay type, one school at a time' },
              { n: '04', t: 'Print the Counselor Report', d: 'Take your full plan to your next counselor meeting' },
            ]).map(s => (
              <div key={s.n} style={ss({background:'rgba(255,255,255,.6)',borderRadius:16,padding:16,display:'flex',gap:12,alignItems:'flex-start'})}>
                <span style={ss({fontWeight:900,fontSize:22,color:'rgba(0,0,0,.15)',lineHeight:1,width:28,flexShrink:0})}>{s.n}</span>
                <div>
                  <div style={ss({fontSize:13,fontWeight:800})}>{s.t}</div>
                  <div style={ss({fontSize:11,fontWeight:500,color:'rgba(0,0,0,.4)',marginTop:2})}>{s.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Page Guide */}
        <div className="a3" style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24,marginBottom:24})}>
          <div style={ss({display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
            <div style={ss({width:40,height:40,borderRadius:14,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0})}>
              <i className="fas fa-map" style={{fontSize:14}}></i>
            </div>
            <div>
              <h2 style={ss({fontSize:16,fontWeight:900})}>{isCounselor ? 'Your Tools' : 'Page Guide'}</h2>
              <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>{isCounselor ? 'Key areas of the platform for counselors' : 'What each section of the app does'}</p>
            </div>
          </div>
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14})}>
            {pages.map(p => (
              <div key={p.name} style={ss({display:'flex',gap:14,padding:16,borderRadius:16,background:'var(--stone-50)',border:'1px solid var(--border-light)'})}>
                <div style={ss({width:40,height:40,borderRadius:12,background:p.bg,color:p.color,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,fontSize:14})}>
                  <i className={`fas ${p.icon}`}></i>
                </div>
                <div>
                  <div style={ss({fontSize:13,fontWeight:800,marginBottom:4})}>{p.name}</div>
                  <div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-500)',lineHeight:1.7})}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQs */}
        <div className="a4" style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24,marginBottom:24})}>
          <div style={ss({display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
            <div style={ss({width:40,height:40,borderRadius:14,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0})}>
              <i className="fas fa-circle-question" style={{fontSize:14}}></i>
            </div>
            <div>
              <h2 style={ss({fontSize:16,fontWeight:900})}>Frequently Asked Questions</h2>
              <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Click any question to expand the answer</p>
            </div>
          </div>
          {faqs.map((faq, i) => <FAQ key={i} q={faq.q} a={faq.a} />)}
        </div>

        {/* Pro Tips */}
        <div className="a5" style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24,marginBottom:40})}>
          <div style={ss({display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
            <div style={ss({width:40,height:40,borderRadius:14,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0})}>
              <i className="fas fa-lightbulb" style={{fontSize:14}}></i>
            </div>
            <div>
              <h2 style={ss({fontSize:16,fontWeight:900})}>{isCounselor ? 'Counselor Tips' : 'Pro Tips'}</h2>
              <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Little things that make a big difference</p>
            </div>
          </div>
          <div style={ss({display:'flex',flexDirection:'column',gap:12})}>
            {tips.map(tip => (
              <div key={tip.t} style={ss({display:'flex',gap:14,padding:16,borderRadius:16,background:'var(--stone-50)',border:'1px solid var(--border-light)'})}>
                <i className={`fas ${tip.icon}`} style={{color:tip.color,fontSize:14,marginTop:2,width:18,flexShrink:0}}></i>
                <div>
                  <div style={ss({fontSize:13,fontWeight:800})}>{tip.t}</div>
                  <div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-500)',marginTop:4,lineHeight:1.7})}>{tip.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
