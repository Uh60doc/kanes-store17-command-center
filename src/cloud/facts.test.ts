import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDailyAmount, requiredPace, sellingDaysRemaining, sumColumn, type DailyFact } from './facts.ts';
import { parseReportText } from './reportText.ts';

const october: DailyFact[] = [
  { date: '2026-10-02', snapWritten: -284, nwdsrWritten: 1306, nwdsrDelivered: 11574 },
  { date: '2026-10-12', snapWritten: 4361, nwdsrWritten: 4361, nwdsrDelivered: 1370 },
];

test('a negative written day stays negative and blank days are not zeroes', () => {
  assert.equal(sumColumn(october, 'snapWritten', '2026-10-02', '2026-11-01'), 4077);
  assert.equal(sumColumn([{ date: '2026-10-03', snapWritten: null, nwdsrWritten: null, nwdsrDelivered: null }], 'snapWritten', '2026-10-02', '2026-11-01'), null);
});

test('the monthly goal is not replaced when the daily pace changes', () => {
  const first = requiredPace(300_000, 200_000, 10);
  assert.deepEqual(first, { remaining: 100_000, pace: 10_000 });
  const after = requiredPace(300_000, 220_000, 9);
  assert.deepEqual(after, { remaining: 80_000, pace: 8888.89 });
  assert.equal(requiredPace(400_000, 90_594, null).pace, null);
  assert.equal(requiredPace(400_000, 90_594, null).remaining, 309_406);
});

test('an empty selling calendar is not treated as zero days left', () => {
  assert.equal(sellingDaysRemaining([], '2026-10-14', '2026-11-01'), null);
  assert.equal(
    sellingDaysRemaining(
      [
        { date: '2026-10-13', selling: true },
        { date: '2026-10-14', selling: true },
        { date: '2026-10-15', selling: false },
      ],
      '2026-10-14',
      '2026-11-01',
    ),
    1,
  );
});

test('the same file cannot be added twice and a conflicting file does not add onto the day', () => {
  const first = applyDailyAmount([], { date: '2026-10-12', field: 'snapWritten', amount: 4361, sha256: 'abc' }, new Set());
  assert.equal(first.decision, 'imported');
  assert.equal(first.rows[0]?.snapWritten, 4361);
  const again = applyDailyAmount(first.rows, { date: '2026-10-12', field: 'snapWritten', amount: 4361, sha256: 'abc' }, new Set(['abc']));
  assert.equal(again.decision, 'duplicate');
  assert.equal(again.rows[0]?.snapWritten, 4361);
  const conflict = applyDailyAmount(first.rows, { date: '2026-10-12', field: 'snapWritten', amount: 9999, sha256: 'def' }, new Set(['abc']));
  assert.equal(conflict.decision, 'conflict');
  assert.equal(conflict.rows[0]?.snapWritten, 4361);
});

test('store 17 totals are read and store 10 is ignored', () => {
  const snap = parseReportText(`SNAP - WRITTEN SALES RANKING REPORT
FROM 02-OCT-2026 TO 02-OCT-2026
10 - ORLANDO Totals: 0.0 200 200
DELSOLAR, RENZO -1,330 -1,330
17 - ORLANDO Totals: -101.4 -284 -71 0.0`);
  assert.equal(snap?.storeTotal, -284);
  assert.equal(snap?.singleDay, true);
  assert.equal(snap?.associates[0]?.amount, -1330);
  const delivered = parseReportText(`DELIVERED STORE SALES RANKING REPORT
FROM 11-OCT-2026 TO 11-OCT-2026
KANE FURNITURE #17 Totals: 1,187 99.3 5`);
  assert.equal(delivered?.reportType, 'NWDSR Delivered');
  assert.equal(delivered?.storeTotal, 1187);
  const cumulative = parseReportText(`NET WRITTEN STORE SALES RANKING REPORT
FROM 02-OCT-2026 TO 11-OCT-2026
KANE FURNITURE #17 Totals: 93,740 10`);
  assert.equal(cumulative?.singleDay, false);
  assert.equal(cumulative?.storeTotal, 93740);
});
