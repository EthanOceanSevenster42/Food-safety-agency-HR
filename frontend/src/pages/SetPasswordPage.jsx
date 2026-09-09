import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { auth } from '../auth.js';

// Public page reached from a staff invite email (?token=…&next=…). Validates
// the one-time token, lets the person set a password, signs them in, and
// forwards them to the review they were invited to.
export default function SetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const nextParamRaw = params.get('next') || '/my-reviews';
  const next = nextParamRaw.startsWith('/') ? nextParamRaw : '/my-reviews';

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setError('This link is missing its token.'); setLoading(false); return; }
    let cancelled = false;
    api.validateInvite(token)
      .then((d) => { if (!cancelled) setInvite(d); })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      const { token: jwt, user } = await api.setPassword(token, password);
      auth.setSession(jwt, user);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <img className="login-logo" src="/fsa-logo.svg" alt="Food Safety Agency" />
        <h1 className="login-title">Set your password</h1>

        {loading ? (
          <p className="login-subtitle">Checking your link…</p>
        ) : !invite ? (
          <>
            <p className="login-subtitle">We couldn't verify this link — it may have expired.</p>
            {error && <div className="error" role="alert">{error}</div>}
            <button type="button" className="btn-ghost" onClick={() => navigate('/login')}>Go to sign in</button>
          </>
        ) : (
          <>
            <p className="login-subtitle">
              Welcome{invite.displayName ? `, ${invite.displayName}` : ''} — choose a password for {invite.email}
            </p>
            {error && <div className="error" role="alert">{error}</div>}
            <div className="field">
              <label htmlFor="pw">New password</label>
              <input id="pw" type="password" autoComplete="new-password" required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
            </div>
            <div className="field">
              <label htmlFor="pw2">Confirm password</label>
              <input id="pw2" type="password" autoComplete="new-password" required
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Set password & continue'}
            </button>
          </>
        )}

        <div className="login-footer">Food Safety Agency · Internal use only</div>
      </form>
    </div>
  );
}
