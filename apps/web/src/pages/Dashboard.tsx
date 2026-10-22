import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Plus, Upload } from '../components/Icons';
import { Dialog } from '../components/Dialog';
import { EmptyState } from '../components/EmptyState';
import { LoadingBlock } from '../components/Loading';
import { PlaylistCover } from '../components/PlaylistCover';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatRelative, splitTrackLine } from '../lib/format';
import { platformName } from '../lib/platforms';
import type { Visibility } from '../lib/types';

export function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [lines, setLines] = useState('');
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [mergeTitle, setMergeTitle] = useState('');

  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const imports = useQuery({ queryKey: ['imports'], queryFn: api.imports });

  const parsedItems = useMemo(
    () =>
      lines
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const { title: trackTitle, artist } = splitTrackLine(line);
          return { title: trackTitle, artist };
        })
        .filter((item) => item.title)
        .slice(0, 500),
    [lines],
  );

  const create = useMutation({
    mutationFn: () =>
      api.createPlaylist({
        title: title.trim(),
        description: description.trim() || null,
        visibility,
        items: parsedItems,
      }),
    onSuccess: (playlist) => {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast('歌单已创建。');
      setDialogOpen(false);
      setTitle('');
      setDescription('');
      setLines('');
      setVisibility('private');
      navigate(`/app/playlists/${playlist.id}`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '创建失败，请重试。', 'error');
    },
  });

  const merge = useMutation({
    mutationFn: () =>
      api.mergePlaylists(mergeIds, mergeTitle.trim() || undefined),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      toast(
        result.duplicatesRemoved > 0
          ? `已合并 ${result.total} 首，去掉 ${result.duplicatesRemoved} 首重复。`
          : `已合并 ${result.total} 首。`,
      );
      setMergeOpen(false);
      setMergeIds([]);
      setMergeTitle('');
      navigate(`/app/playlists/${result.playlist.id}`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '合并失败，请重试。', 'error');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    create.mutate();
  }

  const recent = (imports.data ?? [])
    .filter((job) => job.status === 'succeeded' || job.status === 'failed')
    .slice(0, 5);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">你的歌单</span>
          <h1 className="page-title">
            {user ? `${user.displayName}，把喜欢的歌放在一起。` : '把喜欢的歌放在一起。'}
          </h1>
          <div className="page-meta">
            <span>{stats.data?.playlistCount ?? 0} 个歌单</span>
            <span>·</span>
            <span>{stats.data?.trackCount ?? 0} 首曲目</span>
            <span>·</span>
            <span>{stats.data?.matchCount ?? 0} 首已匹配</span>
          </div>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDialogOpen(true)}
          >
            <Plus size={15} />
            新建歌单
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setMergeOpen(true)}
            disabled={!playlists.data || playlists.data.length < 2}
          >
            合并歌单
          </button>
          <Link className="btn btn-primary" to="/app/import">
            <Upload size={15} />
            导入歌单
          </Link>
        </div>
      </div>

      {playlists.isLoading ? (
        <LoadingBlock label="正在读取你的歌单…" />
      ) : playlists.data && playlists.data.length > 0 ? (
        <div className="playlist-grid">
          {playlists.data.map((playlist) => (
            <Link
              className="playlist-card"
              key={playlist.id}
              to={`/app/playlists/${playlist.id}`}
            >
              <PlaylistCover
                title={playlist.title}
                coverUrl={playlist.coverUrl}
                platform={playlist.sourcePlatform}
                count={playlist.itemCount}
              />
              <h3>{playlist.title}</h3>
              {playlist.description ? (
                <p className="playlist-card-desc">{playlist.description}</p>
              ) : null}
              <div className="playlist-card-meta">
                <span>{platformName(playlist.sourcePlatform)}</span>
                <span className="dot" />
                <span>{playlist.itemCount} 首</span>
                <span className="dot" />
                <span>{formatRelative(playlist.updatedAt)}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          title="这里还很安静"
          text="导入第一张歌单，或者手动新建一份。曲目会带着顺序保存在这里。"
        >
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to="/app/import">
              导入一张歌单
              <ArrowRight size={15} />
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setDialogOpen(true)}
            >
              手动新建
            </button>
          </div>
        </EmptyState>
      )}

      {recent.length > 0 ? (
        <section className="recent">
          <h2>最近的导入</h2>
          <div>
            {recent.map((job) => (
              <div className="recent-row" key={job.id}>
                <Link to={job.playlistId ? `/app/playlists/${job.playlistId}` : '/app/import'}>
                  {job.message ?? `${job.platformName ?? '歌单'} 导入`}
                </Link>
                <span className="recent-meta">
                  {job.platformName ?? '—'} · {formatRelative(job.createdAt)}
                </span>
                <span className="recent-meta recent-status">
                  {job.status === 'succeeded' ? '完成' : '失败'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog
        open={dialogOpen}
        title="新建歌单"
        subtitle="先起个名字。曲目可以现在粘贴，也可以稍后添加。"
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setDialogOpen(false)}
            >
              取消
            </button>
            <button
              type="submit"
              form="new-playlist-form"
              className="btn btn-primary btn-sm"
              disabled={create.isPending || !title.trim()}
            >
              {create.isPending ? '正在创建…' : '创建歌单'}
            </button>
          </>
        }
      >
        <form id="new-playlist-form" className="import-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">歌单名</span>
            <input
              className="input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="比如：雨天旧唱片"
              maxLength={200}
              required
            />
          </label>
          <label className="field">
            <span className="field-label">一句话说明</span>
            <textarea
              className="textarea"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="这张歌单是为什么准备的？"
              maxLength={2000}
              style={{ minHeight: 76 }}
            />
          </label>
          <label className="field">
            <span className="field-label">曲目（每行一首，歌手 - 曲名）</span>
            <textarea
              className="textarea"
              value={lines}
              onChange={(event) => setLines(event.target.value)}
              placeholder={'周杰伦 - 晴天\n陈奕迅 - 富士山下'}
              style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
            />
            <span className="field-hint">已识别 {parsedItems.length} 首，最多 500 首。</span>
          </label>
          <label className="field">
            <span className="field-label">可见性</span>
            <select
              className="select"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as Visibility)}
            >
              <option value="private">仅自己可见</option>
              <option value="unlisted">不公开，但分享链接可访问</option>
              <option value="public">公开</option>
            </select>
          </label>
        </form>
      </Dialog>

      <Dialog
        open={mergeOpen}
        title="合并歌单"
        subtitle="选择两张或更多歌单，合并成一张新的。同曲名、同歌手的重复曲目会自动去掉。"
        onClose={() => setMergeOpen(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMergeOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={merge.isPending || mergeIds.length < 2}
              onClick={() => merge.mutate()}
            >
              {merge.isPending ? '正在合并…' : `合并 ${mergeIds.length} 张`}
            </button>
          </>
        }
      >
        <div className="import-form">
          <label className="field">
            <span className="field-label">新歌单名（可选）</span>
            <input
              className="input"
              value={mergeTitle}
              onChange={(event) => setMergeTitle(event.target.value)}
              placeholder="不填就用第一张歌单命名"
              maxLength={200}
            />
          </label>
          <div className="merge-list">
            {(playlists.data ?? []).map((playlist) => {
              const checked = mergeIds.includes(playlist.id);
              return (
                <label className="merge-row" key={playlist.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setMergeIds((current) =>
                        event.target.checked
                          ? [...current, playlist.id]
                          : current.filter((id) => id !== playlist.id),
                      )
                    }
                  />
                  <span>{playlist.title}</span>
                  <span className="merge-row-sub">{playlist.itemCount} 首</span>
                </label>
              );
            })}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
