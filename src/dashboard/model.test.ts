import assert from 'node:assert/strict';
import test from 'node:test';
import { moneyFromCell } from '../domain/money.ts';
import { buildStoreDashboard } from './model.ts';
import type { ReportSnapshot } from '../import/types.ts';
import type { VerifiedPerqReference } from '../reference/perqReference.ts';

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
  assert.equal(model.closingRatio.kind, 'missing');
});

test('October 1 stays on the individual calendar and November 1 stays on the store calendar', () => {
  const model = buildStoreDashboard([
    snap({ id: 'oct1', sha256: 'oct1', periodStart: '2026-10-01', periodEnd: '2026-10-01', metrics: { writtenSales: 4 }, daily: [{ date: '2026-10-01', amount: 4 }] }),
    snap({ id: 'oct2', sha256: 'oct2', metrics: { writtenSales: 10 }, daily: [{ date: '2026-10-02', amount: 10 }] }),
    snap({ id: 'nov1', sha256: 'nov1', periodStart: '2026-11-01', periodEnd: '2026-11-01', metrics: { writtenSales: 7 }, daily: [{ date: '2026-11-01', amount: 7 }] }),
  ]);
  assert.deepEqual(
    model.storeDaily.map((row) => [row.date, row.amount, row.runningTotal]),
    [
      ['2026-10-02', 10, 10],
      ['2026-11-01', 7, 17],
    ],
  );
  assert.deepEqual(
    model.individualDaily.map((row) => [row.date, row.amount, row.runningTotal]),
    [
      ['2026-10-01', 4, 4],
      ['2026-10-02', 10, 14],
    ],
  );
  assert.equal(model.storeDaily.reduce((total, row) => total + row.amount, 0), 17);
  assert.equal(model.individualDaily.reduce((total, row) => total + row.amount, 0), 14);
});

test('a shorter PERQ window is not the store closing denominator', () => {
  const perq: VerifiedPerqReference = {
    snapshots: [
      {
        id: 'window',
        periodStart: '2026-10-02',
        periodEnd: '2026-10-31',
        opportunities: 10,
        lines: [{ sourceName: 'Eric Montes', opportunities: 10 }],
        additions: [],
      },
    ],
  };
  const model = buildStoreDashboard(
    [
      snap({
        id: 'delivered',
        sha256: 'delivered',
        reportType: 'NWDSR Delivered',
        periodStart: '2026-10-02',
        periodEnd: '2026-10-11',
        metrics: { deliveredSales: 80, closedCustomers: 5 },
        daily: [],
      }),
    ],
    perq,
  );
  assert.equal(model.closingRatio.kind, 'missing');
  assert.equal(model.perq.windows[0]?.opportunities, 10);
});

test('closing ratio uses the full store month only when both inputs share it', () => {
  const perq: VerifiedPerqReference = {
    snapshots: [
      {
        id: 'store-month',
        periodStart: '2026-10-02',
        periodEnd: '2026-11-01',
        opportunities: 50,
        lines: [{ sourceName: 'Eric Montes', opportunities: 50 }],
        additions: [],
      },
    ],
  };
  const model = buildStoreDashboard(
    [
      snap({
        id: 'delivered',
        sha256: 'delivered',
        reportType: 'NWDSR Delivered',
        periodStart: '2026-10-02',
        periodEnd: '2026-11-01',
        metrics: { deliveredSales: 1, closedCustomers: 20 },
        daily: [],
      }),
    ],
    perq,
  );
  assert.equal(model.closingRatio.kind, 'value');
  if (model.closingRatio.kind === 'value') assert.equal(model.closingRatio.value, 0.4);
});
