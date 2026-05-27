'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { UpgradePrompt } from '@/components/UpgradePrompt';

interface Plan { id:number; name:string; sessions:number; price_cents:number; discounted_price_cents:number|null; description:string; features:string[]; }
interface Counselor { display_name:string; title:string; specialties:string[]; years_experience:number; total_students:number; }

const ss = (o:React.CSSProperties) => o;
const fmtPrice = (cents:number) => `$${(cents/100).toFixed(0)}`;
// Phase C added two states: 'reviewing' (admin hasn't responded yet) and
// 'awaiting_payment' (admin sent the invoice, student needs to pay).
type PageState = 'loading' | 'upgrade_pro' | 'plans' | 'reviewing' | 'awaiting_payment' | 'pending' | 'active';

interface PremiumRequest {
  id: number;
  plan_id: number | null;
  plan_name: string;
  amount_cents_quoted: number;
  amount_cents_invoiced: number | null;
  status: 'pending_review' | 'awaiting_payment' | 'paid'
        | 'cancelled_by_student' | 'rejected' | 'voided' | 'expired';
  hosted_invoice_url: string | null;
  invoice_sent_at: string | null;
  invoice_expires_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export default function ExpertSessionsWrapper() {
  return <Suspense fallback={<AppShell><div style={{display:'flex',flex:1,alignItems:'center',justifyContent:'center'}}><i className="fas fa-spinner fa-spin" style={{fontSize:24,color:'#a8a29e'}}></i></div></AppShell>}><ExpertSessionsPage/></Suspense>;
}

function ExpertSessionsPage() {
  const { data: session, status: authStatus, update: updateSession } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const browsePlans = searchParams.get('browse') === '1';
  const paymentSuccess = searchParams.get('payment') === 'success';
  // ?ref=email is sent by the premium-invoice email so we can show a
  // friendly toast if the student lands on the page after their request
  // was already cancelled / voided / paid out-of-band.
  const fromEmail = searchParams.get('ref') === 'email';
  const [pageState, setPageState] = useState<PageState>('loading');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [counselors, setCounselors] = useState<Counselor[]>([]);
  const [assignment, setAssignment] = useState<any>(null);
  // Pre-Phase-C self-serve checkout state — kept for backward compat in
  // case any code path still imports it; the new flow uses requestSubmitting.
  const [checkingOut] = useState<number|null>(null);
  const [statusChecked, setStatusChecked] = useState(false);
  // Phase C — premium request state
  const [premiumRequest, setPremiumRequest] = useState<PremiumRequest|null>(null);
  // Phase D — discriminator from /api/premium/request. 'premium' is the
  // existing flow; 'pro_recovery' means the "request" object is a
  // synthesized Pro recovery invoice (failed Pro Checkout that admin has
  // invoiced for recovery). The awaiting_payment screen swaps to
  // Pro-shaped copy when this is set.
  const [requestType, setRequestType] = useState<'premium' | 'pro_recovery'>('premium');
  const [requestSubmitting, setRequestSubmitting] = useState<number|null>(null);
  const [requestError, setRequestError] = useState<string|null>(null);
  const [requestCancelling, setRequestCancelling] = useState(false);
  const [staleEmailLink, setStaleEmailLink] = useState(false);
  // Count of past assignments (excluding the current one). Used by the
  // pending screen to decide whether to show a "view past sessions" link
  // — only meaningful for repeat Premium students.
  const [pastSessionsCount, setPastSessionsCount] = useState(0);

  // Single source of truth: call status API which checks DB + Stripe directly
  useEffect(() => {
    if (authStatus !== 'authenticated' || statusChecked) return;

    const checkStatus = async () => {
      try {
        // If returning from Stripe checkout, verify payment first
        if (paymentSuccess) {
          await fetch('/api/stripe/verify', { method: 'POST', cache: 'no-store' }).catch(() => {});
          await new Promise(r => setTimeout(r, 500));
        }

        // Fetch status, in-flight premium request, and plans in parallel.
        // We need premium_request *before* the state-based redirect so
        // a student with both an active Premium assignment AND a new
        // in-flight request lands on the request screen instead of
        // bouncing to /expert-portal. Plans are needed by the
        // awaiting_payment screen for its plan-detail card.
        const [statusRes, prRes, plansRes] = await Promise.all([
          fetch('/api/expert-sessions/status', { cache: 'no-store' }),
          fetch('/api/premium/request', { cache: 'no-store' }).catch(() => null),
          fetch('/api/expert-sessions/plans').catch(() => null),
        ]);
        const statusData = await statusRes.json();
        if (typeof statusData.past_sessions_count === 'number') {
          setPastSessionsCount(statusData.past_sessions_count);
        }
        const prData = prRes ? await prRes.json().catch(() => null) : null;
        const pr: PremiumRequest | null = prData?.request ?? null;
        setPremiumRequest(pr);
        setRequestType(prData?.type === 'pro_recovery' ? 'pro_recovery' : 'premium');
        const plansData = plansRes ? await plansRes.json().catch(() => ({ plans: [], counselors: [] })) : { plans: [], counselors: [] };
        setPlans(plansData.plans || []);
        setCounselors(plansData.counselors || []);

        if (pr?.status === 'pending_review') {
          setPageState('reviewing');
          setStatusChecked(true);
          return;
        }
        if (pr?.status === 'awaiting_payment') {
          setPageState('awaiting_payment');
          setStatusChecked(true);
          return;
        }

        // No in-flight request → fall through to existing routing.
        if ((statusData.state === 'active' || statusData.state === 'completed') && !browsePlans) {
          router.push('/expert-portal');
          return;
        }

        if (statusData.state === 'pending') {
          // Already paid (e.g. invoice.paid landed) — show awaiting-counselor.
          setAssignment(statusData.assignment);
          setPageState('pending');
          setStatusChecked(true);
          return;
        }

        // Plans are already fetched in parallel above; nothing to do here.

        // Stale email link: came from invoice email, but no live request.
        // Fall through to plans with a toast. fromEmail also trumps
        // "browsing" — we want plans visible, not the upgrade prompt.
        if (fromEmail && !pr) {
          setStaleEmailLink(true);
          setPageState('plans');
          setStatusChecked(true);
          return;
        }

        if (browsePlans || statusData.state === 'completed') {
          setPageState('plans');
          setStatusChecked(true);
          return;
        }

        const subRes = await fetch('/api/subscription/check', { cache: 'no-store' });
        const subData = await subRes.json();
        const tier = subData.tier || 'free';

        if (tier === 'free') {
          setPageState('upgrade_pro');
          setStatusChecked(true);
          return;
        }

        if (tier === 'pro') {
          if (subData.synced) updateSession();
          setPageState('plans');
          setStatusChecked(true);
          return;
        }

        // Premium but no assignments yet
        if (subData.synced) updateSession();
        setAssignment(statusData.assignment);
        setPageState('pending');
      } catch (e) {
        console.error('[ExpertSessions] Status check failed:', e);
        setPageState('upgrade_pro');
      }
      setStatusChecked(true);
    };

    checkStatus();
  }, [authStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase C — Premium plans now go through manual matching. The CTA
  // creates a premium_requests row and lands the student on the
  // "Request received" reviewing screen. Admin reviews and sends an
  // invoice; the student pays via Stripe's hosted page.
  const handleRequestMatch = async (plan: Plan) => {
    setRequestSubmitting(plan.id);
    setRequestError(null);
    try {
      const res = await fetch('/api/premium/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: plan.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 403) { window.location.href = '/subscribe?require_pro=1'; return; }
      if (!res.ok) {
        setRequestError(data.error || `Failed (${res.status})`);
        setRequestSubmitting(null);
        return;
      }
      // Re-fetch the request so we have the canonical row + show the
      // "reviewing" screen immediately without a full page reload.
      const prRes = await fetch('/api/premium/request', { cache: 'no-store' });
      const prData = await prRes.json().catch(() => ({}));
      setPremiumRequest(prData?.request ?? null);
      setPageState('reviewing');
      setStaleEmailLink(false);
    } catch (e: any) {
      setRequestError(e?.message || 'Network error');
    } finally {
      setRequestSubmitting(null);
    }
  };

  // Cancel works in both 'reviewing' (pending_review) and 'awaiting_payment'.
  // The route knows the difference and voids the Stripe invoice when needed.
  const handleCancelRequest = async () => {
    if (!premiumRequest || requestCancelling) return;
    if (!window.confirm('Cancel this premium request?')) return;
    setRequestCancelling(true);
    try {
      const res = await fetch(`/api/premium/request/${premiumRequest.id}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Cancel failed');
        return;
      }
      setPremiumRequest(null);
      setPageState('plans');
      setStaleEmailLink(false);
    } catch {
      alert('Network error');
    } finally {
      setRequestCancelling(false);
    }
  };

  // Stripe's hosted invoice page handles the actual payment; we just open
  // it in a new tab so the student keeps their context here.
  const handlePayNow = () => {
    if (premiumRequest?.hosted_invoice_url) {
      window.open(premiumRequest.hosted_invoice_url, '_blank', 'noopener,noreferrer');
    }
  };

  // Top-right floating pill that surfaces past sessions on every
  // holding-pattern screen (reviewing, awaiting_payment, pending).
  // Position is fixed against the main content area so it stays visible
  // regardless of how much the centered card scrolls. Returns null for
  // first-time students (count = 0) so they aren't pointed at an empty
  // portal. Centralized here so styling stays consistent across screens.
  const renderPastSessionsLink = () => {
    if (pastSessionsCount <= 0) return null;
    return (
      <a
        href="/expert-portal"
        style={ss({
          position:'fixed', top:24, right:24, zIndex:50,
          display:'inline-flex', alignItems:'center', gap:10,
          padding:'10px 16px', borderRadius:999,
          background:'#1c1917', color:'#FFE500',
          fontFamily:'inherit', fontSize:13, fontWeight:800,
          textDecoration:'none',
          boxShadow:'0 6px 20px rgba(0,0,0,.18)',
          transition:'transform .12s, box-shadow .12s',
        })}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.22)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.transform = '';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 20px rgba(0,0,0,.18)';
        }}
      >
        <i className="fas fa-clock-rotate-left" style={{fontSize:12}}></i>
        Past sessions
        <span style={ss({padding:'2px 7px',borderRadius:999,background:'#FFE500',color:'#1c1917',fontSize:10,fontWeight:900,marginLeft:2})}>{pastSessionsCount}</span>
        <i className="fas fa-arrow-right" style={{fontSize:10,opacity:.85}}></i>
      </a>
    );
  };

  const PA: Record<string,{accent:string;bg:string;border:string;icon:string;gradient:string}> = {
    'Starter':    {accent:'#0a2463',bg:'#ebeef8',border:'#b3bee6',icon:'fa-rocket',gradient:'linear-gradient(135deg,#0a2463,#1e40af)'},
    'Growth':     {accent:'#7c3aed',bg:'#f3f0ff',border:'#c4b5fd',icon:'fa-chart-line',gradient:'linear-gradient(135deg,#7c3aed,#a855f7)'},
    'Full Cycle': {accent:'#06a77d',bg:'#edfaf6',border:'#a3e4d0',icon:'fa-crown',gradient:'linear-gradient(135deg,#06a77d,#10b981)'},
  };

  if (pageState === 'loading') return (
    <AppShell><div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',color:'var(--stone-400)',fontSize:14})}><i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Loading…</div></AppShell>
  );

  // ═══ FREE USER — UPGRADE TO PRO FIRST ═══
  if (pageState === 'upgrade_pro') return (
    <AppShell>
      <div style={ss({flex:1,overflowY:'auto'})}>
        <UpgradePrompt feature="Expert Sessions" description="Expert Sessions are available to Pro members. Upgrade to Pro to unlock college matching, essay strategy, and then add premium counselor sessions." />
      </div>
    </AppShell>
  );

  // ═══ Phase C STATE: REVIEWING — admin hasn't responded yet ═══
  if (pageState === 'reviewing' && premiumRequest) return (
    <AppShell>
      <main style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'40px'})}>
        <div style={ss({maxWidth:520,textAlign:'center'})}>
          <div style={ss({width:72,height:72,borderRadius:'50%',background:'var(--amber-light)',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:20})}><i className="fas fa-clock" style={{fontSize:28,color:'#92400e'}}></i></div>
          <h1 style={ss({fontSize:24,fontWeight:900,letterSpacing:'-0.3px',marginBottom:8})}>Request received!</h1>
          <p style={ss({fontSize:15,fontWeight:500,color:'var(--stone-500)',lineHeight:1.6,marginBottom:24})}>
            Our team is reviewing your request and matching you with the right counselor. You'll receive a payment link by email shortly — usually within one business day.
          </p>
          <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'20px 24px',marginBottom:20,textAlign:'left'})}>
            <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:10})}>Your Request</div>
            <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between'})}>
              <div>
                <div style={ss({fontSize:18,fontWeight:900})}>{premiumRequest.plan_name}</div>
                <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-500)',marginTop:2})}>Quoted: {fmtPrice(premiumRequest.amount_cents_quoted)}</div>
              </div>
              <span style={ss({padding:'4px 12px',borderRadius:8,fontSize:11,fontWeight:800,background:'var(--amber-light)',color:'#92400e'})}>Under Review</span>
            </div>
          </div>
          <button onClick={handleCancelRequest} disabled={requestCancelling}
            style={ss({padding:'10px 22px',borderRadius:10,border:'1px solid var(--border)',background:'var(--card)',color:'var(--stone-600)',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:requestCancelling?'wait':'pointer'})}>
            {requestCancelling ? 'Cancelling…' : 'Cancel Request'}
          </button>
          {renderPastSessionsLink()}
          <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',marginTop:24})}>
            Questions? <a href="mailto:support@admitly.com" style={{color:'var(--blue)',fontWeight:700}}>support@admitly.com</a>
          </div>
        </div>
      </main>
    </AppShell>
  );

  // ═══ Phase D — Pro RECOVERY variant of AWAITING PAYMENT ═══
  // When the student is sitting on an admin-sent Pro recovery invoice
  // (failed Checkout earlier), we still want the "Your payment link is
  // ready" UX, but the Premium-shaped page (sessions count, counselor
  // features, "1-on-1" stat row) doesn't apply. This branch renders a
  // stripped-down version for Pro: amount + Pay Now + support — no
  // plan-detail card, no feature list. Same Cancel-text-link pattern.
  if (pageState === 'awaiting_payment' && premiumRequest && requestType === 'pro_recovery') {
    const amount = premiumRequest.amount_cents_invoiced ?? premiumRequest.amount_cents_quoted;
    return (
      <AppShell>
        <main style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'40px'})}>
          <div style={ss({maxWidth:520,textAlign:'center'})}>
            <div style={ss({width:72,height:72,borderRadius:'50%',background:'var(--emerald-light)',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:20})}>
              <i className="fas fa-credit-card" style={{fontSize:28,color:'var(--emerald)'}}></i>
            </div>
            <h1 style={ss({fontSize:24,fontWeight:900,letterSpacing:'-0.3px',marginBottom:8})}>Your Pro payment link is ready</h1>
            <p style={ss({fontSize:15,fontWeight:500,color:'var(--stone-500)',lineHeight:1.6,marginBottom:24})}>
              Your earlier payment didn't go through. We've prepared a fresh, secure payment link — pay through Stripe and your Pro access activates immediately.
            </p>
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'20px 24px',marginBottom:20,textAlign:'left'})}>
              <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:10})}>Invoice</div>
              <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                <div>
                  <div style={ss({fontSize:18,fontWeight:900})}>Admitly Pro</div>
                  <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-500)',marginTop:2})}>{fmtPrice(amount)}</div>
                </div>
                <span style={ss({padding:'4px 12px',borderRadius:8,fontSize:11,fontWeight:800,background:'var(--emerald-light)',color:'var(--emerald)'})}>Awaiting Payment</span>
              </div>
            </div>
            <div style={ss({display:'flex',justifyContent:'center'})}>
              <button onClick={handlePayNow} disabled={!premiumRequest.hosted_invoice_url}
                style={ss({padding:'14px 36px',borderRadius:12,border:'none',background:premiumRequest.hosted_invoice_url?'var(--stone-900)':'var(--stone-300)',color:'#fff',fontFamily:'inherit',fontSize:15,fontWeight:800,cursor:premiumRequest.hosted_invoice_url?'pointer':'not-allowed',display:'inline-flex',alignItems:'center',gap:10,boxShadow:'0 4px 14px rgba(0,0,0,.08)'})}>
                <i className="fas fa-lock" style={{fontSize:12}}></i>Pay {fmtPrice(amount)} Now →
              </button>
            </div>
            <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',marginTop:14})}>
              Opens Stripe's secure payment page in a new tab.
            </div>
            <div style={ss({display:'flex',justifyContent:'center',gap:24,marginTop:24,paddingTop:18,borderTop:'1px solid var(--border)'})}>
              {[
                {icon:'fa-shield-halved',text:'Secured by Stripe'},
                {icon:'fa-lock',text:'Your data stays private'},
              ].map(t => (
                <div key={t.text} style={ss({display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:600,color:'var(--stone-400)'})}>
                  <i className={`fas ${t.icon}`} style={{fontSize:11,color:'var(--stone-300)'}}></i>{t.text}
                </div>
              ))}
            </div>
            <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)',marginTop:18})}>
              Questions? <a href="mailto:support@admitly.com" style={{color:'var(--blue)',fontWeight:700}}>support@admitly.com</a>
            </div>
          </div>
        </main>
      </AppShell>
    );
  }

  // ═══ Phase C STATE: AWAITING PAYMENT (Premium) — admin sent the invoice ═══
  // Redesigned to remind the student of what they're about to pay for:
  // plan icon, full description, sessions cadence, feature list — drawn
  // directly from /api/expert-sessions/plans rather than just the row's
  // plan_name. The "cancel" affordance is intentionally a small, low-
  // contrast text link below the support footer (not a button) so that
  // a wavering student doesn't accidentally back out.
  if (pageState === 'awaiting_payment' && premiumRequest) {
    const expiresAt = premiumRequest.invoice_expires_at ? new Date(premiumRequest.invoice_expires_at) : null;
    const hoursLeft = expiresAt ? Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 3600_000)) : null;
    const amount = premiumRequest.amount_cents_invoiced ?? premiumRequest.amount_cents_quoted;
    // Match the student's chosen plan against the live plans list. We
    // fall back to a minimal stub if the plan was deleted/renamed
    // between request and payment so the screen still renders.
    const matchedPlan = plans.find(p => p.id === premiumRequest.plan_id);
    const cfg = PA[premiumRequest.plan_name] || PA[matchedPlan?.name || ''] || PA['Starter'];
    const sessionsCount = matchedPlan?.sessions ?? 1;
    const sessionDuration = sessionsCount <= 3 ? 45 : 60;
    const features = matchedPlan?.features ?? [];

    return (
      <AppShell>
        <main style={ss({flex:1,overflowY:'auto',padding:'36px 24px 80px'})}>
          <div style={ss({maxWidth:640,margin:'0 auto'})}>

            {/* Header band */}
            <div style={ss({textAlign:'center',marginBottom:28})}>
              <div style={ss({width:64,height:64,borderRadius:'50%',background:'var(--emerald-light)',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:16})}>
                <i className="fas fa-credit-card" style={{fontSize:24,color:'var(--emerald)'}}></i>
              </div>
              <h1 style={ss({fontSize:26,fontWeight:900,letterSpacing:'-0.4px',marginBottom:6})}>Your payment link is ready</h1>
              <p style={ss({fontSize:14,fontWeight:500,color:'var(--stone-500)',lineHeight:1.55,maxWidth:460,margin:'0 auto'})}>
                Review what's included below, then pay securely through Stripe. Your counselor is notified the moment payment clears.
              </p>
            </div>

            {/* Plan summary card — mirrors the plan card the student
                originally chose so they recognize it. */}
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:16,overflow:'hidden',marginBottom:20})}>
              {/* Top: gradient stripe + plan identity */}
              <div style={ss({background:cfg.gradient,padding:'18px 24px',display:'flex',alignItems:'center',gap:14,color:'#fff'})}>
                <div style={ss({width:46,height:46,borderRadius:12,background:'rgba(255,255,255,.18)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0})}>
                  <i className={`fas ${cfg.icon}`}></i>
                </div>
                <div style={ss({flex:1,minWidth:0})}>
                  <div style={ss({fontSize:11,fontWeight:700,opacity:.8,textTransform:'uppercase',letterSpacing:'.5px',marginBottom:2})}>Premium Plan</div>
                  <div style={ss({fontSize:20,fontWeight:900,letterSpacing:'-.3px'})}>{premiumRequest.plan_name}</div>
                </div>
                <div style={ss({textAlign:'right'})}>
                  <div style={ss({fontSize:11,fontWeight:700,opacity:.8,textTransform:'uppercase',letterSpacing:'.5px'})}>Total</div>
                  <div style={ss({fontSize:24,fontWeight:900,letterSpacing:'-.5px'})}>{fmtPrice(amount)}</div>
                </div>
              </div>

              {/* Stat row: sessions / duration / 1-on-1 */}
              <div style={ss({display:'grid',gridTemplateColumns:'repeat(3,1fr)',padding:'16px 0',borderBottom:'1px solid var(--border-light)'})}>
                {[
                  {label:'Sessions',     value:String(sessionsCount), icon:'fa-video'},
                  {label:'Per session',  value:`${sessionDuration} min`, icon:'fa-clock'},
                  {label:'Format',       value:'1-on-1',           icon:'fa-user-tie'},
                ].map((m, i, arr) => (
                  <div key={m.label} style={ss({display:'flex',flexDirection:'column',alignItems:'center',padding:'8px 12px',borderRight:i<arr.length-1?'1px solid var(--border-light)':'none'})}>
                    <i className={`fas ${m.icon}`} style={{fontSize:13,color:cfg.accent,marginBottom:6}}></i>
                    <div style={ss({fontSize:16,fontWeight:900,letterSpacing:'-.2px'})}>{m.value}</div>
                    <div style={ss({fontSize:10,fontWeight:600,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.4px',marginTop:2})}>{m.label}</div>
                  </div>
                ))}
              </div>

              {/* Description */}
              {matchedPlan?.description && (
                <div style={ss({padding:'16px 24px',borderBottom:'1px solid var(--border-light)'})}>
                  <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:6})}>About this plan</div>
                  <p style={ss({fontSize:13,fontWeight:500,color:'var(--stone-700)',lineHeight:1.6,margin:0})}>{matchedPlan.description}</p>
                </div>
              )}

              {/* Features list — what they're paying for */}
              {features.length > 0 && (
                <div style={ss({padding:'16px 24px',borderBottom:'1px solid var(--border-light)'})}>
                  <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:10})}>What's included</div>
                  <div style={ss({display:'flex',flexDirection:'column',gap:8})}>
                    {features.slice(0,8).map((f, fi) => (
                      <div key={fi} style={ss({display:'flex',alignItems:'flex-start',gap:10,fontSize:13,fontWeight:500,color:'var(--stone-700)',lineHeight:1.5})}>
                        <i className="fas fa-check-circle" style={{color:cfg.accent,fontSize:13,marginTop:2,flexShrink:0}}></i>
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Always-on inclusions — same six chips from the plans page */}
              <div style={ss({padding:'16px 24px'})}>
                <div style={ss({fontSize:10,fontWeight:800,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.5px',marginBottom:10})}>In every Premium plan</div>
                <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr',gap:10})}>
                  {[
                    {icon:'fa-video',         label:'Private Zoom sessions'},
                    {icon:'fa-comments',      label:'Direct messaging'},
                    {icon:'fa-pen-fancy',     label:'Line-by-line essay review'},
                    {icon:'fa-list-check',    label:'Action items each session'},
                    {icon:'fa-calendar-check',label:'Flexible scheduling'},
                    {icon:'fa-file-lines',    label:'Session notes saved'},
                  ].map(it => (
                    <div key={it.label} style={ss({display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:600,color:'var(--stone-600)'})}>
                      <i className={`fas ${it.icon}`} style={{fontSize:11,color:'var(--stone-400)',width:14}}></i>{it.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Pay Now — single primary CTA */}
            <div style={ss({textAlign:'center'})}>
              <button onClick={handlePayNow} disabled={!premiumRequest.hosted_invoice_url}
                style={ss({padding:'14px 36px',borderRadius:12,border:'none',background:premiumRequest.hosted_invoice_url?cfg.gradient:'var(--stone-300)',color:'#fff',fontFamily:'inherit',fontSize:15,fontWeight:800,cursor:premiumRequest.hosted_invoice_url?'pointer':'not-allowed',display:'inline-flex',alignItems:'center',gap:10,boxShadow:'0 4px 14px rgba(0,0,0,.08)',letterSpacing:'-.1px'})}>
                <i className="fas fa-lock" style={{fontSize:12}}></i>Pay {fmtPrice(amount)} Now →
              </button>
              <div style={ss({fontSize:11,fontWeight:500,color:'var(--stone-400)',marginTop:12})}>
                Opens Stripe's secure payment page in a new tab.
                {hoursLeft !== null && hoursLeft > 0 && <> · Link expires in ~{hoursLeft}h.</>}
              </div>
            </div>

            {/* Trust strip */}
            <div style={ss({display:'flex',justifyContent:'center',gap:24,marginTop:28,paddingTop:18,borderTop:'1px solid var(--border)'})}>
              {[
                {icon:'fa-shield-halved',text:'Secured by Stripe'},
                {icon:'fa-rotate-left',text:'Refundable if unmatched'},
                {icon:'fa-lock',text:'Your data stays private'},
              ].map(t => (
                <div key={t.text} style={ss({display:'flex',alignItems:'center',gap:6,fontSize:11,fontWeight:600,color:'var(--stone-400)'})}>
                  <i className={`fas ${t.icon}`} style={{fontSize:11,color:'var(--stone-300)'}}></i>{t.text}
                </div>
              ))}
            </div>

            {/* Past sessions link — only renders for repeat students.
                Sits between trust strip and support so it reads as
                "by the way, your previous sessions are still here". */}
            {renderPastSessionsLink()}

            {/* Support */}
            <div style={ss({textAlign:'center',fontSize:12,fontWeight:500,color:'var(--stone-400)',marginTop:20})}>
              Questions? <a href="mailto:support@admitly.com" style={{color:'var(--blue)',fontWeight:700}}>support@admitly.com</a>
            </div>

            {/* Cancel — intentionally low-emphasis text-link, well below
                the primary CTA, so the affordance still exists for the
                rare student who needs it without competing for their
                attention against Pay Now. */}
            <div style={ss({textAlign:'center',marginTop:36,opacity:.55})}>
              <button onClick={handleCancelRequest} disabled={requestCancelling}
                style={ss({background:'none',border:'none',padding:0,fontFamily:'inherit',fontSize:11,fontWeight:500,color:'var(--stone-400)',cursor:requestCancelling?'wait':'pointer',textDecoration:'underline',textUnderlineOffset:2})}>
                {requestCancelling ? 'cancelling…' : 'changed your mind? cancel this request'}
              </button>
            </div>

          </div>
        </main>
      </AppShell>
    );
  }

  // ═══ STATE 1: PLAN SELECTION ═══
  if (pageState === 'plans') return (
    <AppShell>
      <main style={ss({flex:1,overflowY:'auto',padding:'36px 36px 48px',maxWidth:960})}>
        {/* Phase C — stale-link toast (came from invoice email but no
            active request exists). Sits above the hero so it doesn't
            get lost. */}
        {staleEmailLink && (
          <div style={ss({background:'var(--amber-light)',border:'1px solid #fde68a',borderRadius:12,padding:'12px 16px',marginBottom:24,display:'flex',alignItems:'flex-start',gap:10})}>
            <i className="fas fa-circle-exclamation" style={{fontSize:14,color:'#92400e',marginTop:2}}></i>
            <div style={ss({flex:1,fontSize:13,color:'#78350f',lineHeight:1.55})}>
              <strong style={{color:'#92400e'}}>This request is no longer active.</strong>{' '}
              The payment link you clicked has expired or was cancelled. You can start a new request below.
            </div>
            <button onClick={()=>setStaleEmailLink(false)} style={ss({background:'none',border:'none',cursor:'pointer',color:'#92400e',fontSize:13,padding:2})}>
              <i className="fas fa-xmark"></i>
            </button>
          </div>
        )}

        {/* Phase C — request error toast (server-side conflict, etc.) */}
        {requestError && (
          <div style={ss({background:'var(--red-light)',border:'1px solid #fecaca',borderRadius:12,padding:'12px 16px',marginBottom:24,display:'flex',alignItems:'flex-start',gap:10})}>
            <i className="fas fa-circle-exclamation" style={{fontSize:14,color:'#991b1b',marginTop:2}}></i>
            <div style={ss({flex:1,fontSize:13,color:'#7f1d1d',lineHeight:1.55})}>{requestError}</div>
            <button onClick={()=>setRequestError(null)} style={ss({background:'none',border:'none',cursor:'pointer',color:'#991b1b',fontSize:13,padding:2})}>
              <i className="fas fa-xmark"></i>
            </button>
          </div>
        )}

        {/* Hero */}
        <div style={ss({textAlign:'center',marginBottom:40})}>
          <div style={ss({display:'inline-flex',alignItems:'center',gap:6,background:'var(--yellow)',padding:'5px 14px',borderRadius:8,fontSize:11,fontWeight:800,color:'var(--stone-900)',marginBottom:14})}><i className="fas fa-crown" style={{fontSize:10}}></i> Premium Program</div>
          <h1 style={ss({fontSize:32,fontWeight:900,letterSpacing:'-0.8px',lineHeight:1.15,marginBottom:8})}>Work 1-on-1 with an<br/>admissions expert</h1>
          <p style={ss({fontSize:15,fontWeight:500,color:'var(--stone-400)',maxWidth:480,margin:'0 auto',lineHeight:1.65})}>Get personalized guidance from experienced counselors who know what top schools are looking for — essays, strategy, and everything in between.</p>
        </div>

        {/* Plan cards */}
        <div style={ss({display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:32})}>
          {plans.map((p,i)=>{
            const cfg=PA[p.name]||PA['Starter']; const pop=i===1; const loading=checkingOut===p.id;
            return (
              <div key={p.id} style={ss({background:'var(--card)',border:`${pop?'2px':'1px'} solid ${pop?cfg.accent:'var(--border)'}`,borderRadius:16,padding:'24px 22px',position:'relative',display:'flex',flexDirection:'column',transition:'transform .15s,box-shadow .15s'})}>
                {pop&&<div style={ss({position:'absolute',top:-11,left:'50%',transform:'translateX(-50%)',background:cfg.gradient,color:'#fff',padding:'4px 16px',borderRadius:20,fontSize:10,fontWeight:800,textTransform:'uppercase',letterSpacing:'0.6px',whiteSpace:'nowrap',boxShadow:'0 2px 8px rgba(124,58,237,.3)'})}>Most Popular</div>}
                <div style={ss({width:44,height:44,borderRadius:12,background:cfg.bg,border:`1px solid ${cfg.border}`,display:'flex',alignItems:'center',justifyContent:'center',color:cfg.accent,fontSize:16,marginBottom:16})}><i className={`fas ${cfg.icon}`}></i></div>
                <div style={ss({fontSize:18,fontWeight:900,marginBottom:4})}>{p.name}</div>
                <div style={ss({fontSize:11,fontWeight:600,color:'var(--stone-400)',marginBottom:16})}>{p.sessions} session{p.sessions>1?'s':''} · {p.sessions<=3?'45':'60'} min each</div>
                <div style={ss({display:'flex',alignItems:'baseline',gap:4,marginBottom:16})}>
                  {p.discounted_price_cents?<><span style={ss({fontSize:36,fontWeight:900,color:cfg.accent,letterSpacing:'-1.5px'})}>{fmtPrice(p.discounted_price_cents)}</span><span style={ss({fontSize:15,fontWeight:600,color:'var(--stone-300)',textDecoration:'line-through'})}>{fmtPrice(p.price_cents)}</span></>
                  :<span style={ss({fontSize:36,fontWeight:900,color:cfg.accent,letterSpacing:'-1.5px'})}>{fmtPrice(p.price_cents)}</span>}
                </div>
                <p style={ss({fontSize:12,fontWeight:500,color:'var(--stone-500)',lineHeight:1.6,marginBottom:18,flex:1})}>{p.description}</p>
                <div style={ss({display:'flex',flexDirection:'column',gap:8,marginBottom:20})}>
                  {(p.features||[]).slice(0,5).map((f,fi)=><div key={fi} style={ss({display:'flex',alignItems:'flex-start',gap:8,fontSize:12,fontWeight:600,color:'var(--stone-600)'})}><i className="fas fa-check" style={{color:cfg.accent,fontSize:10,marginTop:3,flexShrink:0}}></i>{f}</div>)}
                </div>
                {/* Phase C — manual-matching CTA. Submitting creates a
                    premium_requests row; admin reviews and sends an
                    invoice. The button text and disabled state reflect
                    the new workflow. */}
                <button onClick={()=>handleRequestMatch(p)} disabled={requestSubmitting!==null}
                  style={ss({width:'100%',padding:'12px 0',borderRadius:12,fontFamily:'inherit',fontSize:14,fontWeight:800,cursor:requestSubmitting!==null?'wait':'pointer',background:requestSubmitting===p.id?'var(--stone-300)':pop?cfg.gradient:'var(--stone-50)',color:pop||requestSubmitting===p.id?'#fff':'var(--stone-700)',border:pop||requestSubmitting===p.id?'none':'1px solid var(--border)',transition:'all .15s,transform .1s',display:'flex',alignItems:'center',justifyContent:'center',gap:6})}>
                  {requestSubmitting===p.id?<><i className="fas fa-spinner fa-spin" style={{fontSize:11}}></i>Submitting…</>:'Request Match →'}
                </button>
              </div>
            );
          })}
          {plans.length===0&&[1,2,3].map(i=><div key={i} style={ss({background:'var(--stone-50)',borderRadius:16,padding:60,textAlign:'center'})}><div style={ss({width:48,height:8,borderRadius:4,background:'var(--stone-200)',margin:'0 auto'})}></div></div>)}
        </div>

        {/* What you get — dark card */}
        <div style={ss({background:'var(--stone-900)',borderRadius:16,padding:'28px 32px',color:'#fff'})}>
          <div style={ss({fontSize:11,fontWeight:800,color:'rgba(255,255,255,.4)',textTransform:'uppercase',letterSpacing:'0.6px',marginBottom:18,display:'flex',alignItems:'center',gap:8})}><i className="fas fa-sparkles" style={{fontSize:11,color:'var(--yellow)'}}></i> Included in Every Plan</div>
          <div style={ss({display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16})}>
            {[
              {icon:'fa-video',label:'Video Sessions',desc:'Private 1-on-1 calls via Zoom'},
              {icon:'fa-comments',label:'Direct Messaging',desc:'Async chat between sessions'},
              {icon:'fa-pen-fancy',label:'Essay Review',desc:'Line-by-line feedback on drafts'},
              {icon:'fa-list-check',label:'Action Items',desc:'Clear next steps after every session'},
              {icon:'fa-calendar-check',label:'Flexible Scheduling',desc:'Book sessions that fit your calendar'},
              {icon:'fa-file-lines',label:'Session Notes',desc:'Everything documented and accessible'},
            ].map(f=>(
              <div key={f.label} style={ss({display:'flex',alignItems:'flex-start',gap:10})}>
                <div style={ss({width:32,height:32,borderRadius:9,background:'rgba(255,255,255,.06)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'var(--yellow)',flexShrink:0,marginTop:1})}><i className={`fas ${f.icon}`}></i></div>
                <div><div style={ss({fontSize:12,fontWeight:700})}>{f.label}</div><div style={ss({fontSize:10,fontWeight:500,color:'rgba(255,255,255,.35)',marginTop:2,lineHeight:1.4})}>{f.desc}</div></div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ / trust strip */}
        <div style={ss({display:'flex',justifyContent:'center',gap:32,marginTop:28,paddingTop:20,borderTop:'1px solid var(--border)'})}>
          {[
            {icon:'fa-shield-halved',text:'Secure payments via Stripe'},
            {icon:'fa-rotate-left',text:'Full refund if not matched'},
            {icon:'fa-lock',text:'Your data stays private'},
          ].map(t=>(
            <div key={t.text} style={ss({display:'flex',alignItems:'center',gap:8,fontSize:11,fontWeight:600,color:'var(--stone-400)'})}><i className={`fas ${t.icon}`} style={{fontSize:12,color:'var(--stone-300)'}}></i>{t.text}</div>
          ))}
        </div>
      </main>
    </AppShell>
  );

  // ═══ STATE 2: PENDING ═══
  if (pageState === 'pending') return (
    <AppShell>
      <main style={ss({flex:1,display:'flex',alignItems:'center',justifyContent:'center',padding:'40px'})}>
        <div style={ss({maxWidth:520,textAlign:'center'})}>
          <div style={ss({width:72,height:72,borderRadius:'50%',background:'var(--emerald-light)',display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:20})}><i className="fas fa-check" style={{fontSize:28,color:'var(--emerald)'}}></i></div>
          <h1 style={ss({fontSize:24,fontWeight:900,letterSpacing:'-0.3px',marginBottom:8})}>Payment Confirmed!</h1>
          <p style={ss({fontSize:15,fontWeight:500,color:'var(--stone-500)',lineHeight:1.6,marginBottom:24})}>We're matching you with the perfect counselor. You'll receive an email once your counselor accepts.</p>

          {assignment && (
            <div style={ss({background:'var(--card)',border:'1px solid var(--border)',borderRadius:14,padding:'20px 24px',marginBottom:20,textAlign:'left'})}>
              <div style={ss({fontSize:10,fontWeight:700,color:'var(--stone-400)',textTransform:'uppercase',letterSpacing:'.3px',marginBottom:10})}>Your Plan</div>
              <div style={ss({display:'flex',alignItems:'center',justifyContent:'space-between'})}>
                <div>
                  <div style={ss({fontSize:18,fontWeight:900})}>{assignment.plan}</div>
                  <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-500)',marginTop:2})}>{assignment.sessionsTotal} session{assignment.sessionsTotal!==1?'s':''} · 60 min each</div>
                </div>
                <span style={ss({padding:'4px 12px',borderRadius:8,fontSize:11,fontWeight:800,background:'var(--amber-light)',color:'#92400e'})}>Awaiting Counselor</span>
              </div>
            </div>
          )}

          <div style={ss({display:'flex',alignItems:'center',justifyContent:'center',gap:10,padding:'16px 20px',background:'var(--stone-50)',borderRadius:12,marginBottom:20})}>
            <div style={ss({width:8,height:8,borderRadius:4,background:'var(--emerald)',animation:'pulse 2s infinite'})}></div>
            <span style={ss({fontSize:13,fontWeight:600,color:'var(--stone-500)'})}>{assignment ? 'Waiting for counselor to accept…' : 'Matching in progress…'}</span>
          </div>

          <div style={ss({display:'flex',flexDirection:'column',gap:0,textAlign:'left',marginBottom:24})}>
            {[
              {icon:'fa-credit-card',label:'Payment received',done:true},
              {icon:'fa-user-plus',label:'Counselor assigned',done:!!assignment},
              {icon:'fa-envelope',label:'Counselor notified',done:!!assignment},
              {icon:'fa-handshake',label:'Counselor accepts',done:false},
              {icon:'fa-video',label:'First session scheduled',done:false},
            ].map((step,i)=>(
              <div key={i} style={ss({display:'flex',alignItems:'center',gap:12,padding:'10px 0'})}>
                <div style={ss({width:32,height:32,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,flexShrink:0,background:step.done?'var(--emerald-light)':'var(--stone-100)',color:step.done?'var(--emerald)':'var(--stone-300)',border:`2px solid ${step.done?'var(--emerald)':'var(--stone-200)'}`})}><i className={`fas ${step.done?'fa-check':step.icon}`}></i></div>
                <span style={ss({fontSize:13,fontWeight:step.done?700:500,color:step.done?'var(--stone-700)':'var(--stone-400)'})}>{step.label}</span>
              </div>
            ))}
          </div>

          {/* Repeat-Premium students get a link back to their previous
              sessions while they wait. First-time students don't see
              this — pastSessionsCount=0 returns null. */}
          {renderPastSessionsLink()}
          <div style={ss({fontSize:12,fontWeight:500,color:'var(--stone-400)'})}>Questions? <a href="mailto:support@admitly.com" style={{color:'var(--blue)',fontWeight:700}}>support@admitly.com</a></div>
          <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`}</style>
        </div>
      </main>
    </AppShell>
  );

  // ═══ STATE 3: ACTIVE — Redirect to portal ═══
  router.push('/expert-portal');
  return (
    <AppShell><div style={ss({display:'flex',alignItems:'center',justifyContent:'center',height:'60vh',color:'var(--stone-400)',fontSize:14})}><i className="fas fa-spinner fa-spin" style={{marginRight:10,fontSize:18}}></i>Opening your expert portal…</div></AppShell>
  );
}
