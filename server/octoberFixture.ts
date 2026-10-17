import type { Grid } from './fakeSpreadsheet.ts';

/** October 2026 as it is on file mid-month: live-shaped synthetic figures for the month-end and history tests. */
export const LEDGER_HEAD = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
export const CLOSING_HEAD = ['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through', 'store'];
export const G17_DAY = (date: string) => `DATA_ANALYSIS_KPI_17_WRITTEN_${date}_${date}.xlsx`;
export const G17_SNAPSHOT = 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-10-13.xlsx';
// Live October purchasing customers per day (NWDSR Net Written # OF CUST).
export const CUSTOMERS: Record<string, number> = { '2026-10-02': 2, '2026-10-03': 6, '2026-10-04': 5, '2026-10-05': 2, '2026-10-06': 3, '2026-10-07': 2, '2026-10-08': 2, '2026-10-09': 5, '2026-10-10': 9, '2026-10-11': 6, '2026-10-12': 4, '2026-10-13': 4, '2026-10-14': 2, '2026-10-15': 2 };

export type Figures = { sales?: number; units?: number; eligible?: number; attachments?: number; percent?: number };
export const ledgerRow = (view: string, grain: string, start: string, end: string, through: string, side: string, f: Figures, source: string, code = '', name = '') =>
  [view, grain, grain === 'daily' ? start : '', start, end, through, '17', code, name, side, f.sales ?? '', f.units ?? '', f.eligible ?? '', f.attachments ?? '', f.percent ?? '', source, '2026-10-16T00:00:00Z', [view, grain, start, end, through, side, code || name || 'STORE'].join('|')];
export const closing = (date: string, scope: string, start: string, end: string, through: string, customers: number | '', opportunities: number | '', source: string, code = '', name = '') =>
  [date, scope, code, name, customers, opportunities, start, end, source, 'yes', '', through, '17'];

export function dates(start: string, end: string): string[] {
  const out: string[] = [];
  for (let at = new Date(`${start}T00:00:00Z`); at.toISOString().slice(0, 10) <= end; at.setUTCDate(at.getUTCDate() + 1)) out.push(at.toISOString().slice(0, 10));
  return out;
}

export const nwdsrWritten = (date: string) => 1000 + Number(date.slice(8)) + (date.slice(5, 7) === '11' ? 31 : 0);

/** October as it is on file on October 16: snapshots for the early days, daily reports after them. */
export function octoberBook(through = '2026-10-15'): Record<string, Grid> {
  const days = dates('2026-10-02', through);
  const ledger: Grid = [LEDGER_HEAD,
    ledgerRow('DA_SALES_STORE', 'cumulative', '2026-10-02', '2026-11-01', '2026-10-13', 'written', { sales: 10000, units: 10 }, G17_SNAPSHOT),
    ledgerRow('FABW_STORE', 'cumulative', '2026-10-02', '2026-11-01', '2026-10-13', 'written', { sales: 400, units: 8, eligible: 10, attachments: 8, percent: 0.8 }, G17_SNAPSHOT),
  ];
  days.filter((date) => date > '2026-10-13').forEach((date) => {
    ledger.push(ledgerRow('DA_SALES_STORE', 'daily', date, date, date, 'written', { sales: nwdsrWritten(date), units: 1 }, G17_DAY(date)));
    ledger.push(ledgerRow('FABW_STORE', 'daily', date, date, date, 'written', { sales: 50, units: 1, eligible: 2, attachments: 1, percent: 0.5 }, G17_DAY(date)));
  });
  const closingRows: Grid = [CLOSING_HEAD];
  days.forEach((date) => closingRows.push(closing(date, 'store', date, date, date, CUSTOMERS[date] ?? 2, '', 'NWDSR Net Written # OF CUST')));
  closingRows.push(closing('2026-10-14', 'store', '2026-10-02', '2026-10-14', '2026-10-14', 52, '', 'NWDSR Net Written # OF CUST'));
  closingRows.push(closing('2026-10-11', 'store', '2026-10-02', '2026-10-11', '2026-10-11', '', 87, 'PERQ Ups + Be Backs'));
  closingRows.push(closing('2026-10-13', 'store', '2026-10-02', '2026-10-13', '2026-10-13', '', 100, 'PERQ Ups + Be Backs'));
  closingRows.push(closing('2026-10-13', 'store', '2026-10-02', '2026-10-31', '2026-10-13', '', 100, 'PERQ Ups + Be Backs'));
  closingRows.push(closing('2026-10-01', 'store', '2026-10-01', '2026-10-01', '2026-10-01', '', 4, 'PERQ Ups + Be Backs'));
  for (const [date, count] of [['2026-10-12', 9], ['2026-10-13', 4], ['2026-10-14', 4], ['2026-10-15', 7]] as const) {
    if (date <= through) closingRows.push(closing(date, 'store', date, date, date, '', count, 'PERQ Ups + Be Backs'));
  }
  return {
    CC_Config: [['key', 'value'], ['store_period_start', '2026-10-02'], ['store_period_end', '2026-11-01'], ['prior_year_start', '2025-10-01'], ['prior_year_end', '2025-10-31']],
    CC_SellingDays: [['date', 'selling']],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-01', 777, '', ''], ...days.map((date) => [date, 900, nwdsrWritten(date), 500])],
    CC_AssociateDays: [['date', 'source_name', 'display_name', 'role', 'amount', 'sha256', 'note'],
      ['2026-10-01', 'MONTES, ERIC', 'Eric Montes Rodriguez', 'associate', 500, 'sha-snap-1001', ''],
      ['2026-10-02', 'DELSOLAR, RENZO', 'Renzo Del Solar', 'associate', -1330, 'sha-snap-1002', ''],
      ['2026-10-02', 'MONTES, ERIC', 'Eric Montes Rodriguez', 'associate', 450, 'sha-snap-1002', ''],
    ],
    CC_People: [['name', 'role', 'SNAP Written'], ['Renzo Del Solar', 'associate', 0], ['Eric Montes Rodriguez', 'associate', 0], ['Caroline Amaro', 'associate', 0], ['Cordell Primous', 'management', 0]],
    CC_Ledger: ledger,
    CC_Closing: closingRows,
    CC_History: [['archived_at', 'tab', 'record_key', 'reason', 'replaced_by', 'previous_row']],
  };
}

export function services() {
  const props: Record<string, string> = { closing_facts_v1: 'yes' };
  return { PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => props[key] ?? null, setProperty: (key: string, value: string) => { props[key] = value; } }) } };
}
