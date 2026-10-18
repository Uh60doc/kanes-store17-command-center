import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';

test('open actions rank overdue first and keep completed history', () => {
  const { gs } = harness();
  const ranked = plain(gs.actionRank_([
    { status: 'Open', due: '2026-10-20', createdAt: 'a', description: 'later' },
    { status: 'Completed', due: '2026-10-01', createdAt: 'b', description: 'done' },
    { status: 'In Progress', due: '2026-10-16', createdAt: 'c', description: 'overdue' },
    { status: 'Blocked', due: '2026-10-01', createdAt: 'd', description: 'blocked' },
    { status: 'Open', due: '2026-10-17', createdAt: 'e', description: 'today' },
  ], '2026-10-17'));
  assert.deepEqual(ranked.map((action: { description: string }) => action.description), ['overdue', 'today', 'later']);
  assert.equal(plain(gs.actionOverdue_(ranked, '2026-10-17')).length, 1);
  assert.equal(gs.actionDue_(new Date('2026-10-18T16:00:00Z')), '2026-10-18');
  const history = plain(gs.actionHistory_([
    { status: 'Completed', completedAt: '2026-10-02', description: 'older' },
    { status: 'Completed', completedAt: '2026-10-10', description: 'newer' },
    { status: 'Open', completedAt: '', description: 'open' },
  ]));
  assert.deepEqual(history.map((action: { description: string }) => action.description), ['newer', 'older']);
});

test('a suggestion is not saved until a manager approves it, and sales figures stay put', () => {
  const { gs, mail } = harness();
  const before = plain(gs.home_({ session }));
  const page = plain(gs.actions_({ session }));
  assert.deepEqual(plain(gs.ROUTES_).actions, ['manager', 'admin']);
  assert.equal(page.priorities.length, 0);
  assert.equal(page.history.length, 0);
  assert.ok(page.suggestions.some((item: { key: string }) => item.key.indexOf('kpi-') === 0));
  assert.match(page.notice, /emails an employee/);
  assert.equal(page.suggestions.some((item: { key: string }) => item.key.indexOf('rescue-') === 0), false);
  page.suggestions.forEach((item: { lane: string }) => assert.ok(item.lane === 'sales' || item.lane === 'operations'));
  assert.equal(gs.sheet_('CC_Actions').length, 0);
  assert.throws(() => gs.actionSave_({ session, description: ' ', lane: 'sales', assignee: 'Store manager', due: '2026-10-17', status: 'Open' }), /Enter the action/);
  const perq = page.suggestions.find((item: { key: string }) => item.key.indexOf('perq-') === 0);
  const choice = perq || page.suggestions[0];
  const saved = plain(gs.actionSave_({ session, description: choice.description, lane: choice.lane, assignee: choice.assignee, due: '2026-10-16', status: 'Open', note: choice.basis, suggestionKey: choice.key }));
  assert.match(saved.notice, /No employee message/);
  assert.equal(saved.page.priorities[0].description, choice.description);
  assert.equal(saved.page.overdue.length, 1);
  assert.equal(saved.page.suggestions.some((item: { key: string }) => item.key === choice.key), false);
  assert.throws(() => gs.actionSave_({ session, description: choice.description, lane: choice.lane, assignee: choice.assignee, due: '2026-10-17', status: 'Open', suggestionKey: choice.key }), /already an open action/);
  const done = plain(gs.actionSave_({ session, id: saved.id, description: choice.description, lane: choice.lane, assignee: choice.assignee, due: '2026-10-16', status: 'Completed', note: 'Report located. No order was changed.', suggestionKey: choice.key }));
  assert.equal(done.page.history.length, 1);
  assert.equal(done.page.history[0].note, 'Report located. No order was changed.');
  assert.equal(done.page.priorities.length, 0);
  const after = plain(gs.home_({ session }));
  assert.equal(after.month.written, before.month.written);
  assert.equal(after.month.delivered, before.month.delivered);
  assert.equal(mail.length, 0);
  assert.equal(gs.sheet_('CC_ActionLog').length >= 2, true);
});
