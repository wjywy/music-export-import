import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog } from './Dialog';
import { Loading } from './Loading';
import { Search } from './Icons';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDuration } from '../lib/format';
import { PLATFORM_INFO } from '../lib/platforms';
import type { Platform, SearchHit, Track } from '../lib/types';

interface Props {
  open: boolean;
  playlistId: string;
  track: Track | null;
  platform: Platform;
  onClose: () => void;
}

export function AssignMatchDialog({ open, playlistId, track, platform, onClose }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [selected, setSelected] = useState<SearchHit | null>(null);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!open || !track) return;
    const initial = `${track.title} ${track.artist}`.trim();
    setQuery(initial);
    setSubmitted(initial);
    setSelected(null);
    setRemember(true);
  }, [open, track]);

  const results = useQuery({
    queryKey: ['platform-search', platform, submitted],
    queryFn: () => api.searchPlatform(platform, submitted),
    enabled: open && submitted.trim().length > 0,
    staleTime: 60_000,
    retry: false,
  });

  const assign = useMutation({
    mutationFn: () => {
      if (!track || !selected) throw new Error('请先选择一首目标曲目。');
      return api.assignMatch(playlistId, track.id, {
        platform,
        remoteId: selected.sourceId,
        remoteTitle: selected.title,
        remoteArtist: selected.artist,
        remoteAlbum: selected.album,
        remoteUrl: selected.sourceUrl,
        remember,
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      void queryClient.invalidateQueries({ queryKey: ['aliases'] });
      toast(
        result.aliasSaved
          ? `已指定为《${result.remoteTitle}》，并记住这条映射。`
          : `已指定为《${result.remoteTitle}》。`,
      );
      onClose();
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '指定失败，请重试。', 'error');
    },
  });

  return (
    <Dialog
      open={open}
      title="指定这首曲目"
      subtitle={`在 ${PLATFORM_INFO[platform].name} 里找到对应版本，指定后会计为已匹配。`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!selected || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {assign.isPending ? '正在保存…' : '设为这首'}
          </button>
        </>
      }
    >
      <div className="assign-dialog">
        {track ? (
          <div className="assign-origin">
            <span className="field-label">原曲目</span>
            <div className="assign-origin-title">{track.title}</div>
            <div className="assign-origin-meta">{track.artist || '未知歌手'}</div>
          </div>
        ) : null}

        <form
          className="assign-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
          }}
        >
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索目标平台的曲名或歌手"
            aria-label="搜索目标平台"
          />
          <button className="btn btn-ghost btn-sm" type="submit">
            <Search size={14} />
            搜索
          </button>
        </form>

        {results.isLoading ? <Loading label="正在搜索…" /> : null}

        {results.error ? (
          <div className="form-error" style={{ marginTop: 14 }}>
            {results.error instanceof Error ? results.error.message : '搜索失败。'}
          </div>
        ) : null}

        {results.data && results.data.hits.length > 0 ? (
          <div className="assign-results" role="listbox" aria-label="搜索结果">
            {results.data.hits.map((hit) => (
              <button
                type="button"
                key={`${hit.sourceId ?? hit.title}-${hit.artist}`}
                className="assign-result"
                role="option"
                aria-selected={selected === hit}
                onClick={() => setSelected(hit)}
              >
                <span className="assign-result-main">
                  <span className="assign-result-title">{hit.title}</span>
                  <span className="assign-result-meta">
                    {hit.artist || '未知歌手'}
                    {hit.album ? ` · ${hit.album}` : ''}
                  </span>
                </span>
                <span className="assign-result-time">
                  {formatDuration(hit.durationMs)}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {results.data && results.data.hits.length === 0 ? (
          <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>
            没有搜到结果，换一个关键词试试。
          </p>
        ) : null}

        <label className="checkbox-row" style={{ marginTop: 18 }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span>记住这条映射，下次匹配同一首歌时自动使用</span>
        </label>
      </div>
    </Dialog>
  );
}
