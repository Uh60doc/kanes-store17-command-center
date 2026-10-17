import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';

const FILES = ['Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs'];
const admin = { role: 'admin' };

function store(): Record<string, Grid> {
  return {
    CC_People: [
      ['name', 'role', 'SNAP Written'],
      ['Renzo Del Solar', 'associate', 10088],
      ['Prakash Gandhi', 'associate', 39843],
      ['Eric Montes Rodriguez', 'associate', 32294],
      ['Ricky Nassif', 'associate', 17715],
      ['Brenda Sanchez', 'associate', ''],
      ['Caroline Amaro', 'former', ''],
    ],
    CC_AssociateDays: [
      ['date', 'source_name', 'display_name', 'role', 'amount', 'sha256', 'note'],
      ['2026-10-02', 'NASSIF, TARIK', 'Ricky Nassif', 'associate', -260, 'a', ''],
      ['2026-10-02', 'MONTES, ERIC', 'Eric Montes Rodriguez', 'associate', 450, 'a', ''],
      ['2026-10-14', 'NASSIF, TARIK', 'Ricky Nassif', 'associate', 2795, 'b', ''],
      ['2026-10-14', 'GANDHI, PRAKASH', 'Prakash Gandhi', 'associate', 1200, 'b', ''],
    ],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-02', 190, 0, 0], ['2026-10-14', 3995, 2476, 4113]],
  };
}

const team = (gs: Record<string, (...args: any[]) => any>) => plain(gs.activeAssociates_());
const board = (gs: Record<string, (...args: any[]) => any>) => plain(gs.peopleRows_('2026-10-01', '2026-10-31')).map((person: any) => [person.name, person.snapWritten]);

test('adding the roster columns keeps the Sales Team, SNAP totals and every report row exactly as they were', () => {
  const tabs = store();
  const before = loadAppsScript(FILES, tabs, '2026-10-17');
  const teamBefore = team(before);
  const boardBefore = board(before);
  const daysBefore = JSON.stringify(tabs.CC_AssociateDays);

  const gs = loadAppsScript(FILES, tabs, '2026-10-17');
  assert.equal(gs.ensureRosterColumns_(), true);
  assert.equal(gs.ensureRosterColumns_(), false, 'a second run changes nothing');
  assert.deepEqual(team(gs), teamBefore);
  assert.deepEqual(teamBefore, ['Renzo Del Solar', 'Prakash Gandhi', 'Eric Montes Rodriguez', 'Ricky Nassif', 'Brenda Sanchez']);
  assert.deepEqual(board(gs), boardBefore);
  assert.equal(JSON.stringify(tabs.CC_AssociateDays), daysBefore);

  const header = tabs.CC_People![0] as string[];
  assert.deepEqual(header.slice(0, 3), ['name', 'role', 'SNAP Written'], 'the first three columns keep their places');
  const ricky = tabs.CC_People!.find((row) => row[0] === 'Ricky Nassif')!;
  assert.equal(ricky[2], 17715, 'the saved SNAP total is untouched');
  assert.equal(ricky[header.indexOf('employee_id')], 'TNASSI');
  assert.equal(ricky[header.indexOf('full_name')], 'Tarik Nassif');
  const caroline = tabs.CC_People!.find((row) => row[0] === 'Caroline Amaro')!;
  assert.equal(caroline[header.indexOf('status')], 'Terminated');
  const listed = plain(gs.roster_({ session: { role: 'admin' } })).associates.find((person: any) => person.name === 'Caroline Amaro');
  assert.deepEqual([listed.currentStatus, listed.startsLater, listed.onSalesTeam], ['Terminated', false, false], 'a terminated person is not shown as starting later');
  assert.ok(tabs.CC_People!.some((row) => row[0] === 'Kelly Meyers' && row[1] === 'management'));
  assert.ok(tabs.CC_RosterHistory!.length > 1, 'the migration is logged');
});

test('a hire needs admin confirmation, joins the Sales Team on the hire date, and a duplicate is refused', () => {
  const tabs = store();
  const gs = loadAppsScript(FILES, tabs, '2026-10-17');
  const hire = { session: admin, action: 'hire', record: { fullName: 'Maria Lopez Garcia', preferredName: 'Maria', employeeId: 'mlop1022', hireDate: '2026-10-20', position: 'Sales Associate' } };

  const preview = plain(gs.saveAssociate_(hire));
  assert.equal(preview.confirmed, false);
  assert.match(preview.preview.summary, /Hire Maria Lopez Garcia \(MLOP1022\) as Sales Associate, Active from 2026-10-20/);
  assert.match(preview.preview.teamNote, /Joins the Sales Team on the hire date 2026-10-20/);
  assert.ok(!tabs.CC_People!.some((row) => row[0] === 'Maria Lopez Garcia'), 'nothing is written before confirmation');

  const saved = plain(gs.saveAssociate_({ ...hire, confirm: true }));
  assert.equal(saved.confirmed, true);
  assert.ok(!team(gs).includes('Maria Lopez Garcia'), 'not on the team before the hire date');
  const later = loadAppsScript(FILES, tabs, '2026-10-20');
  assert.ok(team(later).includes('Maria Lopez Garcia'), 'on the team from the hire date');
  assert.ok(tabs.CC_RosterHistory!.some((row) => row[1] === 'hire' && row[3] === 'Maria Lopez Garcia' && row[8] === 'admin'));

  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'hire', confirm: true, record: { fullName: 'Someone Else', hireDate: '2026-10-21', employeeId: 'TNASSI' } }), /already belongs to Ricky Nassif/);
  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'hire', confirm: true, record: { fullName: 'Caroline Amaro', hireDate: '2026-11-01' } }), /already on the roster\. Use Rehire/);
  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'hire', confirm: true, record: { fullName: 'No Date' } }), /hire date/);
  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'hire', confirm: true, record: { fullName: 'Bad Date', hireDate: '2026-02-30' } }), /real date/);
});

test('a termination is dated, keeps every historical sale, and the associate stays in reports for the dates worked', () => {
  const tabs = store();
  const gs = loadAppsScript(FILES, tabs, '2026-10-17');
  gs.ensureRosterColumns_();
  const days = JSON.stringify(tabs.CC_AssociateDays);
  const daily = JSON.stringify(tabs.CC_Daily);
  const ricky = plain(gs.peopleRows_('2026-10-01', '2026-10-31', { only: 'Ricky Nassif', cachedSnap: false }))[0].snapWritten;

  gs.saveAssociate_({ session: admin, action: 'status', name: 'Ricky Nassif', confirm: true, record: { status: 'Terminated', effectiveDate: '2026-10-25' } });
  assert.ok(team(gs).includes('Ricky Nassif'), 'a future termination date leaves him on the team until then');
  const after = loadAppsScript(FILES, tabs, '2026-10-25');
  assert.ok(!team(after).includes('Ricky Nassif'), 'off the active team from the effective date');
  assert.equal(JSON.stringify(tabs.CC_AssociateDays), days, 'no SNAP line is removed or relabeled');
  assert.equal(JSON.stringify(tabs.CC_Daily), daily, 'store totals are untouched');
  assert.equal(plain(after.peopleRows_('2026-10-01', '2026-10-31', { only: 'Ricky Nassif', cachedSnap: false }))[0].snapWritten, ricky, 'his October SNAP total is the same');

  vm.runInContext("requireSession_ = function () { return { role: 'manager' }; }; healthValue_ = function () { return ''; };", after as vm.Context);
  const summary = plain(after.summary_({ session: { role: 'manager' }, name: 'Ricky Nassif', start: '2026-10-01', end: '2026-10-24' }));
  assert.equal(summary.name, 'Ricky Nassif', 'a former associate stays available for the dates he worked');
  assert.ok(!plain(after.summary_({ session: { role: 'manager' }, name: 'Eric Montes Rodriguez' })).associates.includes('Caroline Amaro'), 'Caroline never started and is not offered');
});

test('rehire reuses the same record, and status changes are checked', () => {
  const tabs = store();
  const gs = loadAppsScript(FILES, tabs, '2026-10-17');
  gs.ensureRosterColumns_();
  const rows = tabs.CC_People!.length;
  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'rehire', name: 'Eric Montes Rodriguez', confirm: true, record: {} }), /Rehire is for a transferred or terminated associate/);
  const preview = plain(gs.saveAssociate_({ session: admin, action: 'rehire', name: 'Caroline Amaro', record: { effectiveDate: '2026-11-02' } }));
  assert.match(preview.preview.summary, /Rehire Caroline Amaro as Active from 2026-11-02/);
  gs.saveAssociate_({ session: admin, action: 'rehire', name: 'Caroline Amaro', confirm: true, record: { effectiveDate: '2026-11-02' } });
  assert.equal(tabs.CC_People!.length, rows, 'no duplicate record');
  assert.ok(!team(gs).includes('Caroline Amaro'));
  assert.ok(team(loadAppsScript(FILES, tabs, '2026-11-02')).includes('Caroline Amaro'));

  gs.saveAssociate_({ session: admin, action: 'status', name: 'Renzo Del Solar', confirm: true, record: { status: 'Leave', effectiveDate: '2026-10-17' } });
  assert.ok(team(gs).includes('Renzo Del Solar'), 'an associate on leave stays on the Sales Team');
  gs.saveAssociate_({ session: admin, action: 'status', name: 'Prakash Gandhi', confirm: true, record: { status: 'Management', effectiveDate: '2026-10-17' } });
  assert.ok(!team(gs).includes('Prakash Gandhi'));
  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'status', name: 'Prakash Gandhi', confirm: true, record: { status: 'Retired' } }), /Choose Active, Leave/);
  assert.throws(() => gs.saveAssociate_({ session: admin, action: 'update', name: 'Nobody', confirm: true, record: {} }), /not on the roster/);
});

test('report names match by employee ID and verified aliases, never by a guess between two people', () => {
  const tabs = store();
  const gs = loadAppsScript(FILES, tabs, '2026-10-17');
  gs.ensureRosterColumns_();
  assert.equal(gs.rosterMatch_('', 'NASSIF, TARIK').name, 'Ricky Nassif');
  assert.equal(gs.rosterMatch_('', 'SANCHEZ, BRENDA').name, 'Brenda Sanchez');
  assert.equal(gs.rosterMatch_('emon0904', 'anything').name, 'Eric Montes Rodriguez');
  assert.equal(gs.rosterMatch_('', 'Unknown Person'), null);
  for (const alias of ['tnassi', 'tnassif', 'ricky nassif', 'tarik nassif', 'ricky (tarik) nassif']) assert.ok(gs.personAliases_('Ricky Nassif').includes(alias), alias);

  gs.saveAssociate_({ session: admin, action: 'hire', confirm: true, record: { fullName: 'Brenda Sanchez Diaz', displayName: 'Brenda Diaz', hireDate: '2026-10-17', aliases: 'DIAZ, BRENDA' } });
  assert.equal(gs.rosterMatch_('', 'SANCHEZ, BRENDA').name, 'Brenda Sanchez', 'an exact verified alias still decides');
  assert.equal(gs.rosterMatch_('', 'SANCHEZ DIAZ, BRENDA M'), null, 'two possible people: no match, so nothing is assigned to the wrong person');
  assert.equal(gs.rosterMatch_('', 'DIAZ, BRENDA').name, 'Brenda Diaz');
});

test('roster changes are admin only, checked on the server', () => {
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  for (const role of ['sales', 'manager', 'admin']) {
    const tabs = store();
    const gs = loadAppsScript(FILES, tabs, '2026-10-17');
    vm.runInContext(code, gs as vm.Context);
    vm.runInContext(`requireSession_ = function () { return { role: '${role}' }; };`, gs as vm.Context);
    if (role === 'admin') {
      assert.equal(plain(gs.dispatch('roster', { token: 't' })).associates.length, 12);
      assert.equal(plain(gs.dispatch('saveAssociate', { token: 't', action: 'status', name: 'Eric Montes Rodriguez', record: { status: 'Leave' } })).confirmed, false);
    } else {
      assert.throws(() => gs.dispatch('roster', { token: 't' }), /not available for this login/);
      assert.throws(() => gs.dispatch('saveAssociate', { token: 't', action: 'status', name: 'Eric Montes Rodriguez', confirm: true, record: { status: 'Terminated' } }), /not available for this login/);
    }
  }
});
