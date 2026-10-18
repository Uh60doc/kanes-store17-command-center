import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

const admin = session;

test('combined recovery is the product of the levers, not the sum of the separate effects', () => {
  const { gs } = harness();
  const base = gs.recoveryRemaining_(10, 8, 0.5, 2000, 1);
  const closingOnly = gs.recoveryRemaining_(10, 8, 0.6, 2000, 1);
  const ticketOnly = gs.recoveryRemaining_(10, 8, 0.5, 2500, 1);
  const combined = gs.recoveryRemaining_(10, 8, 0.6, 2500, 1);
  assert.equal(base, 80000);
  assert.equal(closingOnly - base, 16000);
  assert.equal(ticketOnly - base, 20000);
  assert.equal(combined - base, 40000);
  assert.notEqual(combined - base, (closingOnly - base) + (ticketOnly - base));
  assert.equal(gs.recoveryRemaining_(10, null, 0.5, 2000, 1), null);
});

test('the recovery page reads the store month and does not change actual sales', () => {
  const { gs } = harness();
  const before = plain(gs.home_({ session: admin }));
  const recovery = plain(gs.recovery_({ session: admin }));
  const after = plain(gs.home_({ session: admin }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.equal(recovery.actual.written, before.month.written);
  assert.equal(recovery.budget, 400000);
  assert.match(recovery.calendar, /2nd through the 1st/);
  assert.equal(recovery.trend.note.includes('does not use closing ratio'), true);
  assert.match(recovery.stretch.note, /Do not add/);
  assert.ok(recovery.assumptions.some((line: string) => /not substituted|does not swap/.test(line)));
  const routes = plain(gs.ROUTES_) as Record<string, string[]>;
  assert.deepEqual(routes.recovery, ['manager', 'admin']);
  assert.ok(recovery.daysLeft > 0);
  assert.ok(recovery.economics.dollarsPerCustomer > 0);
  assert.ok(recovery.closing.customers > 0);
  assert.notEqual(recovery.orders.orders, recovery.closing.customers);
});
