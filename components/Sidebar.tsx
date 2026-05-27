'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useState, useRef, useEffect } from 'react';
import { useProCheck } from '@/lib/useProCheck';

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { data: session } = useSession();
  const { isPaid } = useProCheck();
  const [menuOpen, setMenuOpen] = useState(false);
  const [upgradeTip, setUpgradeTip] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Impersonation: detect if current user's role is student but originally admin
  // We store original_admin_id in localStorage during impersonation
  const [isImpersonating, setIsImpersonating] = useState(false);
  useEffect(() => {
    const orig = localStorage.getItem('impersonate_origin');
    setIsImpersonating(!!orig);
  }, [session]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const initials = session?.user?.name
    ?.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) ?? '?';

  const role = (session?.user as any)?.role || 'student';
  const isPending = role === 'pending_counselor' || role === 'rejected';

  // Nav items
  const allNavItems = [
    { href: '/dashboard',        icon: 'fa-th-large',         title: 'Dashboard',               roles: ['student'], requiresPro: false },
    { href: '/colleges',         icon: 'fa-building-columns', title: 'Explore Colleges',         roles: ['student'], requiresPro: true  },
    { href: '/essays',           icon: 'fa-pen-nib',          title: 'Essay Studio',             roles: ['student'], requiresPro: true  },
    { href: '/counselor',        icon: 'fa-file-lines',        title: 'School Counselor Report',  roles: ['student'], requiresPro: true  },
    { href: '/dates',            icon: 'fa-calendar-alt',     title: 'Key Dates & News',         roles: ['student'], requiresPro: false },
    { href: '/essay-lab',        icon: 'fa-flask',            title: 'Essay Lab',                roles: ['student'], requiresPro: false },
    { href: '/admin',            icon: 'fa-shield-halved',    title: 'Admin Console',            roles: ['admin'],   requiresPro: false },
    { href: '/expert-sessions',  icon: 'fa-gem',              title: 'Expert Sessions',          roles: ['student'], requiresPro: false, groupCoach: true },
    { href: '/expert-portal',    icon: 'fa-graduation-cap',   title: 'Expert Portal',            roles: ['counselor'], requiresPro: false },
  ];

  const navItems = isPending ? [] : allNavItems.filter(item => item.roles.includes(role));
  const settingsPath = role === 'counselor' ? '/settings/counselor' : '/settings';
  const popupItems = [
    { label: 'Settings',      icon: 'fa-gear',               action: () => { setMenuOpen(false); router.push(settingsPath); },    roles: ['student', 'counselor', 'admin'] },
    { label: 'Help & FAQ',    icon: 'fa-circle-question',    action: () => { setMenuOpen(false); router.push('/help'); },         roles: ['student', 'counselor', 'admin'] },
    { label: 'Essay Review',  icon: 'fa-magnifying-glass',   action: () => { setMenuOpen(false); router.push('/score'); },        roles: ['student'] },
    { label: 'Admin Console', icon: 'fa-shield-halved',      action: () => { setMenuOpen(false); router.push('/admin'); },        roles: ['admin'] },
  ].filter(item => item.roles.includes(role));

  return (
    <aside style={{
      width: 58, background: 'var(--card)', borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '18px 0', gap: 8, position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 50,
    }}>
      {/* Impersonation banner */}
      {isImpersonating && (
        <div style={{position:'absolute',top:0,left:0,right:0,background:'#f59e0b',padding:'3px 0',display:'flex',alignItems:'center',justifyContent:'center',gap:4,zIndex:100}}>
          <i className="fas fa-user-secret" style={{fontSize:9,color:'#000'}}></i>
          <span style={{fontSize:8,fontWeight:900,color:'#000',letterSpacing:'.3px'}}>IMPERSONATING</span>
        </div>
      )}

      {/* Logo */}
      <div style={{ width: 36, height: 36, marginBottom: 18, marginTop: isImpersonating ? 14 : 0 }}>
        <img src="/raven-logo.svg" alt="Admitly" width={36} height={36} style={{ borderRadius: 8 }} />
      </div>

      {/* Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {navItems.filter((item: any) => !item.groupCoach).map((item: any) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/') || (item.href === '/dashboard' && pathname === '/');
          const locked = item.requiresPro && !isPaid && role === 'student';
          return (
            <div key={item.href} style={{position:'relative'}}
              onMouseEnter={() => locked && setUpgradeTip(item.href)}
              onMouseLeave={() => setUpgradeTip(false)}>
              <Link href={item.href} title={item.title} style={{
                width: 42, height: 42, borderRadius: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: locked ? 'var(--stone-300)' : (active ? '#fff' : 'var(--stone-400)'),
                background: active && !locked ? 'var(--stone-900)' : 'transparent',
                textDecoration: 'none', fontSize: 17, transition: 'all .15s', position: 'relative',
              }}
              onMouseEnter={e => { if (!active && !locked) { (e.currentTarget as HTMLElement).style.background = 'var(--stone-50)'; (e.currentTarget as HTMLElement).style.color = 'var(--stone-600)'; } }}
              onMouseLeave={e => { if (!active && !locked) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--stone-400)'; } }}
              >
                <i className={`fas ${item.icon}`}></i>
                {locked && (
                  <div style={{position:'absolute',bottom:2,right:2,width:14,height:14,borderRadius:'50%',background:'var(--stone-900)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <i className="fas fa-lock" style={{fontSize:6,color:'#fff'}}></i>
                  </div>
                )}
              </Link>
              {/* Upgrade tooltip */}
              {locked && upgradeTip === item.href && (
                <div style={{position:'absolute',left:52,top:'50%',transform:'translateY(-50%)',background:'var(--stone-900)',color:'#fff',padding:'10px 14px',borderRadius:10,fontSize:11,fontWeight:600,whiteSpace:'nowrap',zIndex:100,boxShadow:'0 8px 24px rgba(0,0,0,.15)',lineHeight:1.5,maxWidth:200}}>
                  <div style={{fontWeight:800,marginBottom:4}}>Pro Feature</div>
                  <div style={{color:'rgba(255,255,255,.6)',whiteSpace:'normal'}}>{item.title} requires Admitly Pro.</div>
                  <div style={{marginTop:8}}>
                    <span onClick={()=>router.push('/subscribe')} style={{color:'var(--yellow)',fontWeight:800,cursor:'pointer',fontSize:11}}>Upgrade →</span>
                  </div>
                  <div style={{position:'absolute',left:-5,top:'50%',transform:'translateY(-50%)',width:0,height:0,borderTop:'6px solid transparent',borderBottom:'6px solid transparent',borderRight:'6px solid var(--stone-900)'}}></div>
                </div>
              )}
            </div>
          );
        })}

      </nav>

      {/* Bottom — Expert Sessions (Premium) + Avatar with popup menu.
          Expert Sessions used to live inside the main nav with a solid
          yellow background, which made it look perpetually "selected".
          Moved here next to the avatar so it reads as a separate
          premium-only utility, with a small gold dot accent instead of
          the loud background to signal its tier without competing for
          attention with the active-page indicator. */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }} ref={menuRef}>

        {/* Expert Sessions — only visible after Pro/Premium purchase */}
        {isPaid && navItems.some((item: any) => item.groupCoach) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--border-light)', width: 42 }}>
            {navItems.filter((item: any) => item.groupCoach).map((item: any) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/') || pathname.startsWith('/expert-portal');
              return (
                <Link key={item.href} href={item.href} title={`${item.title} (Premium)`} style={{
                  position: 'relative',
                  width: 42, height: 42, borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: active ? '#fff' : 'var(--stone-400)',
                  background: active ? 'var(--stone-900)' : 'transparent',
                  textDecoration: 'none', fontSize: 17, transition: 'all .15s',
                }}
                onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'var(--stone-50)'; (e.currentTarget as HTMLElement).style.color = 'var(--stone-600)'; } }}
                onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = 'var(--stone-400)'; } }}
                >
                  <i className={`fas ${item.icon}`}></i>
                  {/* Subtle premium accent — small gold dot in the
                      corner. Reads as "this is the special one" without
                      shouting like the old yellow background did. */}
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#FFE500', boxShadow: '0 0 0 1.5px var(--card)',
                  }}></span>
                </Link>
              );
            })}
          </div>
        )}


        {/* Avatar with popup */}
        <div style={{ position: 'relative' }}>
          {menuOpen && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
              width: 210, background: '#fff', borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,.12)',
              border: '1px solid var(--border)', overflow: 'hidden', zIndex: 100,
            }}>
              <div style={{ padding: '12px 16px', background: 'var(--stone-50)', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: '#FFE500', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12 }}>{initials}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--stone-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session?.user?.name ?? 'User'}</div>
                    <div style={{ fontSize: 10, color: 'var(--stone-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session?.user?.email ?? ''}</div>
                  </div>
                </div>
              </div>
              {popupItems.map(item => (
                <button key={item.label} onClick={item.action} style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                  fontSize: 13, fontWeight: 700, color: 'var(--stone-700)', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--stone-50)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <i className={`fas ${item.icon}`} style={{ color: 'var(--stone-400)', fontSize: 12, width: 14 }}></i>
                  {item.label}
                </button>
              ))}
              <div style={{ borderTop: '1px solid var(--border-light)', margin: '4px 0' }}></div>
              <button onClick={() => { setMenuOpen(false); signOut({ callbackUrl: '/login' }); }} style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
                fontSize: 13, fontWeight: 700, color: 'var(--red)', background: 'none', border: 'none',
                cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--red-light)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                <i className="fas fa-right-from-bracket" style={{ fontSize: 12, width: 14 }}></i>
                Sign Out
              </button>
            </div>
          )}
          <button onClick={() => setMenuOpen(p => !p)} style={{
            width: 36, height: 36, borderRadius: '50%', background: '#FFE500',
            color: 'var(--stone-900)', fontWeight: 800, fontSize: 12, border: 'none',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{initials}</button>
        </div>
      </div>
    </aside>
  );
}
