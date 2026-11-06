import { ServiceUnavailableException } from '@nestjs/common';
import {
  closeQrBrowser,
  closeQrSession,
  openQrSession,
  type BrowserQrSession,
} from './netease-qr-browser';

const MAX_SESSIONS = 2;

/** One unassigned code may be prepared, but each acquired browser context has one owner. */
export class NeteaseQrPool {
  private prepared: Promise<BrowserQrSession> | null = null;
  private idleTimer: NodeJS.Timeout | undefined;
  private readonly sessions = new Set<BrowserQrSession>();
  private opening = 0;
  private retryAfter = 0;
  private closed = false;

  constructor(
    private readonly open = openQrSession,
    private readonly dispose = closeQrSession,
    private readonly shutdown = closeQrBrowser,
  ) {}

  prepare(): void {
    if (Date.now() >= this.retryAfter) this.prepareSession();
  }

  private prepareSession(): void {
    if (this.closed || this.prepared || this.sessions.size + this.opening >= MAX_SESSIONS) return;
    this.opening += 1;
    const pending = this.open().then(async (session) => {
      // Transfer the slot from opening to active in one turn, without counting it twice.
      this.opening -= 1;
      if (this.closed) {
        await this.dispose(session);
        throw new ServiceUnavailableException('扫码服务正在重启，请稍后重试。');
      }
      this.sessions.add(session);
      if (this.prepared === pending) {
        const idleMs = Math.max(0, session.expiresAt - Date.now() - 15_000);
        this.idleTimer = setTimeout(() => {
          if (this.prepared !== pending) return;
          this.prepared = null;
          void this.release(session);
        }, idleMs);
        this.idleTimer.unref();
      }
      return session;
    }, (error: unknown) => {
      this.opening -= 1;
      throw error;
    });
    this.prepared = pending;
    // Preparation runs in the background. A subsequent click may explicitly retry.
    void pending.catch(() => {
      if (this.prepared === pending) this.prepared = null;
      this.retryAfter = Date.now() + 15_000;
    });
  }

  async acquire(): Promise<BrowserQrSession> {
    this.prepareSession();
    const pending = this.prepared;
    if (!pending) {
      throw new ServiceUnavailableException('扫码服务繁忙，请稍后重试。');
    }
    // Claim before awaiting so concurrent users never receive the same code.
    this.prepared = null;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    const session = await pending;
    if (session.status === 'expired' || session.expiresAt <= Date.now()) {
      await this.release(session);
      throw new ServiceUnavailableException('二维码已过期，请重新生成。');
    }
    return session;
  }

  async release(session: BrowserQrSession): Promise<void> {
    if (!this.sessions.delete(session)) return;
    await this.dispose(session);
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    this.prepared = null;
    clearTimeout(this.idleTimer);
    await Promise.allSettled([...this.sessions].map((session) => this.release(session)));
    await this.shutdown();
  }
}
