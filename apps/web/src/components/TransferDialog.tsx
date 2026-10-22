import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight } from './Icons';
import { Dialog } from './Dialog';
import { Loading } from './Loading';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import type {
  AccountPushResult,
  AccountQr,
  AccountQrStatus,
  Platform,
  TransferTarget,
} from '../lib/types';

const TARGETS: { value: TransferTarget; label: string; monogram: string }[] = [
  { value: 'qq', label: 'QQ 音乐', monogram: 'Q' },
  { value: 'netease', label: '网易云音乐', monogram: '网' },
];

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
  const [pushResult, setPushResult] = useState<AccountPushResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setTarget(sourcePlatform === 'qq' ? 'netease' : 'qq');
  }, [open, sourcePlatform]);

  useEffect(() => {
    setQr(null);
    setQrState('idle');
    setAccountError(null);
    setPushResult(null);
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
    enabled: open,
    staleTime: 15_000,
    retry: false,
  });

  const account = accounts.data?.accounts.find((entry) => entry.platform === target);

  async function connect() {
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

  async function pushNow() {
    setPushing(true);
    setAccountError(null);
    setPushResult(null);
    try {
      const result = await api.pushPlaylist(playlistId, target);
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
    try {
      await api.disconnectAccount(target);
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setPushResult(null);
      setQr(null);
      toast('已断开账号。');
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : '断开失败。');
    }
  }

  useEffect(() => {
    if (!open || !qr) return;
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
  }, [open, qr, target]);

  const data = playlist.data;
  const targetName = target === 'qq' ? 'QQ 音乐' : '网易云音乐';
  const total = data?.itemCount ?? 0;
  const matched = data?.matches[target] ?? 0;
  const needsMatch = Boolean(data && matched < total && data.sourcePlatform !== target);
  const scanHint =
    target === 'qq'
      ? '打开手机 QQ 扫一扫，确认登录。'
      : '打开网易云音乐 App 扫一扫，确认登录。';

  return (
    <Dialog
      open={open}
      wide
      title="迁移这张歌单"
      subtitle="选一个方向，扫码一次；渡口会自动匹配并写进你的账号。"
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
            {needsMatch ? <span>写入前自动匹配</span> : null}
          </div>

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

            {pushResult ? (
              <div className="push-result">
                <p>
                  已写入 {pushResult.added} 首
                  {pushResult.skipped > 0 ? `，跳过 ${pushResult.skipped} 首` : ''}
                  {pushResult.failed > 0 ? `，失败 ${pushResult.failed} 首` : ''}。
                </p>
                <a href={pushResult.url} target="_blank" rel="noreferrer">
                  打开「{pushResult.name}」
                  <ArrowUpRight size={12} />
                </a>
              </div>
            ) : null}

            {accountError ? <div className="form-error">{accountError}</div> : null}
          </section>
        </>
      ) : null}
    </Dialog>
  );
}
