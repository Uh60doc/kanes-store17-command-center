/**
 * Morning Report Readiness on the verified October workbook. Production is never opened.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const manager = { role: 'manager', username: 'regression' };

function item(page: { items: { key: string; received: string; imported: string; through: string; date: string }[] }, key: string) {
  const found = page.items.find((row) => row.key === key);
  assert.ok(found, key);
  return found!;
}

test('October 16 written reports are received and missing PERQ stays pending', () => {
  const { gs, tabs, mail, setToday, setHour } = harness();
  setToday('2026-10-17');
  setHour(15);
  const before = cells(tabs.CC_Daily);
  const written = Number(plain(gs.home_({ session })).month.written);
  tabs.CC_Daily.push(['2026-10-16', 7432, 10495, 2502]);
  const page = plain(gs.readiness_({ session: manager, date: '2026-10-16' }));
  assert.equal(page.date, '2026-10-16');
  assert.equal(page.displayDate, 'Oct 16, 2026');
  assert.equal(page.mail, false);
  assert.notEqual(page.status, 'ERROR');
  ['snapWritten', 'nwdsrWritten', 'nwdsrDelivered'].forEach((key) => {
    const row = item(page, key);
    assert.equal(row.date, '2026-10-16');
    assert.equal(row.received, 'Received');
    assert.equal(row.imported, 'Imported');
    assert.equal(row.through, '2026-10-16');
  });
  ['perqLocation', 'perqSalesperson'].forEach((key) => {
    const row = item(page, key);
    assert.equal(row.date, '2026-10-16');
    assert.equal(row.received, 'Missing');
    assert.notEqual(row.imported, 'Imported');
  });
  assert.match(page.missing.join(' '), /PERQ Store opportunities/);
  assert.match(page.missing.join(' '), /PERQ Salesperson opportunities/);
  assert.match(page.headline, /Missing/);
  assert.ok(page.waiting.some((line: { report: string; metrics: string }) => /PERQ Store opportunities/.test(line.report) && /closing/i.test(line.metrics)));
  assert.match(page.notice, /Data Refresh/);
  assert.match(page.dueText, /not an error/);
  const after = plain(gs.home_({ session }));
  assert.equal(after.month.written, written + 10495);
  assert.equal(after.month.delivered, Number(plain(gs.home_({ session })).month.delivered));
  assert.equal(JSON.stringify(cells(tabs.CC_Daily).slice(0, before.length)), JSON.stringify(before));
  assert.equal(mail.length, 0);
});

test('a report that is not due yet is not an error, and sales cannot open the page', () => {
  const { gs, tabs, mail, setToday, setHour } = harness();
  setToday('2026-10-17');
  setHour(8);
  tabs.CC_Daily.push(['2026-10-16', 7432, 10495, 2502]);
  const early = plain(gs.readiness_({ session: manager }));
  assert.equal(early.date, '2026-10-16');
  assert.equal(item(early, 'nwdsrWritten').received, 'Received');
  assert.equal(item(early, 'perqLocation').received, 'Not due');
  assert.notEqual(early.status, 'ERROR');
  assert.notEqual(early.status, 'MISSING');
  const daily = JSON.stringify(cells(tabs.CC_Daily));
  vm.runInContext("requireSession_ = function () { return { role: 'sales', username: 'floor' }; };", gs as vm.Context);
  assert.throws(() => gs.dispatch('readiness', { token: 't' }), /not available for this login/);
  assert.throws(() => gs.dispatch('recheckReports', { token: 't' }), /not available for this login/);
  vm.runInContext("requireSession_ = function () { return { role: 'manager', username: 'lead' }; };", gs as vm.Context);
  const checked = plain(gs.dispatch('recheckReports', { token: 't', date: '2026-10-16' }));
  assert.equal(checked.rechecked, true);
  assert.equal(checked.date, '2026-10-16');
  assert.equal(item(checked, 'nwdsrWritten').received, 'Received');
  assert.equal(item(checked, 'perqLocation').received, 'Not due');
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), daily);
  assert.equal(mail.length, 0);
});
