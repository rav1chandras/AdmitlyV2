'use client';
import { useEffect, useState, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { useProCheck } from '@/lib/useProCheck';

interface Deadline { id:number; college_name:string; deadline_type:string; due_date:string; description:string; status:string; notes:string; source:string; }
interface KeyDate { id:number; category:string; title:string; description:string|null; event_date:string; }

const TYPE_CFG: Record<string,{icon:string;bg:string;color:string}> = {
  ED:{icon:'fa-bolt',bg:'#fef2f2',color:'#dc2626'},ED2:{icon:'fa-bolt',bg:'#fef2f2',color:'#dc2626'},
  EA:{icon:'fa-paper-plane',bg:'#eff6ff',color:'#2563eb'},REA:{icon:'fa-shield-halved',bg:'#f5f3ff',color:'#7c3aed'},
  RD:{icon:'fa-file-lines',bg:'#fefce8',color:'#ca8a04'},Rolling:{icon:'fa-arrows-rotate',bg:'#ecfdf5',color:'#059669'},
  FAFSA:{icon:'fa-dollar-sign',bg:'#ecfdf5',color:'#059669'},CSS:{icon:'fa-dollar-sign',bg:'#ecfdf5',color:'#059669'},
  SAT:{icon:'fa-pencil',bg:'#fef2f2',color:'#dc2626'},ACT:{icon:'fa-pencil',bg:'#eff6ff',color:'#2563eb'},
  AP:{icon:'fa-graduation-cap',bg:'#f5f3ff',color:'#7c3aed'},
  Scholarship:{icon:'fa-trophy',bg:'#fefce8',color:'#ca8a04'},Custom:{icon:'fa-pen',bg:'#f5f3ff',color:'#7c3aed'},
};
const CAT_CFG: Record<string,{icon:string;label:string;bg:string;color:string}> = {
  SAT:{icon:'fa-pencil',label:'SAT',bg:'#fef2f2',color:'#dc2626'},
  ACT:{icon:'fa-pencil',label:'ACT',bg:'#eff6ff',color:'#2563eb'},
  AP:{icon:'fa-graduation-cap',label:'AP Exams',bg:'#f5f3ff',color:'#7c3aed'},
  Aid:{icon:'fa-dollar-sign',label:'Financial Aid',bg:'#ecfdf5',color:'#059669'},
  Schools:{icon:'fa-university',label:'School Deadlines',bg:'#fefce8',color:'#ca8a04'},
  Other:{icon:'fa-star',label:'Other',bg:'#f5f5f4',color:'#78716c'},
};
const gtc = (t:string) => TYPE_CFG[t]||TYPE_CFG.Custom;
const DASH_NAVY = '#06245B';
const SITE_YELLOW = '#FFE500';
function parseD(ds:string):Date{return new Date(ds.includes('T')?ds:ds+'T12:00:00');}
function daysU(ds:string):number{const t=new Date();t.setHours(0,0,0,0);return Math.ceil((parseD(ds).getTime()-t.getTime())/86400000);}
function fD(ds:string):string{return parseD(ds).toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function fDF(ds:string):string{return parseD(ds).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});}
function mL(ds:string):string{return parseD(ds).toLocaleDateString('en-US',{month:'long',year:'numeric'});}
function urg(d:number):{border:string;text:string;label:string}{
  if(d<0)return{border:'#a8a29e',text:'#78716c',label:'Past'};
  if(d===0)return{border:'#dc2626',text:'#dc2626',label:'Today'};
  if(d<=7)return{border:'#dc2626',text:'#dc2626',label:`${d}d`};
  if(d<=21)return{border:'#f59e0b',text:'#b45309',label:`${d}d`};
  if(d<=60)return{border:'#2563eb',text:'#2563eb',label:`${d}d`};
  return{border:'#10b981',text:'#059669',label:`${d}d`};
}
const ss=(o:React.CSSProperties)=>o;
function getCatBucket(d:Deadline):string {
  const t = d.deadline_type.toUpperCase();
  if (t==='SAT') return 'SAT'; if (t==='ACT') return 'ACT'; if (t==='AP') return 'AP';
  if (t==='FAFSA'||t==='CSS') return 'Aid';
  if (['ED','ED2','EA','REA','RD','ROLLING'].includes(t)) return 'Schools';
  return 'Other';
}

function StatTile({ icon, label, value, sub, tone }: { icon: string; label: string; value: string; sub: string; tone: string }) {
  return (
    <div style={ss({ border: '1px solid #dbe7f8', borderRadius: 14, background: '#fff', padding: '12px 13px', display: 'grid', gridTemplateColumns: '34px 1fr', gap: 10, alignItems: 'center', boxShadow: '0 8px 22px rgba(6,36,91,.04)' })}>
      <div style={ss({ width: 34, height: 34, borderRadius: 11, background: `${tone}16`, color: tone, display: 'grid', placeItems: 'center', fontSize: 13 })}>
        <i className={`fas ${icon}`}></i>
      </div>
      <div style={ss({ minWidth: 0 })}>
        <div style={ss({ color: 'var(--stone-500)', fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '.35px' })}>{label}</div>
        <div style={ss({ color: DASH_NAVY, fontSize: 18, fontWeight: 950, lineHeight: 1.05, marginTop: 2 })}>{value}</div>
        <div style={ss({ color: 'var(--stone-400)', fontSize: 10, fontWeight: 750, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}>{sub}</div>
      </div>
    </div>
  );
}

export default function DatesPage(){
  const router = useRouter();
  const { isPaid } = useProCheck();
  const [deadlines,setDL]=useState<Deadline[]>([]);
  const [keyDates,setKD]=useState<KeyDate[]>([]);
  const [loading,setL]=useState(true);
  const [view,setV]=useState<'timeline'|'category'|'mydates'>('timeline');
  const [showForm,setSF]=useState(false);
  const [checkoutLoading,setCheckoutLoading]=useState(false);
  const [fC,setFC]=useState('');const [fT,setFT]=useState('Custom');const [fD2,setFD2]=useState('');const [fDesc,setFDesc]=useState('');
  const pathname = usePathname();

  const fetchData = useCallback(() => {
    setL(true);
    Promise.all([
      fetch('/api/deadlines',{cache:'no-store'}).then(r=>r.ok?r.json():[]).then(d=>Array.isArray(d)?d:[]).catch(()=>[]),
      fetch('/api/dates',{cache:'no-store'}).then(r=>r.ok?r.json():[]).then(d=>Array.isArray(d)?d:[]).catch(()=>[]),
    ]).then(([dl,kd])=>{setDL(dl);setKD(kd);setL(false);});
  }, []);
  useEffect(()=>{fetchData();},[pathname, fetchData]);
  useEffect(() => { const f=()=>fetchData(); window.addEventListener('focus',f); return ()=>window.removeEventListener('focus',f); }, [fetchData]);

  // ── Which admin dates have been saved by this student ──
  const savedAdminKeys = new Set(deadlines.filter(d=>d.source==='admin_saved').map(d=>`${d.college_name}|${d.due_date}`));

  // Save a regular deadline to My Dates
  const saveDate=async(id:number)=>{setDL(p=>p.map(d=>d.id===id?{...d,status:'saved'}:d));await fetch('/api/deadlines',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:'saved'})});};

  // Save an admin date — creates a new student_deadline row
  const saveAdminDate=async(d:Deadline)=>{
    const key=`${d.college_name}|${d.due_date}`;
    if(savedAdminKeys.has(key))return;
    const r=await fetch('/api/deadlines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      college_name:d.college_name,deadline_type:d.deadline_type,due_date:d.due_date,description:d.description,status:'saved',source:'admin_saved'
    })});
    if(r.ok){const nd=await r.json();setDL(p=>[...p,nd]);}
  };

  // Toggle completed in My Dates
  const toggleComplete=async(id:number,cur:string)=>{const n=cur==='completed'?'saved':'completed';setDL(p=>p.map(d=>d.id===id?{...d,status:n}:d));await fetch('/api/deadlines',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status:n})});};

  // Remove from My Dates
  const removeDate=async(id:number)=>{setDL(p=>p.filter(d=>d.id!==id));await fetch(`/api/deadlines?id=${id}`,{method:'DELETE'});};

  // Add custom date (goes directly to My Dates)
  const addC=async()=>{if(!fD2)return;const r=await fetch('/api/deadlines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({college_name:fC||'Custom',deadline_type:fT,due_date:fD2,description:fDesc,status:'saved'})});if(r.ok){const d=await r.json();setDL(p=>[...p,d]);}setSF(false);setFC('');setFT('Custom');setFD2('');setFDesc('');};
  const startProCheckout=async()=>{
    setCheckoutLoading(true);
    try{
      const r=await fetch('/api/stripe/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({plan_id:'pro_onetime'})});
      const d=await r.json().catch(()=>({}));
      if(d?.url) window.location.href=d.url;
      else router.push('/colleges');
    }catch{router.push('/colleges');}
    finally{setCheckoutLoading(false);}
  };

  // ── Derived data ──
  const adminAsDeadlines: Deadline[] = keyDates.map(kd=>({
    id:kd.id+100000, college_name:kd.title,
    deadline_type:kd.category==='sat'||kd.category==='act'?kd.category.toUpperCase():kd.category==='fafsa'?'FAFSA':kd.category==='ap'?'AP':kd.category==='css'?'CSS':kd.category==='app_deadline'?'RD':'Custom',
    due_date:kd.event_date, description:kd.description||'', status:'upcoming', notes:'', source:'admin',
  }));
  // All deadlines for Timeline + Category (including saved/completed — they show with check icon)
  const allUp = [...deadlines,...adminAsDeadlines].sort((a,b)=>a.due_date.localeCompare(b.due_date));

  // My Dates: only college-specific school deadlines (auto, not universal) + explicitly saved + custom + admin_saved. Completed at bottom.
  const isCollegeDate = (d:Deadline) => d.source==='auto' && d.college_name!=='ALL';
  const myAll = deadlines.filter(d=>isCollegeDate(d)||d.status==='saved'||d.status==='completed'||d.source==='custom'||d.source==='admin_saved');
  const myDatesDeduped = myAll.filter((d,i,arr)=>arr.findIndex(x=>x.id===d.id)===i);
  const myDates = [...myDatesDeduped.filter(d=>d.status!=='completed').sort((a,b)=>a.due_date.localeCompare(b.due_date)),...myDatesDeduped.filter(d=>d.status==='completed').sort((a,b)=>a.due_date.localeCompare(b.due_date))];
  const myCompleted = myDates.filter(d=>d.status==='completed').length;
  const upcoming = allUp.filter(d=>daysU(d.due_date)>=0);
  const nextDeadline = upcoming[0];
  const urgentCount = upcoming.filter(d=>daysU(d.due_date)<=21).length;
  const savedCount = myDates.length;

  // Timeline months
  const months:Record<string,Deadline[]>={};upcoming.forEach(d=>{const m=mL(d.due_date);if(!months[m])months[m]=[];months[m].push(d);});
  // Category groups
  const categories:Record<string,Deadline[]>={};upcoming.forEach(d=>{const cat=getCatBucket(d);if(!categories[cat])categories[cat]=[];categories[cat].push(d);});
  const catOrder = ['SAT','ACT','AP','Aid','Schools','Other'];

  // ── Render a single card ──
  const renderCard = (d:Deadline, mode:'browse'|'mydates') => {
    const days=daysU(d.due_date); const u=urg(days); const c=gtc(d.deadline_type);
    const isAdmin=d.source==='admin';
    const isCompleted=d.status==='completed';
    const isSaved = d.status==='saved' || d.status==='completed' || (d.source==='auto'&&d.college_name!=='ALL') || d.source==='admin_saved' ||
      (isAdmin && savedAdminKeys.has(`${d.college_name}|${d.due_date}`));

    if (mode === 'mydates') {
      return (
        <div key={d.id} style={ss({background:'#fff',border:'1px solid #e4eaf3',borderRadius:14,padding:12,marginBottom:10,opacity:isCompleted?.62:1,boxShadow:'0 8px 20px rgba(15,23,42,.04)'})}>
          <div style={ss({display:'grid',gridTemplateColumns:'38px minmax(0,1fr) auto',gap:10,alignItems:'center'})}>
            <div style={ss({width:36,height:36,borderRadius:11,background:c.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
              <i className={`fas ${c.icon}`} style={{fontSize:12,color:c.color}}></i>
            </div>
            <div style={ss({minWidth:0})}>
              <div style={ss({display:'flex',alignItems:'center',gap:6,minWidth:0})}>
                <span style={ss({fontSize:12,fontWeight:900,color:DASH_NAVY,textDecoration:isCompleted?'line-through':'none',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}>{d.college_name==='ALL'?d.description:d.college_name}</span>
                <span style={ss({fontSize:8,fontWeight:800,padding:'2px 6px',borderRadius:20,background:c.bg,color:c.color,flexShrink:0})}>{d.deadline_type}</span>
              </div>
              <div style={ss({fontSize:10,color:'var(--stone-500)',fontWeight:700,marginTop:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}>{fDF(d.due_date)}</div>
            </div>
            <div style={ss({textAlign:'right'})}>
              <div style={ss({fontSize:12,fontWeight:950,color:u.text})}>{u.label}</div>
              <div style={ss({fontSize:9,color:'var(--stone-400)',fontWeight:750,marginTop:2})}>{fD(d.due_date)}</div>
            </div>
          </div>
          <div style={ss({display:'flex',justifyContent:'flex-end',gap:7,alignItems:'center',marginTop:10})}>
            <button onClick={()=>toggleComplete(d.id,d.status)} title={isCompleted?'Mark incomplete':'Mark complete'} style={ss({height:30,borderRadius:10,border:'1px solid #dbe7f8',background:isCompleted?'#e8f7f1':'#fff',color:isCompleted?'#0F8B63':DASH_NAVY,fontFamily:'inherit',fontSize:10,fontWeight:900,cursor:'pointer',padding:'0 10px',display:'inline-flex',alignItems:'center',gap:6})}><i className={`fas ${isCompleted?'fa-check':'fa-circle-check'}`} style={{fontSize:10}}></i>{isCompleted?'Done':'Mark done'}</button>
            <button onClick={()=>removeDate(d.id)} title="Remove" style={ss({width:30,height:30,borderRadius:10,border:'1px solid #e4eaf3',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--stone-400)',fontSize:9,fontFamily:'inherit',flexShrink:0})}>
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>
      );
    }

    return (
      <div key={d.id} style={ss({background:'var(--card)',border:'1px solid #e4eaf3',borderRadius:14,padding:'13px 15px',marginBottom:10,display:'grid',gridTemplateColumns:'42px minmax(0,1fr) 112px 148px',alignItems:'center',gap:14,opacity:isCompleted?.6:1,boxShadow:'0 10px 24px rgba(15,23,42,.05)'})}>
        {/* Category icon */}
        <div style={ss({width:38,height:38,borderRadius:11,background:c.bg,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0})}>
          <i className={`fas ${c.icon}`} style={{fontSize:12,color:c.color}}></i>
        </div>

        <div style={ss({flex:1,minWidth:0})}>
          <div style={ss({display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'})}>
            <span style={ss({fontSize:13,fontWeight:850,color:DASH_NAVY,textDecoration:isCompleted?'line-through':'none'})}>{d.college_name==='ALL'?d.description:d.college_name}</span>
            <span style={ss({fontSize:8,fontWeight:700,padding:'2px 7px',borderRadius:20,background:c.bg,color:c.color})}>{d.deadline_type}</span>
            {d.source==='custom'&&<span style={ss({fontSize:8,fontWeight:700,padding:'2px 7px',borderRadius:20,background:'#f5f3ff',color:'#7c3aed'})}>Custom</span>}
          </div>
          <div style={ss({fontSize:11,color:'var(--stone-500)',fontWeight:650,marginTop:3})}>{fDF(d.due_date)}{d.college_name!=='ALL'&&d.description?` · ${d.description}`:''}</div>
        </div>

        <div style={ss({textAlign:'right',flexShrink:0})}>
          <div style={ss({fontSize:14,fontWeight:950,color:u.text})}>{u.label}</div>
          <div style={ss({fontSize:9,color:'var(--stone-400)',fontWeight:750,marginTop:2})}>{fD(d.due_date)}</div>
        </div>

        {mode==='browse' ? (
          isSaved ? (
            <button disabled title="Already in My Dates" style={ss({height:34,borderRadius:10,border:'1px solid #bfe8d8',background:'#e8f7f1',color:'#0F8B63',fontFamily:'inherit',fontSize:11,fontWeight:900,display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6})}><i className="fas fa-check" style={{fontSize:10}}></i>Added</button>
          ) : (
            <button onClick={()=>isAdmin?saveAdminDate(d):saveDate(d.id)} title="Add to My Dates" style={ss({height:34,borderRadius:10,border:'1px solid #dbe7f8',background:'#fff',color:DASH_NAVY,fontFamily:'inherit',fontSize:11,fontWeight:900,cursor:'pointer',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:6})}><i className="fas fa-plus" style={{fontSize:10}}></i>Add to My Dates</button>
          )
        ) : (
          <div style={ss({display:'flex',justifyContent:'flex-end',gap:7,alignItems:'center'})}>
            <button onClick={()=>toggleComplete(d.id,d.status)} title={isCompleted?'Mark incomplete':'Mark complete'} style={ss({height:32,borderRadius:10,border:'1px solid #dbe7f8',background:isCompleted?'#e8f7f1':'#fff',color:isCompleted?'#0F8B63':DASH_NAVY,fontFamily:'inherit',fontSize:11,fontWeight:900,cursor:'pointer',padding:'0 10px',display:'inline-flex',alignItems:'center',gap:6})}><i className={`fas ${isCompleted?'fa-check':'fa-circle-check'}`} style={{fontSize:10}}></i>{isCompleted?'Done':'Mark done'}</button>
            <button onClick={()=>removeDate(d.id)} title="Remove" style={ss({width:32,height:32,borderRadius:10,border:'1px solid #e4eaf3',background:'var(--card)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--stone-400)',fontSize:9,fontFamily:'inherit',flexShrink:0})}>
              <i className="fas fa-times"></i>
            </button>
          </div>
        )}
      </div>
    );
  };

  return(<AppShell><div style={ss({flex:1,overflowY:'auto',padding:'28px 36px 60px',background:'linear-gradient(180deg,#f8fbff 0%,#fff 42%)'})}>
    {/* Hero */}
    <section style={ss({border:'1px solid #dbe7f8',borderRadius:20,padding:22,marginBottom:16,background:'radial-gradient(circle at 96% 8%, rgba(255,229,0,.28), transparent 18%), radial-gradient(circle at 4% 100%, rgba(6,36,91,.08), transparent 28%), linear-gradient(135deg,#fff,#eef5ff)',boxShadow:'0 18px 44px rgba(6,36,91,.07)'})}>
      <div style={ss({display:'grid',gridTemplateColumns:'minmax(0,1fr) 310px',gap:18,alignItems:'stretch'})}>
        <div>
          <h1 style={ss({fontSize:30,lineHeight:1.06,fontWeight:950,letterSpacing:'-0.4px',color:DASH_NAVY,margin:'0 0 7px'})}>Dates & deadlines</h1>
          <div style={ss({fontSize:13,lineHeight:1.55,fontWeight:650,color:'var(--stone-500)',maxWidth:620})}>Track application milestones, test dates, financial aid windows, and custom reminders in one place.</div>
          <div style={ss({display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10,marginTop:18,maxWidth:650})}>
            <StatTile icon="fa-hourglass-half" label="Next due" value={nextDeadline?`${urg(daysU(nextDeadline.due_date)).label}`:'--'} sub={nextDeadline?fD(nextDeadline.due_date):'No dates yet'} tone="#2563eb" />
            <StatTile icon="fa-bell" label="Need attention" value={String(urgentCount)} sub="Within 21 days" tone="#dc2626" />
            <StatTile icon="fa-bookmark" label="My Dates" value={String(savedCount)} sub={`${myCompleted} completed`} tone="#0F8B63" />
          </div>
        </div>
        <aside style={ss({border:'1px solid rgba(6,36,91,.1)',borderRadius:16,background:'#fff',padding:16,display:'flex',flexDirection:'column',justifyContent:'space-between',boxShadow:'0 12px 30px rgba(6,36,91,.06)'})}>
          <div>
            <div style={ss({width:38,height:38,borderRadius:12,display:'grid',placeItems:'center',background:SITE_YELLOW,color:DASH_NAVY,fontSize:15,marginBottom:12})}><i className="fas fa-unlock-keyhole"></i></div>
            <div style={ss({fontSize:16,fontWeight:950,color:DASH_NAVY,lineHeight:1.15})}>{isPaid?'Pro tools are active':'Upgrade when deadlines get real'}</div>
            <div style={ss({fontSize:12,lineHeight:1.55,fontWeight:650,color:'var(--stone-500)',marginTop:7})}>{isPaid?'Use college matching, essay studio, and counselor reports alongside this tracker.':'Pro unlocks college matching, Essay Studio, and counselor-ready reports when your timeline starts filling up.'}</div>
          </div>
          <button onClick={isPaid?()=>router.push('/colleges'):startProCheckout} disabled={checkoutLoading} style={ss({height:40,borderRadius:12,border:'none',background:DASH_NAVY,color:'#fff',fontFamily:'inherit',fontSize:12,fontWeight:900,cursor:checkoutLoading?'wait':'pointer',marginTop:14})}>{checkoutLoading?'Opening...':isPaid?'Explore colleges':'Unlock Pro'}</button>
        </aside>
      </div>
    </section>

    {loading&&<div style={ss({textAlign:'center',padding:'60px 0',color:'var(--stone-400)'})}><i className="fas fa-spinner fa-spin" style={{fontSize:20,marginBottom:8,display:'block'}}></i><div style={{fontSize:13,fontWeight:600}}>Loading deadlines…</div></div>}

    {!loading&&<div style={ss({display:'grid',gridTemplateColumns:'minmax(0,3fr) minmax(340px,2fr)',gap:18,alignItems:'start'})}>
      <section style={ss({minWidth:0})}>
        <div style={ss({background:'#fff',border:'1px solid #e4eaf3',borderRadius:18,padding:18,boxShadow:'0 12px 30px rgba(15,23,42,.045)'})}>
          <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:14})}>
            <div>
              <div style={ss({fontSize:16,fontWeight:950,color:DASH_NAVY,lineHeight:1.15})}>All key dates</div>
              <div style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)',marginTop:3})}>Browse deadlines and add the ones that matter to your plan.</div>
            </div>
            <span style={ss({height:28,padding:'0 10px',borderRadius:999,background:'#eef5ff',color:DASH_NAVY,fontSize:11,fontWeight:900,display:'inline-flex',alignItems:'center'})}>{upcoming.length} upcoming</span>
          </div>
          {Object.keys(months).length===0&&<div style={ss({textAlign:'center',padding:'60px 0',color:'var(--stone-300)'})}><i className="fas fa-calendar" style={{fontSize:32,display:'block',marginBottom:10,opacity:.3}}></i><div style={{fontSize:14,fontWeight:700}}>No upcoming deadlines</div><div style={{fontSize:12,color:'var(--stone-400)',marginTop:4}}>Add colleges to your list to auto-populate deadlines</div></div>}
          {Object.entries(months).map(([month,items])=>(<div key={month} style={ss({marginBottom:20})}>
            <div style={ss({fontSize:11,fontWeight:900,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'1px',marginBottom:10,display:'flex',alignItems:'center',gap:8})}>{month}<span style={ss({fontSize:9,fontWeight:700,color:'var(--stone-300)'})}>{items.length}</span><div style={ss({flex:1,height:1,background:'var(--border)'})}></div></div>
            {items.map(d=>renderCard(d,'browse'))}
          </div>))}
        </div>
      </section>

      <aside style={ss({position:'sticky',top:18,minWidth:0})}>
        <div style={ss({background:'#fff',border:'1px solid #e4eaf3',borderRadius:18,padding:18,boxShadow:'0 12px 30px rgba(15,23,42,.055)'})}>
          <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:14})}>
            <div>
              <div style={ss({fontSize:16,fontWeight:950,color:DASH_NAVY,lineHeight:1.15})}>My Dates</div>
              <div style={ss({fontSize:11,fontWeight:700,color:'var(--stone-400)',marginTop:3})}>Saved deadlines and custom reminders.</div>
            </div>
            <button onClick={()=>setSF(!showForm)} style={ss({height:32,padding:'0 12px',borderRadius:10,border:'1px solid #dbe7f8',background:showForm?DASH_NAVY:'#fff',fontSize:11,fontWeight:900,cursor:'pointer',fontFamily:'inherit',color:showForm?'#fff':DASH_NAVY})}>{showForm?'Cancel':'+ Custom'}</button>
          </div>

          {showForm&&<div style={ss({background:'#f8fbff',border:'1px solid #e4eaf3',borderRadius:14,padding:14,marginBottom:14})}>
            <div style={ss({display:'grid',gridTemplateColumns:'1fr 110px',gap:9,marginBottom:9})}>
              <div><div style={ss({fontSize:10,fontWeight:850,color:'var(--stone-400)',marginBottom:4})}>School / Label</div><input value={fC} onChange={e=>setFC(e.target.value)} placeholder="e.g. Stanford" style={ss({width:'100%',padding:'8px 10px',border:'1px solid #dbe7f8',borderRadius:9,fontSize:12,fontFamily:'inherit',outline:'none',boxSizing:'border-box' as const})}/></div>
              <div><div style={ss({fontSize:10,fontWeight:850,color:'var(--stone-400)',marginBottom:4})}>Type</div><select value={fT} onChange={e=>setFT(e.target.value)} style={ss({width:'100%',padding:'8px 10px',border:'1px solid #dbe7f8',borderRadius:9,fontSize:12,fontFamily:'inherit',outline:'none',boxSizing:'border-box' as const})}><option>Custom</option><option>ED</option><option>EA</option><option>RD</option><option>Scholarship</option><option>FAFSA</option><option>CSS</option></select></div>
            </div>
            <div style={ss({marginBottom:9})}><div style={ss({fontSize:10,fontWeight:850,color:'var(--stone-400)',marginBottom:4})}>Due date</div><input type="date" value={fD2} onChange={e=>setFD2(e.target.value)} style={ss({width:'100%',padding:'8px 10px',border:'1px solid #dbe7f8',borderRadius:9,fontSize:12,fontFamily:'inherit',outline:'none',boxSizing:'border-box' as const})}/></div>
            <div style={ss({marginBottom:10})}><div style={ss({fontSize:10,fontWeight:850,color:'var(--stone-400)',marginBottom:4})}>Description</div><input value={fDesc} onChange={e=>setFDesc(e.target.value)} placeholder="e.g. Finish supplement draft" style={ss({width:'100%',padding:'8px 10px',border:'1px solid #dbe7f8',borderRadius:9,fontSize:12,fontFamily:'inherit',outline:'none',boxSizing:'border-box' as const})}/></div>
            <button onClick={addC} disabled={!fD2} style={ss({width:'100%',height:36,borderRadius:10,border:'none',background:fD2?DASH_NAVY:'var(--stone-200)',color:fD2?'#fff':'var(--stone-400)',fontSize:12,fontWeight:900,cursor:fD2?'pointer':'default',fontFamily:'inherit'})}>Add deadline</button>
          </div>}

          {myDates.length===0&&<div style={ss({textAlign:'center',padding:'42px 12px',color:'var(--stone-300)',border:'1px dashed #dbe7f8',borderRadius:14})}><i className="fas fa-bookmark" style={{fontSize:28,display:'block',marginBottom:10,opacity:.35}}></i><div style={{fontSize:14,fontWeight:800}}>No dates yet</div><div style={{fontSize:12,color:'var(--stone-400)',marginTop:4,lineHeight:1.45}}>Add deadlines from the left or create a custom reminder.</div></div>}
          {myDates.length>0&&<>
            <div style={ss({background:'#f8fbff',border:'1px solid #e4eaf3',borderRadius:14,padding:'12px 13px',marginBottom:14})}>
              <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:7})}>
                <span style={ss({fontSize:12,fontWeight:900,color:DASH_NAVY})}>{myCompleted} of {myDates.length} completed</span>
                <span style={ss({fontSize:11,fontWeight:850,color:myCompleted===myDates.length?'#059669':'var(--stone-400)'})}>{myDates.length>0?Math.round(myCompleted/myDates.length*100):0}%</span>
              </div>
              <div style={ss({height:7,background:'#e8eef7',borderRadius:99,overflow:'hidden'})}>
                <div style={ss({height:'100%',background:myCompleted===myDates.length?'#10b981':DASH_NAVY,borderRadius:99,transition:'width .3s',width:`${myDates.length>0?myCompleted/myDates.length*100:0}%`})}></div>
              </div>
            </div>
            {myDates.map(d=>renderCard(d,'mydates'))}
          </>}
        </div>
      </aside>
    </div>}
  </div></AppShell>);
}
