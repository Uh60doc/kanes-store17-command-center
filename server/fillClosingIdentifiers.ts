/**
 * Complete the identifiers on CC_Closing rows: store 17 on every row, and the verified-through date on a single-day
 * row, which is that day. Only blank cells are written. Counts, dates, sources and notes are never changed.
 *
 *   node --experimental-strip-types server/fillClosingIdentifiers.ts [--dry]
 */

import { SHEETS_SCOPE } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { readStored } from './tokenStore.ts';

type Cell = string | number;

const isoFromSerial = (serial: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10);
const isoOf = (value: Cell | undefined): string => (typeof value === 'number' ? isoFromSerial(value) : /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '');

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  loadDotEnv(process.cwd());
  const config = loadConfig(process.cwd());
  const spreadsheetId = readStored(config.tokenPath).spreadsheetId;
  if (!spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
  const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const payload = await googleJson({ accessToken: token, url: `${base}/values/${encodeURIComponent('CC_Closing!A1:M1000')}?valueRenderOption=UNFORMATTED_VALUE` }) as { values?: Cell[][] };
  const rows = payload.values ?? [];
  const header = (rows[0] ?? []).map(String);
  if (header[0] !== 'date' || header[6] !== 'period_start' || header[7] !== 'period_end' || header[8] !== 'source' || header[11] !== 'verified_through') {
    throw new Error('CC_Closing headers are not the expected layout. Nothing was written.');
  }
  if (header[12] && header[12] !== 'store') throw new Error(`CC_Closing column M is ${header[12]}, not store. Nothing was written.`);

  const updates: { range: string; values: Cell[][] }[] = [];
  if (!header[12]) updates.push({ range: 'CC_Closing!M1', values: [['store']] });
  rows.slice(1).forEach((row, index) => {
    const at = index + 2;
    if (!String(row[1] ?? '').trim()) return;
    const start = isoOf(row[6]);
    const end = isoOf(row[7]);
    if (String(row[11] ?? '').trim() === '' && start && start === end) updates.push({ range: `CC_Closing!L${at}`, values: [[start]] });
    if (String(row[12] ?? '').trim() === '') updates.push({ range: `CC_Closing!M${at}`, values: [['17']] });
  });
  if (!dry && updates.length) await googleJson({ accessToken: token, method: 'POST', url: `${base}/values:batchUpdate`, body: { valueInputOption: 'RAW', data: updates } });
  console.log(JSON.stringify({ dry, updated: updates.map((item) => `${item.range}=${item.values[0][0]}`) }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The identifier fill failed.');
  process.exit(1);
});
