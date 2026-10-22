import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Copy,
  Download,
  ShareIcon,
  Trash,
} from '../components/Icons';
import { AssignMatchDialog } from '../components/AssignMatchDialog';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { Loading, LoadingBlock } from '../components/Loading';
import { PlaylistCover } from '../components/PlaylistCover';
import { TrackTable } from '../components/TrackTable';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate, formatRelative } from '../lib/format';
import { platformName, PLATFORM_INFO, PLATFORM_ORDER } from '../lib/platforms';
import type { Platform, SharePermission, Track, Visibility } from '../lib/types';

const VISIBILITY_LABEL: Record<Visibility, string> = {
  private: '私密',
  unlisted: '链接可见',
  public: '公开',
};

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [platform, setPlatform] = useState<Platform | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editVisibility, setEditVisibility] = useState<Visibility>('private');
  const [sharePermission, setSharePermission] = useState<SharePermission>('clone');
  const [shareExpiry, setShareExpiry] = useState(0);
  const [assignTarget, setAssignTarget] = useState<Track | null>(null);

  const detail = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.playlist(id as string),
    enabled: Boolean(id),
  });
  const shares = useQuery({ queryKey: ['shares'], queryFn: api.shares });
  const appleConfig = useQuery({
    queryKey: ['apple-config'],
    queryFn: api.appleConfig,
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (platform || !detail.data) return;
    const found = PLATFORM_ORDER.find(
      (entry) => (detail.data?.matches?.[entry] ?? 0) > 0,
    );
    if (found) setPlatform(found);
  }, [detail.data, platform]);

  const match = useMutation({
    mutationFn: (target: Platform) => api.match(id as string, target),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast(result.message);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '匹配失败，请重试。', 'error');
    },
  });

  const delivery = useQuery({
    queryKey: ['delivery', id, platform],
    queryFn: () => api.delivery(id as string, platform as Platform),
    enabled: deliveryOpen && Boolean(id) && Boolean(platform),
  });

  const createShare = useMutation({
    mutationFn: () =>
      api.createShare(id as string, sharePermission, shareExpiry || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shares'] });
      toast('分享链接已生成。');
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '分享失败，请重试。', 'error');
    },
  });

  const revokeShare = useMutation({
    mutationFn: (shareId: string) => api.revokeShare(shareId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shares'] });
      toast('分享链接已取消。');
    },
    onError: () => toast('取消失败，请重试。', 'error'),
  });

  const applePush = useMutation({
    mutationFn: () => api.applePushPlaylist(id as string),
    onSuccess: (result) => {
      toast(`已写入 Apple Music 资料库：${result.added} 首。`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '写入 Apple Music 失败。', 'error');
    },
  });

  const dedupe = useMutation({
    mutationFn: () => api.dedupePlaylist(id as string),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast(
        result.removed > 0
          ? `已去掉 ${result.removed} 首重复曲目。`
          : '没有发现重复曲目。',
      );
    },
    onError: () => toast('去重失败，请重试。', 'error'),
  });

  const update = useMutation({
    mutationFn: () =>
      api.updatePlaylist(id as string, {
        title: editTitle.trim(),
        description: editDescription.trim() || null,
        visibility: editVisibility,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['playlist', id] });
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      setEditOpen(false);
      toast('歌单信息已更新。');
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '保存失败，请重试。', 'error');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deletePlaylist(id as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast('歌单已删除。');
      navigate('/app');
    },
    onError: () => toast('删除失败，请重试。', 'error'),
  });

  async function exportFile(format: 'csv' | 'txt' | 'json') {
    if (!detail.data) return;
    try {
      await api.download(
        `/playlists/${id}/export?format=${format}${platform ? `&platform=${platform}` : ''}`,
        `${detail.data.title}.${format}`,
      );
      toast(`已导出 ${format.toUpperCase()}。`);
    } catch (error) {
      toast(error instanceof Error ? error.message : '导出失败。', 'error');
    }
  }

  async function copyLink(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast('链接已复制。');
    } catch {
      toast('复制失败，请手动选中链接。', 'error');
    }
  }

  function openEdit() {
    if (!detail.data) return;
    setEditTitle(detail.data.title);
    setEditDescription(detail.data.description ?? '');
    setEditVisibility(detail.data.visibility);
    setEditOpen(true);
  }

  if (detail.isLoading) return <LoadingBlock label="正在读取歌单…" />;

  if (detail.isError || !detail.data) {
    return (
      <div className="page page--narrow">
        <EmptyState title="没有找到这张歌单" text="它可能已经删除，或者不属于当前账号。">
          <Link className="btn btn-ghost" to="/app">
            回到歌单
          </Link>
        </EmptyState>
      </div>
    );
  }

  const playlist = detail.data;
  const existingShare = shares.data?.find((share) => share.playlistId === playlist.id);
  const shareUrl = existingShare
    ? `${window.location.origin}/s/${existingShare.token}`
    : '';
  const matchedForPlatform = platform ? (playlist.matches[platform] ?? 0) : 0;
  const hasMatch = platform ? matchedForPlatform > 0 : false;
  const appleBlocked = platform === 'apple' && appleConfig.data?.configured === false;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/app">歌单</Link>
        <span aria-hidden="true">/</span>
        <span>{playlist.title}</span>
      </div>

      <div className="detail-head">
        <PlaylistCover
          title={playlist.title}
          coverUrl={playlist.coverUrl}
          platform={playlist.sourcePlatform}
          count={playlist.itemCount}
          size="lg"
          className="cover-detail"
        />
        <div>
          <span className="eyebrow">
            {playlist.sourcePlatform ? `${platformName(playlist.sourcePlatform)} · ` : ''}
            {VISIBILITY_LABEL[playlist.visibility]}
          </span>
          <h1 className="detail-title">{playlist.title}</h1>
          <div className="detail-meta">
            <span>{playlist.itemCount} 首</span>
            <span className="dot" aria-hidden="true">·</span>
            <span className="meta-created">创建于 {formatDate(playlist.createdAt)}</span>
            <span className="dot" aria-hidden="true">·</span>
            <span>更新于 {formatRelative(playlist.updatedAt)}</span>
            {playlist.sourceUrl ? (
              <a href={playlist.sourceUrl} target="_blank" rel="noreferrer" className="platform-inline">
                原始歌单
                <ArrowUpRight size={13} />
              </a>
            ) : null}
          </div>
          {playlist.description ? (
            <p className="detail-desc">{playlist.description}</p>
          ) : null}
          {Object.keys(playlist.matches).length > 0 ? (
            <div className="match-summary">
              {PLATFORM_ORDER.filter((entry) => playlist.matches[entry] != null).map(
                (entry) => (
                  <span className="tag" key={entry}>
                    {PLATFORM_INFO[entry].short} {playlist.matches[entry]} /{' '}
                    {playlist.itemCount}
                  </span>
                ),
              )}
            </div>
          ) : null}
          <div className="detail-actions">
            <button type="button" className="btn btn-primary" onClick={() => void exportFile('csv')}>
              <Download size={15} />
              导出 CSV
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                document
                  .getElementById('share-panel')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            >
              <ShareIcon size={15} />
              分享
            </button>
            <button type="button" className="btn btn-ghost" onClick={openEdit}>
              编辑
            </button>
          </div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <div className="section-label">
            <h2>曲目</h2>
            <span className="meta">
              {playlist.itemCount} 首 · {platformName(playlist.sourcePlatform)}
            </span>
          </div>
          <TrackTable
            tracks={playlist.items}
            platform={platform}
            onAssign={setAssignTarget}
          />
        </div>

        <aside className="aside-stack">
          <section className="panel" id="deliver-panel">
            <h3>送达</h3>
            <p className="panel-sub">
              选一个目标平台，逐首搜索并记录匹配结果。原歌单不会被改动。
            </p>
            <div className="segment" role="group" aria-label="目标平台">
              {PLATFORM_ORDER.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="segment-btn"
                  aria-pressed={platform === entry}
                  onClick={() => setPlatform(entry)}
                >
                  <span className="monogram">{PLATFORM_INFO[entry].monogram}</span>
                  {PLATFORM_INFO[entry].short}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-block btn-sm"
              disabled={
                !platform ||
                match.isPending ||
                playlist.itemCount === 0 ||
                appleBlocked
              }
              onClick={() => platform && match.mutate(platform)}
            >
              {match.isPending
                ? '正在逐首比对…'
                : appleBlocked
                  ? 'Apple 未配置'
                  : platform
                    ? `匹配到 ${PLATFORM_INFO[platform].short}`
                    : '选择目标平台'}
            </button>

            {match.isPending ? (
              <div className="panel-row">
                <Loading label="正在搜索曲目…" />
              </div>
            ) : null}

            {match.error ? (
              <div className="form-error" style={{ marginTop: 14 }}>
                {match.error instanceof Error ? match.error.message : '匹配失败。'}
              </div>
            ) : null}

            {platform && playlist.matches[platform] != null ? (
              <div className="panel-row">
                <span>已匹配</span>
                <span className="mono">
                  {matchedForPlatform} / {playlist.itemCount}
                </span>
              </div>
            ) : null}

            <div className="panel-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void exportFile('csv')}
              >
                <Download size={13} />
                CSV
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => void exportFile('txt')}
              >
                TXT
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={!platform || !hasMatch}
                onClick={() => setDeliveryOpen(true)}
              >
                送达清单
              </button>
            </div>

            {platform === 'apple' ? (
              <>
                <div className="panel-divider" />
                <span className="field-label">Apple Music 资料库</span>
                {appleConfig.data?.authorized ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary btn-block btn-sm"
                      style={{ marginTop: 10 }}
                      disabled={applePush.isPending || !hasMatch}
                      onClick={() => applePush.mutate()}
                    >
                      {applePush.isPending
                        ? '正在写入…'
                        : `写入资料库（${matchedForPlatform} 首）`}
                    </button>
                    {applePush.data ? (
                      <p className="field-hint" style={{ marginTop: 8 }}>
                        已创建「{applePush.data.name}」。
                        <a
                          href={applePush.data.libraryUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          打开资料库歌单
                        </a>
                      </p>
                    ) : null}
                  </>
                ) : appleConfig.data?.configured ? (
                  <p className="field-hint" style={{ marginTop: 8 }}>
                    先到<Link to="/app/settings">设置</Link>里连接 Apple Music，匹配完成后就可以写入资料库。
                  </p>
                ) : (
                  <p className="field-hint" style={{ marginTop: 8 }}>
                    服务端未配置 APPLE_MUSIC_TOKEN，暂时无法写入 Apple Music。
                  </p>
                )}
              </>
            ) : null}
          </section>

          <section className="panel" id="share-panel">
            <h3>分享给朋友</h3>
            <p className="panel-sub">
              链接里是完整曲目表。对方登录后可以整份存成自己的歌单。
            </p>

            {existingShare ? (
              <>
                <div className="link-row">
                  <input
                    className="input"
                    readOnly
                    value={shareUrl}
                    onFocus={(event) => event.currentTarget.select()}
                    aria-label="分享链接"
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="复制链接"
                    onClick={() => void copyLink(shareUrl)}
                  >
                    <Copy size={15} />
                  </button>
                </div>
                <div className="share-stats">
                  <span>
                    <strong>{existingShare.viewCount}</strong> 次查看
                  </span>
                  <span>
                    <strong>{existingShare.cloneCount}</strong> 次保存
                  </span>
                  <span>
                    {existingShare.permission === 'clone' ? '可保存' : '仅查看'}
                  </span>
                  <span>
                    {existingShare.expiresAt
                      ? `${formatDate(existingShare.expiresAt)} 到期`
                      : '长期有效'}
                  </span>
                </div>
                <div className="panel-actions">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => revokeShare.mutate(existingShare.id)}
                    disabled={revokeShare.isPending}
                  >
                    取消分享
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="field" style={{ marginBottom: 12 }}>
                  <span className="field-label">权限</span>
                  <select
                    className="select"
                    value={sharePermission}
                    onChange={(event) =>
                      setSharePermission(event.target.value as SharePermission)
                    }
                  >
                    <option value="clone">可查看，也可保存</option>
                    <option value="view">仅可查看</option>
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">有效期</span>
                  <select
                    className="select"
                    value={shareExpiry}
                    onChange={(event) => setShareExpiry(Number(event.target.value))}
                  >
                    <option value={0}>长期有效</option>
                    <option value={7}>7 天</option>
                    <option value={30}>30 天</option>
                  </select>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-block btn-sm"
                  style={{ marginTop: 14 }}
                  onClick={() => createShare.mutate()}
                  disabled={createShare.isPending}
                >
                  {createShare.isPending ? '正在生成…' : '生成分享链接'}
                </button>
              </>
            )}
          </section>

          <section className="panel">
            <h3>歌单设置</h3>
            <p className="panel-sub">
              当前为{VISIBILITY_LABEL[playlist.visibility]}状态。分享链接可单独控制权限。
            </p>
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={openEdit}>
                编辑信息
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => dedupe.mutate()}
                disabled={dedupe.isPending}
              >
                {dedupe.isPending ? '正在去重…' : '去除重复'}
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm btn-danger"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash size={13} />
                删除
              </button>
            </div>
          </section>
        </aside>
      </div>

      <Dialog
        open={deliveryOpen}
        title={`送达清单 · ${platformName(platform)}`}
        subtitle="已匹配的曲目可以直接打开目标平台；待手动的会给出搜索页。"
        onClose={() => setDeliveryOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void exportFile('csv')}
            >
              导出 CSV
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setDeliveryOpen(false)}
            >
              完成
            </button>
          </>
        }
      >
        {delivery.isLoading ? (
          <Loading label="正在整理送达清单…" />
        ) : delivery.data ? (
          <>
            <div className="panel-row" style={{ marginTop: 0, marginBottom: 8 }}>
              <span>
                {delivery.data.ready} / {delivery.data.total} 首可直接打开
              </span>
              <span className="mono">{platformName(platform)}</span>
            </div>
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
              {delivery.data.rows.map((row) => (
                <div className="mini-row" key={row.itemId}>
                  <span className={`status ${row.status === 'ready' ? 'status--ok' : 'status--warn'}`}>
                    {row.status === 'ready' ? '已匹配' : '待手动'}
                  </span>
                  <span className="mini-title">{row.title}</span>
                  <span className="mini-sub">{row.artist}</span>
                  {row.url ? (
                    <a
                      className="source-link"
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开
                      <ArrowUpRight size={12} />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">还没有可用的匹配结果。</p>
        )}
      </Dialog>

      <Dialog
        open={editOpen}
        title="编辑歌单"
        subtitle="改名、补一句说明，或调整可见性。"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => update.mutate()}
              disabled={update.isPending || !editTitle.trim()}
            >
              {update.isPending ? '正在保存…' : '保存'}
            </button>
          </>
        }
      >
        <div className="import-form">
          <label className="field">
            <span className="field-label">歌单名</span>
            <input
              className="input"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              maxLength={200}
            />
          </label>
          <label className="field">
            <span className="field-label">说明</span>
            <textarea
              className="textarea"
              value={editDescription}
              onChange={(event) => setEditDescription(event.target.value)}
              maxLength={2000}
            />
          </label>
          <label className="field">
            <span className="field-label">可见性</span>
            <select
              className="select"
              value={editVisibility}
              onChange={(event) => setEditVisibility(event.target.value as Visibility)}
            >
              <option value="private">仅自己可见</option>
              <option value="unlisted">不公开，但分享链接可访问</option>
              <option value="public">公开</option>
            </select>
          </label>
        </div>
      </Dialog>

      {platform ? (
        <AssignMatchDialog
          open={Boolean(assignTarget)}
          playlistId={playlist.id}
          track={assignTarget}
          platform={platform}
          onClose={() => setAssignTarget(null)}
        />
      ) : null}

      <Dialog
        open={deleteOpen}
        title="删除这张歌单？"
        subtitle="曲目和匹配记录会一起删除，已有的分享链接也会失效。"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeleteOpen(false)}>
              保留
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }}
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? '正在删除…' : '确认删除'}
            </button>
          </>
        }
      >
        <p className="muted" style={{ fontSize: 14 }}>
          《{playlist.title}》共 {playlist.itemCount} 首。删除后无法恢复。
        </p>
      </Dialog>
    </div>
  );
}
