import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Upload } from '../components/Icons';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { detectPlatform, PLATFORM_INFO } from '../lib/platforms';
import type { ImportJob } from '../lib/types';

const STATUS_LABEL: Record<ImportJob['status'], string> = {
  queued: '排队中',
  fetching: '读取中',
  saving: '保存中',
  matching: '匹配中',
  succeeded: '已完成',
  failed: '失败',
};

const EXAMPLES = [
  { platform: 'netease' as const, url: 'https://music.163.com/playlist?id=3778678' },
  { platform: 'qq' as const, url: 'https://y.qq.com/n/ryqq/playlist/7367094501' },
];

export function ImportPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const detected = detectPlatform(url);

  const create = useMutation({
    mutationFn: () => api.createImport(url.trim()),
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

  useEffect(() => {
    if (job.data?.status === 'succeeded') {
      void queryClient.invalidateQueries({ queryKey: ['playlists'] });
    }
  }, [job.data?.status, queryClient]);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setJobId(null);
    create.mutate();
  }

  function reset() {
    setJobId(null);
    setUrl('');
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
          <h1 className="page-title">粘贴一张歌单。</h1>
          <div className="page-meta">
            <span>只支持 QQ 音乐 / 网易云音乐的公开歌单链接</span>
          </div>
        </div>
      </div>

      <div className="import-card">
        <form className="import-form" onSubmit={onSubmit}>
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
                <span className="tag tag--sand">只支持 QQ / 网易云</span>
              ) : null}
            </div>
            <div className="url-field">
              <input
                className="input"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="粘贴 QQ 音乐或网易云歌单链接"
                required
                inputMode="url"
                autoComplete="off"
              />
              <button
                className="btn btn-primary"
                type="submit"
                disabled={create.isPending || !url.trim()}
              >
                <Upload size={15} />
                {create.isPending ? '正在提交…' : '读取歌单'}
              </button>
            </div>
            <span className="field-hint">
              可以直接粘贴带文字的分享口令，系统会提取其中的链接。
            </span>
          </div>

          {create.error ? (
            <div className="form-error">
              {create.error instanceof Error ? create.error.message : '导入失败，请重试。'}
            </div>
          ) : null}
        </form>
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
              <span className="field-hint">歌单已保存，打开后点「迁移」继续。</span>
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
                <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
                  再导入一张
                </button>
              </div>
            </div>
          ) : null}

          {activeJob?.status === 'failed' ? (
            <div className="job-foot">
              <span className="field-hint">检查链接是否公开，或稍后重试。</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => create.mutate()}>
                重试
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="examples">
        <h3>链接示例</h3>
        {EXAMPLES.map((example) => (
          <div className="example" key={example.platform}>
            <span className="example-name">{PLATFORM_INFO[example.platform].name}</span>
            <code>{example.url}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
