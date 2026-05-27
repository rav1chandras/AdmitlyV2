'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';

const ss = (o: React.CSSProperties) => o;

interface Plan {
  id: number; name: string; sessions: number; price_cents: number;
  discounted_price_cents: number | null; description: string; features: string[];
}

function CheckoutInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const planName = searchParams.get('plan') || '';

  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'unauthenticated') { router.push('/login'); return; }
    fetch('/api/expert-sessions/plans')
      .then(r => r.json())
      .then(data => {
        const match = (data.plans || []).find((p: Plan) =>
          p.name.toLowerCase() === planName.toLowerCase()
        );
        if (match) setPlan(match);
        else setError(`Plan "${planName}" not found.`);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load plan.'); setLoading(false); });
  }, [status, planName, router]);

  const handleCheckout = async () => {
    if (!plan) return;
    setCheckingOut(true);
    setError('');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: `premium_${plan.id}` }),
      });
      const data = await res.json();
      if (res.status === 403) {
        window.location.href = '/subscribe?require_pro=1';
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Failed to create checkout session.');
        setCheckingOut(false);
      }
    } catch {
      setError('Network error. Please try again.');
      setCheckingOut(false);
    }
  };

  const price = plan?.discounted_price_cents ?? plan?.price_cents ?? 0;
  const originalPrice = plan?.discounted_price_cents ? plan.price_cents : null;

  if (loading) {
    return (
      <AppShell>
        <div style={ss({ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--stone-400)', fontSize: 14 })}>
          <i className="fas fa-spinner fa-spin" style={{ marginRight: 10, fontSize: 18 }}></i>Loading plan...
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main style={ss({ flex: 1, padding: '40px', maxWidth: 600, margin: '0 auto' })}>
        <button onClick={() => router.push('/expert-sessions')}
          style={ss({ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--stone-400)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginBottom: 24 })}>
          <i className="fas fa-arrow-left" style={{ fontSize: 10 }}></i>Back to plans
        </button>

        {error && !plan && (
          <div style={ss({ background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 12, padding: '20px', textAlign: 'center' })}>
            <div style={ss({ fontSize: 14, fontWeight: 700, color: 'var(--red)', marginBottom: 8 })}>{error}</div>
            <button onClick={() => router.push('/expert-sessions')}
              style={ss({ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--stone-900)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' })}>
              View All Plans
            </button>
          </div>
        )}

        {plan && (
          <div style={ss({ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' })}>
            {/* Header */}
            <div style={ss({ padding: '28px 28px 20px', borderBottom: '1px solid var(--border-light)' })}>
              <div style={ss({ fontSize: 10, fontWeight: 700, color: 'var(--stone-400)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 })}>Expert Sessions</div>
              <h1 style={ss({ fontSize: 24, fontWeight: 900, margin: 0, letterSpacing: '-0.3px' })}>{plan.name}</h1>
              <p style={ss({ fontSize: 13, fontWeight: 500, color: 'var(--stone-500)', marginTop: 6 })}>{plan.description}</p>
            </div>

            {/* Price */}
            <div style={ss({ padding: '20px 28px', background: 'var(--stone-50)', display: 'flex', alignItems: 'baseline', gap: 8 })}>
              <span style={ss({ fontSize: 36, fontWeight: 900 })}>${(price / 100).toFixed(0)}</span>
              {originalPrice && (
                <span style={ss({ fontSize: 16, fontWeight: 600, color: 'var(--stone-400)', textDecoration: 'line-through' })}>${(originalPrice / 100).toFixed(0)}</span>
              )}
              <span style={ss({ fontSize: 13, fontWeight: 500, color: 'var(--stone-400)' })}>one-time</span>
            </div>

            {/* Features */}
            <div style={ss({ padding: '20px 28px' })}>
              <div style={ss({ fontSize: 11, fontWeight: 700, color: 'var(--stone-400)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 10 })}>What's included</div>
              <div style={ss({ display: 'flex', flexDirection: 'column', gap: 8 })}>
                <div style={ss({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 })}>
                  <i className="fas fa-video" style={{ color: 'var(--emerald)', fontSize: 11, width: 16 }}></i>
                  {plan.sessions} video session{plan.sessions !== 1 ? 's' : ''} (60 min each)
                </div>
                {(plan.features || []).map((f, i) => (
                  <div key={i} style={ss({ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--stone-600)' })}>
                    <i className="fas fa-check" style={{ color: 'var(--emerald)', fontSize: 9, width: 16 }}></i>{f}
                  </div>
                ))}
              </div>
            </div>

            {/* Checkout button */}
            <div style={ss({ padding: '20px 28px 28px' })}>
              {error && plan && (
                <div style={ss({ fontSize: 12, fontWeight: 600, color: 'var(--red)', marginBottom: 10, padding: '8px 12px', background: 'var(--red-light)', borderRadius: 8 })}>{error}</div>
              )}
              <button onClick={handleCheckout} disabled={checkingOut}
                style={ss({
                  width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                  background: checkingOut ? 'var(--stone-300)' : 'var(--stone-900)',
                  color: '#fff', fontSize: 14, fontWeight: 800, cursor: checkingOut ? 'wait' : 'pointer',
                  fontFamily: 'inherit', transition: 'all .15s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                })}>
                {checkingOut ? (
                  <><i className="fas fa-spinner fa-spin" style={{ fontSize: 12 }}></i>Redirecting to Stripe...</>
                ) : (
                  <><i className="fas fa-lock" style={{ fontSize: 10 }}></i>Pay ${(price / 100).toFixed(0)} — Secure Checkout</>
                )}
              </button>
              <div style={ss({ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, fontSize: 10, fontWeight: 500, color: 'var(--stone-400)' })}>
                <i className="fab fa-stripe" style={{ fontSize: 14, color: '#635bff' }}></i>
                Powered by Stripe · 256-bit encryption
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}

export default function ExpertCheckoutPage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#a8a29e', fontSize: 14 }}><i className="fas fa-spinner fa-spin" style={{ marginRight: 10 }}></i>Loading...</div>}>
      <CheckoutInner />
    </Suspense>
  );
}
