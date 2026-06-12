/**
 * src/modules/campaigns/campaigns.controller.ts
 *
 * Thin HTTP layer — validates input, calls service, formats responses.
 * Controllers must not contain business logic.
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import { createCampaignSchema, listCampaignsQuerySchema } from './campaigns.schema';
import { campaignsService } from './campaigns.service';

export class CampaignsController {
  /**
   * GET /campaigns
   *
   * List campaigns for the authenticated user, with pagination and filtering.
   */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Unauthenticated.');

      const query = listCampaignsQuerySchema.parse(req.query);
      const result = await campaignsService.listCampaigns(req.user.sub, query);

      res.status(200).json({ status: 'success', ...result });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /campaigns
   *
   * Create a new campaign for the authenticated user.
   */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Unauthenticated.');

      const dto = createCampaignSchema.parse(req.body);
      const campaign = await campaignsService.createCampaign(req.user.sub, dto);

      res.status(201).json({ status: 'success', data: campaign });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /campaigns/analytics
   *
   * Returns aggregated views + clicks per campaign in a SINGLE DB query.
   * No N+1 queries — see CampaignsService.getAnalytics() for the SQL details.
   */
  async analytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) throw new AppError(401, 'Unauthenticated.');

      const data = await campaignsService.getAnalytics(req.user.sub);

      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  }
}

export const campaignsController = new CampaignsController();
