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

// Compared when the email is unknown, so both paths spend the same time hashing.
// It has to be a real hash: bcrypt rejects a malformed one instantly.
const DUMMY_HASH = bcrypt.hashSync('no-account-has-this-password', 12);

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthTokenResponse {
  token: string;
  expiresIn: string;
  user: AuthUser;
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

    // 2. Hash either way, so response time doesn't reveal whether the email exists.
    const isValid = await bcrypt.compare(dto.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !isValid) {
      // Deliberately vague message — don't reveal whether the email exists
      throw new AppError(401, 'Invalid email or password.');
    }

    // 3. Sign the JWT with the user's id and role in the payload
    const token = jwt.sign({ sub: user.id, role: user.role }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    } as jwt.SignOptions);

    return {
      token,
      expiresIn: env.JWT_EXPIRES_IN,
      user: { id: user.id, email: user.email, role: user.role },
    };
  }
}

export const authService = new AuthService();
