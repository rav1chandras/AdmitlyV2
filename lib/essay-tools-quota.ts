/**
 * lib/essay-tools-quota.ts
 *
 * Shared daily-quota counter for all essay-lab tools (scorer, hook analyzer,
 * cliche detector, show-don't-tell, revision planner, voice authenticity).
 *
 * Free users get FREE_DAILY_LIMIT submissions across ALL tools combined per
 * 24-hour rolling window. Pro/premium users bypass entirely.
 *
 * Why per-user not per-IP:
 *   - Surives reverse proxies and shared NAT (university Wi-Fi → one IP for
 *     thousands of students would be unusable)
 *   - Can't be bypassed by switching networks
 *   - Aligns the quota with the resource you're actually rate-limiting (the
 *     OpenAI bill, which is incurred per authenticated user)
 *
 * Why in-memory:
 *   - Matches the existing scorer's approach (no DB schema changes required)
 *   - Resets on server restart, which is acceptable for a soft cap
 *   - For multi-instance deploys, this should be migrated to Redis or a DB
 *     table — see the TODO comment below
 *
 * TODO(scale): Replace the in-memory Map with a Redis or Postgres counter
 * keyed by `user:${userId}:${YYYY-MM-DD}` if you ever run more than one app
 * instance behind a load balancer. Right now each instance has its own
 * counter, so a 4-instance deploy would let users get 4×FREE_DAILY_LIMIT
 * before hitting the cap.
 */

export const FREE_DAILY_LIMIT = 3;
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Entry {
  count: number;
  resetAt: number;
}

const usage = new Map<string, Entry>();

export interface QuotaResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  /**
   * For Pro/premium users, remaining is set to -1 to signal "unlimited" to
   * the client without breaking the JSON shape that expects a number.
   */
  unlimited: boolean;
}

/**
 * Atomically consume one quota slot for the given user.
 *
 * Pro users always succeed and never increment the counter — they have no
 * cap and no quota tracking.
 *
 * Free users increment the counter; if the counter would exceed the cap,
 * the increment is rolled back and { allowed: false } is returned.
 *
 * Important: this is the ONLY function that should mutate the quota. Routes
 * must call consume() exactly once per submission. If the LLM call fails
 * after consume() returns allowed=true, you may optionally call refund() to
 * give the user their slot back — but most routes don't bother because the
 * cost of the refund logic outweighs the rare error case.
 */
export function consume(userId: string, isPro: boolean): QuotaResult {
  if (isPro) {
    return { allowed: true, remaining: -1, resetAt: 0, unlimited: true };
  }

  const key = String(userId);
  const now = Date.now();
  let entry = usage.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    usage.set(key, entry);
  }

  if (entry.count >= FREE_DAILY_LIMIT) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      unlimited: false,
    };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: Math.max(0, FREE_DAILY_LIMIT - entry.count),
    resetAt: entry.resetAt,
    unlimited: false,
  };
}

/**
 * Refund a previously-consumed slot. Use only when consume() returned
 * allowed=true but the underlying operation failed (e.g. OpenAI threw).
 * Safe to call on Pro users (no-op).
 */
export function refund(userId: string, isPro: boolean): void {
  if (isPro) return;
  const entry = usage.get(String(userId));
  if (entry && entry.count > 0) entry.count--;
}

/**
 * Read current quota state without mutating it. Used by clients that want
 * to display "X free analyses left today" without triggering a consumption.
 */
export function peek(userId: string, isPro: boolean): QuotaResult {
  if (isPro) {
    return { allowed: true, remaining: -1, resetAt: 0, unlimited: true };
  }
  const entry = usage.get(String(userId));
  if (!entry || Date.now() > entry.resetAt) {
    return {
      allowed: true,
      remaining: FREE_DAILY_LIMIT,
      resetAt: Date.now() + WINDOW_MS,
      unlimited: false,
    };
  }
  return {
    allowed: entry.count < FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - entry.count),
    resetAt: entry.resetAt,
    unlimited: false,
  };
}

/**
 * Reset all quota state. ONLY for tests — do not call in production code.
 */
export function __resetForTests(): void {
  usage.clear();
}
