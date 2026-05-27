/**
 * lib/payment-crypto.ts — AES-256-GCM for sensitive financial fields.
 *
 * SECURITY: Previously the `account_number_encrypted` field in
 * counselor_settings was stored verbatim from the client, so the "encrypted"
 * suffix was misleading: whatever the client sent (often plaintext or
 * base64) ended up in the database. This helper does real server-side
 * AES-256-GCM with a key derived from process.env.PAYMENT_ENCRYPTION_KEY.
 *
 * Key format: a 32-byte key encoded as hex (64 chars) or base64. Generate
 * with:   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Output format: base64(iv || authTag || ciphertext). The iv is 12 bytes
 * (GCM recommended), authTag is 16 bytes.
 */

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('PAYMENT_ENCRYPTION_KEY is not set. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  // Accept hex (64 chars) or base64 (44 chars)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('PAYMENT_ENCRYPTION_KEY must decode to exactly 32 bytes (hex 64 chars or base64 44 chars)');
  }
  return buf;
}

export function encryptPaymentField(plaintext: string): string {
  if (!plaintext) return '';
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptPaymentField(ciphertext: string): string {
  if (!ciphertext) return '';
  const key = getKey();
  const buf = Buffer.from(ciphertext, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('payment ciphertext too short');
  }
  const iv  = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct  = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

/**
 * Mask a bank account number for display (last 4 digits visible).
 */
export function maskAccountNumber(plaintext: string): string {
  if (!plaintext) return '';
  const digits = plaintext.replace(/\D/g, '');
  if (digits.length <= 4) return '••••';
  return '••••' + digits.slice(-4);
}
