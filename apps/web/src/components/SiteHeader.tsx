import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut } from './Icons';
import { Wordmark } from './Wordmark';

const NAV = [
  { to: '/app', label: '歌单', end: true },
  { to: '/app/import', label: '导入', end: false },
];

export function SiteHeader() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();

  const isActive = (to: string, end: boolean) => {
    if (to === '/app') {
      return pathname === '/app' || pathname.startsWith('/app/playlists');
    }
    return end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  };

  return (
    <header className="site-header">
      <nav className="nav" aria-label="主导航">
        <Wordmark />
        <div className="nav-links">
          {user ? (
            NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`nav-link${isActive(item.to, item.end) ? ' nav-link--active' : ''}`}
                aria-current={isActive(item.to, item.end) ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))
          ) : null}
        </div>
        <div className="nav-right">
          {user ? (
            <>
              <span className="nav-user">
                <span className="avatar" aria-hidden="true">
                  {user.displayName.slice(0, 1)}
                </span>
                <span>{user.displayName}</span>
              </span>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={signOut}
              >
                <LogOut size={14} />
                <span className="logout-label">退出</span>
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="nav-link">
                登录
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                创建账号
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
