import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export type Grid = unknown[][];

/** In-memory SpreadsheetApp with the calls the Apps Script code makes: read, append, write ranges, add tabs. */
export function fakeSpreadsheet(tabs: Record<string, Grid>) {
  const sheet = (name: string) => {
    const grid = () => tabs[name]!;
    const width = () => Math.max(1, ...grid().map((row) => row.length));
    return {
      getName: () => name,
      getDataRange: () => ({
        getValues: () => grid().map((row) => Array.from({ length: width() }, (_, i) => (row[i] === undefined ? '' : row[i]))),
      }),
      appendRow: (row: unknown[]) => { grid().push([...row]); },
      clearContents: () => { grid().length = 0; },
      getLastRow: () => grid().length,
      setFrozenRows: (_count: number) => undefined,
      setColumnWidth: (_col: number, _width: number) => undefined,
      getRange: (row: number, col: number, rows = 1, cols = 1) => {
        const ensure = () => {
          while (grid().length < row + rows - 1) grid().push([]);
          for (let r = row - 1; r < row - 1 + rows; r += 1) while (grid()[r]!.length < col - 1 + cols) grid()[r]!.push('');
        };
        return {
          setValues: (values: unknown[][]) => {
            ensure();
            values.forEach((line, r) => line.forEach((value, c) => { grid()[row - 1 + r]![col - 1 + c] = value; }));
          },
          setValue: (value: unknown) => { ensure(); grid()[row - 1]![col - 1] = value; },
          getValue: () => grid()[row - 1]?.[col - 1] ?? '',
          getValues: () => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid()[row - 1 + r]?.[col - 1 + c] ?? '')),
          setNumberFormat: (_pattern: string) => undefined,
        };
      },
    };
  };
  return {
    getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null),
    insertSheet: (name: string) => { tabs[name] = []; return sheet(name); },
  };
}

export function loadAppsScript(files: string[], tabs: Record<string, Grid>, today: string, extra: Record<string, unknown> = {}) {
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: {
      formatDate: (date: Date) => date.toISOString().slice(0, 10),
      getUuid: () => Math.random().toString(16).slice(2),
    },
    SpreadsheetApp: { openById: () => fakeSpreadsheet(tabs) },
    ...extra,
  };
  vm.createContext(sandbox);
  for (const file of files) vm.runInContext(readFileSync(file.startsWith('/') ? file : new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox, { filename: file });
  vm.runInContext(`todayNy_ = function () { return '${today}'; }; appendException_ = function () {};`, sandbox);
  return sandbox as Record<string, (...args: any[]) => any>;
}

export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
