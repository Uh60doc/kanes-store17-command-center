import assert from 'node:assert/strict';
import test from 'node:test';
import { moneyFromCell } from '../domain/money.ts';
import { buildStoreDashboard } from './model.ts';
import type { ReportSnapshot } from '../import/types.ts';

function snap(overrides: Partial<ReportSnapshot>): ReportSnapshot {
  return {
    id: 'id',
    reportType: 'SNAP Written',
    sourceTitle: 'SNAP',
    storeNumber: 17,
    periodStart: '2026-10-02',
    periodEnd: '2026-10-02',
    calendar: 'store-operating',
    generatedAt: '2026-10-10T16:00',
    importedAt: '2026-10-13T00:00:00.000Z',
    provisional: false,
    status: 'current',
    supersedes: null,
    source: 'manual-upload',
    fileName: 'snap.pdf',
    sha256: 'sha',
    messageId: null,
    precision: 'whole_dollar',
    metrics: { writtenSales: 10 },
    associates: [],
    projections: [],
    daily: [{ date: '2026-10-02', amount: 10 }],
    issues: [],
    ...overrides,
  };
}

test('a totals label in front of an amount still reads the amount', () => {
  assert.equal(moneyFromCell('Store Totals: 1,234')?.cents, 123400);
});

test('the store headline uses the cumulative report, and the daily chart uses single days', () => {
  const model = buildStoreDashboard([
    snap({ id: 'day', sha256: 'day', metrics: { writtenSales: 10 }, daily: [{ date: '2026-10-02', amount: 10 }] }),
    snap({
      id: 'month',
      sha256: 'month',
      periodEnd: '2026-10-11',
      generatedAt: '2026-10-11T15:10',
      metrics: { writtenSales: 80 },
      daily: [],
    }),
  ]);
  assert.equal(model.snapWritten.kind, 'value');
  if (model.snapWritten.kind === 'value') assert.equal(model.snapWritten.value, 80);
  assert.deepEqual(model.dailySales, [{ date: '2026-10-02', amount: 10 }]);
  assert.deepEqual(model.monthToDate, [{ date: '2026-10-02', amount: 10 }]);
});
