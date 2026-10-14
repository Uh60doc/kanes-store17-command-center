/** Load the verified October baseline into the existing command-center workbook. */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { applyRecords, makeRecord, type LedgerRecord } from '../src/domain/kpiLedger.ts';
import { recordsFromKpi, recordsFromMaintenance } from './kpiLedgerBuild.ts';
import { parseKpiWorkbook } from './kpiWorkbook.ts';
import { parseMppa, parseRugs, parseUvwl } from './maintenanceText.ts';

const PULLED_THROUGH = '2026-10-13';
const VIEWS = [
  'SNAP_STORE', 'SNAP_PERSON',
  'NWDSR_WRITTEN_STORE', 'NWDSR_WRITTEN_PERSON',
  'NWDSR_DELIVERED_STORE', 'NWDSR_DELIVERED_PERSON',
  'PERQ_STORE', 'PERQ_PERSON',
  'BEDDING_STORE', 'BEDDING_PERSON',
  'MPPA_STORE', 'MPPA_PERSON',
  'BASES_STORE', 'BASES_PERSON',
  'PILLOWS_STORE', 'PILLOWS_PERSON',
  'FABW_STORE', 'FABW_PERSON',
  'LTHW_STORE', 'LTHW_PERSON',
  'PWAR_STORE', 'PWAR_PERSON',
  'UVWL_STORE', 'UVWL_PERSON',
  'FINANCE_STORE', 'FINANCE_PERSON',
  'RUGS_STORE', 'RUGS_PERSON',
];
const HEADERS = [
  'view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store',
  'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible',
  'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key',
];

function cell(value: string | number | null): string | number {
  return value === null ? '' : value;
}

function rowValues(record: LedgerRecord, importedAt: string): (string | number)[] {
  return [
    record.view, record.grain, record.reportDate, record.periodStart, record.periodEnd, record.verifiedThrough,
    record.store, record.employeeCode, record.employeeName, record.side,
    cell(record.salesDollars), cell(record.unitCount), cell(record.eligible), cell(record.attachments),
    cell(record.kpiPercent), record.sourceReport, importedAt, record.recordKey,
  ];
}

function dailyMoney(view: string, side: 'written' | 'delivered', date: string, dollars: number, source: string): LedgerRecord {
  return makeRecord({
    view, grain: 'daily', reportDate: date, periodStart: date, periodEnd: date, verifiedThrough: date,
    store: '17', employeeCode: '', employeeName: '', side, salesDollars: dollars, unitCount: null,
    eligible: null, attachments: null, sourceReport: source,
  });
}

function readEnv(name: string): string {
  const file = path.join(process.cwd(), '.env.local');
  const line = readFileSync(file, 'utf8').split('\n').find((entry) => entry.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : '';
}

async function accessToken(): Promise<string> {
  const stored = JSON.parse(readFileSync(path.join(homedir(), '.config/store17-command-center/google-oauth.json'), 'utf8')) as { refreshToken: string; spreadsheetId: string };
  const body = new URLSearchParams({
    client_id: readEnv('GOOGLE_CLIENT_ID'),
    client_secret: readEnv('GOOGLE_CLIENT_SECRET'),
    refresh_token: stored.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  if (!response.ok) throw new Error('Google did not refresh the spreadsheet sign-in.');
  const parsed = await response.json() as { access_token?: string };
  if (!parsed.access_token) throw new Error('Google did not refresh the spreadsheet sign-in.');
  return parsed.access_token;
}

async function sheets(token: string, url: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sheets request failed (${response.status}).`);
  return text ? JSON.parse(text) : {};
}

function pdfText(file: string): string {
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

function collectFiles(): LedgerRecord[] {
  const root = '/tmp/kpi-oct2026/ORIGINAL_REPORTS';
  const records: LedgerRecord[] = [];
  readdirSync(root).filter((name) => name.endsWith('.xlsx')).forEach((name) => {
    const report = parseKpiWorkbook(readFileSync(path.join(root, name)), name);
    records.push(...recordsFromKpi(report, PULLED_THROUGH));
  });
  const reports = path.join(homedir(), '.config/store17-command-center/reports/starter/month_to_date_snapshots/2026-10-02_to_2026-10-11');
  const mppaFile = path.join(reports, 'MPPA_WRITTEN__10.pdf');
  const uvwlFile = path.join(reports, 'UVWL_WRITTEN__17.pdf');
  const rugsFile = path.join(reports, 'RUGS_WRITTEN__0.pdf');
  const mppa = parseMppa(pdfText(mppaFile));
  const uvwl = parseUvwl(pdfText(uvwlFile));
  const rugs = parseRugs(pdfText(rugsFile));
  if (!mppa) throw new Error(`Could not read ${mppaFile}`);
  if (!uvwl) throw new Error(`Could not read ${uvwlFile}`);
  if (!rugs) throw new Error(`Could not read ${rugsFile}`);
  records.push(...recordsFromMaintenance(mppa, 'MPPA_WRITTEN__10.pdf'));
  records.push(...recordsFromMaintenance(uvwl, 'UVWL_WRITTEN__17.pdf'));
  records.push(...recordsFromMaintenance(rugs, 'RUGS_WRITTEN__0.pdf'));
  const perq = JSON.parse(readFileSync(path.join(homedir(), '.config/store17-command-center/reference/perq-october-2026.json'), 'utf8')) as {
    snapshots: { id: string; periodStart: string; periodEnd: string; opportunities: number; lines: { sourceName: string; opportunities: number }[] }[];
  };
  perq.snapshots.forEach((snapshot) => {
    const through = snapshot.periodEnd > PULLED_THROUGH ? PULLED_THROUGH : snapshot.periodEnd;
    records.push(makeRecord({
      view: 'PERQ_STORE', grain: 'cumulative', reportDate: '', periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd,
      verifiedThrough: through, store: '17', employeeCode: '', employeeName: '', side: '', salesDollars: null, unitCount: null,
      eligible: snapshot.opportunities, attachments: null, sourceReport: snapshot.id,
    }));
    snapshot.lines.forEach((line) => {
      records.push(makeRecord({
        view: 'PERQ_PERSON', grain: 'cumulative', reportDate: '', periodStart: snapshot.periodStart, periodEnd: snapshot.periodEnd,
        verifiedThrough: through, store: '17', employeeCode: '', employeeName: line.sourceName, side: '', salesDollars: null,
        unitCount: null, eligible: line.opportunities, attachments: null, sourceReport: snapshot.id,
      }));
    });
  });
  return records;
}

async function main(): Promise<void> {
  const token = await accessToken();
  const spreadsheetId = '1KtsfQPQRdg3IdNXomlM5t47IyE1psouxvgW-D8VSLfw';
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const meta = await sheets(token, `${base}?fields=sheets.properties.title`) as { sheets: { properties: { title: string } }[] };
  const titles = new Set(meta.sheets.map((sheet) => sheet.properties.title));
  const protectedTabs = ['Sheet1', 'CC_Connection_Test', 'CC_Daily', 'CC_AssociateDays'];
  protectedTabs.forEach((title) => {
    if (!titles.has(title)) throw new Error(`${title} is missing. Nothing was written.`);
  });
  const daily = await sheets(token, `${base}/values/${encodeURIComponent('CC_Daily!A1:D40')}`) as { values?: string[][] };
  const people = await sheets(token, `${base}/values/${encodeURIComponent('CC_AssociateDays!A1:F80')}`) as { values?: string[][] };
  const closing = await sheets(token, `${base}/values/${encodeURIComponent('CC_Closing!A1:K20')}`) as { values?: string[][] };
  const records = collectFiles();
  (daily.values ?? []).slice(1).forEach((row) => {
    const date = String(row[0] ?? '');
    if (!date) return;
    const snap = row[1] === '' || row[1] === undefined ? null : Number(row[1]);
    const written = row[2] === '' || row[2] === undefined ? null : Number(row[2]);
    const delivered = row[3] === '' || row[3] === undefined ? null : Number(row[3]);
    if (snap !== null) records.push(dailyMoney('SNAP_STORE', 'written', date, snap, 'CC_Daily'));
    if (written !== null) records.push(dailyMoney('NWDSR_WRITTEN_STORE', 'written', date, written, 'CC_Daily'));
    if (delivered !== null) records.push(dailyMoney('NWDSR_DELIVERED_STORE', 'delivered', date, delivered, 'CC_Daily'));
  });
  (people.values ?? []).slice(1).forEach((row) => {
    const date = String(row[0] ?? '');
    const name = String(row[2] ?? '');
    if (!date || !name || row[4] === '' || row[4] === undefined) return;
    records.push(makeRecord({
      view: 'SNAP_PERSON', grain: 'daily', reportDate: date, periodStart: date, periodEnd: date, verifiedThrough: date,
      store: '17', employeeCode: '', employeeName: name, side: 'written', salesDollars: Number(row[4]), unitCount: null,
      eligible: null, attachments: null, sourceReport: 'CC_AssociateDays',
    }));
  });
  (closing.values ?? []).slice(1).forEach((row) => {
    if (String(row[1] ?? '') !== 'person') return;
    const opportunities = row[5] === '' || row[5] === undefined ? null : Number(row[5]);
    if (opportunities === null) return;
    records.push(makeRecord({
      view: 'PERQ_PERSON', grain: 'cumulative', reportDate: '', periodStart: String(row[6] ?? ''), periodEnd: String(row[7] ?? ''),
      verifiedThrough: PULLED_THROUGH, store: '17', employeeCode: String(row[2] ?? ''), employeeName: String(row[3] ?? ''),
      side: '', salesDollars: null, unitCount: null, eligible: opportunities, attachments: null, sourceReport: 'CC_Closing',
    }));
  });
  const merged = applyRecords([], records);
  const importedAt = new Date().toISOString();
  const values = [HEADERS, ...merged.map((record) => rowValues(record, importedAt))];
  const requests: Record<string, unknown>[] = [];
  if (!titles.has('CC_Ledger')) requests.push({ addSheet: { properties: { title: 'CC_Ledger' } } });
  VIEWS.forEach((view) => {
    if (!titles.has(view)) requests.push({ addSheet: { properties: { title: view } } });
  });
  if (requests.length) await sheets(token, `${base}:batchUpdate`, 'POST', { requests });
  await sheets(token, `${base}/values/${encodeURIComponent('CC_Ledger!A1')}:clear`, 'POST', {});
  await sheets(token, `${base}/values/${encodeURIComponent('CC_Ledger!A1')}?valueInputOption=RAW`, 'PUT', { values });
  for (const view of VIEWS) {
    const formula = `=QUERY(CC_Ledger!A:R,"select * where A='${view}'",1)`;
    await sheets(token, `${base}/values/${encodeURIComponent(`${view}!A1`)}?valueInputOption=USER_ENTERED`, 'PUT', { values: [[formula]] });
  }
  const counts = new Map<string, number>();
  merged.forEach((record) => counts.set(record.view, (counts.get(record.view) ?? 0) + 1));
  console.log(`CC_Ledger rows ${merged.length}`);
  [...counts.entries()].sort().forEach(([view, count]) => console.log(`${view} ${count}`));
  const mppa = merged.find((record) => record.view === 'MPPA_STORE' && record.sourceReport === 'MPPA_WRITTEN__10.pdf');
  console.log(`MPPA written through ${mppa?.verifiedThrough}: mattress ${mppa?.eligible}, protectors ${mppa?.attachments}, rate ${mppa?.kpiPercent}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'The ledger load failed.');
  process.exit(1);
});
