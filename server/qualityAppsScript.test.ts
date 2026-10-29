/**
 * Automated quality checks, data status and self-resolving alerts, run on copies of the verified October records.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session, tabText, verifiedOctober } from './octoberVerified.ts';
import { table } from './snapshotGrid.ts';

const QUALITY_TABS = ['CC_QualityChecks', 'CC_QualityRuns', 'CC_DataStatus', 'CC_Alerts', 'CC_Health'];
/** Roster / history may gain GM-confirmed former identities during checks; sales figures stay frozen. */
const QUALITY_ALLOWED = [...QUALITY_TABS, 'CC_People', 'CC_RosterHistory'];
const statusOf = (tabs: ReturnType<typeof verifiedOctober>, key: string) => table(tabs, 'CC_DataStatus').find((row) => row.key === key)!;
const alerts = (tabs: ReturnType<typeof verifiedOctober>) => table(tabs, 'CC_Alerts');
const active = (tabs: ReturnType<typeof verifiedOctober>) => alerts(tabs).filter((row) => row.status === 'Active').map((row) => row.alert_key);

test('every check runs on the verified October records; Maria stays unmatched as a NOTE; former aliases match', () => {
  const { gs, tabs } = harness();
  const written = Number(plain(gs.home_({ session })).month.written);
  const delivered = Number(plain(gs.home_({ session })).month.delivered);
  const before = tabText(tabs, QUALITY_ALLOWED);
  const summary = plain(gs.runQualityChecks_('test'));
  assert.equal(tabText(tabs, QUALITY_ALLOWED), before, 'no sales or KPI tab changed');
  assert.equal(Number(plain(gs.home_({ session })).month.written), written);
  assert.equal(Number(plain(gs.home_({ session })).month.delivered), delivered);
  const checks = table(tabs, 'CC_QualityChecks');
  const areas = new Set(checks.map((row) => row.check_id));
  for (const id of ['business-date', 'reporting-period', 'approved-source', 'duplicate-import', 'cumulative-daily', 'employee-match', 'written-delivered', 'kpi-math', 'closing-math', 'store-reconcile', 'history-retained', 'report-package', 'reporting-calendar']) assert.ok(areas.has(id), id);
  assert.deepEqual(checks.filter((row) => row.check_id === 'employee-match' && row.status === 'FLAG').map((row) => row.subject), []);
  const maria = checks.find((row) => row.check_id === 'employee-match' && /maria rafalik/i.test(row.subject))!;
  assert.equal(maria.status, 'NOTE');
  assert.match(maria.explanation, /left this name unmatched on purpose/i);
  assert.ok(checks.some((row) => row.check_id === 'employee-match' && row.status === 'PASS'));
  // SNAP vs NWDSR is a legitimate difference: noted with the variance, never flagged.
  const snap = checks.find((row) => row.subject === 'SNAP Written vs NWDSR Net Written')!;
  assert.equal(snap.status, 'NOTE');
  assert.match(snap.explanation, /SNAP Written \$101,166 and NWDSR Net Written \$109,993 differ by -\$8,827/);
  assert.equal(checks.find((row) => row.check_id === 'store-reconcile' && row.status === 'PASS')!.subject, 'Store month totals');
  assert.equal(checks.find((row) => row.check_id === 'closing-math')!.status, 'PASS');
  assert.equal(checks.find((row) => row.check_id === 'kpi-math')!.status, 'PASS');
  assert.equal(summary.flagged, 0);
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
  // Former aliases match; Maria is a NOTE only — person written is no longer held for unmatched names.
  assert.ok(['CURRENT', 'PARTIAL', 'MISSING'].includes(statusOf(afternoon.tabs, 'person_written').status));
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

/** Sheets stores a written yyyy-MM-dd as a date at midnight New York time (EDT in October). */
function asSheetsStores(tabs: ReturnType<typeof verifiedOctober>) {
  for (const name of ['CC_Alerts', 'CC_DataStatus']) {
    for (const row of tabs[name]!) row.forEach((cell, i) => { if (typeof cell === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cell)) row[i] = new Date(`${cell}T04:00:00Z`); });
  }
}

test('dates stored by Sheets read back as the business date on Home, System health and in resolutions', () => {
  const { gs, tabs } = harness();
  gs.runQualityChecks_('first run');
  asSheetsStores(tabs);
  const attention = plain(gs.home_({ session })).attention as string[];
  assert.ok(attention.some((item) => /^Not yet arrived for 2026-10-16: SNAP Written/.test(item)), attention.join('\n'));
  assert.ok(!attention.some((item) => /T04:00/.test(item)));
  const health = plain(gs.health_({ session }));
  assert.ok(health.quality.active.some((row: { date: string }) => row.date === '2026-10-16'));
  const day = health.quality.status.find((row: { kind: string; key: string }) => row.kind === 'Day' && row.key === '2026-10-15');
  assert.equal(day.periodDates, '2026-10-15');
  assert.equal(health.quality.status.find((row: { key: string }) => row.key === 'store_written').through, '2026-10-15');
  assert.ok(!JSON.stringify(health.quality).includes('T04:00:00'));
  gs.writeDailyAmount_({ reportType: 'NWDSR Delivered', start: '2026-10-16', storeTotal: 8800 });
  gs.runQualityChecks_('report arrived');
  asSheetsStores(tabs);
  const record = plain(gs.alertRows_()).find((row: { alert_key: string }) => row.alert_key === 'report|2026-10-16|nwdsrDelivered');
  assert.equal(record.status, 'Resolved');
  assert.equal(record.business_date, '2026-10-16');
  assert.match(record.resolution, /^NWDSR Delivered for 2026-10-16 arrived and passed validation/);
  assert.equal(new Set(alerts(tabs).map((row) => row.alert_key)).size, alerts(tabs).length, 'no alert is raised twice');
});

test('alert dates saved as timestamps by an earlier version read back as the business date and are rewritten', () => {
  const { gs, tabs } = harness();
  gs.runQualityChecks_('first run');
  const head = tabs.CC_Alerts![0] as string[];
  const column = head.indexOf('business_date');
  for (const row of tabs.CC_Alerts!.slice(1)) if (row[column]) row[column] = `${row[column]}T04:00:00.000Z`;
  const attention = plain(gs.home_({ session })).attention as string[];
  assert.ok(attention.some((item) => /^Not yet arrived for 2026-10-16: SNAP Written/.test(item)), attention.join('\n'));
  gs.runQualityChecks_('next run');
  assert.ok(alerts(tabs).every((row) => !/T04/.test(row.business_date)));
  assert.equal(alerts(tabs).find((row) => row.alert_key === 'report|2026-10-16|snapWritten')!.business_date, '2026-10-16');
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
  assert.equal(mail[0]!.subject, 'Command Center: 10 outstanding report problems');
  assert.match(mail[0]!.body, /2026-10-16: SNAP Written, NWDSR Written, NWDSR Delivered, Group 17 Written/);
  assert.ok(!/Needs review\n- Chaves Felipe/.test(mail[0]!.body), 'Filepe Chaves aliases match; not Needs Review');
  assert.ok(!/Needs review\n- Mukhtar Junaid/.test(mail[0]!.body), 'Mukhtar / Jimmy aliases match; not Needs Review');
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

function monthEndRow(tabs: ReturnType<typeof verifiedOctober>, metric: string) {
  const head = tabs.CC_MonthEnd![0] as string[];
  const row = tabs.CC_MonthEnd!.find((line) => line[1] === 'STORE-2026-10' && line[4] === metric)!;
  return { head, row };
}

test('closing math uses the dates both reports share, and a later customer count is not divided by earlier opportunities', () => {
  const tabs = verifiedOctober();
  const customers = monthEndRow(tabs, 'Purchasing customers');
  const ratio = monthEndRow(tabs, 'Closing ratio');
  assert.equal(customers.row[customers.head.indexOf('verified_mtd')], 54);
  assert.equal(ratio.row[ratio.head.indexOf('verified_mtd')], 0.486);
  customers.row[customers.head.indexOf('verified_mtd')] = 59;
  customers.row[customers.head.indexOf('verified_through')] = '2026-10-16';
  const dailyBefore = JSON.stringify(cells(tabs.CC_Daily));
  const ledgerBefore = JSON.stringify(cells(tabs.CC_Ledger));
  const ratioBefore = JSON.stringify(cells(tabs.CC_MonthEnd));
  const { gs } = harness(tabs);
  gs.runQualityChecks_('matched closing dates');
  const closing = table(tabs, 'CC_QualityChecks').find((check) => check.check_id === 'closing-math')!;
  assert.equal(closing.status, 'PASS', closing.explanation);
  assert.match(closing.explanation, /same dates/);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), dailyBefore);
  assert.equal(JSON.stringify(cells(tabs.CC_Ledger)), ledgerBefore);
  assert.equal(JSON.stringify(cells(tabs.CC_MonthEnd)), ratioBefore, '48.6% is not rewritten to 59 ÷ 111');
  const prior = statusOf(tabs, 'store-month-prior');
  assert.equal(prior.status, 'PARTIAL');
  assert.match(prior.explanation, /Pending/);
  assert.match(prior.explanation, /Locked is not the same as verified/);
  assert.equal(statusOf(tabs, 'person-month-prior').status, 'MISSING');
  assert.ok(table(tabs, 'CC_MonthlyHistory').filter((row) => String(row.period_key).startsWith('STORE-2026-09')).every((row) => /^Pending/i.test(String(row.verified_total))));
  assert.equal(gs.integrityOverall_('PASS', 'FAIL', 'WARNING'), 'FAIL');
  assert.equal(gs.integrityOverall_('PASS', 'PASS', 'WARNING'), 'WARNING');
  assert.equal(gs.integrityOverall_('PASS', 'PASS', 'PASS'), 'PASS');
  const board = plain(gs.integrityBoard_());
  assert.equal(board.integrity, 'PASS');
  assert.equal(board.completeness, 'WARNING');
  assert.equal(gs.integrityOverall_('PASS', board.integrity, board.completeness), 'WARNING');
});

test('a 53.2% ratio is flagged against the matching 54 ÷ 111 and the stored ratio is left alone', () => {
  const tabs = verifiedOctober();
  const customers = monthEndRow(tabs, 'Purchasing customers');
  const ratio = monthEndRow(tabs, 'Closing ratio');
  customers.row[customers.head.indexOf('verified_mtd')] = 59;
  customers.row[customers.head.indexOf('verified_through')] = '2026-10-16';
  ratio.row[ratio.head.indexOf('verified_mtd')] = 0.532;
  const stored = JSON.stringify(cells(tabs.CC_MonthEnd));
  const { gs } = harness(tabs);
  gs.runQualityChecks_('wrong closing ratio');
  const closing = table(tabs, 'CC_QualityChecks').find((check) => check.check_id === 'closing-math')!;
  assert.equal(closing.status, 'FLAG');
  assert.match(closing.explanation, /54/);
  assert.match(closing.explanation, /111/);
  assert.match(closing.explanation, /48\.6%/);
  assert.doesNotMatch(closing.explanation, /59 ÷ 111 is 53\.2%/);
  assert.equal(JSON.stringify(cells(tabs.CC_MonthEnd)), stored);
});

test('Filepe Chaves keeps the original negative SNAP line; an alias is not a second ledger row', () => {
  const tabs = verifiedOctober();
  const historyHead = tabs.CC_DailyHistory![0] as string[];
  const history = tabs.CC_DailyHistory!.find((line) => String(line[0]).includes('2026-10-11') && /CHAVES/i.test(String(line[historyHead.indexOf('employee_name')])))!;
  history[historyHead.indexOf('record_key')] = 'SNAP_PERSON|2026-10-11|written|FILEPE CHAVES';
  history[historyHead.indexOf('employee_name')] = 'Filepe Chaves';
  const associate = tabs.CC_AssociateDays!.find((line) => String(line[1]).toUpperCase() === 'CHAVES, FELIPE' && String(line[0]).slice(0, 10) === '2026-10-11')!;
  associate[2] = 'Filepe Chaves';
  const ledgerHead = tabs.CC_Ledger![0] as string[];
  const snap = () => tabs.CC_Ledger!.filter((line) => line[0] === 'SNAP_PERSON' && String(line[2]).slice(0, 10) === '2026-10-11' && /CHAVES|FILEPE/i.test(String(line[ledgerHead.indexOf('employee_name')])));
  assert.equal(snap().length, 1);
  assert.equal(Number(snap()[0]![ledgerHead.indexOf('sales_dollars')]), -180);
  const sourceName = String(associate[1]);
  const dailyBefore = JSON.stringify(cells(tabs.CC_Daily));
  const { gs } = harness(tabs);
  gs.runQualityChecks_('alias history');
  const historyCheck = table(tabs, 'CC_QualityChecks').find((check) => check.check_id === 'history-retained')!;
  assert.equal(historyCheck.status, 'PASS', historyCheck.explanation);
  assert.equal(snap().length, 1, 'the confirmed alias is not copied a second time');
  assert.equal(String(snap()[0]![ledgerHead.indexOf('employee_name')]), 'Chaves Felipe');
  assert.equal(Number(snap()[0]![ledgerHead.indexOf('sales_dollars')]), -180);
  assert.equal(String(associate[1]), sourceName);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), dailyBefore);
});

test('a SNAP day that is on the source and missing from the ledger is restored once', () => {
  const tabs = verifiedOctober();
  const ledgerHead = tabs.CC_Ledger![0] as string[];
  const index = tabs.CC_Ledger!.findIndex((line) => line[0] === 'SNAP_PERSON' && String(line[2]).slice(0, 10) === '2026-10-11' && /CHAVES/i.test(String(line[ledgerHead.indexOf('employee_name')])));
  assert.ok(index > 0);
  tabs.CC_Ledger!.splice(index, 1);
  const dailyBefore = JSON.stringify(cells(tabs.CC_Daily));
  const { gs } = harness(tabs);
  gs.runQualityChecks_('restore missing snap');
  const restored = tabs.CC_Ledger!.filter((line) => line[0] === 'SNAP_PERSON' && String(line[2]).slice(0, 10) === '2026-10-11' && /CHAVES|FILEPE/i.test(String(line[ledgerHead.indexOf('employee_name')])));
  assert.equal(restored.length, 1);
  assert.equal(Number(restored[0]![ledgerHead.indexOf('sales_dollars')]), -180);
  assert.match(String(restored[0]![ledgerHead.indexOf('source_report')]), /CC_AssociateDays CHAVES, FELIPE/);
  const historyCheck = table(tabs, 'CC_QualityChecks').find((check) => check.check_id === 'history-retained')!;
  assert.equal(historyCheck.status, 'PASS', historyCheck.explanation);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), dailyBefore);
  gs.runQualityChecks_('second pass');
  const again = tabs.CC_Ledger!.filter((line) => line[0] === 'SNAP_PERSON' && String(line[2]).slice(0, 10) === '2026-10-11' && /CHAVES|FILEPE/i.test(String(line[ledgerHead.indexOf('employee_name')])));
  assert.equal(again.length, 1);
  assert.equal(Number(again[0]![ledgerHead.indexOf('sales_dollars')]), -180);
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
