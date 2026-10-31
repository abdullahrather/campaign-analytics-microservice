/**
 * src/modules/dev/dev.routes.ts
 *
 * The local mailbox, for trying email flows without a mail server. Messages
 * contain sign-in links, so it only exists in development and only answers
 * requests from this computer.
 */
import { Router } from 'express';
import { handle } from '@/lib/http';
import { usesLocalMailbox } from '@/lib/mailer';
import { prisma } from '@/lib/prisma';
import { AppError } from '@/middleware/errorHandler';

const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const devRouter = Router();

devRouter.get(
  '/dev/mailbox',
  handle(async (req, res) => {
    if (!usesLocalMailbox() || !LOCAL_ADDRESSES.has(req.socket.remoteAddress ?? '')) {
      throw new AppError(404, 'Route not found.');
    }

    const data = await prisma.capturedEmail.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.status(200).json({ status: 'success', data });
  }),
);

export { devRouter };
