/** Turn parsed KPI workbooks into ledger rows. Day files stay daily. */

import { employees } from '../src/config/roster.ts';
import { makeRecord, type LedgerRecord } from '../src/domain/kpiLedger.ts';
import type { KpiLine, KpiReport } from './kpiWorkbook.ts';
import type { MaintenanceReport } from './maintenanceText.ts';

const STORE = '17';

export function verifiedThrough(start: string, end: string, pulledThrough: string): string {
  if (start === end) return start;
  return end < pulledThrough ? end : pulledThrough;
}

function base(report: KpiReport, through: string) {
  const daily = report.start === report.end;
  return {
    grain: daily ? 'daily' as const : 'cumulative' as const,
    reportDate: daily ? report.start : '',
    periodStart: report.start,
    periodEnd: report.end,
    verifiedThrough: through,
    store: STORE,
    sourceReport: report.filename,
  };
}

function canonicalPerson(name: string, code = ''): { code: string; display: string } | null {
  const key = name.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!key || key === 'TOTAL' || key === 'ASL TOTAL' || /^\d+$/.test(key)) return null;
  const found = employees.find((person) => {
    if (code && (person.code === code || person.aliasCodes.includes(code))) return true;
    if (person.displayName.toUpperCase() === key) return true;
    return person.nameAliases.some((alias) => alias.toUpperCase() === key);
  });
  if (found) return { code: found.code || code, display: found.displayName };
  return { code, display: name.trim().replace(/\s+/g, ' ') };
}

interface Qty {
  qual: number | null;
  sold: number | null;
  dollars: number | null;
  percent: number | null;
}

function qtyRow(
  view: string,
  report: KpiReport,
  through: string,
  identity: { code: string; display: string },
  metric: Qty | null,
): LedgerRecord | null {
  if (!metric) return null;
  if (metric.qual === null && metric.sold === null && metric.dollars === null && metric.percent === null) return null;
  return makeRecord({
    ...base(report, through),
    view,
    employeeCode: identity.code,
    employeeName: identity.display,
    side: report.side,
    salesDollars: metric.dollars,
    unitCount: metric.sold,
    eligible: metric.qual,
    attachments: metric.sold,
    kpiPercent: metric.percent,
  });
}

/** Order count is printed sales ÷ printed average ticket. Only a whole number is trusted. */
export function orderCount(line: Pick<KpiLine, 'sales' | 'averageSale'>): number | null {
  if (line.sales === null || line.sales === 0) return 0;
  if (!line.averageSale) return null;
  const count = line.sales / line.averageSale;
  return Math.abs(count - Math.round(count)) < 0.02 ? Math.round(count) : null;
}

function pushLine(records: LedgerRecord[], report: KpiReport, through: string, line: KpiLine, storeLine: boolean): void {
  const identity = storeLine ? null : canonicalPerson(line.name);
  if (!storeLine && !identity) return;
  const scope = storeLine ? 'STORE' : 'PERSON';
  const employeeCode = identity?.code ?? '';
  const employeeName = identity?.display ?? '';
  // Data Analysis sales dollars are kept for individual delivered sales, KPIs and reconciliation. They are not
  // the individual written goal (SNAP) or the store volume (NWDSR).
  if (line.sales !== null) {
    records.push(makeRecord({
      ...base(report, through),
      view: `DA_SALES_${scope}`,
      employeeCode,
      employeeName,
      side: report.side,
      salesDollars: line.sales,
      unitCount: orderCount(line),
      eligible: null,
      attachments: null,
      kpiPercent: null,
    }));
  }
  const bedding = line.beddingDollars === null && line.beddingPercent === null
    ? null
    : makeRecord({
      ...base(report, through),
      view: `BEDDING_${scope}`,
      employeeCode,
      employeeName,
      side: report.side,
      salesDollars: line.beddingDollars,
      unitCount: null,
      eligible: null,
      attachments: null,
      kpiPercent: line.beddingPercent,
    });
  if (bedding) records.push(bedding);
  const rows = [
    qtyRow(`MPPA_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.pads),
    qtyRow(`FABW_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.fabric),
    qtyRow(`LTHW_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.leather),
    qtyRow(`PWAR_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.power),
    qtyRow(`ATTACH_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.totalAttach),
    qtyRow(`PILLOWS_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.pillows),
    qtyRow(`BASES_${scope}`, report, through, { code: employeeCode, display: employeeName }, line.adjustable),
  ];
  rows.forEach((row) => { if (row) records.push(row); });
  if (line.averageSale !== null) {
    records.push(makeRecord({
      ...base(report, through),
      view: `AVERAGE_${scope}`,
      employeeCode,
      employeeName,
      side: report.side,
      salesDollars: line.averageSale,
      unitCount: null,
      eligible: null,
      attachments: null,
      kpiPercent: null,
    }));
  }
  if (line.finance !== null) {
    records.push(makeRecord({
      ...base(report, through),
      view: `FINANCE_${scope}`,
      employeeCode,
      employeeName,
      side: report.side,
      salesDollars: null,
      unitCount: null,
      eligible: null,
      attachments: null,
      kpiPercent: line.finance,
    }));
  }
  if (line.rugsQty !== null || line.rugsDollars !== null) {
    records.push(makeRecord({
      ...base(report, through),
      view: `RUGS_${scope}`,
      employeeCode,
      employeeName,
      side: report.side,
      salesDollars: line.rugsDollars,
      unitCount: line.rugsQty,
      eligible: null,
      attachments: line.rugsQty,
      kpiPercent: null,
    }));
  }
}

/** Group 17 total is the store bedding line. ASL store 17 supplies pillows, bases, and rugs. */
export function recordsFromKpi(report: KpiReport, pulledThrough: string): LedgerRecord[] {
  const through = verifiedThrough(report.start, report.end, pulledThrough);
  const records: LedgerRecord[] = [];
  if (report.family === 'group17') {
    if (report.store) pushLine(records, report, through, report.store, true);
    report.lines.forEach((line) => {
      if (line.name.toUpperCase() === 'TOTAL') return;
      pushLine(records, report, through, line, false);
    });
    return records;
  }
  const store = report.lines.find((line) => line.name === '17');
  if (store) {
    const pillows = qtyRow('PILLOWS_STORE', report, through, { code: '', display: '' }, store.pillows);
    const bases = qtyRow('BASES_STORE', report, through, { code: '', display: '' }, store.adjustable);
    const rugs = store.rugsQty === null && store.rugsDollars === null ? null : makeRecord({
      ...base(report, through),
      view: 'RUGS_STORE',
      employeeCode: '',
      employeeName: '',
      side: report.side,
      salesDollars: store.rugsDollars,
      unitCount: store.rugsQty,
      eligible: null,
      attachments: store.rugsQty,
      kpiPercent: null,
    });
    [pillows, bases, rugs].forEach((row) => { if (row) records.push(row); });
  }
  report.lines.forEach((line) => {
    const identity = canonicalPerson(line.name);
    if (!identity) return;
    const pillows = qtyRow('PILLOWS_PERSON', report, through, identity, line.pillows);
    const bases = qtyRow('BASES_PERSON', report, through, identity, line.adjustable);
    if (pillows) records.push(pillows);
    if (bases) records.push(bases);
    if (line.rugsQty !== null || line.rugsDollars !== null) {
      records.push(makeRecord({
        ...base(report, through),
        view: 'RUGS_PERSON',
        employeeCode: identity.code,
        employeeName: identity.display,
        side: report.side,
        salesDollars: line.rugsDollars,
        unitCount: line.rugsQty,
        eligible: null,
        attachments: line.rugsQty,
        kpiPercent: null,
      }));
    }
  });
  return records;
}

export function recordsFromMaintenance(report: MaintenanceReport, source: string): LedgerRecord[] {
  const records: LedgerRecord[] = [];
  report.lines.forEach((line) => {
    const storeLine = line.name === 'STORE';
    const person = storeLine ? null : canonicalPerson(line.name, line.code);
    if (!storeLine && !person) return;
    const scope = storeLine ? 'STORE' : 'PERSON';
    const common = {
      grain: 'cumulative' as const,
      reportDate: '',
      periodStart: report.start,
      periodEnd: report.end,
      verifiedThrough: report.verifiedThrough,
      store: STORE,
      employeeCode: person?.code ?? '',
      employeeName: person?.display ?? '',
      sourceReport: source,
    };
    if (report.kind === 'mppa') {
      if (line.mattressSales !== null || line.padSales !== null) {
        records.push(makeRecord({
          ...common,
          view: `MPPA_${scope}`,
          side: 'written',
          salesDollars: null,
          unitCount: line.padSales,
          eligible: line.mattressSales,
          attachments: line.padSales,
          kpiPercent: line.padPercent,
        }));
      }
      if (line.baseSales !== null) {
        records.push(makeRecord({
          ...common,
          view: `BASES_${scope}`,
          side: 'written',
          salesDollars: null,
          unitCount: line.baseSales,
          eligible: line.mattressSales,
          attachments: line.baseSales,
          kpiPercent: line.basePercent,
        }));
      }
    }
    if (report.kind === 'uvwl' && line.woodSales !== null) {
      records.push(makeRecord({
        ...common,
        view: `UVWL_${scope}`,
        side: 'written',
        salesDollars: null,
        unitCount: line.woodWarranties,
        eligible: line.woodSales,
        attachments: line.woodWarranties,
        kpiPercent: line.woodPercent,
      }));
    }
    if (report.kind === 'rugs' && line.rugCount !== null) {
      records.push(makeRecord({
        ...common,
        view: `RUGS_${scope}`,
        side: 'written',
        salesDollars: line.rugDollars,
        unitCount: line.rugCount,
        eligible: null,
        attachments: line.rugCount,
        kpiPercent: null,
      }));
    }
  });
  return records;
}
