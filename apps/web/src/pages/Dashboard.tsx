import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Upload } from '../components/Icons';
import { EmptyState } from '../components/EmptyState';
import { LoadingBlock } from '../components/Loading';
import { PlaylistCover } from '../components/PlaylistCover';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatRelative } from '../lib/format';
import { platformName } from '../lib/platforms';

export function Dashboard() {
  const { user } = useAuth();
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const visible = (playlists.data ?? []).filter(
    (playlist) =>
      playlist.sourcePlatform === 'netease' || playlist.sourcePlatform === 'qq',
  );
  const count = visible.length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">你的迁移</span>
          <h1 className="page-title">
            {user ? `${user.displayName}，把歌单搬过去。` : '把歌单搬过去。'}
          </h1>
          <div className="page-meta">
            <span>{count} 张歌单</span>
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn btn-primary" to="/app/import">
            <Upload size={15} />
            导入歌单
          </Link>
        </div>
      </div>

      {playlists.isLoading ? (
        <LoadingBlock label="正在读取你的歌单…" />
      ) : visible.length > 0 ? (
        <div className="playlist-grid">
          {visible.map((playlist) => (
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
          title="还没有歌单"
          text="粘贴一张 QQ 音乐或网易云音乐的歌单链接，开始第一次迁移。"
        >
          <Link className="btn btn-primary" to="/app/import">
            导入第一张歌单
            <ArrowRight size={15} />
          </Link>
        </EmptyState>
      )}
    </div>
  );
}
