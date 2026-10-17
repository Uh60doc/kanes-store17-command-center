import assert from 'node:assert/strict';
import test from 'node:test';
import { appsScriptServices } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';
import { G17_DAY, dates, ledgerRow, nwdsrWritten, octoberBook } from './octoberFixture.ts';

const FILES = ['Code.gs', 'Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'EvalImport.gs', 'Evaluations.gs', 'Upload.gs', 'MonthEnd.gs', 'History.gs'];

function refresh(tabs: Record<string, Grid>, today: string) {
  const drive = appsScriptServices();
  drive.props.closing_facts_v1 = 'yes';
  const gs = loadAppsScript(FILES, tabs, today, drive.services);
  gs.ensureRosterColumns_();
  const result = plain(gs.refreshHistory_());
  return { gs, result };
}

function table(tabs: Record<string, Grid>, name: string) {
  const [head, ...rows] = tabs[name]!;
  return rows.map((row) => Object.fromEntries(head!.map((key, i) => [String(key), row[i] ?? ''])) as Record<string, any>);
}

const register = (tabs: Record<string, Grid>, key: string) => table(tabs, 'CC_DailyHistory').find((row) => row.record_key === key)!;
const monthly = (tabs: Record<string, Grid>, periodKey: string, metric: string, side = '', person = '') =>
  table(tabs, 'CC_MonthlyHistory').find((row) => row.period_key === periodKey && row.metric === metric && row.side === side && row.person === person)!;
const setConfig = (tabs: Record<string, Grid>, key: string, value: string | number) => {
  const row = tabs.CC_Config!.find((line) => line[0] === key);
  if (row) row[1] = value;
  else tabs.CC_Config!.push([key, value]);
};
const peopleRow = (tabs: Record<string, Grid>, name: string) => {
  const head = tabs.CC_People![0]!.map(String);
  const row = tabs.CC_People!.find((line) => line[0] === name)!;
  return { set: (column: string, value: string) => { row[head.indexOf(column)] = value; } };
};

function withImports(tabs: Record<string, Grid>) {
  tabs.CC_Imports = [['sha256', 'file_name', 'report_type', 'status', 'imported_at', 'note'],
    ['sha-g17-14', G17_DAY('2026-10-14'), 'Data Analysis KPI 17 Written', 'imported', '2026-10-15T12:00:00Z', 'Group 17 Written for 2026-10-14.'],
    ['sha-nw-02', 'NWDSR_WRITTEN__0.pdf', 'NWDSR Written', 'imported', '2026-10-14T13:27:59Z', '2026-10-02 through 2026-10-02. Seeded from the verified archive.'],
    ['sha-snap-1002', 'SNAP_WRITTEN__1.pdf', 'SNAP Written', 'imported', '2026-10-14T13:27:59Z', '2026-10-02 through 2026-10-02.'],
  ];
  return tabs;
}

test('the daily register keeps each day as first imported; a later cancellation stays on the date it was reported', () => {
  const tabs = withImports(octoberBook());
  const first = refresh(tabs, '2026-10-16').result;
  const rows = table(tabs, 'CC_DailyHistory');
  assert.equal(first.daily.added, rows.length);
  assert.equal(new Set(rows.map((row) => row.record_key)).size, rows.length, 'each figure is recorded once');

  const renzo = register(tabs, 'SNAP_PERSON|2026-10-02|written|RENZO DEL SOLAR');
  assert.deepEqual([renzo.sales_dollars, renzo.reported_negative, renzo.employee_id, renzo.store_month, renzo.person_month, renzo.ly_date],
    [-1330, -1330, 'RDELSO', 'STORE-2026-10', 'PERSON-2026-10', '2025-10-02'], 'a negative day is kept as reported, compared with the same date last year');
  assert.deepEqual([renzo.source_file, renzo.source_sha256], ['SNAP_WRITTEN__1.pdf', 'sha-snap-1002']);
  const written = register(tabs, 'NWDSR_WRITTEN_STORE|2026-10-02|written|STORE');
  assert.deepEqual([written.sales_dollars, written.source_tab, written.source_file, written.ly_date, written.verification_status],
    [nwdsrWritten('2026-10-02'), 'CC_Daily', 'NWDSR_WRITTEN__0.pdf', '2025-10-01', 'Verified: single-day report'], 'store day 1 (October 2) is compared with October 1, 2025');
  assert.equal(register(tabs, 'NWDSR_WRITTEN_STORE|2026-10-15|written|STORE').ly_date, '2025-10-14');
  assert.equal(register(tabs, 'SNAP_STORE|2026-10-01|written|STORE').ly_date, 'Pending GM confirmation (proposed 2025-09-30)', 'October 1 belongs to the September store month, whose last year is not confirmed');
  const g17 = register(tabs, 'DA_SALES_STORE|2026-10-14|written|STORE');
  assert.deepEqual([g17.source_file, g17.source_sha256, g17.unit_count], [G17_DAY('2026-10-14'), 'sha-g17-14', 1]);
  assert.equal(register(tabs, 'PERQ_STORE|2026-10-15||STORE').eligible, 7);
  assert.equal(register(tabs, 'CUSTOMERS_STORE|2026-10-03|written|STORE').customers, 6);
  assert.equal(rows.filter((row) => row.record_key.startsWith('PERQ_STORE|')).length, 5, 'PERQ days only: snapshots are not daily records');

  const fixed = tabs.CC_DailyHistory!.map((row) => row.slice(0, 21));
  const again = refresh(tabs, '2026-10-16').result;
  assert.deepEqual([again.daily.added, again.daily.filled], [0, 0], 'a second refresh adds and changes nothing');

  // A later pull of October 14 shows a cancellation; the import code holds it back, and October 16 reports the -500.
  const { gs } = refresh(tabs, '2026-10-17');
  const ledgerRowFor14 = tabs.CC_Ledger!.find((row) => row[0] === 'DA_SALES_STORE' && row[2] === '2026-10-14')!;
  gs.holdBackDay_('CC_Ledger', ledgerRowFor14[17], ledgerRowFor14, '$514', 'later-pull.xlsx');
  tabs.CC_Daily!.push(['2026-10-16', -400, -500, 0]);
  tabs.CC_Daily!.find((row) => row[0] === '2026-10-03')![2] = 1;
  const later = refresh(tabs, '2026-10-17').result;
  assert.ok(later.daily.added >= 3);
  assert.deepEqual(tabs.CC_DailyHistory!.slice(0, fixed.length).map((row) => row.slice(0, 21)), fixed, 'no recorded day was rewritten or removed');
  assert.match(register(tabs, 'DA_SALES_STORE|2026-10-14|written|STORE').later_report_note, /a later report \(later-pull\.xlsx\) showed \$514; the figure recorded for this date was kept/);
  const changed = register(tabs, 'NWDSR_WRITTEN_STORE|2026-10-03|written|STORE');
  assert.equal(changed.sales_dollars, nwdsrWritten('2026-10-03'));
  assert.match(changed.later_report_note, /CC_Daily now shows sales_dollars 1; the figures first recorded for this date are kept/);
  const cancellation = register(tabs, 'NWDSR_WRITTEN_STORE|2026-10-16|written|STORE');
  assert.deepEqual([cancellation.sales_dollars, cancellation.reported_negative], [-500, -500], 'the cancellation is recorded on October 16, the day it was reported');
});

test('store and salesperson months, their last-year periods and goals are kept through the rollover', () => {
  const tabs = octoberBook('2026-11-01');
  refresh(tabs, '2026-10-20');
  const calendar = table(tabs, 'CC_PeriodCalendar');
  const october = calendar.find((row) => row.period_key === 'STORE-2026-10')!;
  assert.deepEqual([october.period_start, october.period_end, october.days, october.ly_start, october.ly_end], ['2026-10-02', '2026-11-01', 31, '2025-10-01', '2025-10-31']);
  assert.match(october.ly_status, /^Confirmed/);
  assert.match(calendar.find((row) => row.period_key === 'STORE-2026-11')!.ly_status, /^Pending GM confirmation \(proposed: the same calendar month last year, 2025-11-01 to 2025-11-30\)/);
  assert.match(calendar.find((row) => row.period_key === 'STORE-2026-03')!.calendar_status, /^Pending GM confirmation: store months before October 2026/);
  const person = calendar.find((row) => row.period_key === 'PERSON-2026-10')!;
  assert.deepEqual([person.period_start, person.period_end, person.ly_start, person.ly_end], ['2026-10-01', '2026-10-31', '2025-10-01', '2025-10-31']);

  const goal = (periodKey: string, metric: string) => table(tabs, 'CC_GoalHistory').find((row) => row.goal_record_key === `${periodKey}|${metric}`)!;
  assert.deepEqual([goal('STORE-2026-10', 'NWDSR Written').goal, goal('STORE-2026-10', 'NWDSR Delivered').goal, goal('STORE-2026-10', 'Bedding %').goal, goal('PERSON-2026-10', 'SNAP Written').goal], [400000, 320000, 0.2, 65000]);
  setConfig(tabs, 'bedding_minimum', 0.25);
  refresh(tabs, '2026-10-25');
  assert.deepEqual([goal('STORE-2026-10', 'Bedding %').goal, goal('STORE-2026-10', 'Bedding %').status], [0.25, 'Open']);
  assert.ok(tabs.CC_History!.some((row) => row[1] === 'CC_GoalHistory' && row[2] === 'STORE-2026-10|Bedding %'), 'the earlier goal is archived');

  // November: the GM sets November's store month and a new bedding goal. October keeps what it ran with.
  setConfig(tabs, 'store_period_start', '2026-11-02');
  setConfig(tabs, 'store_period_end', '2026-12-01');
  setConfig(tabs, 'bedding_minimum', 0.3);
  refresh(tabs, '2026-11-03');
  assert.deepEqual([goal('STORE-2026-10', 'Bedding %').goal, goal('STORE-2026-10', 'Bedding %').status, goal('STORE-2026-10', 'NWDSR Written').goal], [0.25, 'Locked', 400000]);
  assert.equal(goal('STORE-2026-11', 'Bedding %').goal, 0.3);
  const kept = table(tabs, 'CC_PeriodCalendar').find((row) => row.period_key === 'STORE-2026-10')!;
  assert.deepEqual([kept.ly_start, kept.ly_end], ['2025-10-01', '2025-10-31'], 'the confirmed last-year mapping is kept after CC_Config moves on');
  assert.match(kept.ly_status, /^Confirmed/);
});

test('each completed month is kept permanently: open, then final, and never rewritten after it locks', () => {
  const tabs = octoberBook('2026-11-01');
  const tracked = dates('2026-10-02', '2026-11-01').reduce((total, date) => total + nwdsrWritten(date), 0);
  refresh(tabs, '2026-10-20');
  assert.equal(table(tabs, 'CC_MonthlyHistory').filter((row) => row.period_key === 'STORE-2026-10').length, 0, 'a month still running is not history yet');

  refresh(tabs, '2026-11-03');
  let written = monthly(tabs, 'STORE-2026-10', 'NWDSR Written', 'written');
  assert.deepEqual([written.verified_total, written.verified_through, written.official_final, written.goal, written.last_year], [tracked, '2026-11-01', 'Pending', 400000, 'Pending']);
  assert.match(written.history_status, /^Open/);
  assert.equal(written.last_year_basis, 'No verified last-year report for 2025-10-01 to 2025-10-31 is on file');
  const perq = monthly(tabs, 'STORE-2026-10', 'PERQ opportunities');
  assert.match(perq.coverage, /^Daily records: 2026-10-12 to 2026-10-15 \(4 dates\)\. Cumulative snapshot: 2026-10-02 to 2026-10-11 \(87\)/);
  assert.deepEqual([perq.verified_total, perq.verified_through, perq.daily_records_total, perq.missing_or_unverified], [111, '2026-10-15', 24, 'Missing: 2026-10-16 to 2026-11-01'], 'PERQ is verified only through October 15, and the dates after it are listed as missing');
  const eric = monthly(tabs, 'PERSON-2026-10', 'SNAP Written', 'written', 'Eric Montes Rodriguez');
  assert.deepEqual([eric.employee_id, eric.verified_total, eric.position_at_close, eric.status_at_close], ['EMON0904', 950, 'Sales Associate', 'Active']);
  const caroline = monthly(tabs, 'PERSON-2026-10', 'SNAP Written', 'written', 'Caroline Amaro');
  assert.equal(caroline, undefined, 'Caroline was terminated before her start date, so she never had a salesperson month');

  // The official final arrives; the month locks with the variance. A mismatched last-year report is not used.
  tabs.CC_Ledger!.push(ledgerRow('NWDSR_WRITTEN_STORE', 'cumulative', '2026-10-02', '2026-11-01', '2026-11-01', 'written', { sales: tracked - 120 }, 'NWDSR_WRITTEN_final.pdf'));
  tabs.CC_LastYear = [['ly_start', 'ly_end', 'track', 'metric', 'side', 'employee_id', 'person', 'value', 'unit', 'source_report', 'source_sha256', 'verified_by', 'entered_at', 'note'],
    ['2025-10-01', '2025-10-31', 'Store', 'NWDSR Written', 'written', '', '', 380000, 'dollars', 'SNAP Written October 2025', '', 'GM', '2026-11-05', '']];
  refresh(tabs, '2026-11-05');
  written = monthly(tabs, 'STORE-2026-10', 'NWDSR Written', 'written');
  assert.deepEqual([written.history_status, written.official_final, written.variance, written.last_year], ['Final', tracked - 120, -120, 'Pending']);
  assert.match(written.last_year_basis, /a figure from a different report was not used/);
  assert.ok(tabs.CC_History!.some((row) => row[1] === 'CC_MonthlyHistory' && row[2] === 'STORE-2026-10|NWDSR Written|written|'), 'the open figures it replaced are archived');

  tabs.CC_LastYear!.push(['2025-10-01', '2025-10-31', 'Store', 'NWDSR Written', 'written', '', '', 390000, 'dollars', 'NWDSR Written October 2025', '', 'GM', '2026-11-06', '']);
  const lockedAt = written.locked_at;
  let september = monthly(tabs, 'STORE-2026-09', 'NWDSR Written', 'written');
  assert.deepEqual([september.history_status, september.verified_total], ['Final', 'Pending'], 'September locked with nothing verified');
  tabs.CC_Daily!.push(['2026-09-02', '', 5000, '']);
  refresh(tabs, '2026-11-06');
  written = monthly(tabs, 'STORE-2026-10', 'NWDSR Written', 'written');
  assert.deepEqual([written.last_year, written.locked_at], [390000, lockedAt], 'a Pending cell of a final row is filled; the row stays locked');
  september = monthly(tabs, 'STORE-2026-09', 'NWDSR Written', 'written');
  assert.deepEqual([september.history_status, september.verified_total, september.verified_through], ['Final', 5000, '2026-09-02'], 'a verified total that was Pending when the month locked is filled');
  assert.equal(september.after_lock_note, 'Filled 2026-11-06 from reports received after the month locked: verified_total 5000 through 2026-09-02');
  assert.ok(tabs.CC_History!.some((row) => row[2] === 'STORE-2026-09|NWDSR Written|written|' && row[4] === 'filled 2026-11-06'), 'the row as it was when it locked is archived');

  // December: Renzo transferred in November; an October figure is edited on the daily tab after the month locked.
  peopleRow(tabs, 'Renzo Del Solar').set('status', 'Transferred');
  peopleRow(tabs, 'Renzo Del Solar').set('status_effective', '2026-11-10');
  peopleRow(tabs, 'Renzo Del Solar').set('prior_status', 'Active');
  tabs.CC_AssociateDays!.push(['2026-11-03', 'DELSOLAR, RENZO', 'Renzo Del Solar', 'associate', 800, 'sha-snap-1103', '']);
  tabs.CC_Daily!.find((row) => row[0] === '2026-10-10')![2] = 1;
  const before = table(tabs, 'CC_MonthlyHistory').filter((row) => row.period_key === 'STORE-2026-10' || row.period_key === 'PERSON-2026-10');
  refresh(tabs, '2026-12-03');
  const after = table(tabs, 'CC_MonthlyHistory');
  const octoberAfter = after.filter((row) => row.period_key === 'STORE-2026-10' || row.period_key === 'PERSON-2026-10');
  assert.equal(octoberAfter.length, before.length, 'no October row was removed');
  assert.ok(octoberAfter.every((row) => row.history_status === 'Final'), 'every October row is final ten days after the month');
  written = monthly(tabs, 'STORE-2026-10', 'NWDSR Written', 'written');
  assert.equal(written.verified_total, tracked, 'the locked October total is not recalculated');
  assert.equal(written.after_lock_note, `Recalculated 2026-12-03: verified_total ${tracked - nwdsrWritten('2026-10-10') + 1}. The locked figures are kept`);
  assert.equal(monthly(tabs, 'PERSON-2026-10', 'SNAP Written', 'written', 'Renzo Del Solar').status_at_close, 'Active', 'October keeps Renzo as he was then');
  const november = monthly(tabs, 'PERSON-2026-11', 'SNAP Written', 'written', 'Renzo Del Solar');
  assert.deepEqual([november.status_at_close, november.employee_id], ['Transferred', 'RDELSO'], 'a transferred associate keeps his November month');
  assert.ok(after.some((row) => row.period_key === 'PERSON-2026-11'), 'the November salesperson month is added beside October');
  assert.equal(after.some((row) => row.period_key === 'STORE-2026-11'), false, 'no store record is on file for November 2 to December 1, so no store month is invented');
});
