'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AppShell } from '@/components/AppShell';

interface ProfileData {
  gpa: number;
  sat: number | null;
  act: number | null;
  ap_offered: number;
  ap_taken: number;
  ec_tier: number;
  leadership_roles: number;
  major_multiplier: number;
  is_ed: boolean;
  is_athlete: boolean;
  is_legacy: boolean;
  final_score: number;
  candidate_statement?: string;
}

interface Settings {
  high_school_name?: string;
  graduation_year?: number | null;
  intended_major?: string;
  gpa_scale?: string;
}

interface Journey {
  activities: { id: string; name: string; role: string; years: string; hours_per_week: number; impact: string }[];
  honors: { id: string; name: string; level: string; year: string; context: string }[];
  experiences: { id: string; title: string; timeframe: string; what_happened: string; what_changed: string }[];
}

interface ProfileActivity {
  id: number;
  name: string;
  category: string;
  role?: string | null;
  start_grade?: number | null;
  end_grade?: number | null;
  description?: string | null;
}

interface PersonalStory {
  id: number;
  title: string;
  summary?: string | null;
  grade?: number | null;
  theme_tags?: string[];
}

interface College {
  id: string;
  name: string;
  bucket: 'reach' | 'target' | 'safety';
  accept_rate: number;
  ownership?: string | null;
  sat_25?: number | null;
  sat_75?: number | null;
  sat_range?: string | null;
  sat_math_25?: number | null;
  sat_math_75?: number | null;
  sat_cr_25?: number | null;
  sat_cr_75?: number | null;
  act_range?: string | null;
  act_25?: number | null;
  act_75?: number | null;
}

const ss = (o: React.CSSProperties) => o;

function n(val: unknown, fallback = 0): number {
  const parsed = parseFloat(String(val));
  return Number.isNaN(parsed) ? fallback : parsed;
}

function b(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  return String(val) === 'true' || val === 1 || String(val) === '1';
}

function normalizeProfile(raw: Record<string, unknown>): ProfileData {
  return {
    gpa: n(raw.gpa),
    sat: raw.sat != null && raw.sat !== '' ? n(raw.sat) : null,
    act: raw.act != null && raw.act !== '' ? n(raw.act) : null,
    ap_offered: n(raw.ap_offered),
    ap_taken: n(raw.ap_taken),
    ec_tier: n(raw.ec_tier, 6),
    leadership_roles: n(raw.leadership_roles),
    major_multiplier: n(raw.major_multiplier, 1),
    is_ed: b(raw.is_ed),
    is_athlete: b(raw.is_athlete),
    is_legacy: b(raw.is_legacy),
    final_score: n(raw.final_score),
    candidate_statement: String(raw.candidate_statement ?? ''),
  };
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function satRange(c: College) {
  if (c.sat_math_25 && c.sat_math_75 && c.sat_cr_25 && c.sat_cr_75) {
    return `${c.sat_math_25 + c.sat_cr_25}-${c.sat_math_75 + c.sat_cr_75}`;
  }
  if (c.sat_25 && c.sat_75) return `${c.sat_25}-${c.sat_75}`;
  return c.sat_range && c.sat_range !== 'N/A' ? c.sat_range : '—';
}

function actRange(c: College) {
  if (c.act_25 && c.act_75) return `${c.act_25}-${c.act_75}`;
  return c.act_range && c.act_range !== 'N/A' ? c.act_range : '—';
}

function collegeType(c: College) {
  return c.ownership && c.ownership !== 'N/A' ? c.ownership : '—';
}

const bucketStyle: Record<string, { bg: string; fg: string; label: string }> = {
  reach: { bg: '#fee2e2', fg: '#b91c1c', label: 'Reach' },
  target: { bg: '#fef3c7', fg: '#9a5b00', label: 'Target' },
  safety: { bg: '#dcfce7', fg: '#15803d', label: 'Safety' },
};

export default function CounselorPage() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [settings, setSettings] = useState<Settings>({});
  const [journey, setJourney] = useState<Journey | null>(null);
  const [profileActivities, setProfileActivities] = useState<ProfileActivity[]>([]);
  const [personalStories, setPersonalStories] = useState<PersonalStory[]>([]);
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [studentNotes, setStudentNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(true);
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [pRes, cRes, sRes, jRes, aRes, stRes] = await Promise.all([
        fetch('/api/profile', { cache: 'no-store' }),
        fetch('/api/colleges', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
        fetch('/api/journey', { cache: 'no-store' }),
        fetch('/api/profile/activities', { cache: 'no-store' }),
        fetch('/api/profile/stories', { cache: 'no-store' }),
      ]);

      if (pRes.ok) {
        const raw = await pRes.json();
        if (raw?.gpa !== undefined) {
          const next = normalizeProfile(raw);
          setProfile(next);
          setStudentNotes(next.candidate_statement || '');
          setNotesSaved(true);
        }
      }
      if (cRes.ok) {
        const data = await cRes.json();
        setColleges(Array.isArray(data) ? data : []);
      }
      if (sRes.ok) setSettings(await sRes.json());
      if (jRes.ok) setJourney(await jRes.json());
      if (aRes.ok) {
        const data = await aRes.json();
        setProfileActivities(Array.isArray(data.activities) ? data.activities : []);
      }
      if (stRes.ok) {
        const data = await stRes.json();
        setPersonalStories(Array.isArray(data.stories) ? data.stories : []);
      }
    } catch (error) {
      console.error('[counselor-report] fetch failed', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') fetchAll();
  }, [status, fetchAll]);

  const saveStudentNotes = async () => {
    if (!profile) return;
    const response = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...profile, candidate_statement: studentNotes }),
    });
    if (response.ok) {
      const next = normalizeProfile(await response.json());
      setProfile(next);
      setStudentNotes(next.candidate_statement || '');
      setNotesSaved(true);
    }
  };

  const emailCounselor = async () => {
    const email = window.prompt('Enter counselor email address');
    if (!email) return;
    setEmailStatus(null);
    setEmailSending(true);
    try {
      const response = await fetch('/api/counselor-report/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      setEmailStatus(response.ok ? 'Report emailed.' : data?.error || 'Could not send report.');
    } catch {
      setEmailStatus('Could not send report.');
    } finally {
      setEmailSending(false);
    }
  };

  const userName = session?.user?.name ?? 'Student';
  const schoolName = settings.high_school_name || 'High School';
  const gradYear = settings.graduation_year || new Date().getFullYear() + 1;
  const intendedMajor = settings.intended_major || 'Undecided';
  const journeyActivities = journey?.activities ?? [];
  const honors = journey?.honors ?? [];
  const journeyExperiences = journey?.experiences ?? [];
  const activityItems = journeyActivities.length
    ? journeyActivities.map(item => [item.name, item.role || item.impact].filter(Boolean).join(' — '))
    : profileActivities.map(item => [item.name, item.role || item.category, item.description].filter(Boolean).join(' — '));
  const experienceItems = journeyExperiences.length
    ? journeyExperiences.map(item => [item.title, item.timeframe].filter(Boolean).join(' — '))
    : personalStories.map(item => [item.title, item.summary].filter(Boolean).join(' — '));
  const orderedColleges = useMemo(() => {
    const rank = { reach: 0, target: 1, safety: 2 };
    return [...colleges].sort((a, b) => rank[a.bucket] - rank[b.bucket]).slice(0, 12);
  }, [colleges]);
  const reportCollegeRows = useMemo(() => {
    const blanksNeeded = Math.max(0, 12 - orderedColleges.length);
    return [...orderedColleges, ...blankCollegeRows.slice(0, blanksNeeded)].slice(0, 12);
  }, [orderedColleges]);

  const gpaDisplay = profile ? n(profile.gpa).toFixed(2) : '—';
  const weightedGpa = profile ? Math.min(5, n(profile.gpa) + Math.max(0, profile.ap_taken) * 0.035).toFixed(2) : '—';
  const testValue = [profile?.sat ? `SAT ${profile.sat}` : '', profile?.act ? `ACT ${profile.act}` : ''].filter(Boolean).join(' / ') || '—';
  const courseworkValue = profile ? String(profile.ap_taken || 0) : '—';
  const leadershipValue = profile ? String(profile.leadership_roles || 0) : '—';

  if (status === 'loading') {
    return (
      <AppShell>
        <main style={ss({ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--stone-400)', fontWeight: 800 })}>Loading…</main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <style>{`
        .scr-page { background: #f4f3f0; }
        .scr-sheet {
          width: min(100%, 980px);
          margin: 0 auto;
          background: #fff;
          color: #07164a;
	          box-shadow: 0 24px 70px rgba(15, 23, 42, .18);
	          border: 1px solid #e7ebf2;
	          box-sizing: border-box;
	        }
        .scr-serif { font-family: Georgia, 'Times New Roman', serif; }
        .scr-section-title {
          font-size: 12px;
          font-weight: 950;
          letter-spacing: .7px;
          text-transform: uppercase;
          color: #07164a;
        }
        @media print {
          @page { size: letter; margin: 0; }
          body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          .no-print { display: none !important; }
          .scr-page { padding: 0 !important; background: #fff !important; }
	          .scr-sheet {
	            width: 8.5in !important;
	            height: 11in !important;
	            margin: 0 !important;
	            border: none !important;
	            box-shadow: none !important;
	            overflow: hidden !important;
	          }
        }
      `}</style>

      <main className="scr-page" style={ss({ flex: 1, overflowY: 'auto', padding: '28px 32px 52px' })}>
        <div className="no-print" style={ss({ width: 'min(100%, 980px)', margin: '0 auto 16px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' })}>
          <div>
            <h1 style={ss({ margin: 0, fontSize: 24, fontWeight: 950, letterSpacing: '-.3px' })}>Counselor Preview</h1>
            <div style={ss({ color: 'var(--stone-500)', fontSize: 13, marginTop: 4 })}>Printable student profile handout.</div>
	          </div>
	          <div style={ss({ display: 'flex', gap: 8 })}>
	            <button disabled={emailSending} onClick={emailCounselor} style={actionButton('#fff', 'var(--stone-700)', '1px solid var(--border)')}><i className="fas fa-envelope"></i>{emailSending ? 'Sending…' : 'Email Counselor'}</button>
	            <button onClick={fetchAll} style={actionButton('#fff', 'var(--stone-700)', '1px solid var(--border)')}><i className="fas fa-rotate"></i>Refresh</button>
	            <button onClick={() => window.print()} style={actionButton('#07164a', '#fff', '1px solid #07164a')}><i className="fas fa-file-pdf"></i>Save PDF</button>
	          </div>
	        </div>
	        {emailStatus && <div className="no-print" style={ss({ width: 'min(100%, 980px)', margin: '-8px auto 12px', color: emailStatus.includes('emailed') ? '#166534' : '#b91c1c', fontSize: 12, fontWeight: 850 })}>{emailStatus}</div>}

	        <article className="scr-sheet" style={ss({ padding: '20px 30px 18px' })}>
	          <header style={ss({ display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', marginBottom: 10 })}>
            <div>
              <div className="scr-serif" style={ss({ fontSize: 30, fontWeight: 800, color: '#07164a', lineHeight: 1.05 })}>{userName}</div>
              <div style={ss({ marginTop: 7, fontSize: 12, letterSpacing: '.6px', textTransform: 'uppercase', fontWeight: 850, color: '#18255f' })}>{schoolName} <span style={ss({ margin: '0 14px', color: '#9aa3b8' })}>|</span> Class of {gradYear}</div>
	              <p style={ss({ margin: '7px 0 0', maxWidth: 680, color: '#2f365f', fontSize: 11, lineHeight: 1.3 })}>This report provides a comprehensive snapshot of {userName.split(' ')[0] || 'the student'}’s academic profile, accomplishments, and goals to help you give focused, informed feedback and support.</p>
            </div>
            <div style={ss({ fontSize: 12, color: '#07164a', marginTop: 5, whiteSpace: 'nowrap' })}>Generated: {formatDate()}</div>
          </header>

          <Rule />

          <SectionTitle>Student Snapshot</SectionTitle>
	          <div style={ss({ display: 'grid', gridTemplateColumns: '1.05fr 1.05fr 1fr .9fr 1.2fr', gap: 7, marginBottom: 9 })}>
            <SnapshotCard icon="fa-graduation-cap" color="#16a34a" label="GPA" sub={settings.gpa_scale === '5.0' ? '5.0 scale' : 'Unweighted'} value={gpaDisplay} foot={`Estimated weighted: ${weightedGpa}`} />
            <SnapshotCard icon="fa-chart-simple" color="#3b82f6" label="SAT/ACT" value={testValue} compact />
            <SnapshotCard icon="fa-book-open" color="#7c3aed" label="Coursework / APs" value={courseworkValue} foot={`${profile?.ap_taken ?? 0} AP · ${Math.max(0, (profile?.ap_offered ?? 0) - (profile?.ap_taken ?? 0))} available`} />
            <SnapshotCard icon="fa-users" color="#f6a400" label="Leadership" value={leadershipValue} foot="Roles tracked" />
            <SnapshotCard icon="fa-bullseye" color="#16a34a" label="Intended Major" value={intendedMajor} foot="Declared interest" compact />
          </div>

          <SectionTitle>Profile Highlights</SectionTitle>
	          <div style={ss({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: '1px solid #d9dfeb', borderBottom: '1px solid #d9dfeb', marginBottom: 9 })}>
            <HighlightColumn icon="fa-people-group" color="#159447" title="Activities & Extracurriculars" count={`${activityItems.length} Activities`} items={activityItems} />
            <HighlightColumn icon="fa-trophy" color="#2563eb" title="Honors & Awards" count={`${honors.length} Honors`} items={honors.map(item => [item.name, item.level || item.year].filter(Boolean).join(' — '))} />
            <HighlightColumn icon="fa-heart" color="#7c3aed" title="Meaningful Experiences" count={`${experienceItems.length} Experiences`} items={experienceItems} />
          </div>

	          <div style={ss({ marginBottom: 9 })}>
            <section>
              <SectionTitle>Selected College List</SectionTitle>
              <div style={ss({ border: '1px solid #d9dfeb', borderRadius: 5, overflow: 'hidden' })}>
                <table style={ss({ width: '100%', borderCollapse: 'collapse', fontSize: 9.5 })}>
                  <thead>
                    <tr style={ss({ background: '#fafbfe', color: '#07164a' })}>
                      <TableHead align="left">College / University</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>SAT Range</TableHead>
                      <TableHead>ACT Range</TableHead>
                    </tr>
                  </thead>
                  <tbody>
	                    {reportCollegeRows.map((college, index) => {
                      const isBlank = !college.name;
                      const cfg = bucketStyle[college.bucket] || bucketStyle.target;
                      return (
                        <tr key={`${college.name}-${index}`}>
                          <td style={tdLeft}>{isBlank ? <span style={blankLine}></span> : <><span style={collegeBadge(index)}>{college.name[0]}</span>{college.name}</>}</td>
                          <td style={tdCenter}>{isBlank ? '' : <span style={ss({ padding: '3px 10px', borderRadius: 999, background: cfg.bg, color: cfg.fg, fontSize: 10, fontWeight: 850 })}>{cfg.label}</span>}</td>
                          <td style={tdCenter}>{isBlank ? '' : collegeType(college as College)}</td>
                          <td style={tdCenter}>{isBlank ? '' : satRange(college as College)}</td>
                          <td style={tdCenter}>{isBlank ? '' : actRange(college as College)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

	          <section style={ss({ border: '1.5px solid #FFE500', borderRadius: 8, padding: '10px 12px', marginBottom: 11 })}>
            <div style={ss({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 })}>
              <div style={ss({ borderRight: '1px solid #d9dfeb', paddingRight: 18 })}>
                <div style={ss({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 })}>
                  <div className="scr-section-title">Student Notes</div>
                  <button className="no-print" disabled={!profile} onClick={saveStudentNotes} style={ss({ ...miniAction(notesSaved ? '#eef2ff' : '#ffb000', notesSaved ? '#1e3a8a' : '#07164a'), opacity: profile ? 1 : .55 })}>
                    <i className={`fas ${notesSaved ? 'fa-check' : 'fa-floppy-disk'}`}></i>{notesSaved ? 'Saved' : 'Save'}
                  </button>
                </div>
                <textarea
                  value={studentNotes}
                  onChange={event => {
                    setStudentNotes(event.target.value);
                    setNotesSaved(false);
                  }}
                  placeholder="Add notes you want your counselor to know..."
	                  style={ss({ width: '100%', minHeight: 76, resize: 'vertical', border: '1px solid #d9dfeb', borderRadius: 6, padding: 9, fontFamily: 'inherit', fontSize: 10.5, lineHeight: 1.35, color: '#07164a', boxSizing: 'border-box', background: '#fff' })}
                />
              </div>
              <div>
                <div className="scr-section-title" style={ss({ marginBottom: 8 })}>Counselor Feedback</div>
	                <div style={ss({ minHeight: 76, display: 'grid', alignContent: 'space-evenly' })}>
                  {[1, 2, 3, 4].map(line => <div key={line} style={ss({ height: 1, background: '#cfd6e5' })}></div>)}
                </div>
              </div>
            </div>
          </section>

          <footer style={ss({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#8a92ad', fontSize: 12 })}>
            <div style={ss({ display: 'flex', alignItems: 'center', gap: 10 })}><img src="/raven-logo.svg" alt="Admitly" style={ss({ width: 22, height: 22, objectFit: 'contain' })} /><strong style={ss({ color: '#07164a' })}>admitly</strong><span style={ss({ margin: '0 12px', color: '#b9c0d1' })}>|</span><span>Empowering students to tell their story and find their best fit.</span></div>
            <span style={ss({ color: '#1d4ed8' })}>admitly.com</span>
          </footer>
        </article>
      </main>
    </AppShell>
  );
}

const blankCollegeRows: College[] = Array.from({ length: 12 }, (_, index) => ({
  id: `blank-${index + 1}`,
  name: '',
  bucket: 'target',
  accept_rate: 0,
}));

function Rule() {
  return <div style={ss({ height: 1, background: '#cfd6e5', margin: '0 0 9px' })} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="scr-section-title" style={ss({ marginBottom: 7 })}>{children}</div>;
}

function SnapshotCard({ icon, color, label, sub, value, foot, compact }: { icon: string; color: string; label: string; sub?: string; value: string; foot?: string; compact?: boolean }) {
  return (
    <div style={ss({ border: '1px solid #cfd6e5', borderRadius: 6, padding: '7px 8px', minHeight: 60, display: 'flex', gap: 8, alignItems: 'center' })}>
      <div style={ss({ width: 28, height: 28, borderRadius: 999, background: color, color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 12 })}><i className={`fas ${icon}`}></i></div>
      <div style={ss({ minWidth: 0 })}>
        <div style={ss({ fontSize: 10, fontWeight: 900, color: '#07164a', lineHeight: 1.2 })}>{label} {sub && <span style={ss({ fontWeight: 600, color: '#2f365f' })}>({sub})</span>}</div>
        <div style={ss({ marginTop: 3, fontSize: compact ? 11.5 : 17, lineHeight: 1.05, fontWeight: 900, color: '#07164a', overflowWrap: 'anywhere' })}>{value}</div>
        {foot && <div style={ss({ marginTop: 3, fontSize: 8.5, color: '#2f365f', lineHeight: 1.1 })}>{foot}</div>}
      </div>
    </div>
  );
}

function HighlightColumn({ icon, color, title, items, count }: { icon: string; color: string; title: string; items: string[]; count: string }) {
  const visible = items.filter(Boolean).slice(0, 4);
  return (
    <div style={ss({ padding: '8px 12px', borderRight: title.includes('Experiences') ? 'none' : '1px solid #d9dfeb', minHeight: 96 })}>
      <div style={ss({ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, color })}>
        <i className={`fas ${icon}`} style={{ fontSize: 16 }}></i>
        <div style={ss({ fontSize: 11, fontWeight: 900 })}>{title}</div>
      </div>
      <ul style={ss({ margin: 0, paddingLeft: 16, color: '#07164a', fontSize: 9.3, lineHeight: 1.25 })}>
        {(visible.length ? visible : ['Add details in the student Journey profile.']).map(item => <li key={item}>{item}</li>)}
      </ul>
      <div style={ss({ color, fontSize: 10.5, fontWeight: 900, marginTop: 6 })}>{count}</div>
    </div>
  );
}

function TableHead({ children, align = 'center' }: { children: React.ReactNode; align?: 'left' | 'center' }) {
  return <th style={ss({ padding: '4px 8px', textAlign: align, fontSize: 8.5, fontWeight: 950, color: '#07164a', borderBottom: '1px solid #d9dfeb' })}>{children}</th>;
}

const tdLeft: React.CSSProperties = { padding: '2px 8px', borderBottom: '1px solid #e8ecf4', color: '#07164a', fontWeight: 750, display: 'flex', gap: 6, alignItems: 'center', height: 20 };
const tdCenter: React.CSSProperties = { padding: '2px 6px', borderBottom: '1px solid #e8ecf4', textAlign: 'center', color: '#07164a', fontWeight: 650, height: 20 };
const blankLine: React.CSSProperties = { display: 'block', width: '100%', height: 12 };

function collegeBadge(index: number): React.CSSProperties {
  const colors = ['#e11d48', '#facc15', '#f97316', '#2563eb', '#1d4ed8', '#16a34a', '#7c3aed'];
  return {
    width: 16,
    height: 16,
    borderRadius: 5,
    display: 'inline-grid',
    placeItems: 'center',
    background: colors[index % colors.length],
    color: '#fff',
    fontSize: 9,
    fontWeight: 950,
    flexShrink: 0,
  };
}

function actionButton(bg: string, color: string, border: string): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 10, border, background: bg, color, fontSize: 12, fontWeight: 850, fontFamily: 'inherit', cursor: 'pointer' };
}

function miniAction(bg: string, color: string): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: bg === '#fff' ? '1px solid #e7e5e4' : 'none', background: bg, color, fontSize: 11, fontWeight: 850, fontFamily: 'inherit', cursor: 'pointer' };
}
