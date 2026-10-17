import { DailyResults } from './dashboard/DailyResults.tsx';
import { SalesTeam } from './dashboard/SalesTeam.tsx';
import { StoreDashboard } from './dashboard/StoreDashboard.tsx';
import { GoogleSetup } from './google/GoogleSetup.tsx';

export default function App() {
  const path = window.location.pathname;
  const google = new URLSearchParams(window.location.search).has('google');
  const daily = path === '/daily' || path.startsWith('/daily/');
  const team = path === '/sales-team' || path.startsWith('/sales-team/');

  return (
    <div className="cc-shell">
      <nav className="app-nav" aria-label="Sections">
        <a href="/" aria-current={!daily && !team && !google ? 'page' : undefined}>
          Store
        </a>
        <a href="/daily" aria-current={daily ? 'page' : undefined}>
          Daily
        </a>
        <a href="/sales-team" aria-current={team ? 'page' : undefined}>
          Sales team
        </a>
        <a href="/?google" aria-current={google ? 'page' : undefined}>
          Google setup
        </a>
      </nav>
      {google ? <GoogleSetup /> : daily ? <DailyResults /> : team ? <SalesTeam /> : <StoreDashboard />}
    </div>
  );
}
