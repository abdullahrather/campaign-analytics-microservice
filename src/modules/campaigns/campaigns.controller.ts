/**
 * src/modules/campaigns/campaigns.controller.ts
 *
 * Thin HTTP layer — validates input, calls service, formats responses.
 * Controllers must not contain business logic.
 */
import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/middleware/errorHandler';
import {
  createCampaignSchema,
  dateRangeSchema,
  listCampaignsQuerySchema,
  updateCampaignSchema,
} from './campaigns.schema';
import { campaignsService, type Actor } from './campaigns.service';

const actorOf = (req: Request): Actor => {
  if (!req.user) throw new AppError(401, 'Unauthenticated.');
  return req.user;
};

const idOf = (req: Request): string => req.params['id'] as string;

export class CampaignsController {
  /** GET /campaigns */
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listCampaignsQuerySchema.parse(req.query);
      const result = await campaignsService.listCampaigns(actorOf(req), query);

      res.status(200).json({ status: 'success', ...result });
    } catch (error) {
      next(error);
    }
  }

  /** POST /campaigns */
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = createCampaignSchema.parse(req.body);
      const campaign = await campaignsService.createCampaign(actorOf(req), dto);

      res.status(201).json({ status: 'success', data: campaign });
    } catch (error) {
      next(error);
    }
  }

  /** GET /campaigns/:id */
  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const campaign = await campaignsService.findOneOrFail(idOf(req), actorOf(req));

      res.status(200).json({ status: 'success', data: campaign });
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /campaigns/:id */
  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dto = updateCampaignSchema.parse(req.body);
      const campaign = await campaignsService.updateCampaign(idOf(req), actorOf(req), dto);

      res.status(200).json({ status: 'success', data: campaign });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /campaigns/:id */
  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await campaignsService.deleteCampaign(idOf(req), actorOf(req));

      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /** GET /campaigns/analytics */
  async analytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const range = dateRangeSchema.parse(req.query);
      const data = await campaignsService.getAnalytics(actorOf(req), range);

      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  }

  /** GET /campaigns/analytics/timeseries */
  async timeseries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const range = dateRangeSchema.parse(req.query);
      const data = await campaignsService.getTimeseries(actorOf(req), range);

      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  }

  /** GET /campaigns/:id/analytics */
  async campaignAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorOf(req);
      const id = idOf(req);
      const range = dateRangeSchema.parse(req.query);

      const breakdown = await campaignsService.getBreakdown(id, actor, range);
      const [[campaign], timeseries] = await Promise.all([
        campaignsService.getAnalytics(actor, range, id),
        campaignsService.getTimeseries(actor, range, id),
      ]);

      res.status(200).json({ status: 'success', data: { campaign, timeseries, breakdown } });
    } catch (error) {
      next(error);
    }
  }
}

export const campaignsController = new CampaignsController();
