/**
 * Regression tests on the verified October 2026 records (through October 15). The expected figures are the ones the
 * October data integrity audit verified against the source reports; a code change that moves any of them fails here.
 * Every test runs on its own in-memory copy of the workbook.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session, verifiedOctober } from './octoberVerified.ts';
import { table, textGrid } from './snapshotGrid.ts';

type Row = Record<string, any>;
const rows = (tabs: ReturnType<typeof verifiedOctober>, name: string) => table(tabs, name);

test('store sales totals match the verified October figures', () => {
  const { gs, tabs } = harness();
  const home = plain(gs.home_({ session }));
  assert.equal(home.period, '2026-10-02 through 2026-11-01');
  assert.deepEqual(
    { written: home.board.month.written, delivered: home.board.month.delivered, snap: home.board.month.snapWritten, variance: home.board.month.snapVariance },
    { written: 109993, delivered: 104220, snap: 101166, variance: -8827 },
  );
  assert.equal(home.board.month.writtenLeft, 290007);
  assert.equal(home.board.month.deliveredLeft, 215780);
  assert.equal(home.board.month.writtenAchieved, 0.275);
  assert.equal(home.board.today.written, 18125.44);
  assert.equal(home.board.today.delivered, 13486.25);
  // The month total is the sum of the daily reports, negative days included.
  const daily = rows(tabs, 'CC_Daily').filter((row) => row.date >= '2026-10-02' && row.date <= '2026-10-15');
  assert.equal(daily.reduce((total, row) => total + Number(row.nwdsr_written), 0), 109993);
  assert.equal(daily.reduce((total, row) => total + Number(row.snap_written), 0), 101166);
  gs.refreshRollup_();
  const rollup = Object.fromEntries(rows(tabs, 'CC_Rollup').map((row) => [row.metric, row.value]));
  assert.equal(Number(rollup.nwdsr_written), 109993);
  assert.equal(Number(rollup.written_remaining), 290007);
});

test('store closing ratio is purchasing customers over PERQ opportunities for the same dates', () => {
  const { gs } = harness();
  const closing = plain(gs.closing_({ session }));
  assert.deepEqual({ customers: closing.store.customers, opportunities: closing.store.opportunities, ratio: closing.store.ratio, through: closing.store.through }, { customers: 54, opportunities: 111, ratio: 0.486, through: '2026-10-15' });
  assert.match(closing.store.opportunitySource, /snapshot 2026-10-02 to 2026-10-13 \(100\) \+ daily 2026-10-14 to 2026-10-15 \(11\)/);
  const home = plain(gs.home_({ session }));
  assert.equal(home.board.kpis.find((kpi: Row) => kpi.name === 'Closing Ratio').written, 0.486);
});

test('individual closing ratio is Group 17 written orders over PERQ salesperson opportunities through a common date', () => {
  const { gs } = harness();
  const people = plain(gs.closing_({ session })).people as Row[];
  const byName = Object.fromEntries(people.map((person) => [person.name, [person.orders, person.opportunities, person.ratio, person.through]]));
  assert.deepEqual(byName['Renzo Del Solar'], [9, 11, 0.818, '2026-10-15']);
  assert.deepEqual(byName['Prakash Gandhi'], [11, 31, 0.355, '2026-10-15']);
  assert.deepEqual(byName['Eric Montes Rodriguez'], [12, 35, 0.343, '2026-10-15']);
  assert.deepEqual(byName['Ricky Nassif'], [17, 35, 0.486, '2026-10-15']);
});

test('KPI attachment rates are recalculated from sold and qualified counts', () => {
  const { gs } = harness();
  const kpis = Object.fromEntries((plain(gs.home_({ session })).board.kpis as Row[]).map((kpi) => [kpi.name, [kpi.written, kpi.delivered]]));
  assert.deepEqual(kpis, {
    Bedding: [0.198, 0.12],
    'Closing Ratio': [0.486, null],
    'Average Ticket': [1964.16, 1270.98],
    Rugs: [7, 3],
    'Fabric Maintenance': [0.631, 0.875],
    'Leather Maintenance': [0.6, 0.778],
    'Power Upholstery': [0.778, 0.875],
    'Mattress Protectors': [0.3, 0.75],
    'Total Attachment': [0.614, 0.856],
    'Adjustable Base Attachment': [0.273, 0.2],
    Pillows: [0, 0],
    'Wood / Furniture Protection': [0.136, 0.229],
    Financing: [0.234, 0.471],
  });
  const people = plain(gs.people_({ session })).people as Row[];
  let checked = 0;
  for (const person of people) {
    for (const side of ['written', 'delivered']) {
      const analysis = person.analysis?.[side];
      if (!analysis?.tallies) continue;
      for (const key of ['fabric', 'leather', 'power']) {
        const tally = analysis.tallies[key];
        const expected = tally.qualified > 0 ? Math.round((tally.sold / tally.qualified) * 1000) / 1000 : null;
        assert.equal(analysis[key].value, expected, `${person.name} ${side} ${key}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 24, `checked ${checked} salesperson rates`);
});

test('reporting periods: the store month runs 2nd to 1st and the salesperson month 1st to last day', () => {
  const { gs, tabs } = harness();
  assert.deepEqual(plain(gs.storePeriodContaining_('2026-11-01')), plain(gs.storePeriodContaining_('2026-10-02')));
  assert.equal(gs.storePeriodContaining_('2026-10-01').start, '2026-09-02');
  assert.equal(gs.individualPeriodContaining_('2026-10-01').start, '2026-10-01');
  assert.equal(gs.individualPeriodContaining_('2026-11-01').start, '2026-11-01');
  const people = plain(gs.people_({ session }));
  assert.equal(people.period, '2026-10-01 through 2026-10-31');
  // October 1 belongs to the salesperson month only: its SNAP Written is pending there and never reaches the store month.
  assert.deepEqual(people.snapPending, ['2026-10-01']);
  tabs.CC_Daily!.push([new Date('2026-10-01T16:00:00Z'), 5000, 5000, 5000]);
  const home = plain(harness(tabs).gs.home_({ session }));
  assert.equal(home.board.month.written, 109993);
  assert.equal(home.board.month.snapWritten, 101166);
});

test('salesperson and store months stay on their own calendars through the year change', () => {
  const { gs, tabs, setToday } = harness();
  const show = (day: string) => {
    setToday(day);
    const home = plain(gs.home_({ session }));
    const people = plain(gs.people_({ session }));
    const review = plain(gs.evaluationCycle_(day));
    return { store: home.period, sales: people.period, written: home.board.month.written, writtenGoal: home.board.month.writtenGoal, covers: review.covers.map((period: Row) => period.start + ' to ' + period.end), prepare: review.prepare };
  };
  const oct31 = show('2026-10-31');
  assert.equal(oct31.sales, '2026-10-01 through 2026-10-31');
  assert.equal(oct31.store, '2026-10-02 through 2026-11-01');
  assert.equal(oct31.written, 109993);
  assert.equal(oct31.writtenGoal, 400000);
  const nov1 = show('2026-11-01');
  assert.equal(nov1.sales, '2026-11-01 through 2026-11-30');
  assert.equal(nov1.store, '2026-10-02 through 2026-11-01');
  assert.equal(nov1.written, 109993, 'November 1 still shows the October store total');
  const nov2 = show('2026-11-02');
  assert.equal(nov2.sales, '2026-11-01 through 2026-11-30');
  assert.equal(nov2.store, '2026-11-02 through 2026-12-01');
  assert.equal(nov2.written, null, 'November store has no verified days yet, so it is pending rather than October reset to zero');
  assert.equal(nov2.writtenGoal, 400000, 'the standing store goal carries into November without a config edit');
  assert.equal(nov2.prepare, '2026-11-02');
  assert.deepEqual(nov2.covers, ['2026-08-01 to 2026-08-31', '2026-09-01 to 2026-09-30', '2026-10-01 to 2026-10-31']);
  const dec1 = show('2026-12-01');
  assert.equal(dec1.sales, '2026-12-01 through 2026-12-31');
  assert.equal(dec1.store, '2026-11-02 through 2026-12-01');
  const dec2 = show('2026-12-02');
  assert.equal(dec2.sales, '2026-12-01 through 2026-12-31');
  assert.equal(dec2.store, '2026-12-02 through 2027-01-01');
  assert.deepEqual(dec2.covers, ['2026-09-01 to 2026-09-30', '2026-10-01 to 2026-10-31', '2026-11-01 to 2026-11-30']);
  const jan1 = show('2027-01-01');
  assert.equal(jan1.sales, '2027-01-01 through 2027-01-31');
  assert.equal(jan1.store, '2026-12-02 through 2027-01-01');
  const jan2 = show('2027-01-02');
  assert.equal(jan2.sales, '2027-01-01 through 2027-01-31');
  assert.equal(jan2.store, '2027-01-02 through 2027-02-01');
  assert.deepEqual(jan2.covers, ['2026-10-01 to 2026-10-31', '2026-11-01 to 2026-11-30', '2026-12-01 to 2026-12-31']);
  const feb2 = show('2027-02-02');
  assert.deepEqual(feb2.covers, ['2026-11-01 to 2026-11-30', '2026-12-01 to 2026-12-31', '2027-01-01 to 2027-01-31']);
  // Day math stays on the calendar date across the daylight-saving changes.
  assert.equal(gs.shiftDate_('2026-11-01', -1), '2026-10-31');
  assert.equal(gs.shiftDate_('2027-03-14', 1), '2027-03-15');
  assert.equal(gs.individualPeriodContaining_('2026-11-01').start, '2026-11-01');
  assert.equal(gs.individualPeriodContaining_('2026-10-31').end, '2026-10-31');

  const october15 = rows(tabs, 'CC_Daily').find((row) => row.date === '2026-10-15')!;
  const october15Written = Number(october15.nwdsr_written);
  const dailyBefore = rows(tabs, 'CC_Daily').length;
  setToday('2026-11-02');
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-31', storeTotal: -250 }), 'imported');
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-11-01', storeTotal: 400 }), 'imported');
  assert.equal(rows(tabs, 'CC_Daily').length, dailyBefore + 2);
  assert.equal(Number(rows(tabs, 'CC_Daily').find((row) => row.date === '2026-10-15')!.nwdsr_written), october15Written);
  const dated = (start: string, end: string) => rows(tabs, 'CC_Daily').filter((row) => row.date >= start && row.date <= end).reduce((total, row) => total + Number(row.nwdsr_written || 0), 0);
  assert.equal(dated('2026-10-02', '2026-11-01'), 109993 - 250 + 400, 'October store keeps October 31 and November 1');
  assert.equal(dated('2026-10-01', '2026-10-31'), dated('2026-10-02', '2026-10-31'), 'November 1 is not an October salesperson day');
  assert.equal(dated('2026-11-02', '2026-12-01'), 0, 'the late October report does not land in the November store month');
  setToday('2026-11-01');
  assert.equal(plain(gs.home_({ session })).board.month.written, 109993 - 250 + 400);
  setToday('2026-11-02');
  assert.equal(plain(gs.home_({ session })).board.month.written, null);
  assert.equal(plain(gs.people_({ session })).period, '2026-11-01 through 2026-11-30');
});

test('a duplicate or conflicting daily import never adds a second figure', () => {
  const { gs, tabs } = harness();
  const before = textGrid(tabs.CC_Daily);
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-15', storeTotal: 1410 }), 'same');
  assert.deepEqual(textGrid(tabs.CC_Daily), before);
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-15', storeTotal: 9999 }), 'conflict');
  assert.deepEqual(textGrid(tabs.CC_Daily), before);
  // The same file again is recognised by its sha256 and changes nothing.
  const imported = rows(tabs, 'CC_Imports').find((row) => row.status === 'imported')!;
  const ledgerBefore = textGrid(tabs.CC_Ledger);
  const again = plain(gs.processUpload_({ sha: imported.sha256, bytes: [37, 80, 68, 70], fileName: 'again.pdf', date: '2026-10-15', confirmed: true, role: 'admin' }));
  assert.equal(again.status, 'Already on file');
  assert.deepEqual(textGrid(tabs.CC_Ledger), ledgerBefore);
  assert.deepEqual(textGrid(tabs.CC_Daily), before);
  const home = plain(gs.home_({ session }));
  assert.equal(home.board.month.written, 109993);
});

test('negative corrections reduce the totals instead of being dropped', () => {
  const { gs, tabs } = harness();
  const october2 = rows(tabs, 'CC_Daily').find((row) => row.date === '2026-10-02')!;
  assert.equal(Number(october2.snap_written), -284);
  const renzo = rows(tabs, 'CC_AssociateDays').filter((row) => row.display_name === 'Renzo Del Solar' && row.date >= '2026-10-01' && row.date <= '2026-10-31');
  assert.ok(renzo.some((row) => Number(row.amount) === -1330));
  assert.equal(renzo.reduce((total, row) => total + Number(row.amount), 0), 10088);
  const people = Object.fromEntries((plain(gs.people_({ session })).people as Row[]).map((person) => [person.name, person.snapWritten]));
  assert.deepEqual({ renzo: people['Renzo Del Solar'], prakash: people['Prakash Gandhi'], eric: people['Eric Montes Rodriguez'], ricky: people['Ricky Nassif'] }, { renzo: 10088, prakash: 39843, eric: 32294, ricky: 17715 });
  // Lines for people not on the roster stay in the store total: every SNAP line adds up to the store SNAP figure.
  const store = rows(tabs, 'CC_AssociateDays').filter((row) => row.date >= '2026-10-02' && row.date <= '2026-10-15').reduce((total, row) => total + Number(row.amount), 0);
  assert.equal(store, 101166);
});

test('month-end reconciliation rebuilds the verified month to date exactly', () => {
  const { gs, tabs } = harness();
  const before = textGrid(tabs.CC_MonthEnd);
  gs.refreshMonthEnd_();
  assert.deepEqual(textGrid(tabs.CC_MonthEnd), before);
  const store = Object.fromEntries(rows(tabs, 'CC_MonthEnd').filter((row) => row.period_key === 'STORE-2026-10').map((row) => [row.metric, [row.verified_mtd, row.verified_through]]));
  assert.deepEqual(store['NWDSR Written'], ['109993', '2026-10-15']);
  assert.deepEqual(store['NWDSR Delivered'], ['104220', '2026-10-15']);
  assert.deepEqual(store['SNAP Written'], ['101166', '2026-10-15']);
  assert.deepEqual(store['Purchasing customers'], ['54', '2026-10-15']);
  assert.deepEqual(store['PERQ opportunities'], ['111', '2026-10-15']);
  assert.deepEqual(store['Closing ratio'], ['0.486', '2026-10-15']);
});

test('a terminated or unmatched employee keeps every historical record', () => {
  const { gs, tabs } = harness();
  const head = tabs.CC_People![0] as string[];
  const renzo = tabs.CC_People!.find((row) => row[0] === 'Renzo Del Solar')!;
  renzo[head.indexOf('status')] = 'Terminated';
  renzo[head.indexOf('status_effective')] = new Date('2026-10-16T16:00:00Z');
  renzo[head.indexOf('prior_status')] = 'Active';
  const historyBefore = rows(tabs, 'CC_DailyHistory').filter((row) => row.employee_name === 'Renzo Del Solar').length;
  // The Sales Team board lists current associates; the associate summary still has every October figure.
  const board = plain(harness(tabs).gs.people_({ session })).people as Row[];
  assert.ok(!board.some((person) => person.name === 'Renzo Del Solar'));
  const [shown] = plain(harness(tabs).gs.peopleRows_('2026-10-01', '2026-10-31', { only: 'Renzo Del Solar' })) as Row[];
  assert.equal(shown.snapWritten, 10088);
  assert.equal(shown.deliveredSales, 32267.82);
  assert.equal(shown.writtenOrders, 9);
  gs.refreshMonthEnd_();
  assert.ok(rows(tabs, 'CC_MonthEnd').some((row) => row.person === 'Renzo Del Solar' && row.metric === 'SNAP Written'));
  gs.refreshHistory_();
  const after = rows(tabs, 'CC_DailyHistory');
  assert.equal(after.filter((row) => row.employee_name === 'Renzo Del Solar').length, historyBefore);
  // Names that are not on the roster are kept under the printed name.
  assert.ok(after.some((row) => row.employee_name === 'Chaves Felipe' && row.sales_dollars === '-180'));
});

test('a recalculation leaves every imported and verified figure as it was', () => {
  const { gs, tabs } = harness();
  const before = structuredClone(tabs);
  gs.refreshRollup_();
  gs.refreshMonthEnd_();
  gs.refreshHistory_();
  gs.refreshMetricRegistry_();
  ['home_', 'daily_', 'closing_', 'people_', 'morning_', 'bedding_'].forEach((page) => gs[page]!({ session }));
  const changed = Object.keys(tabs).filter((name) => JSON.stringify(cells(tabs[name])) !== JSON.stringify(cells(before[name])));
  // Recalculated tabs may refresh their timestamps; imported sales/KPI figures must not change.
  // CC_People / CC_RosterHistory / CC_AssociateDays may gain GM-confirmed former identities and rematched roles only.
  const imported = ['CC_Daily', 'CC_Ledger', 'CC_Closing', 'CC_AssociateDays', 'CC_Kpi', 'CC_Imports', 'CC_Uploads', 'CC_People', 'CC_Config', 'CC_DailyHistory', 'CC_MonthlyHistory', 'CC_GoalHistory', 'CC_SourceArchive', 'CC_History', 'CC_DailyGoals', 'CC_MonthEnd'];
  const identity = ['CC_People', 'CC_RosterHistory', 'CC_AssociateDays'];
  assert.deepEqual(changed.filter((name) => imported.includes(name) && !identity.includes(name)), []);
  assert.equal(Number(plain(gs.home_({ session })).month.written), 109993);
  assert.equal(Number(plain(gs.home_({ session })).month.delivered), 104220);
});
