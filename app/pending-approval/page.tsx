'use client';

import { useSession, signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const ss = (o: React.CSSProperties) => o;

export default function PendingApprovalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as any)?.role || 'student';

  // If user is approved counselor or not pending, redirect them
  useEffect(() => {
    if (status === 'authenticated') {
      if (role === 'counselor') router.push('/expert-portal');
      else if (role === 'admin') router.push('/admin');
      else if (role === 'student') router.push('/profile');
      // 'pending_counselor' and 'rejected' stay here
    }
    if (status === 'unauthenticated') router.push('/login');
  }, [status, role, router]);

  if (status === 'loading') return (
    <div style={ss({height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',fontFamily:"'DM Sans',sans-serif",color:'var(--stone-400)',fontSize:14,fontWeight:600})}>
      <i className="fas fa-spinner fa-spin" style={{marginRight:10}}></i>Loading…
    </div>
  );

  const isRejected = role === 'rejected';

  return (
    <div style={ss({minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',padding:16,fontFamily:"'DM Sans',sans-serif"})}>
      <div style={ss({width:'100%',maxWidth:460,display:'flex',flexDirection:'column',alignItems:'center',gap:20})}>

        {/* Logo */}
        <div style={ss({width:56,height:56,borderRadius:16,background:'var(--yellow)',color:'#000',fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,boxShadow:'0 8px 24px rgba(0,0,0,.08)'})}>A.</div>

        {/* Card */}
        <div style={ss({width:'100%',background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:40,textAlign:'center'})}>

          {isRejected ? (
            <>
              <div style={ss({width:64,height:64,borderRadius:'50%',background:'var(--red-light)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 20px'})}>
                <i className="fas fa-times-circle" style={{color:'var(--red)',fontSize:28}}></i>
              </div>
              <h1 style={ss({fontSize:22,fontWeight:900,marginBottom:10})}>Application Not Approved</h1>
              <p style={ss({fontSize:13,fontWeight:500,color:'var(--stone-500)',lineHeight:1.7,marginBottom:6})}>
                Unfortunately, your counselor application was not approved at this time.
              </p>
              <p style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',lineHeight:1.7,marginBottom:24})}>
                You can re-apply by creating a new account with updated credentials. If you believe this was an error, please contact us at <strong>support@admitly.com</strong>.
              </p>
            </>
          ) : (
            <>
              <div style={ss({width:64,height:64,borderRadius:'50%',background:'var(--amber-light)',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 20px'})}>
                <i className="fas fa-hourglass-half" style={{color:'#f59e0b',fontSize:26}}></i>
              </div>
              <h1 style={ss({fontSize:22,fontWeight:900,marginBottom:10})}>Application Under Review</h1>
              <p style={ss({fontSize:13,fontWeight:500,color:'var(--stone-500)',lineHeight:1.7,marginBottom:6})}>
                Thanks for applying to be an Admitly counselor, <strong>{session?.user?.name}</strong>!
              </p>
              <p style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',lineHeight:1.7,marginBottom:24})}>
                Our team is reviewing your application. This usually takes 1–2 business days. We'll notify you by email once your account is approved.
              </p>

              {/* Status indicator */}
              <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',gap:16,padding:'16px 20px',background:'var(--stone-50)',borderRadius:16,marginBottom:24})}>
                <div style={ss({display:'flex',flexDirection:'column',alignItems:'center',gap:4})}>
                  <div style={ss({width:32,height:32,borderRadius:'50%',background:'var(--emerald)',display:'flex',alignItems:'center',justifyContent:'center'})}>
                    <i className="fas fa-check" style={{color:'#fff',fontSize:12}}></i>
                  </div>
                  <span style={ss({fontSize:9,fontWeight:700,color:'var(--stone-500)'})}>Applied</span>
                </div>
                <div style={ss({width:40,height:2,background:'var(--border)'})}></div>
                <div style={ss({display:'flex',flexDirection:'column',alignItems:'center',gap:4})}>
                  <div style={ss({width:32,height:32,borderRadius:'50%',background:'var(--yellow)',display:'flex',alignItems:'center',justifyContent:'center'})}>
                    <i className="fas fa-magnifying-glass" style={{color:'var(--stone-800)',fontSize:12}}></i>
                  </div>
                  <span style={ss({fontSize:9,fontWeight:700,color:'var(--stone-800)'})}>In Review</span>
                </div>
                <div style={ss({width:40,height:2,background:'var(--border)'})}></div>
                <div style={ss({display:'flex',flexDirection:'column',alignItems:'center',gap:4})}>
                  <div style={ss({width:32,height:32,borderRadius:'50%',background:'var(--stone-200)',display:'flex',alignItems:'center',justifyContent:'center'})}>
                    <i className="fas fa-rocket" style={{color:'var(--stone-400)',fontSize:12}}></i>
                  </div>
                  <span style={ss({fontSize:9,fontWeight:700,color:'var(--stone-400)'})}>Approved</span>
                </div>
              </div>
            </>
          )}

          <button onClick={() => signOut({ callbackUrl: '/login' })}
            style={ss({padding:'11px 28px',borderRadius:14,border:'2px solid var(--border)',fontFamily:'inherit',fontSize:13,fontWeight:800,cursor:'pointer',background:'var(--card)',color:'var(--stone-600)',transition:'all .12s'})}>
            <i className="fas fa-arrow-left" style={{marginRight:8,fontSize:11}}></i>
            Back to Login
          </button>
        </div>

        <p style={ss({fontSize:11,fontWeight:500,color:'var(--stone-300)'})}>Admitly · AI-powered admissions planning</p>
      </div>
    </div>
  );
}
