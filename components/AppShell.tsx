'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';

interface AppShellProps { children: React.ReactNode; }

const IDLE_TIMEOUT_MS = 45 * 60 * 1000;

export function AppShell({ children }: AppShellProps) {
  const { data: session, status } = useSession();
  const router   = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [impersonating, setImpersonating] = useState<string|null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  // Detect impersonation via localStorage
  useEffect(() => {
    const orig = localStorage.getItem('impersonate_origin');
    setImpersonating(orig);
  }, [session]);

  const stopImpersonating = async () => {
    localStorage.removeItem('impersonate_origin');
    await signOut({ callbackUrl: '/login' });
  };

  useEffect(() => {
    if (status !== 'authenticated') return;
    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => signOut({ callbackUrl: '/login' }), IDLE_TIMEOUT_MS);
    };
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, resetTimer, { passive: true }));
    resetTimer();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimer));
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status]);

  if (status === 'loading') {
    return (
      <div style={{ height: '100vh', width: '100vw', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center' }}>
          <svg viewBox="0 0 36 36" fill="none" width="48" height="48" style={{ margin: '0 auto 12px' }}>
            <rect width="36" height="36" rx="10" fill="#FFE500"/>
            <path d="M26 9 C26 7.3 24.7 6 23 6 C21.5 6 20.2 7 20 8.5 C18.8 8.2 17.5 8.5 16.5 9.4 C15.2 10.5 14.8 12 15.2 13.4 L7 13.4 C6.4 13.4 6 14.2 6.4 14.7 L8.5 17.5 L6.8 23 C6.6 23.6 7.1 24.2 7.7 24 L10.5 23.1 L11.2 26.2 C11.4 27 12.3 27.2 12.8 26.6 L15.5 23 L18 23.5 C20.5 24 23 23 24.5 21 C25.8 19.3 26 17 25 15.2 L28 13 C29.2 12.2 29.2 10.5 28 9.8 L26.4 9.1 C26.3 9.1 26.2 9 26 9Z" fill="#1c1917"/>
            <circle cx="23" cy="9.5" r="1.2" fill="#FFE500"/>
          </svg>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--stone-400)' }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: "'DM Sans', -apple-system, sans-serif", background: 'var(--bg)' }}>
      <Sidebar />
      <div style={{ marginLeft: 58, flex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        {/* Impersonation banner */}
        {impersonating && (
          <div style={{ background: '#f59e0b', padding: '8px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, zIndex: 40, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className="fas fa-user-secret" style={{ fontSize: 13, color: '#000' }}></i>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#000' }}>
                Impersonating as <strong>{session.user.name}</strong> ({session.user.email})
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,.6)' }}>— admin: {impersonating}</span>
            </div>
            <button onClick={stopImpersonating}
              style={{ padding: '4px 12px', borderRadius: 8, border: '1.5px solid rgba(0,0,0,.2)', background: 'rgba(0,0,0,.1)', fontSize: 11, fontWeight: 800, color: '#000', cursor: 'pointer', fontFamily: 'inherit' }}>
              <i className="fas fa-sign-out-alt" style={{ marginRight: 4 }}></i>Stop Impersonating
            </button>
          </div>
        )}
        <div style={{ flex: 1, display: 'flex' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
