/** Store and salesperson KPI records. Daily rows and cumulative snapshots stay separate. */

export type LedgerGrain = 'daily' | 'cumulative';

export interface LedgerRecord {
  view: string;
  grain: LedgerGrain;
  reportDate: string;
  periodStart: string;
  periodEnd: string;
  verifiedThrough: string;
  store: string;
  employeeCode: string;
  employeeName: string;
  side: 'written' | 'delivered' | '';
  salesDollars: number | null;
  unitCount: number | null;
  eligible: number | null;
  attachments: number | null;
  kpiPercent: number | null;
  sourceReport: string;
  recordKey: string;
}

export interface Measured {
  eligible: number | null;
  attachments: number | null;
  percent: number | null;
}

/** Attachment percent is attachments ÷ eligible, stored so 33.3 prints as 33.3%. */
export function percentFromCounts(attachments: number | null, eligible: number | null): number | null {
  if (attachments === null || eligible === null || eligible === 0) return null;
  return Math.round((attachments / eligible) * 1000) / 1000;
}

export function recordKey(record: Omit<LedgerRecord, 'recordKey'>): string {
  return [
    record.view,
    record.grain,
    record.periodStart,
    record.periodEnd,
    record.reportDate,
    record.side,
    record.employeeCode || record.employeeName || 'STORE',
  ].join('|');
}

export function makeRecord(input: Omit<LedgerRecord, 'recordKey' | 'kpiPercent'> & { kpiPercent?: number | null }): LedgerRecord {
  const counted = percentFromCounts(input.attachments, input.eligible);
  const record: LedgerRecord = {
    ...input,
    kpiPercent: counted ?? input.kpiPercent ?? null,
    recordKey: '',
  };
  record.recordKey = recordKey(record);
  return record;
}

function sameFigure(left: number | null, right: number | null): boolean {
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.0001;
}

function sameRecord(left: LedgerRecord, right: LedgerRecord): boolean {
  return sameFigure(left.salesDollars, right.salesDollars)
    && sameFigure(left.unitCount, right.unitCount)
    && sameFigure(left.eligible, right.eligible)
    && sameFigure(left.attachments, right.attachments)
    && sameFigure(left.kpiPercent, right.kpiPercent)
    && left.verifiedThrough === right.verifiedThrough
    && left.sourceReport === right.sourceReport;
}

/** Insert a new key, leave an identical reimport alone, and replace a corrected key. */
export function applyRecords(existing: readonly LedgerRecord[], incoming: readonly LedgerRecord[]): LedgerRecord[] {
  const map = new Map(existing.map((row) => [row.recordKey, row]));
  incoming.forEach((row) => {
    const prior = map.get(row.recordKey);
    if (prior && sameRecord(prior, row)) return;
    map.set(row.recordKey, row);
  });
  return [...map.values()];
}

export function sumDaily(
  records: readonly LedgerRecord[],
  view: string,
  side: string,
  start: string,
  end: string,
  field: 'salesDollars' | 'unitCount' | 'eligible' | 'attachments',
): number | null {
  let total = 0;
  let seen = false;
  records.forEach((row) => {
    if (row.view !== view || row.grain !== 'daily' || row.side !== side) return;
    if (row.employeeCode) return;
    if (row.reportDate < start || row.reportDate > end) return;
    const value = row[field];
    if (value === null) return;
    total += value;
    seen = true;
  });
  if (!seen) return null;
  return Math.round(total * 100) / 100;
}

/** Monthly attachment rate from the counts, never an average of daily percentages. */
export function attachmentFromDaily(
  records: readonly LedgerRecord[],
  view: string,
  side: string,
  start: string,
  end: string,
): Measured {
  const eligible = sumDaily(records, view, side, start, end, 'eligible');
  const attachments = sumDaily(records, view, side, start, end, 'attachments');
  return { eligible, attachments, percent: percentFromCounts(attachments, eligible) };
}

export function latestCumulative(
  records: readonly LedgerRecord[],
  view: string,
  side: string,
  employeeCode = '',
): LedgerRecord | null {
  let best: LedgerRecord | null = null;
  records.forEach((row) => {
    if (row.grain !== 'cumulative' || row.view !== view || row.side !== side) return;
    if ((row.employeeCode || '') !== employeeCode) return;
    if (!best || row.verifiedThrough > best.verifiedThrough) best = row;
    else if (best && row.verifiedThrough === best.verifiedThrough && row.periodEnd > best.periodEnd) best = row;
  });
  return best;
}
