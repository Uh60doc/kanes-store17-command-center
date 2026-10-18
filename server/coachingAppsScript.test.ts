import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

const admin = session;

test('a blank ticket goal stays $2,500 and a new-hire goal uses $2,100', () => {
  const { gs } = harness();
  const veteran = plain(gs.opportunityTicket_(30, 57000));
  assert.equal(veteran.goal, 2500);
  assert.equal(veteran.opportunity, 18000);
  const hire = plain(gs.opportunityTicket_(30, 57000, 2100));
  assert.equal(hire.goal, 2100);
  assert.equal(hire.hypothetical, 63000);
  assert.equal(hire.opportunity, 6000);
  assert.match(hire.basis, /not delivered commission/);
});

test('coaching cards use Goal coach math, new-hire goals, and current associates only', () => {
  const { gs } = harness();
  gs.ensureRosterColumns_();
  const before = plain(gs.home_({ session: admin }));
  const page = plain(gs.coaching_({ session: admin }));
  const after = plain(gs.home_({ session: admin }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.deepEqual(plain(gs.ROUTES_).coaching, ['manager', 'admin']);
  assert.equal(plain(gs.READ_ONLY_ROUTES_).coaching, true);
  const names = page.cards.map((card: { name: string }) => card.name);
  assert.ok(names.includes('Ricky Nassif'));
  assert.ok(names.includes('Brenda Sanchez'));
  assert.ok(!names.some((name: string) => /Mukhtar|Filepe|Felipe|Valentina|Caroline|Kelly|Elizabeth|Cordell|James Meyers/.test(name)));
  page.cards.forEach((card: { opportunities: { now: string; goal: string; additional: string; action: string; label: string }[]; rugs: { count: null } }) => {
    assert.ok(card.opportunities.length <= 3);
    assert.equal(card.rugs.count, null);
    assert.ok(!card.opportunities.some((item) => /rug/i.test(item.label)));
    card.opportunities.forEach((item) => {
      assert.ok(item.now);
      assert.ok(item.goal);
      assert.ok(item.additional);
      assert.match(item.action, /^Practice /);
    });
  });
  const ricky = page.cards.find((card: { name: string }) => card.name === 'Ricky Nassif');
  assert.equal(ricky.newHire, false);
  assert.equal(ricky.ticket.goal, 2500);
  const same = plain(gs.opportunityTicket_(ricky.ticket.orders, ricky.ticket.sales));
  assert.equal(ricky.ticket.opportunity, same.opportunity);
  assert.equal(ricky.financial.ticket, same.opportunity > 0 ? same.opportunity : ricky.financial.ticket);
  assert.equal(ricky.financial.protection, 'Pay rule confirmation needed');
  assert.equal(ricky.rugs.goal, 12);
  const brenda = page.cards.find((card: { name: string }) => card.name === 'Brenda Sanchez');
  assert.equal(brenda.newHire, true);
  assert.equal(brenda.ticket.goal, 2100);
  assert.equal(brenda.beddingGoal, 0.15);
  assert.equal(brenda.padsGoal, 0.6);
  assert.equal(brenda.rugs.goal, 6);
  assert.notEqual(brenda.ticket.goal, 2500);
  if (brenda.fabricGoal !== null) assert.equal(brenda.fabricGoal, 0.8);
  const text = gs.coachingText_(brenda);
  assert.match(text, /NEW HIRE/);
  assert.match(text, /2100|\$2,100/);
});
