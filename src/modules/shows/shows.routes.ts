/**
 * src/modules/shows/shows.routes.ts
 *
 * Read-only catalogue, used by the dashboard's targeting options.
 */
import { Router } from 'express';
import { authenticate } from '@/middleware/authenticate';
import { prisma } from '@/lib/prisma';

const showsRouter = Router();

showsRouter.use(authenticate);

showsRouter.get('/', (_req, res, next) => {
  prisma.show
    .findMany({ orderBy: { title: 'asc' } })
    .then((data) => res.status(200).json({ status: 'success', data }))
    .catch(next);
});

export { showsRouter };
