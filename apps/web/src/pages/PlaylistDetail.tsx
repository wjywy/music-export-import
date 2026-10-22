import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Trash } from '../components/Icons';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { LoadingBlock } from '../components/Loading';
import { PlaylistCover } from '../components/PlaylistCover';
import { TrackTable } from '../components/TrackTable';
import { TransferDialog } from '../components/TransferDialog';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { platformName } from '../lib/platforms';

export function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [transferOpen, setTransferOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.playlist(id as string),
    enabled: Boolean(id),
  });

  const remove = useMutation({
    mutationFn: () => api.deletePlaylist(id as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      toast('歌单已删除。');
      navigate('/app');
    },
    onError: () => toast('删除失败，请重试。', 'error'),
  });

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
            {playlist.sourcePlatform ? platformName(playlist.sourcePlatform) : '手动创建'}
            {' · '}
            {playlist.itemCount} 首
          </span>
          <h1 className="detail-title">{playlist.title}</h1>
          <div className="detail-meta">
            <span>{playlist.itemCount} 首</span>
            <span className="dot" aria-hidden="true">·</span>
            <span>创建于 {formatDate(playlist.createdAt)}</span>
          </div>
          {playlist.description ? (
            <p className="detail-desc">{playlist.description}</p>
          ) : null}
          <div className="detail-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setTransferOpen(true)}
            >
              <ArrowRight size={15} />
              迁移
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash size={14} />
              删除
            </button>
          </div>
        </div>
      </div>

      <div className="section-label">
        <h2>曲目</h2>
        <span className="meta">{playlist.itemCount} 首</span>
      </div>
      <TrackTable tracks={playlist.items} />

      <TransferDialog
        open={transferOpen}
        playlistId={playlist.id}
        title={playlist.title}
        sourcePlatform={playlist.sourcePlatform}
        onClose={() => setTransferOpen(false)}
      />

      <Dialog
        open={deleteOpen}
        title="删除歌单"
        subtitle="删除后无法恢复，已写入目标平台的歌单不受影响。"
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? '正在删除…' : '删除'}
            </button>
          </>
        }
      >
        <p className="field-hint">确定删除「{playlist.title}」？</p>
      </Dialog>
    </div>
  );
}
