import { useState, type FormEvent } from 'react';
import type { OfficeSession } from '../config/targets.ts';
import { openOffice } from './openOffice.ts';

export function SignIn({ onSession }: { onSession: (session: OfficeSession) => void }) {
  const [name, setName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setError('Enter your name.');
      return;
    }
    setPending(true);
    setError('');
    const targets = await openOffice(accessCode);
    setPending(false);
    if (!targets) {
      setAccessCode('');
      setError('That access code is not recognized.');
      return;
    }
    setAccessCode('');
    onSession({ name: trimmedName, targets });
  }

  return (
    <div className="gate" data-screen="sign-in">
      <section className="gate-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">Kane&apos;s Furniture · Store 17</p>
        <h1 id="sign-in-title">Store 17 Command Center</h1>
        <p className="location">South Orlando · Orange Blossom Trail</p>
        <p className="gate-lead">Sign in to view the October sales numbers.</p>
        <form className="gate-form" onSubmit={onSubmit}>
          <label className="field">
            <span>Name</span>
            <input
              name="name"
              autoComplete="username"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Access code</span>
            <input
              name="access-code"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              value={accessCode}
              onChange={(event) => setAccessCode(event.target.value)}
              required
            />
          </label>
          {error ? (
            <p className="gate-error" role="alert">
              {error}
            </p>
          ) : null}
          <button className="gate-submit" type="submit" disabled={pending}>
            {pending ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </section>
    </div>
  );
}
