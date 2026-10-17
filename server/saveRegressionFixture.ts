/**
 * Saves the verified October workbook used by server/regression.test.ts. Reads a snapshot (auditMetrics --save) and
 * keeps the tabs the calculations read, with dates as {"$date": "YYYY-MM-DD"}. The tests only ever run on this copy.
 *
 *   node --experimental-strip-types server/saveRegressionFixture.ts --snapshot in.json [--out server/fixtures/october-verified.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { appsScriptGrid, type Workbook } from './snapshotGrid.ts';

// Formula views of CC_Ledger (SNAP_STORE, FABW_PERSON, ...) are not read by the app; documents and scratch tabs are unrelated.
const SKIP = /^(?:[A-Z_]+_(?:STORE|PERSON)|CC_Document.*|Sheet1|CC_Connection_Test)$/;

const args = process.argv.slice(2);
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const snapshotPath = option('--snapshot');
if (!snapshotPath) throw new Error('--snapshot is required (save one with auditMetrics --save).');
const out = option('--out') ?? new URL('./fixtures/october-verified.json', import.meta.url).pathname;
const book: Workbook = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const names = Object.keys(book).filter((name) => !SKIP.test(name)).sort();
const cell = (value: unknown) => (value instanceof Date ? { $date: value.toISOString().slice(0, 10) } : value);
// One row per line, so a refreshed fixture diffs row by row.
const text = '{\n' + names.map((name) => {
  const rows = appsScriptGrid(book[name]!).map((row) => ' ' + JSON.stringify(row.map(cell)));
  return JSON.stringify(name) + ': [\n' + rows.join(',\n') + '\n]';
}).join(',\n') + '\n}\n';
writeFileSync(out, text);
console.log(`Saved ${names.length} tabs to ${out}: ${names.join(', ')}`);
