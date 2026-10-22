import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function Register() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/app';
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('密码至少 8 位。');
      return;
    }
    setPending(true);
    try {
      await signUp(email.trim(), password, displayName.trim());
      navigate(from, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '注册失败，请重试。');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-head">
        <span className="eyebrow">渡口 · 新账号</span>
        <h1>在这里靠岸</h1>
        <p className="lede">创建账号，开始把歌单从一处渡到另一处。</p>
      </div>
      <div className="auth-card">
        <form className="auth-form" onSubmit={onSubmit}>
          <label className="field">
            <span className="field-label">昵称</span>
            <input
              className="input"
              required
              maxLength={40}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="朋友怎么称呼你"
            />
          </label>
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
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
            />
            <span className="field-hint">密码会加盐哈希后保存，不会明文存储。</span>
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
            {pending ? '正在创建…' : '创建账号'}
          </button>
        </form>
      </div>
      <p className="auth-switch">
        已经有账号？<Link to="/login" state={location.state}>直接登录</Link>
      </p>
    </div>
  );
}
