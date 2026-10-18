import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session, verifiedOctober } from './octoberVerified.ts';

const admin = session;
const manager = { role: 'manager', username: 'regression' };
const LIVE = 'Store17MGMT-Mail@kanesfurniture.onmicrosoft.com';

function enableMail(gs: Record<string, (...args: any[]) => any>, to = LIVE) {
  return plain(gs.saveBriefMailSettings_({ session: admin, enabled: true, to }));
}

test('Morning Start-Up and MTD figures match Home and Sales Team, and missing Oct 16 sources stay Pending', () => {
  const { gs, mail } = harness();
  const home = plain(gs.home_({ session: admin }));
  const people = plain(gs.people_({ session: admin }));
  const brief = plain(gs.brief_({ session: admin }));

  assert.equal(brief.today, '2026-10-17');
  assert.equal(brief.storePeriod, home.period, 'store month 2nd through 1st');
  assert.equal(brief.individualPeriod, home.individualPeriod, 'salesperson month 1st through last day');
  assert.equal(brief.homeWritten, home.yesterday.written);
  assert.equal(brief.homeDelivered, home.yesterday.delivered);
  assert.equal(brief.homeMonthWritten, home.month.written);
  assert.equal(brief.homeMonthDelivered, home.month.delivered);
  assert.equal(brief.peopleCount, people.people.length);

  assert.match(brief.startup.subject, /STORE 17 \| MORNING START-UP \| Oct 17, 2026/);
  assert.match(brief.mtd.subject, /STORE 17 \| MTD PERFORMANCE \| Oct 17, 2026/);
  assert.match(brief.startup.text, /Store 17/);
  assert.match(brief.mtd.text, /2nd through the 1st/);
  assert.match(brief.mtd.text, /1st through the last day/);
  assert.match(brief.startup.html + brief.mtd.html, /KANE'S FURNITURE/);

  assert.equal(brief.partial, true);
  assert.ok(brief.missing.some((line: string) => /2026-10-16/.test(line)), 'yesterday\'s missing reports are named');
  assert.match(brief.startup.text, /Pending/);
  assert.match(brief.startup.text, /PARTIAL REPORT/);
  assert.doesNotMatch(brief.startup.text, /\$0 vs/, 'a missing written day is not shown as zero');

  assert.match(brief.mtd.text, /Last-year written: Pending/);
  assert.match(brief.mtd.text, /CC_LastYear|Pending GM confirmation|last-year/i);
  assert.equal(brief.mail.enabled, false);
  assert.equal(brief.mail.to, LIVE);
  assert.equal(mail.length, 0, 'opening the brief does not send mail');
});

test('October 15 verified winners appear on Start-Up when that is the prior business day', () => {
  const { gs } = harness(verifiedOctober(), '2026-10-16');
  const home = plain(gs.home_({ session: admin }));
  const brief = plain(gs.brief_({ session: admin }));
  const startup = brief.startup.text as string;
  assert.equal(brief.today, '2026-10-16');
  assert.equal(brief.homeWritten, home.yesterday.written);
  assert.match(startup, /Ricky Nassif/);
  assert.match(startup, /Eric Montes Rodriguez|Ricky Nassif/);
  assert.match(startup, /SNAP Written/);
});

test('saved plan notes do not change Home sales figures', () => {
  const { gs } = harness();
  const before = plain(gs.home_({ session: admin }));
  const saved = plain(gs.saveBriefPlan_({
    session: admin,
    action1: 'Walk the floor at 9:00.',
    action2: 'Review open deliveries.',
    action3: 'Confirm the PERQ export.',
    notes: 'Do not treat this note as $1,000,000 written.',
  }));
  assert.deepEqual(saved.priorities, ['Walk the floor at 9:00.', 'Review open deliveries.', 'Confirm the PERQ export.']);
  assert.match(saved.startup.text, /Walk the floor at 9:00/);
  const after = plain(gs.home_({ session: admin }));
  assert.equal(after.yesterday.written, before.yesterday.written);
  assert.equal(after.yesterday.delivered, before.yesterday.delivered);
  assert.equal(after.month.written, before.month.written);
});

test('automatic production delivery stays off and never emails the live list during development', () => {
  const { gs, mail, setHour } = harness();
  const morning = plain(gs.maybeSendBriefEmails_());
  assert.equal(morning.sent, false);
  assert.match(morning.reason, /production delivery is off/);
  assert.equal(mail.length, 0);

  enableMail(gs);
  setHour(5);
  const early = plain(gs.maybeSendBriefEmails_());
  assert.equal(early.sent, false);
  assert.match(early.reason, /before 6:00 AM/);
  assert.equal(mail.length, 0);
});

test('after 6:00 AM ET an enabled store sends Start-Up first, then MTD, and will not duplicate that day', () => {
  const { gs, mail, setHour } = harness();
  enableMail(gs);
  setHour(6);
  const first = plain(gs.maybeSendBriefEmails_());
  assert.equal(first.sent, true);
  assert.equal(mail.length, 2);
  assert.equal(mail[0]!.to, LIVE);
  assert.equal(mail[1]!.to, LIVE);
  assert.match(mail[0]!.subject, /MORNING START-UP/);
  assert.match(mail[1]!.subject, /MTD PERFORMANCE/);
  assert.match(mail[0]!.htmlBody || '', /Store Written sales and daily goal/);
  assert.match(mail[1]!.htmlBody || '', /SNAP Written MTD/);
  assert.ok(first.results[0].sent && first.results[1].sent);

  const again = plain(gs.maybeSendBriefEmails_());
  assert.equal(mail.length, 2, 'the same New York date is not emailed twice');
  assert.deepEqual(again.results.map((row: { reason?: string }) => row.reason), ['already sent today', 'already sent today']);
});

test('a test send needs an explicit address and refuses the live management list', () => {
  const { gs, mail } = harness();
  assert.throws(() => gs.sendBriefTest_({ session: admin, kind: 'startup' }), /test address explicitly/);
  assert.throws(() => gs.sendBriefTest_({ session: admin, kind: 'startup', to: LIVE }), /live management list/);
  assert.throws(() => gs.sendBriefTest_({ session: manager, kind: 'startup', to: 'owner@example.com' }), /Only an Admin/);
  assert.equal(mail.length, 0);

  const sent = plain(gs.sendBriefTest_({ session: admin, kind: 'startup', to: 'gm-test@example.com' }));
  assert.equal(sent.sent, true);
  assert.equal(mail.length, 1);
  assert.equal(mail[0]!.to, 'gm-test@example.com');
  assert.match(mail[0]!.subject, /MORNING START-UP/);

  const mtd = plain(gs.sendBriefTest_({ session: admin, kind: 'mtd', to: 'gm-test@example.com' }));
  assert.equal(mtd.sent, true);
  assert.equal(mail.length, 2);
  assert.match(mail[1]!.subject, /MTD PERFORMANCE/);
});

test('resend to the live list is blocked while production is off', () => {
  const { gs, mail } = harness();
  assert.throws(() => gs.resendBriefEmail_({ session: admin, kind: 'startup' }), /production delivery is off/);
  assert.throws(() => gs.resendBriefEmail_({ session: admin, kind: 'startup', to: LIVE }), /live management list was not used/);
  const copy = plain(gs.resendBriefEmail_({ session: admin, kind: 'mtd', to: 'reprint@example.com' }));
  assert.equal(copy.sent, true);
  assert.equal(mail[0]!.to, 'reprint@example.com');
});

test('an unchanged promotion prints only its name after the first recorded Start-Up', () => {
  const { gs } = harness();
  const first = plain(gs.brief_({ session: admin }));
  assert.match(first.startup.text, /78th Anniversary Sale/);
  gs.sendBriefTest_({ session: admin, kind: 'startup', to: 'promo@example.com' });
  const second = plain(gs.brief_({ session: admin }));
  assert.match(second.startup.text, /78th Anniversary Sale/);
  assert.match(second.startup.text, /name only; the promotion has not changed/);
});

test('the Start-Up preview stays one page, names Pending sources, and does not invent a shout-out', () => {
  const { gs, mail } = harness();
  const brief = plain(gs.brief_({ session: admin }));
  const text = brief.startup.text as string;
  assert.match(text, /Store Written sales and daily goal: Pending/);
  assert.match(text, /Store Delivered sales and daily goal: Pending/);
  assert.match(text, /Store closing ratio: Pending/);
  assert.match(text, /Top salesperson: Pending/);
  assert.match(text, /Shout-out: Pending/);
  assert.match(text, /Today's Written goal:/);
  assert.match(text, /Today's Delivered goal:/);
  assert.match(text, /78th Anniversary Sale/);
  assert.doesNotMatch(text, /Present maintenance plans/);
  assert.doesNotMatch(text, /Sales team/);
  assert.equal(brief.mail.enabled, false);
  assert.equal(mail.length, 0);
  assert.ok(brief.startupMissing.some((line: string) => /NWDSR Delivered for 2026-10-16/.test(line)));
  assert.ok(!brief.startupMissing.some((line: string) => /Bedding|salesperson SNAP/i.test(line)));
});

test('preview does not send mail and sales cannot open the brief routes', () => {
  const { gs, mail } = harness();
  const preview = plain(gs.previewBriefEmail_({ session: manager, kind: 'startup' }));
  assert.match(preview.subject, /MORNING START-UP/);
  assert.match(preview.html, /Store Written sales and daily goal/);
  assert.equal(mail.length, 0);
  const routes = plain(gs.ROUTES_) as Record<string, string[]>;
  assert.deepEqual(routes.brief, ['manager', 'admin']);
  assert.deepEqual(routes.sendBriefTest, ['admin']);
  assert.ok(!routes.brief.includes('sales'));
});
