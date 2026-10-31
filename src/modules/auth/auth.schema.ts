/**
 * src/modules/auth/auth.schema.ts
 *
 * Zod schemas for auth-related request bodies.
 * These serve dual purpose: runtime validation + TypeScript type inference.
 */
import { z } from 'zod';

const email = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Must be a valid email address.' }));

/** bcrypt only reads the first 72 bytes, so longer passwords would be silently cut. */
export const newPassword = z
  .string({ error: 'Password is required.' })
  .min(10, { error: 'Password must be at least 10 characters.' })
  .max(72, { error: 'Password must be at most 72 characters.' });

const token = z.string({ error: 'Token is required.' }).min(10);

export const personName = z.string({ error: 'Name is required.' }).trim().min(2).max(100);

export const organisationName = z
  .string({ error: 'Organisation name is required.' })
  .trim()
  .min(2)
  .max(100);

export const loginSchema = z.object({
  email,
  password: z
    .string({ error: 'Password is required.' })
    .min(8, { error: 'Password must be at least 8 characters.' }),
});

export const registerSchema = z.object({
  email,
  password: newPassword,
  name: personName,
  organisationName,
});

export const emailSchema = z.object({ email });
export const tokenSchema = z.object({ token });
export const resetPasswordSchema = z.object({ token, password: newPassword });

export const twoFactorChallengeSchema = z.object({
  challengeToken: token,
  code: z.string({ error: 'Code is required.' }).trim().min(6).max(20),
});

export const switchOrganisationSchema = z.object({ organisationId: z.string().min(1) });

export type LoginDto = z.infer<typeof loginSchema>;
export type RegisterDto = z.infer<typeof registerSchema>;
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
export type TwoFactorChallengeDto = z.infer<typeof twoFactorChallengeSchema>;
