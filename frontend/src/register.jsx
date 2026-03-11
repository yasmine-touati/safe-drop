import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from './api';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    if (!/[A-Z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      setError('Password must contain at least one uppercase letter and one number');
      return;
    }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', {
        email: form.email,
        password: form.password,
      });
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.errors?.[0]?.msg || err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">safe<span>/</span>drop</div>
        <div className="auth-subtitle">// create your encrypted vault</div>

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
              placeholder="Min 8 chars, 1 uppercase, 1 number"
              required
            />
          </div>
          <div className="field">
            <label>Confirm Password</label>
            <input
              type="password"
              value={form.confirm}
              onChange={e => setForm({ ...form, confirm: e.target.value })}
              placeholder="••••••••"
              required
            />
          </div>
          <button className="btn-primary" type="submit" disabled={loading}>
            {loading && <span className="spinner" />}
            {loading ? 'Creating vault...' : 'Create account →'}
          </button>
        </form>

        <div className="auth-switch">
          Already have an account?
          <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  );
}