/**
 * Read-only rollover rehearsal for the permanent history. Loads a workbook snapshot (auditMetrics --save), runs the
 * month-end and history refreshes in memory on each day given, and checks after every day that nothing already
 * recorded changed, no key repeats, and the imported tabs are untouched. Nothing is written to the live workbook.
 *
 *   node --experimental-strip-types server/historyDryRun.ts --snapshot in.json [--days 2026-10-17,2026-11-02,2026-11-12]
 *        [--save out.json]
 *
 * On a day in a new store month the rehearsal moves store_period_start / store_period_end to that month and blanks
 * prior_year_start / prior_year_end, the way the GM rolls the config over before a new last-year period is confirmed.
 * Exit code 1 when any check fails. --save writes the final tabs as a snapshot auditMetrics can read.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { appsScriptServices } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';

interface TabDump { raw: unknown[][]; shown: unknown[][]; formula?: unknown[][] }
type Workbook = Record<string, TabDump>;

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const FILES = ['Code.gs', 'Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'EvalImport.gs', 'Evaluations.gs', 'Upload.gs', 'MonthEnd.gs', 'History.gs'];
const HISTORY_TABS = ['CC_DailyHistory', 'CC_SourceArchive', 'CC_PeriodCalendar', 'CC_GoalHistory', 'CC_MonthlyHistory', 'CC_LastYear'];
const DERIVED_TABS = new Set([...HISTORY_TABS, 'CC_MonthEnd', 'CC_History', 'CC_Exceptions', 'CC_Health', 'CC_Rollup', 'CC_DailyGoals', 'CC_MetricDefinitions', 'CC_MonthEndNotes']);
const DATE_TEXT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/;

/** What getValues() returns in Apps Script: date cells become Date objects (noon Eastern), the rest stay as stored. */
function appsScriptGrid(tab: TabDump): Grid {
  return tab.raw.map((row, y) => row.map((cell, x) => {
    const m = String(tab.shown[y]?.[x] ?? '').match(DATE_TEXT);
    if (typeof cell !== 'number' || !m) return cell;
    const [yy, mm, dd] = m[3] ? [m[3], m[1], m[2]] : [m[4], m[5], m[6]];
    return new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd), 16));
  }));
}
const cellText = (cell: unknown) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : cell === undefined || cell === null ? '' : String(cell));
const textGrid = (grid: Grid | undefined) => (grid ?? []).map((row) => row.map(cellText));
function table(tabs: Record<string, Grid>, name: string) {
  const [head, ...rows] = textGrid(tabs[name]);
  return head ? rows.map((row) => Object.fromEntries(head.map((key, i) => [key, row[i] ?? '']))) : [];
}

function storePeriod(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const iso = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  return d >= 2 ? { start: iso(y, m, 2), end: iso(y, m + 1, 1) } : { start: iso(y, m - 1, 2), end: iso(y, m, 1) };
}
function setConfig(tabs: Record<string, Grid>, key: string, value: string) {
  const row = tabs.CC_Config!.find((line) => line[0] === key);
  if (row) row[1] = value;
  else tabs.CC_Config!.push([key, value]);
}

const snapshotPath = option('--snapshot');
if (!snapshotPath) throw new Error('--snapshot is required (save one with auditMetrics --save).');
const book: Workbook = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const days = (option('--days') ?? '2026-10-17,2026-11-02,2026-11-12,2026-12-03').split(',');
const tabs: Record<string, Grid> = Object.fromEntries(Object.entries(book).map(([name, tab]) => [name, appsScriptGrid(tab)]));
const importedBefore = Object.fromEntries(Object.keys(tabs).filter((name) => !DERIVED_TABS.has(name) && name !== 'CC_Config').map((name) => [name, JSON.stringify(textGrid(tabs[name]))]));

const failures: string[] = [];
const lines: string[] = [];
const check = (day: string, label: string, ok: boolean, detail = '') => {
  lines.push(`${ok ? 'PASS' : 'FAIL'}  ${day}  ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(`${day} ${label} ${detail}`);
};
const REGISTER_FIXED = 21;
const MONTHLY_LOCKED = ['history_key', 'period_key', 'track', 'period_start', 'period_end', 'metric', 'side', 'employee_id', 'person', 'position_at_close', 'status_at_close', 'unit', 'verified_total', 'verified_through', 'coverage', 'qualified', 'sold', 'mtd_basis', 'daily_records_total', 'missing_or_unverified', 'goal', 'goal_basis', 'history_status', 'first_recorded_at', 'locked_at'];
const MONTHLY_FILLABLE = ['verified_total', 'verified_through', 'coverage', 'qualified', 'sold', 'mtd_basis', 'daily_records_total', 'missing_or_unverified'];
const GOAL_LOCKED = ['goal_record_key', 'period_key', 'goal', 'goal_basis', 'status', 'locked_at'];
let previous: { register: string[][]; monthly: Record<string, string>[]; goals: Record<string, string>[]; confirmedLy: Record<string, string> } | null = null;

for (const day of days) {
  const period = storePeriod(day);
  const config = Object.fromEntries(table(tabs, 'CC_Config').map((row) => [row.key, row.value]));
  if (config.store_period_start && config.store_period_start < period.start) {
    setConfig(tabs, 'store_period_start', period.start);
    setConfig(tabs, 'store_period_end', period.end);
    setConfig(tabs, 'prior_year_start', '');
    setConfig(tabs, 'prior_year_end', '');
    lines.push(`----  ${day}  config rolled over to store month ${period.start}–${period.end}; prior_year_start / prior_year_end blanked`);
  }
  const drive = appsScriptServices();
  drive.props.closing_facts_v1 = 'yes';
  const gs = loadAppsScript(FILES, tabs, day, drive.services);
  gs.notifyOnce_ = () => undefined;
  gs.refreshMonthEnd_();
  const result = plain(gs.refreshHistory_());
  lines.push(`----  ${day}  refreshHistory_: calendar ${result.calendar}, daily added ${result.daily.added} / filled ${result.daily.filled} / total ${result.daily.total}, goals ${result.goals}, monthly ${JSON.stringify(result.monthly)}`);

  const register = textGrid(tabs.CC_DailyHistory).slice(1);
  const keys = register.map((row) => row[0]!);
  check(day, 'CC_DailyHistory record keys are unique', keys.length === new Set(keys).size, `${keys.length} rows`);
  const monthly = table(tabs, 'CC_MonthlyHistory');
  const monthlyKeys = monthly.map((row) => row.history_key);
  check(day, 'CC_MonthlyHistory keys are unique', monthlyKeys.length === new Set(monthlyKeys).size, `${monthlyKeys.length} rows`);
  const goals = table(tabs, 'CC_GoalHistory');
  const goalKeys = goals.map((row) => row.goal_record_key);
  check(day, 'CC_GoalHistory keys are unique', goalKeys.length === new Set(goalKeys).size, `${goalKeys.length} rows`);
  const calendar = table(tabs, 'CC_PeriodCalendar');
  const confirmedLy = Object.fromEntries(calendar.filter((row) => /^Confirmed/i.test(row.ly_status)).map((row) => [row.period_key, `${row.ly_start}–${row.ly_end}`]));
  const october = calendar.find((row) => row.period_key === 'STORE-2026-10');
  check(day, 'STORE-2026-10 compares with 2025-10-01–2025-10-31', `${october?.period_start}–${october?.period_end} vs ${october?.ly_start}–${october?.ly_end}` === '2026-10-02–2026-11-01 vs 2025-10-01–2025-10-31', `${october?.ly_start}–${october?.ly_end} (${october?.ly_status})`);
  const personOctober = calendar.find((row) => row.period_key === 'PERSON-2026-10');
  check(day, 'PERSON-2026-10 is the calendar month 2026-10-01–2026-10-31', `${personOctober?.period_start}–${personOctober?.period_end}` === '2026-10-01–2026-10-31');

  if (previous) {
    const byKey = new Map(register.map((row) => [row[0], row]));
    const changed = previous.register.filter((row) => JSON.stringify(byKey.get(row[0])?.slice(0, REGISTER_FIXED)) !== JSON.stringify(row.slice(0, REGISTER_FIXED)));
    check(day, 'Every register row recorded earlier is still present with its original figures', !changed.length, changed.length ? `${changed.length} changed, e.g. ${changed[0]![0]}` : `${previous.register.length} earlier rows kept`);
    const monthlyByKey = new Map(monthly.map((row) => [row.history_key, row]));
    const lost = previous.monthly.filter((row) => !monthlyByKey.has(row.history_key));
    check(day, 'No monthly history row was removed', !lost.length, lost.length ? lost[0]!.history_key : `${previous.monthly.length} earlier rows kept`);
    const relocked = previous.monthly.filter((row) => row.history_status === 'Final').filter((row) => {
      const now = monthlyByKey.get(row.history_key);
      const pendingFilled = /^(Pending)?$/.test(row.verified_total!) && now?.verified_total !== row.verified_total;
      return MONTHLY_LOCKED.some((column) => now?.[column] !== row[column] && !(pendingFilled && MONTHLY_FILLABLE.includes(column)));
    });
    check(day, 'Final monthly rows keep their locked figures, goals and status', !relocked.length, relocked.length ? relocked[0]!.history_key : `${previous.monthly.filter((row) => row.history_status === 'Final').length} final rows checked`);
    const goalByKey = new Map(goals.map((row) => [row.goal_record_key, row]));
    const goalChanged = previous.goals.filter((row) => row.status === 'Locked').filter((row) => GOAL_LOCKED.some((column) => goalByKey.get(row.goal_record_key)?.[column] !== row[column]));
    check(day, 'Locked goals are unchanged', !goalChanged.length, goalChanged.length ? goalChanged[0]!.goal_record_key : `${previous.goals.filter((row) => row.status === 'Locked').length} locked goals checked`);
    const lostLy = Object.entries(previous.confirmedLy).filter(([key, range]) => confirmedLy[key] !== range);
    check(day, 'Confirmed last-year mappings survive the config rollover', !lostLy.length, lostLy.length ? lostLy.map(([key]) => key).join(', ') : Object.entries(confirmedLy).map(([key, range]) => `${key} ${range}`).join('; '));
  }
  const importedChanged = Object.keys(importedBefore).filter((name) => JSON.stringify(textGrid(tabs[name])) !== importedBefore[name]);
  check(day, 'Imported tabs are unchanged', !importedChanged.length, importedChanged.join(', ') || `${Object.keys(importedBefore).length} tabs compared`);
  previous = { register, monthly, goals, confirmedLy };
}

const final = table(tabs, 'CC_MonthlyHistory');
const pick = (periodKey: string, metric: string) => final.filter((row) => row.period_key === periodKey && row.metric === metric);
const show = (row: Record<string, string>) => `${row.period_key} ${row.metric}${row.side ? ' ' + row.side : ''}${row.person ? ' ' + row.person : ''}: verified ${row.verified_total || '—'} through ${row.verified_through || '—'} | daily records ${row.daily_records_total || '—'} | coverage ${row.coverage || '—'} | missing ${row.missing_or_unverified || 'none'} | final ${row.official_final || '—'} | variance ${row.variance || '—'} | goal ${row.goal || '—'} | LY ${row.last_year || '—'} | ${row.history_status}${row.position_at_close ? ' | ' + row.position_at_close + ' / ' + row.status_at_close : ''}`;
lines.push('', 'Monthly history excerpt after the last day:');
for (const metric of ['NWDSR Written', 'NWDSR Delivered', 'Purchasing customers', 'PERQ opportunities', 'Closing ratio']) pick('STORE-2026-10', metric).forEach((row) => lines.push('  ' + show(row)));
pick('PERSON-2026-10', 'SNAP Written').forEach((row) => lines.push('  ' + show(row)));

if (option('--save')) {
  const out: Workbook = { ...book };
  for (const name of Object.keys(tabs)) {
    if (!DERIVED_TABS.has(name) && name !== 'CC_Config') continue;
    const grid = textGrid(tabs[name]);
    out[name] = { raw: grid, shown: grid };
  }
  writeFileSync(option('--save')!, JSON.stringify(out));
}
console.log(lines.join('\n'));
console.log(`\n${lines.filter((line) => /^(PASS|FAIL)/.test(line)).length} checks · ${failures.length} failed · days ${days.join(', ')} · snapshot ${snapshotPath} · nothing written to the live workbook`);
process.exitCode = failures.length ? 1 : 0;
