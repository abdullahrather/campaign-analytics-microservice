/**
 * src/modules/auth/auth.controller.ts
 *
 * Thin controller — parses and validates the request body,
 * delegates to the service, and formats the HTTP response.
 * No business logic lives here.
 */
import { Request, Response, NextFunction } from 'express';
import { loginSchema } from './auth.schema';
import { authService } from './auth.service';

export class AuthController {
  /**
   * POST /auth/login
   *
   * Returns a JWT token on successful authentication.
   */
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = loginSchema.parse(req.body);
      const result = await authService.login(dto);

      res.status(200).json({
        status: 'success',
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const authController = new AuthController();
