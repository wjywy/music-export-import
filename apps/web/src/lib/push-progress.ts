import type { PushProgress } from './types';

export class PushStreamError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

/** Parse complete SSE frames, including UTF-8 characters split across chunks. */
export async function readPushStream<T>(response: Response, onProgress: (value: PushProgress) => void): Promise<T> {
  if (!response.body) throw new PushStreamError('没有收到迁移进度，请稍后重试。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as {
          type: string; progress: PushProgress; result: T; message: string; status: number;
        };
        if (event.type === 'progress') onProgress(event.progress);
        else if (event.type === 'result') return event.result;
        else if (event.type === 'error') throw new PushStreamError(event.message, event.status);
      }
      if (done) break;
    }
    throw new PushStreamError('进度连接中断，迁移可能仍在进行，请先到目标平台查看歌单。');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
