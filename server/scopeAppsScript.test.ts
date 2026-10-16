import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fitsTrack } from '../src/domain/reportingCalendar.ts';

type Grid = (string | number)[][];

const LEDGER_HEAD = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
const CLOSING_HEAD = ['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through', 'store'];
const KPI_HEAD = ['metric', 'written', 'delivered', 'note', 'period_start', 'period_end', 'verified_through'];
const PERQ = 'PERQ Ups + Be Backs';

function ledger(view: string, grain: string, start: string, end: string, through: string, side: string, dollars: number | string, name = '', eligible: number | string = ''): (string | number)[] {
  return [view, grain, '', start, end, through, '17', '', name, side, dollars, '', eligible, '', '', 'file.xlsx', '2026-10-15T00:00:00.000Z', [view, grain, '', start, end, side, name || 'STORE'].join('|')];
}

/** An in-memory spreadsheet that records writes, so overwrite and archive paths can be checked. */
function workbook(tabs: Record<string, Grid>) {
  const sheet = (name: string) => ({
    getDataRange: () => ({ getValues: () => tabs[name].map((row) => [...row]) }),
    getRange: (row: number, column: number, rows = 1, columns = 1) => ({
      setValues: (values: Grid) => values.forEach((line, r) => line.forEach((cell, c) => {
        while (tabs[name].length < row + r) tabs[name].push([]);
        tabs[name][row - 1 + r][column - 1 + c] = cell;
      })),
      setValue: (value: string | number) => { tabs[name][row - 1][column - 1] = value; },
      getValue: () => tabs[name][row - 1]?.[column - 1] ?? '',
      rows,
      columns,
    }),
    appendRow: (row: (string | number)[]) => { tabs[name].push([...row]); },
    getLastRow: () => tabs[name].length,
  });
  return {
    getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null),
    insertSheet: (name: string) => { tabs[name] = []; return sheet(name); },
  };
}

function load(tabs: Record<string, Grid>, today: string) {
  const book = workbook(tabs);
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'yes', setProperty: () => undefined }) },
    SpreadsheetApp: { openById: () => book },
  };
  vm.createContext(sandbox);
  for (const file of ['Data.gs', 'Ledger.gs', 'KpiImport.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox);
  vm.runInContext(`todayNy_ = function () { return '${today}'; }; appendException_ = function () {};`, sandbox);
  return sandbox as Record<string, (...args: unknown[]) => any>;
}

/** Values from the script context have that context's prototypes. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

test('the Apps Script track rule matches the reporting calendar', () => {
  const gs = load({}, '2026-10-16');
  const ranges: [string, string][] = [
    ['2026-10-02', '2026-10-14'], ['2026-10-02', '2026-11-01'], ['2026-10-01', '2026-10-13'], ['2026-10-01', '2026-10-31'],
    ['2026-10-01', '2026-11-01'], ['2026-10-02', '2026-11-02'], ['2026-10-03', '2026-10-14'], ['2026-10-14', '2026-10-14'],
    ['2026-12-02', '2027-01-01'], ['2026-10-14', '2026-10-13'], ['', '2026-10-13'],
  ];
  for (const [start, end] of ranges) {
    assert.equal(gs.fitsTrack_('STORE', start, end), fitsTrack('store', start, end), `STORE ${start}..${end}`);
    assert.equal(gs.fitsTrack_('PERSON', start, end), fitsTrack('individual', start, end), `PERSON ${start}..${end}`);
  }
  assert.equal(gs.fitsTrack_('', '2026-10-14', '2026-10-14'), false);
  assert.equal(gs.viewScope_('BEDDING_STORE'), 'STORE');
  assert.equal(gs.viewScope_('BEDDING_PERSON'), 'PERSON');
  assert.equal(gs.viewScope_('CC_Kpi'), '');
});

test('a STORE or PERSON lookup never falls back to a record from the other track', () => {
  const gs = load({
    CC_Ledger: [
      LEDGER_HEAD,
      ledger('BEDDING_STORE', 'cumulative', '2026-10-01', '2026-10-13', '2026-10-13', 'written', 21000),
      ledger('BEDDING_PERSON', 'cumulative', '2026-10-02', '2026-11-01', '2026-10-13', 'written', 900, 'Ricky Nassif'),
    ],
  }, '2026-10-16');
  assert.equal(gs.latestStoreLedger_('BEDDING_STORE', 'written', '2026-10-02'), null);
  assert.equal(gs.latestStoreLedger_('BEDDING_STORE', 'written', '2026-10-01'), null);
  assert.equal(gs.latestPersonLedger_('BEDDING_PERSON', 'written', 'Ricky Nassif', '2026-10-01'), null);
  assert.equal(gs.latestPersonLedger_('BEDDING_PERSON', 'written', 'Ricky Nassif', '2026-10-02'), null);
  assert.equal(gs.storeBeddingLedger_('written', '2026-10-01'), null);
  const rows = gs.ledgerRows_();
  assert.deepEqual(plain(rows.map((row: { scope: string; fitsTrack: boolean }) => [row.scope, row.fitsTrack])), [['STORE', false], ['PERSON', false]]);
});

test('a STORE lookup takes the latest store-month snapshot and a PERSON lookup the latest individual-month one', () => {
  const gs = load({
    CC_Ledger: [
      LEDGER_HEAD,
      ledger('BEDDING_STORE', 'cumulative', '2026-10-02', '2026-11-01', '2026-10-13', 'written', 21819.51),
      ledger('BEDDING_STORE', 'cumulative', '2026-10-02', '2026-10-14', '2026-10-14', 'written', 21819.51),
      ledger('BEDDING_STORE', 'cumulative', '2026-10-01', '2026-10-14', '2026-10-14', 'written', 25000),
      ledger('BEDDING_PERSON', 'cumulative', '2026-10-01', '2026-10-14', '2026-10-14', 'written', 1200, 'Ricky Nassif'),
      ledger('BEDDING_PERSON', 'cumulative', '2026-10-02', '2026-11-01', '2026-10-14', 'written', 1500, 'Ricky Nassif'),
    ],
  }, '2026-10-16');
  const store = gs.latestStoreLedger_('BEDDING_STORE', 'written', '2026-10-02');
  assert.equal(store.periodStart, '2026-10-02');
  assert.equal(store.verifiedThrough, '2026-10-14');
  assert.equal(store.sales, 21819.51);
  const person = gs.latestPersonLedger_('BEDDING_PERSON', 'written', 'Ricky Nassif', '2026-10-01');
  assert.equal(person.periodStart, '2026-10-01');
  assert.equal(person.sales, 1200);
});

test('closing counts read only rows whose dates fit their scope', () => {
  const gs = load({
    CC_Closing: [
      CLOSING_HEAD,
      ['2026-10-13', 'person', 'TNASSI', 'Ricky Nassif', '', 32, '2026-10-01', '2026-10-31', PERQ, 'yes', '', '2026-10-13', '17'],
      ['2026-10-13', 'person', 'EMON0904', 'Eric Montes Rodriguez', '', 30, '2026-10-02', '2026-10-31', PERQ, 'yes', '', '2026-10-13', '17'],
      ['2026-10-13', 'store', '', '', '', 100, '2026-10-02', '2026-10-31', PERQ, 'yes', '', '2026-10-13', '17'],
      ['2026-10-13', 'store', '', '', '', 104, '2026-10-01', '2026-10-31', PERQ, 'yes', '', '2026-10-13', '17'],
    ],
    CC_Ledger: [
      LEDGER_HEAD,
      ledger('PERQ_PERSON', 'cumulative', '2026-10-02', '2026-10-31', '2026-10-13', '', '', 'Prakash Gandhi', 28),
      ledger('PERQ_PERSON', 'cumulative', '2026-10-01', '2026-10-31', '2026-10-13', '', '', 'Renzo Del Solar', 7),
      ledger('PERQ_STORE', 'cumulative', '2026-10-01', '2026-11-01', '2026-10-13', '', '', '', 99),
    ],
  }, '2026-10-16');
  const facts = plain(gs.loadClosing_()).map((fact: { scope: string; name: string; start: string; end: string; opportunities: number }) => [fact.scope, fact.name, fact.start, fact.end, fact.opportunities]);
  assert.deepEqual(facts, [
    ['person', 'Ricky Nassif', '2026-10-01', '2026-10-31', 32],
    ['store', '', '2026-10-02', '2026-10-31', 100],
    ['person', 'Renzo Del Solar', '2026-10-01', '2026-10-31', 7],
  ]);
});

test('store KPI figures come only from rows for the current store month', () => {
  const tabs = {
    CC_Kpi: [
      KPI_HEAD,
      ['Bedding', 0.201, 0.126, 'store month', '2026-10-02', '2026-11-01', '2026-10-14'],
      ['Pillows', 0.5, 0.5, 'individual month', '2026-10-01', '2026-10-31', '2026-10-14'],
      ['Daily Bedding', 0, -0.057, 'one day', '2026-10-14', '2026-10-14', '2026-10-14'],
    ],
  };
  const october = load(tabs, '2026-10-16').readKpiActuals_();
  assert.deepEqual(plain(Object.keys(october)), ['Bedding']);
  assert.equal(october.Bedding.written, 0.201);
  assert.equal(october.Bedding.through, '2026-10-14');
  assert.equal(load(tabs, '2026-11-01').readKpiActuals_().Bedding.written, 0.201);
  assert.deepEqual(plain(load(tabs, '2026-11-02').readKpiActuals_()), {}, 'October figures are not shown for the November store month');
});

test('salesperson SNAP dates with no report on file are Pending, not zero', () => {
  const gs = load({
    CC_AssociateDays: [['date', 'source_name'], ['2026-10-02', 'Ricky'], ['2026-10-03', 'Ricky'], ['2026-10-05', 'Ricky']],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-04', 0, 0, 0]],
    CC_SellingDays: [['date', 'selling']],
  }, '2026-10-16');
  assert.deepEqual(plain(gs.snapPendingDates_('2026-10-01', '2026-10-31', '2026-10-05')), ['2026-10-01']);
  const closed = load({
    CC_AssociateDays: [['date', 'source_name'], ['2026-10-02', 'Ricky']],
    CC_Daily: [['date', 'snap_written']],
    CC_SellingDays: [['date', 'selling'], ['2026-10-01', 'NO']],
  }, '2026-10-16');
  assert.deepEqual(plain(closed.snapPendingDates_('2026-10-01', '2026-10-31', '2026-10-02')), []);
});

test('a corrected report keeps the replaced row in CC_History and an identical re-import writes nothing', () => {
  const original = ledger('BEDDING_STORE', 'daily', '2026-10-14', '2026-10-14', '2026-10-14', 'written', 100);
  const tabs: Record<string, Grid> = { CC_Ledger: [LEDGER_HEAD, [...original]] };
  const gs = load(tabs, '2026-10-16');
  gs.upsertKpiRecords_([[...original]]);
  assert.equal('CC_History' in tabs, false, 'an identical re-import archives nothing');
  const corrected = [...original];
  corrected[10] = 80;
  corrected[15] = 'corrected.xlsx';
  gs.upsertKpiRecords_([corrected]);
  assert.equal(tabs.CC_Ledger.length, 2);
  assert.equal(tabs.CC_Ledger[1][10], 80);
  assert.deepEqual(tabs.CC_History[0], ['archived_at', 'tab', 'record_key', 'reason', 'replaced_by', 'previous_row']);
  assert.equal(tabs.CC_History.length, 2);
  assert.deepEqual(tabs.CC_History[1].slice(1, 5), ['CC_Ledger', original[17], 'Corrected report replaced this row.', 'corrected.xlsx']);
  assert.equal(JSON.parse(String(tabs.CC_History[1][5]))[10], 100);

  const dailyKey = ['NWDSR_WRITTEN_STORE', 'daily', '2026-10-14', '2026-10-14', '2026-10-14', 'written', 'STORE'].join('|');
  tabs.CC_Ledger.push(['NWDSR_WRITTEN_STORE', 'daily', '2026-10-14', '2026-10-14', '2026-10-14', '2026-10-14', '17', '', '', 'written', 500, '', '', '', '', 'first.pdf', '', dailyKey]);
  gs.upsertLedgerDaily_('NWDSR_WRITTEN_STORE', 'written', '2026-10-14', 500, 'again.pdf');
  assert.equal(tabs.CC_History.length, 2);
  gs.upsertLedgerDaily_('NWDSR_WRITTEN_STORE', 'written', '2026-10-14', -120, 'cancellation.pdf');
  assert.equal(tabs.CC_History.length, 3);
  assert.equal(tabs.CC_History[2][2], dailyKey);
  assert.equal(tabs.CC_History[2][4], 'cancellation.pdf');
  assert.equal(JSON.parse(String(tabs.CC_History[2][5]))[10], 500);
  assert.equal(tabs.CC_Ledger.at(-1)![10], -120);
});
