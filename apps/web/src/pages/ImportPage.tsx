import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Upload } from '../components/Icons';
import { Loading } from '../components/Loading';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { detectPlatform, PLATFORM_INFO, PLATFORM_ORDER } from '../lib/platforms';
import type { ImportJob, Platform } from '../lib/types';

const STATUS_LABEL: Record<ImportJob['status'], string> = {
  queued: '排队中',
  fetching: '读取中',
  saving: '保存中',
  matching: '匹配中',
  succeeded: '已完成',
  failed: '失败',
};

const EXAMPLES = [
  { platform: 'netease' as Platform, url: 'https://music.163.com/playlist?id=3778678' },
  { platform: 'qq' as Platform, url: 'https://y.qq.com/n/ryqq/playlist/7367094501' },
  { platform: 'kugou' as Platform, url: 'https://www.kugou.com/yy/special/single/5799472.html' },
  { platform: 'kuwo' as Platform, url: 'https://www.kuwo.cn/playlist_detail/2747666349' },
  { platform: 'apple' as Platform, url: 'https://music.apple.com/cn/playlist/pl.xxxxxxxxxxxxxxxx' },
];

export function ImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [target, setTarget] = useState<'' | Platform>('');
  const [jobId, setJobId] = useState<string | null>(null);
  const detected = detectPlatform(url);

  const create = useMutation({
    mutationFn: () => api.createImport(url.trim(), target || undefined),
    onSuccess: (job) => {
      setJobId(job.id);
      toast('链接已识别，正在读取。');
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '导入失败，请重试。', 'error');
    },
  });

  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.importJob(jobId as string),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1200;
      return data.status === 'succeeded' || data.status === 'failed' ? false : 1200;
    },
  });

  const recent = useQuery({ queryKey: ['imports'], queryFn: api.imports });

  useEffect(() => {
    if (job.data?.status === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
    }
  }, [job.data?.status, queryClient]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setJobId(null);
    create.mutate();
  }

  const activeJob = job.data;
  const sourceName =
    activeJob?.platformName ??
    (activeJob?.platform
      ? PLATFORM_INFO[activeJob.platform].name
      : detected
        ? PLATFORM_INFO[detected].name
        : null);

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <div>
          <span className="eyebrow">导入</span>
          <h1 className="page-title">把一张歌单，接到这里。</h1>
          <div className="page-meta">
            <span>支持网易云、QQ 音乐、酷狗、酷我、Apple Music 的公开歌单链接</span>
          </div>
        </div>
      </div>

      <div className="import-card">
        <form className="import-form" onSubmit={onSubmit}>
          <div className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span className="field-label">歌单链接</span>
              {detected ? (
                <span className="tag">
                  {PLATFORM_INFO[detected].monogram} · {PLATFORM_INFO[detected].name}
                </span>
              ) : url ? (
                <span className="tag tag--sand">未识别平台</span>
              ) : null}
            </div>
            <div className="url-field">
              <input
                className="input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="粘贴歌单分享链接，例如 https://music.163.com/playlist?id=..."
                required
                inputMode="url"
                autoComplete="off"
              />
              <button className="btn btn-primary" type="submit" disabled={create.isPending || !url.trim()}>
                <Upload size={15} />
                {create.isPending ? '正在提交…' : '读取并导入'}
              </button>
            </div>
            <span className="field-hint">
              可以直接粘贴带文字的分享口令，系统会提取其中的链接。读取后歌单会保存到你的账号。
            </span>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="field-label">同时匹配到（可选）</span>
              <select
                className="select"
                value={target}
                onChange={(event) => setTarget(event.target.value as '' | Platform)}
              >
                <option value="">只保存，不匹配</option>
                {PLATFORM_ORDER.map((platform) => (
                  <option value={platform} key={platform}>
                    匹配到 {PLATFORM_INFO[platform].name}
                  </option>
                ))}
              </select>
              <span className="field-hint">匹配会逐首搜索目标平台，曲目多时需要几十秒。</span>
            </label>
            <div className="field">
              <span className="field-label">流程</span>
              <p className="field-hint">
                读取原歌单 → 保存到你的歌单库 → 如选择了目标平台，再逐首比对。匹配结果随时可以在歌单详情里重新运行。
              </p>
            </div>
          </div>

          {create.error ? (
            <div className="form-error">
              {create.error instanceof Error ? create.error.message : '导入失败，请重试。'}
            </div>
          ) : null}
        </form>

        <div className="examples">
          <h3>支持的链接形态</h3>
          {EXAMPLES.map((example) => (
            <div className="example" key={example.platform}>
              <span className="example-name">{PLATFORM_INFO[example.platform].name}</span>
              <code>{example.url}</code>
            </div>
          ))}
        </div>
      </div>

      {jobId || create.isPending ? (
        <div className="job">
          <div className="job-head">
            <div>
              <div className="job-title">
                {activeJob ? STATUS_LABEL[activeJob.status] : '正在提交链接…'}
              </div>
              <div className="job-sub">
                {sourceName ?? '—'}
                {activeJob?.total ? ` · ${activeJob.total} 首` : ''}
                {activeJob?.targetPlatformName ? ` → ${activeJob.targetPlatformName}` : ''}
              </div>
            </div>
            {activeJob?.status === 'succeeded' ? <span className="tag">已保存</span> : null}
            {activeJob?.status === 'failed' ? <span className="tag tag--sand">失败</span> : null}
          </div>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${activeJob?.progress ?? 4}%` }} />
          </div>
          <div className="progress-label">
            {activeJob ? `${activeJob.progress}%` : '准备中'} · {activeJob?.message ?? '正在识别链接…'}
          </div>

          {activeJob?.status === 'succeeded' ? (
            <div className="job-foot">
              <span className="field-hint">歌单已保存，可以继续匹配或分享。</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {activeJob.playlistId ? (
                  <Link className="btn btn-primary btn-sm" to={`/app/playlists/${activeJob.playlistId}`}>
                    打开歌单
                    <ArrowRight size={14} />
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setJobId(null);
                    setUrl('');
                    setTarget('');
                  }}
                >
                  再导入一张
                </button>
              </div>
            </div>
          ) : null}

          {activeJob?.status === 'failed' ? (
            <div className="job-foot">
              <span className="field-hint">可以检查链接是否公开，或稍后重试。</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setJobId(null);
                  create.mutate();
                }}
              >
                重试
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {recent.data && recent.data.length > 0 ? (
        <section className="recent">
          <h2>最近导入</h2>
          {recent.data.slice(0, 6).map((item) => (
            <div className="recent-row" key={item.id}>
              {item.playlistId ? (
                <Link to={`/app/playlists/${item.playlistId}`}>
                  {item.message ?? `${item.platformName ?? '歌单'} 导入`}
                </Link>
              ) : (
                <span>{item.message ?? `${item.platformName ?? '歌单'} 导入`}</span>
              )}
              <span className="recent-meta">
                {item.platformName ?? '—'} · {STATUS_LABEL[item.status]}
              </span>
              <span className="recent-meta recent-status">
                {item.total ? `${item.total} 首` : '—'}
              </span>
            </div>
          ))}
        </section>
      ) : job.isFetching ? (
        <Loading label="正在读取导入任务…" />
      ) : null}
    </div>
  );
}
