/**
 * src/lib/security.ts
 *
 * Token and encryption helpers. Links and refresh tokens are random and stored
 * only as hashes, so a database leak can't be used to sign in. Two-factor
 * secrets have to be read back, so those are encrypted instead.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '@/config/env';

const IV_BYTES = 12;

const encryptionKey = createHash('sha256').update(env.ENCRYPTION_KEY).digest();

export const randomToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const encrypt = (plainText: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
};

export const decrypt = (value: string): string => {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !encrypted) throw new Error('Malformed encrypted value.');

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};
