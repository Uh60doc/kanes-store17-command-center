import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session, tabText, verifiedOctober } from './octoberVerified.ts';

type Row = Record<string, any>;
type Grid = ReturnType<typeof verifiedOctober>[string];

const perq = (date: string, code: string, name: string, opportunities: number) => {
  const view = code || name ? 'PERQ_PERSON' : 'PERQ_STORE';
  return [view, 'daily', date, date, date, date, '17', code, name, '', '', '', opportunities, '', '', 'PERQ Ups + Be Backs', '2026-10-17T12:00:00.000Z', `${view}|daily|${date}|${date}|${date}||${code || 'STORE'}`];
};
const snapLine = (date: string, source: string, name: string, amount: number) => [date, source, name, 'associate', amount, 'test-sha'];
const staffing = (date: string, code: string, name: string, worked: string) => [date, code, name, 'associate', worked, 'no', '', '', 'General Manager confirmation', ''];
const people = (winners: Row) => (winners.people as Row[]).map((person) => [person.name, person.written, person.opportunities]);

/** October 16 with a PERQ salesperson export and SNAP lines, as the morning import would leave it. */
function october16(perqRows: (string | number)[][], snap: (string | number)[][] = []) {
  const tabs = verifiedOctober();
  tabs.CC_Ledger!.push(...(perqRows as Grid));
  tabs.CC_AssociateDays!.push(...(snap as Grid));
  return tabs;
}

test('October 15: the individual PERQ report is the roster, ranked by SNAP Written, and the 7 vs 6 warning stays', () => {
  const { gs, tabs } = harness(verifiedOctober(), '2026-10-16');
  const logs = ['CC_Health', 'CC_Exceptions', 'CC_Alerts'];
  const before = tabText(tabs, logs);
  const morning = plain(gs.morning_({ session }));
  assert.equal(morning.winners.date, '2026-10-15');
  assert.equal(morning.winners.status, 'ready');
  assert.equal(morning.winners.snapReported, true);
  assert.deepEqual(people(morning.winners), [['Ricky Nassif', 910, 3], ['Eric Montes Rodriguez', 500, 3]], 'Ricky first, Eric second');
  const notes = (morning.rosterNotes as string[]).join(' ');
  assert.match(notes, /from the individual PERQ report: Eric Montes Rodriguez \(3 opportunities\) and Ricky Nassif \(3 opportunities\)/);
  assert.match(notes, /Store PERQ shows 7 opportunities but the salesperson report adds to 6\. 1 opportunity is not assigned to any salesperson and was not given to anyone\./);
  assert.ok(!/not on file/.test(JSON.stringify(morning.winners)), 'no "working roster not on file" message');
  assert.equal(tabText(tabs, logs), before, 'the roster is read, nothing is written to CC_Staffing or anywhere else');
  assert.equal(tabs.CC_Staffing!.length, 6, 'only the confirmed October 14 rows are in CC_Staffing');
});

test('a missing individual PERQ report is PERQ Report Pending, not "working roster not on file", and nobody is absent', () => {
  const { gs } = harness();
  const morning = plain(gs.morning_({ session }));
  assert.equal(morning.winners.date, '2026-10-16');
  assert.equal(morning.winners.status, 'pending');
  assert.equal(morning.winners.reason, 'PERQ Report Pending');
  assert.match(morning.winners.detail, /individual PERQ report for 2026-10-16 is not on file yet\. Nobody is marked absent/);
  assert.deepEqual(morning.winners.people, []);
});

test('a later business day works with no staffing records: zero opportunities count, management does not, $0 only on a complete SNAP report', () => {
  const tabs = october16([
    perq('2026-10-16', '', '', 4),
    perq('2026-10-16', 'PGANDH', 'Prakash Gandhi', 3),
    perq('2026-10-16', 'EMON0904', 'Eric Montes Rodriguez', 0),
    perq('2026-10-16', 'JMEYERS', 'Kelly Meyers', 1),
  ], [snapLine('2026-10-16', 'GANDHI, PRAKASH', 'Prakash Gandhi', 1200)]);
  const { gs } = harness(tabs);
  const morning = plain(gs.morning_({ session }));
  assert.equal(morning.winners.status, 'ready');
  assert.deepEqual(people(morning.winners), [['Prakash Gandhi', 1200, 3], ['Eric Montes Rodriguez', 0, 0]], 'Eric was on the report with 0 opportunities and no sale: still working, shown $0');
  const notes = (morning.rosterNotes as string[]).join(' ');
  assert.match(notes, /not counted as salespeople: Kelly Meyers \(management\)/);
  assert.ok(!/Store PERQ shows/.test(notes), 'store 4 equals the salesperson report total 4, so there is no warning');
  assert.equal(tabs.CC_Staffing!.length, 6, 'no staffing record was needed or written');
});

test('without that day\'s SNAP salesperson lines every amount is Pending, never $0', () => {
  const tabs = october16([perq('2026-10-16', 'PGANDH', 'Prakash Gandhi', 2), perq('2026-10-16', 'TNASSI', 'Ricky Nassif', 1)]);
  const missing = plain(harness(tabs).gs.morning_({ session }));
  assert.equal(missing.winners.status, 'ready');
  assert.equal(missing.winners.snapReported, false);
  assert.deepEqual(people(missing.winners), [['Prakash Gandhi', null, 2], ['Ricky Nassif', null, 1]]);
  assert.match(missing.winners.reason, /SNAP Written for 2026-10-16 is not on file yet/);

  tabs.CC_Daily!.push(['2026-10-16', ...Array(tabs.CC_Daily![0]!.length - 1).fill('')]);
  tabs.CC_Daily![tabs.CC_Daily!.length - 1]![(tabs.CC_Daily![0] as string[]).indexOf('snap_written')] = 1500;
  const storeOnly = plain(harness(tabs).gs.morning_({ session }));
  assert.equal(storeOnly.winners.snapReported, false, 'a store SNAP total without salesperson lines does not make anyone $0');
});

test('roles and employment are effective-dated: a later termination does not remove an earlier day, and non-sales staff are left out', () => {
  const tabs = october16([
    perq('2026-10-16', 'TNASSI', 'Ricky Nassif', 2),
    perq('2026-10-16', 'PGANDH', 'Prakash Gandhi', 1),
    perq('2026-10-16', 'SSTOCK', 'Sam Stock', 0),
  ], [snapLine('2026-10-16', 'NASSIF, TARIK', 'Ricky Nassif', 700)]);
  const head = tabs.CC_People![0] as string[];
  const col = (name: string) => head.indexOf(name);
  const ricky = tabs.CC_People!.find((row) => row[0] === 'Ricky Nassif')!;
  ricky[col('status')] = 'Terminated';
  ricky[col('status_effective')] = '2026-10-16';
  ricky[col('prior_status')] = 'Active';
  const sam = Array(head.length).fill('');
  sam[col('name')] = 'Sam Stock'; sam[col('role')] = 'associate'; sam[col('employee_id')] = 'SSTOCK'; sam[col('full_name')] = 'Sam Stock';
  sam[col('position')] = 'Warehouse'; sam[col('status')] = 'Active';
  tabs.CC_People!.push(sam);
  const { gs } = harness(tabs);
  const sixteenth = plain(gs.morning_({ session }));
  assert.deepEqual(people(sixteenth.winners), [['Prakash Gandhi', 0, 1]]);
  assert.match((sixteenth.rosterNotes as string[]).join(' '), /Ricky Nassif \(not employed as a salesperson on 2026-10-16\) and Sam Stock \(not in a sales position\)/);
  const fifteenth = plain(gs.morning_({ session, day: '2026-10-15' }));
  assert.deepEqual(people(fifteenth.winners), [['Ricky Nassif', 910, 3], ['Eric Montes Rodriguez', 500, 3]], 'on October 15 Ricky was still active');
});

test('CC_Staffing stays the manual confirmation and exception record and is never overwritten', () => {
  const tabs = october16([perq('2026-10-16', 'EMON0904', 'Eric Montes Rodriguez', 2), perq('2026-10-16', 'PGANDH', 'Prakash Gandhi', 1)],
    [snapLine('2026-10-16', 'NASSIF, TARIK', 'Ricky Nassif', 300)]);
  tabs.CC_Staffing!.push(staffing('2026-10-16', 'EMON0904', 'Eric Montes Rodriguez', 'no'), staffing('2026-10-16', 'TNASSI', 'Ricky Nassif', 'yes'));
  const saved = JSON.stringify(tabs.CC_Staffing);
  const { gs } = harness(tabs);
  const morning = plain(gs.morning_({ session }));
  assert.deepEqual(morning.winners.people.map((person: Row) => [person.name, person.written, person.source]), [['Ricky Nassif', 300, 'staffing'], ['Prakash Gandhi', 0, 'perq']]);
  const notes = (morning.rosterNotes as string[]).join(' ');
  assert.match(notes, /Eric Montes Rodriguez is on the PERQ report, but CC_Staffing confirms not working on 2026-10-16/);
  assert.match(notes, /Confirmed in CC_Staffing without a PERQ line: Ricky Nassif/);

  const fourteenth = plain(gs.morning_({ session, day: '2026-10-14' }));
  assert.deepEqual(fourteenth.winners.people.map((person: Row) => [person.name, person.written, person.opportunities, person.source]), [['Renzo Del Solar', 2476, 4, 'perq+staffing']], 'the confirmed October 14 record still decides that day');
  assert.equal(JSON.stringify(tabs.CC_Staffing), saved, 'CC_Staffing is unchanged');
});

test('an export that lists every active salesperson with zeros is not taken as who worked until confirmed', () => {
  const tabs = october16([
    perq('2026-10-16', 'RDELSO', 'Renzo Del Solar', 2),
    perq('2026-10-16', 'PGANDH', 'Prakash Gandhi', 0),
    perq('2026-10-16', 'EMON0904', 'Eric Montes Rodriguez', 0),
    perq('2026-10-16', 'TNASSI', 'Ricky Nassif', 1),
    perq('2026-10-16', '', 'Brenda Sanchez', 0),
  ], [snapLine('2026-10-16', 'DELSOLAR, RENZO', 'Renzo Del Solar', 900)]);
  tabs.CC_Staffing!.push(staffing('2026-10-16', 'PGANDH', 'Prakash Gandhi', 'yes'));
  const morning = plain(harness(tabs).gs.morning_({ session }));
  assert.deepEqual(people(morning.winners), [['Renzo Del Solar', 900, 2], ['Prakash Gandhi', 0, 0], ['Ricky Nassif', 0, 1]]);
  assert.match((morning.rosterNotes as string[]).join(' '), /may be the employee list rather than who worked\. Eric Montes Rodriguez and Brenda Sanchez with 0 opportunities are not counted until confirmed in CC_Staffing/);
});

test('the winners day follows closed days back to the last business day, and a chosen day must be before today', () => {
  const tabs = verifiedOctober();
  tabs.CC_SellingDays!.push(['2026-10-16', 'closed']);
  const { gs } = harness(tabs);
  assert.equal(plain(gs.morning_({ session })).winners.date, '2026-10-15');
  assert.deepEqual(people(plain(gs.morning_({ session })).winners), [['Ricky Nassif', 910, 3], ['Eric Montes Rodriguez', 500, 3]]);
  assert.throws(() => gs.morning_({ session, day: '2026-10-17' }), /business day before today/);
  assert.throws(() => gs.morning_({ session, day: '2026-13-01' }), /real date/);
});

test('the rest of the morning meeting and Home are unchanged by the roster', () => {
  const { gs } = harness();
  const home = plain(gs.home_({ session }));
  const morning = plain(gs.morning_({ session }));
  const other = { ...morning, winners: undefined, rosterNotes: undefined, updated: undefined };
  const again = plain(harness().gs.morning_({ session, day: '2026-10-15' }));
  assert.deepEqual({ ...again, winners: undefined, rosterNotes: undefined, updated: undefined }, other, 'choosing a winners day changes only the winners section');
  assert.equal(morning.yesterday.written.actual, home.board.yesterday.written.actual);
  assert.equal(morning.today.written, home.board.today.written);
});
