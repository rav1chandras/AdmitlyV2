'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';

const SPECIALTY_OPTIONS = [
  'Ivy League','STEM Applications','Essay Strategy','Public Universities',
  'Financial Aid','Athletic Recruitment','West Coast Schools','Pre-Med',
  'Research Narratives','International Students','Art & Design Schools',
  'Liberal Arts','Business Programs','Engineering','Transfer Students',
  'Community College to 4-Year','Test Prep Strategy','Interview Coaching',
];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const TIME_SLOTS = ['8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM'];
const TIMEZONES = ['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Anchorage','Pacific/Honolulu'];

const ss = (o: React.CSSProperties) => o;
const inputS: React.CSSProperties = {width:'100%',padding:'10px 14px',background:'#fff',border:'1px solid #dcdbd7',borderRadius:10,fontSize:13,fontWeight:500,fontFamily:'inherit',outline:'none',color:'#1c1917',transition:'border-color .15s',boxSizing:'border-box' as const};
const labelS: React.CSSProperties = {fontSize:11,fontWeight:600,color:'#78716c',display:'block',marginBottom:6};
const cardS: React.CSSProperties = {background:'#ffffff',border:'1px solid #eae9e5',borderRadius:16,padding:24,marginBottom:16};

function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={ss({marginBottom:20,paddingBottom:16,borderBottom:'1px solid #f0efeb'})}>
      <h2 style={ss({fontSize:15,fontWeight:700,color:'#1c1917'})}>{title}</h2>
      <p style={ss({fontSize:12,fontWeight:400,color:'#a8a29e',marginTop:2})}>{sub}</p>
    </div>
  );
}

function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  return (
    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'16px 0',borderBottom:'1px solid #f5f4f2'})}>
      <div>
        <div style={ss({fontSize:14,fontWeight:500,color:'#1c1917'})}>{label}</div>
        <div style={ss({fontSize:12,fontWeight:400,color:'#a8a29e',marginTop:3})}>{sub}</div>
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        style={ss({position:'relative',flexShrink:0,width:44,height:24,borderRadius:12,border:'none',cursor:'pointer',transition:'background .2s',background:checked?'#22c55e':'#d6d3d1'})}>
        <span style={ss({position:'absolute',top:2,left:checked?22:2,width:20,height:20,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.15)',transition:'left .2s'})} />
      </button>
    </div>
  );
}

export default function CounselorSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Profile
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [yearsExperience, setYearsExperience] = useState('');
  const [phone, setPhone] = useState('');
  const [timezone, setTimezone] = useState('America/New_York');

  // Availability
  const [availabilityEnabled, setAvailabilityEnabled] = useState(true);
  const [availableDays, setAvailableDays] = useState<string[]>(['Mon','Tue','Wed','Thu','Fri']);
  const [startTime, setStartTime] = useState('9:00 AM');
  const [endTime, setEndTime] = useState('5:00 PM');
  const [sessionDuration, setSessionDuration] = useState(60);
  const [maxStudents, setMaxStudents] = useState(15);
  const [zoomLink, setZoomLink] = useState('');
  const [availabilityNote, setAvailabilityNote] = useState('');

  // Notifications
  const [notifyNewMessage, setNotifyNewMessage] = useState(true);
  const [notifyNewAssignment, setNotifyNewAssignment] = useState(true);
  const [notifySessionReminder, setNotifySessionReminder] = useState(true);
  const [notifyActionDue, setNotifyActionDue] = useState(false);
  const [digestFrequency, setDigestFrequency] = useState('daily');

  // Payment
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [bankName, setBankName] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [paymentNote, setPaymentNote] = useState('');

  // UI
  const [saveState, setSaveState] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'profile'|'availability'|'notifications'|'security'|'payment'|'earnings'|'admin_messages'>('profile');

  // Earnings data
  const [earningsData, setEarningsData] = useState<any>(null);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Stripe Connect
  const [connectStatus, setConnectStatus] = useState<{connected:boolean;ready?:boolean;account_id?:string}|null>(null);
  const [connectLoading, setConnectLoading] = useState(false);

  // Admin messages
  const [adminMsgs, setAdminMsgs] = useState<{id:number;sender_role:string;body:string;is_read:boolean;created_at:string}[]>([]);
  const [adminMsgsLoading, setAdminMsgsLoading] = useState(false);
  const [adminMsgText, setAdminMsgText] = useState('');
  const [adminMsgSending, setAdminMsgSending] = useState(false);
  const [adminUnread, setAdminUnread] = useState(0);
  const adminMsgEndRef = useRef<HTMLDivElement>(null);

  // Security / Change Password
  const [pwStep, setPwStep] = useState<'form'|'code'|'done'>('form');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwCode, setPwCode] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwResendTimer, setPwResendTimer] = useState(0);

  const wordCount = (t: string) => t.trim() ? t.trim().split(/\s+/).length : 0;
  const bioWords = wordCount(bio);
  const handleBioChange = (val: string) => { if (wordCount(val) <= 150) setBio(val); };

  const toggleSpecialty = (s: string) => setSpecialties(p => p.includes(s) ? p.filter(x=>x!==s) : p.length < 6 ? [...p, s] : p);
  const toggleDay = (d: string) => setAvailableDays(p => p.includes(d) ? p.filter(x=>x!==d) : [...p, d]);

  // Load data
  useEffect(() => {
    if (status !== 'authenticated') return;
    (async () => {
      try {
        const res = await fetch('/api/counselor-settings', { cache: 'no-store' });
        if (!res.ok) {
          // API may fail if not a real counselor in DB — just show defaults
          setIsLoading(false);
          return;
        }
        const { profile: p, settings: s } = await res.json();
        if (p) {
          setDisplayName(p.display_name || '');
          setEmail(p.email || '');
          setTitle(p.title || '');
          setBio(p.bio || '');
          setSpecialties(p.specialties || []);
          setYearsExperience(String(p.years_experience || ''));
          setPhone(p.phone || '');
          setTimezone(p.timezone || 'America/New_York');
          // Derive availability from counselor status (synced with admin)
          setAvailabilityEnabled((p.counselor_status || 'active') === 'active');
        }
        if (s) {
          setAvailableDays(s.available_days || ['Mon','Tue','Wed','Thu','Fri']);
          setStartTime(s.start_time || '9:00 AM');
          setEndTime(s.end_time || '5:00 PM');
          setSessionDuration(s.session_duration || 60);
          setMaxStudents(s.max_students || 15);
          setZoomLink(s.zoom_link || '');
          setAvailabilityNote(s.availability_note || '');
          setNotifyNewMessage(s.notify_new_message ?? true);
          setNotifyNewAssignment(s.notify_new_assignment ?? true);
          setNotifySessionReminder(s.notify_session_reminder ?? true);
          setNotifyActionDue(s.notify_action_due ?? false);
          setDigestFrequency(s.digest_frequency || 'daily');
          setPaymentMethod(s.payment_method || 'bank_transfer');
          setBankName(s.bank_name || '');
          setAccountHolder(s.account_holder || '');
          setRoutingNumber(s.routing_number || '');
          setAccountNumber(s.account_number_encrypted || '');
          setPaypalEmail(s.paypal_email || '');
          setPaymentNote(s.payment_note || '');
        }
      } catch {}
      // Fill defaults from session if API didn't return data
      if (!displayName && session?.user?.name) setDisplayName(session.user.name);
      if (!email && session?.user?.email) setEmail(session.user.email);
      setIsLoading(false);
    })();
  }, [status]);

  const handleSave = async () => {
    // Validate required fields
    if (!phone.trim()) {
      setActiveTab('profile');
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
      return;
    }
    setSaveState('saving');
    try {
      const res = await fetch('/api/counselor-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: { display_name: displayName, email, title, specialties, years_experience: parseInt(yearsExperience) || 0, bio, phone, timezone, availability_note: availabilityNote },
          settings: { availability_enabled: availabilityEnabled, available_days: availableDays, start_time: startTime, end_time: endTime, session_duration: sessionDuration, max_students: maxStudents, zoom_link: zoomLink, availability_note: availabilityNote, notify_new_message: notifyNewMessage, notify_new_assignment: notifyNewAssignment, notify_session_reminder: notifySessionReminder, notify_action_due: notifyActionDue, digest_frequency: digestFrequency, payment_method: paymentMethod, bank_name: bankName, account_holder: accountHolder, routing_number: routingNumber, account_number_encrypted: accountNumber, paypal_email: paypalEmail, payment_note: paymentNote },
        }),
      });
      if (!res.ok) throw new Error();
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2500);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  };

  // Fetch earnings when tab activates
  useEffect(() => {
    if (activeTab !== 'earnings' || earningsData) return;
    setEarningsLoading(true);
    fetch('/api/counselor/earnings', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setEarningsData(d); setEarningsLoading(false); })
      .catch(() => setEarningsLoading(false));
  }, [activeTab, earningsData]);

  // Password change resend timer
  useEffect(() => {
    if (pwResendTimer <= 0) return;
    const t = setTimeout(() => setPwResendTimer(pwResendTimer - 1), 1000);
    return () => clearTimeout(t);
  }, [pwResendTimer]);

  // Check Stripe Connect status when payment tab activates
  useEffect(() => {
    if (activeTab !== 'payment' || connectStatus) return;
    fetch('/api/stripe/connect', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setConnectStatus(d))
      .catch(() => setConnectStatus({ connected: false }));
  }, [activeTab, connectStatus]);

  // Fetch admin messages when tab activates
  useEffect(() => {
    if (activeTab !== 'admin_messages') return;
    setAdminMsgsLoading(true);
    fetch('/api/admin-messages', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setAdminMsgs(d.messages || []); setAdminUnread(0); setAdminMsgsLoading(false); })
      .catch(() => setAdminMsgsLoading(false));
  }, [activeTab]);

  // Fetch unread count on mount for badge
  useEffect(() => {
    fetch('/api/admin-messages', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setAdminUnread(d.unread || 0))
      .catch(() => {});
  }, []);

  const handleStripeConnect = async () => {
    setConnectLoading(true);
    try {
      const res = await fetch('/api/stripe/connect', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setConnectLoading(false);
      }
    } catch {
      setConnectLoading(false);
    }
  };

  const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const fmtDate = (d: string) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';

  const TABS = [
    { id: 'profile' as const, label: 'Profile', icon: 'fa-user' },
    { id: 'earnings' as const, label: 'Earnings', icon: 'fa-dollar-sign' },
    { id: 'admin_messages' as const, label: 'Message Admin', icon: 'fa-comment-dots', badge: adminUnread > 0 ? adminUnread : undefined },
    { id: 'availability' as const, label: 'Availability', icon: 'fa-calendar-alt' },
    { id: 'notifications' as const, label: 'Notifications', icon: 'fa-bell' },
    { id: 'security' as const, label: 'Security', icon: 'fa-shield-halved' },
    { id: 'payment' as const, label: 'Payment', icon: 'fa-credit-card' },
  ];

  return (
    <AppShell>
      <div style={ss({flex:1,display:'flex',minHeight:'100vh',background:'#f5f4f2'})}>

        {/* ── LEFT SETTINGS NAV ── */}
        <div style={ss({width:220,flexShrink:0,background:'#fff',borderRight:'1px solid #e7e5e4',padding:'32px 0',display:'flex',flexDirection:'column',overflowY:'auto'})}>
          <div style={ss({padding:'0 20px 20px',borderBottom:'1px solid #f0eeec',marginBottom:8})}>
            <div style={ss({fontSize:11,fontWeight:700,color:'#a8a29e',textTransform:'uppercase',letterSpacing:'0.4px'})}>Settings</div>
          </div>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={ss({
                width:'100%', display:'flex', alignItems:'center', gap:10,
                padding:'9px 20px', border:'none', background:'transparent',
                fontFamily:'inherit', fontSize:13, fontWeight:isActive?600:400,
                color:isActive?'#1c1917':'#78716c', cursor:'pointer',
                textAlign:'left', borderLeft:`2px solid ${isActive?'#1c1917':'transparent'}`,
                transition:'all .1s',
              })}>
                <i className={`fas ${tab.icon}`} style={{fontSize:12,width:16,color:isActive?'#1c1917':'#a8a29e'}}></i>
                {tab.label}
                {(tab as any).badge && <span style={ss({marginLeft:'auto',fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:10,background:'#ef4444',color:'#fff',lineHeight:'16px'})}>{(tab as any).badge}</span>}
              </button>
            );
          })}
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div style={ss({flex:1,overflowY:'auto',padding:'40px 44px 80px'})}>
          <div style={ss({maxWidth:700})}>

            {/* Page header */}
            <div style={ss({display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:32})}>
              <div>
                <h1 style={ss({fontSize:22,fontWeight:700,color:'#1c1917',letterSpacing:'-0.3px'})}>
                  {TABS.find(t=>t.id===activeTab)?.label}
                </h1>
                <p style={ss({fontSize:13,color:'#a8a29e',marginTop:3,fontWeight:400})}>
                  {activeTab==='profile'&&'How students and admins see you'}
                  {activeTab==='availability'&&'When students can book sessions with you'}
                  {activeTab==='notifications'&&'Control what alerts you receive'}
                  {activeTab==='security'&&'Change your password and manage account security'}
                  {activeTab==='payment'&&'How you receive payouts'}
                  {activeTab==='earnings'&&'Your assignments, sessions, and payment history'}
                  {activeTab==='admin_messages'&&'Direct messages with Admitly admin'}
                </p>
              </div>
              <button onClick={handleSave} disabled={saveState === 'saving'}
                style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'9px 20px',borderRadius:999,border:'none',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:saveState==='saving'?'not-allowed':'pointer',transition:'all .15s',
                  background: saveState==='saved'?'#22c55e':saveState==='error'?'#ef4444':saveState==='saving'?'#e7e5e4':'#fbbf24',
                  color: saveState==='saving'?'#78716c':saveState==='saved'||saveState==='error'?'#fff':'#000'})}>
                <i className={`fas ${saveState==='saving'?'fa-spinner fa-spin':saveState==='saved'?'fa-check':saveState==='error'?'fa-exclamation':'fa-floppy-disk'}`} style={{fontSize:11}}></i>
                {saveState==='saving'?'Saving…':saveState==='saved'?'Saved!':saveState==='error'?'Error':'Save Changes'}
              </button>
            </div>

            {isLoading ? (
              <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:192,color:'#78716c',fontSize:13,fontWeight:500})}>
                <i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i> Loading…
              </div>
            ) : (
              <>
                {/* ═══ PROFILE ═══ */}
                {activeTab === 'profile' && (
                  <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                    <div style={cardS}>
                      <SectionHead title="Personal Information" sub="Contact details and public profile" />
                      <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14})}>
                        <div style={{gridColumn:'span 2'}}><label style={labelS}>Display Name</label><input style={inputS} value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Dr. Sarah Mitchell" /></div>
                        <div style={{gridColumn:'span 2'}}><label style={labelS}>Professional Title</label><input style={inputS} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Former Yale Admissions Officer" /></div>
                        <div style={{gridColumn:'span 2'}}><label style={labelS}>Email Address</label><input type="email" style={inputS} value={email} onChange={e=>setEmail(e.target.value)} placeholder="sarah@admitly.com" /></div>
                        <div><label style={labelS}>Years of Experience</label><input type="number" style={inputS} value={yearsExperience} onChange={e=>setYearsExperience(e.target.value)} min="0" max="50" /></div>
                        <div>
                          <label style={labelS}>Phone <span style={{color:'#ef4444'}}>*</span></label>
                          <input type="tel" style={{...inputS, borderColor: phone.trim() ? '#e7e5e4' : '#fecaca'}} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(555) 000-0000" />
                          {!phone.trim() && <div style={ss({fontSize:10,fontWeight:600,color:'#ef4444',marginTop:4})}>Phone number is required</div>}
                        </div>
                      </div>
                      <div style={ss({marginTop:14})}>
                        <label style={labelS}>Bio — {bioWords}/150 words</label>
                        <textarea value={bio} onChange={e=>handleBioChange(e.target.value)} placeholder="Tell students about your background…" rows={3}
                          style={ss({...inputS,resize:'vertical',lineHeight:1.6,minHeight:80,borderColor:bioWords>=150?'var(--amber)':'var(--border)'})} />
                        {bioWords >= 145 && <div style={ss({fontSize:10,fontWeight:700,color:'var(--amber)',marginTop:4})}>{150 - bioWords} words remaining</div>}
                      </div>
                    </div>
                    <div style={cardS}>
                      <SectionHead title="Specialties" sub={`${specialties.length}/6 selected — shown on your public profile`} />
                      <div style={ss({display:'flex',gap:8,flexWrap:'wrap'})}>
                        {SPECIALTY_OPTIONS.map(s => {
                          const active = specialties.includes(s);
                          const atLimit = specialties.length >= 6 && !active;
                          return (
                            <button key={s} onClick={() => toggleSpecialty(s)} disabled={atLimit}
                              style={ss({padding:'7px 14px',borderRadius:10,border:active?'2px solid var(--stone-900)':'1px solid var(--border)',background:active?'var(--stone-900)':'var(--card)',color:active?'var(--yellow)':atLimit?'var(--stone-300)':'var(--stone-700)',fontFamily:'inherit',fontSize:12,fontWeight:active?800:600,cursor:atLimit?'not-allowed':'pointer',transition:'all .12s',opacity:atLimit?0.4:1})}>
                              {active && <span style={{marginRight:5,fontSize:10}}>✓</span>}{s}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══ EARNINGS ═══ */}
                {activeTab === 'earnings' && (
                  <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                    {earningsLoading && (
                      <div style={ss({textAlign:'center',padding:'60px 0',color:'#a8a29e'})}>
                        <i className="fas fa-spinner fa-spin" style={{fontSize:20,display:'block',marginBottom:10}}></i>
                        <div style={ss({fontSize:13,fontWeight:600})}>Loading earnings…</div>
                      </div>
                    )}
                    {!earningsLoading && earningsData && (
                      <>
                        {/* Summary Cards */}
                        <div style={ss({display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12})}>
                          {[
                            { label: 'Hourly Rate', value: fmtMoney(earningsData.counselor?.hourly_rate || 0), icon: 'fa-tag', color: '#2563eb' },
                            { label: 'Total Earned', value: fmtMoney(earningsData.counselor?.total_earned || 0), icon: 'fa-dollar-sign', color: '#059669' },
                            { label: 'Total Paid', value: fmtMoney(earningsData.counselor?.total_paid || 0), icon: 'fa-check-circle', color: '#059669' },
                            { label: 'Balance Owed', value: fmtMoney(earningsData.counselor?.balance_owed || 0), icon: 'fa-clock', color: (earningsData.counselor?.balance_owed || 0) > 0 ? '#d97706' : '#a8a29e' },
                          ].map(c => (
                            <div key={c.label} style={ss({background:'#fff',border:'1px solid #eae9e5',borderRadius:14,padding:'18px 16px',textAlign:'center'})}>
                              <i className={`fas ${c.icon}`} style={{fontSize:14,color:c.color,display:'block',marginBottom:8}}></i>
                              <div style={ss({fontSize:18,fontWeight:900,color:'#1c1917'})}>{c.value}</div>
                              <div style={ss({fontSize:10,fontWeight:600,color:'#a8a29e',marginTop:4})}>{c.label}</div>
                            </div>
                          ))}
                        </div>

                        {/* Assignments Table */}
                        <div style={cardS}>
                          <SectionHead title="Assignments" sub={`${earningsData.assignments?.length || 0} total assignments`} />
                          {(earningsData.assignments?.length || 0) === 0 ? (
                            <div style={ss({textAlign:'center',padding:'40px 0',color:'#a8a29e'})}>
                              <i className="fas fa-users" style={{fontSize:24,display:'block',marginBottom:10,opacity:.3}}></i>
                              <div style={ss({fontSize:13,fontWeight:600})}>No assignments yet</div>
                              <div style={ss({fontSize:11,marginTop:4})}>Students will appear here once admin assigns them to you.</div>
                            </div>
                          ) : (
                            <div style={ss({overflowX:'auto'})}>
                              <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                                <thead>
                                  <tr style={{background:'#f9f8f6'}}>
                                    {['Student','Plan','Sessions','Status','Earned','Date'].map(h => (
                                      <th key={h} style={ss({padding:'10px 14px',textAlign:'left',fontSize:10,fontWeight:700,color:'#a8a29e',textTransform:'uppercase',letterSpacing:'.3px',borderBottom:'1px solid #eae9e5'})}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(earningsData.assignments || []).map((a: any) => {
                                    const pct = a.sessions_total ? Math.round((a.sessions_used / a.sessions_total) * 100) : 0;
                                    const statusCfg: Record<string,{bg:string;color:string;label:string}> = {
                                      active: { bg: '#ecfdf5', color: '#065f46', label: 'Active' },
                                      pending_acceptance: { bg: '#fffbeb', color: '#92400e', label: 'Pending' },
                                      completed: { bg: '#eff6ff', color: '#1e40af', label: 'Completed' },
                                      declined: { bg: '#fef2f2', color: '#991b1b', label: 'Declined' },
                                      cancelled: { bg: '#f5f5f4', color: '#78716c', label: 'Cancelled' },
                                    };
                                    const st = statusCfg[a.status] || statusCfg.active;
                                    return (
                                      <tr key={a.id} style={{borderBottom:'1px solid #f5f4f2'}}>
                                        <td style={ss({padding:'14px'})}>
                                          <div style={ss({fontWeight:700,color:'#1c1917'})}>{a.student_name}</div>
                                          <div style={ss({fontSize:10,color:'#a8a29e',marginTop:2})}>{a.student_email}</div>
                                        </td>
                                        <td style={ss({padding:'14px',fontWeight:600})}>{a.plan}</td>
                                        <td style={ss({padding:'14px'})}>
                                          <div style={ss({display:'flex',alignItems:'center',gap:8})}>
                                            <span style={ss({fontWeight:700})}>{a.sessions_used}/{a.sessions_total}</span>
                                            <div style={ss({flex:1,maxWidth:60,height:4,background:'#f0efeb',borderRadius:4,overflow:'hidden'})}>
                                              <div style={ss({height:'100%',width:`${pct}%`,background:pct===100?'#059669':'#fbbf24',borderRadius:4})}/>
                                            </div>
                                          </div>
                                        </td>
                                        <td style={ss({padding:'14px'})}>
                                          <span style={ss({fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,background:st.bg,color:st.color})}>{st.label}</span>
                                        </td>
                                        <td style={ss({padding:'14px',fontWeight:800,color:'#1c1917'})}>{fmtMoney(a.earned_cents || 0)}</td>
                                        <td style={ss({padding:'14px',color:'#a8a29e',fontSize:11})}>{fmtDate(a.created_at)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>

                        {/* Payments Received Table */}
                        <div style={cardS}>
                          <SectionHead title="Payments Received" sub="History of all payouts from Admitly" />
                          {(earningsData.payouts?.length || 0) === 0 ? (
                            <div style={ss({textAlign:'center',padding:'40px 0',color:'#a8a29e'})}>
                              <i className="fas fa-receipt" style={{fontSize:24,display:'block',marginBottom:10,opacity:.3}}></i>
                              <div style={ss({fontSize:13,fontWeight:600})}>No payments yet</div>
                              <div style={ss({fontSize:11,marginTop:4})}>Payouts will appear here after admin processes them.</div>
                            </div>
                          ) : (
                            <div style={ss({overflowX:'auto'})}>
                              <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                                <thead>
                                  <tr style={{background:'#f9f8f6'}}>
                                    {['Date','Student','Plan','Amount','Hours','Rate','Status','Notes'].map(h => (
                                      <th key={h} style={ss({padding:'10px 14px',textAlign:'left',fontSize:10,fontWeight:700,color:'#a8a29e',textTransform:'uppercase',letterSpacing:'.3px',borderBottom:'1px solid #eae9e5'})}>{h}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {(earningsData.payouts || []).map((p: any) => (
                                    <tr key={p.id} style={{borderBottom:'1px solid #f5f4f2'}}>
                                      <td style={ss({padding:'14px',fontSize:11,color:'#78716c'})}>{fmtDate(p.paid_at || p.created_at)}</td>
                                      <td style={ss({padding:'14px',fontWeight:600})}>{p.student_name || '—'}</td>
                                      <td style={ss({padding:'14px',fontSize:11})}>{p.assignment_plan || '—'}</td>
                                      <td style={ss({padding:'14px',fontWeight:800,color:'#1c1917'})}>{fmtMoney(p.amount_cents || 0)}</td>
                                      <td style={ss({padding:'14px'})}>{p.hours || '—'}</td>
                                      <td style={ss({padding:'14px',fontSize:11})}>{p.rate_cents ? fmtMoney(p.rate_cents) + '/hr' : '—'}</td>
                                      <td style={ss({padding:'14px'})}>
                                        <span style={ss({fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:20,
                                          background: p.status === 'paid' ? '#ecfdf5' : '#fffbeb',
                                          color: p.status === 'paid' ? '#065f46' : '#92400e',
                                        })}>{p.status === 'paid' ? 'Paid' : 'Pending'}</span>
                                      </td>
                                      <td style={ss({padding:'14px',fontSize:11,color:'#a8a29e',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{p.notes || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {!earningsLoading && !earningsData && (
                      <div style={ss({textAlign:'center',padding:'60px 0',color:'#a8a29e'})}>
                        <i className="fas fa-exclamation-triangle" style={{fontSize:20,display:'block',marginBottom:10,opacity:.3}}></i>
                        <div style={ss({fontSize:13,fontWeight:600})}>Could not load earnings</div>
                        <button onClick={()=>{setEarningsData(null);}} style={ss({marginTop:12,padding:'8px 16px',border:'1px solid #eae9e5',borderRadius:10,background:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Retry</button>
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ AVAILABILITY ═══ */}
                {activeTab === 'availability' && (
                  <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                    <div style={cardS}>
                      <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
                        <div>
                          <h2 style={ss({fontSize:16,fontWeight:900})}>Accepting Bookings</h2>
                          <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>Toggle off to pause all new session bookings</p>
                        </div>
                        <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                          <span style={ss({fontSize:11,fontWeight:700,color:availabilityEnabled?'var(--emerald)':'var(--stone-400)'})}>
                            {availabilityEnabled ? 'Available' : 'Paused'}
                          </span>
                          <button onClick={() => setAvailabilityEnabled(!availabilityEnabled)}
                            style={ss({position:'relative',width:44,height:24,borderRadius:12,border:'none',cursor:'pointer',background:availabilityEnabled?'var(--emerald)':'var(--stone-200)',transition:'background .2s'})}>
                            <span style={ss({position:'absolute',top:2,left:availabilityEnabled?22:2,width:20,height:20,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.1)',transition:'left .2s'})} />
                          </button>
                        </div>
                      </div>

                      {!availabilityEnabled && (
                        <div style={ss({padding:'12px 16px',background:'var(--amber-light)',borderRadius:12,marginBottom:18,display:'flex',alignItems:'center',gap:10,border:'1px solid #fef3c7'})}>
                          <i className="fas fa-pause-circle" style={{color:'#92400e',fontSize:13}}></i>
                          <span style={ss({fontSize:12,fontWeight:600,color:'#92400e'})}>Your profile is marked unavailable. Students cannot book.</span>
                        </div>
                      )}

                      <div style={ss({opacity:availabilityEnabled?1:0.4,pointerEvents:availabilityEnabled?'auto':'none',transition:'opacity .2s'})}>
                        <div style={ss({marginBottom:18})}>
                          <label style={labelS}>Available Days</label>
                          <div style={ss({display:'flex',gap:6})}>
                            {DAYS.map(d => {
                              const on = availableDays.includes(d);
                              return <button key={d} onClick={() => toggleDay(d)} style={ss({width:48,height:40,borderRadius:10,border:on?'none':'1px solid var(--border)',background:on?'var(--stone-900)':'var(--stone-50)',color:on?'var(--yellow)':'var(--stone-500)',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:'pointer',transition:'all .12s'})}>{d}</button>;
                            })}
                          </div>
                        </div>
                        <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:18})}>
                          <div><label style={labelS}>Start Time</label><select style={inputS} value={startTime} onChange={e=>setStartTime(e.target.value)}>{TIME_SLOTS.map(t=><option key={t}>{t}</option>)}</select></div>
                          <div><label style={labelS}>End Time</label><select style={inputS} value={endTime} onChange={e=>setEndTime(e.target.value)}>{TIME_SLOTS.map(t=><option key={t}>{t}</option>)}</select></div>
                        </div>
                        <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:18})}>
                          <div><label style={labelS}>Timezone</label><select style={inputS} value={timezone} onChange={e=>setTimezone(e.target.value)}>{TIMEZONES.map(tz=><option key={tz} value={tz}>{tz.replace('America/','').replace('Pacific/','').replace('_',' ')}</option>)}</select></div>
                          <div><label style={labelS}>Session Length</label><select style={inputS} value={sessionDuration} onChange={e=>setSessionDuration(Number(e.target.value))}><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>60 min</option><option value={90}>90 min</option></select></div>
                          <div><label style={labelS}>Max Students</label><input type="number" style={inputS} value={maxStudents} onChange={e=>setMaxStudents(Number(e.target.value))} min="1" max="50" /></div>
                        </div>
                        <div><label style={labelS}>Zoom / Meeting Link</label><input style={inputS} value={zoomLink} onChange={e=>setZoomLink(e.target.value)} placeholder="https://zoom.us/j/your-id" /></div>
                        <div style={ss({marginTop:14})}><label style={labelS}>Availability Note (shown to students)</label><input style={inputS} value={availabilityNote} onChange={e=>setAvailabilityNote(e.target.value)} placeholder="Next available: Tomorrow, 3:00 PM EST" /></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══ NOTIFICATIONS ═══ */}
                {activeTab === 'notifications' && (
                  <div style={cardS}>
                    <SectionHead title="Email & Push Notifications" sub="Choose what updates you receive" />
                    <Toggle checked={notifyNewMessage} onChange={setNotifyNewMessage} label="New student messages" sub="When a student sends you a message" />
                    <Toggle checked={notifyNewAssignment} onChange={setNotifyNewAssignment} label="New student assignments" sub="When admin assigns a new student to you" />
                    <Toggle checked={notifySessionReminder} onChange={setNotifySessionReminder} label="Session reminders" sub="1 hour and 15 minutes before sessions" />
                    <Toggle checked={notifyActionDue} onChange={setNotifyActionDue} label="Action item reminders" sub="When student action items are overdue" />
                    <div style={ss({marginTop:16})}>
                      <label style={labelS}>Email Digest</label>
                      <div style={ss({display:'flex',gap:6})}>
                        {['off','daily','weekly'].map(f => (
                          <button key={f} onClick={() => setDigestFrequency(f)}
                            style={ss({padding:'7px 16px',borderRadius:8,border:digestFrequency===f?'2px solid var(--stone-900)':'1px solid var(--border)',background:digestFrequency===f?'var(--stone-900)':'var(--card)',color:digestFrequency===f?'#fff':'var(--stone-600)',fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',textTransform:'capitalize',transition:'all .12s'})}>{f}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══ SECURITY ═══ */}
                {activeTab === 'security' && (
                  <div style={cardS}>
                    <SectionHead title="Change Password" sub="Update your account password. You'll verify via email before the change takes effect." />
                    {(session?.user as any)?.auth_provider === 'google' ? (
                      <div style={ss({padding:'20px 0',textAlign:'center'})}>
                        <div style={ss({width:48,height:48,borderRadius:12,background:'#eff6ff',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:12})}><i className="fab fa-google" style={{fontSize:20,color:'#4285F4'}}></i></div>
                        <div style={ss({fontSize:14,fontWeight:700,color:'var(--stone-700)',marginBottom:4})}>Google Account</div>
                        <div style={ss({fontSize:12,color:'var(--stone-400)',lineHeight:1.5})}>Your account uses Google sign-in. Password is managed by Google.</div>
                      </div>
                    ) : pwStep === 'done' ? (
                      <div style={ss({padding:'24px 0',textAlign:'center'})}>
                        <div style={ss({width:48,height:48,borderRadius:'50%',background:'#ecfdf5',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:12})}><i className="fas fa-check" style={{fontSize:20,color:'#059669'}}></i></div>
                        <div style={ss({fontSize:16,fontWeight:800,color:'var(--stone-800)',marginBottom:4})}>Password updated</div>
                        <div style={ss({fontSize:12,color:'var(--stone-400)',marginBottom:16})}>Your password has been changed successfully. A confirmation email has been sent.</div>
                        <button onClick={()=>{setPwStep('form');setCurrentPw('');setNewPw('');setConfirmPw('');setPwCode('');setPwError('');}}
                          style={ss({padding:'8px 20px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)'})}>Done</button>
                      </div>
                    ) : pwStep === 'code' ? (
                      <div style={ss({maxWidth:360})}>
                        <div style={ss({fontSize:13,color:'var(--stone-500)',marginBottom:16,lineHeight:1.6})}>We sent a 6-digit verification code to <strong style={{color:'var(--stone-700)'}}>{session?.user?.email}</strong>.</div>
                        <label style={labelS}>Verification Code</label>
                        <input type="text" inputMode="numeric" maxLength={6} value={pwCode} onChange={e=>setPwCode(e.target.value.replace(/\D/g,''))} placeholder="000000"
                          style={ss({width:'100%',padding:'12px 16px',borderRadius:10,border:'1px solid var(--border)',fontSize:24,fontWeight:800,letterSpacing:8,textAlign:'center',fontFamily:'monospace',outline:'none',marginBottom:12})}/>
                        {pwError&&<div style={ss({fontSize:12,color:'#dc2626',fontWeight:600,marginBottom:10,padding:'8px 12px',background:'#fef2f2',borderRadius:8})}>{pwError}</div>}
                        <button disabled={pwLoading||pwCode.length!==6} onClick={async()=>{
                          setPwError('');setPwLoading(true);
                          try{
                            const vRes=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',email:session?.user?.email,code:pwCode,purpose:'password_change'})});
                            if(!vRes.ok){const d=await vRes.json();setPwError(d.error);setPwLoading(false);return;}
                            const cRes=await fetch('/api/account/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current_password:currentPw,new_password:newPw})});
                            const cData=await cRes.json();
                            if(!cRes.ok){setPwError(cData.error);setPwLoading(false);return;}
                            setPwStep('done');
                          }catch{setPwError('Something went wrong.');}
                          setPwLoading(false);
                        }} style={ss({width:'100%',padding:'11px 0',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:13,fontWeight:800,cursor:pwLoading?'wait':'pointer',fontFamily:'inherit',marginBottom:8,opacity:pwCode.length!==6?.5:1})}>
                          {pwLoading?'Verifying…':'Confirm Password Change'}
                        </button>
                        <div style={ss({display:'flex',justifyContent:'space-between',alignItems:'center'})}>
                          <button onClick={()=>{setPwStep('form');setPwError('');setPwCode('');}} style={ss({fontSize:12,color:'var(--stone-400)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'})}>← Back</button>
                          <button disabled={pwResendTimer>0} onClick={async()=>{
                            await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',email:session?.user?.email,purpose:'password_change'})});
                            setPwResendTimer(60);
                          }} style={ss({fontSize:12,color:pwResendTimer>0?'var(--stone-300)':'var(--stone-500)',background:'none',border:'none',cursor:pwResendTimer>0?'default':'pointer',fontFamily:'inherit',textDecoration:pwResendTimer>0?'none':'underline'})}>
                            {pwResendTimer>0?`Resend in ${pwResendTimer}s`:'Resend code'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={ss({maxWidth:360})}>
                        <label style={labelS}>Current Password</label>
                        <input type="password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} placeholder="Enter current password" style={ss({...inputS,marginBottom:14})}/>
                        <label style={labelS}>New Password</label>
                        <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="At least 8 characters" style={ss({...inputS,marginBottom:14})}/>
                        <label style={labelS}>Confirm New Password</label>
                        <input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} placeholder="Re-enter new password" style={ss({...inputS,marginBottom:14})}/>
                        {pwError&&<div style={ss({fontSize:12,color:'#dc2626',fontWeight:600,marginBottom:10,padding:'8px 12px',background:'#fef2f2',borderRadius:8})}>{pwError}</div>}
                        <button disabled={pwLoading} onClick={async()=>{
                          setPwError('');
                          if(!currentPw){setPwError('Please enter your current password.');return;}
                          if(newPw.length<8){setPwError('New password must be at least 8 characters.');return;}
                          if(newPw!==confirmPw){setPwError('New passwords do not match.');return;}
                          if(currentPw===newPw){setPwError('New password must be different from current password.');return;}
                          setPwLoading(true);
                          try{
                            const vRes=await fetch('/api/account/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify_current',current_password:currentPw})});
                            if(!vRes.ok){const d=await vRes.json();setPwError(d.error);setPwLoading(false);return;}
                            const sRes=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',email:session?.user?.email,purpose:'password_change'})});
                            if(!sRes.ok){const d=await sRes.json();setPwError(d.error);setPwLoading(false);return;}
                            setPwResendTimer(60);setPwStep('code');
                          }catch{setPwError('Something went wrong.');}
                          setPwLoading(false);
                        }} style={ss({width:'100%',padding:'11px 0',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:13,fontWeight:800,cursor:pwLoading?'wait':'pointer',fontFamily:'inherit',opacity:pwLoading?.5:1})}>
                          {pwLoading?'Checking…':'Continue →'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* ═══ PAYMENT ═══ */}
                {activeTab === 'payment' && (
                  <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                    {/* Stripe Connect Card */}
                    <div style={cardS}>
                      <SectionHead title="Bank Payouts via Stripe" sub="Connect your bank account to receive automatic payouts" />
                      {!connectStatus ? (
                        <div style={ss({textAlign:'center',padding:'30px 0',color:'#a8a29e'})}>
                          <i className="fas fa-spinner fa-spin" style={{fontSize:16}}></i>
                          <div style={ss({fontSize:12,marginTop:8})}>Checking connection…</div>
                        </div>
                      ) : connectStatus.connected && connectStatus.ready ? (
                        <div style={ss({padding:'20px',background:'#ecfdf5',borderRadius:14,border:'1px solid #a7f3d0',display:'flex',alignItems:'center',gap:16})}>
                          <div style={ss({width:48,height:48,borderRadius:14,background:'#059669',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                            <i className="fas fa-check" style={{color:'#fff',fontSize:20}}></i>
                          </div>
                          <div style={ss({flex:1})}>
                            <div style={ss({fontSize:15,fontWeight:800,color:'#065f46'})}>Bank Account Connected</div>
                            <div style={ss({fontSize:12,fontWeight:500,color:'#047857',marginTop:2})}>Payouts are deposited directly to your bank account within 2-3 business days.</div>
                          </div>
                          <button onClick={handleStripeConnect} disabled={connectLoading}
                            style={ss({padding:'8px 16px',borderRadius:10,border:'1px solid #a7f3d0',background:'#fff',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',color:'#059669',flexShrink:0})}>
                            {connectLoading ? <i className="fas fa-spinner fa-spin"></i> : 'Manage'}
                          </button>
                        </div>
                      ) : connectStatus.connected && !connectStatus.ready ? (
                        <div style={ss({padding:'20px',background:'#fffbeb',borderRadius:14,border:'1px solid #fde68a',display:'flex',alignItems:'center',gap:16})}>
                          <div style={ss({width:48,height:48,borderRadius:14,background:'#d97706',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                            <i className="fas fa-exclamation" style={{color:'#fff',fontSize:20}}></i>
                          </div>
                          <div style={ss({flex:1})}>
                            <div style={ss({fontSize:15,fontWeight:800,color:'#92400e'})}>Onboarding Incomplete</div>
                            <div style={ss({fontSize:12,fontWeight:500,color:'#b45309',marginTop:2})}>Please complete your Stripe onboarding to start receiving payouts.</div>
                          </div>
                          <button onClick={handleStripeConnect} disabled={connectLoading}
                            style={ss({padding:'10px 20px',borderRadius:10,border:'none',background:'#d97706',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:'pointer',color:'#fff',flexShrink:0})}>
                            {connectLoading ? <><i className="fas fa-spinner fa-spin"></i> Redirecting…</> : <>Complete Setup <i className="fas fa-arrow-right" style={{fontSize:10,marginLeft:4}}></i></>}
                          </button>
                        </div>
                      ) : (
                        <div style={ss({padding:'24px',background:'#f5f4f2',borderRadius:14,textAlign:'center'})}>
                          <div style={ss({width:64,height:64,borderRadius:'50%',background:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:14,boxShadow:'0 2px 8px rgba(0,0,0,.06)'})}>
                            <i className="fab fa-stripe-s" style={{fontSize:28,color:'#635bff'}}></i>
                          </div>
                          <div style={ss({fontSize:16,fontWeight:800,color:'#1c1917',marginBottom:6})}>Connect Your Bank Account</div>
                          <div style={ss({fontSize:13,fontWeight:500,color:'#78716c',marginBottom:18,maxWidth:400,margin:'0 auto 18px'})}>
                            Link your bank account through Stripe to receive automatic payouts when sessions are completed. Stripe handles all the security.
                          </div>
                          <button onClick={handleStripeConnect} disabled={connectLoading}
                            style={ss({padding:'12px 28px',borderRadius:12,border:'none',background:'#635bff',fontFamily:'inherit',fontSize:14,fontWeight:800,cursor:connectLoading?'wait':'pointer',color:'#fff',display:'inline-flex',alignItems:'center',gap:8})}>
                            {connectLoading ? <><i className="fas fa-spinner fa-spin"></i> Redirecting…</> : <><i className="fab fa-stripe-s" style={{fontSize:14}}></i> Connect with Stripe</>}
                          </button>
                          <div style={ss({marginTop:14,display:'flex',justifyContent:'center',gap:16,fontSize:11,color:'#a8a29e'})}>
                            <span><i className="fas fa-lock" style={{marginRight:4,fontSize:9}}></i>Secure</span>
                            <span><i className="fas fa-bolt" style={{marginRight:4,fontSize:9}}></i>2-3 day payouts</span>
                            <span><i className="fas fa-shield-halved" style={{marginRight:4,fontSize:9}}></i>Tax forms handled</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Fallback manual payout method */}
                    <div style={cardS}>
                      <SectionHead title="Alternative Payout Method" sub="Backup method if Stripe Connect is not available" />
                      <div style={ss({display:'flex',gap:8,marginBottom:20})}>
                        {[{id:'bank_transfer',label:'Bank Transfer',icon:'fa-building-columns'},{id:'paypal',label:'PayPal',icon:'fa-p'}].map(m => {
                          const on = paymentMethod === m.id;
                          return (
                            <button key={m.id} onClick={() => setPaymentMethod(m.id)}
                              style={ss({flex:1,padding:'12px 14px',borderRadius:12,border:on?'2px solid var(--stone-900)':'1px solid var(--border)',background:on?'var(--stone-900)':'var(--card)',color:on?'#fff':'var(--stone-700)',fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:8,transition:'all .12s'})}>
                              <i className={`fas ${m.icon}`} style={{fontSize:12}}></i>{m.label}
                            </button>
                          );
                        })}
                      </div>
                      {paymentMethod === 'bank_transfer' && (
                        <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14})}>
                          <div style={{gridColumn:'span 2'}}><label style={labelS}>Bank Name</label><input style={inputS} value={bankName} onChange={e=>setBankName(e.target.value)} placeholder="Chase, Bank of America, etc." /></div>
                          <div style={{gridColumn:'span 2'}}><label style={labelS}>Account Holder Name</label><input style={inputS} value={accountHolder} onChange={e=>setAccountHolder(e.target.value)} placeholder="Full legal name" /></div>
                          <div><label style={labelS}>Routing Number</label><input style={inputS} value={routingNumber} onChange={e=>setRoutingNumber(e.target.value.replace(/\D/g,'').slice(0,9))} placeholder="9 digits" maxLength={9} /></div>
                          <div><label style={labelS}>Account Number</label><input type="password" style={inputS} value={accountNumber} onChange={e=>setAccountNumber(e.target.value.replace(/\D/g,'').slice(0,17))} placeholder="Account number" /></div>
                        </div>
                      )}
                      {paymentMethod === 'paypal' && (
                        <div><label style={labelS}>PayPal Email Address</label><input type="email" style={inputS} value={paypalEmail} onChange={e=>setPaypalEmail(e.target.value)} placeholder="your-paypal@email.com" /></div>
                      )}
                      <div style={ss({marginTop:16})}><label style={labelS}>Payout Note (optional)</label><input style={inputS} value={paymentNote} onChange={e=>setPaymentNote(e.target.value)} placeholder="Preferred schedule, special instructions" /></div>
                    </div>

                    {/* Danger zone */}
                    <div style={{...cardS,borderColor:'#fecaca'}}>
                      <SectionHead title="Account" sub="Manage your counselor account" />
                      <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'12px 0'})}>
                        <div><div style={ss({fontSize:13,fontWeight:700,color:'#991b1b'})}>Deactivate Account</div><div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>Hides your profile and pauses all assignments</div></div>
                        <button style={ss({padding:'8px 14px',border:'2px solid #fecaca',background:'none',borderRadius:10,fontSize:11,fontWeight:800,color:'var(--red)',cursor:'pointer',fontFamily:'inherit',flexShrink:0})}>Deactivate</button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ═══ ADMIN MESSAGES TAB ═══ */}
                {activeTab === 'admin_messages' && (
                  <div style={{...cardS, padding:0, overflow:'hidden', height:'calc(100vh - 240px)', minHeight:400, display:'flex', flexDirection:'column'}}>
                    {/* Header */}
                    <div style={ss({padding:'16px 20px',borderBottom:'1px solid #f0efeb',display:'flex',alignItems:'center',gap:10})}>
                      <div style={ss({width:36,height:36,borderRadius:10,background:'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',color:'#FFE500',fontSize:14,fontWeight:900,flexShrink:0})}>A</div>
                      <div>
                        <div style={ss({fontSize:14,fontWeight:700,color:'#1c1917'})}>Admitly Admin</div>
                        <div style={ss({fontSize:11,color:'#a8a29e',fontWeight:500})}>Platform support & coordination</div>
                      </div>
                    </div>

                    {/* Messages */}
                    <div style={ss({flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:10,background:'#fafaf9'})}>
                      {adminMsgsLoading ? (
                        <div style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center'})}>
                          <i className="fas fa-spinner fa-spin" style={{fontSize:18,color:'#a8a29e'}}></i>
                        </div>
                      ) : adminMsgs.length === 0 ? (
                        <div style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center'})}>
                          <div style={ss({textAlign:'center',color:'#a8a29e'})}>
                            <div style={ss({width:56,height:56,borderRadius:16,background:'#f5f5f4',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:12})}>
                              <i className="fas fa-comment-dots" style={{fontSize:22,color:'#d6d3d1'}}></i>
                            </div>
                            <div style={ss({fontSize:14,fontWeight:700,color:'#57534e'})}>No messages yet</div>
                            <div style={ss({fontSize:12,marginTop:4})}>Send a message to the Admitly admin team</div>
                          </div>
                        </div>
                      ) : adminMsgs.map(m => (
                        <div key={m.id} style={ss({display:'flex',gap:8,flexDirection:m.sender_role==='counselor'?'row-reverse':'row',maxWidth:'80%',alignSelf:m.sender_role==='counselor'?'flex-end':'flex-start'})}>
                          {m.sender_role==='admin'&&(
                            <div style={ss({width:28,height:28,borderRadius:8,background:'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,fontWeight:800,color:'#FFE500',flexShrink:0,alignSelf:'flex-end'})}>A</div>
                          )}
                          <div>
                            <div style={ss({
                              padding:'10px 14px',
                              borderRadius:m.sender_role==='counselor'?'14px 14px 4px 14px':'14px 14px 14px 4px',
                              background:m.sender_role==='counselor'?'#1c1917':'#ffffff',
                              color:m.sender_role==='counselor'?'#fff':'#292524',
                              border:m.sender_role==='counselor'?'none':'1px solid #e7e5e4',
                              fontSize:13,fontWeight:500,lineHeight:1.55,whiteSpace:'pre-wrap' as const,
                            })}>
                              {m.body}
                            </div>
                            <div style={ss({fontSize:9,color:'#d6d3d1',marginTop:3,textAlign:m.sender_role==='counselor'?'right':'left',display:'flex',alignItems:'center',gap:4,justifyContent:m.sender_role==='counselor'?'flex-end':'flex-start'})}>
                              {m.sender_role==='counselor'&&m.is_read&&<i className="fas fa-check-double" style={{fontSize:8,color:'#004EEB'}}></i>}
                              {new Date(m.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={adminMsgEndRef}/>
                    </div>

                    {/* Compose */}
                    <div style={ss({padding:'12px 20px',background:'#fff',borderTop:'1px solid #e7e5e4',display:'flex',gap:8,alignItems:'flex-end'})}>
                      <textarea
                        value={adminMsgText}
                        onChange={e=>setAdminMsgText(e.target.value)}
                        placeholder="Message Admitly admin…"
                        rows={1}
                        onKeyDown={e=>{
                          if(e.key==='Enter'&&!e.shiftKey){
                            e.preventDefault();
                            if(!adminMsgText.trim()||adminMsgSending) return;
                            setAdminMsgSending(true);
                            fetch('/api/admin-messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:adminMsgText.trim()})})
                              .then(r=>r.json())
                              .then(d=>{if(d.id){setAdminMsgs(p=>[...p,d]);setAdminMsgText('');}})
                              .catch(()=>{})
                              .finally(()=>setAdminMsgSending(false));
                          }
                        }}
                        onInput={(e: React.FormEvent<HTMLTextAreaElement>)=>{const el=e.currentTarget;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}}
                        style={ss({flex:1,padding:'10px 14px',border:'1px solid #e7e5e4',borderRadius:12,fontFamily:'inherit',fontSize:13,fontWeight:500,resize:'none' as const,outline:'none',background:'#fafaf9',lineHeight:1.5,minHeight:42,maxHeight:120})}
                      />
                      <button
                        onClick={()=>{
                          if(!adminMsgText.trim()||adminMsgSending) return;
                          setAdminMsgSending(true);
                          fetch('/api/admin-messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:adminMsgText.trim()})})
                            .then(r=>r.json())
                            .then(d=>{if(d.id){setAdminMsgs(p=>[...p,d]);setAdminMsgText('');}})
                            .catch(()=>{})
                            .finally(()=>setAdminMsgSending(false));
                        }}
                        disabled={adminMsgSending||!adminMsgText.trim()}
                        style={ss({width:42,height:42,borderRadius:10,border:'none',
                          background:adminMsgText.trim()?'#1c1917':'#e7e5e4',
                          color:adminMsgText.trim()?'#FFE500':'#a8a29e',
                          cursor:adminMsgText.trim()?'pointer':'default',
                          flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,transition:'all .12s'})}
                      >
                        {adminMsgSending?<i className="fas fa-spinner fa-spin" style={{fontSize:12}}></i>:<i className="fas fa-paper-plane"></i>}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
