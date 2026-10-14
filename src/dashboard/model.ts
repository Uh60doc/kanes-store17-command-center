import { goalsForStorePeriod } from '../config/periods.ts';
import { cardAssociates } from '../config/roster.ts';
import { addUtcDays, eachDate } from '../domain/calendar.ts';
import {
  datesInPeriod,
  filterByCategory,
  individualPeriodContaining,
  operatingDaysRemaining,
  rangeLabel,
  storePeriodContaining,
} from '../domain/reportingCalendar.ts';
import { projectedMonthEnd } from '../cloud/facts.ts';
import { officialClosing } from '../domain/closingRatio.ts';
import type { ReportSnapshot } from '../import/types.ts';
import {
  buildPerqPanel,
  storeMonthOpportunities,
  type PerqEvidence,
  type PerqPanel,
} from '../reference/perqReference.ts';

export type MissingLabel = 'Awaiting Report' | 'Not Available';

export type Figure =
  | { kind: 'missing'; label: MissingLabel }
  | { kind: 'value'; value: number; unit: 'dollars' | 'percent' | 'count' };

export interface DatedAmountView {
  date: string;
  amount: number;
}

export interface CalendarDayView {
  date: string;
  amount: number;
  runningTotal: number;
}

export interface StoreDayView {
  date: string;
  amount: number | null;
  snapWritten: number | null;
  nwdsrWritten: number | null;
  nwdsrDelivered: number | null;
  purchasingCustomers: number | null;
  opportunities: number | null;
  closingRatio: number | null;
  closingReconciliation: boolean;
  provisional: boolean;
}

export interface SalespersonBoardCard {
  id: string;
  displayName: string;
  writtenSales: number | null;
  coverage: string;
}

export interface WrittenContribution {
  displayName: string;
  amount: number;
  role: string;
}

export interface NegativeWrittenDay {
  date: string;
  storeTotal: number;
  lines: readonly WrittenContribution[];
  reportHref: string;
}

export interface StoreDashboardModel {
  snapWritten: Figure;
  nwdsrWritten: Figure;
  nwdsrDelivered: Figure;
  snapYearOverYear: Figure;
  beddingPercentage: Figure;
  storeAttachment: Figure;
  closingRatio: Figure;
  closingCustomers: Figure;
  closingOpportunities: Figure;
  closingReconciliation: boolean;
  writtenProgress: Figure;
  writtenRemaining: Figure;
  writtenRequiredDailyAverage: Figure;
  deliveredProgress: Figure;
  deliveredRemaining: Figure;
  deliveredRequiredDailyAverage: Figure;
  stretchWrittenProgress: Figure;
  stretchWrittenRemaining: Figure;
  stretchDeliveredProgress: Figure;
  stretchDeliveredRemaining: Figure;
  dailySales: readonly DatedAmountView[];
  monthToDate: readonly DatedAmountView[];
  storeDaily: readonly CalendarDayView[];
  individualDaily: readonly CalendarDayView[];
  storeDays: readonly StoreDayView[];
  perq: PerqPanel;
  closingRatioNote: string;
  flags: readonly string[];
  boardNotes: readonly string[];
  lastImportAt: string | null;
  importedThrough: string | null;
  provisionalDates: readonly string[];
  beddingPeriod: string | null;
  paceNote: string;
  salesTeam: readonly SalespersonBoardCard[];
  negativeWrittenDays: readonly NegativeWrittenDay[];
  daysRemaining: Figure;
  todayWrittenTarget: Figure;
  todayDeliveredTarget: Figure;
  weekWrittenTarget: Figure;
  weekDeliveredTarget: Figure;
  projectedWritten: Figure;
  projectedDelivered: Figure;
  snapYearOverYearDollars: Figure;
  storePeriodLabel: string;
  individualPeriodLabel: string;
  officialWrittenGoal: number | null;
  officialDeliveredGoal: number | null;
  stretchWrittenGoal: number | null;
  stretchDeliveredGoal: number | null;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const officeTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

export function formatMoney(value: number): string {
  return money.format(value);
}

export function formatPercent(value: number): string {
  return percent.format(value);
}

export function formatOfficeTimestamp(date: Date): string {
  return officeTime.format(date);
}

/** Calendar date in the store office, America/New_York. */
export function officeIsoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function formatFigure(figure: Figure): string {
  if (figure.kind === 'missing') return figure.label;
  if (figure.unit === 'dollars') return formatMoney(figure.value);
  if (figure.unit === 'count') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(figure.value);
  return formatPercent(figure.value);
}

function missing(label: MissingLabel): Figure {
  return { kind: 'missing', label };
}

function dollars(value: number): Figure {
  return { kind: 'value', value, unit: 'dollars' };
}

function percentFigure(value: number): Figure {
  return { kind: 'value', value, unit: 'percent' };
}

function countFigure(value: number): Figure {
  return { kind: 'value', value, unit: 'count' };
}

function readMetric(snapshot: ReportSnapshot | undefined, key: string): number | null {
  if (!snapshot) return null;
  const value = snapshot.metrics[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function currentOf(snapshots: readonly ReportSnapshot[], reportType: ReportSnapshot['reportType']): ReportSnapshot | undefined {
  const rows = snapshots.filter((item) => item.status === 'current' && item.reportType === reportType);
  const cumulative = rows.filter((item) => item.periodStart !== item.periodEnd);
  const pool = cumulative.length > 0 ? cumulative : rows;
  return [...pool].sort((left, right) => {
    const period = right.periodEnd.localeCompare(left.periodEnd);
    if (period !== 0) return period;
    return (right.generatedAt ?? '').localeCompare(left.generatedAt ?? '');
  })[0];
}

function ratio(numerator: number | null, denominator: number | null, whenMissing: MissingLabel): Figure {
  if (numerator === null || denominator === null) return missing(whenMissing);
  if (denominator === 0) return missing('Not Available');
  return percentFigure(numerator / denominator);
}

function yearOverYear(current: number | null, prior: number | null): Figure {
  if (current === null || prior === null || prior === 0) return missing('Not Available');
  return percentFigure((current - prior) / prior);
}

function progress(actual: number | null, goal: number | null): Figure {
  if (actual === null || goal === null || goal === 0) return missing('Not Available');
  return percentFigure(actual / goal);
}

function remaining(actual: number | null, goal: number | null): Figure {
  if (actual === null || goal === null) return missing('Not Available');
  return dollars(goal - actual);
}

function requiredDaily(actual: number | null, goal: number | null, daysRemaining: number | null): Figure {
  if (actual === null || goal === null || daysRemaining === null || daysRemaining <= 0) {
    return missing('Not Available');
  }
  return dollars((goal - actual) / daysRemaining);
}

function dollarOrMissing(value: number | null): Figure {
  return value === null ? missing('Not Available') : dollars(value);
}

function collectDaily(snapshots: readonly ReportSnapshot[]): DatedAmountView[] {
  return snapshots
    .filter((snapshot) => snapshot.status === 'current' && snapshot.reportType === 'SNAP Written' && snapshot.periodStart === snapshot.periodEnd)
    .flatMap((snapshot) =>
      snapshot.daily
        .filter((point) => Number.isFinite(point.amount) && point.date !== '')
        .map((point) => ({ date: point.date, amount: point.amount })),
    )
    .sort((left, right) => left.date.localeCompare(right.date));
}

function runningTotal(points: readonly DatedAmountView[]): DatedAmountView[] {
  let total = 0;
  return points.map((point) => {
    total += point.amount;
    return { date: point.date, amount: total };
  });
}

function calendarDays(points: readonly DatedAmountView[]): CalendarDayView[] {
  let total = 0;
  return points.map((point) => {
    total += point.amount;
    return { date: point.date, amount: point.amount, runningTotal: total };
  });
}

function periodsMatch(left: { periodStart: string; periodEnd: string } | null, start: string, end: string): boolean {
  return left !== null && left.periodStart === start && left.periodEnd === end;
}

function metricName(reportType: ReportSnapshot['reportType']): string {
  return reportType.includes('Delivered') ? 'deliveredSales' : 'writtenSales';
}

interface DayAmount {
  amount: number;
  provisional: boolean;
  generatedAt: string;
}

function singleDayMetric(
  snapshots: readonly ReportSnapshot[],
  reportType: ReportSnapshot['reportType'],
  metric: string,
  start: string,
  end: string,
): Map<string, number> {
  const days = new Map<string, number>();
  for (const snapshot of snapshots) {
    if (snapshot.status !== 'current' || snapshot.reportType !== reportType) continue;
    if (snapshot.periodStart !== snapshot.periodEnd) continue;
    if (snapshot.periodStart < start || snapshot.periodStart > end) continue;
    const value = readMetric(snapshot, metric);
    if (value === null) continue;
    days.set(snapshot.periodStart, value);
  }
  return days;
}

function singleDayAmounts(
  snapshots: readonly ReportSnapshot[],
  reportType: ReportSnapshot['reportType'],
  start: string,
  end: string,
): Map<string, DayAmount> {
  const days = new Map<string, DayAmount>();
  for (const snapshot of snapshots) {
    if (snapshot.status !== 'current' || snapshot.reportType !== reportType) continue;
    if (snapshot.periodStart !== snapshot.periodEnd) continue;
    if (snapshot.periodStart < start || snapshot.periodStart > end) continue;
    const amount = readMetric(snapshot, metricName(reportType));
    if (amount === null) continue;
    const existing = days.get(snapshot.periodStart);
    const generatedAt = snapshot.generatedAt ?? '';
    if (existing && generatedAt < existing.generatedAt) continue;
    days.set(snapshot.periodStart, { amount, provisional: snapshot.provisional, generatedAt });
  }
  return days;
}

function prefixDates(days: ReadonlyMap<string, DayAmount>, start: string, end: string): string[] {
  const dates: string[] = [];
  let cursor = start;
  while (cursor <= end && days.has(cursor)) {
    dates.push(cursor);
    cursor = addUtcDays(cursor, 1);
  }
  return dates;
}

function latestCumulative(
  snapshots: readonly ReportSnapshot[],
  reportType: ReportSnapshot['reportType'],
  start: string,
  end: string,
): ReportSnapshot | undefined {
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.status === 'current' &&
        snapshot.reportType === reportType &&
        snapshot.periodStart !== snapshot.periodEnd &&
        snapshot.periodStart === start &&
        snapshot.periodEnd <= end,
    )
    .sort((left, right) => {
      const period = right.periodEnd.localeCompare(left.periodEnd);
      if (period !== 0) return period;
      return (right.generatedAt ?? '').localeCompare(left.generatedAt ?? '');
    })[0];
}

interface Headline {
  amount: number | null;
  through: string | null;
  provisionalDates: string[];
}

function headlineFor(
  snapshots: readonly ReportSnapshot[],
  reportType: ReportSnapshot['reportType'],
  start: string,
  end: string,
): Headline {
  const days = singleDayAmounts(snapshots, reportType, start, end);
  const prefix = prefixDates(days, start, end);
  const cumulative = latestCumulative(snapshots, reportType, start, end);
  const prefixEnd = prefix[prefix.length - 1] ?? null;
  const prefixCoversCumulative = prefixEnd !== null && (cumulative === undefined || prefixEnd >= cumulative.periodEnd);
  if (prefixCoversCumulative && prefixEnd !== null) {
    let amount = 0;
    const provisionalDates: string[] = [];
    for (const date of prefix) {
      const day = days.get(date);
      if (!day) continue;
      amount += day.amount;
      if (day.provisional) provisionalDates.push(date);
    }
    return { amount, through: prefixEnd, provisionalDates };
  }
  if (cumulative) {
    let amount = readMetric(cumulative, metricName(reportType)) ?? 0;
    const provisionalDates = cumulative.provisional ? [cumulative.periodEnd] : [];
    const later = [...days.keys()].filter((date) => date > cumulative.periodEnd).sort();
    for (const date of later) {
      const day = days.get(date);
      if (!day) continue;
      amount += day.amount;
      if (day.provisional) provisionalDates.push(date);
    }
    return { amount, through: later[later.length - 1] ?? cumulative.periodEnd, provisionalDates };
  }
  return { amount: null, through: null, provisionalDates: [] };
}

function centsMatch(snapshot: ReportSnapshot, metric: string): boolean {
  const sales = readMetric(snapshot, metric);
  if (sales === null || snapshot.associates.length === 0) return false;
  if (snapshot.associates.some((row) => row.totalSalesCents === null)) return false;
  const sum = snapshot.associates.reduce((total, row) => total + (row.totalSalesCents ?? 0), 0);
  return sum === Math.round(sales * 100);
}

function personId(code: string | null, displayName: string): string {
  if (code) return code;
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const PACE_NOTE =
  'Every store day is a selling day unless it is marked closed. Today is included. The official monthly budget is not changed. A week target is not calculated because no week definition is on file.';

function salespersonBoard(
  snapshots: readonly ReportSnapshot[],
  start: string,
  end: string,
): { cards: SalespersonBoardCard[]; notes: string[] } {
  const days = snapshots.filter(
    (snapshot) =>
      snapshot.status === 'current' &&
      snapshot.reportType === 'SNAP Written' &&
      snapshot.periodStart === snapshot.periodEnd &&
      snapshot.periodStart >= start &&
      snapshot.periodStart <= end,
  );
  const reconciled = days.filter((snapshot) => centsMatch(snapshot, 'writtenSales'));
  const skipped = days.filter((snapshot) => !centsMatch(snapshot, 'writtenSales')).map((snapshot) => snapshot.periodStart);
  const totals = new Map<string, number>();
  const unknown = new Set<string>();
  for (const snapshot of reconciled) {
    for (const row of snapshot.associates) {
      if (row.role === 'management') continue;
      if (row.role === 'unknown') {
        unknown.add(row.displayName);
        continue;
      }
      if (!row.onCard || row.totalSalesCents === null) continue;
      totals.set(row.displayName, (totals.get(row.displayName) ?? 0) + row.totalSalesCents / 100);
    }
  }
  const dates = reconciled.map((snapshot) => snapshot.periodStart).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const coverage =
    first && last
      ? `SNAP Written ${first} through ${last}. This is the salesperson month ${start} through ${end}.`
      : `No reconciled SNAP Written day is on file for ${start} through ${end}.`;
  const cards = cardAssociates.map((employee) => {
    const written = totals.get(employee.displayName);
    const notStarted = employee.startDate !== null && (last === undefined || employee.startDate > last);
    return {
      id: personId(employee.code, employee.displayName),
      displayName: employee.displayName,
      writtenSales: written === undefined ? null : written,
      coverage: written === undefined ? (notStarted ? 'Not on file yet. No zero was added.' : 'Not on the imported SNAP Written lines.') : coverage,
    };
  });
  const notes: string[] = [];
  if (skipped.length > 0) {
    notes.push(
      `SNAP Written lines on ${skipped.join(', ')} do not add up to the printed store total, so those days are not split onto scorecards.`,
    );
  }
  if (unknown.size > 0) {
    const names = [...unknown].sort();
    const label = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    notes.push(
      `${label} ${names.length === 1 ? 'is' : 'are'} printed on SNAP Written and not on the sales team. No scorecard was added. Those dollars stay in the store total.`,
    );
  }
  if (first && first > start) {
    notes.push(`${start} SNAP Written is not on file. Salesperson totals are not the finished calendar month.`);
  }
  return { cards, notes };
}

function negativeWrittenDays(snapshots: readonly ReportSnapshot[], start: string, end: string): NegativeWrittenDay[] {
  return snapshots
    .filter(
      (snapshot) =>
        snapshot.status === 'current' &&
        snapshot.reportType === 'SNAP Written' &&
        snapshot.periodStart === snapshot.periodEnd &&
        snapshot.periodStart >= start &&
        snapshot.periodStart <= end &&
        centsMatch(snapshot, 'writtenSales') &&
        (readMetric(snapshot, 'writtenSales') ?? 0) < 0,
    )
    .map((snapshot) => ({
      date: snapshot.periodStart,
      storeTotal: readMetric(snapshot, 'writtenSales') ?? 0,
      lines: snapshot.associates
        .filter((row) => row.totalSalesCents !== null)
        .map((row) => ({
          displayName: row.displayName,
          amount: (row.totalSalesCents ?? 0) / 100,
          role: row.role,
        })),
      reportHref: `/api/reports/snap-written/${snapshot.periodStart}`,
    }));
}

export interface DashboardClock {
  asOf?: string;
  closedDates?: readonly string[];
}

export function buildStoreDashboard(
  snapshots: readonly ReportSnapshot[],
  reference: PerqEvidence | null = null,
  referenceIssues: readonly string[] = [],
  clock: DashboardClock = {},
): StoreDashboardModel {
  const asOf = clock.asOf ?? officeIsoDate();
  const storePeriod = storePeriodContaining(asOf);
  const individualPeriod = individualPeriodContaining(asOf);
  const goals = goalsForStorePeriod(storePeriod);
  const closedDates = clock.closedDates ?? [];
  const snapWrittenSnapshot = currentOf(snapshots, 'SNAP Written');
  const nwdsrWrittenSnapshot = currentOf(snapshots, 'NWDSR Written');
  const beddingSnapshot = currentOf(snapshots, 'BSSA Written');
  const perqSnapshot = currentOf(snapshots, 'PERQ');

  const priorYearSnap = snapshots.find(
    (item) =>
      item.status === 'current' &&
      item.reportType === 'SNAP Written' &&
      item.periodStart === '2025-10-01' &&
      item.periodEnd === '2025-10-31',
  );

  const storeStart = storePeriod.start;
  const storeEnd = storePeriod.end;
  const daysLeft = operatingDaysRemaining(storePeriod, asOf, closedDates);
  const closed = new Set(closedDates);
  const snapHeadline = headlineFor(snapshots, 'SNAP Written', storeStart, storeEnd);
  const writtenHeadline = headlineFor(snapshots, 'NWDSR Written', storeStart, storeEnd);
  const deliveredHeadline = headlineFor(snapshots, 'NWDSR Delivered', storeStart, storeEnd);
  const snapWritten = snapHeadline.amount;
  const priorSnapWritten = readMetric(priorYearSnap, 'writtenSales');
  const nwdsrWritten = writtenHeadline.amount;
  const nwdsrDelivered = deliveredHeadline.amount;
  const bedding = readMetric(beddingSnapshot, 'beddingPercentage');
  const attachmentHits = readMetric(snapWrittenSnapshot, 'attachmentHits');
  const attachmentOpportunities = readMetric(snapWrittenSnapshot, 'attachmentOpportunities');
  const importedPerqMatchesStore = periodsMatch(perqSnapshot ?? null, storeStart, storeEnd);
  const referencePerq = reference ? storeMonthOpportunities(reference, { start: storeStart, end: storeEnd }) : null;
  const perqOpportunities = referencePerq ?? (importedPerqMatchesStore ? readMetric(perqSnapshot, 'opportunities') : null);
  const perqPanel = buildPerqPanel(
    reference,
    referenceIssues,
    { start: storeStart, end: storeEnd },
    { start: individualPeriod.start, end: individualPeriod.end },
    nwdsrWrittenSnapshot
      ? { periodStart: nwdsrWrittenSnapshot.periodStart, periodEnd: nwdsrWrittenSnapshot.periodEnd }
      : null,
  );
  const writtenCustomerDays = singleDayMetric(snapshots, 'NWDSR Written', 'writtenCustomers', storeStart, storeEnd);
  const elapsedDates = datesInPeriod(storePeriod).filter((date) => date <= asOf && !closed.has(date));
  const exactWrittenCustomers = periodsMatch(nwdsrWrittenSnapshot ?? null, storeStart, storeEnd)
    ? readMetric(nwdsrWrittenSnapshot, 'writtenCustomers')
    : null;
  const closing = officialClosing({
    periodCustomers: exactWrittenCustomers,
    periodOpportunities: perqOpportunities,
    dates: elapsedDates,
    customers: writtenCustomerDays,
    opportunities: new Map<string, number>(),
  });

  const importedAt = snapshots
    .map((item) => item.importedAt)
    .filter((value) => value !== '')
    .sort();

  const dailySales = collectDaily(snapshots);
  const storePoints = filterByCategory(dailySales, 'store', storePeriod.year, storePeriod.month, (point) => point.date);
  const individualPoints = filterByCategory(
    dailySales,
    'individual',
    individualPeriod.year,
    individualPeriod.month,
    (point) => point.date,
  );
  const storeDaily = calendarDays(storePoints);
  const individualDaily = calendarDays(individualPoints);
  const snapDays = singleDayAmounts(snapshots, 'SNAP Written', storeStart, storeEnd);
  const writtenDays = singleDayAmounts(snapshots, 'NWDSR Written', storeStart, storeEnd);
  const deliveredDays = singleDayAmounts(snapshots, 'NWDSR Delivered', storeStart, storeEnd);
  const storeDays = eachDate(storeStart, storeEnd).map((date) => {
    const snapDay = snapDays.get(date);
    const writtenDay = writtenDays.get(date);
    const deliveredDay = deliveredDays.get(date);
    const purchasingCustomers = writtenCustomerDays.get(date) ?? null;
    return {
      date,
      amount: snapDay?.amount ?? null,
      snapWritten: snapDay?.amount ?? null,
      nwdsrWritten: writtenDay?.amount ?? null,
      nwdsrDelivered: deliveredDay?.amount ?? null,
      purchasingCustomers,
      opportunities: null,
      closingRatio: null,
      closingReconciliation: false,
      provisional: Boolean(snapDay?.provisional || writtenDay?.provisional || deliveredDay?.provisional),
    };
  });
  const openDates = datesInPeriod(storePeriod).filter((date) => !closed.has(date));
  const verifiedWrittenDays = openDates.filter((date) => snapDays.has(date));
  const verifiedDeliveredDays = openDates.filter((date) => deliveredDays.has(date));
  const verifiedWrittenTotal = verifiedWrittenDays.reduce((total, date) => total + (snapDays.get(date)?.amount ?? 0), 0);
  const verifiedDeliveredTotal = verifiedDeliveredDays.reduce((total, date) => total + (deliveredDays.get(date)?.amount ?? 0), 0);
  const team = salespersonBoard(snapshots, individualPeriod.start, individualPeriod.end);
  const monthToDate = runningTotal(storePoints);
  const outside = dailySales.filter(
    (point) => !storePoints.some((row) => row.date === point.date) && !individualPoints.some((row) => row.date === point.date),
  );
  const flags = [...perqPanel.flags];
  if (outside.length > 0) {
    flags.push(
      `Daily records dated ${outside.map((point) => point.date).join(', ')} stay on their original dates and sit outside both the store month and the salesperson month.`,
    );
  }
  const missingWritten = openDates.filter((date) => date < asOf && !snapDays.has(date));
  if (missingWritten.length > 0) {
    flags.push(
      missingWritten.length <= 4
        ? `SNAP Written is incomplete for ${missingWritten.join(', ')}. Those days are not zero.`
        : `SNAP Written is incomplete for ${missingWritten.length} store days. Those days are not zero.`,
    );
  }
  const closingRatioNote = closing.ratio === null
    ? `Closing ratio is Net Written purchasing customers divided by location Ups + Be Backs for the same dates in ${rangeLabel(storePeriod)}. That pair is not on file, so the ratio is Not Available.`
    : closing.needsReconciliation
      ? `Closing ratio is above 100% for ${rangeLabel(storePeriod)} and is flagged for reconciliation.`
      : `Closing ratio is Net Written purchasing customers divided by location Ups + Be Backs for ${rangeLabel(storePeriod)}.`;
  const boardNotes = [...team.notes];
  if (snapHeadline.provisionalDates.length > 0) {
    boardNotes.push(`Generated the same day, so not a next-day close: ${snapHeadline.provisionalDates.join(', ')}.`);
  }
  if (beddingSnapshot && snapHeadline.through && beddingSnapshot.periodEnd < snapHeadline.through) {
    boardNotes.push(
      `Bedding is the BSSA written report for ${beddingSnapshot.periodStart} through ${beddingSnapshot.periodEnd}. A later bedding report is not imported.`,
    );
  }

  return {
    snapWritten: snapWritten === null ? missing('Awaiting Report') : dollars(snapWritten),
    nwdsrWritten: nwdsrWritten === null ? missing('Awaiting Report') : dollars(nwdsrWritten),
    nwdsrDelivered: nwdsrDelivered === null ? missing('Awaiting Report') : dollars(nwdsrDelivered),
    snapYearOverYear: yearOverYear(snapWritten, priorSnapWritten),
    snapYearOverYearDollars: snapWritten === null || priorSnapWritten === null ? missing('Not Available') : dollars(snapWritten - priorSnapWritten),
    beddingPercentage: bedding === null ? missing('Not Available') : percentFigure(bedding),
    storeAttachment: ratio(attachmentHits, attachmentOpportunities, 'Not Available'),
    closingRatio: closing.ratio === null ? missing('Not Available') : percentFigure(closing.ratio),
    closingCustomers: closing.customers === null ? missing('Not Available') : countFigure(closing.customers),
    closingOpportunities: closing.opportunities === null ? missing('Not Available') : countFigure(closing.opportunities),
    closingReconciliation: closing.needsReconciliation,
    writtenProgress: progress(snapWritten, goals.written),
    writtenRemaining: remaining(snapWritten, goals.written),
    writtenRequiredDailyAverage: requiredDaily(snapWritten, goals.written, daysLeft),
    deliveredProgress: progress(nwdsrDelivered, goals.delivered),
    deliveredRemaining: remaining(nwdsrDelivered, goals.delivered),
    deliveredRequiredDailyAverage: requiredDaily(nwdsrDelivered, goals.delivered, daysLeft),
    stretchWrittenProgress: progress(snapWritten, goals.stretchWritten),
    stretchWrittenRemaining: remaining(snapWritten, goals.stretchWritten),
    stretchDeliveredProgress: progress(nwdsrDelivered, goals.stretchDelivered),
    stretchDeliveredRemaining: remaining(nwdsrDelivered, goals.stretchDelivered),
    dailySales,
    monthToDate,
    storeDaily,
    individualDaily,
    storeDays,
    perq: perqPanel,
    closingRatioNote,
    flags,
    boardNotes,
    lastImportAt: importedAt.length === 0 ? null : importedAt[importedAt.length - 1],
    importedThrough: snapHeadline.through,
    provisionalDates: snapHeadline.provisionalDates,
    beddingPeriod: beddingSnapshot ? `${beddingSnapshot.periodStart} through ${beddingSnapshot.periodEnd}` : null,
    paceNote: PACE_NOTE,
    salesTeam: team.cards,
    negativeWrittenDays: negativeWrittenDays(snapshots, storeStart, storeEnd),
    daysRemaining: { kind: 'value', value: daysLeft, unit: 'count' },
    todayWrittenTarget: requiredDaily(snapWritten, goals.written, daysLeft),
    todayDeliveredTarget: requiredDaily(nwdsrDelivered, goals.delivered, daysLeft),
    weekWrittenTarget: missing('Not Available'),
    weekDeliveredTarget: missing('Not Available'),
    projectedWritten: dollarOrMissing(projectedMonthEnd(verifiedWrittenDays.length > 0 ? verifiedWrittenTotal : null, verifiedWrittenDays.length, openDates.length)),
    projectedDelivered: dollarOrMissing(projectedMonthEnd(verifiedDeliveredDays.length > 0 ? verifiedDeliveredTotal : null, verifiedDeliveredDays.length, openDates.length)),
    storePeriodLabel: rangeLabel(storePeriod),
    individualPeriodLabel: rangeLabel(individualPeriod),
    officialWrittenGoal: goals.written,
    officialDeliveredGoal: goals.delivered,
    stretchWrittenGoal: goals.stretchWritten,
    stretchDeliveredGoal: goals.stretchDelivered,
  };
}
