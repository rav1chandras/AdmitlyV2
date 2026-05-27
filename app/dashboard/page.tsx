'use client';

/**
 * Unified Dashboard — merges the old /dashboard and /profile pages.
 *
 * Layout:
 *   Row 0  Greeting header + action buttons + payment banner
 *   Row 1  Profile Strength (score-tinted, 2fr) | Completion (1fr) | Deadlines (1fr)
 *   Row 2  Main column (3fr):  TabNav + tab content + activity/story previews
 *          Right sidebar (1fr): College List, Essay Progress, Themes, Promo
 *   Footer Tip
 */

import { useState, useEffect, useCallback, useMemo, Suspense, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { calcProfileScore } from '@/lib/utils';
import { useProCheck } from '@/lib/useProCheck';
import { POPULAR_MAJORS } from '@/lib/major-cip-map';
import {
  scoreActivityImpact,
  deriveThemes,
  deriveCompletion,
  type Activity,
  type ActivityCategory,
  type ThemeScore,
} from '@/lib/profile-insights';
import type { AnalysisPayload } from '@/lib/profile-analysis-helpers';

// ───── Types ─────────────────────────────────────────────────────
interface AcademicProfile {
  gpa: number; sat: number; act: number;
  ap_offered: number; ap_taken: number;
  ec_tier: number; leadership_roles: number;
  is_ed: boolean; is_athlete: boolean; is_legacy: boolean;
  major_multiplier: number; final_score: number;
}
interface Story { id?: number; title: string; summary: string; grade?: number | null; theme_tags?: string[]; }
interface College { name: string; bucket: string; }
interface Essay { id: number; topic: string; essay_type: string; word_count: number; status: string; college_name: string | null; }
interface DateRow { title: string; event_date: string; category: string; }

const DEFAULTS: AcademicProfile = {
  gpa: 0, sat: 0, act: 0, ap_offered: 21, ap_taken: 0,
  ec_tier: 3, leadership_roles: 1,
  is_ed: false, is_athlete: false, is_legacy: false,
  major_multiplier: 1.0, final_score: 0,
};

type TabId = 'academic' | 'activities' | 'story' | 'insights';
const s = (o: React.CSSProperties) => o;
const DASH_NAVY = '#06245B';

// ───── Category visual metadata ──────────────────────────────────
const CATEGORY_META: Record<ActivityCategory, { icon: string; bg: string; color: string; label: string }> = {
  leadership: { icon: 'fa-users',       bg: '#EEEDFE', color: '#534AB7', label: 'Leadership' },
  community:  { icon: 'fa-heart',       bg: '#FBEAF0', color: '#993556', label: 'Community service' },
  arts:       { icon: 'fa-palette',     bg: '#FAEEDA', color: '#854F0B', label: 'Arts' },
  academic:   { icon: 'fa-flask',       bg: '#E6F1FB', color: '#185FA5', label: 'Academic' },
  athletics:  { icon: 'fa-medal',       bg: '#E1F5EE', color: '#0F6E56', label: 'Athletics' },
  work:       { icon: 'fa-briefcase',   bg: '#F1EFE8', color: '#5F5E5A', label: 'Work' },
  other:      { icon: 'fa-circle',      bg: '#F1EFE8', color: '#5F5E5A', label: 'Other' },
};

const THEME_VISUAL: Record<string, { icon: string; color: string; bg: string }> = {
  leadership:       { icon: 'fa-users-line',  color: '#534AB7', bg: '#EEEDFE' },
  community_impact: { icon: 'fa-heart',       color: '#993556', bg: '#FBEAF0' },
  resilience:       { icon: 'fa-seedling',    color: '#0F6E56', bg: '#E1F5EE' },
  curiosity:        { icon: 'fa-lightbulb',   color: '#185FA5', bg: '#E6F1FB' },
  creativity:       { icon: 'fa-paintbrush',  color: '#854F0B', bg: '#FAEEDA' },
};

// ───── Helpers ───────────────────────────────────────────────────
function gradeRangeLabel(a: Activity): string {
  if (!a.start_grade) return '';
  const start = `${a.start_grade}th`;
  if (a.is_current) return `${start}–present`;
  if (a.end_grade && a.end_grade !== a.start_grade) return `${start}–${a.end_grade}th`;
  return start;
}

// ─────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────
function DashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, update: updateSession } = useSession();
  const { tier } = useProCheck();

  // ── Academic / Profile state ──
  const [academic, setAcademic] = useState<AcademicProfile>(DEFAULTS);
  const [gpaScale, setGpaScale] = useState<string>('4.0');
  const [intendedMajor, setIntendedMajor] = useState('');
  const [school, setSchool] = useState('');
  const [graduationYear, setGraduationYear] = useState<number | null>(null);
  const [classRank, setClassRank] = useState('');

  // ── Activities ──
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  // ── Stories ──
  const [stories, setStories] = useState<Story[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);

  // ── LLM analysis ──
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [analysisStale, setAnalysisStale] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisGeneratedAt, setAnalysisGeneratedAt] = useState<string | null>(null);

  // ── Dashboard-specific state ──
  const [colleges, setColleges] = useState<College[]>([]);
  const [essays, setEssays] = useState<Essay[]>([]);
  const [dates, setDates] = useState<DateRow[]>([]);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const paymentHandled = useRef(false);

  // ── UI state ──
  const [activeTab, setActiveTab] = useState<TabId>('academic');
  const [editAcademicOpen, setEditAcademicOpen] = useState(false);
  const [activityModal, setActivityModal] = useState<{ open: boolean; editing: Activity | null }>({ open: false, editing: null });
  const [storyModal, setStoryModal] = useState<{ open: boolean; editing: Story | null }>({ open: false, editing: null });

  // ── Greeting ──
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // ── Payment success polling (from Dashboard) ──
  useEffect(() => {
    if (searchParams.get('payment') === 'success' && !paymentHandled.current) {
      paymentHandled.current = true;
      setPaymentSuccess(true);
      let cancelled = false;
      const startedAt = Date.now();
      const MAX_MS = 12_000;
      const INTERVAL_MS = 750;
      const pollUntilUpgraded = async () => {
        while (!cancelled && Date.now() - startedAt < MAX_MS) {
          try {
            const res = await fetch('/api/subscription/check', { cache: 'no-store' });
            const data = await res.json();
            if (data?.tier === 'pro' || data?.tier === 'premium') { await updateSession(); return; }
          } catch (e) { console.error('[Dashboard] Subscription check failed:', e); }
          await new Promise(r => setTimeout(r, INTERVAL_MS));
        }
        await updateSession();
      };
      pollUntilUpgraded();
      return () => { cancelled = true; };
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'strengths' || tab === 'recs') {
      setActiveTab('insights');
    } else if (tab === 'academic' || tab === 'activities' || tab === 'story' || tab === 'insights') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // ── Initial load (merged) ──
  useEffect(() => {
    // Profile data
    fetch('/api/profile').then(r => r.ok ? r.json() : null).then(p => {
      if (p) {
        const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
        const merged: AcademicProfile = {
          ...DEFAULTS, ...p,
          gpa: num(p.gpa), sat: num(p.sat), act: num(p.act),
          ap_offered: num(p.ap_offered) > 0 ? num(p.ap_offered) : DEFAULTS.ap_offered,
          ap_taken: num(p.ap_taken),
          ec_tier: num(p.ec_tier) > 0 ? num(p.ec_tier) : DEFAULTS.ec_tier,
          leadership_roles: (num(p.leadership_roles) > 0 || num(p.gpa) > 0) ? num(p.leadership_roles) : DEFAULTS.leadership_roles,
          major_multiplier: num(p.major_multiplier, 1.0),
          final_score: num(p.final_score),
        };
        setAcademic(merged);
      }
    }).catch(() => {});

    // Settings
    fetch('/api/settings').then(r => r.ok ? r.json() : null).then(s => {
      if (s?.gpa_scale) setGpaScale(s.gpa_scale);
      if (s?.intended_major) setIntendedMajor(s.intended_major);
      const sch = s?.high_school_name
        ? `${s.high_school_name}${s.high_school_city ? ', ' + s.high_school_city : ''}${s.high_school_state ? ' ' + s.high_school_state : ''}`
        : '';
      if (sch) setSchool(sch);
      if (s?.graduation_year) setGraduationYear(Number(s.graduation_year));
      if (s?.class_rank) setClassRank(s.class_rank);
    }).catch(() => {});

    // Activities
    fetch('/api/profile/activities').then(r => r.ok ? r.json() : { activities: [] }).then(d => {
      setActivities(Array.isArray(d.activities) ? d.activities : []);
      setActivitiesLoading(false);
    }).catch(() => setActivitiesLoading(false));

    // Stories
    fetch('/api/profile/stories').then(r => r.ok ? r.json() : { stories: [] }).then(d => {
      setStories(Array.isArray(d.stories) ? d.stories : []);
      setStoriesLoading(false);
    }).catch(() => setStoriesLoading(false));

    // Cached LLM analysis
    fetch('/api/profile/analyze').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.cached && d?.payload) {
        setAnalysis(d.payload);
        setAnalysisStale(!!d.stale);
        setAnalysisGeneratedAt(d.generated_at ?? null);
      }
    }).catch(() => {});

    // Dashboard data: colleges, essays, dates
    fetch('/api/colleges').then(r => r.ok ? r.json() : []).then(c => setColleges(Array.isArray(c) ? c : [])).catch(() => {});
    fetch('/api/essays').then(r => r.ok ? r.json() : []).then(e => setEssays(Array.isArray(e) ? e : [])).catch(() => {});
    fetch('/api/dates').then(r => r.ok ? r.json() : []).then(d => setDates(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // ── Score ──
  const breakdown = useMemo(
    () => calcProfileScore({ ...academic, gpa_scale: gpaScale }),
    [academic, gpaScale]
  );
  const score = breakdown.finalScore;
  const verdict = breakdown.verdict || 'Building';
  const vDesc = breakdown.verdictDesc || 'Solid foundation — strengthen rigor and extracurricular leadership.';
  const hasDecidedMajor = !!intendedMajor.trim() && !['undecided', 'undecided major', 'not sure', 'exploring'].includes(intendedMajor.trim().toLowerCase());

  // ── Themes + completion ──
  const themes: ThemeScore[] = useMemo(() => deriveThemes(activities), [activities]);
  const completion = useMemo(() => deriveCompletion({
    has_academic: academic.gpa > 0 && (academic.sat > 0 || academic.act > 0),
    activity_count: activities.length,
    has_sat: academic.sat > 0,
    has_act: academic.act > 0,
    has_intended_major: hasDecidedMajor,
  }), [academic, activities, hasDecidedMajor]);
  const completionItems = useMemo(
    () => completion.items.map(it => it.key === 'stories' ? { ...it, phase: 1 as const, status: stories.length >= 3 ? 'done' as const : stories.length > 0 ? 'partial' as const : 'todo' as const } : it),
    [completion, stories.length]
  );
  const profileCompletionPct = useMemo(() => {
    const phase1 = completionItems.filter(i => i.phase === 1);
    const points = phase1.reduce((sum, i) => sum + (i.status === 'done' ? 1 : i.status === 'partial' ? 0.5 : 0), 0);
    return phase1.length ? Math.round((points / phase1.length) * 100) : 0;
  }, [completionItems]);

  // ── Dashboard computed values ──
  const reach = colleges.filter(c => c.bucket === 'reach').length;
  const target = colleges.filter(c => c.bucket === 'target').length;
  const safety = colleges.filter(c => c.bucket === 'safety').length;
  const total = colleges.length;
  const essayTotalWords = essays.reduce((sum, e) => sum + (Number(e.word_count) || 0), 0);
  const essayAveragePct = essays.length > 0
    ? Math.min(Math.round(essays.reduce((sum, e) => sum + Math.min((Number(e.word_count) || 0) / 650, 1), 0) / essays.length * 100), 100)
    : 0;
  const essayDrafts = essays.filter(e => (Number(e.word_count) || 0) > 0).length;
  const essayReady = essays.filter(e => (Number(e.word_count) || 0) >= 500 || e.status === 'final').length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcomingDates = dates
    .map(d => {
      const raw = typeof d.event_date === 'string' ? d.event_date.split('T')[0] : '';
      const parts = raw.split('-');
      const dateObj = parts.length === 3
        ? new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]), 12, 0, 0)
        : new Date(d.event_date);
      return { ...d, dateObj };
    })
    .filter(d => !isNaN(d.dateObj.getTime()) && d.dateObj >= today)
    .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime())
    .slice(0, 3);
  const daysUntil = (d: Date) => Math.ceil((d.getTime() - today.getTime()) / 86400000);
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // ── Save academic ──
  const saveAcademic = useCallback(async (next: AcademicProfile, nextMajor: string) => {
    setAcademic(next);
    await fetch('/api/profile', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...next, final_score: calcProfileScore({ ...next, gpa_scale: gpaScale }).finalScore }),
    });
    if (nextMajor !== intendedMajor) {
      setIntendedMajor(nextMajor);
      try {
        const sRes = await fetch(`/api/settings?t=${Date.now()}`, { cache: 'no-store' });
        if (sRes.ok) {
          const current = await sRes.json();
          await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...current, intended_major: nextMajor }) });
        }
      } catch {}
    }
  }, [gpaScale, intendedMajor]);

  // ── Activity CRUD ──
  const refreshActivities = async () => { const r = await fetch('/api/profile/activities', { cache: 'no-store' }); const d = await r.json(); setActivities(Array.isArray(d.activities) ? d.activities : []); };
  const saveActivity = async (a: Activity) => {
    const method = a.id ? 'PATCH' : 'POST';
    const r = await fetch('/api/profile/activities', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
    if (r.ok) { await refreshActivities(); setAnalysisStale(true); } else { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed to save activity.'); }
  };
  const deleteActivity = async (id: number) => {
    if (!confirm('Remove this activity?')) return;
    const r = await fetch('/api/profile/activities', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (r.ok) { await refreshActivities(); setAnalysisStale(true); }
  };

  // ── Story CRUD ──
  const refreshStories = async () => { const r = await fetch('/api/profile/stories', { cache: 'no-store' }); const d = await r.json(); setStories(Array.isArray(d.stories) ? d.stories : []); };
  const saveStory = async (st: Story) => {
    const method = st.id ? 'PATCH' : 'POST';
    const r = await fetch('/api/profile/stories', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(st) });
    if (r.ok) { await refreshStories(); setAnalysisStale(true); } else { const d = await r.json().catch(() => ({})); alert(d.error || 'Failed to save story.'); }
  };
  const deleteStory = async (id: number) => {
    if (!confirm('Remove this story?')) return;
    const r = await fetch('/api/profile/stories', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    if (r.ok) { await refreshStories(); setAnalysisStale(true); }
  };

  // ── LLM Analysis ──
  const runAnalysis = async (force = false) => {
    setAnalysisLoading(true); setAnalysisError(null);
    try {
      const r = await fetch('/api/profile/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }) });
      const d = await r.json();
      if (!r.ok) { setAnalysisError(d.error || 'Analysis failed.'); return; }
      if (d?.payload) { setAnalysis(d.payload); setAnalysisStale(false); setAnalysisGeneratedAt(d.generated_at ?? null); }
    } catch (err: any) { setAnalysisError(err?.message || 'Analysis failed.'); } finally { setAnalysisLoading(false); }
  };

  // ── Score tint (from Dashboard's Profile Strength card) ──
  const tint = score >= 90 ? { bg: '#edfaf6', border: '#a3e4d0', accent: '#06a77d', accentLight: '#d4f5ea' }
    : score >= 78 ? { bg: '#ebeef8', border: '#b3bee6', accent: '#0a2463', accentLight: '#d6ddf2' }
    : score >= 65 ? { bg: '#ebeef8', border: '#c0c9e0', accent: '#0a2463', accentLight: '#d6ddf2' }
    : score >= 50 ? { bg: '#f5f3f8', border: '#d6d0e4', accent: '#0a2463', accentLight: '#e8e4f0' }
    : { bg: '#fdeef4', border: '#f5b3cd', accent: '#cc266d', accentLight: '#fbd5e5' };

  function Card({ children, style, onClick, onMouseEnter, onMouseLeave }: { children: React.ReactNode; style?: React.CSSProperties; onClick?: () => any; onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void; onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void }) {
    return <div onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', transition: 'all .15s', ...style }}>{children}</div>;
  }

  // ── UI ──
  return (
    <AppShell>
      <main style={s({ flex: 1, padding: '36px 40px 60px', maxWidth: 1280, overflowY: 'auto' })}>

        {/* Payment success banner */}
        {paymentSuccess && (
          <div style={s({ background: '#ecfdf5', border: '1px solid #bbf7d0', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 })}>
            <span style={{ fontSize: 20 }}>🎉</span>
            <div style={{ flex: 1 }}>
              <div style={s({ fontSize: 14, fontWeight: 800, color: '#065f46' })}>Payment successful — welcome to Pro!</div>
              <div style={s({ fontSize: 12, fontWeight: 500, color: '#059669', marginTop: 2 })}>You now have full access to College Recommendations, Essays, and more.</div>
            </div>
            <button onClick={() => setPaymentSuccess(false)} style={s({ background: 'none', border: 'none', cursor: 'pointer', color: '#059669', fontSize: 16, padding: 4 })}>×</button>
          </div>
        )}

        {/* Header + application path */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(190px, 1fr) minmax(190px, 1fr)', alignItems: 'stretch', gap: 14, marginBottom: 8 })}>
          <div style={s({ minHeight: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center' })}>
            <h1 style={s({ fontSize: 26, fontWeight: 900, color: DASH_NAVY, letterSpacing: '-0.3px', margin: 0 })}>{greet}, {firstName}</h1>
            <p style={s({ fontSize: 13, color: 'var(--stone-400)', margin: '4px 0 0' })}>Build a stronger profile. Tell your story. Stand out.</p>
          </div>
          <ApplicationPathCard
            completionPct={profileCompletionPct}
            essayProgress={essayAveragePct}
            onBuildProfile={() => router.push('/profile')}
            onRecommendations={() => router.push('/colleges')}
            onEssays={() => router.push('/essays')}
            onExpert={() => router.push('/expert-sessions')}
          />
        </div>

        {/* ROW 1: Profile Strength (2fr) | Completion (1fr) | Deadlines (1fr) */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 14, marginBottom: 16 })}>
          {/* Profile Strength — score-tinted card from Dashboard */}
          <Card style={{ padding: '28px 32px', background: tint.bg, borderColor: tint.border, minHeight: 265, display: 'flex', flexDirection: 'column' }}>
            <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 })}>
              <div style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, background: tint.accentLight, border: `1px solid ${tint.border}`, borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, color: tint.accent })}>
                <i className="fas fa-bolt" style={{ fontSize: 11 }}></i> Profile Strength
              </div>
              <button onClick={() => setEditAcademicOpen(true)} style={s({ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', background: DASH_NAVY, color: '#fff', border: 'none', borderRadius: 12, fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer' })}>
                <i className="fas fa-pen-to-square" style={{ fontSize: 10 }}></i> Edit Profile
              </button>
            </div>
            <div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, marginTop: 'auto' })}>
              <div style={s({ flex: 1 })}>
                <h2 style={s({ fontSize: 28, fontWeight: 900, color: DASH_NAVY, letterSpacing: '-0.5px', lineHeight: 1.2, margin: 0 })}>Admissions profile score</h2>
                <p style={s({ fontSize: 13, fontWeight: 500, color: 'rgba(6,36,91,.58)', marginTop: 6, lineHeight: 1.6, maxWidth: 420, margin: '6px 0 0' })}>A quick read on academics, rigor, activities, and story evidence.</p>
                <div style={s({ height: 10, background: 'rgba(6,36,91,.08)', borderRadius: 20, overflow: 'hidden', marginTop: 14 })}>
                  <div className="grow-bar" style={s({ height: '100%', borderRadius: 20, background: 'linear-gradient(90deg,#cc266d 0%,#0a2463 50%,#06a77d 100%)', width: `${score}%` })}></div>
                </div>
                {academic.gpa > 0 && (
                  <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 16, fontSize: 11, fontWeight: 800, color: DASH_NAVY })}>
                    {academic.gpa > 0 && <span style={s({ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 5, minWidth: 0, borderRadius: 999, border: '1px solid rgba(6,36,91,.12)', background: '#fff', padding: '6px 8px', whiteSpace: 'nowrap' })}><span style={s({ width: 7, height: 7, borderRadius: '50%', background: '#06a77d', display: 'inline-block', flexShrink: 0 })}></span>GPA {academic.gpa}</span>}
                    {academic.sat > 0 && <span style={s({ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 5, minWidth: 0, borderRadius: 999, border: '1px solid rgba(6,36,91,.12)', background: '#fff', padding: '6px 8px', whiteSpace: 'nowrap' })}><span style={s({ width: 7, height: 7, borderRadius: '50%', background: '#0a2463', display: 'inline-block', flexShrink: 0 })}></span>SAT {academic.sat}</span>}
                    {academic.act > 0 && <span style={s({ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 5, minWidth: 0, borderRadius: 999, border: '1px solid rgba(6,36,91,.12)', background: '#fff', padding: '6px 8px', whiteSpace: 'nowrap' })}><span style={s({ width: 7, height: 7, borderRadius: '50%', background: '#185FA5', display: 'inline-block', flexShrink: 0 })}></span>ACT {academic.act}</span>}
                    {academic.ap_taken > 0 && <span style={s({ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 5, minWidth: 0, borderRadius: 999, border: '1px solid rgba(6,36,91,.12)', background: '#fff', padding: '6px 8px', whiteSpace: 'nowrap' })}><span style={s({ width: 7, height: 7, borderRadius: '50%', background: '#cc266d', display: 'inline-block', flexShrink: 0 })}></span>{academic.ap_taken} APs</span>}
                  </div>
                )}
              </div>
              <div style={s({ textAlign: 'center', flexShrink: 0 })}>
                <div className="pop" style={s({ fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: '-3px', color: DASH_NAVY })}>
                  {score}<span style={s({ fontSize: 16, fontWeight: 600, color: 'rgba(28,25,23,.25)', marginLeft: 2 })}>/99</span>
                </div>
                <div style={s({ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: 11, fontWeight: 700, color: tint.accent, background: tint.accentLight, padding: '3px 10px', borderRadius: 20 })}>
                  {score >= 85 ? 'Top 5%' : score >= 75 ? 'Top 15%' : score >= 60 ? 'Top 35%' : 'Building'}
                </div>
              </div>
            </div>
          </Card>

          <CompletionCard completion={completion} storyCount={stories.length} onEditProfile={() => setEditAcademicOpen(true)} />

          {/* Upcoming Deadlines */}
          <Card style={{ padding: '16px 18px' }}>
            <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 })}>
              <div style={s({ fontSize: 12, fontWeight: 800, color: DASH_NAVY })}>Upcoming deadlines</div>
              <div onClick={() => router.push('/dates')} style={s({ width: 24, height: 24, borderRadius: 6, background: 'var(--stone-50)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--stone-400)', fontSize: 9 })} title="View all dates"><i className="fas fa-external-link-alt"></i></div>
            </div>
            {upcomingDates.length === 0 && <div style={s({ fontSize: 11, color: 'var(--stone-400)', fontWeight: 500 })}>No upcoming dates — <span onClick={() => router.push('/dates')} style={s({ color: 'var(--blue)', cursor: 'pointer', fontWeight: 700 })}>more</span></div>}
            {upcomingDates.map((d, i) => {
              const days = daysUntil(d.dateObj);
              const u = days <= 3 ? { bg: 'var(--red-light)', color: 'var(--red)', dot: 'var(--red)' } : days <= 14 ? { bg: 'var(--amber-light)', color: '#b45309', dot: 'var(--amber)' } : { bg: '#eff6ff', color: 'var(--blue)', dot: 'var(--violet)' };
              return (
                <div key={i} style={s({ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: i < upcomingDates.length - 1 ? '1px solid var(--border-light)' : 'none' })}>
                  <div style={s({ width: 7, height: 7, borderRadius: '50%', background: u.dot, flexShrink: 0 })}></div>
                  <div style={s({ flex: 1, minWidth: 0 })}>
                    <div style={s({ fontSize: 11, fontWeight: 700, color: 'var(--stone-800)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{d.title}</div>
                    <div style={s({ fontSize: 9, fontWeight: 500, color: 'var(--stone-400)' })}>{fmtDate(d.dateObj)}</div>
                  </div>
                  <div style={s({ fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 6, background: u.bg, color: u.color, whiteSpace: 'nowrap', flexShrink: 0 })}>{days}d</div>
                </div>
              );
            })}
          </Card>
        </div>

        {/* ROW 2: Main (3fr) | Sidebar (1fr) */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: 14 })}>
          {/* Main column */}
          <div style={s({ minWidth: 0 })}>
            <TabNav active={activeTab} onChange={setActiveTab} activitiesCount={activities.length} />

            {activeTab === 'academic' && (
              <AcademicTab academic={academic} gpaScale={gpaScale} intendedMajor={intendedMajor} school={school} graduationYear={graduationYear} classRank={classRank} onEdit={() => setEditAcademicOpen(true)} />
            )}
            {activeTab === 'activities' && (
              <ActivitiesTab activities={activities} loading={activitiesLoading} onAdd={() => setActivityModal({ open: true, editing: null })} onEdit={a => setActivityModal({ open: true, editing: a })} onDelete={deleteActivity} />
            )}
            {activeTab === 'story' && (
              <StoriesTab stories={stories} loading={storiesLoading} analysis={analysis} onAdd={() => setStoryModal({ open: true, editing: null })} onEdit={st => setStoryModal({ open: true, editing: st })} onDelete={deleteStory} />
            )}
            {activeTab === 'insights' && (
              <ProfileInsightsTab
                score={score}
                verdict={analysis?.verdict?.label || verdict}
                verdictDesc={analysis?.verdict?.subtitle || vDesc}
                academic={academic}
                intendedMajor={intendedMajor}
                breakdown={breakdown}
                analysis={analysis}
                stale={analysisStale}
                loading={analysisLoading}
                error={analysisError}
                onRefresh={() => runAnalysis(true)}
                activitiesCount={activities.length}
                storiesCount={stories.length}
                onAddActivity={() => {
                  setActiveTab('activities');
                  setActivityModal({ open: true, editing: null });
                }}
                onAddStory={() => {
                  setActiveTab('story');
                  setStoryModal({ open: true, editing: null });
                }}
              />
            )}

          </div>

          {/* Right sidebar */}
          <aside style={s({ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 })}>
            <CollegeListSlide total={total} reach={reach} target={target} safety={safety} onClick={() => router.push('/colleges')} />
            <EssayProgressSlide essays={essays.length} drafts={essayDrafts} ready={essayReady} totalWords={essayTotalWords} progress={essayAveragePct} onClick={() => router.push('/essays')} />

            <ThemesCard themes={themes} analysis={analysis} hasContent={activities.length > 0 || stories.length > 0} />

            {/* Promo Tile */}
            {tier === 'free' && (
              <div onClick={() => router.push('/subscribe')}
                style={s({ padding: '18px 16px', background: DASH_NAVY, borderRadius: 'var(--radius)', cursor: 'pointer', position: 'relative', overflow: 'hidden', transition: 'all .15s' })}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'none'}>
                <div style={s({ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, position: 'relative', zIndex: 1 })}>
                  <div style={s({ width: 32, height: 32, borderRadius: 10, background: 'var(--yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 })}>
                    <i className="fas fa-bolt" style={{ color: DASH_NAVY }}></i>
                  </div>
                  <div>
                    <div style={s({ fontSize: 12, fontWeight: 800, color: '#fff' })}>Upgrade to Pro</div>
                    <div style={s({ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,.45)', marginTop: 1 })}>Unlock your full potential</div>
                  </div>
                </div>
                <p style={s({ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,.5)', lineHeight: 1.5, position: 'relative', zIndex: 1, margin: 0 })}>
                  Get college recommendations, essay coaching, and a school counselor report.
                </p>
                <button type="button" style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '6px 14px', background: 'var(--yellow)', color: DASH_NAVY, border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer', position: 'relative', zIndex: 1 })}>
                  Upgrade Now <i className="fas fa-arrow-right" style={{ fontSize: 9 }}></i>
                </button>
              </div>
            )}
          </aside>
        </div>

        <TipFooter />
      </main>

      {/* Modals */}
      {editAcademicOpen && (
        <EditAcademicModal academic={academic} gpaScale={gpaScale} intendedMajor={intendedMajor}
          onCancel={() => setEditAcademicOpen(false)}
          onSave={async (next, nextMajor) => { await saveAcademic(next, nextMajor); setEditAcademicOpen(false); }} />
      )}
      {activityModal.open && (
        <ActivityModal activity={activityModal.editing}
          onCancel={() => setActivityModal({ open: false, editing: null })}
          onSave={async a => { await saveActivity(a); setActivityModal({ open: false, editing: null }); }} />
      )}
      {storyModal.open && (
        <StoryModal story={storyModal.editing}
          onCancel={() => setStoryModal({ open: false, editing: null })}
          onSave={async st => { await saveStory(st); setStoryModal({ open: false, editing: null }); }} />
      )}
    </AppShell>
  );
}

// ═════════════════════════════════════════════════════════════════
// SUB-COMPONENTS (from Profile page — all preserved)
// ═════════════════════════════════════════════════════════════════

function ApplicationPathCard({
  completionPct,
  essayProgress,
  onBuildProfile,
  onRecommendations,
  onEssays,
  onExpert,
}: {
  completionPct: number;
  essayProgress: number;
  onBuildProfile: () => void;
  onRecommendations: () => void;
  onEssays: () => void;
  onExpert: () => void;
}) {
  const steps = [
    { label: 'Build profile', note: `${completionPct}% complete`, icon: 'fa-cube', onClick: onBuildProfile },
    { label: 'Select colleges', note: 'Build list', icon: 'fa-school', onClick: onRecommendations },
    { label: 'Improve essays', note: `${essayProgress}% progress`, icon: 'fa-clipboard-check', onClick: onEssays },
  ];

  return (
    <div style={s({ gridColumn: '2 / 4', justifySelf: 'stretch', alignSelf: 'stretch', width: '100%', maxWidth: '100%', padding: '13px 18px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', boxShadow: '0 14px 32px rgba(28,25,23,.04)', display: 'flex', alignItems: 'center' })}>
      <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(420px, 1fr) 132px', gap: 22, alignItems: 'center', width: '100%' })}>
        <div style={s({ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(106px, 1fr))', justifyContent: 'space-between', minHeight: 72 })}>
          <div style={s({ position: 'absolute', left: '16.666%', right: '16.666%', top: 21, height: 4, borderRadius: 999, background: '#dce3ed' })}></div>
          {steps.map((step, index) => {
            const active = index === 0;
            return (
              <button
                key={step.label}
                type="button"
                onClick={step.onClick}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'none')}
                style={s({ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 0, border: 'none', background: 'transparent', color: DASH_NAVY, fontFamily: 'inherit', cursor: 'pointer', transition: 'all .15s', textAlign: 'center', minWidth: 0 })}
              >
                <span style={s({ width: 44, height: 44, borderRadius: 999, background: active ? 'var(--yellow)' : '#eef1f5', border: `3px solid ${active ? 'var(--yellow)' : '#d9e0ea'}`, color: active ? DASH_NAVY : '#6b7280', display: 'grid', placeItems: 'center', fontSize: 17, boxShadow: active ? '0 8px 18px rgba(255,229,0,.25)' : '0 5px 14px rgba(15,23,42,.06)', marginBottom: 7 })}>
                  <i className={`fas ${step.icon}`}></i>
                </span>
                <span style={s({ display: 'block', width: '100%', fontSize: 10, lineHeight: 1.12, fontWeight: 900, color: DASH_NAVY, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{step.label}</span>
                <span style={s({ display: 'block', width: '100%', fontSize: 9, lineHeight: 1.15, marginTop: 3, fontWeight: 750, color: 'var(--stone-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{step.note}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onExpert}
          onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'none')}
          style={s({ minHeight: 72, padding: '12px 14px', borderRadius: 16, border: `1px solid ${DASH_NAVY}`, background: DASH_NAVY, color: 'var(--yellow)', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', transition: 'all .15s', boxShadow: '0 12px 24px rgba(6,36,91,.18)' })}
        >
          <span style={s({ width: 28, height: 28, borderRadius: 999, background: 'var(--yellow)', color: DASH_NAVY, display: 'grid', placeItems: 'center', fontSize: 12, marginBottom: 8 })}>
            <i className="fas fa-user-graduate"></i>
          </span>
          <span style={s({ display: 'block', fontSize: 12, lineHeight: 1.1, fontWeight: 950, color: 'var(--yellow)' })}>Expert session</span>
          <span style={s({ display: 'block', fontSize: 10, lineHeight: 1.15, marginTop: 4, fontWeight: 800, color: '#fff' })}>Book advisor</span>
        </button>
      </div>
    </div>
  );
}

function TabNav({ active, onChange, activitiesCount }: { active: TabId; onChange: (t: TabId) => void; activitiesCount: number }) {
  const tabs: { id: TabId; label: string; icon: string; badge?: string }[] = [
    { id: 'academic',   label: 'Academic',       icon: 'fa-graduation-cap' },
    { id: 'activities', label: 'Activities',     icon: 'fa-users', badge: activitiesCount > 0 ? String(activitiesCount) : undefined },
    { id: 'story',      label: 'Personal story', icon: 'fa-heart' },
    { id: 'insights',   label: 'Profile Insights', icon: 'fa-chart-line' },
  ];
  return (
    <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 4, padding: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, marginBottom: 14 })}>
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={s({ width: '100%', minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 6px', border: 'none', borderRadius: 12, fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', background: isActive ? DASH_NAVY : 'transparent', color: isActive ? '#fff' : 'var(--stone-500)', transition: 'all .15s' })}>
            <i className={`fas ${t.icon}`} style={{ fontSize: 11 }}></i>
            <span style={s({ overflow: 'hidden', textOverflow: 'ellipsis' })}>{t.label}</span>
            {t.badge && (<span style={s({ background: isActive ? 'rgba(255,255,255,.2)' : 'var(--stone-100)', color: isActive ? '#fff' : 'var(--stone-600)', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 800 })}>{t.badge}</span>)}
          </button>
        );
      })}
    </div>
  );
}

function AcademicTab({ academic, gpaScale, intendedMajor, school, graduationYear, classRank, onEdit }: { academic: AcademicProfile; gpaScale: string; intendedMajor: string; school: string; graduationYear: number | null; classRank: string; onEdit: () => void; }) {
  const cards: { label: string; value: string; sub?: string; icon: string; color: string; bg: string }[] = [
    { label: `GPA ${gpaScale === '5.0' ? '(W)' : '(UW)'}`, value: academic.gpa ? Number(academic.gpa).toFixed(2) : '—', sub: gpaScale === '5.0' ? 'Weighted scale' : 'Unweighted scale', icon: 'fa-chart-line', color: '#0F6E56', bg: '#E1F5EE' },
    { label: 'SAT', value: academic.sat ? String(academic.sat) : '—', sub: academic.sat ? 'Best score' : 'Not set', icon: 'fa-pen-ruler', color: '#185FA5', bg: '#E6F1FB' },
    { label: 'ACT', value: academic.act ? String(academic.act) : '—', sub: academic.act ? 'Best score' : 'Not set', icon: 'fa-stopwatch', color: '#534AB7', bg: '#EEEDFE' },
    { label: 'AP / honors', value: academic.ap_taken ? `${academic.ap_taken} APs` : '—', sub: academic.ap_offered ? `${academic.ap_taken} of ${academic.ap_offered} offered` : 'Course rigor', icon: 'fa-layer-group', color: '#854F0B', bg: '#FAEEDA' },
    { label: 'Intended major', value: intendedMajor || '—', sub: intendedMajor ? 'Academic direction' : 'Not set', icon: 'fa-compass', color: '#993556', bg: '#FBEAF0' },
    { label: 'School', value: school || '—', sub: school ? 'High school' : 'Not set', icon: 'fa-school', color: '#5F5E5A', bg: '#F1EFE8' },
    { label: 'Graduation year', value: graduationYear ? String(graduationYear) : '—', sub: graduationYear ? 'Application cohort' : 'Not set', icon: 'fa-calendar-check', color: '#0A2463', bg: '#E6F1FB' },
    { label: 'Class rank', value: classRank || '—', sub: classRank ? 'School context' : 'Optional', icon: 'fa-ranking-star', color: '#A32D2D', bg: '#FCEBEB' },
  ];
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 })}>
        <div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY })}>Academic profile</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Drives your score. Update whenever your numbers change.</div>
        </div>
        <button onClick={onEdit} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: DASH_NAVY, border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' })}>
          <i className="fas fa-pen-to-square" style={{ fontSize: 10 }}></i> Edit
        </button>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 })}>
        {cards.map(c => (
          <div key={c.label} style={s({ position: 'relative', minHeight: 104, background: 'linear-gradient(180deg,#fff,var(--stone-50))', border: '1px solid var(--border-light)', borderRadius: 14, padding: 14, overflow: 'hidden', boxShadow: '0 1px 0 rgba(28,25,23,.03)' })}>
            <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 })}>
              <div style={s({ fontSize: 10, fontWeight: 800, color: 'var(--stone-400)', textTransform: 'uppercase', letterSpacing: '.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{c.label}</div>
              <div style={s({ width: 28, height: 28, borderRadius: 9, background: c.bg, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 })}>
                <i className={`fas ${c.icon}`}></i>
              </div>
            </div>
            <div style={s({ fontSize: c.value.length > 18 ? 14 : 19, fontWeight: 900, color: DASH_NAVY, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any })}>{c.value}</div>
            {c.sub && <div style={s({ fontSize: 10, fontWeight: 600, color: 'var(--stone-400)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivitiesTab({ activities, loading, onAdd, onEdit, onDelete }: { activities: Activity[]; loading: boolean; onAdd: () => void; onEdit: (a: Activity) => void; onDelete: (id: number) => void; }) {
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 })}>
        <div><div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY })}>Activities</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Up to 10. Impact score uses a heuristic (longevity × hours × role).</div></div>
        <button onClick={onAdd} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--yellow)', border: 'none', borderRadius: 8, color: DASH_NAVY, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10 }}></i> Add</button>
      </div>
      {loading ? (<div style={s({ textAlign: 'center', padding: 30, color: 'var(--stone-400)', fontSize: 12 })}>Loading…</div>
      ) : activities.length === 0 ? (
        <div style={s({ textAlign: 'center', padding: '36px 20px', background: 'var(--stone-50)', borderRadius: 12 })}>
          <div style={s({ fontSize: 30, marginBottom: 8 })}><i className="fas fa-people-arrows" style={{ color: 'var(--stone-300)' }}></i></div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY, marginBottom: 4 })}>No activities yet</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-400)', marginBottom: 14, maxWidth: 320, margin: '0 auto 14px' })}>Add your top activities to unlock theme insights and stronger essay suggestions.</div>
          <button onClick={onAdd} style={s({ padding: '8px 16px', background: DASH_NAVY, color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10, marginRight: 6 }}></i> Add your first activity</button>
        </div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {activities.map(a => {
            const impact = scoreActivityImpact(a);
            const meta = CATEGORY_META[a.category];
            const badgeBg = impact.color === 'green' ? '#E1F5EE' : impact.color === 'amber' ? '#FAEEDA' : '#F1EFE8';
            const badgeColor = impact.color === 'green' ? '#0F6E56' : impact.color === 'amber' ? '#854F0B' : '#5F5E5A';
            return (
              <div key={a.id} style={s({ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--stone-50)', borderRadius: 10 })}>
                <div style={s({ width: 36, height: 36, borderRadius: 10, background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 })}><i className={`fas ${meta.icon}`}></i></div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ fontSize: 13, fontWeight: 800, color: DASH_NAVY })}>{a.name}</div>
                  <div style={s({ fontSize: 11, color: 'var(--stone-500)', marginTop: 2 })}>{meta.label}{a.role ? ` · ${a.role}` : ''}{gradeRangeLabel(a) ? ` · ${gradeRangeLabel(a)}` : ''}{a.hours_per_week ? ` · ${a.hours_per_week}h/wk` : ''}</div>
                </div>
                <div style={s({ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, background: badgeBg, color: badgeColor, flexShrink: 0 })}>{impact.label}</div>
                <div style={s({ fontSize: 16, fontWeight: 900, color: DASH_NAVY, minWidth: 36, textAlign: 'right' })}>{impact.score.toFixed(1)}</div>
                <div style={s({ display: 'flex', gap: 4, flexShrink: 0 })}>
                  <button onClick={() => onEdit(a)} title="Edit" style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--stone-500)', fontSize: 11 })}><i className="fas fa-pen"></i></button>
                  <button onClick={() => onDelete(a.id!)} title="Remove" style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--red)', fontSize: 11 })}><i className="fas fa-trash"></i></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProfileInsightsTab({
  score,
  verdict,
  verdictDesc,
  academic,
  intendedMajor,
  breakdown,
  analysis,
  stale,
  loading,
  error,
  onRefresh,
  activitiesCount,
  storiesCount,
  onAddActivity,
  onAddStory,
}: {
  score: number;
  verdict: string;
  verdictDesc: string;
  academic: AcademicProfile;
  intendedMajor: string;
  breakdown: ReturnType<typeof calcProfileScore>;
  analysis: AnalysisPayload | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activitiesCount: number;
  storiesCount: number;
  onAddActivity: () => void;
  onAddStory: () => void;
}) {
  const hasContent = activitiesCount > 0 || storiesCount > 0;
  const recs = analysis?.recommendations || [];
  const primaryActionLabel = loading ? 'Refreshing...' : analysis ? (stale ? 'Refresh insights' : 'Refresh') : 'Generate insights';
  const academics = breakdown.pillars.find(p => p.label === 'Academics') ?? breakdown.pillars[0];
  const rigor = breakdown.pillars.find(p => p.label === 'Course Rigor') ?? breakdown.pillars[1];
  const ecs = breakdown.pillars.find(p => p.label === 'Extracurriculars') ?? breakdown.pillars[2];
  const signalItems = breakdown.insights.filter(i => i.type === 'strength' || i.type === 'context').slice(0, 2);
  const nextItems = (recs.length ? recs.map(r => ({ title: r.title, desc: r.description, icon: 'fa-arrow-right', color: '#185FA5', bg: '#E6F1FB' })) : breakdown.insights.filter(i => i.type === 'gap' || i.type === 'action').map(i => ({ title: i.title, desc: i.desc, icon: i.icon, color: i.color, bg: i.bg }))).slice(0, 3);

  return (
    <div style={s({ background: 'radial-gradient(circle at 96% 8%, rgba(255,229,0,.16), transparent 22%), radial-gradient(circle at 4% 100%, rgba(6,36,91,.08), transparent 26%), var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14, boxShadow: '0 16px 42px rgba(15,23,42,.05)' })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 })}>
        <div>
          <div style={s({ fontSize: 22, lineHeight: 1.1, fontWeight: 950, color: DASH_NAVY })}>Profile Insights</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-500)', fontWeight: 650, lineHeight: 1.5, marginTop: 5, maxWidth: 560 })}>A combined view of strengths, gaps, and recommended next steps based on your profile, activities, and stories.</div>
        </div>
        {hasContent && (
          <button onClick={onRefresh} disabled={loading} style={s({ display: 'inline-flex', alignItems: 'center', gap: 7, height: 38, padding: '0 15px', border: 'none', borderRadius: 12, background: DASH_NAVY, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 900, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? .65 : 1, whiteSpace: 'nowrap' })}>
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`}></i>
            {primaryActionLabel}
          </button>
        )}
      </div>

      {error && <div style={s({ padding: 12, background: '#FCEBEB', color: '#A32D2D', borderRadius: 10, fontSize: 12, marginBottom: 14, fontWeight: 750 })}>{error}</div>}
      {stale && <div style={s({ padding: '9px 12px', background: '#FAEEDA', color: '#854F0B', borderRadius: 10, fontSize: 11, marginBottom: 14, fontWeight: 800 })}><i className="fas fa-clock" style={{ marginRight: 6 }}></i>Your profile changed since the last analysis. Refresh insights for updated recommendations.</div>}

      <section style={s({ display: 'grid', gridTemplateColumns: '1.08fr .92fr', gap: 14, alignItems: 'stretch' })}>
        <article style={s({ border: '1px solid #dbe7ff', borderRadius: 18, padding: 20, background: 'radial-gradient(circle at 88% 12%, rgba(255,229,0,.26), transparent 18%), linear-gradient(135deg,#eef5ff,#fff)', display: 'grid', gridTemplateColumns: '160px 1fr', gap: 18, alignItems: 'center' })}>
          <ProfileDonut value={score} size={136} color={DASH_NAVY} label="Profile" />
          <div>
            <div style={s({ fontSize: 21, fontWeight: 950, color: DASH_NAVY, lineHeight: 1.15 })}>Strong academics, needs sharper story signals.</div>
          </div>
          <div style={s({ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 7 })}>
            {academic.gpa > 0 && <InsightPill>GPA {academic.gpa}</InsightPill>}
            {academic.sat > 0 && <InsightPill>SAT {academic.sat}</InsightPill>}
            {academic.act > 0 && <InsightPill>ACT {academic.act}</InsightPill>}
            {academic.ap_taken > 0 && <InsightPill>{academic.ap_taken} APs</InsightPill>}
            {intendedMajor && <InsightPill>{intendedMajor}</InsightPill>}
          </div>
        </article>

        <article style={s({ border: '1px solid var(--border)', borderRadius: 18, background: 'linear-gradient(180deg,#fff,#fbfdff)', padding: 18, boxShadow: '0 10px 28px rgba(15,23,42,.04)' })}>
          <InsightSectionTitle icon="fa-arrow-trend-up" title="Strength snapshot" />
          <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9, marginTop: 8 })}>
            <MetricDonut pillar={academics} fallbackColor="#0F6E56" note="GPA + scores" />
            <MetricDonut pillar={rigor} fallbackColor={DASH_NAVY} note="AP + honors" />
            <MetricDonut pillar={ecs} fallbackColor="#f59e0b" note="Impact signals" />
          </div>
          <div style={s({ marginTop: 13, borderRadius: 14, background: '#f7fbff', border: '1px solid #e2ecfa', padding: '11px 12px', color: 'var(--stone-500)', fontSize: 11, lineHeight: 1.45, fontWeight: 750 })}>
            Academics are the anchor. Course rigor is solid, while extracurricular impact needs more measurable outcomes.
          </div>
        </article>
      </section>

      <section style={s({ display: 'grid', gridTemplateColumns: '1.08fr .92fr', gap: 14, marginTop: 14 })}>
        <InsightList title="Strongest signals" icon="fa-check" iconText="✓" items={signalItems.length ? signalItems.map(i => ({ title: i.title, desc: i.desc, icon: i.icon, color: i.color, bg: i.bg })) : [{ title: 'Academic readiness is clear', desc: 'Your GPA and test profile support ambitious college targeting.', icon: 'fa-check', color: '#0F6E56', bg: '#E1F5EE' }]} />
        <InsightList title="Gaps & next steps" icon="fa-exclamation" iconText="!" items={nextItems.length ? nextItems : [{ title: hasContent ? 'Generate updated next steps' : 'Add profile evidence first', desc: hasContent ? 'Refresh insights to turn your latest profile into concrete actions.' : 'Add an activity or personal story so recommendations have something real to work from.', icon: 'fa-lightbulb', color: '#185FA5', bg: '#E6F1FB' }]} />
      </section>

      {!hasContent && (
        <div style={s({ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap', marginTop: 14 })}>
          <button onClick={onAddActivity} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: DASH_NAVY, color: '#fff', border: 'none', borderRadius: 9, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10 }}></i>Add activity</button>
          <button onClick={onAddStory} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--card)', color: DASH_NAVY, border: '1px solid var(--border)', borderRadius: 9, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10 }}></i>Add story</button>
        </div>
      )}
    </div>
  );
}

function ProfileDonut({ value, size, color, label, thickness = 15 }: { value: number; size: number; color: string; label: string; thickness?: number }) {
  const innerSize = size - thickness * 2;
  return (
    <div style={s({ width: size, height: size, borderRadius: 999, background: `conic-gradient(${color} ${Math.max(0, Math.min(value, 100)) * 3.6}deg, #dde6f5 0)`, display: 'grid', placeItems: 'center', margin: '0 auto' })}>
      <div style={s({ width: innerSize, height: innerSize, borderRadius: 999, background: '#fff', display: 'grid', placeItems: 'center', textAlign: 'center', boxShadow: 'inset 0 0 0 1px #e6edf7' })}>
        <div><div style={s({ fontSize: size > 100 ? 33 : 22, fontWeight: 950, lineHeight: 1, color })}>{value}</div>{label && <div style={s({ fontSize: 10, color: 'var(--stone-400)', fontWeight: 900, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.35px' })}>{label}</div>}</div>
      </div>
    </div>
  );
}

function MetricDonut({ pillar, fallbackColor, note }: { pillar: ReturnType<typeof calcProfileScore>['pillars'][number]; fallbackColor: string; note: string }) {
  const color = pillar?.color || fallbackColor;
  return (
    <div style={s({ border: '1px solid #e7edf6', borderRadius: 16, background: 'radial-gradient(circle at 100% 0, rgba(255,229,0,.14), transparent 34%), #fff', padding: '13px 10px', textAlign: 'center', minWidth: 0 })}>
      <ProfileDonut value={pillar?.pct ?? 0} size={86} color={color} label="" thickness={9} />
      <div style={s({ color: DASH_NAVY, fontSize: 11, lineHeight: 1.15, fontWeight: 950, marginTop: 8 })}>{pillar?.label || 'Metric'}</div>
      <div style={s({ color: 'var(--stone-400)', fontSize: 10, lineHeight: 1.3, fontWeight: 800, marginTop: 4 })}>{note}</div>
    </div>
  );
}

function InsightPill({ children }: { children: React.ReactNode }) {
  return <span style={s({ borderRadius: 999, background: '#fff', border: '1px solid #dce5f3', color: DASH_NAVY, padding: '6px 10px', fontSize: 11, fontWeight: 900, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{children}</span>;
}

function InsightSectionTitle({ icon, title }: { icon: string; title: string }) {
  return <div style={s({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 950, color: DASH_NAVY, marginBottom: 11 })}><span style={s({ width: 28, height: 28, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'var(--yellow)', color: DASH_NAVY, fontSize: 13 })}><i className={`fas ${icon}`}></i></span>{title}</div>;
}

function InsightList({ title, icon, items }: { title: string; icon: string; iconText: string; items: { title: string; desc: string; icon: string; color: string; bg: string }[] }) {
  return (
    <article style={s({ border: '1px solid var(--border)', borderRadius: 18, background: '#fff', padding: 18 })}>
      <InsightSectionTitle icon={icon} title={title} />
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`} style={s({ display: 'grid', gridTemplateColumns: '30px 1fr', gap: 10, padding: index === 0 ? '0 0 12px' : '12px 0', borderTop: index === 0 ? 'none' : '1px solid var(--border-light)' })}>
          <div style={s({ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900, background: item.bg, color: item.color })}><i className={`fas ${item.icon}`}></i></div>
          <div>
            <div style={s({ fontSize: 12, fontWeight: 950, color: DASH_NAVY, marginBottom: 3 })}>{item.title}</div>
            <div style={s({ fontSize: 11, lineHeight: 1.45, fontWeight: 700, color: 'var(--stone-500)' })}>{item.desc}</div>
          </div>
        </div>
      ))}
    </article>
  );
}

function StrengthsTab({ breakdown }: { breakdown: ReturnType<typeof calcProfileScore> }) {
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ marginBottom: 14 })}><div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY })}>Strengths & gaps</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Pillar breakdown from your academic data, plus the most impactful next moves.</div></div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 })}>
        {breakdown.pillars.map(p => (
          <div key={p.label} style={s({ background: 'var(--stone-50)', padding: 14, borderRadius: 10, position: 'relative', overflow: 'hidden' })}>
            <div style={s({ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: p.color })}></div>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 })}>
              <div style={s({ width: 28, height: 28, borderRadius: 8, background: p.bg, color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 })}><i className={`fas ${p.icon}`}></i></div>
              <div style={s({ fontSize: 11, fontWeight: 800, color: 'var(--stone-800)' })}>{p.label}</div>
            </div>
            <div style={s({ fontSize: 24, fontWeight: 900, color: DASH_NAVY })}>{p.pct}<span style={s({ fontSize: 12, color: 'var(--stone-400)', marginLeft: 2 })}>%</span></div>
            <div style={s({ fontSize: 10, color: 'var(--stone-500)', marginTop: 4 })}>{p.percentileLabel}</div>
          </div>
        ))}
      </div>
      {breakdown.insights.length > 0 && (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {breakdown.insights.slice(0, 4).map((insight, i) => (
            <div key={i} style={s({ padding: '12px 14px', background: 'var(--stone-50)', borderLeft: `3px solid ${insight.color}`, borderRadius: 4 })}>
              <div style={s({ display: 'flex', alignItems: 'center', gap: 10 })}>
                <div style={s({ width: 28, height: 28, borderRadius: 8, background: insight.bg, color: insight.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 })}><i className={`fas ${insight.icon}`}></i></div>
                <div style={s({ flex: 1, minWidth: 0 })}><div style={s({ fontSize: 12, fontWeight: 800, color: DASH_NAVY })}>{insight.title}</div><div style={s({ fontSize: 11, color: 'var(--stone-500)', lineHeight: 1.5, marginTop: 2 })}>{insight.desc}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StoriesTab({ stories, loading, analysis, onAdd, onEdit, onDelete }: { stories: Story[]; loading: boolean; analysis: AnalysisPayload | null; onAdd: () => void; onEdit: (st: Story) => void; onDelete: (id: number) => void; }) {
  const aiById = new Map((analysis?.story_scores || []).map(sc => [sc.id, sc]));
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 })}>
        <div><div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY })}>Personal stories</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Capture 3–5 formative experiences. AI scores relevance for admissions essays.</div></div>
        <button onClick={onAdd} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--yellow)', border: 'none', borderRadius: 8, color: DASH_NAVY, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10 }}></i> Add story</button>
      </div>
      {loading ? (<div style={s({ textAlign: 'center', padding: 30, color: 'var(--stone-400)', fontSize: 12 })}>Loading…</div>
      ) : stories.length === 0 ? (
        <div style={s({ textAlign: 'center', padding: '36px 20px', background: 'var(--stone-50)', borderRadius: 12 })}>
          <div style={s({ fontSize: 30, marginBottom: 8 })}><i className="fas fa-book-heart" style={{ color: 'var(--stone-300)' }}></i></div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY, marginBottom: 4 })}>No stories yet</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-400)', maxWidth: 340, margin: '0 auto 14px', lineHeight: 1.5 })}>Pick moments that shaped you — a challenge, a turning point, a family experience. AI will score relevance for college essays.</div>
          <button onClick={onAdd} style={s({ padding: '8px 16px', background: DASH_NAVY, color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10, marginRight: 6 }}></i> Add your first story</button>
        </div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {stories.map(st => { const ai = st.id ? aiById.get(st.id) : undefined; return (
            <div key={st.id} style={s({ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: 'var(--stone-50)', borderRadius: 10 })}>
              <div style={s({ width: 36, height: 36, borderRadius: 10, background: '#FBEAF0', color: '#993556', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 })}><i className="fas fa-book"></i></div>
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 })}><div style={s({ fontSize: 13, fontWeight: 800, color: DASH_NAVY })}>{st.title}</div>{st.grade && <div style={s({ fontSize: 10, color: 'var(--stone-400)' })}>Grade {st.grade}</div>}</div>
                {st.summary && (<div style={s({ fontSize: 11, color: 'var(--stone-600)', lineHeight: 1.55 })}>{st.summary}</div>)}
                {st.theme_tags && st.theme_tags.length > 0 && (<div style={s({ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 })}>{st.theme_tags.map(t => (<span key={t} style={s({ fontSize: 9, padding: '2px 7px', background: '#EEEDFE', color: '#534AB7', borderRadius: 6, fontWeight: 700 })}>{t}</span>))}</div>)}
                {ai?.rationale && (<div style={s({ fontSize: 10, color: '#0F6E56', fontStyle: 'italic', marginTop: 6 })}><i className="fas fa-sparkles" style={{ marginRight: 4 }}></i>{ai.rationale}</div>)}
              </div>
              {ai && (<div style={s({ textAlign: 'center', minWidth: 44 })}><div style={s({ fontSize: 16, fontWeight: 900, color: DASH_NAVY })}>{ai.relevance.toFixed(1)}</div><div style={s({ fontSize: 9, color: 'var(--stone-400)' })}>relevance</div></div>)}
              <div style={s({ display: 'flex', gap: 4, flexShrink: 0 })}>
                <button onClick={() => onEdit(st)} title="Edit" style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--stone-500)', fontSize: 11 })}><i className="fas fa-pen"></i></button>
                <button onClick={() => onDelete(st.id!)} title="Remove" style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--red)', fontSize: 11 })}><i className="fas fa-trash"></i></button>
              </div>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

function RecommendationsTab({
  analysis,
  stale,
  loading,
  error,
  onRefresh,
  activitiesCount,
  storiesCount,
  onAddActivity,
  onAddStory,
}: {
  analysis: AnalysisPayload | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activitiesCount: number;
  storiesCount: number;
  onAddActivity: () => void;
  onAddStory: () => void;
}) {
  const recs = analysis?.recommendations || [];
  const hasContent = activitiesCount > 0 || storiesCount > 0;
  const primaryActionLabel = loading ? 'Analyzing...' : analysis ? (stale ? 'Refresh analysis' : 'Refresh') : 'Run analysis';
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 })}>
        <div><div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY })}>AI recommendations</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Concrete next moves based on your activities, stories, and academic profile.</div></div>
        {hasContent && (
          <button onClick={onRefresh} disabled={loading} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 13px', background: stale || !analysis ? DASH_NAVY : 'var(--card)', border: stale || !analysis ? 'none' : '1px solid var(--border)', borderRadius: 9, color: stale || !analysis ? '#fff' : 'var(--stone-700)', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' })}>
            <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles'}`} style={{ fontSize: 10 }}></i>
            {primaryActionLabel}
          </button>
        )}
      </div>
      {error && (<div style={s({ padding: 12, background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, fontSize: 12, marginBottom: 12 })}>{error}</div>)}
      {recs.length === 0 ? (
        <div style={s({ textAlign: 'center', padding: '36px 20px', background: 'var(--stone-50)', borderRadius: 12 })}>
          <div style={s({ width: 44, height: 44, borderRadius: 12, background: '#EEEDFE', color: '#534AB7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, marginBottom: 10 })}><i className="fas fa-lightbulb"></i></div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: DASH_NAVY })}>No recommendations yet</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-400)', maxWidth: 360, margin: '4px auto 14px', lineHeight: 1.5 })}>
            {hasContent ? 'Run analysis to turn your activities and personal stories into concrete next moves.' : 'Add an activity or personal story first so recommendations have something real to work from.'}
          </div>
          {!hasContent && (
            <div style={s({ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' })}>
              <button onClick={onAddActivity} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: DASH_NAVY, color: '#fff', border: 'none', borderRadius: 9, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10 }}></i>Add activity</button>
              <button onClick={onAddStory} style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--card)', color: 'var(--stone-800)', border: '1px solid var(--border)', borderRadius: 9, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}><i className="fas fa-plus" style={{ fontSize: 10 }}></i>Add story</button>
            </div>
          )}
        </div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {stale && (<div style={s({ padding: '8px 12px', background: '#FAEEDA', color: '#854F0B', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}><span><i className="fas fa-clock" style={{ marginRight: 6 }}></i>Profile changed since last analysis.</span><button onClick={onRefresh} style={s({ background: 'none', border: 'none', color: '#854F0B', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' })}>Refresh</button></div>)}
          {recs.map((r, i) => (
            <div key={i} style={s({ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: 'var(--stone-50)', borderRadius: 10 })}>
              <div style={s({ width: 32, height: 32, borderRadius: 10, background: '#E6F1FB', color: '#185FA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 })}><i className="fas fa-arrow-right"></i></div>
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ display: 'flex', alignItems: 'center', gap: 8 })}><div style={s({ fontSize: 13, fontWeight: 800, color: DASH_NAVY })}>{r.title}</div><span style={s({ fontSize: 9, padding: '2px 6px', background: 'var(--stone-100)', color: 'var(--stone-600)', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px' })}>{r.category}</span></div>
                <div style={s({ fontSize: 11, color: 'var(--stone-500)', lineHeight: 1.5, marginTop: 2 })}>{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════ Right rail components ═════════════════════════════

function RailProgressSlide({
  title,
  subtitle,
  icon,
  iconBg,
  iconColor,
  metric,
  metricLabel,
  progress,
  children,
  onClick,
}: {
  title: string;
  subtitle: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  metric: string | number;
  metricLabel: string;
  progress: number;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--stone-300)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLElement).style.transform = 'none';
      }}
      style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px', cursor: 'pointer', transition: 'all .15s' })}
    >
      <div style={s({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 })}>
        <div style={s({ width: 36, height: 36, borderRadius: 10, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 })}>
          <i className={`fas ${icon}`}></i>
        </div>
        <div style={s({ flex: 1, minWidth: 0 })}>
          <div style={s({ fontSize: 12, fontWeight: 800, color: DASH_NAVY, marginBottom: 2 })}>{title}</div>
          <div style={s({ fontSize: 10, fontWeight: 500, color: 'var(--stone-400)', lineHeight: 1.4 })}>{subtitle}</div>
        </div>
        <div style={s({ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--stone-300)', fontSize: 9, flexShrink: 0 })}>
          <i className="fas fa-chevron-right"></i>
        </div>
      </div>
      <div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 10 })}>
        <div>
          <div style={s({ fontSize: 28, fontWeight: 900, color: DASH_NAVY, letterSpacing: '-1px', lineHeight: 1 })}>{metric}</div>
          <div style={s({ fontSize: 9, fontWeight: 700, color: 'var(--stone-400)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '.3px' })}>{metricLabel}</div>
        </div>
        <div style={s({ display: 'flex', gap: 10, alignItems: 'center' })}>{children}</div>
      </div>
      <div style={s({ height: 6, background: 'var(--stone-100)', borderRadius: 99, overflow: 'hidden' })}>
        <div className="grow-bar" style={s({ width: `${Math.max(0, Math.min(progress, 100))}%`, height: '100%', background: iconColor, borderRadius: 99, transition: 'width .3s ease' })}></div>
      </div>
    </div>
  );
}

function CollegeListSlide({ total, reach, target, safety, onClick }: { total: number; reach: number; target: number; safety: number; onClick: () => void }) {
  const goal = 10;
  const progress = Math.min(Math.round((total / goal) * 100), 100);
  const subtitle = total === 0
    ? 'No schools saved yet'
    : `${reach} reach · ${target} target · ${safety} safety`;
  return (
    <RailProgressSlide
      title="College List"
      subtitle={subtitle}
      icon="fa-building-columns"
      iconBg="#E6F1FB"
      iconColor="var(--blue)"
      metric={total}
      metricLabel={`of ${goal} school goal`}
      progress={progress}
      onClick={onClick}
    >
      {[
        { label: 'R', count: reach, color: '#cc266d' },
        { label: 'T', count: target, color: '#0a2463' },
        { label: 'S', count: safety, color: '#06a77d' },
      ].map(b => (
        <div key={b.label} style={s({ textAlign: 'center' })}>
          <div style={s({ width: 22, height: 22, borderRadius: 7, background: b.color, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 900 })}>{b.count}</div>
          <div style={s({ fontSize: 8, fontWeight: 800, color: 'var(--stone-400)', marginTop: 3 })}>{b.label}</div>
        </div>
      ))}
    </RailProgressSlide>
  );
}

function EssayProgressSlide({ essays, drafts, ready, totalWords, progress, onClick }: { essays: number; drafts: number; ready: number; totalWords: number; progress: number; onClick: () => void }) {
  const subtitle = essays === 0
    ? 'No drafts yet'
    : `${drafts} active draft${drafts !== 1 ? 's' : ''} · ${ready} near-ready`;
  return (
    <RailProgressSlide
      title="Essay Progress"
      subtitle={subtitle}
      icon="fa-pen-nib"
      iconBg="var(--violet-light)"
      iconColor="var(--violet)"
      metric={`${progress}%`}
      metricLabel={essays === 0 ? 'portfolio progress' : `${totalWords.toLocaleString()} total words`}
      progress={progress}
      onClick={onClick}
    >
      <div style={s({ textAlign: 'center' })}>
        <div style={s({ fontSize: 18, fontWeight: 900, color: DASH_NAVY, lineHeight: 1 })}>{essays}</div>
        <div style={s({ fontSize: 9, fontWeight: 700, color: 'var(--stone-400)', marginTop: 3 })}>Essays</div>
      </div>
      <div style={s({ textAlign: 'center' })}>
        <div style={s({ fontSize: 18, fontWeight: 900, color: '#0F6E56', lineHeight: 1 })}>{ready}</div>
        <div style={s({ fontSize: 9, fontWeight: 700, color: 'var(--stone-400)', marginTop: 3 })}>Ready</div>
      </div>
    </RailProgressSlide>
  );
}

function CompletionCard({ completion, storyCount, onEditProfile }: { completion: ReturnType<typeof deriveCompletion>; storyCount: number; onEditProfile: () => void }) {
  const items = completion.items.map(it => it.key === 'stories' ? { ...it, phase: 1 as const, status: storyCount >= 3 ? 'done' as const : storyCount > 0 ? 'partial' as const : 'todo' as const, detail: storyCount === 0 ? 'Add your first story' : `${storyCount} of 3+ added` } : it);
  const phase1Pts = items.filter(i => i.phase === 1).reduce((sum, i) => sum + (i.status === 'done' ? 1 : i.status === 'partial' ? 0.5 : 0), 0);
  const phase1Count = items.filter(i => i.phase === 1).length;
  const pct = Math.round((phase1Pts / phase1Count) * 100);
  const compactLabel = (it: typeof items[number]) => {
    if (it.key === 'academic') return it.status === 'done' ? 'Academics complete' : 'Add GPA + score';
    if (it.key === 'activities') return it.status === 'todo' ? 'Add activities' : `Activities ${it.detail.replace(' added', '')}`;
    if (it.key === 'tests') return it.status === 'done' ? 'SAT + ACT added' : it.status === 'partial' ? it.detail : 'Add SAT or ACT';
    if (it.key === 'major') return it.status === 'done' ? 'Major selected' : 'Select intended major';
    if (it.key === 'stories') return it.status === 'todo' ? 'Add personal story' : `Stories ${it.detail.replace(' added', '')}`;
    return it.label;
  };
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, boxShadow: '0 10px 28px rgba(6,36,91,.04)' })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 })}>
        <div style={s({ fontSize: 14, lineHeight: 1.1, fontWeight: 950, color: DASH_NAVY })}>Core profile progress</div>
        <div style={s({ fontSize: 20, lineHeight: 1, fontWeight: 950, color: DASH_NAVY })}>{pct}%</div>
      </div>
      <div style={s({ height: 7, background: '#e8eef7', borderRadius: 99, overflow: 'hidden', marginBottom: 11, boxShadow: 'inset 0 0 0 1px rgba(6,36,91,.04)' })}>
        <div style={s({ width: `${pct}%`, height: '100%', background: DASH_NAVY, borderRadius: 99, transition: 'width .3s ease' })}></div>
      </div>
      <div style={s({ display: 'flex', flexDirection: 'column', gap: 6 })}>
        {items.map(it => { const isDone = it.status === 'done'; const isPartial = it.status === 'partial'; const isPhase2 = it.phase === 2; return (
          <div key={it.key} style={s({ display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid #edf1f7', borderRadius: 11, background: '#fff', opacity: isPhase2 ? 0.75 : 1 })}>
            <span style={s({ width: 24, height: 24, borderRadius: 8, display: 'grid', placeItems: 'center', background: isDone ? '#E5F7EF' : '#F2F4F7', color: isDone ? '#0F8B63' : isPartial ? DASH_NAVY : '#98A2B3', fontSize: 10, fontWeight: 950 })}><i className={`fas fa-${isDone ? 'check' : isPartial ? 'circle-half-stroke' : 'circle'}`}></i></span>
            <span style={s({ minWidth: 0, fontSize: 11, lineHeight: 1.15, color: DASH_NAVY, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{compactLabel(it)}</span>
            {isPhase2 ? (
              <span style={s({ fontSize: 10, padding: '4px 8px', borderRadius: 999, background: '#F2F4F7', color: 'var(--stone-500)', fontWeight: 900 })}>Open</span>
            ) : it.status === 'todo' ? (
              <button type="button" onClick={onEditProfile} aria-label={`Open ${it.label} in edit profile`} title={`Open ${it.label} in edit profile`} style={s({ fontSize: 10, padding: '4px 8px', borderRadius: 999, background: '#F7F8FA', color: DASH_NAVY, border: 'none', fontFamily: 'inherit', fontWeight: 900, whiteSpace: 'nowrap', cursor: 'pointer' })}>Open</button>
            ) : (
              <span style={s({ fontSize: 10, padding: '4px 8px', borderRadius: 999, background: isDone ? '#E5F7EF' : '#F7F8FA', color: isDone ? '#0F8B63' : DASH_NAVY, fontWeight: 900, whiteSpace: 'nowrap' })}>{isDone ? 'Done' : 'In progress'}</span>
            )}
          </div>
        ); })}
      </div>
    </div>
  );
}

function ThemesCard({ themes, analysis, hasContent }: { themes: ThemeScore[]; analysis: AnalysisPayload | null; hasContent: boolean }) {
  const usingLLM = !!analysis?.themes?.length;
  const visible = usingLLM ? analysis!.themes.slice(0, 4) : themes.filter(t => t.score > 0).slice(0, 4);
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 })}>
      <div style={s({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 })}>
        <div style={s({ fontSize: 12, fontWeight: 800, color: DASH_NAVY })}>Top themes</div>
        <span style={s({ fontSize: 10, padding: '2px 6px', background: usingLLM ? '#E1F5EE' : '#EEEDFE', color: usingLLM ? '#0F6E56' : '#534AB7', borderRadius: 6, fontWeight: 800 })}>{usingLLM ? 'AI · live' : 'Heuristic'}</span>
      </div>
      {!hasContent ? (
        <div style={s({ fontSize: 11, color: 'var(--stone-400)', textAlign: 'center', padding: '14px 8px', background: 'var(--stone-50)', borderRadius: 8, lineHeight: 1.6 })}>Add activities or stories to surface themes like Leadership, Resilience, and Community impact.</div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 10 })}>
          {visible.map((t: any) => { const v = THEME_VISUAL[t.key] || THEME_VISUAL.curiosity; return (
            <div key={t.key + (t.label || '')} title={t.rationale || ''}>
              <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 })}><span style={s({ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--stone-800)' })}><i className={`fas ${v.icon}`} style={{ color: v.color, fontSize: 11 }}></i>{t.label}</span><span style={s({ fontSize: 11, fontWeight: 800, color: v.color })}>{Number(t.score).toFixed(1)}</span></div>
              <div style={s({ height: 4, background: v.bg, borderRadius: 99, overflow: 'hidden' })}><div style={s({ width: `${(Number(t.score) / 10) * 100}%`, height: '100%', background: v.color })}></div></div>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

function TipFooter() {
  return (
    <div style={s({ marginTop: 16, padding: '14px 18px', background: '#FAEEDA', borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#633806' })}>
      <i className="fas fa-circle-info" style={{ fontSize: 14, color: '#854F0B' }}></i>
      <div><strong style={{ color: '#412402' }}>Tip:</strong> the more complete and authentic your profile, the better the AI can help you stand out.</div>
    </div>
  );
}

// ═════════════ Modals ═════════════════════════════════════════════

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (<><div onClick={onClose} style={s({ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(2px)' })} /><div style={s({ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px 26px', zIndex: 9999, boxShadow: '0 25px 60px rgba(0,0,0,.18)' })}>{children}</div></>);
}
function ModalCloseButton({ onClick }: { onClick: () => void }) { return (<button onClick={onClick} style={s({ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--stone-100)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--stone-500)', fontSize: 12 })}><i className="fas fa-times"></i></button>); }
function ModalField({ label, children }: { label: string; children: React.ReactNode }) { return (<div><label style={s({ fontSize: 10, fontWeight: 700, color: 'var(--stone-500)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.3px' })}>{label}</label>{children}</div>); }
function ModalActions({ children }: { children: React.ReactNode }) { return <div style={s({ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 })}>{children}</div>; }

const inputStyle: React.CSSProperties = { width: '100%', background: 'var(--stone-50)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, color: DASH_NAVY, outline: 'none' };
const selectStyle: React.CSSProperties = { ...inputStyle, appearance: 'none', cursor: 'pointer' };
const btnPrimary: React.CSSProperties = { padding: '8px 16px', background: DASH_NAVY, color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' };
const btnSecondary: React.CSSProperties = { padding: '8px 16px', background: 'var(--card)', color: 'var(--stone-700)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' };

function EditAcademicModal({ academic, gpaScale, intendedMajor, onCancel, onSave }: { academic: AcademicProfile; gpaScale: string; intendedMajor: string; onCancel: () => void; onSave: (next: AcademicProfile, nextMajor: string) => Promise<void>; }) {
  const [draft, setDraft] = useState<AcademicProfile>(academic);
  const [gpaDraft, setGpaDraft] = useState(academic.gpa ? Math.min(4, Number(academic.gpa)).toFixed(2) : '');
  const [draftMajor, setDraftMajor] = useState(intendedMajor);
  const [saving, setSaving] = useState(false);
  const handleNum = (k: keyof AcademicProfile, raw: string, min: number, max: number, integer = false) => {
    const stripped = raw.replace(/[^0-9.]/g, '');
    if (stripped === '' || stripped === '.') { setDraft(d => ({ ...d, [k]: 0 })); return; }
    let val = integer ? parseInt(stripped) : parseFloat(stripped);
    if (isNaN(val)) val = 0;
    val = Math.max(min, Math.min(max, val));
    setDraft(d => ({ ...d, [k]: integer ? Math.round(val) : Math.round(val * 100) / 100 }));
  };
  const handleGpa = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
    if (cleaned === '' || cleaned === '.') {
      setGpaDraft(cleaned);
      setDraft(d => ({ ...d, gpa: 0 }));
      return;
    }
    const limited = cleaned.match(/^\d*(?:\.\d{0,2})?/)?.[0] ?? '';
    const value = Math.min(4, parseFloat(limited) || 0);
    const nextText = value >= 4 ? '4.00' : limited;
    setGpaDraft(nextText);
    setDraft(d => ({ ...d, gpa: Math.round(value * 100) / 100 }));
  };
  const formatGpa = () => {
    setGpaDraft(draft.gpa ? Math.min(4, Number(draft.gpa)).toFixed(2) : '');
  };
  return (
    <Modal onClose={onCancel}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}><div><div style={s({ fontSize: 16, fontWeight: 900, color: DASH_NAVY })}>Edit academic profile</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Fields that drive your admissions profile score.</div></div><ModalCloseButton onClick={onCancel} /></div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 })}>
        <ModalField label="GPA (4.0)"><input type="text" inputMode="decimal" maxLength={4} value={gpaDraft} placeholder="4.00" onChange={e => handleGpa(e.target.value)} onBlur={formatGpa} style={inputStyle} /></ModalField>
        <ModalField label="SAT"><input type="text" inputMode="numeric" maxLength={4} value={draft.sat || ''} placeholder="1600" onChange={e => handleNum('sat', e.target.value, 0, 1600, true)} style={inputStyle} /></ModalField>
        <ModalField label="ACT"><input type="text" inputMode="numeric" maxLength={2} value={draft.act || ''} placeholder="36" onChange={e => handleNum('act', e.target.value, 0, 36, true)} style={inputStyle} /></ModalField>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 })}>
        <ModalField label="AP/IBs offered"><input type="number" min={0} max={30} value={draft.ap_offered} onChange={e => setDraft(d => ({ ...d, ap_offered: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)) }))} style={inputStyle} /></ModalField>
        <ModalField label="AP/IBs you took"><input type="number" min={0} max={25} value={draft.ap_taken} onChange={e => setDraft(d => ({ ...d, ap_taken: Math.max(0, Math.min(25, parseInt(e.target.value) || 0)) }))} style={inputStyle} /></ModalField>
      </div>
      <ModalField label="EC tier (school-wide recognition)"><select value={draft.ec_tier} onChange={e => setDraft(d => ({ ...d, ec_tier: parseInt(e.target.value) }))} style={selectStyle}><option value={1}>Tier 1: National / international recognition</option><option value={2}>Tier 2: State / regional leadership</option><option value={3}>Tier 3: School-level leadership</option><option value={4}>Tier 4: Club member / volunteer</option></select></ModalField>
      <div style={s({ marginTop: 10 })}><ModalField label="Leadership roles"><input type="range" min={0} max={10} value={draft.leadership_roles} onChange={e => setDraft(d => ({ ...d, leadership_roles: parseInt(e.target.value) }))} /><div style={s({ fontSize: 11, color: 'var(--stone-500)', marginTop: 4, textAlign: 'right' })}>{draft.leadership_roles}</div></ModalField></div>
      <div style={s({ marginTop: 10 })}><ModalField label="Intended major"><select value={draftMajor} onChange={e => setDraftMajor(e.target.value)} style={selectStyle}><option value="">Select…</option>{POPULAR_MAJORS.map(m => <option key={m} value={m}>{m}</option>)}</select></ModalField></div>
      <ModalActions><button onClick={onCancel} style={btnSecondary}>Cancel</button><button disabled={saving} onClick={async () => { setSaving(true); try { await onSave(draft, draftMajor); } finally { setSaving(false); } }} style={btnPrimary}>{saving ? 'Saving…' : 'Save changes'}</button></ModalActions>
    </Modal>
  );
}

function ActivityModal({ activity, onCancel, onSave }: { activity: Activity | null; onCancel: () => void; onSave: (a: Activity) => Promise<void>; }) {
  const [draft, setDraft] = useState<Activity>(activity ?? { name: '', category: 'leadership', role: '', hours_per_week: 4, start_grade: 10, end_grade: null, is_current: true, description: '' });
  const [saving, setSaving] = useState(false);
  return (
    <Modal onClose={onCancel}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}><div><div style={s({ fontSize: 16, fontWeight: 900, color: DASH_NAVY })}>{activity ? 'Edit activity' : 'Add activity'}</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Impact score recalculates automatically.</div></div><ModalCloseButton onClick={onCancel} /></div>
      <ModalField label="Activity name"><input type="text" maxLength={120} value={draft.name} placeholder="Debate club, food bank volunteer, etc." onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inputStyle} /></ModalField>
      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 })}>
        <ModalField label="Category"><select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value as ActivityCategory }))} style={selectStyle}>{(Object.keys(CATEGORY_META) as ActivityCategory[]).map(c => (<option key={c} value={c}>{CATEGORY_META[c].label}</option>))}</select></ModalField>
        <ModalField label="Role / title"><input type="text" maxLength={80} value={draft.role ?? ''} placeholder="Captain, founder, member…" onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} style={inputStyle} /></ModalField>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 })}>
        <ModalField label="Hours / week"><input type="number" min={0} max={40} value={draft.hours_per_week ?? 0} onChange={e => setDraft(d => ({ ...d, hours_per_week: Math.max(0, Math.min(40, parseInt(e.target.value) || 0)) }))} style={inputStyle} /></ModalField>
        <ModalField label="Start grade"><select value={draft.start_grade ?? 10} onChange={e => setDraft(d => ({ ...d, start_grade: parseInt(e.target.value) }))} style={selectStyle}>{[7, 8, 9, 10, 11, 12].map(g => <option key={g} value={g}>{g}th grade</option>)}</select></ModalField>
        <ModalField label="End grade"><select value={draft.is_current ? 'current' : (draft.end_grade ?? 12).toString()} onChange={e => { const v = e.target.value; if (v === 'current') setDraft(d => ({ ...d, is_current: true, end_grade: null })); else setDraft(d => ({ ...d, is_current: false, end_grade: parseInt(v) })); }} style={selectStyle}><option value="current">Current</option>{[8, 9, 10, 11, 12].map(g => <option key={g} value={g}>{g}th grade</option>)}</select></ModalField>
      </div>
      <ModalField label="Description (optional, 280 chars)"><textarea maxLength={280} value={draft.description ?? ''} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} rows={3} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} placeholder="What you did, impact, awards. Keep it short — like a Common App entry." /></ModalField>
      <div style={s({ marginTop: 10, padding: 10, background: 'var(--stone-50)', borderRadius: 8, fontSize: 11, color: 'var(--stone-500)' })}>Heuristic preview: <strong style={{ color: DASH_NAVY }}>{scoreActivityImpact(draft).score.toFixed(1)}/10 ({scoreActivityImpact(draft).label})</strong></div>
      <ModalActions><button onClick={onCancel} style={btnSecondary}>Cancel</button><button disabled={saving || !draft.name.trim()} onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }} style={btnPrimary}>{saving ? 'Saving…' : (activity ? 'Save changes' : 'Add activity')}</button></ModalActions>
    </Modal>
  );
}

function StoryModal({ story, onCancel, onSave }: { story: Story | null; onCancel: () => void; onSave: (st: Story) => Promise<void>; }) {
  const [draft, setDraft] = useState<Story>(story ?? { title: '', summary: '', grade: 10, theme_tags: [] });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const addTag = () => { const t = tagInput.trim().toLowerCase(); if (!t || t.length > 30) return; setDraft(d => ({ ...d, theme_tags: Array.from(new Set([...(d.theme_tags || []), t])).slice(0, 6) })); setTagInput(''); };
  const removeTag = (t: string) => { setDraft(d => ({ ...d, theme_tags: (d.theme_tags || []).filter(x => x !== t) })); };
  return (
    <Modal onClose={onCancel}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}><div><div style={s({ fontSize: 16, fontWeight: 900, color: DASH_NAVY })}>{story ? 'Edit story' : 'Add story'}</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>A formative experience worth telling colleges about.</div></div><ModalCloseButton onClick={onCancel} /></div>
      <ModalField label="Story title"><input type="text" maxLength={120} value={draft.title} placeholder="Overcoming stage fright, first in my family, etc." onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} style={inputStyle} /></ModalField>
      <div style={s({ marginTop: 10 })}><ModalField label="Summary (what happened, what changed in you)"><textarea value={draft.summary} maxLength={2000} rows={5} onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }} placeholder="Briefly describe the experience and what you learned. 2–4 sentences." /></ModalField></div>
      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 10 })}>
        <ModalField label="Grade"><select value={draft.grade ?? 10} onChange={e => setDraft(d => ({ ...d, grade: parseInt(e.target.value) }))} style={selectStyle}>{[7, 8, 9, 10, 11, 12].map(g => <option key={g} value={g}>{g}th</option>)}</select></ModalField>
        <ModalField label="Theme tags (optional, up to 6)">
          <div style={s({ display: 'flex', gap: 6 })}><input type="text" value={tagInput} maxLength={30} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} style={inputStyle} placeholder="family, identity, leadership..." /><button type="button" onClick={addTag} style={btnSecondary}>+ Add</button></div>
          {(draft.theme_tags || []).length > 0 && (<div style={s({ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 })}>{(draft.theme_tags || []).map(t => (<span key={t} onClick={() => removeTag(t)} style={s({ fontSize: 10, padding: '3px 8px', background: '#EEEDFE', color: '#534AB7', borderRadius: 6, fontWeight: 700, cursor: 'pointer' })} title="Click to remove">{t} ×</span>))}</div>)}
        </ModalField>
      </div>
      <ModalActions><button onClick={onCancel} style={btnSecondary}>Cancel</button><button disabled={saving || !draft.title.trim()} onClick={async () => { setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }} style={btnPrimary}>{saving ? 'Saving…' : (story ? 'Save changes' : 'Add story')}</button></ModalActions>
    </Modal>
  );
}

function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}><div style={s({ fontSize: 16, fontWeight: 900, color: DASH_NAVY })}>How the profile builder works</div><ModalCloseButton onClick={onClose} /></div>
      <ol style={s({ paddingLeft: 18, fontSize: 13, color: 'var(--stone-700)', lineHeight: 1.7, margin: 0 })}>
        <li><strong>Academic</strong> — enter your GPA, SAT/ACT, AP count. We map these to selective-pool percentiles to compute your score.</li>
        <li><strong>Activities</strong> — add up to 10. Each one earns an impact score based on category, role, longevity, and hours.</li>
        <li><strong>Top themes</strong> — derived from your activity tags (heuristic in Phase 1, AI in Phase 2).</li>
        <li><strong>Generate essay ideas</strong> — your themes feed the Essay Lab tools so prompts are personalized.</li>
      </ol>
      <div style={s({ marginTop: 16, padding: 12, background: 'var(--stone-50)', borderRadius: 8, fontSize: 11, color: 'var(--stone-500)' })}>Not a prediction. Always consult a qualified school counselor.</div>
      <ModalActions><button onClick={onClose} style={btnPrimary}>Got it</button></ModalActions>
    </Modal>
  );
}

// ═════════════ Export ═════════════════════════════════════════════
export default function DashboardPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#a8a29e' }}>Loading…</div>}>
      <DashboardInner />
    </Suspense>
  );
}
