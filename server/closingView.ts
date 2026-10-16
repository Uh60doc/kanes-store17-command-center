/**
 * The store closing-ratio view: two calculated tabs whose formulas read CC_Closing directly.
 * CC_Closing keeps the raw report rows. Nothing here writes to it.
 */

import { googleJson } from './google.ts';

export const DAILY_TAB = 'CC_ClosingDaily';
export const MTD_TAB = 'CC_ClosingMTD';
export const NET_WRITTEN_SOURCE = 'NWDSR Net Written # OF CUST';
export const PERQ_SOURCE = 'PERQ Ups + Be Backs';

export const DAILY_HEADERS = [
  'Date',
  'NWDSR Written purchasing customers',
  'PERQ opportunities',
  'Closing ratio',
  'Store closing goal',
  'Difference from goal (pts)',
  'Versus goal',
  'Source reporting dates',
  'Verification status',
  'MTD purchasing customers',
  'MTD opportunities',
  'MTD closing ratio',
  'MTD difference from goal (pts)',
  'MTD versus goal',
  'MTD sources',
  'MTD verification status',
] as const;

export const MTD_LABELS = [
  'Period start',
  'Period end',
  'MTD through',
  'Purchasing customers',
  'Opportunities',
  'Closing ratio',
  'Store closing goal',
  'Difference from goal (pts)',
  'Versus goal',
  'Verification status',
  'Sources',
  'Latest daily date',
  'Latest daily purchasing customers',
  'Latest daily opportunities',
  'Latest daily closing ratio',
  'Latest daily difference from goal (pts)',
  'Latest daily versus goal',
  'Latest daily verification status',
  'Individual closing ratio',
] as const;

type Binding = [name: string, expression: string];

const source = (column: string) => `CC_Closing!$${column}$2:$${column}`;
const asDate = (range: string) => `IF(ISNUMBER(${range}),INT(${range}),IFERROR(DATEVALUE(${range}),-1))`;
const iso = (expression: string) => `TEXT(${expression},"yyyy-mm-dd")`;
const viewColumn = (column: string) => `FILTER($${column}$2:$${column},$A$2:$A<>"")`;

function let_(bindings: Binding[], body: string): string {
  return `LET(${bindings.map(([name, expression]) => `${name},${expression}`).join(',')},${body})`;
}

/** Day the view is calculated for. A fixed date is only for checking the formulas on a scratch copy. */
function today(asOf?: string): string {
  return asOf ? `DATEVALUE("${asOf}")` : 'TODAY()';
}

// Only final store-level rows count. A blank figure on a row that is on file is a complete report showing zero.
const FACTS: Binding[] = [
  ['pstart', `${MTD_TAB}!$B$2`],
  ['pend', `${MTD_TAB}!$B$3`],
  ['sdate', `ARRAYFORMULA(${asDate(source('G'))})`],
  ['edate', `ARRAYFORMULA(${asDate(source('H'))})`],
  ['vdate', `ARRAYFORMULA(${asDate(source('L'))})`],
  ['thru', 'ARRAYFORMULA(IF(vdate>0,vdate,edate))'],
  ['storerow', `ARRAYFORMULA((LOWER(TRIM(${source('B')}))="store")*(TRIM(${source('C')})="")*(LOWER(TRIM(${source('J')}))="yes")*(sdate>0)*(edate>=sdate))`],
  ['custrow', `ARRAYFORMULA(storerow*(TRIM(${source('I')})="${NET_WRITTEN_SOURCE}"))`],
  ['opprow', `ARRAYFORMULA(storerow*(TRIM(${source('I')})="${PERQ_SOURCE}"))`],
  ['cust', `ARRAYFORMULA(IFERROR(VALUE(${source('E')}),0))`],
  ['opp', `ARRAYFORMULA(IFERROR(VALUE(${source('F')}),0))`],
];

const CLOSED: Binding[] = [
  ['shutdate', `ARRAYFORMULA(${asDate('CC_SellingDays!$A$2:$A')})`],
  ['shut', 'ARRAYFORMULA(REGEXMATCH(LOWER(TRIM(CC_SellingDays!$B$2:$B&"")),"^(n|no|closed|false|0)$"))'],
];

const GOAL: Binding = ['goal', 'IFERROR(VALUE(VLOOKUP("closing_goal",CC_Config!$A:$B,2,FALSE)),0.5)'];
const DAYS: Binding = ['dlist', viewColumn('A')];

function dateColumn(asOf?: string): string {
  const body = let_([
    ...FACTS,
    ['reported', 'IFERROR(MAX(FILTER(sdate,(custrow+opprow)*(sdate=edate)*(sdate>=pstart)*(sdate<=pend))),0)'],
    ['lastday', `MIN(pend,MAX(reported,${today(asOf)}-1))`],
  ], 'IF(lastday<pstart,pstart,SEQUENCE(lastday-pstart+1,1,pstart))');
  return `=${body}`;
}

/** One report date's count: Pending when no report is on file, Reconcile when two reports for that date disagree. */
function dailyCount(rows: 'custrow' | 'opprow', values: 'cust' | 'opp'): string {
  return `=${let_([...FACTS, ...CLOSED, DAYS], `MAP(dlist,LAMBDA(rday,LET(hit,ARRAYFORMULA(${rows}*(sdate=rday)*(edate=rday)),IF(SUM(hit)=0,IF(SUMPRODUCT((shutdate=rday)*shut)>0,"Closed","Pending"),LET(v,FILTER(${values},hit),IF(MAX(v)<>MIN(v),"Reconcile",MAX(v)))))))`)}`;
}

function ratioColumn(customers: string, opportunities: string): string {
  return `=MAP(${viewColumn(customers)},${viewColumn(opportunities)},LAMBDA(cu,op,IF(AND(ISNUMBER(cu),ISNUMBER(op)),IF(op=0,"No opportunities",cu/op),IF(OR(cu="Reconcile",op="Reconcile"),"Reconcile",IF(AND(cu="Closed",op="Closed"),"Closed","Pending")))))`;
}

function goalColumn(): string {
  return `=${let_([GOAL, DAYS], 'MAP(dlist,LAMBDA(rday,goal))')}`;
}

function pointsColumn(ratio: string): string {
  return `=${let_([GOAL], `MAP(${viewColumn(ratio)},LAMBDA(ra,IF(ISNUMBER(ra),(ROUND(ra*1000)-ROUND(goal*1000))/10,"")))`)}`;
}

function versusColumn(ratio: string): string {
  return `=${let_([GOAL], `MAP(${viewColumn(ratio)},LAMBDA(ra,IF(ISNUMBER(ra),IF(ra>1,"Reconcile",IF(ROUND(ra*1000)=ROUND(goal*1000),"On Target",IF(ROUND(ra*1000)>ROUND(goal*1000),"Above Goal","Below Goal"))),ra)))`)}`;
}

function sourceDatesColumn(): string {
  const side = (label: string, value: string) => `"${label} "&IF(OR(ISNUMBER(${value}),${value}="Reconcile"),${iso('rday')},IF(${value}="Closed","closed","not received"))`;
  return `=MAP(${viewColumn('A')},${viewColumn('B')},${viewColumn('C')},LAMBDA(rday,cu,op,${side('NWDSR Written', 'cu')}&" · "&${side('PERQ', 'op')}))`;
}

function dailyStatusColumn(): string {
  return `=MAP(${viewColumn('B')},${viewColumn('C')},${viewColumn('D')},LAMBDA(cu,op,ra,` +
    'IF(AND(cu="Closed",op="Closed"),"Closed",' +
    'IF(OR(cu="Reconcile",op="Reconcile"),"Reconcile: reports disagree",' +
    'IF(AND(NOT(ISNUMBER(cu)),NOT(ISNUMBER(op))),"Pending: NWDSR Written and PERQ",' +
    'IF(NOT(ISNUMBER(cu)),"Pending: NWDSR Written",' +
    'IF(NOT(ISNUMBER(op)),"Pending: PERQ",' +
    'IF(op=0,"Verified: no opportunities",' +
    'IF(ra>1,"Reconcile: above 100%","Verified")))))))))';
}

type Mode = 'value' | 'source' | 'provisional';

/**
 * Customers through a date: the Net Written report printed for the store month through exactly that date,
 * otherwise the sum of every daily report. A cumulative count is never added to daily counts.
 */
function customersThrough(mode: Mode): string {
  const fromReport = {
    value: 'IF(MAX(v)<>MIN(v),"Reconcile",MAX(v))',
    source: `IF(MAX(v)<>MIN(v),"NWDSR Written reports through "&${iso('rday')}&" disagree","NWDSR Written report "&${iso('pstart')}&" to "&${iso('rday')}&" ("&MAX(v)&")")`,
    provisional: 'MAX(FILTER(edate,cum))>rday',
  }[mode];
  const fromDaily = {
    value: 'IF(full,SUM(b),"Pending")',
    source: `IF(full,"NWDSR Written daily reports "&${iso('pstart')}&" to "&${iso('rday')}&" ("&SUM(b)&")","NWDSR Written pending")`,
    provisional: 'FALSE',
  }[mode];
  return `MAP(dlist,LAMBDA(rday,LET(cum,ARRAYFORMULA(custrow*(sdate=pstart)*(edate>sdate)*(thru=rday)),b,FILTER(bcol,dlist<=rday),full,SUMPRODUCT(ISNUMBER(b)+(b="Closed"))=ROWS(b),IF(SUM(cum)>0,LET(v,FILTER(cust,cum),${fromReport}),${fromDaily}))))`;
}

/**
 * Opportunities through a date: the latest store-month PERQ snapshot verified on or before that date, plus each
 * later day's own PERQ count. Only one snapshot is used. Without a snapshot, every day needs its own PERQ count.
 * The cutoff is unconfirmed only when no snapshot of the same count ends on its verified date.
 */
function opportunitiesThrough(mode: Mode): string {
  const dailyOnly = {
    value: 'IF(full,SUM(cs),"Pending")',
    source: `IF(full,"PERQ daily reports "&${iso('pstart')}&" to "&${iso('rday')}&" ("&SUM(cs)&")","PERQ pending")`,
    provisional: 'FALSE',
  }[mode];
  const disagree = { value: '"Reconcile"', source: `"PERQ snapshots through "&${iso('snapthru')}&" disagree"`, provisional: 'FALSE' }[mode];
  const snapOnly = {
    value: 'MAX(v)',
    source: `"PERQ snapshot "&${iso('pstart')}&" to "&${iso('snapthru')}&" ("&MAX(v)&")"`,
    provisional: 'snapend>snapthru',
  }[mode];
  const snapPlus = {
    value: 'MAX(v)+SUM(after)',
    source: `"PERQ snapshot "&${iso('pstart')}&" to "&${iso('snapthru')}&" ("&MAX(v)&") + daily "&${iso('snapthru+1')}&" to "&${iso('rday')}&" ("&SUM(after)&")"`,
    provisional: 'snapend>snapthru',
  }[mode];
  return 'MAP(dlist,LAMBDA(rday,LET(' +
    'cs,FILTER(ccol,dlist<=rday),full,SUMPRODUCT(ISNUMBER(cs)+(cs="Closed"))=ROWS(cs),' +
    'snap,ARRAYFORMULA(opprow*(sdate=pstart)*(edate>sdate)*(thru>=pstart)*(thru<=rday)),' +
    `IF(SUM(snap)=0,${dailyOnly},LET(snapthru,MAX(FILTER(thru,snap)),at,ARRAYFORMULA(snap*(thru=snapthru)),v,FILTER(opp,at),snapend,MIN(FILTER(edate,at)),` +
    `IF(MAX(v)<>MIN(v),${disagree},IF(snapthru=rday,${snapOnly},LET(after,FILTER(ccol,dlist>snapthru,dlist<=rday),` +
    `IF(SUMPRODUCT(ISNUMBER(after)+(after="Closed"))=ROWS(after),${snapPlus},${dailyOnly})))))))))`;
}

const MTD_INPUTS: Binding[] = [...FACTS, DAYS, ['bcol', viewColumn('B')], ['ccol', viewColumn('C')]];

function mtdStatusColumn(): string {
  return `=${let_([...MTD_INPUTS, ['provcust', customersThrough('provisional')], ['provopp', opportunitiesThrough('provisional')]],
    `MAP(${viewColumn('J')},${viewColumn('K')},${viewColumn('L')},provcust,provopp,LAMBDA(cu,op,ra,pcu,pop,` +
    'IF(OR(cu="Reconcile",op="Reconcile"),"Reconcile: reports disagree",' +
    'IF(AND(NOT(ISNUMBER(cu)),NOT(ISNUMBER(op))),"Pending: NWDSR Written and PERQ",' +
    'IF(NOT(ISNUMBER(cu)),"Pending: NWDSR Written",' +
    'IF(NOT(ISNUMBER(op)),"Pending: PERQ",' +
    'IF(op=0,"Verified: no opportunities",' +
    'IF(ra>1,"Reconcile: above 100%",' +
    'IF(AND(pcu,pop),"Provisional: NWDSR Written and PERQ cutoffs unconfirmed",' +
    'IF(pop,"Provisional: PERQ cutoff unconfirmed",' +
    'IF(pcu,"Provisional: NWDSR Written cutoff unconfirmed","Verified")))))))))))')}`;
}

export function dailyFormulas(asOf?: string): string[] {
  return [
    dateColumn(asOf),
    dailyCount('custrow', 'cust'),
    dailyCount('opprow', 'opp'),
    ratioColumn('B', 'C'),
    goalColumn(),
    pointsColumn('D'),
    versusColumn('D'),
    sourceDatesColumn(),
    dailyStatusColumn(),
    `=${let_(MTD_INPUTS, customersThrough('value'))}`,
    `=${let_(MTD_INPUTS, opportunitiesThrough('value'))}`,
    ratioColumn('J', 'K'),
    pointsColumn('L'),
    versusColumn('L'),
    `=${let_([...MTD_INPUTS, ['custsrc', customersThrough('source')], ['oppsrc', opportunitiesThrough('source')]], 'MAP(custsrc,oppsrc,LAMBDA(cs,os,cs&" · "&os))')}`,
    mtdStatusColumn(),
  ];
}

export function mtdRows(asOf?: string): string[][] {
  const daily = (column: string) => `${DAILY_TAB}!$${column}$2:$${column}`;
  const at = (row: number, column: string) => `=IF(ISNUMBER($B$${row}),XLOOKUP($B$${row},${daily('A')},${daily(column)}),"Pending")`;
  const now = today(asOf);
  const values: [string, string][] = [
    [`=IF(DAY(${now})=1,EOMONTH(${now},-2)+2,EOMONTH(${now},-1)+2)`, 'Store month: the 2nd through the 1st of the next month.'],
    ['=EDATE($B$2,1)-1', ''],
    [`=IFERROR(MAX(FILTER(${daily('A')},ISNUMBER(${daily('J')}),ISNUMBER(${daily('K')}))),"Pending")`, `Latest date on ${DAILY_TAB} with both month-to-date counts.`],
    [at(4, 'J'), 'NWDSR Net Written # OF CUST.'],
    [at(4, 'K'), 'PERQ Ups + Be Backs.'],
    [at(4, 'L'), 'Purchasing customers ÷ opportunities.'],
    [`=${let_([GOAL], 'goal')}`, 'CC_Config closing_goal.'],
    [at(4, 'M'), 'Percentage points, using the ratio to one decimal.'],
    [at(4, 'N'), ''],
    [at(4, 'P'), ''],
    [at(4, 'O'), ''],
    [`=IFERROR(MAX(FILTER(${daily('A')},ISNUMBER(${daily('D')}))),"Pending")`, 'Latest date with both daily reports and at least one opportunity.'],
    [at(13, 'B'), ''],
    [at(13, 'C'), ''],
    [at(13, 'D'), ''],
    [at(13, 'F'), ''],
    [at(13, 'G'), ''],
    [at(13, 'I'), ''],
    ['See the dashboard Closing page', 'Individual closing = Data Analysis Group 17 Written order count ÷ the salesperson\'s PERQ Ups + Be Backs, both from the 1st through the same verified date. Store customers are not divided among salespeople.'],
  ];
  return [['Metric', 'Value', 'Basis'], ...MTD_LABELS.map((label, index) => [label, values[index][0], values[index][1]])];
}

interface SheetMeta {
  properties: { sheetId: number; title: string };
  protectedRanges?: { description?: string }[];
}

const PROTECTION = 'Calculated from CC_Closing. Edit CC_Closing, not this tab.';

/** Create or rewrite both view tabs. Safe to run again. */
export async function installClosingView(input: { accessToken: string; spreadsheetId: string; asOf?: string }): Promise<{ created: string[] }> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}`;
  const meta = await googleJson({ accessToken: input.accessToken, url: `${base}?fields=sheets(properties(sheetId,title),protectedRanges(description))` }) as { sheets: SheetMeta[] };
  const existing = new Map(meta.sheets.map((sheet) => [sheet.properties.title, sheet]));
  const created = [MTD_TAB, DAILY_TAB].filter((title) => !existing.has(title));
  if (created.length) {
    await googleJson({
      accessToken: input.accessToken,
      method: 'POST',
      url: `${base}:batchUpdate`,
      body: { requests: created.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
    });
  }
  const after = await googleJson({ accessToken: input.accessToken, url: `${base}?fields=sheets(properties(sheetId,title),protectedRanges(description))` }) as { sheets: SheetMeta[] };
  const byTitle = new Map(after.sheets.map((sheet) => [sheet.properties.title, sheet]));
  const dailyId = byTitle.get(DAILY_TAB)!.properties.sheetId;
  const mtdId = byTitle.get(MTD_TAB)!.properties.sheetId;

  await googleJson({ accessToken: input.accessToken, method: 'POST', url: `${base}/values:batchClear`, body: { ranges: [`${DAILY_TAB}!A:Z`, `${MTD_TAB}!A:Z`] } });
  await googleJson({
    accessToken: input.accessToken,
    method: 'POST',
    url: `${base}/values:batchUpdate`,
    body: {
      valueInputOption: 'USER_ENTERED',
      data: [
        { range: `${MTD_TAB}!A1`, values: mtdRows(input.asOf) },
        { range: `${DAILY_TAB}!A1`, values: [[...DAILY_HEADERS], dailyFormulas(input.asOf)] },
      ],
    },
  });

  const format = (sheetId: number, startColumn: number, endColumn: number, pattern: { type: string; pattern: string }, startRow = 1, endRow?: number) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: startRow, ...(endRow ? { endRowIndex: endRow } : {}), startColumnIndex: startColumn, endColumnIndex: endColumn },
      cell: { userEnteredFormat: { numberFormat: pattern } },
      fields: 'userEnteredFormat.numberFormat',
    },
  });
  const date = { type: 'DATE', pattern: 'yyyy-mm-dd' };
  const percent = { type: 'PERCENT', pattern: '0.0%' };
  const points = { type: 'NUMBER', pattern: '+0.0" pts";-0.0" pts";0.0" pts"' };
  const requests: unknown[] = [
    format(dailyId, 0, 1, date),
    format(dailyId, 3, 5, percent),
    format(dailyId, 5, 6, points),
    format(dailyId, 11, 12, percent),
    format(dailyId, 12, 13, points),
    format(mtdId, 1, 2, date, 1, 4),
    format(mtdId, 1, 2, percent, 6, 8),
    format(mtdId, 1, 2, points, 8, 9),
    format(mtdId, 1, 2, date, 12, 13),
    format(mtdId, 1, 2, percent, 15, 16),
    format(mtdId, 1, 2, points, 16, 17),
    ...[dailyId, mtdId].map((sheetId) => ({
      repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' },
    })),
    ...[DAILY_TAB, MTD_TAB]
      .filter((title) => !(byTitle.get(title)!.protectedRanges ?? []).some((range) => range.description === PROTECTION))
      .map((title) => ({ addProtectedRange: { protectedRange: { range: { sheetId: byTitle.get(title)!.properties.sheetId }, description: PROTECTION, warningOnly: true } } })),
  ];
  await googleJson({ accessToken: input.accessToken, method: 'POST', url: `${base}:batchUpdate`, body: { requests } });
  return { created };
}
