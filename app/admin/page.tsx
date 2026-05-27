 'use client';

import { useState, useEffect, useCallback, useRef, Fragment, CSSProperties } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { downloadCsv, type CsvColumn } from '@/lib/csv-export';

// Phase A — environment badge.
// Surface a red "PROD" pill when running against production so destructive
// actions (refund / broadcast / mass-email) require typing "PROD" to confirm.
// NEXT_PUBLIC_ENV_NAME overrides NODE_ENV so staging can keep the neutral
// pill even though it boots with NODE_ENV=production.
const ENV_NAME = (process.env.NEXT_PUBLIC_ENV_NAME || process.env.NODE_ENV || 'development').toLowerCase();
const IS_PROD = ENV_NAME === 'production';

interface AdminStats {
  total_users: number; active_last_7d: number; active_last_30d: number;
  total_colleges_saved: number; total_essays: number; submitted_essays: number;
  total_llm_calls: number; total_llm_tokens: number; total_llm_cost_usd: number;
  avg_profile_score: number; avg_colleges_per_user: number; avg_essays_per_user: number;
}
interface DailyActivity { date: string; logins: number; essays_created: number; colleges_added: number; llm_calls: number; llm_tokens: number; }
interface AdminStudent {
  id: number; name: string; email: string; role: string; is_locked: boolean;
  created_at: string; last_login: string | null;
  subscription_status: string; subscription_expires_at: string | null;
  gpa: number | null; sat: number | null; act: number | null; final_score: number | null;
  profile_updated_at: string | null; high_school_name: string | null; high_school_state: string | null;
  graduation_year: number | null; intended_major: string | null; phone: string | null;
  college_count: number; reach_count: number; target_count: number; safety_count: number;
  essay_count: number; submitted_essay_count: number; essay_word_count_total: number;
  llm_calls: number; llm_tokens_total: number; llm_cost_usd: number;
  has_expert_session: boolean; has_active_expert_session: boolean; needs_assignment: boolean; expert_plan: string;
}
interface AdminUser {
  id: number; name: string; email: string; role: string;
  is_locked: boolean; created_at: string; last_login: string | null;
  source: 'db' | 'env' | 'both';
}
interface LlmUsageRow {
  id: number; user_id: number | null; user_name: string | null; user_email: string | null;
  mode: string; essay_type: string | null; model: string;
  prompt_tokens: number; completion_tokens: number; total_tokens: number;
  cost_usd: number; created_at: string;
}
interface NewsItem { id: number; headline: string; summary: string; tag: string; is_visible: boolean; source_url?: string; is_custom?: boolean; created_at: string; }

function fmt(n: number, dec = 0) { return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
function fmtDate(s: string | null) { if (!s) return '—'; return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateTime(s: string | null) {
  if (!s) return 'Never'; const d = new Date(s); const diff = Date.now() - d.getTime();
  if (diff < 60000) return 'Just now'; if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`; if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function scoreBg(s: number | null): { bg: string; color: string } {
  if (!s) return { bg: 'var(--stone-100)', color: 'var(--stone-400)' };
  if (s >= 80) return { bg: 'var(--emerald-light)', color: '#065f46' };
  if (s >= 65) return { bg: '#eff6ff', color: '#1e40af' };
  if (s >= 50) return { bg: 'var(--amber-light)', color: '#92400e' };
  return { bg: 'var(--red-light)', color: '#991b1b' };
}

const ss = (o: CSSProperties) => o;
const inputA: CSSProperties = { padding:'8px 12px',border:'1px solid var(--border)',borderRadius:10,fontSize:13,fontWeight:600,fontFamily:'inherit',outline:'none',background:'var(--stone-50)' };
const thS: CSSProperties = { textAlign:'left',padding:'10px 16px',fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',whiteSpace:'nowrap' };
const tdS: CSSProperties = { padding:'10px 16px',fontSize:13 };

function Sparkbar({ data, color = 'var(--blue)' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div style={ss({display:'flex',alignItems:'flex-end',gap:1,height:40})}>
      {data.map((v, i) => <div key={i} style={{flex:1,borderRadius:2,transition:'all .3s',height:`${Math.max((v/max)*100, v>0?8:2)}%`,background:v>0?color:'var(--stone-200)',opacity:i===data.length-1?1:0.5+(i/data.length)*0.5}} />)}
    </div>
  );
}

// ── Phase 1 metrics dashboard helpers ─────────────────────────────────────
// These power the new ranged tiles on the Overview tab. We keep them as
// top-level helpers (rather than inline in the component) so the formatting
// rules are consistent across every future tile we migrate in Phase 2.

type MetricRange = '24h' | '7d' | '30d' | '90d' | 'ytd' | 'all';

interface MetricBundle { current: number; previous: number; spark: number[] }
interface MetricsResponse {
  range: MetricRange;
  since: string; until: string;
  previous_since: string | null; previous_until: string | null;
  bucket: string;
  metrics: Record<string, MetricBundle>;
}

const METRIC_RANGES: { id: MetricRange; label: string }[] = [
  { id: '24h', label: '24h' },
  { id: '7d',  label: '7d'  },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
  { id: 'ytd', label: 'YTD' },
  { id: 'all', label: 'All' },
];

/** Compact dollar formatting: $1.2k / $1.4M above $10k, full $1,234.56 below. */
function fmtMoney(cents: number): string {
  const dollars = (cents || 0) / 100;
  if (Math.abs(dollars) >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (Math.abs(dollars) >= 10_000)    return `$${(dollars / 1_000).toFixed(1)}k`;
  return `$${dollars.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Compact integer formatting for counts: 12.4k / 1.2M / raw if small. */
function fmtCount(n: number): string {
  const v = n || 0;
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 10_000)    return `${(v / 1_000).toFixed(1)}k`;
  return v.toLocaleString('en-US');
}

/** Period-over-period delta as a percentage and direction. */
function computeDelta(current: number, previous: number): { pct: number | null; dir: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    if (current === 0) return { pct: 0, dir: 'flat' };
    return { pct: null, dir: 'up' }; // "—" pct, but arrow up since we went 0 → something
  }
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (Math.abs(pct) < 0.5) return { pct: 0, dir: 'flat' };
  return { pct, dir: pct > 0 ? 'up' : 'down' };
}

/**
 * MetricTile — value, delta vs previous period, sparkline.
 *
 * Layout (post-restyle):
 *   - No icon (label carries identity)
 *   - Title (label) is the most prominent line
 *   - Value is below, slightly smaller than before
 *   - Sparkline sits top-right, smaller than the original 64px
 *   - Tile body is ~20% tighter so a row of them fits more on-screen
 *
 * `icon` prop is kept for API compatibility but ignored — callers don't
 * need to be updated. `format` lets each metric control its own
 * dollar/count rendering. `betterWhen` flips delta colors so refund/cost
 * metrics arrow-green when they go *down*.
 */
const TILE_WIDTH = 168; // px — fixed so the horizontal scroll row stays tidy

function MetricTile({
  label, bundle, format, sub, accent, betterWhen = 'higher',
}: {
  /** @deprecated kept for API compatibility, no longer rendered */
  icon?: string;
  label: string;
  bundle: MetricBundle | undefined;
  format: (n: number) => string;
  sub?: string;
  accent?: boolean;
  betterWhen?: 'higher' | 'lower';
}) {
  const bg = accent ? 'var(--stone-900)' : 'var(--card)';
  const c = accent ? '#fff' : 'var(--stone-900)';
  const dim = accent ? 'rgba(255,255,255,.55)' : 'var(--stone-400)';
  const labelColor = accent ? 'rgba(255,255,255,.85)' : 'var(--stone-700)';

  if (!bundle) {
    return (
      <div style={{flexShrink:0,width:TILE_WIDTH,borderRadius:10,padding:'10px 12px',display:'flex',flexDirection:'column',gap:4,background:bg,border:accent?'none':'1px solid var(--border)',color:c,opacity:0.55}}>
        <div style={{fontSize:13,fontWeight:800,color:labelColor,letterSpacing:'-.1px'}}>{label}</div>
        <div style={{fontSize:17,fontWeight:900,lineHeight:1}}>—</div>
      </div>
    );
  }
  const delta = computeDelta(bundle.current, bundle.previous);
  const goodDir = betterWhen === 'higher' ? 'up' : 'down';
  const deltaColor = delta.dir === 'flat'
    ? (accent ? 'rgba(255,255,255,.5)' : 'var(--stone-400)')
    : delta.dir === goodDir
      ? '#10b981'
      : '#ef4444';
  return (
    <div style={{flexShrink:0,width:TILE_WIDTH,borderRadius:10,padding:'10px 12px',display:'flex',flexDirection:'column',gap:4,background:bg,border:accent?'none':'1px solid var(--border)',color:c}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:6}}>
        <div style={{fontSize:13,fontWeight:800,color:labelColor,letterSpacing:'-.1px',flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{label}</div>
        {bundle.spark.length > 0 && (
          <div style={{width:48,marginTop:1}}>
            <Sparkbar data={bundle.spark} color={accent ? 'rgba(255,255,255,.6)' : 'var(--blue)'} />
          </div>
        )}
      </div>
      <div style={{fontSize:17,fontWeight:900,lineHeight:1}}>{format(bundle.current)}</div>
      <div style={{display:'flex',alignItems:'center',gap:4}}>
        <span style={{fontSize:9,fontWeight:800,color:deltaColor}}>
          {delta.dir === 'flat'
            ? '→ 0%'
            : delta.dir === 'up'
              ? `↑ ${delta.pct === null ? 'new' : `${Math.abs(delta.pct).toFixed(0)}%`}`
              : `↓ ${Math.abs(delta.pct ?? 0).toFixed(0)}%`}
        </span>
        {sub && <span style={{fontSize:9,fontWeight:500,color:dim,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>· {sub}</span>}
      </div>
    </div>
  );
}

/**
 * Wrapper for a horizontally-scrollable tile row. Each metric panel uses
 * this so tiles overflow gracefully when there are more than fit in the
 * viewport instead of wrapping into a second visual row.
 */
const tileRowStyle: CSSProperties = {
  display:'flex',
  gap:8,
  overflowX:'auto',
  overflowY:'hidden',
  paddingBottom:6, // space for the scrollbar so it doesn't overlap content
  marginBottom:14,
  // Hide the bulky default scrollbar; lets the row look like a single bar
  scrollbarWidth:'thin',
};

function StatCard({ icon, label, value, sub, accent, sparkData }: { icon: string; label: string; value: string; sub?: string; accent?: boolean; sparkData?: number[] }) {
  const bg = accent ? 'var(--stone-900)' : 'var(--card)';
  const c = accent ? '#fff' : 'var(--stone-900)';
  const dim = accent ? 'rgba(255,255,255,.5)' : 'var(--stone-400)';
  return (
    <div style={ss({borderRadius:12,padding:'12px 14px',display:'flex',flexDirection:'column',gap:8,background:bg,border:accent?'none':'1px solid var(--border)',color:c})}>
      <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between'})}>
        <div style={ss({width:28,height:28,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,background:accent?'rgba(255,255,255,.15)':'var(--stone-100)',color:accent?'#fff':'var(--stone-500)'})}>
          <i className={`fas ${icon}`}></i>
        </div>
        {sparkData && <div style={{width:56}}><Sparkbar data={sparkData} color={accent?'rgba(255,255,255,.6)':'var(--blue)'} /></div>}
      </div>
      <div>
        <div style={ss({fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.3px',color:dim,marginBottom:2})}>{label}</div>
        <div style={ss({fontSize:20,fontWeight:900,lineHeight:1})}>{value}</div>
        {sub && <div style={ss({fontSize:10,fontWeight:500,color:dim,marginTop:2})}>{sub}</div>}
      </div>
    </div>
  );
}

type TabId = 'overview'|'security'|'students'|'admins'|'messages'|'emails'|'payments'|'llm'|'dates'|'news'|'plans'|'counselors'|'assignments'|'popular'|'engine'|'funnel'|'subs'|'data'|'errors'|'status'|'earnings'|'activity'|'journey'|'premium_requests'|'recoveries';

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<TabId>('overview');
  const [keyDates, setKeyDates] = useState<{id:number;category:string;title:string;description:string|null;event_date:string;is_active:boolean}[]>([]);
  const [dateForm, setDateForm] = useState({ category:'sat', title:'', description:'', event_date:'', is_active:true });
  const [dateSaving, setDateSaving] = useState(false);
  const [stats, setStats] = useState<AdminStats|null>(null);
  const [activity, setActivity] = useState<DailyActivity[]>([]);
  const [students, setStudents] = useState<AdminStudent[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [llmUsage, setLlmUsage] = useState<LlmUsageRow[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [newsGenerating, setNewsGenerating] = useState(false);
  const [customHeadline, setCustomHeadline] = useState('');
  const [customSummary, setCustomSummary] = useState('');
  const [customTag, setCustomTag] = useState('Trends');
  const [customUrl, setCustomUrl] = useState('');
  const [customSaving, setCustomSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [navSearch, setNavSearch] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all'|'pro'|'premium'|'locked'|'no_profile'|'recent'>('all');
  const [studentPage, setStudentPage] = useState(0);
  const STUDENTS_PER_PAGE = 100;
  const [sortKey, setSortKey] = useState<keyof AdminStudent>('created_at');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [expandedId, setExpandedId] = useState<number|null>(null);
  const [refreshAt, setRefreshAt] = useState(Date.now());
  const [showImport, setShowImport] = useState(false);
  const [importCsv, setImportCsv] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{created:number;skipped:number;errors:string[]}|null>(null);

  // Assignments tab state
  const [assignUsers, setAssignUsers] = useState<{id:number;name:string;email:string;role:string}[]>([]);
  const [assignments, setAssignments] = useState<{id:number;counselor_id:number;student_id:number;plan:string;sessions_total:number;sessions_used:number;status:string;student_name:string;student_email:string;counselor_name:string;counselor_email:string;start_date:string|null;end_date:string|null;created_at:string;declined_reason?:string;accepted_at?:string}[]>([]);
  const [counselorsList, setCounselorsList] = useState<{id:number;user_id:number;display_name:string;email:string;name:string;title:string|null;specialties:string[];total_students:number;years_experience:number;role?:string;counselor_status?:string;hourly_rate_cents?:number;total_earned_cents?:number}[]>([]);
  const [pendingCounselors, setPendingCounselors] = useState<{id:number;user_id:number;display_name:string;email:string;name:string;title:string|null;specialties:string[];years_experience:number;application_note:string;applied_at:string;created_at:string}[]>([]);
  const [plans, setPlans] = useState<{id:number;name:string;sessions:number;price_cents:number;discounted_price_cents:number|null;description:string;features:string[];is_active:boolean;sort_order:number}[]>([]);
  const [assignForm, setAssignForm] = useState<{counselor_id:string;student_id:string;plan_id:string;start_date:string;end_date:string}>({ counselor_id:'', student_id:'', plan_id:'', start_date:new Date().toISOString().split('T')[0], end_date:'' });
  const [assignSearch, setAssignSearch] = useState('');
  const [inlineAssignId, setInlineAssignId] = useState<number|null>(null); // student_id for pending_payment inline assign
  const [inlineAssignCounselorSearch, setInlineAssignCounselorSearch] = useState('');
  const [inlineAssignCounselorId, setInlineAssignCounselorId] = useState('');
  const [inlineAssignPlanId, setInlineAssignPlanId] = useState('');
  const [inlineAssignStartDate, setInlineAssignStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [inlineAssignEndDate, setInlineAssignEndDate] = useState('');
  const [inlineAssignAvailableOnly, setInlineAssignAvailableOnly] = useState(true);
  const [showNewAssignModal, setShowNewAssignModal] = useState(false);
  const [cancelledAssignStudentId, setCancelledAssignStudentId] = useState<number|null>(null);
  const [assignStatusFilter, setAssignStatusFilter] = useState('all');
  const [assignPlanFilter, setAssignPlanFilter] = useState('all');
  const [assignDateFrom, setAssignDateFrom] = useState('');
  const [assignDateTo, setAssignDateTo] = useState('');
  const [editingAssignment, setEditingAssignment] = useState<any>(null);
  const [counselorSearch, setCounselorSearch] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [counselorDropdownOpen, setCounselorDropdownOpen] = useState(false);
  const [studentDropdownOpen, setStudentDropdownOpen] = useState(false);
  const [planForm, setPlanForm] = useState({ name:'', sessions:'1', price:'', discounted_price:'', description:'', features:'' });
  const [proFullPrice, setProFullPrice] = useState('129');
  const [proDiscountPrice, setProDiscountPrice] = useState('89');
  const [pricingSaving, setPricingSaving] = useState(false);
  const [pricingSaved, setPricingSaved] = useState(false);
  const [editingPlan, setEditingPlan] = useState<number|null>(null);

  // ── Admin ↔ Counselor Messages state ──
  const [messageThreads, setMessageThreads] = useState<{assignment_id:number;student_name:string;student_email:string;counselor_name:string;last_message:string;last_message_at:string;unread_count:number}[]>([]);
  const [activeThread, setActiveThread] = useState<number|null>(null);
  const [threadMessages, setThreadMessages] = useState<{id:number;sender_role:string;body:string;created_at:string}[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Admin↔Counselor direct messaging
  const [adminThreads, setAdminThreads] = useState<{counselor_user_id:number; name:string; email:string; display_name:string; title:string; specialties:string[]; counselor_status:string; active_students:number; last_message:string|null; last_sender:string|null; last_message_at:string|null; unread_count:number; total_messages:number}[]>([]);
  const [activeAdminThread, setActiveAdminThread] = useState<number|null>(null);
  const [adminMessages, setAdminMessages] = useState<{id:number;sender_role:string;body:string;is_read:boolean;created_at:string}[]>([]);
  const [adminNewMsg, setAdminNewMsg] = useState('');
  const [adminSending, setAdminSending] = useState(false);
  const [adminMsgFilter, setAdminMsgFilter] = useState<'all'|'unread'>('all');
  const [adminMsgSearch, setAdminMsgSearch] = useState('');
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [broadcastIds, setBroadcastIds] = useState<number[]>([]);
  const [broadcastSending, setBroadcastSending] = useState(false);
  const adminMsgEndRef = useRef<HTMLDivElement>(null);

  // ── NEW: Email state ──
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [emailRecipientType, setEmailRecipientType] = useState<'individual'|'all_students'|'all_counselors'>('individual');
  const [emailRecipientSearch, setEmailRecipientSearch] = useState('');
  const [emailRecipientDropdown, setEmailRecipientDropdown] = useState(false);
  const [emailTemplateOpen, setEmailTemplateOpen] = useState(false);
  const [emailSendError, setEmailSendError] = useState<string | null>(null);
  const [auditEmails, setAuditEmails] = useState<{
    id: number; sender_email: string | null; recipient_type: string;
    recipient_email: string; subject: string; success: boolean;
    error: string | null; sent_at: string;
  }[]>([]);

  // ── Phase A: type-PROD confirmation modal ──
  // A single modal driven by a config object lets us reuse the same
  // confirm-by-typing flow for refunds, broadcasts, and mass emails without
  // duplicating the UI for each.
  const [prodConfirm, setProdConfirm] = useState<{
    open: boolean;
    title: string;
    body: string;
    confirmLabel: string;
    onConfirm: () => void | Promise<void>;
  } | null>(null);
  const [prodConfirmInput, setProdConfirmInput] = useState('');
  const [prodConfirmRunning, setProdConfirmRunning] = useState(false);

  /**
   * Run `action` immediately in non-prod; in prod, open the modal and run
   * only after the user types "PROD" exactly. Used for irreversible /
   * customer-visible actions: refunds, broadcasts, mass email sends.
   */
  const requireProdConfirm = useCallback((opts: {
    title: string;
    body: string;
    confirmLabel?: string;
    action: () => void | Promise<void>;
  }) => {
    if (!IS_PROD) {
      void opts.action();
      return;
    }
    setProdConfirmInput('');
    setProdConfirm({
      open: true,
      title: opts.title,
      body: opts.body,
      confirmLabel: opts.confirmLabel || 'Confirm',
      onConfirm: opts.action,
    });
  }, []);

  // ── NEW: Payments state ──
  const [paymentFilter, setPaymentFilter] = useState<'all'|'succeeded'|'pending'|'failed'>('all');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [grantProOpen, setGrantProOpen] = useState(false);
  const [grantProSearch, setGrantProSearch] = useState('');
  const [grantProSending, setGrantProSending] = useState(false);

  // ── NEW: Popular Colleges state ──
  const [popularSort, setPopularSort] = useState<'total'|'reach'|'target'|'safety'|'essays'>('total');
  const [popularView, setPopularView] = useState<'table'|'bars'>('table');

  // ── NEW: Action Items state ──
  const [actionAssigning, setActionAssigning] = useState<number|null>(null);
  const [actionRejecting, setActionRejecting] = useState<number|null>(null);
  const [actionCounselorId, setActionCounselorId] = useState('');
  const [actionRejectReason, setActionRejectReason] = useState('');

  // ── NEW: 360 Dashboard panel data ──
  const [dataHealth, setDataHealth] = useState<any>(null);
  const [subsData, setSubsData] = useState<any>(null);
  const [funnelData, setFunnelData] = useState<any>(null);
  const [engineData, setEngineData] = useState<any>(null);
  const [errorLogs, setErrorLogs] = useState<any>(null);
  const [logFilter, setLogFilter] = useState<'all'|'error'|'warn'|'info'>('all');
  const [systemStatus, setSystemStatus] = useState<any>(null);
  // Phase 3: recapData removed — the Since-Last-Login tab is gone, replaced
  // by the ranged Overview Metrics panel.
  const [paymentData, setPaymentData] = useState<any>(null);
  const [subsFilter, setSubsFilter] = useState<'all'|'free'|'pro'|'premium'|'cancelled'>('all');
  const [refundingId, setRefundingId] = useState<number|null>(null);
  const [refundReason, setRefundReason] = useState('');

  // ── Phase C: Premium Requests inbox state ──
  // List of requests + the filter pill state. Inline-expanded row state
  // lives in a single id-or-null because admin only acts on one at a time.
  const [premiumRequests, setPremiumRequests] = useState<{
    id: number; user_id: number; plan_id: number|null; plan_name: string;
    amount_cents_quoted: number; amount_cents_invoiced: number|null;
    counselor_user_id: number|null; status: string;
    rejection_reason: string|null;
    stripe_invoice_id: string|null; hosted_invoice_url: string|null;
    invoice_sent_at: string|null; invoice_expires_at: string|null;
    reminder_sent_at: string|null; paid_at: string|null;
    created_at: string; updated_at: string;
    student_name: string|null; student_email: string|null;
    counselor_name: string|null; counselor_email: string|null;
  }[]>([]);
  const [premiumRequestsLoading, setPremiumRequestsLoading] = useState(false);
  const [premiumFilter, setPremiumFilter] = useState<'active'|'all'|'paid'|'cancelled'>('active');
  const [expandedPremiumId, setExpandedPremiumId] = useState<number|null>(null);
  const [premiumActionRunning, setPremiumActionRunning] = useState(false);
  const [premiumActionError, setPremiumActionError] = useState<string|null>(null);
  // Per-row form state for the Send Invoice flow.
  const [premiumCounselorPick, setPremiumCounselorPick] = useState<string>('');
  const [premiumAmountOverride, setPremiumAmountOverride] = useState<string>('');
  const [premiumRejectReason, setPremiumRejectReason] = useState<string>('');
  // Sidebar badge: count of pending_review (computed from list).
  const premiumRequestsPendingCount = premiumRequests.filter(r => r.status === 'pending_review').length;

  // ── Recoveries (failed Pro + failed Premium payments) state ──
  // Unified inbox: Pro Checkout failures and Premium hosted-invoice
  // failures both surface here. The `type` field discriminates which
  // action the row needs ('pro' → send_invoice on /api/admin/recoveries,
  // 'premium' → resend_invoice on /api/admin/premium-requests).
  const [recoveries, setRecoveries] = useState<{
    id: number; user_id: number; amount_cents: number;
    plan_id: string|null; plan_name: string|null;
    stripe_payment_intent_id: string|null;
    metadata: any; created_at: string;
    failed_at: string;
    user_name: string|null; user_email: string|null;
    subscription_status: string|null;
    already_recovered: boolean;
    type: 'pro' | 'premium';
    // Premium-only fields:
    status?: string;
    stripe_invoice_id?: string|null;
    hosted_invoice_url?: string|null;
    last_failure_reason?: string|null;
    attempt_count?: number;
  }[]>([]);
  const [recoveriesLoading, setRecoveriesLoading] = useState(false);
  const [expandedRecoveryId, setExpandedRecoveryId] = useState<number|null>(null);
  const [recoveryActionRunning, setRecoveryActionRunning] = useState(false);
  const [recoveryActionError, setRecoveryActionError] = useState<string|null>(null);
  const [recoveryAmountOverride, setRecoveryAmountOverride] = useState<string>('');
  // Sidebar badge — actionable recoveries (failed AND not yet succeeded
  // AND no recovery_invoice_id stamped on metadata).
  const recoveriesActiveCount = recoveries.filter(r =>
    !r.already_recovered && !r.metadata?.recovery_invoice_id
  ).length;

  // ── Phase B: Payment timeline (Details modal) ──
  // One payment id at a time; null = closed. The events list is the
  // ordered audit trail from /api/admin/payments/[id]/events.
  const [eventsModalPaymentId, setEventsModalPaymentId] = useState<number|null>(null);
  const [eventsModalPayment, setEventsModalPayment] = useState<any>(null);
  const [eventsModalEvents, setEventsModalEvents] = useState<{
    id: number; event_type: string; status: string|null;
    amount_cents: number|null; reason: string|null;
    details: any; created_at: string;
  }[]>([]);
  const [eventsModalLoading, setEventsModalLoading] = useState(false);

  const openPaymentEvents = useCallback(async (p: any) => {
    setEventsModalPaymentId(p.id);
    setEventsModalPayment(p);
    setEventsModalEvents([]);
    setEventsModalLoading(true);
    try {
      const res = await fetch(`/api/admin/payments/${p.id}/events`, { cache: 'no-store' });
      const data = await res.json();
      setEventsModalEvents(data.events || []);
    } catch (e) {
      console.error('[admin] payment events fetch failed:', e);
    } finally {
      setEventsModalLoading(false);
    }
  }, []);
  const [counselorFilter, setCounselorFilter2] = useState<'all'|'active'|'pending'>('all');
  const [counselorSearchText, setCounselorSearchText] = useState('');
  const [expandedCounselorId, setExpandedCounselorId] = useState<number|null>(null);
  const [addCounselorOpen, setAddCounselorOpen] = useState(false);
  const [newCounselor, setNewCounselor] = useState({name:'',email:'',password:'',specialties:'',years:''});
  const [payingCounselorId, setPayingCounselorId] = useState<number|null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [editingRate, setEditingRate] = useState<number|null>(null);
  const [rateInput, setRateInput] = useState('');
  const [earningsData, setEarningsData] = useState<any>(null);
  const [earningsFilter, setEarningsFilter] = useState<'all'|'owed'|'paid'>('all');
  const [expandedEarningsId, setExpandedEarningsId] = useState<number|null>(null);
  const [payingEarningsId, setPayingEarningsId] = useState<number|null>(null);
  const [payEAmount, setPayEAmount] = useState('');
  const [payENotes, setPayENotes] = useState('');
  const [payEMethod, setPayEMethod] = useState('bank_transfer');
  const [selectedPayPlans, setSelectedPayPlans] = useState<Record<number, number[]>>({}); // counselor_id -> assignment_ids
  const [payModalCounselor, setPayModalCounselor] = useState<any>(null);
  const [payModalNotes, setPayModalNotes] = useState('');
  const [payModalMethod, setPayModalMethod] = useState('stripe_connect');
  const [payModalProcessing, setPayModalProcessing] = useState(false);
  const [payModalAmountOverride, setPayModalAmountOverride] = useState('');
  const [activityData, setActivityData] = useState<any>(null);
  const [activityDateFrom, setActivityDateFrom] = useState('');
  const [activityDateTo, setActivityDateTo] = useState('');
  const [activitySortField, setActivitySortField] = useState('last_activity');
  const [activitySortDir, setActivitySortDir] = useState<'asc'|'desc'>('desc');
  const [expandedActivityId, setExpandedActivityId] = useState<number|null>(null);
  const [activitySummary, setActivitySummary] = useState('');
  const [activitySummarizing, setActivitySummarizing] = useState(false);
  const [activityStatusFilter, setActivityStatusFilter] = useState<string>('all');

  // ── Journey state ──
  const [journeySearch, setJourneySearch] = useState('');
  const [journeyRole, setJourneyRole] = useState<'all'|'student'|'counselor'>('all');
  const [journeyUsers, setJourneyUsers] = useState<any[]>([]);
  const [journeySearching, setJourneySearching] = useState(false);
  const [journeyUser, setJourneyUser] = useState<any>(null);
  const [journeyEvents, setJourneyEvents] = useState<any[]>([]);
  const [journeyLoading, setJourneyLoading] = useState(false);

  // Compute pending action count from students (premium who need counselor assignment)
  const actionPendingCount = students.filter(s => s.needs_assignment).length;

  // ── NEW: Command palette state ──
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ── Date range filter for overview / security ──
  const todayStr = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo,   setDateTo]   = useState(todayStr);

  // ── Phase 1 ranged metrics (powers /api/admin/metrics) ──
  // metricsRange drives the API query; metricsData holds the response.
  // metricsLoading lets MetricTile dim while a new range is in flight.
  const [metricsRange, setMetricsRange] = useState<MetricRange>('30d');
  const [metricsData, setMetricsData] = useState<MetricsResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);


  const fetchData = useCallback(async (view: string) => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/admin?view=${view}`, { cache:'no-store' });
      if (res.status === 403) { setError('forbidden'); setLoading(false); return; }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.error('[Admin] API error:', res.status, errBody);
        throw new Error(errBody.details || errBody.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (view === 'overview') { setStats(data.stats); setActivity(data.activity); }
      if (view === 'students') setStudents(data.students);
      if (view === 'admins') setAdmins(data.admins || []);
      if (view === 'llm') setLlmUsage(data.usage);
      if (view === 'assignments') { setAssignUsers(data.users||[]); setAssignments(data.assignments||[]); setCounselorsList(data.counselors||[]); setPlans(data.plans||[]); setPendingCounselors(data.pending_counselors||[]); }
    } catch (e: any) { setError(e?.message || 'Failed to load data.'); } finally { setLoading(false); }
  }, []);

  const fetchKeyDates = useCallback(async () => { const res = await fetch('/api/admin?view=all_dates', { cache:'no-store' }); if (res.ok) { const d = await res.json(); setKeyDates(d.dates || []); } }, []);
  const [collegeDeadlines, setCollegeDeadlines] = useState<{id:number;college_name:string;deadline_type:string;due_date:string;description:string}[]>([]);
  const [cdSearch, setCdSearch] = useState('');
  const [cdTypeFilter, setCdTypeFilter] = useState('all');
  const fetchNews = useCallback(async () => { try { const res = await fetch('/api/admin/news?admin=1', { cache:'no-store' }); if (res.ok) setNewsItems(await res.json()); } catch {} }, []);

  const handleAddDate = async () => { if (!dateForm.title || !dateForm.event_date) return; setDateSaving(true); await fetch('/api/dates', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dateForm) }); setDateForm({ category:'sat', title:'', description:'', event_date:'', is_active:true }); await fetchKeyDates(); setDateSaving(false); };
  const handleToggleDate = async (id: number, is_active: boolean) => { await fetch('/api/dates', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id, is_active:!is_active }) }); fetchKeyDates(); };
  const handleDeleteDate = async (id: number) => { if (!confirm('Delete this date?')) return; await fetch('/api/dates', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }) }); fetchKeyDates(); };

  const handleGenerateNews = async () => { setNewsGenerating(true); try { const res = await fetch('/api/admin/news', { method:'POST' }); if (res.ok) setNewsItems(await res.json()); } catch {} finally { setNewsGenerating(false); } };
  const handleToggleNews = async (id: number, visible: boolean) => { await fetch('/api/admin/news', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id, is_visible: visible }) }); fetchNews(); };
  const handleDeleteNews = async (id: number) => { if (!confirm('Delete this news item?')) return; await fetch('/api/admin/news', { method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ id }) }); fetchNews(); };
  const handleAddCustomNews = async () => {
    if (!customHeadline.trim() || !customSummary.trim()) return;
    setCustomSaving(true);
    try {
      const res = await fetch('/api/admin/news', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ custom:true, headline:customHeadline.trim(), summary:customSummary.trim(), tag:customTag, source_url:customUrl.trim()||null }) });
      if (res.ok) { setNewsItems(await res.json()); setCustomHeadline(''); setCustomSummary(''); setCustomTag('Trends'); setCustomUrl(''); }
    } catch {} finally { setCustomSaving(false); }
  };


  // Keyboard shortcut for command palette
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCommandOpen(o => !o); }
      if (e.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      if (tab === 'dates') { fetchKeyDates(); fetch('/api/admin?view=college_deadlines',{cache:'no-store'}).then(r=>r.json()).then(d=>setCollegeDeadlines(d.deadlines||[])).catch(()=>{}); }
      else if (tab === 'news') fetchNews();
      else if (tab === 'security') { fetchData('overview'); fetchData('students'); }
      else if (tab === 'admins') { fetchData('admins'); }
      else if (tab === 'assignments' || tab === 'counselors' || tab === 'plans') { fetchData('assignments'); fetchData('students'); fetch('/api/pricing').then(r=>r.json()).then(d=>{if(d.pro_full_price)setProFullPrice(String(d.pro_full_price));if(d.pro_discount_price)setProDiscountPrice(String(d.pro_discount_price));}).catch(()=>{}); if(tab==='counselors'||tab==='assignments') fetch('/api/admin?view=earnings',{cache:'no-store'}).then(r=>r.json()).then(d=>setEarningsData(d)).catch(()=>{}); if(tab==='assignments') fetch('/api/admin?view=payments',{cache:'no-store'}).then(r=>r.json()).then(d=>setPaymentData(d)).catch(()=>{}); }
      else if (tab === 'messages') { fetchData('assignments'); fetch('/api/admin?view=admin_threads',{cache:'no-store'}).then(r=>r.json()).then(d=>setAdminThreads(d.threads||[])).catch(()=>{}); }
      else if (tab === 'emails') {
        fetchData('students');
        // Phase A: load recent send-audit rows for the audit card.
        fetch('/api/admin/email?limit=25', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : { emails: [] })
          .then(d => setAuditEmails(d.emails || []))
          .catch(() => setAuditEmails([]));
      }
      else if (tab === 'premium_requests') {
        // Phase C: load the counselor list (for the Send Invoice picker)
        // here; the requests themselves are loaded by a dedicated effect
        // below that reacts to the filter pill.
        fetchData('assignments');
      }
      else if (tab === 'recoveries') {
        // Recoveries has its own endpoint (/api/admin/recoveries). The
        // dedicated effect handles fetching; we just intercept here so
        // the catch-all `else fetchData(tab)` doesn't hit
        // /api/admin?view=recoveries (which 400s with "Unknown view").
      }
      else if (tab === 'payments') { setLoading(true); fetchData('students'); fetch('/api/admin?view=payments',{cache:'no-store'}).then(r=>r.json()).then(d=>{setPaymentData(d);setLoading(false);}).catch(e=>{console.error('[admin] payments fetch failed:',e);setPaymentData({payments:[],stats:{total_revenue:0,this_month:0,pending:0,refunded:0}});setLoading(false);}); }
      else if (tab === 'popular') fetchData('students');
      else if (tab === 'engine') { setLoading(true); fetch('/api/admin?view=engine_health',{cache:'no-store'}).then(r=>r.json()).then(d=>{setEngineData(d);setLoading(false);}).catch(e=>{console.error('[admin] engine_health fetch failed:',e);setEngineData({bucket_distribution:[],top_schools:[],major_distribution:[],total_saved:0,students_with_colleges:0});setLoading(false);}); }
      else if (tab === 'funnel') { setLoading(true); fetch('/api/admin?view=funnel',{cache:'no-store'}).then(r=>r.json()).then(d=>{setFunnelData(d);setLoading(false);}).catch(e=>{console.error('[admin] funnel fetch failed:',e);setFunnelData({signups:0,profile_done:0,ran_engine:0,saved_college:0,started_essay:0,submitted_essay:0,purchased:0});setLoading(false);}); }
      else if (tab === 'subs') { setLoading(true); fetch('/api/admin?view=subscriptions',{cache:'no-store'}).then(r=>r.json()).then(d=>{setSubsData(d);setLoading(false);}).catch(e=>{console.error('[admin] subs fetch failed:',e);setSubsData({tiers:[],expiring_7d:0,expiring_30d:0,churned_30d:0});setLoading(false);}); }
      else if (tab === 'data') { setLoading(true); fetch('/api/admin?view=data_health',{cache:'no-store'}).then(r=>r.json()).then(d=>{setDataHealth(d);setLoading(false);}).catch(e=>{console.error('[admin] data_health fetch failed:',e);setDataHealth({counts:{},joinedCount:0,orphanedCount:0,satCoverage:0,progNormCount:0});setLoading(false);}); }
      else if (tab === 'errors') { setLoading(true); fetch('/api/admin?view=error_log',{cache:'no-store'}).then(r=>r.json()).then(d=>{setErrorLogs(d);setLoading(false);}).catch(e=>{console.error('[admin] error_log fetch failed:',e);setErrorLogs({logs:[],level_counts:[]});setLoading(false);}); }
      else if (tab === 'status') { setLoading(true); fetch('/api/admin?view=system_status',{cache:'no-store'}).then(r=>r.json()).then(d=>{setSystemStatus(d);setLoading(false);}).catch(e=>{console.error('[admin] system_status fetch failed:',e);setSystemStatus({services:[]});setLoading(false);}); }
      else if (tab === 'earnings') { setLoading(true); fetch('/api/admin?view=earnings',{cache:'no-store'}).then(r=>r.json()).then(d=>{setEarningsData(d);setLoading(false);}).catch(e=>{console.error('[admin] earnings fetch failed:',e);setEarningsData({counselors:[],totals:{}});setLoading(false);}); }
      else if (tab === 'activity') { setLoading(true); fetch('/api/admin?view=activity',{cache:'no-store'}).then(r=>r.json()).then(d=>{setActivityData(d);setLoading(false);}).catch(e=>{console.error('[admin] activity fetch failed:',e);setActivityData({activities:[],stats:{}});setLoading(false);}); }
      else if (tab === 'journey') { /* data loaded on user search, no initial fetch needed */ }
      else fetchData(tab);
    }
  }, [tab, status, refreshAt, fetchData, fetchKeyDates, fetchNews]);

  // Recoveries list. Mirrors the premium_requests effect shape.
  useEffect(() => {
    if (status !== 'authenticated' || tab !== 'recoveries') return;
    let cancelled = false;
    setRecoveriesLoading(true);
    fetch('/api/admin/recoveries?days=30', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { recoveries: [] })
      .then(d => { if (!cancelled) setRecoveries(d.recoveries || []); })
      .catch(() => { if (!cancelled) setRecoveries([]); })
      .finally(() => { if (!cancelled) setRecoveriesLoading(false); });
    return () => { cancelled = true; };
  }, [tab, status, refreshAt]);

  // Phase C — premium requests list. Re-fetches when the filter pill
  // changes or admin clicks Refresh. Lives in its own effect so we don't
  // re-pull the whole admin payload just to flip filters.
  useEffect(() => {
    if (status !== 'authenticated' || tab !== 'premium_requests') return;
    let cancelled = false;
    setPremiumRequestsLoading(true);
    fetch(`/api/admin/premium-requests?filter=${premiumFilter}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { requests: [] })
      .then(d => { if (!cancelled) setPremiumRequests(d.requests || []); })
      .catch(() => { if (!cancelled) setPremiumRequests([]); })
      .finally(() => { if (!cancelled) setPremiumRequestsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, status, premiumFilter, refreshAt]);

  // Phase 1 metrics fetch — re-runs when the range selector changes or the
  // user clicks Refresh. We only fire on the Overview tab; other tabs don't
  // need the dashboard payload.
  useEffect(() => {
    if (status !== 'authenticated' || tab !== 'overview') return;
    let cancelled = false;
    setMetricsLoading(true);
    fetch(`/api/admin/metrics?range=${metricsRange}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: MetricsResponse) => { if (!cancelled) setMetricsData(d); })
      .catch(e => { console.error('[admin] metrics fetch failed:', e); if (!cancelled) setMetricsData(null); })
      .finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [tab, status, metricsRange, refreshAt]);

  const filteredAll = students
    .filter(s => {
      const isExpired = s.subscription_expires_at && new Date(s.subscription_expires_at) < new Date();
      if (studentFilter === 'pro')      return s.subscription_status === 'pro' && !isExpired;
      if (studentFilter === 'premium')  return s.subscription_status === 'premium' && !isExpired;
      if (studentFilter === 'locked')   return s.is_locked;
      if (studentFilter === 'no_profile') return !s.final_score && !s.gpa;
      if (studentFilter === 'recent')   return Date.now() - new Date(s.created_at).getTime() < 7*86400000;
      return true;
    })
    .filter(s => !search || [s.name,s.email,s.high_school_name,s.intended_major].some(v => v?.toLowerCase().includes(search.toLowerCase())))
    .sort((a,b) => { const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0; return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1); });
  const totalPages = Math.ceil(filteredAll.length / STUDENTS_PER_PAGE);
  const filtered = filteredAll.slice(studentPage * STUDENTS_PER_PAGE, (studentPage + 1) * STUDENTS_PER_PAGE);

  async function toggleLock(studentId: number, currentlyLocked: boolean) {
    try {
      await fetch('/api/admin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'toggle_lock', student_id: studentId, locked: !currentlyLocked }),
      });
      setStudents(prev => prev.map(s => s.id === studentId ? { ...s, is_locked: !currentlyLocked } : s));
    } catch(e) { console.error('Lock toggle failed:', e); }
  }

  async function togglePremium(studentId: number, currentlyPremium: boolean) {
    try {
      await fetch('/api/admin', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'toggle_premium', student_id: studentId, premium: !currentlyPremium }),
      });
      setStudents(prev => prev.map(s => s.id === studentId ? { ...s, has_expert_session: !currentlyPremium, expert_plan: !currentlyPremium ? 'Manual' : '' } : s));
    } catch(e) { console.error('Premium toggle failed:', e); }
  }

  async function deleteStudent(studentId: number, name: string) {
    if (!confirm(`Permanently delete ${name} and all their data? This cannot be undone.`)) return;
    try {
      await fetch('/api/admin', {
        method: 'DELETE', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ action: 'delete_user', student_id: studentId }),
      });
      setStudents(prev => prev.filter(s => s.id !== studentId));
    } catch(e) { console.error('Delete failed:', e); }
  }

  async function impersonateStudent(studentId: number, name: string) {
    if (!confirm(`Impersonate ${name}? You'll be signed in as this student. Log out and back in as admin to return.`)) return;
    try {
      const res = await fetch('/api/admin/impersonate', {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ student_id: studentId }),
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Impersonation failed'); return; }
      const { email, token } = await res.json();
      const { signIn } = await import('next-auth/react');
      const result = await signIn('credentials', {
        email,
        password: `impersonate:${token}`,
        redirect: false,
      });
      if (result?.error) { alert('Impersonation sign-in failed: ' + result.error); return; }
      // Store origin so the sidebar shows the impersonation banner
      localStorage.setItem('impersonate_origin', session?.user?.email ?? 'admin');
      window.location.href = '/profile';
    } catch(e) { alert('Impersonation failed'); }
  }
  function toggleSort(k: keyof AdminStudent) { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('desc'); } }

  if (status === 'loading') return <div style={ss({height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',fontFamily:"'DM Sans',sans-serif",color:'var(--stone-400)',fontSize:14,fontWeight:600})}><i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i>Authenticating…</div>;
  if (error === 'forbidden') return (
    <div style={ss({height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',fontFamily:"'DM Sans',sans-serif"})}>
      <div style={ss({textAlign:'center'})}>
        <div style={ss({width:64,height:64,borderRadius:20,background:'var(--red-light)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'})}><i className="fas fa-lock" style={{color:'var(--red)',fontSize:24}}></i></div>
        <h1 style={ss({fontSize:22,fontWeight:900,marginBottom:8})}>Access Denied</h1>
        <p style={ss({fontSize:13,fontWeight:500,color:'var(--stone-500)',marginBottom:24})}>Your account is not in the admin allowlist.</p>
        <button onClick={() => router.push('/profile')} style={ss({padding:'10px 20px',background:'var(--stone-900)',color:'#fff',borderRadius:12,border:'none',fontFamily:'inherit',fontSize:13,fontWeight:800,cursor:'pointer'})}>Go to App</button>
      </div>
    </div>
  );

  const activityWindow = activity.filter(a => {
    if (dateFrom && a.date < dateFrom) return false;
    if (dateTo   && a.date > dateTo)   return false;
    return true;
  }).slice(-60); // cap at 60 rows

  // ── Sidebar nav structure ──
  const TABS: { id: TabId; icon: string; label: string; group: string; badge?: number }[] = [
    { id:'overview',  icon:'fa-chart-line',   label:'Overview',         group:'DASHBOARD' },
    { id:'security',  icon:'fa-shield-halved',label:'Security',         group:'DASHBOARD' },
    { id:'status',    icon:'fa-server',       label:'System Status',    group:'DASHBOARD' },
    { id:'students',  icon:'fa-users',        label:'Students',         group:'USERS' },
    { id:'admins',    icon:'fa-user-shield',  label:'Admins',           group:'USERS' },
    { id:'counselors',  icon:'fa-chalkboard-user', label:'Counselors',   group:'USERS', badge: pendingCounselors.length > 0 ? pendingCounselors.length : undefined },
    { id:'assignments', icon:'fa-user-tie',    label:'Assignments',      group:'PREMIUM ASSIGNMENTS', badge: actionPendingCount > 0 ? actionPendingCount : undefined },
    { id:'earnings',    icon:'fa-hand-holding-dollar', label:'Counselor Earnings', group:'PREMIUM ASSIGNMENTS' },
    { id:'activity',    icon:'fa-clipboard-list', label:'Activity Log',  group:'PREMIUM ASSIGNMENTS' },
    { id:'popular',   icon:'fa-university',   label:'Popular Colleges', group:'INSIGHTS' },
    { id:'journey',   icon:'fa-route',        label:'User Journey',     group:'INSIGHTS' },
    { id:'engine',    icon:'fa-gauge-high',   label:'Engine Health',    group:'INSIGHTS' },
    { id:'funnel',    icon:'fa-filter',       label:'Funnel',           group:'INSIGHTS' },
    { id:'subs',      icon:'fa-id-badge',     label:'Subscriptions',    group:'INSIGHTS' },
    { id:'data',      icon:'fa-database',     label:'Data Health',      group:'INSIGHTS' },
    { id:'errors',    icon:'fa-triangle-exclamation', label:'Error Log', group:'INSIGHTS', badge: (errorLogs?.level_counts?.find((l:any)=>l.level==='error')?.cnt) || undefined },
    { id:'messages',    icon:'fa-comments',      label:'Messages',         group:'COMMUNICATION', badge: adminThreads.reduce((s,t)=>s+t.unread_count,0) || undefined },
    { id:'emails',      icon:'fa-envelope',      label:'Emails',           group:'COMMUNICATION' },
    { id:'payments',    icon:'fa-credit-card',   label:'Payments',         group:'BILLING' },
    // Phase C — Premium Match requests inbox. Badge shows count of
    // pending_review items so admin sees them without opening the tab.
    { id:'premium_requests', icon:'fa-crown', label:'Premium Requests', group:'PREMIUM ASSIGNMENTS', badge: premiumRequestsPendingCount > 0 ? premiumRequestsPendingCount : undefined },
    // Failed Pro payments inbox. Badge shows count of unrecovered failures.
    { id:'recoveries',  icon:'fa-life-ring',   label:'Recoveries',       group:'BILLING', badge: recoveriesActiveCount > 0 ? recoveriesActiveCount : undefined },
    { id:'plans',       icon:'fa-box-open',    label:'Plans',            group:'BILLING' },
    { id:'llm',       icon:'fa-microchip',    label:'LLM Usage',        group:'BILLING' },
    { id:'news',      icon:'fa-bolt',         label:'Admissions Pulse', group:'CONTENT' },
    { id:'dates',     icon:'fa-calendar-alt', label:'Key Dates',        group:'CONTENT' },
  ];
  const groups = ['DASHBOARD','USERS','PREMIUM ASSIGNMENTS','COMMUNICATION','BILLING','CONTENT','INSIGHTS'];
  const filteredTabs = TABS.filter(t => !navSearch || t.label.toLowerCase().includes(navSearch.toLowerCase()));

  // Security metrics
  const secMetrics = {
    neverLoggedIn:   students.filter(s => !s.last_login).length,
    noProfile:       students.filter(s => !s.final_score && !s.gpa).length,
    highLlmUsers:    students.filter(s => s.llm_calls > 50).length,
    staleAccounts:   students.filter(s => s.last_login && Date.now() - new Date(s.last_login).getTime() > 30*86400000).length,
    recentSignups7d: students.filter(s => Date.now() - new Date(s.created_at).getTime() < 7*86400000).length,
    zeroCostAi:      students.filter(s => s.llm_cost_usd === 0 && s.llm_calls > 0).length,
  };
  const flaggedUsers = students.filter(s =>
    !s.last_login || s.llm_calls > 50 || (!s.final_score && !s.gpa) ||
    (s.last_login && Date.now() - new Date(s.last_login).getTime() > 30*86400000)
  ).slice(0, 25);

  const tabDesc: Record<TabId, string> = {
    recoveries: 'Failed Pro payments — send a manual Stripe invoice to recover the customer',
    premium_requests: 'Review premium match requests, send invoices, and track lifecycle',
    overview: 'Platform stats and daily activity',
    security: 'User risk flags, unusual patterns, and audit metrics',
    status: 'API key connections, database health, and runtime info',
    students: 'All registered students and their progress',
    admins: 'All administrators — view details and lock regular (non-super) admins',
    popular: 'Most-added colleges by students across all buckets',
    engine: 'Recommendation engine metrics, bucket distribution, and program usage',
    funnel: 'Student journey from signup through purchase — find the drop-off',
    subs: 'Subscription tiers, conversion rates, and renewal alerts',
    data: 'Database table health, data freshness, and join integrity',
    errors: 'Recent errors, warnings, and system events',
    messages: 'Direct messaging with counselors — send individual or broadcast messages',
    emails: 'Send emails to students, counselors, or groups',
    payments: 'Track Stripe payments, revenue, and refunds',
    earnings: 'Counselor payouts, outstanding balances, and payment history',
    activity: 'All expert portal activities — messages, sessions, actions, notes, and AI summary',
    plans: 'Configure session packages, pricing, and plan features',
    counselors: 'Manage counselors — status, rates, assignments, and payouts',
    assignments: 'Assign counselors to students with plans and date ranges',
    llm:      'API call log, token usage, and cost tracking',
    news:     'Generate and curate Admissions Pulse news for students',
    dates:    'Manage SAT, ACT, AP, FAFSA, and application deadline dates',
    journey:  'Track every event in a student or counselor lifecycle',
  };

  // Email templates
  const emailTemplates = [
    { name:'Welcome', category:'Onboarding', icon:'fa-hand-wave', subject:'Welcome to Admitly!', body:'Hi {name},\n\nWelcome to Admitly! We\'re excited to help you navigate the college admissions process.\n\nHere are some next steps to get started:\n1. Complete your student profile\n2. Add colleges to your list\n3. Start working on your personal statement\n\nIf you have any questions, don\'t hesitate to reach out.\n\nBest,\nThe Admitly Team' },
    { name:'Session Follow-up', category:'Counseling', icon:'fa-clipboard-check', subject:'Follow-up: Your Expert Session Recap', body:'Hi {name},\n\nThank you for your recent counseling session! Here\'s a summary of what we discussed:\n\nKey Takeaways:\n- [Takeaway 1]\n- [Takeaway 2]\n\nAction Items:\n- [Item 1] — Due: [Date]\n- [Item 2] — Due: [Date]\n\nYour next session is scheduled for [Date/Time]. Please complete your action items beforehand.\n\nBest,\nThe Admitly Team' },
    { name:'Deadline Reminder', category:'Reminders', icon:'fa-clock', subject:'Upcoming Deadline Reminder', body:'Hi {name},\n\nThis is a friendly reminder about your upcoming application deadlines:\n\n• [School 1] — [Date]\n• [School 2] — [Date]\n\nPlease log in to review your timeline and ensure all materials are submitted on time.\n\nBest,\nThe Admitly Team' },
    { name:'Payment Received', category:'Billing', icon:'fa-receipt', subject:'Payment Confirmed — Sessions Active', body:'Hi {name},\n\nWe\'ve confirmed your payment for the {plan} plan. Your sessions are now active.\n\nYour assigned counselor will reach out within 24 hours to schedule your first session.\n\nBest,\nThe Admitly Team' },
    { name:'Cold Outreach', category:'Outreach', icon:'fa-bullhorn', subject:'Personalized College Guidance — Limited Spots', body:'Hi {name},\n\nI noticed you recently signed up for Admitly — great first step!\n\nMany students at this stage benefit from expert guidance to sharpen their college strategy. Our counselors have helped 500+ students gain admission to top universities.\n\nWould you be interested in a complimentary 15-minute strategy call? No commitment required.\n\nBest,\nThe Admitly Team' },
    { name:'Re-engagement', category:'Outreach', icon:'fa-rotate-right', subject:'We Miss You — Your College Journey Awaits', body:'Hi {name},\n\nIt\'s been a while since you last visited Admitly. College deadlines don\'t wait — and neither should your prep.\n\nHere\'s what you can do today:\n• Update your profile to see your latest strength score\n• Check if any new deadlines have been added\n• Start a draft of your personal statement\n\nLet\'s get back on track together.\n\nBest,\nThe Admitly Team' },
    { name:'Issue Resolution', category:'Support', icon:'fa-wrench', subject:'Re: Your Recent Issue — Resolved', body:'Hi {name},\n\nThank you for bringing this to our attention. We\'ve looked into the issue you reported and it has been resolved.\n\nSummary:\n• Issue: [Brief description]\n• Resolution: [What was fixed]\n• Status: Resolved\n\nIf you experience any further issues, please don\'t hesitate to reach out.\n\nBest,\nThe Admitly Team' },
    { name:'Upgrade Prompt', category:'Billing', icon:'fa-crown', subject:'Unlock Premium — Special Offer Inside', body:'Hi {name},\n\nYou\'ve been making great progress on Admitly! Students with your profile score typically see the most improvement with 1-on-1 counseling.\n\nFor a limited time, we\'re offering 20% off our Full Cycle plan:\n• 5 expert sessions (60 min each)\n• Unlimited messaging with your counselor\n• Full essay review and strategy support\n\nUse code ADMITLY20 at checkout.\n\nBest,\nThe Admitly Team' },
  ];

  // Quick actions for command palette
  const quickActions = [
    { label:'Go to Overview', icon:'fa-chart-line', action:()=>{setTab('overview');setCommandOpen(false);} },
    { label:'View Students', icon:'fa-users', action:()=>{setTab('students');setCommandOpen(false);} },
    { label:'Check Messages', icon:'fa-comments', action:()=>{setTab('messages');setCommandOpen(false);} },
    { label:'Compose Email', icon:'fa-envelope', action:()=>{setTab('emails');setCommandOpen(false);} },
    { label:'View Payments', icon:'fa-credit-card', action:()=>{setTab('payments');setCommandOpen(false);} },
    { label:'Generate News', icon:'fa-bolt', action:()=>{setTab('news');setCommandOpen(false);} },
    { label:'Refresh Data', icon:'fa-rotate', action:()=>{setRefreshAt(Date.now());setCommandOpen(false);} },
    { label:'Manage Plans', icon:'fa-box-open', action:()=>{setTab('plans');setCommandOpen(false);} },
    { label:'Back to App', icon:'fa-arrow-left', action:()=>{router.push('/profile');} },
  ].filter(a=>!commandQuery||a.label.toLowerCase().includes(commandQuery.toLowerCase()));

  // Derived threads from assignments
  const displayThreads = assignments.map(a => {
    return {
      assignment_id: a.id,
      student_name: a.student_name,
      student_email: a.student_email,
      counselor_name: a.counselor_name,
      last_message: 'Click to view',
      last_message_at: a.created_at,
      unread_count: 0,
    };
  });

  return (
    <div style={ss({minHeight:'100vh',background:'#fafaf9',fontFamily:"'DM Sans',sans-serif",display:'flex'})}>

      {/* ═══ COMMAND PALETTE (⌘K) ═══ */}
      {commandOpen && (
        <div style={ss({position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.4)',backdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:120})} onClick={()=>setCommandOpen(false)}>
          <div style={ss({background:'#fff',borderRadius:16,width:520,maxHeight:420,overflow:'hidden',border:'1px solid #e7e5e4',boxShadow:'0 25px 60px rgba(0,0,0,.15)'})} onClick={e=>e.stopPropagation()}>
            <div style={ss({display:'flex',alignItems:'center',gap:10,padding:'14px 16px',borderBottom:'1px solid #f5f5f4'})}>
              <i className="fas fa-magnifying-glass" style={{fontSize:14,color:'#78716c'}}></i>
              <input value={commandQuery} onChange={e=>setCommandQuery(e.target.value)} placeholder="Type a command…" autoFocus
                style={ss({flex:1,border:'none',outline:'none',fontFamily:'inherit',fontSize:15,fontWeight:500,color:'#1c1917',background:'transparent'})} />
              <kbd style={ss({fontSize:10,fontWeight:700,padding:'2px 6px',borderRadius:6,background:'#f5f5f4',color:'#78716c',border:'1px solid #e7e5e4'})}>ESC</kbd>
            </div>
            <div style={ss({maxHeight:340,overflowY:'auto',padding:'8px'})}>
              {quickActions.map((a,i)=>(
                <button key={i} onClick={a.action}
                  style={ss({width:'100%',display:'flex',alignItems:'center',gap:12,padding:'10px 12px',border:'none',fontFamily:'inherit',fontSize:13,fontWeight:500,cursor:'pointer',background:'transparent',color:'#44403c',borderRadius:10,textAlign:'left'})}
                  onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#fafaf9'}
                  onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
                >
                  <div style={ss({width:28,height:28,borderRadius:8,background:'#f5f5f4',display:'flex',alignItems:'center',justifyContent:'center'})}>
                    <i className={`fas ${a.icon}`} style={{fontSize:11,color:'#78716c'}}></i>
                  </div>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ═══ LEFT SIDEBAR NAV ═══ */}
      <div style={ss({width:220,flexShrink:0,background:'#fff',borderRight:'1px solid #e7e5e4',padding:'20px 0',display:'flex',flexDirection:'column',position:'sticky',top:0,height:'100vh',overflowY:'auto'})}>

        {/* Logo */}
        <div style={ss({padding:'0 20px',marginBottom:24,display:'flex',alignItems:'center',gap:10})}>
          <img src="/raven-logo.svg" alt="Admitly" width={32} height={32} style={{flexShrink:0,borderRadius:8}} />
          <div>
            <div style={ss({fontSize:10,fontWeight:700,color:'#a8a29e',textTransform:'uppercase',letterSpacing:'0.3px'})}>Admin Console</div>
            <div style={ss({fontSize:14,fontWeight:800,color:'#1c1917'})}>Admitly</div>
          </div>
        </div>

        {/* Grouped nav */}
        {groups.map(group => {
          const items = filteredTabs.filter(t => t.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} style={ss({marginBottom:4})}>
              <div style={ss({fontSize:10,fontWeight:700,color:'#c4bfbb',textTransform:'uppercase',letterSpacing:'0.4px',padding:'10px 20px 4px'})}>{group}</div>
              {items.map(t => {
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    style={ss({width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 20px',border:'none',fontFamily:'inherit',fontSize:13,fontWeight:active?600:400,cursor:'pointer',transition:'all .1s',textAlign:'left',
                      background: active ? '#fafaf9' : 'transparent',
                      color: active ? '#1c1917' : '#78716c',
                      borderLeft: `2px solid ${active?'#1c1917':'transparent'}`,
                    })}
                    onMouseEnter={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='#fafaf9';}}
                    onMouseLeave={e=>{if(!active)(e.currentTarget as HTMLElement).style.background='transparent';}}
                  >
                    <i className={`fas ${t.icon}`} style={{fontSize:12,width:16,color:active?'#1c1917':'#a8a29e'}}></i>
                    {t.label}
                    {t.badge ? <span style={ss({marginLeft:'auto',fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:10,background:'#ef4444',color:'#fff',lineHeight:'16px'})}>{t.badge}</span> : null}
                  </button>
                );
              })}
            </div>
          );
        })}

        <div style={ss({flex:1})}></div>

        {/* Bottom actions */}
        <div style={ss({padding:'12px 0',borderTop:'1px solid #f0eeec'})}>
          <button onClick={() => setRefreshAt(Date.now())}
            style={ss({width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 20px',border:'none',fontFamily:'inherit',fontSize:13,fontWeight:400,cursor:'pointer',background:'transparent',color:'#78716c'})}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#fafaf9'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
          >
            <i className={`fas fa-rotate ${loading?'fa-spin':''}`} style={{fontSize:12,width:16,color:'#a8a29e'}}></i> Refresh
          </button>
          <button onClick={() => router.push('/profile')}
            style={ss({width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 20px',border:'none',fontFamily:'inherit',fontSize:13,fontWeight:400,cursor:'pointer',background:'transparent',color:'#78716c'})}
            onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='#fafaf9'}
            onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}
          >
            <i className="fas fa-arrow-left" style={{fontSize:12,width:16,color:'#a8a29e'}}></i> Back to App
          </button>
          <button onClick={() => signOut({ callbackUrl:'/login' })}
            style={ss({width:'100%',display:'flex',alignItems:'center',gap:10,padding:'9px 20px',border:'none',fontFamily:'inherit',fontSize:13,fontWeight:400,cursor:'pointer',background:'transparent',color:'#78716c'})}
            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#fef2f2';(e.currentTarget as HTMLElement).style.color='#ef4444';}}
            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';(e.currentTarget as HTMLElement).style.color='#78716c';}}
          >
            <i className="fas fa-right-from-bracket" style={{fontSize:12,width:16,color:'#a8a29e'}}></i> Sign Out
          </button>
        </div>
      </div>

      {/* ═══ RIGHT CONTENT ═══ */}
      <div style={ss({flex:1,overflowY:'auto',maxHeight:'100vh'})}>
        <div style={ss({maxWidth:1100,margin:'0 auto',padding:'32px 36px 80px'})}>

          {/* Page heading */}
          <div style={ss({marginBottom:28,display:'flex',alignItems:'flex-start',justifyContent:'space-between'})}>
            <div>
              <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                <h1 style={ss({fontSize:22,fontWeight:700,color:'#1c1917',letterSpacing:'-0.3px'})}>{TABS.find(t=>t.id===tab)?.label ?? 'Admin'}</h1>
                {/* Phase A — environment badge. Red PROD pill in production
                    so destructive actions are visually distinguishable from
                    local/staging work. NEXT_PUBLIC_ENV_NAME overrides
                    NODE_ENV for staging environments. */}
                {IS_PROD ? (
                  <span title="Connected to production data" style={ss({padding:'3px 10px',borderRadius:999,background:'#dc2626',color:'#fff',fontSize:10,fontWeight:900,letterSpacing:'.5px',textTransform:'uppercase',display:'inline-flex',alignItems:'center',gap:5})}>
                    <i className="fas fa-circle" style={{fontSize:6}}></i>PROD
                  </span>
                ) : (
                  <span title={`Environment: ${ENV_NAME}`} style={ss({padding:'3px 10px',borderRadius:999,background:'#f5f5f4',color:'#78716c',fontSize:10,fontWeight:800,letterSpacing:'.5px',textTransform:'uppercase',border:'1px solid #e7e5e4'})}>
                    {ENV_NAME === 'production' ? 'PROD' : 'DEV'}
                  </span>
                )}
              </div>
              <div style={ss({fontSize:12,fontWeight:400,color:'#a8a29e',marginTop:3})}>{tabDesc[tab as TabId]}</div>
            </div>
            <button onClick={()=>setCommandOpen(true)} style={ss({display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:'#fff',border:'1px solid #e7e5e4',borderRadius:10,fontFamily:'inherit',fontSize:12,fontWeight:500,cursor:'pointer',color:'#78716c'})}
              onMouseEnter={e=>(e.currentTarget as HTMLElement).style.borderColor='#c4bfbb'}
              onMouseLeave={e=>(e.currentTarget as HTMLElement).style.borderColor='#e7e5e4'}
            >
              <i className="fas fa-bolt" style={{fontSize:10}}></i> Quick Actions <kbd style={ss({fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:4,background:'#f5f5f4',color:'#a8a29e',marginLeft:4})}>⌘K</kbd>
            </button>
          </div>

          {/* Phase A — type-PROD confirmation modal. Single instance reused
              for refunds, broadcasts, and mass emails. Only opened when
              IS_PROD is true; non-prod paths run their action immediately. */}
          {prodConfirm?.open && (
            <div style={ss({position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'})} onClick={()=>{if(!prodConfirmRunning)setProdConfirm(null);}}>
              <div onClick={e=>e.stopPropagation()} style={ss({background:'var(--card)',borderRadius:14,padding:'24px 28px',width:480,boxShadow:'0 24px 60px rgba(0,0,0,.3)'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:14})}>
                  <div style={ss({width:36,height:36,borderRadius:10,background:'#fef2f2',color:'#dc2626',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14})}><i className="fas fa-triangle-exclamation"></i></div>
                  <div>
                    <h3 style={ss({fontSize:15,fontWeight:900,margin:0,color:'#1c1917'})}>{prodConfirm.title}</h3>
                    <div style={ss({fontSize:11,fontWeight:700,color:'#dc2626',marginTop:2,letterSpacing:'.3px'})}>PRODUCTION ENVIRONMENT</div>
                  </div>
                </div>
                <div style={ss({fontSize:13,color:'#44403c',lineHeight:1.55,marginBottom:14})}>{prodConfirm.body}</div>
                <label style={ss({fontSize:10,fontWeight:800,color:'#78716c',textTransform:'uppercase',letterSpacing:'.4px',display:'block',marginBottom:6})}>Type <code style={ss({background:'#f5f5f4',padding:'1px 6px',borderRadius:4,color:'#dc2626',fontWeight:900})}>PROD</code> to confirm</label>
                <input
                  autoFocus
                  value={prodConfirmInput}
                  onChange={e=>setProdConfirmInput(e.target.value)}
                  placeholder="PROD"
                  disabled={prodConfirmRunning}
                  style={ss({width:'100%',padding:'10px 14px',borderRadius:10,border:`2px solid ${prodConfirmInput==='PROD'?'#dc2626':'#e7e5e4'}`,fontSize:13,fontWeight:700,fontFamily:'inherit',outline:'none',background:'var(--card)',boxSizing:'border-box'})}
                  onKeyDown={e=>{
                    if (e.key === 'Enter' && prodConfirmInput === 'PROD' && !prodConfirmRunning) {
                      (async () => {
                        setProdConfirmRunning(true);
                        try { await prodConfirm.onConfirm(); } finally {
                          setProdConfirmRunning(false);
                          setProdConfirm(null);
                          setProdConfirmInput('');
                        }
                      })();
                    }
                  }}
                />
                <div style={ss({display:'flex',gap:10,justifyContent:'flex-end',marginTop:18})}>
                  <button disabled={prodConfirmRunning} onClick={()=>{setProdConfirm(null);setProdConfirmInput('');}}
                    style={ss({padding:'9px 18px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:12,fontWeight:700,cursor:prodConfirmRunning?'default':'pointer',fontFamily:'inherit',color:'var(--stone-500)',opacity:prodConfirmRunning?0.6:1})}>
                    Cancel
                  </button>
                  <button disabled={prodConfirmInput !== 'PROD' || prodConfirmRunning}
                    onClick={async()=>{
                      setProdConfirmRunning(true);
                      try { await prodConfirm.onConfirm(); } finally {
                        setProdConfirmRunning(false);
                        setProdConfirm(null);
                        setProdConfirmInput('');
                      }
                    }}
                    style={ss({padding:'9px 22px',borderRadius:10,border:'none',background:prodConfirmInput==='PROD'?'#dc2626':'#fca5a5',color:'#fff',fontSize:12,fontWeight:800,cursor:prodConfirmInput==='PROD'&&!prodConfirmRunning?'pointer':'default',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6})}>
                    {prodConfirmRunning ? <><i className="fas fa-spinner fa-spin"></i>Working…</> : prodConfirm.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ─── Phase B — Payment timeline modal ───
              Opens from the Details button on each Payments-tab row. Reads
              from the payment_events audit table via /api/admin/payments/[id]/events.
              Lives at the page level (not inside the Payments tab block) so
              we don't lose it if the user toggles tabs mid-fetch. */}
          {eventsModalPaymentId !== null && (
            <div onClick={() => setEventsModalPaymentId(null)}
              style={ss({position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:24})}>
              <div onClick={e => e.stopPropagation()}
                style={ss({background:'var(--card)',borderRadius:14,width:560,maxHeight:'80vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 24px 60px rgba(0,0,0,.3)'})}>
                <div style={ss({padding:'18px 22px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:12})}>
                  <div style={ss({width:36,height:36,borderRadius:10,background:'var(--stone-900)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13})}>
                    <i className="fas fa-timeline"></i>
                  </div>
                  <div style={ss({flex:1,minWidth:0})}>
                    <h3 style={ss({fontSize:15,fontWeight:900,margin:0,color:'#1c1917'})}>Payment timeline</h3>
                    <div style={ss({fontSize:11,fontWeight:600,color:'var(--stone-400)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}>
                      {eventsModalPayment?.student_name || 'Unknown'} · {eventsModalPayment?.plan_name || '—'} · ${((eventsModalPayment?.amount_cents||0)/100).toFixed(2)}
                    </div>
                  </div>
                  <button onClick={()=>setEventsModalPaymentId(null)} style={ss({background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--stone-400)',padding:6})}>
                    <i className="fas fa-xmark"></i>
                  </button>
                </div>
                <div style={ss({flex:1,overflowY:'auto',padding:'18px 22px'})}>
                  {eventsModalLoading ? (
                    <div style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-400)',fontSize:13})}>
                      <i className="fas fa-spinner fa-spin" style={{marginRight:8}}></i>Loading timeline…
                    </div>
                  ) : eventsModalEvents.length === 0 ? (
                    <div style={ss({textAlign:'center',padding:'40px 0'})}>
                      <div style={{fontSize:32,marginBottom:8,color:'var(--stone-300)'}}><i className="fas fa-circle-info"></i></div>
                      <div style={ss({fontSize:13,fontWeight:700,color:'var(--stone-600)'})}>No events yet</div>
                      <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:4,maxWidth:360,margin:'4px auto 0'})}>
                        Events here come from Stripe webhooks. Older payments from before Phase B won't have timeline rows; new refunds and disputes will appear here automatically.
                      </div>
                    </div>
                  ) : (
                    <div style={ss({display:'flex',flexDirection:'column',gap:0})}>
                      {eventsModalEvents.map((ev, i) => {
                        // Map event types to icon + label + color so the
                        // timeline reads at a glance. Unknown types fall
                        // back to a neutral row.
                        const meta = ((): { icon: string; label: string; color: string; bg: string } => {
                          switch (ev.event_type) {
                            case 'checkout.completed':       return { icon: 'fa-circle-check',    label: 'Payment received',    color: '#065f46', bg: 'var(--emerald-light)' };
                            case 'payment_intent.failed':    return { icon: 'fa-circle-xmark',    label: 'Payment failed',      color: '#991b1b', bg: 'var(--red-light)' };
                            case 'refund.issued':            return { icon: 'fa-rotate-left',     label: 'Refund issued',       color: '#92400e', bg: 'var(--amber-light)' };
                            case 'refund.failed':            return { icon: 'fa-triangle-exclamation', label: 'Refund failed',  color: '#991b1b', bg: 'var(--red-light)' };
                            case 'refund.updated':           return { icon: 'fa-rotate',          label: 'Refund updated',      color: 'var(--stone-600)', bg: 'var(--stone-100)' };
                            case 'dispute.created':          return { icon: 'fa-gavel',           label: 'Dispute opened',      color: '#991b1b', bg: 'var(--red-light)' };
                            case 'dispute.won':              return { icon: 'fa-circle-check',    label: 'Dispute won',         color: '#065f46', bg: 'var(--emerald-light)' };
                            case 'dispute.lost':             return { icon: 'fa-circle-xmark',    label: 'Dispute lost',        color: '#991b1b', bg: 'var(--red-light)' };
                            case 'dispute.warning_closed':   return { icon: 'fa-bell',            label: 'Dispute warning closed', color: '#92400e', bg: 'var(--amber-light)' };
                            default:                          return { icon: 'fa-circle',         label: ev.event_type,         color: 'var(--stone-500)', bg: 'var(--stone-100)' };
                          }
                        })();
                        const isLast = i === eventsModalEvents.length - 1;
                        return (
                          <div key={ev.id} style={ss({display:'flex',gap:14,position:'relative',paddingBottom:isLast?0:16})}>
                            {/* Vertical connector line behind the icon column */}
                            {!isLast && <div style={ss({position:'absolute',left:14,top:30,bottom:0,width:2,background:'var(--border)'})}></div>}
                            <div style={ss({width:30,height:30,borderRadius:10,background:meta.bg,color:meta.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,flexShrink:0,zIndex:1})}>
                              <i className={`fas ${meta.icon}`}></i>
                            </div>
                            <div style={ss({flex:1,minWidth:0,paddingTop:2})}>
                              <div style={ss({display:'flex',alignItems:'baseline',gap:8,flexWrap:'wrap'})}>
                                <span style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)'})}>{meta.label}</span>
                                {ev.amount_cents != null && ev.amount_cents > 0 && (
                                  <span style={ss({fontSize:12,fontWeight:700,color:meta.color})}>${(ev.amount_cents/100).toFixed(2)}</span>
                                )}
                                {ev.status && (
                                  <span style={ss({padding:'1px 6px',borderRadius:4,fontSize:9,fontWeight:800,background:'var(--stone-50)',color:'var(--stone-500)',textTransform:'uppercase',letterSpacing:'.3px'})}>{ev.status}</span>
                                )}
                                <span style={ss({marginLeft:'auto',fontSize:10,color:'var(--stone-400)',fontWeight:600})}>{fmtDateTime(ev.created_at)}</span>
                              </div>
                              {ev.reason && (
                                <div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:3})}>Reason: {ev.reason}</div>
                              )}
                              <div style={ss({fontSize:9,fontFamily:'monospace',color:'var(--stone-300)',marginTop:3})}>{ev.event_type}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {loading && !['students','news','security','dates','messages','emails','payments','engine','funnel','subs','data','errors','status','popular','actions','earnings','premium_requests','recoveries'].includes(tab) && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'#78716c',fontSize:14,fontWeight:500})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading…
            </div>
          )}

          {error && error !== 'forbidden' && (
            <div style={ss({background:'#fef2f2',border:'1px solid #fecaca',borderRadius:12,padding:'16px 20px',marginBottom:20,display:'flex',alignItems:'flex-start',gap:12})}>
              <i className="fas fa-circle-exclamation" style={{color:'#ef4444',fontSize:16,marginTop:2}}></i>
              <div>
                <div style={ss({fontSize:13,fontWeight:700,color:'#991b1b',marginBottom:4})}>Failed to load data</div>
                <div style={ss({fontSize:12,fontWeight:500,color:'#dc2626',lineHeight:1.5})}>{error}</div>
                <div style={ss({fontSize:11,fontWeight:500,color:'#78716c',marginTop:8})}>Check that your database is running and <code style={{background:'#f5f5f4',padding:'1px 4px',borderRadius:4}}>POSTGRES_URL</code> is set correctly in your environment.</div>
                <button onClick={() => setRefreshAt(Date.now())} style={ss({marginTop:10,padding:'6px 14px',borderRadius:8,border:'1px solid #fecaca',background:'#fff',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',color:'#991b1b'})}>
                  <i className="fas fa-rotate" style={{marginRight:6,fontSize:9}}></i>Retry
                </button>
              </div>
            </div>
          )}

          {/* ═══ Phase 3: "Since Last Login" tab removed.
              The Recap tab was a daily-windowed view of signups, colleges,
              essays, payments, and LLM calls. The new Overview Metrics
              panel covers all of those with a 24h range — and lets you
              extend the window to 7d/30d/etc. Activity timeline lives on
              the Activity tab. ═══ */}

          {/* ═══ OVERVIEW ═══ */}
          {tab === 'overview' && !loading && stats && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>
              {/* Date range filter */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'10px 16px'})}>
                <i className="fas fa-calendar-range" style={{fontSize:11,color:'var(--stone-400)'}}></i>
                <span style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)' })}>Filter range</span>
                <input type="date" value={dateFrom} max={dateTo} onChange={e=>setDateFrom(e.target.value)}
                  style={{...inputA,fontSize:12,padding:'5px 10px'}} />
                <span style={ss({fontSize:11,color:'var(--stone-400)' })}>to</span>
                <input type="date" value={dateTo} min={dateFrom} max={todayStr} onChange={e=>setDateTo(e.target.value)}
                  style={{...inputA,fontSize:12,padding:'5px 10px'}} />
                <button onClick={()=>{setDateFrom(thirtyDaysAgo);setDateTo(todayStr);}}
                  style={ss({marginLeft:4,padding:'5px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--stone-50)',fontSize:11,fontWeight:700,color:'var(--stone-500)',cursor:'pointer',fontFamily:'inherit'})}>
                  Reset
                </button>
                <span style={ss({marginLeft:'auto',fontSize:10,fontWeight:600,color:'var(--stone-400)'})}>
                  {activityWindow.length} day{activityWindow.length!==1?'s':''} shown
                </span>
              </div>
              {/* ── Phase 2: Categorized ranged metrics panel ──
                  Single time-range selector drives every tile through one
                  API round-trip (/api/admin/metrics). Tiles are grouped into
                  five workflow-based panels so the dashboard scans top-down
                  rather than as a flat grid. The static StatCard row below
                  is preserved during transition; Phase 3 removes it. */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'16px 20px'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:14})}>
                  <div style={ss({width:30,height:30,borderRadius:8,background:'var(--stone-900)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11})}><i className="fas fa-chart-pie"></i></div>
                  <div style={ss({flex:1})}>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Metrics</h3>
                    <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Compared against the prior period of the same length{metricsRange==='all'?' · "All" range suppresses deltas':''}</p>
                  </div>
                  <div style={ss({display:'flex',gap:2,background:'var(--stone-50)',borderRadius:8,padding:2})}>
                    {METRIC_RANGES.map(r => (
                      <button key={r.id} onClick={()=>setMetricsRange(r.id)}
                        disabled={metricsLoading}
                        style={ss({padding:'5px 12px',borderRadius:6,border:'none',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:metricsLoading?'default':'pointer',
                          background:metricsRange===r.id?'var(--stone-900)':'transparent',
                          color:metricsRange===r.id?'#fff':'var(--stone-500)',
                          opacity:metricsLoading?0.6:1})}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                  {metricsLoading && <i className="fas fa-spinner fa-spin" style={{fontSize:11,color:'var(--stone-400)'}}></i>}
                </div>

                {/* Revenue & Payments */}
                <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6,marginTop:4})}>Revenue &amp; Payments</div>
                <div style={tileRowStyle}>
                  <MetricTile label="Revenue" bundle={metricsData?.metrics['revenue.total_cents']} format={fmtMoney} sub="succeeded" />
                  <MetricTile label="Refunds" bundle={metricsData?.metrics['revenue.refund_cents']} format={fmtMoney} sub="returned" betterWhen="lower" />
                  <MetricTile label="Payments" bundle={metricsData?.metrics['revenue.payment_count']} format={fmtCount} sub="transactions" />
                  <MetricTile label="Net" bundle={
                    /* Derived: revenue − refunds. We synthesize a bundle so
                       the same MetricTile renders it without special-casing. */
                    metricsData?.metrics['revenue.total_cents'] && metricsData?.metrics['revenue.refund_cents']
                      ? {
                          current:  metricsData.metrics['revenue.total_cents'].current  - metricsData.metrics['revenue.refund_cents'].current,
                          previous: metricsData.metrics['revenue.total_cents'].previous - metricsData.metrics['revenue.refund_cents'].previous,
                          spark:    metricsData.metrics['revenue.total_cents'].spark.map((v,i) => v - (metricsData.metrics['revenue.refund_cents'].spark[i] ?? 0)),
                        }
                      : undefined
                  } format={fmtMoney} sub="revenue − refunds" />
                </div>

                {/* Counselor Earnings */}
                <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>Counselor Earnings</div>
                <div style={tileRowStyle}>
                  <MetricTile label="Payouts" bundle={metricsData?.metrics['counselor.payouts_cents']} format={fmtMoney} sub="paid to counselors" />
                  <MetricTile label="Payout Count" bundle={metricsData?.metrics['counselor.payout_count']} format={fmtCount} sub="payout records" />
                </div>

                {/* Students & Engagement */}
                <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>Students &amp; Engagement</div>
                <div style={tileRowStyle}>
                  <MetricTile label="New Students" bundle={metricsData?.metrics['students.signups']} format={fmtCount} sub="signups" />
                  <MetricTile label="New Counselors" bundle={metricsData?.metrics['students.new_counselors']} format={fmtCount} sub="signups" />
                  <MetricTile label="Colleges Saved" bundle={metricsData?.metrics['engagement.colleges_added']} format={fmtCount} sub="across students" />
                  <MetricTile label="Essays Created" bundle={metricsData?.metrics['engagement.essays_created']} format={fmtCount} />
                  <MetricTile label="Essays Submitted" bundle={metricsData?.metrics['engagement.essays_submitted']} format={fmtCount} />
                </div>

                {/* LLM & Cost */}
                <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>LLM &amp; Cost</div>
                <div style={tileRowStyle}>
                  <MetricTile label="LLM Cost" bundle={metricsData?.metrics['llm.cost_microcents']} format={mc => fmtMoney(mc / 10_000)} sub="GPT-4o spend" betterWhen="lower" />
                  <MetricTile label="API Calls" bundle={metricsData?.metrics['llm.calls']} format={fmtCount} />
                  <MetricTile label="Tokens" bundle={metricsData?.metrics['llm.tokens']} format={fmtCount} sub="prompt + completion" />
                  <MetricTile label="Avg / Call" bundle={
                    /* Derived: cost ÷ calls. Cost is in microcents; we
                       convert to cents per call for fmtMoney's input. */
                    metricsData?.metrics['llm.cost_microcents'] && metricsData?.metrics['llm.calls']
                      ? {
                          current:  metricsData.metrics['llm.calls'].current  > 0 ? metricsData.metrics['llm.cost_microcents'].current  / 10_000 / metricsData.metrics['llm.calls'].current  : 0,
                          previous: metricsData.metrics['llm.calls'].previous > 0 ? metricsData.metrics['llm.cost_microcents'].previous / 10_000 / metricsData.metrics['llm.calls'].previous : 0,
                          spark: [], // sparkline of a ratio is rarely meaningful — leave empty
                        }
                      : undefined
                  } format={fmtMoney} sub="cost per call" betterWhen="lower" />
                </div>

                {/* Ops & Health */}
                <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>Ops &amp; Health</div>
                <div style={{...tileRowStyle, marginBottom:0}}>
                  <MetricTile label="Errors" bundle={metricsData?.metrics['ops.errors']} format={fmtCount} sub="logged" betterWhen="lower" />
                  <MetricTile label="Warnings" bundle={metricsData?.metrics['ops.warnings']} format={fmtCount} sub="logged" betterWhen="lower" />
                </div>
              </div>

              {/* Phase 3: the static StatCard row that used to live here
                  has been migrated up into the categorized ranged panel.
                  See the audit table in the Phase 2 commit for the full
                  mapping. The Daily Activity table below still uses
                  activityWindow / dateFrom / dateTo. */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12})}><i className="fas fa-calendar-days"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>Daily Activity</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)'})}>Last 14 days</p></div>
                </div>
                <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:13})}>
                  <thead><tr style={{background:'var(--stone-50)',borderBottom:'1px solid var(--border-light)'}}>
                    {['Date','Logins','Essays','Colleges','LLM Calls','Tokens'].map(h => <th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {[...activityWindow].reverse().map((row,i) => (
                      <tr key={row.date} style={{borderBottom:'1px solid var(--border-light)',background:i===0?'#eff6ff':'transparent'}}>
                        <td style={{...tdS,fontWeight:700}}>{new Date(row.date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}{i===0 && <span style={{marginLeft:8,fontSize:9,fontWeight:800,color:'var(--blue)',background:'#eff6ff',padding:'2px 6px',borderRadius:8}}>TODAY</span>}</td>
                        <td style={{...tdS,fontWeight:800,color:row.logins>0?'var(--stone-900)':'var(--stone-300)'}}>{row.logins}</td>
                        <td style={{...tdS,fontWeight:800,color:row.essays_created>0?'#7c3aed':'var(--stone-300)'}}>{row.essays_created}</td>
                        <td style={{...tdS,fontWeight:800,color:row.colleges_added>0?'#059669':'var(--stone-300)'}}>{row.colleges_added}</td>
                        <td style={{...tdS,fontWeight:800,color:row.llm_calls>0?'#d97706':'var(--stone-300)'}}>{row.llm_calls}</td>
                        <td style={{...tdS,fontWeight:700,color:'var(--stone-600)'}}>{fmt(row.llm_tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Quick Action Cards */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14})}>
                {[
                  {icon:'fa-comments',label:'Messages',desc:'Check student-counselor chats',tab:'messages' as TabId,color:'#3b82f6',bg:'#eff6ff'},
                  {icon:'fa-envelope',label:'Send Email',desc:'Email students or counselors',tab:'emails' as TabId,color:'#8b5cf6',bg:'var(--violet-light)'},
                  {icon:'fa-credit-card',label:'Payments',desc:'View revenue & transactions',tab:'payments' as TabId,color:'#10b981',bg:'var(--emerald-light)'},
                ].map(q=>(
                  <button key={q.label} onClick={()=>setTab(q.tab)}
                    style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,display:'flex',alignItems:'center',gap:14,cursor:'pointer',fontFamily:'inherit',textAlign:'left',transition:'all .15s'})}
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.transform='translateY(-1px)';(e.currentTarget as HTMLElement).style.boxShadow='0 4px 15px rgba(0,0,0,.05)';}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.transform='none';(e.currentTarget as HTMLElement).style.boxShadow='none';}}
                  >
                    <div style={ss({width:42,height:42,borderRadius:12,background:q.bg,display:'flex',alignItems:'center',justifyContent:'center',color:q.color,fontSize:15,flexShrink:0})}><i className={`fas ${q.icon}`}></i></div>
                    <div>
                      <div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)'})}>{q.label}</div>
                      <div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>{q.desc}</div>
                    </div>
                    <i className="fas fa-chevron-right" style={{marginLeft:'auto',fontSize:10,color:'var(--stone-300)'}}></i>
                  </button>
                ))}
              </div>

            </div>
          )}

          {/* ═══ SECURITY ═══ */}
          {tab === 'security' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>
              {/* Date range filter */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'10px 16px'})}>
                <i className="fas fa-calendar-range" style={{fontSize:11,color:'var(--stone-400)'}}></i>
                <span style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)' })}>Filter range</span>
                <input type="date" value={dateFrom} max={dateTo} onChange={e=>setDateFrom(e.target.value)}
                  style={{...inputA,fontSize:12,padding:'5px 10px'}} />
                <span style={ss({fontSize:11,color:'var(--stone-400)' })}>to</span>
                <input type="date" value={dateTo} min={dateFrom} max={todayStr} onChange={e=>setDateTo(e.target.value)}
                  style={{...inputA,fontSize:12,padding:'5px 10px'}} />
                <button onClick={()=>{setDateFrom(thirtyDaysAgo);setDateTo(todayStr);}}
                  style={ss({marginLeft:4,padding:'5px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--stone-50)',fontSize:11,fontWeight:700,color:'var(--stone-500)',cursor:'pointer',fontFamily:'inherit'})}>
                  Reset
                </button>
              </div>
              {/* Metric cards */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10})}>
                {[
                  { icon:'fa-ghost',            label:'Never Logged In',     value:secMetrics.neverLoggedIn,   color:'#ef4444', bg:'var(--red-light)',    sub:'Registered but never signed in' },
                  { icon:'fa-clock-rotate-left', label:'Stale 30d+',          value:secMetrics.staleAccounts,   color:'#f59e0b', bg:'var(--amber-light)',  sub:'No login in 30+ days' },
                  { icon:'fa-user-slash',        label:'No Profile Data',     value:secMetrics.noProfile,       color:'#8b5cf6', bg:'var(--violet-light)', sub:'No GPA or score entered' },
                  { icon:'fa-robot',             label:'High AI Users (50+)', value:secMetrics.highLlmUsers,    color:'#3b82f6', bg:'#eff6ff',            sub:'50+ LLM calls — possible abuse' },
                  { icon:'fa-user-plus',         label:'New Signups (7d)',     value:secMetrics.recentSignups7d, color:'#10b981', bg:'var(--emerald-light)',sub:'Registered in last week' },
                  { icon:'fa-ban',               label:'Zero-Cost AI Calls',  value:secMetrics.zeroCostAi,      color:'#6b7280', bg:'var(--stone-100)',    sub:'API calls logged at $0' },
                ].map(m => (
                  <div key={m.label} style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'12px 14px'})}>
                    <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:10})}>
                      <div style={ss({width:28,height:28,borderRadius:8,background:m.bg,color:m.color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11})}><i className={`fas ${m.icon}`}></i></div>
                      <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',lineHeight:1.2})}>{m.label}</div>
                    </div>
                    <div style={ss({fontSize:24,fontWeight:900,color:'var(--stone-900)',lineHeight:1})}>{m.value}</div>
                    <div style={ss({fontSize:10,fontWeight:500,color:'var(--stone-400)',marginTop:4})}>{m.sub}</div>
                  </div>
                ))}
              </div>

              {/* Flagged users table */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--red-light)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--red)',fontSize:12})}><i className="fas fa-flag"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>Flagged Users</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)'})}>Accounts with potential issues — top 25</p></div>
                </div>
                <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                  <thead><tr style={{background:'var(--stone-50)',borderBottom:'1px solid var(--border-light)'}}>
                    {['Student','Joined','Last Login','Score','AI Calls','Cost','Flags'].map(h => <th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {flaggedUsers.length === 0 ? (
                      <tr><td colSpan={7} style={ss({textAlign:'center',padding:'40px 0',color:'var(--stone-400)',fontSize:13})}><i className="fas fa-check-circle" style={{color:'var(--emerald)',marginRight:8}}></i>No flagged users</td></tr>
                    ) : flaggedUsers.map(s => {
                      const flags: {label:string;color:string;bg:string}[] = [];
                      if (!s.last_login) flags.push({label:'Never logged in',color:'#ef4444',bg:'var(--red-light)'});
                      if (s.last_login && Date.now()-new Date(s.last_login).getTime() > 30*86400000) flags.push({label:'Stale 30d+',color:'#f59e0b',bg:'var(--amber-light)'});
                      if (s.llm_calls > 50) flags.push({label:'High AI',color:'#3b82f6',bg:'#eff6ff'});
                      if (!s.final_score && !s.gpa) flags.push({label:'No profile',color:'#8b5cf6',bg:'var(--violet-light)'});
                      return (
                        <tr key={s.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                          <td style={tdS}><div style={ss({fontWeight:700,fontSize:13})}>{s.name}</div><div style={ss({fontSize:10,color:'var(--stone-400)'})}>{s.email}</div></td>
                          <td style={{...tdS,fontSize:12,color:'var(--stone-500)',whiteSpace:'nowrap'}}>{fmtDate(s.created_at)}</td>
                          <td style={{...tdS,fontSize:12,fontWeight:700,color:s.last_login?'var(--stone-600)':'var(--red)',whiteSpace:'nowrap'}}>{fmtDateTime(s.last_login)}</td>
                          <td style={tdS}>{s.final_score ? <span style={ss({padding:'3px 8px',borderRadius:8,fontSize:11,fontWeight:800,...scoreBg(s.final_score)})}>{s.final_score}</span> : <span style={{color:'var(--stone-300)'}}>—</span>}</td>
                          <td style={{...tdS,fontWeight:800,color:s.llm_calls>50?'#ef4444':'var(--stone-700)'}}>{s.llm_calls}</td>
                          <td style={{...tdS,fontSize:12,fontWeight:700}}>{s.llm_cost_usd > 0 ? `$${s.llm_cost_usd.toFixed(4)}` : '—'}</td>
                          <td style={tdS}><div style={ss({display:'flex',flexWrap:'wrap',gap:4})}>{flags.map(f => <span key={f.label} style={ss({fontSize:9,fontWeight:800,padding:'3px 7px',borderRadius:8,background:f.bg,color:f.color,whiteSpace:'nowrap'})}>{f.label}</span>)}</div></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ SYSTEM STATUS ═══ */}
          {tab === 'status' && !systemStatus && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading system status…
            </div>
          )}
          {tab === 'status' && systemStatus && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Services grid */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-server"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>API & Service Connections</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Environment variable status — keys managed in <code style={{background:'var(--stone-100)',padding:'1px 4px',borderRadius:4,fontSize:10}}>.env</code></p></div>
                </div>
                <div style={ss({padding:'0 20px'})}>
                  {(systemStatus.services || []).map((svc: any, i: number) => (
                    <div key={svc.name} style={ss({display:'flex',alignItems:'center',gap:14,padding:'16px 0',borderBottom:i<(systemStatus.services?.length||0)-1?'1px solid var(--border-light)':'none'})}>
                      {/* Status indicator */}
                      <div style={ss({width:40,height:40,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,
                        background:svc.status==='connected'?'var(--emerald-light)':svc.status==='partial'?'var(--amber-light)':'var(--red-light)',
                        color:svc.status==='connected'?'var(--emerald)':svc.status==='partial'?'#f59e0b':'var(--red)',fontSize:14
                      })}>
                        <i className={`fas ${svc.status==='connected'?'fa-check-circle':svc.status==='partial'?'fa-exclamation-circle':'fa-times-circle'}`}></i>
                      </div>
                      {/* Service info */}
                      <div style={ss({flex:1})}>
                        <div style={ss({display:'flex',alignItems:'center',gap:8})}>
                          <span style={ss({fontSize:14,fontWeight:800})}>{svc.name}</span>
                          <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:700,
                            background:svc.status==='connected'?'var(--emerald-light)':svc.status==='partial'?'var(--amber-light)':'var(--red-light)',
                            color:svc.status==='connected'?'#065f46':svc.status==='partial'?'#92400e':'#991b1b',
                            textTransform:'uppercase'
                          })}>{svc.status}</span>
                        </div>
                        <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:3})}>{svc.description}</div>
                      </div>
                      {/* Key info */}
                      <div style={ss({textAlign:'right',flexShrink:0})}>
                        {svc.key_preview ? (
                          <div style={ss({fontFamily:'monospace',fontSize:12,fontWeight:600,color:'var(--stone-600)',background:'var(--stone-50)',padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)'})}>{svc.key_preview}</div>
                        ) : (
                          <div style={ss({fontSize:11,fontWeight:600,color:'var(--stone-300)'})}>Not configured</div>
                        )}
                        <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:3})}>{svc.env_var}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Database status */}
              {systemStatus.database && (
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                  <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-database"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Database</h3>
                  </div>
                  <div style={ss({padding:'16px 20px',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14})}>
                    {[
                      {label:'Status', value:systemStatus.database.connected?'Connected':'Disconnected', color:systemStatus.database.connected?'var(--emerald)':'var(--red)'},
                      {label:'Pool Size', value:systemStatus.database.pool_total??'—', color:'var(--stone-700)'},
                      {label:'Active', value:systemStatus.database.pool_active??'—', color:'var(--blue)'},
                      {label:'Idle', value:systemStatus.database.pool_idle??'—', color:'var(--stone-500)'},
                    ].map(s=>(
                      <div key={s.label} style={ss({textAlign:'center'})}>
                        <div style={ss({fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.3px',color:'var(--stone-400)',marginBottom:4})}>{s.label}</div>
                        <div style={ss({fontSize:18,fontWeight:900,color:s.color})}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {systemStatus.database.url_preview && (
                    <div style={ss({padding:'0 20px 16px'})}>
                      <div style={ss({fontFamily:'monospace',fontSize:11,color:'var(--stone-500)',background:'var(--stone-50)',padding:'8px 12px',borderRadius:8,border:'1px solid var(--border)'})}>{systemStatus.database.url_preview}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Runtime info */}
              {systemStatus.runtime && (
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                  <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-microchip"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Runtime</h3>
                  </div>
                  <div style={ss({padding:'12px 20px'})}>
                    {Object.entries(systemStatus.runtime).map(([k, v]: [string, any], i: number) => (
                      <div key={k} style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderBottom:i<Object.keys(systemStatus.runtime).length-1?'1px solid var(--border-light)':'none'})}>
                        <span style={ss({fontSize:12,fontWeight:600,color:'var(--stone-500)',textTransform:'capitalize'})}>{k.replace(/_/g,' ')}</span>
                        <span style={ss({fontSize:12,fontWeight:700,fontFamily:'monospace'})}>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Config tip */}
              <div style={ss({background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'16px 20px',display:'flex',alignItems:'flex-start',gap:12})}>
                <i className="fas fa-info-circle" style={{color:'var(--stone-400)',fontSize:14,marginTop:2}}></i>
                <div>
                  <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-600)',marginBottom:4})}>Managing API Keys</div>
                  <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',lineHeight:1.6})}>
                    Keys are managed via environment variables in your <code style={{background:'var(--stone-100)',padding:'1px 4px',borderRadius:4,fontSize:11}}>.env</code> file.
                    After changing keys, restart the app: <code style={{background:'var(--stone-100)',padding:'1px 4px',borderRadius:4,fontSize:11}}>docker compose down && docker compose up --build -d</code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ STUDENTS ═══ */}
          {tab === 'students' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Search + filters */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'})}>
                <div style={ss({position:'relative',flex:1,minWidth:200})}>
                  <i className="fas fa-search" style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--stone-300)',fontSize:11,pointerEvents:'none'}}></i>
                  <input placeholder="Search by name, email, school, major…" value={search} onChange={e => {setSearch(e.target.value);setStudentPage(0);}} style={{...inputA,width:'100%',paddingLeft:32}} />
                </div>
                <div style={ss({display:'flex',gap:4,flexWrap:'wrap'})}>
                  {([
                    {id:'all',       label:'All',         icon:'fa-users'},
                    {id:'pro',       label:'Pro',         icon:'fa-bolt'},
                    {id:'premium',   label:'Premium',     icon:'fa-crown'},
                    {id:'locked',    label:'Locked',      icon:'fa-lock'},
                    {id:'no_profile',label:'No Profile',  icon:'fa-user-slash'},
                    {id:'recent',    label:'Recent (7d)', icon:'fa-clock'},
                  ] as const).map(f => (
                    <button key={f.id} type="button" onClick={()=>{setStudentFilter(f.id);setStudentPage(0);}}
                      style={ss({display:'inline-flex',alignItems:'center',gap:5,padding:'6px 12px',borderRadius:8,border:studentFilter===f.id?'2px solid var(--stone-900)':'1px solid var(--border)',background:studentFilter===f.id?'var(--stone-900)':'var(--card)',color:studentFilter===f.id?'#fff':'var(--stone-500)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',transition:'all .1s'})}>
                      <i className={`fas ${f.icon}`} style={{fontSize:9}}></i>{f.label}
                      {f.id==='pro'     && <span style={ss({fontSize:9,opacity:.7})}>({students.filter(s=>s.subscription_status==='pro').length})</span>}
                      {f.id==='premium' && <span style={ss({fontSize:9,opacity:.7})}>({students.filter(s=>s.subscription_status==='premium').length})</span>}
                      {f.id==='locked'  && <span style={ss({fontSize:9,opacity:.7})}>({students.filter(s=>s.is_locked).length})</span>}
                    </button>
                  ))}
                </div>
                <div style={ss({display:'flex',alignItems:'center',gap:6,padding:'8px 12px',background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,fontSize:11,fontWeight:700,color:'var(--stone-500)'})}><i className="fas fa-users" style={{color:'var(--stone-300)',fontSize:10}}></i>{filteredAll.length} students</div>
                <button onClick={()=>{
                  // Phase A: export the currently-filtered student rows.
                  const cols: CsvColumn<AdminStudent>[] = [
                    { header: 'ID', value: r => r.id },
                    { header: 'Name', value: r => r.name },
                    { header: 'Email', value: r => r.email },
                    { header: 'Phone', value: r => r.phone, preserveLeadingZero: true },
                    { header: 'Subscription', value: r => r.subscription_status },
                    { header: 'Subscription Expires', value: r => r.subscription_expires_at },
                    { header: 'High School', value: r => r.high_school_name },
                    { header: 'State', value: r => r.high_school_state },
                    { header: 'Graduation Year', value: r => r.graduation_year },
                    { header: 'Intended Major', value: r => r.intended_major },
                    { header: 'GPA', value: r => r.gpa },
                    { header: 'SAT', value: r => r.sat },
                    { header: 'ACT', value: r => r.act },
                    { header: 'Final Score', value: r => r.final_score },
                    { header: 'Colleges', value: r => r.college_count },
                    { header: 'Reach', value: r => r.reach_count },
                    { header: 'Target', value: r => r.target_count },
                    { header: 'Safety', value: r => r.safety_count },
                    { header: 'Essays', value: r => r.essay_count },
                    { header: 'Submitted Essays', value: r => r.submitted_essay_count },
                    { header: 'LLM Calls', value: r => r.llm_calls },
                    { header: 'LLM Cost USD', value: r => r.llm_cost_usd },
                    { header: 'Locked', value: r => r.is_locked ? 'Y' : 'N' },
                    { header: 'Created At', value: r => r.created_at },
                    { header: 'Last Login', value: r => r.last_login },
                  ];
                  downloadCsv('admitly_students', filteredAll, cols);
                }} style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-700)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>
                  <i className="fas fa-file-export" style={{fontSize:10}}></i>Export CSV
                </button>
                <button onClick={()=>{setShowImport(true);setImportCsv('');setImportResult(null);}} style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}><i className="fas fa-file-import" style={{fontSize:10}}></i>Import Users</button>
              </div>

              {/* Bulk Import Modal */}
              {showImport && (
                <div style={ss({position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center'})} onClick={()=>setShowImport(false)}>
                  <div onClick={e=>e.stopPropagation()} style={ss({background:'var(--card)',borderRadius:16,padding:'28px 32px',width:560,maxHeight:'80vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.2)'})}>
                    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20})}>
                      <div>
                        <h2 style={ss({fontSize:18,fontWeight:900,margin:0})}>Import Users</h2>
                        <p style={ss({fontSize:12,color:'var(--stone-400)',marginTop:4})}>Paste CSV data or upload a file. Each user gets a welcome email with password setup link.</p>
                      </div>
                      <button onClick={()=>setShowImport(false)} style={ss({background:'none',border:'none',cursor:'pointer',fontSize:16,color:'var(--stone-400)',padding:4})}><i className="fas fa-xmark"></i></button>
                    </div>

                    <div style={ss({background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:10,padding:'12px 14px',marginBottom:12,fontSize:11,color:'var(--stone-500)',lineHeight:1.6})}>
                      <strong style={{color:'var(--stone-700)'}}>CSV Format:</strong> name, email, role (student or counselor)<br/>
                      <code style={{fontSize:10,color:'var(--stone-600)',background:'var(--stone-100)',padding:'1px 4px',borderRadius:3}}>Maya Patel, maya@gmail.com, student</code><br/>
                      <code style={{fontSize:10,color:'var(--stone-600)',background:'var(--stone-100)',padding:'1px 4px',borderRadius:3}}>Dr. Mitchell, sarah@edu.com, counselor</code>
                    </div>

                    <div style={ss({marginBottom:12})}>
                      <input type="file" accept=".csv,.txt" onChange={async(e)=>{
                        const file=e.target.files?.[0];
                        if(!file)return;
                        const text=await file.text();
                        setImportCsv(text);
                      }} style={ss({fontSize:12,marginBottom:8})}/>
                      <textarea value={importCsv} onChange={e=>setImportCsv(e.target.value)} placeholder="name, email, role&#10;Maya Patel, maya@gmail.com, student&#10;James Chen, james@gmail.com, student" rows={8}
                        style={ss({width:'100%',padding:'10px 12px',borderRadius:10,border:'1px solid var(--border)',fontFamily:'monospace',fontSize:11,resize:'vertical',outline:'none',background:'var(--card)',color:'var(--stone-700)'})}/>
                    </div>

                    {importResult && (
                      <div style={ss({padding:'14px 16px',borderRadius:10,marginBottom:12,background:importResult.created>0?'#ecfdf5':'#fef2f2',border:`1px solid ${importResult.created>0?'#a7f3d0':'#fecaca'}`})}>
                        <div style={ss({fontSize:13,fontWeight:700,color:importResult.created>0?'#065f46':'#991b1b',marginBottom:4})}>
                          {importResult.created > 0 ? `✓ ${importResult.created} account${importResult.created===1?'':'s'} created` : 'No accounts created'}
                          {importResult.skipped > 0 && <span style={{fontWeight:500,color:'#92400e'}}> · {importResult.skipped} skipped</span>}
                        </div>
                        {importResult.errors.length>0&&<div style={ss({fontSize:10,color:'#991b1b',marginTop:6})}>{importResult.errors.map((e,i)=><div key={i}>• {e}</div>)}</div>}
                      </div>
                    )}

                    <div style={ss({display:'flex',gap:10,justifyContent:'flex-end'})}>
                      <button onClick={()=>setShowImport(false)} style={ss({padding:'10px 20px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)'})}>Cancel</button>
                      <button disabled={importLoading||!importCsv.trim()} onClick={async()=>{
                        setImportLoading(true);setImportResult(null);
                        // Parse CSV
                        const lines=importCsv.trim().split('\n').map(l=>l.trim()).filter(Boolean);
                        const users:{ name:string; email:string; role:string }[]=[];
                        for(const line of lines){
                          // Skip header row
                          if(line.toLowerCase().startsWith('name,')|| line.toLowerCase().startsWith('name\t'))continue;
                          const parts=line.split(/[,\t]/).map(p=>p.trim());
                          if(parts.length>=2){
                            users.push({name:parts[0],email:parts[1],role:parts[2]||'student'});
                          }
                        }
                        if(users.length===0){setImportResult({created:0,skipped:0,errors:['No valid rows found']});setImportLoading(false);return;}
                        try{
                          const res=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bulk_import',users})});
                          const data=await res.json();
                          // Surface HTTP errors (e.g. 403 Forbidden) and API error objects
                          // that would otherwise be swallowed into a generic "No accounts created".
                          if(!res.ok){
                            setImportResult({created:0,skipped:0,errors:[`Server returned ${res.status}: ${data?.error || 'Unknown error'}`]});
                          }else if(data?.error){
                            setImportResult({created:0,skipped:0,errors:[data.error]});
                          }else{
                            setImportResult({created:data.created||0,skipped:data.skipped||0,errors:data.errors||[]});
                            if(data.created>0)setRefreshAt(Date.now());
                          }
                        }catch(e:any){setImportResult({created:0,skipped:0,errors:[`Network error: ${e.message}`]});}
                        setImportLoading(false);
                      }} style={ss({padding:'10px 24px',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:12,fontWeight:800,cursor:importLoading?'wait':'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6,opacity:importLoading||!importCsv.trim()?.5:1})}>
                        {importLoading?<><i className="fas fa-spinner fa-spin" style={{fontSize:10}}></i>Importing…</>:<><i className="fas fa-file-import" style={{fontSize:10}}></i>Import & Send Invites</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {loading ? <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:192,background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',color:'var(--stone-400)',fontSize:13})}><i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i>Loading…</div> : (
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                  <div style={ss({overflowX:'auto'})}>
                    <table style={ss({width:'100%',borderCollapse:'collapse',minWidth:1000})}>
                      <thead><tr style={{background:'var(--stone-50)',borderBottom:'1px solid var(--border-light)'}}>
                        {([['name','Student'],['created_at','Joined'],['last_login','Last Login'],['high_school_state','State'],['gpa','GPA'],['sat','SAT'],['act','ACT'],['llm_calls','AI']] as [keyof AdminStudent,string][]).map(([k,h]) => (
                          <th key={h} onClick={() => toggleSort(k)} style={{...thS,cursor:'pointer'}}>{h} <i className={`fas fa-sort${sortKey===k?(sortDir==='asc'?'-up':'-down'):''}`} style={{fontSize:9,color:sortKey===k?'var(--blue)':'var(--stone-300)',marginLeft:2}}></i></th>
                        ))}
                        <th style={{...thS,textAlign:'center'}}>Pro</th>
                        <th style={{...thS,textAlign:'center'}}>Premium</th>
                        <th style={{...thS,textAlign:'center'}}>Lock</th>
                        <th style={{...thS,textAlign:'center'}}>Actions</th>
                        <th style={thS}></th>
                      </tr></thead>
                      <tbody>
                        {filtered.map(s => {
                          return (<Fragment key={s.id}>
                            <tr onClick={() => setExpandedId(expandedId===s.id?null:s.id)}
                              style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',transition:'background .1s',
                                background:s.is_locked?'#fef2f2':expandedId===s.id?'#fefce8':'transparent'}}>
                              <td style={tdS}><div><div style={ss({fontWeight:700,fontSize:13})}>{s.name}</div><div style={ss({fontSize:11,color:'var(--stone-400)'})}>{s.email}</div></div></td>
                              <td style={{...tdS,fontSize:12,color:'var(--stone-500)',whiteSpace:'nowrap'}}>{fmtDate(s.created_at)}</td>
                              <td style={{...tdS,fontSize:12,fontWeight:700,color:s.last_login?'var(--stone-600)':'var(--stone-300)',whiteSpace:'nowrap'}}>{fmtDateTime(s.last_login)}</td>
                              <td style={{...tdS,fontSize:12,color:'var(--stone-500)'}}>{s.high_school_state || <span style={{color:'var(--stone-300)'}}>—</span>}</td>
                              <td style={{...tdS,fontWeight:800}}>{s.gpa ? Number(s.gpa).toFixed(2) : <span style={{color:'var(--stone-300)'}}>—</span>}</td>
                              <td style={{...tdS,fontWeight:700,color:'var(--stone-600)',fontSize:12}}>{s.sat ?? <span style={{color:'var(--stone-300)'}}>—</span>}</td>
                              <td style={{...tdS,fontWeight:700,color:'var(--stone-600)',fontSize:12}}>{s.act ?? <span style={{color:'var(--stone-300)'}}>—</span>}</td>
                              <td style={{...tdS,fontWeight:800,color:s.llm_calls>0?'#7c3aed':'var(--stone-300)'}}>{s.llm_calls}</td>
                              {/* Pro — read-only status badge */}
                              <td style={{...tdS,textAlign:'center'}}>
                                {(() => {
                                  const sub = s.subscription_status || 'free';
                                  const expired = s.subscription_expires_at && new Date(s.subscription_expires_at) < new Date();
                                  const isPro = (sub === 'pro' || sub === 'premium') && !expired;
                                  return (
                                    <span style={ss({display:'inline-flex',alignItems:'center',gap:4,padding:'3px 9px',borderRadius:99,fontSize:10,fontWeight:800,
                                      background:isPro?'#eff6ff':'var(--stone-50)',color:isPro?'#2563eb':'var(--stone-300)',
                                      outline:isPro?'1.5px solid #bfdbfe':'1px solid var(--border)'})}>
                                      <i className="fas fa-bolt" style={{fontSize:8}}></i>
                                      {isPro ? 'Pro' : 'Free'}
                                    </span>
                                  );
                                })()}
                              </td>
                              {/* Premium — read-only flag */}
                              <td style={{...tdS,textAlign:'center'}}>
                                {(() => {
                                  const sub = s.subscription_status || 'free';
                                  const expired = s.subscription_expires_at && new Date(s.subscription_expires_at) < new Date();
                                  const isPremium = sub === 'premium' && !expired;
                                  const wasPremium = sub === 'premium' && expired;
                                  return (
                                    <span style={ss({display:'inline-flex',alignItems:'center',gap:4,padding:'3px 9px',borderRadius:99,fontSize:10,fontWeight:800,
                                      background:isPremium?'#f5f3ff':(wasPremium?'#fef2f2':'var(--stone-50)'),
                                      color:isPremium?'#7c3aed':(wasPremium?'#dc2626':'var(--stone-300)'),
                                      outline:isPremium?'1.5px solid #ddd6fe':(wasPremium?'1.5px solid #fecaca':'1px solid var(--border)')})}>
                                      <i className="fas fa-crown" style={{fontSize:8}}></i>
                                      {isPremium ? 'Active' : (wasPremium ? 'Expired' : 'Free')}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td style={{...tdS,textAlign:'center'}}>
                                <button type="button" onClick={(e)=>{e.stopPropagation();toggleLock(s.id,s.is_locked);}}
                                  title={s.is_locked?'Unlock account':'Lock account'}
                                  style={ss({width:28,height:28,borderRadius:8,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,transition:'all .1s',
                                    background:s.is_locked?'var(--red-light)':'var(--stone-50)',color:s.is_locked?'var(--red)':'var(--stone-300)'})}
                                  onMouseEnter={e=>{if(!s.is_locked){(e.currentTarget as HTMLElement).style.background='var(--red-light)';(e.currentTarget as HTMLElement).style.color='var(--red)';}}}
                                  onMouseLeave={e=>{if(!s.is_locked){(e.currentTarget as HTMLElement).style.background='var(--stone-50)';(e.currentTarget as HTMLElement).style.color='var(--stone-300)';}}}
                                ><i className={`fas ${s.is_locked?'fa-lock':'fa-lock-open'}`}></i></button>
                              </td>
                              <td style={{...tdS,textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                                <div style={ss({display:'flex',gap:4,justifyContent:'center'})}>
                                  <button type="button" onClick={()=>impersonateStudent(s.id,s.name)}
                                    title="Impersonate — log in as this student"
                                    style={ss({width:28,height:28,borderRadius:8,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,background:'var(--stone-50)',color:'var(--stone-300)',transition:'all .1s'})}
                                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='#eff6ff';(e.currentTarget as HTMLElement).style.color='#2563eb';}}
                                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='var(--stone-50)';(e.currentTarget as HTMLElement).style.color='var(--stone-300)';}}
                                  ><i className="fas fa-user-secret"></i></button>
                                  <button type="button" onClick={()=>deleteStudent(s.id,s.name)}
                                    title="Delete user and all data"
                                    style={ss({width:28,height:28,borderRadius:8,border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,background:'var(--stone-50)',color:'var(--stone-300)',transition:'all .1s'})}
                                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--red-light)';(e.currentTarget as HTMLElement).style.color='var(--red)';}}
                                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='var(--stone-50)';(e.currentTarget as HTMLElement).style.color='var(--stone-300)';}}
                                  ><i className="fas fa-trash"></i></button>
                                </div>
                              </td>
                              <td style={tdS}><i className="fas fa-chevron-down" style={{fontSize:10,color:expandedId===s.id?'var(--blue)':'var(--stone-300)',transition:'transform .2s',transform:expandedId===s.id?'rotate(180deg)':'none'}}></i></td>
                            </tr>
                            {/* ── Expanded student detail ── */}
                            {expandedId === s.id && (
                              <tr key={`${s.id}-detail`}><td colSpan={11} style={{padding:0,background:'#fefce8',borderBottom:'2px solid #fde68a'}}>
                                <div style={ss({padding:'16px 20px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16})}>
                                  {/* Column 1: Academic Profile */}
                                  <div>
                                    <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:8})}>Academic Profile</div>
                                    <div style={ss({display:'flex',flexDirection:'column',gap:4,fontSize:12})}>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>School:</span> <span style={{fontWeight:700}}>{s.high_school_name || '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>Grad Year:</span> <span style={{fontWeight:700}}>{s.graduation_year || '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>Major:</span> <span style={{fontWeight:700}}>{s.intended_major || '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>GPA:</span> <span style={{fontWeight:800}}>{s.gpa ? Number(s.gpa).toFixed(2) : '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>SAT / ACT:</span> <span style={{fontWeight:800}}>{s.sat || '—'} / {s.act || '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>Phone:</span> <span style={{fontWeight:600}}>{s.phone || '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>Login Type:</span> <span style={{fontWeight:600}}>{(s as any).auth_provider === 'google' ? '🔵 Google' : '✉️ Email'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:100,display:'inline-block'}}>Profile Score:</span> <span style={{fontWeight:800,color:s.final_score&&s.final_score>=70?'#059669':'var(--stone-700)'}}>{s.final_score ?? '—'}/100</span></div>
                                    </div>
                                  </div>
                                  {/* Column 2: College List & Essays */}
                                  <div>
                                    <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:8})}>College List & Essays</div>
                                    <div style={ss({display:'flex',flexDirection:'column',gap:4,fontSize:12})}>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Colleges Saved:</span> <span style={{fontWeight:800}}>{s.college_count}</span></div>
                                      <div style={ss({display:'flex',gap:8,marginLeft:0})}>
                                        <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'#fef2f2',color:'#991b1b'})}>Reach: {s.reach_count}</span>
                                        <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'#fffbeb',color:'#92400e'})}>Target: {s.target_count}</span>
                                        <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'#ecfdf5',color:'#065f46'})}>Safety: {s.safety_count}</span>
                                      </div>
                                      <div style={{marginTop:6}}><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Total Essays:</span> <span style={{fontWeight:800}}>{s.essay_count}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Submitted:</span> <span style={{fontWeight:800,color:s.submitted_essay_count>0?'#059669':'var(--stone-400)'}}>{s.submitted_essay_count}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Word Count:</span> <span style={{fontWeight:700}}>{s.essay_word_count_total?.toLocaleString() || '0'}</span></div>
                                      <div style={{marginTop:6}}><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>AI Calls:</span> <span style={{fontWeight:800,color:'#7c3aed'}}>{s.llm_calls}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>AI Tokens:</span> <span style={{fontWeight:700}}>{s.llm_tokens_total?.toLocaleString() || '0'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>AI Cost:</span> <span style={{fontWeight:700}}>${s.llm_cost_usd?.toFixed(4) || '0.0000'}</span></div>
                                    </div>
                                  </div>
                                  {/* Column 3: Plan History & Status */}
                                  <div>
                                    <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:8})}>Plan & Subscription</div>
                                    <div style={ss({display:'flex',flexDirection:'column',gap:4,fontSize:12})}>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Current Plan:</span>
                                        <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,
                                          background:s.subscription_status==='premium'?'#f5f3ff':s.subscription_status==='pro'?'#eff6ff':'var(--stone-100)',
                                          color:s.subscription_status==='premium'?'#7c3aed':s.subscription_status==='pro'?'#2563eb':'var(--stone-500)',
                                        })}>{(s.subscription_status||'free').toUpperCase()}</span>
                                      </div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Expires:</span> <span style={{fontWeight:700,color:s.subscription_expires_at&&new Date(s.subscription_expires_at)<new Date(Date.now()+7*86400000)?'#ef4444':'var(--stone-700)'}}>{s.subscription_expires_at ? fmtDate(s.subscription_expires_at) : '—'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Expert Session:</span> <span style={{fontWeight:800,color:s.has_expert_session?'#059669':'var(--stone-400)'}}>{s.has_expert_session?'Yes':'No'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Expert Plan:</span> <span style={{fontWeight:700}}>{s.expert_plan || '—'}</span></div>
                                      <div style={{marginTop:6}}><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Account:</span> <span style={{fontWeight:800,color:s.is_locked?'#ef4444':'#059669'}}>{s.is_locked?'LOCKED':'Active'}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Joined:</span> <span style={{fontWeight:600}}>{fmtDate(s.created_at)}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Last Login:</span> <span style={{fontWeight:600}}>{fmtDateTime(s.last_login)}</span></div>
                                      <div><span style={{fontWeight:500,color:'var(--stone-400)',width:120,display:'inline-block'}}>Profile Updated:</span> <span style={{fontWeight:600}}>{fmtDateTime(s.profile_updated_at)}</span></div>
                                    </div>
                                  </div>
                                </div>
                              </td></tr>
                            )}
                          </Fragment>);
                        })}
                        {filtered.length === 0 && !loading && <tr><td colSpan={10} style={ss({textAlign:'center',padding:'60px 0',color:'var(--stone-400)',fontSize:13})}>No students match your filters</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',padding:'12px 20px',borderTop:'1px solid var(--border-light)',background:'var(--stone-50)'})}>
                      <div style={ss({fontSize:12,fontWeight:600,color:'var(--stone-400)'})}>
                        Showing {studentPage * STUDENTS_PER_PAGE + 1}–{Math.min((studentPage + 1) * STUDENTS_PER_PAGE, filteredAll.length)} of {filteredAll.length}
                      </div>
                      <div style={ss({display:'flex',gap:4})}>
                        <button type="button" disabled={studentPage===0} onClick={()=>setStudentPage(p=>p-1)}
                          style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:studentPage===0?'not-allowed':'pointer',color:studentPage===0?'var(--stone-300)':'var(--stone-600)',fontFamily:'inherit'})}>
                          <i className="fas fa-chevron-left" style={{fontSize:9}}></i> Prev
                        </button>
                        {Array.from({length:Math.min(totalPages,5)}).map((_,i) => {
                          const page = totalPages <= 5 ? i : Math.max(0,Math.min(studentPage-2,totalPages-5)) + i;
                          return (
                            <button key={page} type="button" onClick={()=>setStudentPage(page)}
                              style={ss({width:32,height:32,borderRadius:8,border:page===studentPage?'2px solid var(--stone-900)':'1px solid var(--border)',background:page===studentPage?'var(--stone-900)':'var(--card)',color:page===studentPage?'#fff':'var(--stone-600)',fontSize:11,fontWeight:800,cursor:'pointer',fontFamily:'inherit'})}>
                              {page+1}
                            </button>
                          );
                        })}
                        <button type="button" disabled={studentPage>=totalPages-1} onClick={()=>setStudentPage(p=>p+1)}
                          style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:studentPage>=totalPages-1?'not-allowed':'pointer',color:studentPage>=totalPages-1?'var(--stone-300)':'var(--stone-600)',fontFamily:'inherit'})}>
                          Next <i className="fas fa-chevron-right" style={{fontSize:9}}></i>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ═══ ADMINS ═══ */}
          {tab === 'admins' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Summary cards */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10})}>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.4,marginBottom:6})}>Total admins</div>
                  <div style={ss({fontSize:22,fontWeight:800,color:'var(--stone-900)'})}>{admins.length}</div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.4,marginBottom:6})}>
                    <i className="fas fa-shield-halved" style={{marginRight:5,color:'#7c3aed'}}></i>Super admins
                  </div>
                  <div style={ss({fontSize:22,fontWeight:800,color:'#7c3aed'})}>{admins.filter(a=>a.source==='env'||a.source==='both').length}</div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.4,marginBottom:6})}>Regular admins</div>
                  <div style={ss({fontSize:22,fontWeight:800,color:'var(--stone-900)'})}>{admins.filter(a=>a.source==='db').length}</div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.4,marginBottom:6})}>Super + DB</div>
                  <div style={ss({fontSize:22,fontWeight:800,color:'var(--stone-900)'})}>{admins.filter(a=>a.source==='both').length}</div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'14px 16px'})}>
                  <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:.4,marginBottom:6})}>Locked</div>
                  <div style={ss({fontSize:22,fontWeight:800,color:admins.filter(a=>a.is_locked).length>0?'#991b1b':'var(--stone-900)'})}>{admins.filter(a=>a.is_locked).length}</div>
                </div>
              </div>

              {/* Info banner explaining the hierarchy */}
              <div style={ss({padding:'12px 16px',background:'#faf5ff',border:'1px solid #e9d5ff',borderRadius:10,fontSize:12,color:'#5b21b6',lineHeight:1.6})}>
                <i className="fas fa-shield-halved" style={{marginRight:8}}></i>
                <strong>Super admins</strong> are defined in the <code>ADMIN_EMAILS</code> environment variable. They cannot be locked or removed from within the app — to change them, update the env var and redeploy. <strong>Regular admins</strong> have <code>role=&apos;admin&apos;</code> in the users table and can be locked by any other admin. You cannot lock your own account.
              </div>

              {/* Admins table */}
              {loading ? (
                <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:192,background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',color:'var(--stone-400)',fontSize:13})}>
                  <i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i>Loading…
                </div>
              ) : admins.length === 0 ? (
                <div style={ss({padding:'32px 24px',background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,textAlign:'center',color:'var(--stone-400)',fontSize:13})}>
                  No admins found.
                </div>
              ) : (
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                  <div style={ss({overflowX:'auto'})}>
                    <table style={ss({width:'100%',borderCollapse:'collapse',minWidth:800})}>
                      <thead>
                        <tr style={{background:'var(--stone-50)',borderBottom:'1px solid var(--border-light)'}}>
                          <th style={thS}>Admin</th>
                          <th style={thS}>Type</th>
                          <th style={thS}>DB role</th>
                          <th style={thS}>Joined</th>
                          <th style={thS}>Last login</th>
                          <th style={{...thS,textAlign:'center'}}>Status</th>
                          <th style={{...thS,textAlign:'center'}}>Lock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {admins.map(a => {
                          const isSelf = (session?.user?.email || '').toLowerCase() === (a.email || '').toLowerCase();
                          const isSuperAdmin = a.source === 'env' || a.source === 'both';
                          const lockDisabled = isSelf || isSuperAdmin;
                          const lockReason = isSelf
                            ? 'You cannot lock your own account'
                            : isSuperAdmin
                              ? 'Super admins are defined in ADMIN_EMAILS and cannot be locked from the app. Update the env var and redeploy to change them.'
                              : '';
                          // Badge label and color derived from source
                          const badgeLabel = a.source === 'both' ? 'SUPER + DB' : a.source === 'env' ? 'SUPER' : 'REGULAR';
                          const badgeBg    = a.source === 'both' ? '#faf5ff' : a.source === 'env' ? '#faf5ff' : '#ecfdf5';
                          const badgeFg    = a.source === 'both' ? '#6b21a8' : a.source === 'env' ? '#7c3aed' : '#065f46';
                          return (
                            <tr key={a.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                              <td style={tdS}>
                                <div style={ss({display:'flex',flexDirection:'column',gap:2})}>
                                  <div style={ss({fontSize:13,fontWeight:700,color:'var(--stone-900)'})}>
                                    {a.name || '—'}
                                    {isSelf && <span style={ss({marginLeft:8,fontSize:9,padding:'2px 7px',borderRadius:5,background:'#eff6ff',color:'#1e40af',fontWeight:700})}>YOU</span>}
                                    {isSuperAdmin && <span style={ss({marginLeft:6,fontSize:9,padding:'2px 7px',borderRadius:5,background:'#faf5ff',color:'#7c3aed',fontWeight:700})}><i className="fas fa-shield-halved" style={{fontSize:8,marginRight:3}}></i>SUPER</span>}
                                  </div>
                                  <div style={ss({fontSize:11,color:'var(--stone-400)'})}>{a.email}</div>
                                </div>
                              </td>
                              <td style={tdS}>
                                <span style={ss({
                                  fontSize:10,padding:'3px 9px',borderRadius:5,fontWeight:700,
                                  background: badgeBg,
                                  color:      badgeFg,
                                })}>
                                  {badgeLabel}
                                </span>
                              </td>
                              <td style={tdS}>
                                <span style={ss({fontSize:11,color:'var(--stone-500)',fontWeight:600})}>{a.role || '—'}</span>
                              </td>
                              <td style={tdS}>
                                <span style={ss({fontSize:11,color:'var(--stone-500)'})}>{fmtDate(a.created_at)}</span>
                              </td>
                              <td style={tdS}>
                                <span style={ss({fontSize:11,color:'var(--stone-500)'})}>{fmtDateTime(a.last_login)}</span>
                              </td>
                              <td style={{...tdS,textAlign:'center'}}>
                                {a.is_locked ? (
                                  <span style={ss({fontSize:10,padding:'3px 9px',borderRadius:5,background:'#fef2f2',color:'#991b1b',fontWeight:700})}>LOCKED</span>
                                ) : (
                                  <span style={ss({fontSize:10,padding:'3px 9px',borderRadius:5,background:'#ecfdf5',color:'#065f46',fontWeight:700})}>ACTIVE</span>
                                )}
                              </td>
                              <td style={{...tdS,textAlign:'center'}}>
                                {lockDisabled ? (
                                  <span
                                    title={lockReason}
                                    style={ss({fontSize:11,color:'var(--stone-300)',cursor:'help'})}
                                  >
                                    —
                                  </span>
                                ) : (
                                  <button
                                    onClick={async () => {
                                      const action = a.is_locked ? 'unlock' : 'lock';
                                      if (!confirm(`${action === 'lock' ? 'Lock' : 'Unlock'} admin ${a.email}?`)) return;
                                      try {
                                        const res = await fetch('/api/admin', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ action: 'toggle_admin_lock', target_id: a.id, locked: !a.is_locked }),
                                        });
                                        const data = await res.json();
                                        if (!res.ok) {
                                          alert(`Failed: ${data.error || 'Unknown error'}`);
                                          return;
                                        }
                                        fetchData('admins');
                                      } catch (e: any) {
                                        alert(`Network error: ${e.message}`);
                                      }
                                    }}
                                    style={ss({
                                      padding:'5px 12px',borderRadius:6,border:'1px solid var(--border)',
                                      background: a.is_locked ? '#ecfdf5' : 'var(--card)',
                                      fontSize:10,fontWeight:700,
                                      color: a.is_locked ? '#065f46' : '#991b1b',
                                      cursor:'pointer',fontFamily:'inherit',
                                    })}
                                  >
                                    <i className={`fas ${a.is_locked ? 'fa-lock-open' : 'fa-lock'}`} style={{fontSize:9,marginRight:4}}></i>
                                    {a.is_locked ? 'Unlock' : 'Lock'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'llm' && !loading && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Phase 3: LLM stat tiles moved to the Overview Metrics
                  panel (LLM & Cost group), which adds time-range pivots
                  and sparklines. The table below still shows per-call
                  detail, which is the workflow this tab is actually for. */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12})}><i className="fas fa-list-check"></i></div>
                  <h3 style={ss({fontSize:14,fontWeight:900})}>LLM Call Log</h3>
                  <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',marginLeft:'auto'})}>{llmUsage.length} records</span>
                </div>
                <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                  <thead><tr style={{background:'var(--stone-50)',borderBottom:'1px solid var(--border-light)'}}>
                    {['Time','Student','Mode','Essay Type','Model','In','Out','Total','Cost'].map(h => <th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {llmUsage.length === 0 ? <tr><td colSpan={9} style={ss({textAlign:'center',padding:'60px 0',color:'var(--stone-400)',fontSize:13})}>No LLM calls recorded yet</td></tr> :
                    llmUsage.map(row => (
                      <tr key={row.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                        <td style={{...tdS,fontSize:12,color:'var(--stone-500)',whiteSpace:'nowrap'}}>{fmtDateTime(row.created_at)}</td>
                        <td style={tdS}>{row.user_name ? <div><div style={ss({fontSize:12,fontWeight:700})}>{row.user_name}</div><div style={ss({fontSize:10,color:'var(--stone-400)'})}>{row.user_email}</div></div> : <span style={{color:'var(--stone-300)',fontSize:12}}>Unknown</span>}</td>
                        <td style={tdS}><span style={ss({display:'inline-flex',padding:'3px 8px',borderRadius:8,fontSize:10,fontWeight:800,textTransform:'uppercase',background:row.mode==='improve'?'var(--violet-light)':'#eff6ff',color:row.mode==='improve'?'var(--violet)':'var(--blue)'})}>{row.mode}</span></td>
                        <td style={{...tdS,fontSize:12,color:'var(--stone-500)',textTransform:'capitalize',whiteSpace:'nowrap'}}>{row.essay_type?.replace(/_/g,' ') ?? '—'}</td>
                        <td style={tdS}><span style={ss({fontSize:10,fontWeight:800,color:'var(--stone-500)',background:'var(--stone-100)',padding:'3px 8px',borderRadius:8})}>{row.model}</span></td>
                        <td style={{...tdS,fontFamily:'monospace',fontSize:12,textAlign:'right'}}>{fmt(row.prompt_tokens)}</td>
                        <td style={{...tdS,fontFamily:'monospace',fontSize:12,textAlign:'right'}}>{fmt(row.completion_tokens)}</td>
                        <td style={{...tdS,fontFamily:'monospace',fontSize:12,fontWeight:800,textAlign:'right'}}>{fmt(row.total_tokens)}</td>
                        <td style={{...tdS,fontFamily:'monospace',fontSize:12,fontWeight:800,color:'#065f46',textAlign:'right'}}>${Number(row.cost_usd).toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ADMISSIONS PULSE / NEWS ═══ */}
          {tab === 'news' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>
              {/* Generate action card */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:12})}>
                  <div style={ss({width:40,height:40,borderRadius:12,background:'var(--yellow)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14})}><i className="fas fa-bolt"></i></div>
                  <div>
                    <div style={ss({fontSize:14,fontWeight:900})}>Generate News</div>
                    <div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:2})}>Fetches real articles from Google News and summarizes with AI. Toggle checkboxes to control visibility.</div>
                  </div>
                </div>
                <button onClick={handleGenerateNews} disabled={newsGenerating}
                  style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'10px 20px',background:'var(--stone-900)',color:'#fff',borderRadius:12,border:'none',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:newsGenerating?'not-allowed':'pointer',opacity:newsGenerating?0.5:1,flexShrink:0})}>
                  <i className={`fas ${newsGenerating?'fa-spinner fa-spin':'fa-wand-magic-sparkles'}`} style={{fontSize:10}}></i>
                  {newsGenerating ? 'Generating…' : 'Generate 10 Items'}
                </button>
              </div>

              {/* ═══ Add Custom Article Form ═══ */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24})}>
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:16})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--yellow)',fontSize:12,flexShrink:0})}><i className="fas fa-plus"></i></div>
                  <div>
                    <div style={ss({fontSize:14,fontWeight:900})}>Add Custom Article</div>
                    <div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Custom articles appear at the top of the student news feed</div>
                  </div>
                </div>
                <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12})}>
                  <div style={ss({gridColumn:'span 2'})}>
                    <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',display:'block',marginBottom:4})}>Title</label>
                    <input value={customHeadline} onChange={e=>setCustomHeadline(e.target.value)} placeholder="Short headline — under 12 words" maxLength={255}
                      style={ss({width:'100%',background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',fontFamily:'inherit',fontSize:13,fontWeight:700,color:'var(--stone-900)',outline:'none',boxSizing:'border-box'})}/>
                  </div>
                  <div style={ss({gridColumn:'span 2'})}>
                    <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',display:'block',marginBottom:4})}>Detail / Summary</label>
                    <textarea value={customSummary} onChange={e=>setCustomSummary(e.target.value)} placeholder="2–3 sentence summary students would find useful" rows={3}
                      style={ss({width:'100%',background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',fontFamily:'inherit',fontSize:12,fontWeight:500,color:'var(--stone-800)',outline:'none',resize:'vertical',lineHeight:1.6,boxSizing:'border-box'})}/>
                  </div>
                  <div>
                    <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',display:'block',marginBottom:4})}>Tag</label>
                    <select value={customTag} onChange={e=>setCustomTag(e.target.value)}
                      style={ss({width:'100%',background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',fontFamily:'inherit',fontSize:12,fontWeight:700,color:'var(--stone-800)',outline:'none',appearance:'none' as any,cursor:'pointer'})}>
                      {['SAT/ACT','Test-Optional','Financial Aid','Strategy','Deadlines','Trends','Rankings','New Programs'].map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'0.3px',display:'block',marginBottom:4})}>Source URL <span style={{fontWeight:500,textTransform:'none'}}>(optional)</span></label>
                    <input value={customUrl} onChange={e=>setCustomUrl(e.target.value)} placeholder="https://example.edu/news/..."
                      style={ss({width:'100%',background:'var(--stone-50)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 12px',fontFamily:'inherit',fontSize:12,fontWeight:500,color:'var(--stone-800)',outline:'none',boxSizing:'border-box'})}/>
                  </div>
                </div>
                <div style={ss({display:'flex',justifyContent:'flex-end'})}>
                  <button onClick={handleAddCustomNews} disabled={customSaving || !customHeadline.trim() || !customSummary.trim()}
                    style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'10px 20px',borderRadius:10,border:'none',background:!customHeadline.trim()||!customSummary.trim()?'var(--stone-200)':'var(--stone-900)',color:!customHeadline.trim()||!customSummary.trim()?'var(--stone-400)':'#fff',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:!customHeadline.trim()||!customSummary.trim()?'not-allowed':'pointer'})}>
                    <i className={`fas ${customSaving?'fa-spinner fa-spin':'fa-plus'}`} style={{fontSize:10}}></i>
                    {customSaving ? 'Saving…' : 'Add Article'}
                  </button>
                </div>
              </div>

              {/* News list with checkboxes */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--yellow)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12})}><i className="fas fa-newspaper"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>{newsItems.length} News Items</h3>
                  </div>
                  <span style={ss({fontSize:11,fontWeight:600,color:'var(--stone-400)'})}><i className="fas fa-eye" style={{marginRight:4}}></i>{newsItems.filter(n=>n.is_visible).length} visible to students</span>
                </div>

                {newsItems.length === 0 ? (
                  <div style={ss({textAlign:'center',padding:'48px 20px',color:'var(--stone-400)'})}>
                    <i className="fas fa-newspaper" style={{fontSize:28,display:'block',marginBottom:10,color:'var(--stone-200)'}}></i>
                    <p style={ss({fontSize:13,fontWeight:600})}>No news items yet</p>
                    <p style={ss({fontSize:11,fontWeight:500,marginTop:4})}>Click &quot;Generate 10 Items&quot; to create AI-powered admissions news</p>
                  </div>
                ) : newsItems.map(item => (
                  <div key={item.id} style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'flex-start',gap:14,opacity:item.is_visible?1:0.4,transition:'opacity .15s'})}>
                    {/* Checkbox */}
                    <div style={ss({paddingTop:2,flexShrink:0})}>
                      <button onClick={() => handleToggleNews(item.id, !item.is_visible)}
                        style={ss({width:22,height:22,borderRadius:6,border:item.is_visible?'none':'2px solid var(--stone-300)',background:item.is_visible?'var(--yellow)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',transition:'all .15s'})}>
                        {item.is_visible && <i className="fas fa-check" style={{fontSize:10,color:'var(--stone-900)'}}></i>}
                      </button>
                    </div>
                    {/* Content */}
                    <div style={ss({flex:1,minWidth:0})}>
                      <div style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:4})}>
                        <span style={ss({fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:8,background:'var(--stone-100)',color:'var(--stone-500)',textTransform:'uppercase'})}>{item.tag}</span>
                        {item.is_custom && <span style={ss({fontSize:9,fontWeight:800,padding:'2px 7px',borderRadius:8,background:'var(--yellow)',color:'var(--stone-900)',textTransform:'uppercase'})}>Custom</span>}
                        <span style={ss({fontSize:10,fontWeight:500,color:'var(--stone-400)'})}>
                          {new Date(item.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
                        </span>
                      </div>
                      <div style={ss({fontSize:13,fontWeight:800,color:'var(--stone-900)',marginBottom:3})}>{item.headline}</div>
                      <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-500)',lineHeight:1.5})}>{item.summary}</div>
                      {item.source_url && <a href={item.source_url} target="_blank" rel="noopener noreferrer" style={ss({fontSize:10,fontWeight:600,color:'var(--blue)',textDecoration:'none',marginTop:4,display:'inline-flex',alignItems:'center',gap:4})} onClick={e=>e.stopPropagation()}><i className="fas fa-external-link-alt" style={{fontSize:8}}></i>Source</a>}
                    </div>
                    {/* Delete */}
                    <button onClick={() => handleDeleteNews(item.id)}
                      style={ss({width:28,height:28,borderRadius:8,border:'none',background:'transparent',color:'var(--stone-300)',fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}
                      onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--red-light)';(e.currentTarget as HTMLElement).style.color='var(--red)';}}
                      onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';(e.currentTarget as HTMLElement).style.color='var(--stone-300)';}}
                    ><i className="fas fa-trash"></i></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ KEY DATES ═══ */}
          {tab === 'dates' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>
              {/* Add new date form */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:24})}>
                <h2 style={ss({fontSize:14,fontWeight:900,marginBottom:16,display:'flex',alignItems:'center',gap:8})}><i className="fas fa-plus-circle" style={{color:'var(--yellow)',fontSize:13}}></i> Add New Date</h2>
                <div style={ss({display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10})}>
                  <select value={dateForm.category} onChange={e => setDateForm(f=>({...f,category:e.target.value}))} style={inputA}>
                    {['sat','act','ap','fafsa','app_deadline','other'].map(c => <option key={c} value={c}>{c.toUpperCase().replace('_',' ')}</option>)}
                  </select>
                  <input value={dateForm.title} onChange={e => setDateForm(f=>({...f,title:e.target.value}))} placeholder="Title *" style={inputA} />
                  <input type="date" value={dateForm.event_date} onChange={e => setDateForm(f=>({...f,event_date:e.target.value}))} style={inputA} />
                  <input value={dateForm.description} onChange={e => setDateForm(f=>({...f,description:e.target.value}))} placeholder="Description (optional)" style={inputA} />
                </div>
                <button onClick={handleAddDate} disabled={dateSaving || !dateForm.title || !dateForm.event_date}
                  style={ss({marginTop:12,display:'inline-flex',alignItems:'center',gap:6,padding:'8px 16px',background:'var(--stone-900)',color:'#fff',borderRadius:10,border:'none',fontFamily:'inherit',fontSize:11,fontWeight:800,cursor:'pointer',opacity:(dateSaving||!dateForm.title||!dateForm.event_date)?0.4:1})}>
                  <i className={`fas ${dateSaving?'fa-spinner fa-spin':'fa-plus'}`} style={{fontSize:9}}></i> {dateSaving ? 'Saving…' : 'Add Date'}
                </button>
              </div>

              {/* Key Dates table with toggle */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <h3 style={ss({fontSize:14,fontWeight:900})}>{keyDates.length} Key Dates</h3>
                  <span style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:500})}>
                    {keyDates.filter(d=>!d.is_active).length > 0 && <span style={ss({color:'#d97706',fontWeight:700,marginRight:8})}>{keyDates.filter(d=>!d.is_active).length} hidden</span>}
                    Toggle visibility — changes apply immediately
                  </span>
                </div>
                <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                  <thead><tr style={{borderBottom:'1px solid var(--border-light)'}}>
                    {['Date','Category','Title','Description','Visible',''].map(h => <th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {keyDates.map(d => (
                      <tr key={d.id} style={{borderBottom:'1px solid var(--border-light)',opacity:d.is_active?1:.5,transition:'opacity .2s'}}>
                        <td style={{...tdS,fontWeight:700,whiteSpace:'nowrap'}}>{new Date(d.event_date.includes('T')?d.event_date:d.event_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                        <td style={tdS}><span style={ss({padding:'3px 8px',borderRadius:8,fontSize:10,fontWeight:700,background:'var(--stone-100)',color:'var(--stone-600)',textTransform:'uppercase'})}>{d.category.replace('_',' ')}</span></td>
                        <td style={{...tdS,fontWeight:600}}>{d.title}</td>
                        <td style={{...tdS,fontSize:12,color:'var(--stone-400)',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{d.description ?? '—'}</td>
                        <td style={tdS}>
                          <button onClick={() => handleToggleDate(d.id,d.is_active)}
                            style={ss({position:'relative',width:40,height:22,borderRadius:11,border:'none',cursor:'pointer',transition:'background .2s',
                              background:d.is_active?'#22c55e':'#d6d3d1',flexShrink:0,padding:0})}>
                            <span style={ss({position:'absolute',top:2,left:d.is_active?20:2,width:18,height:18,borderRadius:'50%',background:'#fff',
                              boxShadow:'0 1px 3px rgba(0,0,0,.15)',transition:'left .2s'})} />
                          </button>
                        </td>
                        <td style={tdS}>
                          <button onClick={() => handleDeleteDate(d.id)} style={ss({fontSize:10,fontWeight:700,color:'var(--red)',background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',padding:'4px 8px',borderRadius:6,opacity:.6})} title="Delete permanently">
                            <i className="fas fa-trash" style={{fontSize:9}}></i>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* College Deadlines from CSV */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--yellow)',fontSize:12,flexShrink:0})}><i className="fas fa-university"></i></div>
                  <div style={ss({flex:1})}>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>College Deadlines</h3>
                    <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:1})}>
                      Loaded from <code style={ss({fontSize:10,background:'var(--stone-100)',padding:'1px 4px',borderRadius:3})}>data/college_deadlines.csv</code> · {collegeDeadlines.length} entries
                    </div>
                  </div>
                </div>
                {/* Search + type filter */}
                <div style={ss({padding:'12px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:6,flex:1,minWidth:200})}>
                    <i className="fas fa-search" style={{fontSize:10,color:'var(--stone-400)'}}></i>
                    <input value={cdSearch} onChange={e=>setCdSearch(e.target.value)} placeholder="Search schools…"
                      style={{...inputA,flex:1,fontSize:11,padding:'6px 10px'}} />
                    {cdSearch&&<button onClick={()=>setCdSearch('')} style={ss({padding:'2px 6px',borderRadius:4,border:'1px solid var(--border)',background:'var(--card)',fontSize:9,cursor:'pointer',color:'var(--stone-400)',fontFamily:'inherit'})}><i className="fas fa-times"></i></button>}
                  </div>
                  <div style={ss({display:'flex',gap:4})}>
                    {['all','ED','EA','REA','RD','ED2','Rolling','FAFSA','CSS'].map(t=>(
                      <button key={t} onClick={()=>setCdTypeFilter(t)}
                        style={ss({padding:'3px 9px',borderRadius:6,border:'none',cursor:'pointer',fontFamily:'inherit',fontSize:10,fontWeight:700,
                          background:cdTypeFilter===t?'var(--stone-900)':'var(--stone-50)',
                          color:cdTypeFilter===t?'#fff':'var(--stone-500)',transition:'all .1s'})}>{t==='all'?'All':t}</button>
                    ))}
                  </div>
                  <span style={ss({fontSize:10,color:'var(--stone-400)',fontWeight:600,marginLeft:'auto'})}>
                    {(()=>{const f=collegeDeadlines.filter(d=>(cdTypeFilter==='all'||d.deadline_type===cdTypeFilter)&&(!cdSearch||d.college_name.toLowerCase().includes(cdSearch.toLowerCase())));return `${f.length} results`;})()}
                  </span>
                </div>
                {/* Table */}
                <div style={ss({maxHeight:500,overflowY:'auto'})}>
                <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                  <thead><tr style={{background:'var(--stone-50)',position:'sticky',top:0,zIndex:1}}>
                    {['School','Type','Date','Description'].map(h => <th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(()=>{
                      const filtered = collegeDeadlines.filter(d =>
                        (cdTypeFilter==='all'||d.deadline_type===cdTypeFilter) &&
                        (!cdSearch||d.college_name.toLowerCase().includes(cdSearch.toLowerCase()))
                      );
                      if (filtered.length===0) return <tr><td colSpan={4} style={ss({...tdS,textAlign:'center',color:'var(--stone-400)',padding:'30px 20px'})}>No deadlines found{cdSearch?` for "${cdSearch}"`:''}</td></tr>;
                      return filtered.map((d,i)=>{
                        const tc:{[k:string]:{bg:string;color:string}}={ED:{bg:'#fef2f2',color:'#dc2626'},ED2:{bg:'#fef2f2',color:'#dc2626'},EA:{bg:'#eff6ff',color:'#2563eb'},REA:{bg:'#f5f3ff',color:'#7c3aed'},RD:{bg:'#fefce8',color:'#ca8a04'},Rolling:{bg:'#ecfdf5',color:'#059669'},FAFSA:{bg:'#ecfdf5',color:'#059669'},CSS:{bg:'#eff6ff',color:'#2563eb'}};
                        const c=tc[d.deadline_type]||{bg:'var(--stone-100)',color:'var(--stone-600)'};
                        return (
                        <tr key={`${d.id}-${i}`} style={{borderBottom:'1px solid var(--border-light)'}}>
                          <td style={{...tdS,fontWeight:600}}>{d.college_name}</td>
                          <td style={tdS}><span style={ss({padding:'2px 7px',borderRadius:6,fontSize:9,fontWeight:700,background:c.bg,color:c.color})}>{d.deadline_type}</span></td>
                          <td style={{...tdS,fontWeight:600,whiteSpace:'nowrap'}}>{new Date(d.due_date.includes('T')?d.due_date:d.due_date+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                          <td style={{...tdS,fontSize:12,color:'var(--stone-500)'}}>{d.description||'—'}</td>
                        </tr>);
                      });
                    })()}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {/* ═══ PLANS ═══ */}
          {tab === 'plans' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>
              {/* ═══ Pro Pricing Config ═══ */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--yellow)',fontSize:12})}><i className="fas fa-tag"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>Pro Pricing</h3><div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Controls the price shown on all upgrade paywalls and /subscribe</div></div>
                </div>
                <div style={ss({padding:'20px',display:'flex',gap:16,alignItems:'flex-end',flexWrap:'wrap'})}>
                  <div style={ss({width:130})}>
                    <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Full Price ($)</label>
                    <input type="number" value={proFullPrice} onChange={e=>setProFullPrice(e.target.value)} min={1}
                      style={{...inputA,width:'100%',fontSize:18,fontWeight:800,color:'var(--stone-900)',textAlign:'center'}} />
                  </div>
                  <div style={ss({width:130})}>
                    <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Discounted Price ($)</label>
                    <input type="number" value={proDiscountPrice} onChange={e=>setProDiscountPrice(e.target.value)} min={1}
                      style={{...inputA,width:'100%',fontSize:18,fontWeight:800,color:'var(--emerald)',textAlign:'center'}} />
                  </div>
                  {/* Preview */}
                  <div style={ss({flex:1,minWidth:200,padding:'14px 18px',background:'var(--stone-900)',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                    <div>
                      <div style={ss({fontSize:11,fontWeight:600,color:'rgba(255,255,255,.5)',marginBottom:4})}>Student sees:</div>
                      <div style={ss({display:'flex',alignItems:'baseline',gap:8})}>
                        <span style={ss({fontSize:28,fontWeight:900,color:'#fff'})}>${parseInt(proDiscountPrice)||0}</span>
                        {parseInt(proFullPrice) > parseInt(proDiscountPrice) && <span style={ss({fontSize:16,fontWeight:600,color:'rgba(255,255,255,.35)',textDecoration:'line-through'})}>${parseInt(proFullPrice)||0}</span>}
                      </div>
                    </div>
                    {parseInt(proFullPrice) > parseInt(proDiscountPrice) && (
                      <div style={ss({background:'var(--yellow)',color:'#000',padding:'6px 12px',borderRadius:10,fontSize:11,fontWeight:800,textAlign:'center',lineHeight:1.3})}>
                        SAVE<br/>${(parseInt(proFullPrice)||0)-(parseInt(proDiscountPrice)||0)}
                      </div>
                    )}
                  </div>
                  <button onClick={async ()=>{
                    setPricingSaving(true); setPricingSaved(false);
                    await fetch('/api/pricing',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({pro_full_price:parseInt(proFullPrice)||129,pro_discount_price:parseInt(proDiscountPrice)||89})});
                    setPricingSaving(false); setPricingSaved(true); setTimeout(()=>setPricingSaved(false),3000);
                  }} disabled={pricingSaving}
                    style={ss({padding:'10px 24px',borderRadius:10,border:'none',background:pricingSaved?'var(--emerald)':'var(--stone-900)',color:'#fff',fontSize:13,fontWeight:800,cursor:'pointer',fontFamily:'inherit',height:42,display:'flex',alignItems:'center',gap:6,flexShrink:0})}>
                    <i className={`fas ${pricingSaving?'fa-spinner fa-spin':pricingSaved?'fa-check':'fa-save'}`} style={{fontSize:11}}></i>
                    {pricingSaving ? 'Saving…' : pricingSaved ? 'Saved!' : 'Save Pricing'}
                  </button>
                </div>
              </div>
              {/* Add Plan */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--yellow)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-900)',fontSize:12})}><i className="fas fa-plus"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>{editingPlan ? 'Edit Plan' : 'Add New Plan'}</h3></div>
                </div>
                <div style={ss({padding:'16px 20px',display:'flex',gap:10,alignItems:'flex-end',flexWrap:'wrap'})}>
                  <div style={ss({flex:1,minWidth:140})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Name</label>
                    <input value={planForm.name} onChange={e=>setPlanForm(p=>({...p,name:e.target.value}))} placeholder="e.g. Premium" style={{...inputA,width:'100%',color:'var(--stone-700)'}} /></div>
                  <div style={ss({width:80})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Sessions</label>
                    <input type="number" value={planForm.sessions} onChange={e=>setPlanForm(p=>({...p,sessions:e.target.value}))} style={{...inputA,width:'100%',color:'var(--stone-700)'}} /></div>
                  <div style={ss({width:100})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Price ($)</label>
                    <input type="number" value={planForm.price} onChange={e=>setPlanForm(p=>({...p,price:e.target.value}))} placeholder="99.00" step="0.01" style={{...inputA,width:'100%',color:'var(--stone-700)'}} /></div>
                  <div style={ss({width:120})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Discounted ($) <span style={{fontSize:9,fontWeight:500,color:'var(--stone-300)'}}>optional</span></label>
                    <input type="number" value={planForm.discounted_price} onChange={e=>setPlanForm(p=>({...p,discounted_price:e.target.value}))} placeholder="e.g. 79.00" step="0.01" style={{...inputA,width:'100%',color:'var(--stone-700)'}} /></div>
                  <div style={ss({flex:2,minWidth:200})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Description</label>
                    <input value={planForm.description} onChange={e=>setPlanForm(p=>({...p,description:e.target.value}))} placeholder="Short description" style={{...inputA,width:'100%',color:'var(--stone-700)'}} /></div>
                  <button onClick={async () => {
                    if (!planForm.name) return;
                    const body = { action: editingPlan ? 'update_plan' : 'create_plan', id: editingPlan, name:planForm.name, sessions:parseInt(planForm.sessions)||1, price_cents:Math.round(parseFloat(planForm.price||'0')*100), discounted_price_cents: planForm.discounted_price ? Math.round(parseFloat(planForm.discounted_price)*100) : null, description:planForm.description, features:planForm.features.split(',').map(f=>f.trim()).filter(Boolean) };
                    await fetch('/api/admin', { method: editingPlan ? 'PATCH' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
                    setPlanForm({ name:'', sessions:'1', price:'', discounted_price:'', description:'', features:'' }); setEditingPlan(null); setRefreshAt(Date.now());
                  }} style={ss({padding:'8px 20px',borderRadius:10,border:'none',background:planForm.name?'var(--stone-900)':'var(--stone-200)',color:planForm.name?'#fff':'var(--stone-400)',fontSize:13,fontWeight:700,cursor:planForm.name?'pointer':'default',fontFamily:'inherit',height:38})}>
                    {editingPlan ? 'Update' : 'Add Plan'}
                  </button>
                  {editingPlan && <button onClick={()=>{setEditingPlan(null);setPlanForm({name:'',sessions:'1',price:'',discounted_price:'',description:'',features:''});}} style={ss({padding:'8px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-500)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',height:38})}>Cancel</button>}
                </div>
              </div>
              {/* Plan Cards */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280,1fr))',gap:14})}>
                {plans.sort((a,b)=>a.sort_order-b.sort_order).map(p => (
                  <div key={p.id} style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:22,position:'relative',opacity:p.is_active?1:0.5})}>
                    {!p.is_active && <div style={ss({position:'absolute',top:12,right:12,fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20,background:'var(--stone-100)',color:'var(--stone-400)'})}>Inactive</div>}
                    <div style={ss({fontSize:18,fontWeight:900,color:'var(--stone-900)',marginBottom:4})}>{p.name}</div>
                    <div style={ss({display:'flex',alignItems:'baseline',gap:8,marginBottom:2})}>
                      {p.discounted_price_cents ? <>
                        <span style={ss({fontSize:24,fontWeight:900,color:'var(--stone-900)'})}>${(p.discounted_price_cents/100).toFixed(0)}</span>
                        <span style={ss({fontSize:15,fontWeight:700,color:'var(--stone-400)',textDecoration:'line-through'})}>${(p.price_cents/100).toFixed(0)}</span>
                        <span style={ss({fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:20,background:'#fef2f2',color:'var(--red)'})}>{Math.round((1-p.discounted_price_cents/p.price_cents)*100)}% off</span>
                      </> : <span style={ss({fontSize:24,fontWeight:900,color:'var(--stone-900)'})}>${(p.price_cents/100).toFixed(0)}</span>}
                      <span style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)'})}>/package</span>
                    </div>
                    <div style={ss({fontSize:12,color:'var(--stone-500)',marginBottom:12})}>{p.sessions} session{p.sessions!==1?'s':''} · {p.description}</div>
                    {p.features?.length > 0 && <div style={ss({marginBottom:14})}>{p.features.map((f,i) => <div key={i} style={ss({fontSize:11,color:'var(--stone-600)',padding:'3px 0',display:'flex',alignItems:'center',gap:6})}><i className="fas fa-check" style={{fontSize:8,color:'var(--emerald)'}}></i>{f}</div>)}</div>}
                    <div style={ss({display:'flex',gap:6})}>
                      <button onClick={()=>{setEditingPlan(p.id);setPlanForm({name:p.name,sessions:String(p.sessions),price:String(p.price_cents/100),discounted_price:p.discounted_price_cents?String(p.discounted_price_cents/100):'',description:p.description,features:p.features?.join(', ')||''});}} style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,color:'var(--stone-600)',cursor:'pointer',fontFamily:'inherit'})}><i className="fas fa-pen" style={{fontSize:9,marginRight:4}}></i>Edit</button>
                      <button onClick={async()=>{await fetch('/api/admin',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'toggle_plan',id:p.id,is_active:!p.is_active})});setRefreshAt(Date.now());}} style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,color:p.is_active?'var(--red)':'var(--emerald)',cursor:'pointer',fontFamily:'inherit'})}>{p.is_active?'Deactivate':'Activate'}</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ COUNSELORS ═══ */}
          {tab === 'counselors' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Search + add button */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'})}>
                <div style={ss({position:'relative',flex:1,minWidth:200})}>
                  <i className="fas fa-search" style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--stone-300)',fontSize:11,pointerEvents:'none'}}></i>
                  <input placeholder="Search by name, email, specialty…" value={counselorSearchText} onChange={e=>setCounselorSearchText(e.target.value)} style={{...inputA,width:'100%',paddingLeft:32}} />
                </div>
              </div>

              {/* Pending counselor applications */}
              {pendingCounselors.length > 0 && (
                <div style={ss({background:'#fefce8',border:'1px solid #fde68a',borderRadius:'var(--radius)',padding:'16px 20px'})}>
                  <div style={ss({fontSize:13,fontWeight:800,color:'#92400e',marginBottom:12})}><i className="fas fa-user-plus" style={{marginRight:6}}></i>{pendingCounselors.length} Pending Application{pendingCounselors.length!==1?'s':''}</div>
                  {pendingCounselors.map((pc:any)=>(
                    <div key={pc.id} style={ss({display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid #fde68a'})}>
                      <div style={ss({flex:1})}>
                        <span style={ss({fontWeight:700,fontSize:13})}>{pc.display_name}</span>
                        <span style={ss({color:'var(--stone-500)',marginLeft:8,fontSize:12})}>{pc.email}</span>
                        {pc.application_note&&<div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:4})}>{pc.application_note}</div>}
                      </div>
                      <button onClick={async()=>{await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve_counselor',user_id:pc.user_id})});setRefreshAt(Date.now());}} style={ss({padding:'6px 14px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Approve</button>
                      <button onClick={async()=>{await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject_counselor',user_id:pc.user_id})});setRefreshAt(Date.now());}} style={ss({padding:'6px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--red)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Reject</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Counselors Table */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <h3 style={ss({fontSize:14,fontWeight:900})}>All Counselors ({counselorsList.length})</h3>
                  <button onClick={()=>{
                    // Phase A: export the currently-filtered counselor rows.
                    const filtered = counselorsList.filter(c=>!counselorSearchText || [c.display_name,c.email,c.name,...(c.specialties||[])].some(v=>v?.toLowerCase().includes(counselorSearchText.toLowerCase())));
                    const cols: CsvColumn<typeof counselorsList[number]>[] = [
                      { header: 'ID', value: r => r.id },
                      { header: 'Display Name', value: r => r.display_name },
                      { header: 'Login Name', value: r => r.name },
                      { header: 'Email', value: r => r.email },
                      { header: 'Phone', value: r => (r as any).user_phone || (r as any).phone, preserveLeadingZero: true },
                      { header: 'Title', value: r => r.title },
                      { header: 'Specialties', value: r => (r.specialties||[]).join('; ') },
                      { header: 'Years Experience', value: r => r.years_experience },
                      { header: 'Status', value: r => r.counselor_status || 'active' },
                      { header: 'Hourly Rate USD', value: r => ((r.hourly_rate_cents||0)/100).toFixed(2) },
                      { header: 'Active Assignments', value: r => (r as any).active_assignment_count || 0 },
                      { header: 'Total Earned USD', value: r => ((r.total_earned_cents||0)/100).toFixed(2) },
                      { header: 'Stripe Connected', value: r => (r as any).stripe_connect_account_id ? 'Y' : 'N' },
                      { header: 'Joined', value: r => (r as any).joined_at },
                    ];
                    downloadCsv('admitly_counselors', filtered, cols);
                  }} style={ss({display:'inline-flex',alignItems:'center',gap:6,padding:'7px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-700)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>
                    <i className="fas fa-file-export" style={{fontSize:10}}></i>Export CSV
                  </button>
                </div>
                <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                  <thead><tr style={{background:'var(--stone-50)'}}>
                    {['Name','Email','Phone','Login','Status','Joined','Rate','Payout','Active','Unpaid','Balance'].map(h=><th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {counselorsList
                      .filter(c=>!counselorSearchText || [c.display_name,c.email,c.name,...(c.specialties||[])].some(v=>v?.toLowerCase().includes(counselorSearchText.toLowerCase())))
                      .map(c=>{
                        const cAssigns = assignments.filter(a=>a.counselor_id===c.id);
                        const isExpanded = expandedCounselorId === c.id;
                        const eData = earningsData?.counselors?.find((ec:any)=>ec.id===c.id);
                        const owedCents = eData?.owed_cents || 0;
                        const completedUnpaid = cAssigns.filter(a=>a.status==='completed').length - (eData?.payouts?.length||0);
                        return (
                          <Fragment key={c.id}>
                          <tr onClick={()=>setExpandedCounselorId(isExpanded?null:c.id)} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:isExpanded?'#fefce8':'transparent'}}>
                            <td style={ss({...tdS,fontWeight:700})}>{c.display_name}</td>
                            <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)'})}>{c.email}</td>
                            <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)'})}>{(c as any).user_phone||(c as any).phone||'—'}</td>
                            <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)'})}>{(c as any).auth_provider === 'google' ? '🔵 Google' : '✉️ Email'}</td>
                            <td style={tdS} onClick={e=>e.stopPropagation()}>
                              <select value={c.counselor_status||'active'}
                                onChange={async e=>{const ns=e.target.value;await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_counselor_status',counselor_id:c.id,status:ns})});setCounselorsList(p=>p.map(cc=>cc.id===c.id?{...cc,counselor_status:ns}:cc));}}
                                style={ss({padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:700,border:'none',cursor:'pointer',
                                  background:(c.counselor_status||'active')==='active'?'var(--emerald-light)':(c.counselor_status)==='on_leave'?'var(--amber-light)':(c.counselor_status)==='suspended'?'var(--red-light)':'var(--stone-100)',
                                  color:(c.counselor_status||'active')==='active'?'#065f46':(c.counselor_status)==='on_leave'?'#92400e':(c.counselor_status)==='suspended'?'#991b1b':'var(--stone-500)'})}>
                                <option value="active">Active</option>
                                <option value="on_leave">On Leave</option>
                                <option value="suspended">Suspended</option>
                                <option value="inactive">Inactive</option>
                              </select>
                            </td>
                            <td style={ss({...tdS,fontSize:11,color:'var(--stone-400)'})}>{(c as any).joined_at?new Date((c as any).joined_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'—'}</td>
                            <td style={ss({...tdS,fontWeight:700})}>${((c.hourly_rate_cents||5000)/100).toFixed(0)}/hr</td>
                            <td style={tdS}>{(c as any).stripe_connect_account_id?<span style={ss({color:'#059669',fontWeight:700,fontSize:10})}><i className="fas fa-check-circle" style={{marginRight:3}}></i>Yes</span>:<span style={ss({color:'var(--stone-300)',fontSize:10})}>No</span>}</td>
                            <td style={ss({...tdS,textAlign:'center'})}><span style={ss({fontWeight:700,color:(c as any).active_assignment_count>0?'#059669':'var(--stone-300)'})}>{(c as any).active_assignment_count||0}</span></td>
                            <td style={ss({...tdS,textAlign:'center'})}><span style={ss({fontWeight:700,color:completedUnpaid>0?'#d97706':'var(--stone-300)'})}>{Math.max(0,completedUnpaid)}</span></td>
                            <td style={ss({...tdS,fontWeight:700,color:owedCents>0?'#d97706':'var(--stone-400)'})}>${(owedCents/100).toFixed(0)}</td>
                          </tr>
                          {isExpanded && (
                            <tr><td colSpan={10} style={{padding:0}}>
                              <div style={ss({padding:'16px 20px',background:'#fefce8',borderBottom:'2px solid #fde68a'})}>
                                {/* Detail tiles + specialties inline */}
                                <div style={ss({display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'flex-start'})}>
                                  <div style={ss({padding:'10px 14px',background:'var(--card)',borderRadius:10,border:'1px solid var(--border)',minWidth:120})} onClick={e=>e.stopPropagation()}>
                                    <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:4})}>Hourly Rate</div>
                                    <div style={ss({display:'flex',alignItems:'center',gap:4})}>
                                      <span style={ss({fontSize:14,fontWeight:800})}>$</span>
                                      <input defaultValue={String((c.hourly_rate_cents||5000)/100)}
                                        onBlur={async e=>{const v=Math.round(parseFloat(e.target.value)*100)||5000;setCounselorsList(p=>p.map(cc=>cc.id===c.id?{...cc,hourly_rate_cents:v}:cc));await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'set_hourly_rate',counselor_id:c.id,rate_cents:v})});}}
                                        onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();}}
                                        style={{...inputA,width:60,fontSize:14,fontWeight:800,textAlign:'center'}} />
                                      <span style={ss({fontSize:11,color:'var(--stone-400)'})}>/hr</span>
                                    </div>
                                  </div>
                                  <div style={ss({padding:'10px 14px',background:'var(--card)',borderRadius:10,border:'1px solid var(--border)',minWidth:120})}>
                                    <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:4})}>Payout Method</div>
                                    <div style={ss({fontSize:14,fontWeight:700})}>{(c as any).stripe_connect_account_id?'Stripe Connect':'Not configured'}</div>
                                  </div>
                                  <div style={ss({padding:'10px 14px',background:'var(--card)',borderRadius:10,border:'1px solid var(--border)',minWidth:120})}>
                                    <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:4})}>Total Earnings</div>
                                    <div style={ss({fontSize:14,fontWeight:700})}>${((eData?.earned_cents||0)/100).toFixed(0)}</div>
                                  </div>
                                  <div style={ss({padding:'10px 14px',background:'var(--card)',borderRadius:10,border:'1px solid var(--border)',minWidth:120})}>
                                    <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:4})}>Experience</div>
                                    <div style={ss({fontSize:14,fontWeight:700})}>{c.years_experience||0} yrs</div>
                                  </div>
                                  {/* Specialties as tile */}
                                  {c.specialties&&c.specialties.length>0&&(
                                    <div style={ss({padding:'10px 14px',background:'var(--card)',borderRadius:10,border:'1px solid var(--border)',minWidth:160,flex:1})}>
                                      <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:6})}>Specialties</div>
                                      <div style={ss({display:'flex',gap:4,flexWrap:'wrap'})}>
                                        {c.specialties.map((s:string,i:number)=><span key={i} style={ss({padding:'3px 10px',borderRadius:20,fontSize:10,fontWeight:700,background:'var(--stone-100)',color:'var(--stone-600)'})}>{s}</span>)}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {/* Bio */}
                                {(c as any).bio&&<div style={ss({marginBottom:14,padding:'10px 14px',background:'var(--card)',borderRadius:10,border:'1px solid var(--border)'})}>
                                  <div style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:4})}>Bio</div>
                                  <div style={ss({fontSize:12,color:'var(--stone-600)',lineHeight:1.5})}>{(c as any).bio}</div>
                                </div>}
                                {/* Assignments table with payout info */}
                                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:6})}>Assignments ({cAssigns.length} total)</div>
                                {cAssigns.length>0?(
                                  <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:11,background:'var(--card)',borderRadius:8,overflow:'hidden'})}>
                                    <thead><tr style={{background:'var(--stone-50)'}}>
                                      {['Student','Plan','Sessions','Status','Start','End','Payout','Paid Date','Payment ID'].map(h=><th key={h} style={{...thS,fontSize:9,padding:'6px 10px'}}>{h}</th>)}
                                    </tr></thead>
                                    <tbody>
                                      {cAssigns.map(a=>{
                                        const payout = (eData?.payouts||[]).find((p:any)=>p.assignment_id===a.id && p.status==='paid');
                                        return (
                                          <tr key={a.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                                            <td style={ss({padding:'6px 10px',fontWeight:600})}>{a.student_name}</td>
                                            <td style={ss({padding:'6px 10px'})}>{a.plan}</td>
                                            <td style={ss({padding:'6px 10px',fontWeight:700})}>{a.sessions_used}/{a.sessions_total}</td>
                                            <td style={ss({padding:'6px 10px'})}><span style={ss({fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20,background:a.status==='active'?'rgba(16,185,129,.12)':a.status==='completed'?'#eff6ff':a.status==='cancelled'?'#fef2f2':'var(--stone-100)',color:a.status==='active'?'var(--emerald)':a.status==='completed'?'#2563eb':a.status==='cancelled'?'var(--red)':'var(--stone-400)'})}>{a.status}</span></td>
                                            <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-400)'})}>{a.start_date?new Date(a.start_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'}</td>
                                            <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-400)'})}>{a.end_date?new Date(a.end_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'}</td>
                                            <td style={ss({padding:'6px 10px',fontWeight:700,color:payout?'#059669':'var(--stone-300)'})}>{payout?`$${(payout.amount_cents/100).toFixed(0)}`:'—'}</td>
                                            <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-400)'})}>{payout?.paid_at?new Date(payout.paid_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'—'}</td>
                                            <td style={ss({padding:'6px 10px',fontSize:9,fontFamily:'monospace',color:payout?.stripe_transfer_id?'#2563eb':'var(--stone-400)'})}>{payout?.stripe_transfer_id||( payout?'Offline':'—')}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                ):<div style={ss({padding:'10px',fontSize:11,color:'var(--stone-400)',textAlign:'center'})}>No assignments</div>}
                              </div>
                            </td></tr>
                          )}
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ASSIGNMENTS ═══ */}
          {tab === 'assignments' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>

              {/* Top bar: New Assignment + Export */}
              <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                <div></div>
                <div style={ss({display:'flex',gap:8})}>
                  <button onClick={()=>{
                    // Phase A: export real (non-pending) assignment rows.
                    const cols: CsvColumn<typeof assignments[number]>[] = [
                      { header: 'ID', value: r => r.id },
                      { header: 'Student', value: r => r.student_name },
                      { header: 'Student Email', value: r => r.student_email },
                      { header: 'Counselor', value: r => r.counselor_name },
                      { header: 'Counselor Email', value: r => r.counselor_email },
                      { header: 'Plan', value: r => r.plan },
                      { header: 'Sessions Used', value: r => r.sessions_used },
                      { header: 'Sessions Total', value: r => r.sessions_total },
                      { header: 'Status', value: r => r.status },
                      { header: 'Start Date', value: r => r.start_date },
                      { header: 'End Date', value: r => r.end_date },
                      { header: 'Created At', value: r => r.created_at },
                      { header: 'Accepted At', value: r => r.accepted_at },
                      { header: 'Declined Reason', value: r => r.declined_reason },
                    ];
                    downloadCsv('admitly_assignments', assignments, cols);
                  }} style={ss({padding:'8px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-700)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6})}>
                    <i className="fas fa-file-export" style={{fontSize:10}}></i>Export CSV
                  </button>
                  <button onClick={()=>setShowNewAssignModal(true)} style={ss({padding:'8px 18px',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6})}>
                    <i className="fas fa-plus" style={{fontSize:9}}></i>New Assignment
                  </button>
                </div>
              </div>

              {/* ── Assignments Table ── */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:30,height:30,borderRadius:8,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:11})}><i className="fas fa-list-check"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>All Assignments</h3>
                  </div>
                  <input value={assignSearch} onChange={e=>setAssignSearch(e.target.value)} placeholder="Search..." style={{...inputA,width:180}} />
                </div>
                {/* Filters */}
                <div style={ss({padding:'8px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',background:'var(--stone-50)'})}>
                  <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase'})}>Filters</span>
                  <select value={assignStatusFilter} onChange={e=>setAssignStatusFilter(e.target.value)} style={{...inputA,fontSize:11,padding:'5px 8px',width:140}}>
                    <option value="all">All Status</option>
                    <option value="pending_payment">Pending Payment</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="pending_acceptance">Pending Acceptance</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="paused">Paused</option>
                  </select>
                  <select value={assignPlanFilter} onChange={e=>setAssignPlanFilter(e.target.value)} style={{...inputA,fontSize:11,padding:'5px 8px',width:140}}>
                    <option value="all">All Plans</option>
                    {Array.from(new Set(assignments.map(a=>a.plan))).sort().map(p=><option key={p} value={p}>{p}</option>)}
                  </select>
                  <input type="date" value={assignDateFrom} onChange={e=>setAssignDateFrom(e.target.value)} style={{...inputA,fontSize:11,padding:'5px 8px',width:130}} />
                  <span style={ss({fontSize:10,color:'var(--stone-300)'})}>to</span>
                  <input type="date" value={assignDateTo} onChange={e=>setAssignDateTo(e.target.value)} style={{...inputA,fontSize:11,padding:'5px 8px',width:130}} />
                  {(assignStatusFilter!=='all'||assignPlanFilter!=='all'||assignDateFrom||assignDateTo)&&(
                    <button onClick={()=>{setAssignStatusFilter('all');setAssignPlanFilter('all');setAssignDateFrom('');setAssignDateTo('');}} style={ss({padding:'4px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)'})}><i className="fas fa-times" style={{fontSize:8}}></i></button>
                  )}
                </div>
                {(()=>{
                  const pendingStudents = students.filter(s => s.needs_assignment).map(s => {
                    const pmt = (paymentData?.payments||[]).find((p:any) => p.user_id === s.id && p.status === 'succeeded' && (p.plan_id?.startsWith('premium') || ['full cycle','essay only','starter'].includes((p.plan_name||'').toLowerCase())));
                    // Resolve plan name: use plan_name from payment, fallback to matching ep_plan by plan_id
                    let planLabel = pmt?.plan_name || '';
                    if ((!planLabel || planLabel.toLowerCase() === 'premium' || planLabel.toLowerCase() === 'unknown') && pmt?.plan_id) {
                      const dbId = pmt.plan_id.replace('premium_','');
                      const match = plans.find(p=>String(p.id)===dbId);
                      if (match) planLabel = match.name;
                    }
                    if (!planLabel || planLabel.toLowerCase() === 'unknown') planLabel = 'Premium';
                    return { id: -s.id, student_id: s.id, student_name: s.name, student_email: s.email, counselor_name: '', counselor_id: 0, plan: planLabel, sessions_used: 0, sessions_total: 0, start_date: null, end_date: null, status: 'pending_payment', created_at: pmt?.created_at || '', _payment: pmt, _isPending: true };
                  });
                  const allRows = [...pendingStudents, ...assignments] as any[];
                  const filtered = allRows.filter((a:any)=>{
                    if(assignSearch&&![a.student_name,a.counselor_name,a.student_email].some((v:any)=>v?.toLowerCase().includes(assignSearch.toLowerCase()))) return false;
                    if(assignStatusFilter!=='all'&&a.status!==assignStatusFilter) return false;
                    if(assignPlanFilter!=='all'&&a.plan!==assignPlanFilter) return false;
                    if(!a._isPending){if(assignDateFrom&&a.end_date&&new Date(a.end_date)<new Date(assignDateFrom)) return false;if(assignDateTo&&a.end_date&&new Date(a.end_date)>new Date(assignDateTo+'T23:59:59')) return false;}
                    return true;
                  });
                  if(filtered.length===0) return <div style={ss({padding:'40px 20px',textAlign:'center',color:'var(--stone-400)'})}><i className="fas fa-link" style={{fontSize:24,display:'block',marginBottom:10,opacity:.3}}></i><div style={ss({fontSize:13,fontWeight:600})}>No assignments found</div></div>;

                  return (
                  <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                    <thead><tr style={{background:'var(--stone-50)',borderBottom:'1px solid var(--border-light)'}}>
                      {['Student','Counselor','Plan','Sessions','Dates','Status',''].map(h=><th key={h} style={thS}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {filtered.map((a:any) => {
                        const isPending = !!a._isPending;
                        const pct = a.sessions_total?(a.sessions_used/a.sessions_total)*100:0;
                        const atLimit = a.sessions_total>0&&a.sessions_used>=a.sessions_total;
                        const isExp = (isPending&&inlineAssignId===a.student_id) || (!isPending&&expandedId===a.id) || (cancelledAssignStudentId===a.student_id);
                        const isReject = actionRejecting===(isPending?a.student_id:a.student_id) && cancelledAssignStudentId===a.student_id;
                        const pmt = isPending ? a._payment : (paymentData?.payments||[]).find((p:any)=>p.user_id===a.student_id&&p.status==='succeeded'&&(p.plan_id?.startsWith('premium')||['full cycle','essay only','starter'].includes((p.plan_name||'').toLowerCase())));
                        const amtStr = pmt?.amount_cents ? `$${(pmt.amount_cents/100).toFixed(0)}` : '';
                        return (
                          <Fragment key={a.id}>
                          <tr onClick={()=>{
                            if(cancelledAssignStudentId) return;
                            if(isPending){setInlineAssignId(inlineAssignId===a.student_id?null:a.student_id);setExpandedId(null);setInlineAssignCounselorSearch('');setInlineAssignCounselorId('');setInlineAssignPlanId('');setInlineAssignStartDate(new Date().toISOString().split('T')[0]);setInlineAssignEndDate('');}
                            else{const wasExp=expandedId===a.id;setExpandedId(wasExp?null:a.id);setInlineAssignId(null);setEditingAssignment(wasExp?null:{...a,new_status:a.status,new_counselor_id:String(a.counselor_id),new_plan_id:'',new_start_date:a.start_date||'',new_end_date:a.end_date||'',new_sessions_used:a.sessions_used});setInlineAssignCounselorSearch('');setInlineAssignCounselorId(String(a.counselor_id));setInlineAssignAvailableOnly(false);}
                          }} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:cancelledAssignStudentId===a.student_id?'#fef2f2':(isPending?'#fef3c7':(isExp?'#fefce8':'transparent')),borderLeft:isPending?'3px solid #d97706':(cancelledAssignStudentId===a.student_id?'3px solid var(--red)':'none')}}>
                            <td style={tdS}><div style={ss({fontWeight:700})}>{a.student_name}</div><div style={ss({fontSize:10,color:'var(--stone-400)'})}>{a.student_email}</div></td>
                            <td style={ss({...tdS,fontWeight:600,color:isPending?'var(--stone-300)':'var(--stone-700)'})}>{isPending?'--':a.counselor_name}</td>
                            <td style={tdS}><span style={ss({fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:isPending?'#fffbeb':'var(--stone-50)',color:isPending?'#92400e':'var(--stone-600)',border:'1px solid '+(isPending?'#fde68a':'var(--border)')})}>{a.plan}</span></td>
                            <td style={tdS}>{isPending?<span style={ss({color:'var(--stone-300)',fontSize:10})}>--</span>:(
                              <div style={ss({display:'flex',alignItems:'center',gap:6})}>
                                <div style={ss({width:50,height:5,background:'var(--stone-200)',borderRadius:10,overflow:'hidden'})}><div style={ss({height:'100%',width:`${pct}%`,background:atLimit?'var(--red)':'var(--emerald)',borderRadius:10})}/></div>
                                <span style={ss({fontSize:11,fontWeight:700,color:atLimit?'var(--red)':'var(--stone-700)'})}>{a.sessions_used}/{a.sessions_total}</span>
                              </div>
                            )}</td>
                            <td style={ss({...tdS,fontSize:10,color:'var(--stone-500)'})}>{isPending?(pmt?.created_at?`Paid ${fmtDate(pmt.created_at)}`:'--'):(a.start_date?fmtDate(a.start_date):'--')+(a.end_date?` - ${fmtDate(a.end_date)}`:'')} </td>
                            <td style={tdS}><span style={ss({fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:20,
                              background:a.status==='pending_payment'?'#fef3c7':(a.status==='active'?'rgba(16,185,129,.12)':a.status==='completed'?'#eff6ff':a.status==='cancelled'?'#fef2f2':'var(--stone-100)'),
                              color:a.status==='pending_payment'?'#92400e':(a.status==='active'?'var(--emerald)':a.status==='completed'?'#2563eb':a.status==='cancelled'?'var(--red)':'var(--stone-400)')
                            })}>{a.status==='pending_payment'?'Pending Payment':a.status}</span></td>
                            <td style={tdS} onClick={e=>e.stopPropagation()}>
                              <div style={ss({display:'flex',flexDirection:'column',gap:3,alignItems:'flex-end'})}>
                                {isPending&&<button onClick={()=>{
                                  const fn=(a.student_name||'').split(' ')[0];
                                  setActionRejecting(a.student_id);setInlineAssignId(null);setExpandedId(null);setCancelledAssignStudentId(a.student_id);
                                  setActionRejectReason(`Dear ${fn},\n\nThank you for your interest in our Expert Session program. Unfortunately, all counselor slots are currently fully booked and we are unable to accommodate new sessions at this time.\n\nWe have initiated a full refund of ${amtStr} to your original payment method. Please allow 5-10 business days for the refund to appear on your statement.\n\nWe sincerely apologize for the inconvenience. Should a slot become available, we will reach out to you directly.\n\nWarm regards,\nThe Admitly Team`);
                                }} style={ss({padding:'3px 8px',borderRadius:6,border:'1px solid #fecaca',background:'var(--card)',color:'var(--red)',cursor:'pointer',fontSize:9,fontWeight:700,fontFamily:'inherit'})}>Reject {amtStr}</button>}
                                {(pmt?.stripe_payment_intent_id||pmt?.stripe_session_id)?<a href={`https://dashboard.stripe.com/payments/${pmt.stripe_payment_intent_id||pmt.stripe_session_id}`} target="_blank" rel="noopener noreferrer" style={ss({fontSize:8,fontFamily:'monospace',color:'#2563eb',textDecoration:'none'})} title={pmt.stripe_payment_intent_id||pmt.stripe_session_id}>{(pmt.stripe_payment_intent_id||pmt.stripe_session_id||'').slice(0,20)}...</a>:null}
                              </div>
                            </td>
                          </tr>
                          {/* ── Unified expanded row ── */}
                          {isExp&&!isReject&&(cancelledAssignStudentId!==a.student_id)&&(
                            <tr><td colSpan={7} style={{padding:0}}>
                              <div style={ss({padding:'12px 20px',background:'#fefce8',borderBottom:'2px solid #fde68a'})}>
                                {/* Row 1: Search, Filter, Status, Sessions, Plan, Stripe, Amount, Start, End */}
                                <div style={ss({display:'flex',gap:6,marginBottom:10,alignItems:'center',flexWrap:'wrap'})}>
                                  <div style={ss({position:'relative',width:192})}>
                                    <i className="fas fa-search" style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',fontSize:9,color:'var(--stone-300)'}}></i>
                                    <input value={inlineAssignCounselorSearch} onChange={e=>setInlineAssignCounselorSearch(e.target.value)} placeholder="Search counselor..." style={{...inputA,width:'100%',paddingLeft:26,fontSize:11}} />
                                  </div>
                                  <button onClick={()=>setInlineAssignAvailableOnly(!inlineAssignAvailableOnly)} title={inlineAssignAvailableOnly?'Available only':'All'} style={ss({width:24,height:24,borderRadius:6,border:inlineAssignAvailableOnly?'2px solid var(--emerald)':'1px solid var(--border)',background:inlineAssignAvailableOnly?'rgba(16,185,129,.08)':'var(--card)',color:inlineAssignAvailableOnly?'var(--emerald)':'var(--stone-400)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,flexShrink:0})}><i className="fas fa-filter"></i></button>
                                  {!isPending&&editingAssignment&&<>
                                    <select value={editingAssignment.new_status} onChange={e=>setEditingAssignment((p:any)=>({...p,new_status:e.target.value}))} style={{...inputA,fontSize:11,padding:'4px 6px',width:120}}>
                                      {['active','pending_acceptance','completed','cancelled','paused','declined'].map(s=><option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <div style={ss({display:'flex',alignItems:'center',gap:3})}>
                                      <input type="number" min={0} max={a.sessions_total} value={editingAssignment.new_sessions_used} onChange={e=>setEditingAssignment((p:any)=>({...p,new_sessions_used:Math.min(parseInt(e.target.value)||0,a.sessions_total)}))} style={{...inputA,width:48,textAlign:'center',fontWeight:800,fontSize:11}} />
                                      <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)'})}>/{a.sessions_total}</span>
                                    </div>
                                  </>}
                                  {isPending?<select value={inlineAssignPlanId} onChange={e=>setInlineAssignPlanId(e.target.value)} style={{...inputA,fontSize:11,padding:'4px 6px',width:140}}><option value="">Plan...</option>{plans.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.name} ({p.sessions})</option>)}</select>
                                  :<select value={editingAssignment?.new_plan_id||''} onChange={e=>setEditingAssignment((p:any)=>({...p,new_plan_id:e.target.value}))} style={{...inputA,fontSize:11,padding:'4px 6px',width:140}}><option value="">Current plan</option>{plans.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.name} ({p.sessions})</option>)}</select>}
                                  {pmt?.stripe_session_id&&<a href={`https://dashboard.stripe.com/payments/${pmt.stripe_payment_intent_id||pmt.stripe_session_id}`} target="_blank" rel="noopener noreferrer" style={ss({fontSize:8,fontFamily:'monospace',color:'#2563eb',textDecoration:'none',flexShrink:0})} title={pmt.stripe_session_id}>{(pmt.stripe_payment_intent_id||pmt.stripe_session_id||'').slice(0,16)}...</a>}
                                  {pmt?.amount_cents&&<span style={ss({fontSize:10,fontWeight:700,color:'#059669',flexShrink:0})}>${(pmt.amount_cents/100).toFixed(0)}</span>}
                                  <input type="date" value={isPending?inlineAssignStartDate:(editingAssignment?.new_start_date||'')} onChange={e=>{if(isPending)setInlineAssignStartDate(e.target.value);else setEditingAssignment((p:any)=>({...p,new_start_date:e.target.value}));}} style={{...inputA,fontSize:11,padding:'4px 6px',width:115}} title="Start" />
                                  <input type="date" value={isPending?inlineAssignEndDate:(editingAssignment?.new_end_date||'')} onChange={e=>{if(isPending)setInlineAssignEndDate(e.target.value);else setEditingAssignment((p:any)=>({...p,new_end_date:e.target.value}));}} style={{...inputA,fontSize:11,padding:'4px 6px',width:115}} title="End" />
                                </div>
                                {/* Counselor table */}
                                <div style={ss({border:'1px solid var(--border)',borderRadius:8,overflow:'hidden',marginBottom:10})}>
                                  <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:11,background:'var(--card)'})}>
                                    <thead><tr style={{background:'var(--stone-50)'}}>
                                      {['','Counselor','Status','Rate','Active','Exp','Specialties','Availability'].map(h=><th key={h} style={{...thS,fontSize:9,padding:'6px 10px'}}>{h}</th>)}
                                    </tr></thead>
                                    <tbody>
                                      {counselorsList.filter(c=>{
                                        if(inlineAssignAvailableOnly&&(c as any).counselor_status!=='active') return false;
                                        if(inlineAssignCounselorSearch){const q=inlineAssignCounselorSearch.toLowerCase();if(!(c.display_name||'').toLowerCase().includes(q)&&!(c.name||'').toLowerCase().includes(q)&&!(c.email||'').toLowerCase().includes(q)) return false;}
                                        return true;
                                      }).map(c=>{
                                        const sel=inlineAssignCounselorId===String(c.id);const ac=(c as any).active_assignment_count||0;
                                        return (
                                          <tr key={c.id} onClick={()=>setInlineAssignCounselorId(sel?'':String(c.id))} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:sel?'#fffbeb':'transparent'}}>
                                            <td style={ss({padding:'8px 10px',textAlign:'center',width:30})}><input type="radio" checked={sel} onChange={()=>setInlineAssignCounselorId(String(c.id))} style={{accentColor:'var(--emerald)',cursor:'pointer'}} /></td>
                                            <td style={ss({padding:'8px 10px'})}><div style={ss({fontWeight:700,fontSize:12})}>{c.display_name||c.name}</div><div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:1})}>{c.email}</div></td>
                                            <td style={ss({padding:'8px 10px'})}><span style={ss({padding:'2px 8px',borderRadius:4,fontSize:9,fontWeight:700,background:(c.counselor_status||'active')==='active'?'rgba(16,185,129,.12)':'#fef2f2',color:(c.counselor_status||'active')==='active'?'var(--emerald)':'var(--red)'})}>{(c.counselor_status||'active')==='active'?'Available':'Unavailable'}</span></td>
                                            <td style={ss({padding:'8px 10px',fontWeight:700})}>${((c.hourly_rate_cents||5000)/100).toFixed(0)}/hr</td>
                                            <td style={ss({padding:'8px 10px',fontWeight:700,textAlign:'center',color:ac>0?'#d97706':'var(--stone-300)'})}>{ac}</td>
                                            <td style={ss({padding:'8px 10px',color:'var(--stone-500)'})}>{c.years_experience||0}yr</td>
                                            <td style={ss({padding:'8px 10px'})}><div style={ss({display:'flex',gap:3,flexWrap:'wrap'})}>{(c.specialties||[]).slice(0,3).map((s:string,i:number)=><span key={i} style={ss({padding:'1px 6px',borderRadius:10,fontSize:8,fontWeight:700,background:'var(--stone-100)',color:'var(--stone-600)'})}>{s}</span>)}</div></td>
                                            <td style={ss({padding:'8px 10px',fontSize:10,color:'var(--stone-500)'})}><div>{(c as any).available_days||'Mon-Fri'}</div><div style={ss({color:'var(--stone-400)',marginTop:1})}>{(c as any).available_hours||'9AM-5PM'}</div></td>
                                          </tr>
                                        );
                                      })}
                                      {counselorsList.filter(c=>{if(inlineAssignAvailableOnly&&(c as any).counselor_status!=='active') return false;if(inlineAssignCounselorSearch){const q=inlineAssignCounselorSearch.toLowerCase();if(!(c.display_name||'').toLowerCase().includes(q)&&!(c.name||'').toLowerCase().includes(q)&&!(c.email||'').toLowerCase().includes(q)) return false;}return true;}).length===0&&<tr><td colSpan={8} style={ss({padding:'12px',textAlign:'center',fontSize:10,color:'var(--stone-400)'})}>No counselors found</td></tr>}
                                    </tbody>
                                  </table>
                                </div>
                                {/* Actions */}
                                <div style={ss({display:'flex',gap:8,justifyContent:'flex-end'})}>
                                  <button onClick={()=>{if(isPending)setInlineAssignId(null);else{setExpandedId(null);setEditingAssignment(null);}}} style={ss({padding:'5px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Cancel</button>
                                  {isPending ? (
                                    <button disabled={!inlineAssignCounselorId||!inlineAssignPlanId} onClick={async()=>{
                                      const selPlan=plans.find(p=>String(p.id)===inlineAssignPlanId);
                                      await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assign',counselor_id:parseInt(inlineAssignCounselorId),student_id:a.student_id,plan:selPlan?.name||'Starter',plan_id:parseInt(inlineAssignPlanId),sessions_total:selPlan?.sessions||1,start_date:inlineAssignStartDate,end_date:inlineAssignEndDate,force:true})});
                                      setInlineAssignId(null);setRefreshAt(Date.now());fetchData('students');
                                    }} style={ss({padding:'5px 14px',borderRadius:8,border:'none',background:inlineAssignCounselorId&&inlineAssignPlanId?'var(--stone-900)':'var(--stone-300)',color:'#fff',fontSize:11,fontWeight:800,cursor:inlineAssignCounselorId&&inlineAssignPlanId?'pointer':'not-allowed',fontFamily:'inherit'})}>Confirm Assignment</button>
                                  ) : (
                                    <button onClick={async()=>{
                                      const payload:any={action:'edit_assignment',assignment_id:a.id};
                                      if(editingAssignment.new_status!==a.status) payload.status=editingAssignment.new_status;
                                      if(inlineAssignCounselorId&&inlineAssignCounselorId!==String(a.counselor_id)) payload.counselor_id=parseInt(inlineAssignCounselorId);
                                      if(editingAssignment.new_plan_id) payload.plan_id=editingAssignment.new_plan_id;
                                      if(editingAssignment.new_start_date!==(a.start_date||'')) payload.start_date=editingAssignment.new_start_date;
                                      if(editingAssignment.new_end_date!==(a.end_date||'')) payload.end_date=editingAssignment.new_end_date;
                                      if(editingAssignment.new_sessions_used!==a.sessions_used) payload.sessions_used=editingAssignment.new_sessions_used;
                                      await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
                                      setEditingAssignment(null);setExpandedId(null);setRefreshAt(Date.now());
                                      // If status changed to cancelled, show reject panel
                                      if(editingAssignment.new_status==='cancelled'&&a.status!=='cancelled'){
                                        const fn=(a.student_name||'').split(' ')[0];
                                        setCancelledAssignStudentId(a.student_id);
                                        setActionRejecting(a.student_id);
                                        setActionRejectReason(`Dear ${fn},\n\nThank you for your interest in our Expert Session program. Unfortunately, all counselor slots are currently fully booked and we are unable to accommodate new sessions at this time.\n\nWe have initiated a full refund of ${amtStr} to your original payment method. Please allow 5-10 business days for the refund to appear on your statement.\n\nWe sincerely apologize for the inconvenience. Should a slot become available, we will reach out to you directly.\n\nWarm regards,\nThe Admitly Team`);
                                      }
                                    }} style={ss({padding:'5px 14px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:11,fontWeight:800,cursor:'pointer',fontFamily:'inherit'})}>Save</button>
                                  )}
                                </div>
                              </div>
                            </td></tr>
                          )}
                          {/* ── Reject/Refund panel (pending OR after cancel) ── */}
                          {(cancelledAssignStudentId===a.student_id || (isPending&&actionRejecting===a.student_id&&inlineAssignId!==a.student_id))&&(
                            <tr><td colSpan={7} style={{padding:0}}>
                              <div style={ss({padding:14,background:'var(--red-light)',borderBottom:'2px solid #fecaca'})}>
                                <div style={ss({fontSize:12,fontWeight:800,color:'var(--red)',marginBottom:8})}>Reject & refund {amtStr||'$--'} to {a.student_name}?</div>
                                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:4})}>Refund email to student</div>
                                <textarea value={actionRejectReason} onChange={e=>setActionRejectReason(e.target.value)} style={ss({width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #fecaca',fontSize:11,fontFamily:'inherit',resize:'vertical',minHeight:100,outline:'none',boxSizing:'border-box',lineHeight:1.6})} />
                                <div style={ss({display:'flex',gap:8,marginTop:8,justifyContent:'flex-end'})}>
                                  <button onClick={()=>{setActionRejecting(null);setCancelledAssignStudentId(null);}} style={ss({padding:'6px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Skip Refund</button>
                                  <button onClick={async()=>{
                                    await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'reject_premium',student_id:a.student_id||a.student_id,reason:actionRejectReason})});
                                    setStudents(prev=>prev.map(u=>u.id===(a.student_id)?{...u,subscription_status:'pro',has_expert_session:false,needs_assignment:false}:u));
                                    setActionRejecting(null);setCancelledAssignStudentId(null);setRefreshAt(Date.now());
                                  }} style={ss({padding:'6px 16px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',fontSize:11,fontWeight:800,cursor:'pointer',fontFamily:'inherit'})}>
                                    Refund {amtStr||'$--'} & Reject
                                  </button>
                                </div>
                              </div>
                            </td></tr>
                          )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                  );
                })()}
              </div>

              {/* ── New Assignment Modal ── */}
              {showNewAssignModal && (
                <div style={ss({position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'})} onClick={()=>setShowNewAssignModal(false)}>
                  <div style={ss({background:'var(--card)',borderRadius:16,width:'100%',maxWidth:600,maxHeight:'80vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,.2)'})} onClick={e=>e.stopPropagation()}>
                    <div style={ss({padding:'18px 24px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                      <h3 style={ss({fontSize:16,fontWeight:900})}>New Assignment</h3>
                      <button onClick={()=>setShowNewAssignModal(false)} style={ss({width:28,height:28,borderRadius:8,border:'none',background:'var(--stone-100)',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)'})}><i className="fas fa-times"></i></button>
                    </div>
                    <div style={ss({padding:'16px 24px',display:'flex',flexDirection:'column',gap:14})}>
                      <div style={ss({display:'flex',gap:12,flexWrap:'wrap'})}>
                        <div style={ss({flex:1,minWidth:220,position:'relative'})}>
                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Counselor</label>
                          <div style={ss({display:'flex',alignItems:'center',gap:6,border:'1px solid var(--border)',borderRadius:10,background:'var(--stone-50)',paddingRight:8})}>
                            <input value={assignForm.counselor_id?(counselorsList.find(c=>String(c.id)===assignForm.counselor_id)?.display_name??counselorSearch):counselorSearch} onChange={e=>{setCounselorSearch(e.target.value);if(assignForm.counselor_id)setAssignForm(p=>({...p,counselor_id:''}));}} onFocus={()=>setCounselorDropdownOpen(true)} onBlur={()=>setTimeout(()=>setCounselorDropdownOpen(false),200)} placeholder="Search counselor..." style={ss({...inputA,flex:1,border:'none',background:'transparent'})} />
                            {assignForm.counselor_id&&<button onClick={()=>{setAssignForm(p=>({...p,counselor_id:''}));setCounselorSearch('');setCounselorDropdownOpen(true);}} style={ss({width:20,height:20,borderRadius:4,border:'none',background:'var(--stone-200)',color:'var(--stone-600)',cursor:'pointer',fontSize:10,display:'flex',alignItems:'center',justifyContent:'center'})}>x</button>}
                          </div>
                          {counselorDropdownOpen&&<div style={ss({position:'absolute',left:0,right:0,top:'100%',marginTop:2,border:'1px solid var(--border)',borderRadius:10,maxHeight:180,overflowY:'auto',background:'var(--card)',boxShadow:'0 8px 24px rgba(0,0,0,.1)',zIndex:50})}>
                            {counselorsList.filter(c=>[c.display_name,c.email].some(v=>v?.toLowerCase().includes(counselorSearch.toLowerCase()))).map(c=>(
                              <div key={c.id} onMouseDown={e=>{e.preventDefault();setAssignForm(p=>({...p,counselor_id:String(c.id)}));setCounselorSearch(c.display_name);setCounselorDropdownOpen(false);}} style={ss({padding:'8px 14px',cursor:'pointer',borderBottom:'1px solid var(--border-light)',fontSize:12})} onMouseEnter={e=>(e.currentTarget.style.background='var(--stone-50)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                                <span style={ss({fontWeight:700})}>{c.display_name}</span> <span style={ss({color:'var(--stone-400)',fontSize:11})}>{c.email}</span>
                              </div>
                            ))}
                          </div>}
                        </div>
                        <div style={ss({flex:1,minWidth:220,position:'relative'})}>
                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Student</label>
                          <div style={ss({display:'flex',alignItems:'center',gap:6,border:'1px solid var(--border)',borderRadius:10,background:'var(--stone-50)',paddingRight:8})}>
                            <input value={assignForm.student_id?(assignUsers.find(u=>u.role==='student'&&String(u.id)===assignForm.student_id)?.name??studentSearch):studentSearch} onChange={e=>{setStudentSearch(e.target.value);if(assignForm.student_id)setAssignForm(p=>({...p,student_id:''}));}} onFocus={()=>setStudentDropdownOpen(true)} onBlur={()=>setTimeout(()=>setStudentDropdownOpen(false),200)} placeholder="Search student..." style={ss({...inputA,flex:1,border:'none',background:'transparent'})} />
                            {assignForm.student_id&&<button onClick={()=>{setAssignForm(p=>({...p,student_id:''}));setStudentSearch('');setStudentDropdownOpen(true);}} style={ss({width:20,height:20,borderRadius:4,border:'none',background:'var(--stone-200)',color:'var(--stone-600)',cursor:'pointer',fontSize:10,display:'flex',alignItems:'center',justifyContent:'center'})}>x</button>}
                          </div>
                          {studentDropdownOpen&&<div style={ss({position:'absolute',left:0,right:0,top:'100%',marginTop:2,border:'1px solid var(--border)',borderRadius:10,maxHeight:180,overflowY:'auto',background:'var(--card)',boxShadow:'0 8px 24px rgba(0,0,0,.1)',zIndex:50})}>
                            {assignUsers.filter(u=>u.role==='student').filter(u=>[u.name,u.email].some(v=>v?.toLowerCase().includes(studentSearch.toLowerCase()))).map(u=>(
                              <div key={u.id} onMouseDown={e=>{e.preventDefault();setAssignForm(p=>({...p,student_id:String(u.id)}));setStudentSearch(u.name);setStudentDropdownOpen(false);}} style={ss({padding:'8px 14px',cursor:'pointer',borderBottom:'1px solid var(--border-light)',fontSize:12})} onMouseEnter={e=>(e.currentTarget.style.background='var(--stone-50)')} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                                <span style={ss({fontWeight:700})}>{u.name}</span> <span style={ss({color:'var(--stone-400)',fontSize:11})}>{u.email}</span>
                              </div>
                            ))}
                          </div>}
                        </div>
                      </div>
                      <div style={ss({display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'})}>
                        <div style={ss({flex:1,minWidth:180})}>
                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Plan</label>
                          <select value={assignForm.plan_id} onChange={e=>setAssignForm(p=>({...p,plan_id:e.target.value}))} style={{...inputA,width:'100%'}}>
                            <option value="">Select plan...</option>
                            {plans.filter(p=>p.is_active).map(p=><option key={p.id} value={p.id}>{p.name} - {p.sessions} sessions - ${(p.price_cents/100).toFixed(0)}</option>)}
                          </select>
                        </div>
                        <div style={ss({width:140})}>
                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Start</label>
                          <input type="date" value={assignForm.start_date} onChange={e=>setAssignForm(p=>({...p,start_date:e.target.value}))} style={{...inputA,width:'100%'}} />
                        </div>
                        <div style={ss({width:140})}>
                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>End</label>
                          <input type="date" value={assignForm.end_date} onChange={e=>setAssignForm(p=>({...p,end_date:e.target.value}))} style={{...inputA,width:'100%'}} />
                        </div>
                      </div>
                    </div>
                    <div style={ss({padding:'14px 24px',borderTop:'1px solid var(--border-light)',display:'flex',justifyContent:'flex-end',gap:8})}>
                      <button onClick={()=>setShowNewAssignModal(false)} style={ss({padding:'8px 18px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Cancel</button>
                      <button disabled={!assignForm.counselor_id||!assignForm.plan_id||!assignForm.student_id} onClick={async()=>{
                        if(!assignForm.counselor_id||!assignForm.plan_id||!assignForm.student_id) return;
                        const plan=plans.find(p=>p.id===parseInt(assignForm.plan_id));
                        const res=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assign',counselor_id:parseInt(assignForm.counselor_id),student_id:parseInt(assignForm.student_id),plan_id:parseInt(assignForm.plan_id),plan:plan?.name||'Starter',sessions_total:plan?.sessions||1,start_date:assignForm.start_date||null,end_date:assignForm.end_date||null})});
                        const data=await res.json();
                        if(data.conflict){if(!confirm(`Student has active plan(s). Create new plan anyway?`))return;await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'assign',counselor_id:parseInt(assignForm.counselor_id),student_id:parseInt(assignForm.student_id),plan_id:parseInt(assignForm.plan_id),plan:plan?.name||'Starter',sessions_total:plan?.sessions||1,start_date:assignForm.start_date||null,end_date:assignForm.end_date||null,force:true})});}
                        setAssignForm({counselor_id:'',student_id:'',plan_id:'',start_date:new Date().toISOString().split('T')[0],end_date:''});setCounselorSearch('');setStudentSearch('');setShowNewAssignModal(false);setRefreshAt(Date.now());
                      }} style={ss({padding:'8px 24px',borderRadius:10,border:'none',background:assignForm.counselor_id&&assignForm.plan_id&&assignForm.student_id?'var(--stone-900)':'var(--stone-200)',color:assignForm.counselor_id&&assignForm.plan_id&&assignForm.student_id?'#fff':'var(--stone-400)',fontSize:12,fontWeight:700,cursor:assignForm.counselor_id&&assignForm.plan_id&&assignForm.student_id?'pointer':'default',fontFamily:'inherit'})}>Assign</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ═══ MESSAGES ═══ */}
          {tab === 'messages' && (()=>{
            const COLORS = ['#7c3aed','#0ea5e9','#f59e0b','#ec4899','#10b981','#6366f1','#d946ef','#14b8a6','#f97316','#8b5cf6'];
            const filteredThreads = adminThreads.filter(t => {
              if (adminMsgFilter === 'unread' && t.unread_count === 0) return false;
              if (adminMsgSearch && !t.display_name.toLowerCase().includes(adminMsgSearch.toLowerCase()) && !t.name.toLowerCase().includes(adminMsgSearch.toLowerCase())) return false;
              return true;
            });
            const activeT = adminThreads.find(t => t.counselor_user_id === activeAdminThread);
            const loadThread = async (cid: number) => {
              setActiveAdminThread(cid);
              try {
                const r = await fetch(`/api/admin?view=admin_thread_messages&counselor_user_id=${cid}`, { cache: 'no-store' });
                const d = await r.json();
                setAdminMessages(d.messages || []);
                setAdminThreads(prev => prev.map(t => t.counselor_user_id === cid ? { ...t, unread_count: 0 } : t));
              } catch { setAdminMessages([]); }
            };
            const sendAdminMsg = async () => {
              if (!adminNewMsg.trim() || !activeAdminThread) return;
              setAdminSending(true);
              try {
                const r = await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin_msg_send', counselor_user_id: activeAdminThread, message: adminNewMsg.trim() }) });
                const d = await r.json();
                if (d.id) { setAdminMessages(p => [...p, d]); setAdminNewMsg(''); setAdminThreads(prev => prev.map(t => t.counselor_user_id === activeAdminThread ? { ...t, last_message: adminNewMsg.trim(), last_sender: 'admin', last_message_at: new Date().toISOString(), total_messages: t.total_messages + 1 } : t)); }
              } catch {} finally { setAdminSending(false); }
            };
            const sendBroadcast = async () => {
              if (!broadcastMsg.trim() || broadcastIds.length === 0) return;
              // Phase A: broadcast to multiple counselors is destructive
              // (you cannot un-send a broadcast); gate it on type-PROD
              // confirmation when running against production.
              const performBroadcast = async () => {
                setBroadcastSending(true);
                try {
                  await fetch('/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'admin_msg_send', broadcast_ids: broadcastIds, message: broadcastMsg.trim() }) });
                  setBroadcastOpen(false); setBroadcastMsg(''); setBroadcastIds([]);
                  // Refresh threads
                  const r = await fetch('/api/admin?view=admin_threads', { cache: 'no-store' }); const d = await r.json(); setAdminThreads(d.threads || []);
                } catch {} finally { setBroadcastSending(false); }
              };
              requireProdConfirm({
                title: 'Confirm broadcast',
                body: `You're about to broadcast a message to ${broadcastIds.length} counselor${broadcastIds.length===1?'':'s'}. Type PROD to confirm.`,
                confirmLabel: `Send to ${broadcastIds.length}`,
                action: performBroadcast,
              });
            };
            return (
            <>
            <div style={ss({display:'flex',gap:0,background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden',height:'calc(100vh - 180px)',minHeight:500})}>
              {/* ── Conversation list ── */}
              <div style={ss({width:320,borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',flexShrink:0})}>
                <div style={ss({padding:'12px 14px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:8})}>
                  <div style={ss({fontSize:14,fontWeight:800,flex:1})}>Counselors</div>
                  <span style={ss({fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:10,background:'var(--stone-100)',color:'var(--stone-500)'})}>
                    {adminThreads.length}
                  </span>
                  <button onClick={()=>{setBroadcastOpen(true);setBroadcastIds(adminThreads.filter(t=>t.counselor_status==='active').map(t=>t.counselor_user_id));}}
                    style={ss({width:30,height:30,borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:11,transition:'all .12s'})}
                    title="Broadcast message"
                    onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--stone-900)';(e.currentTarget as HTMLElement).style.color='var(--yellow)';(e.currentTarget as HTMLElement).style.borderColor='var(--stone-900)';}}
                    onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='var(--card)';(e.currentTarget as HTMLElement).style.color='var(--stone-500)';(e.currentTarget as HTMLElement).style.borderColor='var(--border)';}}
                  ><i className="fas fa-bullhorn"></i></button>
                </div>
                <div style={ss({padding:'8px 12px',borderBottom:'1px solid var(--border-light)'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:'var(--stone-50)',borderRadius:8})}>
                    <i className="fas fa-magnifying-glass" style={{fontSize:10,color:'var(--stone-400)'}}></i>
                    <input value={adminMsgSearch} onChange={e=>setAdminMsgSearch(e.target.value)} placeholder="Search counselors…"
                      style={ss({flex:1,border:'none',outline:'none',fontFamily:'inherit',fontSize:11,fontWeight:600,background:'transparent',color:'var(--stone-900)'})} />
                  </div>
                </div>
                <div style={ss({padding:'6px 12px',display:'flex',gap:4,borderBottom:'1px solid var(--border-light)'})}>
                  {(['all','unread'] as const).map(f=>(
                    <button key={f} onClick={()=>setAdminMsgFilter(f)}
                      style={ss({padding:'3px 10px',borderRadius:6,fontSize:10,fontWeight:700,border:'none',cursor:'pointer',fontFamily:'inherit',
                        background:adminMsgFilter===f?'var(--stone-900)':'var(--stone-50)',color:adminMsgFilter===f?'#fff':'var(--stone-500)',transition:'all .12s'})}>
                      {f==='all'?'All':'Unread'}
                    </button>
                  ))}
                </div>
                <div style={ss({flex:1,overflowY:'auto'})}>
                  {filteredThreads.length===0 ? (
                    <div style={ss({padding:'50px 20px',textAlign:'center'})}>
                      <i className="fas fa-comments" style={{fontSize:24,color:'var(--stone-200)',display:'block',marginBottom:10}}></i>
                      <div style={ss({fontSize:13,fontWeight:700,color:'var(--stone-500)'})}>No conversations</div>
                      <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:4})}>Click a counselor to start messaging</div>
                    </div>
                  ) : filteredThreads.map((t,i)=>(
                    <button key={t.counselor_user_id} onClick={()=>loadThread(t.counselor_user_id)}
                      style={ss({width:'100%',padding:'12px 14px',border:'none',borderBottom:'1px solid var(--border-light)',fontFamily:'inherit',textAlign:'left',cursor:'pointer',
                        display:'flex',gap:10,background:activeAdminThread===t.counselor_user_id?'#fefce8':'transparent',transition:'background .1s',position:'relative'})}
                      onMouseEnter={e=>{if(activeAdminThread!==t.counselor_user_id)(e.currentTarget as HTMLElement).style.background='var(--stone-50)';}}
                      onMouseLeave={e=>{if(activeAdminThread!==t.counselor_user_id)(e.currentTarget as HTMLElement).style.background='transparent';}}
                    >
                      {t.unread_count>0&&<div style={ss({position:'absolute',left:4,top:'50%',transform:'translateY(-50%)',width:6,height:6,borderRadius:'50%',background:'var(--blue)'})}/>}
                      <div style={ss({width:38,height:38,borderRadius:10,background:COLORS[i%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:11,color:'#fff',flexShrink:0})}>
                        {t.display_name.split(' ').map((w: string)=>w[0]).join('').slice(0,2)}
                      </div>
                      <div style={ss({flex:1,minWidth:0})}>
                        <div style={ss({display:'flex',alignItems:'center',gap:6})}>
                          <span style={ss({fontSize:12,fontWeight:t.unread_count>0?800:700,color:'var(--stone-900)'})}>{t.display_name}</span>
                          {t.counselor_status==='active'?
                            <span style={ss({fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:4,background:'#ecfdf5',color:'#059669'})}>Active</span>:
                            <span style={ss({fontSize:8,fontWeight:700,padding:'1px 5px',borderRadius:4,background:'#fef3c7',color:'#92400e'})}>Pending</span>}
                          <span style={ss({marginLeft:'auto',fontSize:9,fontWeight:500,color:'var(--stone-400)',flexShrink:0})}>{t.last_message_at?fmtDateTime(t.last_message_at):''}</span>
                        </div>
                        <div style={ss({fontSize:11,color:t.unread_count>0?'var(--stone-700)':'var(--stone-400)',marginTop:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:t.unread_count>0?600:500})}>
                          {t.last_message||'No messages yet — click to start'}
                        </div>
                        <div style={ss({display:'flex',gap:4,marginTop:4})}>
                          <span style={ss({fontSize:9,fontWeight:600,padding:'1px 6px',borderRadius:4,background:'#ecfdf5',color:'#059669'})}>{t.active_students} student{t.active_students!==1?'s':''}</span>
                          {t.unread_count>0&&<span style={ss({fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:4,background:'#fef2f2',color:'#dc2626'})}>{t.unread_count} new</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              {/* ── Chat area ── */}
              <div style={ss({flex:1,display:'flex',flexDirection:'column',background:'var(--stone-50)'})}>
                {!activeAdminThread || !activeT ? (
                  <div style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center'})}>
                    <div style={ss({textAlign:'center'})}>
                      <i className="fas fa-comments" style={{fontSize:32,color:'var(--stone-200)',display:'block',marginBottom:14}}></i>
                      <div style={ss({fontSize:14,fontWeight:800,color:'var(--stone-700)'})}>Select a Counselor</div>
                      <div style={ss({fontSize:12,color:'var(--stone-400)',marginTop:4})}>Choose from the list to start messaging</div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Header */}
                    <div style={ss({padding:'12px 20px',background:'#fff',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',gap:10})}>
                      <div style={ss({width:34,height:34,borderRadius:10,background:COLORS[adminThreads.indexOf(activeT)%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:11,color:'#fff'})}>{activeT.display_name.split(' ').map((w: string)=>w[0]).join('').slice(0,2)}</div>
                      <div>
                        <div style={ss({fontSize:13,fontWeight:800})}>{activeT.display_name}</div>
                        <div style={ss({fontSize:10,color:'var(--stone-400)',fontWeight:500})}>{activeT.title||activeT.email} · {activeT.active_students} active student{activeT.active_students!==1?'s':''}</div>
                      </div>
                      <div style={ss({marginLeft:'auto',display:'flex',gap:4})}>
                        <button onClick={()=>setTab('counselors')} style={ss({width:30,height:30,borderRadius:8,border:'1px solid var(--border)',background:'#fff',cursor:'pointer',color:'var(--stone-500)',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center'})} title="View profile"><i className="fas fa-user"></i></button>
                        <button onClick={()=>setTab('assignments')} style={ss({width:30,height:30,borderRadius:8,border:'1px solid var(--border)',background:'#fff',cursor:'pointer',color:'var(--stone-500)',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center'})} title="View assignments"><i className="fas fa-link"></i></button>
                      </div>
                    </div>
                    {/* Counselor context bar */}
                    <div style={ss({padding:'8px 20px',background:'#fff',borderBottom:'1px solid var(--border)',display:'flex',gap:16,fontSize:10,flexWrap:'wrap'})}>
                      {(activeT.specialties||[]).slice(0,4).map((s: string,i: number)=>(<span key={i} style={ss({padding:'2px 8px',borderRadius:6,background:'#f5f3ff',color:'#7c3aed',fontWeight:600})}>{s}</span>))}
                    </div>
                    {/* Messages */}
                    <div style={ss({flex:1,overflowY:'auto',padding:'20px',display:'flex',flexDirection:'column',gap:10})}>
                      {adminMessages.length===0?(
                        <div style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center'})}>
                          <div style={ss({textAlign:'center',color:'var(--stone-400)'})}>
                            <i className="fas fa-message" style={{fontSize:28,color:'var(--stone-200)',display:'block',marginBottom:10}}></i>
                            <div style={ss({fontWeight:700,fontSize:13})}>No messages yet</div>
                            <div style={ss({fontSize:11,marginTop:4})}>Send the first message to {activeT.display_name}</div>
                          </div>
                        </div>
                      ):adminMessages.map(m=>(
                        <div key={m.id} style={ss({display:'flex',gap:8,flexDirection:m.sender_role==='admin'?'row-reverse':'row',maxWidth:'80%',alignSelf:m.sender_role==='admin'?'flex-end':'flex-start'})}>
                          {m.sender_role!=='admin'&&<div style={ss({width:28,height:28,borderRadius:8,background:COLORS[adminThreads.indexOf(activeT)%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:9,color:'#fff',flexShrink:0,alignSelf:'flex-end'})}>{activeT.display_name.split(' ').map((w: string)=>w[0]).join('').slice(0,2)}</div>}
                          <div>
                            <div style={ss({padding:'10px 14px',borderRadius:m.sender_role==='admin'?'14px 14px 4px 14px':'14px 14px 14px 4px',
                              background:m.sender_role==='admin'?'var(--stone-900)':'#fff',color:m.sender_role==='admin'?'#fff':'var(--stone-800)',
                              fontSize:13,fontWeight:500,lineHeight:1.55,border:m.sender_role==='admin'?'none':'1px solid var(--border)',whiteSpace:'pre-wrap'})}>
                              {m.body}
                            </div>
                            <div style={ss({fontSize:9,color:'var(--stone-300)',marginTop:3,textAlign:m.sender_role==='admin'?'right':'left',display:'flex',alignItems:'center',gap:4,justifyContent:m.sender_role==='admin'?'flex-end':'flex-start'})}>
                              {m.sender_role==='admin'&&m.is_read&&<i className="fas fa-check-double" style={{fontSize:8,color:'var(--blue)'}}></i>}
                              {fmtDateTime(m.created_at)}
                            </div>
                          </div>
                        </div>
                      ))}
                      <div ref={adminMsgEndRef}/>
                    </div>
                    {/* Compose */}
                    <div style={ss({padding:'12px 20px',background:'#fff',borderTop:'1px solid var(--border)',display:'flex',gap:8,alignItems:'flex-end'})}>
                      <textarea value={adminNewMsg} onChange={e=>setAdminNewMsg(e.target.value)} placeholder={`Message ${activeT.display_name}…`} rows={1}
                        onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendAdminMsg();}}}
                        onInput={e=>{const el=e.currentTarget;el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px';}}
                        style={ss({flex:1,padding:'10px 14px',border:'1px solid var(--border)',borderRadius:12,fontFamily:'inherit',fontSize:13,fontWeight:500,resize:'none',outline:'none',background:'var(--stone-50)',lineHeight:1.5,minHeight:42,maxHeight:120})} />
                      <button onClick={sendAdminMsg} disabled={adminSending||!adminNewMsg.trim()}
                        style={ss({width:42,height:42,borderRadius:10,border:'none',background:adminNewMsg.trim()?'var(--stone-900)':'var(--stone-200)',color:adminNewMsg.trim()?'var(--yellow)':'var(--stone-400)',cursor:adminNewMsg.trim()?'pointer':'default',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,transition:'all .12s'})}>
                        {adminSending?<i className="fas fa-spinner fa-spin" style={{fontSize:12}}></i>:<i className="fas fa-paper-plane"></i>}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            {/* ── Broadcast Modal ── */}
            {broadcastOpen&&(
              <div style={ss({position:'fixed',inset:0,zIndex:9999,background:'rgba(0,0,0,.4)',backdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',paddingTop:100})} onClick={()=>setBroadcastOpen(false)}>
                <div style={ss({background:'#fff',borderRadius:16,width:520,overflow:'hidden',border:'1px solid var(--border)',boxShadow:'0 25px 60px rgba(0,0,0,.15)'})} onClick={e=>e.stopPropagation()}>
                  <div style={ss({padding:'16px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',fontSize:14,fontWeight:800})}>
                    <i className="fas fa-bullhorn" style={{marginRight:8,color:'var(--stone-400)',fontSize:13}}></i>
                    Broadcast Message
                    <button onClick={()=>setBroadcastOpen(false)} style={ss({marginLeft:'auto',width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'#fff',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-400)',fontSize:11})}><i className="fas fa-xmark"></i></button>
                  </div>
                  <div style={ss({padding:'16px 20px'})}>
                    <div style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>Recipients</div>
                    <div style={ss({display:'flex',flexWrap:'wrap',gap:5,padding:'8px 12px',border:'1px solid var(--border)',borderRadius:10,background:'var(--stone-50)',marginBottom:16,minHeight:40,alignItems:'center'})}>
                      {broadcastIds.map(id=>{const t=adminThreads.find(x=>x.counselor_user_id===id);return t?(
                        <div key={id} style={ss({display:'flex',alignItems:'center',gap:4,padding:'3px 8px 3px 4px',borderRadius:6,background:'var(--stone-900)',color:'#fff',fontSize:10,fontWeight:600})}>
                          <div style={ss({width:18,height:18,borderRadius:4,background:COLORS[adminThreads.indexOf(t)%COLORS.length],display:'flex',alignItems:'center',justifyContent:'center',fontSize:7,fontWeight:800})}>{t.display_name.split(' ').map((w: string)=>w[0]).join('').slice(0,2)}</div>
                          {t.display_name}
                          <i className="fas fa-xmark" style={{fontSize:8,cursor:'pointer',opacity:.6,marginLeft:2}} onClick={()=>setBroadcastIds(p=>p.filter(x=>x!==id))}></i>
                        </div>
                      ):null;})}
                    </div>
                    <div style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>Message</div>
                    <textarea value={broadcastMsg} onChange={e=>setBroadcastMsg(e.target.value)} placeholder="Type your broadcast message…" rows={4}
                      style={ss({width:'100%',padding:'10px 14px',border:'1px solid var(--border)',borderRadius:10,fontFamily:'inherit',fontSize:13,fontWeight:500,outline:'none',resize:'vertical',background:'var(--stone-50)',color:'var(--stone-800)',lineHeight:1.5})} />
                  </div>
                  <div style={ss({padding:'12px 20px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',gap:8})}>
                    <button onClick={()=>setBroadcastIds(adminThreads.filter(t=>t.counselor_status==='active').map(t=>t.counselor_user_id))}
                      style={ss({fontSize:11,fontWeight:700,color:'var(--blue)',cursor:'pointer',padding:'4px 8px',borderRadius:6,border:'none',background:'transparent',fontFamily:'inherit'})}>
                      <i className="fas fa-users" style={{marginRight:4}}></i>Select all active
                    </button>
                    <button onClick={sendBroadcast} disabled={broadcastSending||!broadcastMsg.trim()||broadcastIds.length===0}
                      style={ss({marginLeft:'auto',padding:'8px 20px',borderRadius:10,border:'none',background:broadcastMsg.trim()&&broadcastIds.length?'var(--stone-900)':'var(--stone-200)',color:broadcastMsg.trim()&&broadcastIds.length?'var(--yellow)':'var(--stone-400)',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:broadcastMsg.trim()&&broadcastIds.length?'pointer':'default',display:'flex',alignItems:'center',gap:6})}>
                      {broadcastSending?<i className="fas fa-spinner fa-spin"></i>:<><i className="fas fa-paper-plane" style={{fontSize:10}}></i> Send to {broadcastIds.length} counselor{broadcastIds.length!==1?'s':''}</>}
                    </button>
                  </div>
                </div>
              </div>
            )}
            </>
          );})()}

          {/* ═══ EMAILS ═══ */}
          {tab === 'emails' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:20})}>
              {/* Compose Card */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--violet-light)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--violet)',fontSize:12})}><i className="fas fa-pen-to-square"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>Compose Email</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Send to individuals or groups</p></div>
                </div>
                <div style={ss({padding:'20px'})}>
                  {/* Send To */}
                  <div style={ss({marginBottom:16})}>
                    <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:8})}>Send To</div>
                    <div style={ss({display:'flex',gap:8,marginBottom:10})}>
                      {([{id:'individual' as const,label:'Individual',icon:'fa-user'},{id:'all_students' as const,label:'All Students',icon:'fa-users'},{id:'all_counselors' as const,label:'All Counselors',icon:'fa-chalkboard-user'}]).map(r=>(
                        <button key={r.id} onClick={()=>{setEmailRecipientType(r.id);if(r.id!=='individual'){setEmailTo('');setEmailRecipientSearch('');}}}
                          style={ss({padding:'8px 16px',borderRadius:10,border:emailRecipientType===r.id?'2px solid var(--stone-900)':'1px solid var(--border)',background:emailRecipientType===r.id?'var(--stone-900)':'var(--card)',color:emailRecipientType===r.id?'#fff':'var(--stone-600)',fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:6})}>
                          <i className={`fas ${r.icon}`} style={{fontSize:10}}></i>{r.label}
                        </button>
                      ))}
                    </div>
                    {/* Searchable Recipient Dropdown */}
                    {emailRecipientType==='individual' && (
                      <div style={ss({position:'relative'})}>
                        <div style={ss({display:'flex',alignItems:'center',gap:6,border:'1px solid var(--border)',borderRadius:10,background:'var(--stone-50)',paddingRight:8})}>
                          <i className="fas fa-search" style={{position:'absolute',left:12,color:'var(--stone-300)',fontSize:10,pointerEvents:'none'}}></i>
                          <input
                            value={emailTo || emailRecipientSearch}
                            onChange={e=>{setEmailRecipientSearch(e.target.value);setEmailTo('');}}
                            onFocus={()=>setEmailRecipientDropdown(true)}
                            onBlur={()=>setTimeout(()=>setEmailRecipientDropdown(false),200)}
                            placeholder="Search by name or email…"
                            style={ss({...inputA,flex:1,border:'none',background:'transparent',paddingLeft:32})}
                          />
                          {emailTo && (
                            <button type="button" onClick={()=>{setEmailTo('');setEmailRecipientSearch('');setEmailRecipientDropdown(true);}}
                              style={ss({width:24,height:24,borderRadius:6,border:'none',background:'var(--stone-200)',color:'var(--stone-600)',cursor:'pointer',fontSize:11,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>×</button>
                          )}
                        </div>
                        {emailRecipientDropdown && !emailTo && (
                          <div style={ss({position:'absolute',left:0,right:0,top:'100%',marginTop:2,border:'1px solid var(--border)',borderRadius:10,maxHeight:220,overflowY:'auto',background:'var(--card)',boxShadow:'0 8px 24px rgba(0,0,0,.1)',zIndex:50})}>
                            {students.filter(s=>[s.name,s.email].some(v=>v?.toLowerCase().includes(emailRecipientSearch.toLowerCase()))).slice(0,15).map(s=>(
                              <div key={s.id}
                                onMouseDown={e=>{e.preventDefault();setEmailTo(s.email);setEmailRecipientSearch('');setEmailRecipientDropdown(false);}}
                                style={ss({padding:'8px 14px',cursor:'pointer',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:8,fontSize:12})}
                                onMouseEnter={e=>(e.currentTarget.style.background='var(--stone-50)')}
                                onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                                <div style={ss({width:24,height:24,borderRadius:6,background:'var(--yellow)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:8,color:'#000',flexShrink:0})}>{s.name.split(' ').map(w=>w[0]).join('').slice(0,2)}</div>
                                <span style={ss({fontWeight:700,color:'var(--stone-800)'})}>{s.name}</span>
                                <span style={ss({color:'var(--stone-400)',fontSize:11,marginLeft:'auto'})}>{s.email}</span>
                              </div>
                            ))}
                            {students.filter(s=>[s.name,s.email].some(v=>v?.toLowerCase().includes(emailRecipientSearch.toLowerCase()))).length===0 && (
                              <div style={ss({padding:'12px 14px',fontSize:11,color:'var(--stone-400)',textAlign:'center'})}>No matches found</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {emailRecipientType!=='individual' && <div style={ss({padding:'10px 14px',background:'var(--stone-50)',borderRadius:10,fontSize:12,fontWeight:600,color:'var(--stone-500)',display:'flex',alignItems:'center',gap:8})}><i className="fas fa-info-circle" style={{fontSize:11,color:'var(--stone-400)'}}></i>This will send to {emailRecipientType==='all_students'?`all ${students.length} students`:'all counselors'}</div>}
                  </div>
                  <div style={ss({marginBottom:12})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Subject</label><input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} placeholder="Email subject line" style={{...inputA,width:'100%'}} /></div>
                  <div style={ss({marginBottom:16})}><label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',display:'block',marginBottom:4})}>Message</label><textarea value={emailBody} onChange={e=>setEmailBody(e.target.value)} placeholder="Write your email…" rows={8} style={ss({...inputA,width:'100%',resize:'vertical',lineHeight:1.6,minHeight:140})} /></div>
                  {emailSendError && (
                    <div style={ss({padding:'10px 14px',marginBottom:12,background:'var(--red-light)',border:'1px solid #fecaca',borderRadius:10,fontSize:12,fontWeight:600,color:'#991b1b',display:'flex',alignItems:'center',gap:8})}>
                      <i className="fas fa-circle-exclamation" style={{fontSize:11}}></i>{emailSendError}
                    </div>
                  )}
                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                    <div style={ss({fontSize:11,color:'var(--stone-400)',fontWeight:500})}>{emailBody.length>0&&<><i className="fas fa-text-width" style={{marginRight:4,fontSize:9}}></i>{emailBody.length} chars</>}</div>
                    <div style={ss({display:'flex',gap:8})}>
                      <button onClick={()=>{setEmailTo('');setEmailSubject('');setEmailBody('');setEmailRecipientSearch('');setEmailSendError(null);}} style={ss({padding:'9px 16px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer',color:'var(--stone-500)'})}>Clear</button>
                      <button onClick={()=>{
                          // Phase A: real send. Mass sends to all_students /
                          // all_counselors are wrapped in the type-PROD gate
                          // so a single fat-fingered click can't blast every
                          // user in production.
                          const performSend = async () => {
                            setEmailSendError(null);
                            setEmailSending(true);
                            try {
                              const res = await fetch('/api/admin/email', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  recipient_type: emailRecipientType,
                                  to: emailRecipientType === 'individual' ? emailTo : null,
                                  subject: emailSubject,
                                  body: emailBody,
                                }),
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                setEmailSendError(data.error || `Send failed (HTTP ${res.status})`);
                                return;
                              }
                              if ((data.failed ?? 0) > 0 && (data.sent ?? 0) === 0) {
                                setEmailSendError(`All ${data.failed} sends failed — check Postmark configuration`);
                                return;
                              }
                              setEmailSent(true);
                              // Refresh the audit list so the row appears immediately.
                              fetch('/api/admin/email?limit=25', { cache: 'no-store' })
                                .then(r => r.ok ? r.json() : { emails: [] })
                                .then(d => setAuditEmails(d.emails || []))
                                .catch(() => {});
                              setTimeout(() => {
                                setEmailSent(false);
                                setEmailTo('');
                                setEmailSubject('');
                                setEmailBody('');
                                setEmailRecipientSearch('');
                              }, 2000);
                            } catch (e: any) {
                              setEmailSendError(e?.message || 'Network error');
                            } finally {
                              setEmailSending(false);
                            }
                          };
                          if (emailRecipientType !== 'individual') {
                            const audience = emailRecipientType === 'all_students'
                              ? `all ${students.length} students`
                              : 'all counselors';
                            requireProdConfirm({
                              title: 'Confirm mass email',
                              body: `You're about to email ${audience}. This is a destructive, customer-visible action. Type PROD to confirm.`,
                              confirmLabel: 'Send to everyone',
                              action: performSend,
                            });
                          } else {
                            void performSend();
                          }
                      }} disabled={emailSending||!emailSubject.trim()||!emailBody.trim()||(emailRecipientType==='individual'&&!emailTo.trim())}
                        style={ss({padding:'9px 24px',borderRadius:10,border:'none',background:emailSent?'var(--emerald)':'var(--stone-900)',color:'#fff',fontFamily:'inherit',fontSize:12,fontWeight:800,cursor:'pointer',display:'flex',alignItems:'center',gap:6,opacity:(emailSending||!emailSubject.trim()||!emailBody.trim())?0.5:1})}>
                        {emailSent?<><i className="fas fa-check"></i>Sent!</>:emailSending?<><i className="fas fa-spinner fa-spin"></i>Sending…</>:<><i className="fas fa-paper-plane" style={{fontSize:10}}></i>Send Email</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Phase A: Recent Sends — audit log of every send through the
                  admin composer. Pulled from sent_emails on tab open and
                  refreshed after each successful send. */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-clock-rotate-left"></i></div>
                  <div style={ss({flex:1})}>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Recent Sends</h3>
                    <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Last 25 emails sent through this composer</p>
                  </div>
                  <button onClick={()=>{
                    fetch('/api/admin/email?limit=25', { cache: 'no-store' })
                      .then(r => r.ok ? r.json() : { emails: [] })
                      .then(d => setAuditEmails(d.emails || []))
                      .catch(() => {});
                  }} style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)',display:'flex',alignItems:'center',gap:5})}>
                    <i className="fas fa-rotate" style={{fontSize:9}}></i>Refresh
                  </button>
                </div>
                {auditEmails.length === 0 ? (
                  <div style={ss({padding:'24px 20px',textAlign:'center',fontSize:12,color:'var(--stone-400)'})}>
                    No sends yet. Use the composer above to send your first email.
                  </div>
                ) : (
                  <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                    <thead><tr style={{background:'var(--stone-50)'}}>
                      {['When','Recipient','Type','Subject','Status'].map(h=><th key={h} style={thS}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {auditEmails.map(row => (
                        <tr key={row.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                          <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)',whiteSpace:'nowrap'})}>{fmtDateTime(row.sent_at)}</td>
                          <td style={ss({...tdS,fontWeight:600})}>{row.recipient_email}</td>
                          <td style={ss({...tdS,fontSize:10})}>
                            <span style={ss({padding:'2px 8px',borderRadius:6,fontWeight:700,background:'var(--stone-50)',color:'var(--stone-600)',border:'1px solid var(--border)'})}>{row.recipient_type}</span>
                          </td>
                          <td style={ss({...tdS,fontSize:11,color:'var(--stone-700)',maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})} title={row.subject}>{row.subject}</td>
                          <td style={tdS}>
                            {row.success ? (
                              <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'var(--emerald-light)',color:'#065f46'})}><i className="fas fa-check" style={{fontSize:9,marginRight:3}}></i>Sent</span>
                            ) : (
                              <span title={row.error || ''} style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'var(--red-light)',color:'#991b1b'})}><i className="fas fa-xmark" style={{fontSize:9,marginRight:3}}></i>Failed</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Email Templates */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)'})}>
                <div style={ss({padding:'18px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-file-lines"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>Email Templates</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Click a template to pre-fill the compose form</p></div>
                </div>
                <div style={ss({padding:'16px 20px'})}>
                  {/* Group by category */}
                  {Array.from(new Set(emailTemplates.map(t=>t.category))).map(cat => (
                    <div key={cat} style={ss({marginBottom:14})}>
                      <div style={ss({fontSize:9,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:8})}>{cat}</div>
                      <div style={ss({display:'flex',gap:8,flexWrap:'wrap'})}>
                        {emailTemplates.filter(t=>t.category===cat).map(t=>(
                          <button key={t.name} onClick={()=>{setEmailSubject(t.subject);setEmailBody(t.body);}}
                            style={ss({display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',color:'var(--stone-700)',transition:'all .1s'})}
                            onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background='var(--yellow-soft)';(e.currentTarget as HTMLElement).style.borderColor='#fde68a';}}
                            onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='var(--card)';(e.currentTarget as HTMLElement).style.borderColor='var(--border)';}}
                          ><i className={`fas ${t.icon}`} style={{fontSize:9,color:'var(--stone-400)'}}></i>{t.name}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {/* ═══ PAYMENTS (Stripe) ═══ */}
          {tab === 'payments' && !paymentData && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading payments…
            </div>
          )}
          {tab === 'payments' && paymentData && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Phase 3: Total Revenue + This Month migrated to Overview
                  Metrics (Revenue & Payments group, with range selector).
                  Pending + Refunded stay here because they directly frame
                  the transactions table below — they're workflow context,
                  not historical metrics. */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10})}>
                <StatCard accent icon="fa-clock" label="Pending" value={`$${((paymentData.stats?.pending||0)/100).toFixed(2)}`} sub="awaiting confirmation" />
                <StatCard icon="fa-rotate-left" label="Refunded" value={`$${((paymentData.stats?.refunded||0)/100).toFixed(2)}`} sub="returned to students" />
              </div>
              {/* Grant Pro Modal */}
              {grantProOpen && (
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20})}>
                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14})}>
                    <div style={ss({display:'flex',alignItems:'center',gap:8})}>
                      <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center'})}><i className="fas fa-bolt" style={{color:'var(--yellow)',fontSize:12}}></i></div>
                      <div><h3 style={ss({fontSize:14,fontWeight:900})}>Grant Pro Access</h3><div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:1})}>Upgrade a student to Pro for free (no payment required)</div></div>
                    </div>
                    <button onClick={()=>{setGrantProOpen(false);setGrantProSearch('');}} style={ss({width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--stone-400)',fontSize:10,fontFamily:'inherit'})}><i className="fas fa-times"></i></button>
                  </div>
                  <input value={grantProSearch} onChange={e=>setGrantProSearch(e.target.value)} placeholder="Search student by name or email…" style={{...inputA,width:'100%'}} />
                  {grantProSearch.length >= 2 && (()=>{
                    const matches = students.filter(s=>s.name?.toLowerCase().includes(grantProSearch.toLowerCase())||s.email?.toLowerCase().includes(grantProSearch.toLowerCase())).slice(0,8);
                    if(matches.length===0) return <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:8,padding:'8px 0'})}>No students found matching &quot;{grantProSearch}&quot;</div>;
                    return <div style={ss({marginTop:8,border:'1px solid var(--border)',borderRadius:10,overflow:'hidden'})}>
                      {matches.map(s=>{
                        const sub = s.subscription_status || 'free';
                        const isFree = sub === 'free';
                        const statusCfg:{[k:string]:{label:string;bg:string;color:string}} = {
                          free:{label:'Free',bg:'var(--stone-50)',color:'var(--stone-400)'},
                          pro:{label:'Pro',bg:'#eff6ff',color:'#2563eb'},
                          premium:{label:'Premium',bg:'#f5f3ff',color:'#7c3aed'},
                        };
                        const sc = statusCfg[sub] || statusCfg.free;
                        return (
                        <div key={s.id} style={ss({display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border-light)',cursor:isFree?'pointer':'default',transition:'background .1s',opacity:isFree?1:.7})}
                          onClick={async()=>{
                            if(!isFree||grantProSending)return;
                            setGrantProSending(true);
                            await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'grant_pro',student_id:s.id})});
                            setStudents(prev=>prev.map(u=>u.id===s.id?{...u,subscription_status:'pro',subscription_expires_at:new Date(Date.now()+365*86400000).toISOString()}:u));
                            setGrantProSending(false);setGrantProOpen(false);setGrantProSearch('');
                            fetch('/api/admin?view=payments',{cache:'no-store'}).then(r=>r.json()).then(d=>setPaymentData(d));
                          }}
                          onMouseEnter={e=>{if(isFree)(e.currentTarget as HTMLElement).style.background='var(--stone-50)';}}
                          onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';}}>
                          <div style={ss({width:32,height:32,borderRadius:8,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:'var(--stone-400)',flexShrink:0})}>{(s.name||'?')[0].toUpperCase()}</div>
                          <div style={ss({flex:1,minWidth:0})}>
                            <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)'})}>{s.name}</div>
                            <div style={ss({fontSize:10,color:'var(--stone-400)'})}>{s.email}</div>
                          </div>
                          <span style={ss({fontSize:9,fontWeight:700,padding:'2px 8px',borderRadius:6,background:sc.bg,color:sc.color})}>{sc.label}</span>
                          {isFree && <span style={ss({fontSize:10,fontWeight:700,color:'#2563eb'})}>{grantProSending?'Granting…':'Click to grant Pro →'}</span>}
                          {!isFree && <span style={ss({fontSize:10,fontWeight:600,color:'var(--stone-300)'})}>Already {sc.label}</span>}
                        </div>);
                      })}
                    </div>;
                  })()}
                </div>
              )}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--emerald-light)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--emerald)',fontSize:12})}><i className="fas fa-receipt"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Transaction History</h3>
                    <span style={ss({fontSize:11,fontWeight:600,color:'var(--stone-400)'})}>{paymentData.payments?.length || 0} records</span>
                  </div>
                  <div style={ss({display:'flex',gap:8,alignItems:'center'})}>
                    <div style={ss({display:'flex',gap:2,background:'var(--stone-50)',borderRadius:8,padding:2})}>
                      {(['all','succeeded','pending','failed','refunded'] as const).map(f=>(
                        <button key={f} onClick={()=>setPaymentFilter(f as any)}
                          style={ss({padding:'5px 10px',borderRadius:6,border:'none',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',textTransform:'capitalize',background:paymentFilter===f?'var(--card)':'transparent',color:paymentFilter===f?'var(--stone-900)':'var(--stone-400)',boxShadow:paymentFilter===f?'0 1px 3px rgba(0,0,0,.08)':'none'})}
                        >{f}</button>
                      ))}
                    </div>
                    <input value={paymentSearch} onChange={e=>setPaymentSearch(e.target.value)} placeholder="Search…" style={{...inputA,width:140}} />
                    <button onClick={()=>{
                      // Phase A: export the currently-filtered payment rows.
                      const filtered = (paymentData.payments || [])
                        .filter((p:any) => paymentFilter === 'all' || p.status === paymentFilter)
                        .filter((p:any) => !paymentSearch || [p.student_name,p.student_email,p.plan_name].some((v:any)=>v?.toLowerCase().includes(paymentSearch.toLowerCase())));
                      const cols: CsvColumn<any>[] = [
                        { header: 'ID', value: r => r.id },
                        { header: 'Date', value: r => r.created_at },
                        { header: 'Student', value: r => r.student_name },
                        { header: 'Student Email', value: r => r.student_email },
                        { header: 'Plan', value: r => r.plan_name },
                        { header: 'Plan ID', value: r => r.plan_id },
                        { header: 'Amount USD', value: r => ((r.amount_cents||0)/100).toFixed(2) },
                        { header: 'Status', value: r => r.status },
                        { header: 'Stripe Payment Intent', value: r => r.stripe_payment_intent_id },
                        { header: 'Stripe Session ID', value: r => r.stripe_session_id },
                        { header: 'Refund Reason', value: r => r.refund_reason },
                      ];
                      downloadCsv('admitly_payments', filtered, cols);
                    }}
                      style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-700)',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5})}>
                      <i className="fas fa-file-export" style={{fontSize:9}}></i>Export CSV
                    </button>
                    <button onClick={()=>setGrantProOpen(true)}
                      style={ss({padding:'6px 12px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5})}>
                      <i className="fas fa-bolt" style={{fontSize:9,color:'var(--yellow)'}}></i>Grant Pro
                    </button>
                    <button onClick={async()=>{
                      try{const r=await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync_stripe_payments'})});
                      const d=await r.json();alert(d.ok?`Synced ${d.synced} payments from ${d.total_checked} Stripe sessions`:(d.error||'Failed'));
                      setPaymentData(null);fetch('/api/admin?view=payments',{cache:'no-store'}).then(r=>r.json()).then(d=>setPaymentData(d));}catch{alert('Sync failed');}
                    }}
                      style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-600)',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5})}>
                      <i className="fas fa-rotate" style={{fontSize:9}}></i>Sync Stripe
                    </button>
                    <button onClick={()=>window.open('https://dashboard.stripe.com','_blank')}
                      style={ss({padding:'6px 12px',borderRadius:8,border:'none',background:'#635bff',color:'#fff',fontFamily:'inherit',fontSize:11,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',gap:5})}>
                      <i className="fab fa-stripe-s" style={{fontSize:10}}></i>Stripe
                    </button>
                  </div>
                </div>
                {(!paymentData.payments || paymentData.payments.length === 0) ? (
                  <div style={ss({padding:'48px 20px',textAlign:'center'})}>
                    <div style={ss({width:56,height:56,borderRadius:16,background:'var(--stone-50)',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:14})}><i className="fas fa-credit-card" style={{fontSize:22,color:'var(--stone-300)'}}></i></div>
                    <div style={ss({fontSize:14,fontWeight:800,color:'var(--stone-700)',marginBottom:4})}>No Transactions Yet</div>
                    <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',maxWidth:320,margin:'0 auto'})}>Transactions appear after students pay via Stripe Checkout.</div>
                  </div>
                ) : (
                  <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                    <thead><tr style={{background:'var(--stone-50)'}}>
                      {['Date','Student','Plan','Amount','Status','',''].map((h,i)=><th key={i} style={thS}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {(paymentData.payments || [])
                        .filter((p:any) => paymentFilter === 'all' || p.status === paymentFilter)
                        .filter((p:any) => !paymentSearch || [p.student_name,p.student_email,p.plan_name].some((v:any)=>v?.toLowerCase().includes(paymentSearch.toLowerCase())))
                        .map((p:any, i:number) => {
                          const statusColors: Record<string,{bg:string;color:string}> = {
                            succeeded:{bg:'var(--emerald-light)',color:'#065f46'},
                            pending:{bg:'var(--amber-light)',color:'#92400e'},
                            failed:{bg:'var(--red-light)',color:'#991b1b'},
                            refunded:{bg:'#f5f3ff',color:'#7c3aed'},
                          };
                          const sc = statusColors[p.status] || statusColors.pending;
                          return (
                            <Fragment key={p.id||i}>
                              <tr style={{borderBottom:'1px solid var(--border-light)'}}>
                                <td style={ss({...tdS,fontSize:12,color:'var(--stone-500)',whiteSpace:'nowrap'})}>{fmtDate(p.created_at)}</td>
                                <td style={tdS}><div style={ss({fontWeight:700,fontSize:13})}>{p.student_name||'Unknown'}</div><div style={ss({fontSize:11,color:'var(--stone-400)'})}>{p.student_email||''}</div></td>
                                <td style={ss({...tdS,fontSize:12,fontWeight:700})}>{p.plan_name||'—'}</td>
                                <td style={ss({...tdS,fontSize:13,fontWeight:800})}>${((p.amount_cents||0)/100).toFixed(2)}</td>
                                <td style={tdS}><span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:sc.bg,color:sc.color,textTransform:'uppercase'})}>{p.status}</span></td>
                                <td style={ss({...tdS,textAlign:'center',whiteSpace:'nowrap'})}>
                                  <button onClick={(e)=>{e.stopPropagation();void openPaymentEvents(p);}}
                                    style={ss({padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',color:'var(--stone-600)',marginRight:6})}>
                                    Details
                                  </button>
                                  {p.status === 'succeeded' && (
                                    <button onClick={(e)=>{e.stopPropagation();setRefundingId(refundingId===p.id?null:p.id);setRefundReason('');}}
                                      style={ss({padding:'4px 10px',borderRadius:6,border:'1px solid #fecaca',background:'var(--card)',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',color:'var(--red)'})}>
                                      Refund
                                    </button>
                                  )}
                                </td>
                                <td style={ss({...tdS,fontSize:10,fontFamily:'monospace'})}>
                                  {p.stripe_payment_intent_id ? (
                                    <a href={`https://dashboard.stripe.com/${process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_ID ? process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_ID + '/' : ''}test/payments/${p.stripe_payment_intent_id}`} target="_blank" rel="noopener noreferrer"
                                      onClick={e=>e.stopPropagation()}
                                      style={ss({color:'#635bff',textDecoration:'none',fontWeight:600})}
                                      onMouseEnter={e=>(e.currentTarget as HTMLElement).style.textDecoration='underline'}
                                      onMouseLeave={e=>(e.currentTarget as HTMLElement).style.textDecoration='none'}>
                                      {p.stripe_payment_intent_id.slice(0,20)}…
                                    </a>
                                  ) : p.stripe_session_id ? (
                                    <span style={{color:'var(--stone-300)'}}>{p.stripe_session_id.slice(0,16)}…</span>
                                  ) : '—'}
                                </td>
                              </tr>
                              {/* Refund inline panel */}
                              {refundingId === p.id && (
                                <tr><td colSpan={7} style={{padding:0}}>
                                  <div style={ss({padding:'14px 20px',background:'var(--red-light)',borderBottom:'2px solid #fecaca'})}>
                                    <div style={ss({fontSize:12,fontWeight:800,color:'var(--red)',marginBottom:8})}>Refund ${((p.amount_cents||0)/100).toFixed(2)} to {p.student_name||'student'}?</div>
                                    <textarea value={refundReason} onChange={e=>setRefundReason(e.target.value)}
                                      placeholder="Reason (optional — logged for records)..."
                                      style={ss({width:'100%',padding:'10px 12px',borderRadius:8,border:'1px solid #fecaca',fontSize:12,fontFamily:'inherit',resize:'vertical',minHeight:50,outline:'none',boxSizing:'border-box'})} />
                                    <div style={ss({display:'flex',gap:8,marginTop:10,justifyContent:'flex-end'})}>
                                      <button onClick={()=>setRefundingId(null)} style={ss({padding:'7px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Cancel</button>
                                      <button onClick={()=>{
                                        // Phase A: refunds move real money;
                                        // require typing PROD in production.
                                        const performRefund = async () => {
                                          try {
                                            await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refund_payment',payment_id:p.id,reason:refundReason})});
                                            setPaymentData((prev:any)=>({...prev,payments:prev.payments.map((pp:any)=>pp.id===p.id?{...pp,status:'refunded'}:pp)}));
                                            setRefundingId(null);
                                          } catch(e) { console.error('Refund failed:',e); }
                                        };
                                        requireProdConfirm({
                                          title: 'Confirm refund',
                                          body: `Refund $${((p.amount_cents||0)/100).toFixed(2)} to ${p.student_name||'this student'}? This is irreversible.`,
                                          confirmLabel: 'Refund',
                                          action: performRefund,
                                        });
                                      }}
                                      style={ss({padding:'7px 16px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',fontSize:11,fontWeight:800,cursor:'pointer',fontFamily:'inherit'})}>
                                        Confirm Refund
                                      </button>
                                    </div>
                                  </div>
                                </td></tr>
                              )}
                            </Fragment>
                          );
                        })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ═══ Phase C — PREMIUM REQUESTS ═══
              The Premium plan workflow: students click Request Match,
              admin reviews and sends a Stripe invoice, the student pays,
              and an ep_assignments row materializes to take over. The
              row design is "click to expand" so we don't blow out
              vertical space when there are dozens. */}
          {tab === 'premium_requests' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Filter pills + count */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'})}>
                <div style={ss({display:'flex',gap:4})}>
                  {([
                    {id:'active' as const,    label:'Active',    sub:'pending review + awaiting payment'},
                    {id:'paid' as const,      label:'Paid',      sub:'completed'},
                    {id:'cancelled' as const, label:'Cancelled', sub:'rejected, voided, expired, cancelled'},
                    {id:'all' as const,       label:'All',       sub:'every status'},
                  ]).map(f => (
                    <button key={f.id} title={f.sub} onClick={()=>setPremiumFilter(f.id)}
                      style={ss({padding:'6px 14px',borderRadius:8,border:premiumFilter===f.id?'2px solid var(--stone-900)':'1px solid var(--border)',background:premiumFilter===f.id?'var(--stone-900)':'var(--card)',color:premiumFilter===f.id?'#fff':'var(--stone-500)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <span style={ss({marginLeft:'auto',fontSize:11,color:'var(--stone-400)'})}>{premiumRequests.length} request{premiumRequests.length===1?'':'s'}</span>
                <button onClick={()=>setRefreshAt(Date.now())}
                  style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)',display:'flex',alignItems:'center',gap:5})}>
                  <i className={`fas fa-rotate ${premiumRequestsLoading?'fa-spin':''}`} style={{fontSize:9}}></i>Refresh
                </button>
              </div>

              {premiumActionError && (
                <div style={ss({padding:'10px 14px',background:'var(--red-light)',border:'1px solid #fecaca',borderRadius:10,fontSize:12,fontWeight:600,color:'#991b1b',display:'flex',alignItems:'center',gap:8})}>
                  <i className="fas fa-circle-exclamation" style={{fontSize:11}}></i>{premiumActionError}
                  <button onClick={()=>setPremiumActionError(null)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#991b1b'}}><i className="fas fa-xmark"></i></button>
                </div>
              )}

              {/* Requests table */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                {premiumRequests.length === 0 ? (
                  <div style={ss({padding:'40px 20px',textAlign:'center',color:'var(--stone-400)'})}>
                    <i className="fas fa-crown" style={{fontSize:24,display:'block',marginBottom:10,opacity:.3}}></i>
                    <div style={ss({fontSize:13,fontWeight:700})}>No requests in this filter</div>
                    <div style={ss({fontSize:11,marginTop:4})}>Switch to "All" to see historical requests.</div>
                  </div>
                ) : (
                  <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                    <thead><tr style={{background:'var(--stone-50)'}}>
                      {['Submitted','Student','Plan','Amount','Status','Counselor',''].map(h=><th key={h} style={thS}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {premiumRequests.map(req => {
                        const isExpanded = expandedPremiumId === req.id;
                        const statusColors: Record<string,{bg:string;color:string;label:string}> = {
                          pending_review:       { bg:'var(--amber-light)',  color:'#92400e', label:'Pending Review' },
                          awaiting_payment:     { bg:'var(--emerald-light)',color:'#065f46', label:'Awaiting Payment' },
                          paid:                 { bg:'#eff6ff',             color:'#1e40af', label:'Paid' },
                          cancelled_by_student: { bg:'var(--stone-100)',    color:'var(--stone-500)', label:'Cancelled (Student)' },
                          rejected:             { bg:'var(--red-light)',    color:'#991b1b', label:'Rejected' },
                          voided:               { bg:'var(--red-light)',    color:'#991b1b', label:'Voided' },
                          expired:              { bg:'var(--stone-100)',    color:'var(--stone-500)', label:'Expired' },
                        };
                        const sc = statusColors[req.status] || { bg:'var(--stone-100)', color:'var(--stone-500)', label: req.status };
                        const amount = req.amount_cents_invoiced ?? req.amount_cents_quoted;
                        const expanded = isExpanded;
                        return (
                          <Fragment key={req.id}>
                            <tr onClick={()=>{
                              const opening = expandedPremiumId !== req.id;
                              setExpandedPremiumId(opening ? req.id : null);
                              setPremiumActionError(null);
                              if (opening) {
                                setPremiumCounselorPick(req.counselor_user_id != null ? String(req.counselor_user_id) : '');
                                setPremiumAmountOverride(((req.amount_cents_invoiced ?? req.amount_cents_quoted) / 100).toFixed(2));
                                setPremiumRejectReason('');
                              }
                            }} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:expanded?'#fefce8':'transparent'}}>
                              <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)',whiteSpace:'nowrap'})}>{fmtDateTime(req.created_at)}</td>
                              <td style={tdS}>
                                <div style={ss({fontWeight:700})}>{req.student_name || 'Unknown'}</div>
                                <div style={ss({fontSize:10,color:'var(--stone-400)'})}>{req.student_email || ''}</div>
                              </td>
                              <td style={ss({...tdS,fontWeight:700})}>{req.plan_name}</td>
                              <td style={ss({...tdS,fontSize:13,fontWeight:800})}>${(amount/100).toFixed(2)}</td>
                              <td style={tdS}>
                                <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:sc.bg,color:sc.color,textTransform:'uppercase'})}>{sc.label}</span>
                              </td>
                              <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)'})}>{req.counselor_name || <span style={{color:'var(--stone-300)'}}>—</span>}</td>
                              <td style={ss({...tdS,textAlign:'right',color:'var(--stone-400)'})}><i className={`fas fa-chevron-${expanded?'up':'down'}`} style={{fontSize:10}}></i></td>
                            </tr>
                            {expanded && (
                              <tr><td colSpan={7} style={{padding:0}}>
                                <div style={ss({padding:'18px 22px',background:'#fefce8',borderBottom:'2px solid #fde68a'})}>
                                  {/* pending_review → Send Invoice + Reject */}
                                  {req.status === 'pending_review' && (
                                    <>
                                      <div style={ss({fontSize:12,fontWeight:800,color:'var(--stone-700)',marginBottom:10})}>Send invoice</div>
                                      <div style={ss({display:'grid',gridTemplateColumns:'2fr 1fr',gap:10,marginBottom:14})}>
                                        <div>
                                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Counselor (pre-select)</label>
                                          <select value={premiumCounselorPick} onChange={e=>setPremiumCounselorPick(e.target.value)}
                                            style={{...inputA,width:'100%'}}>
                                            <option value="">— No counselor (admin will assign later) —</option>
                                            {counselorsList.map(c=>{
                                              const activeCount = assignments.filter(a=>a.counselor_id===c.id && a.status==='active').length;
                                              const amber = activeCount > 0;
                                              return <option key={c.id} value={c.user_id} style={{color: amber ? '#92400e' : 'inherit'}}>
                                                {c.display_name} — {activeCount} active
                                              </option>;
                                            })}
                                          </select>
                                          <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:4})}>Amber rows = counselor already has ≥1 active assignment.</div>
                                        </div>
                                        <div>
                                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Amount (USD)</label>
                                          <input value={premiumAmountOverride} onChange={e=>setPremiumAmountOverride(e.target.value)}
                                            placeholder={(req.amount_cents_quoted/100).toFixed(2)}
                                            style={{...inputA,width:'100%'}} />
                                          <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:4})}>Quoted to student: ${(req.amount_cents_quoted/100).toFixed(2)}</div>
                                        </div>
                                      </div>
                                      <div style={ss({display:'flex',gap:8,flexWrap:'wrap'})}>
                                        <button disabled={premiumActionRunning} onClick={async()=>{
                                          setPremiumActionRunning(true);
                                          setPremiumActionError(null);
                                          try {
                                            const overrideCents = Math.round(parseFloat(premiumAmountOverride || '0') * 100);
                                            const res = await fetch('/api/admin/premium-requests', {
                                              method:'POST', headers:{'Content-Type':'application/json'},
                                              body: JSON.stringify({
                                                action: 'send_invoice',
                                                request_id: req.id,
                                                counselor_user_id: premiumCounselorPick ? parseInt(premiumCounselorPick,10) : null,
                                                amount_cents: Number.isFinite(overrideCents) && overrideCents > 0 ? overrideCents : req.amount_cents_quoted,
                                              }),
                                            });
                                            const data = await res.json().catch(()=>({}));
                                            if (!res.ok) { setPremiumActionError(data.error || `Failed (${res.status})`); return; }
                                            setExpandedPremiumId(null);
                                            setRefreshAt(Date.now());
                                          } catch(e:any) { setPremiumActionError(e?.message || 'Network error'); }
                                          finally { setPremiumActionRunning(false); }
                                        }}
                                          style={ss({padding:'9px 18px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:12,fontWeight:800,cursor:premiumActionRunning?'wait':'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:6})}>
                                          {premiumActionRunning ? <><i className="fas fa-spinner fa-spin"></i>Sending…</> : <><i className="fas fa-paper-plane" style={{fontSize:10}}></i>Send Invoice to Student</>}
                                        </button>

                                        <details style={{marginLeft:'auto'}}>
                                          <summary style={ss({padding:'9px 16px',borderRadius:8,border:'1px solid #fecaca',background:'var(--card)',color:'var(--red)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',listStyle:'none'})}>Reject</summary>
                                          <div style={ss({marginTop:10,display:'flex',gap:8,alignItems:'flex-start'})}>
                                            <textarea value={premiumRejectReason} onChange={e=>setPremiumRejectReason(e.target.value)}
                                              placeholder="Reason (sent to student in email)" rows={3}
                                              style={ss({flex:1,minWidth:280,padding:'8px 10px',borderRadius:8,border:'1px solid var(--border)',fontFamily:'inherit',fontSize:12,resize:'vertical'})} />
                                            <button disabled={premiumActionRunning || !premiumRejectReason.trim()} onClick={async()=>{
                                              setPremiumActionRunning(true);
                                              setPremiumActionError(null);
                                              try {
                                                const res = await fetch('/api/admin/premium-requests', {
                                                  method:'POST', headers:{'Content-Type':'application/json'},
                                                  body: JSON.stringify({ action:'reject', request_id: req.id, reason: premiumRejectReason.trim() }),
                                                });
                                                const data = await res.json().catch(()=>({}));
                                                if (!res.ok) { setPremiumActionError(data.error || `Failed (${res.status})`); return; }
                                                setExpandedPremiumId(null);
                                                setRefreshAt(Date.now());
                                              } catch(e:any) { setPremiumActionError(e?.message || 'Network error'); }
                                              finally { setPremiumActionRunning(false); }
                                            }} style={ss({padding:'8px 16px',borderRadius:8,border:'none',background:'var(--red)',color:'#fff',fontSize:12,fontWeight:800,cursor:premiumActionRunning||!premiumRejectReason.trim()?'default':'pointer',fontFamily:'inherit',whiteSpace:'nowrap',opacity:!premiumRejectReason.trim()?0.5:1})}>
                                              Send Rejection
                                            </button>
                                          </div>
                                        </details>
                                      </div>
                                    </>
                                  )}

                                  {/* awaiting_payment → invoice details + Void */}
                                  {req.status === 'awaiting_payment' && (
                                    <>
                                      <div style={ss({fontSize:12,fontWeight:800,color:'var(--stone-700)',marginBottom:10})}>Invoice sent {req.invoice_sent_at ? `(${fmtDateTime(req.invoice_sent_at)})` : ''}</div>
                                      <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14,fontSize:11})}>
                                        <div><div style={ss({color:'var(--stone-400)',fontWeight:700,fontSize:10,textTransform:'uppercase',marginBottom:2})}>Amount Invoiced</div><div style={ss({fontWeight:800})}>${((req.amount_cents_invoiced||0)/100).toFixed(2)}</div></div>
                                        <div><div style={ss({color:'var(--stone-400)',fontWeight:700,fontSize:10,textTransform:'uppercase',marginBottom:2})}>Auto-voids at</div><div style={ss({fontWeight:600})}>{req.invoice_expires_at ? fmtDateTime(req.invoice_expires_at) : '—'}</div></div>
                                        <div><div style={ss({color:'var(--stone-400)',fontWeight:700,fontSize:10,textTransform:'uppercase',marginBottom:2})}>Reminder Sent</div><div style={ss({fontWeight:600})}>{req.reminder_sent_at ? fmtDateTime(req.reminder_sent_at) : 'Not yet'}</div></div>
                                      </div>
                                      <div style={ss({display:'flex',gap:8,flexWrap:'wrap'})}>
                                        {req.hosted_invoice_url && (
                                          <a href={req.hosted_invoice_url} target="_blank" rel="noopener noreferrer"
                                            style={ss({padding:'9px 16px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-700)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:6,textDecoration:'none'})}>
                                            <i className="fas fa-arrow-up-right-from-square" style={{fontSize:10}}></i>Open Stripe Invoice
                                          </a>
                                        )}
                                        <button disabled={premiumActionRunning} onClick={async()=>{
                                          if (!window.confirm('Void this invoice? The student will lose access to the payment link.')) return;
                                          setPremiumActionRunning(true);
                                          setPremiumActionError(null);
                                          try {
                                            const res = await fetch('/api/admin/premium-requests', {
                                              method:'POST', headers:{'Content-Type':'application/json'},
                                              body: JSON.stringify({ action:'void', request_id: req.id }),
                                            });
                                            const data = await res.json().catch(()=>({}));
                                            if (!res.ok) { setPremiumActionError(data.error || `Failed (${res.status})`); return; }
                                            setExpandedPremiumId(null);
                                            setRefreshAt(Date.now());
                                          } catch(e:any) { setPremiumActionError(e?.message || 'Network error'); }
                                          finally { setPremiumActionRunning(false); }
                                        }} style={ss({padding:'9px 16px',borderRadius:8,border:'1px solid #fecaca',background:'var(--card)',color:'var(--red)',fontSize:12,fontWeight:700,cursor:premiumActionRunning?'wait':'pointer',fontFamily:'inherit'})}>
                                          Void Invoice
                                        </button>
                                      </div>
                                    </>
                                  )}

                                  {/* paid / cancelled / rejected / voided / expired → read-only summary */}
                                  {!['pending_review','awaiting_payment'].includes(req.status) && (
                                    <div style={ss({fontSize:12,color:'var(--stone-600)'})}>
                                      <div><strong>Status:</strong> {req.status}</div>
                                      {req.rejection_reason && <div style={ss({marginTop:6})}><strong>Reason:</strong> {req.rejection_reason}</div>}
                                      {req.paid_at && <div style={ss({marginTop:6})}><strong>Paid at:</strong> {fmtDateTime(req.paid_at)}</div>}
                                      {req.stripe_invoice_id && <div style={ss({marginTop:6,fontFamily:'monospace',fontSize:10,color:'var(--stone-500)'})}>Invoice id: {req.stripe_invoice_id}</div>}
                                    </div>
                                  )}
                                </div>
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ═══ Phase D — RECOVERIES ═══
              Inbox of failed Pro payments with a one-click "Send
              Recovery Invoice" action that mirrors the Phase C Premium
              flow. The student gets a Stripe-hosted payment link in
              email; on payment, the webhook handler grants Pro and
              stamps both the new payment and the original failed row.
              Rows that were already recovered (a later succeeded
              payment exists for the same user) render dimmed for
              context but aren't actionable. */}
          {tab === 'recoveries' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              <div style={ss({display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'})}>
                <div style={ss({fontSize:12,color:'var(--stone-500)'})}>
                  Failed Pro payments from the last 30 days. Send a manual Stripe invoice to recover the customer.
                </div>
                <span style={ss({marginLeft:'auto',fontSize:11,color:'var(--stone-400)'})}>{recoveries.length} {recoveries.length===1?'failure':'failures'}</span>
                <button onClick={()=>setRefreshAt(Date.now())}
                  style={ss({padding:'6px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)',display:'flex',alignItems:'center',gap:5})}>
                  <i className={`fas fa-rotate ${recoveriesLoading?'fa-spin':''}`} style={{fontSize:9}}></i>Refresh
                </button>
              </div>

              {recoveryActionError && (
                <div style={ss({padding:'10px 14px',background:'var(--red-light)',border:'1px solid #fecaca',borderRadius:10,fontSize:12,fontWeight:600,color:'#991b1b',display:'flex',alignItems:'center',gap:8})}>
                  <i className="fas fa-circle-exclamation" style={{fontSize:11}}></i>{recoveryActionError}
                  <button onClick={()=>setRecoveryActionError(null)} style={{marginLeft:'auto',background:'none',border:'none',cursor:'pointer',color:'#991b1b'}}><i className="fas fa-xmark"></i></button>
                </div>
              )}

              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                {recoveries.length === 0 ? (
                  <div style={ss({padding:'40px 20px',textAlign:'center',color:'var(--stone-400)'})}>
                    <i className="fas fa-life-ring" style={{fontSize:24,display:'block',marginBottom:10,opacity:.3}}></i>
                    <div style={ss({fontSize:13,fontWeight:700})}>No failed payments in the last 30 days</div>
                    <div style={ss({fontSize:11,marginTop:4})}>Anything that fails or gets declined will land here.</div>
                  </div>
                ) : (
                  <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                    <thead><tr style={{background:'var(--stone-50)'}}>
                      {['Failed','Type','Student','Plan','Amount','State',''].map(h=><th key={h} style={thS}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {recoveries.map(r => {
                        // Each row is keyed by (type, id) since Pro and Premium
                        // share an `id` namespace from different tables.
                        const rowKey = `${r.type}-${r.id}`;
                        const isExpanded = expandedRecoveryId === r.id && (recoveries.find(x=>expandedRecoveryId===x.id)?.type === r.type);
                        const isPro = r.type === 'pro';
                        // Pro state lives in payments.metadata; Premium state
                        // lives on premium_requests fields.
                        const recoveryInvoiceId: string | undefined = isPro ? r.metadata?.recovery_invoice_id : (r.stripe_invoice_id ?? undefined);
                        const recoveryCompletedAt: string | undefined = isPro ? r.metadata?.recovery_completed_at : undefined;
                        const recoverySentAt: string | undefined = isPro ? r.metadata?.recovery_sent_at : undefined;
                        const stateInfo = ((): { bg: string; color: string; label: string; actionable: boolean } => {
                          // Premium: 'paid' is the recovered state.
                          if (!isPro && r.status === 'paid') return { bg: 'var(--emerald-light)', color: '#065f46', label: 'Recovered', actionable: false };
                          if (recoveryCompletedAt) return { bg: 'var(--emerald-light)', color: '#065f46', label: 'Recovered', actionable: false };
                          if (r.already_recovered) return { bg: 'var(--emerald-light)', color: '#065f46', label: 'Recovered', actionable: false };
                          if (isPro && recoveryInvoiceId) return { bg: '#eff6ff', color: '#1e40af', label: 'Invoice Sent', actionable: false };
                          return { bg: 'var(--red-light)', color: '#991b1b', label: isPro ? 'Awaiting Recovery' : 'Premium Payment Failed', actionable: true };
                        })();
                        const dimmed = !stateInfo.actionable;
                        return (
                          <Fragment key={rowKey}>
                            <tr onClick={()=>{
                              const opening = expandedRecoveryId !== r.id;
                              setExpandedRecoveryId(opening ? r.id : null);
                              setRecoveryActionError(null);
                              if (opening) {
                                setRecoveryAmountOverride(((r.amount_cents || 0) / 100).toFixed(2));
                              }
                            }} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:isExpanded?'#fef2f2':'transparent',opacity:dimmed?.6:1}}>
                              <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)',whiteSpace:'nowrap'})}>{fmtDateTime(r.failed_at)}</td>
                              <td style={tdS}>
                                <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:9,fontWeight:800,textTransform:'uppercase',letterSpacing:'.3px',
                                  background: isPro ? '#eff6ff' : '#f5f3ff',
                                  color:      isPro ? '#1e40af' : '#6b21a8'})}>{isPro ? 'Pro' : 'Premium'}</span>
                              </td>
                              <td style={tdS}>
                                <div style={ss({fontWeight:700})}>{r.user_name || 'Unknown'}</div>
                                <div style={ss({fontSize:10,color:'var(--stone-400)'})}>{r.user_email || ''}</div>
                              </td>
                              <td style={ss({...tdS,fontWeight:700})}>{r.plan_name || (isPro ? 'Pro' : 'Premium')}</td>
                              <td style={ss({...tdS,fontSize:13,fontWeight:800})}>${((r.amount_cents||0)/100).toFixed(2)}</td>
                              <td style={tdS}>
                                <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:stateInfo.bg,color:stateInfo.color,textTransform:'uppercase'})}>{stateInfo.label}</span>
                              </td>
                              <td style={ss({...tdS,textAlign:'right',color:'var(--stone-400)'})}><i className={`fas fa-chevron-${isExpanded?'up':'down'}`} style={{fontSize:10}}></i></td>
                            </tr>
                            {isExpanded && (
                              <tr><td colSpan={7} style={{padding:0}}>
                                <div style={ss({padding:'18px 22px',background:'#fef2f2',borderBottom:'2px solid #fecaca'})}>
                                  {/* Failure reason — Premium only */}
                                  {!isPro && r.last_failure_reason && (
                                    <div style={ss({marginBottom:14,padding:'10px 14px',background:'var(--card)',border:'1px solid #fecaca',borderRadius:8,fontSize:11,color:'var(--stone-700)'})}>
                                      <strong>Last failure:</strong> {r.last_failure_reason}
                                      {r.attempt_count != null && r.attempt_count > 1 && (
                                        <span style={ss({marginLeft:8,fontSize:10,color:'var(--stone-500)'})}>· attempt #{r.attempt_count}</span>
                                      )}
                                    </div>
                                  )}

                                  {/* Awaiting state — actionable */}
                                  {stateInfo.actionable && (
                                    <>
                                      <div style={ss({fontSize:12,fontWeight:800,color:'var(--stone-700)',marginBottom:10})}>
                                        {isPro ? 'Send recovery invoice' : 'Resend Premium invoice'}
                                      </div>
                                      <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14})}>
                                        <div>
                                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>Amount (USD)</label>
                                          <input value={recoveryAmountOverride} onChange={e=>setRecoveryAmountOverride(e.target.value)}
                                            style={{...inputA,width:'100%'}} />
                                          <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:4})}>{isPro ? 'Original failed amount' : 'Currently invoiced'}: ${(r.amount_cents/100).toFixed(2)}</div>
                                        </div>
                                        <div>
                                          <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:4})}>{isPro ? 'Stripe payment intent' : 'Current Stripe invoice'}</label>
                                          <div style={ss({padding:'8px 12px',background:'var(--card)',border:'1px solid var(--border)',borderRadius:8,fontSize:11,fontFamily:'monospace',color:'var(--stone-500)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{(isPro ? r.stripe_payment_intent_id : r.stripe_invoice_id) || '—'}</div>
                                          <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:4})}>{isPro ? 'From the original (failed) attempt' : 'Will be voided when the new one sends'}</div>
                                        </div>
                                      </div>
                                      <div style={ss({display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'})}>
                                        <button disabled={recoveryActionRunning} onClick={async()=>{
                                          setRecoveryActionRunning(true);
                                          setRecoveryActionError(null);
                                          try {
                                            const overrideCents = Math.round(parseFloat(recoveryAmountOverride || '0') * 100);
                                            const amountCents = Number.isFinite(overrideCents) && overrideCents > 0 ? overrideCents : r.amount_cents;
                                            // Two endpoints: Pro routes through
                                            // /api/admin/recoveries (creates a
                                            // fresh invoice from a failed
                                            // payment row); Premium routes
                                            // through the existing Premium
                                            // Requests action (resend voids
                                            // the old invoice and ships a new).
                                            const url = isPro ? '/api/admin/recoveries' : '/api/admin/premium-requests';
                                            const body = isPro
                                              ? { action:'send_invoice', payment_id: r.id, amount_cents: amountCents }
                                              : { action:'resend_invoice', request_id: r.id, amount_cents: amountCents };
                                            const res = await fetch(url, {
                                              method:'POST', headers:{'Content-Type':'application/json'},
                                              body: JSON.stringify(body),
                                            });
                                            const data = await res.json().catch(()=>({}));
                                            if (!res.ok) { setRecoveryActionError(data.error || `Failed (${res.status})`); return; }
                                            setExpandedRecoveryId(null);
                                            setRefreshAt(Date.now());
                                          } catch(e:any) { setRecoveryActionError(e?.message || 'Network error'); }
                                          finally { setRecoveryActionRunning(false); }
                                        }} style={ss({padding:'9px 18px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:12,fontWeight:800,cursor:recoveryActionRunning?'wait':'pointer',fontFamily:'inherit',display:'inline-flex',alignItems:'center',gap:6})}>
                                          {recoveryActionRunning ? <><i className="fas fa-spinner fa-spin"></i>{isPro?'Sending…':'Resending…'}</> : <><i className="fas fa-paper-plane" style={{fontSize:10}}></i>{isPro ? 'Send Recovery Invoice' : 'Resend Invoice'}</>}
                                        </button>
                                        <span style={ss({fontSize:11,color:'var(--stone-500)'})}>{isPro ? 'Student gets a Stripe-hosted payment link by email.' : 'Voids the current invoice and emails a fresh link.'}</span>
                                      </div>
                                    </>
                                  )}

                                  {/* Invoice sent — read-only summary (Pro only) */}
                                  {isPro && recoveryInvoiceId && !recoveryCompletedAt && (
                                    <div style={ss({fontSize:12,color:'var(--stone-700)'})}>
                                      <div><strong>Recovery invoice sent</strong>{recoverySentAt ? ` (${fmtDateTime(recoverySentAt)})` : ''}</div>
                                      <div style={ss({marginTop:6,fontFamily:'monospace',fontSize:10,color:'var(--stone-500)'})}>Invoice id: {recoveryInvoiceId}</div>
                                      {r.metadata?.recovery_invoice_url && (
                                        <a href={r.metadata.recovery_invoice_url} target="_blank" rel="noopener noreferrer"
                                          style={ss({display:'inline-flex',alignItems:'center',gap:6,marginTop:10,padding:'7px 14px',borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-700)',fontSize:11,fontWeight:700,fontFamily:'inherit',textDecoration:'none'})}>
                                          <i className="fas fa-arrow-up-right-from-square" style={{fontSize:10}}></i>Open Stripe Invoice
                                        </a>
                                      )}
                                    </div>
                                  )}

                                  {/* Already recovered (Pro recovery flow OR Premium 'paid') */}
                                  {(recoveryCompletedAt || r.already_recovered || (!isPro && r.status === 'paid')) && (
                                    <div style={ss({fontSize:12,color:'var(--stone-700)'})}>
                                      <div><i className="fas fa-circle-check" style={{color:'var(--emerald)',marginRight:6}}></i><strong>Recovered</strong>{recoveryCompletedAt ? ` (${fmtDateTime(recoveryCompletedAt)})` : ''}</div>
                                      <div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:4})}>
                                        {recoveryCompletedAt ? 'Customer paid the recovery invoice.'
                                          : !isPro && r.status === 'paid' ? 'Customer paid the Premium invoice.'
                                          : 'Customer succeeded on a later payment without admin intervention.'}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ═══ COUNSELOR EARNINGS ═══ */}
          {tab === 'earnings' && !earningsData && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading earnings…
            </div>
          )}
          {tab === 'earnings' && earningsData && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Stat tiles */}
              {/* Phase 3: Total Paid + Pipeline migrated to Overview
                  Metrics (Counselor Earnings group). Outstanding +
                  Completed Unpaid stay here because they sit next to the
                  "Pay all outstanding" button below — that tile-to-action
                  proximity is the whole point of having them on this tab. */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10})}>
                <StatCard accent icon="fa-file-invoice-dollar" label="Completed Unpaid" value={String(earningsData.counselors?.reduce((s:number,c:any)=>{const unpaid=c.assignments?.filter((a:any)=>a.payable&&a.payable_cents>0).length||0;return s+unpaid;},0)||0)} sub="assignments awaiting payout" />
                <StatCard icon="fa-exclamation-triangle" label="Outstanding" value={`$${((earningsData.totals?.owed||0)/100).toFixed(0)}`} sub={earningsData.totals?.owed > 0 ? 'needs payment' : 'all clear'} />
              </div>

              {/* Outstanding balance warning */}
              {earningsData.totals?.owed > 0 && (
                <div style={ss({display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'var(--amber-light)',borderRadius:12,border:'1px solid #fde68a'})}>
                  <i className="fas fa-triangle-exclamation" style={{color:'#d97706',fontSize:14}}></i>
                  <span style={ss({fontSize:13,fontWeight:700,color:'#92400e',flex:1})}>{earningsData.counselors.filter((c:any)=>c.owed_cents>0).length} counselor{earningsData.counselors.filter((c:any)=>c.owed_cents>0).length!==1?'s':''} with outstanding balance totaling ${((earningsData.totals.owed)/100).toFixed(0)}</span>
                  <button onClick={async()=>{
                    if(!confirm(`Pay all outstanding balances ($${((earningsData.totals.owed)/100).toFixed(0)})?`)) return;
                    for(const c of earningsData.counselors.filter((cc:any)=>cc.owed_cents>0)){
                      await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'pay_counselor',counselor_id:c.id,amount_cents:c.owed_cents,hours:c.hours_worked,notes:'Bulk payout — all outstanding'})});
                    }
                    setEarningsData(null);
                    fetch('/api/admin?view=earnings',{cache:'no-store'}).then(r=>r.json()).then(d=>setEarningsData(d));
                  }}
                  style={ss({padding:'7px 16px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Pay all outstanding</button>
                </div>
              )}

              {/* Filters */}
              <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                <div style={ss({display:'flex',gap:4})}>
                  {([{id:'all',label:'All'},{id:'owed',label:'Owed'},{id:'paid',label:'Paid in full'}] as const).map(f=>(
                    <button key={f.id} onClick={()=>setEarningsFilter(f.id)}
                      style={ss({padding:'6px 12px',borderRadius:8,border:earningsFilter===f.id?'2px solid var(--stone-900)':'1px solid var(--border)',background:earningsFilter===f.id?'var(--stone-900)':'var(--card)',color:earningsFilter===f.id?'#fff':'var(--stone-500)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>
                      {f.label}
                    </button>
                  ))}
                </div>
                <span style={ss({marginLeft:'auto',fontSize:11,color:'var(--stone-400)'})}>{earningsData.counselors?.length||0} counselors</span>
                <button onClick={()=>{
                  // Phase A: export the currently-filtered earnings summary,
                  // one row per counselor.
                  const filtered = (earningsData.counselors || [])
                    .filter((c:any) => earningsFilter === 'all' || (earningsFilter === 'owed' && c.owed_cents > 0) || (earningsFilter === 'paid' && c.owed_cents === 0));
                  const cols: CsvColumn<any>[] = [
                    { header: 'Counselor ID', value: r => r.id },
                    { header: 'Display Name', value: r => r.display_name },
                    { header: 'Email', value: r => r.email },
                    { header: 'Hourly Rate USD', value: r => ((r.hourly_rate||0)/100).toFixed(2) },
                    { header: 'Earned USD', value: r => ((r.earned_cents||0)/100).toFixed(2) },
                    { header: 'Payable USD', value: r => ((r.payable_cents||0)/100).toFixed(2) },
                    { header: 'Owed USD', value: r => ((r.owed_cents||0)/100).toFixed(2) },
                    { header: 'Paid USD', value: r => ((r.paid_cents||0)/100).toFixed(2) },
                    { header: 'Hours Worked', value: r => r.hours_worked },
                    { header: 'Active Assignments', value: r => (r.assignments||[]).filter((a:any)=>a.status==='active').length },
                    { header: 'Stripe Connected', value: r => r.stripe_connect_account_id ? 'Y' : 'N' },
                  ];
                  downloadCsv('admitly_earnings', filtered, cols);
                }}
                  style={ss({padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-700)',display:'flex',alignItems:'center',gap:4})}>
                  <i className="fas fa-file-export" style={{fontSize:9}}></i>Export CSV
                </button>
                <button onClick={()=>{setEarningsData(null);fetch('/api/admin?view=earnings',{cache:'no-store'}).then(r=>r.json()).then(d=>setEarningsData(d));}}
                  style={ss({padding:'5px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)',display:'flex',alignItems:'center',gap:4})}>
                  <i className="fas fa-rotate" style={{fontSize:9}}></i>Refresh
                </button>
              </div>

              {/* Counselor earnings table */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                  <thead><tr style={{background:'var(--stone-50)'}}>
                    {['Counselor','Email','Payout','Rate','Outstanding','Pipeline',''].map(h=><th key={h} style={thS}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(earningsData.counselors||[])
                      .filter((c:any) => earningsFilter === 'all' || (earningsFilter === 'owed' && c.owed_cents > 0) || (earningsFilter === 'paid' && c.owed_cents === 0))
                      .map((c:any) => {
                        const isExpanded = expandedEarningsId === c.id;
                        const pipelineCents = Math.max(0, c.earned_cents - c.payable_cents);
                        const unpaidAssignments = (c.assignments||[]).filter((a:any)=>a.payable&&a.payable_cents>0);
                        const allPayouts = c.payouts || [];
                        return (
                          <Fragment key={c.id}>
                            <tr onClick={()=>setExpandedEarningsId(isExpanded?null:c.id)} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:isExpanded?'#fefce8':'transparent'}}>
                              <td style={ss({...tdS,fontWeight:700})}>{c.display_name}</td>
                              <td style={ss({...tdS,fontSize:11,color:'var(--stone-500)'})}>{c.email}</td>
                              <td style={tdS}>{c.stripe_connect_account_id?<span style={ss({color:'#059669',fontWeight:700,fontSize:10})}><i className="fas fa-check-circle" style={{marginRight:3}}></i>Stripe</span>:<span style={ss({color:'var(--stone-300)',fontSize:10})}>None</span>}</td>
                              <td style={ss({...tdS,fontSize:13,fontWeight:700})}>${((c.hourly_rate||5000)/100).toFixed(0)}/hr</td>
                              <td style={ss({...tdS,fontSize:13,fontWeight:700,color:c.owed_cents>0?'#d97706':'var(--stone-400)'})}>${(c.owed_cents/100).toFixed(0)}</td>
                              <td style={ss({...tdS,fontSize:13,color:'var(--stone-500)'})}>${(pipelineCents/100).toFixed(0)}</td>
                              <td style={ss({...tdS,textAlign:'center'})} onClick={e=>e.stopPropagation()}>
                                {c.owed_cents > 0 ? (
                                  <span style={ss({padding:'4px 10px',borderRadius:6,fontSize:10,fontWeight:700,background:'var(--amber-light)',color:'#92400e'})}>${(c.owed_cents/100).toFixed(0)} owed</span>
                                ) : (
                                  <span style={ss({padding:'4px 10px',borderRadius:6,fontSize:10,fontWeight:700,background:'var(--emerald-light)',color:'#065f46'})}>Paid</span>
                                )}
                              </td>
                            </tr>
                            {/* Expanded: Unpaid assignments + Payment history */}
                            {isExpanded && (
                              <tr><td colSpan={7} style={{padding:0}}>
                                <div style={ss({padding:'16px 20px',background:'#fefce8',borderBottom:'2px solid #fde68a'})}>
                                  {/* Completed Plans (Not Paid) with checkboxes */}
                                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8})}>
                                    <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase'})}>Completed Plans — Not Paid ({unpaidAssignments.length})</div>
                                    {unpaidAssignments.length>0&&(selectedPayPlans[c.id]||[]).length>0&&(
                                      <button onClick={()=>{
                                        const selected = unpaidAssignments.filter((a:any)=>(selectedPayPlans[c.id]||[]).includes(a.id));
                                        const totalCents = selected.reduce((s:number,a:any)=>s+a.payable_cents,0);
                                        const totalHours = selected.reduce((s:number,a:any)=>s+(a.hours||0),0);
                                        setPayModalCounselor({...c,selectedPlans:selected,totalCents,totalHours});
                                        setPayModalNotes('');
                                        setPayModalMethod(c.stripe_connect_account_id?'stripe_connect':'offline');
                                        setPayModalAmountOverride((totalCents/100).toFixed(2));
                                      }} style={ss({padding:'5px 14px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6})}>
                                        <i className="fas fa-dollar-sign" style={{fontSize:9}}></i>Pay {(selectedPayPlans[c.id]||[]).length} plan{(selectedPayPlans[c.id]||[]).length!==1?'s':''} (${(unpaidAssignments.filter((a:any)=>(selectedPayPlans[c.id]||[]).includes(a.id)).reduce((s:number,a:any)=>s+a.payable_cents,0)/100).toFixed(0)})
                                      </button>
                                    )}
                                  </div>
                                  {unpaidAssignments.length>0?(
                                    <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:11,background:'var(--card)',borderRadius:8,overflow:'hidden',marginBottom:16})}>
                                      <thead><tr style={{background:'var(--stone-50)'}}>
                                        <th style={{...thS,fontSize:9,padding:'6px 10px',width:30}} onClick={e=>e.stopPropagation()}>
                                          <input type="checkbox" checked={unpaidAssignments.length>0&&(selectedPayPlans[c.id]||[]).length===unpaidAssignments.length}
                                            onChange={e=>{const ids=e.target.checked?unpaidAssignments.map((a:any)=>a.id):[];setSelectedPayPlans(p=>({...p,[c.id]:ids}));}}
                                            style={{cursor:'pointer'}} />
                                        </th>
                                        {['Student','Plan','Sessions','Start','End','Balance'].map(h=><th key={h} style={{...thS,fontSize:9,padding:'6px 10px'}}>{h}</th>)}
                                      </tr></thead>
                                      <tbody>
                                        {unpaidAssignments.map((a:any)=>{
                                          const checked = (selectedPayPlans[c.id]||[]).includes(a.id);
                                          return (
                                            <tr key={a.id} style={{borderBottom:'1px solid var(--border-light)',background:checked?'#fefce8':'transparent'}}>
                                              <td style={ss({padding:'6px 10px'})} onClick={e=>e.stopPropagation()}>
                                                <input type="checkbox" checked={checked}
                                                  onChange={()=>setSelectedPayPlans(p=>{const cur=p[c.id]||[];return {...p,[c.id]:checked?cur.filter(id=>id!==a.id):[...cur,a.id]};})}
                                                  style={{cursor:'pointer'}} />
                                              </td>
                                              <td style={ss({padding:'6px 10px',fontWeight:600})}>{a.student_name}</td>
                                              <td style={ss({padding:'6px 10px'})}>{a.plan}</td>
                                              <td style={ss({padding:'6px 10px',fontWeight:700})}>{a.sessions_used}/{a.sessions_total}</td>
                                              <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-400)'})}>{a.start_date?new Date(a.start_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'}</td>
                                              <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-400)'})}>{a.end_date?new Date(a.end_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'}</td>
                                              <td style={ss({padding:'6px 10px',fontWeight:700,color:'#d97706'})}>${(a.payable_cents/100).toFixed(0)}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  ):<div style={ss({padding:'10px',fontSize:11,color:'var(--stone-400)',textAlign:'center',marginBottom:16})}>No unpaid completed plans</div>}

                                  {/* Payment History */}
                                  <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:8})}>Payment History ({allPayouts.length})</div>
                                  {allPayouts.length>0?(
                                    <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:11,background:'var(--card)',borderRadius:8,overflow:'hidden'})}>
                                      <thead><tr style={{background:'var(--stone-50)'}}>
                                        {['Payment Date','Student','Plan','Sessions','Amount','Payment ID','Notes'].map(h=><th key={h} style={{...thS,fontSize:9,padding:'6px 10px'}}>{h}</th>)}
                                      </tr></thead>
                                      <tbody>
                                        {allPayouts.map((p:any,i:number)=>{
                                          const noteText = p.notes || '';
                                          const studentMatch = noteText.match(/Student: ([^,]+)/);
                                          const planMatch = noteText.match(/Plan: ([^|]+)/);
                                          const userNotes = noteText.includes('|') ? noteText.split('|').slice(-1)[0].trim() : '';
                                          // Find the assignment to get session count
                                          const linkedAssignment = p.assignment_id ? (c.assignments||[]).find((a:any)=>a.id===p.assignment_id) : null;
                                          return (
                                            <tr key={p.id||i} style={{borderBottom:'1px solid var(--border-light)'}}>
                                              <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-500)'})}>{p.paid_at?new Date(p.paid_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'—'}</td>
                                              <td style={ss({padding:'6px 10px',fontWeight:600})}>{studentMatch?studentMatch[1].trim():'—'}</td>
                                              <td style={ss({padding:'6px 10px'})}>{planMatch?planMatch[1].trim():'—'}</td>
                                              <td style={ss({padding:'6px 10px',fontWeight:700})}>{linkedAssignment?`${linkedAssignment.sessions_used}/${linkedAssignment.sessions_total}`:(p.hours?`${p.hours}h`:'—')}</td>
                                              <td style={ss({padding:'6px 10px',fontWeight:700,color:'#059669'})}>${((p.amount_cents||0)/100).toFixed(0)}</td>
                                              <td style={ss({padding:'6px 10px',fontSize:9,fontFamily:'monospace',color:p.stripe_transfer_id?'#2563eb':'var(--stone-400)'})}>{p.stripe_transfer_id||'Offline'}</td>
                                              <td style={ss({padding:'6px 10px',fontSize:10,color:'var(--stone-500)',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{userNotes||'—'}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  ):<div style={ss({padding:'10px',fontSize:11,color:'var(--stone-400)',textAlign:'center'})}>No payments recorded</div>}
                                </div>
                              </td></tr>
                            )}
                          </Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ═══ ACTIVITY LOG ═══ */}
          {tab === 'activity' && !activityData && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading activity log…
            </div>
          )}
          {tab === 'activity' && activityData && (()=>{
            // Build assignment-level summary
            const assignMap = new Map<number,any>();
            for (const a of (activityData.assignments||[])) {
              assignMap.set(a.assignment_id, { ...a, messages:[] as any[], actions:[] as any[], notes:[] as any[], sessions:[] as any[], last_activity:'', pii_flags:[] as string[], msg_count:0, action_count:0, note_count:0, session_count:0 });
            }
            const piiPatterns = [
              { name:'Email', regex:/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i },
              { name:'Phone', regex:/\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/ },
              { name:'SSN', regex:/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/ },
            ];
            const detectPII = (text:string) => piiPatterns.filter(p=>p.regex.test(text||'')).map(p=>p.name);

            for (const act of (activityData.activities||[])) {
              const entry = assignMap.get(act.assignment_id);
              if (!entry) continue;
              const pii = detectPII(act.content||act.title||'');
              if (pii.length) entry.pii_flags.push(...pii);
              if (!entry.last_activity || new Date(act.created_at) > new Date(entry.last_activity)) entry.last_activity = act.created_at;
              if (act.activity_type==='message') { entry.messages.push(act); entry.msg_count++; }
              else if (act.activity_type==='session') { entry.sessions.push(act); entry.session_count++; }
              else if (act.activity_type==='action') { entry.actions.push(act); entry.action_count++; }
              else if (act.activity_type==='note') { entry.notes.push(act); entry.note_count++; }
            }

            let rows = Array.from(assignMap.values()).filter(r=>r.msg_count+r.action_count+r.note_count+r.session_count>0);
            // Status filter
            if (activityStatusFilter !== 'all') rows = rows.filter(r => r.status === activityStatusFilter);
            // Date filter
            if (activityDateFrom) rows = rows.filter(r=>r.last_activity && new Date(r.last_activity)>=new Date(activityDateFrom));
            if (activityDateTo) rows = rows.filter(r=>r.last_activity && new Date(r.last_activity)<=new Date(activityDateTo+'T23:59:59'));
            // Sort
            const dir = activitySortDir==='asc'?1:-1;
            rows.sort((a,b)=>{
              const f = activitySortField;
              if(f==='last_activity') return dir*(new Date(a.last_activity||0).getTime()-new Date(b.last_activity||0).getTime());
              if(f==='student') return dir*(a.student_name||'').localeCompare(b.student_name||'');
              if(f==='counselor') return dir*(a.counselor_name||'').localeCompare(b.counselor_name||'');
              if(f==='status') return dir*(a.status||'').localeCompare(b.status||'');
              if(f==='messages') return dir*(a.msg_count-b.msg_count);
              if(f==='actions') return dir*(a.action_count-b.action_count);
              if(f==='sessions') return dir*(a.session_count-b.session_count);
              return 0;
            });

            const totalPII = rows.filter(r=>r.pii_flags.length>0).length;
            const toggleSort = (field:string) => { if(activitySortField===field) setActivitySortDir(d=>d==='asc'?'desc':'asc'); else { setActivitySortField(field); setActivitySortDir('desc'); } };
            const sortIcon = (field:string) => activitySortField===field ? (activitySortDir==='asc'?'fa-sort-up':'fa-sort-down') : 'fa-sort';

            return (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Top bar: date filter + AI summarize */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'})}>
                <div style={ss({display:'flex',alignItems:'center',gap:4})}>
                  <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)'})}>Date:</span>
                  <input type="date" value={activityDateFrom} onChange={e=>setActivityDateFrom(e.target.value)} style={{...inputA,fontSize:11,padding:'5px 8px',width:130}} />
                  <span style={ss({fontSize:10,color:'var(--stone-300)'})}>→</span>
                  <input type="date" value={activityDateTo} onChange={e=>setActivityDateTo(e.target.value)} style={{...inputA,fontSize:11,padding:'5px 8px',width:130}} />
                </div>
                {(activityDateFrom||activityDateTo)&&<button onClick={()=>{setActivityDateFrom('');setActivityDateTo('');}} style={ss({padding:'4px 10px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:10,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'var(--stone-500)'})}><i className="fas fa-times" style={{fontSize:8,marginRight:4}}></i>Clear</button>}
                <div style={ss({marginLeft:'auto',display:'flex',alignItems:'center',gap:8})}>
                  {totalPII>0&&<span style={ss({display:'inline-flex',alignItems:'center',gap:4,padding:'4px 10px',borderRadius:8,fontSize:10,fontWeight:700,background:'#fef2f2',color:'#dc2626'})}><i className="fas fa-shield-halved" style={{fontSize:9}}></i>{totalPII} PII flagged</span>}
                  <span style={ss({fontSize:11,color:'var(--stone-400)'})}>{rows.length} assignments</span>
                  <button disabled={activitySummarizing} onClick={async()=>{
                    setActivitySummarizing(true); setActivitySummary('');
                    try {
                      const res = await fetch('/api/admin/summarize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({date_from:activityDateFrom,date_to:activityDateTo,assignment_id:expandedActivityId?String(expandedActivityId):'all'})});
                      const data = await res.json();
                      setActivitySummary(data.summary||'No summary available.');
                    } catch { setActivitySummary('Failed to generate summary.'); }
                    setActivitySummarizing(false);
                  }} style={ss({padding:'6px 14px',borderRadius:8,border:'none',background:activitySummarizing?'var(--stone-200)':'#7c3aed',color:'#fff',fontSize:11,fontWeight:700,cursor:activitySummarizing?'wait':'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6})}>
                    <i className={`fas ${activitySummarizing?'fa-spinner fa-spin':'fa-wand-magic-sparkles'}`} style={{fontSize:9}}></i>{activitySummarizing?'Summarizing…':'AI Summary'}
                  </button>
                </div>
              </div>

              {/* AI Summary panel */}
              {activitySummary&&<div style={ss({background:'var(--card)',border:'1px solid #ddd6fe',borderRadius:'var(--radius)',padding:'14px 20px'})}>

              {/* Status filters */}
              <div style={ss({display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'})}>
                <span style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)'})}>Status:</span>
                {[
                  {id:'all',label:'All',color:'var(--stone-500)',bg:'var(--stone-100)'},
                  {id:'active',label:'Active',color:'#059669',bg:'#ecfdf5'},
                  {id:'pending_acceptance',label:'Pending',color:'#d97706',bg:'#fffbeb'},
                  {id:'completed',label:'Completed',color:'#2563eb',bg:'#eff6ff'},
                  {id:'paused',label:'Paused',color:'#6366f1',bg:'#eef2ff'},
                  {id:'cancelled',label:'Cancelled',color:'#ef4444',bg:'#fef2f2'},
                  {id:'switched',label:'Switched',color:'#78716c',bg:'#f5f5f4'},
                ].map(s=>(
                  <button key={s.id} onClick={()=>setActivityStatusFilter(s.id)}
                    style={ss({padding:'3px 10px',borderRadius:6,border:'none',cursor:'pointer',fontFamily:'inherit',fontSize:10,fontWeight:700,transition:'all .1s',
                      background:activityStatusFilter===s.id?s.bg:'transparent',
                      color:activityStatusFilter===s.id?s.color:'var(--stone-400)',
                      outline:activityStatusFilter===s.id?`1px solid ${s.color}`:'none',
                    })}>{s.label}</button>
                ))}
              </div>
                <div style={ss({display:'flex',alignItems:'center',gap:6,marginBottom:8})}><i className="fas fa-wand-magic-sparkles" style={{color:'#7c3aed',fontSize:11}}></i><span style={ss({fontSize:12,fontWeight:800,color:'#7c3aed'})}>AI Summary</span>
                  <button onClick={()=>setActivitySummary('')} style={ss({marginLeft:'auto',padding:'2px 8px',borderRadius:6,border:'1px solid var(--border)',background:'var(--card)',fontSize:9,cursor:'pointer',color:'var(--stone-400)',fontFamily:'inherit'})}>Dismiss</button>
                </div>
                <div style={ss({fontSize:12,lineHeight:1.7,color:'var(--stone-700)',whiteSpace:'pre-wrap'})}>{activitySummary}</div>
              </div>}

              {/* Assignment-level table */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <table style={ss({width:'100%',borderCollapse:'collapse',fontSize:12})}>
                  <thead><tr style={{background:'var(--stone-50)'}}>
                    {[
                      {key:'plan',label:'Plan',sortable:false},
                      {key:'status',label:'Status',sortable:true},
                      {key:'counselor',label:'Counselor',sortable:true},
                      {key:'student',label:'Student',sortable:true},
                      {key:'last_activity',label:'Last Activity',sortable:true},
                      {key:'messages',label:'Messages',sortable:true},
                      {key:'actions',label:'Actions',sortable:true},
                      {key:'sessions',label:'Sessions',sortable:true},
                      {key:'notes',label:'Notes',sortable:false},
                      {key:'pii',label:'PII',sortable:false},
                    ].map(h=>(
                      <th key={h.key} style={{...thS,cursor:h.sortable?'pointer':'default',userSelect:'none'}} onClick={()=>h.sortable&&toggleSort(h.key)}>
                        {h.label} {h.sortable&&<i className={`fas ${sortIcon(h.key)}`} style={{fontSize:8,marginLeft:3,opacity:.5}}></i>}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {rows.map(r=>{
                      const isExp = expandedActivityId===r.assignment_id;
                      const uniquePII = Array.from(new Set(r.pii_flags));
                      return (
                        <Fragment key={r.assignment_id}>
                        <tr onClick={()=>setExpandedActivityId(isExp?null:r.assignment_id)} style={{borderBottom:'1px solid var(--border-light)',cursor:'pointer',background:isExp?'#fefce8':'transparent'}}>
                          <td style={ss({...tdS,fontWeight:700})}>{r.plan}</td>
                          <td style={tdS}>{(()=>{const sc:{[k:string]:{bg:string;color:string;label:string}} = {active:{bg:'#ecfdf5',color:'#059669',label:'Active'},pending_acceptance:{bg:'#fffbeb',color:'#d97706',label:'Pending'},completed:{bg:'#eff6ff',color:'#2563eb',label:'Done'},paused:{bg:'#eef2ff',color:'#6366f1',label:'Paused'},cancelled:{bg:'#fef2f2',color:'#ef4444',label:'Cancelled'},switched:{bg:'#f5f5f4',color:'#78716c',label:'Switched'}};const s=sc[r.status]||{bg:'#f5f5f4',color:'#78716c',label:r.status};return <span style={ss({padding:'2px 7px',borderRadius:4,fontSize:9,fontWeight:700,background:s.bg,color:s.color})}>{s.label}</span>;})()}</td>
                          <td style={ss({...tdS,color:'var(--stone-600)'})}>{r.counselor_name}</td>
                          <td style={ss({...tdS,fontWeight:600})}>{r.student_name}</td>
                          <td style={ss({...tdS,fontSize:10,color:'var(--stone-400)'})}>{r.last_activity?new Date(r.last_activity).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit'}):'—'}</td>
                          <td style={ss({...tdS,textAlign:'center',fontWeight:700,color:r.msg_count>0?'#2563eb':'var(--stone-300)'})}>{r.msg_count}</td>
                          <td style={ss({...tdS,textAlign:'center',fontWeight:700,color:r.action_count>0?'#d97706':'var(--stone-300)'})}>{r.action_count}</td>
                          <td style={ss({...tdS,textAlign:'center',fontWeight:700,color:r.session_count>0?'#7c3aed':'var(--stone-300)'})}>{r.session_count}</td>
                          <td style={ss({...tdS,textAlign:'center',color:r.note_count>0?'#059669':'var(--stone-300)'})}>{r.note_count}</td>
                          <td style={tdS}>{uniquePII.length>0?<span style={ss({padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:700,background:'#fef2f2',color:'#dc2626'})}><i className="fas fa-exclamation-triangle" style={{fontSize:7,marginRight:3}}></i>{uniquePII.length}</span>:<span style={ss({color:'var(--stone-200)',fontSize:10})}>—</span>}</td>
                        </tr>
                        {/* Expanded detail view */}
                        {isExp&&(
                          <tr><td colSpan={10} style={{padding:0}}>
                            <div style={ss({padding:'16px 20px',background:'#fefce8',borderBottom:'2px solid #fde68a'})}>
                              {/* Messages — 2 column layout */}
                              {r.messages.length>0&&<>
                                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:8})}>Messages ({r.messages.length})</div>
                                <div style={ss({maxHeight:300,overflowY:'auto',marginBottom:16,background:'var(--card)',borderRadius:8,border:'1px solid var(--border)',padding:'10px 14px'})}>
                                  {r.messages.sort((a:any,b:any)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()).map((m:any,i:number)=>{
                                    const isCounselor = m.type_detail==='counselor';
                                    const pii = detectPII(m.content);
                                    return (
                                      <div key={i} style={ss({display:'flex',flexDirection:isCounselor?'row':'row-reverse',marginBottom:8,gap:8})}>
                                        <div style={ss({maxWidth:'65%',padding:'8px 12px',borderRadius:10,fontSize:11,lineHeight:1.5,
                                          background:isCounselor?'#eff6ff':'#f5f3ff',
                                          color:'var(--stone-700)',
                                          borderBottomLeftRadius:isCounselor?0:10,
                                          borderBottomRightRadius:isCounselor?10:0,
                                        })}>
                                          <div style={ss({fontSize:9,fontWeight:700,color:isCounselor?'#2563eb':'#7c3aed',marginBottom:3})}>{isCounselor?r.counselor_name:r.student_name} · {new Date(m.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div>
                                          {m.content}
                                          {pii.length>0&&<div style={ss({marginTop:4})}><span style={ss({padding:'1px 6px',borderRadius:4,fontSize:8,fontWeight:700,background:'#fef2f2',color:'#dc2626'})}>{pii.join(', ')}</span></div>}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>}
                              {/* Sessions */}
                              {r.sessions.length>0&&<>
                                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:6})}>Sessions ({r.sessions.length})</div>
                                <div style={ss({display:'flex',gap:8,flexWrap:'wrap',marginBottom:16})}>
                                  {r.sessions.map((s:any,i:number)=>(
                                    <div key={i} style={ss({padding:'8px 12px',borderRadius:8,background:'var(--card)',border:'1px solid var(--border)',fontSize:11,minWidth:160})}>
                                      <div style={ss({fontWeight:700})}>{s.content||'Session'}</div>
                                      <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:2})}>{s.session_date?(() => { const p=(s.session_date||'').split('T')[0].split('-'); return p.length===3?new Date(+p[0],+p[1]-1,+p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'; })() :'—'} · {s.session_time||''}</div>
                                      <span style={ss({display:'inline-block',marginTop:4,padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:700,background:s.type_detail==='completed'?'#eff6ff':s.type_detail==='upcoming'?'#ecfdf5':'var(--stone-100)',color:s.type_detail==='completed'?'#2563eb':s.type_detail==='upcoming'?'#059669':'var(--stone-500)'})}>{s.type_detail}</span>
                                    </div>
                                  ))}
                                </div>
                              </>}
                              {/* Action Items */}
                              {r.actions.length>0&&<>
                                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:6})}>Action Items ({r.actions.length})</div>
                                <div style={ss({marginBottom:16,background:'var(--card)',borderRadius:8,border:'1px solid var(--border)',overflow:'hidden'})}>
                                  {r.actions.map((a:any,i:number)=>(
                                    <div key={i} style={ss({padding:'6px 12px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:8,fontSize:11})}>
                                      <i className={`fas ${a.type_detail?'fa-check-circle':'fa-circle'}`} style={{color:a.type_detail?'#059669':'#d97706',fontSize:10}}></i>
                                      <span style={ss({flex:1,color:'var(--stone-700)'})}>{a.content}</span>
                                      <span style={ss({fontSize:9,color:'var(--stone-400)'})}>{a.assigned_by}</span>
                                      {detectPII(a.content).length>0&&<span style={ss({padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:'#fef2f2',color:'#dc2626'})}>PII</span>}
                                    </div>
                                  ))}
                                </div>
                              </>}
                              {/* Notes */}
                              {r.notes.length>0&&<>
                                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:6})}>Shared Notes ({r.notes.length})</div>
                                <div style={ss({background:'var(--card)',borderRadius:8,border:'1px solid var(--border)',overflow:'hidden'})}>
                                  {r.notes.map((n:any,i:number)=>(
                                    <div key={i} style={ss({padding:'8px 12px',borderBottom:'1px solid var(--border-light)',fontSize:11})}>
                                      <div style={ss({fontWeight:700,color:'var(--stone-800)',marginBottom:2})}>{n.title||'Untitled'} <span style={ss({fontWeight:500,color:'var(--stone-400)',fontSize:10})}>by {n.type_detail}</span></div>
                                      <div style={ss({color:'var(--stone-600)',lineHeight:1.5,maxHeight:60,overflow:'hidden'})}>{n.content}</div>
                                      {detectPII(n.content).length>0&&<span style={ss({display:'inline-block',marginTop:3,padding:'1px 5px',borderRadius:4,fontSize:8,fontWeight:700,background:'#fef2f2',color:'#dc2626'})}>PII: {detectPII(n.content).join(', ')}</span>}
                                    </div>
                                  ))}
                                </div>
                              </>}
                            </div>
                          </td></tr>
                        )}
                        </Fragment>
                      );
                    })}
                    {rows.length===0&&<tr><td colSpan={10} style={ss({...tdS,textAlign:'center',color:'var(--stone-400)',padding:'30px 20px'})}>No activity found</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })()}

          {/* ═══ USER JOURNEY ═══ */}
          {tab === 'journey' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Search bar */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'18px 22px'})}>
                <div style={ss({display:'flex',gap:10,alignItems:'center'})}>
                  <div style={ss({flex:1,position:'relative'})}>
                    <i className="fas fa-search" style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'var(--stone-300)',fontSize:11,pointerEvents:'none'}}></i>
                    <input value={journeySearch} onChange={e=>{
                      setJourneySearch(e.target.value);setJourneyUser(null);setJourneyEvents([]);
                      const q=e.target.value;
                      if(q.length<2){setJourneyUsers([]);return;}
                      setJourneySearching(true);
                      fetch(`/api/admin/journey?search=${encodeURIComponent(q)}&role=${journeyRole}`).then(r=>r.json()).then(d=>{setJourneyUsers(d.users||[]);setJourneySearching(false);}).catch(()=>{setJourneyUsers([]);setJourneySearching(false);});
                    }} placeholder="Search by name or email…" style={{...inputA,width:'100%',paddingLeft:32}} />
                  </div>
                  <div style={ss({display:'flex',background:'var(--stone-50)',borderRadius:8,padding:3})}>
                    {(['all','student','counselor'] as const).map(r=>(
                      <button key={r} onClick={()=>{setJourneyRole(r);setJourneyUser(null);setJourneyEvents([]);setJourneyUsers([]);if(journeySearch.length>=2){setJourneySearching(true);fetch(`/api/admin/journey?search=${encodeURIComponent(journeySearch)}&role=${r}`).then(r2=>r2.json()).then(d=>{setJourneyUsers(d.users||[]);setJourneySearching(false);}).catch(()=>{setJourneySearching(false);});}}}
                        style={ss({padding:'6px 14px',borderRadius:6,fontSize:11,fontWeight:700,border:'none',fontFamily:'inherit',cursor:'pointer',textTransform:'capitalize',
                          background:journeyRole===r?'var(--card)':'transparent',color:journeyRole===r?'var(--stone-900)':'var(--stone-400)',
                          boxShadow:journeyRole===r?'0 1px 2px rgba(0,0,0,.06)':'none'})}>{r}</button>
                    ))}
                  </div>
                </div>
                {/* Search results */}
                {journeySearch.length>=2&&!journeyUser&&(
                  <div style={ss({marginTop:10})}>
                    {journeySearching&&<div style={ss({fontSize:11,color:'var(--stone-400)',padding:'6px 0'})}><i className="fas fa-spinner fa-spin" style={{marginRight:6}}></i>Searching…</div>}
                    {!journeySearching&&journeyUsers.length===0&&<div style={ss({fontSize:11,color:'var(--stone-400)',padding:'6px 0'})}>No users found</div>}
                    {!journeySearching&&journeyUsers.map((u:any)=>{
                      const sc:{[k:string]:{l:string;bg:string;c:string}}={free:{l:'Free',bg:'var(--stone-50)',c:'var(--stone-400)'},pro:{l:'Pro',bg:'#eff6ff',c:'#2563eb'},premium:{l:'Premium',bg:'#f5f3ff',c:'#7c3aed'}};
                      const s=sc[u.subscription_status]||sc.free;
                      return(
                        <div key={u.id} onClick={async()=>{
                          setJourneyUser(u);setJourneyLoading(true);
                          const r=await fetch(`/api/admin/journey?user_id=${u.id}`);const d=await r.json();
                          setJourneyEvents(d.events||[]);setJourneyLoading(false);
                        }} style={ss({display:'flex',alignItems:'center',gap:10,padding:'8px 10px',borderRadius:8,cursor:'pointer',transition:'background .1s'})}
                          onMouseEnter={e=>(e.currentTarget as HTMLElement).style.background='var(--stone-50)'}
                          onMouseLeave={e=>(e.currentTarget as HTMLElement).style.background='transparent'}>
                          <div style={ss({width:32,height:32,borderRadius:8,background:u.role==='counselor'?'#eff6ff':'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:800,color:u.role==='counselor'?'#2563eb':'var(--stone-400)',flexShrink:0})}>{(u.name||'?')[0].toUpperCase()}</div>
                          <div style={ss({flex:1,minWidth:0})}>
                            <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)'})}>{u.name}</div>
                            <div style={ss({fontSize:10,color:'var(--stone-400)'})}>{u.email}</div>
                          </div>
                          <span style={ss({fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:6,textTransform:'capitalize',background:u.role==='counselor'?'#eff6ff':'var(--stone-50)',color:u.role==='counselor'?'#2563eb':'var(--stone-400)'})}>{u.role}</span>
                          <span style={ss({fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:6,background:s.bg,color:s.c})}>{s.l}</span>
                          <i className="fas fa-chevron-right" style={{fontSize:8,color:'var(--stone-300)'}}></i>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Selected user header */}
              {journeyUser&&(
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'16px 22px',display:'flex',alignItems:'center',gap:14})}>
                  <div style={ss({width:44,height:44,borderRadius:12,background:journeyUser.role==='counselor'?'#eff6ff':'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,fontWeight:900,color:journeyUser.role==='counselor'?'#2563eb':'#FFE500',flexShrink:0})}>{(journeyUser.name||'?')[0].toUpperCase()}</div>
                  <div style={ss({flex:1})}>
                    <div style={ss({fontSize:15,fontWeight:800,color:'var(--stone-900)'})}>{journeyUser.name}</div>
                    <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:1})}>{journeyUser.email}</div>
                  </div>
                  {(()=>{const sc:{[k:string]:{l:string;bg:string;c:string}}={free:{l:'Free',bg:'var(--stone-50)',c:'var(--stone-400)'},pro:{l:'Pro',bg:'#eff6ff',c:'#2563eb'},premium:{l:'Premium',bg:'#f5f3ff',c:'#7c3aed'}};const s=sc[journeyUser.subscription_status]||sc.free;return<span style={ss({fontSize:10,fontWeight:700,padding:'4px 10px',borderRadius:8,background:s.bg,color:s.c})}>{s.l}</span>;})()}
                  <span style={ss({fontSize:10,fontWeight:700,padding:'4px 10px',borderRadius:8,textTransform:'capitalize',background:journeyUser.role==='counselor'?'#eff6ff':'var(--stone-50)',color:journeyUser.role==='counselor'?'#2563eb':'var(--stone-400)'})}>{journeyUser.role}</span>
                  <span style={ss({fontSize:10,color:'var(--stone-400)'})}>Joined {new Date(journeyUser.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
                  <button onClick={()=>{setJourneyUser(null);setJourneyEvents([]);setJourneySearch('');setJourneyUsers([]);}} style={ss({width:28,height:28,borderRadius:8,border:'1px solid var(--border)',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--stone-400)',fontSize:9,fontFamily:'inherit'})}><i className="fas fa-times"></i></button>
                </div>
              )}

              {/* Loading */}
              {journeyLoading&&<div style={ss({textAlign:'center',padding:'48px 0',color:'var(--stone-400)'})}><i className="fas fa-spinner fa-spin" style={{fontSize:18,display:'block',marginBottom:8}}></i><div style={{fontSize:12,fontWeight:600}}>Loading journey…</div></div>}

              {/* Empty state */}
              {journeyUser&&!journeyLoading&&journeyEvents.length===0&&(
                <div style={ss({textAlign:'center',padding:'48px 0',color:'var(--stone-300)'})}><i className="fas fa-route" style={{fontSize:28,display:'block',marginBottom:8,opacity:.3}}></i><div style={{fontSize:13,fontWeight:700,color:'var(--stone-400)'}}>No events yet</div></div>
              )}

              {/* Timeline */}
              {journeyUser&&!journeyLoading&&journeyEvents.length>0&&(()=>{
                const months:Record<string,any[]>={};
                journeyEvents.forEach((e:any)=>{const m=new Date(e.date).toLocaleDateString('en-US',{month:'long',year:'numeric'});if(!months[m])months[m]=[];months[m].push(e);});
                return(
                  <div style={ss({position:'relative'})}>
                    <div style={ss({position:'absolute',left:19,top:0,bottom:0,width:2,background:'var(--border)',zIndex:0})}></div>
                    {Object.entries(months).map(([month,items])=>(
                      <div key={month} style={ss({marginBottom:24})}>
                        <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:12,position:'relative',zIndex:1})}>
                          <div style={ss({width:40,height:22,borderRadius:6,background:'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:800,color:'#FFE500',letterSpacing:.5})}>{month.split(' ')[0].slice(0,3).toUpperCase()}</div>
                          <span style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)'})}>{month}</span>
                          <div style={ss({flex:1,height:1,background:'var(--border)'})}></div>
                          <span style={ss({fontSize:10,fontWeight:600,color:'var(--stone-300)'})}>{items.length}</span>
                        </div>
                        {items.map((ev:any,i:number)=>(
                          <div key={`${ev.date}-${i}`} style={ss({display:'flex',gap:12,marginBottom:10,position:'relative',zIndex:1})}>
                            <div style={ss({width:40,display:'flex',justifyContent:'center',flexShrink:0})}>
                              <div style={ss({width:26,height:26,borderRadius:7,background:ev.color+'18',border:`2px solid ${ev.color}40`,display:'flex',alignItems:'center',justifyContent:'center'})}>
                                <i className={`fas ${ev.icon}`} style={{fontSize:9,color:ev.color}}></i>
                              </div>
                            </div>
                            <div style={ss({flex:1,background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,padding:'10px 14px',minWidth:0})}>
                              <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:8})}>
                                <div style={ss({fontSize:12,fontWeight:700,color:'var(--stone-900)'})}>{ev.title}</div>
                                <span style={ss({fontSize:9,fontWeight:600,color:'var(--stone-400)',flexShrink:0,whiteSpace:'nowrap'})}>{new Date(ev.date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</span>
                              </div>
                              <div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:3,lineHeight:1.5})}>{ev.detail}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Initial empty */}
              {!journeyUser&&!journeySearch&&(
                <div style={ss({textAlign:'center',padding:'60px 0',color:'var(--stone-300)'})}><i className="fas fa-route" style={{fontSize:32,display:'block',marginBottom:10,opacity:.2}}></i><div style={{fontSize:14,fontWeight:700,color:'var(--stone-400)'}}>User Journey</div><div style={{fontSize:12,color:'var(--stone-300)',marginTop:4}}>Search for a student or counselor to view their complete timeline</div></div>
              )}
            </div>
          )}

          {/* ═══ POPULAR COLLEGES ═══ */}
          {tab === 'popular' && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {/* Date range */}
              <div style={ss({display:'flex',alignItems:'center',gap:10,background:'var(--card)',border:'1px solid var(--border)',borderRadius:12,padding:'10px 16px'})}>
                <i className="fas fa-calendar-range" style={{fontSize:11,color:'var(--stone-400)'}}></i>
                <span style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)'})}>Filter range</span>
                <input type="date" value={dateFrom} max={dateTo} onChange={e=>setDateFrom(e.target.value)} style={{...inputA,fontSize:12,padding:'5px 10px'}} />
                <span style={ss({fontSize:11,color:'var(--stone-400)'})}>to</span>
                <input type="date" value={dateTo} min={dateFrom} onChange={e=>setDateTo(e.target.value)} style={{...inputA,fontSize:12,padding:'5px 10px'}} />
                <button onClick={()=>{setDateFrom(thirtyDaysAgo);setDateTo(todayStr);}} style={ss({marginLeft:4,padding:'5px 12px',borderRadius:8,border:'1px solid var(--border)',background:'var(--stone-50)',fontSize:11,fontWeight:700,color:'var(--stone-500)',cursor:'pointer',fontFamily:'inherit'})}>Reset</button>
              </div>

              {/* Summary cards */}
              {(() => {
                const collegeStats = students.reduce((acc, s) => ({
                  total: acc.total + s.college_count,
                  reach: acc.reach + s.reach_count,
                  target: acc.target + s.target_count,
                  safety: acc.safety + s.safety_count,
                  essays: acc.essays + s.essay_count,
                }), { total:0, reach:0, target:0, safety:0, essays:0 });
                return (
                  <div style={ss({display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10})}>
                    <StatCard accent icon="fa-university" label="Total Adds" value={fmt(collegeStats.total)} sub="across all students" />
                    <StatCard icon="fa-arrow-up" label="As Reach" value={fmt(collegeStats.reach)} sub={`${collegeStats.total>0?Math.round(collegeStats.reach/collegeStats.total*100):0}% of adds`} />
                    <StatCard icon="fa-bullseye" label="As Target" value={fmt(collegeStats.target)} sub={`${collegeStats.total>0?Math.round(collegeStats.target/collegeStats.total*100):0}% of adds`} />
                    <StatCard icon="fa-shield-halved" label="As Safety" value={fmt(collegeStats.safety)} sub={`${collegeStats.total>0?Math.round(collegeStats.safety/collegeStats.total*100):0}% of adds`} />
                    <StatCard icon="fa-pen-nib" label="Total Essays" value={fmt(collegeStats.essays)} sub={`avg ${students.length>0?fmt(collegeStats.essays/students.length,1):'0'} per student`} />
                  </div>
                );
              })()}

              {/* Sort + view controls */}
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-university"></i></div>
                    <div><h3 style={ss({fontSize:14,fontWeight:900})}>Top 20 Colleges by Students</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Most added across all buckets</p></div>
                  </div>
                  <div style={ss({display:'flex',gap:8})}>
                    <div style={ss({display:'flex',gap:2,background:'var(--stone-50)',borderRadius:8,padding:2})}>
                      {(['total','reach','target','safety','essays'] as const).map(s => (
                        <button key={s} onClick={()=>setPopularSort(s)}
                          style={ss({padding:'5px 10px',borderRadius:6,border:'none',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',textTransform:'capitalize',background:popularSort===s?'var(--card)':'transparent',color:popularSort===s?'var(--stone-900)':'var(--stone-400)',boxShadow:popularSort===s?'0 1px 3px rgba(0,0,0,.08)':'none'})}
                        >{s}</button>
                      ))}
                    </div>
                    <div style={ss({display:'flex',gap:2,background:'var(--stone-50)',borderRadius:8,padding:2})}>
                      {(['table','bars'] as const).map(v => (
                        <button key={v} onClick={()=>setPopularView(v)}
                          style={ss({padding:'5px 10px',borderRadius:6,border:'none',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',textTransform:'capitalize',background:popularView===v?'var(--card)':'transparent',color:popularView===v?'var(--stone-900)':'var(--stone-400)',boxShadow:popularView===v?'0 1px 3px rgba(0,0,0,.08)':'none'})}
                        >{v}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Note: Real data would come from an API aggregation query. Placeholder shows structure. */}
                <div style={ss({padding:'60px 20px',textAlign:'center'})}>
                  <div style={ss({width:56,height:56,borderRadius:16,background:'var(--stone-50)',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:14})}>
                    <i className="fas fa-university" style={{fontSize:22,color:'var(--stone-300)'}}></i>
                  </div>
                  <div style={ss({fontSize:14,fontWeight:800,color:'var(--stone-700)',marginBottom:4})}>College Popularity Tracking</div>
                  <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',maxWidth:400,margin:'0 auto'})}>
                    This panel will aggregate which colleges students add most frequently, broken down by reach/target/safety bucket and essay count.
                    Requires a new API endpoint: <code style={{background:'var(--stone-100)',padding:'1px 4px',borderRadius:4,fontSize:11}}>GET /api/admin?view=popular_colleges</code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ ACTION ITEMS ═══ */}

          {/* ═══ ENGINE HEALTH ═══ */}
          {tab === 'engine' && !engineData && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading engine health…
            </div>
          )}
          {tab === 'engine' && engineData && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10})}>
                <StatCard accent icon="fa-gauge-high" label="Colleges Saved" value={fmt(engineData.total_saved)} sub={`by ${engineData.students_with_colleges} students`} />
                <StatCard icon="fa-bullseye" label="Bucket Split" value={engineData.bucket_distribution?.map((b:any)=>`${b.cnt}`).join('/') || '—'} sub={engineData.bucket_distribution?.map((b:any)=>b.bucket).join(' / ') || ''} />
                <StatCard icon="fa-graduation-cap" label="Top Program" value={engineData.major_distribution?.[0]?.major || '—'} sub={`${engineData.major_distribution?.[0]?.cnt || 0} students`} />
                <StatCard icon="fa-users" label="Students Using" value={fmt(engineData.students_with_colleges)} sub="ran recommendations" />
              </div>
              <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:14})}>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                  <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-university"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Top Recommended Schools</h3>
                  </div>
                  <div style={ss({padding:'12px 20px'})}>
                    {engineData.top_schools?.slice(0,15).map((s:any,i:number) => (
                      <div key={i} style={ss({display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderBottom:i<14?'1px solid var(--border-light)':'none'})}>
                        <span style={ss({fontSize:11,fontWeight:800,color:'var(--stone-300)',width:20})}>{i+1}</span>
                        <span style={ss({width:10,height:10,borderRadius:5,background:s.bucket==='reach'?'var(--red)':s.bucket==='target'?'#f59e0b':'var(--emerald)',flexShrink:0})}></span>
                        <span style={ss({flex:1,fontSize:12,fontWeight:600})}>{s.name}</span>
                        <span style={ss({fontSize:12,fontWeight:800,color:'var(--stone-600)'})}>×{s.times}</span>
                      </div>
                    ))}
                    {(!engineData.top_schools || engineData.top_schools.length === 0) && <div style={ss({padding:'20px 0',textAlign:'center',color:'var(--stone-400)',fontSize:12})}>No data yet — students need to save colleges</div>}
                  </div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                  <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-flask"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Program Distribution</h3>
                  </div>
                  <div style={ss({padding:'12px 20px'})}>
                    {engineData.major_distribution?.map((m:any,i:number) => {
                      const maxCnt = engineData.major_distribution?.[0]?.cnt || 1;
                      return (
                        <div key={i} style={ss({display:'flex',alignItems:'center',gap:8,marginBottom:8})}>
                          <span style={ss({width:130,fontSize:12,fontWeight:600,color:'var(--stone-600)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'})}>{m.major}</span>
                          <div style={ss({flex:1,height:8,background:'var(--stone-100)',borderRadius:4,overflow:'hidden'})}>
                            <div style={{width:`${m.cnt/maxCnt*100}%`,height:'100%',background:i===0?'var(--pink)':'var(--stone-400)',borderRadius:4,transition:'width .5s'}}></div>
                          </div>
                          <span style={ss({fontSize:11,fontWeight:700,color:'var(--stone-500)',width:30,textAlign:'right'})}>{m.cnt}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ FUNNEL ═══ */}
          {tab === 'funnel' && !funnelData && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading funnel…
            </div>
          )}
          {tab === 'funnel' && funnelData && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20})}>
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:16})}>
                  <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-filter"></i></div>
                  <div><h3 style={ss({fontSize:14,fontWeight:900})}>Student Journey Funnel</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Where are students dropping off?</p></div>
                </div>
                {(() => {
                  const steps = [
                    { label: 'Signed Up', value: funnelData.signups, color: 'var(--stone-900)' },
                    { label: 'Profile Completed', value: funnelData.profile_done, color: '#6366f1' },
                    { label: 'Saved Colleges', value: funnelData.saved_college, color: '#3b82f6' },
                    { label: 'Started Essay', value: funnelData.started_essay, color: '#f59e0b' },
                    { label: 'Submitted Essay', value: funnelData.submitted_essay, color: '#10b981' },
                    { label: 'Purchased Plan', value: funnelData.purchased, color: 'var(--pink)' },
                  ];
                  const max = steps[0].value || 1;
                  return steps.map((s, i) => {
                    const pct = max > 0 ? (s.value / max * 100) : 0;
                    const prev = i > 0 ? steps[i-1].value : null;
                    const dropPct = prev && prev > 0 ? Math.round((prev - s.value) / prev * 100) : null;
                    return (
                      <div key={s.label} style={ss({display:'flex',alignItems:'center',gap:12,padding:'8px 0'})}>
                        <span style={ss({width:130,fontSize:12,fontWeight:700,color:'var(--stone-600)'})}>{s.label}</span>
                        <div style={ss({flex:1,height:28,background:'var(--stone-100)',borderRadius:6,overflow:'hidden'})}>
                          <div style={{width:`${Math.max(pct,2)}%`,height:'100%',background:s.color,borderRadius:6,transition:'width .8s cubic-bezier(.4,0,.2,1)',display:'flex',alignItems:'center',paddingLeft:8}}>
                            {pct > 15 && <span style={ss({fontSize:10,fontWeight:800,color:'#fff'})}>{s.value}</span>}
                          </div>
                        </div>
                        <span style={ss({width:40,fontSize:12,fontWeight:800,textAlign:'right'})}>{pct.toFixed(0)}%</span>
                        {dropPct !== null && dropPct > 0 && <span style={ss({width:45,fontSize:10,fontWeight:700,color:'var(--red)',textAlign:'right'})}>-{dropPct}%</span>}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* ═══ SUBSCRIPTIONS ═══ */}
          {tab === 'subs' && !subsData && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading subscriptions…
            </div>
          )}
          {tab === 'subs' && subsData && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              {(() => {
                const free = subsData.tiers?.find((t:any) => t.tier === 'free')?.cnt || 0;
                const pro = subsData.tiers?.find((t:any) => t.tier === 'pro')?.cnt || 0;
                const premium = subsData.tiers?.find((t:any) => t.tier === 'premium')?.cnt || 0;
                const cancelled = subsData.tiers?.find((t:any) => t.tier === 'cancelled')?.cnt || 0;
                const total = free + pro + premium + cancelled;
                const paid = pro + premium;
                const convRate = total > 0 ? ((paid) / total * 100).toFixed(1) : '0';
                const filteredSubs = (subsData.subscribers || []).filter((u:any) => subsFilter === 'all' || u.subscription_status === subsFilter);
                return (
                  <>
                    {/* Count tiles */}
                    <div style={ss({display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10})}>
                      <StatCard accent icon="fa-users" label="Total Students" value={fmt(total)} sub={`${paid} paying`} />
                      <StatCard icon="fa-user" label="Free" value={fmt(free)} sub={`${total>0?Math.round(free/total*100):0}%`} />
                      <StatCard icon="fa-bolt" label="Pro" value={fmt(pro)} />
                      <StatCard icon="fa-crown" label="Premium" value={fmt(premium)} />
                      <StatCard icon="fa-ban" label="Cancelled" value={fmt(cancelled)} />
                      <StatCard icon="fa-chart-line" label="Conversion" value={`${convRate}%`} sub="free → paid" />
                    </div>

                    {/* Plan filter pills */}
                    <div style={ss({display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'})}>
                      <div style={ss({display:'flex',gap:4})}>
                        {([{id:'all',label:'All',count:total},{id:'free',label:'Free',count:free},{id:'pro',label:'Pro',count:pro},{id:'premium',label:'Premium',count:premium},{id:'cancelled',label:'Cancelled',count:cancelled}] as const).map(f => (
                          <button key={f.id} onClick={()=>setSubsFilter(f.id)}
                            style={ss({display:'inline-flex',alignItems:'center',gap:5,padding:'6px 12px',borderRadius:8,border:subsFilter===f.id?'2px solid var(--stone-900)':'1px solid var(--border)',background:subsFilter===f.id?'var(--stone-900)':'var(--card)',color:subsFilter===f.id?'#fff':'var(--stone-500)',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',transition:'all .1s'})}>
                            {f.label} <span style={ss({fontSize:9,opacity:.7})}>({f.count})</span>
                          </button>
                        ))}
                      </div>
                      {/* Alerts inline */}
                      {subsData.expiring_7d > 0 && <span style={ss({padding:'4px 10px',borderRadius:8,fontSize:10,fontWeight:800,background:'var(--red-light)',color:'#991b1b'})}>{subsData.expiring_7d} expiring in 7d</span>}
                      {subsData.churned_30d > 0 && <span style={ss({padding:'4px 10px',borderRadius:8,fontSize:10,fontWeight:800,background:'var(--stone-100)',color:'var(--stone-500)'})}>{subsData.churned_30d} churned (30d)</span>}
                    </div>

                    {/* Subscriber table */}
                    <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                      <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                        <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                          <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-users"></i></div>
                          <h3 style={ss({fontSize:14,fontWeight:900})}>Subscribers</h3>
                          <span style={ss({fontSize:11,fontWeight:600,color:'var(--stone-400)'})}>{filteredSubs.length} shown</span>
                        </div>
                      </div>
                      {filteredSubs.length > 0 ? (
                        <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                          <thead><tr style={{background:'var(--stone-50)'}}>
                            {['Student','Plan','Assigned Counselor','Subscribed','Expires','Last Login'].map(h=><th key={h} style={thS}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {filteredSubs.map((u:any) => {
                              const isExpired = u.subscription_expires_at && new Date(u.subscription_expires_at) < new Date();
                              const expSoon = u.subscription_expires_at && !isExpired && new Date(u.subscription_expires_at) < new Date(Date.now() + 7*86400000);
                              return (
                                <tr key={u.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                                  <td style={tdS}><div style={ss({fontWeight:700,fontSize:13})}>{u.name}</div><div style={ss({fontSize:11,color:'var(--stone-400)'})}>{u.email}</div></td>
                                  <td style={tdS}>
                                    <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,
                                      background:u.subscription_status==='premium'?'#f5f3ff':u.subscription_status==='pro'?'#eff6ff':u.subscription_status==='cancelled'?'var(--red-light)':'var(--stone-100)',
                                      color:u.subscription_status==='premium'?'#7c3aed':u.subscription_status==='pro'?'#2563eb':u.subscription_status==='cancelled'?'var(--red)':'var(--stone-500)',
                                      textTransform:'uppercase',
                                    })}>{isExpired ? 'EXPIRED' : u.subscription_status}</span>
                                  </td>
                                  <td style={ss({...tdS,fontSize:12,fontWeight:600,color:u.counselor_name?'var(--stone-700)':'var(--stone-300)'})}>{u.counselor_name || '—'}</td>
                                  <td style={ss({...tdS,fontSize:12,color:'var(--stone-500)',whiteSpace:'nowrap'})}>{fmtDate(u.created_at)}</td>
                                  <td style={ss({...tdS,fontSize:12,fontWeight:600,color:expSoon?'var(--red)':isExpired?'var(--stone-300)':'var(--stone-500)'})}>
                                    {u.subscription_expires_at ? fmtDate(u.subscription_expires_at) : '—'}
                                    {expSoon && <span style={ss({fontSize:9,fontWeight:800,color:'var(--red)',marginLeft:4})}>SOON</span>}
                                  </td>
                                  <td style={ss({...tdS,fontSize:12,fontWeight:600,color:u.last_login?'var(--stone-600)':'var(--stone-300)'})}>{fmtDateTime(u.last_login)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      ) : (
                        <div style={ss({padding:'40px 20px',textAlign:'center',color:'var(--stone-400)',fontSize:12})}>No subscribers match this filter</div>
                      )}
                    </div>
                    {/* Pending Counselor Assignment — premium paid but no counselor yet */}
                    {(() => {
                      const pendingStudents = filteredSubs.filter((u:any) => {
                        return u.subscription_status === 'premium' && !u.counselor_name;
                      });
                      if (pendingStudents.length === 0) return null;
                      return (
                        <div style={ss({background:'var(--card)',border:'2px solid #f59e0b',borderRadius:'var(--radius)',overflow:'hidden'})}>
                          <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',background:'#FFFBEB',display:'flex',alignItems:'center',gap:10})}>
                            <div style={ss({width:34,height:34,borderRadius:10,background:'#f59e0b',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontSize:12})}><i className="fas fa-hourglass-half"></i></div>
                            <div>
                              <h3 style={ss({fontSize:14,fontWeight:900})}>Pending Counselor Assignment ({pendingStudents.length})</h3>
                              <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Premium students who paid but have no counselor assigned yet</p>
                            </div>
                            <button onClick={()=>setTab('assignments')} style={ss({marginLeft:'auto',padding:'7px 14px',borderRadius:8,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:5})}>
                              <i className="fas fa-user-plus" style={{fontSize:9}}></i>Assign
                            </button>
                          </div>
                          <table style={ss({width:'100%',borderCollapse:'collapse'})}>
                            <thead><tr style={{background:'var(--stone-50)'}}>
                              {['Student','Plan','Subscribed','Expires','Last Login'].map(h=><th key={h} style={thS}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {pendingStudents.map((u:any) => (
                                <tr key={u.id} style={{borderBottom:'1px solid var(--border-light)'}}>
                                  <td style={tdS}><div style={ss({fontWeight:700,fontSize:13})}>{u.name}</div><div style={ss({fontSize:11,color:'var(--stone-400)'})}>{u.email}</div></td>
                                  <td style={tdS}><span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:'#f5f3ff',color:'#7c3aed',textTransform:'uppercase'})}>PREMIUM</span></td>
                                  <td style={ss({...tdS,fontSize:12,color:'var(--stone-500)',whiteSpace:'nowrap'})}>{fmtDate(u.created_at)}</td>
                                  <td style={ss({...tdS,fontSize:12,color:'var(--stone-500)'})}>{u.subscription_expires_at ? fmtDate(u.subscription_expires_at) : '—'}</td>
                                  <td style={ss({...tdS,fontSize:12,color:u.last_login?'var(--stone-600)':'var(--stone-300)'})}>{fmtDateTime(u.last_login)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}
                  </>
                );
              })()}
            </div>
          )}

          {/* ═══ DATA HEALTH ═══ */}
          {tab === 'data' && !dataHealth && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading data health…
            </div>
          )}
          {tab === 'data' && dataHealth && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-database"></i></div>
                    <div><h3 style={ss({fontSize:14,fontWeight:900})}>Database Tables</h3><p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:1})}>Row counts and status</p></div>
                  </div>
                </div>
                <div style={ss({padding:'8px 20px'})}>
                  {Object.entries(dataHealth.counts||{}).map(([table, cnt]: [string, any], i: number) => (
                    <div key={table} style={ss({display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:i<Object.keys(dataHealth.counts).length-1?'1px solid var(--border-light)':'none'})}>
                      <div style={ss({width:10,height:10,borderRadius:5,background:cnt>=0?'var(--emerald)':'var(--red)',flexShrink:0})}></div>
                      <div style={ss({flex:1})}><span style={ss({fontSize:13,fontWeight:700})}>{table}</span></div>
                      <span style={ss({fontSize:13,fontWeight:800})}>{cnt >= 0 ? cnt.toLocaleString() : 'Missing'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14})}>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,textAlign:'center'})}>
                  <div style={ss({fontSize:28,fontWeight:900,color:'var(--emerald)'})}>
                    {fmt(dataHealth.joinedCount)}
                  </div>
                  <div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:4})}>Schools with program data (ope6_id join)</div>
                  <div style={ss({fontSize:11,color:'var(--stone-400)',marginTop:4})}>{fmt(dataHealth.orphanedCount)} without programs</div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,textAlign:'center'})}>
                  <div style={ss({fontSize:28,fontWeight:900})}>{dataHealth.progNormCount}</div>
                  <div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:4})}>Program_Normalized values</div>
                </div>
                <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:20,textAlign:'center'})}>
                  <div style={ss({fontSize:28,fontWeight:900,color:dataHealth.satCoverage>=70?'var(--emerald)':'#f59e0b'})}>
                    {dataHealth.satCoverage}%
                  </div>
                  <div style={ss({fontSize:11,color:'var(--stone-500)',marginTop:4})}>SAT data coverage (eligible schools)</div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ ERROR LOG ═══ */}
          {tab === 'errors' && !errorLogs && (
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:256,color:'var(--stone-400)',fontSize:13})}>
              <i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading error log…
            </div>
          )}
          {tab === 'errors' && errorLogs && (
            <div style={ss({display:'flex',flexDirection:'column',gap:16})}>
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10})}>
                <StatCard accent icon="fa-triangle-exclamation" label="Errors (24h)" value={String(errorLogs.level_counts?.find((l:any)=>l.level==='error')?.cnt || 0)} />
                <StatCard icon="fa-exclamation" label="Warnings (24h)" value={String(errorLogs.level_counts?.find((l:any)=>l.level==='warn')?.cnt || 0)} />
                <StatCard icon="fa-info-circle" label="Info (24h)" value={String(errorLogs.level_counts?.find((l:any)=>l.level==='info')?.cnt || 0)} />
                <StatCard icon="fa-list" label="Total Entries" value={String(errorLogs.logs?.length || 0)} sub="in log" />
              </div>
              <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',overflow:'hidden'})}>
                <div style={ss({padding:'14px 20px',borderBottom:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                  <div style={ss({display:'flex',alignItems:'center',gap:10})}>
                    <div style={ss({width:34,height:34,borderRadius:10,background:'var(--stone-100)',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--stone-500)',fontSize:12})}><i className="fas fa-scroll"></i></div>
                    <h3 style={ss({fontSize:14,fontWeight:900})}>Recent Events</h3>
                  </div>
                  <div style={ss({display:'flex',gap:2,background:'var(--stone-50)',borderRadius:8,padding:2})}>
                    {(['all','error','warn','info'] as const).map(f=>(
                      <button key={f} onClick={()=>setLogFilter(f)}
                        style={ss({padding:'5px 10px',borderRadius:6,border:'none',fontFamily:'inherit',fontSize:10,fontWeight:700,cursor:'pointer',textTransform:'capitalize',background:logFilter===f?'var(--card)':'transparent',color:logFilter===f?'var(--stone-900)':'var(--stone-400)',boxShadow:logFilter===f?'0 1px 3px rgba(0,0,0,.08)':'none'})}
                      >{f}</button>
                    ))}
                  </div>
                </div>
                <div style={ss({padding:'0 20px'})}>
                  {(errorLogs.logs || []).filter((e:any) => logFilter === 'all' || e.level === logFilter).map((e:any, i:number) => {
                    const ls: Record<string,{bg:string;color:string}> = {error:{bg:'var(--red-light)',color:'var(--red)'},warn:{bg:'var(--amber-light)',color:'#92400e'},info:{bg:'var(--emerald-light)',color:'#065f46'}};
                    const s = ls[e.level] || ls.info;
                    return (
                      <div key={e.id||i} style={ss({display:'flex',alignItems:'flex-start',gap:10,padding:'12px 0',borderBottom:'1px solid var(--border-light)'})}>
                        <span style={ss({padding:'2px 8px',borderRadius:6,fontSize:10,fontWeight:800,background:s.bg,color:s.color,textTransform:'uppercase',flexShrink:0,marginTop:2})}>{e.level}</span>
                        <div style={ss({flex:1})}>
                          <div style={ss({fontSize:13,fontWeight:600})}>{e.message}</div>
                          <div style={ss({fontSize:10,color:'var(--stone-400)',marginTop:2})}>
                            <span style={ss({fontWeight:700})}>{e.source}</span> · {fmtDateTime(e.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!errorLogs.logs || errorLogs.logs.length === 0) && <div style={ss({padding:'40px 0',textAlign:'center',color:'var(--stone-400)',fontSize:12})}>No log entries</div>}
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ═══ PAY MODAL ═══ */}
        {payModalCounselor && (
          <div style={ss({position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999})} onClick={()=>setPayModalCounselor(null)}>
            <div style={ss({background:'#fff',borderRadius:16,width:520,maxHeight:'80vh',overflow:'auto',border:'1px solid #e7e5e4',boxShadow:'0 25px 60px rgba(0,0,0,.15)'})} onClick={e=>e.stopPropagation()}>
              <div style={ss({padding:'20px 24px',borderBottom:'1px solid var(--border-light)'})}>
                <div style={ss({fontSize:16,fontWeight:900})}>Pay {payModalCounselor.display_name}</div>
                <div style={ss({fontSize:12,color:'var(--stone-500)',marginTop:4})}>{payModalCounselor.selectedPlans.length} plan{payModalCounselor.selectedPlans.length!==1?'s':''} selected</div>
              </div>
              <div style={ss({padding:'16px 24px'})}>
                <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',marginBottom:8})}>Plans to pay</div>
                <div style={ss({background:'var(--stone-50)',borderRadius:10,overflow:'hidden',marginBottom:16,border:'1px solid var(--border)'})}>
                  {payModalCounselor.selectedPlans.map((a:any)=>(
                    <div key={a.id} style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 14px',borderBottom:'1px solid var(--border-light)',fontSize:12})}>
                      <div><span style={ss({fontWeight:700})}>{a.student_name}</span> <span style={ss({color:'var(--stone-400)'})}>{a.plan}</span></div>
                      <span style={ss({fontWeight:800,color:'#d97706'})}>${(a.payable_cents/100).toFixed(0)}</span>
                    </div>
                  ))}
                  <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 14px',fontSize:13,fontWeight:800,background:'var(--stone-100)'})}>
                    <span>Total</span>
                    <div style={ss({display:'flex',alignItems:'center',gap:4})}>
                      <span style={ss({fontSize:16,fontWeight:800})}>$</span>
                      <input value={payModalAmountOverride} onChange={e=>setPayModalAmountOverride(e.target.value)}
                        style={{...inputA,width:80,fontSize:14,fontWeight:800,textAlign:'right',padding:'4px 8px'}} />
                    </div>
                  </div>
                  {parseFloat(payModalAmountOverride)*100 !== payModalCounselor.totalCents && (
                    <div style={ss({padding:'6px 14px',fontSize:10,color:'#d97706',background:'#fffbeb',display:'flex',alignItems:'center',gap:4})}>
                      <i className="fas fa-info-circle" style={{fontSize:9}}></i>
                      Original calculated amount: ${(payModalCounselor.totalCents/100).toFixed(2)}
                    </div>
                  )}
                </div>
                <div style={ss({marginBottom:14})}>
                  <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:6})}>Payment Method</label>
                  <div style={ss({display:'flex',gap:8})}>
                    <button onClick={()=>setPayModalMethod('stripe_connect')}
                      style={ss({flex:1,padding:'10px 14px',borderRadius:10,border:payModalMethod==='stripe_connect'?'2px solid var(--stone-900)':'1px solid var(--border)',background:payModalMethod==='stripe_connect'?'var(--stone-900)':'var(--card)',color:payModalMethod==='stripe_connect'?'#fff':'var(--stone-600)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',textAlign:'center'})}>
                      <i className="fab fa-stripe-s" style={{marginRight:6}}></i>Stripe Connect
                    </button>
                    <button onClick={()=>setPayModalMethod('offline')}
                      style={ss({flex:1,padding:'10px 14px',borderRadius:10,border:payModalMethod==='offline'?'2px solid var(--stone-900)':'1px solid var(--border)',background:payModalMethod==='offline'?'var(--stone-900)':'var(--card)',color:payModalMethod==='offline'?'#fff':'var(--stone-600)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',textAlign:'center'})}>
                      <i className="fas fa-money-bill-wave" style={{marginRight:6}}></i>Record Offline
                    </button>
                  </div>
                  {payModalMethod==='stripe_connect'&&!payModalCounselor.stripe_connect_account_id&&(
                    <div style={ss({marginTop:8,padding:'8px 12px',borderRadius:8,background:'#fef2f2',border:'1px solid #fecaca',fontSize:11,color:'#dc2626'})}>
                      <i className="fas fa-exclamation-triangle" style={{marginRight:6}}></i>Counselor has not connected Stripe. Payment will be recorded as offline.
                    </div>
                  )}
                </div>
                <div style={ss({marginBottom:16})}>
                  <label style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',display:'block',marginBottom:6})}>Notes</label>
                  <textarea value={payModalNotes} onChange={e=>setPayModalNotes(e.target.value)} placeholder="e.g. March sessions, invoice #123, bank transfer ref…" style={ss({width:'100%',padding:'10px 14px',border:'1px solid var(--border)',borderRadius:10,fontSize:12,fontFamily:'inherit',lineHeight:1.5,resize:'vertical',minHeight:60,outline:'none',boxSizing:'border-box'})} />
                </div>
              </div>
              <div style={ss({padding:'14px 24px',borderTop:'1px solid var(--border-light)',display:'flex',gap:8,justifyContent:'flex-end'})}>
                <button onClick={()=>setPayModalCounselor(null)} style={ss({padding:'8px 18px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'})}>Cancel</button>
                <button disabled={payModalProcessing} onClick={async()=>{
                  setPayModalProcessing(true);
                  const overrideCents = Math.round(parseFloat(payModalAmountOverride) * 100) || payModalCounselor.totalCents;
                  const originalTotal = payModalCounselor.totalCents || 1;
                  const ratio = overrideCents / originalTotal;
                  const plans = payModalCounselor.selectedPlans.map((a:any)=>({
                    assignment_id: a.id,
                    student_name: a.student_name,
                    plan_name: a.plan,
                    amount_cents: Math.round((a.payable_cents || 0) * ratio),
                    hours: a.hours || 0,
                  }));
                  const method = payModalMethod==='stripe_connect'&&payModalCounselor.stripe_connect_account_id?'stripe_connect':'offline';
                  try {
                    await fetch('/api/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
                      action:'pay_counselor_plans',
                      counselor_id:payModalCounselor.id,
                      method,
                      notes:payModalNotes||'',
                      plans,
                    })});
                    setPayModalCounselor(null);setPayModalProcessing(false);
                    setSelectedPayPlans(p=>({...p,[payModalCounselor.id]:[]}));
                    setEarningsData(null);
                    fetch('/api/admin?view=earnings',{cache:'no-store'}).then(r=>r.json()).then(d=>setEarningsData(d));
                  } catch { setPayModalProcessing(false); alert('Payment failed'); }
                }} style={ss({padding:'8px 24px',borderRadius:10,border:'none',background:'var(--stone-900)',color:'#fff',fontSize:12,fontWeight:800,cursor:payModalProcessing?'wait':'pointer',fontFamily:'inherit',opacity:payModalProcessing?.5:1})}>
                  {payModalProcessing?'Processing...':`Pay $${payModalAmountOverride||'0'}`}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
