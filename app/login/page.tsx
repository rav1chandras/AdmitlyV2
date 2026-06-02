'use client';
import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { passwordRuleChecklist, ALLOWED_EMAIL_DOMAINS, validateEmail, validatePassword } from '@/lib/auth-validation';

const DEMO_USERS = [
  { email:'student1@admitly.com', name:'Maya Patel', initials:'MP', bg:'#eff6ff', color:'#2563eb', label:'Student · Pro', sub:'GPA 3.4 · SAT 1420' },
  { email:'student2@admitly.com', name:'James Chen', initials:'JC', bg:'#f0fdfa', color:'#0d9488', label:'Student · Free', sub:'GPA 4.7 · SAT 1470' },
  { email:'counselor1@admitly.com', name:'Dr. Mitchell', initials:'SM', bg:'#fefce8', color:'#ca8a04', label:'Counselor', sub:'Yale · 12yr' },
  { email:'counselor2@admitly.com', name:'Dr. Kim', initials:'RK', bg:'#fdf4ff', color:'#a855f7', label:'Counselor', sub:'Stanford · 8yr' },
  { email:'admin@admitly.com', name:'Admin', initials:'AD', bg:'#f0fdf4', color:'#16a34a', label:'Admin', sub:'' },
];

const SLIDES = [
  { tag:'Feature 1 — College Match', title:'AI-powered college matching', desc:'See your real admission chances with personalized match scores based on GPA, test scores, and extracurriculars.' },
  { tag:'Feature 2 — Essay Coach', title:'Write essays that stand out', desc:'Draft, refine, and polish with an AI writing coach that learns your voice and style.' },
  { tag:'Feature 3 — Deadline Tracker', title:'Never miss a deadline again', desc:'A live calendar of every application deadline with smart alerts, completion checklists, and status tracking.' },
];

const ROLE_ICONS: Record<string,string> = {
  student: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>',
  counselor: '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  target: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  pen: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  clipboard: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  chat: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  dollar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  handshake: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#78716c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 17a4 4 0 0 0 8 0"/><path d="M5 7a4 4 0 0 1 8 0"/><path d="M2 12h20"/></svg>',
  default: '👤',
};

const ROLE_DATA: Record<string,{label:string;iconKey:string;title:string;desc:string;features:{iconKey:string;text:string}[];cardClass:string}> = {
  student: { label:'Student view', iconKey:'student', title:'Your personal command center', desc:'Track every school, deadline, and draft in one clean dashboard — built around your college list.',
    features:[{iconKey:'target',text:'College match scores ranked for you'},{iconKey:'pen',text:'AI essay coach with real-time feedback'},{iconKey:'calendar',text:'Smart deadline alerts & action items'},{iconKey:'handshake',text:'Counselor collaboration portal'}], cardClass:'student-active' },
  counselor: { label:'Counselor view', iconKey:'counselor', title:'Manage all your students in one place', desc:"See every student's progress at a glance — milestones, essays, and next steps — with zero manual tracking.",
    features:[{iconKey:'users',text:'Portfolio view across all students'},{iconKey:'clipboard',text:'Assign action items & share notes'},{iconKey:'chat',text:'In-app messaging & session logs'},{iconKey:'dollar',text:'Earnings dashboard & payment tracking'}], cardClass:'counselor-active' },
};

function impliedAge(y:number){ return new Date().getFullYear()-(y-18); }

import { Suspense } from 'react';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus, update: updateSession } = useSession();
  const [step, setStep] = useState<1|'verify'|2|3|'forgot'|'forgot-code'|'forgot-reset'>(1);
  const [tab, setTab] = useState<'signup'|'login'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [slide, setSlide] = useState(0);
  const [role, setRole] = useState<'student'|'counselor'|null>('student');
  const [hoverRole, setHoverRole] = useState<string|null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const [yearsExp, setYearsExp] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPw, setShowNewPw] = useState(false);

  useEffect(()=>{ const t=setInterval(()=>setSlide(s=>(s+1)%3),5000); return()=>clearInterval(t); },[]);
  useEffect(()=>{ if(resendTimer<=0)return; const t=setTimeout(()=>setResendTimer(r=>r-1),1000); return()=>clearTimeout(t); },[resendTimer]);

  // Handle Google OAuth callback — check if user needs role selection
  useEffect(()=>{
    if(searchParams.get('google_callback')==='1' && sessionStatus==='authenticated' && session?.user){
      const userRole = (session.user as any).role;
      if(userRole==='needs_role'){
        setIsGoogleUser(true);
        setEmail(session.user.email||'');
        setStep(2);
      } else {
        // Existing user with role — redirect
        if(userRole==='admin') router.push('/admin');
        else if(userRole==='counselor') router.push('/expert-portal');
        else router.push('/dashboard');
      }
    }
  },[searchParams, sessionStatus, session, router]);

  const doSignIn = async(e:string,p:string)=>{
    setError('');setLoading(true);
    try{
      const r=await signIn('credentials',{email:e.trim().toLowerCase(),password:p,redirect:false});
      if(r?.error){setError('Invalid email or password');setLoading(false);}
      else{ const s=await(await fetch('/api/auth/session')).json(); const role=s?.user?.role||'student';
        if(role==='admin')router.push('/admin'); else if(role==='counselor')router.push('/expert-portal');
        else if(role==='pending_counselor')router.push('/pending-approval'); else router.push('/dashboard');
        router.refresh();}
    }catch{setError('An error occurred.');setLoading(false);}
  };

  const handleLogin=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    await doSignIn(email,password);
  };
  const handleDemoLogin=async(e:string)=>{ await doSignIn(e,'password123'); };

  const sendVerificationCode=async()=>{
    setError('');setLoading(true);
    try{
      const res=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'send',email:email.trim().toLowerCase()})});
      const data=await res.json();
      if(!res.ok){setError(data.error);setLoading(false);return false;}
      setCodeSent(true);setResendTimer(60);setLoading(false);
      return true;
    }catch{setError('Failed to send code.');setLoading(false);return false;}
  };

  const handleSignupStep1=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    if(!email.trim()){setError('Please enter your email.');return;}
    const _ec = validateEmail(email);
    if(!_ec.ok){setError(_ec.error);return;}
    const _pc = validatePassword(password);
    if(!_pc.ok){setError(_pc.error);return;}
    setStep(2);
  };

  const handleVerifyCode=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    if(verifyCode.length!==6){setError('Please enter the 6-digit code.');return;}
    setLoading(true);
    try{
      const res=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'verify',email:email.trim().toLowerCase(),code:verifyCode})});
      const data=await res.json();
      if(!res.ok){setError(data.error);setLoading(false);return;}
      // Code verified — now register the account
      const specs=specialties.split(',').map(s=>s.trim()).filter(Boolean);
      const regRes=await fetch('/api/account/register',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:name.trim()||email.split('@')[0],email,password,role,phone:phone.trim()||undefined,
          bio:role==='counselor'?bio:undefined,years_experience:role==='counselor'?parseInt(yearsExp)||0:undefined,
          specialties:role==='counselor'?specs:undefined})});
      const regData=await regRes.json();
      if(!regRes.ok){setError(regData.error??'Sign up failed.');setLoading(false);return;}
      if(regData.pending){await doSignIn(email,password);return;}
      const r2=await signIn('credentials',{email:email.trim().toLowerCase(),password,redirect:false});
      if(r2?.error){
        // Show the actual NextAuth error instead of a generic message so we
        // can diagnose credential mismatches, schema issues, etc.
        console.error('[signup] signIn returned error:', r2);
        setError(`Account created but sign-in failed: ${r2.error}${r2.status ? ` (${r2.status})` : ''}`);
        setLoading(false);
        return;
      }
      router.push('/dashboard');router.refresh();
    }catch{setError('Verification failed.');setLoading(false);}
  };

  const handleSignupComplete=async()=>{
    if(!role){setError('Please select a role.');return;}
    if(!agreed){setError('Please agree to the Terms of Service and Privacy Policy.');return;}
    setError('');
    if(isGoogleUser){
      // Google user — already authenticated, just set role (go to step 3 for name+phone)
      setStep(3);
    } else {
      // Email/password — go to step 3 for name + phone before verification
      setStep(3);
    }
  };

  const handleStep3Complete=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    if(!name.trim()){setError('Please enter your full name.');return;}
    if(role==='counselor'&&!phone.trim()){setError('Phone number is required for counselors.');return;}
    setLoading(true);
    if(isGoogleUser){
      try{
        const res=await fetch('/api/account/set-role',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({role,name:name.trim(),phone:phone.trim()||undefined,bio:role==='counselor'?bio:undefined,
            years_experience:role==='counselor'?parseInt(yearsExp)||0:undefined,
            specialties:role==='counselor'?specialties:undefined})});
        const data=await res.json();
        if(!res.ok){setError(data.error??'Failed to set role.');setLoading(false);return;}
        await updateSession();
        if(data.pending) window.location.href='/pending-approval';
        else window.location.href='/dashboard';
      }catch{setError('Something went wrong.');setLoading(false);}
    } else {
      // Send verification code, then go to verify step
      const sent=await sendVerificationCode();
      if(sent) setStep('verify');
    }
  };

  const handleGoogleSignIn=()=>{ signIn('google',{callbackUrl:'/login?google_callback=1'}); };
  const isGoogleEnabled = true;

  // ── Forgot password flow ──
  const handleForgotSendCode=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    if(!forgotEmail.trim()){setError('Please enter your email.');return;}
    setLoading(true);
    try{
      // Check if account exists first
      const checkRes=await fetch('/api/account/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'check',email:forgotEmail.trim().toLowerCase()})});
      const checkData=await checkRes.json();
      if(!checkRes.ok){setError(checkData.error);setLoading(false);return;}
      // Send verification code for password reset
      const res=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'send',email:forgotEmail.trim().toLowerCase(),purpose:'reset'})});
      const data=await res.json();
      if(!res.ok){setError(data.error);setLoading(false);return;}
      setResendTimer(60);setStep('forgot-code');setLoading(false);
    }catch{setError('Failed to send code.');setLoading(false);}
  };

  const handleForgotVerify=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    if(forgotCode.length!==6){setError('Please enter the 6-digit code.');return;}
    setLoading(true);
    try{
      const res=await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'verify',email:forgotEmail.trim().toLowerCase(),code:forgotCode,purpose:'reset'})});
      const data=await res.json();
      if(!res.ok){setError(data.error);setLoading(false);return;}
      setStep('forgot-reset');setLoading(false);
    }catch{setError('Verification failed.');setLoading(false);}
  };

  const handleResetPassword=async(ev:React.FormEvent)=>{
    ev.preventDefault(); setError('');
    if(newPassword.length<8){setError('Password must be at least 8 characters.');return;}
    setLoading(true);
    try{
      const res=await fetch('/api/account/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'reset',email:forgotEmail.trim().toLowerCase(),password:newPassword})});
      const data=await res.json();
      if(!res.ok){setError(data.error);setLoading(false);return;}
      // Auto sign in
      await doSignIn(forgotEmail,newPassword);
    }catch{setError('Reset failed.');setLoading(false);}
  }; // Set to false to hide Google button when env vars not configured

  const ctxRole=hoverRole||role;
  const ctxData=ctxRole?ROLE_DATA[ctxRole]:null;

  return(<>
    <div className="lp-page">
      {/* ═══ LEFT ═══ */}
      <div className="lp-left">
        <div className="lp-logo">
          <img className="lp-logo-img" src="/raven-logo.svg" alt="Admitly"/>
          <span className="lp-wordmark">Admitly</span>
        </div>
        <div className="lp-tagline">Your Common App Copilot</div>

        {step===1?(
          <div className="lp-carousel">
            {SLIDES.map((s,i)=>(
              <div key={i} className="lp-slide" style={{display:i===slide?'flex':'none'}}>
                <div className="lp-slide-tag">{s.tag}</div>
                <div className="lp-slide-title">{s.title}</div>
                <div className="lp-slide-desc">{s.desc}</div>
              </div>
            ))}
            <div className="lp-dots">
              {SLIDES.map((_,i)=><button key={i} className={`lp-dot${i===slide?' active':''}`} onClick={()=>setSlide(i)}/>)}
            </div>
          </div>
        ):step==='verify'?(
          <div className="lp-carousel">
            <div className="lp-step-badge">
              <div style={{display:'flex',gap:5,alignItems:'center'}}>
                <div className="lp-step-dot done"/><div className="lp-step-dot done"/><div className="lp-step-dot done"/><div className="lp-step-dot cur"/>
              </div>
              Verify email
            </div>
            <h2 className="lp-left-h">Check your<br/>inbox.<br/><span>Almost there.</span></h2>
            <p className="lp-left-sub">We sent a 6-digit code to <strong>{email}</strong>. Enter it on the right to verify your email.</p>
          </div>
        ):step===3?(
          <div className="lp-carousel">
            <div className="lp-step-badge">
              <div style={{display:'flex',gap:5,alignItems:'center'}}>
                <div className="lp-step-dot done"/><div className="lp-step-dot done"/><div className="lp-step-dot cur"/><div className="lp-step-dot"/>
              </div>
              Step 3 of 4
            </div>
            <h2 className="lp-left-h">Tell us<br/>about you.<br/><span>Just the basics.</span></h2>
            <p className="lp-left-sub">We need your name{role==='counselor'?' and phone number':''} to set up your profile.</p>
          </div>
        ):(step==='forgot'||step==='forgot-code'||step==='forgot-reset')?(
          <div className="lp-carousel">
            <div className="lp-step-badge">
              <div style={{display:'flex',gap:5,alignItems:'center'}}>
                <div className={`lp-step-dot${step==='forgot'?' cur':'done'}`}/>
                <div className={`lp-step-dot${step==='forgot-code'?' cur':step==='forgot-reset'?'done':''}`}/>
                <div className={`lp-step-dot${step==='forgot-reset'?' cur':''}`}/>
              </div>
              Reset password
            </div>
            <h2 className="lp-left-h">
              {step==='forgot'?<>Forgot your<br/>password?<br/><span>No worries.</span></>
               :step==='forgot-code'?<>Check your<br/>inbox.<br/><span>Enter the code.</span></>
               :<>Set a new<br/>password.<br/><span>Almost done.</span></>}
            </h2>
            <p className="lp-left-sub">
              {step==='forgot'?'Enter your email and we\'ll send you a verification code to reset your password.'
               :step==='forgot-code'?<>We sent a 6-digit code to <strong>{forgotEmail}</strong>. Enter it on the right to continue.</>
               :'Choose a strong password — at least 8 characters.'}
            </p>
          </div>
        ):(
          <div className="lp-carousel">
            <div className="lp-step-badge">
              <div style={{display:'flex',gap:5,alignItems:'center'}}>
                <div className="lp-step-dot done"/><div className="lp-step-dot cur"/><div className="lp-step-dot"/><div className="lp-step-dot"/>
              </div>
              Step 2 of 4
            </div>
            <h2 className="lp-left-h">Your account<br/>is ready.<br/><span>One last thing.</span></h2>
            <p className="lp-left-sub">Tell us who you are so we can set up the right experience for you.</p>
            <div className={`lp-ctx${ctxData?` ${ctxData.cardClass}`:''}`}>
              <div className="lp-ctx-label">{ctxData?.label||'Hover a role to preview'}</div>
              <span className="lp-ctx-icon-svg" dangerouslySetInnerHTML={{__html:ctxData?ROLE_ICONS[ctxData.iconKey]||ROLE_ICONS.default:ROLE_ICONS.default}}/>
              <div className="lp-ctx-title">{ctxData?.title||'Choose your role'}</div>
              <div className="lp-ctx-desc">{ctxData?.desc||'Select Student or Counselor on the right to see what Admitly will look like for you.'}</div>
              {ctxData&&<div>{ctxData.features.map((f,i)=><div key={i} className="lp-fi"><div className="lp-fi-dot" dangerouslySetInnerHTML={{__html:ROLE_ICONS[f.iconKey]||''}}/>{f.text}</div>)}</div>}
            </div>
          </div>
        )}

        <div className="lp-links">
          <a href="https://admitly.com/terms" target="_blank" rel="noopener noreferrer">Terms</a><a href="https://admitly.com/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
        </div>
      </div>

      {/* ═══ RIGHT ═══ */}
      <div className="lp-right">
        <div className="lp-form">
          {step===1?(
            <>
              {/* Demo users — shown only when NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS
                  is 'true' (local dev / preview). Hidden on production
                  Vercel deploys so public visitors see a clean login. For
                  production-side testing, the team uses /team-login?key=… */}
              {process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'true' && (
                <div className="lp-demo">
                  <div className="lp-demo-label"><span style={{color:'#ffe500',fontSize:10}}>⚡</span> Quick Demo Access <span style={{marginLeft:'auto',fontWeight:500,opacity:.5,textTransform:'none',letterSpacing:0}}>password123</span></div>
                  <div className="lp-demo-grid">
                    {DEMO_USERS.map(u=>(
                      <button key={u.email} className="lp-demo-btn" onClick={()=>handleDemoLogin(u.email)} disabled={loading}>
                        <div className="lp-demo-avatar" style={{background:u.bg,color:u.color}}>{u.initials}</div>
                        <div><div className="lp-demo-name">{u.name}</div><div className="lp-demo-role">{u.label}</div></div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="lp-tabs">
                <button className={`lp-tab${tab==='signup'?' active':''}`} onClick={()=>{setTab('signup');setError('');}}>Sign up</button>
                <button className={`lp-tab${tab==='login'?' active':''}`} onClick={()=>{setTab('login');setError('');}}>Log in</button>
              </div>

              {tab==='signup'?(
                <form onSubmit={handleSignupStep1}>
                  <div className="lp-head">
                    <h1>Create your account</h1>
                    <p>Start your admissions journey — free.</p>
                  </div>
                  <label className="lp-label">Email address</label>
                  <div className="lp-input-wrap">
                    <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" opacity=".2"/><path d="M2 7l10 7 10-7"/></svg>
                    <input className="lp-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@gmail.com" required/>
                  </div>
                  {email && !validateEmail(email).ok && (
                    <div style={{fontSize:11,color:'rgba(248,113,113,.95)',marginTop:-8,marginBottom:14,paddingLeft:2}}>
                      Allowed: {ALLOWED_EMAIL_DOMAINS.join(', ')}
                    </div>
                  )}
                  <label className="lp-label">Password</label>
                  <div className="lp-pw-row">
                    <div className="lp-input-wrap">
                      <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <input className="lp-input" type={showPw?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8}/>
                    </div>
                    <button type="button" className="lp-pw-btn" onClick={()=>setShowPw(!showPw)} title={showPw?'Hide password':'Show password'}>
                      {showPw
                        ? <svg fill="none" stroke="rgba(255,229,0,.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                    </button>
                  </div>
                  {password && passwordRuleChecklist(password).some(r => !r.met) && (
                    <div style={{fontSize:11,marginTop:-8,marginBottom:14,paddingLeft:2}}>
                      {passwordRuleChecklist(password).filter(r => !r.met).map(r => (
                        <div key={r.label} style={{color:'rgba(248,113,113,.95)', display:'flex',alignItems:'center',gap:6,lineHeight:1.6}}>
                          <span>○</span><span>{r.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {error&&<div className="lp-error">{error}</div>}
                  <button type="submit" className="lp-btn" disabled={loading} style={{marginTop:6}}>{loading?'Please wait…':'Create free account'}</button>
                  <div className="lp-or2"><span>or</span></div>
                  <button type="button" className="lp-google" onClick={handleGoogleSignIn}>
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Continue with Google
                  </button>
                  <p className="lp-terms">By continuing you agree to our <a href="https://admitly.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="https://admitly.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.</p>
                </form>
              ):(
                <form onSubmit={handleLogin}>
                  <div className="lp-head">
                    <h1>Welcome back</h1>
                    <p>Log in to continue your journey.</p>
                  </div>
                  <label className="lp-label">Email address</label>
                  <div className="lp-input-wrap">
                    <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" opacity=".2"/><path d="M2 7l10 7 10-7"/></svg>
                    <input className="lp-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@gmail.com" required/>
                  </div>
                  <label className="lp-label">Password</label>
                  <div className="lp-pw-row">
                    <div className="lp-input-wrap">
                      <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <input className="lp-input" type={showPw?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your password" required/>
                    </div>
                    <button type="button" className="lp-pw-btn" onClick={()=>setShowPw(!showPw)} title={showPw?'Hide password':'Show password'}>
                      {showPw
                        ? <svg fill="none" stroke="rgba(255,229,0,.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        : <svg fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                    </button>
                  </div>
                  {error&&<div className="lp-error">{error}</div>}
                  <button type="submit" className="lp-btn" disabled={loading} style={{marginTop:6}}>{loading?'Signing in…':'Log in'}</button>
                  <div style={{textAlign:'right',marginTop:-6,marginBottom:12}}>
                    <button type="button" onClick={()=>{setError('');setForgotEmail(email);setStep('forgot');}} style={{fontSize:12,color:'rgba(255,229,0,.55)',fontWeight:600,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit',textDecoration:'underline',textUnderlineOffset:2}}>Forgot password?</button>
                  </div>
                  <div className="lp-or2"><span>or</span></div>
                  <button type="button" className="lp-google" onClick={handleGoogleSignIn}>
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    Continue with Google
                  </button>
                </form>
              )}
            </>
          ):step==='forgot'?(
            <form onSubmit={handleForgotSendCode}>
              <div className="lp-head">
                <h1>Reset password</h1>
                <p>Enter your email and we&apos;ll send a verification code.</p>
              </div>
              <label className="lp-label">Email address</label>
              <div className="lp-input-wrap">
                <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2" opacity=".2"/><path d="M2 7l10 7 10-7"/></svg>
                <input className="lp-input" type="email" value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)} placeholder="you@gmail.com" required autoFocus/>
              </div>
              {error&&<div className="lp-error">{error}</div>}
              <button type="submit" className="lp-btn" disabled={loading} style={{marginTop:6}}>{loading?'Sending code…':'Send verification code'}</button>
              <div style={{textAlign:'center',marginTop:8}}>
                <button type="button" onClick={()=>{setStep(1);setTab('login');setError('');}} style={{fontSize:12,color:'rgba(255,255,255,.3)',fontWeight:600,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>← Back to login</button>
              </div>
            </form>
          ):step==='forgot-code'?(
            <form onSubmit={handleForgotVerify}>
              <div className="lp-head">
                <h1>Enter code</h1>
                <p>We sent a 6-digit code to {forgotEmail}</p>
              </div>
              <label className="lp-label">Verification code</label>
              <div className="lp-input-wrap" style={{marginBottom:16}}>
                <input className="lp-code-input" type="text" inputMode="numeric" maxLength={6} value={forgotCode}
                  onChange={e=>{const v=e.target.value.replace(/\D/g,'');setForgotCode(v);}} placeholder="000000" autoFocus/>
              </div>
              {error&&<div className="lp-error">{error}</div>}
              <button type="submit" className="lp-btn" disabled={loading||forgotCode.length!==6} style={{marginTop:4}}>
                {loading?'Verifying…':'Verify code'}
              </button>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8}}>
                <button type="button" onClick={()=>{setStep('forgot');setError('');setForgotCode('');}} style={{fontSize:12,color:'rgba(255,255,255,.3)',fontWeight:600,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>← Back</button>
                <button type="button" className="lp-resend" disabled={resendTimer>0||loading} onClick={async()=>{setError('');setLoading(true);try{await fetch('/api/email-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'send',email:forgotEmail.trim().toLowerCase(),purpose:'reset'})});setResendTimer(60);}catch{}setLoading(false);}}>
                  {resendTimer>0?`Resend in ${resendTimer}s`:'Resend code'}
                </button>
              </div>
            </form>
          ):step==='forgot-reset'?(
            <form onSubmit={handleResetPassword}>
              <div className="lp-head">
                <h1>New password</h1>
                <p>Choose a strong password for your account.</p>
              </div>
              <label className="lp-label">New password</label>
              <div className="lp-pw-row">
                <div className="lp-input-wrap">
                  <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  <input className="lp-input" type={showNewPw?'text':'password'} value={newPassword} onChange={e=>setNewPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8} autoFocus/>
                </div>
                <button type="button" className="lp-pw-btn" onClick={()=>setShowNewPw(!showNewPw)} title={showNewPw?'Hide':'Show'}>
                  {showNewPw
                    ? <svg fill="none" stroke="rgba(255,229,0,.75)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                </button>
              </div>
              {error&&<div className="lp-error">{error}</div>}
              <button type="submit" className="lp-btn" disabled={loading} style={{marginTop:6}}>{loading?'Resetting…':'Reset password & sign in'}</button>
            </form>
          ):step==='verify'?(
            <form onSubmit={handleVerifyCode}>
              <div className="lp-head">
                <h1>Verify your email</h1>
                <p>Enter the 6-digit code sent to {email}</p>
              </div>
              <label className="lp-label">Verification code</label>
              <div className="lp-input-wrap" style={{marginBottom:16}}>
                <input className="lp-code-input" type="text" inputMode="numeric" maxLength={6} value={verifyCode}
                  onChange={e=>{const v=e.target.value.replace(/\D/g,'');setVerifyCode(v);}} placeholder="000000" autoFocus/>
              </div>
              {error&&<div className="lp-error">{error}</div>}
              <button type="submit" className="lp-btn" disabled={loading||verifyCode.length!==6} style={{marginTop:4}}>
                {loading?'Creating account…':'Verify & create account'}
              </button>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8}}>
                <button type="button" onClick={()=>{setStep(3);setError('');setVerifyCode('');}} style={{fontSize:12,color:'rgba(255,255,255,.3)',fontWeight:600,background:'none',border:'none',cursor:'pointer',fontFamily:'inherit'}}>← Back</button>
                <button type="button" className="lp-resend" disabled={resendTimer>0||loading} onClick={async()=>{setError('');await sendVerificationCode();}}>
                  {resendTimer>0?`Resend in ${resendTimer}s`:'Resend code'}
                </button>
              </div>
            </form>
          ):step===3?(
            <form onSubmit={handleStep3Complete}>
              <div style={{fontSize:10.5,fontWeight:800,textTransform:'uppercase',letterSpacing:'.1em',color:'rgba(255,255,255,.3)',marginBottom:8}}>Step 3 — Your Info</div>
              <h1 style={{fontSize:26,fontWeight:800,color:'#fff',letterSpacing:'-.5px',lineHeight:1.2,marginBottom:6}}>What&apos;s your name?</h1>
              <p style={{fontSize:13,color:'rgba(255,255,255,.4)',fontWeight:500,marginBottom:24}}>This will appear on your profile and in messages.</p>
              <label className="lp-label">Full name</label>
              <div className="lp-input-wrap">
                <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <input className="lp-input" type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" required autoFocus/>
              </div>
              <label className="lp-label">Phone number {role==='student'?<span style={{fontWeight:500,color:'rgba(255,255,255,.2)',textTransform:'none',letterSpacing:0}}>(optional)</span>:<span style={{fontWeight:500,color:'rgba(255,229,0,.5)',textTransform:'none',letterSpacing:0}}>(required)</span>}</label>
              <div className="lp-input-wrap">
                <svg className="lp-field-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                <input className="lp-input" type="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder={role==='counselor'?'(555) 123-4567':'(555) 123-4567'} required={role==='counselor'}/>
              </div>
              {error&&<div className="lp-error">{error}</div>}
              <button type="submit" className="lp-btn" disabled={loading||!name.trim()||(role==='counselor'&&!phone.trim())} style={{marginTop:6}}>{loading?'Sending code…':'Continue →'}</button>
              <div className="lp-footer">
                <button type="button" onClick={()=>{setStep(2);setError('');}}>← Back</button>
              </div>
            </form>
          ):(
            <>
              <div style={{fontSize:10.5,fontWeight:800,textTransform:'uppercase',letterSpacing:'.1em',color:'rgba(255,255,255,.3)',marginBottom:8}}>Step 2 — Role</div>
              <h1 style={{fontSize:26,fontWeight:800,color:'#fff',letterSpacing:'-.5px',lineHeight:1.2,marginBottom:6}}>Who are you?</h1>
              <p style={{fontSize:13,color:'rgba(255,255,255,.4)',fontWeight:500,marginBottom:30}}>Pick your role to personalize your dashboard.</p>

              {/* Student card */}
              <div className={`lp-rcard${role==='student'?' sel-student':''}`}
                onClick={()=>setRole('student')} onMouseEnter={()=>setHoverRole('student')} onMouseLeave={()=>setHoverRole(null)}>
                <div className="lp-radio">{role==='student'&&<div style={{width:8,height:8,borderRadius:'50%',background:'#111',margin:'auto'}}/>}</div>
                <div className="lp-rcard-inner">
                  <div className="lp-ricon" style={{background:'rgba(255,255,255,.06)'}}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.1 2.7 3 6 3s6-1.9 6-3v-5"/></svg>
                  </div>
                  <div style={{flex:1,paddingTop:2}}>
                    <div className="lp-rtitle">Student</div>
                    <div className="lp-rdesc">I&apos;m applying to colleges and want to organize my applications, essays, and deadlines.</div>
                  </div>
                </div>
                <div className="lp-rfeats"><div className="lp-rf-inner">
                  {['College match scoring & list builder','AI essay review & feedback','Deadline tracker & action items'].map(t=>
                    <div key={t} className="lp-rf"><svg width="15" height="15" fill="none" stroke="#ffe500" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>{t}</div>
                  )}
                </div></div>
              </div>

              {/* Counselor card */}
              <div className={`lp-rcard${role==='counselor'?' sel-counselor':''}`}
                onClick={()=>setRole('counselor')} onMouseEnter={()=>setHoverRole('counselor')} onMouseLeave={()=>setHoverRole(null)}>
                <div className="lp-radio">{role==='counselor'&&<div style={{width:8,height:8,borderRadius:'50%',background:'#111',margin:'auto'}}/>}</div>
                <div className="lp-rcard-inner">
                  <div className="lp-ricon" style={{background:'rgba(255,255,255,.06)'}}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  </div>
                  <div style={{flex:1,paddingTop:2}}>
                    <div className="lp-rtitle">Counselor</div>
                    <div className="lp-rdesc">I guide students through admissions and want to track their progress and milestones.</div>
                  </div>
                </div>
                <div className="lp-rfeats"><div className="lp-rf-inner">
                  {['Multi-student portfolio view','Notes, action items & messaging','Earnings & session management'].map(t=>
                    <div key={t} className="lp-rf"><svg width="15" height="15" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>{t}</div>
                  )}
                </div></div>
              </div>

              {/* Terms checkbox */}
              <label className="lp-agree">
                <input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/>
                <span>I am 13 or older and agree to the <a href="https://admitly.com/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and <a href="https://admitly.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>. AI-generated content is for guidance only — not professional admissions advice.</span>
              </label>

              {error&&<div className="lp-error">{error}</div>}
              <button className="lp-btn" disabled={!role||!agreed||loading} style={{opacity:(role&&agreed)?1:.35}} onClick={handleSignupComplete}>
                {loading?'Creating account…':'Continue →'}
              </button>
              <div className="lp-footer">
                <button onClick={()=>{setStep(1);setError('');}}>← Back</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  </>);
}

export default function LoginPage() {
  return <Suspense fallback={<div style={{minHeight:'100vh',background:'#ffe500'}}/>}><LoginPageInner/></Suspense>;
}
