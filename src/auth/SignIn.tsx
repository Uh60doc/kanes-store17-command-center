import { useState, type FormEvent } from 'react';

export function SignIn({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (response.ok) {
        setPassword('');
        onSuccess();
        return;
      }
      if (response.status === 503) {
        setError('Sign-in is not configured on this server.');
      } else {
        setError('That password was not accepted.');
      }
      setPassword('');
    } catch {
      setError('Sign-in could not be reached.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Kane&apos;s Furniture · Store 17</p>
          <h1>Store 17 Command Center</h1>
          <p className="location">South Orlando · Orange Blossom Trail</p>
        </div>
      </header>
      <main>
        <form className="card gate" onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="detail">The dashboard stays behind this sign-in. Sales figures are not on this page.</p>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
          {error ? <p className="gate-error">{error}</p> : null}
        </form>
      </main>
    </div>
  );
}
