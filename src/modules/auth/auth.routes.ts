/**
 * src/modules/auth/auth.routes.ts
 *
 * Defines the routes for the auth module.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '@/config/env';
import { authController } from './auth.controller';

const authRouter = Router();

// Slows password guessing against the login endpoint.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.LOGIN_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many login attempts. Try again later.' },
});

/**
 * @route   POST /auth/login
 * @desc    Authenticate with email + password, receive a JWT
 * @access  Public
 */
authRouter.post('/login', loginLimiter, (req, res, next) => {
  void authController.login(req, res, next);
});

export { authRouter };
