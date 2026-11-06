import {
  BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import QRCode from 'qrcode';
import { Repository } from 'typeorm';
import { PlatformCredential } from '../common/entities/platform-credential.entity';
import type { ParsedRef, RemotePlaylist, RemoteTrack } from '../platforms/adapter.interface';
import { CredentialCipher } from '../platforms/credential-cipher.service';
import type { PlaylistDetail } from '../playlists/playlists.service';
import type { AccountPushResult, AccountQr, AccountQrStatus, AccountStatus } from './account.types';
import { chunkArray, compactPlaylistName, neteaseIdFromUrl } from './account.utils';
import { resolveNeteaseSongIds } from './netease-openapi-song-resolver';
import type { ReportPushProgress } from '../common/push-progress';
import {
  NETEASE_OPENAPI as API, NeteaseOpenApiClient, NeteaseOpenApiError,
  type OpenApiContext, type OpenApiEndpoint, type OpenApiRecord,
  type OpenApiRecords, type OpenApiToken,
} from './netease-openapi.client';

interface OfficialSession extends OpenApiContext, OpenApiToken {
  kind: 'openapi';
  appId: string;
  accountId: string;
  nickname: string | null;
}

interface PendingQr {
  userId: string;
  qr: AccountQr;
  context: OpenApiContext;
  timer: NodeJS.Timeout;
  cancelled: boolean;
  polling?: Promise<AccountQrStatus>;
  authorizedToken?: OpenApiToken;
}

const PAGE_SIZE = 500;
const positiveId = (value: unknown): string | null =>
  /^(?:[1-9]\d*)$/.test(String(value ?? '')) ? String(value) : null;
const encryptedId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f\d]{32}$/i.test(value);

@Injectable()
export class NeteaseOpenApiAccountService {
  private readonly pending = new Map<string, PendingQr>();
  private readonly starts = new Map<string, Promise<AccountQr>>();
  private readonly operations = new Map<string, Set<Promise<unknown>>>();
  private readonly disconnecting = new Set<string>();
  private readonly disconnects = new Map<string, Promise<{ ok: true }>>();
  private readonly refreshes = new Map<string, Promise<OfficialSession>>();
  private readonly writes = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    @InjectRepository(PlatformCredential)
    private readonly credentials: Repository<PlatformCredential>,
    private readonly cipher: CredentialCipher,
    private readonly client: NeteaseOpenApiClient,
  ) {}

  get enabled(): boolean { return this.client.enabled; }
  get qrEnabled(): boolean { return this.client.qrProvider === 'openapi'; }

  async ownsSession(userId: string): Promise<boolean> {
    return Boolean(await this.readSession(userId, false));
  }

  async status(userId: string): Promise<AccountStatus> {
    const row = await this.credentials.findOne({ where: { userId, platform: 'netease' } });
    let connected = false;
    let nickname: string | null = null;
    if (row) {
      try {
        const value = JSON.parse(this.cipher.decrypt(row.encryptedToken));
        connected = value.kind === 'openapi'
          ? value.appId === this.client.appId && Boolean(value.accessToken && value.refreshToken)
          : Boolean(value.cookie);
        nickname = typeof value.nickname === 'string' ? value.nickname : null;
      } catch { /* An unreadable credential is disconnected. */ }
    }
    return { platform: 'netease', connected, nickname, connectedAt: row?.createdAt ?? null };
  }

  startQr(userId: string): Promise<AccountQr> {
    const running = this.starts.get(userId);
    if (running) return running;
    const promise = this.run(userId, async () => {
      for (const [key, entry] of this.pending) {
        if (entry.userId !== userId) continue;
        if (entry.qr.expiresAt.getTime() > Date.now()) return entry.qr;
        this.remove(key);
      }
      if (this.pending.size + this.starts.size >= 200) throw new ServiceUnavailableException('扫码服务繁忙，请稍后重试。');
      const next = await this.client.startQr(userId);
      this.assertActive(userId);
      const image = await QRCode.toDataURL(next.url, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
      this.assertActive(userId);
      const qr: AccountQr = { platform: 'netease', key: next.key, image, url: next.url,
        expiresAt: new Date(next.expiresAt) };
      const timer = setTimeout(() => this.remove(next.key), Math.max(0, next.expiresAt - Date.now()));
      timer.unref();
      this.pending.set(next.key, { userId, qr, context: next.context, timer, cancelled: false });
      return qr;
    }).finally(() => this.starts.delete(userId));
    this.starts.set(userId, promise);
    return promise;
  }

  checkQr(userId: string, key: string): Promise<AccountQrStatus> {
    const entry = this.pending.get(key);
    if (!entry || entry.userId !== userId || entry.cancelled ||
        entry.qr.expiresAt.getTime() <= Date.now() || this.disconnecting.has(userId)) {
      if (entry?.userId === userId) this.remove(key);
      return Promise.resolve({ status: 'expired', message: '二维码已过期，请重新生成。' });
    }
    if (entry.polling) return entry.polling;
    const promise = this.run(userId, async (): Promise<AccountQrStatus> => {
      if (!entry.authorizedToken) {
        const data = await this.client.poll(key, entry.context);
        if (entry.cancelled || this.disconnecting.has(userId)) return { status: 'expired' };
        if (Number(data?.status) === 801) return { status: 'waiting' };
        if (Number(data?.status) === 802) return { status: 'scanned' };
        if (Number(data?.status) === 800) {
          this.remove(key);
          return { status: 'expired', message: '网易云二维码已失效，请重新生成。' };
        }
        if (Number(data?.status) !== 803) {
          throw new BadGatewayException('网易云扫码状态异常，请稍后重试。');
        }
        // 803 consumes this key. Retrying profile/storage must never poll it again.
        entry.authorizedToken = this.client.token(data.accessToken);
      }
      const token = entry.authorizedToken;
      const session: OfficialSession = { ...token, device: entry.context.device,
        kind: 'openapi', appId: this.client.appId, accountId: '', nickname: null };
      const profile = await this.client.request<{ id?: string; nickname?: string }>(API.profile, {}, session)
        .catch((error: unknown) => {
          if (error instanceof NeteaseOpenApiError && error.upstreamCode === 301) {
            throw new BadGatewayException({ code: 'NETEASE_PROFILE_FORBIDDEN',
              message: '扫码授权已成功，但网易云拒绝读取此账号资料（301：用户未授权当前接口）。请检查应用的账号及接口授权范围。' });
          }
          throw error;
        });
      if (!profile?.id) throw new BadGatewayException('网易云没有返回已授权的账号信息。');
      if (entry.cancelled || this.disconnecting.has(userId)) return { status: 'expired' };
      session.accountId = profile.id;
      session.nickname = typeof profile.nickname === 'string' ? profile.nickname : null;
      await this.saveSession(userId, session);
      this.remove(key);
      return { status: 'authorized', nickname: session.nickname };
    }).finally(() => { entry.polling = undefined; });
    entry.polling = promise;
    return promise;
  }

  disconnect(userId: string): Promise<{ ok: true }> {
    const existing = this.disconnects.get(userId);
    if (existing) return existing;
    this.disconnecting.add(userId);
    this.removeUserCodes(userId);
    const promise = (async (): Promise<{ ok: true }> => {
      await Promise.allSettled([...(this.operations.get(userId) ?? [])]);
      this.removeUserCodes(userId);
      await this.credentials.delete({ userId, platform: 'netease' });
      return { ok: true };
    })().finally(() => {
      this.disconnecting.delete(userId);
      this.disconnects.delete(userId);
    });
    this.disconnects.set(userId, promise);
    return promise;
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    for (const key of this.pending.keys()) this.remove(key);
    await Promise.allSettled([...this.operations.values()].flatMap((set) => [...set]));
  }

  push(userId: string, detail: PlaylistDetail, name?: string, report?: ReportPushProgress): Promise<AccountPushResult> {
    return this.run(userId, async () => {
      const call = await this.caller(userId);
      const wanted = new Map<string, { title: string; artist: string }>();
      for (const item of detail.items) {
        const match = item.matches.find((value) => value.platform === 'netease' && value.status === 'matched');
        const id = positiveId(match?.remoteId) ??
          (item.sourcePlatform === 'netease' ? neteaseIdFromUrl(item.sourceUrl) : null);
        if (id) wanted.set(id, { title: match?.remoteTitle || item.title,
          artist: match?.remoteArtist || item.artist });
      }
      if (!wanted.size) throw new BadRequestException('还没有可写入的网易云曲目，请先匹配。');
      const resolved = await resolveNeteaseSongIds(wanted, (keyword) =>
        call<OpenApiRecords>(API.searchSongs, { keyword, limit: 100, offset: 0 }),
        (completed, total) => report?.('resolving', completed, total));
      if (!resolved.size) throw new BadGatewayException('网易云官方接口未返回已匹配歌曲，请重新匹配后重试。');
      const playlistName = compactPlaylistName(name ?? detail.title, 40);
      report?.('creating', 0, 1);
      const created = await call<OpenApiRecord | string | number>(API.create, { playlistName });
      let playlist = typeof created === 'object' && created ? created : { id: String(created ?? '') };
      if (!encryptedId(playlist.id)) {
        const original = positiveId(playlist.originalId ?? playlist.id);
        if (!original) throw new BadGatewayException('网易云创建歌单后未返回可用的歌单标识。');
        const list = await call<OpenApiRecords>(API.created, { limit: PAGE_SIZE, offset: 0 });
        playlist = list?.records?.find((record) => positiveId(record.originalId) === original) ?? playlist;
      }
      if (!encryptedId(playlist.id)) throw new BadGatewayException('网易云创建歌单后未返回可用的歌单标识。');
      if (!positiveId(playlist.originalId)) {
        playlist = await call<OpenApiRecord>(API.playlist, { playlistId: playlist.id });
      }
      const originalId = positiveId(playlist?.originalId);
      if (!originalId || !encryptedId(playlist.id)) throw new BadGatewayException('网易云没有返回新歌单的完整信息。');
      const ids = [...resolved.values()];
      let submitted = 0;
      report?.('writing', 0, ids.length);
      for (const group of chunkArray(ids, PAGE_SIZE)) {
        await call(API.add, { playlistId: playlist.id, songIdList: group }, 'POST');
        submitted += group.length;
        report?.('writing', submitted, ids.length);
      }
      const confirmed = new Set<string>();
      let verificationFailed = false;
      report?.('verifying', 0, ids.length);
      try {
        for (let offset = 0; offset < ids.length; offset += PAGE_SIZE) {
          const tracks = await call<OpenApiRecord[]>(API.tracks, { playlistId: playlist.id, limit: PAGE_SIZE, offset });
          if (!Array.isArray(tracks)) throw new BadGatewayException('网易云已接收写入请求，但未返回歌单曲目，请打开目标歌单核对。');
          for (const track of tracks) {
            const original = positiveId(track.originalId);
            if (original && resolved.has(original)) confirmed.add(original);
          }
          report?.('verifying', Math.min(ids.length, offset + tracks.length), ids.length);
          if (tracks.length < PAGE_SIZE) break;
        }
      } catch {
        verificationFailed = true;
      }
      const added = confirmed.size;
      const unresolved = wanted.size - resolved.size;
      const unverified = verificationFailed ? resolved.size - added : 0;
      const unconfirmed = verificationFailed ? 0 : resolved.size - added;
      const skipped = detail.items.length - wanted.size;
      const notes = [
        skipped ? `${skipped} 首未匹配或重复，已跳过。` : '',
        unresolved ? `${unresolved} 首未查到相同歌曲 ID，未替换成其他版本。` : '',
        unconfirmed ? `${unconfirmed} 首已提交但未在目标歌单中确认，请打开歌单核对。` : '',
        unverified ? `${unverified} 首已提交但暂时无法核对，请打开目标歌单确认，避免重复迁移。` : '',
      ].filter(Boolean);
      return { platform: 'netease', playlistId: originalId, name: playlistName,
        url: `https://music.163.com/#/playlist?id=${originalId}`, added,
        skipped, failed: unresolved + unconfirmed,
        ...(unverified ? { unverified } : {}),
        ...(notes.length ? { warning: notes.join('') } : {}) };
    });
  }

  fetchPlaylist(userId: string, ref: ParsedRef, publicReader: () => Promise<RemotePlaylist>): Promise<RemotePlaylist> {
    return this.run(userId, async () => {
      const call = await this.caller(userId);
      let found: OpenApiRecord | undefined;
      for (const endpoint of [API.created, API.collected]) {
        for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
          const data = await call<OpenApiRecords>(endpoint, { limit: PAGE_SIZE, offset });
          found = data?.records?.find((record) => positiveId(record.originalId) === ref.id);
          if (found || (data?.records?.length ?? 0) < PAGE_SIZE) break;
        }
        if (found) break;
      }
      if (!found) {
        const publicPlaylist = await publicReader();
        if (!publicPlaylist.warning) return publicPlaylist;
        const search = await call<OpenApiRecords>(API.searchPlaylists,
          { keyword: publicPlaylist.name, limit: 100, offset: 0 });
        found = search?.records?.find((record) => positiveId(record.originalId) === ref.id);
        if (!found) return publicPlaylist;
      }
      if (!encryptedId(found.id)) throw new BadGatewayException('网易云没有返回可用的歌单标识。');
      const info = await call<OpenApiRecord>(API.playlist, { playlistId: found.id });
      const tracks: RemoteTrack[] = [];
      const seen = new Set<string>();
      const declared = Number(info?.trackCount ?? found.trackCount ?? 0);
      for (let offset = 0; offset < 20_000; offset += PAGE_SIZE) {
        // Unlike search/list endpoints, this API returns the song array directly.
        const songs = await call<OpenApiRecord[]>(API.tracks,
          { playlistId: found.id, limit: PAGE_SIZE, offset });
        if (!Array.isArray(songs)) throw new BadGatewayException('网易云返回的歌单曲目格式无效。');
        for (const song of songs) {
          const id = positiveId(song.originalId);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          tracks.push({ title: song.name || '未知曲目',
            artist: (song.artists ?? []).map((artist) => artist.name).filter(Boolean).join(' / '),
            album: song.album?.name ?? null, durationMs: song.duration ?? null,
            coverUrl: song.coverImgUrl ?? null, sourceId: id,
            sourceUrl: `https://music.163.com/#/song?id=${id}` });
        }
        if (songs.length < PAGE_SIZE || (declared > 0 && tracks.length >= declared)) break;
      }
      return { name: info?.name || found.name || '未命名歌单',
        description: info?.describe ?? found.describe ?? null,
        coverUrl: info?.coverImgUrl ?? found.coverImgUrl ?? null,
        creator: info?.creatorNickName ?? found.creatorNickName ?? null, tracks,
        warning: declared > tracks.length ? `平台返回 ${tracks.length} 首（共 ${declared} 首）。` : undefined };
    });
  }

  private async readSession(userId: string, required = true): Promise<OfficialSession | null> {
    const row = await this.credentials.findOne({ where: { userId, platform: 'netease' } });
    if (row) {
      try {
        const value = JSON.parse(this.cipher.decrypt(row.encryptedToken));
        if (value.kind === 'openapi' && value.appId === this.client.appId &&
            typeof value.accessToken === 'string' && value.accessToken &&
            typeof value.refreshToken === 'string' && value.refreshToken &&
            typeof value.device?.deviceId === 'string' && Number.isFinite(value.expiresAt)) {
          return value as OfficialSession;
        }
      } catch { /* Fall through to a disconnected session. */ }
    }
    if (required) throw new UnauthorizedException('网易云官方授权已失效，请重新扫码。');
    return null;
  }

  private async freshSession(userId: string): Promise<OfficialSession> {
    const session = (await this.readSession(userId))!;
    return session.expiresAt > Date.now() + 30_000 ? session : this.refreshSession(userId, session);
  }

  private async caller(userId: string) {
    let session = await this.freshSession(userId);
    return async <T>(endpoint: OpenApiEndpoint, business: Record<string, unknown>, method: 'GET' | 'POST' = 'GET'): Promise<T> => {
      this.assertActive(userId);
      const attempted = session;
      try { return await this.client.request<T>(endpoint, business, attempted, method); }
      catch (error) {
        if (!(error instanceof NeteaseOpenApiError)) throw error;
        if (error.upstreamCode === 1407 || error.upstreamCode === 1408) {
          throw new UnauthorizedException('网易云官方授权已失效，请重新扫码。');
        }
        if (error.upstreamCode !== 1406) throw error;
        session = await this.refreshSession(userId, attempted);
        this.assertActive(userId);
        return this.client.request<T>(endpoint, business, session, method);
      }
    };
  }

  private async refreshSession(userId: string, session: OfficialSession): Promise<OfficialSession> {
    const current = (await this.readSession(userId))!;
    if (current.accessToken !== session.accessToken) {
      if (!session.accountId || current.accountId !== session.accountId) {
        throw new UnauthorizedException('网易云账号连接已更新，请重试。');
      }
      return current;
    }
    const refreshKey = `${userId}:${session.accessToken}`;
    const existing = this.refreshes.get(refreshKey);
    if (existing) return existing;
    const promise = (async () => {
      let token: OpenApiToken;
      try { token = await this.client.refresh(session, session.refreshToken); }
      catch (error) {
        if (error instanceof NeteaseOpenApiError && [1406, 1407, 1408].includes(error.upstreamCode)) {
          throw new UnauthorizedException('网易云官方授权已失效，请重新扫码。');
        }
        throw error;
      }
      this.assertActive(userId);
      const next = { ...session, ...token };
      await this.saveSession(userId, next, session.accessToken);
      return next;
    })().finally(() => this.refreshes.delete(refreshKey));
    this.refreshes.set(refreshKey, promise);
    return promise;
  }

  private saveSession(userId: string, session: OfficialSession, previousToken?: string): Promise<void> {
    const previous = this.writes.get(userId) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(async () => {
      const row = (await this.credentials.findOne({ where: { userId, platform: 'netease' } })) ??
        this.credentials.create({ userId, platform: 'netease' });
      this.assertActive(userId);
      if (previousToken) {
        const current = row.encryptedToken
          ? JSON.parse(this.cipher.decrypt(row.encryptedToken)) : null;
        if (current?.accessToken !== previousToken) {
          throw new UnauthorizedException('网易云账号连接已更新，请重试。');
        }
      }
      row.encryptedToken = this.cipher.encrypt(JSON.stringify(session));
      row.storefront = 'cn';
      row.tokenExpiresAt = new Date(session.expiresAt);
      await this.credentials.save(row);
    }).finally(() => { if (this.writes.get(userId) === write) this.writes.delete(userId); });
    this.writes.set(userId, write);
    return write;
  }

  private run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    try { this.assertActive(userId); } catch (error) { return Promise.reject(error); }
    const operations = this.operations.get(userId) ?? new Set<Promise<unknown>>();
    this.operations.set(userId, operations);
    const promise = work().finally(() => {
      operations.delete(promise);
      if (!operations.size && this.operations.get(userId) === operations) this.operations.delete(userId);
    });
    operations.add(promise);
    return promise;
  }

  private assertActive(userId: string): void {
    if (this.closed || this.disconnecting.has(userId)) {
      throw new ServiceUnavailableException('账号连接正在关闭，请稍后重试。');
    }
  }

  private remove(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    entry.cancelled = true;
    clearTimeout(entry.timer);
    this.pending.delete(key);
  }

  private removeUserCodes(userId: string): void {
    for (const [key, entry] of this.pending) if (entry.userId === userId) this.remove(key);
  }
}
