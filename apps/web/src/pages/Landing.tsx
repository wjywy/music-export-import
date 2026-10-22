import { Link } from 'react-router-dom';
import { ArrowRight, Check } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { PLATFORM_INFO, PLATFORM_ORDER } from '../lib/platforms';

const PREVIEW_ROWS = [
  { title: '晴天', artist: '周杰伦', match: 'match' as const, score: '100%' },
  { title: '富士山下', artist: '陈奕迅', match: 'match' as const, score: '100%' },
  { title: '暧昧', artist: '王菲', match: 'match' as const, score: '90%' },
  { title: '天空之城', artist: '李志', match: 'manual' as const, score: '' },
  { title: '平凡之路', artist: '朴树', match: 'match' as const, score: '100%' },
];

const PLATFORM_NOTES: Record<string, string> = {
  netease: '公开接口读取；未登录只返回前 10 首完整信息。',
  qq: '歌单与搜索均可直接读取，无需登录。',
  kugou: '移动端公开接口，歌单与搜索可用。',
  kuwo: '接口校验 csrf，需在服务端配置 KUWO_COOKIE。',
  apple: '需要 Apple Music 开发者令牌（MusicKit JWT）。',
};

const CAPABILITIES: Record<string, { read: string; search: string; write: string }> = {
  netease: { read: '公开接口', search: '可用', write: '文件送达' },
  qq: { read: '公开接口', search: '可用', write: '文件送达' },
  kugou: { read: '公开接口', search: '可用', write: '文件送达' },
  kuwo: { read: '需 Cookie', search: '需 Cookie', write: '文件送达' },
  apple: { read: '需令牌', search: '需令牌', write: '文件送达' },
};

export function Landing() {
  const { user } = useAuth();
  const startPath = user ? '/app/import' : '/register';

  return (
    <div>
      <div className="landing-hero">
        <div className="hero-eyebrow">
          <span className="eyebrow">歌单迁移 · 五平台互通</span>
          <span className="eyebrow">本地演示 · v0.1</span>
        </div>

        <div className="hero">
          <h1>
            把歌单，
            <br />
            渡到对岸。
          </h1>
          <p className="hero-lede">
            网易云、QQ 音乐、酷狗、酷我、Apple Music。整份歌单带着顺序搬过去。
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to={startPath}>
              开始迁移
              <ArrowRight size={15} />
            </Link>
            <Link className="btn btn-ghost" to="/s/demo">
              看一份分享
            </Link>
          </div>
          <div className="chips">
            <span>五平台互通</span>
            <span>逐首匹配校验</span>
            <span>分享即可保存</span>
          </div>
        </div>

        <div className="preview" aria-label="歌单迁移示例">
          <div className="preview-head">
            <span className="tag">示例</span>
            <span className="preview-title">深夜渡口</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--stone)' }}>
              10 首
            </span>
            <div className="preview-head-meta">
              <span>送达</span>
              <span className="platform-inline">
                <span className="monogram">Q</span>
                QQ 音乐
              </span>
            </div>
          </div>
          <div className="preview-grid">
            <div className="preview-col">
              <div className="preview-col-head">
                <span className="preview-col-title">原歌单 · 网易云</span>
                <span className="tag tag--sand">源</span>
              </div>
              {PREVIEW_ROWS.map((row, index) => (
                <div className="mini-row" key={row.title}>
                  <span className="mini-no">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mini-title">{row.title}</span>
                  <span className="mini-sub">{row.artist}</span>
                </div>
              ))}
            </div>
            <div className="preview-mid" aria-hidden="true">
              <ArrowRight size={18} />
            </div>
            <div className="preview-col">
              <div className="preview-col-head">
                <span className="preview-col-title">匹配结果 · QQ 音乐</span>
                <span className="tag">9 / 10</span>
              </div>
              {PREVIEW_ROWS.map((row, index) => (
                <div className="mini-row" key={row.title}>
                  <span className="mini-no">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mini-title">{row.title}</span>
                  {row.match === 'match' ? (
                    <span className="mini-check">
                      <Check size={11} /> {row.score}
                    </span>
                  ) : (
                    <span className="mini-sub">待手动</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="preview-foot">
            <span>匹配度按曲名、歌手、时长综合判断</span>
            <span className="mono">9 首可直达 · 1 首待手动</span>
          </div>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">工作方式</span>
          <h2>读取、比对、送达。</h2>
          <p className="section-lede">
            不越过平台的版权边界，只把你能听的东西，整理成能在另一个平台继续听的样子。每一步都留下记录，匹配不准的曲目会单独标出来。
          </p>
        </div>
        <div className="steps">
          <div className="step">
            <span className="step-no">01</span>
            <div>
              <h3 className="step-name">读取原歌单</h3>
              <p className="step-text">
                粘贴网易云、QQ 音乐、酷狗、酷我或 Apple Music 的公开歌单链接。系统读取曲名、歌手、专辑、时长与顺序，原样保存一份。
              </p>
            </div>
          </div>
          <div className="step">
            <span className="step-no">02</span>
            <div>
              <h3 className="step-name">逐首比对</h3>
              <p className="step-text">
                在目标平台搜索同一首歌，按曲名、歌手、时长综合打分。达到阈值的标记为已匹配，其余留给人工确认，不硬凑。
              </p>
            </div>
          </div>
          <div className="step">
            <span className="step-no">03</span>
            <div>
              <h3 className="step-name">带走整份歌单</h3>
              <p className="step-text">
                导出 CSV / TXT / JSON，或按匹配清单逐首打开目标平台。分享链接里是完整的曲目表，朋友登录后可以一键存进自己的歌单。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">接入范围</span>
          <h2>五个平台，一本账。</h2>
          <p className="section-lede">
            公开接口能做的直接做；需要登录凭证的，把 Cookie 或令牌留在你自己的服务器上。写入能力受平台限制，目前以文件与直达链接送达。
          </p>
        </div>
        <div className="table-wrap">
          <table className="platforms-table">
            <thead>
              <tr>
                <th scope="col">平台</th>
                <th scope="col">读取</th>
                <th scope="col">搜索</th>
                <th scope="col">写入</th>
                <th scope="col">说明</th>
              </tr>
            </thead>
            <tbody>
              {PLATFORM_ORDER.map((platform) => (
                <tr key={platform}>
                  <td>
                    <span className="platform-inline">
                      <span className="monogram">{PLATFORM_INFO[platform].monogram}</span>
                      {PLATFORM_INFO[platform].name}
                    </span>
                  </td>
                  <td
                    className={
                      CAPABILITIES[platform].read === '公开接口'
                        ? 'capability capability--yes'
                        : 'capability'
                    }
                  >
                    {CAPABILITIES[platform].read}
                  </td>
                  <td className={CAPABILITIES[platform].search === '可用' ? 'capability capability--yes' : 'capability'}>
                    {CAPABILITIES[platform].search}
                  </td>
                  <td className="capability capability--no">{CAPABILITIES[platform].write}</td>
                  <td className="capability" style={{ whiteSpace: 'normal', color: 'var(--stone)' }}>
                    {PLATFORM_NOTES[platform]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="platform-cards">
          {PLATFORM_ORDER.map((platform) => (
            <div className="platform-card" key={platform}>
              <div className="platform-card-head">
                <span className="platform-inline">
                  <span className="monogram">{PLATFORM_INFO[platform].monogram}</span>
                  {PLATFORM_INFO[platform].name}
                </span>
                <span className="tag tag--sand">{CAPABILITIES[platform].read}</span>
              </div>
              <div className="platform-card-caps">
                搜索 · {CAPABILITIES[platform].search}　写入 · {CAPABILITIES[platform].write}
              </div>
              <p>{PLATFORM_NOTES[platform]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-split">
          <div>
            <span className="eyebrow">分享</span>
            <h2 style={{ fontSize: 32, fontWeight: 500, lineHeight: 1.3, margin: '10px 0 16px' }}>
              分享不是截图，
              <br />
              是一份能保存的歌单。
            </h2>
            <p className="section-lede" style={{ marginBottom: 28 }}>
              链接里是完整的曲目清单。朋友打开就能看，登录后可以整份存进自己的歌单，顺序和备注都在。
            </p>
            <div className="steps" style={{ marginTop: 0 }}>
              <div className="step" style={{ gridTemplateColumns: '28px 1fr', padding: '18px 0' }}>
                <span className="step-no" style={{ paddingTop: 3 }}>01</span>
                <p className="step-text">生成链接，设置只读或可保存。</p>
              </div>
              <div className="step" style={{ gridTemplateColumns: '28px 1fr', padding: '18px 0' }}>
                <span className="step-no" style={{ paddingTop: 3 }}>02</span>
                <p className="step-text">可选 7 天、30 天或长期有效。</p>
              </div>
              <div className="step" style={{ gridTemplateColumns: '28px 1fr', padding: '18px 0', borderBottom: 0 }}>
                <span className="step-no" style={{ paddingTop: 3 }}>03</span>
                <p className="step-text">保存后成为对方自己的歌单，互不覆盖。</p>
              </div>
            </div>
          </div>
          <div className="share-preview">
            <span className="eyebrow">朋友分享的歌单</span>
            <h3>深夜渡口</h3>
            <p className="meta">来自 网易云音乐 · 10 首</p>
            <div className="rows">
              <div className="mini-row">
                <span className="mini-no">01</span>
                <span className="mini-title">晴天</span>
                <span className="mini-sub">周杰伦</span>
              </div>
              <div className="mini-row">
                <span className="mini-no">02</span>
                <span className="mini-title">富士山下</span>
                <span className="mini-sub">陈奕迅</span>
              </div>
              <div className="mini-row">
                <span className="mini-no">03</span>
                <span className="mini-title">暧昧</span>
                <span className="mini-sub">王菲</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Link className="btn btn-primary btn-sm" to="/s/demo">
                保存到我的歌单
              </Link>
              <span className="btn btn-ghost btn-sm" style={{ cursor: 'default' }}>
                导出 CSV
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div
          style={{
            borderTop: '1px solid var(--border)',
            paddingTop: 56,
            marginTop: 8,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 32,
            flexWrap: 'wrap',
          }}
        >
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 500, lineHeight: 1.3 }}>
            把下一张歌单，渡过去。
          </h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="btn btn-primary" to={startPath}>
              开始迁移
              <ArrowRight size={15} />
            </Link>
            <Link className="btn btn-ghost" to="/login">
              我已有账号
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
