import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, Check, Download } from '../components/Icons';
import { EmptyState } from '../components/EmptyState';
import { LoadingBlock } from '../components/Loading';
import { TrackTable } from '../components/TrackTable';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { platformName } from '../lib/platforms';

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const toast = useToast();
  const [clonedId, setClonedId] = useState<string | null>(null);

  const share = useQuery({
    queryKey: ['share', token],
    queryFn: () => api.publicShare(token as string),
    enabled: Boolean(token),
    retry: false,
  });

  const clone = useMutation({
    mutationFn: () => api.cloneShare(token as string),
    onSuccess: (result) => {
      setClonedId(result.playlistId);
      toast(`已保存 ${result.itemCount} 首到你的歌单。`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '保存失败，请重试。', 'error');
    },
  });

  async function exportCsv() {
    if (!share.data) return;
    try {
      await api.download(`/share/${token}/export?format=csv`, `${share.data.playlist.title}.csv`);
      toast('已导出 CSV。');
    } catch {
      toast('导出失败，请稍后再试。', 'error');
    }
  }

  if (share.isLoading) return <LoadingBlock label="正在打开这份分享…" />;

  if (share.isError || !share.data) {
    return (
      <div className="share-page">
        <EmptyState
          title="这份分享打不开"
          text="链接可能已经过期、被取消，或者写错了。"
        >
          <Link className="btn btn-ghost" to="/">
            回到渡口
          </Link>
        </EmptyState>
      </div>
    );
  }

  const { playlist, ownerName, permission, cloneCount, expiresAt } = share.data;

  return (
    <div className="share-page">
      <div className="share-hero">
        <span className="eyebrow">朋友分享的歌单</span>
        <h1>{playlist.title}</h1>
        <div className="meta">
          {playlist.sourcePlatform ? (
            <>
              <span className="platform-inline">
                {platformName(playlist.sourcePlatform)}
              </span>
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <span>{playlist.itemCount} 首</span>
          <span aria-hidden="true">·</span>
          <span>{ownerName} 分享</span>
          <span aria-hidden="true">·</span>
          <span>被保存 {cloneCount} 次</span>
          {expiresAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{formatDate(expiresAt)} 到期</span>
            </>
          ) : null}
        </div>
        {playlist.description ? (
          <p className="share-desc">{playlist.description}</p>
        ) : null}
      </div>

      <div className="share-tracks">
        <TrackTable tracks={playlist.items} mode="public" />
      </div>

      {clonedId ? (
        <div className="share-cta" style={{ marginTop: 32 }}>
          <div>
            <h2>
              <Check size={16} /> 已保存到你的歌单
            </h2>
            <p>顺序和曲目都在，你可以继续匹配到自己的常用平台。</p>
          </div>
          <div className="share-cta-actions">
            <Link className="btn btn-primary" to={`/app/playlists/${clonedId}`}>
              打开歌单
              <ArrowRight size={15} />
            </Link>
            <Link className="btn btn-ghost" to="/app">
              我的歌单
            </Link>
          </div>
        </div>
      ) : (
        <div className="share-cta">
          <div>
            <h2>把这张歌单带走</h2>
            <p>
              {permission === 'clone'
                ? '保存后成为你自己的歌单，不会影响分享者的版本。'
                : '这份分享只开放查看，不能直接保存。'}
            </p>
          </div>
          <div className="share-cta-actions">
            {permission === 'clone' ? (
              user ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => clone.mutate()}
                  disabled={clone.isPending}
                >
                  {clone.isPending ? '正在保存…' : '保存到我的歌单'}
                </button>
              ) : (
                <Link
                  className="btn btn-primary"
                  to="/login"
                  state={{ from: `/s/${token}` }}
                >
                  登录后保存
                </Link>
              )
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => void exportCsv()}>
              <Download size={15} />
              导出 CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
