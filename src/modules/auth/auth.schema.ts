/**
 * src/modules/auth/auth.schema.ts
 *
 * Zod schemas for auth-related request bodies.
 * These serve dual purpose: runtime validation + TypeScript type inference.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required.' })
    .email({ message: 'Must be a valid email address.' })
    .toLowerCase()
    .trim(),

  password: z
    .string({ required_error: 'Password is required.' })
    .min(8, { message: 'Password must be at least 8 characters.' }),
});

export type LoginDto = z.infer<typeof loginSchema>;
