import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';
  const [email, setEmail] = useState('demo@dukou.app');
  const [password, setPassword] = useState('demo1234');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-head">
        <span className="eyebrow">渡口 · 账号</span>
        <h1>回到渡口</h1>
        <p className="lede">登录后继续整理你的歌单。</p>
      </div>
      <div className="auth-card">
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">邮箱</span>
            <input
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
            />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
            {pending ? '正在登录…' : '登录'}
          </button>
        </form>
      </div>
      <p className="auth-switch">
        还没有账号？<Link to="/register" state={location.state}>创建一个</Link>
      </p>
    </div>
  );
}
