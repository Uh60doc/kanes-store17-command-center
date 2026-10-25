/**
 * Month-end proof. Store months run the 2nd through the 1st. Salesperson months run the 1st through the last day.
 * The dollars below are test inputs on a copy of the verified October workbook. They never touch production.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, session } from './octoberVerified.ts';
import { table } from './snapshotGrid.ts';

const BASE_WRITTEN = 109993;
const BASE_DELIVERED = 104220;
const BASE_SNAP = 101166;
const PRAKASH_OCTOBER = 39843;
const RENZO_OCTOBER = 10088;

type Input = { uploadOn: string; businessDate: string; written: number; snap: number; delivered: number; prakash: number };
const INPUTS: Input[] = [
  { uploadOn: '2026-10-31', businessDate: '2026-10-31', written: 1000, snap: 1100, delivered: 900, prakash: 700 },
  { uploadOn: '2026-11-01', businessDate: '2026-11-01', written: 200, snap: 250, delivered: 180, prakash: 80 },
  { uploadOn: '2026-11-02', businessDate: '2026-11-02', written: 40, snap: 45, delivered: 30, prakash: 15 },
  { uploadOn: '2026-11-05', businessDate: '2026-10-30', written: 500, snap: 550, delivered: 450, prakash: 60 },
  { uploadOn: '2026-12-31', businessDate: '2026-12-31', written: 300, snap: 310, delivered: 280, prakash: 120 },
  { uploadOn: '2027-01-01', businessDate: '2027-01-01', written: 70, snap: 75, delivered: 60, prakash: 25 },
  { uploadOn: '2027-01-02', businessDate: '2027-01-02', written: 20, snap: 22, delivered: 18, prakash: 9 },
];

const money = (value: number | null) => (value === null || value === undefined ? 'Pending' : (value < 0 ? '-' : '') + '$' + Math.abs(value).toLocaleString('en-US'));
const shown = (value: unknown) => (value === null || value === undefined || value === '' ? 'Pending' : String(value));

test('month-end calendars keep November 1 in the October store month and the November sales month', () => {
  const { gs, tabs, setToday } = harness();
  const failures: string[] = [];
  const check = (label: string, expected: unknown, actual: unknown) => {
    const same = expected === actual || (Number.isNaN(expected) && Number.isNaN(actual));
    const line = `${label}: expected ${shown(expected)} | calculated ${shown(actual)}`;
    console.log(same ? `OK  ${line}` : `FAIL ${line}`);
    if (!same) failures.push(line);
  };
  const dayRow = (date: string) => table(tabs, 'CC_Daily').find((row) => row.date === date);
  const historyRows = (name: string) => table(tabs, name).filter((row) => (row.date || row.business_date || '') <= '2026-10-15');
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
  const seeded = plain(gs.installHistoricalSeed_());
  console.log(`Prior-year register before the test inputs: ${seeded.added} days added, ${seeded.same} days already on file.`);
  const october15Before = { ...dayRow('2026-10-15') };
  const historyBefore = {
    daily: digest(table(tabs, 'CC_Daily').filter((row) => row.date <= '2026-10-15')),
    dailyHistory: digest(historyRows('CC_DailyHistory')),
    monthlyHistory: digest(historyRows('CC_MonthlyHistory')),
    lastYear: digest(table(tabs, 'CC_LastYear')),
    snapLy: digest(table(tabs, 'SNAP_WRITTEN_LY')),
    writtenLy: digest(table(tabs, 'NWDSR_WRITTEN_LY')),
    deliveredLy: digest(table(tabs, 'NWDSR_DELIVERED_LY')),
  };
  const priorYear = ['SNAP Written', 'NWDSR Written', 'NWDSR Delivered'].flatMap((metric) =>
    ['2025-10-17', '2025-11-01', '2025-11-02'].map((date) => ({ metric, date, amount: plain(gs.historicalAmount_(metric, date)) })),
  );

  console.log('\nVerified base already on file through 2026-10-15 (not part of the test inputs)');
  console.log(`Store NWDSR written ${money(BASE_WRITTEN)} | delivered ${money(BASE_DELIVERED)} | SNAP ${money(BASE_SNAP)}`);
  console.log(`Prakash Gandhi SNAP ${money(PRAKASH_OCTOBER)} | Renzo Del Solar SNAP ${money(RENZO_OCTOBER)}`);
  console.log(`2026-10-15 on CC_Daily: written ${october15Before.nwdsr_written} | SNAP ${october15Before.snap_written} | delivered ${october15Before.nwdsr_delivered}`);
  console.log('\nTest inputs (business date is the report date, not the upload date)');
  for (const input of INPUTS) {
    console.log(`${input.businessDate} uploaded ${input.uploadOn}: NWDSR written ${money(input.written)} | store SNAP ${money(input.snap)} | delivered ${money(input.delivered)} | Prakash SNAP ${money(input.prakash)}`);
  }

  const file = (input: Input) => {
    setToday(input.uploadOn);
    const written = gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: input.businessDate, storeTotal: input.written });
    const snap = gs.writeDailyAmount_({ reportType: 'SNAP Written', start: input.businessDate, storeTotal: input.snap });
    const delivered = gs.writeDailyAmount_({ reportType: 'NWDSR Delivered', start: input.businessDate, storeTotal: input.delivered });
    gs.writeSnapAssociates_({ start: input.businessDate, reportType: 'SNAP Written' }, `GANDHI, PRAKASH ${input.prakash}`, `proof-${input.businessDate}`);
    check(`${input.businessDate} written row status`, 'imported', written);
    check(`${input.businessDate} SNAP row status`, 'imported', snap);
    check(`${input.businessDate} delivered row status`, 'imported', delivered);
    check(`${input.businessDate} stored on its own CC_Daily date`, input.businessDate, dayRow(input.businessDate)?.date);
    check(`${input.businessDate} stored NWDSR written`, input.written, Number(dayRow(input.businessDate)?.nwdsr_written));
  };
  const storeSum = (field: string, start: string, end: string) => gs.sumField_(gs.dailyFacts_(), field, start, end);
  const prakash = (start: string, end: string) => table(tabs, 'CC_AssociateDays')
    .filter((row) => row.display_name === 'Prakash Gandhi' && row.date >= start && row.date <= end)
    .reduce((total, row) => total + Number(row.amount), 0);
  const renzo = (start: string, end: string) => table(tabs, 'CC_AssociateDays')
    .filter((row) => row.display_name === 'Renzo Del Solar' && row.date >= start && row.date <= end)
    .reduce((total, row) => total + Number(row.amount), 0);
  const kpi = (home: any, name: string) => (home.board.kpis as any[]).find((item) => item.name === name);
  const line = (report: any, key: string) => (report.lines as any[]).find((item) => item.key === key);

  const view = (clock: string) => {
    setToday(clock);
    const home = plain(gs.home_({ session }));
    const people = plain(gs.people_({ session }));
    const morning = plain(gs.morning_({ session }));
    const review = plain(gs.evaluationCycle_(clock));
    const byName = Object.fromEntries((people.people as any[]).map((person) => [person.name, person]));
    return { home, people, morning, review, byName };
  };

  file(INPUTS[0]!);
  const oct31 = view('2026-10-31');
  console.log('\n--- Clock 2026-10-31. Only the October 31 inputs are on file. ---');
  check('Oct 31 store period', '2026-10-02 through 2026-11-01', oct31.home.period);
  check('Oct 31 sales period', '2026-10-01 through 2026-10-31', oct31.people.period);
  check('Oct 31 store written', BASE_WRITTEN + 1000, oct31.home.board.month.written);
  check('Oct 31 store SNAP', BASE_SNAP + 1100, oct31.home.board.month.snapWritten);
  check('Oct 31 store delivered', BASE_DELIVERED + 900, oct31.home.board.month.delivered);
  check('Oct 31 written goal', 400000, oct31.home.board.month.writtenGoal);
  check('Oct 31 delivered goal', 320000, oct31.home.board.month.deliveredGoal);
  check('Oct 31 Prakash sales-team SNAP', PRAKASH_OCTOBER + 700, oct31.byName['Prakash Gandhi'].snapWritten);
  check('Oct 31 Renzo sales-team SNAP', RENZO_OCTOBER, oct31.byName['Renzo Del Solar'].snapWritten);
  check('Oct 31 bedding KPI', 0.198, kpi(oct31.home, 'Bedding').written);
  check('Oct 31 rugs KPI', 7, kpi(oct31.home, 'Rugs').written);
  const octoberClosing = oct31.home.closing.mtd.ratio;
  check('Oct 31 closing ratio is on file', true, octoberClosing !== null && octoberClosing !== 0);
  check('Oct 31 Morning store period', oct31.home.period, oct31.morning.storePeriod);
  check('Oct 31 Morning sales period', oct31.home.individualPeriod, oct31.morning.individualPeriod);
  check('Oct 31 review prepare date', '2026-11-02', oct31.review.prepare);
  check('Oct 31 review covers', '2026-08-01 to 2026-08-31 | 2026-09-01 to 2026-09-30 | 2026-10-01 to 2026-10-31', oct31.review.covers.map((period: any) => `${period.start} to ${period.end}`).join(' | '));

  file(INPUTS[1]!);
  const nov1 = view('2026-11-01');
  console.log('\n--- Clock 2026-11-01. November 1 is in the October store month and the November sales month. ---');
  check('Nov 1 store period', '2026-10-02 through 2026-11-01', nov1.home.period);
  check('Nov 1 sales period', '2026-11-01 through 2026-11-30', nov1.people.period);
  check('Nov 1 store written', BASE_WRITTEN + 1000 + 200, nov1.home.board.month.written);
  check('Nov 1 store SNAP', BASE_SNAP + 1100 + 250, nov1.home.board.month.snapWritten);
  check('Nov 1 store delivered', BASE_DELIVERED + 900 + 180, nov1.home.board.month.delivered);
  check('Nov 1 written goal', 400000, nov1.home.board.month.writtenGoal);
  check('Nov 1 delivered goal', 320000, nov1.home.board.month.deliveredGoal);
  check('Nov 1 Prakash November SNAP', 80, nov1.byName['Prakash Gandhi'].snapWritten);
  check('Nov 1 Renzo November SNAP', 0, nov1.byName['Renzo Del Solar'].snapWritten);
  check('Nov 1 Prakash October SNAP still excludes November 1', PRAKASH_OCTOBER + 700, prakash('2026-10-01', '2026-10-31'));
  check('Nov 1 closing ratio still October', octoberClosing, nov1.home.closing.mtd.ratio);
  check('Nov 1 bedding KPI still October', 0.198, kpi(nov1.home, 'Bedding').written);
  check('Nov 1 rugs KPI still October', 7, kpi(nov1.home, 'Rugs').written);
  check('Nov 1 Morning store period', '2026-10-02 through 2026-11-01', nov1.morning.storePeriod);
  check('Nov 1 Morning sales period', '2026-11-01 through 2026-11-30', nov1.morning.individualPeriod);
  check('Nov 1 sales goal', 65000, nov1.byName['Prakash Gandhi'].monthlyGoal);
  const nov1Report = plain(gs.reportDaily_({ session, date: '2026-11-01' }, '2026-11-02'));
  console.log('Daily report opened 2026-11-02 for business date 2026-11-01');
  check('Nov 1 report store period', '2026-10-02 through 2026-11-01', nov1Report.storePeriod);
  check('Nov 1 report sales period', '2026-11-01 through 2026-11-30', nov1Report.individualPeriod);
  check('Nov 1 report written MTD', money(BASE_WRITTEN + 1000 + 200), line(nov1Report, 'written-mtd').result);
  check('Nov 1 report written goal', '$400,000', line(nov1Report, 'written-mtd').goal);

  file(INPUTS[2]!);
  const nov2 = view('2026-11-02');
  console.log('\n--- Clock 2026-11-02. The store month starts over. The sales month stays November. ---');
  check('Nov 2 store period', '2026-11-02 through 2026-12-01', nov2.home.period);
  check('Nov 2 sales period', '2026-11-01 through 2026-11-30', nov2.people.period);
  check('Nov 2 store written', 40, nov2.home.board.month.written);
  check('Nov 2 store SNAP', 45, nov2.home.board.month.snapWritten);
  check('Nov 2 store delivered', 30, nov2.home.board.month.delivered);
  check('Nov 2 written goal', 400000, nov2.home.board.month.writtenGoal);
  check('Nov 2 delivered goal', 320000, nov2.home.board.month.deliveredGoal);
  check('Nov 2 Prakash November SNAP', 95, nov2.byName['Prakash Gandhi'].snapWritten);
  check('Nov 2 Renzo November SNAP', 0, nov2.byName['Renzo Del Solar'].snapWritten);
  check('Nov 2 October store written kept', BASE_WRITTEN + 1000 + 200, storeSum('nwdsrWritten', '2026-10-02', '2026-11-01'));
  check('Nov 2 closing ratio', null, nov2.home.closing.mtd.ratio);
  check('Nov 2 bedding KPI', null, kpi(nov2.home, 'Bedding').written);
  check('Nov 2 rugs KPI', null, kpi(nov2.home, 'Rugs').written);
  check('Nov 2 Morning store period', '2026-11-02 through 2026-12-01', nov2.morning.storePeriod);
  check('Nov 2 Morning sales period', '2026-11-01 through 2026-11-30', nov2.morning.individualPeriod);
  const nov2Review = plain(gs.evaluationCycle_('2026-11-02'));
  check('Nov 2 official review covers', '2026-08-01 to 2026-08-31 | 2026-09-01 to 2026-09-30 | 2026-10-01 to 2026-10-31', nov2Review.covers.map((period: any) => `${period.start} to ${period.end}`).join(' | '));
  check('Nov 2 review Prakash October dollars', PRAKASH_OCTOBER + 700, prakash('2026-10-01', '2026-10-31'));
  check('Nov 2 Prakash November 1 dollars stay out of October', 80, prakash('2026-11-01', '2026-11-01'));
  const nov2Report = plain(gs.reportDaily_({ session, date: '2026-11-02' }, '2026-11-03'));
  console.log('Daily report opened 2026-11-03 for business date 2026-11-02');
  check('Nov 2 report store period', '2026-11-02 through 2026-12-01', nov2Report.storePeriod);
  check('Nov 2 report sales period', '2026-11-01 through 2026-11-30', nov2Report.individualPeriod);
  check('Nov 2 report written MTD', money(40), line(nov2Report, 'written-mtd').result);

  file(INPUTS[3]!);
  const late = view('2026-11-05');
  console.log('\n--- Clock 2026-11-05. A late October 30 report updates October, not November. ---');
  check('Late upload stored on 2026-10-30', 500, Number(dayRow('2026-10-30')?.nwdsr_written));
  check('Late upload Prakash on 2026-10-30', 60, prakash('2026-10-30', '2026-10-30'));
  check('Nov 5 live store period', '2026-11-02 through 2026-12-01', late.home.period);
  check('Nov 5 live sales period', '2026-11-01 through 2026-11-30', late.people.period);
  check('Nov 5 live store written stays November', 40, late.home.board.month.written);
  check('October store written after the late report', BASE_WRITTEN + 1000 + 200 + 500, storeSum('nwdsrWritten', '2026-10-02', '2026-11-01'));
  check('October store SNAP after the late report', BASE_SNAP + 1100 + 250 + 550, storeSum('snapWritten', '2026-10-02', '2026-11-01'));
  check('October store delivered after the late report', BASE_DELIVERED + 900 + 180 + 450, storeSum('nwdsrDelivered', '2026-10-02', '2026-11-01'));
  check('November store written does not take October 30', 40, storeSum('nwdsrWritten', '2026-11-02', '2026-12-01'));
  check('Prakash October SNAP after the late report', PRAKASH_OCTOBER + 700 + 60, prakash('2026-10-01', '2026-10-31'));
  check('Prakash November SNAP after the late report', 95, prakash('2026-11-01', '2026-11-30'));
  check('Nov 5 Prakash on the sales team', 95, late.byName['Prakash Gandhi'].snapWritten);

  file(INPUTS[4]!);
  const dec31 = view('2026-12-31');
  console.log('\n--- Clock 2026-12-31. December store month is open. December sales month is open. ---');
  check('Dec 31 store period', '2026-12-02 through 2027-01-01', dec31.home.period);
  check('Dec 31 sales period', '2026-12-01 through 2026-12-31', dec31.people.period);
  check('Dec 31 store written', 300, dec31.home.board.month.written);
  check('Dec 31 store SNAP', 310, dec31.home.board.month.snapWritten);
  check('Dec 31 store delivered', 280, dec31.home.board.month.delivered);
  check('Dec 31 written goal', 400000, dec31.home.board.month.writtenGoal);
  check('Dec 31 Prakash December SNAP', 120, dec31.byName['Prakash Gandhi'].snapWritten);
  check('Dec 31 closing ratio', null, dec31.home.closing.mtd.ratio);
  check('Dec 31 bedding KPI', null, kpi(dec31.home, 'Bedding').written);
  check('Dec 31 Morning store period', '2026-12-02 through 2027-01-01', dec31.morning.storePeriod);
  check('Dec 31 Morning sales period', '2026-12-01 through 2026-12-31', dec31.morning.individualPeriod);
  check('Dec 31 screen review', '2027-01', dec31.review.cycle);
  const dec2Review = plain(gs.evaluationCycle_('2026-12-02'));
  check('Dec 2 official review covers', '2026-09-01 to 2026-09-30 | 2026-10-01 to 2026-10-31 | 2026-11-01 to 2026-11-30', dec2Review.covers.map((period: any) => `${period.start} to ${period.end}`).join(' | '));

  file(INPUTS[5]!);
  const jan1 = view('2027-01-01');
  console.log('\n--- Clock 2027-01-01. January 1 stays in the December store month and starts the January sales month. ---');
  check('Jan 1 store period', '2026-12-02 through 2027-01-01', jan1.home.period);
  check('Jan 1 sales period', '2027-01-01 through 2027-01-31', jan1.people.period);
  check('Jan 1 store written', 370, jan1.home.board.month.written);
  check('Jan 1 store SNAP', 385, jan1.home.board.month.snapWritten);
  check('Jan 1 store delivered', 340, jan1.home.board.month.delivered);
  check('Jan 1 written goal', 400000, jan1.home.board.month.writtenGoal);
  check('Jan 1 delivered goal', 320000, jan1.home.board.month.deliveredGoal);
  check('Jan 1 Prakash January SNAP', 25, jan1.byName['Prakash Gandhi'].snapWritten);
  check('Jan 1 Prakash December SNAP excludes January 1', 120, prakash('2026-12-01', '2026-12-31'));
  check('Jan 1 closing ratio', null, jan1.home.closing.mtd.ratio);
  check('Jan 1 bedding KPI', null, kpi(jan1.home, 'Bedding').written);
  check('Jan 1 Morning store period', '2026-12-02 through 2027-01-01', jan1.morning.storePeriod);
  check('Jan 1 Morning sales period', '2027-01-01 through 2027-01-31', jan1.morning.individualPeriod);
  const jan1Report = plain(gs.reportDaily_({ session, date: '2027-01-01' }, '2027-01-02'));
  console.log('Daily report opened 2027-01-02 for business date 2027-01-01');
  check('Jan 1 report store period', '2026-12-02 through 2027-01-01', jan1Report.storePeriod);
  check('Jan 1 report sales period', '2027-01-01 through 2027-01-31', jan1Report.individualPeriod);
  check('Jan 1 report written MTD', money(370), line(jan1Report, 'written-mtd').result);

  file(INPUTS[6]!);
  const jan2 = view('2027-01-02');
  console.log('\n--- Clock 2027-01-02. The store month starts January. The sales month stays January. ---');
  check('Jan 2 store period', '2027-01-02 through 2027-02-01', jan2.home.period);
  check('Jan 2 sales period', '2027-01-01 through 2027-01-31', jan2.people.period);
  check('Jan 2 store written', 20, jan2.home.board.month.written);
  check('Jan 2 store SNAP', 22, jan2.home.board.month.snapWritten);
  check('Jan 2 store delivered', 18, jan2.home.board.month.delivered);
  check('Jan 2 written goal', 400000, jan2.home.board.month.writtenGoal);
  check('Jan 2 delivered goal', 320000, jan2.home.board.month.deliveredGoal);
  check('Jan 2 Prakash January SNAP', 34, jan2.byName['Prakash Gandhi'].snapWritten);
  check('Jan 2 December store written kept', 370, storeSum('nwdsrWritten', '2026-12-02', '2027-01-01'));
  check('Jan 2 closing ratio', null, jan2.home.closing.mtd.ratio);
  check('Jan 2 bedding KPI', null, kpi(jan2.home, 'Bedding').written);
  check('Jan 2 rugs KPI', null, kpi(jan2.home, 'Rugs').written);
  check('Jan 2 Morning store period', '2027-01-02 through 2027-02-01', jan2.morning.storePeriod);
  check('Jan 2 Morning sales period', '2027-01-01 through 2027-01-31', jan2.morning.individualPeriod);
  const jan2Review = plain(gs.evaluationCycle_('2027-01-02'));
  check('Jan 2 official review covers', '2026-10-01 to 2026-10-31 | 2026-11-01 to 2026-11-30 | 2026-12-01 to 2026-12-31', jan2Review.covers.map((period: any) => `${period.start} to ${period.end}`).join(' | '));
  check('Jan 2 review Prakash October', PRAKASH_OCTOBER + 700 + 60, prakash('2026-10-01', '2026-10-31'));
  check('Jan 2 review Prakash November', 95, prakash('2026-11-01', '2026-11-30'));
  check('Jan 2 review Prakash December', 120, prakash('2026-12-01', '2026-12-31'));
  check('Jan 2 review leaves January out', 34, prakash('2027-01-01', '2027-01-31'));
  const jan2Report = plain(gs.reportDaily_({ session, date: '2027-01-02' }, '2027-01-03'));
  console.log('Daily report opened 2027-01-03 for business date 2027-01-02');
  check('Jan 2 report store period', '2027-01-02 through 2027-02-01', jan2Report.storePeriod);
  check('Jan 2 report sales period', '2027-01-01 through 2027-01-31', jan2Report.individualPeriod);
  check('Jan 2 report written MTD', money(20), line(jan2Report, 'written-mtd').result);

  console.log('\n--- History stays on the original dates ---');
  const october15After = dayRow('2026-10-15');
  check('2026-10-15 written unchanged', october15Before.nwdsr_written, october15After?.nwdsr_written);
  check('2026-10-15 SNAP unchanged', october15Before.snap_written, october15After?.snap_written);
  check('2026-10-15 delivered unchanged', october15Before.nwdsr_delivered, october15After?.nwdsr_delivered);
  check('Daily rows through 2026-10-15', historyBefore.daily, digest(table(tabs, 'CC_Daily').filter((row) => row.date <= '2026-10-15')));
  check('CC_DailyHistory through 2026-10-15', historyBefore.dailyHistory, digest(historyRows('CC_DailyHistory')));
  check('CC_MonthlyHistory through 2026-10-15', historyBefore.monthlyHistory, digest(historyRows('CC_MonthlyHistory')));
  check('CC_LastYear', historyBefore.lastYear, digest(table(tabs, 'CC_LastYear')));
  check('SNAP_WRITTEN_LY', historyBefore.snapLy, digest(table(tabs, 'SNAP_WRITTEN_LY')));
  check('NWDSR_WRITTEN_LY', historyBefore.writtenLy, digest(table(tabs, 'NWDSR_WRITTEN_LY')));
  check('NWDSR_DELIVERED_LY', historyBefore.deliveredLy, digest(table(tabs, 'NWDSR_DELIVERED_LY')));
  for (const sample of priorYear) {
    const again = plain(gs.historicalAmount_(sample.metric, sample.date));
    check(`${sample.date} ${sample.metric}`, sample.amount ? sample.amount.dollars : null, again ? again.dollars : null);
    if (sample.amount) check(`${sample.date} ${sample.metric} store month`, sample.amount.month, again.month);
  }
  check('Renzo October lines unchanged', RENZO_OCTOBER, renzo('2026-10-01', '2026-10-15'));

  console.log(failures.length ? `\nCRITICAL ${failures.length} month-transition check(s) failed.` : '\nEvery month-transition check matched.');
  assert.deepEqual(failures, []);
});
