import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from './Icons';
import { Dialog } from './Dialog';
import { Loading } from './Loading';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import {
  authorizeAppleMusic,
  preloadAppleMusic,
} from '../lib/musickit';
import type {
  AccountQr,
  AccountQrStatus,
  AppleImportLinks,
  Platform,
  PushResult,
  Track,
  TransferTarget,
} from '../lib/types';

const TARGETS: { value: TransferTarget; label: string; monogram: string }[] = [
  { value: 'qq', label: 'QQ 音乐', monogram: 'Q' },
  { value: 'netease', label: '网易云音乐', monogram: '网' },
  { value: 'apple', label: 'Apple Music', monogram: 'A' },
];


const TUNEMYMUSIC_URL = 'https://www.tunemymusic.com/';
const TUNEMYMUSIC_FREE_LIMIT = 500;

function csvCell(value: string | null | undefined): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function safeFileName(title: string): string {
  return (
    title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80).trim() || 'playlist'
  );
}

function downloadFile(name: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function downloadTracks(
  items: Track[],
  title: string,
  format: 'txt' | 'csv',
  start = 0,
  end = items.length,
): void {
  const slice = items.slice(start, end);
  const base = safeFileName(title);
  const range =
    start > 0 || end < items.length ? `-${start + 1}-${end}` : '';
  if (format === 'csv') {
    const rows = [
      ['Song', 'Artist', 'Album'],
      ...slice.map((item) => [item.title, item.artist, item.album ?? '']),
    ];
    const csv = rows
      .map((row) => row.map((cell) => csvCell(cell)).join(','))
      .join('\r\n');
    downloadFile(
      `${base}${range}.csv`,
      `\ufeff${csv}\r\n`,
      'text/csv;charset=utf-8',
    );
    return;
  }

  const lines = slice.map((item) =>
    item.artist ? `${item.title} - ${item.artist}` : item.title,
  );
  downloadFile(
    `${base}${range}.txt`,
    `${lines.join('\n')}\n`,
    'text/plain;charset=utf-8',
  );
}

interface Props {
  open: boolean;
  playlistId: string;
  title: string;
  sourcePlatform: Platform | null;
  onClose: () => void;
}

export function TransferDialog({
  open,
  playlistId,
  title,
  sourcePlatform,
  onClose,
}: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<TransferTarget>('qq');
  const [qr, setQr] = useState<AccountQr | null>(null);
  const [qrState, setQrState] = useState<AccountQrStatus['status'] | 'idle'>('idle');
  const [accountError, setAccountError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [matching, setMatching] = useState(false);
  const [appleConnecting, setAppleConnecting] = useState(false);
  const [pushResult, setPushResult] = useState<PushResult | null>(null);
  const [importLinks, setImportLinks] = useState<AppleImportLinks | null>(null);
  const [creatingLinks, setCreatingLinks] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const isApple = target === 'apple';

  useEffect(() => {
    if (!open) return;
    setTarget(sourcePlatform === 'qq' ? 'netease' : 'qq');
  }, [open, sourcePlatform]);

  useEffect(() => {
    setQr(null);
    setQrState('idle');
    setAccountError(null);
    setPushResult(null);
    setMatching(false);
    setAppleConnecting(false);
    setImportLinks(null);
    setCreatingLinks(false);
    setLinkError(null);
  }, [open, target]);

  const playlist = useQuery({
    queryKey: ['playlist', playlistId],
    queryFn: () => api.playlist(playlistId),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: api.accounts,
    enabled: open && !isApple,
    staleTime: 15_000,
    retry: false,
  });

  const appleConfig = useQuery({
    queryKey: ['apple-config'],
    queryFn: api.appleConfig,
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (open && isApple && appleConfig.data?.developerToken) {
      preloadAppleMusic();
    }
  }, [open, isApple, appleConfig.data?.developerToken]);


  const account = isApple
    ? undefined
    : accounts.data?.accounts.find((entry) => entry.platform === target);

  async function connect() {
    if (isApple) return;
    setAccountError(null);
    setQrState('waiting');
    try {
      setQr(await api.startAccountQr(target));
    } catch (error) {
      setQr(null);
      setQrState('idle');
      setAccountError(error instanceof Error ? error.message : '生成二维码失败。');
    }
  }

  async function connectApple() {
    setAccountError(null);
    const config = appleConfig.data;
    if (!config) {
      setAccountError('正在读取 Apple Music 配置，请稍候。');
      return;
    }
    if (!config.configured || !config.developerToken) {
      setAccountError('Apple Music 迁移暂未开放。');
      return;
    }

    setAppleConnecting(true);
    try {
      const musicUserToken = await authorizeAppleMusic(config.developerToken);
      await api.appleAuthorize(musicUserToken);
      await queryClient.invalidateQueries({ queryKey: ['apple-config'] });
      toast('Apple Music 已连接。');
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : 'Apple Music 授权没有完成。',
      );
    } finally {
      setAppleConnecting(false);
    }
  }

  async function matchApple() {
    setMatching(true);
    setAccountError(null);
    setPushResult(null);
    try {
      const result = await api.matchPlaylist(playlistId, 'apple');
      await queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      toast(result.message);
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : '匹配 Apple Music 失败。',
      );
    } finally {
      setMatching(false);
    }
  }

  async function createAppleLinks() {
    setCreatingLinks(true);
    setLinkError(null);
    setImportLinks(null);
    try {
      const result = await api.appleImportLinks(playlistId);
      setImportLinks(result);
      toast(
        result.links.length > 1
          ? `已生成 ${result.links.length} 个导入链接，请逐段完成。`
          : '导入链接已生成。',
      );
    } catch (error) {
      setLinkError(
        error instanceof Error ? error.message : '生成 Soundiiz 导入链接失败。',
      );
    } finally {
      setCreatingLinks(false);
    }
  }

  async function pushNow() {
    setPushing(true);
    setAccountError(null);
    setPushResult(null);
    try {
      const result =
        target === 'apple'
          ? await api.applePushPlaylist(playlistId)
          : await api.pushPlaylist(playlistId, target);
      setPushResult(result);
      await queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      toast(
        result.failed > 0
          ? `写入 ${result.added} 首，失败 ${result.failed} 首。`
          : `已写入 ${result.added} 首。`,
        result.failed > 0 ? 'error' : 'default',
      );
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : '写入失败，请重试。');
    } finally {
      setPushing(false);
    }
  }

  async function disconnect() {
    setAccountError(null);
    try {
      if (isApple) {
        await api.appleDisconnect();
        await queryClient.invalidateQueries({ queryKey: ['apple-config'] });
        toast('已断开 Apple Music。');
      } else {
        await api.disconnectAccount(target);
        await queryClient.invalidateQueries({ queryKey: ['accounts'] });
        toast('已断开账号。');
      }
      setPushResult(null);
      setQr(null);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : '断开失败。');
    }
  }

  useEffect(() => {
    if (!open || !qr || isApple) return;
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const status = await api.checkAccountQr(target, qr.key);
        if (cancelled) return;
        if (status.status === 'authorized') {
          setQr(null);
          setQrState('authorized');
          await queryClient.invalidateQueries({ queryKey: ['accounts'] });
          void pushNow();
          return;
        }
        if (status.status === 'expired') {
          setQrState('expired');
          setAccountError(status.message ?? '二维码已过期。');
          return;
        }
        setQrState(status.status);
        timer = window.setTimeout(tick, 2000);
      } catch (error) {
        if (cancelled) return;
        setQrState('expired');
        setAccountError(
          error instanceof Error ? error.message : '检查扫码状态失败。',
        );
      }
    };

    timer = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, qr, target, isApple]);

  const data = playlist.data;
  const targetName =
    target === 'qq' ? 'QQ 音乐' : target === 'netease' ? '网易云音乐' : 'Apple Music';
  const total = data?.itemCount ?? 0;
  const matched = data?.matches[target] ?? 0;
  const needsMatch = Boolean(data && matched < total && data.sourcePlatform !== target);
  const appleConfigured = Boolean(appleConfig.data?.configured);
  const appleAuthorized = Boolean(appleConfigured && appleConfig.data?.authorized);
  const appleOverLimit = isApple && total > 500;
  const scanHint =
    target === 'qq'
      ? '打开手机 QQ 扫一扫，确认登录。'
      : '打开网易云音乐 App 扫一扫，确认登录。';
  const canPushApple =
    appleAuthorized && matched > 0 && !pushing && !matching && !appleOverLimit;

  return (
    <Dialog
      open={open}
      wide
      title="迁移这张歌单"
      subtitle="选一个目标，扫码或授权一次；渡口会先匹配，再写进你的账号。"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
          完成
        </button>
      }
    >
      <div className="segment transfer-targets" role="group" aria-label="目标平台">
        {TARGETS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="segment-btn"
            aria-pressed={target === entry.value}
            disabled={pushing || matching}
            onClick={() => setTarget(entry.value)}
          >
            <span className="monogram">{entry.monogram}</span>
            {entry.label}
          </button>
        ))}
      </div>

      {playlist.isLoading ? <Loading label="正在读取歌单…" /> : null}

      {playlist.isError ? (
        <div className="form-error">
          {playlist.error instanceof Error ? playlist.error.message : '读取失败，请重试。'}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="transfer-summary">
            <span>{total} 首</span>
            <span>已匹配 {matched}</span>
            {isApple ? (
              <span>
                {appleConfigured
                  ? matched < total
                    ? '先匹配，再写入'
                    : '可以写入'
                  : 'Soundiiz 免费导入'}
              </span>
            ) : needsMatch ? (
              <span>写入前自动匹配</span>
            ) : null}
          </div>

          {isApple ? (
            <section className="transfer-account">
              <div className="transfer-account-head">
                <h3>
                  {appleConfigured ? '写进 Apple Music' : '免费导入 Apple Music'}
                </h3>
                <span className="tag">
                  {appleAuthorized
                    ? `已连接 · ${appleConfig.data?.storefront ?? 'cn'}`
                    : appleConfigured
                      ? '未连接'
                      : 'Soundiiz'}
                </span>
              </div>

              {appleConfig.isLoading && !appleConfig.data ? (
                <Loading label="正在检查 Apple Music 直连配置…" />
              ) : !appleConfigured ? (
                <>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={creatingLinks}
                      onClick={() => void createAppleLinks()}
                    >
                      {creatingLinks
                        ? '正在生成…'
                        : importLinks
                          ? '重新生成导入链接'
                          : '生成 Apple Music 导入链接'}
                    </button>
                  </div>

                  {linkError ? <div className="form-error">{linkError}</div> : null}

                  {importLinks ? (
                    <>
                      <div className="panel-actions">
                        {importLinks.links.map((link) => (
                          <a
                            key={link.index}
                            className="btn btn-primary btn-sm"
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {importLinks.links.length > 1
                              ? `第 ${link.index} 段（${link.from}–${link.to}）`
                              : '打开 Soundiiz 完成导入'}
                            <ArrowUpRight size={12} />
                          </a>
                        ))}
                      </div>
                      <ol
                        className="field-hint"
                        style={{ paddingLeft: 20, lineHeight: 1.8 }}
                      >
                        <li>打开链接，登录并连接 Apple Music。</li>
                        <li>确认匹配后开始导入；没匹配到的歌会在结果里列出。</li>
                      </ol>
                    </>
                  ) : null}

                  <details>
                    <summary className="field-hint">
                      备用：下载文件用 TuneMyMusic 导入
                    </summary>
                    <div className="panel-actions">
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => downloadTracks(data.items, title, 'txt')}
                      >
                        下载 TXT
                      </button>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => downloadTracks(data.items, title, 'csv')}
                      >
                        下载 CSV
                      </button>
                      <a
                        className="btn btn-ghost btn-sm"
                        href={TUNEMYMUSIC_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开 TuneMyMusic
                        <ArrowUpRight size={12} />
                      </a>
                    </div>
                    {total > TUNEMYMUSIC_FREE_LIMIT ? (
                      <>
                        <p className="field-hint">
                          分段文件（TuneMyMusic 免费版每次最多 500 首）：
                        </p>
                        <div className="panel-actions">
                          {Array.from(
                            {
                              length: Math.ceil(
                                total / TUNEMYMUSIC_FREE_LIMIT,
                              ),
                            },
                            (_, index) => {
                              const start = index * TUNEMYMUSIC_FREE_LIMIT;
                              const end = Math.min(
                                start + TUNEMYMUSIC_FREE_LIMIT,
                                total,
                              );
                              return (
                                <button
                                  key={start}
                                  type="button"
                                  className="btn btn-quiet btn-sm"
                                  onClick={() =>
                                    downloadTracks(
                                      data.items,
                                      title,
                                      'csv',
                                      start,
                                      end,
                                    )
                                  }
                                >
                                  第 {index + 1} 段（{start + 1}–{end}）
                                </button>
                              );
                            },
                          )}
                        </div>
                      </>
                    ) : null}
                    <ol
                      className="field-hint"
                      style={{ paddingLeft: 20, lineHeight: 1.8 }}
                    >
                      <li>
                        打开 TuneMyMusic，来源选「Upload file」并上传刚下载的文件。
                      </li>
                      <li>目标选 Apple Music，登录你的 Apple ID。</li>
                      <li>确认匹配后开始传输。</li>
                    </ol>
                  </details>
                </>
              ) : (
                <>
                  {appleConfig.isError ? (
                    <div className="form-error">
                      {appleConfig.error instanceof Error
                        ? appleConfig.error.message
                        : '读取 Apple Music 配置失败。'}
                    </div>
                  ) : null}

                  {!appleAuthorized ? (
                    <>
                      <p className="field-hint">
                        需要有效的 Apple Music 订阅；授权由 Apple 在浏览器弹窗完成。v1
                        只支持中国区账号。
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={appleConnecting}
                        onClick={() => void connectApple()}
                      >
                        {appleConnecting ? '正在连接…' : '连接 Apple Music'}
                      </button>
                    </>
                  ) : null}

                  {appleAuthorized ? (
                    <>
                      <p className="field-hint">
                        会在资料库新建「{title} · 渡口」，不改动已有歌单。渡口的「删除」只删本地记录；如需删除 Apple Music 里的歌单，请到 Apple Music App 操作。
                      </p>
                      {appleOverLimit ? (
                        <div className="form-error">
                          Apple Music 直写目前最多支持 500 首，请先拆分歌单。
                        </div>
                      ) : null}
                      <div className="panel-actions">
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          disabled={matching || pushing || appleOverLimit}
                          onClick={() => void matchApple()}
                        >
                          {matching
                            ? '正在匹配…'
                            : matched > 0
                              ? `重新匹配（已匹配 ${matched}/${total}）`
                              : `匹配 Apple Music（${total} 首）`}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={!canPushApple}
                          onClick={() => void pushNow()}
                        >
                          {pushing ? '正在写入…' : `写入资料库（${matched} 首）`}
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          disabled={matching || pushing}
                          onClick={() => void disconnect()}
                        >
                          断开
                        </button>
                      </div>
                    </>
                  ) : null}

                  {matching ? (
                    <div className="panel-row">
                      <Loading label="正在搜索 Apple Music 曲库，可能要到 1 分钟…" />
                    </div>
                  ) : null}

                  {pushing ? (
                    <div className="panel-row">
                      <Loading label="正在写入 Apple Music 资料库…" />
                    </div>
                  ) : null}
                </>
              )}
            </section>
          ) : (
            <section className="transfer-account">
              <div className="transfer-account-head">
                <h3>写进 {targetName}</h3>
                <span className="tag">
                  {account?.connected
                    ? `已连接${account.nickname ? ` · ${account.nickname}` : ''}`
                    : '未连接'}
                </span>
              </div>

              {account?.connected ? (
                <>
                  <p className="field-hint">
                    会在你的{targetName}账号里新建一张「{title} · 渡口」歌单，不改动已有歌单。
                  </p>
                  <div className="panel-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={pushing}
                      onClick={() => void pushNow()}
                    >
                      {pushing
                        ? needsMatch
                          ? '正在匹配并写入…'
                          : '正在写入…'
                        : `一键迁移（${total} 首）`}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm"
                      onClick={() => void disconnect()}
                    >
                      断开账号
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="field-hint">
                    扫码一次，之后渡口直接建歌单；登录态 AES-256-GCM 加密保存，可随时断开。
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(qr) || pushing}
                    onClick={() => void connect()}
                  >
                    {qr ? '等待扫码…' : `扫码连接 ${targetName}`}
                  </button>
                </>
              )}

              {qr ? (
                <div className="account-qr">
                  <img src={qr.image} alt={`${targetName} 登录二维码`} />
                  <p>
                    {qrState === 'scanned'
                      ? '已扫码，请在手机上确认。'
                      : qrState === 'expired'
                        ? '二维码已过期。'
                        : scanHint}
                  </p>
                  {qrState === 'expired' ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void connect()}
                    >
                      重新生成
                    </button>
                  ) : null}
                </div>
              ) : null}

              {pushing ? (
                <div className="panel-row">
                  <Loading label={needsMatch ? '正在匹配并写入…' : '正在写入…'} />
                </div>
              ) : null}
            </section>
          )}

          {pushResult ? (
            <div className="push-result">
              <p>
                已写入 {pushResult.added} 首
                {pushResult.skipped > 0 ? `，跳过 ${pushResult.skipped} 首` : ''}
                {pushResult.failed > 0 ? `，失败 ${pushResult.failed} 首` : ''}。
              </p>
              {pushResult.warning ? (
                <p className="field-hint">{pushResult.warning}</p>
              ) : null}
              <a href={pushResult.url} target="_blank" rel="noreferrer">
                打开「{pushResult.name}」
                <ArrowUpRight size={12} />
              </a>
            </div>
          ) : null}

          {accountError ? <div className="form-error">{accountError}</div> : null}
        </>
      ) : null}
    </Dialog>
  );
}
