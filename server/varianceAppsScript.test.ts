/**
 * Written Sales Reality on the verified October workbook. Production is never opened.
 * NWDSR Written stays the official total. The SNAP comparison is not removed from it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const manager = { role: 'manager', username: 'regression' };

function windowOf(page: { windows: { key: string; nwdsrText: string; snapText: string; dollarsText: string; percentText: string; incomplete: boolean; coverage: string }[] }, key: string) {
  const found = page.windows.find((item) => item.key === key);
  assert.ok(found, key);
  return found!;
}

test('October 16 shows NWDSR $10,495, SNAP $7,432, and a $3,063 difference', () => {
  const { gs, tabs, mail, setToday } = harness();
  setToday('2026-10-17');
  const beforeDaily = JSON.stringify(cells(tabs.CC_Daily));
  const beforeWritten = Number(plain(gs.home_({ session })).month.written);
  tabs.CC_Daily.push(['2026-10-16', 7432, 10495, 2502]);
  const page = plain(gs.variance_({ session: manager, focus: 'yesterday' }));
  const yesterday = windowOf(page, 'yesterday');
  assert.equal(yesterday.nwdsrText, '$10,495');
  assert.equal(yesterday.snapText, '$7,432');
  assert.equal(yesterday.dollarsText, '+$3,063');
  assert.equal(yesterday.percentText, '+29.2%');
  assert.equal(yesterday.incomplete, false);
  assert.equal(page.days[0].date, '2026-10-16');
  assert.equal(page.days[0].large, true);
  assert.equal(page.days[0].review, null);
  assert.equal(page.unresolved.length, 1);
  assert.equal(page.mail, false);
  assert.equal(page.orderEvidence, false);
  assert.match(page.notice, /not subtracted/);
  assert.doesNotMatch(page.notice, /air ticket/i);
  assert.ok(page.categories.some((item: { key: string; label: string }) => item.key === 'possible-air' && /Possible air-ticket activity/.test(item.label)));
  const seven = windowOf(page, 'seven');
  assert.equal(seven.comparableCount, 7);
  assert.equal(plain(gs.variance_({ session: manager, focus: 'seven' })).days.at(-1).date, '2026-10-16');
  const report = plain(gs.reportCenter_({ session, kind: 'daily', date: '2026-10-16' }));
  assert.equal(report.lines.find((line: { key: string }) => line.key === 'written').result, '$10,495');
  assert.match(report.writtenGap.text, /Not removed from official NWDSR Written/);
  assert.doesNotMatch(report.writtenGap.text, /air ticket/i);
  const pdf = Buffer.from(report.pdf, 'base64').toString('latin1');
  assert.match(pdf, /10,495/);
  assert.match(pdf, /7,432/);
  assert.match(pdf, /3,063/);
  assert.doesNotMatch(pdf, /air ticket/i);
  assert.equal((pdf.match(/\/Type \/Page[^s]/g) || []).length, 1);
  const noted = plain(gs.saveWrittenReview_({
    session: manager,
    focus: 'yesterday',
    date: '2026-10-16',
    category: 'timing',
    explanation: 'The two reports were printed at different times.',
    references: 'No order file on hand',
  }));
  assert.equal(noted.days[0].review.category, 'timing');
  assert.equal(noted.days[0].review.label, 'Timing or reporting difference');
  assert.match(noted.days[0].review.caveat, /Not an automatic conclusion/);
  assert.equal(noted.days[0].unresolved, false);
  assert.equal(noted.days[0].dollarsText, '+$3,063');
  const quiet = plain(gs.saveWrittenReview_({ session: manager, focus: 'yesterday', threshold: 5000 }));
  assert.equal(quiet.threshold, 5000);
  assert.equal(quiet.days[0].large, false);
  assert.equal(Number(plain(gs.home_({ session })).month.written), beforeWritten + 10495);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily).slice(0, JSON.parse(beforeDaily).length)), beforeDaily);
  assert.equal(mail.length, 0);
});

test('a period with a missing day is flagged and sales cannot open the comparison', () => {
  const { gs, tabs, mail, setToday } = harness();
  setToday('2026-10-18');
  tabs.CC_Daily.push(['2026-10-16', 7432, 10495, 2502]);
  const dailyBefore = JSON.stringify(cells(tabs.CC_Daily));
  const page = plain(gs.variance_({ session: manager, focus: 'custom', start: '2026-10-16', end: '2026-10-17' }));
  const selected = windowOf(page, 'custom');
  assert.equal(selected.nwdsrText, '$10,495');
  assert.equal(selected.snapText, '$7,432');
  assert.equal(selected.dollarsText, '+$3,063');
  assert.equal(selected.incomplete, true);
  assert.match(selected.coverage, /2026-10-17/);
  assert.match(selected.coverage, /not treated as zero/);
  const yesterday = windowOf(page, 'yesterday');
  assert.equal(yesterday.nwdsrText, 'Pending');
  assert.equal(yesterday.incomplete, true);
  vm.runInContext("requireSession_ = function () { return { role: 'sales', username: 'floor' }; };", gs as vm.Context);
  assert.throws(() => gs.dispatch('variance', { token: 't' }), /not available for this login/);
  assert.throws(() => gs.dispatch('saveWrittenReview', { token: 't', date: '2026-10-16', category: 'possible-air', explanation: 'guess' }), /not available for this login/);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), dailyBefore);
  assert.equal(mail.length, 0);
});
