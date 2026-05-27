'use client';

/**
 * Client component for /team-login. Mirrors the demo-buttons UI from
 * the public /login page but lives behind the server-side key gate
 * (see ./page.tsx). On click, signs in with the seeded password and
 * redirects to /dashboard (or admin sees their console).
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

const DEMO_USERS = [
  { email:'student1@example.com',  name:'Maya Patel',   initials:'MP', bg:'#eff6ff', color:'#2563eb', label:'Student · Pro',  sub:'GPA 3.4 · SAT 1420' },
  { email:'student2@example.com',  name:'James Chen',   initials:'JC', bg:'#f0fdfa', color:'#0d9488', label:'Student · Free', sub:'GPA 4.7 · SAT 1470' },
  { email:'counselor1@example.com',name:'Dr. Mitchell', initials:'SM', bg:'#fefce8', color:'#ca8a04', label:'Counselor',      sub:'Yale · 12yr' },
  { email:'counselor2@example.com',name:'Dr. Kim',      initials:'RK', bg:'#fdf4ff', color:'#a855f7', label:'Counselor',      sub:'Stanford · 8yr' },
  { email:'admin@admitly.com',     name:'Admin',        initials:'AD', bg:'#f0fdf4', color:'#16a34a', label:'Admin',          sub:'' },
];

export default function TeamLoginClient() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loginAs = async (email: string) => {
    setBusy(email);
    setError(null);
    try {
      const res = await signIn('credentials', {
        email,
        password: 'password',
        redirect: false,
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      // Admins land on /admin; everyone else to /dashboard.
      router.push(email.startsWith('admin@') ? '/admin' : '/dashboard');
    } catch (e: any) {
      setError(e?.message || 'Sign in failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a', color: '#fff',
      fontFamily: "'DM Sans', -apple-system, sans-serif",
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 520 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '5px 14px', borderRadius: 999,
            background: 'rgba(255,229,0,.12)', color: '#FFE500',
            fontSize: 11, fontWeight: 800, letterSpacing: '.5px',
            textTransform: 'uppercase', marginBottom: 14,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FFE500' }}></span>
            Team access
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.5px', marginBottom: 6 }}>
            Quick demo login
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,.55)', lineHeight: 1.6 }}>
            Click any account to log in instantly. This page is for solo testing only — don't share the URL.
          </p>
        </div>

        {/* Demo accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {DEMO_USERS.map(u => (
            <button
              key={u.email}
              onClick={() => loginAs(u.email)}
              disabled={busy != null}
              style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 18px',
                background: busy === u.email ? 'rgba(255,229,0,.08)' : 'rgba(255,255,255,.04)',
                border: '1px solid rgba(255,255,255,.08)', borderRadius: 14,
                color: '#fff', fontFamily: 'inherit',
                cursor: busy != null ? 'wait' : 'pointer',
                textAlign: 'left',
                transition: 'all .15s',
                opacity: busy != null && busy !== u.email ? 0.4 : 1,
              }}
              onMouseEnter={e => {
                if (busy != null) return;
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,229,0,.06)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,229,0,.3)';
              }}
              onMouseLeave={e => {
                if (busy === u.email) return;
                (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.04)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,.08)';
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: u.bg, color: u.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 900, flexShrink: 0,
              }}>{u.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>{u.name}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.55)' }}>
                  {u.label}{u.sub ? ` · ${u.sub}` : ''}
                </div>
              </div>
              <div style={{
                fontSize: 11, fontWeight: 800, color: 'rgba(255,229,0,.7)',
                letterSpacing: '.3px', textTransform: 'uppercase',
              }}>
                {busy === u.email ? '…' : 'Log in →'}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div style={{
            marginTop: 16, padding: '10px 14px',
            background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)',
            borderRadius: 10, fontSize: 12, color: '#fca5a5',
          }}>
            <strong style={{ color: '#fff' }}>Login failed:</strong> {error}
          </div>
        )}

        {/* Footer hint */}
        <div style={{
          marginTop: 28, textAlign: 'center',
          fontSize: 11, color: 'rgba(255,255,255,.35)', lineHeight: 1.6,
        }}>
          Password for all accounts: <code style={{
            background: 'rgba(255,255,255,.06)', padding: '2px 7px',
            borderRadius: 4, color: 'rgba(255,229,0,.8)', fontFamily: 'monospace',
          }}>password</code>
          <br/>
          Need the regular sign-in?{' '}
          <a href="/login" style={{ color: 'rgba(255,229,0,.7)', fontWeight: 700, textDecoration: 'underline' }}>
            /login
          </a>
        </div>
      </div>
    </div>
  );
}
