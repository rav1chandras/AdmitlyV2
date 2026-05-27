'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  score?: number;
  feature?: string;
  description?: string;
  tier?: 'pro' | 'premium';
}

const s = (o: React.CSSProperties) => o;

const DEV_MODE = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_PAYMENT_SKIP === 'true';

const PRO_FEATURES = [
  { icon: 'fa-chart-bar',      text: 'Full admissions score with detailed breakdown' },
  { icon: 'fa-university',     text: 'Unlimited college match & list builder' },
  { icon: 'fa-pen-nib',        text: 'AI essay feedback & scoring' },
  { icon: 'fa-robot',          text: 'AdmitCoach — AI admissions advisor' },
  { icon: 'fa-calendar-check', text: 'Deadline tracker with smart reminders' },
  { icon: 'fa-user-tie',       text: 'Access to certified counselor marketplace' },
];

const PREMIUM_FEATURES = [
  { icon: 'fa-video',           text: 'Live 1-on-1 sessions with expert counselor' },
  { icon: 'fa-pen-nib',         text: 'Personalized essay review & feedback' },
  { icon: 'fa-comments',        text: 'Direct messaging with your counselor' },
  { icon: 'fa-clipboard-check', text: 'Action items, tracking & accountability' },
  { icon: 'fa-calendar-check',  text: 'Priority scheduling & session recordings' },
  { icon: 'fa-user-tie',        text: 'Everything in Pro included' },
];

export function UpgradePrompt({ score, feature = 'this feature', description, tier = 'pro' }: Props) {
  const router = useRouter();
  const isPremium = tier === 'premium';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [skipping, setSkipping] = useState(false);
  const [fullPrice, setFullPrice] = useState(129);
  const [discountPrice, setDiscountPrice] = useState(89);

  useEffect(() => {
    fetch('/api/pricing').then(r => r.json()).then(d => {
      if (d.pro_full_price) setFullPrice(d.pro_full_price);
      if (d.pro_discount_price) setDiscountPrice(d.pro_discount_price);
    }).catch(() => {});
  }, []);

  const savings = fullPrice - discountPrice;
  const features = isPremium ? PREMIUM_FEATURES : PRO_FEATURES;
  const planLabel = isPremium ? 'Admitly Premium' : 'Admitly Pro';
  const price = discountPrice;

  const handlePurchase = async () => {
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: isPremium ? 'premium' : 'pro_onetime' }),
      });
      const data = await res.json();
      if (data.dev || !res.ok) {
        setError(data.dev ? 'Stripe not configured. Use "Skip for now" below.' : (data.error ?? 'Something went wrong.'));
        setLoading(false); return;
      }
      if (data.url) window.location.href = data.url;
    } catch { setError('Connection error. Please try again.'); setLoading(false); }
  };

  return (
    <div style={s({ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-start', padding:'40px 24px 60px', minHeight:400 })}>

      {/* Score hook */}
      {!isPremium && score && (
        <div style={s({ display:'inline-flex', alignItems:'center', gap:10, background:'#fefce8', border:'1px solid #fde68a', borderRadius:99, padding:'6px 16px', marginBottom:20 })}>
          <span style={s({ fontSize:13, fontWeight:900, color:'var(--stone-900)' })}>{score}</span>
          <span style={s({ fontSize:12, fontWeight:600, color:'#92400e' })}>Your Admissions Score</span>
        </div>
      )}

      {/* Premium: Pro badge */}
      {isPremium && (
        <div style={s({ display:'inline-flex', alignItems:'center', gap:6, padding:'6px 14px', background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:99, marginBottom:20 })}>
          <i className="fas fa-check-circle" style={{ fontSize:11, color:'#7c3aed' }}></i>
          <span style={s({ fontSize:12, fontWeight:700, color:'#5b21b6' })}>Pro member — upgrade to unlock {feature}</span>
        </div>
      )}

      {/* Header */}
      <div style={s({ textAlign:'center', maxWidth:460, marginBottom:28 })}>
        {savings > 0 && !isPremium && (
          <div style={s({ display:'inline-flex', alignItems:'center', gap:7, background:'#fefce8', border:'1px solid #fde68a', borderRadius:99, padding:'5px 14px', marginBottom:16 })}>
            <i className="fas fa-bolt" style={{ color:'#d97706', fontSize:11 }}></i>
            <span style={s({ fontSize:11, fontWeight:700, color:'#92400e' })}>Launch offer — save ${savings} · limited time</span>
          </div>
        )}
        <h1 style={s({ fontSize:26, fontWeight:900, color:'var(--stone-900)', letterSpacing:'-0.5px', lineHeight:1.2, marginBottom:10 })}>
          {isPremium ? 'Get 1-on-1 expert counseling' : 'Unlock your full admissions potential'}
        </h1>
        <p style={s({ fontSize:14, fontWeight:500, color:'var(--stone-500)', lineHeight:1.7 })}>
          {description ?? (isPremium
            ? 'Get matched with a verified admissions counselor for personalized strategy, essays, and college selection.'
            : 'AI scoring, essay coaching, college matching, and expert guidance — everything you need.')}
        </p>
      </div>

      {/* Main checkout card */}
      <div style={s({ width:'100%', maxWidth:520, background:'var(--card)', border:'1px solid var(--border)', borderRadius:24, overflow:'hidden', boxShadow:'0 4px 24px rgba(0,0,0,.06)' })}>

        {/* Price block */}
        <div style={s({ padding:'28px 28px 24px', background:'var(--stone-900)', display:'flex', alignItems:'center', justifyContent:'space-between' })}>
          <div>
            <div style={s({ fontSize:13, fontWeight:700, color:'rgba(255,255,255,.6)', marginBottom:6 })}>{planLabel} — Full Access</div>
            <div style={s({ display:'flex', alignItems:'baseline', gap:10 })}>
              <span style={s({ fontSize:40, fontWeight:900, color:'#fff', letterSpacing:'-1px' })}>${price}</span>
              {savings > 0 && <span style={s({ fontSize:18, fontWeight:600, color:'rgba(255,255,255,.4)', textDecoration:'line-through' })}>${fullPrice}</span>}
            </div>
            <div style={s({ fontSize:12, fontWeight:600, color:'rgba(255,255,255,.5)', marginTop:4 })}>One-time payment · access for 1 year</div>
          </div>
          {savings > 0 && (
            <div style={s({ background:'var(--yellow)', color:'#000', padding:'8px 14px', borderRadius:12, fontSize:12, fontWeight:800, textAlign:'center', lineHeight:1.3 })}>
              SAVE<br/>${savings}
            </div>
          )}
        </div>

        {/* Launch note */}
        {savings > 0 && !isPremium && (
          <div style={s({ padding:'12px 28px', background:'#fefce8', borderBottom:'1px solid #fde68a', display:'flex', alignItems:'center', gap:8 })}>
            <i className="fas fa-tag" style={{ color:'#d97706', fontSize:11 }}></i>
            <span style={s({ fontSize:12, fontWeight:600, color:'#92400e' })}>Launch price — will go up to ${fullPrice}. Lock in ${price} today.</span>
          </div>
        )}

        {/* Features */}
        <div style={s({ padding:'24px 28px' })}>
          <div style={s({ fontSize:11, fontWeight:700, color:'var(--stone-500)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:14 })}>Everything included</div>
          <div style={s({ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px 16px' })}>
            {features.map(f => (
              <div key={f.icon + f.text} style={s({ display:'flex', alignItems:'flex-start', gap:10 })}>
                <div style={s({ width:28, height:28, borderRadius:8, background:isPremium?'#f5f3ff':'var(--yellow)', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' })}>
                  <i className={`fas ${f.icon}`} style={{ fontSize:11, color:isPremium?'#7c3aed':'#000' }}></i>
                </div>
                <span style={s({ fontSize:12, fontWeight:600, color:'var(--stone-600)', lineHeight:1.5, paddingTop:5 })}>{f.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={s({ height:1, background:'var(--border)' })}></div>

        {/* CTA */}
        <div style={s({ padding:'20px 28px 28px', display:'flex', flexDirection:'column', gap:10 })}>
          {error && (
            <div style={s({ padding:'10px 14px', borderRadius:12, background:error.includes('not configured')?'#fefce8':'var(--red-light)', border:`1px solid ${error.includes('not configured')?'#fde68a':'#fecaca'}`, color:error.includes('not configured')?'#92400e':'#dc2626', fontSize:12, fontWeight:600, lineHeight:1.6 })}>
              <i className={`fas ${error.includes('not configured')?'fa-flask':'fa-circle-exclamation'}`} style={{ marginRight:8 }}></i>{error}
            </div>
          )}

          <button onClick={handlePurchase} disabled={loading}
            style={s({ width:'100%', padding:'16px 0', borderRadius:14, border:'none', background:loading?'var(--stone-300)':isPremium?'linear-gradient(135deg,#7c3aed,#9333ea)':'var(--stone-900)', color:'#fff', fontSize:16, fontWeight:800, cursor:loading?'not-allowed':'pointer', fontFamily:'inherit', transition:'all .15s', display:'flex', alignItems:'center', justifyContent:'center', gap:10 })}>
            {loading
              ? <><i className="fas fa-spinner fa-spin"></i> Redirecting to Stripe…</>
              : <><i className={`fab fa-stripe`} style={{ fontSize:18 }}></i> Get {planLabel} — ${price}</>}
          </button>

          <div style={s({ display:'flex', alignItems:'center', justifyContent:'center', gap:20, marginTop:4 })}>
            {[['fa-lock','Secure payment'],['fa-shield-halved','Stripe protected'],['fa-calendar','1-year access']].map(([icon,label])=>(
              <div key={icon} style={s({ display:'flex', alignItems:'center', gap:5 })}>
                <i className={`fas ${icon}`} style={{ color:'var(--stone-300)', fontSize:10 }}></i>
                <span style={s({ fontSize:10, fontWeight:600, color:'var(--stone-400)' })}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Dev skip */}
      {DEV_MODE && (
        <div style={s({ marginTop:20, width:'100%', maxWidth:520, background:'var(--card)', border:'1.5px dashed var(--border)', borderRadius:16, padding:'16px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 })}>
          <div>
            <div style={s({ fontSize:12, fontWeight:700, color:'var(--stone-600)', display:'flex', alignItems:'center', gap:6 })}><i className="fas fa-wrench" style={{ color:'var(--stone-400)', fontSize:11 }}></i>Dev mode</div>
            <div style={s({ fontSize:11, fontWeight:500, color:'var(--stone-400)', marginTop:2 })}>Skip payment for testing</div>
          </div>
          <button onClick={()=>{setSkipping(true);router.push('/profile');}} disabled={skipping}
            style={s({ flexShrink:0, padding:'9px 18px', borderRadius:10, border:'1.5px solid var(--border)', background:'var(--stone-50)', color:'var(--stone-600)', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit' })}>
            {skipping ? 'Going…' : 'Skip for now →'}
          </button>
        </div>
      )}
    </div>
  );
}
