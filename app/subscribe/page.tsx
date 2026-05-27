'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { UpgradePrompt } from '@/components/UpgradePrompt';
import { useProCheck } from '@/lib/useProCheck';

const ss = (o: React.CSSProperties) => o;

function SubscribeContent() {
  const searchParams = useSearchParams();
  const cancelled = searchParams?.get('cancelled') === '1';
  const requirePro = searchParams?.get('require_pro') === '1';
  const { isPaid, isPremium } = useProCheck();

  // If already premium, redirect context
  const tier = isPaid && !isPremium ? 'premium' : 'pro';

  return (
    <AppShell>
      <div style={ss({ flex: 1, overflowY: 'auto' })}>
        {requirePro && (
          <div style={ss({ maxWidth: 520, margin: '20px auto 0', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 })}>
            <i className="fas fa-lock" style={{ color: '#d97706', fontSize: 13 }}></i>
            <span style={ss({ fontSize: 12, fontWeight: 600, color: '#92400e' })}>Pro subscription is required before purchasing Expert Sessions. Upgrade to Pro first to unlock premium plans.</span>
          </div>
        )}
        {cancelled && (
          <div style={ss({ maxWidth: 520, margin: '20px auto 0', background: 'var(--red-light)', border: '1px solid #fecaca', borderRadius: 14, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 })}>
            <i className="fas fa-circle-info" style={{ color: '#dc2626', fontSize: 13 }}></i>
            <span style={ss({ fontSize: 12, fontWeight: 600, color: '#dc2626' })}>Payment cancelled — you can subscribe anytime. Your account is saved.</span>
          </div>
        )}
        <UpgradePrompt tier={tier} feature="full access" />
      </div>
    </AppShell>
  );
}

export default function SubscribePage() {
  return (
    <Suspense fallback={null}>
      <SubscribeContent />
    </Suspense>
  );
}
