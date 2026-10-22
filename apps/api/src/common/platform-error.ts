export type PlatformErrorCode =
  | 'UNSUPPORTED_LINK'
  | 'NOT_FOUND'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE';

export class PlatformError extends Error {
  constructor(
    public readonly code: PlatformErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformError';
  }

  get status(): number {
    if (this.code === 'UNSUPPORTED_LINK') return 400;
    if (this.code === 'AUTH_REQUIRED') return 401;
    if (this.code === 'RATE_LIMITED') return 429;
    return 502;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof PlatformError) return error.message;
  if (error instanceof Error && error.name === 'TimeoutError') {
    return '平台响应超时，请稍后重试。';
  }
  if (error instanceof Error) return error.message;
  return '未知错误';
}
