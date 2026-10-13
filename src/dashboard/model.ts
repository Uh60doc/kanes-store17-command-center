import { remainingOperatingDays, storeOperatingPeriod } from '../config/periods.ts';
import type { ReportSnapshot } from '../import/types.ts';

export type MissingLabel = 'Awaiting Report' | 'Not Available';

export type Figure =
  | { kind: 'missing'; label: MissingLabel }
  | { kind: 'value'; value: number; unit: 'dollars' | 'percent' };

export interface DatedAmountView {
  date: string;
  amount: number;
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
  return snapshots.find((item) => item.status === 'current' && item.reportType === reportType);
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
  return snapshots.flatMap((snapshot) =>
    snapshot.daily
      .filter((point) => Number.isFinite(point.amount) && point.date !== '')
      .map((point) => ({ date: point.date, amount: point.amount })),
  );
}

export function buildStoreDashboard(snapshots: readonly ReportSnapshot[]): StoreDashboardModel {
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
  const closedCustomers = readMetric(nwdsrWrittenSnapshot, 'closedCustomers');
  const perqOpportunities = readMetric(perqSnapshot, 'opportunities');

  const importedAt = snapshots
    .map((item) => item.importedAt)
    .filter((value) => value !== '')
    .sort();

  const dailySales = collectDaily(snapshots);

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
    monthToDate: dailySales.length === 0 ? [] : dailySales,
    lastImportAt: importedAt.length === 0 ? null : importedAt[importedAt.length - 1],
  };
}
