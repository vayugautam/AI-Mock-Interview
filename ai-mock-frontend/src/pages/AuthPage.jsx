import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fetchCurrentUser, loginUser, registerUser } from '../api/auth';
import { setStoredToken } from '../api/client';
import { useAuth } from '../context/AuthContext';

const emptyState = { email: '', password: '' };

export default function AuthPage({ mode = 'login' }) {
  const [form, setForm] = useState(emptyState);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const isLoginMode = mode === 'login';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!form.email.trim() || !form.password.trim()) {
      setError('Email and password are required.');
      return;
    }

    setLoading(true);
    try {
      const payload = { email: form.email.trim(), password: form.password };
      const response = isLoginMode ? await loginUser(payload) : await registerUser(payload);

      if (isLoginMode && response.access_token) {
        setStoredToken(response.access_token);
        const currentUser = await fetchCurrentUser();
        login(response.access_token, currentUser);
        const from = location.state?.from?.pathname || '/dashboard';
        navigate(from, { replace: true });
      } else {
        navigate('/login', {
          replace: true,
          state: { banner: 'Account created. Please sign in.' },
        });
      }
    } catch (err) {
      setError(err.message || 'Unable to complete request.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-heading">
          <p className="eyebrow">AI Mock Interview Platform</p>
          <h2>{isLoginMode ? 'Welcome back' : 'Create your account'}</h2>
        </div>

        {location.state?.banner && <div className="success-banner">{location.state.banner}</div>}

        <form onSubmit={handleSubmit} className="stacked-form">
          <label htmlFor="email">
            <span>Email</span>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>

          <label htmlFor="password">
            <span>Password</span>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Enter your password"
              autoComplete={isLoginMode ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? 'Please wait...' : isLoginMode ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-footer">
          {isLoginMode ? 'Need an account?' : 'Already have an account?'}{' '}
          <Link to={isLoginMode ? '/register' : '/login'}>
            {isLoginMode ? 'Create one' : 'Sign in'}
          </Link>
        </p>
      </div>
    </div>
  );
}
