import assert from 'node:assert/strict';
import test from 'node:test';
import { currentSnapshots, placeSnapshot, resetSnapshots } from './snapshotStore.ts';
import type { ReportSnapshot } from './types.ts';

function sample(overrides: Partial<ReportSnapshot>): ReportSnapshot {
  return {
    id: overrides.sha256 ?? 'sha',
    reportType: 'SNAP Written',
    sourceTitle: 'SNAP',
    storeNumber: 17,
    periodStart: '2026-10-10',
    periodEnd: '2026-10-10',
    calendar: 'store-operating',
    generatedAt: '2026-10-10T20:00',
    importedAt: '2026-10-13T00:00:00.000Z',
    provisional: false,
    status: 'current',
    supersedes: null,
    source: 'manual-upload',
    fileName: 'snap.pdf',
    sha256: 'sha-a',
    messageId: null,
    precision: 'whole_dollar',
    metrics: { writtenSales: 100 },
    associates: [],
    projections: [],
    daily: [{ date: '2026-10-10', amount: 100 }],
    issues: [],
    ...overrides,
  };
}

test('the same file hash does not add a second current total', () => {
  resetSnapshots();
  const first = placeSnapshot(sample({ sha256: 'same', id: 'same', metrics: { writtenSales: 100 } }));
  const second = placeSnapshot(sample({ sha256: 'same', id: 'same', metrics: { writtenSales: 999 } }));
  assert.equal(first.action, 'committed');
  assert.equal(second.action, 'duplicate');
  assert.equal(currentSnapshots()[0]?.metrics.writtenSales, 100);
});

test('a later generation time replaces the current row without adding the totals', () => {
  resetSnapshots();
  placeSnapshot(sample({ sha256: 'early', id: 'early', generatedAt: '2026-10-10T16:00', metrics: { writtenSales: 100 } }));
  const next = placeSnapshot(sample({ sha256: 'late', id: 'late', generatedAt: '2026-10-10T20:00', metrics: { writtenSales: 120 } }));
  assert.equal(next.action, 'committed');
  const current = currentSnapshots();
  assert.equal(current.length, 1);
  assert.equal(current[0]?.metrics.writtenSales, 120);
  assert.equal(current[0]?.supersedes, 'early');
});

test('the same generation time with a different file does not replace the current row', () => {
  resetSnapshots();
  placeSnapshot(sample({ sha256: 'one', id: 'one' }));
  const conflict = placeSnapshot(sample({ sha256: 'two', id: 'two' }));
  assert.equal(conflict.action, 'kept-current');
  if (conflict.action === 'kept-current') assert.equal(conflict.reason, 'same-time-different-file');
  assert.equal(currentSnapshots().length, 0);
});

test('a missing generation time does not replace a current total', () => {
  resetSnapshots();
  placeSnapshot(sample({ sha256: 'known', id: 'known', metrics: { writtenSales: 100 } }));
  const review = placeSnapshot(sample({ sha256: 'unknown', id: 'unknown', generatedAt: null, metrics: { writtenSales: 500 } }));
  assert.equal(review.action, 'kept-current');
  if (review.action === 'kept-current') assert.equal(review.reason, 'missing-generated-time');
  assert.equal(currentSnapshots()[0]?.metrics.writtenSales, 100);
});
