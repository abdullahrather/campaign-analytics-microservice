/**
 * src/modules/campaigns/campaigns.routes.ts
 *
 * All campaign routes are protected by the JWT authenticate middleware.
 *
 * IMPORTANT: /campaigns/analytics MUST be registered BEFORE /campaigns/:id
 * so Express doesn't interpret "analytics" as an ID parameter.
 */
import { Router } from 'express';
import { authenticate } from '@/middleware/authenticate';
import { campaignsController } from './campaigns.controller';

const campaignsRouter = Router();

// Apply JWT guard to all routes in this router
campaignsRouter.use(authenticate);

/**
 * @route   GET /campaigns/analytics
 * @desc    Aggregated views + clicks per campaign (single SQL query)
 * @access  Private
 */
campaignsRouter.get('/analytics', (req, res, next) => {
  void campaignsController.analytics(req, res, next);
});

/**
 * @route   GET /campaigns
 * @desc    List authenticated user's campaigns (paginated, filterable)
 * @access  Private
 */
campaignsRouter.get('/', (req, res, next) => {
  void campaignsController.list(req, res, next);
});

/**
 * @route   POST /campaigns
 * @desc    Create a new campaign
 * @access  Private
 */
campaignsRouter.post('/', (req, res, next) => {
  void campaignsController.create(req, res, next);
});

export { campaignsRouter };
