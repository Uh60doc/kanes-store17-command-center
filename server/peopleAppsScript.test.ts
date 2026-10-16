import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Grid = (string | number)[][];

const LEDGER_HEAD = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
const SNAPSHOT = 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-01_2026-10-13.xlsx';
const DAY = (date: string) => `DATA_ANALYSIS_KPI_17_WRITTEN_${date}_${date}.xlsx`;

type Figures = { sales?: number; units?: number; eligible?: number; attachments?: number; percent?: number };
const row = (view: string, grain: string, start: string, end: string, code: string, name: string, figures: Figures, source: string, side = 'written') =>
  [view, grain, grain === 'daily' ? start : '', start, end, end, '17', code, name, side, figures.sales ?? '', figures.units ?? '', figures.eligible ?? '', figures.attachments ?? '', figures.percent ?? '', source, '', `${view}|${grain}|${start}|${end}|${code || 'STORE'}|${side}`];

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function load(tabs: Record<string, Grid>, today: string) {
  const sheet = (name: string) => ({ getDataRange: () => ({ getValues: () => tabs[name].map((line) => [...line]) }) });
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null) }) },
  };
  vm.createContext(sandbox);
  for (const file of ['Data.gs', 'Ledger.gs', 'KpiImport.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox);
  vm.runInContext(`todayNy_ = function () { return '${today}'; };`, sandbox);
  return sandbox as Record<string, (...args: unknown[]) => any>;
}

function october(): Record<string, Grid> {
  return {
    CC_Ledger: [
      LEDGER_HEAD,
      row('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 31794.47, units: 11 }, SNAPSHOT),
      row('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'TNASSI', 'Ricky Nassif', { sales: 16804.84, units: 8 }, SNAPSHOT),
      row('BEDDING_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 11018.52, percent: 0.347 }, SNAPSHOT),
      row('MPPA_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 29.99, units: 1, eligible: 3, attachments: 1 }, SNAPSHOT),
      row('FINANCE_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { percent: 0.5 }, SNAPSHOT),
      row('FINANCE_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'TNASSI', 'Ricky Nassif', { percent: 0.25 }, SNAPSHOT),
      row('MPPA_PERSON', 'cumulative', '2026-10-02', '2026-10-11', 'EMON0904', 'Eric Montes Rodriguez', { units: 1, eligible: 9, attachments: 1 }, 'MPPA_WRITTEN__10.pdf'),
      row('DA_SALES_PERSON', 'cumulative', '2026-10-02', '2026-11-01', 'EMON0904', 'Eric Montes Rodriguez', { sales: 99999, units: 50 }, 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-11-01.xlsx'),
      row('DA_SALES_STORE', 'daily', '2026-10-13', '2026-10-13', '', '', { sales: 7106, units: 4 }, DAY('2026-10-13')),
      row('DA_SALES_PERSON', 'daily', '2026-10-13', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 5000, units: 2 }, DAY('2026-10-13')),
      row('DA_SALES_STORE', 'daily', '2026-10-14', '2026-10-14', '', '', { sales: 2476, units: 2 }, DAY('2026-10-14')),
      row('DA_SALES_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', { sales: 2476, units: 2 }, DAY('2026-10-14')),
      row('FINANCE_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', { percent: 1 }, DAY('2026-10-14')),
      row('DA_SALES_STORE', 'daily', '2026-10-16', '2026-10-16', '', '', { sales: 900, units: 1 }, DAY('2026-10-16')),
      row('DA_SALES_PERSON', 'daily', '2026-10-16', '2026-10-16', 'TNASSI', 'Ricky Nassif', { sales: 900, units: 1 }, DAY('2026-10-16')),
    ],
    CC_AssociateDays: [['date', 'display_name', 'amount', 'note', 'role'], ['2026-10-14', 'Ricky Nassif', 2795, '', 'associate'], ['2026-10-14', 'Eric Montes Rodriguez', 410, '', 'associate']],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-14', 3205, 2476, 4113]],
  };
}

test('salesperson Data Analysis figures are the October 1 snapshot plus the following day files, with no overlap or gap', () => {
  const gs = load(october(), '2026-10-18');
  const context = gs.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' });
  assert.equal(context.written.snapshot, '2026-10-13');
  assert.deepEqual(plain(context.written.days), ['2026-10-14']);
  assert.equal(context.written.through, '2026-10-14');
  assert.equal(context.delivered.through, '');

  const eric = gs.personAnalysis_(context, 'Eric Montes Rodriguez').written;
  assert.equal(eric.sales, 31794.47, 'the October 13 day row is inside the snapshot and the October 2 store-track row is not used');
  assert.equal(eric.orders, 11);
  assert.equal(eric.bedding.value, 0.347);
  assert.equal(eric.pads.detail, '1 of 3', 'the store-track MPPA PDF is not added');
  assert.equal(eric.finance.value, 0.5);
  assert.equal(eric.average.value, 2890.41);

  const ricky = gs.personAnalysis_(context, 'Ricky Nassif').written;
  assert.equal(ricky.sales, 19280.84, 'October 16 is after the missing October 15 file and is not counted');
  assert.equal(ricky.orders, 10);
  assert.equal(ricky.finance.value, Math.round(((0.25 * 16804.84 + 2476) / 19280.84) * 1000) / 1000);
  assert.equal(ricky.basis, 'Group 17 salesperson report 2026-10-01 through 2026-10-13 plus the day files 2026-10-14');

  assert.equal(gs.personAnalysis_(context, 'Brenda Sanchez').written.sales, 0, 'a covered report without a line is 0');
  assert.equal(gs.personAnalysis_(context, 'Eric Montes Rodriguez').delivered, null, 'no delivered report is Pending, not zero');
});

test('the salesperson record uses SNAP for written and the goal, Data Analysis for the rest, and has no NWDSR fields', () => {
  const gs = load(october(), '2026-10-18');
  const context = gs.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' });
  const goals = gs.approvedGoals_({});
  const person = gs.personRecord_('Ricky Nassif', 2795, 'associate', [], goals, null, gs.personAnalysis_(context, 'Ricky Nassif'));
  assert.equal(person.snapWritten, 2795);
  assert.equal(person.written, 2795);
  assert.equal(person.monthlyGoal, 65000);
  assert.equal(person.analysisWritten, 19280.84);
  assert.equal(person.writtenOrders, 10);
  assert.equal(person.deliveredSales, null);
  assert.ok(!('nwdsrWritten' in person) && !('nwdsrDelivered' in person));
  const kpi = (name: string) => person.kpis.find((item: { name: string }) => item.name === name);
  assert.deepEqual(plain(person.kpis.map((item: { name: string }) => item.name)), ['Bedding', 'Mattress Pads', 'Adjustable Bases', 'Pillows', 'Fabric', 'Leather', 'Power', 'Financing', 'Average Ticket', 'Orders', 'Closing Ratio']);
  assert.equal(kpi('Adjustable Bases').writtenText, 'Not in report');
  assert.equal(kpi('Fabric').writtenText, 'No qualifying sales');
  assert.equal(kpi('Fabric').written, null);
  assert.equal(kpi('Average Ticket').written, 1928.08);
  assert.equal(kpi('Closing Ratio').written, null);
});

test('morning winners compare yesterday\'s SNAP Written line, and a missing SNAP report is Pending', () => {
  const gs = load(october(), '2026-10-15');
  const staffing = [
    { name: 'Ricky Nassif', role: 'associate', worked: true, onLeave: false },
    { name: 'Eric Montes Rodriguez', role: 'associate', worked: true, onLeave: false },
    { name: 'Prakash Gandhi', role: 'associate', worked: true, onLeave: false },
  ];
  const ready = gs.morningWinners_(staffing, 3000, gs.snapWrittenOn_('2026-10-14'));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.share, 1000);
  assert.deepEqual(plain(ready.people.map((item: { name: string; written: number }) => [item.name, item.written])), [['Ricky Nassif', 2795]]);
  const pending = gs.morningWinners_(staffing, 3000, gs.snapWrittenOn_('2026-10-12'));
  assert.equal(pending.status, 'pending');
  assert.match(pending.reason, /SNAP Written by salesperson is not on file/);
});

test('the mailbox import keeps Group 17 sales and orders for the store and each salesperson', () => {
  const gs = load(october(), '2026-10-15');
  const grid = [
    ['GROUP 17', 'WRITTEN ORDERS', '', ''],
    ['Sales Person', 'Sales', 'Avg Sales', 'Fin %'],
    ['TARIK NASSIF', 909.98, 909.98, 0],
    ['TOTAL', 1409.97, 704.99, 0],
  ];
  const sales = gs.kpiRecords_(grid, 'group17', 'written', '2026-10-15', '2026-10-15', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-15_2026-10-15.xlsx')
    .filter((record: unknown[]) => String(record[0]).startsWith('DA_SALES_'));
  assert.deepEqual(plain(sales.map((record: unknown[]) => [record[0], record[8], record[10], record[11], record[17]])), [
    ['DA_SALES_PERSON', 'Ricky Nassif', 909.98, 1, 'DA_SALES_PERSON|daily|2026-10-15|2026-10-15|2026-10-15|written|TNASSI'],
    ['DA_SALES_STORE', '', 1409.97, 2, 'DA_SALES_STORE|daily|2026-10-15|2026-10-15|2026-10-15|written|STORE'],
  ]);
});
