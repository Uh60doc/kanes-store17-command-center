/**
 * New-hire training progress on the verified October workbook. Production is never opened.
 * A calendar day does not complete a block, and a quiz score is not stored.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const manager = { role: 'manager', username: 'regression' };
const KEYS = ['day1-materials', 'day2-materials', 'day3-materials', 'day4-materials', 'day4-shadow', 'day5-materials', 'day5-roleplay', 'day5-objections', 'day5-floor', 'day5-ticket', 'day5-checklist'];

function blocks(done: string[] = [], initials = 'SC') {
  const marks: Record<string, { done: string; initials?: string }> = {};
  KEYS.forEach((key) => { if (done.includes(key)) marks[key] = { done: 'yes', initials }; });
  return marks;
}

test('five calendar days do not make a new hire ready, and scores are not stored', () => {
  const { gs, tabs, mail } = harness();
  const daily = JSON.stringify(cells(tabs.CC_Daily));
  const people = JSON.stringify(cells(tabs.CC_People));
  const written = Number(plain(gs.home_({ session })).month.written);
  const empty = plain(gs.training_({ session: manager }));
  assert.deepEqual(empty.steps.map((step: { key: string }) => step.key), KEYS);
  assert.equal(empty.materialsOnFile, false);
  assert.equal(empty.scores, false);
  assert.equal(empty.autoReady, false);
  assert.equal(empty.people.length, 0);
  assert.match(empty.notice, /Document Center/);
  assert.deepEqual(empty.goals.map((goal: { amount: number }) => goal.amount), [0, 45000, 45000, 65000]);

  const started = plain(gs.saveTraining_({
    session: manager, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', notes: 'Practice tracker. Not a real completion.', blocks: {},
  }));
  assert.equal(started.saved, true);
  assert.equal(started.current.day.calendarDay, 6);
  assert.equal(started.current.day.number, 5);
  assert.equal(started.current.status, 'Incomplete');
  assert.equal(started.current.ready, false);
  assert.equal(started.current.open.length, KEYS.length);
  assert.equal(started.current.goal.amount, 0);
  assert.equal(started.people.length, 1);

  const shadow = plain(gs.saveTraining_({
    session: manager, id: started.current.id, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', blocks: blocks(['day4-shadow']),
  }));
  assert.equal(shadow.current.status, 'Incomplete');
  assert.equal(shadow.current.tracks.practice, '1 of 2');
  assert.equal(shadow.current.open.some((line: string) => /Customer Service shadowing/.test(line)), false);
  assert.ok(shadow.current.open.some((line: string) => /role-play/.test(line)));
  assert.equal(shadow.people.length, 1);

  assert.throws(() => gs.saveTraining_({
    session: manager, id: started.current.id, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', blocks: { 'day5-roleplay': { done: 'yes', initials: '' } },
  }), /initials/);
  assert.throws(() => gs.saveTraining_({
    session: manager, id: started.current.id, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', ready: 'yes', readyInitials: 'SC', blocks: blocks(['day4-shadow']),
  }), /Floor readiness/);
  assert.throws(() => gs.saveTraining_({
    session: manager, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', score: 90, blocks: blocks(KEYS),
  }), /test scores/);
  assert.throws(() => gs.saveTraining_({
    session: manager, id: started.current.id, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', notes: 'quiz 90', blocks: {},
  }), /quiz|score/);

  const finished = plain(gs.saveTraining_({
    session: manager, id: started.current.id, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', blocks: blocks(KEYS),
  }));
  assert.equal(finished.current.status, 'Blocks complete');
  assert.equal(finished.current.ready, false);
  assert.match(finished.current.day.label, /does not mean this associate is ready/);

  const ready = plain(gs.saveTraining_({
    session: manager, id: started.current.id, name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-12', ready: 'yes', readyInitials: 'SC', blocks: blocks(KEYS),
  }));
  assert.equal(ready.current.status, 'Ready for the floor');
  assert.equal(ready.current.readyInitials, 'SC');
  assert.equal(ready.current.updatedBy, 'regression');
  assert.equal(ready.people.length, 1);

  const headers = ['doc_id', 'family_id', 'version', 'status', 'title', 'category', 'subcategory', 'source', 'audience', 'file_name', 'mime_type', 'doc_type', 'size_bytes', 'sha256', 'drive_file_id', 'print_file_id', 'print_note', 'document_date', 'doc_revision', 'uploaded_at', 'uploaded_by', 'updated_at', 'updated_by', 'replaces_doc_id', 'note'];
  tabs.CC_Documents = [headers, ['doc-day4', 'fam-day4', 1, 'active', 'Day 4 Customer Service shadowing', 'New Hire', 'Day 1–5 Training Materials', 'Store 17', 'all', 'day4.pdf', 'application/pdf', 'PDF', 10, '', 'drive', '', '', '2026-10-01', '', '2026-10-01', 'admin', '2026-10-01', 'admin', '', '']];
  const linked = plain(gs.training_({ session: manager, id: started.current.id }));
  const shadowItem = linked.current.items.find((item: { key: string }) => item.key === 'day4-shadow');
  assert.equal(linked.materialsOnFile, true);
  assert.equal(shadowItem.links[0].title, 'Day 4 Customer Service shadowing');
  assert.equal(shadowItem.done, true);

  assert.equal(Number(plain(gs.home_({ session })).month.written), written);
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), daily);
  assert.equal(JSON.stringify(cells(tabs.CC_People)), people);
  assert.equal(mail.length, 0);
  vm.runInContext("requireSession_ = function () { return { role: 'sales', username: 'floor' }; };", gs as vm.Context);
  assert.throws(() => gs.dispatch('training', { token: 't' }), /not available for this login/);
  assert.throws(() => gs.dispatch('saveTraining', { token: 't', name: 'Sample Hire', hireDate: '2026-10-12', startDate: '2026-10-13' }), /not available for this login/);
});
