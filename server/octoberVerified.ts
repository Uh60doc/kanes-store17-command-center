import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { blob } from './appsScriptServices.ts';
import { fakeSpreadsheet, type Grid, loadAppsScript } from './fakeSpreadsheet.ts';
import { textGrid } from './snapshotGrid.ts';

/**
 * The verified October 2026 workbook (records through October 15, saved with saveRegressionFixture.ts) and an
 * in-memory Apps Script to run on it. Every call returns a fresh copy, so no test can change another's data, and
 * nothing here can reach the production workbook.
 */
export const FIXTURE_TODAY = '2026-10-17';
export const ALL_FILES = ['Code.gs', 'Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'EvalImport.gs', 'Evaluations.gs', 'Upload.gs', 'MonthEnd.gs', 'History.gs', 'Quality.gs', 'Backup.gs', 'Brief.gs', 'DevLog.gs', 'Opportunity.gs', 'Recovery.gs', 'Coaching.gs', 'EvalPrep.gs', 'Leakage.gs', 'DeliveryRadar.gs', 'Accelerator.gs', 'Actions.gs', 'Reports.gs', 'Trend.gs', 'Readiness.gs', 'Variance.gs', 'OrderQuality.gs', 'Closeout.gs', 'Training.gs', 'Documents.gs', 'Consistency.gs'];

let fixtureText: string | null = null;
export function verifiedOctober(): Record<string, Grid> {
  fixtureText ??= readFileSync(new URL('./fixtures/october-verified.json', import.meta.url), 'utf8');
  return JSON.parse(fixtureText, (_key, value) => (value && typeof value === 'object' && typeof value.$date === 'string' ? new Date(`${value.$date}T16:00:00Z`) : value));
}

const unsigned = (bytes: ArrayLike<number>) => Uint8Array.from(Array.from(bytes, (b) => (b + 256) % 256));
const signed = (bytes: Uint8Array) => Array.from(bytes, (b) => (b > 127 ? b - 256 : b));

function formatDate(date: Date, timeZone = 'America/New_York', format = 'yyyy-MM-dd') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value]));
  return format.replace('yyyy', parts.year!).replace('MM', parts.month!).replace('dd', parts.day!).replace('HH', parts.hour!).replace('mm', parts.minute!).replace('ss', parts.second!).replace(/\bH\b/, String(Number(parts.hour)));
}

export interface DriveFile { name: string; folder: string; tabs?: Record<string, Grid>; content?: string; trashed?: boolean }

/** Drive with folders, copies of spreadsheets and files, and trash. Spreadsheet copies open as their own workbook. */
export function fakeDrive(liveId: () => string, liveTabs: Record<string, Grid>) {
  const files: Record<string, DriveFile> = {};
  const folders: Record<string, { name: string; parent: string }> = {};
  let next = 1;
  const tabsOf = (id: string) => (id === liveId() ? liveTabs : files[id]?.tabs);
  const file = (id: string) => ({
    getId: () => id,
    getName: () => files[id]?.name ?? 'production',
    setTrashed: (value: boolean) => { if (files[id]) files[id]!.trashed = value; },
    makeCopy: (name: string, folder: { getId: () => string }) => {
      const copyId = `copy-${next++}`;
      const source = tabsOf(id);
      files[copyId] = { name, folder: folder.getId(), tabs: source ? structuredClone(source) : undefined, content: files[id]?.content };
      return file(copyId);
    },
    getBlob: () => blob(Buffer.from(files[id]?.content ?? ''), '', files[id]?.name ?? ''),
  });
  const folder = (id: string): Record<string, (...args: any[]) => any> => ({
    getId: () => id,
    createFolder: (name: string) => { const childId = `folder-${next++}`; folders[childId] = { name, parent: id }; return folder(childId); },
    createFile: (name: string, content: string) => { const fileId = `file-${next++}`; files[fileId] = { name, folder: id, content }; return file(fileId); },
  });
  const pathOf = (id: string): string => (folders[id] ? (folders[id]!.parent ? `${pathOf(folders[id]!.parent)}/` : '') + folders[id]!.name : id);
  const DriveApp = {
    createFolder: (name: string) => { const id = `folder-${next++}`; folders[id] = { name, parent: '' }; return folder(id); },
    getFolderById: (id: string) => { if (!folders[id]) throw new Error('no such folder'); return folder(id); },
    getFileById: (id: string) => { if (id !== liveId() && !files[id]) throw new Error(`no such file ${id}`); return file(id); },
  };
  const openById = (id: string) => {
    const tabs = tabsOf(id);
    if (!tabs) throw new Error(`no spreadsheet ${id}`);
    const book = fakeSpreadsheet(tabs);
    return { ...book, getId: () => id, getSheets: () => Object.keys(tabs).map((name) => book.getSheetByName(name)!) };
  };
  return { files, folders, pathOf, DriveApp, openById, addFile: (id: string, name: string, content = name) => { files[id] = { name, folder: 'original', content }; } };
}

export interface Harness {
  gs: Record<string, (...args: any[]) => any>;
  tabs: Record<string, Grid>;
  props: Record<string, string>;
  mail: { to: string; subject: string; body: string; htmlBody?: string; name?: string }[];
  drive: ReturnType<typeof fakeDrive>;
  setHour: (hour: number) => void;
  setToday: (today: string) => void;
}

/** The Apps Script project on a copy of the verified October workbook. */
export function harness(tabs: Record<string, Grid> = verifiedOctober(), today = FIXTURE_TODAY, hour = 15): Harness {
  // The one-time seeding flags are set in production.
  const props: Record<string, string> = { closing_facts_v1: 'yes', morning_promo_v1: 'yes' };
  const mail: Harness['mail'] = [];
  const cache: Record<string, string> = {};
  let gs: Harness['gs'];
  const drive = fakeDrive(() => String(gs.SPREADSHEET_ID_), tabs);
  gs = loadAppsScript(ALL_FILES, tabs, today, {
    Utilities: {
      formatDate,
      getUuid: () => Math.random().toString(16).slice(2),
      DigestAlgorithm: { SHA_256: 'sha256', MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm: string, input: string | number[]) => signed(createHash(algorithm).update(typeof input === 'string' ? Buffer.from(input, 'utf8') : unsigned(input)).digest()),
      base64Decode: (text: string) => signed(Buffer.from(text, 'base64')),
      base64Encode: (bytes: number[]) => Buffer.from(unsigned(bytes)).toString('base64'),
      newBlob: (bytes: number[], type?: string, name?: string) => blob(bytes, type, name),
    },
    SpreadsheetApp: { openById: (id: string) => drive.openById(id) },
    DriveApp: drive.DriveApp,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null, setProperty: (key: string, value: string) => { props[key] = String(value); }, deleteProperty: (key: string) => { delete props[key]; }, getProperties: () => ({ ...props }) }) },
    CacheService: { getScriptCache: () => ({ get: (key: string) => cache[key] ?? null, put: (key: string, value: string) => { cache[key] = value; }, remove: (key: string) => { delete cache[key]; } }) },
    MailApp: {
      sendEmail: (...args: any[]) => {
        const first = args[0];
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          mail.push({ to: String(first.to || ''), subject: String(first.subject || ''), body: String(first.body || ''), htmlBody: String(first.htmlBody || ''), name: first.name });
          return;
        }
        mail.push({ to: String(args[0] || ''), subject: String(args[1] || ''), body: String(args[2] || '') });
      },
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => undefined, releaseLock: () => undefined }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => { throw new Error('no triggers in tests'); } },
    Session: { getScriptTimeZone: () => 'America/New_York' },
    GmailApp: { search: () => [] },
  });
  const sandbox = gs as unknown as Record<string, unknown>;
  const setHour = (value: number) => { sandbox.nowHourNy_ = () => value; };
  const setToday = (value: string) => { sandbox.todayNy_ = () => value; };
  setHour(hour);
  return { gs, tabs, props, mail, drive, setHour, setToday };
}

export const session = { role: 'admin', username: 'regression' };

/** A tab as text without trailing blank cells and rows, which a sheet does not store. */
export function cells(grid: Grid | undefined) {
  return textGrid(grid).map((row) => {
    const line = [...row];
    while (line.length && line[line.length - 1] === '') line.pop();
    return line;
  }).filter((row, i, all) => row.length || all.slice(i).some((later) => later.length));
}

/** Every tab except the ones named, as text, to prove a run changed nothing else. */
export function tabText(tabs: Record<string, Grid>, except: string[] = []) {
  return JSON.stringify(Object.keys(tabs).filter((name) => !except.includes(name)).sort().map((name) => [name, cells(tabs[name])]));
}
