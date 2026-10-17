import { storeOperatingPeriod } from '../config/periods.ts';
import { formatMoney, formatPercent } from './model.ts';
import { useDashboardModel } from './useDashboardModel.ts';

const rows = [
  'Delivered sales',
  'Bedding',
  'Maintenance plan',
  'Mattress protectors',
  'Fabric',
  'Leather',
  'Power',
  'Rugs',
  'Average ticket',
] as const;

export function SalesTeam() {
  const model = useDashboardModel();
  const id = decodeURIComponent(window.location.pathname.split('/')[2] ?? '');
  const member = (model.salesTeam ?? []).find((item) => item.id === id);
  if (id) return <PersonPage member={member} id={id} periodLabel={model.individualPeriodLabel} />;

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Individual calendar month</p>
          <h1>Sales team</h1>
          <p className="location">{model.individualPeriodLabel}</p>
        </div>
      </header>
      <main className="page">
        <ul className="day-list">
          {(model.salesTeam ?? []).map((person) => (
            <li key={person.id}>
              <a href={`/sales-team/${person.id}`}>{person.displayName}</a>
              <span>{person.writtenSales === null ? 'Written not on file' : `${formatMoney(person.writtenSales)} written`}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function PersonPage({
  id,
  member,
  periodLabel,
}: {
  id: string;
  member: ReturnType<typeof useDashboardModel>['salesTeam'][number] | undefined;
  periodLabel: string;
}) {
  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Individual calendar month</p>
          <h1>{member?.displayName ?? id}</h1>
          <p className="location">{periodLabel}</p>
        </div>
      </header>
      <main className="page scorecard">
        <p>
          <a href="/sales-team">All salespeople</a>
        </p>
        <article className="thermo" data-metric="person-written">
          <div className="thermo-top">
            <h2>Written sales</h2>
            <p>{member && member.writtenSales !== null ? formatMoney(member.writtenSales) : 'Not Available'}</p>
          </div>
          <p className="detail">{member?.coverage ?? 'This person is not on the sales team.'}</p>
          <p className="detail">An individual written goal is not set, so this row has no progress bar.</p>
        </article>
        {rows.map((label) => (
          <article key={label} className="thermo">
            <div className="thermo-top">
              <h2>{label}</h2>
              <p>Not Available</p>
            </div>
            <p className="detail">The imported reports do not have this figure for the calendar month.</p>
          </article>
        ))}
        <article className="thermo" data-metric="person-closing">
          <div className="thermo-top">
            <h2>Closing ratio</h2>
            <p>Not Available</p>
          </div>
          <p className="detail">
            Goal {formatPercent(storeOperatingPeriod.managementGoals.closingRatioTarget)}. Needs this associate&apos;s Net Written purchasing customers and PERQ opportunities for {periodLabel}. A missing count stays Not Available.
          </p>
        </article>
      </main>
    </div>
  );
}
