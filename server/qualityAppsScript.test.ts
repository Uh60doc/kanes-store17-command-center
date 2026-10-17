/**
 * Automated quality checks, data status and self-resolving alerts, run on copies of the verified October records.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session, tabText, verifiedOctober } from './octoberVerified.ts';
import { table } from './snapshotGrid.ts';

const QUALITY_TABS = ['CC_QualityChecks', 'CC_QualityRuns', 'CC_DataStatus', 'CC_Alerts', 'CC_Health'];
const UNMATCHED = ['Chaves Felipe', 'FELIPE CHAVES', 'MARIA RAFALIK', 'Mukhtar Junaid'];
const statusOf = (tabs: ReturnType<typeof verifiedOctober>, key: string) => table(tabs, 'CC_DataStatus').find((row) => row.key === key)!;
const alerts = (tabs: ReturnType<typeof verifiedOctober>) => table(tabs, 'CC_Alerts');
const active = (tabs: ReturnType<typeof verifiedOctober>) => alerts(tabs).filter((row) => row.status === 'Active').map((row) => row.alert_key);

test('every check runs on the verified October records and only the unmatched names are flagged', () => {
  const { gs, tabs } = harness();
  const before = tabText(tabs, QUALITY_TABS);
  const summary = plain(gs.runQualityChecks_('test'));
  assert.equal(tabText(tabs, QUALITY_TABS), before, 'no imported or calculated tab changed');
  const checks = table(tabs, 'CC_QualityChecks');
  const areas = new Set(checks.map((row) => row.check_id));
  for (const id of ['business-date', 'reporting-period', 'approved-source', 'duplicate-import', 'cumulative-daily', 'employee-match', 'written-delivered', 'kpi-math', 'closing-math', 'store-reconcile', 'history-retained', 'report-package']) assert.ok(areas.has(id), id);
  assert.deepEqual(checks.filter((row) => row.status === 'FLAG').map((row) => row.subject).sort(), [...UNMATCHED].sort());
  assert.ok(checks.filter((row) => row.status === 'FLAG').every((row) => /does not match one roster person/.test(row.explanation) && /Add the name or alias/.test(row.explanation)));
  // SNAP vs NWDSR is a legitimate difference: noted with the variance, never flagged.
  const snap = checks.find((row) => row.subject === 'SNAP Written vs NWDSR Net Written')!;
  assert.equal(snap.status, 'NOTE');
  assert.match(snap.explanation, /SNAP Written \$101,166 and NWDSR Net Written \$109,993 differ by -\$8,827/);
  assert.equal(checks.find((row) => row.check_id === 'store-reconcile' && row.status === 'PASS')!.subject, 'Store month totals');
  assert.equal(checks.find((row) => row.check_id === 'closing-math')!.status, 'PASS');
  assert.equal(checks.find((row) => row.check_id === 'kpi-math')!.status, 'PASS');
  assert.equal(summary.flagged, 4);
  assert.equal(table(tabs, 'CC_QualityRuns').length, 1);
});

test('a recent import does not make the reporting package complete', () => {
  const morning = harness(verifiedOctober(), '2026-10-17', 8);
  morning.gs.runQualityChecks_('before the due hour');
  assert.equal(statusOf(morning.tabs, 'store_written').status, 'CURRENT');
  assert.equal(statusOf(morning.tabs, 'store_written').verified_through, '2026-10-15');
  assert.ok(!active(morning.tabs).some((key) => key.startsWith('report|2026-10-16')), 'reports for 10-16 are not due before 10:00');

  const afternoon = harness(verifiedOctober(), '2026-10-17', 15);
  // A fresh import for October 16 arrives (NWDSR Written only).
  afternoon.gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-16', storeTotal: 2500 });
  afternoon.gs.runQualityChecks_('after one report');
  // Up to date, but the month is still open: CURRENT, not COMPLETE.
  assert.equal(statusOf(afternoon.tabs, 'store_written').status, 'CURRENT');
  assert.equal(statusOf(afternoon.tabs, 'store_written').verified_through, '2026-10-16');
  assert.equal(statusOf(afternoon.tabs, 'store_delivered').status, 'PARTIAL');
  assert.equal(statusOf(afternoon.tabs, 'store_delivered').verified_through, '2026-10-15');
  assert.equal(statusOf(afternoon.tabs, '2026-10-16').status, 'PARTIAL');
  assert.equal(statusOf(afternoon.tabs, 'store-month').status, 'PARTIAL');
  assert.equal(statusOf(afternoon.tabs, '2026-10-15').status, 'COMPLETE');
  assert.equal(statusOf(afternoon.tabs, 'kpi_warranty').status, 'MISSING');
  assert.equal(statusOf(afternoon.tabs, 'person_written').status, 'NEEDS REVIEW');
});

test('a missing-report alert resolves itself when the report arrives, and the record is kept', () => {
  const { gs, tabs } = harness();
  gs.runQualityChecks_('first run');
  assert.ok(active(tabs).includes('report|2026-10-16|nwdsrDelivered'));
  assert.ok(plain(gs.home_({ session })).attention.some((item: string) => /Not yet arrived for 2026-10-16: .*NWDSR Delivered/.test(item)));
  gs.writeDailyAmount_({ reportType: 'NWDSR Delivered', start: '2026-10-16', storeTotal: 8800 });
  const second = plain(gs.runQualityChecks_('report arrived'));
  assert.ok(second.resolved >= 1);
  assert.ok(!active(tabs).includes('report|2026-10-16|nwdsrDelivered'));
  const record = alerts(tabs).find((row) => row.alert_key === 'report|2026-10-16|nwdsrDelivered')!;
  assert.equal(record.status, 'Resolved');
  assert.match(record.resolution, /NWDSR Delivered for 2026-10-16 arrived and passed validation \(Store 17 total \$8,800\)/);
  assert.ok(record.first_seen && record.resolved_at >= record.first_seen);
  assert.ok(active(tabs).includes('report|2026-10-16|nwdsrWritten'), 'the reports still missing stay active');
  const attention = plain(gs.home_({ session })).attention as string[];
  assert.ok(!attention.some((item) => /NWDSR Delivered/.test(item) && /2026-10-16/.test(item)));
  const health = plain(gs.health_({ session }));
  assert.ok(health.quality.resolved.some((row: { report: string; date: string }) => row.report === 'NWDSR Delivered' && row.date === '2026-10-16'));
  assert.ok(!health.quality.active.some((row: { report: string; date: string }) => row.report === 'NWDSR Delivered' && row.date === '2026-10-16'));
});

test('obsolete missing-report warnings from before alert tracking are resolved and not shown', () => {
  const { gs, tabs } = harness();
  assert.ok(table(tabs, 'CC_Exceptions').some((row) => row.severity === 'Report Missing' && /2026-10-15 is missing/.test(row.message)));
  gs.runQualityChecks_('first run');
  for (const key of ['report|2026-10-13|nwdsrWritten', 'report|2026-10-15|snapWritten', 'report|2026-10-15|nwdsrDelivered']) {
    assert.equal(alerts(tabs).find((row) => row.alert_key === key)!.status, 'Resolved', key);
  }
  const attention = plain(gs.home_({ session })).attention as string[];
  assert.ok(!attention.some((item) => /2026-10-1[35] is missing|A report for 2026-10-13/.test(item)));
  const health = plain(gs.health_({ session }));
  assert.ok(!health.exceptions.some((row: { severity: string }) => row.severity === 'Report Missing'));
  assert.equal(table(tabs, 'CC_Exceptions').filter((row) => row.severity === 'Report Missing').length, 3, 'the original log rows are kept');
});

test('only one consolidated email is sent for the outstanding problems', () => {
  const { gs, tabs, mail, setToday } = harness();
  gs.qualityAfterUpdate_('scheduled import', true);
  assert.equal(mail.length, 1);
  assert.equal(mail[0]!.subject, 'Command Center: 14 outstanding report problems');
  assert.match(mail[0]!.body, /2026-10-16: SNAP Written, NWDSR Written, NWDSR Delivered, Group 17 Written/);
  assert.match(mail[0]!.body, /Needs review\n- Chaves Felipe/);
  gs.qualityAfterUpdate_('scheduled import', true);
  gs.notifyOnce_('PERQ export could not be read. No figure was changed.');
  gs.qualityAfterUpdate_('scheduled import', true);
  assert.equal(mail.length, 1, 'no second email the same day');
  assert.ok(alerts(tabs).some((row) => row.category === 'Notice' && /PERQ export could not be read/.test(row.message)));
  // An upload batch never emails.
  gs.qualityAfterUpdate_('upload by admin', false);
  assert.equal(mail.length, 1);
  setToday('2026-10-18');
  gs.writeDailyAmount_({ reportType: 'NWDSR Delivered', start: '2026-10-16', storeTotal: 8800 });
  gs.qualityAfterUpdate_('scheduled import', true);
  assert.equal(mail.length, 2, 'the next day brings one new email for the new problems');
  assert.match(mail[1]!.body, /2026-10-17: SNAP Written/);
  assert.match(mail[1]!.body, /Other notices\n- PERQ export could not be read/);
  assert.match(mail[1]!.body, /Resolved since the last email \(1\)\n- NWDSR Delivered for 2026-10-16 arrived/);
  assert.equal(mail.filter((item) => /Slack/i.test(item.body)).length, 0);
});

test('an unexplained mismatch is flagged with an explanation and the reported value is kept', () => {
  const tabs = verifiedOctober();
  const head = tabs.CC_MonthEnd![0] as string[];
  const row = tabs.CC_MonthEnd!.find((line) => line[1] === 'STORE-2026-10' && line[4] === 'NWDSR Written')!;
  row[head.indexOf('verified_mtd')] = 109000;
  const ledgerHead = tabs.CC_Ledger![0] as string[];
  const kpi = tabs.CC_Ledger!.find((line) => line[0] === 'FABW_STORE' && line[1] === 'daily')!;
  const printed = kpi[ledgerHead.indexOf('kpi_percent')];
  kpi[ledgerHead.indexOf('kpi_percent')] = 0.999;
  const { gs } = harness(tabs);
  const monthEnd = JSON.stringify(cells(tabs.CC_MonthEnd));
  gs.runQualityChecks_('test');
  const flags = table(tabs, 'CC_QualityChecks').filter((check) => check.status === 'FLAG');
  const totals = flags.find((check) => check.check_id === 'store-reconcile')!;
  assert.match(totals.explanation, /109,000/);
  assert.match(totals.explanation, /109,993/);
  const rate = flags.find((check) => check.check_id === 'kpi-math')!;
  assert.match(rate.explanation, /prints 99\.9%/);
  assert.match(rate.explanation, /The reported value was kept/);
  assert.equal(statusOf(tabs, 'store_written').status, 'NEEDS REVIEW');
  assert.equal(JSON.stringify(cells(tabs.CC_MonthEnd)), monthEnd, 'the check never rewrites a figure');
  assert.equal(kpi[ledgerHead.indexOf('kpi_percent')], 0.999);
  assert.notEqual(printed, 0.999);
  assert.ok(table(tabs, 'CC_Alerts').some((alert) => alert.alert_key.startsWith('quality|store-reconcile|') && alert.status === 'Active'));
});

test('a duplicated import and lost history are flagged; the alert clears once corrected', () => {
  const { gs, tabs } = harness();
  gs.runQualityChecks_('baseline');
  const duplicate = [...tabs.CC_Daily![tabs.CC_Daily!.length - 1]!];
  tabs.CC_Daily!.push(duplicate);
  const removed = tabs.CC_DailyHistory!.splice(5, 1);
  gs.runQualityChecks_('after damage');
  const flags = table(tabs, 'CC_QualityChecks').filter((check) => check.status === 'FLAG');
  assert.ok(flags.some((check) => check.check_id === 'duplicate-import' && /CC_Daily/.test(check.subject + check.explanation)));
  assert.ok(flags.some((check) => check.check_id === 'history-retained' && /CC_DailyHistory/.test(check.subject + check.explanation)));
  tabs.CC_Daily!.pop();
  tabs.CC_DailyHistory!.splice(5, 0, ...removed);
  gs.runQualityChecks_('after repair');
  assert.ok(!table(tabs, 'CC_QualityChecks').some((check) => check.status === 'FLAG' && (check.check_id === 'duplicate-import' || check.check_id === 'history-retained')));
  const cleared = alerts(tabs).filter((row) => row.alert_key.startsWith('quality|duplicate-import|') || row.alert_key.startsWith('quality|history-retained|'));
  assert.ok(cleared.length >= 2);
  assert.ok(cleared.every((row) => row.status === 'Resolved' && /The check passed/.test(row.resolution)));
});

test('a manual upload stays quiet and the checks never block it', () => {
  const { gs, mail } = harness();
  (gs as unknown as Record<string, unknown>).UPLOAD_QUIET_ = true;
  gs.notifyOnce_('Should not be emailed.');
  const result = plain(gs.qualityAfterUpdate_('upload by manager', true));
  assert.equal(result.email.sent, false);
  assert.equal(mail.length, 0);
  (gs as unknown as Record<string, unknown>).runQualityChecks_ = () => { throw new Error('boom'); };
  assert.equal(gs.qualityAfterUpdate_('upload by manager', false), null);
});
