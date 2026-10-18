import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

const admin = session;
const sales = { role: 'sales', username: 'sales17' };

test('the 30-ticket example is $18,000 of written opportunity and is not called commission', () => {
  const { gs } = harness();
  const ticket = plain(gs.opportunityTicket_(30, 57000));
  assert.equal(ticket.average, 1900);
  assert.equal(ticket.hypothetical, 75000);
  assert.equal(ticket.opportunity, 18000);
  assert.match(ticket.basis, /not delivered commission/);
});

test('protection bands follow the agreement and do not guess under $3,000 or a 12% rug tier', () => {
  const { gs } = harness();
  const low = plain(gs.opportunityProtectionRate_(2500));
  assert.equal(low.status, 'Pay rule confirmation needed');
  assert.equal(low.earnings, null);
  assert.equal(low.dollarsToNext, 500);
  const mid = plain(gs.opportunityProtectionRate_(3000));
  assert.equal(mid.rate, 0.2);
  assert.equal(mid.earnings, 600);
  const line = plain(gs.opportunityProtectionRate_(4500));
  assert.equal(line.rate, 0.2);
  const high = plain(gs.opportunityProtectionRate_(4500.01));
  assert.equal(high.rate, 0.25);
  const rugs = plain(gs.opportunityRugIllustration_(1, 400));
  assert.equal(rugs.commission, 24);
  assert.match(rugs.note, /12% tier is not in the agreement/);
  const blank = plain(gs.opportunityRugIllustration_(1, null));
  assert.equal(blank.commission, null);
  assert.equal(blank.status, 'Pay rule confirmation needed');
});

test('goal coach uses verified associate tickets, hides former employees, and leaves store sales unchanged', () => {
  const { gs } = harness();
  const before = plain(gs.home_({ session: admin }));
  const coach = plain(gs.opportunity_({ session: admin }));
  const after = plain(gs.home_({ session: admin }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.equal(coach.access, 'management');
  assert.match(coach.calendar, /1st through the last calendar day/);
  const names = coach.people.map((person: { name: string }) => person.name);
  assert.ok(names.includes('Prakash Gandhi'));
  assert.ok(!names.some((name: string) => /Mukhtar|Filepe|Valentina|Kelly Meyers|Elizabeth Perez/.test(name)));
  const ready = coach.people.find((person: { ticket: { status: string } }) => person.ticket.status === 'ready');
  assert.ok(ready, 'at least one associate has Group 17 orders');
  assert.equal(ready.ticket.hypothetical, Math.round(ready.ticket.orders * 2500 * 100) / 100);
  assert.equal(ready.rugs.count, null);
  assert.equal(ready.rugs.nextStatus, 'Pay rule confirmation needed');
  assert.equal(ready.protection.actual, null);
  assert.match(ready.takeaways.join(' '), /not commission/);
  const hidden = plain(gs.opportunity_({ session: sales }));
  assert.equal(hidden.access, 'shared-login');
  assert.deepEqual(hidden.people, []);
  assert.match(hidden.message, /not tied to one associate/);
});
