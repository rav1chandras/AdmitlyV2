'use client';
import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface UserResult { id:number; name:string; email:string; role:string; subscription_status:string; created_at:string; last_login:string|null; }
interface JourneyEvent { date:string; type:string; title:string; detail:string; icon:string; color:string; }

const ss = (o:React.CSSProperties) => o;

function fmtDate(s:string):string {
  return new Date(s).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
}
function fmtDateTime(s:string):string {
  return new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
}
function timeAgo(s:string):string {
  const d = Date.now() - new Date(s).getTime();
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d/60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d/3600000)}h ago`;
  if (d < 2592000000) return `${Math.floor(d/86400000)}d ago`;
  return fmtDate(s);
}

export default function JourneyPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all'|'student'|'counselor'>('all');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult|null>(null);
  const [events, setEvents] = useState<JourneyEvent[]>([]);
  const [loadingJourney, setLoadingJourney] = useState(false);

  // Auth check
  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/');
  }, [authStatus, router]);

  // Search users
  const doSearch = useCallback(async (q: string, role: string) => {
    if (q.length < 2) { setUsers([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/journey?search=${encodeURIComponent(q)}&role=${role}`);
      const data = await res.json();
      setUsers(data.users || []);
    } catch { setUsers([]); }
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => doSearch(search, roleFilter), 300);
    return () => clearTimeout(t);
  }, [search, roleFilter, doSearch]);

  // Load journey for selected user
  const loadJourney = async (user: UserResult) => {
    setSelectedUser(user);
    setLoadingJourney(true);
    try {
      const res = await fetch(`/api/admin/journey?user_id=${user.id}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch { setEvents([]); }
    setLoadingJourney(false);
  };

  if (authStatus === 'loading') return (
    <div style={ss({height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#fafaf9',fontFamily:"'DM Sans',sans-serif",color:'#a8a29e',fontSize:14})}>
      <i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i>Loading…
    </div>
  );

  const statusCfg: Record<string,{label:string;bg:string;color:string}> = {
    free:{label:'Free',bg:'#f5f5f4',color:'#78716c'},
    pro:{label:'Pro',bg:'#eff6ff',color:'#2563eb'},
    premium:{label:'Premium',bg:'#f5f3ff',color:'#7c3aed'},
  };

  // Group events by month
  const monthGroups: Record<string, JourneyEvent[]> = {};
  events.forEach(e => {
    const m = new Date(e.date).toLocaleDateString('en-US',{month:'long',year:'numeric'});
    if (!monthGroups[m]) monthGroups[m] = [];
    monthGroups[m].push(e);
  });

  return (
    <div style={ss({minHeight:'100vh',background:'#fafaf9',fontFamily:"'DM Sans',sans-serif"})}>
      {/* Top bar */}
      <div style={ss({background:'#1c1917',padding:'14px 28px',display:'flex',alignItems:'center',gap:14})}>
        <Link href="/admin" style={ss({width:32,height:32,borderRadius:8,background:'rgba(255,255,255,.08)',display:'flex',alignItems:'center',justifyContent:'center',textDecoration:'none',color:'#a8a29e',fontSize:12})}>
          <i className="fas fa-arrow-left"></i>
        </Link>
        <div style={ss({width:32,height:32,borderRadius:8,background:'#FFE500',display:'flex',alignItems:'center',justifyContent:'center'})}>
          <i className="fas fa-route" style={{fontSize:13,color:'#1c1917'}}></i>
        </div>
        <div>
          <div style={ss({fontSize:14,fontWeight:800,color:'#fff'})}>User Journey</div>
          <div style={ss({fontSize:10,color:'rgba(255,255,255,.4)',marginTop:1})}>Track every event in a student or counselor's lifecycle</div>
        </div>
      </div>

      <div style={ss({maxWidth:900,margin:'0 auto',padding:'28px 24px 60px'})}>
        {/* Search bar */}
        <div style={ss({background:'#fff',border:'1px solid #e7e5e4',borderRadius:14,padding:'18px 22px',marginBottom:20})}>
          <div style={ss({display:'flex',gap:10,alignItems:'center'})}>
            <div style={ss({flex:1,position:'relative'})}>
              <i className="fas fa-search" style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#a8a29e',fontSize:12,pointerEvents:'none'}}></i>
              <input value={search} onChange={e=>{setSearch(e.target.value);setSelectedUser(null);setEvents([]);}}
                placeholder="Search by name or email…"
                style={ss({width:'100%',padding:'10px 14px 10px 36px',border:'1px solid #e7e5e4',borderRadius:10,fontSize:13,fontFamily:'inherit',fontWeight:500,outline:'none',color:'#1c1917',boxSizing:'border-box'})} />
            </div>
            <div style={ss({display:'flex',background:'#f5f5f4',borderRadius:8,padding:3})}>
              {(['all','student','counselor'] as const).map(r => (
                <button key={r} onClick={()=>{setRoleFilter(r);setSelectedUser(null);setEvents([]);}}
                  style={ss({padding:'7px 14px',borderRadius:6,fontSize:11,fontWeight:700,border:'none',fontFamily:'inherit',cursor:'pointer',textTransform:'capitalize',
                    background:roleFilter===r?'#fff':'transparent',color:roleFilter===r?'#1c1917':'#a8a29e',
                    boxShadow:roleFilter===r?'0 1px 3px rgba(0,0,0,.06)':'none'})}>{r}</button>
              ))}
            </div>
          </div>

          {/* Search results */}
          {search.length >= 2 && !selectedUser && (
            <div style={ss({marginTop:12})}>
              {searching && <div style={ss({fontSize:12,color:'#a8a29e',padding:'8px 0'})}><i className="fas fa-spinner fa-spin" style={{marginRight:6}}></i>Searching…</div>}
              {!searching && users.length === 0 && <div style={ss({fontSize:12,color:'#a8a29e',padding:'8px 0'})}>No users found</div>}
              {!searching && users.map(u => {
                const sc = statusCfg[u.subscription_status] || statusCfg.free;
                return (
                  <div key={u.id} onClick={()=>loadJourney(u)}
                    style={ss({display:'flex',alignItems:'center',gap:12,padding:'10px 12px',borderRadius:10,cursor:'pointer',transition:'background .1s'})}
                    onMouseEnter={e=>(e.currentTarget.style.background='#f5f5f4')}
                    onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                    <div style={ss({width:36,height:36,borderRadius:9,background:u.role==='counselor'?'#eff6ff':'#f5f3ff',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,fontWeight:800,color:u.role==='counselor'?'#2563eb':'#7c3aed',flexShrink:0})}>
                      {(u.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={ss({flex:1,minWidth:0})}>
                      <div style={ss({fontSize:13,fontWeight:700,color:'#1c1917'})}>{u.name}</div>
                      <div style={ss({fontSize:10,color:'#a8a29e'})}>{u.email}</div>
                    </div>
                    <span style={ss({fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:6,textTransform:'capitalize',background:u.role==='counselor'?'#eff6ff':'#f5f5f4',color:u.role==='counselor'?'#2563eb':'#78716c'})}>{u.role}</span>
                    <span style={ss({fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:6,background:sc.bg,color:sc.color})}>{sc.label}</span>
                    <span style={ss({fontSize:10,color:'#a8a29e'})}>{u.last_login ? timeAgo(u.last_login) : 'never'}</span>
                    <i className="fas fa-chevron-right" style={{fontSize:9,color:'#d6d3d1'}}></i>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected user header */}
        {selectedUser && (
          <div style={ss({background:'#fff',border:'1px solid #e7e5e4',borderRadius:14,padding:'18px 22px',marginBottom:20,display:'flex',alignItems:'center',gap:14})}>
            <div style={ss({width:48,height:48,borderRadius:12,background:selectedUser.role==='counselor'?'#eff6ff':'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:900,color:selectedUser.role==='counselor'?'#2563eb':'#FFE500',flexShrink:0})}>
              {(selectedUser.name||'?')[0].toUpperCase()}
            </div>
            <div style={ss({flex:1})}>
              <div style={ss({fontSize:16,fontWeight:800,color:'#1c1917'})}>{selectedUser.name}</div>
              <div style={ss({fontSize:12,color:'#a8a29e',marginTop:1})}>{selectedUser.email}</div>
            </div>
            <div style={ss({display:'flex',gap:6,alignItems:'center'})}>
              <span style={ss({fontSize:10,fontWeight:700,padding:'4px 10px',borderRadius:8,textTransform:'capitalize',background:selectedUser.role==='counselor'?'#eff6ff':'#f5f5f4',color:selectedUser.role==='counselor'?'#2563eb':'#78716c'})}>{selectedUser.role}</span>
              {(()=>{const sc=statusCfg[selectedUser.subscription_status]||statusCfg.free;return <span style={ss({fontSize:10,fontWeight:700,padding:'4px 10px',borderRadius:8,background:sc.bg,color:sc.color})}>{sc.label}</span>;})()}
              <span style={ss({fontSize:10,color:'#a8a29e'})}>Joined {fmtDate(selectedUser.created_at)}</span>
            </div>
            <button onClick={()=>{setSelectedUser(null);setEvents([]);setSearch('');}}
              style={ss({width:30,height:30,borderRadius:8,border:'1px solid #e7e5e4',background:'#fff',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#a8a29e',fontSize:10,fontFamily:'inherit'})}>
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}

        {/* Timeline */}
        {loadingJourney && (
          <div style={ss({textAlign:'center',padding:'60px 0',color:'#a8a29e'})}>
            <i className="fas fa-spinner fa-spin" style={{fontSize:20,display:'block',marginBottom:10}}></i>
            <div style={{fontSize:13,fontWeight:600}}>Loading journey…</div>
          </div>
        )}

        {selectedUser && !loadingJourney && events.length === 0 && (
          <div style={ss({textAlign:'center',padding:'60px 0',color:'#d6d3d1'})}>
            <i className="fas fa-route" style={{fontSize:32,display:'block',marginBottom:10,opacity:.3}}></i>
            <div style={{fontSize:14,fontWeight:700,color:'#a8a29e'}}>No events yet</div>
            <div style={{fontSize:12,color:'#d6d3d1',marginTop:4}}>This user hasn't performed any trackable actions</div>
          </div>
        )}

        {selectedUser && !loadingJourney && events.length > 0 && (
          <div style={ss({position:'relative'})}>
            {/* Vertical line */}
            <div style={ss({position:'absolute',left:19,top:0,bottom:0,width:2,background:'#e7e5e4',zIndex:0})}></div>

            {Object.entries(monthGroups).map(([month, items]) => (
              <div key={month} style={ss({marginBottom:28})}>
                {/* Month label */}
                <div style={ss({display:'flex',alignItems:'center',gap:10,marginBottom:14,position:'relative',zIndex:1})}>
                  <div style={ss({width:40,height:24,borderRadius:6,background:'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:800,color:'#FFE500',letterSpacing:.5})}>{month.split(' ')[0].slice(0,3).toUpperCase()}</div>
                  <span style={ss({fontSize:11,fontWeight:700,color:'#a8a29e'})}>{month}</span>
                  <div style={ss({flex:1,height:1,background:'#e7e5e4'})}></div>
                  <span style={ss({fontSize:10,fontWeight:600,color:'#d6d3d1'})}>{items.length} event{items.length>1?'s':''}</span>
                </div>

                {/* Events */}
                {items.map((ev, i) => (
                  <div key={`${ev.date}-${i}`} style={ss({display:'flex',gap:14,marginBottom:12,position:'relative',zIndex:1})}>
                    {/* Icon dot */}
                    <div style={ss({width:40,display:'flex',justifyContent:'center',flexShrink:0})}>
                      <div style={ss({width:28,height:28,borderRadius:8,background:ev.color+'18',border:`2px solid ${ev.color}40`,display:'flex',alignItems:'center',justifyContent:'center'})}>
                        <i className={`fas ${ev.icon}`} style={{fontSize:10,color:ev.color}}></i>
                      </div>
                    </div>
                    {/* Content */}
                    <div style={ss({flex:1,background:'#fff',border:'1px solid #e7e5e4',borderRadius:10,padding:'11px 16px',minWidth:0})}>
                      <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:8})}>
                        <div style={ss({fontSize:13,fontWeight:700,color:'#1c1917'})}>{ev.title}</div>
                        <span style={ss({fontSize:9,fontWeight:600,color:'#a8a29e',flexShrink:0,whiteSpace:'nowrap'})}>{fmtDateTime(ev.date)}</span>
                      </div>
                      <div style={ss({fontSize:11,color:'#78716c',marginTop:3,lineHeight:1.5})}>{ev.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Empty state when no user selected */}
        {!selectedUser && !search && (
          <div style={ss({textAlign:'center',padding:'80px 0',color:'#d6d3d1'})}>
            <i className="fas fa-route" style={{fontSize:40,display:'block',marginBottom:14,opacity:.2}}></i>
            <div style={{fontSize:16,fontWeight:800,color:'#a8a29e'}}>User Journey</div>
            <div style={{fontSize:12,color:'#d6d3d1',marginTop:6,maxWidth:320,margin:'6px auto 0'}}>Search for a student or counselor above to view their complete activity timeline</div>
          </div>
        )}
      </div>
    </div>
  );
}
