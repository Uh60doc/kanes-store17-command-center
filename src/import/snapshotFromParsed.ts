import { calendarOf, periodIsSingleDay, type ParsedReport } from './pdf/parseReport.ts';
import type { ImportSourceId, ReportSnapshot, SnapshotMetrics } from './types.ts';

function dollars(cents: number): number {
  return cents / 100;
}

export function snapshotFromParsed(
  parsed: ParsedReport,
  input: {
    sha256: string;
    fileName: string;
    source: ImportSourceId;
    receivedAt: string;
    messageId: string | null;
  },
): ReportSnapshot | null {
  if (!parsed.recognized || !parsed.reportType || !parsed.periodStart || !parsed.periodEnd) return null;
  const metrics: Record<string, number> = {};
  if (parsed.totalSales) {
    const key = parsed.reportType.includes('Delivered') ? 'deliveredSales' : 'writtenSales';
    metrics[key] = dollars(parsed.totalSales.cents);
  }
  if (parsed.bedSales && parsed.totalSales && parsed.totalSales.cents !== 0 && parsed.reportType.startsWith('BSSA')) {
    metrics.beddingPercentage = parsed.bedSales.cents / parsed.totalSales.cents;
  }
  if (parsed.customerCount !== null && parsed.reportType === 'NWDSR Delivered') {
    metrics.closedCustomers = parsed.customerCount;
  }
  if (parsed.customerCount !== null && parsed.reportType === 'NWDSR Written') {
    metrics.writtenCustomers = parsed.customerCount;
  }
  const singleDay = periodIsSingleDay(parsed);
  const daily =
    singleDay && parsed.totalSales
      ? [{ date: parsed.periodStart, amount: dollars(parsed.totalSales.cents) }]
      : [];
  const snapshot: ReportSnapshot = {
    id: input.sha256,
    reportType: parsed.reportType,
    sourceTitle: parsed.sourceTitle,
    storeNumber: 17,
    periodStart: parsed.periodStart,
    periodEnd: parsed.periodEnd,
    calendar: calendarOf(parsed),
    generatedAt: parsed.generatedAt,
    importedAt: input.receivedAt,
    provisional: parsed.provisional,
    status: 'current',
    supersedes: null,
    source: input.source,
    fileName: input.fileName,
    sha256: input.sha256,
    messageId: input.messageId,
    precision: parsed.precision,
    metrics: metrics satisfies SnapshotMetrics,
    associates: parsed.associates,
    projections: parsed.projections,
    daily,
    issues: parsed.issues,
  };
  return snapshot;
}
