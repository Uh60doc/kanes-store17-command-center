import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

test('an attachment on the current eligible count does not change the denominator, and a new eligible item does', () => {
  const { gs } = harness();
  assert.equal(gs.accelAttachmentsNeeded_(4, 10, 0.8), 4);
  const same = plain(gs.accelScenario_(4, 10, 0.8, 1, 0, 0));
  assert.equal(same.sold, 5);
  assert.equal(same.qualified, 10);
  assert.equal(same.actual, 0.5);
  const added = plain(gs.accelScenario_(4, 10, 0.8, 0, 1, 0));
  assert.equal(added.sold, 4);
  assert.equal(added.qualified, 11);
  assert.equal(added.actual, 0.3636);
  const both = plain(gs.accelScenario_(4, 10, 0.8, 0, 1, 1));
  assert.equal(both.sold, 5);
  assert.equal(both.qualified, 11);
  const capped = plain(gs.accelScenario_(9, 10, 0.8, 5, 0, 0));
  assert.equal(capped.onHand, 1);
  assert.equal(capped.qualified, 10);
});

test('bedding dollars increase the sales denominator, and rugs are a count', () => {
  const { gs } = harness();
  assert.equal(gs.accelBeddingDollars_(100, 1000, 0.2), 125);
  const reached = plain(gs.accelBeddingScenario_(100, 1000, 0.2, 125, 0));
  assert.equal(reached.actual, 0.2);
  assert.equal(reached.sales, 1125);
  const diluted = plain(gs.accelBeddingScenario_(100, 1000, 0.2, 125, 100));
  assert.ok(diluted.actual < 0.2);
  assert.equal(gs.accelCountNeeded_(9, 12), 3);
  assert.equal(gs.accelCountNeeded_(12, 12), 0);
  const partial = plain(gs.accelProtectCard_([
    { label: 'Fabric maintenance', dollars: 1000 },
    { label: 'Pillows', dollars: null },
  ], 4500));
  assert.equal(partial.status, 'partial');
  assert.equal(partial.dollarsNeeded, null);
  assert.equal(partial.known, 1000);
  const complete = plain(gs.accelProtectCard_([
    { label: 'Fabric maintenance', dollars: 4000 },
    { label: 'Pillows', dollars: 100 },
  ], 4500));
  assert.equal(complete.dollarsNeeded, 400);
  assert.notEqual(complete.note.includes('commission rate'), false);
});

test('the closest open goal is the highest verified pace, and the page does not change sales', () => {
  const { gs } = harness();
  const closest = plain(gs.accelClosest_([
    { key: 'fabric', label: 'Fabric maintenance', customer: 'Fabric Maintenance Plan', status: 'below', ratioToGoal: 0.7 },
    { key: 'power', label: 'Power upholstery', customer: 'Power Maintenance Plan', status: 'below', ratioToGoal: 0.94 },
    { key: 'rugs', label: 'Rugs', customer: 'rug', status: 'pending', ratioToGoal: null },
  ]));
  assert.equal(closest.key, 'power');
  const before = plain(gs.home_({ session }));
  const page = plain(gs.accelerator_({ session, side: 'written' }));
  const after = plain(gs.home_({ session }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.equal(page.store.calendar.includes('2nd through the 1st'), true);
  assert.equal(page.individualCalendar.includes('1st through the last calendar day'), true);
  const fabric = page.store.cards.find((card: { key: string }) => card.key === 'fabric');
  assert.equal(fabric.goal, 0.8);
  assert.equal(fabric.needed, gs.accelAttachmentsNeeded_(fabric.sold, fabric.qualified, 0.8));
  const bedding = page.store.cards.find((card: { key: string }) => card.key === 'bedding');
  assert.equal(bedding.goal, 0.2);
  const rugs = page.store.cards.find((card: { key: string }) => card.key === 'rugs');
  assert.equal(rugs.goal, 12);
  const ricky = page.people.find((person: { name: string }) => person.name === 'Ricky Nassif');
  const brenda = page.people.find((person: { name: string }) => person.name === 'Brenda Sanchez');
  assert.equal(brenda.newHire, true);
  assert.equal(brenda.cards.find((card: { key: string }) => card.key === 'bedding').goal, 0.15);
  assert.equal(brenda.cards.find((card: { key: string }) => card.key === 'pads').goal, 0.6);
  assert.equal(brenda.cards.find((card: { key: string }) => card.key === 'rugs').goal, 6);
  assert.equal(brenda.cards.find((card: { key: string }) => card.key === 'rugs').count, null);
  assert.equal(ricky.cards.find((card: { key: string }) => card.key === 'fabric').goal, 0.8);
  assert.equal(ricky.cards.find((card: { key: string }) => card.key === 'protection').dollarsNeeded, null);
  assert.match(page.notice, /Goal coach/);
  const sales = plain(gs.accelerator_({ session: { role: 'sales', username: 'sales' }, side: 'written' }));
  assert.equal(sales.people.length, 0);
  assert.equal(sales.store.cards.length > 0, true);
});
