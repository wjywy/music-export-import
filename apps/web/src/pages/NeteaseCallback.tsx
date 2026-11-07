import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loading } from '../components/Loading';
import { Seo } from '../components/Seo';
import { api } from '../lib/api';
import { ROBOTS_NOINDEX } from '../lib/seo';

type Result = Awaited<ReturnType<typeof api.completeNeteaseOAuth>>;

export function NeteaseCallback() {
  const queryClient = useQueryClient();
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const started = useRef<Promise<Result> | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Remove the temporary code from browser history before making API requests.
    window.history.replaceState(window.history.state, '', window.location.pathname);
    const code = params.get('code');
    const state = params.get('state');
    if (params.has('error') || !code || !state) {
      setError('网易云授权未完成或回调参数不完整，请返回后重新发起授权。');
      return;
    }
    started.current ??= api.completeNeteaseOAuth(state, code);
    void started.current.then(async (value) => {
      if (cancelled) return;
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      if (!cancelled) setResult(value);
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : '网易云授权没有完成，请重新发起。');
    });
    return () => { cancelled = true; };
  }, [params, queryClient]);

  return (
    <div className="auth">
      <Seo title="网易云音乐授权" description="完成网易云音乐账号连接。" robots={ROBOTS_NOINDEX} />
      <div className="auth-head">
        <span className="eyebrow">渡口 · 账号连接</span>
        <h1>{result ? '网易云音乐已连接' : error ? '未能完成连接' : '正在完成授权'}</h1>
        <p className="lede">{result ? '返回歌单，即可继续迁移。' : '请保持在当前浏览器中完成网易云授权。'}</p>
      </div>
      <div className="auth-card" aria-live="polite">
        {!result && !error ? <Loading label="正在安全连接网易云音乐…" /> : null}
        {result?.nickname ? <p>已连接：{result.nickname}</p> : null}
        {error ? <div className="form-error">{error}</div> : null}
        {result || error ? <Link className="btn btn-primary" to={result?.returnTo ?? '/app'} replace>
          {result?.returnTo.startsWith('/app/playlists/') ? '返回歌单继续迁移' : '返回我的歌单'}
        </Link> : null}
      </div>
    </div>
  );
}
