'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { POPULAR_MAJORS } from '@/lib/major-cip-map';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Settings {
  phone: string; parent_email: string; bio: string;
  high_school_name: string; high_school_city: string; high_school_state: string;
  graduation_year: number | ''; intended_major: string; intended_major_alt: string;
  gpa_scale: string; counselor_name: string; counselor_email: string;
  app_round: string; target_school_count: number; preferred_location: string;
  preferred_size: string; financial_aid_needed: boolean;
  email_reminders: boolean; deadline_alerts: boolean; weekly_summary: boolean;
  share_data_analytics: boolean; allow_counselor_access: boolean;
}

const DEFAULTS: Settings = {
  phone: '', parent_email: '', bio: '',
  high_school_name: '', high_school_city: '', high_school_state: 'PA',
  graduation_year: '', intended_major: '', intended_major_alt: '',
  gpa_scale: '4.0', counselor_name: '', counselor_email: '',
  app_round: 'Regular Decision', target_school_count: 8,
  preferred_location: '', preferred_size: '',
  financial_aid_needed: false, email_reminders: true,
  deadline_alerts: true, weekly_summary: false,
  share_data_analytics: true, allow_counselor_access: true,
};

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const CURRENT_YEAR = new Date().getFullYear();
const GRAD_YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR + i);
const GPA_SCALES = ['4.0', '5.0'];
const APP_ROUNDS = ['Early Decision (ED)', 'Early Action (EA)', 'Restrictive EA', 'Regular Decision', 'Rolling Admission', 'Undecided'];
const SCHOOL_SIZES = ['Small (<5k)', 'Medium (5k-15k)', 'Large (15k-30k)', 'Very Large (>30k)', 'No preference'];
// POPULAR_MAJORS imported from @/lib/major-cip-map

interface Activity   { id: string; name: string; role: string; years: string; hours_per_week: number; impact: string; story_moment: string; essay_worthy: boolean; }
interface Honor      { id: string; name: string; level: string; year: string; context: string; }
interface Experience { id: string; title: string; timeframe: string; what_happened: string; what_changed: string; essay_worthy: boolean; }
interface IdentityBlock { family_background: string; challenge_overcome: string; three_words: string; grades_dont_show: string; proud_of_outside_school: string; }
interface GoalsBlock    { career_direction: string; intended_college_major: string; why_college_now: string; ten_year_vision: string; }
interface Journey { activities: Activity[]; honors: Honor[]; experiences: Experience[]; identity: IdentityBlock; goals: GoalsBlock; }

const IDENTITY_DEFAULTS: IdentityBlock = { family_background: '', challenge_overcome: '', three_words: '', grades_dont_show: '', proud_of_outside_school: '' };
const GOALS_DEFAULTS: GoalsBlock = { career_direction: '', intended_college_major: '', why_college_now: '', ten_year_vision: '' };
const JOURNEY_DEFAULTS: Journey = { activities: [], honors: [], experiences: [], identity: IDENTITY_DEFAULTS, goals: GOALS_DEFAULTS };

function uid() { return Math.random().toString(36).slice(2, 9); }
const HONOR_LEVELS = ['school', 'regional', 'state', 'national', 'international'];

const ss = (o: React.CSSProperties) => o;
const inputS: React.CSSProperties = {width:'100%',padding:'10px 14px',background:'#fff',border:'1px solid #dcdbd7',borderRadius:10,fontSize:13,fontWeight:500,fontFamily:'inherit',outline:'none',color:'#1c1917',transition:'border-color .15s',boxSizing:'border-box' as const};
const labelS: React.CSSProperties = {fontSize:11,fontWeight:600,color:'#78716c',display:'block',marginBottom:6};
const errS: React.CSSProperties = {fontSize:10,fontWeight:700,color:'var(--red)',marginTop:4,display:'flex',alignItems:'center',gap:4};

// ── Validation ───────────────────────────────────────────────────────────────
const SSN_REGEX = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/;
const PHONE_REGEX = /^$|^\+?1?\s*[-.(]?\d{3}[-.)]\s*\d{3}[-.\s]?\d{4}$/;
const EMAIL_REGEX = /^$|^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function containsSSN(val: string): boolean { return SSN_REGEX.test(val); }
function isValidPhone(val: string): boolean { return !val.trim() || PHONE_REGEX.test(val.trim()); }
function isValidEmail(val: string): boolean { return !val.trim() || EMAIL_REGEX.test(val.trim()); }

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <div style={errS}><i className="fas fa-circle-exclamation" style={{fontSize:9}}></i> {msg}</div>;
}

function SectionHead({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div style={ss({display:'flex',alignItems:'center',gap:12,marginBottom:20,paddingBottom:16,borderBottom:'1px solid #f0efeb'})}>
      <div style={ss({width:36,height:36,borderRadius:10,background:'#f5f4f2',display:'flex',alignItems:'center',justifyContent:'center',color:'#78716c',flexShrink:0,fontSize:14})}>
        <i className={`fas ${icon}`}></i>
      </div>
      <div>
        <h2 style={ss({fontSize:15,fontWeight:700,color:'#1c1917'})}>{title}</h2>
        <p style={ss({fontSize:12,fontWeight:400,color:'#a8a29e',marginTop:1})}>{subtitle}</p>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  return (
    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'16px 0',borderBottom:'1px solid #f5f4f2'})}>
      <div style={ss({minWidth:0})}>
        <div style={ss({fontSize:14,fontWeight:500,color:'#1c1917'})}>{label}</div>
        <div style={ss({fontSize:12,fontWeight:400,color:'#a8a29e',marginTop:3})}>{sub}</div>
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        style={ss({position:'relative',flexShrink:0,width:44,height:24,borderRadius:12,border:'none',cursor:'pointer',transition:'background .2s',
          background:checked?'#22c55e':'#d6d3d1'})}>
        <span style={ss({position:'absolute',top:2,left:checked?22:2,width:20,height:20,borderRadius:'50%',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.15)',transition:'left .2s'})} />
      </button>
    </div>
  );
}

const cardS: React.CSSProperties = {background:'#ffffff',border:'1px solid #eae9e5',borderRadius:16,padding:24};

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [saveState, setSaveState] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [isLoading, setIsLoading] = useState(true);
  const [journey, setJourney] = useState<Journey>(JOURNEY_DEFAULTS);
  const [journeySave, setJourneySave] = useState<'idle'|'saving'|'saved'|'error'>('idle');
  const [activeTab, setActiveTab] = useState<'profile'|'academic'|'notifications'|'security'|'journey'|'danger'>('profile');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [navSearch, setNavSearch] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [journeyErrors, setJourneyErrors] = useState<Record<string, string>>({});
  // Security / Change Password
  const [pwStep, setPwStep] = useState<'form'|'code'|'done'>('form');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwCode, setPwCode] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwResendTimer, setPwResendTimer] = useState(0);
  const role = (session?.user as any)?.role || 'student';

  useEffect(() => {
    if (status === 'authenticated' && role === 'counselor') {
      router.replace('/settings/counselor');
      return;
    }
    if (status === 'authenticated' && role !== 'counselor') {
      const loadSettings = async () => {
        try {
          const [sRes, jRes] = await Promise.all([
            fetch('/api/settings', { cache: 'no-store' }).catch(() => null),
            fetch('/api/journey', { cache: 'no-store' }).catch(() => null),
          ]);
          const sData = sRes && sRes.ok ? await sRes.json().catch(() => DEFAULTS) : DEFAULTS;
          const jData = jRes && jRes.ok ? await jRes.json().catch(() => JOURNEY_DEFAULTS) : JOURNEY_DEFAULTS;
          setSettings({ ...DEFAULTS, ...sData, graduation_year: sData?.graduation_year ?? (CURRENT_YEAR + 1) });
          setJourney({ ...JOURNEY_DEFAULTS, ...jData });
        } catch (e) { console.error('[Settings] load failed:', e); }
        setIsLoading(false);
      };
      loadSettings();
    }
  }, [status, role, router]);

  // Password change resend timer
  useEffect(() => {
    if (pwResendTimer <= 0) return;
    const t = setTimeout(() => setPwResendTimer(pwResendTimer - 1), 1000);
    return () => clearTimeout(t);
  }, [pwResendTimer]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(prev => ({ ...prev, [key]: value }));
    // Live validation
    const v = String(value);
    const errs = { ...fieldErrors };
    if (key === 'phone') {
      if (containsSSN(v)) errs.phone = 'This looks like a Social Security number. Do not enter SSNs.';
      else if (!isValidPhone(v)) errs.phone = 'Enter a valid phone number, e.g. (555) 123-4567';
      else delete errs.phone;
    }
    if (key === 'parent_email') {
      if (containsSSN(v)) errs.parent_email = 'Do not enter Social Security numbers.';
      else if (!isValidEmail(v)) errs.parent_email = 'Enter a valid email address';
      else delete errs.parent_email;
    }
    if (key === 'counselor_email') {
      if (containsSSN(v)) errs.counselor_email = 'Do not enter Social Security numbers.';
      else if (!isValidEmail(v)) errs.counselor_email = 'Enter a valid email address';
      else delete errs.counselor_email;
    }
    if (key === 'bio') {
      if (containsSSN(v)) errs.bio = 'Do not include Social Security numbers in your bio.';
      else delete errs.bio;
    }
    // SSN check on any free-text settings field
    if (['high_school_name','high_school_city','counselor_name','preferred_location'].includes(key as string)) {
      if (containsSSN(v)) errs[key as string] = 'Do not enter Social Security numbers.';
      else delete errs[key as string];
    }
    setFieldErrors(errs);
  }

  function validateAll(): boolean {
    const errs: Record<string,string> = {};
    if (!settings.high_school_state) errs.high_school_state = 'State is required';
    if (settings.phone && !isValidPhone(settings.phone)) errs.phone = 'Enter a valid phone number';
    if (settings.phone && containsSSN(settings.phone)) errs.phone = 'This looks like an SSN. Do not enter SSNs.';
    if (settings.parent_email && !isValidEmail(settings.parent_email)) errs.parent_email = 'Enter a valid email address';
    if (settings.parent_email && containsSSN(settings.parent_email)) errs.parent_email = 'Do not enter SSNs.';
    if (settings.counselor_email && !isValidEmail(settings.counselor_email)) errs.counselor_email = 'Enter a valid email address';
    if (containsSSN(settings.bio)) errs.bio = 'Remove Social Security number from bio';
    // Check all string fields for SSN
    for (const [k,v] of Object.entries(settings)) {
      if (typeof v === 'string' && containsSSN(v) && !errs[k]) errs[k] = 'Do not enter Social Security numbers.';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  // Journey field SSN checker — validates on change, stores errors keyed by fieldKey
  function checkJourneySSN(fieldKey: string, value: string) {
    setJourneyErrors(prev => {
      const next = { ...prev };
      if (containsSSN(value)) next[fieldKey] = 'Contains what looks like a Social Security number — please remove it';
      else delete next[fieldKey];
      return next;
    });
  }

  function validateAllJourney(): boolean {
    const errs: Record<string, string> = {};
    const ssnMsg = 'Contains what looks like a Social Security number — please remove it';
    for (const a of journey.activities) {
      for (const f of ['name','role','impact','story_moment'] as const) { if (containsSSN(a[f])) errs[`act_${a.id}_${f}`] = ssnMsg; }
    }
    for (const h of journey.honors) {
      for (const f of ['name','context'] as const) { if (containsSSN(h[f])) errs[`hon_${h.id}_${f}`] = ssnMsg; }
    }
    for (const e of journey.experiences) {
      for (const f of ['title','what_happened','what_changed'] as const) { if (containsSSN(e[f])) errs[`exp_${e.id}_${f}`] = ssnMsg; }
    }
    for (const [k, v] of Object.entries(journey.identity)) { if (containsSSN(v as string)) errs[`id_${k}`] = ssnMsg; }
    for (const [k, v] of Object.entries(journey.goals)) { if (containsSSN(v as string)) errs[`goal_${k}`] = ssnMsg; }
    setJourneyErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSave() {
    if (!validateAll()) return;
    setSaveState('saving');
    try {
      const payload = {
        ...settings,
        graduation_year: settings.graduation_year ? parseInt(String(settings.graduation_year)) : null,
        target_school_count: parseInt(String(settings.target_school_count)) || 8,
      };
      const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[Settings Save]', res.status, errBody);
        throw new Error(errBody.error || 'Save failed');
      }
      setSaveState('saved'); setTimeout(() => setSaveState('idle'), 3000);
    } catch (err) { console.error('[Settings Save]', err); setSaveState('error'); setTimeout(() => setSaveState('idle'), 3000); }
  }

  async function deleteAccount() {
    setDeleteError('');
    setDeletingAccount(true);
    try {
      const res = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: deleteConfirmEmail, reason: deleteReason || 'No reason provided' }),
      });
      const data = await res.json();
      if (res.ok) {
        await signOut({ callbackUrl: '/login' });
      } else {
        setDeleteError(data.error || 'Failed to delete account.');
        setDeletingAccount(false);
      }
    } catch {
      setDeleteError('An error occurred. Please try again.');
      setDeletingAccount(false);
    }
  }

  async function saveJourney() {
    if (!validateAllJourney()) { setJourneySave('error'); setTimeout(() => setJourneySave('idle'), 3000); return; }
    setJourneySave('saving');
    try {
      const res = await fetch('/api/journey', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(journey) });
      if (!res.ok) throw new Error();
      setJourneySave('saved'); setTimeout(() => setJourneySave('idle'), 3000);
    } catch { setJourneySave('error'); setTimeout(() => setJourneySave('idle'), 3000); }
  }

  function addActivity()   { setJourney(j => ({ ...j, activities: [...j.activities, { id: uid(), name:'', role:'', years:'', hours_per_week:5, impact:'', story_moment:'', essay_worthy:false }] })); }
  function removeActivity(id: string)  { setJourney(j => ({ ...j, activities: j.activities.filter(a => a.id !== id) })); }
  function updateActivity(id: string, patch: Partial<Activity>) {
    setJourney(j => ({ ...j, activities: j.activities.map(a => a.id === id ? { ...a, ...patch } : a) }));
    for (const [f, v] of Object.entries(patch)) { if (typeof v === 'string') checkJourneySSN(`act_${id}_${f}`, v); }
  }
  function addHonor()      { setJourney(j => ({ ...j, honors: [...j.honors, { id: uid(), name:'', level:'school', year:'', context:'' }] })); }
  function removeHonor(id: string)     { setJourney(j => ({ ...j, honors: j.honors.filter(h => h.id !== id) })); }
  function updateHonor(id: string, patch: Partial<Honor>) {
    setJourney(j => ({ ...j, honors: j.honors.map(h => h.id === id ? { ...h, ...patch } : h) }));
    for (const [f, v] of Object.entries(patch)) { if (typeof v === 'string') checkJourneySSN(`hon_${id}_${f}`, v); }
  }
  function addExperience() { setJourney(j => ({ ...j, experiences: [...j.experiences, { id: uid(), title:'', timeframe:'', what_happened:'', what_changed:'', essay_worthy:false }] })); }
  function removeExperience(id: string){ setJourney(j => ({ ...j, experiences: j.experiences.filter(e => e.id !== id) })); }
  function updateExperience(id: string, patch: Partial<Experience>) {
    setJourney(j => ({ ...j, experiences: j.experiences.map(e => e.id === id ? { ...e, ...patch } : e) }));
    for (const [f, v] of Object.entries(patch)) { if (typeof v === 'string') checkJourneySSN(`exp_${id}_${f}`, v); }
  }
  function setIdentity(patch: Partial<IdentityBlock>) {
    setJourney(j => ({ ...j, identity: { ...j.identity, ...patch } }));
    for (const [f, v] of Object.entries(patch)) { if (typeof v === 'string') checkJourneySSN(`id_${f}`, v); }
  }
  function setGoals(patch: Partial<GoalsBlock>) {
    setJourney(j => ({ ...j, goals: { ...j.goals, ...patch } }));
    for (const [f, v] of Object.entries(patch)) { if (typeof v === 'string') checkJourneySSN(`goal_${f}`, v); }
  }

  const initials = session?.user?.name?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) ?? '??';

  const TABS = [
    { id: 'profile',       icon: 'fa-user',            label: 'Personal',       group: 'PROFILE' },
    { id: 'academic',      icon: 'fa-graduation-cap',  label: 'Academic',       group: 'PROFILE' },
    { id: 'journey',       icon: 'fa-book-open-reader',label: 'My Journey',     group: 'JOURNEY' },
    { id: 'notifications', icon: 'fa-bell',            label: 'Notifications',  group: 'ACCOUNT' },
    { id: 'security',      icon: 'fa-shield-halved',    label: 'Security',       group: 'ACCOUNT' },
    { id: 'danger',        icon: 'fa-triangle-exclamation', label: 'Danger Zone', group: 'ACCOUNT' },
  ] as const;

  function SaveBtn({ state, onClick, label }: { state: string; onClick: () => void; label: string }) {
    const bg = state === 'saved' ? '#22c55e' : state === 'error' ? '#ef4444' : state === 'saving' ? '#e7e5e4' : '#fbbf24';
    const color = state === 'saving' ? '#78716c' : state === 'saved' || state === 'error' ? '#fff' : '#000';
    const icon = state === 'saving' ? 'fa-spinner fa-spin' : state === 'saved' ? 'fa-check' : state === 'error' ? 'fa-exclamation' : 'fa-floppy-disk';
    const text = state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved!' : state === 'error' ? 'Error' : label;
    return (
      <button onClick={onClick} disabled={state === 'saving'}
        style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'9px 20px',borderRadius:999,border:'none',fontFamily:'inherit',fontSize:13,fontWeight:600,cursor:state==='saving'?'not-allowed':'pointer',background:bg,color,transition:'all .15s'})}>
        <i className={`fas ${icon}`} style={{fontSize:11}}></i> {text}
      </button>
    );
  }

  return (
    <AppShell>
      <div style={ss({flex:1,display:'flex',minHeight:'100vh',background:'#f5f4f2'})}>

        {/* ── LEFT SETTINGS NAV ── */}
        <div style={ss({width:220,flexShrink:0,background:'#fff',borderRight:'1px solid #e7e5e4',padding:'32px 0',display:'flex',flexDirection:'column',overflowY:'auto'})}>
          <div style={ss({padding:'0 20px 20px',borderBottom:'1px solid #f0eeec',marginBottom:8})}>
            <div style={ss({fontSize:11,fontWeight:700,color:'#a8a29e',textTransform:'uppercase',letterSpacing:'0.4px'})}>Settings</div>
          </div>
          {(['PROFILE','JOURNEY','ACCOUNT'] as const).map(group => {
            const items = TABS.filter(t => t.group === group);
            return (
              <div key={group} style={ss({marginBottom:4})}>
                <div style={ss({fontSize:10,fontWeight:700,color:'#c4bfbb',textTransform:'uppercase',letterSpacing:'0.4px',padding:'12px 20px 4px'})}>
                  {group === 'PROFILE' ? 'Profile' : group === 'JOURNEY' ? 'Journey' : 'Account'}
                </div>
                {items.map(tab => {
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
                    </button>
                  );
                })}
              </div>
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
                  {activeTab==='profile'&&'Contact details for you and your family'}
                  {activeTab==='academic'&&'School info, intended major, and counselor'}
                  {activeTab==='journey'&&'Activities, experiences, and goals that power your essays'}
                  {activeTab==='notifications'&&'Notifications, privacy, and data controls'}
                  {activeTab==='security'&&'Change your password and manage account security'}
                  {activeTab==='danger'&&'Permanent actions — proceed with caution'}
                </p>
              </div>
              {activeTab !== 'danger' && (
                activeTab === 'journey'
                  ? <SaveBtn state={journeySave} onClick={saveJourney} label="Save Changes" />
                  : <SaveBtn state={saveState} onClick={handleSave} label="Save Changes" />
              )}
            </div>

          {isLoading ? (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:192,color:'#78716c',fontSize:13,fontWeight:500})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i> Loading settings…
            </div>
          ) : (
            <>
              {/* PERSONAL */}
              {activeTab === 'profile' && (
                <div style={cardS}>
                  <SectionHead icon="fa-id-card" title="Personal Information" subtitle="Contact details for you and your family." />
                  <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:16})}>
                    <div><label style={labelS}>Full Name</label><input style={{...inputS,background:'#f5f4f2',color:'#a8a29e'}} value={session?.user?.name ?? ''} readOnly /></div>
                    <div><label style={labelS}>Email</label><input style={{...inputS,background:'#f5f4f2',color:'#a8a29e'}} value={session?.user?.email ?? ''} readOnly /></div>
                    <div>
                      <label style={labelS}>Phone <span style={{fontWeight:500,color:'var(--stone-300)',textTransform:'none'}}>Optional</span></label>
                      <input type="tel" style={{...inputS,borderColor:fieldErrors.phone?'var(--red)':'var(--border)'}} placeholder="(555) 000-0000" value={settings.phone} onChange={e => set('phone', e.target.value)} />
                      <FieldError msg={fieldErrors.phone} />
                    </div>
                    <div>
                      <label style={labelS}>Parent / Guardian Email</label>
                      <input type="email" style={{...inputS,borderColor:fieldErrors.parent_email?'var(--red)':'var(--border)'}} placeholder="parent@email.com" value={settings.parent_email} onChange={e => set('parent_email', e.target.value)} />
                      <FieldError msg={fieldErrors.parent_email} />
                    </div>
                  </div>
                  <div style={ss({marginTop:16})}>
                    <label style={labelS}>Short Bio <span style={{fontWeight:500,color:'var(--stone-300)',textTransform:'none'}}>{settings.bio.length}/300</span></label>
                    <textarea maxLength={300} rows={3} style={{...inputS,resize:'none',borderColor:fieldErrors.bio?'var(--red)':'var(--border)'}} placeholder="Tell your story in a sentence or two…" value={settings.bio} onChange={e => set('bio', e.target.value)} />
                    <FieldError msg={fieldErrors.bio} />
                  </div>
                </div>
              )}

              {/* ACADEMIC */}
              {activeTab === 'academic' && (
                <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                  <div style={cardS}>
                    <SectionHead icon="fa-school" title="High School" subtitle="Where you're currently enrolled." />
                    <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:16})}>
                      <div style={ss({gridColumn:'span 2'})}>
                        <label style={labelS}>High School Name</label>
                        <input style={{...inputS,borderColor:fieldErrors.high_school_name?'var(--red)':'var(--border)'}} placeholder="Downingtown High School" value={settings.high_school_name} onChange={e => set('high_school_name', e.target.value)} />
                        <FieldError msg={fieldErrors.high_school_name} />
                      </div>
                      <div>
                        <label style={labelS}>City</label>
                        <input style={{...inputS,borderColor:fieldErrors.high_school_city?'var(--red)':'var(--border)'}} placeholder="Exton" value={settings.high_school_city} onChange={e => set('high_school_city', e.target.value)} />
                        <FieldError msg={fieldErrors.high_school_city} />
                      </div>
                      <div>
                        <label style={labelS}>State <span style={{color:'var(--red)'}}>*</span></label>
                        <select style={{...inputS,borderColor:fieldErrors.high_school_state?'var(--red)':'var(--border)'}} value={settings.high_school_state} onChange={e => set('high_school_state', e.target.value)}>
                          <option value="">Select…</option>{US_STATES.map(s => <option key={s}>{s}</option>)}
                        </select>
                        <FieldError msg={fieldErrors.high_school_state} />
                      </div>
                      <div><label style={labelS}>Graduation Year</label><select style={inputS} value={settings.graduation_year} onChange={e => set('graduation_year', e.target.value ? parseInt(e.target.value) : '')}><option value="">Select…</option>{GRAD_YEARS.map(y => <option key={y}>{y}</option>)}</select></div>
                      <div><label style={labelS}>GPA Scale</label><select style={inputS} value={settings.gpa_scale} onChange={e => set('gpa_scale', e.target.value)}>{GPA_SCALES.map(s => <option key={s}>{s}</option>)}</select></div>
                    </div>
                  </div>
                  <div style={cardS}>
                    <SectionHead icon="fa-book-open" title="Intended Major" subtitle="Your first choice and preferred region." />
                    <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:16})}>
                      <div><label style={labelS}>Primary Major</label><select style={inputS} value={settings.intended_major} onChange={e => set('intended_major', e.target.value)}><option value="">Select…</option>{POPULAR_MAJORS.map(m => <option key={m}>{m}</option>)}</select></div>
                      <div>
                        <label style={labelS}>Preferred Location</label>
                        <input style={{...inputS,borderColor:fieldErrors.preferred_location?'var(--red)':'var(--border)'}} placeholder="e.g. Northeast, West Coast, California" value={settings.preferred_location} onChange={e => set('preferred_location', e.target.value)} />
                        <FieldError msg={fieldErrors.preferred_location} />
                      </div>
                    </div>
                  </div>
                  <div style={cardS}>
                    <SectionHead icon="fa-user-tie" title="School Counselor" subtitle="Used to pre-fill your printable counselor report." />
                    <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:16})}>
                      <div><label style={labelS}>Counselor Name</label><input style={{...inputS,borderColor:fieldErrors.counselor_name?'var(--red)':'var(--border)'}} placeholder="Ms. Rivera" value={settings.counselor_name} onChange={e => set('counselor_name', e.target.value)} />
                        <FieldError msg={fieldErrors.counselor_name} />
                      </div>
                      <div><label style={labelS}>Counselor Email</label><input type="email" style={{...inputS,borderColor:fieldErrors.counselor_email?'var(--red)':'var(--border)'}} placeholder="mrivera@school.edu" value={settings.counselor_email} onChange={e => set('counselor_email', e.target.value)} />
                        <FieldError msg={fieldErrors.counselor_email} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* NOTIFICATIONS */}
              {activeTab === 'notifications' && (
                <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                  <div style={cardS}>
                    <SectionHead icon="fa-bell" title="Notifications" subtitle="Choose what updates you want to receive." />
                    <Toggle checked={settings.email_reminders} onChange={v => { set('email_reminders', v); fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,email_reminders:v})}); }} label="Email reminders" sub="Application checklist reminders and nudges" />
                    <Toggle checked={settings.deadline_alerts} onChange={v => { set('deadline_alerts', v); fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,deadline_alerts:v})}); }} label="Deadline alerts" sub="Alerts 30, 14, and 7 days before application deadlines" />
                    <Toggle checked={settings.weekly_summary} onChange={v => { set('weekly_summary', v); fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,weekly_summary:v})}); }} label="Weekly progress summary" sub="A weekly email showing your college list progress and essay word counts" />
                  </div>
                  <div style={cardS}>
                    <SectionHead icon="fa-shield-halved" title="Privacy & Data" subtitle="Control how your information is used." />
                    <Toggle checked={settings.share_data_analytics} onChange={v => { set('share_data_analytics', v); fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,share_data_analytics:v})}); }} label="Share anonymized usage data" sub="Help improve the app by sharing anonymized interaction data." />
                    <Toggle checked={settings.allow_counselor_access} onChange={v => { set('allow_counselor_access', v); fetch('/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...settings,allow_counselor_access:v})}); }} label="Share academic data with counselor" sub="When on, your assigned expert counselor can view your GPA, school, college list, essays, journey, and admissions score. Messaging, action items, notes, and sessions are always accessible." />
                  </div>
                </div>
              )}

              {/* SECURITY */}
              {activeTab === 'security' && (
                <div style={cardS}>
                  <SectionHead icon="fa-shield-halved" title="Change Password" subtitle="Update your account password. You'll verify via email before the change takes effect." />
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
                      <div style={ss({fontSize:13,color:'var(--stone-500)',marginBottom:16,lineHeight:1.6})}>We sent a 6-digit verification code to <strong style={{color:'var(--stone-700)'}}>{session?.user?.email}</strong>. Enter it below to confirm your password change.</div>
                      <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',display:'block',marginBottom:6})}>Verification Code</label>
                      <input type="text" inputMode="numeric" maxLength={6} value={pwCode} onChange={e=>setPwCode(e.target.value.replace(/\D/g,''))} placeholder="000000"
                        style={ss({width:'100%',padding:'12px 16px',borderRadius:10,border:'1px solid var(--border)',fontSize:24,fontWeight:800,letterSpacing:8,textAlign:'center',fontFamily:'monospace',outline:'none',marginBottom:12})}/>
                      {pwError&&<div style={ss({fontSize:12,color:'#dc2626',fontWeight:600,marginBottom:10,padding:'8px 12px',background:'#fef2f2',borderRadius:8})}>{pwError}</div>}
                      <button disabled={pwLoading||pwCode.length!==6} onClick={async()=>{
                        setPwError('');setPwLoading(true);
                        try{
                          // Verify code
                          const vRes=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify',email:session?.user?.email,code:pwCode,purpose:'password_change'})});
                          if(!vRes.ok){const d=await vRes.json();setPwError(d.error);setPwLoading(false);return;}
                          // Change password
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
                      <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',display:'block',marginBottom:6})}>Current Password</label>
                      <input type="password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} placeholder="Enter current password"
                        style={ss({width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:14})}/>
                      <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',display:'block',marginBottom:6})}>New Password</label>
                      <input type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="At least 8 characters"
                        style={ss({width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:14})}/>
                      <label style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',display:'block',marginBottom:6})}>Confirm New Password</label>
                      <input type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} placeholder="Re-enter new password"
                        style={ss({width:'100%',padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',fontSize:13,fontFamily:'inherit',outline:'none',marginBottom:14})}/>
                      {pwError&&<div style={ss({fontSize:12,color:'#dc2626',fontWeight:600,marginBottom:10,padding:'8px 12px',background:'#fef2f2',borderRadius:8})}>{pwError}</div>}
                      <button disabled={pwLoading} onClick={async()=>{
                        setPwError('');
                        if(!currentPw){setPwError('Please enter your current password.');return;}
                        if(newPw.length<8){setPwError('New password must be at least 8 characters.');return;}
                        if(newPw!==confirmPw){setPwError('New passwords do not match.');return;}
                        if(currentPw===newPw){setPwError('New password must be different from current password.');return;}
                        setPwLoading(true);
                        // Verify current password first
                        try{
                          const vRes=await fetch('/api/account/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'verify_current',current_password:currentPw})});
                          if(!vRes.ok){const d=await vRes.json();setPwError(d.error);setPwLoading(false);return;}
                          // Send verification code
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

              {/* DANGER ZONE */}
              {activeTab === 'danger' && (
                <div style={{...cardS,borderColor:'#fecaca'}}>
                  <SectionHead icon="fa-triangle-exclamation" title="Danger Zone" subtitle="These actions are permanent and cannot be undone." />
                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'12px 0',borderBottom:'1px solid var(--border-light)'})}>
                    <div><div style={ss({fontSize:13,fontWeight:700})}>Delete all my essays</div><div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>Permanently removes all saved essay drafts</div></div>
                    <button onClick={async () => { if (!window.confirm('Delete all essays? This cannot be undone.')) return; await fetch('/api/essays', { method: 'DELETE' }); }}
                      style={ss({padding:'8px 14px',border:'2px solid #fecaca',background:'none',borderRadius:10,fontSize:11,fontWeight:800,color:'var(--red)',cursor:'pointer',fontFamily:'inherit',flexShrink:0})}>Delete Essays</button>
                  </div>
                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'12px 0',borderBottom:'1px solid var(--border-light)'})}>
                    <div><div style={ss({fontSize:13,fontWeight:700})}>Delete all my college data</div><div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>Clears your Reach / Target / Safety lists permanently</div></div>
                    <button onClick={async () => { if (!window.confirm('Delete all college data? This cannot be undone.')) return; await fetch('/api/colleges', { method: 'DELETE' }); }}
                      style={ss({padding:'8px 14px',border:'2px solid #fecaca',background:'none',borderRadius:10,fontSize:11,fontWeight:800,color:'var(--red)',cursor:'pointer',fontFamily:'inherit',flexShrink:0})}>Delete Colleges</button>
                  </div>
                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:14,marginTop:8,borderRadius:14,background:'var(--red-light)'})}>
                    <div><div style={ss({fontSize:13,fontWeight:900,color:'#991b1b'})}>Delete My Account</div><div style={ss({fontSize:11,fontWeight:500,color:'#dc2626',marginTop:2})}>Your data will be retained for 30 days, then permanently purged.</div></div>
                    <button onClick={()=>{setDeleteModal(true);setDeleteConfirmEmail('');setDeleteReason('');setDeleteError('');}}
                      style={ss({padding:'8px 14px',background:'var(--red)',borderRadius:10,border:'none',fontSize:11,fontWeight:800,color:'#fff',cursor:'pointer',fontFamily:'inherit',flexShrink:0})}>Delete Account</button>
                  </div>
                </div>
              )}

              {/* ═══ Delete Account Confirmation Modal ═══ */}
              {deleteModal && (
                <>
                  <div onClick={()=>setDeleteModal(false)} style={ss({position:'fixed',inset:0,zIndex:9998,background:'rgba(0,0,0,.4)',backdropFilter:'blur(3px)'})} />
                  <div style={ss({position:'fixed',top:'50%',left:'50%',transform:'translate(-50%,-50%)',width:460,background:'var(--card)',border:'1px solid var(--border)',borderRadius:18,padding:'32px',boxShadow:'0 25px 60px rgba(0,0,0,.2)',zIndex:9999})}>
                    {/* Header */}
                    <div style={ss({display:'flex',alignItems:'center',gap:14,marginBottom:20})}>
                      <div style={ss({width:48,height:48,borderRadius:14,background:'var(--red-light)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                        <i className="fas fa-triangle-exclamation" style={{fontSize:20,color:'var(--red)'}}></i>
                      </div>
                      <div>
                        <div style={ss({fontSize:18,fontWeight:900,color:'#991b1b'})}>Delete your account?</div>
                        <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-500)',marginTop:2})}>This action cannot be undone after 30 days</div>
                      </div>
                      <button onClick={()=>setDeleteModal(false)} style={ss({marginLeft:'auto',width:30,height:30,borderRadius:8,border:'none',background:'var(--stone-100)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'var(--stone-500)',flexShrink:0})}>
                        <i className="fas fa-times"></i>
                      </button>
                    </div>

                    {/* What happens */}
                    <div style={ss({background:'var(--stone-50)',borderRadius:12,padding:'14px 16px',marginBottom:20,fontSize:12,fontWeight:500,color:'var(--stone-600)',lineHeight:1.7})}>
                      <div style={ss({fontWeight:800,color:'var(--stone-800)',marginBottom:6})}>What happens when you delete:</div>
                      <div style={ss({display:'flex',flexDirection:'column',gap:4})}>
                        <div><i className="fas fa-lock" style={{fontSize:9,color:'var(--stone-400)',marginRight:6,width:12}}></i>Your account will be locked immediately</div>
                        <div><i className="fas fa-clock" style={{fontSize:9,color:'var(--stone-400)',marginRight:6,width:12}}></i>Data is retained for 30 days, then permanently purged</div>
                        <div><i className="fas fa-envelope" style={{fontSize:9,color:'var(--stone-400)',marginRight:6,width:12}}></i>Contact support within 30 days to recover your account</div>
                        <div><i className="fas fa-trash" style={{fontSize:9,color:'var(--red)',marginRight:6,width:12}}></i>After 30 days: essays, colleges, profile — all gone forever</div>
                      </div>
                    </div>

                    {/* Reason */}
                    <div style={ss({marginBottom:16})}>
                      <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',display:'block',marginBottom:6})}>Why are you leaving? <span style={{textTransform:'none',fontWeight:500}}>(optional)</span></label>
                      <select value={deleteReason} onChange={e=>setDeleteReason(e.target.value)}
                        style={ss({width:'100%',padding:'10px 12px',background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:10,fontFamily:'inherit',fontSize:12,fontWeight:600,color:'var(--stone-800)',outline:'none',appearance:'none' as any,cursor:'pointer',boxSizing:'border-box'})}>
                        <option value="">Select a reason…</option>
                        <option value="Already accepted to college">Already accepted to college</option>
                        <option value="Not finding it useful">Not finding it useful</option>
                        <option value="Too expensive">Too expensive</option>
                        <option value="Using another tool">Using another tool</option>
                        <option value="Privacy concerns">Privacy concerns</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>

                    {/* Email confirmation */}
                    <div style={ss({marginBottom:16})}>
                      <label style={ss({fontSize:10,fontWeight:700,color:'#991b1b',textTransform:'uppercase',letterSpacing:'0.3px',display:'block',marginBottom:6})}>Type your email to confirm</label>
                      <input type="email" value={deleteConfirmEmail} onChange={e=>setDeleteConfirmEmail(e.target.value)} placeholder={session?.user?.email || 'your@email.com'}
                        style={ss({width:'100%',padding:'10px 12px',background:'#fff',border:'2px solid #fecaca',borderRadius:10,fontFamily:'inherit',fontSize:13,fontWeight:700,color:'#991b1b',outline:'none',boxSizing:'border-box'})} />
                    </div>

                    {deleteError && (
                      <div style={ss({display:'flex',alignItems:'center',gap:8,padding:'10px 14px',background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,marginBottom:16})}>
                        <i className="fas fa-circle-exclamation" style={{color:'var(--red)',fontSize:12}}></i>
                        <p style={ss({fontSize:12,color:'#dc2626',fontWeight:600,margin:0})}>{deleteError}</p>
                      </div>
                    )}

                    <div style={ss({display:'flex',gap:10,justifyContent:'flex-end'})}>
                      <button onClick={()=>setDeleteModal(false)} style={ss({padding:'10px 20px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontFamily:'inherit',fontSize:13,fontWeight:700,color:'var(--stone-600)',cursor:'pointer'})}>Cancel</button>
                      <button onClick={deleteAccount} disabled={deletingAccount || deleteConfirmEmail.toLowerCase().trim() !== (session?.user?.email||'').toLowerCase().trim()}
                        style={ss({padding:'10px 20px',borderRadius:10,border:'none',background:deleteConfirmEmail.toLowerCase().trim()===(session?.user?.email||'').toLowerCase().trim()?'#dc2626':'var(--stone-200)',fontFamily:'inherit',fontSize:13,fontWeight:800,color:deleteConfirmEmail.toLowerCase().trim()===(session?.user?.email||'').toLowerCase().trim()?'#fff':'var(--stone-400)',cursor:deleteConfirmEmail.toLowerCase().trim()===(session?.user?.email||'').toLowerCase().trim()?'pointer':'not-allowed',display:'flex',alignItems:'center',gap:6})}>
                        {deletingAccount ? <><i className="fas fa-spinner fa-spin" style={{fontSize:10}}></i> Deleting…</> : <><i className="fas fa-trash" style={{fontSize:10}}></i> Permanently Delete</>}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* JOURNEY */}
              {activeTab === 'journey' && (
                <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
                  {/* Banner */}
                  <div style={ss({background:'#fffbeb',border:'1px solid #fde68a',borderRadius:16,padding:20,display:'flex',alignItems:'flex-start',gap:14})}>
                    <div style={ss({width:36,height:36,borderRadius:10,background:'rgba(0,0,0,.12)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                      <i className="fas fa-wand-magic-sparkles" style={{color:'#1c1917',fontSize:13}}></i>
                    </div>
                    <div>
                      <h3 style={ss({fontWeight:900,fontSize:15})}>Your story powers the AI</h3>
                      <p style={ss({fontSize:12,fontWeight:500,color:'rgba(0,0,0,.5)',marginTop:4,lineHeight:1.7})}>Everything you enter here becomes the AI's source of truth when generating essays. The more specific the details, the more authentic your essays will sound.</p>
                      <div style={ss({marginTop:10,padding:'10px 14px',background:'rgba(0,0,0,.06)',borderRadius:10,display:'flex',alignItems:'flex-start',gap:8})}>
                        <i className="fas fa-triangle-exclamation" style={{color:'var(--stone-900)',fontSize:11,marginTop:2,flexShrink:0}}></i>
                        <p style={ss({fontSize:11,fontWeight:600,color:'rgba(0,0,0,.6)',lineHeight:1.6,margin:0})}>
                          Do not enter sensitive information such as medical conditions, social security numbers, financial account details, or other private data.{' '}
                          <span onClick={() => window.open('/privacy', '_blank')} style={ss({color:'var(--stone-900)',textDecoration:'underline',cursor:'pointer',fontWeight:700})}>Read our Privacy Policy</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Journey-wide SSN error banner */}
                  {Object.keys(journeyErrors).length > 0 && (
                    <div style={ss({background:'var(--red-light)',border:'1px solid #fecaca',borderRadius:'var(--radius)',padding:'14px 18px',display:'flex',alignItems:'center',gap:10})}>
                      <i className="fas fa-shield-exclamation" style={{color:'var(--red)',fontSize:14,flexShrink:0}}></i>
                      <div>
                        <div style={ss({fontSize:12,fontWeight:800,color:'var(--red)'})}>Sensitive data detected</div>
                        <div style={ss({fontSize:11,fontWeight:500,color:'#991b1b',marginTop:2})}>{Object.keys(journeyErrors).length} field{Object.keys(journeyErrors).length>1?'s':''} contain{Object.keys(journeyErrors).length===1?'s':''} what looks like a Social Security number. Please remove before saving.</div>
                      </div>
                    </div>
                  )}
                  <div style={cardS}>
                    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
                      <div style={ss({display:'flex',alignItems:'center',gap:12})}>
                        <div style={ss({width:36,height:36,borderRadius:10,background:'#f5f4f2',display:'flex',alignItems:'center',justifyContent:'center',color:'#78716c',flexShrink:0,fontSize:13})}><i className="fas fa-trophy"></i></div>
                        <div><h2 style={ss({fontSize:15,fontWeight:900})}>Activities & Extracurriculars</h2><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Up to 10 — be specific about your role and real impact</p></div>
                      </div>
                      {journey.activities.length < 10 && <button onClick={addActivity} style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#fbbf24',color:'#000',borderRadius:999,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'})}><i className="fas fa-plus" style={{fontSize:9}}></i> Add</button>}
                    </div>
                    {journey.activities.length === 0 ? (
                      <div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-trophy" style={{fontSize:28,display:'block',marginBottom:10,opacity:.3}}></i><p style={ss({fontSize:13,fontWeight:500})}>No activities yet</p></div>
                    ) : journey.activities.map((a, idx) => (
                      <div key={a.id} style={ss({borderRadius:14,border:`1px solid ${a.essay_worthy?'var(--yellow)':'var(--border)'}`,background:a.essay_worthy?'rgba(255,229,0,.05)':'var(--stone-50)',padding:16,marginBottom:12})}>
                        <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12})}>
                          <span style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px'})}>Activity {idx+1}</span>
                          <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                            <label style={ss({display:'flex',alignItems:'center',gap:5,cursor:'pointer'})}>
                              <input type="checkbox" checked={a.essay_worthy} onChange={e => updateActivity(a.id, { essay_worthy: e.target.checked })} style={{width:14,height:14,accentColor:'#f59e0b'}} />
                              <span style={ss({fontSize:10,fontWeight:800,color:'#d97706',textTransform:'uppercase'})}>Essay-Worthy</span>
                            </label>
                            <button onClick={() => removeActivity(a.id)} style={ss({width:24,height:24,borderRadius:8,border:'none',background:'none',cursor:'pointer',color:'var(--stone-300)',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center'})}><i className="fas fa-times"></i></button>
                          </div>
                        </div>
                        <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10})}>
                          <div><label style={labelS}>Activity Name</label><input style={inputS} placeholder="Robotics Team" value={a.name} onChange={e => updateActivity(a.id, { name: e.target.value })} /></div>
                          <div><label style={labelS}>Your Role</label><input style={inputS} placeholder="Captain" value={a.role} onChange={e => updateActivity(a.id, { role: e.target.value })} /></div>
                          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:8})}>
                            <div><label style={labelS}>Years</label><input style={inputS} placeholder="9th–12th" value={a.years} onChange={e => updateActivity(a.id, { years: e.target.value })} /></div>
                            <div><label style={labelS}>Hrs/Wk</label><input type="number" min={1} max={40} style={inputS} value={a.hours_per_week} onChange={e => updateActivity(a.id, { hours_per_week: parseInt(e.target.value) || 1 })} /></div>
                          </div>
                        </div>
                        <div style={ss({marginBottom:10})}>
                          <label style={labelS}>Impact</label>
                          <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors[`act_${a.id}_impact`]?'var(--red)':'var(--border)'}} placeholder="What changed because you were there?" value={a.impact} onChange={e => updateActivity(a.id, { impact: e.target.value })} />
                          <FieldError msg={journeyErrors[`act_${a.id}_impact`]} />
                        </div>
                        <div>
                          <label style={labelS}>Specific Moment</label>
                          <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors[`act_${a.id}_story_moment`]?'var(--red)':'var(--border)'}} placeholder="One real scene the AI can anchor the essay to" value={a.story_moment} onChange={e => updateActivity(a.id, { story_moment: e.target.value })} />
                          <FieldError msg={journeyErrors[`act_${a.id}_story_moment`]} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Honors */}
                  <div style={cardS}>
                    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
                      <div style={ss({display:'flex',alignItems:'center',gap:12})}>
                        <div style={ss({width:36,height:36,borderRadius:10,background:'#f5f4f2',display:'flex',alignItems:'center',justifyContent:'center',color:'#78716c',flexShrink:0,fontSize:13})}><i className="fas fa-medal"></i></div>
                        <div><h2 style={ss({fontSize:15,fontWeight:900})}>Honors & Awards</h2><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Up to 8</p></div>
                      </div>
                      {journey.honors.length < 8 && <button onClick={addHonor} style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#fbbf24',color:'#000',borderRadius:999,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'})}><i className="fas fa-plus" style={{fontSize:9}}></i> Add</button>}
                    </div>
                    {journey.honors.length === 0 ? (
                      <div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-medal" style={{fontSize:28,display:'block',marginBottom:10,opacity:.3}}></i><p style={ss({fontSize:13,fontWeight:500})}>No honors yet</p></div>
                    ) : journey.honors.map((h, idx) => (
                      <div key={h.id} style={ss({borderRadius:14,border:'1px solid var(--border)',background:'var(--stone-50)',padding:16,marginBottom:12})}>
                        <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12})}>
                          <span style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px'})}>Honor {idx+1}</span>
                          <button onClick={() => removeHonor(h.id)} style={ss({width:24,height:24,borderRadius:8,border:'none',background:'none',cursor:'pointer',color:'var(--stone-300)',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center'})}><i className="fas fa-times"></i></button>
                        </div>
                        <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:10})}>
                          <div><label style={labelS}>Award Name</label><input style={inputS} placeholder="National Merit" value={h.name} onChange={e => updateHonor(h.id, { name: e.target.value })} /></div>
                          <div><label style={labelS}>Level</label><select style={inputS} value={h.level} onChange={e => updateHonor(h.id, { level: e.target.value })}>{HONOR_LEVELS.map(l => <option key={l} value={l}>{l.charAt(0).toUpperCase()+l.slice(1)}</option>)}</select></div>
                          <div><label style={labelS}>Year</label><input style={inputS} placeholder="2024" value={h.year} onChange={e => updateHonor(h.id, { year: e.target.value })} /></div>
                        </div>
                        <div>
                          <label style={labelS}>Context</label>
                          <input style={{...inputS,borderColor:journeyErrors[`hon_${h.id}_context`]?'var(--red)':'var(--border)'}} placeholder="Why it mattered" value={h.context} onChange={e => updateHonor(h.id, { context: e.target.value })} />
                          <FieldError msg={journeyErrors[`hon_${h.id}_context`]} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Experiences */}
                  <div style={cardS}>
                    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,paddingBottom:16,borderBottom:'1px solid var(--border-light)'})}>
                      <div style={ss({display:'flex',alignItems:'center',gap:12})}>
                        <div style={ss({width:36,height:36,borderRadius:10,background:'#f5f4f2',display:'flex',alignItems:'center',justifyContent:'center',color:'#78716c',flexShrink:0,fontSize:13})}><i className="fas fa-heart"></i></div>
                        <div><h2 style={ss({fontSize:15,fontWeight:900})}>Meaningful Experiences</h2><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Up to 5</p></div>
                      </div>
                      {journey.experiences.length < 5 && <button onClick={addExperience} style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'#fbbf24',color:'#000',borderRadius:999,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'})}><i className="fas fa-plus" style={{fontSize:9}}></i> Add</button>}
                    </div>
                    {journey.experiences.length === 0 ? (
                      <div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-heart" style={{fontSize:28,display:'block',marginBottom:10,opacity:.3}}></i><p style={ss({fontSize:13,fontWeight:500})}>No experiences yet</p></div>
                    ) : journey.experiences.map((exp, idx) => (
                      <div key={exp.id} style={ss({borderRadius:14,border:`1px solid ${exp.essay_worthy?'var(--yellow)':'var(--border)'}`,background:exp.essay_worthy?'rgba(255,229,0,.05)':'var(--stone-50)',padding:16,marginBottom:12})}>
                        <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12})}>
                          <span style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px'})}>Experience {idx+1}</span>
                          <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                            <label style={ss({display:'flex',alignItems:'center',gap:5,cursor:'pointer'})}><input type="checkbox" checked={exp.essay_worthy} onChange={e => updateExperience(exp.id, { essay_worthy: e.target.checked })} style={{width:14,height:14,accentColor:'#f59e0b'}} /><span style={ss({fontSize:10,fontWeight:800,color:'#d97706',textTransform:'uppercase'})}>Essay-Worthy</span></label>
                            <button onClick={() => removeExperience(exp.id)} style={ss({width:24,height:24,borderRadius:8,border:'none',background:'none',cursor:'pointer',color:'var(--stone-300)',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center'})}><i className="fas fa-times"></i></button>
                          </div>
                        </div>
                        <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10})}>
                          <div><label style={labelS}>Title</label><input style={inputS} placeholder="My grandmother showed me her unsent letters" value={exp.title} onChange={e => updateExperience(exp.id, { title: e.target.value })} /></div>
                          <div><label style={labelS}>When</label><input style={inputS} placeholder="Summer before 10th grade" value={exp.timeframe} onChange={e => updateExperience(exp.id, { timeframe: e.target.value })} /></div>
                        </div>
                        <div style={ss({marginBottom:10})}>
                          <label style={labelS}>What happened</label>
                          <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors[`exp_${exp.id}_what_happened`]?'var(--red)':'var(--border)'}} placeholder="Just the facts, no interpretation" value={exp.what_happened} onChange={e => updateExperience(exp.id, { what_happened: e.target.value })} />
                          <FieldError msg={journeyErrors[`exp_${exp.id}_what_happened`]} />
                        </div>
                        <div>
                          <label style={labelS}>What it changed</label>
                          <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors[`exp_${exp.id}_what_changed`]?'var(--red)':'var(--border)'}} placeholder="Reflection, meaning, what you carry forward" value={exp.what_changed} onChange={e => updateExperience(exp.id, { what_changed: e.target.value })} />
                          <FieldError msg={journeyErrors[`exp_${exp.id}_what_changed`]} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Identity */}
                  <div style={cardS}>
                    <SectionHead icon="fa-fingerprint" title="Identity & Background" subtitle="Context that shapes your perspective" />
                    <div style={ss({display:'flex',flexDirection:'column',gap:14})}>
                      <div>
                        <label style={labelS}>Family background</label>
                        <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors.id_family_background?'var(--red)':'var(--border)'}} placeholder="Immigration, socioeconomic context, first-gen…" value={journey.identity.family_background} onChange={e => setIdentity({ family_background: e.target.value })} />
                        <FieldError msg={journeyErrors.id_family_background} />
                      </div>
                      <div>
                        <label style={labelS}>Challenge you've overcome</label>
                        <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors.id_challenge_overcome?'var(--red)':'var(--border)'}} placeholder="Be specific about what it actually was" value={journey.identity.challenge_overcome} onChange={e => setIdentity({ challenge_overcome: e.target.value })} />
                        <FieldError msg={journeyErrors.id_challenge_overcome} />
                      </div>
                      <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14})}>
                        <div>
                          <label style={labelS}>Three words others use</label>
                          <input style={{...inputS,borderColor:journeyErrors.id_three_words?'var(--red)':'var(--border)'}} placeholder="persistent, curious, loud" value={journey.identity.three_words} onChange={e => setIdentity({ three_words: e.target.value })} />
                          <FieldError msg={journeyErrors.id_three_words} />
                        </div>
                        <div>
                          <label style={labelS}>Proud of outside school</label>
                          <input style={{...inputS,borderColor:journeyErrors.id_proud_of_outside_school?'var(--red)':'var(--border)'}} placeholder="Teaching myself guitar…" value={journey.identity.proud_of_outside_school} onChange={e => setIdentity({ proud_of_outside_school: e.target.value })} />
                          <FieldError msg={journeyErrors.id_proud_of_outside_school} />
                        </div>
                      </div>
                      <div>
                        <label style={labelS}>What grades don't show</label>
                        <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors.id_grades_dont_show?'var(--red)':'var(--border)'}} placeholder="Hidden strengths, context, texture" value={journey.identity.grades_dont_show} onChange={e => setIdentity({ grades_dont_show: e.target.value })} />
                        <FieldError msg={journeyErrors.id_grades_dont_show} />
                      </div>
                    </div>
                  </div>

                  {/* Goals */}
                  <div style={cardS}>
                    <SectionHead icon="fa-compass" title="Goals & Direction" subtitle="Makes 'Why This School' essays feel intentional" />
                    <div style={ss({display:'flex',flexDirection:'column',gap:14})}>
                      <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14})}>
                        <div>
                          <label style={labelS}>Intended college major</label>
                          <input style={{...inputS,borderColor:journeyErrors.goal_intended_college_major?'var(--red)':'var(--border)'}} placeholder="Computer Science + Public Policy" value={journey.goals.intended_college_major} onChange={e => setGoals({ intended_college_major: e.target.value })} />
                          <FieldError msg={journeyErrors.goal_intended_college_major} />
                        </div>
                        <div>
                          <label style={labelS}>Career direction</label>
                          <input style={{...inputS,borderColor:journeyErrors.goal_career_direction?'var(--red)':'var(--border)'}} placeholder="Tech policy or AI ethics research" value={journey.goals.career_direction} onChange={e => setGoals({ career_direction: e.target.value })} />
                          <FieldError msg={journeyErrors.goal_career_direction} />
                        </div>
                      </div>
                      <div>
                        <label style={labelS}>Why college, why now</label>
                        <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors.goal_why_college_now?'var(--red)':'var(--border)'}} placeholder="What are you actually going to do there?" value={journey.goals.why_college_now} onChange={e => setGoals({ why_college_now: e.target.value })} />
                        <FieldError msg={journeyErrors.goal_why_college_now} />
                      </div>
                      <div>
                        <label style={labelS}>10-year vision</label>
                        <textarea rows={2} style={{...inputS,resize:'none',borderColor:journeyErrors.goal_ten_year_vision?'var(--red)':'var(--border)'}} placeholder="Where do you see yourself?" value={journey.goals.ten_year_vision} onChange={e => setGoals({ ten_year_vision: e.target.value })} />
                        <FieldError msg={journeyErrors.goal_ten_year_vision} />
                      </div>
                    </div>
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
