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
 * @route   GET /auth/options
 * @desc    Tells the sign-in page whether this is the public demo
 * @access  Public
 */
authRouter.get('/options', (_req, res) => {
  res.status(200).json({ status: 'success', data: { demo: env.DEMO_MODE } });
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
