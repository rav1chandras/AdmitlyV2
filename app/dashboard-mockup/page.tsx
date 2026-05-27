'use client';

import { useState } from 'react';

const s = (o: React.CSSProperties) => o;

type TabId = 'academic' | 'activities' | 'story' | 'strengths' | 'recs';

const tabs: { id: TabId; label: string; shortLabel: string; icon: string; badge?: string }[] = [
  { id: 'academic', label: 'Academic', shortLabel: 'Academic', icon: 'fa-graduation-cap' },
  { id: 'activities', label: 'Activities', shortLabel: 'Acts', icon: 'fa-users', badge: '3' },
  { id: 'story', label: 'Personal story', shortLabel: 'Story', icon: 'fa-heart' },
  { id: 'strengths', label: 'Strengths & gaps', shortLabel: 'Strengths', icon: 'fa-chart-line' },
  { id: 'recs', label: 'Recommendations', shortLabel: 'Recs', icon: 'fa-lightbulb' },
];

const metrics = [
  { label: 'GPA (UW)', value: '3.82', sub: 'Strong upward trend', icon: 'fa-chart-line', color: '#0F6E56', bg: '#E1F5EE' },
  { label: 'SAT', value: '1450', sub: 'Best score', icon: 'fa-pen-ruler', color: '#185FA5', bg: '#E6F1FB' },
  { label: 'ACT', value: '—', sub: 'Optional', icon: 'fa-stopwatch', color: '#534AB7', bg: '#EEEDFE' },
  { label: 'AP / honors', value: '8 APs', sub: '8 of 16 offered', icon: 'fa-layer-group', color: '#854F0B', bg: '#FAEEDA' },
  { label: 'Intended major', value: 'Computer Science', sub: 'Academic direction', icon: 'fa-compass', color: '#993556', bg: '#FBEAF0' },
  { label: 'School', value: 'Phillips Academy', sub: 'Andover, MA', icon: 'fa-school', color: '#5F5E5A', bg: '#F1EFE8' },
  { label: 'Graduation year', value: '2026', sub: 'Application cohort', icon: 'fa-calendar-check', color: '#0A2463', bg: '#E6F1FB' },
  { label: 'Class rank', value: 'Top 12%', sub: 'School context', icon: 'fa-ranking-star', color: '#A32D2D', bg: '#FCEBEB' },
];

export default function DashboardMockupPage() {
  const [active, setActive] = useState<TabId>('academic');

  return (
    <main style={s({ minHeight: '100vh', background: 'var(--bg)', color: 'var(--stone-900)', fontFamily: "'DM Sans', -apple-system, sans-serif" })}>
      <div style={s({ maxWidth: 1320, margin: '0 auto', padding: '32px 34px 56px' })}>
        <header style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 18 })}>
          <div>
            <div style={s({ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 999, background: '#E1F5EE', color: '#0F6E56', fontSize: 11, fontWeight: 900, marginBottom: 8 })}>
              <i className="fas fa-circle-check" style={{ fontSize: 10 }}></i>
              Preview concept
            </div>
            <h1 style={s({ margin: 0, fontSize: 28, fontWeight: 950, letterSpacing: '-0.4px' })}>Good evening, Maya</h1>
            <p style={s({ margin: '5px 0 0', fontSize: 13, color: 'var(--stone-400)' })}>A calmer freemium dashboard with one clear next step.</p>
          </div>
        </header>

        <section style={s({ marginBottom: 14 })}>
          <ProgressPath />
        </section>

        <section style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 14, marginBottom: 16 })}>
          <ProfileStrength />
          <CompletionCard />
          <DeadlinesCard />
        </section>

        <section style={s({ display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 1fr)', gap: 14 })}>
          <div style={s({ minWidth: 0 })}>
            <TabBar active={active} onChange={setActive} />
            {active === 'academic' && <AcademicPanel />}
            {active === 'recs' && <RecommendationsPanel />}
            {active !== 'academic' && active !== 'recs' && <PlaceholderPanel active={active} />}
          </div>
          <aside style={s({ display: 'flex', flexDirection: 'column', gap: 14 })}>
            <CollegeListTile />
            <EssayProgressTile />
            <LockedPreview />
            <ThemesTile />
          </aside>
        </section>
      </div>
    </main>
  );
}

function ProgressPath() {
  const steps = [
    { label: 'Build profile', status: 'Profile 82%', icon: 'fa-check', done: true },
    { label: 'Get recommendations', status: 'Run analysis', icon: 'fa-lightbulb', done: false },
    { label: 'Improve essays', status: 'Draft strategy', icon: 'fa-pen-nib', done: false },
    { label: 'Expert session', status: 'Book advisor', icon: 'fa-user-graduate', done: false },
  ];
  return (
    <div style={card({ padding: 18, background: '#fff' })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 })}>
        <div>
          <div style={s({ fontSize: 12, fontWeight: 900 })}>Application path</div>
          <div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>A compact view of the freemium journey from profile to expert help.</div>
        </div>
        <button style={buttonDark}>Continue</button>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 })}>
        {steps.map((step, i) => (
          <div key={step.label} style={s({ position: 'relative', minHeight: 92, padding: 12, borderRadius: 13, background: step.done ? '#E1F5EE' : i === 3 ? '#FFF8E1' : 'var(--stone-50)', border: `1px solid ${step.done ? '#A3E4D0' : i === 3 ? '#F1D38B' : 'var(--border-light)'}` })}>
            <div style={s({ width: 30, height: 30, borderRadius: 10, background: step.done ? '#0F6E56' : i === 3 ? 'var(--yellow)' : '#fff', color: step.done ? '#fff' : i === 3 ? 'var(--stone-900)' : 'var(--stone-400)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, marginBottom: 10 })}>
              <i className={`fas ${step.icon}`}></i>
            </div>
            <div style={s({ fontSize: 11, fontWeight: 850, color: step.done ? '#0F6E56' : 'var(--stone-600)' })}>{step.label}</div>
            <div style={s({ fontSize: 10, fontWeight: 750, color: 'var(--stone-400)', marginTop: 3 })}>{step.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileStrength() {
  return (
    <div style={card({ padding: '26px 30px', background: '#ebeef8', borderColor: '#b3bee6' })}>
      <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 })}>
        <span style={s({ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 9, background: '#d6ddf2', color: '#0a2463', fontSize: 12, fontWeight: 850 })}><i className="fas fa-bolt"></i> Profile Strength</span>
        <button style={buttonDark}>Edit profile</button>
      </div>
      <div style={s({ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 })}>
        <div>
          <div style={s({ fontSize: 28, fontWeight: 950, letterSpacing: '-.4px' })}>Strong foundation</div>
          <p style={s({ margin: '6px 0 16px', maxWidth: 430, fontSize: 13, lineHeight: 1.55, color: 'rgba(28,25,23,.55)' })}>Academic profile is competitive. Add sharper stories and balanced schools to improve readiness.</p>
          <div style={s({ height: 10, borderRadius: 999, background: 'rgba(0,0,0,.06)', overflow: 'hidden' })}>
            <div style={s({ width: '74%', height: '100%', background: 'linear-gradient(90deg,#cc266d,#0a2463,#06a77d)', borderRadius: 999 })}></div>
          </div>
        </div>
        <div style={s({ textAlign: 'center' })}>
          <div style={s({ fontSize: 58, fontWeight: 950, lineHeight: 1, letterSpacing: '-3px' })}>74<span style={s({ fontSize: 16, color: 'rgba(28,25,23,.25)', marginLeft: 2 })}>/99</span></div>
          <div style={s({ display: 'inline-flex', marginTop: 8, padding: '3px 10px', borderRadius: 999, background: '#d6ddf2', color: '#0a2463', fontSize: 11, fontWeight: 850 })}>Top 20%</div>
        </div>
      </div>
    </div>
  );
}

function CompletionCard() {
  return (
    <div style={card({ padding: 16 })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 })}><div style={label}>Profile completion</div><div style={s({ fontSize: 18, fontWeight: 950, color: '#0F6E56' })}>82%</div></div>
      <div style={s({ height: 7, background: 'var(--stone-100)', borderRadius: 999, overflow: 'hidden', marginBottom: 14 })}><div style={s({ width: '82%', height: '100%', background: '#0F6E56' })}></div></div>
      {['Academic profile', 'Activities', 'Personal stories', 'College preferences'].map((item, i) => (
        <div key={item} style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderTop: i ? '1px solid var(--border-light)' : 'none' })}>
          <span style={s({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700 })}><i className={`fas ${i < 2 ? 'fa-circle-check' : 'fa-circle-half-stroke'}`} style={{ color: i < 2 ? '#0F6E56' : '#EF9F27' }}></i>{item}</span>
          <span style={s({ fontSize: 11, color: 'var(--stone-400)', fontWeight: 700 })}>{i < 2 ? 'Done' : 'Partial'}</span>
        </div>
      ))}
    </div>
  );
}

function DeadlinesCard() {
  return (
    <div style={card({ padding: 16 })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', marginBottom: 10 })}><div style={label}>Upcoming deadlines</div><i className="fas fa-calendar-alt" style={{ color: 'var(--stone-300)', fontSize: 12 }}></i></div>
      {[
        ['SAT Test Date', 'Jun 6', '15d', '#185FA5'],
        ['ACT Test Date', 'Jun 13', '22d', '#534AB7'],
        ['FAFSA Federal Deadline', 'Jun 30', '39d', '#0F6E56'],
      ].map(([name, date, days, color]) => (
        <div key={name} style={s({ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border-light)' })}>
          <span style={s({ width: 7, height: 7, borderRadius: 999, background: color })}></span>
          <span style={s({ flex: 1, minWidth: 0 })}><span style={s({ display: 'block', fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{name}</span><span style={s({ fontSize: 9, color: 'var(--stone-400)' })}>{date}</span></span>
          <span style={s({ padding: '2px 7px', borderRadius: 7, background: '#eff6ff', color, fontSize: 10, fontWeight: 900 })}>{days}</span>
        </div>
      ))}
    </div>
  );
}

function TabBar({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return (
    <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 4, padding: 4, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, marginBottom: 14 })}>
      {tabs.map(tab => {
        const isActive = active === tab.id;
        return (
          <button key={tab.id} onClick={() => onChange(tab.id)} style={s({ width: '100%', minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '8px 6px', border: 'none', borderRadius: 12, background: isActive ? 'var(--stone-900)' : 'transparent', color: isActive ? '#fff' : 'var(--stone-500)', fontFamily: 'inherit', fontSize: 11, fontWeight: 850, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden' })}>
            <i className={`fas ${tab.icon}`} style={{ fontSize: 11 }}></i>
            <span style={s({ overflow: 'hidden', textOverflow: 'ellipsis' })}>{tab.shortLabel}</span>
            {tab.badge && <span style={s({ padding: '1px 6px', borderRadius: 8, background: isActive ? 'rgba(255,255,255,.2)' : 'var(--stone-100)', color: isActive ? '#fff' : 'var(--stone-600)', fontSize: 10, fontWeight: 900 })}>{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

function AcademicPanel() {
  return (
    <div style={card({ padding: 20 })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 })}>
        <div><div style={s({ fontSize: 14, fontWeight: 900 })}>Academic profile</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>A richer version of the current academic metric grid.</div></div>
        <button style={buttonDark}><i className="fas fa-pen-to-square" style={{ fontSize: 10 }}></i>Edit</button>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 })}>
        {metrics.map(metric => <MetricCard key={metric.label} {...metric} />)}
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, icon, color, bg }: (typeof metrics)[number]) {
  return (
    <div style={s({ position: 'relative', minHeight: 104, background: 'linear-gradient(180deg,#fff,var(--stone-50))', border: '1px solid var(--border-light)', borderRadius: 14, padding: 14, overflow: 'hidden', boxShadow: '0 1px 0 rgba(28,25,23,.03)' })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 12 })}>
        <div style={s({ fontSize: 10, fontWeight: 900, color: 'var(--stone-400)', textTransform: 'uppercase', letterSpacing: '.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{label}</div>
        <div style={s({ width: 28, height: 28, borderRadius: 9, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 })}><i className={`fas ${icon}`}></i></div>
      </div>
      <div style={s({ fontSize: value.length > 18 ? 14 : 19, fontWeight: 950, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any })}>{value}</div>
      <div style={s({ fontSize: 10, fontWeight: 700, color: 'var(--stone-400)', marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{sub}</div>
    </div>
  );
}

function RecommendationsPanel() {
  return (
    <div style={card({ padding: 20 })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 })}>
        <div><div style={s({ fontSize: 14, fontWeight: 900 })}>AI recommendations</div><div style={s({ fontSize: 11, color: 'var(--stone-400)', marginTop: 2 })}>Concrete next moves based on profile evidence.</div></div>
        <button style={buttonDark}><i className="fas fa-wand-magic-sparkles" style={{ fontSize: 10 }}></i>Run analysis</button>
      </div>
      <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 })}>
        {[
          ['Add 2 personal stories', 'Capture a challenge, turning point, or family context.'],
          ['Balance your list', 'Add two target schools before adding more reaches.'],
          ['Sharpen essay angle', 'Connect robotics leadership to community impact.'],
        ].map(([title, desc], i) => (
          <div key={title} style={s({ padding: 14, borderRadius: 12, background: 'var(--stone-50)', border: '1px solid var(--border-light)' })}>
            <div style={s({ width: 30, height: 30, borderRadius: 9, background: i === 0 ? '#FBEAF0' : i === 1 ? '#E6F1FB' : '#E1F5EE', color: i === 0 ? '#993556' : i === 1 ? '#185FA5' : '#0F6E56', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 })}><i className={`fas ${i === 0 ? 'fa-heart' : i === 1 ? 'fa-building-columns' : 'fa-pen-nib'}`}></i></div>
            <div style={s({ fontSize: 12, fontWeight: 900 })}>{title}</div>
            <div style={s({ fontSize: 11, color: 'var(--stone-500)', lineHeight: 1.45, marginTop: 4 })}>{desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaceholderPanel({ active }: { active: TabId }) {
  const title = tabs.find(tab => tab.id === active)?.label || 'Profile';
  return <div style={card({ padding: 28, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--stone-400)', fontSize: 13, fontWeight: 800 })}>{title} content remains in the existing tab.</div>;
}

function CollegeListTile() {
  return <ProgressTile title="College List" subtitle="4 reach · 3 target · 2 safety" icon="fa-building-columns" color="#185FA5" bg="#E6F1FB" metric="9" metricLabel="of 10 school goal" progress={90} />;
}

function EssayProgressTile() {
  return <ProgressTile title="Essay Progress" subtitle="3 active drafts · 1 near-ready" icon="fa-pen-nib" color="#8b5cf6" bg="var(--violet-light)" metric="58%" metricLabel="2,140 total words" progress={58} />;
}

function ProgressTile({ title, subtitle, icon, color, bg, metric, metricLabel, progress }: { title: string; subtitle: string; icon: string; color: string; bg: string; metric: string; metricLabel: string; progress: number }) {
  return (
    <div style={card({ padding: '14px 16px' })}>
      <div style={s({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 })}>
        <div style={s({ width: 36, height: 36, borderRadius: 10, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center' })}><i className={`fas ${icon}`}></i></div>
        <div style={s({ flex: 1 })}><div style={s({ fontSize: 12, fontWeight: 900 })}>{title}</div><div style={s({ fontSize: 10, color: 'var(--stone-400)', marginTop: 2 })}>{subtitle}</div></div>
      </div>
      <div style={s({ fontSize: 28, fontWeight: 950, letterSpacing: '-1px' })}>{metric}</div>
      <div style={s({ fontSize: 9, fontWeight: 900, color: 'var(--stone-400)', textTransform: 'uppercase', letterSpacing: '.3px', marginTop: 3, marginBottom: 9 })}>{metricLabel}</div>
      <div style={s({ height: 6, background: 'var(--stone-100)', borderRadius: 999, overflow: 'hidden' })}><div style={s({ width: `${progress}%`, background: color, height: '100%' })}></div></div>
    </div>
  );
}

function LockedPreview() {
  return (
    <div style={card({ padding: 16, position: 'relative', overflow: 'hidden' })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 })}><div style={label}>Pro preview</div><span style={s({ fontSize: 10, fontWeight: 900, color: '#854F0B', background: '#FAEEDA', padding: '2px 7px', borderRadius: 8 })}>Locked</span></div>
      {[1, 2].map(i => <div key={i} style={s({ height: 34, borderRadius: 9, background: 'var(--stone-50)', border: '1px solid var(--border-light)', marginBottom: 7, filter: 'blur(1.2px)', opacity: .75 })}></div>)}
      <button style={{ ...buttonDark, width: '100%', justifyContent: 'center', marginTop: 4 }}>Unlock college recommendations</button>
    </div>
  );
}

function ThemesTile() {
  return (
    <div style={card({ padding: 16 })}>
      <div style={s({ display: 'flex', justifyContent: 'space-between', marginBottom: 10 })}><div style={label}>Top themes</div><span style={s({ fontSize: 10, fontWeight: 900, color: '#534AB7', background: '#EEEDFE', padding: '2px 7px', borderRadius: 8 })}>Heuristic</span></div>
      {([
        ['Leadership', 78, '#534AB7'],
        ['Curiosity', 64, '#185FA5'],
        ['Community impact', 42, '#993556'],
      ] as [string, number, string][]).map(([theme, score, color]) => (
        <div key={theme} style={s({ marginBottom: 10 })}>
          <div style={s({ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 850, marginBottom: 4 })}><span>{theme}</span><span style={{ color }}>{score}</span></div>
          <div style={s({ height: 5, background: 'var(--stone-100)', borderRadius: 999, overflow: 'hidden' })}><div style={s({ height: '100%', width: `${score}%`, background: color as string })}></div></div>
        </div>
      ))}
    </div>
  );
}

function card(extra: React.CSSProperties = {}) {
  return s({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', ...extra });
}

const label = s({ fontSize: 12, fontWeight: 900, color: 'var(--stone-900)' });
const buttonDark = s({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--stone-900)', color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' });
