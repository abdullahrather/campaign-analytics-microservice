/**
 * src/modules/auth/auth.routes.ts
 *
 * Express router for authentication endpoints.
 * No middleware protection required here — these are public routes.
 */
import { Router } from 'express';
import { authController } from './auth.controller';

const authRouter = Router();

/**
 * @route   POST /auth/login
 * @desc    Authenticate with email + password, receive a JWT
 * @access  Public
 */
authRouter.post('/login', (req, res, next) => {
  void authController.login(req, res, next);
});

export { authRouter };
