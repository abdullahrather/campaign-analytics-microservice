/**
 * src/modules/auth/auth.service.ts
 *
 * Business logic for authentication.
 * Controllers should call this service; it should never touch HTTP concerns.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { env } from '@/config/env';
import { AppError } from '@/middleware/errorHandler';
import type { LoginDto } from './auth.schema';

export interface AuthTokenResponse {
  token: string;
  expiresIn: string;
}

export class AuthService {
  /**
   * Validates credentials and issues a signed JWT.
   *
   * @throws {AppError} 401 if email not found or password is incorrect.
   */
  async login(dto: LoginDto): Promise<AuthTokenResponse> {
    // 1. Look up the user by email
    const user = await prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, passwordHash: true, role: true },
    });

    // 2. Use a constant-time comparison regardless of whether user exists.
    //    This prevents timing-based email enumeration attacks.
    const DUMMY_HASH = '$2b$12$invalidhashfortimingsafety000000000000000000';
    const isValid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !isValid) {
      // Deliberately vague message — don't reveal whether the email exists
      throw new AppError(401, 'Invalid email or password.');
    }

    // 3. Sign the JWT with the user's id and role in the payload
    const token = jwt.sign(
      { sub: user.id, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions,
    );

    return { token, expiresIn: env.JWT_EXPIRES_IN };
  }
}

export const authService = new AuthService();
