/**
 * End-of-day closeout on the verified October workbook. Production is never opened.
 * The checklist is an attestation. It does not send email or store an alarm code.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const manager = { role: 'manager', username: 'regression' };
const KEYS = ['perq-gone', 'eod-reports', 'business-date', 'email-subject', 'report-numbers', 'recipient-steele', 'recipient-ferguson', 'recipient-franco', 'recipient-store', 'back-doors', 'back-lights', 'main-lights', 'music', 'doors', 'deadbolts', 'alarm', 'go-home'];

function steps(open: string[] = []) {
  const marks: Record<string, boolean> = {};
  KEYS.forEach((key) => { marks[key] = !open.includes(key); });
  return marks;
}

test('a closing is complete only when every attestation is checked', () => {
  const { gs, tabs, mail } = harness();
  const daily = JSON.stringify(cells(tabs.CC_Daily));
  const written = Number(plain(gs.home_({ session })).month.written);
  const empty = plain(gs.closeout_({ session: manager }));
  assert.deepEqual(empty.steps.map((step: { key: string }) => step.key), KEYS);
  assert.equal(empty.mail, false);
  assert.equal(empty.checksAlarm, false);
  assert.equal(empty.current.status, 'Incomplete');
  assert.equal(empty.current.open.length, KEYS.length);
  assert.match(empty.notice, /does not send the end-of-day email/);
  assert.match(empty.notice, /does not check the locks or the alarm/);
  assert.doesNotMatch(empty.notice, /alarm is set/i);

  const partial = plain(gs.saveCloseout_({
    session: manager, date: '2026-10-16', manager: 'Sample Close', notes: 'Practice attestation.', status: 'Complete', steps: steps(['alarm', 'go-home']),
  }));
  assert.equal(partial.saved, true);
  assert.equal(partial.current.status, 'Incomplete');
  assert.equal(partial.current.completedAt, '');
  assert.deepEqual(partial.current.open, [
    'Alarm set. This is an attestation. The website does not know the alarm state.',
    'Go Home. Drive Safe.',
  ]);
  assert.equal(partial.history.length, 1);

  const done = plain(gs.saveCloseout_({
    session: manager, date: '2026-10-16', manager: 'Sample Close', notes: 'Practice attestation.', steps: steps(),
  }));
  assert.equal(done.current.status, 'Complete');
  assert.ok(done.current.completedAt);
  assert.equal(done.history.length, 1);
  const firstStamp = done.current.completedAt;

  const again = plain(gs.saveCloseout_({
    session: manager, date: '2026-10-16', manager: 'Sample Close', notes: 'Practice attestation.', steps: steps(),
  }));
  assert.equal(again.current.completedAt, firstStamp);
  assert.equal(again.history.length, 1);

  const opened = plain(gs.saveCloseout_({
    session: manager, date: '2026-10-16', manager: 'Sample Close', notes: 'Practice attestation.', steps: steps(['music']),
  }));
  assert.equal(opened.current.status, 'Incomplete');
  assert.equal(opened.current.completedAt, '');
  assert.equal(opened.history.length, 1);

  assert.throws(() => gs.saveCloseout_({ session: manager, date: '2026-10-16', manager: '', steps: steps() }), /closing manager/);
  assert.throws(() => gs.saveCloseout_({ session: manager, date: '2026-10-18', manager: 'Sample Close', steps: steps() }), /future/);
  assert.throws(() => gs.saveCloseout_({ session: manager, date: '2026-10-16', manager: 'Sample Close', notes: 'alarm code 1234', steps: steps() }), /alarm code|building secret/i);
  assert.throws(() => gs.saveCloseout_({ session: manager, date: '2026-10-16', manager: 'Sample Close', notes: 'side door 4821', steps: steps() }), /building secret/);
  const stored = JSON.stringify(cells(tabs.CC_Closeout));
  assert.doesNotMatch(stored, /1234|4821/);

  assert.equal(Number(plain(gs.home_({ session })).month.written), written);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), daily);
  assert.equal(mail.length, 0);
  vm.runInContext("requireSession_ = function () { return { role: 'sales', username: 'floor' }; };", gs as vm.Context);
  assert.throws(() => gs.dispatch('closeout', { token: 't' }), /not available for this login/);
  assert.throws(() => gs.dispatch('saveCloseout', { token: 't', manager: 'Sample Close', steps: steps() }), /not available for this login/);
});
