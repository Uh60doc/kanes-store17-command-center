/**
 * Import daily Data Analysis KPI workbooks into CC_Ledger, CC_Kpi, and CC_Imports. Pass every day after the
 * to-date snapshot: each day is a daily record, and the store and salesperson totals are the snapshot plus those days.
 * CC_Daily and CC_Rollup are read for checks only and are never written here.
 *
 *   node --experimental-strip-types server/importKpiDay.ts [--dry] <four files for each day>
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SHEETS_SCOPE } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { appendHistory, historyRow } from './history.ts';
import { readStored } from './tokenStore.ts';
import { employees } from '../src/config/roster.ts';
import { applyRecords, heldBackDays, makeRecord, type LedgerRecord } from '../src/domain/kpiLedger.ts';
import { recordsFromKpi } from './kpiLedgerBuild.ts';
import { parseKpiWorkbook, type KpiLine, type KpiReport, type QtyMetric } from './kpiWorkbook.ts';

const STORE_START = '2026-10-02';
const STORE_END = '2026-11-01';
const PERSON_START = '2026-10-01';
const BASELINE = path.join(homedir(), '.config/store17-command-center/reports/kpi-baseline');
const STORE_BASE = {
  group17: { written: 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-11-01.xlsx', delivered: 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-02_2026-11-01.xlsx' },
  asl: { written: 'DATA_ANALYSIS_KPI_ASL_WRITTEN_2026-10-02_2026-11-01.xlsx', delivered: 'DATA_ANALYSIS_KPI_ASL_DELIVERED_2026-10-02_2026-11-01.xlsx' },
};
const HELD_BACK = 'Later report for a recorded day differs. The recorded day was kept and this figure was not applied.';
const PERSON_BASE = { written: 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-01_2026-10-13.xlsx', delivered: 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-01_2026-10-13.xlsx' };
const LEDGER_HEADERS = [
  'view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store',
  'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible',
  'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key',
];

type Side = 'written' | 'delivered';
type Cell = string | number;

interface DayFile {
  file: string;
  name: string;
  sha256: string;
  report: KpiReport;
}

interface Totals {
  sales: number;
  orders: number | null;
  financed: number | null;
  bedding: number;
  fabric: Counted;
  power: Counted;
  leather: Counted;
  pads: Counted;
  pillows: Counted | null;
  bases: Counted | null;
  rugs: number | null;
  rugDollars: number | null;
}

interface Counted {
  qual: number;
  sold: number;
  dollars: number;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function rate(top: number, bottom: number): number | null {
  return bottom === 0 ? null : round(top / bottom, 3);
}

function canonicalName(file: string): string {
  return path.basename(file).replace(/_[0-9a-f]{4}\.xlsx$/i, '.xlsx');
}

function counted(metric: QtyMetric | null): Counted {
  return { qual: metric?.qual ?? 0, sold: metric?.sold ?? 0, dollars: metric?.dollars ?? 0 };
}

function addCounted(left: Counted, right: Counted): Counted {
  return { qual: left.qual + right.qual, sold: left.sold + right.sold, dollars: round(left.dollars + right.dollars, 2) };
}

/** Order count is printed sales ÷ printed average ticket. Only a whole number is trusted. */
function orders(line: KpiLine): number | null {
  if (line.sales === null || line.sales === 0) return 0;
  if (!line.averageSale) return null;
  const count = line.sales / line.averageSale;
  return Math.abs(count - Math.round(count)) < 0.02 ? Math.round(count) : null;
}

function totals(line: KpiLine | null, asl: KpiLine | null): Totals {
  const none: QtyMetric = { qual: 0, sold: 0, dollars: 0, percent: null, mismatch: false };
  const empty: KpiLine = {
    name: '', sales: 0, averageSale: null, finance: null, beddingDollars: 0, beddingPercent: null,
    fabric: none, power: none, leather: none, pads: none, pillows: null, adjustable: null, powerBasePercent: null, rugsQty: null, rugsDollars: null,
  };
  const row = line ?? empty;
  const sales = row.sales ?? 0;
  return {
    sales,
    orders: orders(row),
    financed: row.finance === null ? (sales === 0 ? 0 : null) : row.finance * sales,
    bedding: row.beddingDollars ?? 0,
    fabric: counted(row.fabric),
    power: counted(row.power),
    leather: counted(row.leather),
    pads: counted(row.pads),
    pillows: asl ? counted(asl.pillows) : null,
    bases: asl ? counted(asl.adjustable) : null,
    rugs: asl ? asl.rugsQty ?? 0 : null,
    rugDollars: asl ? asl.rugsDollars ?? 0 : null,
  };
}

function combine(left: Totals, right: Totals): Totals {
  return {
    sales: round(left.sales + right.sales, 2),
    orders: left.orders === null || right.orders === null ? null : left.orders + right.orders,
    financed: left.financed === null || right.financed === null ? null : left.financed + right.financed,
    bedding: round(left.bedding + right.bedding, 2),
    fabric: addCounted(left.fabric, right.fabric),
    power: addCounted(left.power, right.power),
    leather: addCounted(left.leather, right.leather),
    pads: addCounted(left.pads, right.pads),
    pillows: left.pillows && right.pillows ? addCounted(left.pillows, right.pillows) : null,
    bases: left.bases && right.bases ? addCounted(left.bases, right.bases) : null,
    rugs: left.rugs === null || right.rugs === null ? null : left.rugs + right.rugs,
    rugDollars: left.rugDollars === null || right.rugDollars === null ? null : round(left.rugDollars + right.rugDollars, 2),
  };
}

function parseFile(file: string, name: string): KpiReport {
  return parseKpiWorkbook(readFileSync(file), name);
}

function personKey(name: string): string {
  const key = name.trim().toUpperCase().replace(/\s+/g, ' ');
  const found = employees.find((person) => person.displayName.toUpperCase() === key || person.nameAliases.some((alias) => alias.toUpperCase() === key));
  return found ? found.displayName : name.trim().replace(/\s+/g, ' ');
}

function personCode(display: string): string {
  return employees.find((person) => person.displayName === display)?.code ?? '';
}

function derivedRecords(scope: 'STORE' | 'PERSON', side: Side, start: string, through: string, who: { code: string; name: string }, value: Totals, source: string): LedgerRecord[] {
  const common = {
    grain: 'cumulative' as const, reportDate: '', periodStart: start, periodEnd: through, verifiedThrough: through,
    store: '17', employeeCode: who.code, employeeName: who.name, side, sourceReport: source,
  };
  const out: LedgerRecord[] = [
    makeRecord({ ...common, view: `BEDDING_${scope}`, salesDollars: value.bedding, unitCount: null, eligible: null, attachments: null, kpiPercent: rate(value.bedding, value.sales) ?? 0 }),
  ];
  const qty: [string, Counted | null][] = [
    [`FABW_${scope}`, value.fabric], [`PWAR_${scope}`, value.power], [`LTHW_${scope}`, value.leather], [`MPPA_${scope}`, value.pads],
    [`PILLOWS_${scope}`, value.pillows], [`BASES_${scope}`, value.bases],
  ];
  qty.forEach(([view, metric]) => {
    if (!metric) return;
    out.push(makeRecord({ ...common, view, salesDollars: metric.dollars, unitCount: metric.sold, eligible: metric.qual, attachments: metric.sold, kpiPercent: 0 }));
  });
  if (value.financed !== null) {
    out.push(makeRecord({ ...common, view: `FINANCE_${scope}`, salesDollars: null, unitCount: null, eligible: null, attachments: null, kpiPercent: rate(value.financed, value.sales) ?? 0 }));
  }
  if (value.orders !== null && value.orders !== 0) {
    out.push(makeRecord({ ...common, view: `AVERAGE_${scope}`, salesDollars: round(value.sales / value.orders, 2), unitCount: value.orders, eligible: null, attachments: null, kpiPercent: null }));
  }
  if (value.rugs !== null) {
    out.push(makeRecord({ ...common, view: `RUGS_${scope}`, salesDollars: value.rugDollars, unitCount: value.rugs, eligible: null, attachments: value.rugs, kpiPercent: null }));
  }
  return out;
}

function ledgerRow(record: LedgerRecord, importedAt: string): Cell[] {
  const cell = (value: number | null): Cell => (value === null ? '' : value);
  return [
    record.view, record.grain, record.reportDate, record.periodStart, record.periodEnd, record.verifiedThrough,
    record.store, record.employeeCode, record.employeeName, record.side,
    cell(record.salesDollars), cell(record.unitCount), cell(record.eligible), cell(record.attachments),
    cell(record.kpiPercent), record.sourceReport, importedAt, record.recordKey,
  ];
}

function fromRow(row: Cell[]): LedgerRecord {
  const num = (value: Cell | undefined): number | null => (value === '' || value === undefined ? null : Number(value));
  const side = String(row[9] ?? '');
  const record: LedgerRecord = {
    view: String(row[0] ?? ''),
    grain: String(row[1] ?? '') === 'daily' ? 'daily' : 'cumulative',
    reportDate: String(row[2] ?? ''),
    periodStart: String(row[3] ?? ''),
    periodEnd: String(row[4] ?? ''),
    verifiedThrough: String(row[5] ?? ''),
    store: String(row[6] ?? ''),
    employeeCode: String(row[7] ?? ''),
    employeeName: String(row[8] ?? ''),
    side: side === 'written' || side === 'delivered' ? side : '',
    salesDollars: num(row[10]),
    unitCount: num(row[11]),
    eligible: num(row[12]),
    attachments: num(row[13]),
    kpiPercent: num(row[14]),
    sourceReport: String(row[15] ?? ''),
    recordKey: String(row[17] ?? ''),
  };
  return record;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const files = args.filter((arg) => arg !== '--dry');
  if (!files.length || files.length % 4 !== 0) throw new Error('Pass four daily files for each day: 17 written, 17 delivered, ASL written, ASL delivered.');

  const allDays: DayFile[] = files.map((file) => {
    const bytes = readFileSync(file);
    const name = canonicalName(file);
    return { file, name, sha256: createHash('sha256').update(bytes).digest('hex'), report: parseKpiWorkbook(bytes, name) };
  });
  allDays.forEach((item) => {
    if (item.report.start !== item.report.end) throw new Error(`${item.name} covers ${item.report.start} through ${item.report.end}. Only daily files are imported here.`);
  });
  const dates = [...new Set(allDays.map((item) => item.report.start))].sort();
  const date = dates[dates.length - 1] ?? '';
  const cutoff = shiftDate(dates[0] ?? '', -1);
  // The to-date snapshot plus every day after it, so each day must be present once and in order.
  dates.forEach((value, index) => {
    if (index && value !== shiftDate(dates[index - 1], 1)) throw new Error(`Day files skip from ${dates[index - 1]} to ${value}. Pass every day after the snapshot.`);
  });
  const personCutoff = /_(\d{4}-\d{2}-\d{2})\.xlsx$/.exec(PERSON_BASE.written)?.[1] ?? '';
  if (personCutoff !== cutoff) throw new Error(`The salesperson snapshot ends ${personCutoff}, so the first day file must be ${shiftDate(personCutoff, 1)}, not ${dates[0]}.`);
  const findOn = (onDate: string, family: 'group17' | 'asl', side: Side): DayFile => {
    const found = allDays.filter((item) => item.report.start === onDate && item.report.family === family && item.report.side === side);
    if (found.length !== 1) throw new Error(`${found.length ? 'Two' : 'Missing the'} ${family === 'asl' ? 'ASL' : '17'} ${side} file${found.length ? 's' : ''} for ${onDate}.`);
    return found[0];
  };

  loadDotEnv(process.cwd());
  const config = loadConfig(process.cwd());
  const spreadsheetId = readStored(config.tokenPath).spreadsheetId;
  if (!spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
  const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const read = async (range: string): Promise<Cell[][]> => {
    const payload = await googleJson({ accessToken: token, url: `${base}/values/${encodeURIComponent(range)}` }) as { values?: Cell[][] };
    return payload.values ?? [];
  };

  const daily = await read('CC_Daily!A1:D60');
  const rollupBefore = await read('CC_Rollup!A1:C20');
  const nwdsr = (side: Side, from: string, to: string): number => daily.slice(1).reduce((sum, row) => {
    const rowDate = String(row[0] ?? '').slice(0, 10);
    const value = row[side === 'written' ? 2 : 3];
    if (rowDate < from || rowDate > to || value === '' || value === undefined) return sum;
    return sum + Number(value);
  }, 0);

  const checks: string[] = [];
  const store: Record<Side, Totals> = {} as Record<Side, Totals>;
  const storeSource: Record<Side, string> = {} as Record<Side, string>;
  for (const side of ['written', 'delivered'] as Side[]) {
    const baseG17 = parseFile(path.join(BASELINE, STORE_BASE.group17[side]), STORE_BASE.group17[side]);
    const baseAsl = parseFile(path.join(BASELINE, STORE_BASE.asl[side]), STORE_BASE.asl[side]);
    const before = nwdsr(side, STORE_START, cutoff);
    const baseSales = baseG17.store?.sales ?? null;
    if (baseSales === null || Math.abs(baseSales - before) > 1) {
      throw new Error(`${baseG17.filename} sales ${baseSales} are not NWDSR ${side} through ${cutoff} (${before}). The days would overlap the snapshot, so nothing was combined.`);
    }
    checks.push(`${side}: ${baseG17.filename} sales ${baseSales} equal CC_Daily NWDSR ${STORE_START} through ${cutoff} (${before}), so ${dates.join(', ')} are not already inside it.`);
    let running = totals(baseG17.store, baseAsl.lines.find((line) => line.name === '17') ?? null);
    const sources = [baseG17.filename, baseAsl.filename];
    for (const onDate of dates) {
      const g17 = findOn(onDate, 'group17', side).report;
      const asl = findOn(onDate, 'asl', side).report;
      const dayStore = g17.store;
      const dayNwdsr = nwdsr(side, onDate, onDate);
      if (!dayStore || dayStore.sales === null || Math.abs(dayStore.sales - dayNwdsr) > 1) {
        throw new Error(`${g17.filename} Store 17 sales ${dayStore?.sales} do not match CC_Daily NWDSR ${side} ${dayNwdsr} for ${onDate}.`);
      }
      checks.push(`${side} ${onDate}: Group 17 TOTAL sales ${dayStore.sales} matches CC_Daily NWDSR ${dayNwdsr}.`);
      running = combine(running, totals(dayStore, asl.lines.find((line) => line.name === '17') ?? null));
      sources.push(g17.filename, asl.filename);
    }
    store[side] = running;
    storeSource[side] = sources.join(' + ');
  }

  const importedAt = new Date().toISOString();
  const incoming: LedgerRecord[] = [];
  allDays.forEach((item) => incoming.push(...recordsFromKpi(item.report, item.report.start)));
  (['written', 'delivered'] as Side[]).forEach((side) => {
    incoming.push(...derivedRecords('STORE', side, STORE_START, date, { code: '', name: '' }, store[side], storeSource[side]));
  });

  const people: { side: Side; name: string; value: Totals; source: string }[] = [];
  (['written', 'delivered'] as Side[]).forEach((side) => {
    const dayReports = dates.map((onDate) => findOn(onDate, 'group17', side).report);
    const basePeople = parseFile(path.join(BASELINE, PERSON_BASE[side]), PERSON_BASE[side]);
    const names = new Set<string>();
    [...basePeople.lines, ...dayReports.flatMap((report) => report.lines)].forEach((line) => {
      if (line.name.toUpperCase() === 'TOTAL') return;
      names.add(personKey(line.name));
    });
    names.forEach((name) => {
      const lineFor = (report: KpiReport) => report.lines.find((line) => line.name.toUpperCase() !== 'TOTAL' && personKey(line.name) === name) ?? null;
      const value = dayReports.reduce((sum, report) => combine(sum, totals(lineFor(report), null)), totals(lineFor(basePeople), null));
      const source = [basePeople.filename, ...dayReports.map((report) => report.filename)].join(' + ');
      people.push({ side, name, value, source });
      incoming.push(...derivedRecords('PERSON', side, PERSON_START, date, { code: personCode(name), name }, value, source));
    });
  });

  const ledgerValues = await read('CC_Ledger!A1:R5000');
  if (ledgerValues.length && String(ledgerValues[0]?.[17] ?? '') !== 'record_key') throw new Error('CC_Ledger headers are not the expected layout. Nothing was written.');
  const existing = ledgerValues.slice(1).filter((row) => row[17]).map(fromRow);
  const rowByKey = new Map<string, number>();
  ledgerValues.forEach((row, index) => { if (index > 0 && row[17]) rowByKey.set(String(row[17]), index + 1); });
  const applied = applyRecords(existing, incoming);
  const heldBack = heldBackDays(existing, incoming);
  const appliedByKey = new Map(applied.map((record) => [record.recordKey, record]));
  const existingByKey = new Map(existing.map((record) => [record.recordKey, record]));
  const updates: { range: string; values: Cell[][] }[] = [];
  const appends: Cell[][] = [];
  const replaced: Cell[][] = [];
  const seen = new Set<string>();
  incoming.forEach((record) => {
    if (seen.has(record.recordKey)) throw new Error(`Two incoming rows share ${record.recordKey}.`);
    seen.add(record.recordKey);
    const kept = appliedByKey.get(record.recordKey);
    const prior = existingByKey.get(record.recordKey);
    if (!kept || kept === prior) return;
    const row = rowByKey.get(record.recordKey);
    if (row) {
      replaced.push(historyRow({ at: importedAt, tab: 'CC_Ledger', key: record.recordKey, replacedBy: kept.sourceReport, previous: ledgerValues[row - 1] ?? [] }));
      updates.push({ range: `CC_Ledger!A${row}:R${row}`, values: [ledgerRow(kept, importedAt)] });
    } else appends.push(ledgerRow(kept, importedAt));
  });
  heldBack.forEach((record) => {
    const row = rowByKey.get(record.recordKey);
    replaced.push(historyRow({
      at: importedAt, tab: 'CC_Ledger', key: record.recordKey, replacedBy: `not applied: ${record.sourceReport}`, previous: row ? ledgerValues[row - 1] ?? [] : [],
      reason: `${HELD_BACK} Later figures: ${JSON.stringify(ledgerRow(record, importedAt).slice(10, 15))}.`,
    }));
  });

  const kpi = await read('CC_Kpi!A1:G60');
  const kpiHeader = (kpi[0] ?? []).map(String);
  if (kpiHeader[0] !== 'metric') throw new Error('CC_Kpi headers are not the expected layout. Nothing was written.');
  const w = store.written;
  const d = store.delivered;
  const pct = (top: number, bottom: number): number => rate(top, bottom) ?? 0;
  const countNote = (label: string, left: Counted | null, right: Counted | null): string =>
    `${label}. Written ${left?.sold ?? 0} of ${left?.qual ?? 0}, delivered ${right?.sold ?? 0} of ${right?.qual ?? 0}.`;
  const through = `${STORE_START} through ${cutoff} snapshot plus the ${dates.length > 1 ? `${dates[0]} through ${date} daily files` : `${date} daily file`}`;
  const kpiRows: [string, number | null, number | null, string][] = [
    ['Bedding', pct(w.bedding, w.sales), pct(d.bedding, d.sales), `Bedding dollars ÷ sales, ${through}. Written ${w.bedding} of ${w.sales}, delivered ${d.bedding} of ${d.sales}.`],
    ['Adjustable Base Attachment', w.bases ? pct(w.bases.sold, w.bases.qual) : null, d.bases ? pct(d.bases.sold, d.bases.qual) : null, countNote(`ASL Store 17 ADJ, ${through}`, w.bases, d.bases)],
    ['Pillows', w.pillows ? pct(w.pillows.sold, w.pillows.qual) : null, d.pillows ? pct(d.pillows.sold, d.pillows.qual) : null, countNote(`ASL Store 17 Pillows, ${through}`, w.pillows, d.pillows)],
    ['Mattress Protectors', pct(w.pads.sold, w.pads.qual), pct(d.pads.sold, d.pads.qual), countNote(`Mattress Pads, ${through}`, w.pads, d.pads)],
    ['Fabric Maintenance', pct(w.fabric.sold, w.fabric.qual), pct(d.fabric.sold, d.fabric.qual), countNote(`Fabric, ${through}`, w.fabric, d.fabric)],
    ['Leather Maintenance', pct(w.leather.sold, w.leather.qual), pct(d.leather.sold, d.leather.qual), countNote(`Leather, ${through}`, w.leather, d.leather)],
    ['Power Upholstery', pct(w.power.sold, w.power.qual), pct(d.power.sold, d.power.qual), countNote(`Power furniture, ${through}`, w.power, d.power)],
    ['Finance', w.financed === null ? null : pct(w.financed, w.sales), d.financed === null ? null : pct(d.financed, d.sales), `Financed dollars ÷ sales, ${through}. Financed dollars are each report's FIN % × its sales.`],
    ['Average Ticket', w.orders ? round(w.sales / w.orders, 2) : null, d.orders ? round(d.sales / d.orders, 2) : null, `Sales ÷ orders, ${through}. Written ${w.sales} ÷ ${w.orders}, delivered ${d.sales} ÷ ${d.orders}.`],
    ['Rugs', w.rugs, d.rugs, `ASL Store 17 rugs sold, ${through}.`],
  ];
  const kpiUpdates: { range: string; values: Cell[][] }[] = [];
  const kpiAppends: Cell[][] = [];
  if (kpiHeader[6] !== 'verified_through') kpiUpdates.push({ range: 'CC_Kpi!G1', values: [['verified_through']] });
  kpiRows.forEach(([metric, written, delivered, note]) => {
    const index = kpi.findIndex((row, i) => i > 0 && String(row[0]) === metric && String(row[4] ?? '') === STORE_START && String(row[5] ?? '') === STORE_END);
    const values: Cell[] = [metric, written ?? '', delivered ?? '', note, STORE_START, STORE_END, date];
    if (index < 0) kpiAppends.push(values);
    else if (JSON.stringify(kpi[index]?.map(String)) !== JSON.stringify(values.map(String))) {
      replaced.push(historyRow({ at: importedAt, tab: 'CC_Kpi', key: `${metric}|${STORE_START}|${STORE_END}`, replacedBy: `snapshot through ${date}`, previous: kpi[index] ?? [], reason: 'A newer store-period snapshot replaced this row.' }));
      kpiUpdates.push({ range: `CC_Kpi!A${index + 1}:G${index + 1}`, values: [values] });
    }
  });
  const dayBedding = (onDate: string, side: Side): number => findOn(onDate, 'group17', side).report.store?.beddingPercent ?? 0;
  const dailyBedding = dates.map((onDate) => {
    const values: Cell[] = ['Daily Bedding', dayBedding(onDate, 'written'), dayBedding(onDate, 'delivered'), `Group 17 TOTAL bedding dollars ÷ sales for ${onDate} only.`, onDate, onDate, onDate];
    const index = kpi.findIndex((row, i) => i > 0 && String(row[0]) === 'Daily Bedding' && String(row[4] ?? '') === onDate);
    if (index < 0) kpiAppends.push(values);
    else if (Number(kpi[index]?.[1]) !== values[1] || Number(kpi[index]?.[2]) !== values[2]) {
      replaced.push(historyRow({ at: importedAt, tab: 'CC_Kpi', key: `Daily Bedding|${onDate}`, replacedBy: 'not applied', previous: kpi[index] ?? [], reason: `${HELD_BACK} Later figures: ${values[1]} written, ${values[2]} delivered.` }));
    }
    return { date: onDate, written: values[1], delivered: values[2] };
  });

  const imports = await read('CC_Imports!A1:F1000');
  const known = new Set(imports.slice(1).map((row) => String(row[0] ?? '')));
  const importAppends: Cell[][] = [];
  const fileStatus = allDays.map((item) => {
    const already = known.has(item.sha256);
    const label = `Data Analysis KPI ${item.report.family === 'asl' ? 'ASL' : '17'} ${item.report.side === 'written' ? 'Written' : 'Delivered'}`;
    const scope = item.report.family === 'asl' ? 'Only the Store 17 row was used (pillows, adjustable bases, rugs).' : 'Store 17 TOTAL and every salesperson line were used.';
    if (!already) {
      importAppends.push([item.sha256, item.name, label, 'imported', importedAt, `Daily report ${item.report.start}. ${scope} Saved to CC_Ledger and CC_Kpi. CC_Daily and CC_Rollup were not changed.`]);
    }
    return { file: item.name, uploadedAs: path.basename(item.file), reportDate: item.report.start, type: label, sha256: item.sha256, status: already ? 'already imported (skipped)' : 'imported' };
  });

  const summary = {
    date,
    dry,
    checks,
    files: fileStatus,
    ledger: { existingRows: existing.length, incoming: incoming.length, updated: updates.length, appended: appends.length, heldBack: heldBack.map((record) => record.recordKey), unchanged: incoming.length - updates.length - appends.length - heldBack.length },
    history: replaced.length,
    kpi: { updated: kpiUpdates.length, appended: kpiAppends.length },
    importsAppended: importAppends.length,
    store: { written: w, delivered: d },
    kpiRows: kpiRows.map(([metric, written, delivered]) => ({ metric, written, delivered })),
    dailyBedding,
    people: people.map((item) => ({
      side: item.side, name: item.name, sales: item.value.sales, bedding: rate(item.value.bedding, item.value.sales),
      fabric: `${item.value.fabric.sold}/${item.value.fabric.qual}`, power: `${item.value.power.sold}/${item.value.power.qual}`,
      leather: `${item.value.leather.sold}/${item.value.leather.qual}`, pads: `${item.value.pads.sold}/${item.value.pads.qual}`,
      finance: item.value.financed === null ? null : rate(item.value.financed, item.value.sales),
      average: item.value.orders ? round(item.value.sales / item.value.orders, 2) : null, orders: item.value.orders,
    })),
  };
  if (!dry) {
    await appendHistory(token, spreadsheetId, replaced);
    const data = [...updates, ...kpiUpdates];
    if (data.length) await googleJson({ accessToken: token, method: 'POST', url: `${base}/values:batchUpdate`, body: { valueInputOption: 'RAW', data } });
    const append = async (range: string, values: Cell[][]): Promise<void> => {
      if (!values.length) return;
      await googleJson({ accessToken: token, method: 'POST', url: `${base}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, body: { values } });
    };
    if (!ledgerValues.length) await append('CC_Ledger!A1', [LEDGER_HEADERS]);
    await append('CC_Ledger!A1', appends);
    await append('CC_Kpi!A1', kpiAppends);
    await append('CC_Imports!A1', importAppends);
    const rollupAfter = await read('CC_Rollup!A1:C20');
    const dailyAfter = await read('CC_Daily!A1:D60');
    Object.assign(summary, {
      rollupUnchanged: JSON.stringify(rollupBefore) === JSON.stringify(rollupAfter),
      dailyUnchanged: JSON.stringify(daily) === JSON.stringify(dailyAfter),
    });
  }
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The KPI import failed.');
  process.exit(1);
});
