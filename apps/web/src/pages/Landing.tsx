import { Link } from 'react-router-dom';
import { ArrowRight } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { PLATFORM_INFO } from '../lib/platforms';

const PLATFORMS = ['netease', 'qq'] as const;

export function Landing() {
  const { user } = useAuth();
  const startPath = user ? '/app/import' : '/register';

  return (
    <div>
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
            <span>来源只支持 QQ / 网易云</span>
            <span>可迁往 Apple Music</span>
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

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">怎么用</span>
          <h2>三步，搬完。</h2>
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
    </div>
  );
}
