/**
 * src/lib/totp.ts
 *
 * Time-based one-time passwords (RFC 6238), as used by authenticator apps.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const ALLOWED_DRIFT_STEPS = 1;

const toBase32 = (bytes: Buffer): string => {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');

  let output = '';
  for (let index = 0; index + 5 <= bits.length; index += 5) {
    output += BASE32[parseInt(bits.slice(index, index + 5), 2)];
  }
  return output;
};

const fromBase32 = (value: string): Buffer => {
  let bits = '';
  for (const character of value) {
    bits += BASE32.indexOf(character).toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

export const generateTotpSecret = (): string => toBase32(randomBytes(20));

const currentStep = (now: number): bigint => BigInt(Math.floor(now / 1000 / STEP_SECONDS));

const codeForStep = (secret: string, step: bigint): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);

  const digest = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 10 ** DIGITS).padStart(DIGITS, '0');
};

export const totpCode = (secret: string, now = Date.now()): string =>
  codeForStep(secret, currentStep(now));

/**
 * Returns the time step a code belongs to, or null if it isn't valid. A code at
 * or before `lastStep` was already used, so it's rejected.
 */
export const verifyTotp = (
  secret: string,
  code: string,
  lastStep: bigint | null,
  now = Date.now(),
): bigint | null => {
  const provided = Buffer.from(code.padEnd(DIGITS, ' '));
  const step = currentStep(now);

  for (let drift = -ALLOWED_DRIFT_STEPS; drift <= ALLOWED_DRIFT_STEPS; drift += 1) {
    const candidate = step + BigInt(drift);
    if (lastStep !== null && candidate <= lastStep) continue;

    const expected = Buffer.from(codeForStep(secret, candidate));
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return candidate;
    }
  }
  return null;
};

export const totpUri = (secret: string, email: string): string => {
  const issuer = 'Campaign Analytics';
  const label = encodeURIComponent(`${issuer}:${email}`);
  const query = new URLSearchParams({ secret, issuer }).toString();
  return `otpauth://totp/${label}?${query}`;
};
