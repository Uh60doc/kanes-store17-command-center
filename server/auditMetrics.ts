/**
 * Command Center data integrity audit. Reads the workbook (live and read-only, or a saved snapshot), runs the Apps
 * Script page functions against it with every write recorded and none applied, recomputes each figure straight from
 * the imported tabs, and prints Metric | Source | Reporting Dates | Expected | Actual | Variance | Status.
 *
 *   node --experimental-strip-types server/auditMetrics.ts [--snapshot in.json] [--save out.json] [--today YYYY-MM-DD]
 *        [--code apps-script-dir] [--markdown out.md] [--json out.json]
 *
 * Exit code 1 when a display disagrees with its approved source for the same metric and dates. Legitimate differences
 * between reports (SNAP Written vs NWDSR Net Written, Data Analysis vs NWDSR) are listed with their variance and do
 * not fail the audit. No tolerance is applied: equal means equal after the display rounding stated on the row.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Cell = string | number | boolean | Date;
type Grid = Cell[][];
interface TabDump { raw: unknown[][]; shown: unknown[][]; formula?: unknown[][] }
type Workbook = Record<string, TabDump>;
type Row = Record<string, string>;

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const codeDir = option('--code') ?? new URL('../apps-script', import.meta.url).pathname;
const codeExt = codeDir.includes('clasp-pull') ? '.js' : '.gs';

async function readLive(): Promise<Workbook> {
  const { SHEETS_SCOPE } = await import('./access.ts');
  const { loadConfig, loadDotEnv } = await import('./config.ts');
  const { accessTokenFor, googleJson } = await import('./google.ts');
  const { readStored } = await import('./tokenStore.ts');
  const root = path.resolve(new URL('..', import.meta.url).pathname);
  loadDotEnv(root);
  const config = loadConfig(root);
  const id = readStored(config.tokenPath).spreadsheetId;
  if (!id) throw new Error('The command center spreadsheet is not saved.');
  const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${id}`;
  const meta = await googleJson({ accessToken: token, url: `${base}?fields=sheets.properties.title` }) as { sheets: { properties: { title: string } }[] };
  const titles = meta.sheets.map((sheet) => sheet.properties.title);
  const get = (render: string) => googleJson({ accessToken: token, url: `${base}/values:batchGet?valueRenderOption=${render}&${titles.map((t) => 'ranges=' + encodeURIComponent(t)).join('&')}` }) as Promise<{ valueRanges: { values?: unknown[][] }[] }>;
  const [raw, shown, formula] = await Promise.all([get('UNFORMATTED_VALUE'), get('FORMATTED_VALUE'), get('FORMULA')]);
  const out: Workbook = {};
  titles.forEach((title, i) => { out[title] = { raw: raw.valueRanges[i]?.values ?? [], shown: shown.valueRanges[i]?.values ?? [], formula: formula.valueRanges[i]?.values ?? [] }; });
  return out;
}

const DATE_TEXT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/;

/** What getValues() returns in Apps Script: date cells become Date objects (noon Eastern), the rest stay as stored. */
function appsScriptGrid(tab: TabDump): Grid {
  return tab.raw.map((row, y) => row.map((cell, x) => {
    const label = String(tab.shown[y]?.[x] ?? '');
    const m = label.match(DATE_TEXT);
    if (typeof cell !== 'number' || !m) return cell as Cell;
    const [yy, mm, dd] = m[3] ? [m[3], m[1], m[2]] : [m[4], m[5], m[6]];
    return new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd), 16));
  }));
}

/** Header-mapped rows with dates as YYYY-MM-DD text and numbers as stored. */
function rowsOf(book: Workbook, name: string): Row[] {
  const tab = book[name];
  if (!tab || !tab.raw.length) return [];
  const grid = appsScriptGrid(tab);
  const header = grid[0]!.map((cell) => String(cell));
  return grid.slice(1).map((line) => Object.fromEntries(header.map((key, i) => {
    const cell = line[i];
    const text = cell instanceof Date ? cell.toISOString().slice(0, 10) : cell === undefined || cell === null ? '' : String(cell);
    return [key, text];
  })));
}

function loadPages(book: Workbook, today: string) {
  const tabs: Record<string, Grid> = {};
  Object.entries(book).forEach(([name, tab]) => { tabs[name] = appsScriptGrid(tab); });
  const writes: string[] = [];
  const sheet = (name: string) => ({
    getName: () => name,
    getDataRange: () => ({ getValues: () => { const width = Math.max(1, ...tabs[name]!.map((row) => row.length)); return tabs[name]!.map((row) => Array.from({ length: width }, (_, i) => (row[i] === undefined ? '' : row[i]))); } }),
    getRange: (row: number, col: number) => ({
      setValue: () => writes.push(`${name}!R${row}C${col}`),
      setValues: () => writes.push(`${name}!R${row}C${col}`),
      getValue: () => tabs[name]![row - 1]?.[col - 1] ?? '',
      clearContent: () => writes.push(`${name}!R${row}C${col}`),
    }),
    appendRow: () => writes.push(`${name}!append`),
    getLastRow: () => tabs[name]!.length,
    clearContents: () => writes.push(`${name}!clear`),
  });
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'audit',
    Utilities: {
      formatDate: (date: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz === 'UTC' ? 'UTC' : 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date),
      getUuid: () => 'audit',
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'yes', setProperty: () => undefined }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => undefined, remove: () => undefined }) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null), insertSheet: (name: string) => { writes.push(`${name}!insert`); tabs[name] = []; return sheet(name); } }) },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    ScriptApp: { getProjectTriggers: () => [{ getHandlerFunction: () => 'dailyImport' }] },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => undefined, releaseLock: () => undefined }) },
  };
  vm.createContext(sandbox);
  const files = ['Code', 'Data', 'Ledger', 'Import', 'KpiImport', 'Auth', 'Roster', 'MonthEnd', 'Metrics'];
  for (const file of files) {
    let source = '';
    try { source = readFileSync(path.join(codeDir, file + codeExt), 'utf8'); } catch { continue; }
    vm.runInContext(source, sandbox, { filename: file + codeExt });
  }
  vm.runInContext(`todayNy_ = function () { return '${today}'; }; appendException_ = function () {}; notifyOnce_ = function () {};`, sandbox);
  return { gs: sandbox as Record<string, (...a: unknown[]) => any>, writes };
}

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// ---------- independent recomputation from the imported tabs ----------

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
const shift = (day: string, n: number) => { const [y, m, d] = day.split('-').map(Number); return iso(y!, m!, d! + n); };
function storePeriod(day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return d >= 2 ? { start: iso(y, m, 2), end: iso(y, m + 1, 1) } : { start: iso(y, m - 1, 2), end: iso(y, m, 1) };
}
function personPeriod(day: string) {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return { start: iso(y, m, 1), end: iso(y, m + 1, 0) };
}
const num = (text: string | undefined) => (text === undefined || text === '' || !Number.isFinite(Number(text)) ? null : Number(text));
const cents = (value: number) => Math.round(value * 100) / 100;
const between = (day: string, start: string, end: string) => day >= start && day <= end;
function eachDay(start: string, end: string) { const out: string[] = []; for (let d = start; d <= end; d = shift(d, 1)) out.push(d); return out; }

interface Check { area: string; metric: string; source: string; dates: string; expected: string; actual: string; variance: string; status: string }
const checks: Check[] = [];
const money = (v: number | null | undefined) => (v === null || v === undefined ? 'Pending' : (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(cents(v)) ? 0 : 2, maximumFractionDigits: 2 }));
const pct = (v: number | null | undefined, places = 1) => (v === null || v === undefined ? 'Pending' : (v * 100).toFixed(places) + '%');
const count = (v: number | null | undefined) => (v === null || v === undefined ? 'Pending' : String(v));
type Unit = 'dollars' | 'percent' | 'count';
const show = (v: number | null | undefined, unit: Unit) => (unit === 'dollars' ? money(v) : unit === 'percent' ? pct(v) : count(v));

/** Same metric, same source, same dates: must be equal. `round` is the stated display rounding (cents, 0.1%, whole). */
function same(area: string, metric: string, source: string, dates: string, expected: number | null | undefined, actual: number | null | undefined, unit: Unit, round?: 'whole' | 'tenth-pct' | 'thousandth') {
  const e = expected ?? null;
  const a = actual ?? null;
  let status: string;
  let variance = '';
  if (e === null && a === null) status = 'Pending (no report on file)';
  else if (e === null || a === null) status = 'MISMATCH';
  else {
    const diff = unit === 'percent' ? a - e : cents(a - e);
    const r = (v: number) => (round === 'whole' ? Math.round(v) : round === 'tenth-pct' ? Math.round(v * 1000) : round === 'thousandth' ? Math.round(v * 1000) : unit === 'percent' ? Math.round(v * 1e6) : Math.round(v * 100));
    variance = unit === 'percent' ? ((a - e) * 100).toFixed(2) + ' pts' : money(diff);
    if (r(a) === r(e)) status = diff === 0 || Math.abs(diff) < 1e-9 ? 'Match' : `Match (${round === 'whole' ? 'whole-dollar' : round === 'tenth-pct' ? '0.1%' : '0.001'} rounding)`;
    else status = 'MISMATCH';
  }
  checks.push({ area, metric, source, dates, expected: show(e, unit), actual: show(a, unit), variance, status });
}

/** Two different approved reports for related figures: both kept, variance documented, never forced to match. */
function documented(area: string, metric: string, source: string, dates: string, reference: number | null, other: number | null, unit: Unit, label: string) {
  const variance = reference === null || other === null ? '' : unit === 'percent' ? ((other - reference) * 100).toFixed(2) + ' pts' : money(cents(other - reference));
  checks.push({ area, metric, source, dates, expected: show(reference, unit), actual: show(other, unit), variance, status: `Documented variance: ${label}` });
}

function note(area: string, metric: string, source: string, dates: string, expected: string, actual: string, status: string) {
  checks.push({ area, metric, source, dates, expected, actual, variance: '', status });
}

// ---------- run ----------

const snapshotPath = option('--snapshot');
const book: Workbook = snapshotPath ? JSON.parse(readFileSync(snapshotPath, 'utf8')) : await readLive();
if (option('--save')) writeFileSync(option('--save')!, JSON.stringify(book));
const today = option('--today') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const yesterday = shift(today, -1);
const store = storePeriod(today);
const person = personPeriod(today);
const { gs, writes } = loadPages(book, today);
const session = { role: 'manager', username: 'audit' };
const pages: Record<string, any> = {};
for (const name of ['home', 'daily', 'closing', 'people', 'bedding', 'morning', 'health']) {
  try { pages[name] = plain(gs[name + '_']!({ session })); } catch (error) { pages[name] = { error: String((error as Error)?.message ?? error) }; }
}
const registry = typeof gs.metricRegistry_ === 'function' ? plain(gs.metricRegistry_(today)) as any[] : null;

// Imported tabs.
const config = Object.fromEntries(rowsOf(book, 'CC_Config').map((row) => [row.key!, row.value!]));
const closedDays = new Set(rowsOf(book, 'CC_SellingDays').filter((row) => /^(n|no|closed|false|0)$/i.test(String(row.selling || '').trim())).map((row) => row.date!));
const daily = rowsOf(book, 'CC_Daily').filter((row) => between(row.date!, store.start, store.end));
const sum = (field: string, through = store.end, from = store.start) => {
  const seen = daily.filter((row) => between(row.date!, from, through) && num(row[field]) !== null);
  return seen.length ? cents(seen.reduce((total, row) => total + num(row[field])!, 0)) : null;
};
const through = daily.filter((row) => num(row.nwdsr_written) !== null).map((row) => row.date!).sort().pop() ?? '';
const storeDates = `${store.start} to ${through || store.start} (store month ${store.start}–${store.end})`;
const nwdsrWritten = sum('nwdsr_written');
const nwdsrDelivered = sum('nwdsr_delivered');
const snapWritten = sum('snap_written');
const goalFor = (key: string) => {
  const specific = config[`${key}_${store.start.slice(0, 7)}`];
  if (specific) return Number(specific);
  return config.store_period_start === store.start && config.store_period_end === store.end && config[key] ? Number(config[key]) : null;
};
const writtenGoal = goalFor('written_goal');
const deliveredGoal = goalFor('delivered_goal');
const openDaysFrom = (day: string) => eachDay(day, store.end).filter((d) => !closedDays.has(d)).length;
const dailyGoal = (goal: number | null, field: string, day: string) => {
  if (goal === null) return null;
  const before = day > store.start ? sum(field, shift(day, -1)) ?? 0 : 0;
  return cents((goal - before) / openDaysFrom(day));
};
const dayRow = (day: string) => daily.find((row) => row.date === day);

// Closing: NWDSR Net Written purchasing customers and PERQ Location opportunities.
const closingRows = rowsOf(book, 'CC_Closing').filter((row) => row.final === 'yes' && row.scope === 'store' && !row.employee_code);
const custDaily = closingRows.filter((row) => row.source === 'NWDSR Net Written # OF CUST' && row.period_start === row.period_end && between(row.period_start!, store.start, store.end));
const customers = custDaily.length ? custDaily.reduce((total, row) => total + Number(row.customers), 0) : null;
const custThrough = custDaily.map((row) => row.period_start!).sort().pop() ?? '';
const perqRows = closingRows.filter((row) => row.source === 'PERQ Ups + Be Backs');
const perqSnapshot = perqRows.filter((row) => row.period_start === store.start && row.period_end !== row.period_start)
  .sort((a, b) => (a.verified_through! < b.verified_through! ? -1 : a.verified_through! > b.verified_through! ? 1 : 0)).pop();
const perqAfter = perqRows.filter((row) => row.period_start === row.period_end && perqSnapshot && row.period_start! > perqSnapshot.verified_through! && row.period_start! <= store.end);
const opportunities = perqSnapshot ? Number(perqSnapshot.opportunities) + perqAfter.reduce((total, row) => total + Number(row.opportunities), 0) : null;
const perqThrough = perqAfter.map((row) => row.period_start!).sort().pop() ?? perqSnapshot?.verified_through ?? '';
const closingThrough = custThrough < perqThrough ? custThrough : perqThrough;
const closingRatio = customers !== null && opportunities ? customers / opportunities : null;

// Store KPI ledger: the latest cumulative row for the store month, by view and side.
const ledger = rowsOf(book, 'CC_Ledger');
const storeCumulative = (view: string, side: string) => ledger
  .filter((row) => row.view === view && row.grain === 'cumulative' && row.side === side && row.period_start === store.start && !row.employee_code && !row.employee_name)
  .sort((a, b) => (a.verified_through! < b.verified_through! ? -1 : 1)).pop();
const kpiRows = Object.fromEntries(rowsOf(book, 'CC_Kpi').filter((row) => row.period_start === store.start && row.period_end === store.end).map((row) => [row.metric!, row]));

// ===== Checkpoints (October 2026 baseline through October 15) =====
const BASELINE = { store: '2026-10-02', through: '2026-10-15', nwdsrWritten: 109993, nwdsrDelivered: 104220, customers: 54, opportunities: 111, closing: 0.486 };
if (store.start === BASELINE.store && through >= BASELINE.through) {
  const b = BASELINE;
  const atBaseline = (field: string) => sum(field, b.through);
  same('Checkpoint', 'NWDSR Written (store MTD)', 'CC_Daily nwdsr_written (NWDSR Net Written)', `${b.store} to ${b.through}`, b.nwdsrWritten, atBaseline('nwdsr_written'), 'dollars', 'whole');
  same('Checkpoint', 'NWDSR Delivered (store MTD)', 'CC_Daily nwdsr_delivered (NWDSR Delivered)', `${b.store} to ${b.through}`, b.nwdsrDelivered, atBaseline('nwdsr_delivered'), 'dollars', 'whole');
  const custAt = custDaily.filter((row) => row.period_start! <= b.through).reduce((total, row) => total + Number(row.customers), 0);
  same('Checkpoint', 'Purchasing customers', 'CC_Closing NWDSR Net Written # OF CUST, daily rows', `${b.store} to ${b.through}`, b.customers, custAt, 'count');
  same('Checkpoint', 'PERQ opportunities', `CC_Closing PERQ Location: snapshot ${perqSnapshot?.period_start}–${perqSnapshot?.verified_through} (${perqSnapshot?.opportunities}) + daily ${perqAfter.map((row) => row.period_start + ' (' + row.opportunities + ')').join(', ')}`, `${b.store} to ${b.through}`, b.opportunities, opportunities, 'count');
  same('Checkpoint', 'Store closing ratio', 'Purchasing customers ÷ PERQ opportunities', `${b.store} to ${b.through}`, b.closing, closingRatio, 'percent', 'tenth-pct');
}

// ===== Store written and delivered: every display against CC_Daily =====
const home = pages.home ?? {};
const board = home.board ?? {};
const rollup = Object.fromEntries(rowsOf(book, 'CC_Rollup').map((row) => [row.metric!, row.value!]));
const monthEnd = rowsOf(book, 'CC_MonthEnd');
const monthEndValue = (track: string, metric: string, personName = '') => num(monthEnd.find((row) => row.track === track && row.metric === metric && row.person === personName && row.period_start === (track === 'Store' ? store.start : person.start))?.daily_tracked);
const homeWrittenIsNwdsr = home.month?.writtenSource ? /NWDSR/.test(home.month.writtenSource) : null;
same('Home', 'Written month to date', 'NWDSR Net Written (CC_Daily)', storeDates, nwdsrWritten, board.month?.written, 'dollars');
same('Home', 'Written % of goal', `NWDSR Net Written ÷ written_goal ${money(writtenGoal)}`, storeDates, nwdsrWritten !== null && writtenGoal ? Math.round(nwdsrWritten / writtenGoal * 1000) / 1000 : null, board.month?.writtenAchieved, 'percent', 'tenth-pct');
same('Home', 'Remaining written', `written_goal ${money(writtenGoal)} − NWDSR Net Written`, storeDates, writtenGoal !== null && nwdsrWritten !== null ? cents(writtenGoal - nwdsrWritten) : null, board.month?.writtenLeft, 'dollars');
same('Home', 'Delivered month to date', 'NWDSR Delivered (CC_Daily)', storeDates, nwdsrDelivered, board.month?.delivered, 'dollars');
same('Home', 'Remaining delivered', `delivered_goal ${money(deliveredGoal)} − NWDSR Delivered`, storeDates, deliveredGoal !== null && nwdsrDelivered !== null ? cents(deliveredGoal - nwdsrDelivered) : null, board.month?.deliveredLeft, 'dollars');
if (board.month && 'snapWritten' in board.month) same('Home', 'SNAP Written (reconciliation line)', 'SNAP Written (CC_Daily)', storeDates, snapWritten, board.month.snapWritten, 'dollars');
same('Home', `Yesterday written (${yesterday})`, 'NWDSR Net Written (CC_Daily)', yesterday, num(dayRow(yesterday)?.nwdsr_written), home.yesterday?.written, 'dollars');
same('Home', `Yesterday delivered (${yesterday})`, 'NWDSR Delivered (CC_Daily)', yesterday, num(dayRow(yesterday)?.nwdsr_delivered), home.yesterday?.delivered, 'dollars');
same('Home', `Yesterday's written goal (${yesterday})`, '(written_goal − NWDSR Net Written before the day) ÷ open days left', yesterday, dailyGoal(writtenGoal, 'nwdsr_written', yesterday), board.yesterday?.written?.goal, 'dollars');
same('Home', `Yesterday's delivered goal (${yesterday})`, '(delivered_goal − NWDSR Delivered before the day) ÷ open days left', yesterday, dailyGoal(deliveredGoal, 'nwdsr_delivered', yesterday), board.yesterday?.delivered?.goal, 'dollars');
same('Home', `Today's written goal (${today})`, '(written_goal − NWDSR Net Written to date) ÷ open days left', today, dailyGoal(writtenGoal, 'nwdsr_written', today), board.today?.written, 'dollars');
same('Home', `Today's delivered goal (${today})`, '(delivered_goal − NWDSR Delivered to date) ÷ open days left', today, dailyGoal(deliveredGoal, 'nwdsr_delivered', today), board.today?.delivered, 'dollars');
void homeWrittenIsNwdsr;

same('CC_Rollup', 'nwdsr_written', 'NWDSR Net Written (CC_Daily)', storeDates, nwdsrWritten, num(rollup.nwdsr_written), 'dollars');
same('CC_Rollup', 'nwdsr_delivered', 'NWDSR Delivered (CC_Daily)', storeDates, nwdsrDelivered, num(rollup.nwdsr_delivered), 'dollars');
same('CC_Rollup', 'snap_written', 'SNAP Written (CC_Daily)', storeDates, snapWritten, num(rollup.snap_written), 'dollars');
same('CC_Rollup', 'written_remaining', 'written_goal − NWDSR Net Written', storeDates, writtenGoal !== null && nwdsrWritten !== null ? cents(writtenGoal - nwdsrWritten) : null, num(rollup.written_remaining), 'dollars');
same('CC_Rollup', 'delivered_remaining', 'delivered_goal − NWDSR Delivered', storeDates, deliveredGoal !== null && nwdsrDelivered !== null ? cents(deliveredGoal - nwdsrDelivered) : null, num(rollup.delivered_remaining), 'dollars');
same('Home vs CC_Rollup', 'Remaining written', 'Both: written_goal − NWDSR Net Written', storeDates, num(rollup.written_remaining), board.month?.writtenLeft, 'dollars');
same('Month-End', 'NWDSR Written daily tracked', 'CC_MonthEnd vs CC_Daily', storeDates, nwdsrWritten, monthEndValue('Store', 'NWDSR Written'), 'dollars');
same('Month-End', 'NWDSR Delivered daily tracked', 'CC_MonthEnd vs CC_Daily', storeDates, nwdsrDelivered, monthEndValue('Store', 'NWDSR Delivered'), 'dollars');
same('Month-End', 'SNAP Written daily tracked', 'CC_MonthEnd vs CC_Daily', storeDates, snapWritten, monthEndValue('Store', 'SNAP Written'), 'dollars');
same('Month-End', 'Purchasing customers daily tracked', 'CC_MonthEnd vs CC_Closing daily rows', storeDates, customers, monthEndValue('Store', 'Purchasing customers'), 'count');

const dailyPage = pages.daily ?? {};
const dailyDays: any[] = dailyPage.days ?? [];
const pageSum = (field: string) => { const seen = dailyDays.filter((day) => day[field] !== null && day[field] !== undefined); return seen.length ? cents(seen.reduce((t, day) => t + Number(day[field]), 0)) : null; };
same('Daily', 'NWDSR written column total', 'NWDSR Net Written (CC_Daily)', storeDates, nwdsrWritten, pageSum('nwdsrWritten'), 'dollars');
same('Daily', 'NWDSR delivered column total', 'NWDSR Delivered (CC_Daily)', storeDates, nwdsrDelivered, pageSum('nwdsrDelivered'), 'dollars');
same('Daily', 'SNAP written column total', 'SNAP Written (CC_Daily)', storeDates, snapWritten, pageSum('snapWritten'), 'dollars');
same('Daily', 'Purchasing customers column total', 'CC_ClosingDaily ← CC_Closing', storeDates, customers, pageSum('purchasingCustomers'), 'count');

// SNAP vs NWDSR: legitimate report differences, kept and labelled.
documented('Reconciliation', 'SNAP Written vs NWDSR Net Written (store MTD)', 'SNAP Written − NWDSR Net Written', storeDates, nwdsrWritten, snapWritten, 'dollars', 'different reports; SNAP is reconciliation only');
const das = storeCumulative('DA_SALES_STORE', 'written');
const dad = storeCumulative('DA_SALES_STORE', 'delivered');
documented('Reconciliation', 'Data Analysis Group 17 written sales vs NWDSR Net Written', `DA_SALES_STORE cumulative ${das?.period_start}–${das?.verified_through} vs CC_Daily`, storeDates, nwdsrWritten, num(das?.sales_dollars), 'dollars', 'different reports; NWDSR is whole dollars');
documented('Reconciliation', 'Data Analysis Group 17 delivered sales vs NWDSR Delivered', `DA_SALES_STORE cumulative ${dad?.period_start}–${dad?.verified_through} vs CC_Daily`, storeDates, nwdsrDelivered, num(dad?.sales_dollars), 'dollars', 'different reports; NWDSR is whole dollars');
const associateDays = rowsOf(book, 'CC_AssociateDays');
const snapLines = associateDays.filter((row) => between(row.date!, store.start, store.end));
same('Reconciliation', 'SNAP Written store total vs salesperson lines', 'CC_Daily snap_written vs every CC_AssociateDays line (incl. managers, unknown)', storeDates, snapWritten, snapLines.length ? cents(snapLines.reduce((t, row) => t + Number(row.amount), 0)) : null, 'dollars');

// ===== Closing =====
const closingPage = pages.closing ?? {};
const homeClosing = (board.kpis ?? []).find((row: any) => row.name === 'Closing Ratio');
same('Closing page', 'Store purchasing customers', 'NWDSR Net Written # OF CUST', `${store.start} to ${closingThrough}`, customers, closingPage.store?.customers, 'count');
same('Closing page', 'Store PERQ opportunities', 'PERQ Location Ups + Be Backs', `${store.start} to ${closingThrough}`, opportunities, closingPage.store?.opportunities, 'count');
same('Closing page', 'Store closing ratio', 'customers ÷ opportunities', `${store.start} to ${closingThrough}`, closingRatio, closingPage.store?.ratio, 'percent', 'thousandth');
same('Home', 'Closing Ratio tile', 'customers ÷ opportunities', `${store.start} to ${closingThrough}`, closingRatio, homeClosing?.written, 'percent', 'thousandth');
same('Daily', 'MTD closing ratio', 'customers ÷ opportunities', `${store.start} to ${closingThrough}`, closingRatio, dailyPage.closing?.ratio, 'percent', 'thousandth');
const closingMtd = Object.fromEntries(rowsOf(book, 'CC_ClosingMTD').map((row) => [row.Metric!, row.Value!]));
same('CC_ClosingMTD', 'Purchasing customers', 'NWDSR Net Written # OF CUST', `${store.start} to ${closingMtd['MTD through']}`, customers, num(closingMtd['Purchasing customers']), 'count');
same('CC_ClosingMTD', 'Opportunities', 'PERQ Location Ups + Be Backs', `${store.start} to ${closingMtd['MTD through']}`, opportunities, num(closingMtd.Opportunities), 'count');
const cumulativeCust = closingRows.filter((row) => row.source === 'NWDSR Net Written # OF CUST' && row.period_start === store.start && row.period_end !== row.period_start);
cumulativeCust.forEach((row) => {
  const dailyTotal = custDaily.filter((d) => d.period_start! <= row.period_end!).reduce((t, d) => t + Number(d.customers), 0);
  same('Overlap', `NWDSR Written report ${row.period_start}–${row.period_end} customers vs daily rows`, 'Cumulative report row is a check, not added', `${row.period_start} to ${row.period_end}`, Number(row.customers), dailyTotal, 'count');
});
const perqSnapshots = perqRows.filter((row) => row.period_start === store.start && row.period_end !== row.period_start);
const earliest = perqSnapshots.slice().sort((a, b) => (a.verified_through! < b.verified_through! ? -1 : 1))[0];
perqSnapshots.filter((row) => earliest && row.verified_through! > earliest.verified_through!).forEach((row) => {
  const built = Number(earliest!.opportunities) + perqRows.filter((d) => d.period_start === d.period_end && d.period_start! > earliest!.verified_through! && d.period_start! <= row.verified_through!).reduce((t, d) => t + Number(d.opportunities), 0);
  same('Overlap', `PERQ snapshot ${row.period_start}–${row.period_end} (through ${row.verified_through}) vs ${earliest!.period_start}–${earliest!.verified_through} + dailies`, 'Snapshots are not added together', `${row.period_start} to ${row.verified_through}`, Number(row.opportunities), built, 'count');
});

// ===== Store KPIs: CC_Kpi (Home tiles) and the Bedding page against the ledger =====
const kpiViews: [string, string, Unit][] = [
  ['Fabric Maintenance', 'FABW_STORE', 'percent'], ['Leather Maintenance', 'LTHW_STORE', 'percent'], ['Power Upholstery', 'PWAR_STORE', 'percent'],
  ['Mattress Protectors', 'MPPA_STORE', 'percent'], ['Adjustable Base Attachment', 'BASES_STORE', 'percent'], ['Pillows', 'PILLOWS_STORE', 'percent'],
  ['Total Attachment', 'ATTACH_STORE', 'percent'], ['Wood / Furniture Protection', 'FP_STORE', 'percent'],
];
const tile = (name: string) => (board.kpis ?? []).find((row: any) => row.name === name || (name === 'Finance' && row.name === 'Financing'));
for (const side of ['written', 'delivered'] as const) {
  for (const [metric, view] of kpiViews) {
    const row = storeCumulative(view, side);
    const value = row && num(row.eligible) ? Math.round(Number(row.attachments) / Number(row.eligible) * 1000) / 1000 : null;
    same('Store KPI', `${metric} ${side}`, `${view} cumulative ${row?.period_start}–${row?.verified_through}: ${row?.attachments} of ${row?.eligible}`, `${store.start} to ${row?.verified_through}`, value, num(kpiRows[metric]?.[side]), 'percent', 'thousandth');
    same('Home', `${metric} tile ${side}`, 'CC_Kpi', `${store.start} to ${kpiRows[metric]?.verified_through}`, num(kpiRows[metric]?.[side]), tile(metric)?.[side], 'percent');
  }
  const bed = storeCumulative('BEDDING_STORE', side);
  const sales = storeCumulative('DA_SALES_STORE', side);
  const bedPct = bed && sales && bed.verified_through === sales.verified_through ? Math.round(Number(bed.sales_dollars) / Number(sales.sales_dollars) * 1000) / 1000 : null;
  same('Store KPI', `Bedding ${side}`, `BEDDING_STORE ${money(num(bed?.sales_dollars))} ÷ DA_SALES_STORE ${money(num(sales?.sales_dollars))}`, `${store.start} to ${bed?.verified_through}`, bedPct, num(kpiRows.Bedding?.[side]), 'percent', 'thousandth');
  same('Home', `Bedding tile ${side}`, 'CC_Kpi', `${store.start} to ${kpiRows.Bedding?.verified_through}`, num(kpiRows.Bedding?.[side]), tile('Bedding')?.[side], 'percent');
  same('Bedding page', `Store bedding ${side} %`, 'CC_Kpi Bedding (same figure as Home)', `${store.start} to ${kpiRows.Bedding?.verified_through}`, num(kpiRows.Bedding?.[side]), pages.bedding?.[side + 'Percent'], 'percent');
  if (pages.bedding && 'store' in pages.bedding) {
    same('Bedding page', `Store bedding ${side} $`, 'BEDDING_STORE cumulative', `${store.start} to ${bed?.verified_through}`, num(bed?.sales_dollars), pages.bedding.store?.[side]?.beddingDollars, 'dollars');
    for (const [metric, key] of [['Mattress Protectors', 'protectors'], ['Pillows', 'pillows'], ['Adjustable Base Attachment', 'bases']] as const) {
      same('Bedding page', `Store ${metric} ${side}`, 'CC_Kpi (same figure as Home)', `${store.start} to ${kpiRows[metric]?.verified_through}`, num(kpiRows[metric]?.[side]), pages.bedding.store?.[side]?.[key], 'percent');
    }
  }
  const avg = storeCumulative('AVERAGE_STORE', side);
  same('Store KPI', `Average ticket ${side}`, `AVERAGE_STORE cumulative (${avg?.unit_count} orders)`, `${store.start} to ${avg?.verified_through}`, num(avg?.sales_dollars), num(kpiRows['Average Ticket']?.[side]), 'dollars');
  if (avg && sales && avg.verified_through === sales.verified_through) {
    same('Store KPI', `Average ticket ${side} recomputed`, `DA_SALES_STORE ${money(num(sales.sales_dollars))} ÷ ${sales.unit_count} orders`, `${store.start} to ${avg.verified_through}`, cents(Number(sales.sales_dollars) / Number(sales.unit_count)), num(avg.sales_dollars), 'dollars');
  }
  same('Home', `Average Ticket tile ${side}`, 'CC_Kpi', `${store.start} to ${kpiRows['Average Ticket']?.verified_through}`, num(kpiRows['Average Ticket']?.[side]), tile('Average Ticket')?.[side], 'dollars');
  const rugs = storeCumulative('RUGS_STORE', side);
  same('Store KPI', `Rugs ${side}`, 'RUGS_STORE cumulative units', `${store.start} to ${rugs?.verified_through}`, num(rugs?.unit_count), num(kpiRows.Rugs?.[side]), 'count');
  same('Home', `Rugs tile ${side}`, 'CC_Kpi', `${store.start} to ${kpiRows.Rugs?.verified_through}`, num(kpiRows.Rugs?.[side]), tile('Rugs')?.[side], 'count');
  const fin = storeCumulative('FINANCE_STORE', side);
  same('Store KPI', `Finance ${side}`, 'FINANCE_STORE cumulative', `${store.start} to ${fin?.verified_through}`, num(fin?.kpi_percent), num(kpiRows.Finance?.[side]), 'percent');
  same('Home', `Financing tile ${side}`, 'CC_Kpi', `${store.start} to ${kpiRows.Finance?.verified_through}`, num(kpiRows.Finance?.[side]), tile('Finance')?.[side], 'percent');

  // Overlap: the combined cumulative row equals the earlier snapshot plus the daily rows after it.
  for (const view of ['DA_SALES_STORE', 'BEDDING_STORE', 'FABW_STORE', 'ATTACH_STORE']) {
    const latest = storeCumulative(view, side);
    const earlier = ledger.filter((row) => row.view === view && row.grain === 'cumulative' && row.side === side && row.period_start === store.start && !row.employee_code && latest && row.verified_through! < latest.verified_through!)
      .sort((a, b) => (a.verified_through! < b.verified_through! ? -1 : 1))[0];
    if (!latest || !earlier) continue;
    const days = ledger.filter((row) => row.view === view && row.grain === 'daily' && row.side === side && !row.employee_code && row.report_date! > earlier.verified_through! && row.report_date! <= latest.verified_through!);
    const field = view === 'DA_SALES_STORE' || view === 'BEDDING_STORE' ? 'sales_dollars' : 'attachments';
    same('Overlap', `${view} ${side} ${field}: ${latest.period_start}–${latest.verified_through} vs ${earlier.period_start}–${earlier.verified_through} + ${days.length} daily`, 'Cumulative and daily rows are not both added', `${store.start} to ${latest.verified_through}`, num(latest[field]), cents(Number(earlier[field]) + days.reduce((t, row) => t + Number(row[field] || 0), 0)), field === 'sales_dollars' ? 'dollars' : 'count');
  }
}
const metricsTab = Object.fromEntries(rowsOf(book, 'CC_Metrics').map((row) => [row.key!, row]));
if (metricsTab.bedding_percent?.value) {
  documented('Stale', 'CC_Metrics bedding_percent (older snapshot)', `CC_Metrics note "${metricsTab.bedding_percent.note}" vs CC_Kpi`, String(metricsTab.bedding_percent.note), num(kpiRows.Bedding?.written), num(metricsTab.bedding_percent.value), 'percent', 'older period; must not be displayed as the store month');
}

// ===== Morning meeting =====
const morning = pages.morning ?? {};
same('Morning', `Yesterday written (${yesterday})`, 'Same figure as Home', yesterday, home.yesterday?.written, morning.yesterday?.written?.actual, 'dollars');
same('Morning', `Yesterday written goal (${yesterday})`, 'Same figure as Home', yesterday, board.yesterday?.written?.goal, morning.yesterday?.written?.goal, 'dollars');
same('Morning', `Yesterday delivered (${yesterday})`, 'Same figure as Home', yesterday, home.yesterday?.delivered, morning.yesterday?.delivered?.actual, 'dollars');
same('Morning', `Today's written goal (${today})`, 'Same figure as Home', today, board.today?.written, morning.today?.written, 'dollars');
same('Morning', 'Bedding target', 'CC_Config bedding_minimum', today, num(config.bedding_minimum) ?? 0.2, morning.today?.beddingGoal, 'percent');
same('Morning', 'Closing target', 'CC_Config closing_goal', today, num(config.closing_goal) ?? 0.5, morning.today?.closingGoal, 'percent');

// ===== Goals (configured targets preserved) =====
const goals = home.goals ?? {};
for (const [label, key, expected] of [['Fabric', 'fabric', 0.8], ['Leather', 'leather', 0.8], ['Power', 'power', 0.8], ['Closing', 'closing', 0.5]] as const) {
  same('Goals', `${label} goal`, 'CC_Config (preserved target)', 'Current', expected, goals[key], 'percent');
}
for (const [label, name] of [['Fabric', 'Fabric Maintenance'], ['Leather', 'Leather Maintenance'], ['Power', 'Power Upholstery'], ['Closing', 'Closing Ratio']] as const) {
  same('Goals', `${label} goal on the Home tile`, 'CC_Config', 'Current', goals[label.toLowerCase()], tile(name)?.goal, 'percent');
}

// ===== Salesperson month =====
const peoplePage = pages.people ?? {};
const roster = rowsOf(book, 'CC_People');
const active = roster.filter((row) => row.role === 'associate' && (row.status || 'Active') === 'Active').map((row) => row.name!);
const personDates = `${person.start} to ${peoplePage.snapThrough ?? '?'} (salesperson month ${person.start}–${person.end})`;
const aliasFor = (name: string) => { const row = roster.find((r) => r.name === name); return [name, ...(row?.aliases ?? '').split(';').map((a) => a.trim())].map((a) => a.toLowerCase()).filter(Boolean); };
for (const name of active) {
  const aliases = aliasFor(name);
  const lines = associateDays.filter((row) => between(row.date!, person.start, person.end) && (aliases.includes(String(row.display_name).toLowerCase()) || aliases.includes(String(row.source_name).toLowerCase())));
  const snap = lines.length ? cents(lines.reduce((t, row) => t + Number(row.amount), 0)) : null;
  const pageRow = (peoplePage.people ?? []).find((row: any) => row.name === name);
  same('Sales Team', `${name} SNAP written`, 'CC_AssociateDays (SNAP Written by salesperson)', personDates, snap, pageRow?.snapWritten ?? null, 'dollars');
  same('Month-End', `${name} SNAP written`, 'CC_MonthEnd Person vs CC_AssociateDays', personDates, snap, monthEndValue('Person', 'SNAP Written', name), 'dollars');
  let summary: any = null;
  try { summary = plain(gs.summary_!({ session, name })); } catch (error) { summary = { error: String((error as Error).message) }; }
  same('Associate summary', `${name} SNAP written`, 'Same figure as Sales Team', personDates, pageRow?.snapWritten ?? null, summary?.person?.snapWritten ?? null, 'dollars');
  const closingRow = (closingPage.people ?? []).find((row: any) => row.name === name);
  const teamClosing = pageRow?.closing ?? {};
  const sumClosing = summary?.person?.closing ?? {};
  same('Closing page', `${name} written orders`, 'Group 17 Data Analysis Written (same as Sales Team)', `${person.start} to ${teamClosing.through || '?'}`, teamClosing.orders ?? null, closingRow?.orders ?? null, 'count');
  same('Closing page', `${name} PERQ opportunities`, 'PERQ Salesperson (same as Sales Team)', `${person.start} to ${teamClosing.through || '?'}`, teamClosing.opportunities ?? null, closingRow?.opportunities ?? null, 'count');
  same('Associate summary', `${name} closing ratio`, 'Written orders ÷ PERQ opportunities (same as Sales Team)', `${person.start} to ${teamClosing.through || '?'}`, teamClosing.ratio ?? null, sumClosing.ratio ?? null, 'percent');
  if (teamClosing.orders !== null && teamClosing.orders !== undefined && teamClosing.opportunities) {
    same('Sales Team', `${name} closing ratio recomputed`, `${teamClosing.orders} orders ÷ ${teamClosing.opportunities} opportunities`, `${person.start} to ${teamClosing.through}`, Math.round(teamClosing.orders / teamClosing.opportunities * 1000) / 1000, teamClosing.ratio, 'percent');
  }
  const personLedger = (side: string, upTo: string) => {
    const mine = ledger.filter((row) => row.view === 'DA_SALES_PERSON' && row.side === side && aliases.includes(String(row.employee_name).toLowerCase()));
    const base = mine.filter((row) => row.grain === 'cumulative' && row.period_start === person.start && !String(row.source_report).includes(' + ') && row.verified_through! <= upTo)
      .sort((a, b) => (a.verified_through! < b.verified_through! ? -1 : 1)).pop();
    // Each Data Analysis file covers the whole store, so a salesperson missing from a covered file had no sales.
    const baseThrough = base ? base.verified_through! : '';
    const after = mine.filter((row) => row.grain === 'daily' && row.period_start! > baseThrough && row.period_start! <= upTo && row.period_start! <= person.end);
    return {
      sales: cents((base ? Number(base.sales_dollars) : 0) + after.reduce((t, row) => t + Number(row.sales_dollars), 0)),
      units: (base ? Number(base.unit_count) : 0) + after.reduce((t, row) => t + Number(row.unit_count || 0), 0),
      source: base ? `DA_SALES_PERSON snapshot ${base.period_start}–${base.verified_through} + ${after.length} daily file(s)` : `DA_SALES_PERSON: not listed on any covered file (${after.length} daily row(s))`,
    };
  };
  const delivered = pageRow?.analysis?.delivered;
  const deliveredSummary = summary?.person?.analysis?.delivered;
  if (pageRow?.deliveredThrough) {
    const fromLedger = personLedger('delivered', pageRow.deliveredThrough);
    same('Sales Team', `${name} delivered sales from the ledger`, fromLedger?.source ?? 'DA_SALES_PERSON', `${person.start} to ${pageRow.deliveredThrough}`, fromLedger?.sales ?? null, delivered?.sales ?? null, 'dollars');
  }
  if (teamClosing.through && teamClosing.orders !== null && teamClosing.orders !== undefined) {
    const fromLedger = personLedger('written', teamClosing.through);
    same('Sales Team', `${name} written orders from the ledger`, fromLedger?.source ?? 'DA_SALES_PERSON', `${person.start} to ${teamClosing.through}`, fromLedger?.units ?? null, teamClosing.orders, 'count');
  }
  same('Associate summary', `${name} delivered sales`, 'Group 17 Data Analysis Delivered (same as Sales Team)', `${person.start} to ${pageRow?.deliveredThrough || '?'}`, delivered?.sales ?? null, deliveredSummary?.sales ?? null, 'dollars');
  const goal = pageRow?.monthlyGoal;
  same('Goals', `${name} monthly written goal`, 'CC_Config individual_volume_goal', 'Current', num(config.individual_volume_goal), goal ?? null, 'dollars');
}
const reportThrough = (peoplePage.people ?? []).map((row: any) => row.analysisWrittenThrough || '').sort().pop() || null;
const reportDeliveredThrough = (peoplePage.people ?? []).map((row: any) => row.deliveredThrough || '').sort().pop() || null;
note('Reports', 'Group 17 Written verified through (Reports page)', 'Latest across salespeople vs the date the page prints', person.start + ' onward', String(reportThrough), String(peoplePage.analysisThrough?.written ?? null), reportThrough === (peoplePage.analysisThrough?.written ?? null) ? 'Match' : 'MISMATCH');
note('Reports', 'Group 17 Delivered verified through (Reports page)', 'Latest across salespeople vs the date the page prints', person.start + ' onward', String(reportDeliveredThrough), String(peoplePage.analysisThrough?.delivered ?? null), reportDeliveredThrough === (peoplePage.analysisThrough?.delivered ?? null) ? 'Match' : 'MISMATCH');

// ===== Duplicates and stale records =====
const keys = ledger.map((row) => row.record_key);
note('Duplicates', 'CC_Ledger record keys', 'CC_Ledger', 'All', '0 duplicates', `${keys.length - new Set(keys).size} duplicates in ${keys.length} rows`, keys.length === new Set(keys).size ? 'Match' : 'MISMATCH');
const dailyDates = rowsOf(book, 'CC_Daily').map((row) => row.date);
note('Duplicates', 'CC_Daily dates', 'CC_Daily', 'All', '0 duplicates', `${dailyDates.length - new Set(dailyDates).size} duplicates`, dailyDates.length === new Set(dailyDates).size ? 'Match' : 'MISMATCH');
const kpiKeys = rowsOf(book, 'CC_Kpi').map((row) => [row.metric, row.period_start, row.period_end].join('|'));
note('Duplicates', 'CC_Kpi metric + period', 'CC_Kpi', 'All', '0 duplicates', `${kpiKeys.length - new Set(kpiKeys).size} duplicates`, kpiKeys.length === new Set(kpiKeys).size ? 'Match' : 'MISMATCH');
const closingKeys = rowsOf(book, 'CC_Closing').map((row) => [row.scope, row.employee_code, row.source, row.period_start, row.period_end].join('|'));
const closingDupes = closingKeys.filter((key, i) => closingKeys.indexOf(key) !== i);
note('Duplicates', 'CC_Closing scope + person + source + dates', 'CC_Closing', 'All', '0 duplicates', closingDupes.length ? closingDupes.join('; ') : '0 duplicates', closingDupes.length ? 'MISMATCH' : 'Match');
const goalRows = rowsOf(book, 'CC_DailyGoals');
const goalBasis = goalRows.filter((row) => between(row.date!, store.start, shift(today, -1)));
const goalMismatch = goalBasis.filter((row) => {
  const expected = dailyGoal(writtenGoal, 'nwdsr_written', row.date!);
  return expected !== null && num(row.written_goal) !== expected;
});
note('Stale', 'CC_DailyGoals written goals on the NWDSR Net Written basis', 'CC_DailyGoals vs (written_goal − NWDSR before the day) ÷ open days left', `${store.start} to ${shift(today, -1)}`, `${goalBasis.length} saved days`, goalMismatch.length ? `${goalMismatch.length} days on another basis (e.g. ${goalMismatch[0]!.date}: ${money(num(goalMismatch[0]!.written_goal))} vs ${money(dailyGoal(writtenGoal, 'nwdsr_written', goalMismatch[0]!.date!))})` : 'All match', goalMismatch.length ? 'MISMATCH' : 'Match');
const deliveredGoalMismatch = goalBasis.filter((row) => { const e = dailyGoal(deliveredGoal, 'nwdsr_delivered', row.date!); return e !== null && num(row.delivered_goal) !== e; });
note('Stale', 'CC_DailyGoals delivered goals on the NWDSR Delivered basis', 'CC_DailyGoals vs (delivered_goal − NWDSR Delivered before the day) ÷ open days left', `${store.start} to ${shift(today, -1)}`, `${goalBasis.length} saved days`, deliveredGoalMismatch.length ? `${deliveredGoalMismatch.length} days differ` : 'All match', deliveredGoalMismatch.length ? 'MISMATCH' : 'Match');

if (registry) {
  const byKey = Object.fromEntries(registry.map((row) => [row.key, row]));
  for (const [key, expected] of [['store_written', 'NWDSR Net Written'], ['store_delivered', 'NWDSR Delivered'], ['store_snap_written', 'SNAP Written'], ['store_closing', 'NWDSR Net Written # OF CUST ÷ PERQ Location Ups + Be Backs'], ['person_written', 'SNAP Written by salesperson'], ['person_delivered', 'Group 17 Data Analysis Delivered'], ['person_opportunities', 'PERQ Salesperson Ups + Be Backs']] as const) {
    note('Registry', `${key} approved source`, 'CC_MetricDefinitions', 'Current', expected, String(byKey[key]?.source ?? 'missing'), byKey[key]?.source === expected ? 'Match' : 'MISMATCH');
  }
  note('Registry', 'store_written verified through', 'Registry vs CC_Daily', storeDates, through, String(byKey.store_written?.verifiedThrough ?? ''), byKey.store_written?.verifiedThrough === through ? 'Match' : 'MISMATCH');
  note('Registry', 'store_closing verified through', 'Registry vs CC_Closing', `${store.start} to ${closingThrough}`, closingThrough, String(byKey.store_closing?.verifiedThrough ?? ''), byKey.store_closing?.verifiedThrough === closingThrough ? 'Match' : 'MISMATCH');
  for (const [key, goal] of [['kpi_fabric', 0.8], ['kpi_leather', 0.8], ['kpi_power', 0.8], ['store_closing', 0.5]] as const) {
    same('Registry', `${key} goal`, 'CC_MetricDefinitions vs CC_Config', 'Current', goal, byKey[key]?.goal ?? null, 'percent');
  }
}

for (const [name, page] of Object.entries(pages)) if (page?.error) note('Pages', `${name}_ ran`, 'Apps Script page function', today, 'No error', page.error, 'MISMATCH');

// ---------- output ----------
const failing = checks.filter((check) => check.status === 'MISMATCH');
const header = ['Area', 'Metric', 'Source', 'Reporting Dates', 'Expected', 'Actual', 'Variance', 'Status'];
const md = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...checks.map((c) => `| ${[c.area, c.metric, c.source, c.dates, c.expected, c.actual, c.variance, c.status].map((v) => String(v).replace(/\|/g, '/')).join(' | ')} |`)].join('\n');
const writtenTabs = [...new Set(writes.map((w) => w.split('!')[0]))];
const summaryLine = `${checks.length} checks · ${failing.length} mismatches · as of ${today} (yesterday ${yesterday}) · store month ${store.start}–${store.end} · salesperson month ${person.start}–${person.end} · code ${path.basename(codeDir)} · writes the pages would make (not applied): ${writtenTabs.join(', ') || 'none'}`;
if (option('--markdown')) writeFileSync(option('--markdown')!, md + '\n\n' + summaryLine + '\n');
if (option('--json')) writeFileSync(option('--json')!, JSON.stringify({ today, store, person, checks, writes, registry, pages }, null, 1));
console.log(md);
console.log('\n' + summaryLine);
process.exitCode = failing.length ? 1 : 0;
