import { useEffect, useState } from 'react';
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

function CalendarChart({
  title,
  metric,
  periodLabel,
  rows,
  detail,
}: {
  title: string;
  metric: string;
  periodLabel: string;
  rows: StoreDashboardModel['storeDaily'];
  detail: string;
}) {
  if (rows.length === 0) {
    return <EmptyChart title={title} metric={metric} detail="No dated snapshots fall in this calendar." />;
  }
  return (
    <section className="card" data-metric={metric} data-state="values">
      <h2>{title}</h2>
      <p className="detail">{periodLabel}</p>
      <div className="series-head">
        <span>Date</span>
        <span>Day</span>
        <span>Running</span>
      </div>
      <ul className="series calendar">
        {rows.map((point) => (
          <li key={point.date}>
            <span>{point.date}</span>
            <span>{formatMoney(point.amount)}</span>
            <span>{formatMoney(point.runningTotal)}</span>
          </li>
        ))}
      </ul>
      <p className="detail">{detail}</p>
    </section>
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

function DashboardBody({ model }: { model: StoreDashboardModel }) {
  const goals = storeOperatingPeriod.managementGoals;
  const stretch = storeOperatingPeriod.corporateStretch;

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
            detail={model.closingRatioNote}
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

      <section className="perq" aria-labelledby="verified-perq">
        <div className="section-heading">
          <h2 id="verified-perq">Verified PERQ snapshots</h2>
          <p>Cumulative counts for the printed window. Each calendar is calculated on its own.</p>
        </div>
        {model.perq.loaded ? (
          <div className="perq-grid">
            {model.perq.windows.map((entry) => (
              <article key={entry.id} className="card" data-metric={`perq-${entry.id}`}>
                <h3>{entry.label}</h3>
                <p className="period-range">
                  {entry.periodStart} – {entry.periodEnd}
                </p>
                <p className="hero">
                  <span className="amount">{entry.opportunities}</span>
                </p>
                <p className="detail">UPS + Be Backs. {entry.status}</p>
                {entry.lines.length > 0 ? (
                  <ul className="perq-lines">
                    {entry.lines.map((line) => (
                      <li key={line.displayName}>
                        <span>
                          {line.displayName}
                          {line.role === 'management' ? ' · Management' : ''}
                          {line.note ? ` · ${line.note}` : ''}
                        </span>
                        <span>{line.opportunities}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <p className="hero">
            <span className="status">Awaiting Report</span>
          </p>
        )}
        {model.flags.length > 0 ? (
          <div className="card flags">
            <h3>Still required</h3>
            <ul className="flag-list">
              {model.flags.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="charts" aria-label="Trends">
        <CalendarChart
          title="Store operating days"
          metric="store-daily"
          periodLabel={storeOperatingPeriod.rangeDisplay}
          rows={model.storeDaily}
          detail="Day amount and the running total of store-period days. October 1 stays on the individual calendar."
        />
        <CalendarChart
          title="Individual calendar days"
          metric="individual-daily"
          periodLabel={payrollPeriod.rangeDisplay}
          rows={model.individualDaily}
          detail="Day amount and the running total of calendar-month days. November 1 stays on the store calendar."
        />
      </section>
    </>
  );
}

export function StoreDashboard() {
  const checkedAt = useOfficeClock();
  const [model, setModel] = useState<StoreDashboardModel>(() => buildStoreDashboard(currentSnapshots()));

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: StoreDashboardModel | null) => {
        if (active && payload) setModel(payload);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="screen">
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
          Store results use the 2nd through the 1st. Individual results use the calendar month. Daily records keep
          their original dates, and each view is calculated on its own.
        </p>
        <DashboardBody model={model} />
      </main>
    </div>
  );
}
