import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from './api';

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', form);
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">safe<span>/</span>drop</div>
        <div className="auth-subtitle">// secure encrypted file sharing</div>

        {error && <div className="error-msg">⚠ {error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              required
            />
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading && <span className="spinner" />}
            {loading ? 'Authenticating...' : 'Login →'}
          </button>
        </form>

        <div className="auth-switch">
          No account?
          <Link to="/register">Register here</Link>
        </div>
      </div>
    </div>
  );
}