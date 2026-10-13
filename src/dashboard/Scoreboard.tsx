import type { ReactNode } from 'react';
import type { ManagementView, OtherActivity, ScorecardView } from '../import/commandSheet.ts';
import { FigureValue } from './FigureValue.tsx';
import { formatFigure, formatMoney, type Figure } from './model.ts';
import {
  beddingTier,
  deliveredTier,
  maintenanceTier,
  rugTier,
  type PerformanceTier,
} from './thermometer.ts';

export function Scoreboard({
  periodLabel,
  scorecards,
  management,
  otherActivity,
}: {
  periodLabel: string | null;
  scorecards: readonly ScorecardView[];
  management: readonly ManagementView[];
  otherActivity: readonly OtherActivity[];
}) {
  return (
    <section className="scoreboard" aria-label="Salesperson scoreboard">
      <div className="section-heading">
        <h2>Salesperson scoreboard</h2>
        <p>
          {periodLabel
            ? `Store-period snapshot ${periodLabel}. These are not payroll-month figures.`
            : 'Active salespeople. Figures stay blank until a snapshot names them.'}
        </p>
      </div>
      <div className="score-grid">
        {scorecards.map((card) => (
          <article className="card person-card" key={card.id} data-person={card.id}>
            <h3>{card.name}</h3>
            {card.knownAs ? <p className="marker">{card.knownAs}</p> : null}
            <p className="detail">{card.note}</p>
            <WrittenLine figure={card.written} />
            <DeliveredLine figure={card.delivered} />
            <BeddingLine figure={card.bedding} />
            <MaintenanceLine figure={card.maintenance} />
            <RugsLine figure={card.rugs} />
            <PlainLine label="Mattress protectors" figure={card.mattress} />
            <PlainLine label="Fabric" figure={card.fabric} />
            <PlainLine label="Leather" figure={card.leather} />
            <PlainLine label="Power" figure={card.power} />
          </article>
        ))}
      </div>

      <article className="card management-break" data-metric="management">
        <h2>Management</h2>
        <p className="detail">
          Cordell Primous, Kelly Meyers, and Elizabeth Perez stay off the scoreboard. Their sales remain in the
          store totals and are not moved onto a salesperson.
        </p>
        <ul className="management-list">
          {management.map((person) => (
            <li key={person.id} data-person={person.id}>
              <span className="management-name">
                {person.name}
                <span className="detail">{person.role}</span>
              </span>
              <span>
                Written <FigureValue figure={person.written} />
              </span>
              <span>
                Delivered <FigureValue figure={person.delivered} />
              </span>
            </li>
          ))}
        </ul>
      </article>

      {otherActivity.length > 0 ? (
        <article className="card" data-metric="other-activity">
          <h2>Other store activity</h2>
          <p className="detail">
            These amounts stay out of the six cards. They are not added onto the official store total.
          </p>
          <ul className="management-list">
            {otherActivity.map((person) => (
              <li key={person.name}>
                <span className="management-name">{person.name}</span>
                <span>
                  Written <FigureValue figure={person.written} />
                </span>
                <span>
                  Delivered <FigureValue figure={person.delivered} />
                </span>
              </li>
            ))}
          </ul>
        </article>
      ) : null}
    </section>
  );
}

function WrittenLine({ figure }: { figure: Figure }) {
  return (
    <MetricLine label="Written sales">
      <FigureValue figure={figure} />
      {figure.kind === 'value' ? <span className="threshold">No approved threshold</span> : <span />}
    </MetricLine>
  );
}

function DeliveredLine({ figure }: { figure: Figure }) {
  if (figure.kind === 'missing' || figure.unit !== 'dollars') {
    return (
      <MetricLine label="Delivered sales">
        <FigureValue figure={figure} />
        <span />
      </MetricLine>
    );
  }
  const tier = deliveredTier(figure.value);
  return (
    <MetricLine label="Delivered sales">
      <FigureValue figure={figure} />
      <TierReadout tier={tier} unit="dollars" />
    </MetricLine>
  );
}

function BeddingLine({ figure }: { figure: Figure }) {
  if (figure.kind === 'missing' || figure.unit !== 'percent') {
    return (
      <MetricLine label="Bedding">
        <FigureValue figure={figure} />
        <span className="threshold">Minimum 20%</span>
      </MetricLine>
    );
  }
  return (
    <MetricLine label="Bedding">
      <FigureValue figure={figure} />
      <TierReadout tier={beddingTier(figure.value)} unit="percent" />
    </MetricLine>
  );
}

function MaintenanceLine({ figure }: { figure: Figure }) {
  if (figure.kind === 'missing' || figure.unit !== 'dollars') {
    return (
      <MetricLine label="Maintenance plans">
        <FigureValue figure={figure} />
        <span />
      </MetricLine>
    );
  }
  return (
    <MetricLine label="Maintenance plans">
      <FigureValue figure={figure} />
      <TierReadout tier={maintenanceTier(figure.value)} unit="dollars" />
    </MetricLine>
  );
}

function RugsLine({ figure }: { figure: Figure }) {
  if (figure.kind === 'missing' || figure.unit !== 'count') {
    return (
      <MetricLine label="Rugs">
        <FigureValue figure={figure} />
        <span className="threshold">Monthly goal 12</span>
      </MetricLine>
    );
  }
  return (
    <MetricLine label="Rugs">
      <FigureValue figure={figure} />
      <TierReadout tier={rugTier(figure.value)} unit="count" />
    </MetricLine>
  );
}

function PlainLine({ label, figure }: { label: string; figure: Figure }) {
  return (
    <MetricLine label={label}>
      <FigureValue figure={figure} />
      {figure.kind === 'value' ? <span className="threshold">No approved threshold</span> : <span />}
    </MetricLine>
  );
}

function MetricLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="metric-line">
      <span className="metric-name">{label}</span>
      {children}
    </div>
  );
}

function TierReadout({ tier, unit }: { tier: PerformanceTier; unit: 'dollars' | 'percent' | 'count' }) {
  const goal =
    tier.nextGoal === null
      ? tier.nextLabel
      : `${tier.nextLabel} ${formatGoal(tier.nextGoal, unit)}`;
  return (
    <span className="tier">
      <span className={`thermo tone-${tier.tone}`} aria-hidden="true">
        <span style={{ width: `${tier.fillPercent}%` }} />
      </span>
      <span className="threshold">{goal}</span>
    </span>
  );
}

function formatGoal(value: number, unit: 'dollars' | 'percent' | 'count'): string {
  if (unit === 'dollars') return formatMoney(value);
  if (unit === 'percent') return formatFigure({ kind: 'value', value, unit: 'percent' });
  return formatFigure({ kind: 'value', value, unit: 'count' });
}
