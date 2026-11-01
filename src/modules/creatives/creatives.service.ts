/**
 * src/modules/creatives/creatives.service.ts
 *
 * Video ads. An upload is inspected, converted in the background, then waits
 * for a platform admin. Only approved creatives can be served to viewers.
 */
import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import jwt from 'jsonwebtoken';
import { CreativeStatus, type Creative } from '@prisma/client';
import { env } from '@/config/env';
import type { Actor } from '@/lib/actor';
import { sendEmail } from '@/lib/mailer';
import { prisma } from '@/lib/prisma';
import { storage } from '@/lib/storage';
import { extractPoster, probeVideo, transcodeVideo } from '@/lib/video';
import { AppError } from '@/middleware/errorHandler';
import { campaignsService } from '@/modules/campaigns/campaigns.service';
import type { ReviewDto, UploadCreativeDto } from './creatives.schema';

const MIN_SECONDS = 5;
const MAX_SECONDS = 120;
const MIN_HEIGHT = 240;
const MAX_CONCURRENT_JOBS = 2;
const PREVIEW_TTL = '1h';
const PREVIEW_AUDIENCE = 'creative-preview';

export interface CreativeView extends Omit<Creative, 'originalKey' | 'videoKey' | 'posterKey'> {
  videoUrl: string;
  posterUrl: string;
}

export const creativeFolder = (id: string): string => `creatives/${id}`;

class CreativesService {
  private readonly waiting: string[] = [];
  private running = 0;

  /** Adds short-lived links, so a review page can play a video that isn't public. */
  toView({ originalKey: _o, videoKey, posterKey, ...creative }: Creative): CreativeView {
    const token = jwt.sign({}, env.JWT_SECRET, {
      subject: creative.id,
      audience: PREVIEW_AUDIENCE,
      expiresIn: PREVIEW_TTL,
    });
    const query = creative.status === CreativeStatus.APPROVED ? '' : `?t=${token}`;

    return {
      ...creative,
      videoUrl: videoKey ? `/media/creatives/${creative.id}/video${query}` : '',
      posterUrl: posterKey ? `/media/creatives/${creative.id}/poster${query}` : '',
    };
  }

  /** Approved videos are public. Anything else needs a preview token. */
  async mediaFor(id: string, token: unknown): Promise<Creative> {
    const creative = await prisma.creative.findUnique({ where: { id } });
    if (!creative) throw new AppError(404, 'Not found.');
    if (creative.status === CreativeStatus.APPROVED) return creative;

    try {
      if (typeof token !== 'string') throw new Error('Missing token.');
      jwt.verify(token, env.JWT_SECRET, { audience: PREVIEW_AUDIENCE, subject: id });
    } catch {
      throw new AppError(404, 'Not found.');
    }
    return creative;
  }

  async list(actor: Actor, campaignId: string): Promise<CreativeView[]> {
    await campaignsService.findOneOrFail(campaignId, actor);
    const creatives = await prisma.creative.findMany({
      where: { campaignId },
      orderBy: { createdAt: 'desc' },
    });
    return creatives.map((creative) => this.toView(creative));
  }

  /**
   * Checks the upload, then queues it for conversion. Problems with the file are
   * reported now, while the person is still on the page.
   */
  async upload(actor: Actor, filePath: string, dto: UploadCreativeDto): Promise<Creative> {
    try {
      await campaignsService.findOneOrFail(dto.campaignId, actor);

      const info = await probeVideo(filePath);
      if (!info) throw new AppError(422, 'That file is not a supported video.');
      if (info.durationSeconds < MIN_SECONDS || info.durationSeconds > MAX_SECONDS) {
        throw new AppError(422, `Ads must last ${MIN_SECONDS} to ${MAX_SECONDS} seconds.`);
      }
      if (info.height < MIN_HEIGHT) {
        throw new AppError(422, `Ads must be at least ${MIN_HEIGHT} pixels tall.`);
      }

      const id = crypto.randomUUID();
      const originalKey = `${creativeFolder(id)}/original`;
      await storage.store(filePath, originalKey);

      const creative = await prisma.creative.create({
        data: {
          id,
          campaignId: dto.campaignId,
          name: dto.name,
          clickUrl: dto.clickUrl,
          originalKey,
          durationSeconds: info.durationSeconds,
          createdById: actor.sub,
        },
      });

      this.enqueue(id);
      return creative;
    } finally {
      await fs.rm(filePath, { force: true });
    }
  }

  private enqueue(id: string): void {
    this.waiting.push(id);
    this.drain();
  }

  /** Runs a few conversions at a time, so uploads can't overload the machine. */
  private drain(): void {
    while (this.running < MAX_CONCURRENT_JOBS && this.waiting.length > 0) {
      const id = this.waiting.shift() as string;
      this.running += 1;
      void this.convert(id).finally(() => {
        this.running -= 1;
        this.drain();
      });
    }
  }

  private async convert(id: string): Promise<void> {
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'creative-'));

    try {
      const creative = await prisma.creative.findUnique({ where: { id } });
      if (!creative?.originalKey) return;

      const videoFile = path.join(scratch, 'video.mp4');
      const posterFile = path.join(scratch, 'poster.jpg');
      await transcodeVideo(storage.localPath(creative.originalKey), videoFile);
      await extractPoster(videoFile, posterFile);

      const info = await probeVideo(videoFile);
      if (!info) throw new Error('The converted video could not be read.');

      const videoKey = `${creativeFolder(id)}/video.mp4`;
      const posterKey = `${creativeFolder(id)}/poster.jpg`;
      await storage.store(videoFile, videoKey);
      await storage.store(posterFile, posterKey);
      await storage.remove(creative.originalKey);

      await prisma.creative.update({
        where: { id },
        data: {
          status: CreativeStatus.PENDING_REVIEW,
          originalKey: '',
          videoKey,
          posterKey,
          durationSeconds: info.durationSeconds,
          width: info.width,
          height: info.height,
          sizeBytes: await storage.size(videoKey),
        },
      });
    } catch (error) {
      console.error(`Creative ${id} failed:`, String(error));
      await prisma.creative.updateMany({
        where: { id },
        data: {
          status: CreativeStatus.FAILED,
          failureReason: 'This video could not be converted. Try exporting it as MP4.',
        },
      });
    } finally {
      await fs.rm(scratch, { recursive: true, force: true });
    }
  }

  /** Picks up conversions that were interrupted by a restart. */
  async resumeProcessing(): Promise<void> {
    const creatives = await prisma.creative.findMany({
      where: { status: CreativeStatus.PROCESSING },
      select: { id: true },
    });
    creatives.forEach(({ id }) => this.enqueue(id));
  }

  async remove(actor: Actor, id: string): Promise<Creative> {
    const creative = await prisma.creative.findUnique({ where: { id } });
    if (!creative) throw new AppError(404, 'Ad not found.');
    await campaignsService.findOneOrFail(creative.campaignId, actor);

    await prisma.creative.delete({ where: { id } });
    await storage.removeFolder(creativeFolder(id));
    return creative;
  }

  /** Call before deleting a campaign, because the database cascade leaves files behind. */
  async removeFilesForCampaign(campaignId: string): Promise<void> {
    const creatives = await prisma.creative.findMany({
      where: { campaignId },
      select: { id: true },
    });
    await Promise.all(creatives.map(({ id }) => storage.removeFolder(creativeFolder(id))));
  }

  async queue(status: CreativeStatus): Promise<Array<CreativeView & { campaignTitle: string }>> {
    const creatives = await prisma.creative.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { campaign: { select: { title: true, advertiser: true } } },
    });

    return creatives.map(({ campaign, ...creative }) => ({
      ...this.toView(creative),
      campaignTitle: `${campaign.advertiser}: ${campaign.title}`,
    }));
  }

  /** Decides a pending ad, and tells whoever uploaded it. */
  async review(actor: Actor, id: string, dto: ReviewDto): Promise<Creative> {
    const approved = dto.decision === 'APPROVE';
    const { count } = await prisma.creative.updateMany({
      where: { id, status: CreativeStatus.PENDING_REVIEW },
      data: {
        status: approved ? CreativeStatus.APPROVED : CreativeStatus.REJECTED,
        rejectionReason: approved ? '' : dto.reason,
        reviewedById: actor.sub,
        reviewedAt: new Date(),
      },
    });

    if (count === 0) {
      const exists = await prisma.creative.count({ where: { id } });
      throw exists
        ? new AppError(409, 'This ad has already been reviewed.')
        : new AppError(404, 'Ad not found.');
    }

    const creative = await prisma.creative.findUniqueOrThrow({ where: { id } });
    const uploader = await prisma.user.findUnique({
      where: { id: creative.createdById },
      select: { email: true },
    });
    if (uploader) {
      sendEmail({
        to: uploader.email,
        subject: `Your ad "${creative.name}" was ${approved ? 'approved' : 'rejected'}`,
        body: approved ? 'It can now run in its campaign.' : `The reviewer said: ${dto.reason}`,
        link: `${env.APP_URL}/#/campaigns/${creative.campaignId}`,
      });
    }
    return creative;
  }
}

export const creativesService = new CreativesService();
