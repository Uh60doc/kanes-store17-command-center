/**
 * Email launch control on the verified October workbook. Production is never opened.
 * Both automatic switches stay off, and a missing figure stays Pending.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

const admin = session;
const LIVE = 'Store17MGMT-Mail@kanesfurniture.onmicrosoft.com';

test('both management previews stay unsent while automatic delivery is off', () => {
  const { gs, mail } = harness();
  const home = plain(gs.home_({ session: admin }));
  const page = plain(gs.emailControl_({ session: admin }));
  assert.equal(page.recipient, LIVE);
  assert.equal(page.automatic, 'Off');
  assert.equal(page.startup.enabled, false);
  assert.equal(page.mtd.enabled, false);
  assert.equal(page.approval.approved, false);
  assert.equal(page.mailSent, false);
  assert.equal(page.sourceDate, home.yesterday.date);
  assert.equal(page.homeWritten, home.yesterday.written);
  assert.equal(page.homeDelivered, home.yesterday.delivered);
  assert.equal(page.homeMonthWritten, home.month.written);
  assert.match(page.startup.subject, /MORNING START-UP/);
  assert.match(page.mtd.subject, /MONTH-TO-DATE PERFORMANCE/);
  assert.match(page.startup.text, /Pending/);
  assert.match(page.completeness, /Pending/);
  assert.match(page.schedule, /7:00 AM/);
  assert.match(page.schedule, /not on a desktop/);
  assert.equal(mail.length, 0);

  assert.throws(() => gs.saveBriefMailSettings_({ session: admin, startup: 'yes' }), /Approve this format/);
  const approved = plain(gs.approveBriefFormat_({ session: admin }));
  assert.equal(approved.approval.approved, true);
  assert.equal(approved.automatic, 'Off');
  assert.equal(approved.startup.enabled, false);
  assert.equal(mail.length, 0);

  const enabled = plain(gs.saveBriefMailSettings_({ session: admin, startup: 'yes', mtd: 'no' }));
  assert.equal(enabled.startup.enabled, true);
  assert.equal(enabled.mtd.enabled, false);
  assert.equal(mail.length, 0);
  vm.runInContext("requireSession_ = function () { return { role: 'sales', username: 'floor' }; };", gs as vm.Context);
  assert.throws(() => gs.dispatch('emailControl', { token: 't' }), /not available for this login/);
  assert.throws(() => gs.dispatch('approveBriefFormat', { token: 't' }), /not available for this login/);
});
