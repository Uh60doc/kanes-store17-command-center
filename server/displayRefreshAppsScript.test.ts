/**
 * The open website refreshes from the current sheets. It does not import reports or start a new software version.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session, tabText } from './octoberVerified.ts';

const admin = session;

test('a display pulse reads the data version and does not import or rewrite sales', () => {
  const { gs, tabs } = harness();
  vm.runInContext("requireSession_ = function () { return { role: 'manager', username: 'test' }; };", gs as vm.Context);
  const before = tabText(tabs, []);
  const pulse = plain(gs.dispatch('dataPulse', { token: 't' }));
  assert.equal(pulse.ok, true);
  assert.equal(pulse.imports, false);
  assert.equal(pulse.version, 'initial');
  assert.equal(tabText(tabs, []), before);
  assert.equal(plain(gs.READ_ONLY_ROUTES_).dataPulse, true);
  const routes = plain(gs.ROUTES_) as Record<string, string[]>;
  assert.deepEqual(routes.dataPulse, ['sales', 'manager', 'admin']);
});

test('a scheduled check that finds the same figures does not retire the cached pages', () => {
  const { gs, props, tabs } = harness();
  gs.scheduledImport_();
  const version = props.data_version || '';
  const daily = JSON.stringify(cells(tabs.CC_Daily));
  const imports = JSON.stringify(cells(tabs.CC_Imports));
  gs.scheduledImport_();
  assert.equal(props.data_version || '', version);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), daily);
  assert.equal(JSON.stringify(cells(tabs.CC_Imports)), imports);
  props.suppress_change_mark = 'yes';
  gs.workbookChanged_();
  assert.equal(props.data_version || '', version);
  delete props.suppress_change_mark;
  gs.workbookChanged_();
  assert.equal(props.data_version || '', version, 'the same figures do not count as a new edit');
});

test('a real change in the daily tab is visible to the next display pulse', () => {
  const { gs, props, tabs } = harness();
  gs.scheduledImport_();
  const version = props.data_version || '';
  const daily = tabs.CC_Daily!;
  const header = daily[0]!.map(String);
  const column = header.indexOf('nwdsr_written');
  assert.ok(column > 0);
  const row = daily.find((line) => String(line[0]).slice(0, 10) === '2026-10-15');
  assert.ok(row);
  row![column] = Number(row![column]) + 1;
  gs.workbookChanged_();
  assert.notEqual(props.data_version || '', version);
  assert.match(props.data_version || '', /workbook edited$/);
  assert.equal(plain(gs.dataPulse_()).version, props.data_version);
  const imports = JSON.stringify(cells(tabs.CC_Imports));
  gs.scheduledImport_();
  assert.equal(JSON.stringify(cells(tabs.CC_Imports)), imports);
  assert.equal(Number(row![column]), Number(cells(tabs.CC_Daily).find((line) => String(line[0]).slice(0, 10) === '2026-10-15')![column]));
});

test('a note on the Dashboard Freshness task does not create another version', () => {
  const { gs, tabs } = harness();
  const started = plain(gs.startDevTask('Dashboard Freshness', 'baseline'));
  plain(gs.finishDevTask(started.taskNumber, 'Home dates verified.'));
  const noted = plain(gs.recordDevLog_({ session: admin, action: 'note', taskNumber: started.taskNumber, notes: 'Website data refreshes every 30 minutes without importing reports.' }));
  assert.equal(noted.version, '1.0.1');
  assert.equal(noted.status, 'COMPLETED');
  assert.match(noted.notes, /Home dates verified/);
  assert.match(noted.notes, /30 minutes/);
  assert.equal(cells(tabs.CC_DevLog).filter((row) => row[0] === '1.0.1').length, 1);
  assert.equal(cells(tabs.CC_DevLog).length, 2);
});

test('the website waits 30 minutes, keeps verified figures, and skips a form', () => {
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /var DISPLAY_REFRESH_MS = 30 \* 60 \* 1000;/);
  assert.match(html, /api\('dataPulse'\)/);
  assert.doesNotMatch(html.slice(html.indexOf('function refreshDisplayed'), html.indexOf('function startDisplayRefresh')), /scheduledImport_|uploadReport|retry/);
  const start = html.indexOf('/* display-refresh-policy */');
  const end = html.indexOf('/* end-display-refresh-policy */');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(html.slice(start, end), sandbox);
  const plan = sandbox.displayRefreshPlan as (state: Record<string, boolean>) => { redraw: boolean; stale: boolean; stamp: boolean; defer: boolean };
  const weakened = sandbox.figuresWeakened as (previous: unknown, next: unknown) => boolean;
  const seen = (state: Record<string, boolean>) => JSON.parse(JSON.stringify(plan(state)));
  assert.deepEqual(seen({ failed: false, weakened: false, busy: false, manual: false, changed: false }), { redraw: false, stale: false, stamp: true, defer: false });
  assert.deepEqual(seen({ failed: false, weakened: false, busy: false, manual: false, changed: true }), { redraw: true, stale: false, stamp: true, defer: false });
  assert.deepEqual(seen({ failed: false, weakened: false, busy: true, manual: true, changed: true }), { redraw: false, stale: false, stamp: false, defer: true });
  assert.deepEqual(seen({ failed: true, weakened: false, busy: false, manual: false, changed: true }), { redraw: false, stale: true, stamp: false, defer: false });
  assert.equal(weakened({ board: { month: { written: 120488 } } }, { board: { month: { written: null } } }), true);
  assert.equal(weakened({ board: { month: { written: 120488 } } }, { board: { month: { written: 120500 } } }), false);
  assert.equal(weakened({ board: { month: { written: 120488, delivered: null } } }, { board: { month: { written: 120488, delivered: null } } }), false);
});
