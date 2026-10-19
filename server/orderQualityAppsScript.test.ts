/**
 * Sales order quality checklist on the verified October workbook. Production is never opened.
 * The checklist does not change a customer order or store a phone, address, or access code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const manager = { role: 'manager', username: 'regression' };
const KEYS = ['customer', 'spr', 'white-glove', 'no-contact', 'delivery-choice', 'access', 'product', 'protector', 'asis', 'maintenance', 'manager-to', 'salesperson', 'manager'];

function done(except: string[] = []) {
  const steps: Record<string, { state: string; note?: string }> = {};
  KEYS.forEach((key) => { steps[key] = { state: except.includes(key) ? 'open' : 'done' }; });
  return steps;
}

function item(page: { saved: { items: { key: string; state: string; applies: boolean }[] } }, key: string) {
  const found = page.saved.items.find((row) => row.key === key);
  assert.ok(found, key);
  return found!;
}

test('White Glove, No Contact, and AS-IS checklists are complete only after manager review', () => {
  const { gs, tabs, mail } = harness();
  const daily = JSON.stringify(cells(tabs.CC_Daily));
  const written = Number(plain(gs.home_({ session })).month.written);
  const empty = plain(gs.orderQuality_({ session: manager }));
  assert.deepEqual(empty.steps.map((step: { key: string }) => step.key), KEYS);
  assert.equal(empty.mail, false);
  assert.equal(empty.changesOrders, false);
  assert.equal(empty.policyOnFile, false);
  assert.match(empty.notice, /Document Center/);
  assert.doesNotMatch(empty.notice, /gate code is/i);

  const waiting = plain(gs.saveOrderCheck_({
    session: manager, orderRef: 'WG1601', delivery: 'white-glove', asIs: 'no', mattress: 'yes', nocom: 'no', salesperson: 'Jamie Cole', steps: done(['manager']),
  }));
  assert.equal(waiting.saved.status, 'Awaiting manager');
  assert.notEqual(waiting.saved.status, 'Complete');
  assert.equal(item(waiting, 'white-glove').state, 'done');
  assert.equal(item(waiting, 'no-contact').state, 'na');
  assert.equal(item(waiting, 'asis').state, 'na');
  assert.equal(item(waiting, 'protector').state, 'done');
  assert.deepEqual(waiting.saved.incomplete, ['Manager completes final order review']);

  const glove = plain(gs.saveOrderCheck_({ session: manager, id: waiting.saved.id, steps: done() }));
  assert.equal(glove.saved.status, 'Complete');
  assert.equal(glove.saved.orderRef, 'WG1601');
  assert.equal(glove.report.complete, 1);

  const contact = plain(gs.saveOrderCheck_({
    session: manager, orderRef: 'NC1602', delivery: 'no-contact', asIs: 'no', mattress: 'no', nocom: 'yes', salesperson: 'Jamie Cole', steps: done(),
  }));
  assert.equal(contact.saved.status, 'Complete');
  assert.equal(item(contact, 'no-contact').state, 'done');
  assert.equal(item(contact, 'white-glove').state, 'na');
  assert.equal(item(contact, 'protector').state, 'done');
  assert.equal(item(contact, 'asis').state, 'na');

  const asIsOpen = plain(gs.saveOrderCheck_({
    session: manager, orderRef: 'AS1603', delivery: 'white-glove', asIs: 'yes', mattress: 'no', nocom: 'no', salesperson: 'Jamie Cole', steps: done(['asis']),
  }));
  assert.equal(asIsOpen.saved.status, 'Incomplete');
  assert.equal(item(asIsOpen, 'asis').state, 'open');
  assert.ok(asIsOpen.saved.incomplete.includes('Review AS-IS requirements where applicable'));
  const asIs = plain(gs.saveOrderCheck_({ session: manager, id: asIsOpen.saved.id, steps: done() }));
  assert.equal(asIs.saved.status, 'Complete');
  assert.equal(item(asIs, 'asis').state, 'done');
  assert.equal(item(asIs, 'protector').state, 'na');

  assert.throws(() => gs.saveOrderCheck_({ session: manager, orderRef: '5551234567', delivery: 'white-glove', steps: done() }), /phone|reference/i);
  assert.throws(() => gs.saveOrderCheck_({
    session: manager, orderRef: 'EX1604', delivery: 'white-glove', salesperson: 'Jamie Cole', steps: Object.assign(done(['access']), { access: { state: 'exception', note: 'gate code is 1234' } }),
  }), /access code|gate code/i);
  assert.throws(() => gs.saveOrderCheck_({
    session: manager, orderRef: 'EX1605', delivery: 'white-glove', salesperson: 'Jamie Cole', steps: Object.assign(done(['salesperson']), { salesperson: { state: 'open' }, manager: { state: 'done' } }),
  }), /salesperson review/);

  assert.equal(Number(plain(gs.home_({ session })).month.written), written);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), daily);
  assert.equal(mail.length, 0);
  vm.runInContext("requireSession_ = function () { return { role: 'sales', username: 'floor' }; };", gs as vm.Context);
  assert.throws(() => gs.dispatch('orderQuality', { token: 't' }), /not available for this login/);
  assert.throws(() => gs.dispatch('saveOrderCheck', { token: 't', orderRef: 'WG1601', steps: {} }), /not available for this login/);
});
