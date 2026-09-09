import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { auth } from '../auth.js';
import { homeFor } from '../roles.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { token, user } = await api.login(email, password);
      auth.setSession(token, user);
      const from = location.state?.from;
      const dest = from ? (from.pathname + (from.search || '')) : homeFor(user);
      navigate(dest, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        {/* The real FSA logo, the same public/logo.png the APS system signs in
            with — not the placeholder SVG that was here. */}
        <img className="login-logo" src="/logo.png" alt="Food Safety Agency" />

        <div className="login-eyebrow">Food Safety Agency</div>
        <h1 className="login-title">People &amp; management hub</h1>
        <p className="login-subtitle">Sign in with your work email address.</p>

        {error && (
          <div className="login-error" role="alert">
            <i className="fas fa-circle-exclamation" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            /* eslint-disable-next-line jsx-a11y/no-autofocus */
            autoFocus
            spellCheck="false"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@fsa-pty.co.za"
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          {/* A reveal toggle rather than a bare password box: this is typed on
              handsets in the field, where a mistyped password you cannot see is
              the usual reason for a failed sign-in. */}
          <div className="login-password">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
            />
            <button
              type="button"
              className="login-reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
            >
              <i className={showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'} aria-hidden="true" />
            </button>
          </div>
        </div>

        <button className="btn-primary" type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="login-help">
          No account, or locked out? Ask your HR administrator to add you on
          Users &amp; access.
        </p>

        <div className="login-footer">Food Safety Agency · Internal use only</div>
      </form>
    </div>
  );
}
