import { googleJson } from './google.ts';

export const HISTORY_TAB = 'CC_History';
export const HISTORY_HEADERS = ['archived_at', 'tab', 'record_key', 'reason', 'replaced_by', 'previous_row'];

type Cell = string | number;

export function historyRow(input: { at: string; tab: string; key: string; replacedBy: string; previous: Cell[]; reason?: string }): Cell[] {
  return [input.at, input.tab, input.key, input.reason ?? 'Corrected report replaced this row.', input.replacedBy, JSON.stringify(input.previous)];
}

/** CC_History is append-only: a corrected report's earlier row is kept here before the working row changes. */
export async function appendHistory(accessToken: string, spreadsheetId: string, rows: Cell[][]): Promise<void> {
  if (!rows.length) return;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const meta = await googleJson({ accessToken, url: `${base}?fields=sheets.properties.title` }) as { sheets: { properties: { title: string } }[] };
  if (!meta.sheets.some((sheet) => sheet.properties.title === HISTORY_TAB)) {
    await googleJson({ accessToken, method: 'POST', url: `${base}:batchUpdate`, body: { requests: [{ addSheet: { properties: { title: HISTORY_TAB, gridProperties: { frozenRowCount: 1 } } } }] } });
    await googleJson({ accessToken, method: 'PUT', url: `${base}/values/${encodeURIComponent(`${HISTORY_TAB}!A1`)}?valueInputOption=RAW`, body: { values: [HISTORY_HEADERS] } });
  }
  await googleJson({ accessToken, method: 'POST', url: `${base}/values/${encodeURIComponent(`${HISTORY_TAB}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, body: { values: rows } });
}
