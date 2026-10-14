import assert from 'node:assert/strict';
import test from 'node:test';
import { closingRatio, coveredTotal, officialClosing } from './closingRatio.ts';

test('the October 11 example divides 6 purchasing customers by 9 opportunities', () => {
  // Arithmetic check only. 9 is not a stored opportunity count.
  const result = closingRatio(6, 9);
  assert.equal(result.ratio, 0.667);
  assert.equal(result.needsReconciliation, false);
});

test('a missing count and a zero denominator are not calculated', () => {
  assert.equal(closingRatio(null, 9).ratio, null);
  assert.equal(closingRatio(6, null).ratio, null);
  assert.equal(closingRatio(4, 0).ratio, null);
  assert.equal(closingRatio(0, 0).ratio, null);
  assert.equal(closingRatio(0, 5).ratio, 0);
});

test('a ratio above 100% is flagged and still returned', () => {
  const result = closingRatio(10, 4);
  assert.equal(result.ratio, 2.5);
  assert.equal(result.needsReconciliation, true);
});

test('month to date adds the counts and does not average the daily percentages', () => {
  const dates = ['2026-10-02', '2026-10-03'];
  const result = officialClosing({
    periodCustomers: null,
    periodOpportunities: null,
    dates,
    customers: new Map([
      ['2026-10-02', 1],
      ['2026-10-03', 1],
    ]),
    opportunities: new Map([
      ['2026-10-02', 1],
      ['2026-10-03', 9],
    ]),
  });
  assert.equal(result.customers, 2);
  assert.equal(result.opportunities, 10);
  assert.equal(result.ratio, 0.2);
});

test('a gap in the store month is not treated as zero', () => {
  const dates = ['2026-10-02', '2026-10-11', '2026-10-12', '2026-10-13'];
  const customers = new Map<string, number>([
    ['2026-10-11', 6],
    ['2026-10-12', 4],
    ['2026-10-13', 4],
  ]);
  assert.equal(coveredTotal(dates, customers), null);
  const result = officialClosing({
    periodCustomers: null,
    periodOpportunities: null,
    dates,
    customers,
    opportunities: new Map(),
  });
  assert.equal(result.customers, null);
  assert.equal(result.opportunities, null);
  assert.equal(result.ratio, null);
});

test('a full-period pair is not mixed with a shorter daily series', () => {
  const result = officialClosing({
    periodCustomers: 20,
    periodOpportunities: null,
    dates: ['2026-10-02'],
    customers: new Map([['2026-10-02', 1]]),
    opportunities: new Map([['2026-10-02', 9]]),
  });
  assert.equal(result.customers, 20);
  assert.equal(result.opportunities, 9);
  assert.equal(result.ratio, null);
});

test('matching full-period counts divide once', () => {
  const result = officialClosing({
    periodCustomers: 20,
    periodOpportunities: 50,
    dates: ['2026-10-02'],
    customers: new Map([['2026-10-02', 6]]),
    opportunities: new Map([['2026-10-02', 9]]),
  });
  assert.equal(result.customers, 20);
  assert.equal(result.opportunities, 50);
  assert.equal(result.ratio, 0.4);
  assert.equal(result.needsReconciliation, false);
});
