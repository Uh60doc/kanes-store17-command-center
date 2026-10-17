/**
 * Import one day's SNAP Written, NWDSR Net Written, and NWDSR Delivered PDFs into the command center.
 * Safe to run again: a figure already on file is left alone. A later report that disagrees with a recorded
 * day is logged to CC_History and CC_Exceptions and is not applied.
 *
 *   node --experimental-strip-types server/importDailyReports.ts [--dry] <pdf> <pdf> <pdf>
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SHEETS_SCOPE } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { appendHistory, historyRow } from './history.ts';
import { readStored } from './tokenStore.ts';
import { parseReportText, type ParsedReportText } from '../src/cloud/reportText.ts';

type Cell = string | number;

const DAILY_FIELD: Record<string, number> = { 'SNAP Written': 1, 'NWDSR Written': 2, 'NWDSR Delivered': 3 };
const LEDGER_VIEW: Record<string, string> = { 'SNAP Written': 'SNAP_STORE', 'NWDSR Written': 'NWDSR_WRITTEN_STORE', 'NWDSR Delivered': 'NWDSR_DELIVERED_STORE' };
const NET_WRITTEN = 'NWDSR Net Written # OF CUST';
const NOT_APPLIED = 'Later report for a recorded day differs. The recorded day was kept and this figure was not applied.';

interface Report {
  file: string;
  name: string;
  sha256: string;
  report: ParsedReportText;
  runTime: string;
  deliveredCustomers: number | null;
}

/** Upload copies carry a short suffix ("output__1__67cb.pdf"). Keep the name the report was saved under. */
export function originalName(file: string): string {
  return path.basename(file).replace(/_[0-9a-f]{4}\.(pdf|xlsx|zip)$/i, '.$1').replace(/__(\d+)_(?=\.)/, ' ($1)');
}

/** The NWDSR Delivered # OF CUST is recorded for reference only. It is never the closing numerator. */
export function deliveredCustomers(text: string): number | null {
  const line = text.split(/\r?\n/).find((entry) => /KANE FURNITURE #17\s+Totals:/i.test(entry));
  const match = line ? /Totals:\s*(-?[\d,]+)\s+(-?[\d.]+)\s+(\d+)\b/.exec(line) : null;
  return match ? Number(match[3]) : null;
}

function runTime(text: string): string {
  const date = /DATE:\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  const time = /TIME:\s*(\d{1,2}:\d{2}\s*[AP]M)/i.exec(text);
  return date ? `${date[3]}-${date[1]}-${date[2]}${time ? ` ${time[1].toUpperCase()}` : ''}` : 'not printed';
}

function readReports(files: string[]): Report[] {
  const reports = files.map((file) => {
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    const report = parseReportText(text);
    if (!report) throw new Error(`${path.basename(file)} is not a SNAP Written, NWDSR Written, or NWDSR Delivered report for store 17. Nothing was written.`);
    if (!report.singleDay) throw new Error(`${path.basename(file)} covers ${report.start} through ${report.end}. Only single-day reports are added to the daily record. Nothing was written.`);
    if (report.storeTotal === null) throw new Error(`${path.basename(file)} has no store total. Nothing was written.`);
    return {
      file,
      name: originalName(file),
      sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
      report,
      runTime: runTime(text),
      deliveredCustomers: report.reportType === 'NWDSR Delivered' ? deliveredCustomers(text) : null,
    };
  });
  const dates = new Set(reports.map((item) => item.report.start));
  if (dates.size !== 1) throw new Error(`The reports are for different dates (${[...dates].join(', ')}). Import one day at a time. Nothing was written.`);
  const types = reports.map((item) => item.report.reportType);
  if (new Set(types).size !== types.length) throw new Error('Two files are the same report type. Nothing was written.');
  return reports;
}

const text = (value: unknown) => String(value ?? '').trim();
const num = (value: unknown) => {
  const cleaned = text(value).replace(/[$,]/g, '');
  return cleaned === '' || !Number.isFinite(Number(cleaned)) ? null : Number(cleaned);
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const files = args.filter((arg) => arg !== '--dry');
  if (!files.length) throw new Error('Pass the day\'s report PDFs.');
  const reports = readReports(files);
  const date = reports[0].report.start;

  loadDotEnv(process.cwd());
  const config = loadConfig(process.cwd());
  const spreadsheetId = readStored(config.tokenPath).spreadsheetId;
  if (!spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
  const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const ranges = ['CC_Daily!A1:D400', 'CC_AssociateDays!A1:F2000', 'CC_Closing!A1:M2000', 'CC_Imports!A1:F4000', 'CC_Ledger!A1:R6000', 'CC_Exceptions!A1:C2000'];
  const batch = await googleJson({ accessToken: token, url: `${base}/values:batchGet?${ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&')}` }) as { valueRanges: { values?: Cell[][] }[] };
  const [daily, associates, closing, imports, ledger, exceptions] = batch.valueRanges.map((range) => range.values ?? []);
  if (text(daily[0]?.[0]) !== 'date' || text(daily[0]?.[3]) !== 'nwdsr_delivered') throw new Error('CC_Daily headers are not the expected layout. Nothing was written.');
  if (text(ledger[0]?.[17]) !== 'record_key') throw new Error('CC_Ledger headers are not the expected layout. Nothing was written.');
  if (text(closing[0]?.[8]) !== 'source' || text(closing[0]?.[12]) !== 'store') throw new Error('CC_Closing headers are not the expected layout. Nothing was written.');

  const importedAt = new Date().toISOString();
  const updates: { range: string; values: Cell[][] }[] = [];
  const appends: Record<string, Cell[][]> = { CC_Daily: [], CC_AssociateDays: [], CC_Closing: [], CC_Imports: [], CC_Ledger: [], CC_Exceptions: [] };
  const history: Cell[][] = [];
  const log: string[] = [];
  const notApplied = (tab: string, key: string, kept: Cell[], incoming: string, source: Report) => {
    history.push(historyRow({ at: importedAt, tab, key, replacedBy: `not applied: ${source.name} sha256 ${source.sha256.slice(0, 12)} run ${source.runTime}`, previous: kept, reason: `${NOT_APPLIED} Later figure: ${incoming}.` }));
    const message = `${source.report.reportType} ${date} re-pull (${source.name}) shows ${incoming}, which differs from the recorded day. The recorded figure was kept.`;
    if (!exceptions.some((row) => text(row[2]) === message)) appends.CC_Exceptions.push([importedAt, 'Needs Review', message]);
    log.push(`NOT APPLIED ${tab} ${key}: recorded ${JSON.stringify(kept)}, later ${incoming}`);
  };

  let dailyIndex = daily.findIndex((row, index) => index > 0 && text(row[0]) === date);
  const dailyRow: Cell[] = dailyIndex > 0 ? [...daily[dailyIndex]] : [date, '', '', ''];
  const ledgerKeys = new Map<string, number>();
  ledger.forEach((row, index) => { if (index > 0) ledgerKeys.set(text(row[17]), index); });
  const known = new Map<string, Cell[]>();
  associates.forEach((row, index) => { if (index > 0 && !known.has(text(row[1]).toUpperCase())) known.set(text(row[1]).toUpperCase(), row); });

  const ledgerDaily = (view: string, side: string, name: string, amount: number, source: string, origin: Report) => {
    const key = [view, 'daily', date, date, date, side, name || 'STORE'].join('|');
    const row: Cell[] = [view, 'daily', date, date, date, date, '17', '', name, side, amount, '', '', '', '', source, importedAt, key];
    const at = ledgerKeys.get(key);
    if (at === undefined) {
      appends.CC_Ledger.push(row);
      ledgerKeys.set(key, -1);
      log.push(`ADD CC_Ledger ${key} = ${amount}`);
    } else if (at >= 0 && num(ledger[at][10]) !== amount) notApplied('CC_Ledger', key, ledger[at], String(amount), origin);
    else log.push(`SKIP CC_Ledger ${key} already on file`);
  };

  for (const item of reports) {
    const { report } = item;
    const field = DAILY_FIELD[report.reportType];
    const current = num(dailyRow[field]);
    if (current === null) {
      dailyRow[field] = report.storeTotal as number;
      log.push(`ADD CC_Daily ${date} ${report.reportType} = ${report.storeTotal}`);
    } else if (current !== report.storeTotal) notApplied('CC_Daily', `${date}|${report.reportType}`, daily[dailyIndex], String(report.storeTotal), item);
    else log.push(`SKIP CC_Daily ${date} ${report.reportType} already ${current}`);
    ledgerDaily(LEDGER_VIEW[report.reportType], report.reportType === 'NWDSR Delivered' ? 'delivered' : 'written', '', report.storeTotal as number, report.reportType, item);

    if (report.reportType === 'SNAP Written') {
      for (const line of report.associates) {
        const prior = known.get(line.sourceName.toUpperCase());
        const display = prior ? text(prior[2]) : line.sourceName;
        const role = prior ? text(prior[3]) : 'unknown';
        const existing = associates.find((row, index) => index > 0 && text(row[0]) === date && text(row[1]).toUpperCase() === line.sourceName.toUpperCase());
        if (!existing) {
          appends.CC_AssociateDays.push([date, line.sourceName, display, role, line.amount, item.sha256]);
          log.push(`ADD CC_AssociateDays ${date} ${display} = ${line.amount}`);
        } else if (num(existing[4]) !== line.amount) notApplied('CC_AssociateDays', `${date}|${line.sourceName}`, existing, String(line.amount), item);
        else log.push(`SKIP CC_AssociateDays ${date} ${display} already ${line.amount}`);
        ledgerDaily('SNAP_PERSON', 'written', display, line.amount, 'CC_AssociateDays', item);
      }
    }

    if (report.reportType === 'NWDSR Written' && report.purchasingCustomers !== null) {
      const existing = closing.find((row, index) => index > 0 && text(row[1]) === 'store' && text(row[2]) === '' && text(row[6]) === date && text(row[7]) === date && text(row[8]) === NET_WRITTEN);
      if (!existing) {
        appends.CC_Closing.push([date, 'store', '', '', report.purchasingCustomers, '', date, date, NET_WRITTEN, 'yes', `Net Written # OF CUST for the report date. ${item.name} sha256 ${item.sha256.slice(0, 12)}, run ${item.runTime}.`, date, '17']);
        log.push(`ADD CC_Closing ${date} store customers = ${report.purchasingCustomers}`);
      } else if (num(existing[4]) !== report.purchasingCustomers) notApplied('CC_Closing', `${date}|store|${NET_WRITTEN}`, existing, String(report.purchasingCustomers), item);
      else log.push(`SKIP CC_Closing ${date} store customers already ${report.purchasingCustomers}`);
    }

    if (!imports.some((row) => text(row[0]) === item.sha256)) {
      const extra = report.reportType === 'NWDSR Written' ? ` # OF CUST ${report.purchasingCustomers} (closing numerator).`
        : report.reportType === 'NWDSR Delivered' ? ` Delivered # OF CUST ${item.deliveredCustomers ?? 'not printed'} (reference only, not the closing numerator).`
          : report.associates.length ? ` Salesperson lines: ${report.associates.map((line) => `${line.sourceName} ${line.amount}`).join('; ')}.` : '';
      appends.CC_Imports.push([item.sha256, item.name, report.reportType, 'imported', importedAt, `${date} single day. Store total ${report.storeTotal}. Run ${item.runTime}.${extra} Not added again.`]);
      log.push(`ADD CC_Imports ${item.name} ${item.sha256.slice(0, 12)}`);
    } else log.push(`SKIP CC_Imports ${item.name} already logged`);
  }

  if (dailyIndex > 0) {
    if (JSON.stringify(dailyRow) !== JSON.stringify(daily[dailyIndex])) updates.push({ range: `CC_Daily!A${dailyIndex + 1}:D${dailyIndex + 1}`, values: [dailyRow.map((cell) => cell ?? '')] });
  } else if (dailyRow.slice(1).some((cell) => cell !== '')) {
    appends.CC_Daily.push(dailyRow);
    dailyIndex = daily.length;
  }

  if (!dry) {
    if (updates.length) await googleJson({ accessToken: token, method: 'POST', url: `${base}/values:batchUpdate`, body: { valueInputOption: 'RAW', data: updates } });
    for (const [tab, rows] of Object.entries(appends)) {
      if (!rows.length) continue;
      await googleJson({ accessToken: token, method: 'POST', url: `${base}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, body: { values: rows } });
    }
    await appendHistory(token, spreadsheetId, history);
  }
  console.log(JSON.stringify({
    dry,
    date,
    reports: reports.map((item) => ({ file: item.name, uploadedAs: path.basename(item.file), type: item.report.reportType, total: item.report.storeTotal, purchasingCustomers: item.report.purchasingCustomers, deliveredCustomers: item.deliveredCustomers, associates: item.report.associates, run: item.runTime, sha256: item.sha256.slice(0, 12) })),
    written: { updates: updates.map((item) => item.range), appended: Object.fromEntries(Object.entries(appends).map(([tab, rows]) => [tab, rows.length])), history: history.length },
    log,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'The daily report import failed.');
    process.exit(1);
  });
}
