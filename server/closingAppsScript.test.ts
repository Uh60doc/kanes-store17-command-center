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

interface CapturedView { daily: Grid; mtd: Grid }
const captured = JSON.parse(readFileSync(new URL('./fixtures/closing-view.json', import.meta.url), 'utf8')) as { scenarios: Record<string, CapturedView> };
const LIVE = 'live CC_Closing rows: October 14 daily and October 2-14 month to date';
const TOMORROW = 'tomorrow: October 15 Net Written 2 and PERQ 7 arrive';

/** CC_ClosingDaily and CC_ClosingMTD exactly as Google Sheets calculated them on the scratch copy (server/checkClosingView.ts). */
function withView(scenario: string): Record<string, Grid> {
  const view = captured.scenarios[scenario];
  assert.ok(view, `no captured view for ${scenario}`);
  return { ...october(), CC_ClosingDaily: view.daily, CC_ClosingMTD: view.mtd };
}

test('the dashboard shows October 2 through 14 as 52 ÷ 104 = 50.0% and October 14 as 2 ÷ 4 = 50.0% from CC_ClosingMTD', () => {
  const gs = load(withView(LIVE), '2026-10-16');
  const month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.equal(month.through, '2026-10-14');
  assert.equal(month.customers, 52);
  assert.equal(month.opportunities, 104);
  assert.equal(month.ratio, 0.5);
  assert.equal(month.versusGoal, 'On Target');
  assert.equal(month.points, 0);
  assert.equal(month.verification, 'Provisional: PERQ cutoff unconfirmed');
  assert.equal(month.provisional, true);
  assert.equal(month.customerSource, 'NWDSR Written report 2026-10-02 to 2026-10-14 (52)');
  assert.equal(month.opportunitySource, 'PERQ snapshot 2026-10-02 to 2026-10-13 (100) + daily 2026-10-14 to 2026-10-14 (4)');
  assert.deepEqual(
    { date: month.latest.date, customers: month.latest.customers, opportunities: month.latest.opportunities, ratio: month.latest.ratio, status: month.latest.status, points: month.latest.points },
    { date: '2026-10-14', customers: 2, opportunities: 4, ratio: 0.5, status: 'On Target', points: 0 },
  );
  const oct13 = month.trend.find((day: { date: string }) => day.date === '2026-10-13');
  assert.equal(oct13.customers, 4);
  assert.equal(oct13.opportunities, null);
  assert.equal(oct13.ratio, null);
  assert.equal(oct13.status, 'Pending: PERQ');
  assert.equal(oct13.mtdRatio, 0.5);
  assert.equal(month.trend.find((day: { date: string }) => day.date === '2026-10-05').mtdRatio, null);
  const oct15 = month.trend.at(-1);
  assert.equal(oct15.date, '2026-10-15');
  assert.equal(oct15.status, 'Pending: NWDSR Written and PERQ');
  assert.equal(oct15.customers, null);
  assert.equal(month.trend.filter((day: { ratio: number | null }) => day.ratio !== null).length, 1);
});

test('the Daily page and Morning Meeting read the same CC_ClosingDaily rows', () => {
  const gs = load(withView(LIVE), '2026-10-16');
  const view = gs.loadClosingView_();
  const days = gs.withDayClosing_([{ date: '2026-10-14' }, { date: '2026-10-15' }], view);
  assert.deepEqual(
    { customers: days[0].purchasingCustomers, opportunities: days[0].opportunities, ratio: days[0].closingRatio, versus: days[0].closingVersus, status: days[0].closingStatus },
    { customers: 2, opportunities: 4, ratio: 0.5, versus: 'On Target', status: 'Verified' },
  );
  assert.equal(days[1].closingRatio, null);
  assert.equal(days[1].closingStatus, 'Pending: NWDSR Written and PERQ');
  const morning = gs.morningClosing_(view, '2026-10-15', 0.5);
  assert.deepEqual({ value: morning.value, scope: morning.scope, date: morning.date }, { value: 0.5, scope: 'latest-daily', date: '2026-10-14' });
});

test('when October 15 reports reach CC_Closing, the recalculated view moves the month to 54 ÷ 111', () => {
  const gs = load(withView(TOMORROW), '2026-10-16');
  const month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.equal(month.through, '2026-10-15');
  assert.equal(month.customers, 54);
  assert.equal(month.opportunities, 111);
  assert.equal(month.ratio, 0.486);
  assert.equal(month.versusGoal, 'Below Goal');
  assert.equal(month.points, -1.4);
  assert.equal(month.latest.date, '2026-10-15');
  assert.equal(month.latest.ratio, 0.286);
  assert.equal(month.latest.status, 'Below Goal');
});

const IMPORTED = 'live CC_Closing rows after the October 15 and PERQ history imports';

function afterPerqHistory(): Record<string, Grid> {
  const tabs = withView(IMPORTED);
  const day = (date: string, scope: string, code: string, name: string, opportunities: number): (string | number)[] => [date, scope, code, name, '', opportunities, date, date, PERQ, 'yes', '', date];
  tabs.CC_Closing = [
    ...tabs.CC_Closing,
    ['2026-10-15', 'store', '', '', 2, '', '2026-10-15', '2026-10-15', NW, 'yes', '', '2026-10-15'],
    day('2026-10-01', 'store', '', '', 4), day('2026-10-01', 'person', 'TNASSI', 'Ricky Nassif', 4),
    day('2026-10-12', 'store', '', '', 9), day('2026-10-12', 'person', 'EMON0904', 'Eric Montes Rodriguez', 3), day('2026-10-12', 'person', 'JMEYERS', 'Kelly Meyers', 0),
    day('2026-10-12', 'person', 'RDELSO', 'Renzo Del Solar', 3), day('2026-10-12', 'person', 'TNASSI', 'Ricky Nassif', 3),
    day('2026-10-13', 'store', '', '', 4), day('2026-10-13', 'person', 'EMON0904', 'Eric Montes Rodriguez', 0),
    day('2026-10-13', 'person', 'RDELSO', 'Renzo Del Solar', 4), day('2026-10-13', 'person', 'TNASSI', 'Ricky Nassif', 0),
    day('2026-10-15', 'store', '', '', 7), day('2026-10-15', 'person', 'EMON0904', 'Eric Montes Rodriguez', 3), day('2026-10-15', 'person', 'TNASSI', 'Ricky Nassif', 3),
    ['2026-10-11', 'store', '', '', '', 87, '2026-10-02', '2026-10-11', PERQ, 'yes', '', '2026-10-11'],
    ['2026-10-13', 'store', '', '', '', 100, '2026-10-02', '2026-10-13', PERQ, 'yes', '', '2026-10-13'],
    ...([['EMON0904', 'Eric Montes Rodriguez', 29], ['PGANDH', 'Prakash Gandhi', 31], ['TNASSI', 'Ricky Nassif', 29], ['RDELSO', 'Renzo Del Solar', 0]] as const)
      .map(([code, name, count]) => ['2026-10-11', 'person', code, name, '', count, '2026-10-01', '2026-10-11', PERQ, 'yes', '', '2026-10-11']),
  ];
  return tabs;
}

test('after the PERQ history import the month is a verified 54 ÷ 111 and October 15 counts only the listed salespeople', () => {
  const gs = load(afterPerqHistory(), '2026-10-16');
  const month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.equal(month.through, '2026-10-15');
  assert.equal(month.customers, 54);
  assert.equal(month.opportunities, 111);
  assert.equal(month.ratio, 0.486);
  assert.equal(month.verification, 'Verified');
  assert.equal(month.provisional, false);
  assert.equal(month.trend.find((day: { date: string }) => day.date === '2026-10-12').ratio, 0.444);
  const facts = gs.loadClosing_();
  const person = (name: string) => gs.personClosing_(facts, name, '2026-10-01', '2026-10-31', 0.5);
  assert.deepEqual([person('Eric Montes Rodriguez').opportunities, person('Eric Montes Rodriguez').opportunitiesThrough], [35, '2026-10-15']);
  assert.deepEqual([person('Ricky Nassif').opportunities, person('Ricky Nassif').opportunitiesThrough], [35, '2026-10-15']);
  assert.deepEqual([person('Prakash Gandhi').opportunities, person('Prakash Gandhi').opportunitiesThrough], [31, '2026-10-14']);
  assert.deepEqual([person('Renzo Del Solar').opportunities, person('Renzo Del Solar').opportunitiesThrough], [11, '2026-10-14']);
  assert.equal(person('Ricky Nassif').ratioStatus, 'Awaiting Verified Data');
});

test('zero opportunities and disagreeing reports are not divided', () => {
  let gs = load(withView('blank figures on completed October 15 reports are zero'), '2026-10-16');
  let month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.equal(month.trend.at(-1).ratio, null);
  assert.equal(month.trend.at(-1).status, 'No opportunities');
  assert.equal(month.latest.date, '2026-10-14');
  gs = load(withView('two October 15 PERQ reports that disagree are Reconcile, not added'), '2026-10-16');
  month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.equal(month.through, '2026-10-14');
  assert.equal(month.trend.at(-1).status, 'Reconcile: reports disagree');
});

test('store closing is Pending without the view tabs or for another store month', () => {
  let gs = load(october(), '2026-10-16');
  let month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.equal(month.ratio, null);
  assert.match(month.gap, /CC_ClosingDaily and CC_ClosingMTD tabs are not on the spreadsheet/);
  gs = load(withView(LIVE), '2026-11-03');
  month = gs.storeMonthClosing_(gs.loadClosingView_(), { start: '2026-11-02', end: '2026-12-01' }, 0.5);
  assert.equal(month.ratio, null);
  assert.match(month.gap, /covers 2026-10-02 through 2026-11-01/);
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
