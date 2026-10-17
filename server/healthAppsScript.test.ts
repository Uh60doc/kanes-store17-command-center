import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Grid = (string | number)[][];

function load(tabs: Record<string, Grid>, today: string) {
  const sheet = (name: string) => ({
    getDataRange: () => ({ getValues: () => tabs[name].map((row) => [...row]) }),
    getRange: (row: number, column: number) => ({ setValue: (value: string) => { tabs[name][row - 1][column - 1] = value; } }),
    appendRow: (values: (string | number)[]) => { tabs[name].push([...values]); },
  });
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null) }) },
  };
  vm.createContext(sandbox);
  for (const file of ['Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox);
  vm.runInContext(`todayNy_ = function () { return '${today}'; }; notifyOnce_ = function () {};`, sandbox);
  return sandbox as Record<string, (...args: unknown[]) => unknown>;
}

const health = (tabs: Record<string, Grid>) => Object.fromEntries(tabs.CC_Health.slice(1).map((row) => [row[0], row[1]]));

test('the health check records the latest day with all three daily reports on file', () => {
  const tabs: Record<string, Grid> = {
    CC_Daily: [
      ['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'],
      ['2026-10-14', 2795, 2795, 4113],
      ['2026-10-15', 1410, 1410, 10541],
      ['2026-10-16', 900, '', ''],
    ],
    CC_Health: [['key', 'value'], ['status', 'Current'], ['latest_report_day', '2026-10-14']],
    CC_Exceptions: [['at', 'severity', 'message']],
  };
  load(tabs, '2026-10-16').markMissingReports_();
  assert.equal(health(tabs).latest_report_day, '2026-10-15');
  assert.equal(health(tabs).status, 'Current');
});

test('a missing report leaves the latest complete day in place', () => {
  const tabs: Record<string, Grid> = {
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-14', 2795, 2795, 4113]],
    CC_Health: [['key', 'value'], ['status', 'Current']],
    CC_Exceptions: [['at', 'severity', 'message']],
  };
  load(tabs, '2026-10-16').markMissingReports_();
  assert.equal(health(tabs).latest_report_day, '2026-10-14');
  assert.equal(health(tabs).status, 'Report Missing');
});
