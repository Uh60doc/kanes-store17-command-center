/**
 * October 16 is on file for NWDSR Written and SNAP Written only. Delivered and PERQ stay pending,
 * and each source keeps its own verified-through date. Totals stay the existing daily sums.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

test('October 16 written shows with its own date while delivered and closing stay through October 15', () => {
  const { gs } = harness();
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-16', storeTotal: 10495 }), 'imported');
  assert.equal(gs.writeDailyAmount_({ reportType: 'SNAP Written', start: '2026-10-16', storeTotal: 7432 }), 'imported');
  const home = plain(gs.home_({ session }));
  assert.equal(home.today, '2026-10-17');
  assert.equal(home.yesterday.date, '2026-10-16');
  assert.equal(home.yesterday.missing, false);
  assert.equal(home.yesterday.written, 10495);
  assert.equal(home.yesterday.delivered, null);
  assert.equal(home.yesterday.snapWritten, 7432);
  assert.equal(home.yesterday.snapVariance, -3063);
  assert.equal(home.month.written, 120488);
  assert.equal(home.board.month.written, 120488);
  assert.equal(home.month.delivered, 104220);
  assert.equal(home.board.month.delivered, 104220);
  assert.deepEqual(home.freshness.written, { through: '2026-10-16', day: 10495, mtd: 120488 });
  assert.equal(home.freshness.snap.day, 7432);
  assert.equal(home.freshness.snap.through, '2026-10-16');
  assert.deepEqual(home.freshness.delivered, { through: '2026-10-15', day: null, mtd: 104220 });
  assert.equal(home.freshness.closing.through, '2026-10-15');
  const october16 = home.freshness.pending.find((day: { date: string }) => day.date === '2026-10-16');
  assert.ok(october16, 'October 16 is listed as partial');
  assert.deepEqual(october16.reports, ['NWDSR Delivered', 'PERQ']);
  assert.ok(!home.attention.some((item: string) => /incomplete for 2026-10-16/.test(item)));
  const closing = home.board.kpis.find((row: { name: string }) => row.name === 'Closing Ratio');
  assert.equal(closing.through, '2026-10-15');
  assert.equal(closing.written, 0.486);
  const bedding = home.board.kpis.find((row: { name: string }) => row.name === 'Bedding');
  assert.ok(!bedding.deliveredThrough || bedding.deliveredThrough <= '2026-10-15', bedding.deliveredThrough);
  const people = plain(gs.people_({ session }));
  assert.equal(people.deliveredVariance.storeDelivered, home.month.delivered);
  assert.equal(people.deliveredVariance.storeDeliveredThrough, '2026-10-15');
  const daily = plain(gs.daily_({ session }));
  const day = daily.days.find((row: { date: string }) => row.date === '2026-10-16');
  assert.equal(day.nwdsrWritten, 10495);
  assert.equal(day.snapWritten, 7432);
  assert.equal(day.nwdsrDelivered, null);
  assert.equal(daily.closing.through, '2026-10-15');
});
