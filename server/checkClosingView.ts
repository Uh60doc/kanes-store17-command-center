/**
 * Check the closing-view formulas on a scratch spreadsheet. Most scenarios start from CC_Closing as it stood on
 * October 14 (fixtures/closing-rows-2026-10-14.json), so they do not move as reports arrive; one scenario uses a copy
 * of the live rows. The production spreadsheet is only read.
 *
 *   node --experimental-strip-types server/checkClosingView.ts
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SHEETS_SCOPE } from './access.ts';
import { DAILY_TAB, MTD_TAB, installClosingView } from './closingView.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { readStored } from './tokenStore.ts';

type Cell = string | number | boolean;
const AS_OF = '2026-10-16';
const SCRATCH = path.join(homedir(), '.config/store17-command-center/closing-view-check.json');
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

loadDotEnv(process.cwd());
const config = loadConfig(process.cwd());
const production = readStored(config.tokenPath).spreadsheetId;
if (!production) throw new Error('The command center spreadsheet is not saved.');
const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });

async function values(spreadsheetId: string, range: string, render: 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE'): Promise<Cell[][]> {
  const payload = await googleJson({ accessToken: token, url: `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=${render}` }) as { values?: Cell[][] };
  return payload.values ?? [];
}

async function scratchId(): Promise<string> {
  if (existsSync(SCRATCH)) {
    const saved = JSON.parse(readFileSync(SCRATCH, 'utf8')) as { spreadsheetId: string };
    return saved.spreadsheetId;
  }
  const created = await googleJson({
    accessToken: token,
    method: 'POST',
    url: SHEETS,
    body: {
      properties: { title: 'Store 17 closing view check (scratch copy)', timeZone: 'America/New_York', locale: 'en_US' },
      sheets: ['CC_Closing', 'CC_Config', 'CC_SellingDays'].map((title) => ({ properties: { title } })),
    },
  }) as { spreadsheetId: string };
  writeFileSync(SCRATCH, JSON.stringify({ spreadsheetId: created.spreadsheetId }, null, 2));
  return created.spreadsheetId;
}

const scratch = await scratchId();
const liveClosing = await values(production, 'CC_Closing!A1:L', 'UNFORMATTED_VALUE');
const liveConfig = await values(production, 'CC_Config!A1:B', 'UNFORMATTED_VALUE');
const liveSelling = await values(production, 'CC_SellingDays!A1:B', 'UNFORMATTED_VALUE');
await installClosingView({ accessToken: token, spreadsheetId: scratch, asOf: AS_OF });

async function load(closing: Cell[][], selling: Cell[][] = liveSelling): Promise<void> {
  await googleJson({ accessToken: token, method: 'POST', url: `${SHEETS}/${scratch}/values:batchClear`, body: { ranges: ['CC_Closing!A:Z', 'CC_Config!A:Z', 'CC_SellingDays!A:Z'] } });
  await googleJson({
    accessToken: token,
    method: 'POST',
    url: `${SHEETS}/${scratch}/values:batchUpdate`,
    body: { valueInputOption: 'RAW', data: [{ range: 'CC_Closing!A1', values: closing }, { range: 'CC_Config!A1', values: liveConfig }, { range: 'CC_SellingDays!A1', values: selling }] },
  });
}

interface View {
  day(date: string): Record<string, Cell>;
  mtd: Record<string, Cell>;
  dates: string[];
  grids: { daily: Cell[][]; mtd: Cell[][] };
}

const CAPTURE = process.argv.includes('--capture') ? process.argv[process.argv.indexOf('--capture') + 1] : '';
const isoFromSerial = (serial: number) => new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);

async function view(): Promise<View> {
  const shown = await values(scratch, `${DAILY_TAB}!A1:P`, 'FORMATTED_VALUE');
  const raw = await values(scratch, `${DAILY_TAB}!A1:P`, 'UNFORMATTED_VALUE');
  const header = shown[0].map(String);
  const rows = new Map<string, Record<string, Cell>>();
  shown.slice(1).forEach((row, index) => {
    const record: Record<string, Cell> = {};
    header.forEach((name, column) => {
      const value = raw[index + 1]?.[column];
      record[name] = typeof value === 'number' && column !== 0 ? value : row[column];
    });
    rows.set(String(row[0]), record);
  });
  const errors = shown.flat().filter((cell) => /^#(N\/A|REF|VALUE|ERROR|NAME|DIV\/0)/.test(String(cell)));
  assert.deepEqual(errors, [], `${DAILY_TAB} shows formula errors`);
  const mtdShown = await values(scratch, `${MTD_TAB}!A1:B`, 'FORMATTED_VALUE');
  const mtdRaw = await values(scratch, `${MTD_TAB}!A1:B`, 'UNFORMATTED_VALUE');
  const mtd: Record<string, Cell> = {};
  mtdShown.slice(1).forEach((row, index) => {
    const value = mtdRaw[index + 1]?.[1];
    mtd[String(row[0])] = typeof value === 'number' && !/date|through|Period/.test(String(row[0])) ? value : row[1];
  });
  return {
    day(date) {
      const row = rows.get(date);
      assert.ok(row, `${DAILY_TAB} has no row for ${date}`);
      return row;
    },
    mtd,
    dates: [...rows.keys()],
    grids: {
      daily: raw.map((row, index) => (index > 0 && typeof row[0] === 'number' ? [isoFromSerial(row[0]), ...row.slice(1)] : row)),
      mtd: mtdRaw.map((row) => (/date|through|Period/.test(String(row[0])) && typeof row[1] === 'number' ? [row[0], isoFromSerial(row[1])] : row)),
    },
  };
}

const pinned = JSON.parse(readFileSync(new URL('./fixtures/closing-rows-2026-10-14.json', import.meta.url), 'utf8')) as { rows: Cell[][] };
const header = pinned.rows[0];
const base = pinned.rows.slice(1);
assert.deepEqual(liveClosing[0].slice(0, header.length), header, 'CC_Closing headers changed');
const netWritten = (date: string, customers: Cell, start = date, end = date, through = end): Cell[] => [date, 'store', '', '', customers, '', start, end, 'NWDSR Net Written # OF CUST', 'yes', 'check', through];
const perq = (date: string, opportunities: Cell, start = date, end = date, through = end, final = 'yes'): Cell[] => [date, 'store', '', '', '', opportunities, start, end, 'PERQ Ups + Be Backs', final, 'check', through];
const results: string[] = [];
const near = (actual: Cell, expected: number) => assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);

const captured: Record<string, View['grids']> = {};

async function scenario(name: string, closing: Cell[][], check: (result: View) => void, selling?: Cell[][]): Promise<void> {
  await load([header, ...closing], selling);
  const result = await view();
  check(result);
  captured[name] = result.grids;
  results.push(`PASS ${name}`);
}

await scenario('live CC_Closing rows: October 14 daily and October 2-14 month to date', base, (result) => {
  assert.equal(result.dates[0], '2026-10-02');
  assert.equal(result.dates.at(-1), '2026-10-15');
  const oct14 = result.day('2026-10-14');
  assert.equal(oct14['NWDSR Written purchasing customers'], 2);
  assert.equal(oct14['PERQ opportunities'], 4);
  near(oct14['Closing ratio'], 0.5);
  near(oct14['Store closing goal'], 0.5);
  near(oct14['Difference from goal (pts)'], 0);
  assert.equal(oct14['Versus goal'], 'On Target');
  assert.equal(oct14['Source reporting dates'], 'NWDSR Written 2026-10-14 · PERQ 2026-10-14');
  assert.equal(oct14['Verification status'], 'Verified');
  assert.equal(oct14['MTD purchasing customers'], 52);
  assert.equal(oct14['MTD opportunities'], 104);
  near(oct14['MTD closing ratio'], 0.5);
  assert.equal(oct14['MTD versus goal'], 'On Target');
  assert.equal(oct14['MTD sources'], 'NWDSR Written report 2026-10-02 to 2026-10-14 (52) · PERQ snapshot 2026-10-02 to 2026-10-13 (100) + daily 2026-10-14 to 2026-10-14 (4)');
  assert.equal(oct14['MTD verification status'], 'Provisional: PERQ cutoff unconfirmed');
  const oct13 = result.day('2026-10-13');
  assert.equal(oct13['PERQ opportunities'], 'Pending');
  assert.equal(oct13['Closing ratio'], 'Pending');
  assert.equal(oct13['Verification status'], 'Pending: PERQ');
  assert.equal(oct13['MTD purchasing customers'], 50);
  assert.equal(oct13['MTD opportunities'], 100);
  assert.equal(result.day('2026-10-12')['MTD opportunities'], 'Pending');
  assert.equal(result.day('2026-10-12')['MTD verification status'], 'Pending: PERQ');
  assert.equal(result.day('2026-10-02')['NWDSR Written purchasing customers'], 2);
  const oct15 = result.day('2026-10-15');
  assert.equal(oct15['NWDSR Written purchasing customers'], 'Pending');
  assert.equal(oct15['PERQ opportunities'], 'Pending');
  assert.equal(oct15['Verification status'], 'Pending: NWDSR Written and PERQ');
  assert.equal(oct15['Source reporting dates'], 'NWDSR Written not received · PERQ not received');
  assert.equal(result.mtd['Period start'], '2026-10-02');
  assert.equal(result.mtd['Period end'], '2026-11-01');
  assert.equal(result.mtd['MTD through'], '2026-10-14');
  assert.equal(result.mtd['Purchasing customers'], 52);
  assert.equal(result.mtd['Opportunities'], 104);
  near(result.mtd['Closing ratio'], 0.5);
  near(result.mtd['Store closing goal'], 0.5);
  near(result.mtd['Difference from goal (pts)'], 0);
  assert.equal(result.mtd['Versus goal'], 'On Target');
  assert.equal(result.mtd['Verification status'], 'Provisional: PERQ cutoff unconfirmed');
  assert.equal(result.mtd['Latest daily date'], '2026-10-14');
  assert.equal(result.mtd['Latest daily purchasing customers'], 2);
  assert.equal(result.mtd['Latest daily opportunities'], 4);
  near(result.mtd['Latest daily closing ratio'], 0.5);
  assert.equal(result.mtd['Individual closing ratio'], 'See the dashboard Closing page');
});

await scenario('tomorrow: October 15 Net Written 2 and PERQ 7 arrive', [...base, netWritten('2026-10-15', 2), perq('2026-10-15', 7)], (result) => {
  const oct15 = result.day('2026-10-15');
  near(oct15['Closing ratio'], 2 / 7);
  near(oct15['Difference from goal (pts)'], -21.4);
  assert.equal(oct15['Versus goal'], 'Below Goal');
  assert.equal(oct15['MTD purchasing customers'], 54);
  assert.equal(oct15['MTD opportunities'], 111);
  near(oct15['MTD difference from goal (pts)'], -1.4);
  assert.equal(oct15['MTD versus goal'], 'Below Goal');
  assert.equal(oct15['MTD sources'], 'NWDSR Written daily reports 2026-10-02 to 2026-10-15 (54) · PERQ snapshot 2026-10-02 to 2026-10-13 (100) + daily 2026-10-14 to 2026-10-15 (11)');
  assert.equal(result.mtd['MTD through'], '2026-10-15');
  assert.equal(result.mtd['Latest daily date'], '2026-10-15');
  assert.equal(result.day('2026-10-14')['MTD opportunities'], 104);
});

await scenario('two October 15 PERQ reports that disagree are Reconcile, not added', [...base, netWritten('2026-10-15', 2), perq('2026-10-15', 7), perq('2026-10-15', 8)], (result) => {
  const oct15 = result.day('2026-10-15');
  assert.equal(oct15['PERQ opportunities'], 'Reconcile');
  assert.equal(oct15['Verification status'], 'Reconcile: reports disagree');
  assert.equal(oct15['MTD opportunities'], 'Pending');
  assert.equal(result.mtd['MTD through'], '2026-10-14');
});

await scenario('the same October 15 report on file twice counts once', [...base, netWritten('2026-10-15', 2), netWritten('2026-10-15', 2), perq('2026-10-15', 7), perq('2026-10-15', 7)], (result) => {
  assert.equal(result.day('2026-10-15')['NWDSR Written purchasing customers'], 2);
  assert.equal(result.day('2026-10-15')['MTD opportunities'], 111);
});

await scenario('blank figures on completed October 15 reports are zero', [...base, netWritten('2026-10-15', ''), perq('2026-10-15', '')], (result) => {
  const oct15 = result.day('2026-10-15');
  assert.equal(oct15['NWDSR Written purchasing customers'], 0);
  assert.equal(oct15['PERQ opportunities'], 0);
  assert.equal(oct15['Closing ratio'], 'No opportunities');
  assert.equal(oct15['Verification status'], 'Verified: no opportunities');
  assert.equal(oct15['MTD purchasing customers'], 52);
  assert.equal(oct15['MTD opportunities'], 104);
  assert.equal(result.mtd['MTD through'], '2026-10-15');
  assert.equal(result.mtd['Latest daily date'], '2026-10-14');
});

await scenario('a cumulative customer count is used for its own date and never added to daily counts', [...base, netWritten('2026-10-11', 40, '2026-10-02', '2026-10-11')], (result) => {
  assert.equal(result.day('2026-10-11')['MTD purchasing customers'], 40);
  assert.equal(result.day('2026-10-12')['MTD purchasing customers'], 46);
  assert.equal(result.day('2026-10-13')['MTD purchasing customers'], 50);
  assert.equal(result.day('2026-10-14')['MTD purchasing customers'], 52);
});

await scenario('the October 1 PERQ snapshot of 104 and salesperson rows are not used for the store month', [...base, perq('2026-10-13', 104, '2026-10-01', '2026-10-31', '2026-10-13')], (result) => {
  assert.equal(result.day('2026-10-14')['MTD opportunities'], 104);
  assert.match(String(result.day('2026-10-14')['MTD sources']), /PERQ snapshot 2026-10-02 to 2026-10-13 \(100\)/);
});

await scenario('a PERQ snapshot whose period ends on its verified date is not provisional', [...base, perq('2026-10-14', 104, '2026-10-02', '2026-10-14')], (result) => {
  assert.equal(result.day('2026-10-14')['MTD opportunities'], 104);
  assert.equal(result.day('2026-10-14')['MTD sources'], 'NWDSR Written report 2026-10-02 to 2026-10-14 (52) · PERQ snapshot 2026-10-02 to 2026-10-14 (104)');
  assert.equal(result.day('2026-10-14')['MTD verification status'], 'Verified');
});

await scenario('a snapshot of the same count that ends on its verified date confirms the cutoff', [...base, perq('2026-10-13', 100, '2026-10-02', '2026-10-13')], (result) => {
  assert.equal(result.day('2026-10-13')['MTD opportunities'], 100);
  assert.equal(result.day('2026-10-13')['MTD verification status'], 'Verified');
  assert.equal(result.day('2026-10-14')['MTD verification status'], 'Verified');
  assert.equal(result.mtd['Verification status'], 'Verified');
});

await scenario('live CC_Closing rows after the October 15 and PERQ history imports', liveClosing.slice(1), (result) => {
  assert.equal(result.dates.at(-1), '2026-10-15');
  const oct15 = result.day('2026-10-15');
  assert.equal(oct15['NWDSR Written purchasing customers'], 2);
  assert.equal(oct15['PERQ opportunities'], 7);
  near(oct15['Closing ratio'], 2 / 7);
  assert.equal(oct15['Verification status'], 'Verified');
  assert.equal(oct15['MTD purchasing customers'], 54);
  assert.equal(oct15['MTD opportunities'], 111);
  near(oct15['MTD closing ratio'], 54 / 111);
  near(oct15['MTD difference from goal (pts)'], -1.4);
  assert.equal(oct15['MTD versus goal'], 'Below Goal');
  assert.equal(oct15['MTD verification status'], 'Verified');
  assert.equal(result.day('2026-10-12')['PERQ opportunities'], 9);
  assert.equal(result.day('2026-10-13')['PERQ opportunities'], 4);
  assert.equal(result.day('2026-10-11')['MTD opportunities'], 87);
  assert.equal(result.day('2026-10-12')['MTD opportunities'], 96);
  assert.equal(result.day('2026-10-13')['MTD opportunities'], 100);
  for (const date of ['2026-10-02', '2026-10-06', '2026-10-11']) assert.equal(result.day(date)['PERQ opportunities'], 'Pending');
  assert.equal(result.day('2026-10-10')['MTD opportunities'], 'Pending');
  assert.equal(result.mtd['MTD through'], '2026-10-15');
  assert.equal(result.mtd['Opportunities'], 111);
  assert.equal(result.mtd['Verification status'], 'Verified');
});

await scenario('a report that is not final is ignored', [...base, perq('2026-10-15', 9, '2026-10-15', '2026-10-15', '2026-10-15', 'no')], (result) => {
  assert.equal(result.day('2026-10-15')['PERQ opportunities'], 'Pending');
});

await scenario('a closed day is Closed and skipped in month to date', base, (result) => {
  const oct15 = result.day('2026-10-15');
  assert.equal(oct15['Verification status'], 'Closed');
  assert.equal(oct15['MTD purchasing customers'], 52);
  assert.equal(oct15['MTD opportunities'], 104);
  assert.equal(result.mtd['MTD through'], '2026-10-15');
}, [['date', 'selling'], ['2026-10-15', 'NO']]);

await load([header, ...base]);
if (CAPTURE) {
  writeFileSync(CAPTURE, `${JSON.stringify({ asOf: AS_OF, scenarios: captured }, null, 1)}\n`);
  results.push(`Saved the calculated tabs for each scenario to ${CAPTURE}`);
}
console.log(results.join('\n'));
console.log(`Scratch spreadsheet: https://docs.google.com/spreadsheets/d/${scratch}`);
