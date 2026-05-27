/**
 * /team-login — hidden quick-access demo login.
 *
 * Why this exists: during soft launch we hide the QUICK DEMO ACCESS pill
 * from /login so public visitors see a clean sign-in page. But for
 * solo-testing on the live deployment, typing email + password every
 * time is friction. This route shows the same demo buttons, gated on a
 * secret key in the URL.
 *
 *   https://yourdomain.com/team-login?key=YOUR_LONG_RANDOM_SECRET
 *
 * The key is read from process.env.TEAM_LOGIN_KEY and compared
 * server-side. On miss (or when the env var is unset), the route 404s
 * via `notFound()` so it doesn't leak that the route exists.
 *
 * Usage:
 *   1. Pick a long random string (e.g. `openssl rand -hex 24`).
 *   2. Set TEAM_LOGIN_KEY in Vercel → Settings → Environment Variables.
 *   3. Bookmark `https://yourdomain.com/team-login?key=YOUR_SECRET`.
 *
 * Security note: this is "security through obscurity" — anyone with the
 * URL can log in as a demo user. Don't share the bookmark in chat,
 * commits, or screenshots. Rotate the key any time it might have leaked.
 * Delete this whole route the day you stop needing it.
 */

import { notFound } from 'next/navigation';
import TeamLoginClient from './client';

export const dynamic = 'force-dynamic';

export default function TeamLoginPage({
  searchParams,
}: {
  searchParams: { key?: string };
}) {
  const expectedKey = process.env.TEAM_LOGIN_KEY;
  if (!expectedKey || searchParams?.key !== expectedKey) {
    // Use Next's notFound so the response is a real 404, not a friendly
    // page that says "wrong key" (which would confirm the route exists).
    notFound();
  }
  return <TeamLoginClient />;
}
