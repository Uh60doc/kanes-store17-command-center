import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

function line(page: { lines: { key: string; result: string; source: string; status: string }[] }, key: string) {
  const found = page.lines.find((item) => item.key === key);
  assert.ok(found, key);
  return found!;
}

test('a missing report stays Pending and a blank on a complete report is zero', () => {
  const { gs } = harness();
  assert.equal(plain(gs.reportCompleteNumber_(false, null)).pending, true);
  assert.equal(plain(gs.reportCompleteNumber_(false, '')).value, null);
  assert.equal(plain(gs.reportCompleteNumber_(true, '')).value, 0);
  assert.equal(plain(gs.reportCompleteNumber_(true, null)).value, 0);
  assert.equal(plain(gs.reportCompleteNumber_(true, 0)).value, 0);
});

test('the daily summary uses Morning Start-Up figures and does not email', () => {
  const { gs, mail, setToday } = harness();
  setToday('2026-10-18');
  const before = plain(gs.home_({ session }));
  assert.deepEqual(plain(gs.ROUTES_).reports, ['manager', 'admin']);
  const facts = plain(gs.dailyFacts_());
  const writtenThrough = facts.filter((row: { date: string; nwdsrWritten: number | null }) => row.date <= '2026-10-16' && row.date >= '2026-10-02' && row.nwdsrWritten !== null).map((row: { date: string }) => row.date).sort().pop();
  const deliveredThrough = facts.filter((row: { date: string; nwdsrDelivered: number | null }) => row.date <= '2026-10-16' && row.date >= '2026-10-02' && row.nwdsrDelivered !== null).map((row: { date: string }) => row.date).sort().pop();
  const writtenMtd = plain(gs.sumField_(facts, 'nwdsrWritten', '2026-10-02', writtenThrough));
  const deliveredMtd = plain(gs.sumField_(facts, 'nwdsrDelivered', '2026-10-02', deliveredThrough));
  const page = plain(gs.reportCenter_({ session, kind: 'daily', date: '2026-10-16' }));
  assert.equal(page.date, '2026-10-16');
  assert.equal(page.mail, false);
  assert.equal(page.ready, true);
  assert.equal(line(page, 'written-mtd').result, plain(gs.moneyText_(writtenMtd)));
  assert.equal(line(page, 'delivered-mtd').result, plain(gs.moneyText_(deliveredMtd)));
  assert.match(line(page, 'written-mtd').source, new RegExp('through ' + writtenThrough));
  assert.match(line(page, 'delivered-mtd').source, new RegExp('through ' + deliveredThrough));
  assert.equal(before.month.written, writtenMtd);
  assert.equal(before.month.delivered, deliveredMtd);
  const day = facts.find((row: { date: string }) => row.date === '2026-10-16');
  assert.equal(line(page, 'written').result, day && day.nwdsrWritten !== null ? plain(gs.moneyText_(day.nwdsrWritten)) : 'Pending');
  const monthClosing = before.closing.mtd;
  if (monthClosing.through && monthClosing.through <= '2026-10-16' && monthClosing.ratio !== null) {
    assert.equal(line(page, 'closing-mtd').result, plain(gs.percentText_(monthClosing.ratio)));
    assert.match(line(page, 'closing-mtd').source, new RegExp(monthClosing.through));
  } else {
    assert.equal(line(page, 'closing-mtd').result, 'Pending');
  }
  assert.ok(page.priorities.length <= 3);
  assert.match(page.calendarNote, /2nd through the 1st/);
  assert.match(page.calendarNote, /1st through the last calendar day/);
  assert.match(page.verification, /2026-10-16|Oct 16, 2026/);
  assert.match(page.storePeriod, /2026-10-02/);
  assert.match(page.individualPeriod, /2026-10-01/);
  const yesterday = plain(gs.reportCenter_({ session, kind: 'daily' }));
  assert.equal(yesterday.date, '2026-10-17');
  const missing = plain(gs.reportCenter_({ session, kind: 'daily', date: '2026-10-17' }));
  assert.equal(missing.date, '2026-10-17');
  assert.equal(line(missing, 'written').result, 'Pending');
  assert.equal(line(missing, 'delivered').result, 'Pending');
  assert.equal(line(missing, 'written').result === '$0', false);
  assert.match(line(missing, 'written-mtd').source, new RegExp('through ' + writtenThrough));
  assert.match(line(missing, 'written-mtd').source, /not included/);
  assert.equal(line(missing, 'written-mtd').result, plain(gs.moneyText_(writtenMtd)));
  const weekly = plain(gs.reportCenter_({ session, kind: 'weekly' }));
  const monthly = plain(gs.reportCenter_({ session, kind: 'monthly' }));
  const individual = plain(gs.reportCenter_({ session, kind: 'individual' }));
  [weekly, monthly, individual].forEach((report) => {
    assert.equal(report.ready, false);
    assert.equal(report.lines.length, 0);
    assert.equal(report.pdf, '');
    assert.equal(JSON.stringify(report.lines), '[]');
  });
  assert.match(weekly.notice, /not built yet/);
  const pdf = Buffer.from(page.pdf, 'base64').toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);
  assert.equal((pdf.match(/\/Type \/Page[^s]/g) || []).length, 1);
  assert.match(pdf, /MediaBox \[0 0 612 792\]/);
  assert.match(pdf, /Daily Management Summary/);
  const after = plain(gs.home_({ session }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.equal(mail.length, 0);
});
