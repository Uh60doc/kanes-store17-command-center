/**
 * Import PERQ Performance Stats exports (xlsx files or a ZIP of them) into CC_Closing and PERQ_STORE / PERQ_PERSON.
 * Only exports whose date is proven in perqDays.ts become daily rows. Held exports, duplicates, and files that are not
 * PERQ are logged to CC_Imports and counted nowhere. Safe to run again: a count already on file is left alone, and a
 * differing later count is logged to CC_History and CC_Exceptions and is not applied.
 *
 *   node --experimental-strip-types server/importPerqDays.ts [--dry] <xlsx|zip>...
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SHEETS_SCOPE } from './access.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { accessTokenFor, googleJson } from './google.ts';
import { appendHistory, historyRow } from './history.ts';
import { originalName } from './importDailyReports.ts';
import { HELD_BLOCK, NOT_PERQ, PERQ_DAYS, PERQ_SNAPSHOTS, PERQ_SOURCE, dayCounts, parsePerqExport, type PerqExport } from './perqDays.ts';
import { readStored } from './tokenStore.ts';
import { firstSheet, unzip } from './xlsxLite.ts';

type Cell = string | number;

export interface PerqFile {
  name: string;
  sha256: string;
  archive?: string;
  /** Null for a file that is known not to be PERQ. */
  parsed: PerqExport | null;
}

export interface PerqArchive {
  name: string;
  sha256: string;
}

export interface Sheets {
  closing: Cell[][];
  ledger: Cell[][];
  imports: Cell[][];
  exceptions: Cell[][];
  coverage: Cell[][];
}

export interface PerqPlan {
  appends: { CC_Closing: Cell[][]; CC_Ledger: Cell[][]; CC_Imports: Cell[][]; CC_Exceptions: Cell[][] };
  updates: { range: string; values: Cell[][] }[];
  history: Cell[][];
  days: { date: string; store: number; people: string; unassigned: number }[];
  log: string[];
}

const NOT_APPLIED = 'Later PERQ count for a recorded day or period differs. The recorded count was kept and this count was not applied.';
const HELD_NOTE = `${HELD_BLOCK.start} through ${HELD_BLOCK.end}`;

const text = (value: unknown) => String(value ?? '').trim();
const num = (value: unknown) => {
  const cleaned = text(value).replace(/,/g, '');
  return cleaned === '' || !Number.isFinite(Number(cleaned)) ? null : Number(cleaned);
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const short = (value: string) => value.slice(0, 12);

/** Read xlsx files and ZIP archives. Each export inside an archive keeps the archive name for the import log. */
export function readPerqFiles(paths: string[]): { files: PerqFile[]; archives: PerqArchive[] } {
  const files: PerqFile[] = [];
  const archives: PerqArchive[] = [];
  const add = (name: string, bytes: Buffer, archive?: string) => {
    const hash = sha(bytes);
    files.push({ name, sha256: hash, archive, parsed: NOT_PERQ[hash] ? null : parsePerqExport(firstSheet(unzip(bytes))) });
  };
  for (const file of paths) {
    const bytes = readFileSync(file);
    if (/\.zip$/i.test(file)) {
      const archive = { name: originalName(file), sha256: sha(bytes) };
      archives.push(archive);
      for (const [entry, content] of unzip(bytes)) {
        if (/\.xlsx$/i.test(entry) && !entry.startsWith('__MACOSX/')) add(path.basename(entry), content, archive.name);
      }
    } else if (/\.xlsx$/i.test(file)) add(originalName(file), bytes);
    else throw new Error(`${path.basename(file)} is not an xlsx export or a ZIP archive. Nothing was written.`);
  }
  return { files, archives };
}

const reportType = (item: PerqExport) => item.kind === 'location' ? 'PERQ Performance Stats by Location' : 'PERQ Performance Stats by Salesperson';
const peopleText = (item: PerqExport) => item.people.map((person) => `${person.name} ${person.opportunities}`).join(', ') || 'no salesperson rows';

/** Decide every row to write. Nothing already on file is rewritten. */
export function planPerqImport(input: { files: PerqFile[]; archives: PerqArchive[]; sheets: Sheets; importedAt: string }): PerqPlan {
  const { files, archives, sheets, importedAt } = input;
  const plan: PerqPlan = { appends: { CC_Closing: [], CC_Ledger: [], CC_Imports: [], CC_Exceptions: [] }, updates: [], history: [], days: [], log: [] };
  const parsed = new Map<string, PerqExport>();
  const byHash = new Map<string, PerqFile>();
  for (const file of files) {
    if (byHash.has(file.sha256)) continue;
    byHash.set(file.sha256, file);
    if (file.parsed) parsed.set(file.sha256, file.parsed);
  }

  const importNotes = new Map<string, { file: PerqFile; type: string; status: string; note: string }>();
  const logImport = (hash: string, status: string, note: string) => {
    const file = byHash.get(hash);
    if (!file || importNotes.has(hash)) return;
    const item = parsed.get(hash);
    const where = file.archive ? ` From ${file.archive}.` : '';
    importNotes.set(hash, { file, type: item ? reportType(item) : 'Not PERQ', status, note: `${note}${where}` });
  };
  const describe = (item: PerqExport) => item.kind === 'location' ? `Store 17 ${item.store17}` : `${peopleText(item)}${item.exportedAt ? ` (Active Deals ${item.exportedAt})` : ''}`;

  const exceptionMessages = new Set(sheets.exceptions.map((row) => text(row[2])));
  const flag = (message: string) => {
    if (exceptionMessages.has(message)) return;
    exceptionMessages.add(message);
    plan.appends.CC_Exceptions.push([importedAt, 'Needs Review', message]);
  };

  const closingIndex = new Map<string, Cell[]>();
  sheets.closing.forEach((row, index) => {
    if (index === 0 || text(row[8]) !== PERQ_SOURCE) return;
    closingIndex.set([text(row[1]), text(row[2]).toUpperCase(), text(row[6]), text(row[7])].join('|'), row);
  });
  const ledgerIndex = new Map<string, Cell[]>();
  sheets.ledger.forEach((row, index) => { if (index > 0) ledgerIndex.set(text(row[17]), row); });

  const notApplied = (tab: string, key: string, kept: Cell[], incoming: number, why: string) => {
    plan.history.push(historyRow({ at: importedAt, tab, key, replacedBy: `not applied: ${why}`, previous: kept, reason: `${NOT_APPLIED} Later count: ${incoming}.` }));
    flag(`PERQ ${key} later shows ${incoming}, which differs from the recorded count. The recorded count was kept.`);
    plan.log.push(`NOT APPLIED ${tab} ${key}: recorded ${JSON.stringify(kept)}, later ${incoming}`);
  };

  const record = (fact: { scope: 'store' | 'person'; code: string; name: string; opportunities: number; start: string; end: string; through: string; note: string; why: string }) => {
    const closingKey = [fact.scope, fact.code.toUpperCase(), fact.start, fact.end].join('|');
    const existing = closingIndex.get(closingKey);
    if (!existing) {
      const row: Cell[] = [fact.through, fact.scope, fact.code, fact.name, '', fact.opportunities, fact.start, fact.end, PERQ_SOURCE, 'yes', fact.note, fact.through, '17'];
      plan.appends.CC_Closing.push(row);
      closingIndex.set(closingKey, row);
      plan.log.push(`ADD CC_Closing ${closingKey} = ${fact.opportunities}`);
    } else if (num(existing[5]) !== fact.opportunities) notApplied('CC_Closing', closingKey, existing, fact.opportunities, fact.why);
    else plan.log.push(`SKIP CC_Closing ${closingKey} already ${fact.opportunities}`);

    const daily = fact.start === fact.end;
    const view = fact.scope === 'store' ? 'PERQ_STORE' : 'PERQ_PERSON';
    const grain = daily ? 'daily' : 'cumulative';
    const reportDate = daily ? fact.start : '';
    const key = [view, grain, fact.start, fact.end, reportDate, '', fact.code || 'STORE'].join('|');
    const prior = ledgerIndex.get(key);
    if (!prior) {
      const row: Cell[] = [view, grain, reportDate, fact.start, fact.end, fact.through, '17', fact.code, fact.name, '', '', '', fact.opportunities, '', '', PERQ_SOURCE, importedAt, key];
      plan.appends.CC_Ledger.push(row);
      ledgerIndex.set(key, row);
      plan.log.push(`ADD CC_Ledger ${key} = ${fact.opportunities}`);
    } else if (num(prior[12]) !== fact.opportunities) notApplied('CC_Ledger', key, prior, fact.opportunities, fact.why);
    else plan.log.push(`SKIP CC_Ledger ${key} already ${fact.opportunities}`);
  };

  for (const day of PERQ_DAYS) {
    const counts = dayCounts(day, parsed);
    if (!counts) continue;
    const sources = counts.files.map((hash) => `${byHash.get(hash)!.name} ${short(hash)}`).join('; ');
    const why = `PERQ exports for ${day.date}: ${sources}`;
    const gap = counts.unassigned ? ` Salesperson rows add to ${counts.store - counts.unassigned}, so ${counts.unassigned} ${counts.unassigned === 1 ? 'opportunity is' : 'opportunities are'} not assigned to any salesperson.` : '';
    record({
      scope: 'store', code: '', name: '', opportunities: counts.store, start: day.date, end: day.date, through: day.date, why,
      note: `Store 17 Ups + Be Backs for ${day.date} only.${gap} Not added to any snapshot. Exports: ${sources}.`,
    });
    for (const person of counts.people) {
      record({
        scope: 'person', code: person.code, name: person.name, opportunities: person.opportunities, start: day.date, end: day.date, through: day.date, why,
        note: `Ups + Be Backs for ${day.date} only. Not added to any snapshot.`,
      });
    }
    if (counts.unassigned) {
      flag(`PERQ ${day.date}: Store 17 shows ${counts.store} opportunities but the salesperson export lists ${counts.people.map((person) => `${person.name} ${person.opportunities}`).join(', ')} (${counts.store - counts.unassigned}). ${counts.unassigned} ${counts.unassigned === 1 ? 'opportunity is' : 'opportunities are'} not assigned to anyone. Salespeople not listed stay pending for ${day.date}.`);
    }
    plan.days.push({ date: day.date, store: counts.store, people: counts.people.map((person) => `${person.name} ${person.opportunities}`).join(', '), unassigned: counts.unassigned });
    const primary = (hashes: readonly string[]) => hashes.find((hash) => parsed.has(hash));
    for (const hashes of [day.location, day.salesperson]) {
      const first = primary(hashes);
      for (const hash of hashes) {
        const item = parsed.get(hash);
        if (!item) continue;
        if (hash === first) logImport(hash, 'imported', `${day.date} single day. ${describe(item)}. Date evidence: ${day.evidence} Not added again.`);
        else logImport(hash, 'duplicate', `Same ${day.date} counts as ${byHash.get(first!)!.name} (${short(first!)}). ${describe(item)}. Not added again.`);
      }
    }
  }

  let heldStore = 0;
  let heldFound = 0;
  for (const held of HELD_BLOCK.exports) {
    const location = parsed.get(held.location);
    if (location) {
      heldFound += 1;
      heldStore += location.store17 ?? 0;
    }
    const hold = `One of ten daily exports for ${HELD_NOTE}, which add to ${HELD_BLOCK.store}. The file prints no date. Export order suggests ${held.exportOrderDate}, but nothing confirms it, so it is not dated or counted as a daily row until the General Manager confirms the date.`;
    if (location) logImport(held.location, 'held: date unconfirmed', `${describe(location)}. ${hold}`);
    const first = held.salesperson.find((hash) => parsed.has(hash));
    for (const hash of held.salesperson) {
      const item = parsed.get(hash);
      if (!item) continue;
      if (hash === first) logImport(hash, 'held: date unconfirmed', `${describe(item)}. ${hold}`);
      else logImport(hash, 'duplicate', `Same counts as ${byHash.get(first!)!.name} (${short(first!)}). ${describe(item)}. Held with it. Not added again.`);
    }
  }
  if (heldFound === HELD_BLOCK.exports.length && heldStore !== HELD_BLOCK.store) {
    throw new Error(`The held ${HELD_NOTE} store exports add to ${heldStore}, not ${HELD_BLOCK.store}. Nothing was written.`);
  }
  if (heldFound) {
    flag(`PERQ ${HELD_NOTE}: ${heldFound} daily exports add to ${heldStore} but print no date. They are held, and only the ${HELD_NOTE} total is used, until the General Manager confirms each export's date.`);
  }

  for (const snapshot of PERQ_SNAPSHOTS) {
    record({ ...snapshot, why: 'verified PERQ snapshot' });
  }

  for (const [hash, reason] of Object.entries(NOT_PERQ)) {
    if (byHash.has(hash)) logImport(hash, 'not used', reason);
  }
  for (const [hash, item] of parsed) {
    if (!importNotes.has(hash)) logImport(hash, 'held: no date evidence', `${describe(item)}. No evidence fixes the date of this export, so it is not counted anywhere.`);
  }

  const logged = new Set(sheets.imports.map((row) => text(row[0])));
  for (const [hash, entry] of importNotes) {
    if (logged.has(hash)) {
      plan.log.push(`SKIP CC_Imports ${entry.file.name} already logged`);
      continue;
    }
    logged.add(hash);
    plan.appends.CC_Imports.push([hash, entry.file.name, entry.type, entry.status, importedAt, entry.note]);
    plan.log.push(`ADD CC_Imports ${entry.file.name} ${short(hash)} ${entry.status}`);
  }
  for (const archive of archives) {
    if (logged.has(archive.sha256)) continue;
    logged.add(archive.sha256);
    const inside = [...importNotes.values()].filter((entry) => entry.file.archive === archive.name);
    const count = (status: string) => inside.filter((entry) => entry.status === status).length;
    plan.appends.CC_Imports.push([archive.sha256, archive.name, 'PERQ export archive', 'imported', importedAt,
      `${inside.length} distinct exports: ${count('imported')} dated, ${count('duplicate')} duplicate, ${count('held: date unconfirmed')} held with unconfirmed dates, ${count('held: no date evidence')} with no date evidence. Each export is logged by its own sha256.`]);
    plan.log.push(`ADD CC_Imports ${archive.name} ${short(archive.sha256)}`);
  }

  const coverageRow = sheets.coverage.findIndex((row) => text(row[0]) === 'PERQ');
  if (coverageRow > 0) {
    const dailyDates = [...new Set([...closingIndex.keys()]
      .map((key) => key.split('|'))
      .filter(([scope, code, start, end]) => scope === 'store' && !code && start === end)
      .map(([, , start]) => start))].sort();
    const unassigned = plan.days.filter((day) => day.unassigned).map((day) => `${day.date} has ${day.unassigned} not assigned to a salesperson`);
    const row: Cell[] = [
      'PERQ',
      dailyDates[0] ?? '',
      dailyDates[dailyDates.length - 1] ?? '',
      String(dailyDates.length),
      dailyDates.join(', '),
      `${HELD_NOTE} store ${HELD_BLOCK.store} (ten exports held, dates unconfirmed); 2026-10-02 through 2026-10-13 store 100; 2026-10-01 through 2026-10-11 and 2026-10-01 through 2026-10-31 (through 2026-10-13) by salesperson. Not added to the daily count.`,
      `${HELD_NOTE}: exports on file, dates unconfirmed`,
      `CC_Closing and PERQ_STORE / PERQ_PERSON.${unassigned.length ? ` ${unassigned.join('; ')}.` : ''}`,
    ];
    const current = sheets.coverage[coverageRow].map(text);
    if (JSON.stringify(current.slice(0, row.length)) !== JSON.stringify(row.map(text))) {
      plan.updates.push({ range: `CC_Coverage!A${coverageRow + 1}:H${coverageRow + 1}`, values: [row] });
      plan.log.push('UPDATE CC_Coverage PERQ row');
    }
  }
  return plan;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const paths = args.filter((arg) => arg !== '--dry');
  if (!paths.length) throw new Error('Pass the PERQ exports or the ZIP that holds them.');
  const { files, archives } = readPerqFiles(paths);

  loadDotEnv(process.cwd());
  const config = loadConfig(process.cwd());
  const spreadsheetId = readStored(config.tokenPath).spreadsheetId;
  if (!spreadsheetId) throw new Error('The command center spreadsheet is not saved.');
  const token = await accessTokenFor({ clientId: config.clientId, clientSecret: config.clientSecret, tokenPath: config.tokenPath, requiredScope: SHEETS_SCOPE });
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const ranges = ['CC_Closing!A1:M2000', 'CC_Ledger!A1:R6000', 'CC_Imports!A1:F4000', 'CC_Exceptions!A1:C2000', 'CC_Coverage!A1:H100'];
  const batch = await googleJson({ accessToken: token, url: `${base}/values:batchGet?${ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join('&')}` }) as { valueRanges: { values?: Cell[][] }[] };
  const [closing, ledger, imports, exceptions, coverage] = batch.valueRanges.map((range) => range.values ?? []);
  if (text(closing[0]?.[8]) !== 'source' || text(closing[0]?.[12]) !== 'store') throw new Error('CC_Closing headers are not the expected layout. Nothing was written.');
  if (text(ledger[0]?.[12]) !== 'eligible' || text(ledger[0]?.[17]) !== 'record_key') throw new Error('CC_Ledger headers are not the expected layout. Nothing was written.');

  const plan = planPerqImport({ files, archives, sheets: { closing, ledger, imports, exceptions, coverage }, importedAt: new Date().toISOString() });
  if (!dry) {
    if (plan.updates.length) await googleJson({ accessToken: token, method: 'POST', url: `${base}/values:batchUpdate`, body: { valueInputOption: 'RAW', data: plan.updates } });
    for (const [tab, rows] of Object.entries(plan.appends)) {
      if (!rows.length) continue;
      await googleJson({ accessToken: token, method: 'POST', url: `${base}/values/${encodeURIComponent(`${tab}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, body: { values: rows } });
    }
    await appendHistory(token, spreadsheetId, plan.history);
  }
  console.log(JSON.stringify({
    dry,
    files: files.length,
    distinct: new Set(files.map((file) => file.sha256)).size,
    days: plan.days,
    written: { updates: plan.updates.map((item) => item.range), appended: Object.fromEntries(Object.entries(plan.appends).map(([tab, rows]) => [tab, rows.length])), history: plan.history.length },
    imports: plan.appends.CC_Imports.map((row) => `${row[3]} | ${row[1]} | ${String(row[0]).slice(0, 12)}`),
    exceptions: plan.appends.CC_Exceptions.map((row) => row[2]),
    log: plan.log,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'The PERQ import failed.');
    process.exit(1);
  });
}
