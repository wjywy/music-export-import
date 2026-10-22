import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { PLATFORM_INFO } from '../lib/platforms';

export function Settings() {
  const { user, signOut } = useAuth();
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: api.platforms });

  return (
    <div className="page page--narrow">
      <div className="page-head">
        <div>
          <span className="eyebrow">设置</span>
          <h1 className="page-title">账号与平台接入</h1>
          <div className="page-meta">
            <span>凭证只保存在服务端环境变量里，不会写进数据库。</span>
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
                        <span className="monogram">{PLATFORM_INFO[platform.platform].monogram}</span>
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
                    <td className="capability capability--no">
                      {platform.write ? '可写入' : '文件送达'}
                    </td>
                    <td>
                      <span className="credential">{platform.credential.envVar}</span>
                    </td>
                    <td>
                      {platform.credential.configured ? (
                        <span className="tag">{platform.credential.required ? '已配置' : '无需配置'}</span>
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
          网易云、QQ 音乐、酷狗通过公开接口读取；网易云未登录时只返回前 10 首完整信息，配置
          <span className="credential"> NETEASE_COOKIE </span>
          后可读取完整歌单。酷我需要 <span className="credential">KUWO_COOKIE</span>（含
          kw_token），Apple Music 需要 <span className="credential">APPLE_MUSIC_TOKEN</span>。
          QQ 音乐偶尔需要 <span className="credential">QQ_COOKIE</span>，未配置时多数公开歌单仍可读取。
        </p>
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
            <dd>MySQL（本地演示可用 sql.js 驱动）</dd>
            <dt>设计</dt>
            <dd>Kami 纸张体系 · 单一墨蓝强调色 · 衬线正文</dd>
          </dl>
          <p className="settings-note" style={{ marginTop: 20 }}>
            平台写入能力受官方接口限制：当前导出的结果是 CSV / TXT / JSON 文件，加上逐首的匹配链接。
            分享链接的曲目表可以完整保存到另一个渡口账号。
          </p>
        </div>
      </section>
    </div>
  );
}
