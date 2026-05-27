import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import bcrypt from 'bcryptjs';
import { getUserByEmail, getPool } from '@/lib/db';
import { touchLastLogin } from '@/lib/db_admin';
import { ensureSchema, seedMockData } from '@/lib/db_schema';

const DEMO_ENABLED = process.env.ENABLE_DEMO_ACCOUNTS === 'true';
const MOCK_PASSWORD = 'password123';
const MOCK_EMAILS = new Set([
  'student1@admitly.com', 'student2@admitly.com',
  'counselor1@admitly.com', 'counselor2@admitly.com',
  'admin@admitly.com',
]);

let schemaReady = false;

export const authOptions: NextAuthOptions = {
  secret: (() => {
    const s = process.env.NEXTAUTH_SECRET;
    if (!s) throw new Error('NEXTAUTH_SECRET environment variable is required. Generate one with: openssl rand -base64 32');
    return s;
  })(),
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.error('[auth] authorize: missing credentials');
          return null;
        }
        try {
          // Ensure DB schema exists on first auth attempt
          if (!schemaReady) {
            try { await ensureSchema(); await seedMockData(); schemaReady = true; } catch(e) { console.error('[auth] schema init failed:', e); }
          }

          let user = await getUserByEmail(credentials.email);

          // Auto-create mock demo users if not in DB yet (seed may not have run)
          // Only available when ENABLE_DEMO_ACCOUNTS=true (dev/staging)
          if (DEMO_ENABLED && !user && MOCK_EMAILS.has(credentials.email.toLowerCase()) && credentials.password === MOCK_PASSWORD) {
            const pool = (await import('@/lib/db')).getPool();
            const emailLower = credentials.email.toLowerCase();
            const mockUsers: Record<string, { name: string; role: string; sub: string }> = {
              'student1@admitly.com':   { name:'Maya Patel',         role:'student',   sub:'premium' },
              'student2@admitly.com':   { name:'James Chen',         role:'student',   sub:'premium' },
              'counselor1@admitly.com': { name:'Dr. Sarah Mitchell', role:'counselor', sub:'free' },
              'counselor2@admitly.com': { name:'Dr. Robert Kim',     role:'counselor', sub:'free' },
              'admin@admitly.com':      { name:'Ravi (Admin)',       role:'admin',     sub:'free' },
            };
            const m = mockUsers[emailLower];
            if (m) {
              const bcrypt = (await import('bcryptjs')).default;
              const hashed = await bcrypt.hash(MOCK_PASSWORD, 10);
              const expires = m.sub === 'premium' ? "NOW() + INTERVAL '1 year'" : 'NULL';
              await pool.query(
                `INSERT INTO users (email, name, password, role, subscription_status, subscription_expires_at)
                 VALUES ($1, $2, $3, $4, $5, ${expires})
                 ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, subscription_status=EXCLUDED.subscription_status, subscription_expires_at=${expires}, is_locked=false`,
                [emailLower, m.name, hashed, m.role, m.sub]
              );
              user = await getUserByEmail(emailLower);
            }
          }

          if (!user) {
            console.error('[auth] authorize: user not found for email', credentials.email);
            return null;
          }

          // Block locked accounts from logging in
          if (user.is_locked) {
            console.error('[auth] authorize: account is locked', credentials.email);
            return null;
          }

          // Safe subscription field extraction — columns may not exist on old DBs
          const subStatus = (user.subscription_status ?? 'free') as string;
          const expiresAt = user.subscription_expires_at instanceof Date
            ? user.subscription_expires_at.toISOString()
            : (user.subscription_expires_at as string | null ?? null);

          const payload = {
            id: user.id.toString(),
            email: user.email,
            name: user.name,
            role: user.role || 'student',
            subscription_status: subStatus,
            subscription_expires_at: expiresAt,
          };

          // Mock demo users — plain password (only when demo accounts enabled)
          if (DEMO_ENABLED && MOCK_EMAILS.has(credentials.email.toLowerCase()) && credentials.password === MOCK_PASSWORD) {
            return payload;
          }

          // Impersonation token — short-lived, single-use, admin-generated
          if (credentials.password.startsWith('impersonate:')) {
            const token = credentials.password.replace('impersonate:', '');
            const pool = (await import('@/lib/db')).getPool();
            const { rows } = await pool.query(
              `UPDATE users SET impersonate_token=NULL, impersonate_expires_at=NULL
               WHERE id=$1 AND impersonate_token=$2 AND impersonate_expires_at > NOW()
               RETURNING id`,
              [user.id, token]
            );
            if (!rows[0]) return null; // token wrong, expired, or already used
            return payload;
          }

          // Standard bcrypt check
          const ok = await bcrypt.compare(credentials.password, user.password);
          if (!ok) {
            // Log enough to diagnose without leaking the password.
            // hashPrefix tells us the bcrypt variant ($2a$/$2b$/$2y$) and cost.
            const hashPrefix = typeof user.password === 'string' ? user.password.slice(0, 7) : '(non-string)';
            console.error(
              '[auth] authorize: password mismatch for', credentials.email,
              'submitted_len=', credentials.password.length,
              'stored_hash_prefix=', hashPrefix,
              'stored_hash_len=', typeof user.password === 'string' ? user.password.length : 0
            );
            return null;
          }
          return payload;
        } catch (err) {
          console.error('[auth] authorize error:', err);
          return null;
        }
      },
    }),
    // Google OAuth — auto-creates user on first sign-in
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    ] : []),
  ],
  session: { strategy: 'jwt' },
  pages:   { signIn: '/login', error: '/auth-error' },
  callbacks: {
    async jwt({ token, user, trigger, account }) {
      // On initial sign-in, set all fields from the user object
      if (user) {
        token.id = (user as any).id || user.id;
        token.role = (user as any).role || 'student';
        token.subscription_status = (user as any).subscription_status || 'free';
        token.subscription_expires_at = (user as any).subscription_expires_at ?? null;
        token.sub_refreshed_at = Date.now();
      }

      // For Google OAuth on first sign-in, fetch from DB if id not set
      if (account?.provider === 'google' && !token.id && token.email) {
        try {
          const existing = await getUserByEmail(token.email as string);
          if (existing) {
            token.id = existing.id.toString();
            token.role = existing.role || 'student';
            token.subscription_status = existing.subscription_status || 'free';
            token.subscription_expires_at = existing.subscription_expires_at
              ? new Date(existing.subscription_expires_at).toISOString() : null;
          }
        } catch {}
      }

      // Refresh subscription_status from DB every 5 minutes
      // This catches Stripe webhook updates without requiring re-login
      const refreshInterval = 5 * 60 * 1000; // 5 minutes
      const lastRefresh = (token.sub_refreshed_at as number) || 0;
      if (token.id && (Date.now() - lastRefresh > refreshInterval || trigger === 'update')) {
        try {
          const { getPool } = await import('@/lib/db');
          const pool = getPool();
          const { rows } = await pool.query(
            `SELECT subscription_status, subscription_expires_at, role FROM users WHERE id = $1`,
            [parseInt(token.id as string)]
          );
          if (rows[0]) {
            token.subscription_status = rows[0].subscription_status || 'free';
            token.subscription_expires_at = rows[0].subscription_expires_at
              ? new Date(rows[0].subscription_expires_at).toISOString()
              : null;
            token.role = rows[0].role || token.role;
          }
          token.sub_refreshed_at = Date.now();
        } catch (err) {
          // Don't block auth if DB is temporarily unavailable
          console.error('[auth] JWT refresh failed:', err);
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string || 'student';
        session.user.subscription_status = ((token.subscription_status as string) || 'free') as 'free' | 'pro' | 'premium' | 'cancelled';
        session.user.subscription_expires_at = (token.subscription_expires_at as string | null) ?? null;
      }
      return session;
    },
    async signIn({ user, account }) {
      // Google OAuth — auto-create user in DB if not exists
      if (account?.provider === 'google' && user?.email) {
        try {
          if (!schemaReady) {
            try { await ensureSchema(); await seedMockData(); schemaReady = true; } catch(e) { console.error('[auth] schema init:', e); }
          }
          const existing = await getUserByEmail(user.email.toLowerCase());
          if (!existing) {
            // Create new user — role will be set after they pick student/counselor
            const pool = getPool();
            const randomPw = await bcrypt.hash(Math.random().toString(36), 10);
            const result = await pool.query(
              `INSERT INTO users (email, name, password, role, subscription_status, auth_provider)
               VALUES ($1, $2, $3, 'needs_role', 'free', 'google') RETURNING id, role, subscription_status, subscription_expires_at`,
              [user.email.toLowerCase(), user.name || user.email.split('@')[0], randomPw]
            );
            if (result.rows[0]) {
              (user as any).id = result.rows[0].id.toString();
              (user as any).role = 'needs_role';
              (user as any).subscription_status = 'free';
              (user as any).subscription_expires_at = null;
            }
          } else {
            if (existing.is_locked) return false;
            (user as any).id = existing.id.toString();
            (user as any).role = existing.role || 'student';
            (user as any).subscription_status = existing.subscription_status || 'free';
            (user as any).subscription_expires_at = existing.subscription_expires_at
              ? new Date(existing.subscription_expires_at).toISOString() : null;
          }
        } catch (err) {
          console.error('[auth] Google signIn error:', err);
          return false;
        }
      }
      if (user?.id) {
        touchLastLogin(parseInt(user.id as string)).catch(() => {});
      }
      return true;
    },
  },
};
