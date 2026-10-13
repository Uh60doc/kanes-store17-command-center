import { useState } from 'react';
import { StoreDashboard } from './dashboard/StoreDashboard.tsx';
import { GoogleSetup } from './google/GoogleSetup.tsx';

type Screen = 'store' | 'google';

export default function App() {
  const [screen, setScreen] = useState<Screen>(() =>
    new URLSearchParams(window.location.search).has('google') ? 'google' : 'store',
  );

  return (
    <>
      <nav className="app-nav" aria-label="Sections">
        <button type="button" aria-current={screen === 'store' ? 'page' : undefined} onClick={() => setScreen('store')}>
          Store
        </button>
        <button type="button" aria-current={screen === 'google' ? 'page' : undefined} onClick={() => setScreen('google')}>
          Google setup
        </button>
      </nav>
      {screen === 'store' ? <StoreDashboard /> : <GoogleSetup />}
    </>
  );
}
