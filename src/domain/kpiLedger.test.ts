import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRecords, attachmentFromDaily, latestCumulative, makeRecord, sumDaily, type LedgerRecord } from './kpiLedger.ts';

function day(date: string, dollars: number, source = 'day.pdf'): LedgerRecord {
  return makeRecord({
    view: 'SNAP_STORE',
    grain: 'daily',
    reportDate: date,
    periodStart: date,
    periodEnd: date,
    verifiedThrough: date,
    store: '17',
    employeeCode: '',
    employeeName: '',
    side: 'written',
    salesDollars: dollars,
    unitCount: null,
    eligible: null,
    attachments: null,
    sourceReport: source,
  });
}

test('a positive day increases the total and a negative day decreases it', () => {
  const first = applyRecords([], [day('2026-10-02', 1000), day('2026-10-03', 500)]);
  assert.equal(sumDaily(first, 'SNAP_STORE', 'written', '2026-10-02', '2026-11-01', 'salesDollars'), 1500);
  const withReturn = applyRecords(first, [day('2026-10-04', -200)]);
  assert.equal(sumDaily(withReturn, 'SNAP_STORE', 'written', '2026-10-02', '2026-11-01', 'salesDollars'), 1300);
});

test('reimporting the same report does not change the total', () => {
  const first = applyRecords([], [day('2026-10-13', 6686, 'snap.pdf')]);
  const again = applyRecords(first, [day('2026-10-13', 6686, 'snap.pdf')]);
  assert.equal(again.length, 1);
  assert.equal(sumDaily(again, 'SNAP_STORE', 'written', '2026-10-02', '2026-11-01', 'salesDollars'), 6686);
});

test('a corrected report replaces the day instead of adding to it', () => {
  const first = applyRecords([], [day('2026-10-12', 4000, 'first.pdf')]);
  const corrected = applyRecords(first, [day('2026-10-12', 4361, 'corrected.pdf')]);
  assert.equal(corrected.length, 1);
  assert.equal(corrected[0]?.salesDollars, 4361);
  assert.equal(sumDaily(corrected, 'SNAP_STORE', 'written', '2026-10-02', '2026-11-01', 'salesDollars'), 4361);
});

test('revising an earlier date changes the monthly total', () => {
  const base = applyRecords([], [day('2026-10-02', -284), day('2026-10-03', 1000)]);
  const revised = applyRecords(base, [day('2026-10-02', -300)]);
  assert.equal(sumDaily(revised, 'SNAP_STORE', 'written', '2026-10-02', '2026-11-01', 'salesDollars'), 700);
});

test('monthly attachment uses the counts and ignores a cumulative snapshot', () => {
  const daily = [
    makeRecord({
      view: 'MPPA_STORE', grain: 'daily', reportDate: '2026-10-02', periodStart: '2026-10-02', periodEnd: '2026-10-02',
      verifiedThrough: '2026-10-02', store: '17', employeeCode: '', employeeName: '', side: 'written',
      salesDollars: null, unitCount: 1, eligible: 4, attachments: 1, sourceReport: 'day-a',
    }),
    makeRecord({
      view: 'MPPA_STORE', grain: 'daily', reportDate: '2026-10-03', periodStart: '2026-10-03', periodEnd: '2026-10-03',
      verifiedThrough: '2026-10-03', store: '17', employeeCode: '', employeeName: '', side: 'written',
      salesDollars: null, unitCount: 2, eligible: 5, attachments: 2, sourceReport: 'day-b',
    }),
  ];
  const measured = attachmentFromDaily(daily, 'MPPA_STORE', 'written', '2026-10-02', '2026-11-01');
  assert.equal(measured.eligible, 9);
  assert.equal(measured.attachments, 3);
  assert.equal(measured.percent, 0.333);
  const withSnapshot = applyRecords(daily, [makeRecord({
    view: 'MPPA_STORE', grain: 'cumulative', reportDate: '', periodStart: '2026-10-02', periodEnd: '2026-10-11',
    verifiedThrough: '2026-10-11', store: '17', employeeCode: '', employeeName: '', side: 'written',
    salesDollars: null, unitCount: 3, eligible: 9, attachments: 3, sourceReport: 'MPPA_WRITTEN.pdf',
  })]);
  assert.equal(attachmentFromDaily(withSnapshot, 'MPPA_STORE', 'written', '2026-10-02', '2026-11-01').attachments, 3);
  assert.equal(latestCumulative(withSnapshot, 'MPPA_STORE', 'written')?.eligible, 9);
});

test('October 1 stays on the salesperson records and out of the store daily sum', () => {
  const records = [
    day('2026-10-01', 500),
    day('2026-10-02', 100),
  ];
  assert.equal(sumDaily(records, 'SNAP_STORE', 'written', '2026-10-02', '2026-11-01', 'salesDollars'), 100);
  assert.equal(sumDaily(records, 'SNAP_STORE', 'written', '2026-10-01', '2026-10-31', 'salesDollars'), 600);
});
