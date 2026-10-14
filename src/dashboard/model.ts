import { payrollPeriod, remainingOperatingDays, reportingMonth, storeOperatingPeriod } from '../config/periods.ts';
import { filterByCategory } from '../domain/reportingCalendar.ts';
import type { ReportSnapshot } from '../import/types.ts';
import {
  buildPerqPanel,
  storeMonthOpportunities,
  type PerqPanel,
  type VerifiedPerqReference,
} from '../reference/perqReference.ts';

export type MissingLabel = 'Awaiting Report' | 'Not Available';

export type Figure =
  | { kind: 'missing'; label: MissingLabel }
  | { kind: 'value'; value: number; unit: 'dollars' | 'percent' };

export interface DatedAmountView {
  date: string;
  amount: number;
}

export interface CalendarDayView {
  date: string;
  amount: number;
  runningTotal: number;
}

export interface StoreDashboardModel {
  snapWritten: Figure;
  nwdsrWritten: Figure;
  nwdsrDelivered: Figure;
  snapYearOverYear: Figure;
  beddingPercentage: Figure;
  storeAttachment: Figure;
  closingRatio: Figure;
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
  perq: PerqPanel;
  closingRatioNote: string;
  flags: readonly string[];
  lastImportAt: string | null;
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

export function formatFigure(figure: Figure): string {
  if (figure.kind === 'missing') return figure.label;
  return figure.unit === 'dollars' ? formatMoney(figure.value) : formatPercent(figure.value);
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

function progress(actual: number | null, goal: number): Figure {
  if (actual === null || goal === 0) return missing('Not Available');
  return percentFigure(actual / goal);
}

function remaining(actual: number | null, goal: number): Figure {
  if (actual === null) return missing('Not Available');
  return dollars(goal - actual);
}

function requiredDaily(actual: number | null, goal: number, daysRemaining: number | null): Figure {
  if (actual === null || daysRemaining === null || daysRemaining <= 0) {
    return missing('Not Available');
  }
  return dollars((goal - actual) / daysRemaining);
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

export function buildStoreDashboard(
  snapshots: readonly ReportSnapshot[],
  reference: VerifiedPerqReference | null = null,
  referenceIssues: readonly string[] = [],
): StoreDashboardModel {
  const snapWrittenSnapshot = currentOf(snapshots, 'SNAP Written');
  const nwdsrWrittenSnapshot = currentOf(snapshots, 'NWDSR Written');
  const nwdsrDeliveredSnapshot = currentOf(snapshots, 'NWDSR Delivered');
  const beddingSnapshot = currentOf(snapshots, 'BSSA Written');
  const perqSnapshot = currentOf(snapshots, 'PERQ');

  const priorYearSnap = snapshots.find(
    (item) =>
      item.status === 'current' &&
      item.reportType === 'SNAP Written' &&
      item.periodStart === '2025-10-01' &&
      item.periodEnd === '2025-10-31',
  );

  const snapWritten = readMetric(snapWrittenSnapshot, 'writtenSales');
  const priorSnapWritten = readMetric(priorYearSnap, 'writtenSales');
  const nwdsrWritten = readMetric(nwdsrWrittenSnapshot, 'writtenSales');
  const nwdsrDelivered = readMetric(nwdsrDeliveredSnapshot, 'deliveredSales');
  const bedding = readMetric(beddingSnapshot, 'beddingPercentage');
  const attachmentHits = readMetric(snapWrittenSnapshot, 'attachmentHits');
  const attachmentOpportunities = readMetric(snapWrittenSnapshot, 'attachmentOpportunities');
  const storeStart = storeOperatingPeriod.start;
  const storeEnd = storeOperatingPeriod.end;
  const deliveredMatchesStore = periodsMatch(nwdsrDeliveredSnapshot ?? null, storeStart, storeEnd);
  const closedCustomers = deliveredMatchesStore ? readMetric(nwdsrDeliveredSnapshot, 'closedCustomers') : null;
  const importedPerqMatchesStore = periodsMatch(perqSnapshot ?? null, storeStart, storeEnd);
  const referencePerq = reference ? storeMonthOpportunities(reference, { start: storeStart, end: storeEnd }) : null;
  const perqOpportunities = referencePerq ?? (importedPerqMatchesStore ? readMetric(perqSnapshot, 'opportunities') : null);
  const perqPanel = buildPerqPanel(
    reference,
    referenceIssues,
    { start: storeStart, end: storeEnd },
    { start: payrollPeriod.start, end: payrollPeriod.end },
    nwdsrDeliveredSnapshot
      ? { periodStart: nwdsrDeliveredSnapshot.periodStart, periodEnd: nwdsrDeliveredSnapshot.periodEnd }
      : null,
  );

  const importedAt = snapshots
    .map((item) => item.importedAt)
    .filter((value) => value !== '')
    .sort();

  const dailySales = collectDaily(snapshots);
  const { year, month } = reportingMonth;
  const storePoints = filterByCategory(dailySales, 'store', year, month, (point) => point.date);
  const individualPoints = filterByCategory(dailySales, 'individual', year, month, (point) => point.date);
  const storeDaily = calendarDays(storePoints);
  const individualDaily = calendarDays(individualPoints);
  const monthToDate = runningTotal(storePoints);
  const outside = dailySales.filter(
    (point) => !storePoints.some((row) => row.date === point.date) && !individualPoints.some((row) => row.date === point.date),
  );
  const flags = [...perqPanel.flags];
  if (outside.length > 0) {
    flags.push(
      `Daily records dated ${outside.map((point) => point.date).join(', ')} stay on their original dates and sit outside both October calendars.`,
    );
  }
  const closingFlag = perqPanel.flags.find((flag) => flag.startsWith('NWDSR delivered') || flag.startsWith('A store PERQ'));
  const closingRatioNote =
    closingFlag ??
    'Store closing ratio uses NWDSR closed customers and PERQ opportunities for October 2–November 1.';

  return {
    snapWritten: snapWritten === null ? missing('Awaiting Report') : dollars(snapWritten),
    nwdsrWritten: nwdsrWritten === null ? missing('Awaiting Report') : dollars(nwdsrWritten),
    nwdsrDelivered: nwdsrDelivered === null ? missing('Awaiting Report') : dollars(nwdsrDelivered),
    snapYearOverYear: yearOverYear(snapWritten, priorSnapWritten),
    beddingPercentage: bedding === null ? missing('Awaiting Report') : percentFigure(bedding),
    storeAttachment: ratio(attachmentHits, attachmentOpportunities, 'Awaiting Report'),
    closingRatio: ratio(closedCustomers, perqOpportunities, 'Not Available'),
    writtenProgress: progress(snapWritten, storeOperatingPeriod.managementGoals.writtenSales),
    writtenRemaining: remaining(snapWritten, storeOperatingPeriod.managementGoals.writtenSales),
    writtenRequiredDailyAverage: requiredDaily(
      snapWritten,
      storeOperatingPeriod.managementGoals.writtenSales,
      remainingOperatingDays,
    ),
    deliveredProgress: progress(nwdsrDelivered, storeOperatingPeriod.managementGoals.deliveredSales),
    deliveredRemaining: remaining(nwdsrDelivered, storeOperatingPeriod.managementGoals.deliveredSales),
    deliveredRequiredDailyAverage: requiredDaily(
      nwdsrDelivered,
      storeOperatingPeriod.managementGoals.deliveredSales,
      remainingOperatingDays,
    ),
    stretchWrittenProgress: progress(snapWritten, storeOperatingPeriod.corporateStretch.writtenSales),
    stretchWrittenRemaining: remaining(snapWritten, storeOperatingPeriod.corporateStretch.writtenSales),
    stretchDeliveredProgress: progress(nwdsrDelivered, storeOperatingPeriod.corporateStretch.deliveredSales),
    stretchDeliveredRemaining: remaining(nwdsrDelivered, storeOperatingPeriod.corporateStretch.deliveredSales),
    dailySales,
    monthToDate,
    storeDaily,
    individualDaily,
    perq: perqPanel,
    closingRatioNote,
    flags,
    lastImportAt: importedAt.length === 0 ? null : importedAt[importedAt.length - 1],
  };
}
