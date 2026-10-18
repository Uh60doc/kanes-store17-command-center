import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

const admin = session;

test('closing and ticket illustrations stay separate and do not treat a missing count as zero', () => {
  const { gs } = harness();
  assert.equal(gs.leakageExtra_(54, 111, 0.5, 2042.17), 3063.26);
  assert.equal(gs.leakageExtra_(54, 111, 0.486, 2042.17), 0);
  assert.equal(gs.leakageExtra_(null, 111, 0.5, 2042.17), null);
  const ranked = plain(gs.leakageRank_([
    { key: 'closing', kind: 'incremental', dollars: 3063.26 },
    { key: 'ticket', kind: 'incremental', dollars: 18122.73 },
    { key: 'bedding', kind: 'mix', dollars: 4000 },
  ]));
  assert.equal(ranked[0].key, 'ticket');
  assert.equal(plain(gs.leakageBiggest_(ranked)).dollars, 18122.73);
  assert.notEqual(plain(gs.leakageBiggest_(ranked)).dollars, 3063.26 + 18122.73);
});

test('the leakage page uses Goal coach ticket math, leaves store orders pending, and does not write sales', () => {
  const { gs } = harness();
  gs.ensureRosterColumns_();
  const before = plain(gs.home_({ session: admin }));
  const page = plain(gs.leakage_({ session: admin }));
  const after = plain(gs.home_({ session: admin }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.deepEqual(plain(gs.ROUTES_).leakage, ['manager', 'admin']);
  assert.equal(page.store.orders, null);
  assert.equal(page.store.ticket, null);
  assert.match(page.notice, /not added together/);
  assert.match(page.store.calendar, /2nd through the 1st/);
  assert.match(page.individual.calendar, /1st through the last calendar day/);
  const names = page.people.map((person: { name: string }) => person.name);
  assert.ok(!names.some((name: string) => /Mukhtar|Filepe|Valentina|Caroline|Kelly|Elizabeth|Cordell|James/.test(name)));
  const ricky = page.people.find((person: { name: string }) => person.name === 'Ricky Nassif');
  const ticket = plain(gs.opportunityTicket_(ricky.orders, ricky.groupSales, 2500));
  assert.equal(ricky.ticket, ticket.opportunity);
  assert.equal(ricky.ticketGoal, 2500);
  assert.notEqual(ricky.biggest.dollars, (ricky.closing || 0) + ricky.ticket);
  ricky.attachments.forEach((line: { dollars: null }) => assert.equal(line.dollars, null));
  const brenda = page.people.find((person: { name: string }) => person.name === 'Brenda Sanchez');
  assert.equal(brenda.newHire, true);
  assert.equal(brenda.ticketGoal, 2100);
  assert.equal(brenda.ticket, null);
});
