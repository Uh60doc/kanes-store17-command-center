import { individualPeriodContaining, storePeriodContaining } from '../domain/reportingCalendar.ts';
import { formatMoney } from './model.ts';
import { useDashboardModel } from './useDashboardModel.ts';

export function DailyResults() {
  const model = useDashboardModel();
  const date = window.location.pathname.split('/')[2] ?? '';
  if (date) return <DayDetail date={date} model={model} />;

  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Store operating days</p>
          <h1>Daily results</h1>
          <p className="location">Store {model.storePeriodLabel}</p>
        </div>
      </header>
      <main className="page">
        <ul className="day-list">
          {model.storeDays.map((day) => (
            <li key={day.date}>
              <a href={`/daily/${day.date}`}>{day.date}{day.provisional ? ' · same-day snapshot' : ''}</a>
              <span>{day.snapWritten === null ? 'Written not imported' : formatMoney(day.snapWritten)}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

function moneyOrMissing(amount: number | null | undefined) {
  if (amount === null || amount === undefined) return <span className="status">Daily report not imported</span>;
  return <span className="amount">{formatMoney(amount)}</span>;
}

function DayDetail({
  date,
  model,
}: {
  date: string;
  model: ReturnType<typeof useDashboardModel>;
}) {
  const day = model.storeDays.find((item) => item.date === date);
  const review = (model.negativeWrittenDays ?? []).find((item) => item.date === date);
  const store = storePeriodContaining(date);
  const individual = individualPeriodContaining(date);
  return (
    <div className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Store day</p>
          <h1>{date}</h1>
          <p className="location">
            Store {store.start}–{store.end} · Individual {individual.start}–{individual.end}
          </p>
        </div>
      </header>
      <main className="page">
        <p>
          <a href="/daily">All store days</a>
        </p>
        <article className="card" data-metric="daily-snap">
          <h2>SNAP Written</h2>
          <p className="hero">{moneyOrMissing(day?.snapWritten)}</p>
          {review ? (
            <>
              <ul className="review-lines">
                {review.lines.map((line) => (
                  <li key={`${line.displayName}-${line.amount}`}>
                    <span>{line.displayName}{line.role === 'management' ? ' · management' : ''}</span>
                    <span>{formatMoney(line.amount)}</span>
                  </li>
                ))}
              </ul>
              <p className="detail">These lines add up to the printed store total. A negative total stays as printed.</p>
              <p className="tv-foot"><a href={review.reportHref}>Open the SNAP Written report</a></p>
            </>
          ) : null}
        </article>
        <article className="card" data-metric="daily-nwdsr-written">
          <h2>NWDSR Written</h2>
          <p className="hero">{moneyOrMissing(day?.nwdsrWritten)}</p>
        </article>
        <article className="card" data-metric="daily-nwdsr-delivered">
          <h2>NWDSR Delivered</h2>
          <p className="hero">{moneyOrMissing(day?.nwdsrDelivered)}</p>
        </article>
        {day?.provisional ? <p className="detail">This file was generated on the same date, so it is a same-day snapshot rather than a next-day close.</p> : null}
        <p className="detail">Store month {store.start}–{store.end}. Individual month {individual.start}–{individual.end}. A blank figure was not imported. It is not zero.</p>
      </main>
    </div>
  );
}
