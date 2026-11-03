import { Link } from 'react-router-dom';
import { ArrowRight } from '../components/Icons';
import { Seo } from '../components/Seo';
import { ROBOTS_NOINDEX } from '../lib/seo';

export function NotFound() {
  return (
    <div className="page page--narrow" style={{ textAlign: 'center', paddingTop: 120 }}>
      <Seo
        title="页面未找到"
        description="这条水路走不通：页面可能已经搬走，或者链接写错了。回到渡口首页继续迁移歌单。"
        robots={ROBOTS_NOINDEX}
      />
      <span className="eyebrow">404</span>
      <h1 className="page-title" style={{ marginTop: 12 }}>
        这条水路走不通
      </h1>
      <p className="lede" style={{ marginBottom: 28 }}>
        页面可能已经搬走，或者链接写错了。
      </p>
      <Link className="btn btn-primary" to="/">
        回到渡口
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}
