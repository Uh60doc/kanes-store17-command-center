import assert from 'node:assert/strict';
import test from 'node:test';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';

const FILES = ['Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs'];
const TODAY = '2026-11-06';
const STORE = { start: '2026-11-02', end: '2026-12-01' };
const LEDGER_HEADER = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
const session = { role: 'admin', name: 'Test Admin' };

function storeLedger(view: string, side: string, sales: number, units: number | '') {
  return [view, 'cumulative', '', STORE.start, '2026-11-05', '2026-11-05', '17', '', '', side, sales, units, '', '', '', 'synthetic.xlsx', '2026-11-06T00:00:00Z', `${view}|${side}`];
}

function workbook(extra: Record<string, Grid> = {}): Record<string, Grid> {
  return {
    CC_Config: [
      ['key', 'value'],
      ['written_goal_2026-11', 300000],
      ['delivered_goal_2026-11', 250000],
      ['fabric_maintenance_goal', 0.8],
      ['leather_maintenance_goal', 0.8],
      ['power_maintenance_goal', 0.8],
      ['closing_goal', 0.5],
      ['bedding_minimum', 0.2],
    ],
    CC_Daily: [
      ['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'],
      ['2026-11-02', 10000, 11000, 9000],
      ['2026-11-03', 12000, 11500, 8000],
      ['2026-11-04', 5000, 6000, 7000],
      ['2026-11-05', 8000, 7500, 6000],
    ],
    CC_Kpi: [
      ['metric', 'period_start', 'period_end', 'written', 'delivered', 'note', 'verified_through'],
      ['Bedding', STORE.start, STORE.end, 0.2, 0.15, '', '2026-11-05'],
      ['Mattress Protectors', STORE.start, STORE.end, 0.5, 0.6, '', '2026-11-05'],
      ['Pillows', STORE.start, STORE.end, 0.1, 0, '', '2026-11-05'],
      ['Adjustable Base Attachment', STORE.start, STORE.end, 0.3, 0.25, '', '2026-11-05'],
    ],
    CC_Ledger: [
      LEDGER_HEADER,
      storeLedger('BEDDING_STORE', 'written', 7200, ''),
      storeLedger('BEDDING_STORE', 'delivered', 4500, ''),
      storeLedger('MPPA_STORE', 'written', 199.98, 2),
      storeLedger('MPPA_STORE', 'delivered', 99.99, 1),
      storeLedger('PILLOWS_STORE', 'written', 0, 0),
      storeLedger('BASES_STORE', 'written', 2400, 1),
    ],
    CC_Exceptions: [['at', 'severity', 'message']],
    CC_Health: [['key', 'value'], ['status', 'Current']],
    CC_History: [['at', 'tab', 'key', 'reason', 'replaced_by', 'previous']],
    ...extra,
  };
}

const load = (tabs: Record<string, Grid>, today = TODAY) => loadAppsScript(FILES, tabs, today, { notifyOnce_: () => {}, APP_VERSION_: 'test' });

test('the registry keeps one approved source per metric and the preserved Fabric, Leather, Power and Closing goals', () => {
  const tabs = workbook();
  const gs = load(tabs);
  assert.equal(gs.metricSource_('store_written'), 'NWDSR Net Written');
  assert.equal(gs.metricSource_('store_delivered'), 'NWDSR Delivered');
  assert.equal(gs.metricSource_('store_snap_written'), 'SNAP Written');
  assert.equal(gs.metricSource_('person_written'), 'SNAP Written by salesperson');
  assert.equal(gs.metricSource_('person_delivered'), 'Group 17 Data Analysis Delivered');
  assert.equal(gs.metricSource_('person_opportunities'), 'PERQ Salesperson Ups + Be Backs');
  const registry = plain(gs.metricRegistry_(TODAY)) as any[];
  const byKey = Object.fromEntries(registry.map((row) => [row.key, row]));
  assert.equal(new Set(registry.map((row) => row.key)).size, registry.length);
  for (const key of ['kpi_fabric', 'kpi_leather', 'kpi_power']) assert.equal(byKey[key].goal, 0.8);
  assert.equal(byKey.store_closing.goal, 0.5);
  assert.equal(byKey.store_written.goal, 300000);
  assert.equal(byKey.store_written.periodDates, `${STORE.start} through ${STORE.end}`);
  assert.equal(byKey.store_written.verifiedThrough, '2026-11-05');
  assert.equal(byKey.person_written.periodDates, '2026-11-01 through 2026-11-30');
  assert.equal(byKey.kpi_bedding.verifiedThrough, '2026-11-05');
  assert.throws(() => gs.metricDefinition_('not_a_metric'), /No approved definition/);
});

test('blank goal cells fall back to the official defaults, never a different figure', () => {
  const gs = load(workbook({ CC_Config: [['key', 'value']] }));
  const goals = plain(gs.approvedGoals_({}));
  assert.equal(goals.fabric, 0.8);
  assert.equal(goals.leather, 0.8);
  assert.equal(goals.power, 0.8);
  assert.equal(goals.closing, 0.5);
  assert.equal(goals.bedding, 0.2);
});

test('the registry tab lists every definition with its period, verified-through date and goal', () => {
  const tabs = workbook();
  const gs = load(tabs);
  const count = gs.refreshMetricRegistry_();
  const grid = tabs.CC_MetricDefinitions!;
  assert.equal(grid.length, count + 1);
  assert.deepEqual(grid[0], ['metric_key', 'metric', 'approved_source', 'scope', 'side', 'calculation', 'reporting_period', 'period_dates', 'verified_through', 'goal', 'goal_key', 'goal_effective', 'used_on']);
  const fabric = grid.find((row) => row[0] === 'kpi_fabric')!;
  assert.equal(fabric[9], 0.8);
  const written = grid.find((row) => row[0] === 'store_written')!;
  assert.equal(written[2], 'NWDSR Net Written');
  assert.equal(written[8], '2026-11-05');
  assert.match(String(written[11]), /written_goal_2026-11/);
});

test('Home store written is NWDSR Net Written; SNAP Written stays beside it with the variance', () => {
  const tabs = workbook();
  const gs = load(tabs);
  const home = plain(gs.home_({ session }));
  assert.equal(home.board.month.written, 36000);
  assert.equal(home.board.month.snapWritten, 35000);
  assert.equal(home.board.month.snapVariance, -1000);
  assert.equal(home.board.month.writtenLeft, 264000);
  assert.equal(home.board.month.writtenAchieved, 0.12);
  assert.equal(home.board.month.delivered, 30000);
  assert.equal(home.yesterday.written, 7500);
  assert.equal(home.yesterday.snapWritten, 8000);
  assert.equal(home.yesterday.snapVariance, 500);
  assert.equal(home.labels.written, 'NWDSR Net Written');
  assert.equal(home.labels.snap, 'SNAP Written');
  assert.match(home.standard, /Store written is NWDSR Net Written/);
  const daysLeft = gs.operatingDaysRemaining_(STORE, TODAY, {});
  assert.equal(home.board.today.daysLeft, daysLeft);
  assert.equal(home.board.today.written, Math.round((264000 / daysLeft) * 100) / 100);
  const yesterdayDays = gs.operatingDaysRemaining_(STORE, '2026-11-05', {});
  assert.equal(home.board.yesterday.written.goal, Math.round(((300000 - 28500) / yesterdayDays) * 100) / 100);
});

test('a saved written goal worked out from SNAP is recalculated from NWDSR and the old row is archived', () => {
  const daysOn = (date: string) => (gs: Record<string, (...args: any[]) => any>) => gs.operatingDaysRemaining_(STORE, date, {});
  const tabs = workbook({
    CC_DailyGoals: [
      ['date', 'written_goal', 'delivered_goal', 'days_left'],
      ['2026-11-03', 9999.99, 8333.33, 29],
    ],
  });
  const gs = load(tabs);
  gs.home_({ session });
  const goals = tabs.CC_DailyGoals!;
  assert.deepEqual(goals[0], ['date', 'written_goal', 'delivered_goal', 'days_left', 'written_basis']);
  const row = goals.find((line) => line[0] === '2026-11-03')!;
  assert.equal(row[1], Math.round(((300000 - 11000) / daysOn('2026-11-03')(gs)) * 100) / 100);
  assert.equal(row[2], 8333.33);
  assert.equal(row[4], 'NWDSR Net Written');
  const archived = tabs.CC_History!.filter((line) => line[1] === 'CC_DailyGoals');
  assert.equal(archived.length, 1);
  assert.equal(archived[0]![2], '2026-11-03');
  assert.match(String(archived[0]![5]), /9999\.99/);
  gs.home_({ session });
  assert.equal(tabs.CC_History!.filter((line) => line[1] === 'CC_DailyGoals').length, 1);
  for (const line of goals.slice(1)) assert.equal(line[4], 'NWDSR Net Written');
});

test('the Bedding page shows the same store percentages as Home and the store-month dollars and units', () => {
  const tabs = workbook();
  const gs = load(tabs);
  const bedding = plain(gs.bedding_({ session }));
  const home = plain(gs.home_({ session }));
  const tile = home.board.kpis.find((row: { name: string }) => row.name === 'Bedding');
  assert.equal(bedding.writtenPercent, tile.written);
  assert.equal(bedding.deliveredPercent, tile.delivered);
  assert.equal(bedding.deliveredPercent, 0.15);
  assert.equal(bedding.store.written.beddingDollars, 7200);
  assert.equal(bedding.store.delivered.beddingDollars, 4500);
  assert.equal(bedding.store.written.protectorUnits, 2);
  assert.equal(bedding.store.written.protectorDollars, 199.98);
  assert.equal(bedding.store.written.protectors, 0.5);
  assert.equal(bedding.store.delivered.protectors, 0.6);
  assert.equal(bedding.store.written.pillowUnits, 0);
  assert.equal(bedding.store.delivered.pillowUnits, null);
  assert.equal(bedding.store.written.bases, 0.3);
  assert.equal(bedding.store.written.ledgerThrough, '2026-11-05');
  assert.equal(bedding.beddingGoal, 0.2);
  assert.match(bedding.deliveredPercentNote, /through 2026-11-05/);
});

test('a configured bedding minimum reaches the morning meeting instead of a fixed 20%', () => {
  const tabs = workbook();
  tabs.CC_Config = tabs.CC_Config!.map((row) => (row[0] === 'bedding_minimum' ? ['bedding_minimum', 0.25] : row));
  const gs = load(tabs);
  const morning = plain(gs.morning_({ session }));
  assert.equal(morning.today.beddingGoal, 0.25);
  assert.equal(morning.yesterday.written.actual, 7500);
  assert.equal(morning.yesterday.snapWritten, 8000);
  assert.equal(morning.labels.written, 'NWDSR Net Written');
});

test('the attention list and health check look for NWDSR Net Written as well as SNAP and NWDSR Delivered', () => {
  const tabs = workbook();
  tabs.CC_Daily!.push(['2026-11-06', 9000, '', 5000]);
  const gs = load(tabs, '2026-11-07');
  const attention = plain(gs.attention_(gs.dailyFacts_(), {}, 'admin')) as string[];
  assert.ok(attention.some((item) => /NWDSR Net Written for 2026-11-06 has not arrived/.test(item)));
  assert.ok(!attention.some((item) => /SNAP Written for 2026-11-06/.test(item)));
  const health = plain(gs.health_({ session }));
  const status = health.rows.find((row: { key: string }) => row.key === 'status');
  assert.equal(status.value, 'Report Missing');
});

test('CC_Rollup keeps today\'s written and delivered goals equal to the Home figures', () => {
  const tabs = workbook({ CC_Rollup: [['metric', 'value', 'note']] });
  const gs = load(tabs);
  gs.refreshRollup_();
  const rollup = Object.fromEntries(tabs.CC_Rollup!.slice(1).map((row) => [row[0], row[1]]));
  const home = plain(gs.home_({ session }));
  assert.equal(rollup.nwdsr_written, 36000);
  assert.equal(rollup.snap_written, 35000);
  assert.equal(rollup.written_remaining, home.board.month.writtenLeft);
  assert.equal(rollup.delivered_remaining, home.board.month.deliveredLeft);
  assert.equal(rollup.written_pace, home.board.today.written);
  assert.equal(rollup.delivered_pace, home.board.today.delivered);
  assert.equal(rollup.verified_through, '2026-11-05');
});
