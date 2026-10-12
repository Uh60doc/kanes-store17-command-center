import { lazy, Suspense, useState } from 'react';
import { SignIn } from './auth/SignIn.tsx';
import type { OfficeSession } from './config/targets.ts';

const StoreDashboard = lazy(() =>
  import('./dashboard/StoreDashboard.tsx').then((module) => ({
    default: module.StoreDashboard,
  })),
);

export default function App() {
  const [session, setSession] = useState<OfficeSession | null>(null);

  if (!session) {
    return <SignIn onSession={setSession} />;
  }

  return (
    <Suspense fallback={<p className="opening">Opening the October dashboard…</p>}>
      <StoreDashboard
        signedInName={session.name}
        targets={session.targets}
        onSignOut={() => setSession(null)}
      />
    </Suspense>
  );
}
