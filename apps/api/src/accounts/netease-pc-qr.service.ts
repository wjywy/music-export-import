import { BadGatewayException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import { CredentialCipher } from '../platforms/credential-cipher.service';
import type { AccountQr, AccountQrStatus } from './account.types';
import { NeteasePcQrClient, type PcQrCookieJar } from './netease-pc-qr.client';

interface Pending {
  userId: string;
  qr: AccountQr;
  jar: PcQrCookieJar;
  controller: AbortController;
  timer: NodeJS.Timeout;
  status: AccountQrStatus;
  nextPoll: number;
  consumed: boolean;
  polling?: Promise<AccountQrStatus>;
}

@Injectable()
export class NeteasePcQrService {
  private readonly pending = new Map<string, Pending>();
  private readonly starts = new Map<string, Promise<AccountQr>>();
  private readonly opening = new Map<string, AbortController>();
  private readonly operations = new Map<string, Set<Promise<unknown>>>();
  private readonly disconnecting = new Set<string>();
  private closed = false;

  constructor(@InjectRepository(PlatformCredential) private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher, private readonly client: NeteasePcQrClient) {}

  startQr(userId: string): Promise<AccountQr> {
    this.assertActive(userId);
    const running = this.starts.get(userId);
    if (running) return running;
    for (const entry of this.pending.values()) {
      if (entry.userId === userId && entry.qr.expiresAt.getTime() > Date.now()) return Promise.resolve(entry.qr);
    }
    if (this.pending.size + this.starts.size >= 200) throw new ServiceUnavailableException('扫码服务繁忙，请稍后重试。');
    const controller = new AbortController();
    this.opening.set(userId, controller);
    const operation = this.run(userId, async () => {
      const deviceId = this.cipher.stableId(`netease-pc:${userId}`);
      const jar: PcQrCookieJar = new Map([['deviceId', deviceId], ['os', 'pc'],
        ['_ntes_nuid', deviceId.slice(0, 32)], ['_ntes_nnid', `${deviceId.slice(0, 32)},${Date.now()}`]]);
      const body = await this.client.key(jar, controller.signal);
      this.assertActive(userId);
      if (body.code !== 200 || !body.unikey || !/^[a-zA-Z0-9-]{8,128}$/.test(body.unikey)) {
        throw new BadGatewayException('网易云没有返回有效的二维码标识，请稍后重试。');
      }
      const url = new URL('https://music.163.com/login');
      url.searchParams.set('codekey', body.unikey);
      const qr: AccountQr = { platform: 'netease', key: body.unikey, url: url.href,
        image: await QRCode.toDataURL(url.href, { width: 360, margin: 2, errorCorrectionLevel: 'M' }),
        expiresAt: new Date(Date.now() + 180_000) };
      this.assertActive(userId);
      const timer = setTimeout(() => this.remove(qr.key), 180_000);
      timer.unref();
      this.pending.set(qr.key, { userId, qr, jar, controller, timer, consumed: false,
        status: { status: 'waiting' }, nextPoll: 0 });
      return qr;
    }).finally(() => { this.starts.delete(userId); this.opening.delete(userId); });
    this.starts.set(userId, operation);
    return operation;
  }

  checkQr(userId: string, key: string): Promise<AccountQrStatus> {
    const entry = this.pending.get(key);
    if (!entry || entry.userId !== userId || entry.controller.signal.aborted ||
        entry.qr.expiresAt.getTime() <= Date.now() || this.disconnecting.has(userId) || this.closed) {
      return Promise.resolve({ status: 'expired', message: '二维码已过期，请重新生成。' });
    }
    if (entry.polling) return entry.polling;
    if (!entry.consumed && Date.now() < entry.nextPoll) return Promise.resolve(entry.status);
    const operation = this.run(userId, async (): Promise<AccountQrStatus> => {
      if (!entry.consumed) {
        const result = await this.client.poll(key, entry.jar, entry.controller.signal).catch(error => {
          const response = error instanceof BadGatewayException ? error.getResponse() : null;
          if (response && typeof response === 'object' && 'code' in response && response.code === 'NETEASE_QR_REJECTED') this.remove(key);
          throw error;
        });
        this.assertActive(userId);
        if (entry.controller.signal.aborted) return { status: 'expired' };
        entry.nextPoll = Date.now() + 3000;
        if (result.code === 801 || result.code === 802) {
          entry.status = { status: result.code === 801 ? 'waiting' : 'scanned' };
          return entry.status;
        }
        if (result.code === 800) { this.remove(key); return { status: 'expired', message: '二维码已失效，请重新生成。' }; }
        if (result.code !== 803) {
          this.remove(key);
          throw new BadGatewayException({ code: 'NETEASE_QR_REJECTED',
            message: `网易云未能完成扫码（状态 ${result.code}），请查看手机提示后重试。` });
        }
        entry.consumed = true;
        entry.status = { status: 'authorized', nickname: typeof result.nickname === 'string' ? result.nickname : null };
      }
      // Preserve a consumed result if saving fails; never re-poll a single-use key.
      this.assertActive(userId);
      const row = await this.credentials.findOne({ where: { userId, platform: 'netease' } }) ??
        this.credentials.create({ userId, platform: 'netease' });
      this.assertActive(userId);
      row.encryptedToken = this.cipher.encrypt(JSON.stringify({ cookie: this.client.cookie(entry.jar), nickname: entry.status.nickname ?? null }));
      row.tokenExpiresAt = null;
      row.storefront = 'cn';
      await this.credentials.save(row);
      this.assertActive(userId);
      this.remove(key);
      return entry.status;
    }).finally(() => { entry.polling = undefined; });
    entry.polling = operation;
    return operation;
  }

  async disconnect(userId: string): Promise<void> {
    this.disconnecting.add(userId);
    this.opening.get(userId)?.abort();
    for (const [key, entry] of this.pending) if (entry.userId === userId) this.remove(key);
    try {
      await Promise.allSettled([...(this.operations.get(userId) ?? [])]);
      await this.credentials.delete({ userId, platform: 'netease' });
    } finally { this.disconnecting.delete(userId); }
  }

  async onModuleDestroy() {
    this.closed = true;
    for (const controller of this.opening.values()) controller.abort();
    for (const key of this.pending.keys()) this.remove(key);
    await Promise.allSettled([...this.operations.values()].flatMap(set => [...set]));
  }

  private remove(key: string) {
    const entry = this.pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer); entry.controller.abort(); this.pending.delete(key);
  }

  private assertActive(userId: string) {
    if (this.closed || this.disconnecting.has(userId)) throw new ServiceUnavailableException('扫码连接正在关闭，请稍后重试。');
  }

  private run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    this.assertActive(userId);
    const operations = this.operations.get(userId) ?? new Set<Promise<unknown>>();
    this.operations.set(userId, operations);
    const operation = work().finally(() => {
      operations.delete(operation);
      if (!operations.size) this.operations.delete(userId);
    });
    operations.add(operation);
    return operation;
  }
}
