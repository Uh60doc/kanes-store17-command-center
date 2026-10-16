/**
 * STORE and PERSON tabs: calculated views of CC_Ledger that show only the records whose dates fit that tab's track.
 * CC_ScopeAudit lists every record kept on file whose dates or identifiers do not fit its scope.
 * Nothing here writes to CC_Ledger, CC_Closing or CC_Kpi.
 */

import { googleJson } from './google.ts';

export type Scope = 'STORE' | 'PERSON';

export const SCOPE_VIEWS = [
  'SNAP_STORE', 'SNAP_PERSON', 'NWDSR_WRITTEN_STORE', 'NWDSR_WRITTEN_PERSON',
  'NWDSR_DELIVERED_STORE', 'NWDSR_DELIVERED_PERSON', 'PERQ_STORE', 'PERQ_PERSON',
  'BEDDING_STORE', 'BEDDING_PERSON', 'MPPA_STORE', 'MPPA_PERSON', 'BASES_STORE', 'BASES_PERSON',
  'PILLOWS_STORE', 'PILLOWS_PERSON', 'FABW_STORE', 'FABW_PERSON', 'LTHW_STORE', 'LTHW_PERSON',
  'PWAR_STORE', 'PWAR_PERSON', 'UVWL_STORE', 'UVWL_PERSON', 'FINANCE_STORE', 'FINANCE_PERSON',
  'RUGS_STORE', 'RUGS_PERSON', 'AVERAGE_STORE', 'AVERAGE_PERSON',
] as const;

export const AUDIT_TAB = 'CC_ScopeAudit';
export const VIEW_EXTRA_HEADERS = ['scope', 'reporting_period_start', 'reporting_period_end', 'counting'] as const;
export const AUDIT_HEADERS = [
  'source_tab', 'sheet_row', 'record', 'scope', 'grain', 'report_date', 'period_start', 'period_end',
  'verified_through', 'store', 'employee_name', 'side', 'source_report', 'issue', 'handling',
] as const;

const LEDGER_WIDTH = 18;
const RULE: Record<Scope, string> = {
  STORE: 'store periods run the 2nd through the 1st of the next month',
  PERSON: 'individual periods run the 1st through the last day of the month',
};
const RANGE_NAME: Record<Scope, string> = { STORE: 'store', PERSON: 'individual' };

export function scopeOf(view: string): Scope | null {
  const match = /_(STORE|PERSON)$/.exec(view);
  return match ? (match[1] as Scope) : null;
}

const serial = (value: string) => `IF(ISNUMBER(${value}),INT(${value}),IFERROR(DATEVALUE(${value}),-1))`;
const iso = (value: string) => `TEXT(${value},"yyyy-mm-dd")`;
const trackStart = (scope: Scope, day: string) =>
  scope === 'STORE' ? `IF(DAY(${day})=1,EOMONTH(${day},-2)+2,EOMONTH(${day},-1)+2)` : `(EOMONTH(${day},-1)+1)`;
const trackEnd = (scope: Scope, day: string) =>
  scope === 'STORE' ? `(EDATE(${trackStart(scope, day)},1)-1)` : `EOMONTH(${day},0)`;
const fits = (scope: Scope, start: string, end: string) =>
  `IF(OR(${start}<0,${end}<0,${end}<${start}),FALSE,IF(${start}=${end},TRUE,AND(${start}=${trackStart(scope, start)},${end}<=${trackEnd(scope, start)})))`;
const quoted = (text: string) => `"${text.replaceAll('"', '""')}"`;
const messageRow = (message: string, width: number) => `HSTACK(${[message, ...Array(width - 1).fill('""')].join(',')})`;

function let_(bindings: [string, string][], body: string): string {
  return `LET(${bindings.map(([name, expression]) => `${name},${expression}`).join(',')},${body})`;
}

/**
 * One STORE or PERSON tab. Rows keep CC_Ledger's columns and order, followed by the scope, the reporting period
 * the record belongs to, and how it is counted. A snapshot replaces earlier snapshots; it is never added to them or
 * to the daily rows it already includes.
 */
export function viewFormula(view: string): string {
  const scope = scopeOf(view);
  if (!scope) throw new Error(`${view} has no STORE or PERSON scope.`);
  const width = LEDGER_WIDTH + VIEW_EXTRA_HEADERS.length;
  const none = scope === 'PERSON'
    ? `No salesperson report on file for ${view}. Pending. Store figures are not copied here.`
    : `No store report on file for ${view}. Pending.`;
  const excluded = `"No record on file covers a ${RANGE_NAME[scope]} period (${RULE[scope]}). "&(total-kept)&" record(s) with other date ranges are kept in CC_Ledger and listed on ${AUDIT_TAB}."`;
  const counting = 'MAP(SEQUENCE(ROWS(recs)),LAMBDA(idx,' + let_([
    ['kind', 'INDEX(gr,idx)'],
    ['st', 'INDEX(sday,idx)'],
    ['upto', 'INDEX(thru,idx)'],
    ['mine', 'ARRAYFORMULA(ok*(gr="cumulative")*(sd=INDEX(sd,idx))*(emp=INDEX(emp,idx))*(who=INDEX(who,idx)))'],
  ], 'IF(NOT(INDEX(ok,idx)),"",IF(kind="cumulative",' +
    let_([['top', 'MAX(FILTER(thru,mine*(sday=st)))'], ['ties', 'SUMPRODUCT(mine*(sday=st)*(thru=top))']],
      `IF(upto<top,"Earlier snapshot, replaced by the one through "&${iso('top')}&": not counted",` +
      `IF(ties>1,"Latest snapshot through "&${iso('top')}&": "&ties&" reports agree on this cutoff, use one, never add them",` +
      '"Latest snapshot for this period: use it alone, daily rows inside it are not added"))') + ',' +
    let_([['cover', `IFERROR(MAX(FILTER(thru,mine*(sday=${trackStart(scope, 'st')})*(thru>=st))),0)`]],
      `IF(cover>=st,"Daily, inside the snapshot through "&${iso('cover')}&": already in it, not added","Daily, after the latest snapshot: counted once")`) +
    '))') + '))';
  const body = let_([
    ['recs', `FILTER(CC_Ledger!$A$2:$R,CC_Ledger!$A$2:$A="${view}")`],
    ['gr', 'CHOOSECOLS(recs,2)'],
    ['emp', 'CHOOSECOLS(recs,8)'],
    ['who', 'CHOOSECOLS(recs,9)'],
    ['sd', 'CHOOSECOLS(recs,10)'],
    ['sday', `MAP(CHOOSECOLS(recs,4),LAMBDA(x,${serial('x')}))`],
    ['eday', `MAP(CHOOSECOLS(recs,5),LAMBDA(x,${serial('x')}))`],
    ['vday', `MAP(CHOOSECOLS(recs,6),LAMBDA(x,${serial('x')}))`],
    ['thru', 'MAP(vday,eday,LAMBDA(v,en,IF(v>0,v,en)))'],
    ['ok', `MAP(sday,eday,LAMBDA(st,en,${fits(scope, 'st', 'en')}))`],
    ['kept', 'SUMPRODUCT(--ok)'],
    ['pst', `MAP(sday,LAMBDA(st,IF(st<0,"",${iso(trackStart(scope, 'st'))})))`],
    ['pen', `MAP(sday,LAMBDA(st,IF(st<0,"",${iso(trackEnd(scope, 'st'))})))`],
    ['counting', counting],
  ], `IF(kept=0,VSTACK(hdr,${messageRow(excluded, width)}),VSTACK(hdr,FILTER(HSTACK(recs,MAP(sday,LAMBDA(x,"${scope}")),pst,pen,counting),ok)))`);
  return `=${let_([
    ['hdr', `HSTACK(CC_Ledger!$A$1:$R$1,${VIEW_EXTRA_HEADERS.map(quoted).join(',')})`],
    ['total', `COUNTIF(CC_Ledger!$A$2:$A,"${view}")`],
  ], `IF(total=0,VSTACK(hdr,${messageRow(quoted(none), width)}),${body})`)}`;
}

/** Issue text for one record's dates. Blank when the record fits its scope. */
function dateIssue(scopeName: string, start: string, end: string): string {
  const range = `IF(${start}<0,"(no start)",${iso(start)})&" to "&IF(${end}<0,"(no end)",${iso(end)})`;
  const wrong = (scope: Scope, other: Scope) =>
    `IF(${fits(scope, start, end)},"","Cumulative "&${range}&" does not fit a ${scope} period: ${RULE[scope]}."&IF(${fits(other, start, end)}," It matches the ${RANGE_NAME[other]} range.",""))`;
  return `IF(${scopeName}="","No STORE or PERSON scope.",IF(OR(${start}<0,${end}<0,${end}<${start}),"Dates missing or reversed: "&${range}&".",IF(${scopeName}="STORE",${wrong('STORE', 'PERSON')},${wrong('PERSON', 'STORE')})))`;
}

const blank = (value: string) => `TRIM(TO_TEXT(${value}))=""`;
const shown = (value: string) => `IF(ISNUMBER(${value}),${iso(value)},TO_TEXT(${value}))`;

/**
 * Every record whose dates do not fit its scope, or that lacks the store number, source or verified-through date.
 * The period start and end are the record's coverage, so a missing range is a date issue. Records are listed, never removed.
 */
export function auditFormula(): string {
  const ledger = let_([
    ['recs', 'FILTER(CC_Ledger!$A$2:$R,CC_Ledger!$A$2:$A<>"")'],
    ['rown', 'FILTER(ROW(CC_Ledger!$A$2:$A),CC_Ledger!$A$2:$A<>"")'],
    ['scp', 'MAP(CHOOSECOLS(recs,1),LAMBDA(x,IFERROR(REGEXEXTRACT(x,"_(STORE|PERSON)$"),"")))'],
    ['sday', `MAP(CHOOSECOLS(recs,4),LAMBDA(x,${serial('x')}))`],
    ['eday', `MAP(CHOOSECOLS(recs,5),LAMBDA(x,${serial('x')}))`],
    ['dissue', `MAP(scp,sday,eday,LAMBDA(sc,st,en,${dateIssue('sc', 'st', 'en')}))`],
    ['idissue', 'MAP(CHOOSECOLS(recs,2),CHOOSECOLS(recs,6),CHOOSECOLS(recs,7),CHOOSECOLS(recs,16),LAMBDA(gn,vt,sn,src,' +
      `TRIM(IF(AND(gn<>"daily",gn<>"cumulative"),"Grain is not daily or cumulative. ","")&IF(${blank('vt')},"No verified-through date. ","")&IF(TO_TEXT(sn)<>"17","Store is not 17. ","")&IF(${blank('src')},"No source report.",""))))`],
    ['handle', 'MAP(scp,dissue,LAMBDA(sc,di,IF(di="","Kept. Identifier missing; the figures are still read on their track.",' +
      `IF(sc="","Kept in CC_Ledger. Not on any STORE or PERSON tab.","Kept in CC_Ledger. Excluded from the "&sc&" tab and "&sc&" calculations."))))`],
  ], 'HSTACK(MAP(rown,LAMBDA(x,"CC_Ledger")),rown,CHOOSECOLS(recs,1),scp,CHOOSECOLS(recs,2),CHOOSECOLS(recs,3),CHOOSECOLS(recs,4),CHOOSECOLS(recs,5),CHOOSECOLS(recs,6),CHOOSECOLS(recs,7),CHOOSECOLS(recs,9),CHOOSECOLS(recs,10),CHOOSECOLS(recs,16),' +
    'MAP(dissue,idissue,LAMBDA(di,ii,TRIM(di&" "&ii))),handle)');

  const closing = let_([
    ['recs', 'FILTER(CC_Closing!$A$2:$M,CC_Closing!$B$2:$B<>"")'],
    ['rown', 'FILTER(ROW(CC_Closing!$B$2:$B),CC_Closing!$B$2:$B<>"")'],
    ['scp', 'MAP(CHOOSECOLS(recs,2),LAMBDA(x,IF(LOWER(TRIM(x))="store","STORE",IF(LOWER(TRIM(x))="person","PERSON",""))))'],
    ['sday', `MAP(CHOOSECOLS(recs,7),LAMBDA(x,${serial('x')}))`],
    ['eday', `MAP(CHOOSECOLS(recs,8),LAMBDA(x,${serial('x')}))`],
    ['dissue', `MAP(scp,sday,eday,LAMBDA(sc,st,en,${dateIssue('sc', 'st', 'en')}))`],
    ['idissue', 'MAP(CHOOSECOLS(recs,12),CHOOSECOLS(recs,13),CHOOSECOLS(recs,9),LAMBDA(vt,sn,src,' +
      `TRIM(IF(${blank('vt')},"No verified-through date. ","")&IF(TO_TEXT(sn)<>"17","Store is not 17. ","")&IF(${blank('src')},"No source.",""))))`],
    ['handle', 'MAP(scp,dissue,LAMBDA(sc,di,IF(di="","Kept. Identifier missing; the counts are still read on their track.","Kept in CC_Closing. Not counted in "&IF(sc="","any","the "&sc)&" closing ratio.")))'],
  ], 'HSTACK(MAP(rown,LAMBDA(x,"CC_Closing")),rown,CHOOSECOLS(recs,9),scp,MAP(sday,eday,LAMBDA(st,en,IF(st=en,"daily","cumulative"))),' +
    `MAP(CHOOSECOLS(recs,1),LAMBDA(x,${shown('x')})),MAP(CHOOSECOLS(recs,7),LAMBDA(x,${shown('x')})),MAP(CHOOSECOLS(recs,8),LAMBDA(x,${shown('x')})),MAP(CHOOSECOLS(recs,12),LAMBDA(x,${shown('x')})),CHOOSECOLS(recs,13),CHOOSECOLS(recs,4),MAP(rown,LAMBDA(x,"written")),CHOOSECOLS(recs,11),` +
    'MAP(dissue,idissue,LAMBDA(di,ii,TRIM(di&" "&ii))),handle)');

  // CC_Kpi holds store figures for the whole store month. Rows without a figure are notes, not records.
  const kpi = let_([
    ['recs', 'FILTER(CC_Kpi!$A$2:$G,CC_Kpi!$A$2:$A<>"")'],
    ['rown', 'FILTER(ROW(CC_Kpi!$A$2:$A),CC_Kpi!$A$2:$A<>"")'],
    ['sday', `MAP(CHOOSECOLS(recs,5),LAMBDA(x,${serial('x')}))`],
    ['eday', `MAP(CHOOSECOLS(recs,6),LAMBDA(x,${serial('x')}))`],
    ['figure', `MAP(CHOOSECOLS(recs,2),CHOOSECOLS(recs,3),LAMBDA(wr,dl,NOT(AND(${blank('wr')},${blank('dl')}))))`],
    ['dissue', `MAP(sday,eday,LAMBDA(st,en,${dateIssue('"STORE"', 'st', 'en')}))`],
    ['idissue', `MAP(figure,CHOOSECOLS(recs,7),LAMBDA(fg,vt,IF(AND(fg,${blank('vt')}),"No verified-through date.","")))`],
    ['handle', 'MAP(dissue,LAMBDA(di,IF(di="","Kept. Identifier missing; the figure is still read for the store month.","Kept in CC_Kpi. Not shown as a store-month figure.")))'],
  ], 'HSTACK(MAP(rown,LAMBDA(x,"CC_Kpi")),rown,CHOOSECOLS(recs,1),MAP(rown,LAMBDA(x,"STORE")),MAP(sday,eday,LAMBDA(st,en,IF(st=en,"daily","cumulative"))),' +
    `MAP(rown,LAMBDA(x,"")),MAP(CHOOSECOLS(recs,5),LAMBDA(x,${shown('x')})),MAP(CHOOSECOLS(recs,6),LAMBDA(x,${shown('x')})),MAP(CHOOSECOLS(recs,7),LAMBDA(x,${shown('x')})),MAP(rown,LAMBDA(x,"17")),MAP(rown,LAMBDA(x,"")),MAP(rown,LAMBDA(x,"")),MAP(rown,LAMBDA(x,"")),` +
    'MAP(dissue,idissue,LAMBDA(di,ii,TRIM(di&" "&ii))),handle)');

  const width = AUDIT_HEADERS.length;
  return `=${let_([
    ['hdr', `HSTACK(${AUDIT_HEADERS.map(quoted).join(',')})`],
    ['every', `VSTACK(${ledger},${closing},${kpi})`],
    ['flagged', 'IFERROR(FILTER(every,CHOOSECOLS(every,14)<>""),"")'],
  ], `IF(ROWS(flagged)*COLUMNS(flagged)=1,VSTACK(hdr,${messageRow('"No out-of-scope records."', width)}),VSTACK(hdr,flagged))`)}`;
}

interface SheetMeta {
  properties: { sheetId: number; title: string };
  protectedRanges?: { description?: string }[];
}

const PROTECTION = 'Calculated from CC_Ledger. Edit CC_Ledger, not this tab.';
const AUDIT_PROTECTION = 'Calculated from CC_Ledger, CC_Closing and CC_Kpi. Nothing here is removed from those tabs.';

/** Rewrite every STORE and PERSON tab and the audit tab. Creates any tab that is missing. Safe to run again. */
export async function installScopeViews(input: { accessToken: string; spreadsheetId: string }): Promise<{ created: string[] }> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${input.spreadsheetId}`;
  const fields = 'sheets(properties(sheetId,title),protectedRanges(description))';
  const metaOf = async () => (await googleJson({ accessToken: input.accessToken, url: `${base}?fields=${fields}` }) as { sheets: SheetMeta[] }).sheets;
  const titles: string[] = [...SCOPE_VIEWS, AUDIT_TAB];
  const before = new Set((await metaOf()).map((sheet) => sheet.properties.title));
  const created = titles.filter((title) => !before.has(title));
  if (created.length) {
    await googleJson({
      accessToken: input.accessToken,
      method: 'POST',
      url: `${base}:batchUpdate`,
      body: { requests: created.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) },
    });
  }
  const byTitle = new Map((await metaOf()).map((sheet) => [sheet.properties.title, sheet]));
  await googleJson({ accessToken: input.accessToken, method: 'POST', url: `${base}/values:batchClear`, body: { ranges: titles.map((title) => `${title}!A:Z`) } });
  await googleJson({
    accessToken: input.accessToken,
    method: 'POST',
    url: `${base}/values:batchUpdate`,
    body: {
      valueInputOption: 'USER_ENTERED',
      data: [
        ...SCOPE_VIEWS.map((view) => ({ range: `${view}!A1`, values: [[viewFormula(view)]] })),
        { range: `${AUDIT_TAB}!A1`, values: [[auditFormula()]] },
      ],
    },
  });
  const requests = titles.flatMap((title) => {
    const sheet = byTitle.get(title)!;
    const description = title === AUDIT_TAB ? AUDIT_PROTECTION : PROTECTION;
    return [
      { repeatCell: { range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      ...((sheet.protectedRanges ?? []).some((range) => range.description === description)
        ? []
        : [{ addProtectedRange: { protectedRange: { range: { sheetId: sheet.properties.sheetId }, description, warningOnly: true } } }]),
    ];
  });
  await googleJson({ accessToken: input.accessToken, method: 'POST', url: `${base}:batchUpdate`, body: { requests } });
  return { created };
}
