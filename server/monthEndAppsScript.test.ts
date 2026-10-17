import assert from 'node:assert/strict';
import test from 'node:test';
import { type Grid, loadAppsScript } from './fakeSpreadsheet.ts';
import { closing, dates, ledgerRow, nwdsrWritten, octoberBook, services } from './octoberFixture.ts';

const FILES = ['Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Upload.gs', 'MonthEnd.gs'];
const HEADERS = ['track', 'period_key', 'period_start', 'period_end', 'metric', 'side', 'person', 'employee_id', 'unit', 'verified_mtd', 'verified_through', 'qualified', 'sold', 'mtd_basis', 'daily_records_total', 'daily_record_dates', 'snapshot_coverage', 'missing_or_unverified', 'official_final', 'official_basis', 'variance', 'explanation', 'status'];

function monthEnd(tabs: Record<string, Grid>, today: string) {
  const gs = loadAppsScript(FILES, tabs, today, services());
  gs.ensureRosterColumns_();
  gs.refreshMonthEnd_();
  const grid = tabs.CC_MonthEnd!;
  assert.deepEqual(grid[0], HEADERS);
  return grid.slice(1).map((row) => Object.fromEntries(HEADERS.map((name, index) => [name, row[index]])) as Record<string, any>);
}

const find = (rows: Record<string, any>[], key: string, metric: string, side?: string, person = '') =>
  rows.find((row) => row.period_key === key && row.metric === metric && (side === undefined || row.side === side) && row.person === person)!;

test('month to date is the snapshot plus later days; the daily records alone are shown as partial coverage', () => {
  const rows = monthEnd(octoberBook(), '2026-10-16');
  const perq = find(rows, 'STORE-2026-10', 'PERQ opportunities');
  assert.equal(perq.verified_mtd, 111, 'PERQ: 100 through October 13 plus 4 (October 14) and 7 (October 15)');
  assert.equal(perq.verified_through, '2026-10-15');
  assert.equal(perq.daily_records_total, 24, 'the single-day PERQ exports alone add up to 24 and are not called a month to date');
  assert.equal(perq.daily_record_dates, '2026-10-12 to 2026-10-15 (4 dates)');
  assert.match(perq.snapshot_coverage, /2026-10-02 to 2026-10-11 \(87\); 2026-10-02 to 2026-10-13 \(100\)\. Used: through 2026-10-13/);
  assert.equal(perq.missing_or_unverified, 'None');
  assert.equal(perq.official_final, 'Pending', 'the October 2-31 export through October 13 is not the official final');
  assert.equal(perq.status, 'In progress: verified through 2026-10-15; official final after 2026-11-01');

  const customers = find(rows, 'STORE-2026-10', 'Purchasing customers');
  assert.deepEqual([customers.verified_mtd, customers.verified_through, customers.daily_records_total], [54, '2026-10-15', 54]);
  const ratio = find(rows, 'STORE-2026-10', 'Closing ratio');
  assert.equal(ratio.verified_mtd, 0.486);
  assert.match(ratio.mtd_basis, /^54 purchasing customers ÷ 111 opportunities, both 2026-10-02 through 2026-10-15$/);

  const sales = find(rows, 'STORE-2026-10', 'Data Analysis Group 17 sales', 'written');
  assert.equal(sales.verified_mtd, 10000 + nwdsrWritten('2026-10-14') + nwdsrWritten('2026-10-15'));
  assert.equal(sales.daily_records_total, nwdsrWritten('2026-10-14') + nwdsrWritten('2026-10-15'), 'the day files alone cover only October 14 and 15');
  assert.match(sales.snapshot_coverage, /^2026-10-02 to 2026-10-13 \(DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-10-13\.xlsx\)$/);
  const fabric = find(rows, 'STORE-2026-10', 'Fabric protection', 'written');
  assert.deepEqual([fabric.verified_mtd, fabric.qualified, fabric.sold, fabric.daily_records_total], [0.7143, 14, 10, 0.5]);
  const delivered = find(rows, 'STORE-2026-10', 'Data Analysis Group 17 sales', 'delivered');
  assert.equal(delivered.verified_mtd, 'Pending', 'no Group 17 delivered report is on file, so nothing is shown as verified');

  const written = find(rows, 'STORE-2026-10', 'NWDSR Written');
  assert.equal(written.verified_mtd, dates('2026-10-02', '2026-10-15').reduce((total, date) => total + nwdsrWritten(date), 0));
  assert.equal(written.snapshot_coverage, 'None: single-day reports only');
});

test('store and salesperson months are separate and neither uses the other\'s records', () => {
  const rows = monthEnd(octoberBook(), '2026-10-16');
  assert.deepEqual([...new Set(rows.map((row) => `${row.track} ${row.period_key} ${row.period_start} ${row.period_end}`))], [
    'Store STORE-2026-10 2026-10-02 2026-11-01', 'Store STORE-2026-09 2026-09-02 2026-10-01', 'Person PERSON-2026-10 2026-10-01 2026-10-31',
  ]);
  const storeSnap = find(rows, 'STORE-2026-10', 'SNAP Written');
  assert.equal(storeSnap.verified_mtd, 14 * 900, 'October 1 SNAP belongs to the September store month');
  assert.equal(find(rows, 'STORE-2026-09', 'SNAP Written').verified_mtd, 'Pending', 'September 2-30 is not on file, so its store month is not verified');
  const eric = find(rows, 'PERSON-2026-10', 'SNAP Written', 'written', 'Eric Montes Rodriguez');
  assert.deepEqual([eric.verified_mtd, eric.verified_through, eric.employee_id], [950, '2026-10-15', 'EMON0904'], 'October 1 counts in the salesperson month');
  assert.equal(find(rows, 'PERSON-2026-10', 'SNAP Written', 'written', 'Renzo Del Solar').verified_mtd, -1330, 'a reported negative day stays on the day it was reported');
  assert.equal(rows.filter((row) => row.track === 'Person' && row.metric === 'Purchasing customers').length, 0, 'store customers are never given to a salesperson');
  assert.equal(rows.some((row) => row.person === 'Cordell Primous'), false, 'management is not a salesperson');
});

test('after the month the official final sits beside the verified month to date and is never added to it', () => {
  const tabs = octoberBook('2026-11-01');
  const tracked = dates('2026-10-02', '2026-11-01').reduce((total, date) => total + nwdsrWritten(date), 0);
  tabs.CC_Ledger!.push(ledgerRow('NWDSR_WRITTEN_STORE', 'cumulative', '2026-10-02', '2026-11-01', '2026-11-01', 'written', { sales: tracked - 120 }, 'NWDSR_WRITTEN_final.pdf'));
  tabs.CC_Ledger!.push(ledgerRow('NWDSR_DELIVERED_STORE', 'cumulative', '2026-10-02', '2026-11-01', '2026-11-01', 'delivered', { sales: 1 }, 'a.pdf + b.pdf'));
  tabs.CC_Ledger!.push(ledgerRow('SNAP_PERSON', 'cumulative', '2026-10-01', '2026-10-31', '2026-10-31', 'written', { sales: 1000 }, 'SNAP_final.pdf', '', 'Eric Montes Rodriguez'));
  tabs.CC_Closing!.push(closing('2026-11-01', 'store', '2026-10-02', '2026-11-01', '2026-11-01', 60, '', 'NWDSR Net Written # OF CUST'));
  let rows = monthEnd(tabs, '2026-11-03');
  const written = find(rows, 'STORE-2026-10', 'NWDSR Written');
  assert.deepEqual([written.verified_mtd, written.daily_records_total, written.official_final, written.variance], [tracked, tracked, tracked - 120, -120], 'the final is never added to the daily record');
  assert.equal(written.status, 'Variance: official final differs from verified month to date; explanation pending');
  assert.equal(find(rows, 'STORE-2026-10', 'NWDSR Delivered').official_final, 'Pending', 'a row the app calculated from several files is not an official final');
  const customers = find(rows, 'STORE-2026-10', 'Purchasing customers');
  assert.deepEqual([customers.verified_mtd, customers.official_final, customers.variance], [88, 60, -28], '52 through October 14, then 2 a day through November 1');
  const eric = find(rows, 'PERSON-2026-10', 'SNAP Written', 'written', 'Eric Montes Rodriguez');
  assert.deepEqual([eric.official_final, eric.variance], [1000, 50]);
  assert.equal(find(rows, 'PERSON-2026-10', 'SNAP Written', 'written', 'Renzo Del Solar').official_final, 0, 'a salesperson without a line on the official SNAP final had 0');
  assert.equal(rows.some((row) => row.track === 'Person' && row.metric === 'NWDSR Written'), false);

  tabs.CC_MonthEndNotes!.push(['STORE-2026-10', 'Store', 'NWDSR Written', 'written', '', 'Cancellation reported November 1 for an October 20 order.', 'GM', '2026-11-03']);
  rows = monthEnd(tabs, '2026-11-03');
  const explained = find(rows, 'STORE-2026-10', 'NWDSR Written');
  assert.deepEqual([explained.explanation, explained.status], ['Cancellation reported November 1 for an October 20 order.', 'Variance: official final differs from verified month to date']);

  tabs.CC_Daily = tabs.CC_Daily!.filter((row) => row[0] !== '2026-10-20');
  rows = monthEnd(tabs, '2026-11-03');
  const gap = find(rows, 'STORE-2026-10', 'NWDSR Written');
  assert.deepEqual([gap.verified_through, gap.variance, gap.missing_or_unverified], ['2026-10-19', '', 'Missing: 2026-10-20']);
  assert.equal(gap.status, 'Official final on file; daily record verified through 2026-10-19, so no variance');
  assert.equal(gap.daily_records_total, tracked - nwdsrWritten('2026-10-20'), 'the daily records still show what is on file, not a month to date');
});
