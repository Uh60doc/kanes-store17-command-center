/**
 * Check the STORE and PERSON tab formulas and CC_ScopeAudit against the reporting-calendar rule.
 *
 *   node --experimental-strip-types server/checkScopeViews.ts               scratch copy of the live rows plus edge cases
 *   node --experimental-strip-types server/checkScopeViews.ts --production  install on the command center and read back
 *
 * The scratch run only reads production. The production run rewrites the calculated tabs, never CC_Ledger,
 * CC_Closing or CC_Kpi.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SHEETS_SCOPE } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { AUDIT_HEADERS, AUDIT_TAB, NOT_SUPPLIED, SCOPE_VIEWS, VIEW_EXTRA_HEADERS, installScopeViews, scopeOf, type Scope } from './scopeViews.ts';
import { readStored } from './tokenStore.ts';
import { fitsTrack, periodContaining, type ReportingCategory } from '../src/domain/reportingCalendar.ts';

type Cell = string | number | boolean;
const SCRATCH = path.join(homedir(), '.config/store17-command-center/scope-view-check.json');
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SOURCE_TABS = ['CC_Ledger', 'CC_Closing', 'CC_Kpi'] as const;
const PRODUCTION = process.argv.includes('--production');

loadDotEnv(process.cwd());
const config = loadConfig(process.cwd());
const production = readStored(config.tokenPath).spreadsheetId;
if (!production) throw new Error('The command center spreadsheet is not saved.');
const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });

async function cells(spreadsheetId: string, range: string, render: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'): Promise<Cell[][]> {
  const payload = await googleJson({ accessToken: token, url: `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${render}` }) as { values?: Cell[][] };
  return payload.values ?? [];
}

async function values(spreadsheetId: string, range: string, render: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' = 'FORMATTED_VALUE'): Promise<string[][]> {
  return (await cells(spreadsheetId, range, render)).map((row) => row.map((cell) => String(cell)));
}

async function scratchId(): Promise<string> {
  if (existsSync(SCRATCH)) return (JSON.parse(readFileSync(SCRATCH, 'utf8')) as { spreadsheetId: string }).spreadsheetId;
  const created = await googleJson({
    accessToken: token,
    method: 'POST',
    url: SHEETS,
    body: {
      properties: { title: 'Store 17 scope view check (scratch copy)', timeZone: 'America/New_York', locale: 'en_US' },
      sheets: SOURCE_TABS.map((title) => ({ properties: { title } })),
    },
  }) as { spreadsheetId: string };
  writeFileSync(SCRATCH, JSON.stringify({ spreadsheetId: created.spreadsheetId }, null, 2));
  return created.spreadsheetId;
}

const iso = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d+(\.\d+)?$/.test(value)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000).toISOString().slice(0, 10);
  return '';
};
const category = (scope: Scope): ReportingCategory => (scope === 'STORE' ? 'store' : 'individual');

// Scratch-only rows that exercise the period boundaries and missing identifiers.
const ledgerRow = (view: string, grain: string, report: string, start: string, end: string, through: string, name: string, side: string, dollars: string, source = 'check.xlsx', store = '17'): string[] =>
  [view, grain, report, start, end, through, store, name ? 'CHECK' : '', name, side, dollars, '', '', '', '', source, '2026-10-16T00:00:00.000Z', [view, grain, report, start, end, side, name || 'STORE'].join('|')];
const EDGE_LEDGER = [
  ledgerRow('RUGS_STORE', 'daily', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', '', 'written', '5'),
  ledgerRow('PILLOWS_PERSON', 'daily', '2026-10-01', '2026-10-01', '2026-10-01', '2026-10-01', 'Check Person', 'written', '3'),
  ledgerRow('PILLOWS_PERSON', 'cumulative', '2026-10-10', '2026-10-01', '2026-10-10', '2026-10-10', 'Check Person', 'written', '9'),
  ledgerRow('PILLOWS_PERSON', 'cumulative', '2026-10-12', '2026-10-01', '2026-10-31', '2026-10-12', 'Check Person', 'written', '11'),
  ledgerRow('PILLOWS_PERSON', 'daily', '2026-10-13', '2026-10-13', '2026-10-13', '2026-10-13', 'Check Person', 'written', '2'),
  ledgerRow('PERQ_STORE', 'cumulative', '2026-10-13', '2026-10-01', '2026-11-01', '2026-10-13', '', '', '99'),
  ledgerRow('UVWL_STORE', 'daily', '2026-10-15', '2026-10-15', '2026-10-15', '', '', 'written', '1', '', ''),
];
const EDGE_CLOSING = [
  ['2026-10-13', 'person', 'CHECK', 'Check Person', '', 5, '2026-10-02', '2026-10-31', 'PERQ Ups + Be Backs', 'yes', 'check', '2026-10-13', '17'],
];
const EDGE_KPI = [['Check Metric', 0.5, 0.4, 'check', '2026-10-01', '2026-10-31', '2026-10-14']];

const target = PRODUCTION ? production : await scratchId();
if (!PRODUCTION) {
  const live = await Promise.all(SOURCE_TABS.map((tab) => cells(production, `${tab}!A1:Z`, 'UNFORMATTED_VALUE')));
  const [ledger, closing, kpi] = live;
  await googleJson({ accessToken: token, method: 'POST', url: `${SHEETS}/${target}/values:batchClear`, body: { ranges: SOURCE_TABS.map((tab) => `${tab}!A:Z`) } });
  await googleJson({
    accessToken: token,
    method: 'POST',
    url: `${SHEETS}/${target}/values:batchUpdate`,
    body: {
      valueInputOption: 'RAW',
      data: [
        { range: 'CC_Ledger!A1', values: [...ledger, ...EDGE_LEDGER] },
        { range: 'CC_Closing!A1', values: [...closing, ...EDGE_CLOSING] },
        { range: 'CC_Kpi!A1', values: [...kpi, ...EDGE_KPI] },
      ],
    },
  });
}
const installed = await installScopeViews({ accessToken: token, spreadsheetId: target });

const ledger = await values(target, 'CC_Ledger!A1:R');
const ledgerHeader = ledger[0];
const ledgerRows = ledger.slice(1).map((row, index) => ({ row: Array.from({ length: 18 }, (_, column) => row[column] ?? ''), sheetRow: index + 2 })).filter((entry) => entry.row[0]);

interface Fitted { row: string[]; scope: Scope; start: string; end: string; through: string }

/** Mirror of the tab's counting column. */
function counting(entry: Fitted, all: Fitted[]): string {
  const same = all.filter((other) => other.row[1] === 'cumulative' && other.row[9] === entry.row[9] && other.row[7] === entry.row[7] && other.row[8] === entry.row[8]);
  if (entry.row[1] === 'cumulative') {
    const peers = same.filter((other) => other.start === entry.start);
    const top = peers.map((other) => other.through).sort().at(-1)!;
    if (entry.through < top) return `Earlier snapshot, replaced by the one through ${top}: not counted`;
    const ties = peers.filter((other) => other.through === top).length;
    return ties > 1
      ? `Latest snapshot through ${top}: ${ties} reports agree on this cutoff, use one, never add them`
      : 'Latest snapshot for this period: use it alone, daily rows inside it are not added';
  }
  const trackStart = periodContaining(category(entry.scope), entry.start).start;
  const cover = same.filter((other) => other.start === trackStart && other.through >= entry.start).map((other) => other.through).sort().at(-1);
  return cover ? `Daily, inside the snapshot through ${cover}: already in it, not added` : 'Daily, after the latest snapshot: counted once';
}

const report: string[] = [];
const errorPattern = /^#(N\/A|REF|VALUE|ERROR|NAME|DIV\/0|NUM)/;
for (const view of SCOPE_VIEWS) {
  const scope = scopeOf(view)!;
  const shown = await values(target, `${view}!A1:V`);
  assert.deepEqual(shown.flat().filter((cell) => errorPattern.test(cell)), [], `${view} shows formula errors`);
  assert.deepEqual(shown[0], [...ledgerHeader, ...VIEW_EXTRA_HEADERS], `${view} header`);
  const mine = ledgerRows.filter((entry) => entry.row[0] === view);
  const fitted: Fitted[] = mine
    .map((entry) => ({ row: entry.row, scope, start: iso(entry.row[3]), end: iso(entry.row[4]), through: iso(entry.row[5]) || iso(entry.row[4]) }))
    .filter((entry) => fitsTrack(category(scope), entry.start, entry.end));
  const body = shown.slice(1).map((row) => Array.from({ length: 22 }, (_, column) => row[column] ?? ''));
  if (!mine.length) {
    assert.equal(body.length, 1, `${view} message row`);
    if (NOT_SUPPLIED[view]) assert.equal(body[0][0], NOT_SUPPLIED[view]);
    else assert.match(body[0][0], scope === 'PERSON' ? /^No salesperson report on file .* Pending\. Store figures are not copied here\.$/ : /^No store report on file .* Pending\.$/);
  } else if (!fitted.length) {
    assert.equal(body.length, 1, `${view} message row`);
    assert.match(body[0][0], new RegExp(`^No record on file covers an? (store|individual) period .* ${mine.length} record\\(s\\) with other date ranges are kept in CC_Ledger`));
  } else {
    const expected = fitted.map((entry) => {
      const period = periodContaining(category(scope), entry.start);
      return [...entry.row, scope, period.start, period.end, counting(entry, fitted)];
    });
    assert.deepEqual(body, expected, `${view} rows`);
  }
  report.push(`${view.padEnd(24)} scope ${scope.padEnd(6)} ledger ${String(mine.length).padStart(3)}  shown ${String(fitted.length).padStart(3)}  kept out ${String(mine.length - fitted.length).padStart(3)}${mine.length ? '' : '  (no report on file: Pending)'}`);
}

// Every record the audit should list, computed from the same rule.
const closing = await values(target, 'CC_Closing!A1:M', 'UNFORMATTED_VALUE');
const kpi = await values(target, 'CC_Kpi!A1:G', 'UNFORMATTED_VALUE');
const expectedAudit = new Set<string>();
ledgerRows.forEach((entry) => {
  const scope = scopeOf(entry.row[0]);
  const datesFit = scope ? fitsTrack(category(scope), iso(entry.row[3]), iso(entry.row[4])) : false;
  const identifiers = entry.row[5] && entry.row[6] === '17' && entry.row[15] && ['daily', 'cumulative'].includes(entry.row[1]);
  if (!datesFit || !identifiers) expectedAudit.add(`CC_Ledger|${entry.sheetRow}`);
});
closing.slice(1).forEach((row, index) => {
  if (!row[1]) return;
  const scope = row[1].trim().toLowerCase() === 'store' ? 'STORE' : row[1].trim().toLowerCase() === 'person' ? 'PERSON' : null;
  const datesFit = scope ? fitsTrack(category(scope), iso(row[6] ?? ''), iso(row[7] ?? '')) : false;
  const identifiers = row[11] && row[12] === '17' && row[8];
  if (!datesFit || !identifiers) expectedAudit.add(`CC_Closing|${index + 2}`);
});
kpi.slice(1).forEach((row, index) => {
  if (!row[0]) return;
  const figure = Boolean((row[1] ?? '').trim() || (row[2] ?? '').trim());
  if (!fitsTrack('store', iso(row[4] ?? ''), iso(row[5] ?? '')) || (figure && !(row[6] ?? '').trim())) expectedAudit.add(`CC_Kpi|${index + 2}`);
});

const audit = await values(target, `${AUDIT_TAB}!A1:O`);
assert.deepEqual(audit.flat().filter((cell) => errorPattern.test(cell)), [], `${AUDIT_TAB} shows formula errors`);
assert.deepEqual(audit[0], [...AUDIT_HEADERS], `${AUDIT_TAB} header`);
const listed = audit.slice(1).filter((row) => row[1]).map((row) => `${row[0]}|${row[1]}`);
assert.deepEqual([...listed].sort(), [...expectedAudit].sort(), `${AUDIT_TAB} lists exactly the records that do not fit`);

if (!PRODUCTION) {
  const find = (tab: string, predicate: (row: string[]) => boolean) => audit.find((row) => row[0] === tab && predicate(row));
  assert.match(find('CC_Ledger', (row) => row[2] === 'PERQ_STORE' && row[6] === '2026-10-01' && row[7] === '2026-11-01')?.[13] ?? '', /^Cumulative 2026-10-01 to 2026-11-01 does not fit a STORE period: store periods run the 2nd through the 1st of the next month\.$/);
  assert.match(find('CC_Ledger', (row) => row[2] === 'UVWL_STORE' && row[5] === '2026-10-15')?.[13] ?? '', /^No verified-through date\. Store is not 17\. No source report\.$/);
  assert.match(find('CC_Closing', (row) => row[10] === 'Check Person')?.[13] ?? '', /does not fit a PERSON period.* It matches the store range\.$/);
  assert.equal(find('CC_Closing', (row) => row[10] === 'Check Person')?.[14], 'Kept in CC_Closing. Not counted in the PERSON closing ratio.');
  assert.match(find('CC_Kpi', (row) => row[2] === 'Check Metric')?.[13] ?? '', /does not fit a STORE period.* It matches the individual range\.$/);
  const rugs = await values(target, 'RUGS_STORE!A1:V');
  const october1 = rugs.find((row) => row[2] === '2026-10-01');
  assert.deepEqual(october1?.slice(18, 21), ['STORE', '2026-09-02', '2026-10-01'], 'an October 1 store daily row belongs to the September store month');
  const pillows = (await values(target, 'PILLOWS_PERSON!A1:V')).filter((row) => row[8] === 'Check Person');
  assert.deepEqual(pillows.map((row) => [row[2], row[21]]), [
    ['2026-10-01', 'Daily, inside the snapshot through 2026-10-12: already in it, not added'],
    ['2026-10-10', 'Earlier snapshot, replaced by the one through 2026-10-12: not counted'],
    ['2026-10-12', 'Latest snapshot for this period: use it alone, daily rows inside it are not added'],
    ['2026-10-13', 'Daily, after the latest snapshot: counted once'],
  ]);
  report.push('PASS edge cases: October 1 store daily row, superseded snapshot, daily inside and after a snapshot, wrong-track closing and KPI rows, missing identifiers');
}

const byTab = audit.slice(1).reduce<Record<string, number>>((counts, row) => ({ ...counts, [row[0]]: (counts[row[0]] ?? 0) + 1 }), {});
report.push(`PASS ${AUDIT_TAB} lists ${listed.length} records: ${Object.entries(byTab).map(([tab, count]) => `${tab} ${count}`).join(', ') || 'none'}`);
if (installed.created.length) report.push(`Created tabs: ${installed.created.join(', ')}`);
console.log(report.join('\n'));
console.log(`${PRODUCTION ? 'Command center' : 'Scratch spreadsheet'}: https://docs.google.com/spreadsheets/d/${target}`);
