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
  { platform: 'kuwo' as Platform, url: 'https://www.kuwo.cn/playlist_detail/3523198944' },
  { platform: 'apple' as Platform, url: 'https://music.apple.com/cn/playlist/pl.xxxxxxxxxxxxxxxx' },
];

type ImportMode = 'single' | 'batch';

export function ImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<ImportMode>('single');
  const [url, setUrl] = useState('');
  const [batchText, setBatchText] = useState('');
  const [batchTitle, setBatchTitle] = useState('');
  const [target, setTarget] = useState<'' | Platform>('');
  const [jobId, setJobId] = useState<string | null>(null);
  const detected = detectPlatform(url);

  const batchUrls = batchText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);

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

  const createBatch = useMutation({
    mutationFn: () =>
      api.createBatchImport(
        batchUrls,
        target || undefined,
        batchTitle.trim() || undefined,
      ),
    onSuccess: (job) => {
      setJobId(job.id);
      toast(`已识别 ${batchUrls.length} 个链接，正在合并。`);
    },
    onError: (error) => {
      toast(error instanceof Error ? error.message : '批量导入失败，请重试。', 'error');
    },
  });

  const pending = create.isPending || createBatch.isPending;

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

  function resetForm() {
    setJobId(null);
    setUrl('');
    setBatchText('');
    setBatchTitle('');
    setTarget('');
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setJobId(null);
    if (mode === 'batch') {
      if (batchUrls.length === 0) return;
      createBatch.mutate();
      return;
    }
    if (!url.trim()) return;
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
  const queryError = create.error ?? createBatch.error;

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <div>
          <span className="eyebrow">导入</span>
          <h1 className="page-title">把歌单，接到这里。</h1>
          <div className="page-meta">
            <span>支持网易云、QQ 音乐、酷狗、酷我、Apple Music 的公开歌单链接</span>
          </div>
        </div>
      </div>

      <div className="import-card">
        <div className="mode-tabs" role="group" aria-label="导入方式">
          <button
            type="button"
            className="mode-tab"
            aria-pressed={mode === 'single'}
            onClick={() => setMode('single')}
          >
            单个链接
          </button>
          <button
            type="button"
            className="mode-tab"
            aria-pressed={mode === 'batch'}
            onClick={() => setMode('batch')}
          >
            批量合并
          </button>
        </div>

        <form className="import-form" onSubmit={onSubmit} style={{ marginTop: 24 }}>
          {mode === 'single' ? (
            <div className="field">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
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
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={pending || !url.trim()}
                >
                  <Upload size={15} />
                  {create.isPending ? '正在提交…' : '读取并导入'}
                </button>
              </div>
              <span className="field-hint">
                可以直接粘贴带文字的分享口令，系统会提取其中的链接。读取后歌单会保存到你的账号。
              </span>
            </div>
          ) : (
            <>
              <div className="field">
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <span className="field-label">歌单链接（每行一个）</span>
                  <span className="batch-hint">{batchUrls.length} / 10</span>
                </div>
                <textarea
                  className="textarea"
                  value={batchText}
                  onChange={(event) => setBatchText(event.target.value)}
                  placeholder={
                    'https://music.163.com/playlist?id=...\nhttps://y.qq.com/n/ryqq/playlist/...\nhttps://www.kugou.com/yy/special/single/....html'
                  }
                  style={{ fontFamily: 'var(--mono)', fontSize: 12.5, minHeight: 148 }}
                  required
                />
                <span className="field-hint">
                  最多 10 个链接，可以跨平台。曲目会合并成一张新歌单，同名同歌手的重复曲目自动去掉。
                </span>
              </div>
              <div className="form-row">
                <label className="field">
                  <span className="field-label">合并后的歌单名（可选）</span>
                  <input
                    className="input"
                    value={batchTitle}
                    onChange={(event) => setBatchTitle(event.target.value)}
                    placeholder="不填就用第一张歌单命名"
                    maxLength={200}
                  />
                </label>
                <div className="field">
                  <span className="field-label">合并结果</span>
                  <p className="field-hint">
                    读取 → 合并 → 去重 → 保存。某张读取失败不会中断其它歌单，结果里会说明。
                  </p>
                </div>
              </div>
            </>
          )}

          {mode === 'batch' ? (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={pending || batchUrls.length === 0}
              >
                <Upload size={15} />
                {createBatch.isPending ? '正在提交…' : '读取并合并'}
              </button>
            </div>
          ) : null}

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

          {queryError ? (
            <div className="form-error">
              {queryError instanceof Error ? queryError.message : '导入失败，请重试。'}
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

      {jobId || pending ? (
        <div className="job">
          <div className="job-head">
            <div>
              <div className="job-title">
                {activeJob ? STATUS_LABEL[activeJob.status] : '正在提交链接…'}
              </div>
              <div className="job-sub">
                {activeJob?.kind === 'batch'
                  ? `${activeJob.urls?.length ?? 0} 个链接`
                  : (sourceName ?? '—')}
                {activeJob?.total ? ` · ${activeJob.total} 首` : ''}
                {activeJob?.duplicateCount
                  ? ` · 去重 ${activeJob.duplicateCount} 首`
                  : ''}
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
            {activeJob ? `${activeJob.progress}%` : '准备中'} ·{' '}
            {activeJob?.message ?? '正在识别链接…'}
          </div>

          {activeJob?.status === 'succeeded' ? (
            <div className="job-foot">
              <span className="field-hint">
                {activeJob.kind === 'batch'
                  ? '合并后的歌单已保存，可以继续匹配、去重或分享。'
                  : '歌单已保存，可以继续匹配或分享。'}
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {activeJob.playlistId ? (
                  <Link
                    className="btn btn-primary btn-sm"
                    to={`/app/playlists/${activeJob.playlistId}`}
                  >
                    打开歌单
                    <ArrowRight size={14} />
                  </Link>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
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
                  if (mode === 'batch') createBatch.mutate();
                  else create.mutate();
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
                {item.kind === 'batch' ? '批量合并' : (item.platformName ?? '—')} ·{' '}
                {STATUS_LABEL[item.status]}
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
