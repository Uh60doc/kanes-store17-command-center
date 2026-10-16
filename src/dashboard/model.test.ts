import assert from 'node:assert/strict';
import test from 'node:test';
import { storeOperatingPeriod } from '../config/periods.ts';
import { moneyFromCell } from '../domain/money.ts';
import { buildStoreDashboard, type DashboardClock } from './model.ts';
import type { ReportSnapshot } from '../import/types.ts';
import type { PerqEvidence } from '../reference/perqReference.ts';

const octoberClock: DashboardClock = { asOf: '2026-10-14' };

function octoberDashboard(
  snapshots: readonly ReportSnapshot[],
  reference: PerqEvidence | null = null,
  issues: readonly string[] = [],
  clock: DashboardClock = octoberClock,
) {
  return buildStoreDashboard(snapshots, reference, issues, clock);
}
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
  const model = octoberDashboard([
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
  const model = octoberDashboard([
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

function locationSnapshot(start: string, end: string, total: number, finalMonth: boolean): PerqEvidence {
  return {
    snapshotMetadata: [
      {
        id: 'location',
        filter_start: start,
        filter_end: end,
        report_level: 'location',
        reported_total: total,
        source: 'location.png',
        source_run_time: 'UNKNOWN',
        coverage: 'test',
        location: 'Store 17',
        measure: 'Ups + Be Backs',
        is_final_month_end: finalMonth,
      },
    ],
    employeeSnapshotRows: [],
  };
}

test('a shorter PERQ window is not the store closing denominator', () => {
  const perq = locationSnapshot('2026-10-02', '2026-10-31', 10, false);
  const model = octoberDashboard(
    [
      snap({
        id: 'written',
        sha256: 'written',
        reportType: 'NWDSR Written',
        periodStart: '2026-10-02',
        periodEnd: '2026-11-01',
        metrics: { writtenSales: 80, writtenCustomers: 20 },
        daily: [],
      }),
    ],
    perq,
  );
  assert.equal(model.closingRatio.kind, 'missing');
  assert.equal(model.closingCustomers.kind, 'value');
  if (model.closingCustomers.kind === 'value') assert.equal(model.closingCustomers.value, 20);
  assert.equal(model.closingOpportunities.kind, 'missing');
  assert.equal(model.perq.windows[0]?.opportunities, 10);
});

test('delivered customer counts are not the closing numerator', () => {
  const perq = locationSnapshot('2026-10-02', '2026-11-01', 50, true);
  const model = octoberDashboard(
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
  assert.equal(model.closingRatio.kind, 'missing');
  assert.equal(model.closingCustomers.kind, 'missing');
});

test('contiguous single days replace an earlier cumulative snapshot', () => {
  const model = octoberDashboard([
    snap({ id: 'day2', sha256: 'day2', metrics: { writtenSales: 10 }, daily: [{ date: '2026-10-02', amount: 10 }] }),
    snap({
      id: 'day3',
      sha256: 'day3',
      periodStart: '2026-10-03',
      periodEnd: '2026-10-03',
      metrics: { writtenSales: 4 },
      daily: [{ date: '2026-10-03', amount: 4 }],
    }),
    snap({
      id: 'month',
      sha256: 'month',
      periodEnd: '2026-10-03',
      generatedAt: '2026-10-03T15:10',
      metrics: { writtenSales: 80 },
      daily: [],
    }),
  ]);
  assert.equal(model.snapWritten.kind, 'value');
  if (model.snapWritten.kind === 'value') assert.equal(model.snapWritten.value, 14);
  assert.equal(model.writtenRemaining.kind, 'value');
  if (model.writtenRemaining.kind === 'value') assert.equal(model.writtenRemaining.value, 400_000 - 14);
  assert.equal(storeOperatingPeriod.managementGoals.writtenSales, 400_000);
  assert.equal(model.daysRemaining.kind, 'value');
  if (model.daysRemaining.kind === 'value') assert.equal(model.daysRemaining.value, 19);
  assert.equal(model.officialWrittenGoal, 400_000);
  assert.equal(model.weekWrittenTarget.kind, 'missing');
  const closed = octoberDashboard(
    [
      snap({ id: 'day2', sha256: 'day2', metrics: { writtenSales: 10 }, daily: [{ date: '2026-10-02', amount: 10 }] }),
      snap({
        id: 'day3',
        sha256: 'day3',
        periodStart: '2026-10-03',
        periodEnd: '2026-10-03',
        metrics: { writtenSales: 4 },
        daily: [{ date: '2026-10-03', amount: 4 }],
      }),
    ],
    null,
    [],
    { asOf: '2026-10-14', closedDates: ['2026-10-15'] },
  );
  if (closed.daysRemaining.kind === 'value') assert.equal(closed.daysRemaining.value, 18);
  assert.equal(closed.officialWrittenGoal, 400_000);
});

test('a later month does not inherit the October budget', () => {
  const model = buildStoreDashboard(
    [snap({ id: 'oct2', sha256: 'oct2', metrics: { writtenSales: 10 }, daily: [{ date: '2026-10-02', amount: 10 }] })],
    null,
    [],
    { asOf: '2026-11-02' },
  );
  assert.equal(model.storePeriodLabel, 'November 2–December 1, 2026');
  assert.equal(model.individualPeriodLabel, 'November 1–30, 2026');
  assert.equal(model.officialWrittenGoal, null);
  assert.equal(model.officialDeliveredGoal, null);
  assert.equal(model.todayWrittenTarget.kind, 'missing');
  assert.equal(model.snapWritten.kind, 'missing');
  assert.equal(storeOperatingPeriod.managementGoals.writtenSales, 400_000);
  if (model.daysRemaining.kind === 'value') assert.equal(model.daysRemaining.value, 30);
});

test('November 1 stays on the October store calendar and opens the November salesperson calendar', () => {
  const model = octoberDashboard(
    [
      snap({ id: 'oct1', sha256: 'oct1', periodStart: '2026-10-01', periodEnd: '2026-10-01', metrics: { writtenSales: 4 }, daily: [{ date: '2026-10-01', amount: 4 }] }),
      snap({ id: 'nov1', sha256: 'nov1', periodStart: '2026-11-01', periodEnd: '2026-11-01', metrics: { writtenSales: 7 }, daily: [{ date: '2026-11-01', amount: 7 }] }),
    ],
    null,
    [],
    { asOf: '2026-11-01' },
  );
  assert.equal(model.storePeriodLabel, 'October 2–November 1, 2026');
  assert.equal(model.individualPeriodLabel, 'November 1–30, 2026');
  assert.deepEqual(
    model.storeDaily.map((row) => row.date),
    ['2026-11-01'],
  );
  assert.deepEqual(
    model.individualDaily.map((row) => row.date),
    ['2026-11-01'],
  );
  assert.equal(model.storeDaily.some((row) => row.date === '2026-10-01'), false);
});

test('October 2 negative written sales stay negative and keep every printed line', () => {
  const model = octoberDashboard([
    snap({
      id: 'oct2',
      sha256: 'oct2',
      metrics: { writtenSales: -284 },
      associates: [
        { employeeCode: 'RDELSO', sourceName: 'RENZO DEL SOLAR', displayName: 'Renzo Del Solar', role: 'associate', onCard: true, note: '', totalSalesCents: -133000, bedSalesCents: null, precision: 'whole_dollar' },
        { employeeCode: 'TNASSI', sourceName: 'TARIK NASSIF', displayName: 'Ricky Nassif', role: 'associate', onCard: true, note: '', totalSalesCents: -26000, bedSalesCents: null, precision: 'whole_dollar' },
        { employeeCode: 'EMON0904', sourceName: 'ERIC MONTES', displayName: 'Eric Montes Rodriguez', role: 'associate', onCard: true, note: '', totalSalesCents: 45000, bedSalesCents: null, precision: 'whole_dollar' },
        { employeeCode: 'JMEYERS', sourceName: 'JAMES MEYERS', displayName: 'Kelly Meyers', role: 'management', onCard: false, note: '', totalSalesCents: 85600, bedSalesCents: null, precision: 'whole_dollar' },
      ],
    }),
  ]);
  assert.equal(model.snapWritten.kind, 'value');
  if (model.snapWritten.kind === 'value') assert.equal(model.snapWritten.value, -284);
  assert.equal(model.negativeWrittenDays[0]?.storeTotal, -284);
  assert.deepEqual(
    model.negativeWrittenDays[0]?.lines.map((line) => [line.displayName, line.amount]),
    [
      ['Renzo Del Solar', -1330],
      ['Ricky Nassif', -260],
      ['Eric Montes Rodriguez', 450],
      ['Kelly Meyers', 856],
    ],
  );
  assert.equal(model.salesTeam.some((person) => person.displayName === 'Kelly Meyers'), false);
  const renzo = model.salesTeam.find((person) => person.displayName === 'Renzo Del Solar');
  assert.equal(renzo?.writtenSales, -1330);
});

test('manager and unrecognized written lines stay out of the salesperson cards', () => {
  const model = octoberDashboard([
    snap({
      id: 'lines',
      sha256: 'lines',
      metrics: { writtenSales: 30 },
      associates: [
        { employeeCode: 'EMON0904', sourceName: 'ERIC MONTES', displayName: 'Eric Montes Rodriguez', role: 'associate', onCard: true, note: '', totalSalesCents: 2000, bedSalesCents: null, precision: 'whole_dollar' },
        { employeeCode: 'JMEYERS', sourceName: 'JAMES MEYERS', displayName: 'Kelly Meyers', role: 'management', onCard: false, note: '', totalSalesCents: 500, bedSalesCents: null, precision: 'whole_dollar' },
        { employeeCode: null, sourceName: 'MUKHTAR JUNAID', displayName: 'Mukhtar Junaid', role: 'unknown', onCard: false, note: '', totalSalesCents: 500, bedSalesCents: null, precision: 'whole_dollar' },
      ],
    }),
  ]);
  const eric = model.salesTeam.find((person) => person.displayName === 'Eric Montes Rodriguez');
  assert.equal(eric?.writtenSales, 20);
  assert.equal(model.salesTeam.some((person) => person.displayName === 'Kelly Meyers'), false);
  assert.equal(model.salesTeam.some((person) => person.displayName === 'Mukhtar Junaid'), false);
  assert.match(model.boardNotes.join(' '), /Mukhtar Junaid/);
  assert.equal(model.boardNotes.join(' ').includes('Kelly'), false);
});

test('closing ratio uses Net Written customers and the full store-month PERQ', () => {
  const perq = locationSnapshot('2026-10-02', '2026-11-01', 50, true);
  const model = octoberDashboard(
    [
      snap({
        id: 'written',
        sha256: 'written',
        reportType: 'NWDSR Written',
        periodStart: '2026-10-02',
        periodEnd: '2026-11-01',
        metrics: { writtenSales: 1, writtenCustomers: 25 },
        daily: [],
      }),
    ],
    perq,
  );
  assert.equal(model.closingRatio.kind, 'value');
  if (model.closingRatio.kind === 'value') assert.equal(model.closingRatio.value, 0.5);
  assert.equal(model.closingReconciliation, false);
  assert.equal(storeOperatingPeriod.managementGoals.closingRatioTarget, 0.5);
  if (model.closingRatio.kind === 'value') {
    assert.equal(model.closingRatio.value, storeOperatingPeriod.managementGoals.closingRatioTarget);
  }
});
