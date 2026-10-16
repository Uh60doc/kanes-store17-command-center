import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Grid = (string | number)[][];

const CLOSING_HEAD = ['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through'];
const NW = 'NWDSR Net Written # OF CUST';
const PERQ = 'PERQ Ups + Be Backs';
const LEDGER_HEAD = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];

function dailyCustomers(): Grid {
  const counts: [string, number][] = [
    ['2026-10-02', 2], ['2026-10-03', 6], ['2026-10-04', 5], ['2026-10-05', 2], ['2026-10-06', 3], ['2026-10-07', 2],
    ['2026-10-08', 2], ['2026-10-09', 5], ['2026-10-10', 9], ['2026-10-11', 6], ['2026-10-12', 4], ['2026-10-13', 4], ['2026-10-14', 2],
  ];
  return counts.map(([date, customers]) => [date, 'store', '', '', customers, '', date, date, NW, 'yes', '', date]);
}

function october(): Record<string, Grid> {
  return {
    CC_Config: [['key', 'value'], ['closing_goal', 0.5]],
    CC_SellingDays: [['date', 'selling']],
    CC_Closing: [
      CLOSING_HEAD,
      ...dailyCustomers(),
      ['2026-10-13', 'person', 'EMON0904', 'Eric Montes Rodriguez', '', 32, '2026-10-01', '2026-10-31', PERQ, 'yes', '', '2026-10-13'],
      ['2026-10-13', 'person', 'PGANDH', 'Prakash Gandhi', '', 31, '2026-10-01', '2026-10-31', PERQ, 'yes', '', '2026-10-13'],
      ['2026-10-13', 'person', 'TNASSI', 'Ricky Nassif', '', 32, '2026-10-01', '2026-10-31', PERQ, 'yes', '', '2026-10-13'],
      ['2026-10-13', 'person', 'RDELSO', 'Renzo Del Solar', '', 7, '2026-10-01', '2026-10-31', PERQ, 'yes', '', '2026-10-13'],
      ['2026-10-14', 'store', '', '', '', 4, '2026-10-14', '2026-10-14', PERQ, 'yes', ''],
      ['2026-10-14', 'person', 'RDELSO', 'Renzo Del Solar', '', 4, '2026-10-14', '2026-10-14', PERQ, 'yes', ''],
      ['2026-10-14', 'store', '', '', 52, '', '2026-10-02', '2026-10-14', NW, 'yes', '', '2026-10-14'],
      ['2026-10-13', 'store', '', '', '', 100, '2026-10-02', '2026-10-31', PERQ, 'yes', '', '2026-10-13'],
    ],
    CC_Ledger: [
      LEDGER_HEAD,
      ['PERQ_STORE', 'cumulative', '', '2026-10-02', '2026-10-31', '2026-10-13', '17', '', '', '', '', '', 100, '', '', 'perq-store17-2026-10-02-to-2026-10-31', '', 'a'],
      ['PERQ_STORE', 'cumulative', '', '2026-10-01', '2026-10-31', '2026-10-13', '17', '', '', '', '', '', 104, '', '', 'perq-store17-2026-10-01-to-2026-10-31', '', 'b'],
      ['PERQ_PERSON', 'cumulative', '', '2026-10-02', '2026-10-31', '2026-10-13', '17', '', 'Ricky Nassif', '', '', '', 28, '', '', 'perq-store17-2026-10-02-to-2026-10-31', '', 'c'],
    ],
  };
}

function load(tabs: Record<string, Grid>, today: string) {
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'yes', setProperty: () => undefined }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name: string) => (tabs[name] ? { getDataRange: () => ({ getValues: () => tabs[name] }) } : null),
      }),
    },
  };
  vm.createContext(sandbox);
  for (const file of ['Data.gs', 'Ledger.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox);
  vm.runInContext(`todayNy_ = function () { return '${today}'; }; appendException_ = function () {};`, sandbox);
  return sandbox as Record<string, (...args: unknown[]) => any>;
}

const STORE = { start: '2026-10-02', end: '2026-11-01' };

test('the closing goal is 50%, and exactly 50.0% is On Target', () => {
  const gs = load(october(), '2026-10-15');
  assert.equal(gs.closingGoal_({ closing_goal: 0.5 }), 0.5);
  assert.equal(gs.closingGoal_({}), 0.5);
  assert.equal(gs.versusGoal_(0.5, 0.5, false), 'On Target');
  assert.equal(gs.versusGoal_(0.499, 0.5, false), 'Below Goal');
  assert.equal(gs.versusGoal_(0.501, 0.5, false), 'Above Goal');
  assert.equal(gs.pointsFromGoal_(0.486, 0.5), -1.4);
  assert.equal(gs.pointsFromGoal_(0.5, 0.5), 0);
  assert.doesNotMatch(readFileSync(new URL('../apps-script/Data.gs', import.meta.url), 'utf8'), /closing_goal', 0\.4|set_40/);
});

test('October 2 through 14 is 52 ÷ 104 = 50.0% and October 14 is 2 ÷ 4 = 50.0%', () => {
  const gs = load(october(), '2026-10-15');
  const month = gs.storeMonthClosing_(gs.loadClosing_(), STORE, '2026-10-15', {}, 0.5);
  assert.equal(month.through, '2026-10-14');
  assert.equal(month.customers, 52);
  assert.equal(month.opportunities, 104);
  assert.equal(month.ratio, 0.5);
  assert.equal(month.versusGoal, 'On Target');
  assert.equal(month.points, 0);
  assert.match(month.customerSource, /52 for 2026-10-02 through 2026-10-14/);
  assert.match(month.opportunitySource, /100 for 2026-10-02 through 2026-10-13 plus daily 2026-10-14 4/);
  assert.deepEqual(
    { date: month.latest.date, customers: month.latest.customers, opportunities: month.latest.opportunities, ratio: month.latest.ratio, status: month.latest.status },
    { date: '2026-10-14', customers: 2, opportunities: 4, ratio: 0.5, status: 'On Target' },
  );
  const oct13 = month.trend.find((day: { date: string }) => day.date === '2026-10-13');
  assert.equal(oct13.ratio, null);
  assert.equal(oct13.status, 'Pending: PERQ');
  assert.equal(oct13.mtdRatio, 0.5);
  const oct05 = month.trend.find((day: { date: string }) => day.date === '2026-10-05');
  assert.equal(oct05.mtdRatio, null);
  assert.equal(month.trend.filter((day: { ratio: number | null }) => day.ratio !== null).length, 1);
});

test('the October 1 PERQ snapshot of 104 is never used for the store month', () => {
  const tabs = october();
  tabs.CC_Closing = tabs.CC_Closing!.filter((row) => !(row[5] === 100 && row[1] === 'store'));
  tabs.CC_Ledger = tabs.CC_Ledger!.filter((row) => row[12] !== 100);
  const gs = load(tabs, '2026-10-15');
  const month = gs.storeMonthClosing_(gs.loadClosing_(), STORE, '2026-10-15', {}, 0.5);
  assert.equal(month.ratio, null);
  assert.equal(month.opportunities, null);
});

test('a later day adds to the month only when both of its reports arrive', () => {
  const tabs = october();
  tabs.CC_Closing!.push(['2026-10-15', 'store', '', '', 2, '', '2026-10-15', '2026-10-15', NW, 'yes', '']);
  let gs = load(tabs, '2026-10-16');
  let month = gs.storeMonthClosing_(gs.loadClosing_(), STORE, '2026-10-16', {}, 0.5);
  assert.equal(month.through, '2026-10-14');
  assert.equal(month.trend.at(-1).status, 'Pending: PERQ');
  tabs.CC_Closing!.push(['2026-10-15', 'store', '', '', '', 7, '2026-10-15', '2026-10-15', PERQ, 'yes', '']);
  gs = load(tabs, '2026-10-16');
  month = gs.storeMonthClosing_(gs.loadClosing_(), STORE, '2026-10-16', {}, 0.5);
  assert.equal(month.through, '2026-10-15');
  assert.equal(month.customers, 54);
  assert.equal(month.opportunities, 111);
  assert.equal(month.ratio, 0.486);
  assert.equal(month.versusGoal, 'Below Goal');
  assert.equal(month.points, -1.4);
  assert.equal(month.latest.ratio, 0.286);
});

test('zero opportunities is not divided', () => {
  const tabs = october();
  tabs.CC_Closing!.push(['2026-10-15', 'store', '', '', 0, '', '2026-10-15', '2026-10-15', NW, 'yes', '']);
  tabs.CC_Closing!.push(['2026-10-15', 'store', '', '', '', 0, '2026-10-15', '2026-10-15', PERQ, 'yes', '']);
  const gs = load(tabs, '2026-10-16');
  const month = gs.storeMonthClosing_(gs.loadClosing_(), STORE, '2026-10-16', {}, 0.5);
  const day = month.trend.at(-1);
  assert.equal(day.ratio, null);
  assert.equal(day.status, 'No opportunities');
});

test('salespeople show verified PERQ opportunities and Awaiting Verified Data for customers and ratio', () => {
  const gs = load(october(), '2026-10-15');
  const facts = gs.loadClosing_();
  const renzo = gs.personClosing_(facts, 'Renzo Del Solar', '2026-10-01', '2026-10-31', 0.5);
  assert.equal(renzo.opportunities, 11);
  assert.equal(renzo.opportunitiesThrough, '2026-10-14');
  assert.equal(renzo.customers, null);
  assert.equal(renzo.customersStatus, 'Awaiting Verified Data');
  assert.equal(renzo.ratio, null);
  assert.equal(renzo.ratioStatus, 'Awaiting Verified Data');
  const ricky = gs.personClosing_(facts, 'Ricky Nassif', '2026-10-01', '2026-10-31', 0.5);
  assert.equal(ricky.opportunities, 32);
  assert.equal(ricky.ratio, null);
});
