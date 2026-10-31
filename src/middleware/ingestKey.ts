/**
 * src/middleware/ingestKey.ts
 *
 * API key guard for the ad server endpoints. Keys are hashed first so the
 * constant-time comparison always sees equal lengths.
 */
import { createHash, timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '@/config/env';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

const expected = digest(env.INGEST_API_KEY);

export const requireIngestKey = (req: Request, res: Response, next: NextFunction): void => {
  const provided = req.headers['x-ingest-key'];

  if (typeof provided !== 'string' || !timingSafeEqual(digest(provided), expected)) {
    res.status(401).json({ status: 'error', message: 'A valid x-ingest-key header is required.' });
    return;
  }

  next();
};
