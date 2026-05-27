/**
 * Shared authorization helpers.
 *
 * SECURITY: Previously there were 3+ different isAdmin() implementations
 * scattered across admin routes — some checked only the ADMIN_EMAILS env var,
 * some checked only the DB `role` column, some checked both. This
 * inconsistency made it possible for a counselor to escalate to admin on
 * routes using the email-only check by changing their email to an
 * ADMIN_EMAILS value (now also blocked at the email-change endpoint).
 *
 * Use these helpers everywhere instead of ad-hoc checks.
 */

import type { Session } from 'next-auth';

function adminEmailList(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true iff the caller is an admin.
 *
 * A user is considered admin if EITHER:
 *   - their session.user.role === 'admin' (set by the DB role column), OR
 *   - their session.user.email is in the ADMIN_EMAILS env var.
 *
 * Both conditions are checked together so routes that forget one branch
 * don't accidentally become too permissive or too restrictive.
 */
export function isAdmin(session: Session | null | undefined): boolean {
  const user: any = session?.user;
  if (!user) return false;
  if (user.role === 'admin') return true;
  const email = typeof user.email === 'string' ? user.email.toLowerCase() : '';
  if (!email) return false;
  return adminEmailList().includes(email);
}

/**
 * Returns true iff the caller is authenticated as any user.
 */
export function isAuthenticated(session: Session | null | undefined): boolean {
  return !!session?.user?.id;
}
