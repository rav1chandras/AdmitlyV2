'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useProCheck } from '@/lib/useProCheck';
import { UpgradePrompt } from '@/components/UpgradePrompt';

/* ═══ Types ═══ */
interface Student {
  id: string; name: string; initials: string; grade: string;
  avatar: string; status: string; unread: number; pendingActions: number;
  school: string; gpa: string; targetSchools: string[]; lastActive: string;
  plan: string; nextSession: string | null; assignmentId: number;
  sessionsUsed: number; sessionsTotal: number; userId?: number;
  sharingEnabled: boolean; sat: number|null; act: number|null; gradYear: string;
  avatarText?: string; endDate?: string|null; assignmentStatus?: string;
  planDescription?: string; planFeatures?: string[]; planSessionDuration?: number;
}
interface Msg  { id: string; from: string; text: string; timestamp: string; read: boolean; }
interface Sess { id: string; date: string; time: string; duration: number; status: string; topic: string; zoomLink?: string; notes?: string; recordingUrl?: string; }
interface Act  { id: string; text: string; done: boolean; dueDate: string; assignedBy: string; category: string; }
interface Nt   { id: string; title: string; content: string; author: string; updatedAt: string; pinned: boolean; category: string; }
interface Cslr { name: string; title: string; initials: string; specialties: string[]; totalStudents: number; yearsExp: number; availability: string; }

/* ═══ Defaults ═══ */
const EMPTY_COUNSELOR: Cslr = { name:'—', title:'', initials:'—', specialties:[], totalStudents:0, yearsExp:0, availability:'' };
const STATUS_CFG: Record<string,{color:string;label:string;bg:string}> = {
  active:{color:'#10b981',label:'Active',bg:'rgba(16,185,129,0.12)'},
  idle:{color:'#f59e0b',label:'Idle',bg:'rgba(245,158,11,0.12)'},
  inactive:{color:'#a8a29e',label:'Away',bg:'rgba(168,162,158,0.12)'},
};
const CAT_COLORS: Record<string,{bg:string;color:string}> = {
  Essay:{bg:'#f5f3ff',color:'#7c3aed'}, Supplements:{bg:'#eff6ff',color:'#06245B'},
  Application:{bg:'#ecfdf5',color:'#059669'}, Strategy:{bg:'#fffbeb',color:'#d97706'},
  Research:{bg:'#f0fdfa',color:'#0d9488'}, 'Session Notes':{bg:'#fefce8',color:'#ca8a04'},
};
const gc = (c: string) => CAT_COLORS[c] || { bg:'#f5f5f4', color:'#78716c' };
function fmtTime(ts: string) { return new Date(ts).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}); }
function fmtDate(ds: string) { const parts=(ds||'').split('T')[0].split('-'); if(parts.length<3) return ds; const d=new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2])); return d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}); }
function relDate(ds: string) { const d=new Date(ds),now=new Date(),diff=Math.floor((now.getTime()-d.getTime())/864e5); if(diff<=0) return'Today'; if(diff===1) return'Yesterday'; if(diff<7) return diff+'d ago'; return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function daysUntil(ds: string) {
  // Compare calendar dates only (no time component)
  const parts = (ds||'').split('T')[0].split('-');
  if (parts.length < 3) return 0;
  const target = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 864e5);
  return isNaN(diff) ? 0 : diff;
}
const US_TIMEZONES = [
  { label: 'Eastern (ET)', value: 'America/New_York' },
  { label: 'Central (CT)', value: 'America/Chicago' },
  { label: 'Mountain (MT)', value: 'America/Denver' },
  { label: 'Pacific (PT)', value: 'America/Los_Angeles' },
  { label: 'Alaska (AKT)', value: 'America/Anchorage' },
  { label: 'Hawaii (HT)', value: 'Pacific/Honolulu' },
];
function formatTimeAmPm(time24: string): string {
  if (!time24 || time24.includes('AM') || time24.includes('PM')) return time24 || '';
  const [h, m] = time24.split(':').map(Number);
  if (isNaN(h)) return time24;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m||0).padStart(2,'0')} ${ampm}`;
}
function convertTzDisplay(time: string, fromTz: string): string {
  if (!time || !fromTz) return formatTimeAmPm(time);
  try {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const t = time.includes('AM')||time.includes('PM') ? time : formatTimeAmPm(time);
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (fromTz === browserTz) return t;
    const tzLabel = US_TIMEZONES.find(z=>z.value===fromTz)?.label?.match(/\((\w+)\)/)?.[1] || '';
    return `${t}${tzLabel ? ' '+tzLabel : ''}`;
  } catch { return formatTimeAmPm(time); }
}
function isSessionInPast(dateStr: string, timeStr: string): boolean {
  try {
    const t = timeStr?.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!t) return false;
    let h = parseInt(t[1]); const m = parseInt(t[2]); const ap = t[3];
    if (ap) { if (ap.toUpperCase()==='PM' && h!==12) h+=12; if (ap.toUpperCase()==='AM' && h===12) h=0; }
    const sess = new Date(dateStr.includes('T')?dateStr:dateStr+'T00:00:00');
    sess.setHours(h, m, 0, 0);
    return sess < new Date();
  } catch { return false; }
}
function relActive(ds: string) { if(!ds) return ''; const d=new Date(ds),now=new Date(),mins=Math.floor((now.getTime()-d.getTime())/60000); if(mins<1) return 'Just now'; if(mins<60) return `${mins}m ago`; const hrs=Math.floor(mins/60); if(hrs<24) return `${hrs}h ago`; const days=Math.floor(hrs/24); return `${days}d ago`; }
function shortName(full: string) { const p=full.trim().split(' '); if(p.length<2) return full; return `${p[0]} ${p[p.length-1][0]}.`; }
function sessCountdown(sessions: Sess[]) { const up=sessions.filter(s=>s.status==='upcoming'); if(!up.length) return null; const d=daysUntil(up[0].date); if(d<=0) return 'Today'; if(d===1) return 'Tmrw'; if(d<=7) return `${d}d`; return `${d}d`; }
const ss = (o: React.CSSProperties) => o;
const API = '/api/expert-portal';

/** Returns true if the assignment is past end_date + 2 day grace period (communication disabled) */
function isExpiredGrace(endDate: string|null|undefined, assignmentStatus: string|undefined): boolean {
  if (!endDate) return false;
  if (assignmentStatus !== 'completed') return false;
  const end = new Date(endDate.includes('T') ? endDate : endDate + 'T23:59:59');
  const grace = new Date(end.getTime() + 2 * 86400000); // +2 days
  return new Date() > grace;
}

/* ═══ API ═══ */
async function apiGet(params: Record<string,string>) { const q = new URLSearchParams(params).toString(); const r = await fetch(`${API}?${q}`); return r.json(); }
async function apiPost(body: any) { const r = await fetch(API, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); }
async function apiPatch(body: any) { const r = await fetch(API, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }); return r.json(); }

/* ═══ MAIN ═══ */
export default function ExpertPortalPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { isPaid, isPremium, isExpiredPremium, score: profileScore, loading: tierLoading } = useProCheck();

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [dataLoaded, setDataLoaded] = useState(false);
  const [portalLoading, setPortalLoading] = useState(true);
  const [needsNewAssignment, setNeedsNewAssignment] = useState(false);
  // Phase C-aware sidebar banner state.
  // hasPendingAcceptance — student has a NEW assignment whose counselor
  //   hasn't accepted yet. Could coexist with past completed sessions.
  // premiumReq — most recent premium_requests row (any status). Used to
  //   show "Under Review" / "Payment Link Ready" callouts when the
  //   student is mid-flow on a new plan.
  const [hasPendingAcceptance, setHasPendingAcceptance] = useState(false);
  const [premiumReq, setPremiumReq] = useState<{
    id: number; plan_name: string; status: string;
    hosted_invoice_url: string | null;
  } | null>(null);
  // Past completed/active sessions count, sourced from
  // /api/expert-sessions/status. Used to show a "View past sessions"
  // link on the Payment Confirmed empty-state for repeat students.
  // Self-link, since this page IS the portal — but the link still
  // makes sense because the empty-state visually hides past sessions.
  // Actually for /expert-portal the more useful link target is
  // /expert-portal itself (a refresh / re-fetch). We instead use this
  // count as a signal to show a "your past sessions are still here —
  // expand to view" affordance. See banner comment.
  const [pastSessionsCount, setPastSessionsCount] = useState(0);
  const [students, setStudents] = useState<Student[]>([]);
  const [counselor, setCounselor] = useState<Cslr>(EMPTY_COUNSELOR);
  const [messagesByStudent, setMessagesByStudent] = useState<Record<string,Msg[]>>({});
  const [sessionsByStudent, setSessionsByStudent] = useState<Record<string,Sess[]>>({});
  const [actionsByStudent, setActionsByStudent] = useState<Record<string,Act[]>>({});
  const [notesByStudent, setNotesByStudent] = useState<Record<string,Nt[]>>({});

  const role = (session?.user as any)?.role || 'student';
  const isCounselor = role === 'counselor';

  const FALLBACK: Student = { id:'none', name:'—', initials:'—', grade:'', avatar:'#E8D5F5', status:'inactive', unread:0, pendingActions:0, school:'', gpa:'', targetSchools:[], lastActive:'', plan:'', nextSession:null, assignmentId:0, sessionsUsed:0, sessionsTotal:0, sharingEnabled:true, sat:null, act:null, gradYear:'', avatarText:'#6B21A8' };
  const student = students.find(s=>s.id===selectedStudentId)||students[0]||FALLBACK;
  const messages = messagesByStudent[selectedStudentId]||[];
  const sessions = sessionsByStudent[selectedStudentId]||[];
  const actions  = actionsByStudent[selectedStudentId]||[];
  const notes    = notesByStudent[selectedStudentId]||[];

  const setMessages = (u: ((p:Msg[])=>Msg[])|Msg[]) => setMessagesByStudent(prev=>({...prev,[selectedStudentId]:typeof u==='function'?u(prev[selectedStudentId]||[]):u}));
  const setActions  = (u: ((p:Act[])=>Act[])|Act[]) => setActionsByStudent(prev=>({...prev,[selectedStudentId]:typeof u==='function'?u(prev[selectedStudentId]||[]):u}));
  const setNotes    = (u: ((p:Nt[])=>Nt[])|Nt[])   => setNotesByStudent(prev=>({...prev,[selectedStudentId]:typeof u==='function'?u(prev[selectedStudentId]||[]):u}));
  const setSessions = (u: ((p:Sess[])=>Sess[])|Sess[]) => setSessionsByStudent(prev=>({...prev,[selectedStudentId]:typeof u==='function'?u(prev[selectedStudentId]||[]):u}));

  const [msgInput, setMsgInput] = useState('');
  const [newAction, setNewAction] = useState('');
  const [activeNote, setActiveNote] = useState<string|null>(null);
  const [noteContent, setNoteContent] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedPanel, setExpandedPanel] = useState<string|null>(null);
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [sharedEssays, setSharedEssays] = useState<any[]>([]);
  const [editingEssay, setEditingEssay] = useState<any|null>(null);
  const [essayEditText, setEssayEditText] = useState('');
  const [essayEditHtml, setEssayEditHtml] = useState('');
  const [essayFmtOpen, setEssayFmtOpen] = useState(false);
  const [essayHlOpen, setEssayHlOpen] = useState(false);
  const [essayHlColor, setEssayHlColor] = useState<'yellow'|'green'|'pink'>('yellow');
  const essayEditorRef = useRef<HTMLDivElement>(null);
  const [essaySaving, setEssaySaving] = useState(false);
  const [planHover, setPlanHover] = useState(false);
  const [showEssays, setShowEssays] = useState(false);
  const [sessDate, setSessDate] = useState('');
  const [sessTime, setSessTime] = useState('');
  const [sessDuration, setSessDuration] = useState('45');
  const [sessTopic, setSessTopic] = useState('');
  const [sessLink, setSessLink] = useState('');
  const [sessTz, setSessTz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const chatEndRef = useRef<HTMLDivElement>(null);

  /* ── Load on mount ── */
  useEffect(() => {
    (async () => {
      try {
        // Phase C: pull the student's most-recent premium_request in
        // parallel so the bottom banner can reflect Under Review /
        // Payment Link Ready states. No-op for counselors; the route
        // returns null for non-students.
        fetch('/api/premium/request', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : { request: null })
          .then(d => setPremiumReq(d?.request ?? null))
          .catch(() => {});
        // past_sessions_count drives the "view past sessions" pill on
        // the Payment Confirmed empty state. Same source of truth as
        // /expert-sessions so both pages agree on whether the student
        // has prior plans on file.
        fetch('/api/expert-sessions/status', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (typeof d?.past_sessions_count === 'number') setPastSessionsCount(d.past_sessions_count); })
          .catch(() => {});
        const data = await apiGet({});
        if (data.role === 'student' && data.counselor && data.assignment) {
          setDataLoaded(true);
          if (data.needsAssignment) setNeedsNewAssignment(true);
          // Build one card per assignment (exclude pending_acceptance — those students see "Payment Confirmed")
          const allAssignments = data.assignments || [data.assignment];
          // Track pending_acceptance separately — these get filtered out
          // of the cards row but should still drive the bottom banner.
          setHasPendingAcceptance(allAssignments.some((a: any) => a.status === 'pending_acceptance'));
          const portalAssignments = allAssignments.filter((a: any) => a.status !== 'pending_acceptance');
          // If all assignments are pending_acceptance, show Payment Confirmed screen
          if (portalAssignments.length === 0) {
            setNeedsNewAssignment(true);
            setStudents([]);
            setPortalLoading(false);
            return;
          }
          const assignments = portalAssignments;
          const PASTEL = ['#D5F5E8','#D5E8F5','#E8D5F5','#F5E8D5','#F5D5E0'];
          const PASTEL_TEXT = ['#065F46','#1E40AF','#6B21A8','#9A3412','#9F1239'];
          const cards: Student[] = assignments.map((a: any, i: number) => {
            const cName = a.counselorName || data.counselor.name || '—';
            const cInitials = cName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2);
            return {
              id: String(a.id),
              name: cName,
              initials: cInitials,
              grade: a.counselorTitle || data.counselor.title || '',
              avatar: PASTEL[i % PASTEL.length],
              avatarText: PASTEL_TEXT[i % PASTEL_TEXT.length],
              status: 'active',
              unread: 0, pendingActions: 0,
              school: '', gpa: '',
              lastActive: 'now',
              plan: a.plan,
              nextSession: null,
              assignmentId: a.id,
              sessionsUsed: a.sessionsUsed || a.sessions_used || 0,
              sessionsTotal: a.sessionsTotal || a.sessions_total || 0,
              sharingEnabled: true,
              sat: null, act: null, gradYear: '',
              endDate: a.endDate || a.end_date || null,
              assignmentStatus: a.status || 'active',
              planDescription: a.planDescription || a.plan_description || '',
              planFeatures: a.planFeatures || a.plan_features || [],
              planSessionDuration: a.planSessionDuration || a.plan_session_duration || 60,
              targetSchools: a.counselorSpecialties || a.specialties || data.counselor.specialties || [],
            };
          });
          setStudents(cards);
          if (cards.length > 0) setSelectedStudentId(cards[0].id);
          // Set primary counselor for hero
          setCounselor({ name:data.counselor.name, title:data.counselor.title||'', initials:data.counselor.initials||data.counselor.name.split(' ').map((w:string)=>w[0]).join('').toUpperCase().slice(0,2), specialties:data.counselor.specialties||[], totalStudents:data.counselor.totalStudents||0, yearsExp:data.counselor.yearsExp||0, availability:data.counselor.availability||'' });
          // Load data for first assignment
          const firstAid = String(cards[0]?.assignmentId || data.assignment.id);
          try {
            const [msgs,sess,acts,nts] = await Promise.all([apiGet({entity:'messages',assignment_id:firstAid}),apiGet({entity:'sessions',assignment_id:firstAid}),apiGet({entity:'actions',assignment_id:firstAid}),apiGet({entity:'notes',assignment_id:firstAid})]);
            const sid = cards[0]?.id || 'me';
            if(Array.isArray(msgs))setMessagesByStudent({[sid]:msgs.map((m:any)=>({id:String(m.id),from:m.sender_role,text:m.body,timestamp:m.created_at,read:m.is_read}))});
            if(Array.isArray(sess))setSessionsByStudent({[sid]:sess.map((s:any)=>({id:String(s.id),date:s.session_date,time:s.session_time||'3:00 PM',duration:s.duration_min||60,topic:s.topic||'Session',status:s.status||'upcoming',notes:s.notes||'',zoomLink:s.zoom_link}))});
            if(Array.isArray(acts))setActionsByStudent({[sid]:acts.map((a:any)=>({id:String(a.id),text:a.text,done:a.is_done,dueDate:a.due_date,assignedBy:a.assigned_by||'counselor',category:a.category||'Application'}))});
            if(Array.isArray(nts))setNotesByStudent({[sid]:nts.map((n:any)=>({id:String(n.id),title:n.title,content:n.content,author:n.author_role||'counselor',updatedAt:n.updated_at,pinned:n.is_pinned,category:n.category||'Session Notes'}))});
          } catch{}
        } else if (data.role==='student') { setDataLoaded(true); if(data.needsAssignment) setNeedsNewAssignment(true); }
        else if (data.counselor && data.assignments) {
          setDataLoaded(true);
          setCounselor({ name:data.counselor.display_name||'', title:data.counselor.title||'', initials:(data.counselor.display_name||'').split(' ').map((w:string)=>w[0]).join('').toUpperCase().slice(0,2), specialties:data.counselor.specialties||[], totalStudents:data.counselor.total_students||0, yearsExp:data.counselor.years_experience||0, availability:data.counselor.availability||'' });
          const PASTEL = ['#E8D5F5','#D5E8F5','#D5F5E8','#F5E8D5','#F5D5E0'];
          const PASTEL_TEXT = ['#6B21A8','#1E40AF','#065F46','#9A3412','#9F1239'];
          const list: Student[] = (data.assignments||[]).map((a:any,i:number)=>({ id:String(a.id), name:a.student_name||'Student', initials:(a.student_name||'S').split(' ').map((w:string)=>w[0]).join('').toUpperCase().slice(0,2), grade:a.high_school_name||'', avatar:PASTEL[i%PASTEL.length], status: a.student_last_login && (Date.now() - new Date(a.student_last_login).getTime()) < 15*60*1000 ? 'active' : (a.student_last_login && (Date.now() - new Date(a.student_last_login).getTime()) < 24*3600*1000 ? 'idle' : 'inactive'), unread:a.unread||0, pendingActions:a.pending_actions||0, school:a.high_school_name||'', gpa:a.profile_gpa?String(a.profile_gpa):(a.gpa_scale||''), targetSchools:[], lastActive:a.last_message_at||'', plan:a.plan||'', nextSession:null, assignmentId:a.id, sessionsUsed:a.sessions_used||0, sessionsTotal:a.sessions_total||0, sharingEnabled:a.allow_counselor_access!==false, sat:a.profile_sat||null, act:a.profile_act||null, gradYear:a.graduation_year?String(a.graduation_year):'', avatarText:PASTEL_TEXT[i%PASTEL_TEXT.length], endDate:a.end_date||null, assignmentStatus:a.status||'active', planDescription:a.plan_description||'', planFeatures:a.plan_features||[], planSessionDuration:a.plan_session_duration||60 }));
          if(list.length>0){setStudents(list);setSelectedStudentId(list[0].id);}
        }
        setPortalLoading(false);
      } catch { setPortalLoading(false); }
    })();
  }, []);

  const loadStudentData = useCallback(async (sid: string) => {
    if(!dataLoaded) return; const s=students.find(x=>x.id===sid); if(!s?.assignmentId) return;
    const aid=String(s.assignmentId);
    try {
      const [msgs,sess,acts,nts] = await Promise.all([apiGet({entity:'messages',assignment_id:aid}),apiGet({entity:'sessions',assignment_id:aid}),apiGet({entity:'actions',assignment_id:aid}),apiGet({entity:'notes',assignment_id:aid})]);
      if(Array.isArray(msgs))setMessagesByStudent(p=>({...p,[sid]:msgs.map((m:any)=>({id:String(m.id),from:m.sender_role,text:m.body,timestamp:m.created_at,read:m.is_read}))}));
      if(Array.isArray(sess))setSessionsByStudent(p=>({...p,[sid]:sess.map((s:any)=>({id:String(s.id),date:s.session_date,time:s.session_time,duration:s.duration_min,status:s.status,topic:s.topic||'',zoomLink:s.zoom_link,notes:s.notes,recordingUrl:s.recording_url}))}));
      if(Array.isArray(acts))setActionsByStudent(p=>({...p,[sid]:acts.map((a:any)=>({id:String(a.id),text:a.text,done:a.is_done,dueDate:a.due_date,assignedBy:a.assigned_by,category:a.category}))}));
      if(Array.isArray(nts))setNotesByStudent(p=>({...p,[sid]:nts.map((n:any)=>({id:String(n.id),title:n.title,content:n.content,author:n.author_role,updatedAt:n.updated_at,pinned:n.is_pinned,category:n.category}))}));
      // Load shared essays for counselor
      try { const essays = await apiGet({entity:'shared_essays',assignment_id:aid}); if(Array.isArray(essays)) setSharedEssays(essays); else setSharedEssays([]); } catch { setSharedEssays([]); }
    } catch(e) { console.error('Load failed',e); }
  }, [dataLoaded, students]);

  useEffect(() => { if(selectedStudentId){setActiveNote(null);setEditingNote(false);setMsgInput('');loadStudentData(selectedStudentId);} }, [selectedStudentId, loadStudentData]);

  /* ── Handlers ── */
  const sendMessage = async () => {
    if(!msgInput.trim()) return; const text=msgInput.trim(); const role2=isCounselor?'counselor':'student';
    setMessages(p=>[...p,{id:`m${Date.now()}`,from:role2,text,timestamp:new Date().toISOString(),read:false}]); setMsgInput('');
    if(dataLoaded&&student.assignmentId){try{await apiPost({entity:'message',assignment_id:student.assignmentId,body:text,sender_role:role2});}catch{}}
  };
  const toggleAction = async (id:string) => {
    setActions(p=>p.map(a=>a.id===id?{...a,done:!a.done}:a));
    if(dataLoaded){try{await apiPatch({entity:'action',id:parseInt(id),toggle_done:true});}catch{}}
  };
  const addAction = async () => {
    if(!newAction.trim()||!isCounselor) return; const text=newAction.trim();
    const act:Act={id:`a${Date.now()}`,text,done:false,dueDate:new Date(Date.now()+48*36e5).toISOString().split('T')[0],assignedBy:'counselor',category:'Task'};
    setActions(p=>[act,...p]); setNewAction('');
    if(dataLoaded&&student.assignmentId){try{await apiPost({entity:'action',assignment_id:student.assignmentId,text,due_date:act.dueDate,assigned_by:'counselor',category:'Task'});}catch{}}
  };
  const openNote = (n:Nt) => {setActiveNote(n.id);setNoteTitle(n.title);setNoteContent(n.content);setEditingNote(false);};
  const saveNote = async () => {
    if(!activeNote) return;
    setNotes(p=>p.map(n=>n.id===activeNote?{...n,title:noteTitle,content:noteContent,updatedAt:new Date().toISOString()}:n)); setEditingNote(false);
    if(dataLoaded){try{await apiPatch({entity:'note',id:parseInt(activeNote),title:noteTitle,content:noteContent});}catch{}}
  };
  const createNote = async () => {
    const nn:Nt={id:`n${Date.now()}`,title:'New Note',content:'',author:isCounselor?'counselor':'student',updatedAt:new Date().toISOString(),pinned:false,category:'Session Notes'};
    setNotes(p=>[nn,...p]); openNote(nn); setEditingNote(true);
    if(dataLoaded&&student.assignmentId){try{const saved=await apiPost({entity:'note',assignment_id:student.assignmentId,title:'New Note'});if(saved?.id)setNotes(p=>p.map(n=>n.id===nn.id?{...n,id:String(saved.id)}:n));}catch{}}
  };
  const togglePin = async (noteId:string) => {
    const n=notes.find(x=>x.id===noteId); if(!n) return;
    setNotes(p=>p.map(x=>x.id===noteId?{...x,pinned:!x.pinned}:x));
    if(dataLoaded){try{await apiPatch({entity:'note',id:parseInt(noteId),is_pinned:!n.pinned});}catch{}}
  };
  const scheduleSession = async () => {
    if(!sessDate||!sessTime||!sessTopic.trim()) return;
    // Validate session is not in the past
    if(isSessionInPast(sessDate, sessTime)){alert('Cannot schedule a session in the past.');return;}
    const displayTime = formatTimeAmPm(sessTime);
    const tzLabel = US_TIMEZONES.find(z=>z.value===sessTz)?.label?.match(/\((\w+)\)/)?.[1] || '';
    const timeWithTz = tzLabel ? `${displayTime} ${tzLabel}` : displayTime;
    const temp: Sess = { id:`s${Date.now()}`, date:sessDate, time:timeWithTz, duration:parseInt(sessDuration)||45, topic:sessTopic.trim().slice(0,50), status:'upcoming', zoomLink:sessLink||undefined };
    setSessions(p=>[temp,...p]);
    setShowSessionForm(false); setSessDate(''); setSessTime(''); setSessDuration('45'); setSessTopic(''); setSessLink('');
    if(dataLoaded&&student.assignmentId){
      try{ const saved = await apiPost({entity:'session', assignment_id:student.assignmentId, session_date:sessDate, session_time:timeWithTz, duration_min:parseInt(sessDuration)||45, topic:sessTopic.trim().slice(0,50), zoom_link:sessLink});
        if(saved?.id) setSessions(p=>p.map(s=>s.id===temp.id?{...s,id:String(saved.id)}:s));
      }catch{}
    }
  };
  // Essay rich text helpers
  function essayStripHtml(html: string): string {
    return html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  }
  function handleEssayEditorInput() {
    if (!essayEditorRef.current) return;
    const html = essayEditorRef.current.innerHTML;
    setEssayEditHtml(html);
    setEssayEditText(essayStripHtml(html));
  }
  function essayExecFmt(cmd: string) {
    document.execCommand(cmd, false);
    essayEditorRef.current?.focus();
    handleEssayEditorInput();
  }
  function essayApplyHighlight(color: 'yellow'|'green'|'pink') {
    setEssayHlColor(color); setEssayHlOpen(false);
    const map = { yellow: '#fef9c3', green: '#dcfce7', pink: '#fce7f3' };
    document.execCommand('hiliteColor', false, map[color]);
    essayEditorRef.current?.focus();
    handleEssayEditorInput();
  }
  function essayRemoveHighlight() {
    setEssayHlOpen(false);
    document.execCommand('hiliteColor', false, 'transparent');
    essayEditorRef.current?.focus();
    handleEssayEditorInput();
  }
  const saveExpertEssay = async () => {
    if(!essayEditText.trim()||!student.assignmentId) return;
    if (essayEditorRef.current) setEssayEditHtml(essayEditorRef.current.innerHTML);
    const htmlToSave = essayEditorRef.current?.innerHTML || essayEditHtml || essayEditText;
    setEssaySaving(true);
    try {
      if (editingEssay?._isNew) {
        await apiPost({ entity:'expert_essay', assignment_id:student.assignmentId, essay_type:editingEssay.essay_type||'Supplemental', college_name:editingEssay.college_name||'', topic:editingEssay.topic||'Expert Essay', draft_text:htmlToSave });
      } else if (editingEssay?.expert_tag && editingEssay?.id) {
        await apiPatch({ entity:'essay', id:parseInt(editingEssay.id), draft_text:htmlToSave, topic:editingEssay.topic });
      } else if (editingEssay) {
        await apiPost({ entity:'expert_essay', assignment_id:student.assignmentId, source_essay_id:editingEssay.id, essay_type:editingEssay.essay_type, college_name:editingEssay.college_name, topic:editingEssay.topic, draft_text:htmlToSave });
      }
      setEditingEssay(null); setEssayEditText(''); setEssayEditHtml('');
      const aid=String(student.assignmentId);
      try{ const essays=await apiGet({entity:'shared_essays',assignment_id:aid}); if(Array.isArray(essays)) setSharedEssays(essays); }catch{}
    } catch(e){ console.error('Save expert essay failed',e); }
    setEssaySaving(false);
  };
  const unread = messages.filter(m=>!m.read&&m.from!==(isCounselor?'counselor':'student')).length;
  const pending = actions.filter(a=>!a.done).length;
  const st = STATUS_CFG[student.status]||STATUS_CFG.inactive;
  const upSess = sessions.filter(se=>se.status==='upcoming');
  const pastSess = sessions.filter(se=>se.status==='completed');
  const cancelledSess = sessions.filter(se=>se.status==='cancelled');
  const nextSess = upSess[0];
  const nextDays = nextSess?daysUntil(nextSess.date):null;
  const selNote = notes.find(n=>n.id===activeNote);

  /* ═══ Paywalls ═══ */
  const hasAssignments = dataLoaded && students.length > 0;
  // Only block truly free users with no assignments and no pending payment
  if(!isCounselor&&!isPaid&&!isExpiredPremium&&!tierLoading&&!hasAssignments&&!needsNewAssignment) return(<AppShell><div style={ss({flex:1,overflowY:'auto'})}><UpgradePrompt score={profileScore??undefined} feature="Expert Counselor Portal"/></div></AppShell>);
  if(portalLoading||tierLoading) return(<AppShell><main style={ss({display:'flex',flex:1,alignItems:'center',justifyContent:'center'})}><div style={ss({textAlign:'center',color:'var(--stone-400)'})}><i className="fas fa-spinner fa-spin" style={{fontSize:24,marginBottom:12,display:'block'}}></i><div style={{fontSize:14,fontWeight:600}}>Loading expert portal…</div></div></main></AppShell>);

  /* ═══ Hero config ═══ */
  const heroName = shortName(student.name);
  const heroInitials = student.initials;
  const heroAvatar = isCounselor ? student.avatar : '#06245B';
  const heroAvatarColor = isCounselor ? '#fff' : '#FFE500';
  const heroSub = isCounselor
    ? (student.sharingEnabled ? `${student.school||student.grade}${student.gpa?` · GPA ${student.gpa}`:''}` : 'Academic data not shared')
    : `${student.grade||counselor.title}`;
  const heroBadge = isCounselor ? {label:st.label,bg:st.bg,color:st.color} : {label:'Your counselor',bg:'rgba(255,255,255,.13)',color:'#fff'};
  const heroTags = isCounselor ? student.targetSchools : student.targetSchools;
  const planFeats = student.planFeatures || [];
  const planDesc = student.planDescription || '';
  const planDur = student.planSessionDuration || 60;

  const isExpired = isExpiredGrace(student.endDate, student.assignmentStatus);

  /* ═══ Dashboard (shared by both views) ═══ */
  const dashboard = (
    <div style={ss({flex:1,display:'flex',flexDirection:'column',padding:'14px 20px',background:'var(--bg)',overflowY:'auto'})}>
      {/* HERO */}
      <div style={ss({background:'#06245B',borderRadius:16,overflow:'visible',marginBottom:12,flexShrink:0,position:'relative',zIndex:10,boxShadow:'0 16px 36px rgba(6,36,91,.18)'})}>
        <div style={ss({padding:'22px 26px',display:'flex',alignItems:'flex-start',gap:18})}>
          <div style={ss({flex:1,minWidth:0})}>
            <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:5})}><span style={ss({fontSize:24,fontWeight:900,color:'#fff',lineHeight:1.05,letterSpacing:'-0.2px'})}>{heroName}</span><span style={ss({fontSize:10,fontWeight:800,padding:'3px 10px',borderRadius:20,background:heroBadge.bg,color:heroBadge.color})}>{heroBadge.label}</span></div>
            <div style={ss({fontSize:13,fontWeight:600,color:'rgba(255,255,255,.68)'})}>{heroSub}</div>
            {heroTags.length>0&&<div style={ss({display:'flex',gap:5,marginTop:9,flexWrap:'wrap',maxWidth:360})}>{heroTags.slice(0,6).map(t=><span key={t} style={ss({fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:20,background:'rgba(255,255,255,.12)',color:'#fff',maxWidth:'32%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',boxSizing:'border-box'})}>{t}</span>)}</div>}
          </div>
          {/* Plan box + Stats grid */}
          <div style={ss({display:'flex',gap:6,flexShrink:0,alignItems:'stretch'})}>
            {/* Plan detail tile — stretches to match stats column */}
            {student.plan&&<div style={ss({position:'relative'})} onMouseEnter={()=>setPlanHover(true)} onMouseLeave={()=>setPlanHover(false)}>
              <div style={ss({padding:'8px 16px',background:'rgba(255,229,0,.1)',borderRadius:8,minWidth:115,cursor:'default',display:'flex',flexDirection:'column',justifyContent:'center',height:'100%',boxSizing:'border-box'})}>
                <div style={ss({fontSize:12,fontWeight:800,color:'#FFE500',marginBottom:3})}>{student.plan}</div>
                <div style={ss({fontSize:9,fontWeight:500,color:'rgba(255,255,255,.4)',lineHeight:1.4})}>
                  {planFeats.slice(0,3).map((f,i)=><div key={i} style={ss({overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:150})}>{f}</div>)}
                  {planFeats.length>3&&<div style={ss({color:'rgba(255,229,0,.5)',fontWeight:600})}>+{planFeats.length-3} more</div>}
                  {planFeats.length===0&&<div>{student.sessionsTotal} session{student.sessionsTotal!==1?'s':''} · {planDur}min</div>}
                </div>
              </div>
              {/* Plan tooltip — position:fixed on hover */}
              {planHover&&(planFeats.length>0||planDesc)&&<div id="plan-tip" style={ss({position:'fixed',zIndex:99999,background:'#fff',borderRadius:12,padding:'14px 18px',boxShadow:'0 16px 48px rgba(0,0,0,.3)',border:'1px solid var(--border)',minWidth:260,maxWidth:340})} ref={(el)=>{if(el&&el.parentElement){const r=el.parentElement.getBoundingClientRect();el.style.top=(r.bottom+8)+'px';el.style.right=(window.innerWidth-r.right)+'px';}}}>
                <div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)',marginBottom:4})}>{student.plan} Plan</div>
                {planDesc&&<div style={ss({fontSize:11,color:'var(--stone-500)',marginBottom:8,lineHeight:1.4})}>{planDesc}</div>}
                {planFeats.length>0&&<div style={ss({display:'flex',flexDirection:'column',gap:4})}>
                  {planFeats.map((f,i)=><div key={i} style={ss({display:'flex',alignItems:'flex-start',gap:6,fontSize:11,color:'var(--stone-700)',lineHeight:1.4})}><i className="fas fa-check" style={{fontSize:8,color:'#10b981',marginTop:3,flexShrink:0}}></i><span>{f}</span></div>)}
                </div>}
                <div style={ss({marginTop:8,paddingTop:8,borderTop:'1px solid var(--border)',fontSize:10,color:'var(--stone-400)'})}>
                  {student.sessionsTotal} session{student.sessionsTotal!==1?'s':''} · {planDur} min each
                </div>
              </div>}
            </div>}
            {/* Stats column: row1=3 squares, row2=session bar (same width) */}
            <div style={ss({display:'flex',flexDirection:'column',gap:4,width:176})}>
              <div style={ss({display:'flex',gap:4})}>
                {[{v:`${student.sessionsUsed}/${student.sessionsTotal}`,l:'sessions',c:'#38bdf8',bg:'rgba(56,189,248,.12)'},{v:String(pending),l:'actions',c:pending>0?'#fbbf24':'#a3a3a3',bg:pending>0?'rgba(251,191,36,.12)':'rgba(255,255,255,.06)'},{v:String(unread),l:'unread',c:unread>0?'#f87171':'#a3a3a3',bg:unread>0?'rgba(248,113,113,.12)':'rgba(255,255,255,.06)'}].map(m=>(
                  <div key={m.l} style={ss({textAlign:'center',padding:'8px 0',background:m.bg,borderRadius:8,flex:1})}><div style={ss({fontSize:16,fontWeight:800,color:m.c})}>{m.v}</div><div style={ss({fontSize:8,fontWeight:600,color:'rgba(255,255,255,.4)',marginTop:2})}>{m.l}</div></div>
                ))}
              </div>
              {/* Next session row — constrained to same width as stats */}
              {nextSess&&<div style={ss({display:'flex',alignItems:'center',gap:6,padding:'6px 8px',background:'rgba(37,99,235,.1)',borderRadius:8})}>
                <i className="fas fa-video" style={{fontSize:9,color:'#60a5fa',flexShrink:0}}></i>
                <div style={ss({flex:1,minWidth:0,overflow:'hidden'})}>
                  <div style={ss({fontSize:9,fontWeight:700,color:'#93c5fd',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{fmtDate(nextSess.date)} · {nextSess.time}</div>
                </div>
                <span style={ss({fontSize:8,fontWeight:700,color:nextDays!==null&&nextDays<=2?'#fca5a5':'#93c5fd',flexShrink:0})}>{nextDays===0?'Today':nextDays===1?'Tmrw':`${nextDays}d`}</span>
                {nextSess.zoomLink&&<button onClick={()=>window.open(nextSess.zoomLink,'_blank')} style={ss({padding:'2px 6px',borderRadius:4,border:'none',background:'#06245B',color:'#fff',fontSize:8,fontWeight:700,cursor:'pointer',fontFamily:'inherit',flexShrink:0})}>Join</button>}
              </div>}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ PANELS ═══ */}
      {(() => {
        const PANELS = [
          { key:'messages', icon:'fa-comment-dots', label:'Messages', badge:unread>0?`${unread} new`:null, badgeBg:'#fef2f2', badgeColor:'#dc2626' },
          { key:'actions',  icon:'fa-check-circle', label:'Action Items', badge:pending>0?`${pending} pending`:null, badgeBg:'#fffbeb', badgeColor:'#b45309' },
          { key:'notes',    icon:'fa-sticky-note',  label:'Shared Notes', badge:null, badgeBg:'', badgeColor:'' },
          { key:'sessions', icon:'fa-video',        label:'Sessions', badge:null, badgeBg:'', badgeColor:'' },
        ];

        const panelContent: Record<string, React.ReactNode> = {
          messages: (<>
            <div style={ss({flex:1,overflowY:'auto',padding:'14px 16px',display:'flex',flexDirection:'column',gap:8})}>
              {messages.length===0&&<div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-comment-dots" style={{fontSize:28,display:'block',marginBottom:8,opacity:.4}}></i><div style={{fontSize:12,fontWeight:600}}>No messages yet — start a conversation</div></div>}
              {messages.map(m=>{const isMe=isCounselor?m.from==='counselor':m.from==='student'; return(
                <div key={m.id} style={ss({display:'flex',gap:8,flexDirection:isMe?'row-reverse':'row'})}>
                  {!isMe&&<div style={ss({width:28,height:28,borderRadius:8,background:isCounselor?student.avatar:'#06245B',color:isCounselor?'#fff':'#FFE500',fontSize:9,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>{isCounselor?student.initials:counselor.initials}</div>}
                  <div style={ss({maxWidth:'75%'})}><div style={ss({padding:'10px 14px',borderRadius:isMe?'14px 14px 4px 14px':'14px 14px 14px 4px',background:isMe?'#06245B':'var(--stone-50)',color:isMe?'#fff':'var(--stone-800)',fontSize:13,fontWeight:500,lineHeight:1.5})}>{m.text}</div><div style={ss({fontSize:10,color:'var(--stone-300)',marginTop:3,textAlign:isMe?'right':'left'})}>{fmtTime(m.timestamp)}</div></div>
                </div>
              );})}
              <div ref={chatEndRef}/>
            </div>
            <div style={ss({padding:'10px 14px',borderTop:'1px solid var(--border)',display:'flex',gap:8,flexShrink:0})}>
              {isExpired?(
                <div style={ss({flex:1,padding:'8px 12px',borderRadius:10,background:'var(--stone-50)',border:'1px solid var(--border)',fontSize:11,fontWeight:600,color:'var(--stone-400)',textAlign:'center'})}>
                  <i className="fas fa-lock" style={{fontSize:9,marginRight:6}}></i>Plan ended — messaging disabled
                </div>
              ):(
                <>
                  <input value={msgInput} onChange={e=>setMsgInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder={isCounselor?`Message ${student.name}…`:`Message ${counselor.name}…`} style={ss({flex:1,padding:'8px 12px',border:'1px solid var(--border)',borderRadius:10,fontSize:12,fontFamily:'inherit',outline:'none',background:'var(--stone-50)',color:'var(--stone-700)'})}/>
                  <button onClick={sendMessage} style={ss({padding:'8px 14px',borderRadius:10,border:'none',background:msgInput.trim()?'#06245B':'var(--stone-200)',color:msgInput.trim()?'#fff':'var(--stone-400)',fontSize:12,fontWeight:700,cursor:msgInput.trim()?'pointer':'default',fontFamily:'inherit'})}>Send</button>
                </>
              )}
            </div>
          </>),
          actions: (<>
            <div style={ss({padding:'10px 16px',borderBottom:'1px solid var(--border)',display:'flex',gap:8,flexShrink:0})}>
              {isExpired?(
                <div style={ss({flex:1,padding:'7px 10px',borderRadius:8,background:'var(--stone-50)',border:'1px solid var(--border)',fontSize:11,fontWeight:600,color:'var(--stone-400)',textAlign:'center'})}><i className="fas fa-lock" style={{fontSize:9,marginRight:6}}></i>Plan ended</div>
              ):isCounselor?(
                <>
                  <input id="ep-act" value={newAction} onChange={e=>setNewAction(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addAction();}} placeholder="Add action item…" style={ss({flex:1,padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',background:'var(--stone-50)',color:'var(--stone-700)'})}/>
                  <button onClick={addAction} style={ss({padding:'7px 14px',borderRadius:8,border:'none',background:newAction.trim()?'#06245B':'var(--stone-200)',color:newAction.trim()?'#fff':'var(--stone-400)',fontSize:11,fontWeight:700,cursor:newAction.trim()?'pointer':'default',fontFamily:'inherit'})}>Add</button>
                </>
              ):null}
            </div>
            <div style={ss({flex:1,overflowY:'auto'})}>
              {actions.length===0&&<div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-check-circle" style={{fontSize:28,display:'block',marginBottom:8,opacity:.4}}></i><div style={{fontSize:12,fontWeight:600}}>No action items yet</div></div>}
              {actions.filter(a=>!a.done).map(a=>{const days=daysUntil(a.dueDate); return(
                <div key={a.id} style={ss({padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'flex-start',gap:10})}>
                  <button onClick={()=>toggleAction(a.id)} style={ss({width:18,height:18,borderRadius:5,border:`2px solid ${days<=1?'#dc2626':days<=3?'#f59e0b':'var(--stone-300)'}`,background:'transparent',cursor:'pointer',flexShrink:0,marginTop:2,fontFamily:'inherit'})}/>
                  <div style={ss({flex:1})}><div style={ss({fontSize:12,fontWeight:600,color:'var(--stone-800)',lineHeight:1.4})}>{a.text}</div><div style={ss({display:'flex',gap:5,marginTop:5})}><span style={ss({fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,background:days<=1?'#fef2f2':days<=3?'#fffbeb':'#f5f5f4',color:days<=1?'#dc2626':days<=3?'#b45309':'var(--stone-500)'})}>{days<=0?'Overdue':days===1?'Due tomorrow':`Due in ${days}d`}</span></div></div>
                </div>
              );})}
              {actions.filter(a=>a.done).map(a=>(
                <div key={a.id} style={ss({padding:'10px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'flex-start',gap:10,opacity:.45})}>
                  <button onClick={()=>toggleAction(a.id)} style={ss({width:18,height:18,borderRadius:5,border:'none',background:'#10b981',cursor:'pointer',flexShrink:0,marginTop:2,color:'#fff',fontSize:9,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit'})}><i className="fas fa-check" style={{fontSize:8}}></i></button>
                  <span style={ss({fontSize:12,color:'var(--stone-500)',textDecoration:'line-through'})}>{a.text}</span>
                </div>
              ))}
            </div>
          </>),
          notes: (<>
            {!selNote?(
              <div style={ss({flex:1,overflowY:'auto'})}>
                {notes.length===0&&<div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-sticky-note" style={{fontSize:28,display:'block',marginBottom:8,opacity:.4}}></i><div style={{fontSize:12,fontWeight:600}}>No notes yet</div></div>}
                {[...notes].sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0)).map(n=>{const cc=gc(n.category); return(
                  <div key={n.id} onClick={()=>openNote(n)} style={ss({padding:'12px 16px',borderBottom:'1px solid var(--border)',cursor:'pointer'})} onMouseOver={e=>(e.currentTarget.style.background='var(--stone-50)')} onMouseOut={e=>(e.currentTarget.style.background='transparent')}>
                    <div style={ss({display:'flex',justifyContent:'space-between',marginBottom:3})}><span style={ss({fontSize:12,fontWeight:700,color:'var(--stone-800)',display:'flex',alignItems:'center',gap:4})}>{n.pinned&&<i className="fas fa-thumbtack" style={{fontSize:9,color:'#ca8a04',transform:'rotate(20deg)'}}></i>}{n.title}</span><span style={ss({fontSize:10,color:'var(--stone-400)'})}>{relDate(n.updatedAt)}</span></div>
                    <div style={ss({fontSize:11,color:'var(--stone-400)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:5})}>{n.content.slice(0,60)||'Empty note…'}</div>
                    <div style={ss({display:'flex',gap:4})}><span style={ss({fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,background:cc.bg,color:cc.color})}>{n.category}</span>{n.pinned&&<span style={ss({fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:20,background:'#fffbeb',color:'#b45309'})}>Pinned</span>}</div>
                  </div>
                );})}
              </div>
            ):(
              <div style={ss({flex:1,display:'flex',flexDirection:'column',overflow:'hidden'})}>
                <div style={ss({padding:'10px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8,flexShrink:0})}>
                  <button onClick={()=>setActiveNote(null)} style={ss({width:26,height:26,borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit'})}><i className="fas fa-arrow-left" style={{fontSize:9,color:'var(--stone-400)'}}></i></button>
                  <div style={ss({flex:1})}>{editingNote?<input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)',border:'none',outline:'none',background:'transparent',fontFamily:'inherit',width:'100%'})}/>:<div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)'})}>{selNote.title}</div>}</div>
                  <button onClick={()=>{if(editingNote)saveNote();else setEditingNote(true);}} style={ss({padding:'4px 10px',borderRadius:8,border:'1px solid var(--border)',background:editingNote?'#06245B':'var(--card)',color:editingNote?'#fff':'var(--stone-500)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>{editingNote?'Save':'Edit'}</button>
                  <button onClick={()=>togglePin(selNote.id)} style={ss({width:26,height:26,borderRadius:8,border:'1px solid var(--border)',background:selNote.pinned?'#fffbeb':'var(--card)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit'})}><i className="fas fa-thumbtack" style={{fontSize:9,color:selNote.pinned?'#ca8a04':'var(--stone-400)',transform:'rotate(20deg)'}}></i></button>
                </div>
                <div style={ss({flex:1,overflow:'auto',padding:'12px 16px'})}>{editingNote?<textarea value={noteContent} onChange={e=>setNoteContent(e.target.value)} style={ss({width:'100%',height:'100%',border:'none',outline:'none',fontSize:12,fontFamily:'inherit',lineHeight:1.7,color:'var(--stone-600)',resize:'none',background:'transparent'})}/>:<div style={ss({fontSize:12,lineHeight:1.7,color:'var(--stone-600)',whiteSpace:'pre-wrap'})}>{selNote.content||'Empty — click Edit to add content.'}</div>}</div>
              </div>
            )}
          </>),
          sessions: (
            <div style={ss({flex:1,overflowY:'auto'})}>
              {/* Schedule form */}
              {isCounselor&&showSessionForm&&<div style={ss({padding:'14px 16px',borderBottom:'1px solid var(--border)',background:'var(--stone-50)'})}>
                <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8})}>
                  <div><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Date *</div><input type="date" value={sessDate} min={new Date().toISOString().split('T')[0]} onChange={e=>setSessDate(e.target.value)} style={ss({width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',color:'var(--stone-700)',boxSizing:'border-box'})}/></div>
                  <div><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Time *</div><input type="time" value={sessTime} onChange={e=>setSessTime(e.target.value)} style={ss({width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',color:'var(--stone-700)',boxSizing:'border-box'})}/></div>
                </div>
                <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8})}>
                  <div><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Timezone *</div><select value={sessTz} onChange={e=>setSessTz(e.target.value)} style={ss({width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',color:'var(--stone-700)',background:'#fff',boxSizing:'border-box'})}>{US_TIMEZONES.map(tz=><option key={tz.value} value={tz.value}>{tz.label}</option>)}</select></div>
                  <div><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Duration</div><select value={sessDuration} onChange={e=>setSessDuration(e.target.value)} style={ss({width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',color:'var(--stone-700)',background:'#fff',boxSizing:'border-box'})}><option value="30">30 min</option><option value="45">45 min</option><option value="60">60 min</option><option value="90">90 min</option></select></div>
                </div>
                <div style={ss({marginBottom:8})}><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Topic * <span style={ss({fontWeight:500,color:'var(--stone-300)'})}>(max 50 chars)</span></div><input value={sessTopic} onChange={e=>setSessTopic(e.target.value.slice(0,50))} maxLength={50} placeholder="e.g. Essay review" style={ss({width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',color:'var(--stone-700)',boxSizing:'border-box'})}/></div>
                <div style={ss({marginBottom:10})}><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Meeting link (optional)</div><input value={sessLink} onChange={e=>setSessLink(e.target.value)} placeholder="https://zoom.us/j/..." style={ss({width:'100%',padding:'7px 10px',border:'1px solid var(--border)',borderRadius:8,fontSize:12,fontFamily:'inherit',outline:'none',color:'var(--stone-700)',boxSizing:'border-box'})}/></div>
                <button onClick={scheduleSession} disabled={!sessDate||!sessTime||!sessTopic.trim()} style={ss({width:'100%',padding:'9px 0',borderRadius:10,border:'none',background:sessDate&&sessTime&&sessTopic.trim()?'#06245B':'var(--stone-200)',color:sessDate&&sessTime&&sessTopic.trim()?'#fff':'var(--stone-400)',fontSize:12,fontWeight:700,cursor:sessDate&&sessTime&&sessTopic.trim()?'pointer':'default',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:6})}><i className="fas fa-calendar-plus" style={{fontSize:10}}></i>Schedule Session</button>
              </div>}
              {sessions.length===0&&!(isCounselor&&showSessionForm)&&<div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-300)'})}><i className="fas fa-video" style={{fontSize:28,display:'block',marginBottom:8,opacity:.4}}></i><div style={{fontSize:12,fontWeight:600}}>No sessions yet</div></div>}
              {upSess.map(se=>{const d=daysUntil(se.date); return(
                <div key={se.id} style={ss({padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}><i className="fas fa-video" style={{fontSize:11,color:'#06245B'}}></i></div>
                  <div style={ss({flex:1,minWidth:0})}>
                    <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)'})}>{fmtDate(se.date)} · {se.time}</div>
                    <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:1})}>{se.topic} · {se.duration}min</div>
                  </div>
                  {isCounselor&&<>
                    <button onClick={async(e)=>{e.stopPropagation();setSessions(p=>p.map(x=>x.id===se.id?{...x,status:'completed'}:x));setStudents(p=>p.map(x=>x.id===selectedStudentId?{...x,sessionsUsed:x.sessionsUsed+1}:x));try{await apiPatch({entity:'session',id:parseInt(se.id),status:'completed'});}catch{}}} style={ss({padding:'3px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:9,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)',flexShrink:0})} title="Mark as completed"><i className="fas fa-check" style={{fontSize:7,marginRight:3}}></i>Done</button>
                    <button onClick={async(e)=>{e.stopPropagation();if(!confirm('Cancel this session?'))return;setSessions(p=>p.map(x=>x.id===se.id?{...x,status:'cancelled'}:x));try{await apiPatch({entity:'session',id:parseInt(se.id),status:'cancelled'});}catch{}}} style={ss({padding:'3px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:9,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'#dc2626',flexShrink:0})} title="Cancel session"><i className="fas fa-times" style={{fontSize:7}}></i></button>
                  </>}
                  <span style={ss({fontSize:8,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'#eff6ff',color:'#06245B',flexShrink:0})}>{d<=0?'Today':d===1?'Tmrw':`${d}d`}</span>
                </div>
              );})}
              {pastSess.map(se=>(
                <div key={se.id} style={ss({padding:'12px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'#ecfdf5',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}><i className="fas fa-check" style={{fontSize:10,color:'#059669'}}></i></div>
                  <div style={ss({flex:1})}><div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)'})}>{fmtDate(se.date)} · {se.time}</div><div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:1})}>{se.topic} · {se.duration}min</div></div>
                  <span style={ss({fontSize:8,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'#ecfdf5',color:'#059669',flexShrink:0})}>Done</span>
                </div>
              ))}
              {cancelledSess.length>0&&<>
                <div style={ss({padding:'8px 16px',fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.5px',borderBottom:'1px solid var(--border)',background:'var(--stone-50)'})}>Cancelled</div>
                {cancelledSess.map(se=>(
                  <div key={se.id} style={ss({padding:'10px 16px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10,opacity:.4})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}><i className="fas fa-ban" style={{fontSize:10,color:'var(--stone-400)'}}></i></div>
                    <div style={ss({flex:1})}><div style={ss({fontSize:12,fontWeight:600,color:'var(--stone-500)',textDecoration:'line-through'})}>{fmtDate(se.date)} · {se.time}</div><div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:1})}>{se.topic}</div></div>
                    <span style={ss({fontSize:8,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'var(--stone-100)',color:'var(--stone-400)',flexShrink:0})}>Cancelled</span>
                  </div>
                ))}
              </>}
            </div>
          ),
        };

        const headerActions: Record<string,React.ReactNode> = {
          notes: isExpired ? null : <button onClick={createNote} style={ss({padding:'4px 10px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)'})}>+ New</button>,
          sessions: isExpired ? null : (isCounselor ? <button onClick={()=>setShowSessionForm(!showSessionForm)} style={ss({padding:'4px 10px',borderRadius:8,border:'1px solid var(--border)',background:showSessionForm?'#06245B':'var(--card)',color:showSessionForm?'#fff':'var(--stone-500)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>{showSessionForm?'Cancel':'Schedule'}</button> : undefined),
        };

        function PanelHeader({ p, isExpanded }: { p: typeof PANELS[0]; isExpanded: boolean }) {
          return (
            <div style={ss({padding:'12px 18px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8,flexShrink:0})}>
              <i className={`fas ${p.icon}`} style={{fontSize:12,color:'var(--stone-400)'}}></i>
              <span style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)',flex:1})}>{p.label}</span>
              {p.badge&&<span style={ss({padding:'2px 8px',borderRadius:20,background:p.badgeBg,color:p.badgeColor,fontSize:10,fontWeight:700})}>{p.badge}</span>}
              {headerActions[p.key]}
              <button onClick={()=>setExpandedPanel(isExpanded?null:p.key)} title={isExpanded?'Collapse':'Expand'}
                style={ss({width:26,height:26,borderRadius:8,border:'1px solid var(--border)',background:isExpanded?'#06245B':'var(--card)',color:isExpanded?'#fff':'var(--stone-400)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit',fontSize:10,flexShrink:0,transition:'all .15s'})}>
                <i className={`fas ${isExpanded?'fa-compress-alt':'fa-expand-alt'}`} style={{fontSize:9}}></i>
              </button>
            </div>
          );
        }

        /* ── EXPANDED MODE ── */
        if (expandedPanel) {
          const exp = PANELS.find(p=>p.key===expandedPanel)!;
          const rest = PANELS.filter(p=>p.key!==expandedPanel);
          return (
            <div style={ss({display:'flex',flexDirection:'column',gap:10,minHeight:500})}>
              {/* Minimized tabs */}
              <div style={ss({display:'flex',gap:8})}>
                {rest.map(p=>(
                  <button key={p.key} onClick={()=>setExpandedPanel(p.key)}
                    style={ss({flex:1,display:'flex',alignItems:'center',gap:8,padding:'10px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',cursor:'pointer',fontFamily:'inherit',transition:'all .12s'})}
                    onMouseOver={e=>(e.currentTarget.style.borderColor='var(--stone-300)')}
                    onMouseOut={e=>(e.currentTarget.style.borderColor='var(--border)')}>
                    <i className={`fas ${p.icon}`} style={{fontSize:11,color:'var(--stone-400)'}}></i>
                    <span style={ss({fontSize:12,fontWeight:700,color:'var(--stone-700)'})}>{p.label}</span>
                    {p.badge&&<span style={ss({padding:'2px 7px',borderRadius:20,background:p.badgeBg,color:p.badgeColor,fontSize:9,fontWeight:700})}>{p.badge}</span>}
                  </button>
                ))}
              </div>
              {/* Expanded panel */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,height:500,display:'flex',flexDirection:'column',overflow:'hidden'})}>
                <PanelHeader p={exp} isExpanded={true}/>
                {panelContent[exp.key]}
              </div>
            </div>
          );
        }

        /* ── 2×2 GRID MODE ── */
        return (
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gridTemplateRows:'380px 340px',gap:10})}>
            {PANELS.map((p)=>(
              <div key={p.key} style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,display:'flex',flexDirection:'column',overflow:'hidden'})}>
                <PanelHeader p={p} isExpanded={false}/>
                {panelContent[p.key]}
              </div>
            ))}
          </div>
        );
      })()}

      {/* ═══ SHARED ESSAYS (counselor only) ═══ */}
      {isCounselor && (
        <div style={ss({marginTop:10,flexShrink:0})}>
          <button onClick={()=>setShowEssays(!showEssays)} style={ss({display:'flex',alignItems:'center',gap:8,padding:'10px 16px',borderRadius:showEssays?'10px 10px 0 0':'10px',border:showEssays?'1px solid var(--border)':'1px solid #06245B',background:showEssays?'var(--card)':'#06245B',cursor:'pointer',fontFamily:'inherit',width:'100%',borderBottom:showEssays?'none':undefined})}>
            <i className="fas fa-pen-nib" style={{fontSize:11,color:showEssays?'var(--stone-400)':'#fff'}}></i>
            <span style={ss({fontSize:12,fontWeight:700,color:showEssays?'var(--stone-700)':'#fff',flex:1,textAlign:'left'})}>Shared Essays</span>
            {sharedEssays.length>0&&<span style={ss({padding:'2px 8px',borderRadius:20,background:showEssays?'var(--stone-100)':'rgba(255,255,255,.16)',color:showEssays?'var(--stone-500)':'#fff',fontSize:10,fontWeight:700})}>{sharedEssays.length}</span>}
            <i className={`fas fa-chevron-${showEssays?'up':'down'}`} style={{fontSize:9,color:showEssays?'var(--stone-400)':'#fff'}}></i>
          </button>
          {showEssays&&(
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 14px 14px',overflow:'hidden'})}>
              {/* + New Essay button */}
              {!editingEssay&&!isExpired&&<div style={ss({padding:'10px 16px',borderBottom:'1px solid var(--border)'})}>
                <button onClick={()=>{setEditingEssay({_isNew:true,topic:'',essay_type:'Supplemental',college_name:'',expert_tag:'Expert Review'});setEssayEditText('');setEssayEditHtml('');setTimeout(()=>{if(essayEditorRef.current)essayEditorRef.current.innerHTML='';},0);}} style={ss({padding:'7px 14px',borderRadius:8,border:'none',background:'#06245B',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6})}><i className="fas fa-plus" style={{fontSize:9}}></i>New Essay</button>
              </div>}
              {sharedEssays.length===0&&!editingEssay&&<div style={ss({padding:'24px 20px',textAlign:'center',color:'var(--stone-400)'})}><i className="fas fa-pen-nib" style={{fontSize:20,display:'block',marginBottom:6,opacity:.3}}></i><div style={{fontSize:12,fontWeight:600}}>No shared essays yet</div><div style={{fontSize:10,color:'var(--stone-300)',marginTop:4}}>Student can share essays from Essay Studio</div></div>}
              {!editingEssay ? (
                sharedEssays.map(e=>(
                  <div key={e.id} onClick={()=>{setEditingEssay(e);const dt=e.draft_text||'';const hasHtml=dt.includes('<b>')||dt.includes('<i>')||dt.includes('<s>')||dt.includes('<strike')||dt.includes('background')||dt.includes('<br');setEssayEditHtml(hasHtml?dt:dt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'));setEssayEditText(hasHtml?essayStripHtml(dt):dt);setTimeout(()=>{if(essayEditorRef.current)essayEditorRef.current.innerHTML=hasHtml?dt:dt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');},0);}} style={ss({padding:'12px 18px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'flex-start',gap:12,cursor:'pointer',transition:'background .1s'})}
                    onMouseOver={ev=>(ev.currentTarget.style.background='var(--stone-50)')}
                    onMouseOut={ev=>(ev.currentTarget.style.background='')}>
                    <div style={ss({width:34,height:34,borderRadius:8,background:e.expert_tag?'#fefce8':'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                      <i className={`fas ${e.expert_tag?'fa-user-tie':'fa-pen-nib'}`} style={{fontSize:12,color:e.expert_tag?'#a16207':'#06245B'}}></i>
                    </div>
                    <div style={ss({flex:1,minWidth:0})}>
                      <div style={ss({display:'flex',alignItems:'center',gap:6,marginBottom:2})}>
                        <span style={ss({fontSize:13,fontWeight:700,color:'var(--stone-900)'})}>{e.topic||'Untitled'}</span>
                        {e.expert_tag&&<span style={ss({fontSize:8,fontWeight:700,padding:'2px 7px',borderRadius:20,background:'#fefce8',color:'#a16207'})}>Expert Review</span>}
                      </div>
                      <div style={ss({fontSize:11,color:'var(--stone-400)'})}>{e.essay_type} · {e.word_count} words{e.college_name?` · ${e.college_name}`:''}</div>
                    </div>
                    <i className="fas fa-chevron-right" style={{fontSize:9,color:'var(--stone-300)',alignSelf:'center',flexShrink:0}}></i>
                  </div>
                ))
              ) : (
                <div style={ss({padding:'16px 18px'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:12})}>
                    <button onClick={()=>{setEditingEssay(null);setEssayEditText('');}} style={ss({width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit'})}><i className="fas fa-arrow-left" style={{fontSize:9,color:'var(--stone-400)'}}></i></button>
                    <div style={ss({flex:1})}>
                      {editingEssay._isNew?(
                        <input value={editingEssay.topic} onChange={e=>{setEditingEssay((p:any)=>({...p,topic:e.target.value}));}} placeholder="Essay title…" style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)',border:'none',outline:'none',background:'transparent',width:'100%',fontFamily:'inherit',padding:0})}/>
                      ):(
                        <div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)'})}>{editingEssay.topic||'Untitled'}</div>
                      )}
                      <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:1})}>
                        {editingEssay._isNew?'New expert essay':(editingEssay.expert_tag?'Editing expert review':'Student essay · Save as expert review')}
                      </div>
                    </div>
                    <span style={ss({fontSize:10,fontWeight:600,color:'var(--stone-400)'})}>{essayEditText.trim().split(/\s+/).filter(Boolean).length} words</span>
                  </div>
                  {editingEssay._isNew&&<div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10})}>
                    <div><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>Essay type</div><select value={editingEssay.essay_type} onChange={e=>setEditingEssay((p:any)=>({...p,essay_type:e.target.value}))} style={ss({width:'100%',padding:'6px 8px',border:'1px solid var(--border)',borderRadius:8,fontSize:11,fontFamily:'inherit',color:'var(--stone-700)',background:'#fff',boxSizing:'border-box'})}><option>Personal Statement</option><option>Supplemental</option><option>Why Us</option><option>Activities</option><option>Other</option></select></div>
                    <div><div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginBottom:3})}>College (optional)</div><input value={editingEssay.college_name||''} onChange={e=>setEditingEssay((p:any)=>({...p,college_name:e.target.value}))} placeholder="e.g. Stanford" style={ss({width:'100%',padding:'6px 8px',border:'1px solid var(--border)',borderRadius:8,fontSize:11,fontFamily:'inherit',color:'var(--stone-700)',boxSizing:'border-box'})}/></div>
                  </div>}
                  {/* Formatting toolbar */}
                  {!isExpired&&<div style={ss({display:'flex',alignItems:'center',gap:4,marginBottom:8})}>
                    <div style={ss({position:'relative'})}>
                      <button type="button" onClick={()=>{setEssayFmtOpen(!essayFmtOpen);setEssayHlOpen(false);}} title="Format"
                        style={ss({width:26,height:26,borderRadius:6,border:`1px solid ${essayFmtOpen?'var(--stone-400)':'var(--border)'}`,background:essayFmtOpen?'var(--stone-100)':'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontWeight:700,color:'var(--stone-600)'})}>A</button>
                      {essayFmtOpen&&<div style={ss({position:'absolute',top:30,left:0,background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,padding:4,display:'flex',gap:3,zIndex:10,boxShadow:'0 4px 12px rgba(0,0,0,.08)'})}>
                        <button type="button" onClick={()=>{essayExecFmt('bold');setEssayFmtOpen(false);}} style={ss({width:26,height:26,borderRadius:5,border:'1px solid var(--border)',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontWeight:800,color:'var(--stone-700)'})}>B</button>
                        <button type="button" onClick={()=>{essayExecFmt('italic');setEssayFmtOpen(false);}} style={ss({width:26,height:26,borderRadius:5,border:'1px solid var(--border)',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontFamily:'inherit',fontSize:11,fontStyle:'italic',color:'var(--stone-700)'})}>I</button>
                        <button type="button" onClick={()=>{essayExecFmt('strikethrough');setEssayFmtOpen(false);}} style={ss({width:26,height:26,borderRadius:5,border:'1px solid var(--border)',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontFamily:'inherit',fontSize:11,textDecoration:'line-through',color:'var(--stone-700)'})}>S</button>
                      </div>}
                    </div>
                    <div style={ss({position:'relative'})}>
                      <button type="button" onClick={()=>{setEssayHlOpen(!essayHlOpen);setEssayFmtOpen(false);}} title="Highlight"
                        style={ss({width:26,height:26,borderRadius:6,border:`1px solid ${essayHlOpen?'var(--stone-400)':'var(--border)'}`,background:essayHlOpen?'var(--stone-100)':'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',position:'relative'})}>
                        <i className="fas fa-highlighter" style={{fontSize:8,color:'var(--stone-500)'}}></i>
                        <span style={ss({position:'absolute',bottom:2,right:2,width:6,height:6,borderRadius:2,background:essayHlColor==='yellow'?'#fef9c3':essayHlColor==='green'?'#dcfce7':'#fce7f3',border:`1px solid ${essayHlColor==='yellow'?'#e5d18a':essayHlColor==='green'?'#86efac':'#f9a8d4'}`})}></span>
                      </button>
                      {essayHlOpen&&<div style={ss({position:'absolute',top:30,left:0,background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,padding:4,display:'flex',gap:3,zIndex:10,boxShadow:'0 4px 12px rgba(0,0,0,.08)'})}>
                        {(['yellow','green','pink'] as const).map(c=>(<button key={c} type="button" onClick={()=>essayApplyHighlight(c)} style={ss({width:22,height:22,borderRadius:5,background:c==='yellow'?'#fef9c3':c==='green'?'#dcfce7':'#fce7f3',border:essayHlColor===c?'2px solid var(--stone-900)':'2px solid transparent',cursor:'pointer'})}></button>))}
                        <button type="button" onClick={essayRemoveHighlight} style={ss({width:22,height:22,borderRadius:5,background:'var(--stone-50)',border:'2px solid transparent',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'})}><i className="fas fa-times" style={{fontSize:7,color:'var(--stone-400)'}}></i></button>
                      </div>}
                    </div>
                  </div>}
                  {/* Rich text editor */}
                  <div ref={essayEditorRef} contentEditable={!isExpired} suppressContentEditableWarning
                    onInput={handleEssayEditorInput}
                    onClick={()=>{setEssayFmtOpen(false);setEssayHlOpen(false);}}
                    data-placeholder="Write essay content…"
                    style={ss({width:'100%',minHeight:200,border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px',fontSize:13,fontFamily:'inherit',lineHeight:1.7,color:isExpired?'var(--stone-400)':'var(--stone-700)',outline:'none',background:isExpired?'var(--stone-100)':'var(--stone-50)',boxSizing:'border-box',cursor:isExpired?'default':'text',overflowY:'auto'})}></div>
                  <div style={ss({display:'flex',justifyContent:'space-between',marginTop:4})}>
                    <span style={ss({fontSize:10,color:essayEditText.length>=950?'#dc2626':'var(--stone-400)'})}>{essayEditText.length}/1000 chars</span>
                    <span style={ss({fontSize:10,color:'var(--stone-400)'})}>{essayEditText.trim().split(/\s+/).filter(Boolean).length} words</span>
                  </div>
                  <div style={ss({display:'flex',gap:8,marginTop:10})}>
                    {!isExpired&&<button onClick={saveExpertEssay} disabled={essaySaving||!essayEditText.trim()||(editingEssay._isNew&&!editingEssay.topic?.trim())} style={ss({flex:1,padding:'10px 0',borderRadius:10,border:'none',background:essayEditText.trim()?'#06245B':'var(--stone-200)',color:essayEditText.trim()?'#fff':'var(--stone-400)',fontSize:12,fontWeight:700,cursor:essayEditText.trim()?'pointer':'default',fontFamily:'inherit',display:'flex',alignItems:'center',justifyContent:'center',gap:6})}>
                      <i className={`fas ${essaySaving?'fa-spinner fa-spin':'fa-check'}`} style={{fontSize:10}}></i>
                      {essaySaving?'Saving…':(editingEssay._isNew?'Create Essay':(editingEssay.expert_tag?'Update Expert Review':'Save as Expert Review'))}
                    </button>}
                    {!isExpired&&editingEssay.expert_tag&&!editingEssay._isNew&&<button onClick={async()=>{if(!confirm('Delete this expert review?'))return;try{await apiPatch({entity:'essay',id:parseInt(editingEssay.id),_delete:true});setSharedEssays(p=>p.filter(x=>x.id!==editingEssay.id));setEditingEssay(null);setEssayEditText('');}catch{}}} style={ss({padding:'10px 14px',borderRadius:10,border:'1px solid #fecaca',background:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'#dc2626'})}>Delete</button>}
                    <button onClick={()=>{setEditingEssay(null);setEssayEditText('');}} style={ss({padding:'10px 16px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)'})}>{isExpired?'Close':'Cancel'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ═══ STUDENT VIEW ═══ */
  if (!isCounselor) {
    // Student with no assignments — show payment confirmed or expert session prompt
    if (dataLoaded && students.length === 0) {
      return (
        <AppShell><main style={ss({display:'flex',flex:1,alignItems:'center',justifyContent:'center',background:'var(--bg)'})}>
          <div style={ss({textAlign:'center',maxWidth:400,padding:32})}>
            {needsNewAssignment?(
              <>
                <div style={ss({width:64,height:64,borderRadius:12,background:'#92400e',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'})}>
                  <i className="fas fa-check" style={{fontSize:24,color:'#FFE500'}}></i>
                </div>
                <div style={ss({fontSize:18,fontWeight:800,color:'var(--stone-900)',marginBottom:8})}>Payment Confirmed!</div>
                <div style={ss({fontSize:13,color:'var(--stone-500)',lineHeight:1.6,marginBottom:20})}>We're matching you with the perfect counselor. You'll see your sessions, messages, and action items here once assigned.</div>
                <div style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'8px 20px',borderRadius:8,background:'#fefce8',color:'#92400e',fontSize:12,fontWeight:700})}>
                  <div style={ss({width:8,height:8,borderRadius:'50%',background:'#10b981'})}></div>Matching in progress…
                </div>
                {/* Top-right floating pill — same UX as /expert-sessions
                    holding screens. Refreshes the portal in case the
                    empty state was shown due to transient data. Only
                    rendered when past_sessions_count > 0. */}
                {pastSessionsCount > 0 && (
                  <a href="/expert-portal" onClick={(e)=>{e.preventDefault();window.location.reload();}}
                    style={ss({position:'fixed',top:24,right:24,zIndex:50,display:'inline-flex',alignItems:'center',gap:10,padding:'10px 16px',borderRadius:999,background:'#06245B',color:'#FFE500',fontFamily:'inherit',fontSize:13,fontWeight:800,textDecoration:'none',boxShadow:'0 6px 20px rgba(0,0,0,.18)'})}>
                    <i className="fas fa-clock-rotate-left" style={{fontSize:12}}></i>
                    Past sessions
                    <span style={ss({padding:'2px 7px',borderRadius:999,background:'#FFE500',color:'#06245B',fontSize:10,fontWeight:900,marginLeft:2})}>{pastSessionsCount}</span>
                    <i className="fas fa-arrow-right" style={{fontSize:10,opacity:.85}}></i>
                  </a>
                )}
              </>
            ):(
              <>
                <div style={ss({width:64,height:64,borderRadius:12,background:'#06245B',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'})}>
                  <i className="fas fa-user-graduate" style={{fontSize:24,color:'#FFE500'}}></i>
                </div>
                <div style={ss({fontSize:18,fontWeight:800,color:'var(--stone-900)',marginBottom:8})}>Expert Session</div>
                <div style={ss({fontSize:13,color:'var(--stone-500)',lineHeight:1.6,marginBottom:20})}>Get personalized guidance on your college strategy, essay review, and application timeline.</div>
                <a href="/expert-sessions?browse=1" style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'12px 24px',borderRadius:10,background:'#06245B',color:'#fff',fontSize:13,fontWeight:800,textDecoration:'none'})}>
                  Book Session <i className="fas fa-arrow-right" style={{fontSize:11}}></i>
                </a>
              </>
            )}
          </div>
        </main></AppShell>
      );
    }

    const cNext = sessCountdown(sessions);
    const sessActive = student.sessionsUsed < student.sessionsTotal && student.sessionsTotal > 0;
    const cUnread = messages.filter(m=>!m.read&&m.from==='counselor').length;
    const cPending = actions.filter(a=>!a.done).length;

    const switchCard = async (sid: string) => {
      if (sid === selectedStudentId) return;
      setSelectedStudentId(sid);
      const card = students.find(s => s.id === sid);
      if (!card) return;
      // Update counselor state to reflect selected card's counselor
      setCounselor(prev => ({ ...prev, name: card.name, initials: card.initials, title: card.grade }));
      // Load assignment data
      const aid = String(card.assignmentId);
      try {
        const [msgs2, sess2, acts2, nts2] = await Promise.all([
          apiGet({ entity: 'messages', assignment_id: aid }),
          apiGet({ entity: 'sessions', assignment_id: aid }),
          apiGet({ entity: 'actions', assignment_id: aid }),
          apiGet({ entity: 'notes', assignment_id: aid }),
        ]);
        if (Array.isArray(msgs2)) setMessagesByStudent(p => ({ ...p, [sid]: msgs2.map((m: any) => ({ id: String(m.id), from: m.sender_role, text: m.body, timestamp: m.created_at, read: m.is_read })) }));
        if (Array.isArray(sess2)) setSessionsByStudent(p => ({ ...p, [sid]: sess2.map((s2: any) => ({ id: String(s2.id), date: s2.session_date, time: s2.session_time || '3:00 PM', duration: s2.duration_min || 60, topic: s2.topic || 'Session', status: s2.status || 'upcoming', notes: s2.notes || '', zoomLink: s2.zoom_link })) }));
        if (Array.isArray(acts2)) setActionsByStudent(p => ({ ...p, [sid]: acts2.map((a2: any) => ({ id: String(a2.id), text: a2.text, done: a2.is_done, dueDate: a2.due_date, assignedBy: a2.assigned_by || 'counselor', category: a2.category || 'Application' })) }));
        if (Array.isArray(nts2)) setNotesByStudent(p => ({ ...p, [sid]: nts2.map((n2: any) => ({ id: String(n2.id), title: n2.title, content: n2.content, author: n2.author_role || 'counselor', updatedAt: n2.updated_at, pinned: n2.is_pinned, category: n2.category || 'Session Notes' })) }));
      } catch {}
    };

    return (
    <AppShell><style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:var(--stone-300);pointer-events:none;font-style:italic}[contenteditable]:focus{outline:none}`}</style><main style={ss({display:'flex',flex:1,height:'100vh',overflow:'hidden'})}>
      <div style={ss({width:panelCollapsed?54:210,flexShrink:0,borderRight:'1px solid var(--border)',background:'var(--card)',display:'flex',flexDirection:'column',overflow:'hidden',transition:'width .2s ease'})}>
        <div style={ss({padding:panelCollapsed?'12px 0':'12px 12px',display:'flex',alignItems:'center',justifyContent:panelCollapsed?'center':'space-between',gap:8,flexShrink:0,borderBottom:'1px solid var(--border)'})}>
          {!panelCollapsed&&<span style={ss({fontSize:11,fontWeight:800,color:'var(--stone-900)'})}>{students.length>1?'My Counselors':'My Counselor'}</span>}
          <button onClick={()=>setPanelCollapsed(!panelCollapsed)} style={ss({width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--stone-50)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit',flexShrink:0})}><i className={`fas fa-chevron-${panelCollapsed?'right':'left'}`} style={{fontSize:8,color:'var(--stone-400)'}}></i></button>
        </div>
        {panelCollapsed?(
          <div style={ss({flex:1,display:'flex',flexDirection:'column',alignItems:'center',padding:'12px 0',gap:6})}>
            {students.map((s,i)=>{const isSel=s.id===selectedStudentId; return(
              <div key={s.id} onClick={()=>switchCard(s.id)} title={`${s.name} · ${s.plan}`} style={ss({width:32,height:32,borderRadius:10,background:s.avatar||'#D5F5E8',display:'flex',alignItems:'center',justifyContent:'center',color:s.avatarText||'#065F46',fontWeight:800,fontSize:10,cursor:'pointer',border:isSel?'2px solid #06245B':'2px solid transparent',flexShrink:0})}>{s.initials}</div>
            );})}
          </div>
        ):(
          <div style={ss({flex:1,overflowY:'auto',padding:'8px 8px',display:'flex',flexDirection:'column',gap:5})}>
            {students.map((s,i)=>{
              const isSel=s.id===selectedStudentId;
              const sessPct=s.sessionsTotal>0?(s.sessionsUsed/s.sessionsTotal)*100:0;
              const expired=isExpiredGrace(s.endDate,s.assignmentStatus);
              const sUp=sessionsByStudent[s.id]||[];
              const sNext=sessCountdown(sUp);
              const sPending=(actionsByStudent[s.id]||[]).filter(a=>!a.done).length;
              const sUnread=(messagesByStudent[s.id]||[]).filter(m=>!m.read&&m.from==='counselor').length;
              const planActive=s.assignmentStatus==='active';
              return(
              <div key={s.id} onClick={()=>switchCard(s.id)} style={ss({padding:'10px 12px',borderRadius:10,border:isSel?'2px solid #06245B':'1px solid var(--border)',background:expired?'var(--stone-50)':(isSel?'var(--stone-50)':'var(--card)'),cursor:'pointer',opacity:expired?.35:1,transition:'border-color .12s'})}
                onMouseOver={e=>{if(!isSel&&!expired)(e.currentTarget as HTMLElement).style.borderColor='var(--stone-300)';}}
                onMouseOut={e=>{if(!isSel&&!expired)(e.currentTarget as HTMLElement).style.borderColor='var(--border)';}}>
                {/* Row 1: Avatar + Name + Plan status */}
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:6})}>
                  <div style={ss({width:32,height:32,borderRadius:10,background:expired?'var(--stone-200)':(s.avatar||'#D5F5E8'),display:'flex',alignItems:'center',justifyContent:'center',color:expired?'var(--stone-400)':(s.avatarText||'#065F46'),fontWeight:800,fontSize:12,flexShrink:0,position:'relative'})}>
                    {s.initials}
                    {!expired&&<div style={ss({position:'absolute',bottom:-1,right:-1,width:9,height:9,borderRadius:'50%',background:planActive?'#10b981':'#a8a29e',border:'2px solid var(--card)'})}/>}
                  </div>
                  <div style={ss({flex:1,minWidth:0})}>
                    <div style={ss({fontSize:14,fontWeight:800,color:expired?'var(--stone-400)':'var(--stone-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{shortName(s.name)}</div>
                  </div>
                  <span style={ss({fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:20,background:expired?'#fef2f2':(planActive?'#ecfdf5':'#fef2f2'),color:expired?'#dc2626':(planActive?'#059669':'#dc2626'),flexShrink:0})}>{expired?'Ended':(planActive?'Active':'Ended')}</span>
                </div>
                {/* Row 2: Indicators — messages, actions, session countdown */}
                {!expired&&<div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'})}>
                  {sUnread>0&&<div style={ss({display:'flex',alignItems:'center',gap:3})}><i className="fas fa-comment-dots" style={{fontSize:10,color:'#dc2626'}}></i><span style={ss({fontSize:10,fontWeight:700,color:'#dc2626'})}>{sUnread}</span></div>}
                  {sPending>0&&<div style={ss({display:'flex',alignItems:'center',gap:3})}><i className="fas fa-circle-check" style={{fontSize:10,color:'#d97706'}}></i><span style={ss({fontSize:10,fontWeight:700,color:'#d97706'})}>{sPending}</span></div>}
                  {sNext&&<div style={ss({display:'flex',alignItems:'center',gap:3})}><i className="fas fa-video" style={{fontSize:10,color:'#06245B'}}></i><span style={ss({fontSize:10,fontWeight:700,color:'#06245B'})}>{sNext}</span></div>}
                  {!sUnread&&!sPending&&!sNext&&<span style={ss({fontSize:10,color:'var(--stone-300)'})}>No activity</span>}
                </div>}
                {/* Row 3: Plan name + progress bar */}
                <div style={ss({display:'flex',alignItems:'center',gap:8})}>
                  {s.plan&&<span style={ss({fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:6,background:expired?'var(--stone-100)':'#fefce8',color:expired?'var(--stone-400)':'#a16207',flexShrink:0})}>{s.plan}</span>}
                  <div style={ss({flex:1,display:'flex',alignItems:'center',gap:6})}>
                    <div style={ss({flex:1,height:4,borderRadius:2,background:'var(--stone-100)',overflow:'hidden'})}>
                      <div style={ss({height:'100%',borderRadius:2,background:expired?'var(--stone-300)':(sessPct>=100?'#10b981':'#FFE500'),width:`${Math.min(sessPct,100)}%`,transition:'width .3s'})}/>
                    </div>
                    <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',flexShrink:0})}>{s.sessionsUsed}/{s.sessionsTotal}</span>
                  </div>
                </div>
              </div>
            );})}
          </div>
        )}
        {/* Bottom banner: context-aware status / upgrade prompt.
            Priority order (most informative state wins):
              1. Premium request pending_review  → "Under Review"
              2. Premium request awaiting_payment → "Payment Link Ready"
              3. needsNewAssignment              → "Payment Confirmed (matching)"
              4. Pending acceptance (counselor not yet accepted)
                                                  → "Awaiting Counselor"
              5. isPaid (Pro w/ no in-flight Premium activity)
                                                  → "Book Session"
              6. expired/free                    → "Upgrade to Pro"
            We always show the banner when any of states 1–4 apply, even
            if the student has an active assignment beneath — they need
            to see the in-flight Premium status. For 5 and 6 we only show
            when nothing is active so we don't compete with the main
            workspace UI. */}
        {!panelCollapsed&&(()=>{
          const allEnded = students.length===0 || students.every(s=>s.assignmentStatus!=='active');
          const reqPendingReview     = premiumReq?.status === 'pending_review';
          const reqAwaitingPayment   = premiumReq?.status === 'awaiting_payment';
          const inflightPremium      = reqPendingReview || reqAwaitingPayment || needsNewAssignment || hasPendingAcceptance;

          // ── State 1: pending_review ─────────────────────────────────
          if (reqPendingReview) return (
            <div style={ss({flexShrink:0,padding:'8px 8px',borderTop:'1px solid var(--border)'})}>
              <div style={ss({padding:'12px',borderRadius:10,background:'#eef5ff',border:'1px solid #c9d9f2'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:6})}>
                  <div style={ss({width:28,height:28,borderRadius:6,background:'#06245B',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                    <i className="fas fa-hourglass-half" style={{fontSize:11,color:'#fff'}}></i>
                  </div>
                  <div>
                    <div style={ss({fontSize:11,fontWeight:800,color:'#06245B'})}>Request Under Review</div>
                    <div style={ss({fontSize:9,color:'rgba(0,0,0,.55)',marginTop:1})}>{premiumReq?.plan_name} — admin reviewing</div>
                  </div>
                </div>
                <div style={ss({fontSize:10,color:'rgba(0,0,0,.6)',lineHeight:1.4})}>You'll receive a payment link by email shortly.</div>
              </div>
            </div>
          );

          // ── State 2: awaiting_payment ───────────────────────────────
          if (reqAwaitingPayment) return (
            <div style={ss({flexShrink:0,padding:'8px 8px',borderTop:'1px solid var(--border)'})}>
              <a href="/expert-sessions" style={ss({display:'block',padding:'12px',borderRadius:10,background:'#06245B',textDecoration:'none',cursor:'pointer'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:6})}>
                  <div style={ss({width:28,height:28,borderRadius:6,background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                    <i className="fas fa-credit-card" style={{fontSize:11,color:'#06245B'}}></i>
                  </div>
                  <div>
                    <div style={ss({fontSize:11,fontWeight:800,color:'#fff'})}>Payment Link Ready</div>
                    <div style={ss({fontSize:9,color:'rgba(255,255,255,.85)',marginTop:1})}>{premiumReq?.plan_name}</div>
                  </div>
                </div>
                <div style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'5px 12px',borderRadius:6,background:'#fff',color:'#06245B',fontSize:10,fontWeight:800})}>Pay now <i className="fas fa-arrow-right" style={{fontSize:8}}></i></div>
              </a>
            </div>
          );

          // States 3+ only render when no active session is in progress
          // (so they don't fight the main workspace).
          if (!allEnded) return null;
          // Student paid for new premium but no assignment created yet
          if (needsNewAssignment) return (
            <div style={ss({flexShrink:0,padding:'8px 8px',borderTop:'1px solid var(--border)'})}>
              <div style={ss({padding:'12px',borderRadius:10,background:'#eef5ff',border:'1px solid #c9d9f2'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:6})}>
                  <div style={ss({width:28,height:28,borderRadius:6,background:'#06245B',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                    <i className="fas fa-hourglass-half" style={{fontSize:11,color:'#fff'}}></i>
                  </div>
                  <div>
                    <div style={ss({fontSize:11,fontWeight:800,color:'#06245B'})}>Payment Confirmed</div>
                    <div style={ss({fontSize:9,color:'rgba(0,0,0,.55)',marginTop:1})}>Counselor assignment in progress</div>
                  </div>
                </div>
                <div style={ss({width:'100%',height:3,borderRadius:2,background:'rgba(6,36,91,.12)',overflow:'hidden'})}>
                  <div style={ss({width:'40%',height:'100%',borderRadius:2,background:'#06245B',animation:'pulse 1.5s ease-in-out infinite'})}/>
                </div>
              </div>
            </div>
          );

          // ── State 4: pending_acceptance — counselor hasn't accepted yet ──
          if (hasPendingAcceptance) return (
            <div style={ss({flexShrink:0,padding:'8px 8px',borderTop:'1px solid var(--border)'})}>
              <div style={ss({padding:'12px',borderRadius:10,background:'#eef5ff',border:'1px solid #c9d9f2'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:6})}>
                  <div style={ss({width:28,height:28,borderRadius:6,background:'#06245B',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                    <i className="fas fa-user-clock" style={{fontSize:11,color:'#dbeafe'}}></i>
                  </div>
                  <div>
                    <div style={ss({fontSize:11,fontWeight:800,color:'#06245B'})}>Awaiting Counselor</div>
                    <div style={ss({fontSize:9,color:'rgba(0,0,0,.55)',marginTop:1})}>Notified — waiting on acceptance</div>
                  </div>
                </div>
                <div style={ss({fontSize:10,color:'rgba(0,0,0,.6)',lineHeight:1.4})}>You'll get an email the moment they accept.</div>
              </div>
            </div>
          );

          // suppress unused-variable warning when none of the above hit
          void inflightPremium;
          // Past premium — show appropriate upgrade banner based on pro status
          if (isPaid) {
            // Pro is active — show Expert Session upgrade
            return (
              <div style={ss({flexShrink:0,padding:'8px 8px',borderTop:'1px solid var(--border)'})}>
                <a href="/expert-sessions?browse=1" style={ss({display:'block',padding:'14px',borderRadius:10,background:'#06245B',textDecoration:'none',cursor:'pointer'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:8})}>
                    <div style={ss({width:32,height:32,borderRadius:8,background:'#FFE500',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                      <i className="fas fa-user-graduate" style={{fontSize:13,color:'#06245B'}}></i>
                    </div>
                    <div>
                      <div style={ss({fontSize:12,fontWeight:800,color:'#fff'})}>Expert Session</div>
                      <div style={ss({fontSize:9,color:'rgba(255,255,255,.5)',marginTop:1})}>1-on-1 with a counselor</div>
                    </div>
                  </div>
                  <div style={ss({fontSize:10,color:'rgba(255,255,255,.4)',lineHeight:1.4,marginBottom:10})}>Get personalized guidance on your college strategy, essay review, and application timeline.</div>
                  <div style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:8,background:'#FFE500',color:'#06245B',fontSize:11,fontWeight:800})}>Book Session <i className="fas fa-arrow-right" style={{fontSize:9}}></i></div>
                </a>
              </div>
            );
          } else {
            // Pro expired or refunded — show Upgrade to Pro
            return (
              <div style={ss({flexShrink:0,padding:'8px 8px',borderTop:'1px solid var(--border)'})}>
                <a href="/subscribe" style={ss({display:'block',padding:'14px',borderRadius:10,background:'#06245B',textDecoration:'none',cursor:'pointer'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:8})}>
                    <div style={ss({width:32,height:32,borderRadius:8,background:'#FFE500',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
                      <i className="fas fa-bolt" style={{fontSize:13,color:'#06245B'}}></i>
                    </div>
                    <div>
                      <div style={ss({fontSize:12,fontWeight:800,color:'#fff'})}>Upgrade to Pro</div>
                      <div style={ss({fontSize:9,color:'rgba(255,255,255,.5)',marginTop:1})}>Required for Expert Sessions</div>
                    </div>
                  </div>
                  <div style={ss({fontSize:10,color:'rgba(255,255,255,.4)',lineHeight:1.4,marginBottom:10})}>Unlock college matching, essay tools, and expert counselor access with Admitly Pro.</div>
                  <div style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:8,background:'#FFE500',color:'#06245B',fontSize:11,fontWeight:800})}>Upgrade Now <i className="fas fa-arrow-right" style={{fontSize:9}}></i></div>
                </a>
              </div>
            );
          }
        })()}
      </div>
      {dashboard}
    </main></AppShell>
    );
  }

  /* ═══ COUNSELOR VIEW ═══ */
  const filtered = students.filter(s=>!search||s.name.toLowerCase().includes(search.toLowerCase()));
  const totalUnread = students.reduce((s,x)=>s+x.unread,0);
  const totalPending = students.reduce((s,x)=>s+x.pendingActions,0);
  return (
    <AppShell><style>{`[contenteditable]:empty:before{content:attr(data-placeholder);color:var(--stone-300);pointer-events:none;font-style:italic}[contenteditable]:focus{outline:none}`}</style><main style={ss({display:'flex',flex:1,height:'100vh',overflow:'hidden'})}>
      <div style={ss({width:panelCollapsed?54:225,flexShrink:0,borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',overflow:'hidden',background:'var(--card)',transition:'width .2s ease'})}>
        <div style={ss({padding:panelCollapsed?'12px 0':'12px 12px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:panelCollapsed?'center':'space-between',gap:6,flexShrink:0})}>
          {!panelCollapsed&&<><div style={ss({flex:1,minWidth:0})}><div style={ss({fontSize:11,fontWeight:800,color:'var(--stone-900)'})}>Students</div><div style={ss({fontSize:9,color:'var(--stone-400)'})}>{students.length} assigned</div></div><div style={ss({display:'flex',gap:3})}>{totalUnread>0&&<div style={ss({minWidth:18,height:18,borderRadius:9,background:'#fef2f2',color:'#dc2626',fontSize:8,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'})}>{totalUnread}</div>}{totalPending>0&&<div style={ss({minWidth:18,height:18,borderRadius:9,background:'#fffbeb',color:'#b45309',fontSize:8,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px'})}>{totalPending}</div>}</div></>}
          <button onClick={()=>setPanelCollapsed(!panelCollapsed)} style={ss({width:24,height:24,borderRadius:6,border:'1px solid var(--border)',background:'var(--stone-50)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'inherit',flexShrink:0})}><i className={`fas fa-chevron-${panelCollapsed?'right':'left'}`} style={{fontSize:8,color:'var(--stone-400)'}}></i></button>
        </div>
        {panelCollapsed?(
          <div style={ss({flex:1,overflowY:'auto',display:'flex',flexDirection:'column',alignItems:'center',padding:'8px 0',gap:5})}>
            {filtered.map((s,i)=>{const isSel=s.id===selectedStudentId;const P=['#E8D5F5','#D5E8F5','#D5F5E8','#F5E8D5','#F5D5E0'];const PT=['#6B21A8','#1E40AF','#065F46','#9A3412','#9F1239']; return(
              <div key={s.id} onClick={()=>setSelectedStudentId(s.id)} title={s.name} style={ss({width:32,height:32,borderRadius:10,background:P[i%5],display:'flex',alignItems:'center',justifyContent:'center',color:PT[i%5],fontWeight:800,fontSize:9,cursor:'pointer',position:'relative',border:isSel?'2px solid #06245B':'2px solid transparent',flexShrink:0})}>
                {s.initials}
                {s.unread>0&&<div style={ss({position:'absolute',top:-3,right:-3,minWidth:12,height:12,borderRadius:6,background:'#dc2626',color:'#fff',fontSize:7,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 2px'})}>{s.unread}</div>}
              </div>
            );})}
          </div>
        ):(
          <>
            <div style={ss({padding:'6px 8px',flexShrink:0})}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search…" style={ss({width:'100%',background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:8,padding:'6px 8px',fontFamily:'inherit',fontSize:10,fontWeight:600,color:'var(--stone-800)',outline:'none',boxSizing:'border-box'})}/></div>
            <div style={ss({flex:1,overflowY:'auto',padding:'2px 8px 8px',display:'flex',flexDirection:'column',gap:5})}>
              {filtered.map((s,idx)=>{
                const isSel=s.id===selectedStudentId;
                const away=s.status==='inactive';
                const sUp=sessionsByStudent[s.id]||[];
                const sNext=sessCountdown(sUp);
                const sPending=(actionsByStudent[s.id]||[]).filter(a=>!a.done).length;
                const sUnread=(messagesByStudent[s.id]||[]).filter(m=>!m.read&&m.from==='student').length;
                const stCfg=STATUS_CFG[s.status]||STATUS_CFG.inactive;
                const sessPct=s.sessionsTotal>0?(s.sessionsUsed/s.sessionsTotal)*100:0;
                const expired=isExpiredGrace(s.endDate,s.assignmentStatus);
                const planActive=s.assignmentStatus==='active';
                const P=['#E8D5F5','#D5E8F5','#D5F5E8','#F5E8D5','#F5D5E0'];
                const PT=['#6B21A8','#1E40AF','#065F46','#9A3412','#9F1239'];
                const bg=s.avatar||P[idx%5]; const tc=s.avatarText||PT[idx%5];
                return(
                <div key={s.id} onClick={()=>setSelectedStudentId(s.id)} style={ss({padding:'10px 12px',borderRadius:10,border:isSel?'2px solid #06245B':'1px solid var(--border)',background:expired?'var(--stone-50)':(isSel?'var(--stone-50)':'var(--card)'),cursor:'pointer',opacity:expired?.35:(away?.55:1),transition:'border-color .12s'})}
                  onMouseOver={e=>{if(!isSel&&!expired)(e.currentTarget as HTMLElement).style.borderColor='var(--stone-300)';}}
                  onMouseOut={e=>{if(!isSel&&!expired)(e.currentTarget as HTMLElement).style.borderColor='var(--border)';}}>
                  {/* Row 1: Avatar + Name + Plan status */}
                  <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:6})}>
                    <div style={ss({width:32,height:32,borderRadius:10,background:expired?'var(--stone-200)':bg,display:'flex',alignItems:'center',justifyContent:'center',color:expired?'var(--stone-400)':tc,fontWeight:800,fontSize:12,flexShrink:0,position:'relative'})}>
                      {s.initials}
                      {!expired&&<div style={ss({position:'absolute',bottom:-1,right:-1,width:9,height:9,borderRadius:'50%',background:stCfg.color,border:'2px solid var(--card)'})}/>}
                    </div>
                    <div style={ss({flex:1,minWidth:0})}>
                      <div style={ss({fontSize:14,fontWeight:800,color:expired?'var(--stone-400)':'var(--stone-900)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{shortName(s.name)}</div>
                    </div>
                    <span style={ss({fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:20,background:expired?'#fef2f2':(planActive?'#ecfdf5':'#fef2f2'),color:expired?'#dc2626':(planActive?'#059669':'#dc2626'),flexShrink:0})}>{expired?'Ended':(planActive?'Active':'Ended')}</span>
                  </div>
                  {/* Row 2: Indicators — messages, actions, session countdown */}
                  {!expired&&<div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'})}>
                    {sUnread>0&&<div style={ss({display:'flex',alignItems:'center',gap:3})}><i className="fas fa-comment-dots" style={{fontSize:10,color:'#dc2626'}}></i><span style={ss({fontSize:10,fontWeight:700,color:'#dc2626'})}>{sUnread}</span></div>}
                    {sPending>0&&<div style={ss({display:'flex',alignItems:'center',gap:3})}><i className="fas fa-circle-check" style={{fontSize:10,color:'#d97706'}}></i><span style={ss({fontSize:10,fontWeight:700,color:'#d97706'})}>{sPending}</span></div>}
                    {sNext&&<div style={ss({display:'flex',alignItems:'center',gap:3})}><i className="fas fa-video" style={{fontSize:10,color:'#06245B'}}></i><span style={ss({fontSize:10,fontWeight:700,color:'#06245B'})}>{sNext}</span></div>}
                    {!sUnread&&!sPending&&!sNext&&<span style={ss({fontSize:10,color:'var(--stone-300)'})}>No activity</span>}
                  </div>}
                  {/* Row 3: Plan name + progress bar */}
                  <div style={ss({display:'flex',alignItems:'center',gap:8})}>
                    {s.plan&&<span style={ss({fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:6,background:expired?'var(--stone-100)':'#fefce8',color:expired?'var(--stone-400)':'#a16207',flexShrink:0})}>{s.plan}</span>}
                    <div style={ss({flex:1,display:'flex',alignItems:'center',gap:6})}>
                      <div style={ss({flex:1,height:4,borderRadius:2,background:'var(--stone-100)',overflow:'hidden'})}>
                        <div style={ss({height:'100%',borderRadius:2,background:expired?'var(--stone-300)':(sessPct>=100?'#10b981':'#FFE500'),width:`${Math.min(sessPct,100)}%`,transition:'width .3s'})}/>
                      </div>
                      <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',flexShrink:0})}>{s.sessionsUsed}/{s.sessionsTotal}</span>
                    </div>
                  </div>
                </div>
              );})}
            </div>
          </>
        )}
      </div>
      {dashboard}
    </main></AppShell>
  );
}
