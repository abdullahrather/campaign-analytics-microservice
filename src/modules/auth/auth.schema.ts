/**
 * src/modules/auth/auth.schema.ts
 *
 * Zod schemas for auth-related request bodies.
 * These serve dual purpose: runtime validation + TypeScript type inference.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ error: 'Email is required.' })
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Must be a valid email address.' })),

  password: z
    .string({ error: 'Password is required.' })
    .min(8, { error: 'Password must be at least 8 characters.' }),
});

export type LoginDto = z.infer<typeof loginSchema>;
