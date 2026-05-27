'use client';

/**
 * useProCheck — client-side hook for subscription tier access.
 *
 * Calls /api/subscription/check on mount which checks DB + Stripe directly.
 * Does NOT rely solely on stale JWT session data for tier determination.
 */

import { useSession } from 'next-auth/react';
import { useEffect, useState, useRef } from 'react';

export type AccessTier = 'free' | 'pro' | 'premium';

interface ProCheck {
  tier: AccessTier;
  isPro: boolean;
  isPremium: boolean;
  isPaid: boolean;
  isExpiredPro: boolean;
  isExpiredPremium: boolean;
  score: number | null;
  loading: boolean;
}

export function useProCheck(): ProCheck {
  const { data: session, status, update: updateSession } = useSession();
  const [tier, setTier] = useState<AccessTier>('free');
  const [expired, setExpired] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [tierLoading, setTierLoading] = useState(true);
  const checked = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated' || checked.current) return;
    checked.current = true;

    // Quick initial read from JWT (may be stale but gives instant UI)
    const jwtTier = ((session?.user as any)?.subscription_status || 'free') as string;
    if (jwtTier === 'pro' || jwtTier === 'premium') {
      setTier(jwtTier as AccessTier);
      setTierLoading(false);
    }

    // Then verify against DB + Stripe (authoritative)
    fetch('/api/subscription/check', { cache: 'no-store' })
      .then(r => r.json())
      .then(data => {
        const realTier = (data.tier || 'free') as AccessTier;
        setTier(realTier);
        setExpired(!!data.expired);
        setTierLoading(false);

        // If tier changed, refresh the session so sidebar + other components pick it up
        if (realTier !== jwtTier && data.synced) {
          updateSession();
        }
      })
      .catch(() => {
        setTier(jwtTier as AccessTier);
        setTierLoading(false);
      });

    // Fetch profile score for free users (shown in UpgradePrompt)
    if (jwtTier === 'free') {
      fetch('/api/profile')
        .then(r => r.ok ? r.json() : null)
        .then(p => { if (p?.final_score) setScore(p.final_score); })
        .catch(() => {});
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    tier,
    // Pro access: active pro OR active premium OR expired premium (they paid for Pro before upgrading)
    isPro: tier === 'pro' ? !expired : tier === 'premium',
    isPremium: tier === 'premium' && !expired,
    // isPaid: has any active paid access (Pro or Premium)
    isPaid: tier === 'pro' ? !expired : tier === 'premium',
    isExpiredPro: tier === 'pro' && expired,
    isExpiredPremium: tier === 'premium' && expired,
    score,
    loading: status === 'loading' || tierLoading,
  };
}
