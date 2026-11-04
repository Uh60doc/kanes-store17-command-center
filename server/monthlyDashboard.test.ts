import assert from 'node:assert/strict';
import test from 'node:test';
import { appsScriptServices } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';
import { dates, nwdsrWritten, octoberBook } from './octoberFixture.ts';

const FILES = ['Code.gs', 'Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'History.gs', 'Quality.gs', 'Reports.gs', 'Brief.gs', 'MonthlyDashboard.gs'];
const gm = { role: 'admin', username: 'liz' };

function open(tabs: Record<string, Grid>, today = '2026-11-03') {
  const drive = appsScriptServices();
  drive.props.closing_facts_v1 = 'yes';
  return loadAppsScript(FILES, tabs, today, drive.services);
}

function check(view: Record<string, any>, name: string) {
  return view.checks.find((row: { name: string }) => row.name === name);
}

test('monthly history is admin only and defaults to the last completed month', () => {
  const gs = open(octoberBook());
  assert.throws(() => gs.monthlyDashboard_({ session: { role: 'sales', username: 'renzo' } }), /administrators/);
  assert.throws(() => gs.monthlyDashboard_({ session: { role: 'manager', username: 'liz' } }), /administrators/);
  assert.throws(() => gs.finalizeHistoricalMonth_({ year: 2026, month: 10, confirm: 'FINALIZE', session: { role: 'admin', username: 'renzo' } }), /Only the GM/);
  const dash = plain(gs.monthlyDashboard_({ session: gm }));
  assert.equal(dash.historical, true);
  assert.deepEqual([dash.year, dash.month], [2026, 10]);
  assert.equal(dash.periods.store, 'Store reporting period: October 2–November 1, 2026.');
  assert.equal(dash.periods.salesperson, 'Salesperson reporting period: October 1–31, 2026.');
  assert.equal(dash.label, 'PARTIAL — NOT FINALIZED');
  assert.equal(dash.status, 'PARTIAL');
  assert.equal(dash.checks.length, 10);
  assert.ok(dash.checks.some((row: { result: string }) => row.result === 'INCOMPLETE' || row.result === 'FAIL'));
  assert.equal(dash.omitted.includes('stillNeeded') && dash.omitted.includes('winners'), true);
  assert.equal(dash.todayGoal, undefined);
  assert.equal(dash.print.title, 'STORE 17 — OCTOBER 2026 PERFORMANCE');
  assert.equal(dash.backLabel, 'BACK TO OCTOBER 2026 MONTHLY HISTORY');
  assert.ok(dash.storeKpis.every((row: { name: string }) => !['Bedding', 'Closing Ratio', 'Total Attachment'].includes(row.name)));
  assert.notEqual(dash.tiles.written.actual, 0);
  assert.ok(dash.tiles.written.missingDays.length > 0);
  assert.match(dash.tiles.written.note, /not counted as zero/);
  const home = plain(gs.home_({ session: gm }));
  assert.equal(home.historical, undefined);
  assert.match(home.period, /2026-11-02 through 2026-12-01/);
  assert.equal(home.today, '2026-11-03');
});

test('a blank day stays blank, a former associate stays on the month, and drill-down stays on that month', () => {
  const tabs = octoberBook();
  const before = tabs.CC_Daily!.filter((row) => String(row[0]) >= '2026-10-02' && String(row[0]) <= '2026-11-01' && row[2] !== '').reduce((sum, row) => sum + Number(row[2]), 0);
  tabs.CC_Daily!.push(['2026-10-20', '', '', '']);
  tabs.CC_Daily!.push(['2026-11-03', 99999, 99999, 99999]);
  tabs.CC_AssociateDays!.push(['2026-10-05', 'OLD, PAT', 'Pat Old', 'former', 250, 'sha-old', '']);
  tabs.CC_AssociateDays!.push(['2026-11-03', 'DELSOLAR, RENZO', 'Renzo Del Solar', 'associate', 99999, 'sha-nov', '']);
  const gs = open(tabs);
  const dash = plain(gs.monthlyDashboard_({ session: gm, person: 'Renzo Del Solar' }));
  assert.equal(dash.tiles.written.actual, before);
  assert.ok(dash.tiles.written.missingDays.includes('2026-10-20'));
  assert.ok(dash.people.some((person: { name: string; former: boolean }) => person.name === 'Pat Old' && person.former));
  assert.equal(dash.focus.name, 'Renzo Del Solar');
  assert.notEqual(dash.focus.snapWritten, 99999);
  assert.ok(dash.focus.days.every((day: { date: string }) => day.date < '2026-11-01'));
  const empty = plain(gs.monthlyDashboard_({ session: gm, year: 2024, month: 3 }));
  assert.equal(empty.label, 'NO DATA AVAILABLE');
  assert.equal(empty.tiles.written.actual, null);
  assert.equal(empty.tiles.delivered.actual, null);
  assert.throws(() => gs.finalizeHistoricalMonth_({ session: gm, year: 2026, month: 10, confirm: 'FINALIZE' }), /cannot be finalized/);
});

test('a passing month becomes ready, and only an explicit GM confirmation saves an immutable snapshot', () => {
  const tabs = octoberBook('2026-10-02');
  dates('2026-09-02', '2026-10-01').forEach((date) => {
    if (date !== '2026-09-02') tabs.CC_SellingDays!.push([date, 'no']);
  });
  tabs.CC_Daily!.push(['2026-09-02', 1000, 1100, 800]);
  tabs.CC_AssociateDays!.push(['2026-09-02', 'DELSOLAR, RENZO', 'Renzo Del Solar', 'associate', 1000, 'sha-sep', '']);
  tabs.CC_Config!.push(['written_goal', 2000], ['delivered_goal', 1500], ['prior_year_start_2026-09', '2025-09-01'], ['prior_year_end_2026-09', '2025-09-30']);
  tabs.CC_Kpi = [['metric', 'written', 'delivered', 'note', 'period_start', 'period_end', 'verified_through'],
    ['Bedding', 0.2, 0.1, '', '2026-09-02', '2026-10-01', '2026-09-02'],
    ['Average Ticket', 1000, 800, '', '2026-09-02', '2026-10-01', '2026-09-02'],
    ['Finance', 0.25, 0.2, '', '2026-09-02', '2026-10-01', '2026-09-02'],
    ['Total Attachment', 0.4, 0.3, '', '2026-09-02', '2026-10-01', '2026-09-02'],
    ['Bedding', 0.9, 0.9, '', '2026-11-02', '2026-12-01', '2026-11-03']];
  tabs.CC_ClosingMTD = [['Item', 'Value'], ['Period start', '2026-09-02'], ['Period end', '2026-10-01'], ['MTD through', '2026-09-02'], ['Sources', 'NWDSR · PERQ'], ['Latest daily date', '2026-09-02']];
  tabs.CC_ClosingDaily = [['Date', 'NWDSR Written purchasing customers', 'PERQ opportunities', 'Closing ratio', 'Store closing goal', 'Difference from goal (pts)', 'Versus goal', 'Source reporting dates', 'Verification status', 'MTD purchasing customers', 'MTD opportunities', 'MTD closing ratio', 'MTD difference from goal (pts)', 'MTD versus goal', 'MTD sources', 'MTD verification status'],
    ['2026-09-02', 4, 8, 0.5, 0.5, 0, 'On Target', 'test', 'Verified', 4, 8, 0.5, 0, 'On Target', 'NWDSR · PERQ', 'Verified']];
  tabs.CC_QualityChecks = [['check_id', 'area', 'status', 'subject', 'explanation', 'metrics', 'checked_at']];
  tabs.CC_DataStatus = [['kind', 'key', 'name', 'approved_source', 'period_dates', 'verified_through', 'expected_through', 'status', 'explanation', 'checked_at']];
  tabs.CC_Alerts = [['alert_key', 'category', 'severity', 'business_date', 'report', 'message', 'status', 'first_seen', 'last_seen', 'resolved_at', 'resolution', 'emailed_at']];
  tabs.CC_Consistency = [['run_at', 'trigger', 'status', 'checked', 'matched', 'discrepancies', 'warnings', 'summary'],
    ['2026-10-02T12:00:00', 'review', 'PASS', 4, 4, 0, 0, 'Compared 2026-09-02 through 2026-10-01']];
  const gs = open(tabs);
  const ready = plain(gs.monthlyDashboard_({ session: gm, year: 2026, month: 9 }));
  assert.equal(ready.status, 'READY FOR REVIEW', ready.checks.map((row: { name: string; result: string }) => row.name + ' ' + row.result).join(' | '));
  assert.equal(ready.label, 'READY FOR REVIEW');
  assert.notEqual(ready.status, 'FINALIZED');
  assert.equal(ready.tiles.written.actual, 1100);
  assert.equal(ready.tiles.bedding.actual, 0.2);
  assert.equal(ready.goals.written, 2000);
  assert.throws(() => gs.finalizeHistoricalMonth_({ session: gm, year: 2026, month: 9, confirm: true }), /explicit confirmation/);
  const saved = plain(gs.finalizeHistoricalMonth_({ session: gm, year: 2026, month: 9, confirm: 'FINALIZE' }));
  assert.equal(saved.status, 'FINALIZED');
  assert.match(saved.label, /FINALIZED — Approved by Liz on /);
  assert.match(saved.label, /America\/New_York/);
  assert.equal(saved.snapshot.version, 1);
  assert.equal(saved.snapshot.integrity, 'verified');
  tabs.CC_Daily!.find((row) => row[0] === '2026-09-02')![2] = 1;
  const again = plain(gs.monthlyDashboard_({ session: gm, year: 2026, month: 9, person: 'Renzo Del Solar' }));
  assert.equal(again.tiles.written.actual, 1100);
  assert.equal(again.focus.snapWritten, 1000);
  assert.equal(again.fromSnapshot, true);
  assert.throws(() => gs.finalizeHistoricalMonth_({ session: gm, year: 2026, month: 9, confirm: 'FINALIZE' }), /already finalized/);
  assert.throws(() => gs.approveMonthRevision_({ session: gm, year: 2026, month: 9, confirm: 'REVISE' }), /Start a revision/);
  const opened = plain(gs.startMonthRevision_({ session: gm, year: 2026, month: 9, reason: 'Delivered report was corrected.' }));
  assert.equal(opened.tiles.written.actual, 1100);
  assert.equal(opened.revision.reason, 'Delivered report was corrected.');
  tabs.CC_SellingDays = tabs.CC_SellingDays!.filter((row) => row[0] !== '2026-09-03');
  const blocked = plain(gs.monthlyDashboard_({ session: { role: 'admin', username: 'cordell' }, year: 2026, month: 9 }));
  assert.equal(blocked.fromSnapshot, true, 'an open revision still shows the saved snapshot');
  assert.throws(() => gs.approveMonthRevision_({ session: gm, year: 2026, month: 9, confirm: 'REVISE' }), /did not pass review/);
  tabs.CC_SellingDays!.push(['2026-09-03', 'no']);
  tabs.CC_Daily!.find((row) => row[0] === '2026-09-02')![2] = 1100;
  const revised = plain(gs.approveMonthRevision_({ session: gm, year: 2026, month: 9, confirm: 'REVISE' }));
  assert.equal(revised.status, 'REVISED');
  assert.equal(revised.snapshot.version, 2);
  assert.equal(revised.snapshot.prior.length > 0, true);
  const versions = tabs.CC_MonthSnapshot!.filter((row) => row[0] && row[0] !== 'snapshot_id');
  assert.equal(versions.length, 2);
  assert.equal(versions[0]![5], 'FINALIZED');
  assert.equal(String(versions[0]![15]).includes('1100'), true);

  const broken = octoberBook();
  broken.CC_MonthSnapshot = [['snapshot_id', 'period_key', 'year', 'month', 'version', 'status', 'store_start', 'store_end', 'person_start', 'person_end', 'finalized_by', 'finalized_at_et', 'digest', 'prior_snapshot_id', 'reason', 'body'],
    ['SNAP-BROKEN', 'STORE-2026-10', 2026, 10, 1, 'FINALIZED', '2026-10-02', '2026-11-01', '2026-10-01', '2026-10-31', 'Liz', '2026-11-03 America/New_York', 'not-the-digest', '', '', '']];
  const ignored = plain(open(broken).monthlyDashboard_({ session: gm }));
  assert.notEqual(ignored.status, 'FINALIZED');
  assert.match(ignored.snapshotWarning, /integrity/);
});
