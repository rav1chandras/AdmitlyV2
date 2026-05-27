/**
 * auth-validation.ts — shared email + password validation.
 *
 * Used by:
 *   - POST /api/account/register
 *   - POST /api/account/reset-password
 *   - POST /api/account/change-password
 *   - lib/auth.ts (Google OAuth signIn callback)
 *   - app/login/page.tsx (client-side UI hints)
 */

export const ALLOWED_EMAIL_DOMAINS = [
  'gmail.com',
  'icloud.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'aol.com',
];

export function validateEmail(email: string): { ok: true } | { ok: false; error: string } {
  const e = (email || '').trim().toLowerCase();
  if (!e) return { ok: false, error: 'Email is required.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  const domain = e.split('@')[1] || '';
  if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
    return {
      ok: false,
      error: `We currently only accept ${ALLOWED_EMAIL_DOMAINS.join(', ')} addresses.`,
    };
  }
  return { ok: true };
}

export function validatePassword(password: string): { ok: true } | { ok: false; error: string } {
  if (!password) return { ok: false, error: 'Password is required.' };
  if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
  if (!/[A-Z]/.test(password)) return { ok: false, error: 'Password must include at least one uppercase letter.' };
  if (!/[a-z]/.test(password)) return { ok: false, error: 'Password must include at least one lowercase letter.' };
  if (!/[0-9]/.test(password)) return { ok: false, error: 'Password must include at least one digit.' };
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/]/.test(password)) {
    return { ok: false, error: 'Password must include at least one special character (!@#$%^& etc).' };
  }
  return { ok: true };
}

/** For live UI hints — returns array of rules with met/not-met state. */
export function passwordRuleChecklist(password: string) {
  return [
    { label: 'At least 8 characters',          met: password.length >= 8 },
    { label: 'One uppercase letter (A–Z)',     met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter (a–z)',     met: /[a-z]/.test(password) },
    { label: 'One digit (0–9)',                met: /[0-9]/.test(password) },
    { label: 'One special character',          met: /[!@#$%^&*()_+\-=\[\]{}|;:,.<>?/]/.test(password) },
  ];
}
