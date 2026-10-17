/**
 * Runs the automated quality checks on a workbook snapshot (auditMetrics --save) in memory. Prints every check, the data
 * status of each metric, period and business day, and the alerts that would be opened or resolved. Nothing is written to
 * the live workbook and no email is sent; the run fails if any imported tab would change.
 *
 *   node --experimental-strip-types server/qualityDryRun.ts --snapshot in.json [--today YYYY-MM-DD] [--hour 0-23]
 *        [--json out.json] [--markdown out.md]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { appsScriptServices } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';
import { appsScriptGrid, table, textGrid, type Workbook } from './snapshotGrid.ts';

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const FILES = ['Code.gs', 'Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'EvalImport.gs', 'Evaluations.gs', 'Upload.gs', 'MonthEnd.gs', 'History.gs', 'Quality.gs'];
// Tabs the checks own. Every other tab must be byte-for-byte the same after the run.
const QUALITY_TABS = new Set(['CC_QualityChecks', 'CC_QualityRuns', 'CC_DataStatus', 'CC_Alerts', 'CC_Health']);

export function runQualityOnTabs(tabs: Record<string, Grid>, today: string, hour: number, props: Record<string, string> = {}) {
  const services = appsScriptServices().services;
  const mail: { to: string; subject: string; body: string }[] = [];
  const cache: Record<string, string> = {};
  const gs = loadAppsScript(FILES, tabs, today, {
    ...services,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null, setProperty: (key: string, value: string) => { props[key] = value; }, deleteProperty: (key: string) => { delete props[key]; }, getProperties: () => ({ ...props }) }) },
    CacheService: { getScriptCache: () => ({ get: (key: string) => cache[key] ?? null, put: (key: string, value: string) => { cache[key] = value; }, remove: (key: string) => { delete cache[key]; }, removeAll: (keys: string[]) => keys.forEach((k) => delete cache[k]) }) },
    MailApp: { sendEmail: (to: string, subject: string, body: string) => { mail.push({ to, subject, body }); } },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    ScriptApp: { getProjectTriggers: () => [] },
  });
  (gs as unknown as Record<string, unknown>).nowHourNy_ = () => hour;
  const summary = plain(gs.runQualityChecks_!('dry run'));
  return { gs, summary, mail, props };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshotPath = option('--snapshot');
  if (!snapshotPath) throw new Error('--snapshot is required (save one with auditMetrics --save).');
  const book: Workbook = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const today = option('--today') ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const hour = Number(option('--hour') ?? 12);
  const tabs: Record<string, Grid> = Object.fromEntries(Object.entries(book).map(([name, tab]) => [name, appsScriptGrid(tab)]));
  const before = Object.fromEntries(Object.keys(tabs).filter((name) => !QUALITY_TABS.has(name)).map((name) => [name, JSON.stringify(textGrid(tabs[name]))]));
  const { summary } = runQualityOnTabs(tabs, today, hour);
  const changed = Object.keys(before).filter((name) => JSON.stringify(textGrid(tabs[name])) !== before[name]);
  const checks = table(tabs, 'CC_QualityChecks');
  const status = table(tabs, 'CC_DataStatus');
  const alerts = table(tabs, 'CC_Alerts');
  const lines: string[] = [];
  lines.push(`Quality checks on ${snapshotPath} as of ${today} ${hour}:00 — ${summary.checks} results: ${summary.passed} PASS, ${summary.flagged} FLAG, ${summary.noted} NOTE. Alerts: ${summary.active} active, ${summary.resolved} resolved this run. Store month ${summary.storeMonth}, salesperson month ${summary.personMonth}.`);
  lines.push('', '| Check | Status | Subject | Explanation |', '| --- | --- | --- | --- |');
  checks.forEach((row) => lines.push(`| ${row.area} | ${row.status} | ${row.subject.replace(/\|/g, '/')} | ${row.explanation.replace(/\|/g, '/')} |`));
  lines.push('', '| Kind | Name | Period | Verified through | Expected through | Status | Explanation |', '| --- | --- | --- | --- | --- | --- | --- |');
  status.forEach((row) => lines.push(`| ${row.kind} | ${row.name} | ${row.period_dates} | ${row.verified_through} | ${row.expected_through} | ${row.status} | ${row.explanation.replace(/\|/g, '/')} |`));
  lines.push('', '| Alert | Severity | Status | Message / resolution |', '| --- | --- | --- | --- |');
  alerts.forEach((row) => lines.push(`| ${row.alert_key} | ${row.severity} | ${row.status} | ${(row.status === 'Active' ? row.message : row.resolution).replace(/\|/g, '/')} |`));
  lines.push('', changed.length ? `IMPORTED TABS CHANGED: ${changed.join(', ')}` : `Imported tabs unchanged (${Object.keys(before).length} tabs compared).`);
  console.log(lines.join('\n'));
  if (option('--markdown')) writeFileSync(option('--markdown')!, lines.join('\n') + '\n');
  if (option('--json')) writeFileSync(option('--json')!, JSON.stringify({ summary, checks, status, alerts, changed }, null, 1));
  if (changed.length) process.exitCode = 1;
}
