import { Link } from 'react-router-dom';
import { ArrowRight } from '../components/Icons';
import { Seo } from '../components/Seo';
import { useAuth } from '../context/AuthContext';
import { PLATFORM_INFO } from '../lib/platforms';
import { HOME_FAQ, SITE } from '../lib/seo';

const PLATFORMS = ['netease', 'qq'] as const;

export function Landing() {
  const { user } = useAuth();
  const startPath = user ? '/app/import' : '/register';

  return (
    <div>
      <Seo description={SITE.description} faq={HOME_FAQ} includeApp />

      <div className="landing-hero">
        <div className="hero">
          <h1>
            把歌单，
            <br />
            渡到对岸。
          </h1>
          <div className="hero-actions">
            <Link className="btn btn-primary" to={startPath}>
              开始迁移
              <ArrowRight size={15} />
            </Link>
            {!user ? (
              <Link className="btn btn-ghost" to="/login">
                我已有账号
              </Link>
            ) : null}
          </div>
          <div className="chips">
            <span>来源：QQ / 网易云 / Apple</span>
            <span>可迁往三个平台</span>
            <span>自动匹配并写入</span>
          </div>
        </div>

        <div className="platform-cards" aria-label="支持的来源平台">
          {PLATFORMS.map((platform) => (
            <div className="platform-card" key={platform}>
              <div className="platform-card-head">
                <span className="platform-inline">
                  <span className="monogram">{PLATFORM_INFO[platform].monogram}</span>
                  {PLATFORM_INFO[platform].name}
                </span>
                <span className="tag">可读 · 可写</span>
              </div>
              <p>
                {platform === 'netease'
                  ? '粘贴网易云歌单链接，迁移到 QQ 音乐。'
                  : '粘贴 QQ 音乐歌单链接，迁移到网易云音乐。'}
              </p>
            </div>
          ))}
        </div>
      </div>

      <section className="section" aria-labelledby="how-title">
        <div className="section-head">
          <span className="eyebrow">怎么用</span>
          <h2 id="how-title">三步，搬完。</h2>
          <p className="section-lede">
            渡口负责匹配，最后写进你的账号。
          </p>
        </div>
        <div className="steps">
          <div className="step">
            <span className="step-no">01</span>
            <div>
              <h3 className="step-name">粘贴歌单链接</h3>
              <p className="step-text">QQ 音乐或网易云音乐的公开歌单链接，任意一个方向。</p>
            </div>
          </div>
          <div className="step">
            <span className="step-no">02</span>
            <div>
              <h3 className="step-name">连接一次</h3>
              <p className="step-text">
                QQ / 网易云扫码，或 Apple Music 弹窗授权；登录态加密保存，可随时断开。
              </p>
            </div>
          </div>
          <div className="step">
            <span className="step-no">03</span>
            <div>
              <h3 className="step-name">匹配并写入</h3>
              <p className="step-text">
                渡口逐首匹配，在目标账号里新建一张歌单；Apple Music 先看匹配结果再写。
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq" aria-labelledby="faq-title">
        <div className="section-head">
          <span className="eyebrow">常见问题</span>
          <h2 id="faq-title">迁移之前，你可能想知道。</h2>
          <p className="section-lede">
            关于歌单迁移、授权方式和 Apple Music 的常见疑问。
          </p>
        </div>
        <div className="faq-list">
          {HOME_FAQ.map((entry, index) => (
            <details className="faq-item" key={entry.question} open={index === 0}>
              <summary>
                <span>{entry.question}</span>
                <span className="faq-mark" aria-hidden="true">
                  +
                </span>
              </summary>
              <p>{entry.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section section--about" aria-labelledby="about-title">
        <div className="section-head">
          <span className="eyebrow">关于渡口</span>
          <h2 id="about-title">歌单应该跟着人走。</h2>
        </div>
        <div className="about-copy">
          <p>
            渡口是一个在浏览器里使用的歌单迁移工具，解决的是同一个问题：
            你在一个平台攒了几百首、几千首歌，换到另一个平台时，不想再手动重建。
            粘贴公开歌单链接，渡口读取曲目、按曲名与歌手匹配，再写进目标平台的新歌单。
          </p>
          <p>
            来源支持 QQ 音乐、网易云音乐和 Apple Music 公开歌单，目标支持 QQ 音乐、网易云音乐和
            Apple Music。QQ 音乐与网易云音乐之间可以直接互迁；Apple Music 通过 Soundiiz
            免费导入，或在配置开发者 token 后使用 MusicKit 站内直写，也可以用 TuneMyMusic
            导入导出文件。全程不需要安装 App 或浏览器插件。
          </p>
          <Link className="text-link" to={startPath}>
            把第一张歌单渡过去
            <ArrowRight size={14} />
          </Link>
        </div>
      </section>
    </div>
  );
}
