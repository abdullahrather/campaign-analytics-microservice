/**
 * src/modules/delivery/delivery.routes.ts
 *
 * Machine-to-machine endpoints for the ad server or player, guarded by an API
 * key rather than a user login.
 *
 * GET  /ad-decision  Which ad should play in this ad break?
 * POST /events       Record impressions, clicks and completions in a batch.
 */
import { Router } from 'express';
import { requireIngestKey } from '@/middleware/ingestKey';
import { adDecisionQuerySchema, eventBatchSchema } from './delivery.schema';
import { deliveryService } from './delivery.service';

const deliveryRouter = Router();

deliveryRouter.use(requireIngestKey);

deliveryRouter.get('/ad-decision', (req, res, next) => {
  void (async (): Promise<void> => {
    try {
      const query = adDecisionQuerySchema.parse(req.query);
      const data = await deliveryService.decide(query);

      res.status(200).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  })();
});

deliveryRouter.post('/events', (req, res, next) => {
  void (async (): Promise<void> => {
    try {
      const { events } = eventBatchSchema.parse(req.body);
      const data = await deliveryService.ingest(events);

      res.status(202).json({ status: 'success', data });
    } catch (error) {
      next(error);
    }
  })();
});

export { deliveryRouter };
