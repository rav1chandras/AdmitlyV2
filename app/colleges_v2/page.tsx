'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AppShell } from '@/components/AppShell';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { useProCheck } from '@/lib/useProCheck';

type Bucket = 'reach' | 'target' | 'safety';

interface SavedCollege {
  id: number;
  master_id?: number | null;
  name: string;
  bucket: Bucket;
}

interface RecCollege {
  ope6_id: number;
  name: string;
  city: string | null;
  state: string | null;
  ownership: string | null;
  acceptance_rate: number;
  sat_25: number | null;
  sat_75: number | null;
  sat_range: string | null;
  act_25: number | null;
  act_75: number | null;
  act_range: string | null;
  enrollment: number | null;
  retention_rate: number | null;
  student_faculty_ratio: number | null;
  tuition_in_state: number | null;
  tuition_out_state: number | null;
  net_price: number | null;
  cost_attendance: number | null;
  grad_rate: number | null;
  median_debt: number | null;
  earnings_6yr: number | null;
  earnings_10yr: number | null;
  pct_white: number | null;
  pct_black: number | null;
  pct_hispanic: number | null;
  pct_asian: number | null;
  pct_two_or_more: number | null;
  pct_men: number | null;
  pct_women: number | null;
  program_name: string | null;
  program_earn_5yr: number | null;
  program_grads: number | null;
  fit_score: number;
  bucket: Bucket;
  fit_reasons: { text: string; good: boolean }[];
  college_url: string | null;
  admission_probability?: number;
  overmatch_risk?: boolean;
}

interface RecInputs {
  sat?: number | null;
  act?: number | null;
  gpa_raw?: number | null;
  gpa_used?: number | null;
  final_score?: number | null;
  ap_taken?: number | null;
  ap_offered?: number | null;
  primary_major: string;
  alt_major: string;
  is_ed: boolean;
  is_instate: boolean;
  is_public: boolean;
}

interface RecResponse {
  pools: Record<Bucket, RecCollege[]>;
  page_sizes: Record<Bucket, number>;
  inputs: RecInputs;
  counts: { reach: number; target: number; safety: number; total_scored: number };
}

const css = (o: React.CSSProperties) => o;

const BUCKETS: Record<Bucket, { label: string; color: string; bg: string; soft: string; border: string; shadow: string; icon: string }> = {
  reach: { label: 'Reach', color: '#ef4444', bg: '#fff7f7', soft: '#fee2e2', border: '#fca5a5', shadow: 'rgba(239,68,68,.14)', icon: 'fa-mountain-sun' },
  target: { label: 'Target', color: '#2563eb', bg: '#f8fbff', soft: '#dbeafe', border: '#93c5fd', shadow: 'rgba(37,99,235,.14)', icon: 'fa-bullseye' },
  safety: { label: 'Safety', color: '#16a34a', bg: '#f7fff9', soft: '#dcfce7', border: '#86efac', shadow: 'rgba(22,163,74,.14)', icon: 'fa-shield-halved' },
};

const APP_YELLOW = '#FFE500';
const APP_YELLOW_BORDER = '#e7cf00';
const APP_YELLOW_DARK = '#b89f00';

function fmtMoney(value?: number | null) {
  if (!value) return '—';
  return `$${Math.round(value).toLocaleString()}`;
}

function fmtNumber(value?: number | null) {
  if (!value) return '—';
  return value.toLocaleString();
}

function fmtPct(value?: number | null) {
  if (value == null) return '—';
  return `${Math.round(Number(value))}%`;
}

function fmtDecimal(value?: number | null) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return Number(value).toFixed(2).replace(/\.00$/, '');
}

function admitRange(value?: number | null) {
  if (value == null) return '—';
  const pct = value * 100;
  return `${Math.max(1, Math.round(pct - 5))}–${Math.min(99, Math.round(pct + 5))}%`;
}

function ownershipLabel(value?: string | null) {
  if (!value) return '—';
  if (value.toLowerCase().includes('private')) return 'Private';
  if (value.toLowerCase().includes('public')) return 'Public';
  return value;
}

function fitLabel(score: number) {
  if (score >= 80) return 'Great Fit';
  if (score >= 70) return 'Strong Fit';
  if (score >= 60) return 'Good Fit';
  if (score >= 50) return 'Possible Fit';
  return 'Explore';
}

function fitColor(score: number) {
  if (score >= 75) return '#16a34a';
  if (score >= 60) return '#2563eb';
  if (score >= 45) return '#f59e0b';
  return '#ef4444';
}

function schoolMark(name: string) {
  const skipWords = new Set(['of', 'the', 'and']);
  return name
    .split(/\s+/)
    .filter(Boolean)
    .filter((part, index) => index === 0 || !skipWords.has(part.toLowerCase()))
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase() || 'C';
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function actToSatApprox(act?: number | null) {
  if (!act) return null;
  return Math.round(clamp(590 + act * 28.5, 1000, 1600));
}

function academicScoreFromInputs(inputs?: RecInputs) {
  return inputs?.sat ?? actToSatApprox(inputs?.act) ?? null;
}

function academicScoreForSchool(school: RecCollege) {
  if (school.sat_25 && school.sat_75) return Math.round((school.sat_25 + school.sat_75) / 2);
  if (school.act_25 && school.act_75) return actToSatApprox((school.act_25 + school.act_75) / 2);
  return null;
}

function estimatedCollegeGpa(school: RecCollege) {
  const rate = clamp(Number(school.acceptance_rate || 65), 3, 95);
  return Math.round((4.03 - (rate / 95) * 0.78) * 100) / 100;
}

export default function CollegesV2Page() {
  const { status, update: updateSession } = useSession();
  const { isPaid, score: profileScore } = useProCheck();
  const [activeBucket, setActiveBucket] = useState<Bucket>('target');
  const [recData, setRecData] = useState<RecResponse | null>(null);
  const [savedColleges, setSavedColleges] = useState<SavedCollege[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<RecCollege | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proVerifying, setProVerifying] = useState(false);
  const [isInstate, setIsInstate] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [applyEd, setApplyEd] = useState<boolean | null>(null);
  const [likelyAdmits, setLikelyAdmits] = useState(false);
  const [highAccept, setHighAccept] = useState(false);
  const [testOptional, setTestOptional] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [addingId, setAddingId] = useState<number | null>(null);

  const fetchSaved = useCallback(async () => {
    const response = await fetch('/api/colleges', { cache: 'no-store' });
    const data = response.ok ? await response.json() : [];
    const list = Array.isArray(data) ? data : [];
    setSavedColleges(list);
    setAddedIds(new Set(list.map((college: SavedCollege) => college.master_id).filter(Boolean) as number[]));
  }, []);

  const fetchRecommendations = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (isInstate) params.set('instate', '1');
    if (isPublic) params.set('public', '1');
    if (applyEd === true) params.set('ed', '1');
    if (applyEd === false) params.set('ed', '0');
    try {
      const response = await fetch(`/api/colleges/recommend?${params}`, { cache: 'no-store' });
      const data = await response.json();
      if (data?.upgrade || data?.error === 'Pro subscription required') {
        setProVerifying(true);
        return;
      }
      if (data?.error) {
        setError(data.message || data.error);
        return;
      }
      setRecData(data);
      setSelectedSchool((current) => current || data.pools?.target?.[0] || data.pools?.reach?.[0] || data.pools?.safety?.[0] || null);
    } catch {
      setError('Failed to load recommendations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyEd, isInstate, isPublic]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetchSaved();
    fetchRecommendations(false);
  }, [status, fetchSaved, fetchRecommendations]);

  useEffect(() => {
    if (!proVerifying) return;
    let cancelled = false;
    const started = Date.now();
    const verify = async () => {
      while (!cancelled && Date.now() - started < 15000) {
        try {
          const response = await fetch('/api/subscription/check', { cache: 'no-store' });
          const data = await response.json();
          if (data?.tier === 'pro' || data?.tier === 'premium') {
            await updateSession();
            if (!cancelled) {
              setProVerifying(false);
              fetchRecommendations(false);
            }
            return;
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    };
    verify();
    return () => { cancelled = true; };
  }, [fetchRecommendations, proVerifying, updateSession]);

  const applyListFilters = useCallback((rows: RecCollege[]) => {
    if (likelyAdmits) rows = rows.filter(row => (row.admission_probability ?? 0) >= 0.7);
    if (highAccept) rows = rows.filter(row => row.acceptance_rate >= 50);
    if (testOptional) rows = rows.filter(row => !row.sat_25 && !row.act_25);
    return rows;
  }, [highAccept, likelyAdmits, testOptional]);

  const savedRecommendedRows = useMemo(() => {
    if (!recData) return [];
    return applyListFilters([...recData.pools.reach, ...recData.pools.target, ...recData.pools.safety])
      .filter(row => addedIds.has(row.ope6_id));
  }, [addedIds, applyListFilters, recData]);

  const bucketRows = useMemo(() => {
    if (savedOnly) return savedRecommendedRows;
    return applyListFilters(recData?.pools?.[activeBucket] ?? []);
  }, [activeBucket, applyListFilters, recData, savedOnly, savedRecommendedRows]);

  const filteredCounts = useMemo(() => {
    const next = { reach: 0, target: 0, safety: 0 };
    (['reach', 'target', 'safety'] as Bucket[]).forEach(bucket => {
      next[bucket] = applyListFilters(recData?.pools?.[bucket] ?? []).length;
    });
    return next;
  }, [applyListFilters, recData]);

  const pageSize = 9;
  const pagedRows = bucketRows.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(bucketRows.length / pageSize));

  useEffect(() => {
    setPage(0);
  }, [activeBucket, highAccept, likelyAdmits, savedOnly, testOptional]);

  useEffect(() => {
    if (!pagedRows[0]) return;
    if (!selectedSchool || !bucketRows.some(row => row.ope6_id === selectedSchool.ope6_id)) {
      setSelectedSchool(pagedRows[0]);
    }
  }, [bucketRows, pagedRows, selectedSchool]);

  const stats = useMemo(() => {
    const all = recData ? [...recData.pools.reach, ...recData.pools.target, ...recData.pools.safety] : [];
    const strong = all.filter(row => row.fit_score >= 75).length;
    const avg = all.length ? Math.round(all.reduce((sum, row) => sum + row.fit_score, 0) / all.length) : 0;
    return { total: recData?.counts.total_scored ?? all.length, strong, avg };
  }, [recData]);

  const addToList = async (school: RecCollege) => {
    if (addedIds.has(school.ope6_id)) return;
    setAddingId(school.ope6_id);
    try {
      const response = await fetch('/api/colleges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: school.name,
          master_id: school.ope6_id,
          bucket: school.bucket,
          accept_rate: school.acceptance_rate,
          grad_rate: school.grad_rate ?? 0,
          sat_avg: school.sat_75 ?? school.sat_25 ?? 0,
          sat_range: school.sat_range || 'N/A',
          act_range: school.act_range || 'N/A',
          tuition_in: school.tuition_in_state ? String(school.tuition_in_state) : 'N/A',
          tuition_out: school.tuition_out_state ? String(school.tuition_out_state) : 'N/A',
          notes: '',
        }),
      });
      if (response.ok) {
        setAddedIds(previous => new Set([...Array.from(previous), school.ope6_id]));
        await fetchSaved();
      }
    } finally {
      setAddingId(null);
    }
  };

  const removeFromList = async (school: RecCollege) => {
    const saved = savedColleges.find(college => college.master_id === school.ope6_id);
    if (!saved) return;
    setAddingId(school.ope6_id);
    try {
      const response = await fetch(`/api/colleges?id=${saved.id}`, { method: 'DELETE' });
      if (response.ok) {
        setAddedIds(previous => {
          const next = new Set(previous);
          next.delete(school.ope6_id);
          return next;
        });
        await fetchSaved();
      }
    } finally {
      setAddingId(null);
    }
  };

  if (!isPaid) {
    return (
      <AppShell>
        <main style={css({ flex: 1, overflowY: 'auto' })}>
          <UpgradePrompt score={profileScore ?? undefined} feature="College Recommendations" />
        </main>
      </AppShell>
    );
  }

  const detail = selectedSchool;

  return (
    <AppShell>
      <main style={css({ flex: 1, overflow: 'hidden', background: '#f8fafc', color: '#0f172a' })}>
        <div style={css({ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 366px', gap: 22, padding: '26px 28px' })}>
          <section style={css({ minWidth: 0, overflowY: 'auto', paddingRight: 2 })}>
            <header style={css({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 24 })}>
              <div>
                <h1 style={css({ margin: 0, fontSize: 24, lineHeight: 1.1, fontWeight: 800, color: '#0f172a', letterSpacing: 0 })}>College Explorer</h1>
                <p style={css({ margin: '6px 0 0', color: '#64748b', fontSize: 13, fontWeight: 600 })}>Discover best-fit schools, organize your list, and compare opportunities.</p>
              </div>
            </header>

            <div style={css({ display: 'flex', alignItems: 'center', gap: 22, padding: '10px 16px', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', marginBottom: 18, minHeight: 50 })}>
              <Toggle label="In-State" checked={isInstate} onChange={setIsInstate} />
              <Toggle label="Public" checked={isPublic} onChange={setIsPublic} />
              <Toggle label="Apply ED" checked={applyEd === true} onChange={checked => setApplyEd(checked ? true : false)} />
              <Toggle label="Likely Admits" checked={likelyAdmits} onChange={setLikelyAdmits} />
              <Toggle label="50%+ Accept" checked={highAccept} onChange={setHighAccept} />
              <Toggle label="Test Optional" checked={testOptional} onChange={setTestOptional} />
              <div style={css({ flex: 1 })}></div>
              <button onClick={() => fetchRecommendations(true)} style={iconButton} title="Refresh"><i className="fas fa-rotate"></i></button>
              <button style={iconButton} title="Filters"><i className="fas fa-sliders"></i></button>
            </div>

            <div style={css({ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', marginBottom: 18 })}>
              <Metric icon="fa-building-columns" label="Scored Schools" value={stats.total || '—'} />
              <Metric icon="fa-bullseye" label="Strong Fits" value={stats.strong || '—'} />
              <Metric icon="fa-chart-pie" label="Avg Fit Score" value={stats.avg || '—'} />
              <StudentProfileTile inputs={recData?.inputs} last />
            </div>

            <div style={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 12 })}>
              <div style={css({ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' })}>
                {(['reach', 'target', 'safety'] as Bucket[]).map(bucket => {
                  const active = activeBucket === bucket;
                  const meta = BUCKETS[bucket];
                  return (
                    <button
                      key={bucket}
                      onClick={() => { setActiveBucket(bucket); setSavedOnly(false); }}
                      style={css({
                        minWidth: 122,
                        height: 36,
                        border: `1px solid ${active ? meta.color : meta.border}`,
                        background: active ? meta.color : '#fff',
                        color: active ? '#fff' : meta.color,
                        padding: '0 14px',
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        fontWeight: 850,
                        fontSize: 12,
                        borderRadius: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 7,
                        boxShadow: active ? `0 6px 14px ${meta.shadow}` : '0 2px 8px rgba(15,23,42,.03)',
                        transition: 'all .15s',
                      })}
                    >
                      <i className={`fas ${meta.icon}`} style={{ fontSize: 10 }}></i>
                      <span>{Math.min(filteredCounts[bucket], pageSize)}</span>
                      <span style={css({ opacity: active ? .75 : .55, fontWeight: 850 })}>of {filteredCounts[bucket]}</span>
                      <span>{meta.label}</span>
                    </button>
                  );
                })}
              </div>
              <div style={css({ display: 'flex', gap: 4, background: '#f8fafc', border: '1px solid #dbe3ef', borderRadius: 14, padding: 4, whiteSpace: 'nowrap' })}>
                {([
                  { key: 'recommended' as const, label: 'Recommended', icon: 'fa-wand-magic-sparkles' },
                  { key: 'mylist' as const, label: 'My List', icon: 'fa-bookmark' },
                ]).map(tab => {
                  const active = tab.key === 'mylist' ? savedOnly : !savedOnly;
                  return (
                    <button
                      key={tab.key}
                      onClick={() => setSavedOnly(tab.key === 'mylist')}
                      style={css({
                        height: 36,
                        borderRadius: 10,
                        border: 'none',
                        background: active ? (tab.key === 'mylist' ? APP_YELLOW : '#06245b') : 'transparent',
                        color: active ? (tab.key === 'mylist' ? '#0f172a' : '#fff') : '#64748b',
                        padding: '0 14px',
                        fontFamily: 'inherit',
                        fontSize: 12,
                        fontWeight: 850,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        transition: 'all .15s',
                      })}
                    >
                      <i className={`fas ${tab.icon}`} style={{ fontSize: 10 }}></i>
                      {tab.label}
                      {tab.key === 'mylist' && savedColleges.length > 0 && (
                        <span style={css({
                          background: active ? 'rgba(15,23,42,.12)' : '#e2e8f0',
                          color: active ? '#0f172a' : '#475569',
                          padding: '1px 7px',
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 950,
                        })}>{savedColleges.length}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {savedOnly && (
              <AcademicFitMap
                rows={bucketRows}
                inputs={recData?.inputs}
                onSelect={(school) => setSelectedSchool(school)}
              />
            )}

            <div style={css({ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' })}>
              <table style={css({ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' })}>
                <thead>
                  <tr style={css({ background: '#fbfdff', color: '#64748b', fontSize: 11, fontWeight: 850 })}>
                    <Th align="left">College</Th>
                    <Th width="92px">Fit Score</Th>
                    <Th width="112px">Admit Chance</Th>
                    <Th width="112px">SAT Range</Th>
                    <Th width="98px">ACT Range</Th>
                    <Th width="118px">Acceptance Rate</Th>
                    <Th width="128px"></Th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={7} style={css({ padding: 48, textAlign: 'center', color: '#64748b', fontWeight: 800 })}>Loading recommendations...</td></tr>
                  )}
                  {!loading && error && (
                    <tr><td colSpan={7} style={css({ padding: 48, textAlign: 'center', color: '#b91c1c', fontWeight: 800 })}>{error}</td></tr>
                  )}
                  {!loading && proVerifying && (
                    <tr><td colSpan={7} style={css({ padding: 48, textAlign: 'center', color: '#64748b', fontWeight: 800 })}>Activating Pro access...</td></tr>
                  )}
                  {!loading && !error && !proVerifying && pagedRows.map(school => {
                    const added = addedIds.has(school.ope6_id);
                    const active = detail?.ope6_id === school.ope6_id;
                    return (
                      <tr
                        key={school.ope6_id}
                        onClick={() => setSelectedSchool(school)}
                        style={css({ borderTop: '1px solid #e2e8f0', background: active ? '#f8fbff' : '#fff', cursor: 'pointer' })}
                      >
                        <td style={css({ padding: '12px 10px' })}>
                          <div style={css({ display: 'grid', gridTemplateColumns: '46px 1fr', gap: 12, alignItems: 'center' })}>
                            <LogoMark name={school.name} />
                            <div style={css({ minWidth: 0 })}>
                              <div style={css({ fontSize: 13, fontWeight: 900, color: '#172033', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{school.name}</div>
                              <div style={css({ fontSize: 11, color: '#64748b', marginTop: 3 })}>{[school.city, school.state].filter(Boolean).join(', ')}</div>
                              <span style={smallPill}>{ownershipLabel(school.ownership)}</span>
                            </div>
                          </div>
                        </td>
                        <Td center><FitDonut score={school.fit_score} size={44} /></Td>
                        <Td center><strong>{admitRange(school.admission_probability)}</strong><br /><span style={bucketText(school.bucket)}>{BUCKETS[school.bucket].label}</span></Td>
                        <Td center>{school.sat_range || '—'}</Td>
                        <Td center>{school.act_range || '—'}</Td>
                        <Td center><strong>{fmtPct(school.acceptance_rate)}</strong></Td>
                        <Td>
                          <div style={css({ display: 'grid', gap: 6 })}>
                            <a href={school.college_url || '#'} target="_blank" onClick={event => event.stopPropagation()} style={rowButton}>Visit <i className="fas fa-arrow-up-right-from-square"></i></a>
                            <button onClick={(event) => { event.stopPropagation(); added ? removeFromList(school) : addToList(school); }} style={added ? rowButtonActive : rowButton}>
                              {addingId === school.ope6_id ? (added ? 'Removing...' : 'Adding...') : added ? <><i className="fas fa-xmark"></i> Remove</> : <><i className="fas fa-plus"></i> Add to list</>}
                            </button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                  {!loading && !error && !proVerifying && pagedRows.length === 0 && (
                    <tr>
                      <td colSpan={7} style={css({ padding: 44, textAlign: 'center', color: '#64748b', fontWeight: 800 })}>
                        {savedOnly ? 'No saved colleges match the current filters.' : 'No colleges match the current filters.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, color: '#475569', fontSize: 13, fontWeight: 750 })}>
              <div>Showing {bucketRows.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, bucketRows.length)} of {bucketRows.length} {savedOnly ? 'saved schools' : 'schools'}</div>
              <div style={css({ display: 'flex', gap: 8, alignItems: 'center' })}>
                <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} style={pagerButton}><i className="fas fa-chevron-left"></i></button>
                {Array.from({ length: totalPages }).slice(0, 3).map((_, index) => (
                  <button key={index} onClick={() => setPage(index)} style={page === index ? pagerActive : pagerButton}>{index + 1}</button>
                ))}
                <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} style={pagerButton}><i className="fas fa-chevron-right"></i></button>
              </div>
            </div>
          </section>

          <aside style={css({ minWidth: 0 })}>
            {detail ? (
              <DetailPanel school={detail} />
            ) : (
              <div style={css({ height: '100%', border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', display: 'grid', placeItems: 'center', color: '#64748b', fontWeight: 800 })}>Select a college</div>
            )}
          </aside>
        </div>
      </main>
    </AppShell>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} style={css({ border: 'none', background: 'transparent', display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: 'inherit', fontSize: 12, fontWeight: 850, color: '#475569', cursor: 'pointer', padding: 0 })}>
      <span style={css({ width: 40, height: 22, borderRadius: 999, background: checked ? '#0b2a63' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: checked ? 'flex-end' : 'flex-start', padding: 3, boxSizing: 'border-box', transition: 'all .15s' })}>
        <span style={css({ width: 16, height: 16, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.2)' })}></span>
      </span>
      {label}
    </button>
  );
}

function Metric({ icon, label, value, last }: { icon: string; label: string; value: string | number; last?: boolean }) {
  return (
    <div style={css({ display: 'grid', gridTemplateColumns: '46px 1fr', gap: 11, padding: '14px 24px', borderRight: last ? 'none' : '1px solid #e2e8f0', alignItems: 'center', minHeight: 79 })}>
      <i className={`fas ${icon}`} style={{ color: APP_YELLOW_DARK, fontSize: 27 }}></i>
      <div>
        <div style={css({ color: '#64748b', fontSize: 12, fontWeight: 800 })}>{label}</div>
        <div style={css({ color: '#0f172a', fontSize: 27, fontWeight: 950, lineHeight: 1.05 })}>{value}</div>
      </div>
    </div>
  );
}

function StudentProfileTile({ inputs, last }: { inputs?: RecInputs; last?: boolean }) {
  const scoreLabel = inputs?.sat ? 'SAT' : inputs?.act ? 'ACT' : 'Score';
  const scoreValue = inputs?.sat || inputs?.act || inputs?.final_score || null;
  const apValue = inputs?.ap_taken != null
    ? inputs.ap_offered ? `${inputs.ap_taken}/${inputs.ap_offered}` : String(inputs.ap_taken)
    : '—';

  return (
    <div style={css({ display: 'grid', gridTemplateColumns: '38px 1fr', gap: 11, padding: '12px 22px', borderRight: last ? 'none' : '1px solid #e2e8f0', alignItems: 'center', minHeight: 79 })}>
      <i className="fas fa-user-graduate" style={{ color: APP_YELLOW_DARK, fontSize: 25 }}></i>
      <div style={css({ display: 'grid', gap: 5 })}>
        <ProfileRow label="GPA" value={fmtDecimal(inputs?.gpa_used ?? inputs?.gpa_raw)} />
        <ProfileRow label={scoreLabel} value={scoreValue ? String(scoreValue) : '—'} />
        <ProfileRow label="AP Count" value={apValue} />
      </div>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={css({ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' })}>
      <span style={css({ color: '#64748b', fontSize: 11, fontWeight: 850 })}>{label}</span>
      <span style={css({ color: '#0f172a', fontSize: 14, fontWeight: 950 })}>{value}</span>
    </div>
  );
}

function AcademicFitMap({ rows, inputs, onSelect }: { rows: RecCollege[]; inputs?: RecInputs; onSelect: (school: RecCollege) => void }) {
  const studentGpa = clamp(Number(inputs?.gpa_used ?? inputs?.gpa_raw ?? 3.6), 2.8, 4.0);
  const studentScore = clamp(academicScoreFromInputs(inputs) ?? 1250, 1000, 1600);
  const scoreLabel = inputs?.act && !inputs?.sat ? 'ACT converted to SAT scale' : 'SAT score';
  const plot = { x: 54, y: 28, w: 392, h: 210 };
  const xMid = 1300;
  const yMid = 3.5;
  const toX = (score: number) => plot.x + ((clamp(score, 1000, 1600) - 1000) / 600) * plot.w;
  const toY = (gpa: number) => plot.y + (1 - ((clamp(gpa, 2.8, 4.0) - 2.8) / 1.2)) * plot.h;
  const points = rows
    .map((school) => ({
      school,
      score: academicScoreForSchool(school),
      gpa: estimatedCollegeGpa(school),
    }))
    .filter((point): point is { school: RecCollege; score: number; gpa: number } => point.score != null)
    .slice(0, 18);
  const academicMatch = points.filter(point => point.score <= studentScore + 35 && point.gpa <= studentGpa + 0.08).length;
  const balancedTargets = points.filter(point => point.school.bucket === 'target').length;
  const stretch = points.filter(point => point.score > studentScore + 80 || point.gpa > studentGpa + 0.16).length;
  const lift = points.filter(point => point.score > studentScore && point.score <= studentScore + 70).length;

  return (
    <section style={css({ border: '1px solid #dbe3ef', borderRadius: 12, background: '#fff', boxShadow: '0 14px 34px rgba(15,23,42,.07)', marginBottom: 14, overflow: 'hidden' })}>
      <div style={css({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '16px 18px 12px', borderBottom: '1px solid #edf2f7' })}>
        <div>
          <div style={css({ display: 'flex', alignItems: 'center', gap: 9 })}>
            <h2 style={css({ margin: 0, color: '#0f172a', fontSize: 17, fontWeight: 950, letterSpacing: 0 })}>Academic Fit Map</h2>
            <span style={css({ height: 22, borderRadius: 999, background: '#eff6ff', color: '#2563eb', padding: '0 9px', display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 900 })}>Beta</span>
          </div>
          <p style={css({ margin: '5px 0 0', color: '#64748b', fontSize: 12, fontWeight: 700 })}>See how your GPA and scores compare across your saved college list.</p>
        </div>
        <div style={css({ display: 'inline-flex', background: '#f1f5f9', borderRadius: 9, padding: 3, border: '1px solid #e2e8f0' })}>
          <span style={css({ height: 30, minWidth: 48, borderRadius: 7, background: '#06245b', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 })}>SAT</span>
          <span style={css({ height: 30, minWidth: 48, borderRadius: 7, color: '#64748b', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 900 })}>ACT</span>
        </div>
      </div>

      <div style={css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 220px', gap: 12, padding: '14px 16px 16px' })}>
        <div style={css({ position: 'relative', minHeight: 286 })}>
          <svg viewBox="0 0 520 280" role="img" aria-label="Academic fit map plotting GPA by score" style={{ width: '100%', height: 286, display: 'block' }}>
            <rect x={plot.x} y={plot.y} width={plot.w / 2} height={plot.h / 2} fill="#fef3c7" opacity=".55" />
            <rect x={plot.x + plot.w / 2} y={plot.y} width={plot.w / 2} height={plot.h / 2} fill="#dcfce7" opacity=".62" />
            <rect x={plot.x} y={plot.y + plot.h / 2} width={plot.w / 2} height={plot.h / 2} fill="#fee2e2" opacity=".5" />
            <rect x={plot.x + plot.w / 2} y={plot.y + plot.h / 2} width={plot.w / 2} height={plot.h / 2} fill="#dbeafe" opacity=".55" />
            {[1000, 1150, 1300, 1450, 1600].map(score => (
              <g key={score}>
                <line x1={toX(score)} x2={toX(score)} y1={plot.y} y2={plot.y + plot.h} stroke="#e2e8f0" strokeWidth="1" />
                <text x={toX(score)} y={plot.y + plot.h + 22} textAnchor="middle" fill="#64748b" fontSize="10" fontWeight="700">{score}</text>
              </g>
            ))}
            {[2.8, 3.2, 3.6, 4.0].map(gpa => (
              <g key={gpa}>
                <line x1={plot.x} x2={plot.x + plot.w} y1={toY(gpa)} y2={toY(gpa)} stroke="#e2e8f0" strokeWidth="1" />
                <text x={plot.x - 14} y={toY(gpa) + 4} textAnchor="end" fill="#64748b" fontSize="10" fontWeight="700">{gpa.toFixed(1)}</text>
              </g>
            ))}
            <line x1={toX(xMid)} x2={toX(xMid)} y1={plot.y} y2={plot.y + plot.h} stroke="#cbd5e1" strokeWidth="1.5" />
            <line x1={plot.x} x2={plot.x + plot.w} y1={toY(yMid)} y2={toY(yMid)} stroke="#cbd5e1" strokeWidth="1.5" />
            <text x={plot.x + 14} y={plot.y + 20} fill="#92400e" fontSize="10" fontWeight="900">GPA Strength</text>
            <text x={plot.x + plot.w - 14} y={plot.y + 20} textAnchor="end" fill="#166534" fontSize="10" fontWeight="900">Academic Match</text>
            <text x={plot.x + 14} y={plot.y + plot.h - 12} fill="#b91c1c" fontSize="10" fontWeight="900">Stretch Zone</text>
            <text x={plot.x + plot.w - 14} y={plot.y + plot.h - 12} textAnchor="end" fill="#1d4ed8" fontSize="10" fontWeight="900">Testing Strength</text>
            <text x={plot.x + plot.w / 2} y={270} textAnchor="middle" fill="#334155" fontSize="11" fontWeight="850">{scoreLabel}</text>
            <text x="14" y={plot.y + plot.h / 2} textAnchor="middle" fill="#334155" fontSize="11" fontWeight="850" transform={`rotate(-90 14 ${plot.y + plot.h / 2})`}>GPA</text>

            <line x1={toX(studentScore)} x2={toX(studentScore)} y1={toY(studentGpa)} y2={plot.y + plot.h} stroke="#0b2a63" strokeDasharray="4 4" strokeWidth="1.4" opacity=".55" />
            <line x1={plot.x} x2={toX(studentScore)} y1={toY(studentGpa)} y2={toY(studentGpa)} stroke="#0b2a63" strokeDasharray="4 4" strokeWidth="1.4" opacity=".55" />
            {points.map(point => {
              const meta = BUCKETS[point.school.bucket];
              const label = point.school.name.split(/\s+/).slice(0, 2).join(' ');
              const showLabel = point.school.fit_score >= 68 || point.school.bucket === 'reach';
              return (
                <g key={point.school.ope6_id} onClick={() => onSelect(point.school)} style={{ cursor: 'pointer' }}>
                  <circle cx={toX(point.score)} cy={toY(point.gpa)} r="6.5" fill={meta.color} stroke="#fff" strokeWidth="2" opacity=".92" />
                  {showLabel && (
                    <text x={toX(point.score) + 9} y={toY(point.gpa) - 8} fill="#334155" fontSize="9" fontWeight="850">{label}</text>
                  )}
                </g>
              );
            })}
            <circle cx={toX(studentScore)} cy={toY(studentGpa)} r="10" fill="#06245b" stroke="#fff" strokeWidth="4" />
            <text x={toX(studentScore) + 14} y={toY(studentGpa) + 4} fill="#06245b" fontSize="11" fontWeight="950">You</text>
          </svg>
          <div style={css({ display: 'flex', justifyContent: 'center', gap: 14, marginTop: -4, color: '#64748b', fontSize: 11, fontWeight: 850 })}>
            <LegendDot color={BUCKETS.reach.color} label="Reach" />
            <LegendDot color={BUCKETS.target.color} label="Target" />
            <LegendDot color={BUCKETS.safety.color} label="Safety" />
            <LegendDot color="#06245b" label="You" />
          </div>
        </div>

        <div style={css({ display: 'grid', alignContent: 'start', gap: 9 })}>
          <InsightMetric icon="fa-check" label="Academic Match" value={`${academicMatch} schools`} color="#16a34a" />
          <InsightMetric icon="fa-bullseye" label="Balanced Targets" value={`${balancedTargets} schools`} color="#2563eb" />
          <InsightMetric icon="fa-arrow-trend-up" label="Stretch Academics" value={`${stretch} schools`} color="#ef4444" />
          <InsightMetric icon="fa-wand-magic-sparkles" label="Score Lift" value={`+70 opens ${lift} more`} color="#f59e0b" />
          <div style={css({ marginTop: 2, color: '#64748b', fontSize: 11, lineHeight: 1.45, fontWeight: 700 })}>
            GPA placement is estimated from school selectivity when school-reported GPA is unavailable.
          </div>
        </div>
      </div>
    </section>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={css({ display: 'inline-flex', alignItems: 'center', gap: 6 })}>
      <span style={css({ width: 9, height: 9, borderRadius: 999, background: color })}></span>
      {label}
    </span>
  );
}

function InsightMetric({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={css({ border: '1px solid #e2e8f0', borderRadius: 9, padding: '11px 12px', background: '#fbfdff', display: 'grid', gridTemplateColumns: '28px 1fr', gap: 9, alignItems: 'center' })}>
      <span style={css({ width: 28, height: 28, borderRadius: 8, background: `${color}18`, color, display: 'grid', placeItems: 'center', fontSize: 12 })}>
        <i className={`fas ${icon}`}></i>
      </span>
      <span>
        <span style={css({ display: 'block', color: '#64748b', fontSize: 11, fontWeight: 850 })}>{label}</span>
        <span style={css({ display: 'block', color: '#0f172a', fontSize: 14, fontWeight: 950, marginTop: 2 })}>{value}</span>
      </span>
    </div>
  );
}

function detailHeroStyle(bucket: Bucket): { background: string; glow: string; accent: string } {
  if (bucket === 'reach') {
    return {
      background: 'radial-gradient(circle at 72% 36%, rgba(255,229,0,.18), transparent 18%), radial-gradient(circle at 22% 0%, rgba(248,113,113,.34), transparent 34%), linear-gradient(135deg, #3b1020 0%, #7f1d1d 42%, #dc2626 100%)',
      glow: 'rgba(255,229,0,.22)',
      accent: '#FFE500',
    };
  }
  if (bucket === 'safety') {
    return {
      background: 'radial-gradient(circle at 72% 36%, rgba(255,229,0,.18), transparent 18%), radial-gradient(circle at 22% 0%, rgba(74,222,128,.32), transparent 34%), linear-gradient(135deg, #052e2b 0%, #065f46 42%, #16a34a 100%)',
      glow: 'rgba(255,229,0,.2)',
      accent: '#FFE500',
    };
  }
  return {
    background: 'radial-gradient(circle at 72% 36%, rgba(255,229,0,.22), transparent 18%), radial-gradient(circle at 22% 0%, rgba(86,134,255,.34), transparent 34%), linear-gradient(135deg, #041b45 0%, #06245b 42%, #123f9d 100%)',
    glow: 'rgba(255,229,0,.22)',
    accent: '#FFE500',
  };
}

function DetailPanel({ school }: { school: RecCollege }) {
  const goodReasons = school.fit_reasons.filter(reason => reason.good).slice(0, 4);
  const watchOuts = school.fit_reasons.filter(reason => !reason.good).slice(0, 3);
  const fit = fitColor(school.fit_score);
  const hero = detailHeroStyle(school.bucket);

  return (
    <div style={css({ height: '100%', borderRadius: 16, background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 18px 44px rgba(15,23,42,.12)', overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
      <div style={css({ height: 172, background: hero.background, position: 'relative', zIndex: 2, overflow: 'visible', flexShrink: 0 })}>
        <div style={css({ position: 'absolute', inset: 0, opacity: .2, backgroundImage: 'linear-gradient(rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)', backgroundSize: '34px 34px', transform: 'perspective(220px) rotateX(42deg) translateY(-38px) scale(1.35)', transformOrigin: 'center top', pointerEvents: 'none' })}></div>
        <div style={css({ position: 'absolute', left: 138, top: 28, width: 76, height: 76, borderRadius: 18, border: '1px solid rgba(255,255,255,.13)', transform: 'rotate(18deg)', pointerEvents: 'none' })}></div>
        <div style={css({ position: 'absolute', right: -12, bottom: -28, width: 132, height: 132, borderRadius: 999, background: hero.glow, filter: 'blur(2px)', opacity: .42, pointerEvents: 'none' })}></div>
        <a href={school.college_url || '#'} target="_blank" style={css({ position: 'absolute', top: 14, right: 14, height: 34, borderRadius: 999, border: '1px solid rgba(255,255,255,.55)', background: 'rgba(255,255,255,.92)', color: '#06245b', fontSize: 12, fontWeight: 950, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '0 13px', textDecoration: 'none', boxShadow: '0 8px 20px rgba(15,23,42,.16)' })}>Visit <i className="fas fa-arrow-up-right-from-square"></i></a>
        <div style={css({ position: 'absolute', left: 20, top: 18, right: 112, zIndex: 4, color: '#fff', textShadow: '0 2px 12px rgba(0,0,0,.22)' })}>
          <div style={css({ display: 'inline-flex', alignItems: 'center', gap: 7, height: 24, padding: '0 10px', borderRadius: 999, background: 'rgba(255,255,255,.15)', border: '1px solid rgba(255,255,255,.2)', fontSize: 10, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '.45px', marginBottom: 8 })}>
            <i className={`fas ${BUCKETS[school.bucket].icon}`} style={{ color: hero.accent }}></i>
            {BUCKETS[school.bucket].label}
          </div>
          <h2 style={css({ margin: 0, fontSize: 22, lineHeight: 1.08, fontWeight: 950, letterSpacing: 0 })}>{school.name}</h2>
          <div style={css({ color: 'rgba(255,255,255,.82)', fontSize: 12, fontWeight: 800, marginTop: 5 })}>{[school.city, school.state].filter(Boolean).join(', ')}</div>
        </div>
        <div style={css({ position: 'absolute', left: 20, bottom: -56, zIndex: 5 })}>
          <LogoMark name={school.name} large />
        </div>
      </div>
      <div style={css({ flex: 1, padding: '70px 20px 20px', overflowY: 'auto', position: 'relative', zIndex: 1, background: '#eef5ff url("/college-detail-bg.svg") center top / cover no-repeat' })}>
        <div style={css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 88px', gap: 16, alignItems: 'center' })}>
          <div style={css({ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fbfdff', padding: '13px 14px' })}>
            <div style={css({ color: '#64748b', fontSize: 12, fontWeight: 850 })}>Admit Chance</div>
            <div style={css({ color: '#0f172a', fontSize: 22, fontWeight: 950, marginTop: 5 })}>{admitRange(school.admission_probability)}</div>
            <div style={bucketText(school.bucket)}>{BUCKETS[school.bucket].label}</div>
          </div>
          <div style={css({ textAlign: 'center' })}>
            <FitDonut score={school.fit_score} size={78} />
            <div style={css({ color: fit, fontWeight: 900, fontSize: 13, marginTop: 5 })}>{fitLabel(school.fit_score)}</div>
          </div>
        </div>

        <div style={css({ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 })}>
          <span style={detailPill}>{ownershipLabel(school.ownership)}</span>
          <span style={detailPill}>{school.enrollment && school.enrollment > 20000 ? 'Large (20K+ undergrads)' : 'Mid-size campus'}</span>
        </div>

        <InfoRow leftLabel="Intended Major" leftValue={school.program_name || 'Program not specified'} rightLabel="Program Fit" rightValue={school.program_name ? 'Excellent' : 'General'} compact accentRight />

        <div style={css({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 20 })}>
          <DetailStat label="Acceptance Rate" value={fmtPct(school.acceptance_rate)} />
          <DetailStat label="SAT Range" value={school.sat_range || '—'} />
          <DetailStat label="ACT Range" value={school.act_range || '—'} />
          <DetailStat label="Graduation Rate" value={fmtPct(school.grad_rate)} />
          <DetailStat label="Student-Faculty Ratio" value={school.student_faculty_ratio ? `${school.student_faculty_ratio}:1` : '—'} />
        </div>

        <DetailGroup title="Students & Outcomes">
          <MiniMetric label="Retention" value={fmtPct(school.retention_rate)} />
          <MiniMetric label="Enrollment" value={fmtNumber(school.enrollment)} />
          <MiniMetric label="Graduation Rate" value={fmtPct(school.grad_rate)} />
          <MiniMetric label="Student:Faculty" value={school.student_faculty_ratio ? `${school.student_faculty_ratio}:1` : '—'} />
        </DetailGroup>

        <DetailGroup title="Cost">
          <MiniMetric label="Est. Net Price / yr" value={fmtMoney(school.net_price)} />
          <MiniMetric label="Total Cost" value={fmtMoney(school.cost_attendance)} />
          <MiniMetric label="In-State Tuition" value={fmtMoney(school.tuition_in_state)} />
          <MiniMetric label="Median Debt" value={fmtMoney(school.median_debt)} />
        </DetailGroup>

        <div style={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, borderBottom: '1px solid #e2e8f0', padding: '15px 0' })}>
          <MiniMetric label="Average Starting Salary" value={fmtMoney(school.program_earn_5yr || school.earnings_6yr)} plain />
          <MiniMetric label="Median Earnings" value={fmtMoney(school.earnings_10yr)} plain />
        </div>

        <ReasonList title="Why You'll Like It" icon="fa-check" color="#22c55e" items={goodReasons.map(reason => reason.text)} fallback={['Strong match based on your profile and college preferences.']} />
        <ReasonList title="Watch Outs" icon="fa-triangle-exclamation" color="#f97316" items={watchOuts.map(reason => reason.text)} fallback={school.overmatch_risk ? ['Scores may be above typical range; yield protection can matter.'] : ['Review cost, selectivity, and program fit before applying.']} />

        <StudentBody school={school} />
      </div>
    </div>
  );
}

function DetailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={css({ border: '1px solid #e2e8f0', borderRadius: 9, padding: '13px 12px', minHeight: 78 })}>
      <div style={css({ color: '#64748b', fontSize: 11, fontWeight: 850 })}>{label}</div>
      <div style={css({ color: '#0f172a', fontSize: 17, fontWeight: 950, marginTop: 8 })}>{value}</div>
      {sub && <div style={bucketText(sub.toLowerCase() as Bucket)}>{sub}</div>}
    </div>
  );
}

function DetailGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={css({ borderBottom: '1px solid #e2e8f0', padding: '15px 0' })}>
      <div style={css({ color: '#64748b', fontSize: 11, fontWeight: 950, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 10 })}>{title}</div>
      <div style={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 })}>{children}</div>
    </section>
  );
}

function MiniMetric({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  return (
    <div style={css({ border: plain ? '1px solid #e2e8f0' : 'none', background: plain ? '#fff' : '#f8fafc', borderRadius: 9, padding: '11px 12px' })}>
      <div style={css({ color: '#64748b', fontSize: 11, fontWeight: 850 })}>{label}</div>
      <div style={css({ color: '#0f172a', fontSize: 15, fontWeight: 950, marginTop: 6 })}>{value}</div>
    </div>
  );
}

function StudentBody({ school }: { school: RecCollege }) {
  const groups = [
    { label: 'White', value: school.pct_white, color: '#3b82f6' },
    { label: 'Hispanic', value: school.pct_hispanic, color: '#f59e0b' },
    { label: 'Asian', value: school.pct_asian, color: '#8b5cf6' },
    { label: 'Black', value: school.pct_black, color: '#10b981' },
  ].filter(group => group.value != null && Number(group.value) > 0);
  const remainder = Math.max(0, 100 - groups.reduce((sum, group) => sum + Number(group.value || 0), 0));
  const women = school.pct_women != null ? Math.round(Number(school.pct_women)) : null;
  const men = school.pct_men != null ? Math.round(Number(school.pct_men)) : null;

  return (
    <section style={css({ padding: '15px 0 14px', borderBottom: '1px solid #e2e8f0' })}>
      <div style={css({ display: 'flex', alignItems: 'center', gap: 9, color: '#64748b', fontSize: 11, fontWeight: 950, letterSpacing: .8, textTransform: 'uppercase', marginBottom: 12 })}>
        <span style={css({ width: 11, height: 11, borderRadius: 999, background: 'linear-gradient(90deg, #7c3aed 50%, #c4b5fd 50%)', display: 'inline-block' })}></span>
        Student Body
      </div>
      <div style={css({ display: 'flex', height: 11, borderRadius: 999, overflow: 'hidden', background: '#cbd5e1', marginBottom: 14 })}>
        {groups.map(group => (
          <span key={group.label} style={css({ width: `${Math.max(3, Number(group.value))}%`, background: group.color })}></span>
        ))}
        {remainder > 0 && <span style={css({ flex: 1, background: '#cbd5e1' })}></span>}
      </div>
      <div style={css({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginBottom: 14 })}>
        {groups.map(group => (
          <div key={group.label} style={css({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 850, color: '#334155' })}>
            <span style={css({ width: 9, height: 9, borderRadius: 999, background: group.color })}></span>
            {group.label} {Number(group.value).toFixed(1)}%
          </div>
        ))}
      </div>
      <div style={css({ fontSize: 14, fontWeight: 900, color: '#0f172a' })}>
        {women != null ? `${women}% women` : 'Women —'} {men != null ? `${men}% men` : 'Men —'}
      </div>
    </section>
  );
}

function InfoRow({ leftLabel, leftValue, rightLabel, rightValue, compact, accentRight }: { leftLabel: string; leftValue: string; rightLabel?: string; rightValue?: string; compact?: boolean; accentRight?: boolean }) {
  return (
    <div style={css({ display: 'grid', gridTemplateColumns: rightLabel ? '1fr 120px' : '1fr', gap: 14, borderBottom: '1px solid #e2e8f0', padding: compact ? '13px 0 14px' : '16px 0' })}>
      <div>
        <div style={css({ color: '#64748b', fontSize: 12, fontWeight: 850 })}>{leftLabel}</div>
        <div style={css({ color: '#0f172a', fontSize: 15, fontWeight: 900, marginTop: 6 })}>{leftValue}</div>
      </div>
      {rightLabel && (
        <div>
          <div style={css({ color: '#64748b', fontSize: 12, fontWeight: 850 })}>{rightLabel}</div>
          <div style={css({ color: accentRight ? '#16a34a' : '#0f172a', fontSize: 13, fontWeight: 900, marginTop: 7 })}>
            {accentRight && <span style={css({ display: 'inline-block', width: 9, height: 9, borderRadius: 999, background: '#16a34a', marginRight: 7 })}></span>}
            {rightValue}
          </div>
        </div>
      )}
    </div>
  );
}

function ReasonList({ title, icon, color, items, fallback }: { title: string; icon: string; color: string; items: string[]; fallback: string[] }) {
  const visible = (items.length ? items : fallback).slice(0, 4);
  return (
    <div style={css({ borderBottom: '1px solid #e2e8f0', padding: '15px 0' })}>
      <div style={css({ color: '#334155', fontSize: 12, fontWeight: 950, marginBottom: 10 })}>{title}</div>
      <div style={css({ display: 'grid', gap: 8 })}>
        {visible.map(item => (
          <div key={item} style={css({ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8, color: '#334155', fontSize: 12, fontWeight: 720, lineHeight: 1.35 })}>
            <i className={`fas ${icon}`} style={{ color, marginTop: 1 }}></i>
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogoMark({ name, large }: { name: string; large?: boolean }) {
  return (
    <div style={css({ width: large ? 94 : 44, height: large ? 94 : 44, borderRadius: large ? 10 : 8, background: '#08245a', border: large ? '4px solid #fff' : '1px solid #cbd5e1', boxShadow: large ? '0 8px 22px rgba(15,23,42,.24)' : 'none', color: '#facc15', display: 'grid', placeItems: 'center', fontSize: large ? 30 : 15, fontWeight: 950, flexShrink: 0, position: 'relative', zIndex: large ? 3 : 'auto' })}>
      {schoolMark(name)}
    </div>
  );
}

function FitDonut({ score, size }: { score: number; size: number }) {
  const color = fitColor(score);
  return (
    <div style={css({ width: size, height: size, borderRadius: 999, background: `conic-gradient(${color} ${score * 3.6}deg, #e2e8f0 0)`, display: 'grid', placeItems: 'center', margin: '0 auto' })}>
      <div style={css({ width: size - 9, height: size - 9, borderRadius: 999, background: '#fff', display: 'grid', placeItems: 'center', color: '#0f172a', fontWeight: 950, fontSize: size > 60 ? 20 : 13 })}>{score}</div>
    </div>
  );
}

function Th({ children, align = 'center', width }: { children?: React.ReactNode; align?: 'left' | 'center'; width?: string }) {
  return <th style={css({ width, textAlign: align, padding: '11px 10px', borderBottom: '1px solid #e2e8f0' })}>{children}</th>;
}

function Td({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <td style={css({ padding: '12px 10px', color: '#334155', fontSize: 13, fontWeight: 720, textAlign: center ? 'center' : 'left' })}>{children}</td>;
}

function bucketText(bucket: Bucket | string): React.CSSProperties {
  const meta = BUCKETS[bucket as Bucket] || BUCKETS.target;
  return { color: meta.color, fontSize: 11, fontWeight: 900, marginTop: 4 };
}

const outlineButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  border: '1px solid #dbe3ef',
  background: '#fff',
  color: '#172033',
  borderRadius: 7,
  padding: '0 18px',
  height: 44,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 850,
  cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  border: '1px solid #06245b',
  background: '#06245b',
  color: '#fff',
  borderRadius: 7,
  padding: '0 20px',
  height: 44,
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 900,
  cursor: 'pointer',
};

const iconButton: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 8,
  border: '1px solid #dbe3ef',
  background: '#fff',
  color: '#172033',
  cursor: 'pointer',
  fontSize: 15,
};

const rowButton: React.CSSProperties = {
  display: 'inline-flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 8,
  height: 28,
  borderRadius: 6,
  border: '1px solid #dbe3ef',
  background: '#fff',
  color: '#172033',
  fontFamily: 'inherit',
  fontSize: 11,
  fontWeight: 850,
  textDecoration: 'none',
  cursor: 'pointer',
};

const rowButtonActive: React.CSSProperties = {
  ...rowButton,
  borderColor: '#bfdbfe',
  background: '#eff6ff',
  color: '#2563eb',
};

const pagerButton: React.CSSProperties = {
  minWidth: 30,
  height: 30,
  borderRadius: 7,
  border: '1px solid #e2e8f0',
  background: '#fff',
  color: '#64748b',
  fontFamily: 'inherit',
  fontWeight: 850,
  cursor: 'pointer',
};

const pagerActive: React.CSSProperties = {
  ...pagerButton,
  background: '#06245b',
  borderColor: '#06245b',
  color: '#fff',
};

const smallPill: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 5,
  padding: '2px 7px',
  borderRadius: 6,
  background: '#eff6ff',
  color: '#2563eb',
  fontSize: 10,
  fontWeight: 850,
};

const detailPill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: 30,
  padding: '0 12px',
  borderRadius: 7,
  background: '#eff6ff',
  color: '#2563eb',
  fontSize: 12,
  fontWeight: 900,
};
