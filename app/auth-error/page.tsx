'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const ss = (o: React.CSSProperties) => o;

function AuthErrorInner() {
  const params = useSearchParams();
  const error = params.get('error') || 'Unknown';

  const isAccessDenied = error === 'AccessDenied';
  const isOAuth = error === 'OAuthSignin' || error === 'OAuthCallback' || error === 'OAuthCreateAccount' || error === 'OAuthAccountNotLinked';

  const title = isAccessDenied
    ? 'Account locked'
    : isOAuth
    ? 'Sign-in issue'
    : 'Something went wrong';

  const message = isAccessDenied
    ? 'Your account has been temporarily locked due to a policy violation or administrative action. If you believe this is a mistake, please reach out — we\'re here to help.'
    : isOAuth
    ? 'We couldn\'t complete the sign-in with your Google account. This can happen if the email is already registered with a different method.'
    : 'An unexpected error occurred during sign-in. Please try again or contact support if the problem continues.';

  const icon = isAccessDenied ? 'fa-lock' : isOAuth ? 'fa-triangle-exclamation' : 'fa-circle-exclamation';
  const iconBg = isAccessDenied ? '#fef2f2' : '#fffbeb';
  const iconColor = isAccessDenied ? '#dc2626' : '#f59e0b';

  return (
    <div style={ss({minHeight:'100vh',background:'#ffe500',display:'flex',alignItems:'center',justifyContent:'center',padding:24,fontFamily:"'DM Sans',system-ui,sans-serif"})}>
      <div style={ss({width:'100%',maxWidth:440,display:'flex',flexDirection:'column',alignItems:'center'})}>

        {/* Logo */}
        <div style={ss({display:'flex',alignItems:'center',gap:11,marginBottom:32})}>
          <div style={ss({width:44,height:44,borderRadius:11,background:'#1c1917',display:'flex',alignItems:'center',justifyContent:'center',color:'#FFE500',fontSize:18,fontWeight:900})}>A.</div>
          <span style={ss({fontSize:18,fontWeight:800,color:'#111',letterSpacing:'0.12em',textTransform:'uppercase'})}>Admitly</span>
        </div>

        {/* Card */}
        <div style={ss({width:'100%',background:'#131929',borderRadius:24,padding:'48px 40px',boxShadow:'0 24px 64px rgba(0,0,0,.2)',position:'relative',overflow:'hidden'})}>
          {/* Gradient overlay */}
          <div style={ss({position:'absolute',inset:0,borderRadius:'inherit',background:'radial-gradient(circle at 80% 12%, rgba(255,229,0,.07) 0%, transparent 50%), radial-gradient(circle at 18% 88%, rgba(0,78,235,.1) 0%, transparent 45%)',pointerEvents:'none'})}/>

          <div style={ss({position:'relative',zIndex:1,display:'flex',flexDirection:'column',alignItems:'center',textAlign:'center'})}>
            {/* Icon */}
            <div style={ss({width:72,height:72,borderRadius:20,background:iconBg,display:'flex',alignItems:'center',justifyContent:'center',marginBottom:24})}>
              <i className={`fas ${icon}`} style={{fontSize:28,color:iconColor}}></i>
            </div>

            <h1 style={ss({fontSize:24,fontWeight:800,color:'#fff',letterSpacing:'-.4px',marginBottom:8})}>{title}</h1>
            <p style={ss({fontSize:14,fontWeight:500,color:'rgba(255,255,255,.5)',lineHeight:1.7,marginBottom:32,maxWidth:320})}>{message}</p>

            {/* Contact support */}
            {isAccessDenied && (
              <a href="mailto:support@admitly.com" style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'12px 24px',borderRadius:12,background:'rgba(255,255,255,.07)',border:'1.5px solid rgba(255,255,255,.1)',color:'rgba(255,255,255,.8)',fontSize:14,fontWeight:700,textDecoration:'none',transition:'all .15s',marginBottom:20,fontFamily:'inherit'})}>
                <i className="fas fa-envelope" style={{fontSize:13,color:'#FFE500'}}></i>
                Contact support@admitly.com
              </a>
            )}

            {/* Back to login */}
            <a href="/login" style={ss({display:'inline-flex',alignItems:'center',gap:8,padding:'14px 32px',borderRadius:13,background:'#FFE500',color:'#111',fontSize:15,fontWeight:800,textDecoration:'none',boxShadow:'0 4px 18px rgba(255,229,0,.32)',transition:'all .15s',fontFamily:'inherit'})}>
              <i className="fas fa-arrow-left" style={{fontSize:11}}></i>
              Back to sign in
            </a>

            {isAccessDenied && (
              <p style={ss({fontSize:11,fontWeight:500,color:'rgba(255,255,255,.25)',marginTop:20,lineHeight:1.6})}>
                Reference: {error} · If you need immediate help, include your email address in the subject line.
              </p>
            )}
          </div>
        </div>

        <p style={ss({fontSize:10,fontWeight:500,color:'rgba(0,0,0,.35)',marginTop:20})}>Admitly © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return <Suspense fallback={<div style={{minHeight:'100vh',background:'#ffe500'}}/>}><AuthErrorInner/></Suspense>;
}
