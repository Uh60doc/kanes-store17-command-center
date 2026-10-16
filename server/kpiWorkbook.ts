/** KPI workbook parser. Attachment percent is sold quantity ÷ qualified quantity. */

import { firstSheet, unzip } from './xlsxLite.ts';

export interface QtyMetric {
  qual: number | null;
  sold: number | null;
  dollars: number | null;
  percent: number | null;
  mismatch: boolean;
}

export interface KpiLine {
  name: string;
  sales: number | null;
  averageSale: number | null;
  finance: number | null;
  beddingDollars: number | null;
  beddingPercent: number | null;
  fabric: QtyMetric;
  power: QtyMetric;
  leather: QtyMetric;
  pads: QtyMetric;
  pillows: QtyMetric | null;
  adjustable: QtyMetric | null;
  powerBasePercent: number | null;
  rugsQty: number | null;
  rugsDollars: number | null;
}

export interface KpiReport {
  filename: string;
  family: 'group17' | 'asl';
  side: 'written' | 'delivered';
  start: string;
  end: string;
  lines: KpiLine[];
  store: KpiLine | null;
}

function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function cents(value: number | null): number | null {
  if (value === null) return null;
  return Math.round(value * 100) / 100;
}

/** One-decimal percent such as 20.6, stored as a fraction that displays as 20.6%. */
function fractionFromPercent(oneDecimal: number): number {
  return Math.round(oneDecimal * 10) / 1000;
}

/** Printed percents are already on a 0–100 scale. Store the one-decimal fraction. */
export function percentFraction(printed: number | null): number | null {
  if (printed === null) return null;
  return fractionFromPercent(Math.round(printed * 10) / 10);
}

function qtyMetric(
  qual: string | null | undefined,
  sold: string | null | undefined,
  dollars: string | null | undefined,
  printed: string | null | undefined,
): QtyMetric {
  const qualified = num(qual);
  let soldQty = num(sold);
  let amount = cents(num(dollars));
  const printedPercent = num(printed);
  if (soldQty === null && qualified !== null && qualified !== 0) {
    soldQty = 0;
    if (amount === null) amount = 0;
  }
  if (soldQty === null || qualified === null || qualified === 0) {
    return { qual: qualified, sold: soldQty, dollars: amount, percent: percentFraction(printedPercent), mismatch: false };
  }
  const rounded = Math.round((soldQty / qualified) * 1000) / 10;
  const fraction = fractionFromPercent(rounded);
  const printedRounded = printedPercent === null ? null : Math.round(printedPercent * 10) / 10;
  return {
    qual: qualified,
    sold: soldQty,
    dollars: amount,
    percent: fraction,
    mismatch: printedRounded !== null && Math.abs(printedRounded - rounded) > 0.05,
  };
}

function cell(row: readonly (string | null)[], index: number | undefined): string | null {
  if (index === undefined) return null;
  return row[index] ?? null;
}

function groupLabels(header: readonly (string | null)[], width: number): string[] {
  const labels: string[] = [];
  let current = '';
  for (let index = 0; index < Math.max(header.length, width); index += 1) {
    const value = header[index];
    if (value && value.trim()) current = value.trim().toUpperCase();
    labels[index] = current;
  }
  return labels;
}

interface ColumnMap {
  name: number;
  sales: number;
  average: number;
  finance: number;
  groups: Record<string, Record<string, number>>;
}

function mapColumns(rows: (string | null)[][]): ColumnMap {
  const sub = rows[1] ?? [];
  const groups = groupLabels(rows[0] ?? [], sub.length);
  const mapped: ColumnMap = { name: 0, sales: 1, average: 2, finance: 3, groups: {} };
  sub.forEach((value, index) => {
    const label = (value ?? '').trim().toUpperCase();
    const group = groups[index] ?? '';
    if (label === 'SALES PERSON' || label === 'STORE') mapped.name = index;
    if (group === 'WRITTEN ORDERS' || group === 'DELIVERED ORDERS' || group.startsWith('GROUP')) {
      if (label === 'SALES') mapped.sales = index;
      if (label === 'AVG SALES') mapped.average = index;
      if (label === 'FIN %') mapped.finance = index;
      return;
    }
    const bucket = mapped.groups[group] ?? {};
    bucket[label] = index;
    mapped.groups[group] = bucket;
  });
  return mapped;
}

function beddingPercent(dollars: number | null, sales: number | null, printed: number | null): number | null {
  if (dollars === null || sales === null || sales === 0) return percentFraction(printed);
  const rounded = Math.round((dollars / sales) * 1000) / 10;
  return fractionFromPercent(rounded);
}

function lineFrom(row: readonly (string | null)[], columns: ColumnMap): KpiLine | null {
  const name = (cell(row, columns.name) ?? '').trim();
  if (!name) return null;
  const sales = cents(num(cell(row, columns.sales)));
  const beddingGroup = columns.groups['WRITTEN BEDDING'] ?? columns.groups['DELIVERED BEDDING'] ?? {};
  const beddingDollars = cents(num(cell(row, beddingGroup.SALES)));
  const beddingPrinted = num(cell(row, beddingGroup['%']));
  const adjustable = columns.groups.ADJ;
  return {
    name,
    sales,
    averageSale: cents(num(cell(row, columns.average))),
    finance: percentFraction(num(cell(row, columns.finance))),
    beddingDollars,
    beddingPercent: beddingPercent(beddingDollars, sales, beddingPrinted),
    fabric: qtyMetric(cell(row, columns.groups.FABRIC?.['QUAL QTY']), cell(row, columns.groups.FABRIC?.['SOLD QTY']), cell(row, columns.groups.FABRIC?.['SOLD $']), cell(row, columns.groups.FABRIC?.['ATTACH %'])),
    power: qtyMetric(
      cell(row, (columns.groups['POWER FURNITURE'] ?? columns.groups.POWER)?.['QUAL QTY']),
      cell(row, (columns.groups['POWER FURNITURE'] ?? columns.groups.POWER)?.['SOLD QTY']),
      cell(row, (columns.groups['POWER FURNITURE'] ?? columns.groups.POWER)?.['SOLD $']),
      cell(row, (columns.groups['POWER FURNITURE'] ?? columns.groups.POWER)?.['ATTACH %']),
    ),
    leather: qtyMetric(cell(row, columns.groups.LEATHER?.['QUAL QTY']), cell(row, columns.groups.LEATHER?.['SOLD QTY']), cell(row, columns.groups.LEATHER?.['SOLD $']), cell(row, columns.groups.LEATHER?.['ATTACH %'])),
    pads: qtyMetric(cell(row, columns.groups['MATTRESS PADS']?.['QUAL QTY']), cell(row, columns.groups['MATTRESS PADS']?.['SOLD QTY']), cell(row, columns.groups['MATTRESS PADS']?.['SOLD $']), cell(row, columns.groups['MATTRESS PADS']?.['ATTACH %'])),
    pillows: columns.groups.PILLOWS
      ? qtyMetric(cell(row, columns.groups.PILLOWS['QUAL QTY']), cell(row, columns.groups.PILLOWS['SOLD QTY']), cell(row, columns.groups.PILLOWS['SOLD $']), cell(row, columns.groups.PILLOWS['ATTACH %']))
      : null,
    adjustable: adjustable
      ? qtyMetric(cell(row, adjustable['QUAL QTY']), cell(row, adjustable['SOLD QTY']), cell(row, adjustable['SOLD $']), cell(row, adjustable['ATTACH %']))
      : null,
    powerBasePercent: adjustable ? percentFraction(num(cell(row, adjustable['PWR %']))) : null,
    rugsQty: columns.groups.RUGS ? num(cell(row, columns.groups.RUGS['SOLD QTY'])) : null,
    rugsDollars: columns.groups.RUGS ? cents(num(cell(row, columns.groups.RUGS['SOLD $']))) : null,
  };
}

export function parseKpiWorkbook(bytes: Buffer, filename: string): KpiReport {
  const match = filename.match(/(WRITTEN|DELIVERED)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i);
  if (!match || !match[1] || !match[2] || !match[3]) throw new Error(`KPI filename has no period: ${filename}`);
  const rows = firstSheet(unzip(bytes));
  const columns = mapColumns(rows);
  const daily = match[2] === match[3];
  const labelled = (rows[1] ?? []).map((value, index) => index !== columns.name && !!(value && value.trim()));
  // A daily report is complete for its date, so a blank figure there is zero and a blank rate is 0%.
  const filled = daily
    ? rows.slice(2).map((row) => labelled.map((isFigure, index) => (isFigure && (row[index] === null || row[index] === undefined) ? '0' : row[index] ?? null)))
    : rows.slice(2);
  const lines = filled.map((row) => lineFrom(row, columns)).filter((row): row is KpiLine => row !== null);
  const family = /_ASL_/i.test(filename) ? 'asl' : 'group17';
  const store = family === 'asl'
    ? lines.find((row) => row.name === '17') ?? null
    : lines.find((row) => row.name.toUpperCase() === 'TOTAL') ?? null;
  return {
    filename,
    family,
    side: match[1].toLowerCase() === 'delivered' ? 'delivered' : 'written',
    start: match[2],
    end: match[3],
    lines,
    store,
  };
}

/** Period snapshot only. A day file and a second copy are not added. */
export function storeSnapshot(reports: readonly KpiReport[], family: KpiReport['family'], side: KpiReport['side'], start: string, end: string): KpiLine | null {
  return reports.find((report) => report.family === family && report.side === side && report.start === start && report.end === end && report.start !== report.end)?.store ?? null;
}
