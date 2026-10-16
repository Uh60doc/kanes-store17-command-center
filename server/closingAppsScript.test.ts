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
  assert.equal(person('Ricky Nassif').ratio, null, 'no Group 17 Written report is on file, so nothing is divided');
  assert.equal(person('Ricky Nassif').ratioStatus, 'Pending: Group 17 Written orders');
  assert.equal(person('Ricky Nassif').orders, null);
});

const G17_SNAPSHOT = 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-01_2026-10-13.xlsx';
const G17_DAY = (date: string) => `DATA_ANALYSIS_KPI_17_WRITTEN_${date}_${date}.xlsx`;
const sales = (view: string, grain: string, start: string, end: string, code: string, name: string, dollars: number, orders: number | '', source: string): (string | number)[] =>
  [view, grain, grain === 'daily' ? start : '', start, end, end, '17', code, name, 'written', dollars, orders, '', '', '', source, '', `${view}|${grain}|${start}|${end}|${code || 'STORE'}`];

/** Group 17 Written: the October 1-13 salesperson snapshot, then the October 13, 14 and 15 day files. */
function withOrders(tabs: Record<string, Grid>, days = ['2026-10-14', '2026-10-15']): Record<string, Grid> {
  const rows = [
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', 31794.47, 11, G17_SNAPSHOT),
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'PGANDH', 'Prakash Gandhi', 20000, 9, G17_SNAPSHOT),
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'TNASSI', 'Ricky Nassif', 16804.84, 8, G17_SNAPSHOT),
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'RDELSO', 'Renzo Del Solar', 4000, 3, G17_SNAPSHOT),
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EDURAN', 'Elizabeth Duran', -301.3, 5, G17_SNAPSHOT),
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-02', '2026-11-01', 'EMON0904', 'Eric Montes Rodriguez', 99999, 50, 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-11-01.xlsx'),
    sales('DA_SALES_STORE', 'daily', '2026-10-13', '2026-10-13', '', '', 7106, 4, G17_DAY('2026-10-13')),
    sales('DA_SALES_PERSON', 'daily', '2026-10-13', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', 5000, 2, G17_DAY('2026-10-13')),
  ];
  if (days.includes('2026-10-14')) {
    rows.push(
      sales('DA_SALES_STORE', 'daily', '2026-10-14', '2026-10-14', '', '', 3300, 3, G17_DAY('2026-10-14')),
      sales('DA_SALES_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', 2476, 2, G17_DAY('2026-10-14')),
      sales('DA_SALES_PERSON', 'daily', '2026-10-14', '2026-10-14', 'RDELSO', 'Renzo Del Solar', 824, 1, G17_DAY('2026-10-14')),
    );
  }
  if (days.includes('2026-10-15')) {
    rows.push(
      sales('DA_SALES_STORE', 'daily', '2026-10-15', '2026-10-15', '', '', 1409.97, 2, G17_DAY('2026-10-15')),
      sales('DA_SALES_PERSON', 'daily', '2026-10-15', '2026-10-15', 'EMON0904', 'Eric Montes Rodriguez', 500, 1, G17_DAY('2026-10-15')),
      sales('DA_SALES_PERSON', 'daily', '2026-10-15', '2026-10-15', 'TNASSI', 'Ricky Nassif', 0, '', G17_DAY('2026-10-15')),
      sales('DA_SALES_PERSON', 'daily', '2026-10-15', '2026-10-15', 'JMEYERS', 'Kelly Meyers', 909.97, 1, G17_DAY('2026-10-15')),
    );
  }
  return { ...tabs, CC_Ledger: [...tabs.CC_Ledger, ...rows] };
}

const individual = (gs: Record<string, (...args: unknown[]) => any>, name: string) => {
  const result = gs.personClosing_(gs.loadClosing_(), name, '2026-10-01', '2026-10-31', 0.5);
  return { orders: result.orders, opportunities: result.opportunities, through: result.through, ratio: result.ratio, points: result.points, versus: result.versusGoal, status: result.ratioStatus };
};

test('individual closing is Group 17 Written orders ÷ PERQ opportunities, both through the same verified date', () => {
  const gs = load(withOrders(afterPerqHistory()), '2026-10-16');
  assert.deepEqual(individual(gs, 'Eric Montes Rodriguez'), { orders: 12, opportunities: 35, through: '2026-10-15', ratio: 0.343, points: -15.7, versus: 'Below Goal', status: '' });
  assert.deepEqual(individual(gs, 'Ricky Nassif'), { orders: 10, opportunities: 35, through: '2026-10-15', ratio: 0.286, points: -21.4, versus: 'Below Goal', status: '' });
  assert.deepEqual(individual(gs, 'Prakash Gandhi'), { orders: 9, opportunities: 31, through: '2026-10-14', ratio: 0.29, points: -21, versus: 'Below Goal', status: '' },
    'PERQ for Prakash is through October 14, so October 15 orders are not counted');
  assert.deepEqual(individual(gs, 'Renzo Del Solar'), { orders: 4, opportunities: 11, through: '2026-10-14', ratio: 0.364, points: -13.6, versus: 'Below Goal', status: '' });
  const eric = gs.personClosing_(gs.loadClosing_(), 'Eric Montes Rodriguez', '2026-10-01', '2026-10-31', 0.5);
  assert.equal(eric.ordersSource, '11 for 2026-10-01 through 2026-10-13 plus day files 2026-10-14 0, 2026-10-15 1',
    'the October 13 day file is inside the snapshot, and the October 2 store-track report is not used');
});

test('when the October 15 Group 17 report is missing, the ratio moves back to the last date both reports cover', () => {
  const gs = load(withOrders(afterPerqHistory(), ['2026-10-14']), '2026-10-16');
  assert.deepEqual(individual(gs, 'Eric Montes Rodriguez'), { orders: 11, opportunities: 32, through: '2026-10-14', ratio: 0.344, points: -15.6, versus: 'Below Goal', status: '' });
  const eric = gs.personClosing_(gs.loadClosing_(), 'Eric Montes Rodriguez', '2026-10-01', '2026-10-31', 0.5);
  assert.match(eric.note, /PERQ through 2026-10-15 waits for the Group 17 Written report/);
});

test('a later salesperson snapshot replaces the earlier snapshot and its day files instead of adding to them', () => {
  const tabs = withOrders(afterPerqHistory());
  const derived = `${G17_SNAPSHOT} + ${G17_DAY('2026-10-14')} + ${G17_DAY('2026-10-15')}`;
  tabs.CC_Ledger.push(
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-15', 'EMON0904', 'Eric Montes Rodriguez', 32294.47, 12, derived),
    sales('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-15', 'TNASSI', 'Ricky Nassif', 19280.84, 10, derived),
  );
  const gs = load(tabs, '2026-10-16');
  assert.equal(individual(gs, 'Eric Montes Rodriguez').orders, 12);
  assert.equal(individual(gs, 'Ricky Nassif').orders, 10);
  const eric = gs.personClosing_(gs.loadClosing_(), 'Eric Montes Rodriguez', '2026-10-01', '2026-10-31', 0.5);
  assert.equal(eric.ordersSource, '12 for 2026-10-01 through 2026-10-15');
});

test('zero opportunities is not divided, a missing report is Pending, and a blank line on a covered report is 0', () => {
  const tabs = withOrders(afterPerqHistory());
  tabs.CC_Closing.push(['2026-10-15', 'person', '', 'Brenda Sanchez', '', 0, '2026-10-01', '2026-10-15', PERQ, 'yes', '', '2026-10-15']);
  const gs = load(tabs, '2026-10-16');
  assert.deepEqual(individual(gs, 'Brenda Sanchez'), { orders: 0, opportunities: 0, through: '2026-10-15', ratio: null, points: null, versus: null, status: 'No opportunities' });
  assert.deepEqual(individual(gs, 'Caroline Amaro'), { orders: null, opportunities: null, through: '', ratio: null, points: null, versus: null, status: 'Pending: reporting dates do not match' },
    'PERQ for Caroline is only verified through October 1 and the Group 17 snapshot starts at October 13');
  assert.equal(individual(load(withOrders(october()), '2026-10-16'), 'Caroline Amaro').status, 'Pending: PERQ opportunities');
  assert.equal(individual(load(october(), '2026-10-16'), 'Caroline Amaro').status, 'Pending: PERQ opportunities and Group 17 Written orders');
});

test('an order count that could not be read is Pending, never guessed', () => {
  const tabs = withOrders(afterPerqHistory());
  tabs.CC_Ledger = tabs.CC_Ledger.map((row) => (row[0] === 'DA_SALES_PERSON' && row[1] === 'daily' && row[2] === '2026-10-15' && row[8] === 'Eric Montes Rodriguez' ? [...row.slice(0, 11), '', ...row.slice(12)] : row));
  const gs = load(tabs, '2026-10-16');
  assert.deepEqual(individual(gs, 'Eric Montes Rodriguez'), { orders: 11, opportunities: 32, through: '2026-10-14', ratio: 0.344, points: -15.6, versus: 'Below Goal', status: '' });
});

test('salesperson order counts never change the store closing ratio', () => {
  const gs = load(withOrders(afterPerqHistory()), '2026-10-16');
  const month = gs.storeMonthClosing_(gs.loadClosingView_(), STORE, 0.5);
  assert.deepEqual([month.customers, month.opportunities, month.ratio, month.through], [54, 111, 0.486, '2026-10-15']);
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

test('salespeople are matched by code or alias, and the store purchasing-customer count is never used', () => {
  const gs = load(withOrders(october()), '2026-10-15');
  const renzo = individual(gs, 'Renzo Del Solar');
  assert.deepEqual(renzo, { orders: 4, opportunities: 11, through: '2026-10-14', ratio: 0.364, points: -13.6, versus: 'Below Goal', status: '' });
  const ricky = gs.personClosing_(gs.loadClosing_(), 'Ricky Nassif', '2026-10-01', '2026-10-31', 0.5);
  assert.equal(ricky.orders, 10);
  assert.ok(!('customers' in ricky));
});
