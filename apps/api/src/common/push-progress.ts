import { HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { PlatformError } from './platform-error';

export type PushStage = 'preparing' | 'matching' | 'resolving' | 'creating' | 'writing' | 'verifying' | 'done';
export type ReportPushProgress = (stage: PushStage, completed: number, total: number) => void;

const ranges: Record<PushStage, [number, number]> = {
  preparing: [0, 0], matching: [5, 35], resolving: [35, 65], creating: [65, 70],
  writing: [70, 90], verifying: [90, 99], done: [100, 100],
};

/** Preserve JSON clients while streaming authenticated POST progress to the app. */
export async function respondToPush<T>(
  response: Response,
  accept: string | undefined,
  work: (report?: ReportPushProgress) => Promise<T>,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  if (!accept?.includes('text/event-stream')) {
    response.status(201).json(await work());
    return;
  }
  response.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
  });
  response.flushHeaders();
  const send = (event: unknown) => {
    if (!response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  let percent = 0;
  const report: ReportPushProgress = (stage, completed, total) => {
    const [start, end] = ranges[stage];
    const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
    percent = Math.max(percent, Math.round(start + (end - start) * ratio));
    send({ type: 'progress', progress: { stage, completed, total, percent } });
  };
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded) response.write(': keep-alive\n\n');
  }, 15_000);
  heartbeat.unref();
  report('preparing', 0, 0);
  try {
    const result = await work(report);
    const unverified = result && typeof result === 'object' && 'unverified' in result &&
      typeof result.unverified === 'number' && result.unverified > 0;
    if (!unverified) report('done', 1, 1);
    send({ type: 'result', result });
  } catch (error) {
    let status = 500, message = '服务器出了点问题，请稍后重试。';
    if (error instanceof PlatformError) {
      status = error.status; message = error.message;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      const raw = typeof body === 'string' ? body : (body as { message?: string | string[] }).message;
      message = (Array.isArray(raw) ? raw[0] : raw) || error.message;
    } else {
      new Logger('Push').error('Unexpected playlist write failure');
    }
    send({ type: 'error', status, message });
  } finally {
    clearInterval(heartbeat);
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}
