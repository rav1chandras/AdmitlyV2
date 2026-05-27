'use client';

/**
 * Profile Builder (redesign) — mirrors the multi-section "stand out in
 * admissions" layout instead of the old calculator UI. We keep the
 * existing calcProfileScore behaviour intact (the engine is unchanged)
 * but surface it through a richer narrative: hero verdict, profile
 * completion checklist, AI-ready themes, activity cards, and an essay
 * ideas CTA. Phase 2 will swap heuristic themes/strengthen for LLM.
 *
 * Data sources:
 *   - /api/profile           GET + POST (academic fields, final_score)
 *   - /api/profile/activities GET/POST/PATCH/DELETE (new)
 *   - /api/settings           GET + PUT (intended_major sync)
 *   - lib/profile-insights    deriveThemes / scoreActivityImpact / deriveCompletion
 *
 * Phase 1 features are fully wired. Phase 2 sections render as styled
 * placeholders with the "AI-powered" badge so the layout looks
 * complete from day one.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
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

// ── Phase 2: stories + LLM analysis types ──
interface Story {
  id?: number;
  title: string;
  summary: string;
  grade?: number | null;
  theme_tags?: string[];
}

// ───── Types ─────────────────────────────────────────────────────
interface AcademicProfile {
  gpa: number; sat: number; act: number;
  ap_offered: number; ap_taken: number;
  ec_tier: number; leadership_roles: number;
  is_ed: boolean; is_athlete: boolean; is_legacy: boolean;
  major_multiplier: number; final_score: number;
}

const DEFAULTS: AcademicProfile = {
  gpa: 0, sat: 0, act: 0, ap_offered: 21, ap_taken: 0,
  ec_tier: 3, leadership_roles: 1,
  is_ed: false, is_athlete: false, is_legacy: false,
  major_multiplier: 1.0, final_score: 0,
};

type TabId = 'academic' | 'activities' | 'story' | 'strengths' | 'recs';

const s = (o: React.CSSProperties) => o;

// ───── Category visual metadata ──────────────────────────────────
const CATEGORY_META: Record<ActivityCategory, { icon: string; bg: string; color: string; label: string }> = {
  leadership: { icon: 'fa-users',            bg: '#EEEDFE', color: '#534AB7', label: 'Leadership' },
  community:  { icon: 'fa-heart',            bg: '#FBEAF0', color: '#993556', label: 'Community service' },
  arts:       { icon: 'fa-palette',          bg: '#FAEEDA', color: '#854F0B', label: 'Arts' },
  academic:   { icon: 'fa-flask',            bg: '#E6F1FB', color: '#185FA5', label: 'Academic' },
  athletics:  { icon: 'fa-medal',            bg: '#E1F5EE', color: '#0F6E56', label: 'Athletics' },
  work:       { icon: 'fa-briefcase',        bg: '#F1EFE8', color: '#5F5E5A', label: 'Work' },
  other:      { icon: 'fa-circle',           bg: '#F1EFE8', color: '#5F5E5A', label: 'Other' },
};

const THEME_VISUAL: Record<string, { icon: string; color: string; bg: string }> = {
  leadership:       { icon: 'fa-users-line',    color: '#534AB7', bg: '#EEEDFE' },
  community_impact: { icon: 'fa-heart',         color: '#993556', bg: '#FBEAF0' },
  resilience:       { icon: 'fa-seedling',      color: '#0F6E56', bg: '#E1F5EE' },
  curiosity:        { icon: 'fa-lightbulb',     color: '#185FA5', bg: '#E6F1FB' },
  creativity:       { icon: 'fa-paintbrush',    color: '#854F0B', bg: '#FAEEDA' },
};

// ───── Helpers ───────────────────────────────────────────────────
function categoryTotal(activities: Activity[], cat: ActivityCategory) {
  return activities.filter(a => a.category === cat).length;
}

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
export default function ProfilePage() {
  const router = useRouter();
  const { isPaid } = useProCheck();

  // Academic profile state (matches existing /api/profile shape)
  const [academic, setAcademic] = useState<AcademicProfile>(DEFAULTS);
  const [gpaScale, setGpaScale] = useState<string>('4.0');
  const [intendedMajor, setIntendedMajor] = useState('');
  const [school, setSchool] = useState('');
  const [graduationYear, setGraduationYear] = useState<number | null>(null);
  const [classRank, setClassRank] = useState('');

  // Activities state
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  // Stories state (Phase 2)
  const [stories, setStories] = useState<Story[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);

  // LLM analysis state (Phase 2)
  const [analysis, setAnalysis] = useState<AnalysisPayload | null>(null);
  const [analysisStale, setAnalysisStale] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisGeneratedAt, setAnalysisGeneratedAt] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<TabId>('academic');
  const [editAcademicOpen, setEditAcademicOpen] = useState(false);
  const [activityModal, setActivityModal] = useState<{ open: boolean; editing: Activity | null }>({ open: false, editing: null });
  const [storyModal, setStoryModal] = useState<{ open: boolean; editing: Story | null }>({ open: false, editing: null });
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);

  // ── Initial load ──
  useEffect(() => {
    fetch('/api/profile').then(r => r.ok ? r.json() : null).then(p => {
      if (p) {
        // pg returns numeric columns as strings; coerce so .toFixed/comparisons work.
        const num = (v: any, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
        const merged: AcademicProfile = {
          ...DEFAULTS,
          ...p,
          gpa:              num(p.gpa),
          sat:              num(p.sat),
          act:              num(p.act),
          ap_offered:       num(p.ap_offered) > 0 ? num(p.ap_offered) : DEFAULTS.ap_offered,
          ap_taken:         num(p.ap_taken),
          ec_tier:          num(p.ec_tier) > 0 ? num(p.ec_tier) : DEFAULTS.ec_tier,
          leadership_roles: (num(p.leadership_roles) > 0 || num(p.gpa) > 0) ? num(p.leadership_roles) : DEFAULTS.leadership_roles,
          major_multiplier: num(p.major_multiplier, 1.0),
          final_score:      num(p.final_score),
        };
        setAcademic(merged);
      }
    }).catch(() => {});

    fetch('/api/settings').then(r => r.ok ? r.json() : null).then(s => {
      if (s?.gpa_scale) setGpaScale(s.gpa_scale);
      if (s?.intended_major) setIntendedMajor(s.intended_major);
      // student_settings stores `high_school_name`/`high_school_city`/`high_school_state` — combine for display
      const sch = s?.high_school_name
        ? `${s.high_school_name}${s.high_school_city ? ', ' + s.high_school_city : ''}${s.high_school_state ? ' ' + s.high_school_state : ''}`
        : '';
      if (sch) setSchool(sch);
      if (s?.graduation_year) setGraduationYear(Number(s.graduation_year));
      // No class_rank column in DB. We display it from the user's local input if they add it.
      if (s?.class_rank) setClassRank(s.class_rank);
    }).catch(() => {});

    fetch('/api/profile/activities').then(r => r.ok ? r.json() : { activities: [] }).then(d => {
      setActivities(Array.isArray(d.activities) ? d.activities : []);
      setActivitiesLoading(false);
    }).catch(() => setActivitiesLoading(false));

    fetch('/api/profile/stories').then(r => r.ok ? r.json() : { stories: [] }).then(d => {
      setStories(Array.isArray(d.stories) ? d.stories : []);
      setStoriesLoading(false);
    }).catch(() => setStoriesLoading(false));

    // Pull cached LLM analysis if any
    fetch('/api/profile/analyze').then(r => r.ok ? r.json() : null).then(d => {
      if (d?.cached && d?.payload) {
        setAnalysis(d.payload);
        setAnalysisStale(!!d.stale);
        setAnalysisGeneratedAt(d.generated_at ?? null);
      }
    }).catch(() => {});
  }, []);

  // ── Score (unchanged engine) ──
  const breakdown = useMemo(
    () => calcProfileScore({ ...academic, gpa_scale: gpaScale }),
    [academic, gpaScale]
  );
  const score = breakdown.finalScore;

  // ── Themes + completion (Phase 1 heuristics) ──
  const themes: ThemeScore[] = useMemo(() => deriveThemes(activities), [activities]);
  const completion = useMemo(() => deriveCompletion({
    has_academic: academic.gpa > 0 && (academic.sat > 0 || academic.act > 0),
    activity_count: activities.length,
    has_sat: academic.sat > 0,
    has_act: academic.act > 0,
    has_intended_major: !!intendedMajor,
  }), [academic, activities, intendedMajor]);

  // ── Save academic (used by edit modal) ──
  const saveAcademic = useCallback(async (next: AcademicProfile, nextMajor: string) => {
    setAcademic(next);
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...next, final_score: calcProfileScore({ ...next, gpa_scale: gpaScale }).finalScore }),
    });
    if (nextMajor !== intendedMajor) {
      setIntendedMajor(nextMajor);
      try {
        const sRes = await fetch(`/api/settings?t=${Date.now()}`, { cache: 'no-store' });
        if (sRes.ok) {
          const current = await sRes.json();
          await fetch('/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...current, intended_major: nextMajor }),
          });
        }
      } catch {}
    }
  }, [gpaScale, intendedMajor]);

  // ── Activity CRUD ──
  const refreshActivities = async () => {
    const r = await fetch('/api/profile/activities', { cache: 'no-store' });
    const d = await r.json();
    setActivities(Array.isArray(d.activities) ? d.activities : []);
  };

  const saveActivity = async (a: Activity) => {
    const method = a.id ? 'PATCH' : 'POST';
    const r = await fetch('/api/profile/activities', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    });
    if (r.ok) {
      await refreshActivities();
      setAnalysisStale(true);
    } else {
      const d = await r.json().catch(() => ({}));
      alert(d.error || 'Failed to save activity.');
    }
  };

  const deleteActivity = async (id: number) => {
    if (!confirm('Remove this activity?')) return;
    const r = await fetch('/api/profile/activities', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      await refreshActivities();
      setAnalysisStale(true);
    }
  };

  // ── Story CRUD ──
  const refreshStories = async () => {
    const r = await fetch('/api/profile/stories', { cache: 'no-store' });
    const d = await r.json();
    setStories(Array.isArray(d.stories) ? d.stories : []);
  };

  const saveStory = async (st: Story) => {
    const method = st.id ? 'PATCH' : 'POST';
    const r = await fetch('/api/profile/stories', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(st),
    });
    if (r.ok) {
      await refreshStories();
      setAnalysisStale(true);
    } else {
      const d = await r.json().catch(() => ({}));
      alert(d.error || 'Failed to save story.');
    }
  };

  const deleteStory = async (id: number) => {
    if (!confirm('Remove this story?')) return;
    const r = await fetch('/api/profile/stories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      await refreshStories();
      setAnalysisStale(true);
    }
  };

  // ── LLM Analysis trigger ──
  const runAnalysis = async (force = false) => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const r = await fetch('/api/profile/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const d = await r.json();
      if (!r.ok) {
        setAnalysisError(d.error || 'Analysis failed.');
        return;
      }
      if (d?.payload) {
        setAnalysis(d.payload);
        setAnalysisStale(false);
        setAnalysisGeneratedAt(d.generated_at ?? null);
      }
    } catch (err: any) {
      setAnalysisError(err?.message || 'Analysis failed.');
    } finally {
      setAnalysisLoading(false);
    }
  };

  // ── UI ──
  return (
    <AppShell>
      <main style={s({ flex: 1, padding: '36px 40px 60px', maxWidth: 1280, overflowY: 'auto' })}>
        <Header onAdd={() => setActivityModal({ open: true, editing: null })} onHow={() => setHowItWorksOpen(true)} />

        {/* ROW 1: hero (2fr) | completion (1fr) | themes (1fr) */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 14, marginBottom: 16 })}>
          <Hero breakdown={breakdown} score={score} activitiesCount={activities.length} analysis={analysis} />
          <CompletionCard completion={completion} storyCount={stories.length} />
          <ThemesCard themes={themes} analysis={analysis} hasContent={activities.length > 0 || stories.length > 0} />
        </div>

        {/* ROW 2: main (3fr) | sidebar (1fr) */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 1fr)', gap: 14 })}>
          {/* ── Main column ── */}
          <div style={s({ minWidth: 0 })}>
            <TabNav active={activeTab} onChange={setActiveTab} activitiesCount={activities.length} />

            {activeTab === 'academic' && (
              <AcademicTab
                academic={academic}
                gpaScale={gpaScale}
                intendedMajor={intendedMajor}
                school={school}
                graduationYear={graduationYear}
                classRank={classRank}
                onEdit={() => setEditAcademicOpen(true)}
              />
            )}
            {activeTab === 'activities' && (
              <ActivitiesTab
                activities={activities}
                loading={activitiesLoading}
                onAdd={() => setActivityModal({ open: true, editing: null })}
                onEdit={a => setActivityModal({ open: true, editing: a })}
                onDelete={deleteActivity}
              />
            )}
            {activeTab === 'story' && (
              <StoriesTab
                stories={stories}
                loading={storiesLoading}
                analysis={analysis}
                onAdd={() => setStoryModal({ open: true, editing: null })}
                onEdit={st => setStoryModal({ open: true, editing: st })}
                onDelete={deleteStory}
              />
            )}
            {activeTab === 'strengths' && <StrengthsTab breakdown={breakdown} />}
            {activeTab === 'recs' && (
              <RecommendationsTab
                analysis={analysis}
                stale={analysisStale}
                loading={analysisLoading}
                error={analysisError}
                onRefresh={() => runAnalysis(true)}
                hasContent={activities.length > 0 || stories.length > 0}
              />
            )}

            {/* ROW 3: top activities | personal story highlights (always visible at bottom of main col) */}
            <div style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, marginTop: 14 })}>
              <TopActivitiesPreview activities={activities} analysis={analysis} onClickAll={() => setActiveTab('activities')} />
              <PersonalStoryHighlightsPreview
                stories={stories}
                analysis={analysis}
                onClickAll={() => setActiveTab('story')}
              />
            </div>
          </div>

          {/* ── Right rail (Areas + Essay CTA only — Completion & Themes moved up) ── */}
          <aside style={s({ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 })}>
            <AreasToStrengthen breakdown={breakdown} analysis={analysis} />
            <AiRefreshCard
              analysis={analysis}
              stale={analysisStale}
              loading={analysisLoading}
              error={analysisError}
              generatedAt={analysisGeneratedAt}
              hasContent={activities.length > 0 || stories.length > 0}
              onRefresh={() => runAnalysis(true)}
            />
            <EssayCta isPaid={isPaid} onClick={() => router.push('/essay-lab')} />
          </aside>
        </div>

        <TipFooter />
      </main>

      {/* ── Modals ── */}
      {editAcademicOpen && (
        <EditAcademicModal
          academic={academic}
          gpaScale={gpaScale}
          intendedMajor={intendedMajor}
          onCancel={() => setEditAcademicOpen(false)}
          onSave={async (next, nextMajor) => {
            await saveAcademic(next, nextMajor);
            setEditAcademicOpen(false);
          }}
        />
      )}

      {activityModal.open && (
        <ActivityModal
          activity={activityModal.editing}
          onCancel={() => setActivityModal({ open: false, editing: null })}
          onSave={async a => { await saveActivity(a); setActivityModal({ open: false, editing: null }); }}
        />
      )}

      {storyModal.open && (
        <StoryModal
          story={storyModal.editing}
          onCancel={() => setStoryModal({ open: false, editing: null })}
          onSave={async st => { await saveStory(st); setStoryModal({ open: false, editing: null }); }}
        />
      )}

      {howItWorksOpen && <HowItWorksModal onClose={() => setHowItWorksOpen(false)} />}
    </AppShell>
  );
}

// ═════════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═════════════════════════════════════════════════════════════════

function Header({ onAdd, onHow }: { onAdd: () => void; onHow: () => void }) {
  return (
    <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, gap: 12 })}>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 12 })}>
        <div style={s({ width: 42, height: 42, borderRadius: 12, background: 'var(--yellow)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--stone-900)' })}>
          <i className="fas fa-sparkles"></i>
        </div>
        <div>
          <h1 style={s({ fontSize: 26, fontWeight: 900, color: 'var(--stone-900)', letterSpacing: '-0.3px' })}>Profile builder</h1>
          <p style={s({ fontSize: 13, color: 'var(--stone-400)', margin: 0 })}>Build a stronger profile. Tell your story. Stand out.</p>
        </div>
      </div>
      <div style={s({ display: 'flex', gap: 8 })}>
        <button onClick={onHow}
          style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--stone-700)', cursor: 'pointer' })}>
          <i className="fas fa-circle-play" style={{ fontSize: 11 }}></i> How it works
        </button>
        <button onClick={onAdd}
          style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--yellow)', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, color: 'var(--stone-900)', cursor: 'pointer' })}>
          <i className="fas fa-plus" style={{ fontSize: 11 }}></i> Add activity
        </button>
      </div>
    </div>
  );
}

function Hero({ breakdown, score, activitiesCount, analysis }: { breakdown: ReturnType<typeof calcProfileScore>; score: number; activitiesCount: number; analysis: AnalysisPayload | null }) {
  // Prefer LLM verdict if cached. Falls back to calcProfileScore's verdict for first-paint.
  const verdict = analysis?.verdict?.label || breakdown.verdict || 'Building';
  const nextStep = analysis?.verdict?.subtitle
    || (activitiesCount < 3
      ? `Add ${3 - activitiesCount} more ${activitiesCount === 2 ? 'activity' : 'activities'} to unlock theme insights.`
      : score >= 85 ? 'You\'re in elite territory — focus on essays next.'
      : score >= 70 ? 'Strong base. Push for stretch tier with one more leadership role.'
      : 'Strengthen your activities and test scores to climb the next tier.');

  return (
    <div style={s({ borderRadius: 'var(--radius)', background: 'var(--yellow)', padding: '24px 28px', position: 'relative', overflow: 'hidden', marginBottom: 0 })}>
      <div style={s({ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'rgba(0,0,0,.04)', right: -80, bottom: -100 })}></div>
      <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 28, position: 'relative' })}>
        <div style={s({ flex: 1, minWidth: 0 })}>
          <div style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,.07)', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 800, color: 'var(--stone-800)', marginBottom: 12 })}>
            <i className="fas fa-shield-halved" style={{ fontSize: 10 }}></i> Admissions profile score
          </div>
          <h2 style={s({ fontSize: 28, fontWeight: 900, color: 'var(--stone-900)', letterSpacing: '-0.5px', lineHeight: 1.15, marginBottom: 6 })}>{verdict}</h2>
          <p style={s({ fontSize: 13, fontWeight: 500, color: 'rgba(28,25,23,.6)', maxWidth: 460, lineHeight: 1.5, margin: 0 })}>{nextStep}</p>
          <div style={s({ marginTop: 12 })}>
            <span style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--stone-900)', color: 'var(--yellow)', padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800 })}>
              <span style={s({ width: 6, height: 6, borderRadius: '50%', background: 'var(--yellow)' })}></span>
              {verdict}
            </span>
          </div>
        </div>
        <div style={s({ textAlign: 'center', flexShrink: 0 })}>
          <div style={s({ fontSize: 60, fontWeight: 900, lineHeight: 1, letterSpacing: '-2px', color: 'var(--stone-900)' })}>
            {score}<span style={s({ fontSize: 20, fontWeight: 600, color: 'rgba(28,25,23,.35)', marginLeft: 2 })}>/99</span>
          </div>
          <div style={s({ fontSize: 11, fontWeight: 700, color: 'rgba(28,25,23,.55)', marginTop: 6 })}>
            {score >= 85 ? 'Top 5%' : score >= 75 ? 'Top 15%' : score >= 60 ? 'Top 35%' : 'Building'}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabNav({ active, onChange, activitiesCount }: { active: TabId; onChange: (t: TabId) => void; activitiesCount: number }) {
  const tabs: { id: TabId; label: string; icon: string; phase: 1 | 2; badge?: string }[] = [
    { id: 'academic',   label: 'Academic',     icon: 'fa-graduation-cap', phase: 1 },
    { id: 'activities', label: 'Activities',   icon: 'fa-users',          phase: 1, badge: activitiesCount > 0 ? String(activitiesCount) : undefined },
    { id: 'story',      label: 'Personal story', icon: 'fa-heart',        phase: 2 },
    { id: 'strengths',  label: 'Strengths & gaps', icon: 'fa-chart-line', phase: 1 },
    { id: 'recs',       label: 'Recommendations', icon: 'fa-lightbulb',  phase: 2 },
  ];

  return (
    <div style={s({ display: 'flex', flexWrap: 'wrap', gap: 4, padding: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 14 })}>
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)}
            style={s({
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', border: 'none', borderRadius: 10,
              fontFamily: 'inherit', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap',
              background: isActive ? 'var(--stone-900)' : 'transparent',
              color: isActive ? '#fff' : 'var(--stone-500)',
              transition: 'all .15s',
            })}>
            <i className={`fas ${t.icon}`} style={{ fontSize: 11 }}></i>
            {t.label}
            {t.badge && (
              <span style={s({ background: isActive ? 'rgba(255,255,255,.2)' : 'var(--stone-100)', color: isActive ? '#fff' : 'var(--stone-600)', padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 800 })}>{t.badge}</span>
            )}
            {t.phase === 2 && (
              <span style={s({ background: isActive ? 'rgba(255,255,255,.18)' : 'var(--stone-100)', color: isActive ? '#fff' : 'var(--stone-500)', padding: '1px 5px', borderRadius: 6, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.3px' })}>AI soon</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═════════════ Academic tab ════════════════════════════════════
function AcademicTab({ academic, gpaScale, intendedMajor, school, graduationYear, classRank, onEdit }: {
  academic: AcademicProfile; gpaScale: string; intendedMajor: string;
  school: string; graduationYear: number | null; classRank: string;
  onEdit: () => void;
}) {
  const cards: { label: string; value: string; sub?: string }[] = [
    { label: `GPA (${gpaScale === '5.0' ? 'W' : 'UW'})`, value: academic.gpa ? Number(academic.gpa).toFixed(2) : '—', sub: gpaScale === '5.0' ? 'Weighted' : 'Unweighted' },
    { label: 'SAT', value: academic.sat ? String(academic.sat) : '—', sub: academic.sat ? 'Best score' : 'Not set' },
    { label: 'ACT', value: academic.act ? String(academic.act) : '—', sub: academic.act ? 'Best score' : 'Not set' },
    { label: 'AP / honors', value: academic.ap_taken ? `${academic.ap_taken} APs` : '—', sub: academic.ap_offered ? `of ${academic.ap_offered} offered` : '' },
    { label: 'Intended major', value: intendedMajor || '—' },
    { label: 'School', value: school || '—' },
    { label: 'Graduation year', value: graduationYear ? String(graduationYear) : '—' },
    { label: 'Class rank', value: classRank || '—' },
  ];

  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 })}>
        <div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)' })}>Academic profile</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Drives your score. Update whenever your numbers change.</div>
        </div>
        <button onClick={onEdit}
          style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--stone-900)', border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer' })}>
          <i className="fas fa-pen-to-square" style={{ fontSize: 10 }}></i> Edit
        </button>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 })}>
        {cards.map(c => (
          <div key={c.label} style={s({ background: 'var(--stone-50)', borderRadius: 10, padding: '10px 12px' })}>
            <div style={s({ fontSize: 10, fontWeight: 700, color: 'var(--stone-400)', textTransform: 'uppercase', letterSpacing: '.3px' })}>{c.label}</div>
            <div style={s({ fontSize: 16, fontWeight: 800, color: 'var(--stone-900)', marginTop: 4 })}>{c.value}</div>
            {c.sub && <div style={s({ fontSize: 10, color: 'var(--stone-400)', marginTop: 2 })}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═════════════ Activities tab ════════════════════════════════════
function ActivitiesTab({ activities, loading, onAdd, onEdit, onDelete }: {
  activities: Activity[]; loading: boolean;
  onAdd: () => void; onEdit: (a: Activity) => void; onDelete: (id: number) => void;
}) {
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)' })}>Activities</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Up to 10. Impact score uses a heuristic (longevity × hours × role).</div>
        </div>
        <button onClick={onAdd}
          style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--yellow)', border: 'none', borderRadius: 8, color: 'var(--stone-900)', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}>
          <i className="fas fa-plus" style={{ fontSize: 10 }}></i> Add
        </button>
      </div>

      {loading ? (
        <div style={s({ textAlign: 'center', padding: 30, color: 'var(--stone-400)', fontSize: 12 })}>Loading…</div>
      ) : activities.length === 0 ? (
        <div style={s({ textAlign: 'center', padding: '36px 20px', background: 'var(--stone-50)', borderRadius: 12 })}>
          <div style={s({ fontSize: 30, marginBottom: 8 })}><i className="fas fa-people-arrows" style={{ color: 'var(--stone-300)' }}></i></div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)', marginBottom: 4 })}>No activities yet</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-400)', marginBottom: 14, maxWidth: 320, margin: '0 auto 14px' })}>Add your top activities to unlock theme insights and stronger essay suggestions.</div>
          <button onClick={onAdd} style={s({ padding: '8px 16px', background: 'var(--stone-900)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}>
            <i className="fas fa-plus" style={{ fontSize: 10, marginRight: 6 }}></i> Add your first activity
          </button>
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
                <div style={s({ width: 36, height: 36, borderRadius: 10, background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 })}>
                  <i className={`fas ${meta.icon}`}></i>
                </div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ fontSize: 13, fontWeight: 800, color: 'var(--stone-900)' })}>{a.name}</div>
                  <div style={s({ fontSize: 11, color: 'var(--stone-500)', marginTop: 2 })}>
                    {meta.label}{a.role ? ` · ${a.role}` : ''}{gradeRangeLabel(a) ? ` · ${gradeRangeLabel(a)}` : ''}{a.hours_per_week ? ` · ${a.hours_per_week}h/wk` : ''}
                  </div>
                </div>
                <div style={s({ fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 8, background: badgeBg, color: badgeColor, flexShrink: 0 })}>{impact.label}</div>
                <div style={s({ fontSize: 16, fontWeight: 900, color: 'var(--stone-900)', minWidth: 36, textAlign: 'right' })}>{impact.score.toFixed(1)}</div>
                <div style={s({ display: 'flex', gap: 4, flexShrink: 0 })}>
                  <button onClick={() => onEdit(a)} title="Edit"
                    style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--stone-500)', fontSize: 11 })}>
                    <i className="fas fa-pen"></i>
                  </button>
                  <button onClick={() => onDelete(a.id!)} title="Remove"
                    style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--red)', fontSize: 11 })}>
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TopActivitiesPreview({ activities, analysis, onClickAll }: { activities: Activity[]; analysis: AnalysisPayload | null; onClickAll: () => void }) {
  if (activities.length === 0) return null;
  // Use LLM activity_scores if available — falls back to heuristic.
  const aiById = new Map((analysis?.activity_scores || []).map(a => [a.id, a]));
  const top = activities
    .map(a => {
      const ai = a.id ? aiById.get(a.id) : undefined;
      const heur = scoreActivityImpact(a);
      const score = ai ? ai.score : heur.score;
      const label = ai ? ai.label : heur.label;
      const usingAI = !!ai;
      return { a, score, label, usingAI };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 3);
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18 })}>
      <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 })}>
        <div style={s({ fontSize: 13, fontWeight: 800, color: 'var(--stone-900)' })}>Top activities</div>
        <button onClick={onClickAll}
          style={s({ background: 'none', border: 'none', fontSize: 11, fontWeight: 800, color: '#854F0B', cursor: 'pointer', fontFamily: 'inherit' })}>
          View all ({activities.length}) →
        </button>
      </div>
      <div style={s({ display: 'flex', flexDirection: 'column', gap: 6 })}>
        {top.map(({ a, score, usingAI }) => {
          const meta = CATEGORY_META[a.category];
          return (
            <div key={a.id} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--stone-50)', borderRadius: 8 })}>
              <div style={s({ width: 28, height: 28, borderRadius: 8, background: meta.bg, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 })}>
                <i className={`fas ${meta.icon}`}></i>
              </div>
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>{a.name}</div>
                <div style={s({ fontSize: 10, color: 'var(--stone-400)' })}>{meta.label}{gradeRangeLabel(a) ? ` · ${gradeRangeLabel(a)}` : ''}{usingAI ? ' · AI' : ''}</div>
              </div>
              <div style={s({ fontSize: 14, fontWeight: 900, color: 'var(--stone-900)' })}>{score.toFixed(1)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════ Personal Story Highlights (top 3 by LLM relevance) ══
function PersonalStoryHighlightsPreview({ stories, analysis, onClickAll }: {
  stories: Story[]; analysis: AnalysisPayload | null; onClickAll: () => void;
}) {
  const aiById = new Map((analysis?.story_scores || []).map(sc => [sc.id, sc]));
  if (stories.length === 0) {
    return (
      <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 160, textAlign: 'center' })}>
        <div style={s({ width: 40, height: 40, borderRadius: 10, background: '#FBEAF0', color: '#993556', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, marginBottom: 10 })}>
          <i className="fas fa-heart"></i>
        </div>
        <div style={s({ fontSize: 13, fontWeight: 800, color: 'var(--stone-900)' })}>Personal story highlights</div>
        <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 4, lineHeight: 1.5, maxWidth: 220 })}>Capture 3–5 personal experiences. AI will score relevance.</div>
        <button onClick={onClickAll} style={s({ marginTop: 10, padding: '6px 12px', background: 'var(--stone-900)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer' })}>
          <i className="fas fa-plus" style={{ fontSize: 10, marginRight: 4 }}></i> Add story
        </button>
      </div>
    );
  }
  const top = stories
    .map(st => ({ st, ai: st.id ? aiById.get(st.id) : undefined }))
    .sort((x, y) => (y.ai?.relevance ?? 0) - (x.ai?.relevance ?? 0))
    .slice(0, 3);
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 18 })}>
      <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 })}>
        <div style={s({ fontSize: 13, fontWeight: 800, color: 'var(--stone-900)' })}>Personal story highlights</div>
        <button onClick={onClickAll} style={s({ background: 'none', border: 'none', fontSize: 11, fontWeight: 800, color: '#854F0B', cursor: 'pointer', fontFamily: 'inherit' })}>
          View all ({stories.length}) →
        </button>
      </div>
      <div style={s({ display: 'flex', flexDirection: 'column', gap: 6 })}>
        {top.map(({ st, ai }) => (
          <div key={st.id} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--stone-50)', borderRadius: 8 })}>
            <div style={s({ width: 28, height: 28, borderRadius: 8, background: '#FBEAF0', color: '#993556', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 })}>
              <i className="fas fa-book"></i>
            </div>
            <div style={s({ flex: 1, minWidth: 0 })}>
              <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>{st.title}</div>
              <div style={s({ fontSize: 10, color: 'var(--stone-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
                {st.summary || (st.grade ? `Grade ${st.grade}` : '')}
              </div>
            </div>
            {ai && <div style={s({ fontSize: 13, fontWeight: 900, color: 'var(--stone-900)' })}>{ai.relevance.toFixed(1)}</div>}
          </div>
        ))}
      </div>
      {!analysis && (
        <div style={s({ marginTop: 8, padding: '6px 10px', background: '#F1EFE8', borderRadius: 6, fontSize: 10, color: 'var(--stone-500)', textAlign: 'center' })}>
          Click "Refresh insights" on the right rail to score with AI.
        </div>
      )}
    </div>
  );
}

// ═════════════ Strengths & Gaps tab ══════════════════════════════
function StrengthsTab({ breakdown }: { breakdown: ReturnType<typeof calcProfileScore> }) {
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ marginBottom: 14 })}>
        <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)' })}>Strengths & gaps</div>
        <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Pillar breakdown from your academic data, plus the most impactful next moves.</div>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginBottom: 14 })}>
        {breakdown.pillars.map(p => (
          <div key={p.label} style={s({ background: 'var(--stone-50)', padding: 14, borderRadius: 10, position: 'relative', overflow: 'hidden' })}>
            <div style={s({ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: p.color })}></div>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 })}>
              <div style={s({ width: 28, height: 28, borderRadius: 8, background: p.bg, color: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 })}>
                <i className={`fas ${p.icon}`}></i>
              </div>
              <div style={s({ fontSize: 11, fontWeight: 800, color: 'var(--stone-800)' })}>{p.label}</div>
            </div>
            <div style={s({ fontSize: 24, fontWeight: 900, color: 'var(--stone-900)' })}>{p.pct}<span style={s({ fontSize: 12, color: 'var(--stone-400)', marginLeft: 2 })}>%</span></div>
            <div style={s({ fontSize: 10, color: 'var(--stone-500)', marginTop: 4 })}>{p.percentileLabel}</div>
          </div>
        ))}
      </div>
      {breakdown.insights.length > 0 && (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {breakdown.insights.slice(0, 4).map((insight, i) => (
            <div key={i} style={s({ padding: '12px 14px', background: 'var(--stone-50)', borderLeft: `3px solid ${insight.color}`, borderRadius: 4 })}>
              <div style={s({ display: 'flex', alignItems: 'center', gap: 10 })}>
                <div style={s({ width: 28, height: 28, borderRadius: 8, background: insight.bg, color: insight.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 })}>
                  <i className={`fas ${insight.icon}`}></i>
                </div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>{insight.title}</div>
                  <div style={s({ fontSize: 11, color: 'var(--stone-500)', lineHeight: 1.5, marginTop: 2 })}>{insight.desc}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════ Stories tab ═══════════════════════════════════════
function StoriesTab({ stories, loading, analysis, onAdd, onEdit, onDelete }: {
  stories: Story[]; loading: boolean; analysis: AnalysisPayload | null;
  onAdd: () => void; onEdit: (st: Story) => void; onDelete: (id: number) => void;
}) {
  const aiById = new Map((analysis?.story_scores || []).map(sc => [sc.id, sc]));
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)' })}>Personal stories</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Capture 3–5 formative experiences. AI scores relevance for admissions essays.</div>
        </div>
        <button onClick={onAdd}
          style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--yellow)', border: 'none', borderRadius: 8, color: 'var(--stone-900)', fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}>
          <i className="fas fa-plus" style={{ fontSize: 10 }}></i> Add story
        </button>
      </div>
      {loading ? (
        <div style={s({ textAlign: 'center', padding: 30, color: 'var(--stone-400)', fontSize: 12 })}>Loading…</div>
      ) : stories.length === 0 ? (
        <div style={s({ textAlign: 'center', padding: '36px 20px', background: 'var(--stone-50)', borderRadius: 12 })}>
          <div style={s({ fontSize: 30, marginBottom: 8 })}><i className="fas fa-book-heart" style={{ color: 'var(--stone-300)' }}></i></div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)', marginBottom: 4 })}>No stories yet</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-400)', maxWidth: 340, margin: '0 auto 14px', lineHeight: 1.5 })}>
            Pick moments that shaped you — a challenge, a turning point, a family experience.
            AI will score relevance for college essays.
          </div>
          <button onClick={onAdd} style={s({ padding: '8px 16px', background: 'var(--stone-900)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer' })}>
            <i className="fas fa-plus" style={{ fontSize: 10, marginRight: 6 }}></i> Add your first story
          </button>
        </div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {stories.map(st => {
            const ai = st.id ? aiById.get(st.id) : undefined;
            return (
              <div key={st.id} style={s({ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: 'var(--stone-50)', borderRadius: 10 })}>
                <div style={s({ width: 36, height: 36, borderRadius: 10, background: '#FBEAF0', color: '#993556', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 })}>
                  <i className="fas fa-book"></i>
                </div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 })}>
                    <div style={s({ fontSize: 13, fontWeight: 800, color: 'var(--stone-900)' })}>{st.title}</div>
                    {st.grade && <div style={s({ fontSize: 10, color: 'var(--stone-400)' })}>Grade {st.grade}</div>}
                  </div>
                  {st.summary && (
                    <div style={s({ fontSize: 11, color: 'var(--stone-600)', lineHeight: 1.55 })}>{st.summary}</div>
                  )}
                  {st.theme_tags && st.theme_tags.length > 0 && (
                    <div style={s({ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 })}>
                      {st.theme_tags.map(t => (
                        <span key={t} style={s({ fontSize: 9, padding: '2px 7px', background: '#EEEDFE', color: '#534AB7', borderRadius: 6, fontWeight: 700 })}>{t}</span>
                      ))}
                    </div>
                  )}
                  {ai?.rationale && (
                    <div style={s({ fontSize: 10, color: '#0F6E56', fontStyle: 'italic', marginTop: 6 })}>
                      <i className="fas fa-sparkles" style={{ marginRight: 4 }}></i>{ai.rationale}
                    </div>
                  )}
                </div>
                {ai && (
                  <div style={s({ textAlign: 'center', minWidth: 44 })}>
                    <div style={s({ fontSize: 16, fontWeight: 900, color: 'var(--stone-900)' })}>{ai.relevance.toFixed(1)}</div>
                    <div style={s({ fontSize: 9, color: 'var(--stone-400)' })}>relevance</div>
                  </div>
                )}
                <div style={s({ display: 'flex', gap: 4, flexShrink: 0 })}>
                  <button onClick={() => onEdit(st)} title="Edit"
                    style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--stone-500)', fontSize: 11 })}>
                    <i className="fas fa-pen"></i>
                  </button>
                  <button onClick={() => onDelete(st.id!)} title="Remove"
                    style={s({ width: 28, height: 28, border: '1px solid var(--border)', background: 'var(--card)', borderRadius: 8, cursor: 'pointer', color: 'var(--red)', fontSize: 11 })}>
                    <i className="fas fa-trash"></i>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═════════════ Recommendations tab ═══════════════════════════════
function RecommendationsTab({ analysis, stale, loading, error, onRefresh, hasContent }: {
  analysis: AnalysisPayload | null; stale: boolean; loading: boolean; error: string | null;
  onRefresh: () => void; hasContent: boolean;
}) {
  const recs = analysis?.recommendations || [];
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 20, marginBottom: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)' })}>AI recommendations</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Concrete next moves based on your activities, stories, and academic profile.</div>
        </div>
        <button onClick={onRefresh} disabled={loading || !hasContent}
          style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--stone-900)', border: 'none', borderRadius: 8, color: '#fff', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: loading || !hasContent ? 'not-allowed' : 'pointer', opacity: loading || !hasContent ? 0.6 : 1 })}>
          <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} style={{ fontSize: 10 }}></i>
          {loading ? 'Analyzing…' : recs.length ? 'Refresh' : 'Generate'}
        </button>
      </div>
      {error && (
        <div style={s({ padding: 12, background: '#FCEBEB', color: '#A32D2D', borderRadius: 8, fontSize: 12, marginBottom: 12 })}>{error}</div>
      )}
      {recs.length === 0 ? (
        <div style={s({ textAlign: 'center', padding: '36px 20px', background: 'var(--stone-50)', borderRadius: 12 })}>
          <div style={s({ width: 44, height: 44, borderRadius: 12, background: '#EEEDFE', color: '#534AB7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, marginBottom: 10 })}>
            <i className="fas fa-lightbulb"></i>
          </div>
          <div style={s({ fontSize: 14, fontWeight: 800, color: 'var(--stone-900)' })}>No recommendations yet</div>
          <div style={s({ fontSize: 12, color: 'var(--stone-400)', maxWidth: 340, margin: '4px auto 14px', lineHeight: 1.5 })}>
            {hasContent
              ? 'Click "Generate" above to run an AI analysis of your profile.'
              : 'Add at least one activity or story first, then come back here.'}
          </div>
        </div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
          {stale && (
            <div style={s({ padding: '8px 12px', background: '#FAEEDA', color: '#854F0B', borderRadius: 8, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
              <span><i className="fas fa-clock" style={{ marginRight: 6 }}></i>Profile changed since last analysis.</span>
              <button onClick={onRefresh} style={s({ background: 'none', border: 'none', color: '#854F0B', fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' })}>Refresh</button>
            </div>
          )}
          {recs.map((r, i) => (
            <div key={i} style={s({ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, background: 'var(--stone-50)', borderRadius: 10 })}>
              <div style={s({ width: 32, height: 32, borderRadius: 10, background: '#E6F1FB', color: '#185FA5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 })}>
                <i className="fas fa-arrow-right"></i>
              </div>
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ display: 'flex', alignItems: 'center', gap: 8 })}>
                  <div style={s({ fontSize: 13, fontWeight: 800, color: 'var(--stone-900)' })}>{r.title}</div>
                  <span style={s({ fontSize: 9, padding: '2px 6px', background: 'var(--stone-100)', color: 'var(--stone-600)', borderRadius: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px' })}>{r.category}</span>
                </div>
                <div style={s({ fontSize: 11, color: 'var(--stone-500)', lineHeight: 1.5, marginTop: 2 })}>{r.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════ AI Refresh card (right rail) ══════════════════════
function AiRefreshCard({ analysis, stale, loading, error, generatedAt, hasContent, onRefresh }: {
  analysis: AnalysisPayload | null; stale: boolean; loading: boolean; error: string | null;
  generatedAt: string | null; hasContent: boolean; onRefresh: () => void;
}) {
  const ts = generatedAt ? new Date(generatedAt) : null;
  const tsLabel = ts ? `${ts.toLocaleDateString()} · ${ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null;
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 })}>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 })}>
        <div style={s({ width: 24, height: 24, borderRadius: 6, background: '#EEEDFE', color: '#534AB7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 })}>
          <i className="fas fa-sparkles"></i>
        </div>
        <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>AI insights</div>
        {stale && analysis && <span style={s({ fontSize: 9, padding: '2px 6px', background: '#FAEEDA', color: '#854F0B', borderRadius: 6, fontWeight: 800 })}>Stale</span>}
      </div>
      <div style={s({ fontSize: 11, color: 'var(--stone-500)', marginBottom: 10, lineHeight: 1.5 })}>
        {analysis
          ? stale ? 'Your profile changed since the last analysis. Refresh to update themes and recommendations.'
                  : `Last run: ${tsLabel || 'recently'}.`
          : 'Run an analysis to score themes, activities, and stories with AI.'}
      </div>
      {error && <div style={s({ padding: 8, background: '#FCEBEB', color: '#A32D2D', borderRadius: 6, fontSize: 10, marginBottom: 8 })}>{error}</div>}
      <button onClick={onRefresh} disabled={loading || !hasContent}
        style={s({ width: '100%', padding: '8px 12px', background: 'var(--stone-900)', color: '#fff', border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 11, fontWeight: 800, cursor: loading || !hasContent ? 'not-allowed' : 'pointer', opacity: loading || !hasContent ? 0.55 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 })}>
        <i className={`fas ${loading ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} style={{ fontSize: 10 }}></i>
        {loading ? 'Analyzing…' : analysis ? 'Refresh insights' : 'Run analysis'}
      </button>
      {!hasContent && <div style={s({ fontSize: 10, color: 'var(--stone-400)', textAlign: 'center', marginTop: 6 })}>Add an activity or story first.</div>}
    </div>
  );
}

// ═════════════ Phase 2 placeholders ════════════════════════════════
function Phase2Placeholder({ kind }: { kind: 'story' | 'recs' }) {
  const config = kind === 'story'
    ? { icon: 'fa-heart', title: 'Personal story highlights', body: 'Capture 3–5 personal experiences. We\'ll score relevance, surface narrative themes, and suggest the best fit for each Common App prompt.', cta: 'Coming in Phase 2' }
    : { icon: 'fa-lightbulb', title: 'AI recommendations', body: 'Personalized suggestions for activities, awards, and essay angles based on your strongest themes and target schools.', cta: 'Coming in Phase 2' };
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '36px 24px', textAlign: 'center', marginBottom: 14 })}>
      <div style={s({ width: 52, height: 52, borderRadius: 14, background: 'var(--stone-100)', color: 'var(--stone-500)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, marginBottom: 12 })}>
        <i className={`fas ${config.icon}`}></i>
      </div>
      <div style={s({ fontSize: 16, fontWeight: 800, color: 'var(--stone-900)' })}>{config.title}</div>
      <p style={s({ fontSize: 12, color: 'var(--stone-500)', maxWidth: 380, margin: '8px auto 14px', lineHeight: 1.6 })}>{config.body}</p>
      <div style={s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: '#EEEDFE', color: '#534AB7', borderRadius: 20, fontSize: 11, fontWeight: 800 })}>
        <i className="fas fa-sparkles" style={{ fontSize: 10 }}></i> {config.cta}
      </div>
    </div>
  );
}

// ═════════════ Right rail ═════════════════════════════════════════
function CompletionCard({ completion, storyCount }: { completion: ReturnType<typeof deriveCompletion>; storyCount: number }) {
  // Adjust the "Personal stories" item now that Phase 2 is real — replace the Phase 2 stub.
  const items = completion.items.map(it => it.key === 'stories' ? {
    ...it,
    phase: 1 as const,
    status: storyCount >= 3 ? 'done' as const : storyCount > 0 ? 'partial' as const : 'todo' as const,
    detail: storyCount === 0 ? 'Add your first story' : `${storyCount} of 3+ added`,
  } : it);
  const phase1Pts = items.filter(i => i.phase === 1).reduce((sum, i) => sum + (i.status === 'done' ? 1 : i.status === 'partial' ? 0.5 : 0), 0);
  const phase1Count = items.filter(i => i.phase === 1).length;
  const pct = Math.round((phase1Pts / phase1Count) * 100);
  const barColor = pct >= 90 ? '#0F6E56' : pct >= 50 ? '#EF9F27' : '#A32D2D';
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 })}>
        <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>Profile completion</div>
        <div style={s({ fontSize: 16, fontWeight: 900, color: barColor })}>{pct}%</div>
      </div>
      <div style={s({ height: 6, background: 'var(--stone-100)', borderRadius: 99, overflow: 'hidden', marginBottom: 14 })}>
        <div style={s({ width: `${pct}%`, height: '100%', background: barColor, transition: 'width .3s ease' })}></div>
      </div>
      <div style={s({ display: 'flex', flexDirection: 'column', gap: 8 })}>
        {items.map(it => {
          const isDone = it.status === 'done';
          const isPartial = it.status === 'partial';
          const isPhase2 = it.phase === 2;
          return (
            <div key={it.key} style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: isPhase2 ? 0.55 : 1 })}>
              <span style={s({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--stone-700)' })}>
                <i className={`fas fa-${isDone ? 'circle-check' : isPartial ? 'circle-half-stroke' : 'circle'}`} style={{ fontSize: 13, color: isDone ? '#0F6E56' : isPartial ? '#EF9F27' : 'var(--stone-300)' }}></i>
                {it.label}
              </span>
              {isPhase2 ? (
                <span style={s({ fontSize: 10, padding: '2px 6px', borderRadius: 6, background: 'var(--stone-100)', color: 'var(--stone-500)', fontWeight: 700 })}>Phase 2</span>
              ) : (
                <span style={s({ fontSize: 11, color: isDone ? '#0F6E56' : 'var(--stone-400)', fontWeight: 600 })}>{it.detail}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ThemesCard({ themes, analysis, hasContent }: { themes: ThemeScore[]; analysis: AnalysisPayload | null; hasContent: boolean }) {
  // Prefer LLM themes if cached; otherwise show heuristic.
  const usingLLM = !!analysis?.themes?.length;
  const visible = usingLLM
    ? analysis!.themes.slice(0, 4)
    : themes.filter(t => t.score > 0).slice(0, 4);
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 })}>
      <div style={s({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 })}>
        <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>Top themes</div>
        <span style={s({ fontSize: 10, padding: '2px 6px', background: usingLLM ? '#E1F5EE' : '#EEEDFE', color: usingLLM ? '#0F6E56' : '#534AB7', borderRadius: 6, fontWeight: 800 })}>
          {usingLLM ? 'AI · live' : 'Heuristic'}
        </span>
      </div>
      {!hasContent ? (
        <div style={s({ fontSize: 11, color: 'var(--stone-400)', textAlign: 'center', padding: '14px 8px', background: 'var(--stone-50)', borderRadius: 8, lineHeight: 1.6 })}>
          Add activities or stories to surface themes like Leadership, Resilience, and Community impact.
        </div>
      ) : (
        <div style={s({ display: 'flex', flexDirection: 'column', gap: 10 })}>
          {visible.map((t: any) => {
            const v = THEME_VISUAL[t.key] || THEME_VISUAL.curiosity;
            return (
              <div key={t.key + (t.label || '')} title={t.rationale || ''}>
                <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 })}>
                  <span style={s({ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--stone-800)' })}>
                    <i className={`fas ${v.icon}`} style={{ color: v.color, fontSize: 11 }}></i>{t.label}
                  </span>
                  <span style={s({ fontSize: 11, fontWeight: 800, color: v.color })}>{Number(t.score).toFixed(1)}</span>
                </div>
                <div style={s({ height: 4, background: v.bg, borderRadius: 99, overflow: 'hidden' })}>
                  <div style={s({ width: `${(Number(t.score) / 10) * 100}%`, height: '100%', background: v.color })}></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AreasToStrengthen({ breakdown, analysis }: { breakdown: ReturnType<typeof calcProfileScore>; analysis: AnalysisPayload | null }) {
  // Use LLM areas_to_strengthen if cached; fall back to calcProfileScore.insights.
  const usingLLM = !!analysis?.areas_to_strengthen?.length;
  type Card = { title: string; desc: string; color: string; bg: string; icon: string; priority?: 'high' | 'medium' | 'low' };
  const cards: Card[] = usingLLM
    ? analysis!.areas_to_strengthen.map(a => {
        const map = a.priority === 'high' ? { color: '#A32D2D', bg: '#FCEBEB', icon: 'fa-circle-exclamation' }
                  : a.priority === 'low'  ? { color: '#185FA5', bg: '#E6F1FB', icon: 'fa-chart-line' }
                                          : { color: '#854F0B', bg: '#FAEEDA', icon: 'fa-triangle-exclamation' };
        return { title: a.title, desc: a.description, priority: a.priority, ...map };
      })
    : (() => {
        const fi = breakdown.insights.filter(i => i.type === 'gap' || i.type === 'action').slice(0, 2);
        if (fi.length === 0) {
          return [
            { title: 'Build depth',    desc: 'Top applicants showcase independent projects or research alongside school clubs.', color: '#534AB7', bg: '#EEEDFE', icon: 'fa-graduation-cap' },
            { title: 'Go further',     desc: 'Deepen one of your activities to show sustained impact over time.',                  color: '#185FA5', bg: '#E6F1FB', icon: 'fa-chart-line' },
          ];
        }
        return fi.map(i => ({ title: i.title, desc: i.desc, color: i.color, bg: i.bg, icon: i.icon }));
      })();
  return (
    <div style={s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16 })}>
      <div style={s({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 })}>
        <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>Areas to strengthen</div>
        {usingLLM && <span style={s({ fontSize: 10, padding: '2px 6px', background: '#E1F5EE', color: '#0F6E56', borderRadius: 6, fontWeight: 800 })}>AI</span>}
      </div>
      <div style={s({ display: 'flex', flexDirection: 'column', gap: 10 })}>
        {cards.map((card, i) => (
          <div key={i} style={s({ padding: 12, background: 'var(--stone-50)', borderRadius: 10 })}>
            <div style={s({ display: 'flex', alignItems: 'flex-start', gap: 8 })}>
              <div style={s({ width: 28, height: 28, borderRadius: 8, background: card.bg, color: card.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 })}>
                <i className={`fas ${card.icon}`}></i>
              </div>
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)' })}>{card.title}</div>
                <div style={s({ fontSize: 11, color: 'var(--stone-500)', lineHeight: 1.5, marginTop: 2 })}>{card.desc}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EssayCta({ isPaid, onClick }: { isPaid: boolean; onClick: () => void }) {
  return (
    <div style={s({ background: 'var(--yellow)', borderRadius: 'var(--radius)', padding: 16 })}>
      <div style={s({ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)', marginBottom: 4 })}>See how it all comes together</div>
      <div style={s({ fontSize: 11, color: 'rgba(28,25,23,.65)', lineHeight: 1.5, marginBottom: 12 })}>
        {isPaid ? 'Use your profile to brainstorm essay angles tailored to your themes.' : 'Generate essay ideas grounded in your activities and themes.'}
      </div>
      <button onClick={onClick}
        style={s({ width: '100%', padding: '10px 14px', background: 'var(--stone-900)', color: 'var(--yellow)', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 })}>
        <i className="fas fa-sparkles" style={{ fontSize: 11 }}></i> Generate essay ideas
      </button>
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

// ═════════════ Edit Academic Modal ════════════════════════════════
function EditAcademicModal({ academic, gpaScale, intendedMajor, onCancel, onSave }: {
  academic: AcademicProfile; gpaScale: string; intendedMajor: string;
  onCancel: () => void;
  onSave: (next: AcademicProfile, nextMajor: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<AcademicProfile>(academic);
  const [draftMajor, setDraftMajor] = useState(intendedMajor);
  const [saving, setSaving] = useState(false);
  const gpaMax = gpaScale === '5.0' ? 5.0 : 4.0;

  const handleNum = (k: keyof AcademicProfile, raw: string, min: number, max: number, integer = false) => {
    const stripped = raw.replace(/[^0-9.]/g, '');
    if (stripped === '' || stripped === '.') { setDraft(d => ({ ...d, [k]: 0 })); return; }
    let val = integer ? parseInt(stripped) : parseFloat(stripped);
    if (isNaN(val)) val = 0;
    val = Math.max(min, Math.min(max, val));
    setDraft(d => ({ ...d, [k]: integer ? Math.round(val) : Math.round(val * 100) / 100 }));
  };

  return (
    <Modal onClose={onCancel}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 16, fontWeight: 900, color: 'var(--stone-900)' })}>Edit academic profile</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Fields that drive your admissions profile score.</div>
        </div>
        <ModalCloseButton onClick={onCancel} />
      </div>

      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 })}>
        <ModalField label={`GPA (${gpaScale})`}>
          <input type="text" inputMode="decimal" maxLength={5} value={draft.gpa || ''} placeholder={String(gpaMax)}
            onChange={e => handleNum('gpa', e.target.value, 0, gpaMax)}
            style={inputStyle} />
        </ModalField>
        <ModalField label="SAT">
          <input type="text" inputMode="numeric" maxLength={4} value={draft.sat || ''} placeholder="1600"
            onChange={e => handleNum('sat', e.target.value, 0, 1600, true)}
            style={inputStyle} />
        </ModalField>
        <ModalField label="ACT">
          <input type="text" inputMode="numeric" maxLength={2} value={draft.act || ''} placeholder="36"
            onChange={e => handleNum('act', e.target.value, 0, 36, true)}
            style={inputStyle} />
        </ModalField>
      </div>

      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 })}>
        <ModalField label="AP/IBs offered">
          <input type="number" min={0} max={30} value={draft.ap_offered}
            onChange={e => setDraft(d => ({ ...d, ap_offered: Math.max(0, Math.min(30, parseInt(e.target.value) || 0)) }))}
            style={inputStyle} />
        </ModalField>
        <ModalField label="AP/IBs you took">
          <input type="number" min={0} max={25} value={draft.ap_taken}
            onChange={e => setDraft(d => ({ ...d, ap_taken: Math.max(0, Math.min(25, parseInt(e.target.value) || 0)) }))}
            style={inputStyle} />
        </ModalField>
      </div>

      <ModalField label="EC tier (school-wide recognition)">
        <select value={draft.ec_tier} onChange={e => setDraft(d => ({ ...d, ec_tier: parseInt(e.target.value) }))} style={selectStyle}>
          <option value={1}>Tier 1: National / international recognition</option>
          <option value={2}>Tier 2: State / regional leadership</option>
          <option value={3}>Tier 3: School-level leadership</option>
          <option value={4}>Tier 4: Club member / volunteer</option>
        </select>
      </ModalField>

      <div style={s({ marginTop: 10 })}>
        <ModalField label="Leadership roles">
          <input type="range" min={0} max={10} value={draft.leadership_roles}
            onChange={e => setDraft(d => ({ ...d, leadership_roles: parseInt(e.target.value) }))} />
          <div style={s({ fontSize: 11, color: 'var(--stone-500)', marginTop: 4, textAlign: 'right' })}>{draft.leadership_roles}</div>
        </ModalField>
      </div>

      <div style={s({ marginTop: 10 })}>
        <ModalField label="Intended major">
          <select value={draftMajor} onChange={e => setDraftMajor(e.target.value)} style={selectStyle}>
            <option value="">Select…</option>
            {POPULAR_MAJORS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </ModalField>
      </div>

      <ModalActions>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        <button disabled={saving} onClick={async () => {
          setSaving(true);
          try { await onSave(draft, draftMajor); } finally { setSaving(false); }
        }} style={btnPrimary}>{saving ? 'Saving…' : 'Save changes'}</button>
      </ModalActions>
    </Modal>
  );
}

// ═════════════ Activity Modal ═════════════════════════════════════
function ActivityModal({ activity, onCancel, onSave }: {
  activity: Activity | null;
  onCancel: () => void;
  onSave: (a: Activity) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Activity>(activity ?? {
    name: '', category: 'leadership', role: '', hours_per_week: 4,
    start_grade: 10, end_grade: null, is_current: true, description: '',
  });
  const [saving, setSaving] = useState(false);

  return (
    <Modal onClose={onCancel}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 16, fontWeight: 900, color: 'var(--stone-900)' })}>{activity ? 'Edit activity' : 'Add activity'}</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Impact score recalculates automatically.</div>
        </div>
        <ModalCloseButton onClick={onCancel} />
      </div>

      <ModalField label="Activity name">
        <input type="text" maxLength={120} value={draft.name} placeholder="Debate club, food bank volunteer, etc."
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} style={inputStyle} />
      </ModalField>

      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 })}>
        <ModalField label="Category">
          <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value as ActivityCategory }))} style={selectStyle}>
            {(Object.keys(CATEGORY_META) as ActivityCategory[]).map(c => (
              <option key={c} value={c}>{CATEGORY_META[c].label}</option>
            ))}
          </select>
        </ModalField>
        <ModalField label="Role / title">
          <input type="text" maxLength={80} value={draft.role ?? ''} placeholder="Captain, founder, member…"
            onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} style={inputStyle} />
        </ModalField>
      </div>

      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 })}>
        <ModalField label="Hours / week">
          <input type="number" min={0} max={40} value={draft.hours_per_week ?? 0}
            onChange={e => setDraft(d => ({ ...d, hours_per_week: Math.max(0, Math.min(40, parseInt(e.target.value) || 0)) }))}
            style={inputStyle} />
        </ModalField>
        <ModalField label="Start grade">
          <select value={draft.start_grade ?? 10} onChange={e => setDraft(d => ({ ...d, start_grade: parseInt(e.target.value) }))} style={selectStyle}>
            {[7, 8, 9, 10, 11, 12].map(g => <option key={g} value={g}>{g}th grade</option>)}
          </select>
        </ModalField>
        <ModalField label="End grade">
          <select value={draft.is_current ? 'current' : (draft.end_grade ?? 12).toString()}
            onChange={e => {
              const v = e.target.value;
              if (v === 'current') setDraft(d => ({ ...d, is_current: true, end_grade: null }));
              else setDraft(d => ({ ...d, is_current: false, end_grade: parseInt(v) }));
            }} style={selectStyle}>
            <option value="current">Current</option>
            {[8, 9, 10, 11, 12].map(g => <option key={g} value={g}>{g}th grade</option>)}
          </select>
        </ModalField>
      </div>

      <ModalField label="Description (optional, 280 chars)">
        <textarea maxLength={280} value={draft.description ?? ''}
          onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
          rows={3}
          style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          placeholder="What you did, impact, awards. Keep it short — like a Common App entry." />
      </ModalField>

      <div style={s({ marginTop: 10, padding: 10, background: 'var(--stone-50)', borderRadius: 8, fontSize: 11, color: 'var(--stone-500)' })}>
        Heuristic preview: <strong style={{ color: 'var(--stone-900)' }}>{scoreActivityImpact(draft).score.toFixed(1)}/10 ({scoreActivityImpact(draft).label})</strong>
      </div>

      <ModalActions>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        <button disabled={saving || !draft.name.trim()} onClick={async () => {
          setSaving(true);
          try { await onSave(draft); } finally { setSaving(false); }
        }} style={btnPrimary}>{saving ? 'Saving…' : (activity ? 'Save changes' : 'Add activity')}</button>
      </ModalActions>
    </Modal>
  );
}

// ═════════════ Story Modal ═══════════════════════════════════════
function StoryModal({ story, onCancel, onSave }: {
  story: Story | null;
  onCancel: () => void;
  onSave: (st: Story) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Story>(story ?? {
    title: '', summary: '', grade: 10, theme_tags: [],
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (!t) return;
    if (t.length > 30) return;
    setDraft(d => ({ ...d, theme_tags: Array.from(new Set([...(d.theme_tags || []), t])).slice(0, 6) }));
    setTagInput('');
  };
  const removeTag = (t: string) => {
    setDraft(d => ({ ...d, theme_tags: (d.theme_tags || []).filter(x => x !== t) }));
  };

  return (
    <Modal onClose={onCancel}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 16, fontWeight: 900, color: 'var(--stone-900)' })}>{story ? 'Edit story' : 'Add story'}</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>A formative experience worth telling colleges about.</div>
        </div>
        <ModalCloseButton onClick={onCancel} />
      </div>

      <ModalField label="Story title">
        <input type="text" maxLength={120} value={draft.title} placeholder="Overcoming stage fright, first in my family, etc."
          onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} style={inputStyle} />
      </ModalField>

      <div style={s({ marginTop: 10 })}>
        <ModalField label="Summary (what happened, what changed in you)">
          <textarea value={draft.summary} maxLength={2000} rows={5}
            onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5 }}
            placeholder="Briefly describe the experience and what you learned. 2–4 sentences." />
        </ModalField>
      </div>

      <div style={s({ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginTop: 10 })}>
        <ModalField label="Grade">
          <select value={draft.grade ?? 10}
            onChange={e => setDraft(d => ({ ...d, grade: parseInt(e.target.value) }))} style={selectStyle}>
            {[7, 8, 9, 10, 11, 12].map(g => <option key={g} value={g}>{g}th</option>)}
          </select>
        </ModalField>
        <ModalField label="Theme tags (optional, up to 6)">
          <div style={s({ display: 'flex', gap: 6 })}>
            <input type="text" value={tagInput} maxLength={30}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              style={inputStyle} placeholder="family, identity, leadership..." />
            <button type="button" onClick={addTag} style={btnSecondary}>+ Add</button>
          </div>
          {(draft.theme_tags || []).length > 0 && (
            <div style={s({ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 })}>
              {(draft.theme_tags || []).map(t => (
                <span key={t} onClick={() => removeTag(t)} style={s({ fontSize: 10, padding: '3px 8px', background: '#EEEDFE', color: '#534AB7', borderRadius: 6, fontWeight: 700, cursor: 'pointer' })} title="Click to remove">
                  {t} ×
                </span>
              ))}
            </div>
          )}
        </ModalField>
      </div>

      <ModalActions>
        <button onClick={onCancel} style={btnSecondary}>Cancel</button>
        <button disabled={saving || !draft.title.trim()} onClick={async () => {
          setSaving(true);
          try { await onSave(draft); } finally { setSaving(false); }
        }} style={btnPrimary}>{saving ? 'Saving…' : (story ? 'Save changes' : 'Add story')}</button>
      </ModalActions>
    </Modal>
  );
}

// ═════════════ How it works modal ═════════════════════════════════
function HowItWorksModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}>
        <div style={s({ fontSize: 16, fontWeight: 900, color: 'var(--stone-900)' })}>How the profile builder works</div>
        <ModalCloseButton onClick={onClose} />
      </div>
      <ol style={s({ paddingLeft: 18, fontSize: 13, color: 'var(--stone-700)', lineHeight: 1.7, margin: 0 })}>
        <li><strong>Academic</strong> — enter your GPA, SAT/ACT, AP count. We map these to selective-pool percentiles to compute your score.</li>
        <li><strong>Activities</strong> — add up to 10. Each one earns an impact score based on category, role, longevity, and hours.</li>
        <li><strong>Top themes</strong> — derived from your activity tags (heuristic in Phase 1, AI in Phase 2).</li>
        <li><strong>Generate essay ideas</strong> — your themes feed the Essay Lab tools so prompts are personalized.</li>
      </ol>
      <div style={s({ marginTop: 16, padding: 12, background: 'var(--stone-50)', borderRadius: 8, fontSize: 11, color: 'var(--stone-500)' })}>
        Not a prediction. Always consult a qualified school counselor.
      </div>
      <ModalActions>
        <button onClick={onClose} style={btnPrimary}>Got it</button>
      </ModalActions>
    </Modal>
  );
}

// ═════════════ Modal shell + form atoms ═════════════════════════════
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div onClick={onClose} style={s({ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(2px)' })} />
      <div style={s({ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 520, maxWidth: 'calc(100vw - 40px)', maxHeight: '85vh', overflowY: 'auto', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px 26px', zIndex: 9999, boxShadow: '0 25px 60px rgba(0,0,0,.18)' })}>
        {children}
      </div>
    </>
  );
}

function ModalCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={s({ width: 28, height: 28, borderRadius: 8, border: 'none', background: 'var(--stone-100)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--stone-500)', fontSize: 12 })}>
      <i className="fas fa-times"></i>
    </button>
  );
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={s({ fontSize: 10, fontWeight: 700, color: 'var(--stone-500)', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.3px' })}>{label}</label>
      {children}
    </div>
  );
}

function ModalActions({ children }: { children: React.ReactNode }) {
  return <div style={s({ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 })}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--stone-50)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '9px 10px', fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
  color: 'var(--stone-900)', outline: 'none',
};
const selectStyle: React.CSSProperties = {
  ...inputStyle, appearance: 'none', cursor: 'pointer',
};
const btnPrimary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--stone-900)', color: '#fff',
  border: 'none', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 800, cursor: 'pointer',
};
const btnSecondary: React.CSSProperties = {
  padding: '8px 16px', background: 'var(--card)', color: 'var(--stone-700)',
  border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: 700, cursor: 'pointer',
};
