/**
 * November 2025 last-year days on a copy of the October workbook. Production is never opened.
 * Thanksgiving is closed. SNAP stays at the verified zero. No NWDSR row is invented for that day.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness } from './octoberVerified.ts';

test('November 1 stays in the October store month and Thanksgiving is closed, not a missing report', () => {
  const { gs, tabs, setToday } = harness();
  setToday('2026-11-15');
  tabs.CC_SellingDays = [['date', 'selling'], ['2025-11-27', 'closed']];
  tabs.CC_Config!.push(['prior_year_start_2026-11', '2025-11-02']);
  tabs.CC_Config!.push(['prior_year_end_2026-11', '2025-12-01']);

  const octoberStore = plain(gs.storePeriodContaining_('2025-11-01'));
  const novemberStore = plain(gs.storePeriodContaining_('2025-11-02'));
  const decemberEdge = plain(gs.storePeriodContaining_('2025-12-01'));
  const salespersonNovember = plain(gs.individualPeriodContaining_('2025-11-01'));
  const salespersonDecember = plain(gs.individualPeriodContaining_('2025-12-01'));
  const nextNovember = plain(gs.storePeriodContaining_('2026-11-02'));
  const nextOctoberEdge = plain(gs.storePeriodContaining_('2026-11-01'));
  assert.equal(octoberStore.start, '2025-10-02');
  assert.equal(octoberStore.end, '2025-11-01');
  assert.equal(novemberStore.start, '2025-11-02');
  assert.equal(novemberStore.end, '2025-12-01');
  assert.deepEqual(decemberEdge, novemberStore);
  assert.equal(salespersonNovember.start, '2025-11-01');
  assert.equal(salespersonNovember.end, '2025-11-30');
  assert.equal(salespersonDecember.start, '2025-12-01');
  assert.equal(nextOctoberEdge.end, '2026-11-01');
  assert.equal(nextNovember.start, '2026-11-02');
  assert.equal(nextNovember.end, '2026-12-01');

  const dates = gs.eachDate_('2025-11-02', '2025-12-01') as string[];
  assert.equal(dates.length, 30);
  assert.equal(dates.includes('2025-11-27'), true);
  dates.forEach((date) => {
    if (!gs.historicalAmount_('SNAP Written', date)) {
      gs.recordHistoricalDay_({
        metric: 'SNAP Written', date, dollars: date === '2025-11-27' ? 0 : 10,
        source: 'november-test.pdf', verification: date === '2025-11-27' ? 'Verified zero' : 'Verified', note: '',
      });
    }
    if (date === '2025-11-27') return;
    if (!gs.historicalAmount_('NWDSR Written', date)) {
      gs.recordHistoricalDay_({ metric: 'NWDSR Written', date, dollars: 20, source: 'november-test.pdf', verification: 'Verified', note: '' });
    }
    if (!gs.historicalAmount_('NWDSR Delivered', date)) {
      gs.recordHistoricalDay_({ metric: 'NWDSR Delivered', date, dollars: 30, source: 'november-test.pdf', verification: 'Verified', note: '' });
    }
  });

  const snapClosed = plain(gs.historicalAmount_('SNAP Written', '2025-11-27'));
  assert.equal(snapClosed.dollars, 0);
  assert.equal(gs.historicalAmount_('NWDSR Written', '2025-11-27'), null);
  assert.equal(gs.historicalAmount_('NWDSR Delivered', '2025-11-27'), null);

  const facts = gs.dailyFacts_();
  const written = plain(gs.reportLySeries_(facts, dates, 'nwdsrWritten', 'NWDSR Written'));
  const delivered = plain(gs.reportLySeries_(facts, dates, 'nwdsrDelivered', 'NWDSR Delivered'));
  const snap = plain(gs.reportLySeries_(facts, dates, 'snapWritten', 'SNAP Written'));
  assert.equal(written.pending, false);
  assert.equal(delivered.pending, false);
  assert.equal(snap.pending, false);
  assert.equal(written.missing.length, 0);
  assert.match(written.source, /Closed, not a missing report: 2025-11-27/);
  assert.doesNotMatch(written.source, /Missing NWDSR Written for 2025-11-27/);
  assert.match(delivered.source, /Closed, not a missing report: 2025-11-27/);
  assert.equal(snap.value >= 0, true);

  const ly = plain(gs.storeLastYear_(gs.config_(), nextNovember));
  assert.equal(ly.confirmed, true);
  assert.equal(ly.start, '2025-11-02');
  assert.equal(ly.end, '2025-12-01');
  const comparison = plain(gs.reportMonthSnapLy_(facts, gs.closedDates_(), nextNovember, '2026-12-02'));
  assert.match(comparison.nwdsrLySource, /Closed, not a missing report: 2025-11-27/);
  assert.doesNotMatch(comparison.nwdsrLySource, /Missing/);
  assert.equal(comparison.nwdsrLy !== 'Pending', true);

  const coverage = plain(gs.writeMetricCoverage_());
  const writtenCoverage = (tabs.CC_MetricCoverage || []).find((row) => row[0] === 'Store written sales');
  assert.match(String(writtenCoverage && writtenCoverage[3]), /Closed, not a missing report: 2025-11-27/);
  assert.doesNotMatch(String(writtenCoverage && writtenCoverage[3]), /Missing 2025-11-27/);
  assert.equal(coverage.rows > 0, true);
});
