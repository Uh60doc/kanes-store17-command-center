import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

type Grid = (string | number)[][];

const LEDGER_HEAD = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
const SNAPSHOT = 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-01_2026-10-13.xlsx';
const DAY = (date: string) => `DATA_ANALYSIS_KPI_17_WRITTEN_${date}_${date}.xlsx`;

type Figures = { sales?: number; units?: number; eligible?: number; attachments?: number; percent?: number };
const row = (view: string, grain: string, start: string, end: string, code: string, name: string, figures: Figures, source: string, side = 'written') =>
  [view, grain, grain === 'daily' ? start : '', start, end, end, '17', code, name, side, figures.sales ?? '', figures.units ?? '', figures.eligible ?? '', figures.attachments ?? '', figures.percent ?? '', source, '', `${view}|${grain}|${start}|${end}|${code || 'STORE'}|${side}`];

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function load(tabs: Record<string, Grid>, today: string) {
  const sheet = (name: string) => ({ getDataRange: () => ({ getValues: () => tabs[name].map((line) => [...line]) }) });
  const sandbox: Record<string, unknown> = {
    SPREADSHEET_ID_: 'test',
    Utilities: { formatDate: (date: Date) => date.toISOString().slice(0, 10) },
    SpreadsheetApp: { openById: () => ({ getSheetByName: (name: string) => (tabs[name] ? sheet(name) : null) }) },
  };
  vm.createContext(sandbox);
  for (const file of ['Data.gs', 'Metrics.gs', 'Roster.gs', 'Ledger.gs', 'KpiImport.gs']) vm.runInContext(readFileSync(new URL(`../apps-script/${file}`, import.meta.url), 'utf8'), sandbox);
  vm.runInContext(`todayNy_ = function () { return '${today}'; };`, sandbox);
  return sandbox as Record<string, (...args: unknown[]) => any>;
}

function october(): Record<string, Grid> {
  return {
    CC_Ledger: [
      LEDGER_HEAD,
      row('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 31794.47, units: 11 }, SNAPSHOT),
      row('DA_SALES_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'TNASSI', 'Ricky Nassif', { sales: 16804.84, units: 8 }, SNAPSHOT),
      row('BEDDING_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 11018.52, percent: 0.347 }, SNAPSHOT),
      row('MPPA_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 29.99, units: 1, eligible: 3, attachments: 1 }, SNAPSHOT),
      row('FINANCE_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { percent: 0.5 }, SNAPSHOT),
      row('FINANCE_PERSON', 'cumulative', '2026-10-01', '2026-10-13', 'TNASSI', 'Ricky Nassif', { percent: 0.25 }, SNAPSHOT),
      row('MPPA_PERSON', 'cumulative', '2026-10-02', '2026-10-11', 'EMON0904', 'Eric Montes Rodriguez', { units: 1, eligible: 9, attachments: 1 }, 'MPPA_WRITTEN__10.pdf'),
      row('DA_SALES_PERSON', 'cumulative', '2026-10-02', '2026-11-01', 'EMON0904', 'Eric Montes Rodriguez', { sales: 99999, units: 50 }, 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-11-01.xlsx'),
      row('DA_SALES_STORE', 'daily', '2026-10-13', '2026-10-13', '', '', { sales: 7106, units: 4 }, DAY('2026-10-13')),
      row('DA_SALES_PERSON', 'daily', '2026-10-13', '2026-10-13', 'EMON0904', 'Eric Montes Rodriguez', { sales: 5000, units: 2 }, DAY('2026-10-13')),
      row('DA_SALES_STORE', 'daily', '2026-10-14', '2026-10-14', '', '', { sales: 2476, units: 2 }, DAY('2026-10-14')),
      row('DA_SALES_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', { sales: 2476, units: 2 }, DAY('2026-10-14')),
      row('FINANCE_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', { percent: 1 }, DAY('2026-10-14')),
      row('DA_SALES_STORE', 'daily', '2026-10-16', '2026-10-16', '', '', { sales: 900, units: 1 }, DAY('2026-10-16')),
      row('DA_SALES_PERSON', 'daily', '2026-10-16', '2026-10-16', 'TNASSI', 'Ricky Nassif', { sales: 900, units: 1 }, DAY('2026-10-16')),
    ],
    CC_AssociateDays: [['date', 'display_name', 'amount', 'note', 'role'], ['2026-10-14', 'Ricky Nassif', 2795, '', 'associate'], ['2026-10-14', 'Eric Montes Rodriguez', 410, '', 'associate']],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-14', 3205, 2476, 4113]],
  };
}

test('salesperson Data Analysis figures are the October 1 snapshot plus the following day files, with no overlap or gap', () => {
  const gs = load(october(), '2026-10-18');
  const context = gs.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' });
  assert.equal(context.written.snapshot, '2026-10-13');
  assert.deepEqual(plain(context.written.days), ['2026-10-14']);
  assert.equal(context.written.through, '2026-10-14');
  assert.equal(context.delivered.through, '');

  const eric = gs.personAnalysis_(context, 'Eric Montes Rodriguez').written;
  assert.equal(eric.sales, 31794.47, 'the October 13 day row is inside the snapshot and the October 2 store-track row is not used');
  assert.equal(eric.orders, 11);
  assert.equal(eric.bedding.value, 0.347);
  assert.equal(eric.pads.detail, '1 of 3', 'the store-track MPPA PDF is not added');
  assert.equal(eric.finance.value, 0.5);
  assert.equal(eric.average.value, 2890.41);

  const ricky = gs.personAnalysis_(context, 'Ricky Nassif').written;
  assert.equal(ricky.sales, 19280.84, 'October 16 is after the missing October 15 file and is not counted');
  assert.equal(ricky.orders, 10);
  assert.equal(ricky.finance.value, Math.round(((0.25 * 16804.84 + 2476) / 19280.84) * 1000) / 1000);
  assert.equal(ricky.basis, 'Group 17 salesperson report 2026-10-01 through 2026-10-13 plus the day files 2026-10-14');

  assert.equal(gs.personAnalysis_(context, 'Brenda Sanchez').written.sales, 0, 'a covered report without a line is 0');
  assert.equal(gs.personAnalysis_(context, 'Eric Montes Rodriguez').delivered, null, 'no delivered report is Pending, not zero');
});

test('a verified $0 store day is not a hole, and a missing day with no verified zero still stops the count', () => {
  const tabs = october();
  tabs.CC_Daily.push(['2026-10-15', 0, 0, 0]);
  const gs = load(tabs, '2026-10-18');
  const context = gs.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(plain(context.written.days), ['2026-10-14', '2026-10-16']);
  assert.deepEqual(plain(context.written.zeroDays), ['2026-10-15']);
  assert.equal(context.written.through, '2026-10-16');
  const ricky = gs.personAnalysis_(context, 'Ricky Nassif').written;
  assert.equal(ricky.sales, 20180.84);
  assert.equal(ricky.basis.includes('was $0'), false);
});

test('the salesperson record uses SNAP for written and the goal, Data Analysis for the rest, and has no NWDSR fields', () => {
  const gs = load(october(), '2026-10-18');
  const context = gs.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' });
  const goals = gs.approvedGoals_({});
  const person = gs.personRecord_('Ricky Nassif', 2795, 'associate', [], goals, null, gs.personAnalysis_(context, 'Ricky Nassif'));
  assert.equal(person.snapWritten, 2795);
  assert.equal(person.written, 2795);
  assert.equal(person.monthlyGoal, 65000);
  assert.equal(person.analysisWritten, 19280.84);
  assert.equal(person.writtenOrders, 10);
  assert.equal(person.deliveredSales, null);
  assert.ok(!('nwdsrWritten' in person) && !('nwdsrDelivered' in person));
  const kpi = (name: string) => person.kpis.find((item: { name: string }) => item.name === name);
  assert.deepEqual(plain(person.kpis.map((item: { name: string }) => item.name)), ['Bedding', 'Mattress Pads', 'Adjustable Bases', 'Pillows', 'Furniture Protection', 'Pet Protections', 'Rugs', 'Fabric', 'Leather', 'Power', 'Financing', 'Average Ticket', 'Orders', 'Closing Ratio']);
  assert.equal(kpi('Adjustable Bases').writtenText, 'Not in report');
  assert.equal(kpi('Fabric').writtenText, 'No qualifying sales');
  assert.equal(kpi('Fabric').written, null);
  assert.equal(kpi('Average Ticket').written, 1928.08);
  assert.equal(kpi('Closing Ratio').written, null);
});

test('morning winners rank the whole working roster by that day\'s SNAP Written, and a missing SNAP report is Pending', () => {
  const gs = load(october(), '2026-10-15');
  const roster = (date: string) => ({
    date, status: 'ready', reason: '', people: ['Prakash Gandhi', 'Eric Montes Rodriguez', 'Ricky Nassif'].map((name) => ({ name, opportunities: 1, source: 'perq' })),
  });
  const ready = gs.morningWinners_(roster('2026-10-14'), 3000, gs.snapWrittenOn_('2026-10-14'));
  assert.equal(ready.status, 'ready');
  assert.equal(ready.share, 1000);
  assert.deepEqual(plain(ready.people.map((item: { name: string; written: number; above: number | null }) => [item.name, item.written, item.above])),
    [['Ricky Nassif', 2795, 1795], ['Eric Montes Rodriguez', 410, null], ['Prakash Gandhi', 0, null]], 'no line on a reported day is $0, not left out');
  const pending = gs.morningWinners_(roster('2026-10-12'), 3000, gs.snapWrittenOn_('2026-10-12'));
  assert.equal(pending.status, 'ready');
  assert.equal(pending.snapReported, false);
  assert.ok(pending.people.every((item: { written: number | null }) => item.written === null));
  assert.match(pending.reason, /SNAP Written for 2026-10-12 is not on file yet/);
  const noRoster = gs.morningWinners_({ date: '2026-10-12', status: 'pending', reason: 'PERQ Report Pending', people: [] }, 3000, gs.snapWrittenOn_('2026-10-14'));
  assert.equal(noRoster.reason, 'PERQ Report Pending');
});

test('the mailbox import keeps Group 17 sales and orders for the store and each salesperson', () => {
  const gs = load(october(), '2026-10-15');
  const grid = [
    ['GROUP 17', 'WRITTEN ORDERS', '', ''],
    ['Sales Person', 'Sales', 'Avg Sales', 'Fin %'],
    ['TARIK NASSIF', 909.98, 909.98, 0],
    ['TOTAL', 1409.97, 704.99, 0],
  ];
  const sales = gs.kpiRecords_(grid, 'group17', 'written', '2026-10-15', '2026-10-15', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-15_2026-10-15.xlsx')
    .filter((record: unknown[]) => String(record[0]).startsWith('DA_SALES_'));
  assert.deepEqual(plain(sales.map((record: unknown[]) => [record[0], record[8], record[10], record[11], record[17]])), [
    ['DA_SALES_PERSON', 'Ricky Nassif', 909.98, 1, 'DA_SALES_PERSON|daily|2026-10-15|2026-10-15|2026-10-15|written|TNASSI'],
    ['DA_SALES_STORE', '', 1409.97, 2, 'DA_SALES_STORE|daily|2026-10-15|2026-10-15|2026-10-15|written|STORE'],
  ]);
});

const line = (gs: Record<string, (...args: unknown[]) => any>, qualified: number, sold: number, goal: number | null, dollars: number | null = null) => {
  const result = plain(gs.attachmentLine_({ key: 'fabric', name: 'Fabric', source: 'FABRIC' }, { qualified, sold, dollars }, goal));
  return { missed: result.missed, actual: result.actual, points: result.points, needed: result.needed, status: result.status, flagged: !!result.flag };
};

test('attachment math: missed, actual %, points from goal and attachments needed come from the quantities', () => {
  const gs = load(october(), '2026-10-16');
  assert.deepEqual(line(gs, 32, 28, 0.8), { missed: 4, actual: 0.875, points: 7.5, needed: 0, status: 'at', flagged: false });
  assert.deepEqual(line(gs, 21, 11, 0.8), { missed: 10, actual: 0.5238, points: -27.6, needed: 6, status: 'below', flagged: false }, 'CEILING(21 × 0.8) = 17, less 11 sold');
  assert.deepEqual(line(gs, 5, 4, 0.8), { missed: 1, actual: 0.8, points: 0, needed: 0, status: 'at', flagged: false }, '5 × 0.8 is exactly 4, not 4.000000000000001');
  assert.deepEqual(line(gs, 10, 7, 0.8), { missed: 3, actual: 0.7, points: -10, needed: 1, status: 'below', flagged: false });
  assert.deepEqual(line(gs, 0, 0, 0.8), { missed: 0, actual: null, points: null, needed: 0, status: 'na', flagged: false }, 'no opportunity is N/A, not 0%');
  assert.deepEqual(line(gs, 1, 2, 0.8), { missed: 0, actual: 2, points: 120, needed: 0, status: 'at', flagged: true }, 'sold above qualified is kept and flagged');
  assert.deepEqual(line(gs, 1.5, 1, 0.8), { missed: 0.5, actual: 0.6667, points: -13.3, needed: 1, status: 'below', flagged: false }, 'Delivered can print fractional quantities');
  assert.deepEqual(line(gs, 1.5, 1.5, 0.8), { missed: 0, actual: 1, points: 20, needed: 0, status: 'at', flagged: false }, 'a fractional count at goal needs nothing more');
  assert.deepEqual(line(gs, 4.5, 3.5, 0.8), { missed: 1, actual: 0.7778, points: -2.2, needed: 1, status: 'below', flagged: false }, 'one whole attachment reaches 80%');
  assert.deepEqual(line(gs, 44, 37, null), { missed: 7, actual: 0.8409, points: null, needed: null, status: 'nogoal', flagged: false });
});

function withAttachments(): Record<string, Grid> {
  const tabs = october();
  const eric = (view: string, grain: string, start: string, end: string, figures: Figures, source: string) => row(view, grain, start, end, 'EMON0904', 'Eric Montes Rodriguez', figures, source);
  tabs.CC_Ledger.push(
    eric('FABW_PERSON', 'cumulative', '2026-10-01', '2026-10-13', { sales: 283.9, units: 11, eligible: 21, attachments: 11 }, SNAPSHOT),
    eric('PWAR_PERSON', 'cumulative', '2026-10-01', '2026-10-13', { sales: 199.99, units: 1, eligible: 3, attachments: 1 }, SNAPSHOT),
    eric('ATTACH_PERSON', 'cumulative', '2026-10-01', '2026-10-13', { sales: 513.88, units: 13, eligible: 27, attachments: 13 }, SNAPSHOT),
    row('FABW_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', { sales: 0, units: 0, eligible: 2, attachments: 0 }, DAY('2026-10-14')),
    row('ATTACH_PERSON', 'daily', '2026-10-14', '2026-10-14', 'TNASSI', 'Ricky Nassif', { sales: 0, units: 0, eligible: 2, attachments: 0 }, DAY('2026-10-14')),
  );
  return tabs;
}

test('the scorecard uses Group 17 quantities and dollars, keeps Written and Delivered apart, and checks the total', () => {
  const gs = load(withAttachments(), '2026-10-18');
  const context = gs.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' });
  const goals = { ...plain(gs.approvedGoals_({})), attachment: 0.9 };
  const eric = plain(gs.personAttachments_(gs.personAnalysis_(context, 'Eric Montes Rodriguez'), goals));
  const pick = (side: { lines: { name: string; qualified: number | null; sold: number | null; dollars: number | null; needed: number | null; status: string }[] }) =>
    side.lines.map((item) => [item.name, item.qualified, item.sold, item.dollars, item.needed, item.status]);
  assert.deepEqual(pick(eric.written), [
    ['Fabric', 21, 11, 283.9, 6, 'below'],
    ['Leather', 0, 0, 0, 0, 'na'],
    ['Power Upholstery', 3, 1, 199.99, 2, 'below'],
    ['Mattress Protectors (Pads)', 3, 1, 29.99, 2, 'below'],
    ['Total Attachment', 27, 13, 513.88, 12, 'below'],
  ]);
  assert.deepEqual(eric.written.flags, [], 'the Group 17 total equals Fabric + Power + Leather + Mattress Pads');
  assert.equal(eric.written.through, '2026-10-14');
  assert.ok(eric.delivered.lines.every((item: { status: string; qualified: null }) => item.status === 'pending' && item.qualified === null), 'no Delivered report is Pending, never zero or copied from Written');

  const ricky = plain(gs.personAttachments_(gs.personAnalysis_(context, 'Ricky Nassif'), goals));
  assert.deepEqual(pick(ricky.written)[0], ['Fabric', 2, 0, 0, 2, 'below']);

  const tabs = withAttachments();
  tabs.CC_Ledger = tabs.CC_Ledger.filter((item) => !(item[0] === 'ATTACH_PERSON' && item[8] === 'Eric Montes Rodriguez'));
  const missing = load(tabs, '2026-10-18');
  const noTotal = plain(missing.personAttachments_(missing.personAnalysis_(missing.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' }), 'Eric Montes Rodriguez'), goals));
  assert.equal(noTotal.written.lines[4].status, 'pending', 'a total that was not loaded is Pending, never rebuilt or zero');
  assert.match(noTotal.written.flags.join(' '), /Total Attachments is not on file/);

  const tampered = withAttachments();
  tampered.CC_Ledger = tampered.CC_Ledger.map((item) => (item[0] === 'ATTACH_PERSON' && item[8] === 'Eric Montes Rodriguez' ? [...item.slice(0, 12), 28, ...item.slice(13)] : item));
  const off = load(tampered, '2026-10-18');
  const differs = plain(off.personAttachments_(off.personAnalysis_(off.personAnalysisContext_({ start: '2026-10-01', end: '2026-10-31' }), 'Eric Montes Rodriguez'), goals));
  assert.equal(differs.written.lines[4].qualified, 28, 'the printed total is shown as printed');
  assert.match(differs.written.flags.join(' '), /differs from the four categories \(13 of 27\)/);
});

test('the mailbox import keeps the Group 17 Total Attachments group for each salesperson and the store', () => {
  const gs = load(october(), '2026-10-15');
  const grid = [
    ['GROUP 17', 'WRITTEN ORDERS', '', '', 'FABRIC', '', '', '', 'TOTAL ATTACHMENTS %', '', '', ''],
    ['Sales Person', 'Sales', 'Avg Sales', 'Fin %', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %'],
    ['TARIK NASSIF', 909.98, 909.98, 0, 2, '', '', '', 2, '', '', ''],
    ['TOTAL', 1409.97, 704.99, 0, 3, 1, 79.99, 33.3, 3, 1, 79.99, 33.3],
  ];
  const attach = gs.kpiRecords_(grid, 'group17', 'written', '2026-10-15', '2026-10-15', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-15_2026-10-15.xlsx')
    .filter((record: unknown[]) => String(record[0]).startsWith('ATTACH_'));
  assert.deepEqual(plain(attach.map((record: unknown[]) => [record[0], record[8], record[10], record[12], record[13]])), [
    ['ATTACH_PERSON', 'Ricky Nassif', 0, 2, 0],
    ['ATTACH_STORE', '', 79.99, 3, 1],
  ]);
});

function withSession(tabs: Record<string, Grid>, today: string, role: string) {
  const gs = load(tabs, today);
  vm.runInContext(`requireSession_ = function () { return { role: '${role}', username: 'test' }; }; healthValue_ = function () { return ''; };`, gs as vm.Context);
  return gs;
}

test('the associate summary is for managers and admins only, checked on the server', () => {
  const tabs = { ...withAttachments(), CC_People: [['name', 'role', 'SNAP Written'], ['Eric Montes Rodriguez', 'associate', 410], ['Ricky Nassif', 'associate', 2795], ['Caroline Amaro', 'former', '']], CC_Config: [['key', 'value'], ['attachment_goal', 0.9]] };
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  for (const role of ['sales', 'manager', 'admin']) {
    const gs = withSession(tabs, '2026-10-18', role);
    vm.runInContext(code, gs as vm.Context);
    if (role === 'sales') assert.throws(() => gs.dispatch('summary', { token: 't', name: 'Eric Montes Rodriguez' }), /not available for this login/);
    else assert.equal(gs.dispatch('summary', { token: 't', name: 'Eric Montes Rodriguez' }).name, 'Eric Montes Rodriguez');
  }
});

test('the associate summary defaults to the salesperson month and refuses ranges it cannot verify', () => {
  const tabs = { ...withAttachments(), CC_People: [['name', 'role', 'SNAP Written'], ['Eric Montes Rodriguez', 'associate', 410], ['Ricky Nassif', 'associate', 2795], ['Caroline Amaro', 'former', '']], CC_Config: [['key', 'value'], ['attachment_goal', 0.9]] };
  const gs = withSession(tabs, '2026-10-18', 'manager');
  const session = { role: 'manager' };
  const month = plain(gs.summary_({ session, name: 'Ricky Nassif' }));
  assert.deepEqual([month.start, month.end, month.fromFirst, month.snapThrough], ['2026-10-01', '2026-10-31', true, '2026-10-14']);
  assert.deepEqual(month.associates, ['Eric Montes Rodriguez', 'Ricky Nassif'], 'former associates are not offered');
  assert.equal(month.person.snapWritten, 2795);
  assert.equal(month.person.attachments.written.lines[0].qualified, 2);
  assert.equal(month.goals.attachment, 0.9);

  const later = plain(gs.summary_({ session, name: 'Ricky Nassif', start: '2026-10-14', end: '2026-10-14' }));
  assert.equal(later.fromFirst, false);
  assert.equal(later.person.snapWritten, 2795);
  assert.equal(later.person.analysisWritten, 2476, 'the October 14 day file alone, never a slice of the October 1-13 snapshot');

  const inside = plain(gs.summary_({ session, name: 'Eric Montes Rodriguez', start: '2026-10-05', end: '2026-10-12' }));
  assert.equal(inside.person.snapWritten, null, 'no SNAP line in the range and no cached month total');
  assert.equal(inside.person.analysisWritten, null, 'a to-date snapshot is not split, so Group 17 is Pending');

  assert.throws(() => gs.summary_({ session, name: 'Caroline Amaro' }), /Choose an associate who was on the Sales Team/);
  assert.throws(() => gs.summary_({ session, name: 'Ricky Nassif', start: '2026-10-20', end: '2026-11-02' }), /inside one salesperson month/);
  assert.throws(() => gs.summary_({ session, name: 'Ricky Nassif', start: '2026-10-10', end: '2026-10-09' }), /before the start date/);
  assert.throws(() => gs.summary_({ session, name: 'Ricky Nassif', start: '2026-02-30', end: '2026-03-01' }), /Choose a start and end date/);
  assert.throws(() => gs.summary_({ session, name: 'Ricky Nassif', start: '2026-10-25', end: '2026-10-26' }), /in the future/);
});

test('the evaluation cycle covers the previous three completed salesperson months', () => {
  const gs = load(october(), '2026-10-16');
  assert.deepEqual(plain(gs.evaluationCycle_('2026-10-16')), { cycle: '2026-11', prepare: '2026-11-02', deliverBy: '2026-11-06', covers: [
    { start: '2026-08-01', end: '2026-08-31' }, { start: '2026-09-01', end: '2026-09-30' }, { start: '2026-10-01', end: '2026-10-31' },
  ] });
  assert.equal(plain(gs.evaluationCycle_('2026-10-05')).covers[0].start, '2026-07-01', 'through the 6th the current cycle is still open');
  assert.equal(plain(gs.evaluationCycle_('2026-12-20')).prepare, '2027-01-02');
  assert.equal(plain(gs.evaluationCycle_('2027-01-02')).covers[0].start, '2026-10-01');
});
