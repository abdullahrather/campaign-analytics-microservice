/**
 * src/lib/storage.ts
 *
 * Where media files live. Everything goes through keys such as
 * "creatives/abc/video.mp4", so moving to cloud storage later only means
 * writing another implementation of this interface.
 */
import fs from 'fs/promises';
import path from 'path';
import { env } from '@/config/env';

export interface MediaStorage {
  /** Moves a local file into storage. */
  store(sourcePath: string, key: string): Promise<void>;
  /** Returns a local path for reading a stored file. */
  localPath(key: string): string;
  size(key: string): Promise<number>;
  remove(key: string): Promise<void>;
  /** Removes a key and everything under it. */
  removeFolder(key: string): Promise<void>;
}

class LocalStorage implements MediaStorage {
  private readonly root = path.resolve(env.MEDIA_DIR);

  localPath(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return resolved;
  }

  async store(sourcePath: string, key: string): Promise<void> {
    const target = this.localPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.rename(sourcePath, target);
    } catch (error) {
      // Temporary files can be on another drive, which a rename can't cross.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      await fs.copyFile(sourcePath, target);
      await fs.rm(sourcePath, { force: true });
    }
  }

  async size(key: string): Promise<number> {
    return (await fs.stat(this.localPath(key))).size;
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.localPath(key), { force: true });
  }

  async removeFolder(key: string): Promise<void> {
    await fs.rm(this.localPath(key), { recursive: true, force: true });
  }
}

export const storage: MediaStorage = new LocalStorage();
