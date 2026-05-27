'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';

type Bucket = 'reach' | 'target' | 'safety';

interface College {
  id: number;
  name: string;
  bucket: Bucket;
  city?: string | null;
  state?: string | null;
  ownership?: string | null;
  accept_rate?: number | null;
  sat_range?: string | null;
  act_range?: string | null;
  net_price?: number | null;
  grad_rate?: number | null;
  enrollment?: number | null;
  college_url?: string | null;
}

const s = (o: React.CSSProperties) => o;

const bucketMeta: Record<Bucket, { label: string; color: string; bg: string }> = {
  reach: { label: 'Reach', color: '#ef4444', bg: '#fef2f2' },
  target: { label: 'Target', color: '#2563eb', bg: '#eff6ff' },
  safety: { label: 'Safety', color: '#16a34a', bg: '#f0fdf4' },
};

function money(value?: number | null) {
  if (!value) return '—';
  return `$${Math.round(value).toLocaleString()}`;
}

function pct(value?: number | null) {
  if (value == null) return '—';
  return `${Math.round(Number(value))}%`;
}

function mark(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'C';
}

export default function MyCollegeListPage() {
  const [colleges, setColleges] = useState<College[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/colleges', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : [])
      .then(data => setColleges(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    reach: colleges.filter(college => college.bucket === 'reach').length,
    target: colleges.filter(college => college.bucket === 'target').length,
    safety: colleges.filter(college => college.bucket === 'safety').length,
  }), [colleges]);

  return (
    <AppShell>
      <main style={s({ flex: 1, overflowY: 'auto', background: '#f8fafc', padding: '30px 34px 60px', color: '#0f172a' })}>
        <header style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, marginBottom: 26 })}>
          <div>
            <a href="/colleges_v2" style={s({ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#2563eb', fontSize: 13, fontWeight: 850, textDecoration: 'none', marginBottom: 14 })}>
              <i className="fas fa-arrow-left"></i> Back to Colleges
            </a>
            <h1 style={s({ margin: 0, fontSize: 32, lineHeight: 1, fontWeight: 950, letterSpacing: 0 })}>My College List</h1>
            <p style={s({ margin: '10px 0 0', color: '#64748b', fontSize: 15, fontWeight: 650 })}>Your saved schools, grouped by application strategy.</p>
          </div>
          <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3, 110px)', gap: 10 })}>
            {(['reach', 'target', 'safety'] as Bucket[]).map(bucket => (
              <div key={bucket} style={s({ border: `1px solid ${bucketMeta[bucket].color}33`, background: bucketMeta[bucket].bg, color: bucketMeta[bucket].color, borderRadius: 14, padding: '12px 14px', textAlign: 'center' })}>
                <div style={s({ fontSize: 22, fontWeight: 950, lineHeight: 1 })}>{counts[bucket]}</div>
                <div style={s({ fontSize: 12, fontWeight: 850, marginTop: 5 })}>{bucketMeta[bucket].label}</div>
              </div>
            ))}
          </div>
        </header>

        {loading ? (
          <div style={emptyState}>Loading your college list...</div>
        ) : colleges.length === 0 ? (
          <div style={emptyState}>
            <div style={s({ fontSize: 17, fontWeight: 900, color: '#0f172a', marginBottom: 6 })}>No colleges saved yet</div>
            <div style={s({ color: '#64748b', fontSize: 13, fontWeight: 650 })}>Add schools from Colleges v2 and they’ll appear here.</div>
          </div>
        ) : (
          <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 })}>
            {colleges.map(college => {
              const meta = bucketMeta[college.bucket] || bucketMeta.target;
              return (
                <article key={college.id} style={s({ border: '1px solid #e2e8f0', borderRadius: 14, background: '#fff', padding: 18, boxShadow: '0 10px 28px rgba(15,23,42,.06)' })}>
                  <div style={s({ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 14, alignItems: 'center' })}>
                    <div style={s({ width: 52, height: 52, borderRadius: 12, background: '#08245a', color: '#facc15', display: 'grid', placeItems: 'center', fontSize: 17, fontWeight: 950 })}>{mark(college.name)}</div>
                    <div style={s({ minWidth: 0 })}>
                      <h2 style={s({ margin: 0, fontSize: 16, fontWeight: 950, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{college.name}</h2>
                      <div style={s({ color: '#64748b', fontSize: 12, fontWeight: 700, marginTop: 4 })}>{[college.city, college.state].filter(Boolean).join(', ') || 'Location unavailable'}</div>
                    </div>
                  </div>
                  <div style={s({ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 })}>
                    <span style={s({ background: meta.bg, color: meta.color, borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 900 })}>{meta.label}</span>
                    <span style={s({ background: '#eff6ff', color: '#2563eb', borderRadius: 999, padding: '5px 10px', fontSize: 11, fontWeight: 900 })}>{college.ownership || 'School type'}</span>
                  </div>
                  <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 16 })}>
                    <MiniStat label="Acceptance" value={pct(college.accept_rate)} />
                    <MiniStat label="Net Price" value={money(college.net_price)} />
                    <MiniStat label="SAT" value={college.sat_range || '—'} />
                    <MiniStat label="ACT" value={college.act_range || '—'} />
                  </div>
                  <div style={s({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0', color: '#64748b', fontSize: 12, fontWeight: 750 })}>
                    <span>{college.enrollment ? `${college.enrollment.toLocaleString()} students` : 'Enrollment unavailable'}</span>
                    {college.college_url && <a href={college.college_url} target="_blank" style={s({ color: '#2563eb', textDecoration: 'none', fontWeight: 900 })}>Website <i className="fas fa-arrow-up-right-from-square"></i></a>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={s({ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', minHeight: 58 })}>
      <div style={s({ color: '#64748b', fontSize: 11, fontWeight: 850 })}>{label}</div>
      <div style={s({ color: '#0f172a', fontSize: 14, fontWeight: 950, marginTop: 6 })}>{value}</div>
    </div>
  );
}

const emptyState: React.CSSProperties = {
  minHeight: 260,
  border: '1px dashed #cbd5e1',
  borderRadius: 16,
  background: '#fff',
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  color: '#64748b',
  fontWeight: 800,
};
