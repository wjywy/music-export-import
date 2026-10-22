import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { formatDate, formatRelative } from '../lib/format';
import { authorizeAppleMusic } from '../lib/musickit';
import { PLATFORM_INFO } from '../lib/platforms';

export function Settings() {
  const { user, signOut } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [applePending, setApplePending] = useState(false);

  const platforms = useQuery({ queryKey: ['platforms'], queryFn: api.platforms });
  const appleConfig = useQuery({
    queryKey: ['apple-config'],
    queryFn: api.appleConfig,
    retry: false,
  });
  const kuwoSession = useQuery({
    queryKey: ['kuwo-session'],
    queryFn: api.kuwoSession,
    retry: false,
  });
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: api.aliases });

  const refreshKuwo = useMutation({
    mutationFn: api.refreshKuwoSession,
    onSuccess: (session) => {
      queryClient.setQueryData(['kuwo-session'], session);
      toast('酷我会话已刷新。');
    },
    onError: () => toast('刷新失败，请稍后重试。', 'error'),
  });

  const disconnectApple = useMutation({
    mutationFn: api.appleDisconnect,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['apple-config'] });
      toast('已断开 Apple Music。');
    },
    onError: () => toast('断开失败，请重试。', 'error'),
  });

  const removeAlias = useMutation({
    mutationFn: (id: string) => api.deleteAlias(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['aliases'] });
      toast('映射已删除。');
    },
    onError: () => toast('删除失败，请重试。', 'error'),
  });

  async function connectApple() {
    const config = appleConfig.data;
    if (!config?.developerToken) {
      toast('服务端还没有配置 APPLE_MUSIC_TOKEN。', 'error');
      return;
    }
    setApplePending(true);
    try {
      const musicUserToken = await authorizeAppleMusic(config.developerToken);
      await api.appleAuthorize(musicUserToken);
      await queryClient.invalidateQueries({ queryKey: ['apple-config'] });
      toast('Apple Music 已连接。');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Apple Music 授权没有完成。',
        'error',
      );
    } finally {
      setApplePending(false);
    }
  }

  const session = kuwoSession.data;

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <div>
          <span className="eyebrow">设置</span>
          <h1 className="page-title">账号与平台接入</h1>
          <div className="page-meta">
            <span>平台凭证保存在服务端；Apple 用户令牌加密后入库。</span>
          </div>
        </div>
      </div>

      <section className="settings-section">
        <h2>账号</h2>
        <div className="card" style={{ padding: 24 }}>
          <dl className="kv">
            <dt>昵称</dt>
            <dd>{user?.displayName ?? '—'}</dd>
            <dt>邮箱</dt>
            <dd>{user?.email ?? '—'}</dd>
            <dt>加入时间</dt>
            <dd>{formatDate(user?.createdAt)}</dd>
          </dl>
          <div style={{ marginTop: 24 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
              退出登录
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>平台接入</h2>
        {platforms.isLoading ? (
          <p className="muted">正在读取平台状态…</p>
        ) : (
          <div className="table-wrap">
            <table className="platforms-table">
              <thead>
                <tr>
                  <th scope="col">平台</th>
                  <th scope="col">读取</th>
                  <th scope="col">搜索</th>
                  <th scope="col">写入</th>
                  <th scope="col">凭证</th>
                  <th scope="col">状态</th>
                </tr>
              </thead>
              <tbody>
                {(platforms.data?.platforms ?? []).map((platform) => (
                  <tr key={platform.platform}>
                    <td>
                      <span className="platform-inline">
                        <span className="monogram">
                          {PLATFORM_INFO[platform.platform].monogram}
                        </span>
                        {platform.name}
                      </span>
                    </td>
                    <td
                      className={
                        platform.credential.configured
                          ? 'capability capability--yes'
                          : 'capability'
                      }
                    >
                      {platform.credential.configured ? '可用' : '需配置'}
                    </td>
                    <td
                      className={
                        platform.credential.configured
                          ? 'capability capability--yes'
                          : 'capability'
                      }
                    >
                      {platform.credential.configured ? '可用' : '需配置'}
                    </td>
                    <td
                      className={
                        platform.write
                          ? 'capability capability--yes'
                          : 'capability capability--no'
                      }
                    >
                      {platform.platform === 'apple'
                        ? appleConfig.data?.authorized
                          ? '可写入'
                          : '授权后可写入'
                        : '文件送达'}
                    </td>
                    <td>
                      <span className="credential">{platform.credential.envVar}</span>
                    </td>
                    <td>
                      {platform.credential.configured ? (
                        <span className="tag">
                          {platform.credential.required ? '已配置' : '无需配置'}
                        </span>
                      ) : (
                        <span className="tag tag--sand">未配置</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="settings-note">
          网易云、QQ 音乐、酷狗、酷我通过公开接口读取；网易云未登录时只返回前 10 首完整信息，
          配置 <span className="credential">NETEASE_COOKIE</span> 后可读取完整歌单。酷我使用公开
          网页与搜索接口，Cookie 会自动获取并每 6 小时刷新，也可手动覆盖。
          Apple Music 的读取需要 <span className="credential">APPLE_MUSIC_TOKEN</span>，写入还需要
          每个用户完成 MusicKit 授权。
        </p>
      </section>

      <section className="settings-section">
        <h2>Apple Music</h2>
        <div className="card" style={{ padding: 24 }}>
          <div className="apple-card">
            <div className="apple-copy">
              <h3>
                {appleConfig.data?.authorized ? '已连接' : '写入资料库'}
                <span
                  className={`tag${appleConfig.data?.authorized ? '' : ' tag--sand'}`}
                  style={{ marginLeft: 10, verticalAlign: 'middle' }}
                >
                  {appleConfig.data?.authorized
                    ? `区号 ${appleConfig.data.storefront}`
                    : appleConfig.data?.configured
                      ? '待授权'
                      : '未配置'}
                </span>
              </h3>
              <p>
                连接后可把匹配好的歌单直接写进 Apple Music 资料库。授权由 MusicKit JS
                在浏览器里完成，服务端只保存加密后的用户令牌，不接触 Apple 账号密码。
              </p>
              {appleConfig.data?.note ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  {appleConfig.data.note}
                </p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {appleConfig.data?.authorized ? (
                <>
                  <span className="tag">已授权</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => disconnectApple.mutate()}
                    disabled={disconnectApple.isPending}
                  >
                    断开连接
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void connectApple()}
                  disabled={applePending || !appleConfig.data?.configured}
                >
                  {applePending ? '正在授权…' : '连接 Apple Music'}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>酷我会话</h2>
        <div className="card" style={{ padding: 24 }}>
          <div className="apple-card">
            <div className="apple-copy">
              <h3>
                自动 Cookie
                <span className="tag" style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                  {session?.source === 'env'
                    ? '环境变量'
                    : session?.source === 'auto'
                      ? '自动获取'
                      : '暂无会话'}
                </span>
              </h3>
              <p>
                公开歌单与搜索不需要登录；会话 Cookie 用于带登录态的场景，系统每 6 小时自动刷新。
                如果配置了 <span className="credential">KUWO_COOKIE</span>，以环境变量为准。
              </p>
              <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                {session?.refreshedAt
                  ? `最近刷新：${formatRelative(session.refreshedAt)} · `
                  : ''}
                {session?.cookieNames.length
                  ? `Cookie：${session.cookieNames.join('、')}`
                  : '尚无 Cookie'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => refreshKuwo.mutate()}
                disabled={refreshKuwo.isPending}
              >
                {refreshKuwo.isPending ? '正在刷新…' : '刷新会话'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>记住的映射</h2>
        <div className="card" style={{ padding: '10px 24px' }}>
          {aliases.isLoading ? (
            <p className="muted" style={{ padding: '14px 0' }}>
              正在读取…
            </p>
          ) : aliases.data && aliases.data.length > 0 ? (
            aliases.data.map((alias) => (
              <div className="alias-row" key={alias.id}>
                <span className="tag tag--sand">
                  {PLATFORM_INFO[alias.platform].short}
                </span>
                <div className="alias-row-main">
                  <strong>
                    {alias.titleKey || '—'}
                    {alias.artistKey ? ` · ${alias.artistKey}` : ''}
                  </strong>
                  <div className="alias-row-sub">
                    → {alias.remoteTitle}
                    {alias.remoteArtist ? ` · ${alias.remoteArtist}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => removeAlias.mutate(alias.id)}
                  disabled={removeAlias.isPending}
                >
                  删除
                </button>
              </div>
            ))
          ) : (
            <p className="muted" style={{ padding: '14px 0', fontSize: 13, lineHeight: 1.7 }}>
              还没有手动映射。在歌单详情里把「待手动」的曲目指定为目标平台的某一首，
              勾选「记住这条映射」后，这里会保存下来，下次匹配自动使用。
            </p>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h2>关于渡口</h2>
        <div className="card" style={{ padding: 24 }}>
          <dl className="kv">
            <dt>前端</dt>
            <dd>React · Vite · TypeScript</dd>
            <dt>后端</dt>
            <dd>Node.js · NestJS · TypeORM</dd>
            <dt>数据库</dt>
            <dd>MySQL 8（TypeORM migration 管理表结构）</dd>
            <dt>设计</dt>
            <dd>Kami 纸张体系 · 单一墨蓝强调色 · 衬线正文</dd>
          </dl>
          <p className="settings-note" style={{ marginTop: 20 }}>
            公开接口能做的直接做；写入能力受平台限制。Apple Music 授权后可写入资料库，
            其余平台以 CSV / TXT / JSON 与逐首匹配链接送达。分享链接的曲目表可以完整保存到另一个渡口账号。
          </p>
        </div>
      </section>
    </div>
  );
}
