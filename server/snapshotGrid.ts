import type { Grid } from './fakeSpreadsheet.ts';

export interface TabDump { raw: unknown[][]; shown: unknown[][]; formula?: unknown[][] }
export type Workbook = Record<string, TabDump>;

const DATE_TEXT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/;

/** What getValues() returns in Apps Script: date cells become Date objects (noon Eastern), the rest stay as stored. */
export function appsScriptGrid(tab: TabDump): Grid {
  return tab.raw.map((row, y) => row.map((cell, x) => {
    const m = String(tab.shown[y]?.[x] ?? '').match(DATE_TEXT);
    if (typeof cell !== 'number' || !m) return cell;
    const [yy, mm, dd] = m[3] ? [m[3], m[1], m[2]] : [m[4], m[5], m[6]];
    return new Date(Date.UTC(Number(yy), Number(mm) - 1, Number(dd), 16));
  }));
}

export const cellText = (cell: unknown) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : cell === undefined || cell === null ? '' : String(cell));
export const textGrid = (grid: Grid | undefined) => (grid ?? []).map((row) => row.map(cellText));

/** Header-mapped rows with dates as YYYY-MM-DD text. */
export function table(tabs: Record<string, Grid>, name: string): Record<string, string>[] {
  const [head, ...rows] = textGrid(tabs[name]);
  return head ? rows.map((row) => Object.fromEntries(head.map((key, i) => [key, row[i] ?? '']))) : [];
}
