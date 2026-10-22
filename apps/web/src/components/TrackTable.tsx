import { ArrowUpRight } from './Icons';
import { formatDuration } from '../lib/format';
import type { Track } from '../lib/types';

interface Props {
  tracks: (Track | Omit<Track, 'matches'>)[];
  emptyLabel?: string;
}

export function TrackTable({ tracks, emptyLabel }: Props) {
  const showSource = tracks.some(
    (track) => 'sourceUrl' in track && Boolean(track.sourceUrl),
  );

  return (
    <div className="table-wrap">
      <table className="tracks">
        <thead>
          <tr>
            <th scope="col" aria-label="序号">#</th>
            <th scope="col">曲目</th>
            <th scope="col" className="album-head">专辑</th>
            <th scope="col">时长</th>
            {showSource ? <th scope="col" className="source-head" aria-label="原曲链接" /> : null}
          </tr>
        </thead>
        <tbody>
          {tracks.length === 0 ? (
            <tr>
              <td colSpan={showSource ? 5 : 4} className="muted">
                {emptyLabel ?? '歌单里还没有曲目。'}
              </td>
            </tr>
          ) : (
            tracks.map((track, index) => (
              <tr key={track.id}>
                <td className="num">{String(index + 1).padStart(2, '0')}</td>
                <td className="track-cell">
                  <div className="track-title">{track.title}</div>
                  <div className="track-sub">{track.artist || '未知歌手'}</div>
                </td>
                <td className="album">{track.album || '—'}</td>
                <td className="time">{formatDuration(track.durationMs)}</td>
                {showSource ? (
                  <td className="source-cell">
                    {'sourceUrl' in track && track.sourceUrl ? (
                      <a
                        className="source-link"
                        href={track.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`打开 ${track.title} 的原曲链接`}
                      >
                        <ArrowUpRight size={13} />
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
