/**
 * CC_DevLog on a copy of the verified October workbook. Production is never opened.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session, tabText, verifiedOctober } from './octoberVerified.ts';

const admin = session;
const manager = { role: 'manager', username: 'regression' };
const SALES_TABS = ['CC_Daily', 'CC_Ledger', 'CC_Closing', 'CC_Kpi', 'CC_People', 'CC_Config', 'CC_MonthEnd'];

function logRows(tabs: Record<string, unknown[][]>) {
  return cells(tabs.CC_DevLog).slice(1);
}

test('starting a task writes STARTED as 1.0.1 on a new CC_DevLog, newest row on top', () => {
  const { gs, tabs } = harness();
  const before = tabText(tabs, []);
  const written = Number(plain(gs.home_({ session: admin })).month.written);
  const started = plain(gs.startDevTask('Version Tracking', 'Installing CC_DevLog'));
  assert.equal(started.version, '1.0.1');
  assert.equal(started.taskNumber, 1);
  assert.equal(started.status, 'STARTED');
  assert.equal(started.description, 'Version Tracking');
  assert.match(String(started.updated), /2026|ET|\d/);
  const grid = cells(tabs.CC_DevLog);
  assert.deepEqual(grid[0], ['Version', 'Task Number', 'Task Description', 'Status', 'Last Updated (Eastern Time)', 'Notes']);
  assert.equal(grid[1]![0], '1.0.1');
  assert.equal(grid[1]![3], 'STARTED');
  const afterHome = plain(gs.home_({ session: admin }));
  assert.equal(afterHome.month.written, written);
  assert.equal(afterHome.month.delivered, 104220);
  assert.equal(tabText(tabs, ['CC_DevLog']), before, 'no sales or configuration tab changed');
});

test('completing updates the same record to COMPLETED', () => {
  const { gs, tabs } = harness();
  const started = plain(gs.startDevTask('Version Tracking'));
  const done = plain(gs.finishDevTask(started.taskNumber, 'Tested successfully'));
  assert.equal(done.taskNumber, started.taskNumber);
  assert.equal(done.version, '1.0.1');
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.notes, 'Tested successfully');
  assert.equal(logRows(tabs).length, 1);
  assert.equal(logRows(tabs)[0]![3], 'COMPLETED');
});

test('a blocked task can be recorded with a reason', () => {
  const { gs, tabs } = harness();
  const started = plain(gs.startDevTask('Needs a permission'));
  assert.throws(() => gs.blockDevTask(started.taskNumber, ''), /Explain the blocker/);
  const blocked = plain(gs.blockDevTask(started.taskNumber, 'Waiting on Google Sheets permission.'));
  assert.equal(blocked.status, 'BLOCKED');
  assert.match(blocked.notes, /permission/);
  assert.equal(logRows(tabs)[0]![3], 'BLOCKED');
});

test('the latest version and last started / completed tasks are visible', () => {
  const { gs } = harness();
  const first = plain(gs.startDevTask('Version Tracking'));
  gs.finishDevTask(first.taskNumber, 'Tested successfully');
  const second = plain(gs.startDevTask('Next assignment'));
  const status = plain(gs.devLogStatus_());
  assert.equal(status.latestVersion, '1.0.2');
  assert.equal(status.lastStarted.taskNumber, second.taskNumber);
  assert.equal(status.lastStarted.status, 'STARTED');
  assert.equal(status.lastCompleted.taskNumber, first.taskNumber);
  assert.equal(status.lastCompleted.status, 'COMPLETED');
  assert.equal(status.rows[0].version, '1.0.2');
  assert.equal(status.productionVersion, '1.0.1');
  assert.equal(status.deployedMatchesLatestCompleted, true);
  assert.equal(status.aheadOfProduction, true);
  assert.equal(status.sheet, 'CC_DevLog');
});

test('queued stays queued and sequential versions continue 1.0.1, 1.0.2', () => {
  const { gs, tabs } = harness();
  const queued = plain(gs.queueDevTask('Known later assignment'));
  assert.equal(queued.status, 'QUEUED');
  assert.equal(queued.version, '1.0.1');
  const started = plain(gs.startDevTask('Current work'));
  assert.equal(started.version, '1.0.2');
  assert.equal(logRows(tabs)[0]![0], '1.0.2');
  assert.equal(logRows(tabs)[1]![0], '1.0.1');
});

test('routine import and quality checks do not create software versions', () => {
  const { gs, tabs } = harness();
  gs.startDevTask('Version Tracking', 'baseline');
  const before = JSON.stringify(logRows(tabs));
  const written = Number(plain(gs.home_({ session: admin })).month.written);
  gs.runQualityChecks_('scheduled import');
  gs.refreshRollup_();
  gs.scheduledImport_();
  assert.equal(JSON.stringify(logRows(tabs)), before);
  assert.equal(Number(plain(gs.home_({ session: admin })).month.written), written);
  for (const name of SALES_TABS) assert.ok(tabs[name], name);
});

test('Admin can read the log; sales and managers cannot open the route', () => {
  const { gs } = harness();
  const written = Number(plain(gs.home_({ session: admin })).month.written);
  const started = plain(gs.recordDevLog_({ session: admin, action: 'start', description: 'Version Tracking', notes: 'via recordDevLog' }));
  assert.equal(started.status, 'STARTED');
  const page = plain(gs.devLog_({ session: admin }));
  assert.equal(page.development.latestVersion, '1.0.1');
  const routes = plain(gs.ROUTES_) as Record<string, string[]>;
  assert.deepEqual(routes.devLog, ['admin']);
  assert.deepEqual(routes.recordDevLog, ['admin']);
  assert.ok(!routes.devLog.includes('sales'));
  assert.ok(!routes.recordDevLog.includes('manager'));
  assert.equal(plain(gs.READ_ONLY_ROUTES_).devLog, true);
  assert.equal(plain(gs.READ_ONLY_ROUTES_).recordDevLog, undefined);
  assert.equal(Number(plain(gs.home_({ session: admin })).month.written), written);
  assert.equal(manager.role, 'manager');
});

test('a failed description does not invent a completion row', () => {
  const { gs, tabs } = harness();
  assert.throws(() => gs.startDevTask(''), /short task description/);
  assert.equal(tabs.CC_DevLog, undefined);
  assert.throws(() => gs.finishDevTask(99, 'done'), /not on CC_DevLog/);
});
