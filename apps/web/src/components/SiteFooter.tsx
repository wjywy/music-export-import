import { Link } from 'react-router-dom';
import { FerryMark } from './Wordmark';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <Link to="/" className="brand" aria-label="渡口 · 首页">
            <FerryMark size={24} />
            <span className="brand-cn">渡口</span>
          </Link>
          <p>把歌单从一处渡到另一处。五平台互通，逐首核对。</p>
          <div className="footer-links">
            <Link to="/s/demo">示例歌单</Link>
            <span aria-hidden="true">·</span>
            <Link to="/app/import">导入</Link>
            <span aria-hidden="true">·</span>
            <Link to="/app/settings">平台接入</Link>
          </div>
        </div>
        <div className="footer-colophon">
          <p className="footer-ethos">
            歌单是一个人听过的证据。它应该跟着人走，而不是留在某个 App 里。
          </p>
          <span className="eyebrow">Dukou · 2026</span>
        </div>
      </div>
    </footer>
  );
}
