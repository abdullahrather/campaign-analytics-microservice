/**
 * src/lib/video.ts
 *
 * Inspects and converts uploaded videos with FFmpeg. Uploads are untrusted, so
 * FFmpeg is limited to local files, runs without a shell, and is stopped if it
 * takes too long.
 */
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';

const TIMEOUT_MS = 5 * 60_000;
const SAFE_INPUT = ['-hide_banner', '-nostdin', '-protocol_whitelist', 'file'];
const MAX_HEIGHT = 720;
const ALLOWED_CONTAINERS = /^(mov,mp4|matroska,webm|avi|mpegts)/;

export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
}

interface RunResult {
  code: number | null;
  stderr: string;
}

const run = (args: string[]): Promise<RunResult> =>
  new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(new Error('FFmpeg is not available on this platform.'));
      return;
    }

    const child = spawn(ffmpegPath as unknown as string, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);

    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

/** Reads a video's details. Returns null when the file isn't a usable video. */
export const probeVideo = async (filePath: string): Promise<VideoInfo | null> => {
  // With no output file FFmpeg always exits with an error, but still prints the details.
  const { stderr } = await run([...SAFE_INPUT, '-i', filePath]);

  const container = /Input #0, ([^ ]+), from/.exec(stderr)?.[1];
  const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  const size = /Stream #0.*Video: .*?(\d{2,5})x(\d{2,5})/.exec(stderr);

  if (!container || !ALLOWED_CONTAINERS.test(container) || !duration || !size) return null;

  const [, hours, minutes, seconds] = duration;
  return {
    durationSeconds: Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds),
    width: Number(size[1]),
    height: Number(size[2]),
  };
};

/** Converts a video to web-friendly H.264 that can start playing before it fully loads. */
export const transcodeVideo = async (inputPath: string, outputPath: string): Promise<void> => {
  const { code, stderr } = await run([
    ...SAFE_INPUT,
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-vf',
    `scale=-2:'min(${MAX_HEIGHT},ih)'`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath,
  ]);
  if (code !== 0) throw new Error(`Video conversion failed: ${stderr.slice(-300)}`);
};

export const extractPoster = async (videoPath: string, posterPath: string): Promise<void> => {
  const { code, stderr } = await run([
    ...SAFE_INPUT,
    '-y',
    '-ss',
    '1',
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=-2:360',
    posterPath,
  ]);
  if (code !== 0) throw new Error(`Poster creation failed: ${stderr.slice(-300)}`);
};
