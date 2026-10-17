/**
 * Counts the Google Sheets reads each dashboard page makes. Loads a workbook snapshot (auditMetrics --save), runs every
 * page function in memory and records each SpreadsheetApp.openById and each full-tab getValues() by tab. Nothing is
 * written to the live workbook. Each read is a round trip to Sheets in Apps Script, so the counts track page speed.
 *
 *   node --experimental-strip-types server/profileReads.ts --snapshot in.json [--today YYYY-MM-DD] [--json out.json]
 *        [--code apps-script-dir] [--pages replies.json]
 *
 * --pages saves every page's reply, so two code versions can be compared figure for figure on the same snapshot.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { appsScriptServices } from './appsScriptServices.ts';
import { fakeSpreadsheet, type Grid, loadAppsScript } from './fakeSpreadsheet.ts';
import { appsScriptGrid, type Workbook } from './snapshotGrid.ts';

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const codeDir = option('--code') ?? new URL('../apps-script', import.meta.url).pathname;
const FILES = ['Code.gs', 'Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'EvalImport.gs', 'Evaluations.gs', 'Upload.gs', 'MonthEnd.gs', 'History.gs', 'Documents.gs', 'Auth.gs', 'Logos.gs', 'Quality.gs', 'Backup.gs', 'Cache.gs'].filter((file) => {
  try { readFileSync(`${codeDir}/${file}`); return true; } catch { return false; }
});
const ROUTES: [string, Record<string, unknown>][] = [['home', {}], ['daily', {}], ['closing', {}], ['people', {}], ['morning', {}], ['health', {}], ['bedding', {}], ['coverage', {}], ['uploads', { date: '' }], ['evals', {}], ['documents', {}]];

const snapshotPath = option('--snapshot');
if (!snapshotPath) throw new Error('--snapshot is required (save one with auditMetrics --save).');
const book: Workbook = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const today = option('--today') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tabs: Record<string, Grid> = Object.fromEntries(Object.entries(book).map(([name, tab]) => [name, appsScriptGrid(tab)]));
const services = appsScriptServices().services;
const cache: Record<string, string> = {};
const gs = loadAppsScript(FILES.map((file) => `${codeDir}/${file}`), tabs, today, {
  ...services,
  // The one-time seeding flags are set in production, so the profile does not re-run the seeding.
  PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => (key === 'closing_facts_v1' || key === 'morning_promo_v1' ? 'yes' : null), setProperty: () => undefined, deleteProperty: () => undefined, getProperties: () => ({}) }) },
  CacheService: { getScriptCache: () => ({ get: (key: string) => cache[key] ?? null, getAll: (keys: string[]) => Object.fromEntries(keys.filter((k) => k in cache).map((k) => [k, cache[k]])), put: (key: string, value: string) => { cache[key] = value; }, putAll: (map: Record<string, string>) => Object.assign(cache, map), remove: (key: string) => { delete cache[key]; }, removeAll: (keys: string[]) => keys.forEach((k) => delete cache[k]) }) },
  ScriptApp: { getProjectTriggers: () => [] },
  Session: { getScriptTimeZone: () => 'America/New_York' },
  DriveApp: { getFolderById: () => ({ getFiles: () => ({ hasNext: () => false }) }), getFileById: () => { throw new Error('no drive in profile'); } },
  MailApp: { sendEmail: () => { throw new Error('mail is not sent from the profile'); } },
});
const counts = { open: 0, reads: {} as Record<string, number>, writes: {} as Record<string, number> };
const book_ = fakeSpreadsheet(tabs);
(gs as unknown as Record<string, unknown>).SpreadsheetApp = {
  openById: () => {
    counts.open += 1;
    return {
      ...book_,
      getSheetByName: (name: string) => {
        const tab = book_.getSheetByName(name);
        if (!tab) return null;
        const wrote = () => { counts.writes[name] = (counts.writes[name] ?? 0) + 1; };
        return {
          ...tab,
          getDataRange: () => ({ getValues: () => { counts.reads[name] = (counts.reads[name] ?? 0) + 1; return tab.getDataRange().getValues(); } }),
          appendRow: (row: unknown[]) => { wrote(); tab.appendRow(row); },
          clearContents: () => { wrote(); tab.clearContents(); },
          getRange: (...a: [number, number, number?, number?]) => {
            const range = tab.getRange(...a);
            return { ...range, setValue: (v: unknown) => { wrote(); range.setValue(v); }, setValues: (v: unknown[][]) => { wrote(); range.setValues(v); } };
          },
        };
      },
      getSheets: () => Object.keys(tabs).map((name) => book_.getSheetByName(name)),
    };
  },
};
(gs as unknown as Record<string, unknown>).appendException_ = () => undefined;
(gs as unknown as Record<string, unknown>).notifyOnce_ = () => undefined;

const session = { role: 'admin', username: 'profile' };
const replies: Record<string, unknown> = {};
const results: { route: string; opens: number; reads: number; distinctTabs: number; repeated: number; top: string; writes: string; ms: number; error?: string }[] = [];
for (const [route, extra] of ROUTES) {
  counts.open = 0;
  counts.reads = {};
  counts.writes = {};
  const fn = gs[route + '_'];
  const started = performance.now();
  let error: string | undefined;
  let reply: unknown;
  try {
    const memo = (gs as unknown as Record<string, Record<string, boolean> | undefined>).MEMO_PAGES_;
    if (memo?.[route] && typeof gs.beginPageRead_ === 'function') gs.beginPageRead_();
    reply = fn!({ session, ...extra });
  } catch (e) { error = String((e as Error)?.message ?? e); }
  if (typeof gs.endPageRead_ === 'function') gs.endPageRead_();
  (gs as unknown as Record<string, unknown>).BOOK_ = null;
  const ms = Math.round(performance.now() - started);
  const reads = Object.values(counts.reads).reduce((t, n) => t + n, 0);
  const tabsRead = Object.keys(counts.reads).length;
  const top = Object.entries(counts.reads).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, n]) => `${name}×${n}`).join(', ');
  const writes = Object.entries(counts.writes).map(([name, n]) => `${name}×${n}`).join(', ');
  replies[route] = reply === undefined ? null : JSON.parse(JSON.stringify(reply));
  results.push({ route, opens: counts.open, reads, distinctTabs: tabsRead, repeated: reads - tabsRead, top, writes, ms, error });
}
const header = '| Page | openById | Tab reads | Distinct tabs | Repeat reads | Most-read tabs | Writes | Local ms |';
console.log([header, '| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |', ...results.map((r) => `| ${r.route} | ${r.opens} | ${r.reads} | ${r.distinctTabs} | ${r.repeated} | ${r.top}${r.error ? ' — ERROR ' + r.error : ''} | ${r.writes || 'none'} | ${r.ms} |`)].join('\n'));
const total = results.reduce((t, r) => ({ opens: t.opens + r.opens, reads: t.reads + r.reads }), { opens: 0, reads: 0 });
console.log(`\nTotal across ${results.length} pages: ${total.opens} openById, ${total.reads} tab reads.`);
if (option('--pages')) writeFileSync(option('--pages')!, JSON.stringify(replies, null, 1));
if (option('--json')) writeFileSync(option('--json')!, JSON.stringify({ today, results, total }, null, 1));
if (results.some((r) => r.error)) process.exitCode = 1;
