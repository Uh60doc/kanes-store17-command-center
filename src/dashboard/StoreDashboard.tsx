import { useEffect, useState } from 'react';
import { storeOperatingPeriod } from '../config/periods.ts';
import {
  formatFigure,
  formatMoney,
  formatOfficeTimestamp,
  formatPercent,
  type Figure,
  type StoreDashboardModel,
  type StoreDayView,
} from './model.ts';
import { useDashboardModel } from './useDashboardModel.ts';

function useOfficeClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function moneyText(figure: Figure): string {
  return formatFigure(figure);
}

function percentOfGoal(figure: Figure, goal: number | null): string {
  if (figure.kind !== 'value' || goal === null) return 'Not Available';
  return `${(figure.value * 100).toFixed(1)}% of ${formatMoney(goal)} goal`;
}

function tone(figure: Figure, goal: number): 'good' | 'bad' | 'muted' {
  if (figure.kind !== 'value') return 'muted';
  return figure.value >= goal ? 'good' : 'bad';
}

function cumulative(days: readonly StoreDayView[], key: 'snapWritten' | 'nwdsrDelivered', through: string | null) {
  let total = 0;
  const points: { date: string; total: number }[] = [];
  for (const day of days) {
    if (through && day.date > through) break;
    const value = day[key];
    if (value === null) continue;
    total += value;
    points.push({ date: day.date, total });
  }
  return points;
}

function TrendChart({ model }: { model: StoreDashboardModel }) {
  const written = cumulative(model.storeDays, 'snapWritten', model.importedThrough);
  const delivered = cumulative(model.storeDays, 'nwdsrDelivered', model.importedThrough);
  const width = 640;
  const height = 210;
  const pad = { left: 52, right: 12, top: 16, bottom: 28 };
  const values = [...written, ...delivered].map((point) => point.total);
  const min = Math.min(0, ...values, 0);
  const max = Math.max(1000, ...values, 0);
  const yMax = Math.ceil(max / 20000) * 20000;
  const yMin = Math.floor(min / 1000) * 1000;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const dates = written.length > 0 ? written.map((point) => point.date) : delivered.map((point) => point.date);
  const xAt = (index: number) => pad.left + (dates.length <= 1 ? innerW / 2 : (index / (dates.length - 1)) * innerW);
  const yAt = (value: number) => pad.top + ((yMax - value) / (yMax - yMin)) * innerH;
  const line = (points: { date: string; total: number }[]) =>
    points
      .map((point, index) => {
        const slot = dates.indexOf(point.date);
        return `${index === 0 ? 'M' : 'L'} ${xAt(slot)} ${yAt(point.total)}`;
      })
      .join(' ');
  const ticks = [0, yMax / 2, yMax].filter((tick, index, all) => all.indexOf(tick) === index);

  return (
    <svg className="cc-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Imported SNAP written and NWDSR delivered totals">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={yAt(tick)} y2={yAt(tick)} />
          <text x={pad.left - 8} y={yAt(tick) + 4} textAnchor="end">
            {tick >= 1000 ? `$${Math.round(tick / 1000)}k` : formatMoney(tick)}
          </text>
        </g>
      ))}
      {dates.map((date, index) =>
        index % 3 === 0 || index === dates.length - 1 ? (
          <text key={date} x={xAt(index)} y={height - 8} textAnchor="middle">
            {date.slice(5)}
          </text>
        ) : null,
      )}
      {written.length > 1 ? <path d={line(written)} className="cc-line-written" /> : null}
      {delivered.length > 1 ? <path d={line(delivered)} className="cc-line-delivered" /> : null}
    </svg>
  );
}

function DashboardBody({ model }: { model: StoreDashboardModel }) {
  const now = useOfficeClock();
  const writtenGoal = model.officialWrittenGoal;
  const deliveredGoal = model.officialDeliveredGoal;
  const beddingGoal = storeOperatingPeriod.managementGoals.beddingMinimum;
  const closingGoal = storeOperatingPeriod.managementGoals.closingRatioTarget;
  const attachmentGoal = storeOperatingPeriod.managementGoals.storeAttachmentTarget;
  const beddingTone = tone(model.beddingPercentage, beddingGoal);
  const closingTone = model.closingReconciliation ? 'bad' : tone(model.closingRatio, closingGoal);
  const attachmentTone = tone(model.storeAttachment, attachmentGoal);
  const rankedTeam = [...model.salesTeam].sort(
    (left, right) => (right.writtenSales ?? Number.NEGATIVE_INFINITY) - (left.writtenSales ?? Number.NEGATIVE_INFINITY),
  );

  return (
    <div className="cc-screen">
      <header className="cc-hero">
        <div className="cc-brand">
          <img src="/store17-logo.png" alt="Kane's Furniture Store 17" />
          <div>
            <h1>Store 17 Command Center</h1>
            <p>South Orlando · Orange Blossom Trail</p>
          </div>
        </div>
        <img className="cc-mark" src="/store17-logo.png" alt="" />
        <div className="cc-latest">
          <span>Latest report day</span>
          <strong>{model.importedThrough ?? 'Not Available'}</strong>
          <small>Checked {formatOfficeTimestamp(now)}</small>
        </div>
      </header>

      <section className="cc-kpis" aria-label="Store sales">
        <article className="cc-card" data-metric="snap-written">
          <h2><i className="cc-ico money" /> SNAP Written</h2>
          <p className="cc-value">{moneyText(model.snapWritten)}</p>
          <div className="cc-bar"><span style={{ width: model.writtenProgress.kind === 'value' ? `${model.writtenProgress.value * 100}%` : '0%' }} /></div>
          <p>{percentOfGoal(model.writtenProgress, writtenGoal)}</p>
          <p className="cc-need">{moneyText(model.writtenRemaining)} still needed</p>
        </article>
        <article className="cc-card" data-metric="nwdsr-delivered">
          <h2><i className="cc-ico truck" /> NWDSR Delivered</h2>
          <p className="cc-value">{moneyText(model.nwdsrDelivered)}</p>
          <div className="cc-bar delivered"><span style={{ width: model.deliveredProgress.kind === 'value' ? `${model.deliveredProgress.value * 100}%` : '0%' }} /></div>
          <p>{percentOfGoal(model.deliveredProgress, deliveredGoal)}</p>
          <p className="cc-need">{moneyText(model.deliveredRemaining)} still needed</p>
        </article>
        <article className="cc-card" data-metric="bedding-percentage">
          <h2><i className="cc-ico bed" /> Bedding</h2>
          <p className={`cc-value ${beddingTone}`}>{formatFigure(model.beddingPercentage)}</p>
          {beddingTone === 'good' ? <span className="cc-badge good">On track</span> : beddingTone === 'muted' ? <span className="cc-badge">N/A</span> : null}
          <p>Goal {formatPercent(beddingGoal)}</p>
          <p className="cc-note">{model.beddingPeriod ?? 'Bedding report not on file'}</p>
        </article>
        <article className="cc-card" data-metric="closing-ratio">
          <h2><i className="cc-ico target" /> Closing ratio</h2>
          <p className={`cc-value ${closingTone}`}>{formatFigure(model.closingRatio)}</p>
          {model.closingReconciliation ? <span className="cc-badge">Reconcile</span> : closingTone === 'muted' ? <span className="cc-badge">N/A</span> : closingTone === 'good' ? <span className="cc-badge good">On track</span> : null}
          <p>Goal {formatPercent(closingGoal)}</p>
          <p>Purchasing customers {formatFigure(model.closingCustomers)} · Opportunities {formatFigure(model.closingOpportunities)}</p>
          <p className="cc-note">{model.closingRatioNote}</p>
        </article>
        <article className="cc-card" data-metric="store-attachment">
          <h2><i className="cc-ico link" /> Store attachment</h2>
          <p className={`cc-value ${attachmentTone}`}>{formatFigure(model.storeAttachment)}</p>
          {attachmentTone === 'muted' ? <span className="cc-badge">N/A</span> : attachmentTone === 'good' ? <span className="cc-badge good">On track</span> : null}
          <p>Goal {formatPercent(attachmentGoal)}</p>
        </article>
      </section>

      {(model.negativeWrittenDays ?? []).map((day) => (
        <a key={day.date} className="cc-flag" href={`/daily/${day.date}`} data-metric="negative-written">
          <strong>{day.date} SNAP Written {formatMoney(day.storeTotal)}</strong>
          <span>Printed store total, flagged for review. Open the day for the line breakdown.</span>
        </a>
      ))}

      <section className="cc-mid">
        <article className="cc-card">
          <h2>Still needed this month</h2>
          <p className="cc-note">Imported through {model.importedThrough ?? 'Not Available'} · Store {model.storePeriodLabel}</p>
          <div className="cc-split">
            <div>
              <span>Written still needed</span>
              <strong>{moneyText(model.writtenRemaining)}</strong>
              <small>{writtenGoal === null ? 'No official budget on file' : `of ${formatMoney(writtenGoal)}`}</small>
            </div>
            <div>
              <span>Delivered still needed</span>
              <strong>{moneyText(model.deliveredRemaining)}</strong>
              <small>{deliveredGoal === null ? 'No official budget on file' : `of ${formatMoney(deliveredGoal)}`}</small>
            </div>
          </div>
          <p className="cc-note">Month-end written projection {formatFigure(model.projectedWritten)}. Delivered projection {formatFigure(model.projectedDelivered)}. {model.paceNote}</p>
        </article>
        <article className="cc-card">
          <h2>Today and this week</h2>
          <div className="cc-quad">
            <div><span>Today written target</span><strong>{formatFigure(model.todayWrittenTarget)}</strong></div>
            <div><span>Today delivered target</span><strong>{formatFigure(model.todayDeliveredTarget)}</strong></div>
            <div><span>This week written target</span><strong>{formatFigure(model.weekWrittenTarget)}</strong></div>
            <div><span>This week delivered target</span><strong>{formatFigure(model.weekDeliveredTarget)}</strong></div>
          </div>
        </article>
        <article className="cc-card stretch" data-metric="corporate-stretch">
          <h2>Corporate stretch</h2>
          <p><span>Written</span> <strong>{model.stretchWrittenGoal === null ? 'Not Available' : formatMoney(model.stretchWrittenGoal)}</strong></p>
          <p className="cc-note">{formatFigure(model.stretchWrittenProgress)} of stretch · {formatFigure(model.stretchWrittenRemaining)} left</p>
          <p><span>Delivered</span> <strong>{model.stretchDeliveredGoal === null ? 'Not Available' : formatMoney(model.stretchDeliveredGoal)}</strong></p>
          <p className="cc-note">{formatFigure(model.stretchDeliveredProgress)} of stretch · {formatFigure(model.stretchDeliveredRemaining)} left</p>
        </article>
      </section>

      <section className="cc-lower">
        <article className="cc-card">
          <h2>Year over year</h2>
          <div className="cc-quad">
            <div><span>TY SNAP</span><strong>{moneyText(model.snapWritten)}</strong><small>Through {model.importedThrough}</small></div>
            <div><span>LY SNAP</span><strong>Not Available</strong><small>Same store month last year</small></div>
            <div><span>TY NWDSR</span><strong>{moneyText(model.nwdsrDelivered)}</strong><small>Through {model.importedThrough}</small></div>
            <div><span>LY NWDSR</span><strong>Not Available</strong><small>Same store month last year</small></div>
          </div>
        </article>
        <article className="cc-card">
          <h2>Written and delivered trend</h2>
          <p className="cc-legend"><span className="written" /> Written (SNAP) <span className="delivered" /> Delivered (NWDSR)</p>
          <TrendChart model={model} />
          <p className="cc-note">Imported days only. No projection past {model.importedThrough ?? 'the latest report'}.</p>
        </article>
      </section>

      <section className="cc-team-wrap" aria-label="Sales team">
        <div className="cc-team-head">
          <h2>Sales team performance</h2>
          <a href="/sales-team">View sales details</a>
        </div>
        <div className="cc-team">
          {rankedTeam.map((person, index) => (
            <a key={person.id} className="cc-person" href={`/sales-team/${person.id}`} title={person.coverage}>
              <span className={`cc-rank r${index + 1}`}>{index + 1}</span>
              <strong>{person.displayName}</strong>
              <em>{person.writtenSales === null ? 'Not Available' : formatMoney(person.writtenSales)}</em>
              <small>SNAP Written</small>
              <span className="cc-chips"><i>BED N/A</i><i>CR N/A</i><i>ATT N/A</i></span>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

export function StoreDashboard() {
  const model = useDashboardModel();
  if (!model) return <main className="cc-screen"><p className="cc-card">Loading the scoreboard.</p></main>;
  return (
    <main>
      <DashboardBody model={model} />
    </main>
  );
}
