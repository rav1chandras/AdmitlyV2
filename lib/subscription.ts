/**
 * lib/subscription.ts — SERVER-ONLY subscription access helpers.
 *
 * Use in API routes and server components only.
 * For client components use lib/useProCheck.ts instead.
 *
 * DO NOT import this file from any 'use client' component — it chains
 * to lib/auth.ts → lib/db_admin.ts → pg (Node.js only modules).
 */

import { Session } from 'next-auth';
import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from '@/lib/auth';

export type AccessTier = 'free' | 'pro' | 'premium';

/**
 * Derive the effective access tier from a session.
 * Handles expiry: an expired pro/premium user falls back to 'free'.
 */
export function getAccessTier(session: Session | null): AccessTier {
  if (!session?.user) return 'free';

  const status  = session.user.subscription_status ?? 'free';
  const expires = session.user.subscription_expires_at;

  // Check expiry
  if ((status === 'pro' || status === 'premium') && expires) {
    if (new Date(expires) < new Date()) return 'free'; // expired
  }

  if (status === 'premium') return 'premium';
  if (status === 'pro')     return 'pro';
  return 'free';
}

export function isPro(session: Session | null): boolean {
  const tier = getAccessTier(session);
  return tier === 'pro' || tier === 'premium'; // both paid tiers get Pro features
}

export function isPremium(session: Session | null): boolean {
  return getAccessTier(session) === 'premium';
}

/** Check if user has any paid subscription (pro OR premium) */
export function isPaid(session: Session | null): boolean {
  const tier = getAccessTier(session);
  return tier === 'pro' || tier === 'premium';
}

/**
 * API route guard — returns a 403 response if user is not pro/premium.
 * Usage: const guard = await requirePro(); if (guard) return guard;
 */
export async function requirePro(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPro(session)) {
    return NextResponse.json({ error: 'Pro subscription required', upgrade: true }, { status: 403 });
  }
  return null;
}

export async function requirePremium(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isPremium(session)) {
    return NextResponse.json({ error: 'Premium subscription required', upgrade: true }, { status: 403 });
  }
  return null;
}
