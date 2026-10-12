import { useEffect, useState } from 'react';
import type { OfficeTargets } from '../config/targets.ts';
import { payrollPeriod, storeOperatingPeriod } from '../config/periods.ts';
import { currentSnapshots } from '../import/snapshotStore.ts';
import {
  buildStoreDashboard,
  formatFigure,
  formatMoney,
  formatOfficeTimestamp,
  formatPercent,
  type Figure,
  type StoreDashboardModel,
} from './model.ts';

function useOfficeClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function FigureValue({ figure }: { figure: Figure }) {
  const text = formatFigure(figure);
  if (figure.kind === 'missing') {
    return <span className="status">{text}</span>;
  }
  return <span className="amount">{text}</span>;
}

function TotalCard({
  title,
  metric,
  figure,
  detail,
  marker,
}: {
  title: string;
  metric: string;
  figure: Figure;
  detail: string;
  marker?: string;
}) {
  return (
    <article className="card" data-metric={metric} data-state={figure.kind}>
      <h3>{title}</h3>
      <p className="hero">
        <FigureValue figure={figure} />
      </p>
      {marker ? <p className="marker">{marker}</p> : null}
      <p className="detail">{detail}</p>
    </article>
  );
}

function PaceRow({ label, figure }: { label: string; figure: Figure }) {
  return (
    <div className="pace-row">
      <dt>{label}</dt>
      <dd>
        <FigureValue figure={figure} />
      </dd>
    </div>
  );
}

function GoalBlock({
  title,
  goalLabel,
  goalDisplay,
  rows,
}: {
  title: string;
  goalLabel: string;
  goalDisplay: string;
  rows: { label: string; figure: Figure }[];
}) {
  return (
    <article className="goal-block">
      <h3>{title}</h3>
      <p className="goal-label">{goalLabel}</p>
      <p className="goal-amount">{goalDisplay}</p>
      <dl className="pace">
        {rows.map((row) => (
          <PaceRow key={row.label} label={row.label} figure={row.figure} />
        ))}
      </dl>
    </article>
  );
}

function EmptyChart({ title, metric, detail }: { title: string; metric: string; detail: string }) {
  return (
    <section className="card chart-empty" data-metric={metric} data-state="empty" aria-label={title}>
      <h2>{title}</h2>
      <p className="hero">
        <span className="status">Awaiting Report</span>
      </p>
      <p className="detail">{detail}</p>
    </section>
  );
}

function DashboardBody({ model, targets }: { model: StoreDashboardModel; targets: OfficeTargets }) {
  const goals = targets.managementGoals;
  const stretch = targets.corporateStretch;

  return (
    <>
      <section className="totals" aria-labelledby="store-totals">
        <div className="section-heading">
          <h2 id="store-totals">Store totals</h2>
          <p>October operating month. Actuals come only from an imported report.</p>
        </div>
        <div className="total-grid">
          <TotalCard
            title="SNAP Written"
            metric="snap-written"
            figure={model.snapWritten}
            detail="Written sales production."
          />
          <TotalCard
            title="NWDSR Written"
            metric="nwdsr-written"
            figure={model.nwdsrWritten}
            detail="Official written report, including air tickets."
          />
          <TotalCard
            title="NWDSR Delivered"
            metric="nwdsr-delivered"
            figure={model.nwdsrDelivered}
            detail="Delivered store revenue."
          />
          <TotalCard
            title="SNAP Written vs last year"
            metric="snap-year-over-year"
            figure={model.snapYearOverYear}
            detail={`Versus ${storeOperatingPeriod.priorYearSnap.rangeDisplay}, by operating-day number.`}
          />
          <TotalCard
            title="Bedding"
            metric="bedding"
            figure={model.beddingPercentage}
            detail="Cumulative bedding. Daily rates are not averaged."
          />
          <TotalCard
            title="Store attachment"
            metric="store-attachment"
            figure={model.storeAttachment}
            detail="Cumulative opportunity counts and hits."
          />
          <TotalCard
            title="Closing ratio"
            metric="closing-ratio"
            figure={model.closingRatio}
            detail="NWDSR closed customers ÷ PERQ opportunities."
          />
        </div>
      </section>

      <section className="goals" aria-label="Goals">
        <div className="card management">
          <div className="section-heading">
            <h2>Store management goals</h2>
            <p>Configured targets for this operating month.</p>
          </div>
          <div className="goal-grid">
            <GoalBlock
              title="Written sales"
              goalLabel="Goal"
              goalDisplay={formatMoney(goals.writtenSales)}
              rows={[
                { label: 'Progress', figure: model.writtenProgress },
                { label: 'Remaining to goal', figure: model.writtenRemaining },
                { label: 'Required daily average', figure: model.writtenRequiredDailyAverage },
              ]}
            />
            <GoalBlock
              title="Delivered sales"
              goalLabel="Goal"
              goalDisplay={formatMoney(goals.deliveredSales)}
              rows={[
                { label: 'Progress', figure: model.deliveredProgress },
                { label: 'Remaining to goal', figure: model.deliveredRemaining },
                { label: 'Required daily average', figure: model.deliveredRequiredDailyAverage },
              ]}
            />
            <article className="goal-block">
              <h3>Bedding</h3>
              <p className="goal-label">Minimum</p>
              <p className="goal-amount">{formatPercent(goals.beddingMinimum)}</p>
              <dl className="pace">
                <PaceRow label="Actual" figure={model.beddingPercentage} />
              </dl>
            </article>
            <article className="goal-block">
              <h3>Closing ratio</h3>
              <p className="goal-label">Target</p>
              <p className="goal-amount">{formatPercent(goals.closingRatioTarget)}</p>
              <dl className="pace">
                <PaceRow label="Actual" figure={model.closingRatio} />
              </dl>
            </article>
          </div>
          <p className="calendar-note">
            Required daily average stays Not Available until the store operating-day calendar is supplied.
            Calendar dates are not used in its place.
          </p>
        </div>

        <div className="card stretch">
          <h2>CORPORATE STRETCH GOALS</h2>
          <p className="stretch-note">A separate target from the store management goals.</p>
          <div className="stretch-stack">
            <GoalBlock
              title="Written sales"
              goalLabel="Goal"
              goalDisplay={formatMoney(stretch.writtenSales)}
              rows={[
                { label: 'Progress', figure: model.stretchWrittenProgress },
                { label: 'Remaining to goal', figure: model.stretchWrittenRemaining },
              ]}
            />
            <GoalBlock
              title="Delivered sales"
              goalLabel="Goal"
              goalDisplay={formatMoney(stretch.deliveredSales)}
              rows={[
                { label: 'Progress', figure: model.stretchDeliveredProgress },
                { label: 'Remaining to goal', figure: model.stretchDeliveredRemaining },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="charts" aria-label="Trends">
        {model.dailySales.length === 0 ? (
          <EmptyChart
            title="Daily sales"
            metric="daily-sales"
            detail="No dated snapshots are imported. This chart stays empty."
          />
        ) : (
          <section className="card" data-metric="daily-sales" data-state="values">
            <h2>Daily sales</h2>
            <ul className="series">
              {model.dailySales.map((point) => (
                <li key={point.date}>
                  <span>{point.date}</span>
                  <span>{formatMoney(point.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {model.monthToDate.length === 0 ? (
          <EmptyChart
            title="Month-to-date trend"
            metric="month-to-date"
            detail="No dated snapshots are imported. This chart stays empty."
          />
        ) : (
          <section className="card" data-metric="month-to-date" data-state="values">
            <h2>Month-to-date trend</h2>
            <ul className="series">
              {model.monthToDate.map((point) => (
                <li key={point.date}>
                  <span>{point.date}</span>
                  <span>{formatMoney(point.amount)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </>
  );
}

export function StoreDashboard({
  signedInName,
  targets,
  onSignOut,
}: {
  signedInName: string;
  targets: OfficeTargets;
  onSignOut: () => void;
}) {
  const checkedAt = useOfficeClock();
  const model = buildStoreDashboard(currentSnapshots(), targets);

  return (
    <div className="screen" data-screen="october-dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">Kane&apos;s Furniture · Store 17</p>
          <h1>Store 17 Command Center</h1>
          <p className="location">South Orlando · Orange Blossom Trail</p>
        </div>
        <div className="refresh" data-metric="data-refresh" data-state={model.lastImportAt === null ? 'missing' : 'value'}>
          <p className="refresh-kicker">Data refresh</p>
          <p className="refresh-state">{model.lastImportAt === null ? 'Not Available' : model.lastImportAt}</p>
          <p className="checked-label">Checked</p>
          <time dateTime={checkedAt.toISOString()}>{formatOfficeTimestamp(checkedAt)}</time>
          <p className="refresh-note">
            {model.lastImportAt === null ? 'No report snapshot imported.' : 'Latest report snapshot.'}
          </p>
          <p className="signed-in">Signed in as {signedInName}</p>
          <button type="button" className="sign-out" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <section className="calendars" aria-label="Reporting periods">
          <article className="card period operating">
            <p className="eyebrow">Kept separate</p>
            <h2>{storeOperatingPeriod.label}</h2>
            <p className="period-range">{storeOperatingPeriod.rangeDisplay}</p>
            <p className="detail">{storeOperatingPeriod.purpose}</p>
          </article>
          <article className="card period payroll">
            <p className="eyebrow">Kept separate</p>
            <h2>{payrollPeriod.label}</h2>
            <p className="period-range">{payrollPeriod.rangeDisplay}</p>
            <p className="detail">{payrollPeriod.purpose}</p>
          </article>
        </section>
        <p className="period-rule">
          Store-period sales and payroll-period sales are tracked apart. One does not stand in for the other.
        </p>
        <DashboardBody model={model} targets={targets} />
      </main>
    </div>
  );
}
