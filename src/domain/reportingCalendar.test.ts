import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterByCategory,
  individualPeriodContaining,
  lastCalendarDay,
  periodFor,
  storePeriodContaining,
} from './reportingCalendar.ts';

test('store and individual calendars meet at the month boundary', () => {
  const cases = [
    {
      name: 'October',
      store: ['2026-10-02', '2026-11-01'],
      individual: ['2026-10-01', '2026-10-31'],
    },
    {
      name: 'January',
      store: ['2026-01-02', '2026-02-01'],
      individual: ['2026-01-01', '2026-01-31'],
    },
    {
      name: 'April',
      store: ['2026-04-02', '2026-05-01'],
      individual: ['2026-04-01', '2026-04-30'],
    },
    {
      name: 'December',
      store: ['2026-12-02', '2027-01-01'],
      individual: ['2026-12-01', '2026-12-31'],
    },
    {
      name: 'February leap year',
      store: ['2024-02-02', '2024-03-01'],
      individual: ['2024-02-01', '2024-02-29'],
    },
    {
      name: 'February common year',
      store: ['2025-02-02', '2025-03-01'],
      individual: ['2025-02-01', '2025-02-28'],
    },
  ] as const;

  for (const item of cases) {
    const [storeYear, storeMonth] = item.store[0].split('-').map(Number);
    const store = periodFor('store', storeYear ?? 0, storeMonth ?? 0);
    const [individualYear, individualMonth] = item.individual[0].split('-').map(Number);
    const individual = periodFor('individual', individualYear ?? 0, individualMonth ?? 0);
    assert.deepEqual([store.start, store.end], [...item.store], item.name);
    assert.deepEqual([individual.start, individual.end], [...item.individual], item.name);
    assert.notDeepEqual([store.start, store.end], [individual.start, individual.end], item.name);
  }
});

test('the mandatory business-date matrix keeps store and individual periods apart', () => {
  const matrix = [
    ['2026-09-30', '2026-09-02', '2026-10-01', '2026-09-01', '2026-09-30'],
    ['2026-10-01', '2026-09-02', '2026-10-01', '2026-10-01', '2026-10-31'],
    ['2026-10-02', '2026-10-02', '2026-11-01', '2026-10-01', '2026-10-31'],
    ['2026-10-31', '2026-10-02', '2026-11-01', '2026-10-01', '2026-10-31'],
    ['2026-11-01', '2026-10-02', '2026-11-01', '2026-11-01', '2026-11-30'],
    ['2026-11-02', '2026-11-02', '2026-12-01', '2026-11-01', '2026-11-30'],
    ['2027-02-01', '2027-01-02', '2027-02-01', '2027-02-01', '2027-02-28'],
    ['2028-02-29', '2028-02-02', '2028-03-01', '2028-02-01', '2028-02-29'],
    ['2028-03-01', '2028-02-02', '2028-03-01', '2028-03-01', '2028-03-31'],
  ] as const;
  for (const [date, storeStart, storeEnd, individualStart, individualEnd] of matrix) {
    const store = storePeriodContaining(date);
    const individual = individualPeriodContaining(date);
    assert.deepEqual([store.start, store.end], [storeStart, storeEnd], date);
    assert.deepEqual([individual.start, individual.end], [individualStart, individualEnd], date);
  }
});

test('the 1st closes the store month and opens the individual month', () => {
  assert.deepEqual(
    [storePeriodContaining('2026-11-01').start, storePeriodContaining('2026-11-01').end],
    ['2026-10-02', '2026-11-01'],
  );
  assert.deepEqual(
    [individualPeriodContaining('2026-11-01').start, individualPeriodContaining('2026-11-01').end],
    ['2026-11-01', '2026-11-30'],
  );
  assert.deepEqual(
    [storePeriodContaining('2026-10-01').start, storePeriodContaining('2026-10-01').end],
    ['2026-09-02', '2026-10-01'],
  );
  assert.deepEqual(
    [individualPeriodContaining('2026-10-01').start, individualPeriodContaining('2026-10-01').end],
    ['2026-10-01', '2026-10-31'],
  );
  assert.deepEqual(
    [storePeriodContaining('2027-01-01').start, storePeriodContaining('2027-01-01').end],
    ['2026-12-02', '2027-01-01'],
  );
  assert.equal(lastCalendarDay(2024, 2), 29);
  assert.equal(lastCalendarDay(2025, 2), 28);
});

test('each calendar filters the same daily records without changing them', () => {
  const records = [
    { date: '2026-10-01', amount: 4 },
    { date: '2026-10-02', amount: 10 },
    { date: '2026-11-01', amount: 7 },
  ];
  const store = filterByCategory(records, 'store', 2026, 10, (row) => row.date);
  const individual = filterByCategory(records, 'individual', 2026, 10, (row) => row.date);
  assert.deepEqual(
    store.map((row) => row.date),
    ['2026-10-02', '2026-11-01'],
  );
  assert.deepEqual(
    individual.map((row) => row.date),
    ['2026-10-01', '2026-10-02'],
  );
  assert.equal(records.length, 3);
  assert.equal(records[0]?.amount, 4);
});
