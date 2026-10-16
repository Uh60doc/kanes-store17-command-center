import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Grid = (string | number)[][];

const LEDGER_HEAD = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
const CLOSING_HEAD = ['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through', 'store'];

const daily = (view: string, date: string, side: string, figures: { sales?: number; eligible?: number; attachments?: number; percent?: number }, code = '', name = '') =>
  [view, 'daily', date, date, date, date, '17', code, name, side, figures.sales ?? '', '', figures.eligible ?? '', figures.attachments ?? '', figures.percent ?? '', 'file', '', `${view}|${date}|${code || name}`];
const cumulative = (view: string, start: string, end: string, through: string, side: string, figures: { sales?: number; eligible?: number; attachments?: number; percent?: number }, code = '', name = '') =>
  [view, 'cumulative', '', start, end, through, '17', code, name, side, figures.sales ?? '', '', figures.eligible ?? '', figures.attachments ?? '', figures.percent ?? '', 'final.xlsx', '', `${view}|${start}|${end}|${code || name}`];

function dates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let at = new Date(`${start}T00:00:00Z`); at.toISOString().slice(0, 10) <= end; at.setUTCDate(at.getUTCDate() + 1)) out.push(at.toISOString().slice(0, 10));
  return out;
}

function load(tabs: Record<string, Grid>, today: string) {
  const sheet = (name: string) => ({
    getDataRange: () => ({ getValues: () => tabs[name].map((row) => [...row]) }),
    clearContents: () => { tabs[name] = []; },
    getRange: (row: number, column: number) => ({
      setValues: (values: Grid) => values.forEach((line, r) => { tabs[name][row - 1 + r] = [...line]; void column; }),
    }),
  });
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null),
        insertSheet: (name: string) => { tabs[name] = []; return sheet(name); },
      }),
    },
  };
  vm.createContext(sandbox);
  for (const file of ['Data.gs', 'Ledger.gs', 'MonthEnd.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox);
  vm.runInContext(`todayNy_ = function () { return '${today}'; };`, sandbox);
  return sandbox as Record<string, (...args: unknown[]) => any>;
}

const HEADERS = ['track', 'period_start', 'period_end', 'metric', 'side', 'person', 'unit', 'daily_tracked', 'daily_basis', 'official_final', 'official_basis', 'variance', 'status'];

function rows(tabs: Record<string, Grid>, today: string) {
  const gs = load(tabs, today);
  gs.refreshMonthEnd_();
  const grid = tabs.CC_MonthEnd;
  assert.deepEqual(grid[0], HEADERS);
  return grid.slice(1).map((row) => Object.fromEntries(HEADERS.map((name, index) => [name, row[index]])));
}

function october(throughStore: string): Record<string, Grid> {
  const ledger: Grid = [LEDGER_HEAD];
  const closing: Grid = [CLOSING_HEAD];
  dates('2026-10-02', throughStore).forEach((date, index) => {
    ledger.push(daily('NWDSR_WRITTEN_STORE', date, 'written', { sales: 1000 + index }));
    ledger.push(daily('FINANCE_STORE', date, 'written', { percent: 0.25 }));
    closing.push([date, 'store', '', '', 2, '', date, date, 'NWDSR Net Written # OF CUST', 'yes', '', date, '17']);
  });
  ledger.push(cumulative('NWDSR_WRITTEN_STORE', '2026-10-02', '2026-10-31', '2026-10-13', 'written', { sales: 99 }));
  return { CC_Ledger: ledger, CC_Closing: closing, CC_SellingDays: [['date', 'selling']] };
}

test('during the month the daily total is in progress and a partial snapshot is not the official final', () => {
  const result = rows(october('2026-10-15'), '2026-10-16');
  const written = result.find((row) => row.track === 'Store' && row.metric === 'NWDSR Written')!;
  assert.equal(written.period_start, '2026-10-02');
  assert.equal(written.period_end, '2026-11-01');
  assert.equal(written.daily_tracked, 14 * 1000 + 91);
  assert.equal(written.daily_basis, '14 of 14 open days so far');
  assert.equal(written.official_final, 'Pending');
  assert.equal(written.variance, '');
  assert.equal(written.status, 'In progress: official final after 2026-11-01');
  const finance = result.find((row) => row.metric === 'Finance')!;
  assert.equal(finance.daily_tracked, 'Pending');
  assert.match(String(finance.daily_basis), /not summed/);
  const customers = result.find((row) => row.track === 'Store' && row.metric === 'Purchasing customers')!;
  assert.equal(customers.daily_tracked, 28);
  assert.equal(result.find((row) => row.track === 'Person' && row.metric === 'Purchasing customers'), undefined);
  const individual = result.find((row) => row.track === 'Person' && row.metric === 'Closing numerator')!;
  assert.match(String(individual.daily_basis), /Group 17 Written order count/);
});

test('after the month the official final sits beside the daily total and the variance is final minus daily', () => {
  const tabs = october('2026-11-01');
  const tracked = dates('2026-10-02', '2026-11-01').reduce((total, _date, index) => total + 1000 + index, 0);
  tabs.CC_Ledger.push(cumulative('NWDSR_WRITTEN_STORE', '2026-10-02', '2026-11-01', '2026-11-01', 'written', { sales: tracked - 120 }));
  tabs.CC_Closing.push(['2026-11-01', 'store', '', '', 60, '', '2026-10-02', '2026-11-01', 'NWDSR Net Written # OF CUST', 'yes', '', '2026-11-01', '17']);
  const result = rows(tabs, '2026-11-03');
  const written = result.find((row) => row.track === 'Store' && row.period_start === '2026-10-02' && row.metric === 'NWDSR Written')!;
  assert.equal(written.daily_tracked, tracked, 'the final is never added to the daily total');
  assert.equal(written.official_final, tracked - 120);
  assert.equal(written.variance, -120);
  assert.equal(written.status, 'Variance: official final differs from daily tracked');
  const customers = result.find((row) => row.track === 'Store' && row.period_start === '2026-10-02' && row.metric === 'Purchasing customers')!;
  assert.deepEqual([customers.daily_tracked, customers.official_final, customers.variance], [62, 60, -2]);

  tabs.CC_Ledger = tabs.CC_Ledger.filter((row) => !(row[0] === 'NWDSR_WRITTEN_STORE' && row[2] === '2026-10-20'));
  const missing = rows(tabs, '2026-11-03').find((row) => row.track === 'Store' && row.period_start === '2026-10-02' && row.metric === 'NWDSR Written')!;
  assert.equal(missing.variance, '');
  assert.equal(missing.status, 'Daily incomplete: 30 of 31 open days in the period');
});

test('a salesperson is counted for a PERQ day only when that day\'s salesperson rows add up to the store count', () => {
  const ledger: Grid = [LEDGER_HEAD];
  const store = { '2026-10-14': 4, '2026-10-15': 7 } as Record<string, number>;
  for (const [date, count] of Object.entries(store)) ledger.push(daily('PERQ_STORE', date, '', { eligible: count }));
  ledger.push(daily('PERQ_PERSON', '2026-10-14', '', { eligible: 4 }, 'RDELSO', 'Renzo Del Solar'));
  ledger.push(daily('PERQ_PERSON', '2026-10-15', '', { eligible: 3 }, 'EMON0904', 'Eric Montes Rodriguez'));
  ledger.push(daily('PERQ_PERSON', '2026-10-15', '', { eligible: 3 }, 'TNASSI', 'Ricky Nassif'));
  ledger.push(cumulative('PERQ_PERSON', '2026-10-01', '2026-10-31', '2026-10-13', '', { eligible: 31 }, 'PGANDH', 'Prakash Gandhi'));
  const result = rows({ CC_Ledger: ledger, CC_Closing: [CLOSING_HEAD], CC_SellingDays: [['date', 'selling']] }, '2026-10-16');
  const person = (name: string) => result.find((row) => row.track === 'Person' && row.metric === 'PERQ opportunities' && row.person === name)!;
  assert.deepEqual([person('Eric Montes Rodriguez').daily_tracked, person('Eric Montes Rodriguez').daily_basis], [3, '2 of 15 open days so far'], 'October 14 adds up to the store count, so Eric had 0 that day');
  assert.deepEqual([person('Renzo Del Solar').daily_tracked, person('Renzo Del Solar').daily_basis], [4, '1 of 15 open days so far']);
  assert.deepEqual([person('Prakash Gandhi').daily_tracked, person('Prakash Gandhi').daily_basis], [0, '1 of 15 open days so far']);
  assert.equal(person('Prakash Gandhi').official_final, 'Pending', 'a snapshot through October 13 is not the October final');
  const storeRow = result.find((row) => row.track === 'Store' && row.metric === 'PERQ opportunities')!;
  assert.equal(storeRow.daily_tracked, 11);
  const ratio = result.find((row) => row.metric === 'Closing ratio')!;
  assert.equal(ratio.daily_tracked, 'Pending');
  assert.match(String(ratio.status), /^Daily incomplete/);
});

test('an attachment rate is attachments over eligible, and zero eligible is not divided', () => {
  const ledger: Grid = [LEDGER_HEAD,
    daily('FABW_STORE', '2026-10-14', 'written', { eligible: 4, attachments: 3 }),
    daily('FABW_STORE', '2026-10-15', 'written', { eligible: 1, attachments: 1 }),
    daily('LTHW_STORE', '2026-10-15', 'written', { eligible: 0, attachments: 0 }),
  ];
  const result = rows({ CC_Ledger: ledger, CC_Closing: [CLOSING_HEAD], CC_SellingDays: [['date', 'selling']] }, '2026-10-16');
  const fabric = result.find((row) => row.metric === 'Fabric protection')!;
  assert.equal(fabric.daily_tracked, 0.8);
  assert.match(String(fabric.daily_basis), /^4 of 5 eligible; 2 of 14 open days so far$/);
  assert.equal(result.find((row) => row.metric === 'Leather protection')!.daily_tracked, 'No eligible sales');
});
