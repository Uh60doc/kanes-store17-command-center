/**
 * Save the verified October closing counts to CC_Closing. Safe to run again: a row already on file is left alone.
 *
 *   node --experimental-strip-types server/loadOctoberClosing.ts [--dry]
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { SHEETS_SCOPE } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { readStored } from './tokenStore.ts';
import { parseReportText } from '../src/cloud/reportText.ts';

type Cell = string | number;

const DAILY_ROOT = path.join(homedir(), '.config/store17-command-center/reports/starter/daily_single_date');
const NET_WRITTEN = 'NWDSR Net Written # OF CUST';
const PERQ = 'PERQ Ups + Be Backs';
// The PERQ package was saved at 2026-10-14T00:22Z (October 13, 8:22 PM Eastern), so neither snapshot can include October 14.
const PERQ_CUTOFF = '2026-10-13';
const PERQ_CUTOFF_NOTE = 'PERQ screenshots saved October 13 at 8:22 PM Eastern, so this snapshot ends no later than October 13 and does not include October 14.';

function key(row: Cell[]): string {
  return [row[1], row[2], row[6], row[7], row[8]].map((value) => String(value ?? '')).join('|');
}

function dailyCustomerRows(): Cell[][] {
  const rows: Cell[][] = [];
  readdirSync(DAILY_ROOT).sort().forEach((day) => {
    readdirSync(path.join(DAILY_ROOT, day)).filter((name) => name.startsWith('NWDSR_WRITTEN')).forEach((name) => {
      const file = path.join(DAILY_ROOT, day, name);
      const report = parseReportText(execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }));
      if (!report || report.reportType !== 'NWDSR Written' || !report.singleDay || report.purchasingCustomers === null) {
        throw new Error(`${name} did not give a single-day Net Written # OF CUST.`);
      }
      const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
      rows.push([report.start, 'store', '', '', report.purchasingCustomers, '', report.start, report.start, NET_WRITTEN, 'yes', `Net Written # OF CUST for the report date. ${name} sha256 ${sha.slice(0, 12)}.`, report.start, '17']);
    });
  });
  return rows;
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  loadDotEnv(process.cwd());
  const config = loadConfig(process.cwd());
  const spreadsheetId = readStored(config.tokenPath).spreadsheetId;
  if (!spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
  const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const payload = await googleJson({ accessToken: token, url: `${base}/values/${encodeURIComponent('CC_Closing!A1:L500')}` }) as { values?: Cell[][] };
  const current = payload.values ?? [];
  if (String(current[0]?.[0] ?? '') !== 'date' || String(current[0]?.[8] ?? '') !== 'source') throw new Error('CC_Closing headers are not the expected layout. Nothing was written.');

  const updates: { range: string; values: Cell[][] }[] = [];
  if (String(current[0]?.[11] ?? '') !== 'verified_through') updates.push({ range: 'CC_Closing!L1', values: [['verified_through']] });
  const rowByKey = new Map<string, number>();
  current.forEach((row, index) => { if (index > 0) rowByKey.set(key(row), index + 1); });

  const wanted: Cell[][] = [
    ...dailyCustomerRows(),
    ['2026-10-14', 'store', '', '', 52, '', '2026-10-02', '2026-10-14', NET_WRITTEN, 'yes', 'NET WRITTEN store report for October 2 through October 14: 52 purchasing customers, written sales $108,583. The daily # OF CUST for October 2 through October 14 also adds to 52.', '2026-10-14', '17'],
    [PERQ_CUTOFF, 'store', '', '', '', 100, '2026-10-02', '2026-10-31', PERQ, 'yes', `Store 17 South Orlando location Ups + Be Backs, filter October 2 through October 31. ${PERQ_CUTOFF_NOTE} The October 1 snapshot of 104 is a different period and is not used for the store month.`, PERQ_CUTOFF, '17'],
  ];
  const appends: Cell[][] = [];
  const skipped: string[] = [];
  wanted.forEach((row) => {
    const at = rowByKey.get(key(row));
    if (!at) {
      appends.push(row);
      return;
    }
    const existing = current[at - 1] ?? [];
    const same = String(existing[4] ?? '') === String(row[4]) && String(existing[5] ?? '') === String(row[5]);
    if (!same) throw new Error(`CC_Closing row ${at} has different counts for ${key(row)}. Nothing was written.`);
    if (String(existing[11] ?? '') !== String(row[11])) updates.push({ range: `CC_Closing!L${at}`, values: [[row[11] ?? '']] });
    skipped.push(`${key(row)} already on file (row ${at})`);
  });

  current.forEach((row, index) => {
    if (index === 0 || row[1] !== 'person' || row[6] !== '2026-10-01' || row[7] !== '2026-10-31' || row[8] !== PERQ) return;
    const note = `PERQ Ups + Be Backs by salesperson, filter October 1 through October 31. ${PERQ_CUTOFF_NOTE}`;
    if (row[0] === PERQ_CUTOFF && row[9] === 'yes' && row[10] === note && row[11] === PERQ_CUTOFF) return;
    // A row with a blank date is skipped when the command center reads the tab.
    updates.push({ range: `CC_Closing!A${index + 1}`, values: [[PERQ_CUTOFF]] });
    updates.push({ range: `CC_Closing!J${index + 1}:L${index + 1}`, values: [['yes', note, PERQ_CUTOFF]] });
  });

  if (!dry) {
    if (updates.length) await googleJson({ accessToken: token, method: 'POST', url: `${base}/values:batchUpdate`, body: { valueInputOption: 'RAW', data: updates } });
    if (appends.length) await googleJson({ accessToken: token, method: 'POST', url: `${base}/values/${encodeURIComponent('CC_Closing!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, body: { values: appends } });
  }
  console.log(JSON.stringify({ dry, appended: appends.map((row) => `${row[6]}..${row[7]} ${row[1]} ${row[8]} customers=${row[4]} opportunities=${row[5]}`), updated: updates.map((item) => item.range), skipped }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The closing load failed.');
  process.exit(1);
});
