import { useEffect, useState } from 'react';
import { payrollPeriod, storeOperatingPeriod } from '../config/periods.ts';
import {
  loadCommandSheet,
  standingManagement,
  standingScorecards,
  type ManagementView,
  type OtherActivity,
  type ScorecardView,
} from '../import/commandSheet.ts';
import {
  buildStoreDashboard,
  formatMoney,
  formatOfficeTimestamp,
  formatPercent,
  type Figure,
  type StoreDashboardModel,
} from './model.ts';
import { FigureValue } from './FigureValue.tsx';
import { Scoreboard } from './Scoreboard.tsx';

function useOfficeClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
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
    <article
      className="card"
      data-metric={metric}
      data-state={figure.kind}
      data-value={figure.kind === 'value' ? String(figure.value) : undefined}
    >
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

function DashboardBody({
  model,
  periodLabel,
  provisional,
  scorecards,
  management,
  otherActivity,
}: {
  model: StoreDashboardModel;
  periodLabel: string | null;
  provisional: boolean;
  scorecards: readonly ScorecardView[];
  management: readonly ManagementView[];
  otherActivity: readonly OtherActivity[];
}) {
  const goals = model.goals;
  const stretch = model.stretch;
  const periodMarker = periodLabel ? `${periodLabel}${provisional ? ' · Provisional' : ''}` : undefined;

  return (
    <>
      <section className="totals" aria-labelledby="store-totals">
        <div className="section-heading">
          <h2 id="store-totals">Store totals</h2>
          <p>
            {periodLabel
              ? `Loaded period ${periodLabel}${provisional ? ', provisional' : ''}. A newer snapshot for these dates replaces this one.`
              : 'Actuals come only from an imported report.'}
          </p>
        </div>
        <div className="total-grid">
          <TotalCard
            title="SNAP Written"
            metric="snap-written"
            figure={model.snapWritten}
            detail="Written sales production."
            marker={periodMarker}
          />
          <TotalCard
            title="NWDSR Delivered"
            metric="nwdsr-delivered"
            figure={model.nwdsrDelivered}
            detail="Delivered store revenue."
            marker={periodMarker}
          />
          <TotalCard
            title="SNAP Written vs last year"
            metric="snap-year-over-year"
            figure={model.snapYearOverYear}
            detail={`Versus ${storeOperatingPeriod.priorYearSnap.rangeDisplay}, by operating-day number.`}
          />
          <TotalCard
            title="Projected month-end written"
            metric="projected-written"
            figure={model.projectedWritten}
            detail="Needs the store operating-day calendar. Commission projections are not used."
          />
          <TotalCard
            title="NWDSR Written"
            metric="nwdsr-written"
            figure={model.nwdsrWritten}
            detail="Official written report, including air tickets."
            marker={periodMarker}
          />
          <TotalCard
            title="Bedding"
            metric="bedding"
            figure={model.beddingPercentage}
            detail="Cumulative bedding. Daily rates are not averaged."
            marker={periodMarker}
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
            detail="No single-day amounts are in the current snapshot. This chart stays empty."
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
            detail="No single-day amounts are in the current snapshot. This chart stays empty."
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

      <Scoreboard
        periodLabel={periodLabel}
        scorecards={scorecards}
        management={management}
        otherActivity={otherActivity}
      />
    </>
  );
}

function formatImport(value: string | null): string {
  if (value === null) return 'Not Available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatOfficeTimestamp(date);
}

export function StoreDashboard({ onSignOut }: { onSignOut: () => void }) {
  const checkedAt = useOfficeClock();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [model, setModel] = useState<StoreDashboardModel>(() => buildStoreDashboard([]));
  const [periodLabel, setPeriodLabel] = useState<string | null>(null);
  const [provisional, setProvisional] = useState(false);
  const [scorecards, setScorecards] = useState<ScorecardView[]>(() => standingScorecards());
  const [management, setManagement] = useState<ManagementView[]>(() => standingManagement());
  const [otherActivity, setOtherActivity] = useState<OtherActivity[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch('/api/sheet', { credentials: 'same-origin' });
        if (response.status === 401) {
          if (!cancelled) onSignOut();
          return;
        }
        if (!response.ok) throw new Error('unavailable');
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null || !('csv' in body) || typeof body.csv !== 'string') {
          throw new Error('unavailable');
        }
        if (cancelled) return;
        const loaded = loadCommandSheet(body.csv, new Date().toISOString());
        if (!loaded.ok) throw new Error(loaded.reason);
        if (cancelled) return;
        setModel(loaded.view.model);
        setPeriodLabel(loaded.view.periodLabel);
        setProvisional(loaded.view.provisional);
        setScorecards(loaded.view.scorecards);
        setManagement(loaded.view.management);
        setOtherActivity(loaded.view.otherActivity);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setModel(buildStoreDashboard([]));
        setPeriodLabel(null);
        setProvisional(false);
        setScorecards(standingScorecards());
        setManagement(standingManagement());
        setOtherActivity([]);
        setStatus('error');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [onSignOut]);

  return (
    <div className="screen" data-sheet={status}>
      <header className="topbar">
        <div>
          <p className="eyebrow">Kane&apos;s Furniture · Store 17</p>
          <h1>Store 17 Command Center</h1>
          <p className="location">South Orlando · Orange Blossom Trail</p>
        </div>
        <div className="refresh" data-metric="data-refresh" data-state={model.lastImportAt === null ? 'missing' : 'value'}>
          <p className="refresh-kicker">Data refresh</p>
          <p className="refresh-state">{formatImport(model.lastImportAt)}</p>
          <p className="checked-label">Checked</p>
          <time dateTime={checkedAt.toISOString()}>{formatOfficeTimestamp(checkedAt)}</time>
          <p className="refresh-note">
            {status === 'loading'
              ? 'Reading the sheet…'
              : status === 'error'
                ? 'The sheet could not be read. Missing figures stay blank.'
                : 'Current sheet snapshot. A later file for the same dates replaces it.'}
          </p>
          <button className="sign-out" type="button" onClick={onSignOut}>
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
        {status === 'loading' ? <p className="reading">Reading the sheet…</p> : null}
        {status === 'error' ? (
          <p className="gate-error">The sheet could not be read. Figures stay Awaiting Report or Not Available.</p>
        ) : null}
        {status === 'loading' ? null : (
          <DashboardBody
            model={model}
            periodLabel={periodLabel}
            provisional={provisional}
            scorecards={scorecards}
            management={management}
            otherActivity={otherActivity}
          />
        )}
      </main>
    </div>
  );
}
