import { useCallback, useEffect, useState } from 'react';
import { SignIn } from './auth/SignIn.tsx';
import { StoreDashboard } from './dashboard/StoreDashboard.tsx';

type SessionState = 'checking' | 'signed-out' | 'signed-in';

export default function App() {
  const [session, setSession] = useState<SessionState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/session', { credentials: 'same-origin', signal: controller.signal })
      .then((response) => {
        setSession(response.ok ? 'signed-in' : 'signed-out');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSession('signed-out');
      });
    return () => controller.abort();
  }, []);

  const signOut = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' });
    setSession('signed-out');
  }, []);

  if (session === 'checking') {
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
          <p className="reading">Checking sign-in…</p>
        </main>
      </div>
    );
  }

  if (session === 'signed-out') {
    return <SignIn onSuccess={() => setSession('signed-in')} />;
  }

  return <StoreDashboard onSignOut={signOut} />;
}
