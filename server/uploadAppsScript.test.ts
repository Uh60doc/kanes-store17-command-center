import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { crc32 } from 'node:zlib';
import { appsScriptServices } from './appsScriptServices.ts';
import { type Grid, loadAppsScript, plain } from './fakeSpreadsheet.ts';

const FILES = ['Code.gs', 'Data.gs', 'Roster.gs', 'Ledger.gs', 'Import.gs', 'KpiImport.gs', 'EvalImport.gs', 'Evaluations.gs', 'Upload.gs'];
const manager = { role: 'manager' };
const SNAPSHOT_17 = 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-11-01.xlsx';
const LEDGER_HEADER = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.concat([local, nameBytes, data]);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(crc32(data), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(entry);
    central.push(Buffer.concat([header, nameBytes]));
    offset += entry.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A one-sheet .xlsx with inline strings. A trailing comment in the sheet changes the bytes but not the cells. */
function xlsx(rows: (string | number | null)[][], salt = ''): Buffer {
  const col = (i: number) => String.fromCharCode(65 + i);
  const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    if (cell === null || cell === '') return '';
    const ref = `${col(c)}${r + 1}`;
    return typeof cell === 'number' ? `<c r="${ref}"><v>${cell}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return zip({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${body}</sheetData>${salt ? `<!--${salt}-->` : ''}</worksheet>`,
  });
}

const pdf = (text: string, salt = '') => Buffer.from(`%PDF-1.4\n${text}\n%%EOF${salt}`);
const day = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}-${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(m) - 1]}-${y}`;
};
const snapPdf = (date: string, total: number, lines: [string, number][], salt = '') =>
  pdf(`SNAP - WRITTEN\nFROM ${day(date)} TO ${day(date)}\n${lines.map(([name, amount]) => `${name}    ${amount}`).join('\n')}\n17 - ORLANDO Totals: 54.0 ${total.toLocaleString('en-US')} 500`, salt);
const nwdsrPdf = (kind: 'written' | 'delivered', start: string, end: string, total: number, customers = 2, salt = '') =>
  pdf(`${kind === 'written' ? 'NET WRITTEN STORE SALES' : 'DELIVERED STORE SALES'}\nFROM ${day(start)} TO ${day(end)}\nKANE FURNITURE #17 Totals: ${total.toLocaleString('en-US')} -79.7 ${customers} -71.4`, salt);

function group17(side: 'WRITTEN' | 'DELIVERED', people: [string, number][], salt = '') {
  const header = ['GROUP 17', `${side} ORDERS`, '', '', 'FABRIC', '', '', '', `${side} BEDDING`, '', 'TOTAL ATTACHMENTS', '', '', ''];
  const sub = ['Sales Person', 'Sales', 'Avg Sales', 'Fin %', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %', 'Sales', '%', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %'];
  const line = (name: string, sales: number) => [name, sales, sales / 2, 50, 2, 1, 49.99, 50, sales / 5, 20, 4, 2, 99.98, 50];
  const total = people.reduce((sum, [, sales]) => sum + sales, 0);
  const rows = [header, sub, ...people.map(([name, sales]) => line(name, sales))];
  if (people.length) rows.push(['TOTAL', total, total / (2 * people.length), 50, 2 * people.length, people.length, 49.99 * people.length, 50, total / 5, 20, 4 * people.length, 2 * people.length, 99.98 * people.length, 50]);
  return xlsx(rows, salt);
}
const asl = (side: 'WRITTEN' | 'DELIVERED', salt = '') => xlsx([
  ['GROUP ASL', `${side} ORDERS`, '', '', 'PILLOWS', '', '', '', 'ADJ', '', '', '', 'FURNITURE PROTECTION', '', '', '', 'RUGS', ''],
  ['Store', 'Sales', 'Avg Sales', 'Fin %', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %', 'Qual Qty', 'Sold Qty', 'Sold $', 'Attach %', 'Sold Qty', 'Sold $'],
  ['12', 5000, 1000, 0, 9, 9, 90, 100, 9, 9, 900, 100, 9, 9, 900, 100, 9, 900],
  ['17', 1000, 500, 0, 2, 1, 20, 50, 4, 1, 800, 25, 5, 2, 99.98, 40, 1, 150],
], salt);
const perqLocation = (count: number, salt = '') => xlsx([['Performance Stats by Location'], ['Location', 'Ups + Be Backs'], ['Store 12 - Tampa', 9], ['Store 17 - Orlando', count]], salt);
const perqSalesperson = (people: [string, string, string, number][], stamp = '10/15/26 08:15pm', salt = '') => xlsx([
  ['Performance Stats by Salesperson'],
  ['EmployeeCode', 'FirstName', 'LastName', 'Ups + Be Backs', `Active Deals${stamp}`],
  ...people.map(([code, first, last, count]) => [code, first, last, count, 0]),
], salt);

function store(): Record<string, Grid> {
  const snap = (view: string, sales: number | string, units: number | string, eligible: number | string, attachments: number | string, percent: number | string) =>
    [view, 'cumulative', '', '2026-10-02', '2026-11-01', '2026-10-13', '17', '', '', 'written', sales, units, eligible, attachments, percent, SNAPSHOT_17, '2026-10-14T00:00:00Z', `${view}|cumulative|2026-10-02|2026-11-01||written|STORE`];
  return {
    CC_People: [
      ['name', 'role', 'SNAP Written'],
      ['Renzo Del Solar', 'associate', 0],
      ['Eric Montes Rodriguez', 'associate', 0],
      ['Ricky Nassif', 'associate', 0],
    ],
    CC_Config: [['key', 'value'], ['store_period_start', '2026-10-02'], ['store_period_end', '2026-11-01']],
    CC_Daily: [['date', 'snap_written', 'nwdsr_written', 'nwdsr_delivered'], ['2026-10-13', 900, 900, 400]],
    CC_AssociateDays: [['date', 'source_name', 'display_name', 'role', 'amount', 'sha256', 'note']],
    CC_Imports: [['sha256', 'file_name', 'report_type', 'status', 'imported_at', 'note']],
    CC_Exceptions: [['at', 'severity', 'message']],
    CC_Health: [['key', 'value']],
    CC_History: [['archived_at', 'tab', 'record_key', 'reason', 'replaced_by', 'previous_row']],
    CC_Kpi: [['metric', 'written', 'delivered', 'note', 'period_start', 'period_end', 'verified_through']],
    CC_Closing: [['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through', 'store']],
    CC_Ledger: [
      LEDGER_HEADER,
      snap('DA_SALES_STORE', 10000, 10, '', '', ''),
      snap('BEDDING_STORE', 2000, '', '', '', 0.2),
      snap('FABW_STORE', 400, 8, 10, 8, 0.8),
      snap('PWAR_STORE', 300, 4, 5, 4, 0.8),
      snap('LTHW_STORE', 100, 1, 2, 1, 0.5),
      snap('MPPA_STORE', 200, 2, 4, 2, 0.5),
      snap('ATTACH_STORE', 1000, 15, 21, 15, 0.714),
      snap('FINANCE_STORE', '', '', '', '', 0.5),
    ],
  };
}

function boot(tabs = store(), today = '2026-10-17') {
  const services = appsScriptServices();
  const mail: string[] = [];
  const gs = loadAppsScript(FILES, tabs, today, { ...services.services, MailApp: { sendEmail: (_to: string, _subject: string, body: string) => { mail.push(body); } } }) as any;
  gs.ensureRosterColumns_();
  gs.pdfText_ = (blob: { getBytes: () => number[] }) => Buffer.from(blob.getBytes().map((b) => (b < 0 ? b + 256 : b))).toString('utf8').replace(/^%PDF-1\.4\n/, '').replace(/\n%%EOF[\s\S]*$/, '');
  const exceptions: string[] = [];
  gs.appendException_ = (severity: string, message: string) => { exceptions.push(`${severity}: ${message}`); };
  const send = (date: string, fileName: string, bytes: Buffer, confirm = false) =>
    plain(gs.uploadReport_({ date, fileName, base64: bytes.toString('base64'), confirmDate: confirm ? date : '', session: manager }));
  return { gs, tabs, send, mail, exceptions };
}

const ledger = (tabs: Record<string, Grid>, view: string, reportDate = '') => tabs.CC_Ledger!.filter((row) => row[0] === view && (!reportDate || row[2] === reportDate));
const kpi = (tabs: Record<string, Grid>, metric: string) => tabs.CC_Kpi!.find((row) => row[0] === metric);
const snapshotOf = (tabs: Record<string, Grid>) => JSON.stringify(Object.fromEntries(Object.entries(tabs).filter(([name]) => !['CC_Imports'].includes(name))));

test('each of the nine reports is identified from its contents, whatever the file is called', () => {
  const { send, tabs } = boot();
  tabs.CC_Daily!.push(['2026-10-14', '', '', '']);
  const results = [
    send('2026-10-14', 'output.pdf', snapPdf('2026-10-14', 1000, [['NASSIF, TARIK', 1000]])),
    send('2026-10-14', 'output (1).pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000)),
    send('2026-10-14', 'output (2).pdf', nwdsrPdf('delivered', '2026-10-14', '2026-10-14', 3000)),
    send('2026-10-14', 'report.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]), true),
    send('2026-10-14', 'report (1).xlsx', group17('DELIVERED', [['TARIK NASSIF', 3000]]), true),
    send('2026-10-14', 'Performance_Stats_by_Salesperson.xlsx', asl('WRITTEN'), true),
    send('2026-10-14', 'report (3).xlsx', asl('DELIVERED'), true),
    send('2026-10-14', 'Performance Stats by Location (4).xlsx', perqLocation(7), true),
    send('2026-10-14', 'Performance Stats by Salesperson (9).xlsx', perqSalesperson([['TNASSI', 'Tarik', 'Nassif', 4]], '10/14/26 08:00pm'), true),
  ];
  assert.deepEqual(results.map((r: any) => r.report), [
    'SNAP Written', 'NWDSR Written', 'NWDSR Delivered', 'Group 17 Written', 'Group 17 Delivered', 'ASL Written', 'ASL Delivered',
    'PERQ Performance Stats by Location', 'PERQ Performance Stats by Salesperson',
  ], 'a file named like a PERQ export but holding ASL Written is read as ASL Written');
  assert.deepEqual(results.map((r: any) => r.status), Array(9).fill('Imported'));
  assert.deepEqual(tabs.CC_Daily!.find((row) => row[0] === '2026-10-14')!.slice(1), [1000, 1000, 3000]);
  assert.equal(ledger(tabs, 'DA_SALES_STORE', '2026-10-14')[0]![15], 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-14_2026-10-14.xlsx', 'a renamed workbook is stored under the report name the KPI code expects');
  assert.equal(ledger(tabs, 'DA_SALES_PERSON', '2026-10-14')[0]![7], 'TNASSI', 'the salesperson is matched to the employee ID');
  assert.deepEqual(ledger(tabs, 'FP_STORE', '2026-10-14')[0]!.slice(10, 15), [99.98, 2, 5, 2, 0.4], 'only the Store 17 line of ASL is used');
  assert.deepEqual(tabs.CC_Closing!.filter((row) => row[8] === 'PERQ Ups + Be Backs').map((row) => [row[1], row[2], row[5]]), [['store', '', 7], ['person', 'TNASSI', 4]]);
  assert.deepEqual(tabs.CC_AssociateDays!.slice(1).map((row) => [row[0], row[2], row[4]]), [['2026-10-14', 'Ricky Nassif', 1000]]);
  assert.deepEqual(ledger(tabs, 'SNAP_PERSON', '2026-10-14').map((row) => [row[8], row[10]]), [['Ricky Nassif', 1000]], 'SNAP_PERSON mirrors CC_AssociateDays');
});

test('SNAP salesperson lines are read when the PDF conversion joins rows onto one line', () => {
  const { gs } = boot();
  const lines = (text: string) => plain(gs.snapAssociates_(text)).map((line: any) => [line.sourceName, line.amount]);
  assert.deepEqual(lines('MONTES, ERIC 500 500 0.0 0.0 0.0 NASSIF, TARIK 910 910 0.0 12.1 0.0 \n17 - ORLANDO Totals: -75.1 1,410 705 0.0'), [['MONTES, ERIC', 500], ['NASSIF, TARIK', 910]]);
  assert.deepEqual(lines('DELSOLAR, RENZO 2,476 1,238 0.0 6.0 41.8 0.0 17 - ORLANDO Totals: 54.0 2,476 1,238 0.0'), [['DELSOLAR, RENZO', 2476]]);
  assert.deepEqual(lines('KANES FURNITURE, INC. \nMONTES, ERIC    -320\n17 - ORLANDO Totals: 54.0 -320'), [['MONTES, ERIC', -320]]);
});

test('the same file twice, or the same report with different bytes, adds nothing', () => {
  const { send, tabs } = boot();
  const first = send('2026-10-14', 'nw.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000));
  assert.equal(first.status, 'Imported');
  send('2026-10-14', 'g17.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]), true);
  send('2026-10-14', 'loc.xlsx', perqLocation(7), true);
  const before = snapshotOf(tabs);

  const exact = send('2026-10-14', 'nw copy.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000));
  assert.equal(exact.status, 'Already on file');
  assert.match(exact.message, /exact file was already imported/);
  const resaved = [
    send('2026-10-14', 'nw resaved.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000, 2, '\n%resaved')),
    send('2026-10-14', 'g17 resaved.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]], 'resaved'), true),
    send('2026-10-14', 'loc resaved.xlsx', perqLocation(7, 'resaved'), true),
  ];
  assert.deepEqual(resaved.map((r: any) => r.status), ['Already on file', 'Already on file', 'Already on file']);
  const after = JSON.parse(snapshotOf(tabs));
  delete after.CC_Uploads;
  const was = JSON.parse(before);
  delete was.CC_Uploads;
  assert.deepEqual(after, was, 'no figure, ledger row or closing count changed');
  assert.equal(tabs.CC_Uploads!.length, 1 + 7, 'every attempt is still logged');
});

test('a different figure for a recorded day is held back for review and never applied', () => {
  const { send, tabs, mail, exceptions } = boot();
  send('2026-10-14', 'nw.pdf', nwdsrPdf('delivered', '2026-10-14', '2026-10-14', 5639));
  const later = send('2026-10-14', 'nw later.pdf', nwdsrPdf('delivered', '2026-10-14', '2026-10-14', 5959));
  assert.equal(later.status, 'Needs Review');
  assert.match(later.message, /shows \$5,959, but \$5,639 is already on file\. The recorded figure was kept/);
  assert.equal(tabs.CC_Daily!.find((row) => row[0] === '2026-10-14')![3], 5639);
  assert.ok(exceptions.some((line) => /conflicts with the figure already on file/.test(line)));
  assert.equal(mail.length, 0, 'a manual upload shows its result on screen and does not email');

  send('2026-10-14', 'loc.xlsx', perqLocation(7), true);
  const recount = send('2026-10-14', 'loc 2.xlsx', perqLocation(8), true);
  assert.equal(recount.status, 'Needs Review');
  assert.deepEqual(tabs.CC_Closing!.filter((row) => row[1] === 'store').map((row) => row[5]), [7]);
  assert.ok(tabs.CC_History!.some((row) => String(row[2]).startsWith('PERQ store||2026-10-14')));
});

test('wrong dates, month-to-date files, unknown files and unconfirmed PERQ exports change nothing', () => {
  const { send, tabs } = boot();
  const before = JSON.stringify([tabs.CC_Daily, tabs.CC_Ledger, tabs.CC_Closing]);
  const wrongDay = send('2026-10-15', 'nw.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000));
  assert.equal(wrongDay.status, 'Failed');
  assert.match(wrongDay.message, /is for 2026-10-14, not the business date 2026-10-15/);
  const monthToDate = send('2026-10-14', 'mtd.pdf', nwdsrPdf('written', '2026-10-02', '2026-10-14', 90000));
  assert.equal(monthToDate.status, 'Needs Review');
  assert.match(monthToDate.message, /Month-to-date reports are not added/);
  assert.equal(send('2026-10-14', 'snapd.pdf', pdf('SNAP - DELIVERED\nFROM 14-OCT-2026 TO 14-OCT-2026\n17 - ORLANDO Totals: 1 2')).status, 'Failed');
  assert.equal(send('2026-10-14', 'notes.txt', Buffer.from('hello')).status, 'Failed');
  assert.equal(send('2026-10-14', 'budget.xlsx', xlsx([['Store Budget'], ['x', 1]])).status, 'Failed');
  const wrongKpiDay = send('2026-10-14', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-15_2026-10-15.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]));
  assert.equal(wrongKpiDay.status, 'Failed');
  const mtdKpi = send('2026-10-14', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-02_2026-10-14.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]));
  assert.equal(mtdKpi.status, 'Needs Review');
  const mislabeled = send('2026-10-14', 'DATA_ANALYSIS_KPI_ASL_WRITTEN_2026-10-14_2026-10-14.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]));
  assert.equal(mislabeled.status, 'Needs Review');
  assert.match(mislabeled.message, /file name says ASL written, but the contents are Group 17 Written/);
  const renamed = send('2026-10-14', 'report.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]));
  assert.equal(renamed.status, 'Needs Review');
  assert.match(renamed.message, /Tick "These Excel files are for 2026-10-14"/);
  const perq = send('2026-10-14', 'loc.xlsx', perqLocation(7));
  assert.equal(perq.status, 'Needs Review');
  assert.match(perq.message, /business date must be confirmed/);
  const stale = send('2026-10-15', 'people.xlsx', perqSalesperson([['TNASSI', 'Tarik', 'Nassif', 4]], '10/14/26 08:00pm'), true);
  assert.equal(stale.status, 'Failed');
  assert.match(stale.message, /saved 10\/14\/26 08:00pm, before the business date 2026-10-15/);
  assert.throws(() => send('2026-10-18', 'x.pdf', nwdsrPdf('written', '2026-10-18', '2026-10-18', 1)), /cannot be after today/);
  assert.equal(JSON.stringify([tabs.CC_Daily, tabs.CC_Ledger, tabs.CC_Closing]), before);
});

test('a file refused only for the chosen date stays usable, and a file the mailbox held can be confirmed here', () => {
  const { send, tabs } = boot();
  const report = nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000);
  assert.equal(send('2026-10-15', 'nw.pdf', report).status, 'Failed');
  const location = perqLocation(7);
  assert.equal(send('2026-10-14', 'loc.xlsx', location).status, 'Needs Review');
  assert.equal(tabs.CC_Imports!.length, 1, 'neither file is marked as seen, so the mailbox import would still read it');
  assert.equal(send('2026-10-14', 'nw.pdf', report).status, 'Imported');
  assert.equal(send('2026-10-14', 'loc.xlsx', location, true).status, 'Imported');

  const held = perqLocation(9, 'mailbox');
  const sha = createHash('sha256').update(held).digest('hex');
  tabs.CC_Imports!.push([sha, 'Performance Stats by Location (10).xlsx', 'PERQ Performance Stats by Location', 'held: date unconfirmed', '2026-10-16T18:52:00Z', 'Store 17 9.']);
  const confirmed = send('2026-10-13', 'Performance Stats by Location (10).xlsx', held, true);
  assert.equal(confirmed.status, 'Imported');
  assert.equal(tabs.CC_Imports!.find((row) => row[0] === sha)![3], 'imported');
  assert.deepEqual(tabs.CC_Closing!.filter((row) => row[1] === 'store' && row[8] === 'PERQ Ups + Be Backs').map((row) => [row[0], row[5]]), [['2026-10-14', 7], ['2026-10-13', 9]]);
});

test('Group 17 must agree with NWDSR for the day; PERQ salespeople may not exceed the store count', () => {
  const { send, tabs } = boot();
  send('2026-10-14', 'nw.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1500));
  const mismatch = send('2026-10-14', 'g17.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]), true);
  assert.equal(mismatch.status, 'Needs Review');
  assert.match(mismatch.message, /TOTAL sales \$1,000 do not match NWDSR Written \$1,500/);
  assert.equal(ledger(tabs, 'DA_SALES_STORE', '2026-10-14').length, 0);

  send('2026-10-14', 'loc.xlsx', perqLocation(5), true);
  const tooMany = send('2026-10-14', 'people.xlsx', perqSalesperson([['TNASSI', 'Tarik', 'Nassif', 4], ['EMON0904', 'Eric', 'Montes', 3]], '10/14/26 08:00pm'), true);
  assert.equal(tooMany.status, 'Needs Review');
  assert.equal(tabs.CC_Closing!.filter((row) => row[1] === 'person').length, 0);

  const unknown = send('2026-10-14', 'people 2.xlsx', perqSalesperson([['TNASSI', 'Tarik', 'Nassif', 3], ['ZZTOP', 'New', 'Hire', 1]], '10/14/26 08:00pm'), true);
  assert.equal(unknown.status, 'Needs Review');
  assert.match(unknown.message, /not on the roster: ZZTOP \(New Hire\) 1/);
  assert.deepEqual(tabs.CC_Closing!.filter((row) => row[1] === 'person').map((row) => [row[2], row[5]]), [['TNASSI', 3]], 'the matched salesperson is saved, the unknown code is not guessed');
});

test('store month KPIs: snapshot plus each verified day, recalculated once, never across a gap', () => {
  const { send, tabs, gs } = boot();
  send('2026-10-14', 'nw.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000));
  assert.equal(send('2026-10-14', 'g17.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]), true).status, 'Imported');
  const through = '2026-10-02 through 2026-10-13 snapshot plus the 2026-10-14 daily file';
  assert.deepEqual(kpi(tabs, 'Bedding')!.slice(1, 4), [0.2, '', `Bedding dollars ÷ sales, ${through}. Written 2200 of 11000, delivered 0 of 0.`]);
  assert.deepEqual(kpi(tabs, 'Fabric Maintenance')!.slice(1, 3), [0.75, '']);
  assert.deepEqual(kpi(tabs, 'Total Attachment')!.slice(1, 3), [0.68, '']);
  assert.deepEqual(kpi(tabs, 'Mattress Protectors')!.slice(1, 3), [0.5, ''], 'a day without the category adds 0 of 0');
  assert.deepEqual(kpi(tabs, 'Average Ticket')!.slice(1, 3), [916.67, '']);
  assert.deepEqual(kpi(tabs, 'Finance')!.slice(1, 3), [0.5, '']);
  assert.equal(kpi(tabs, 'Bedding')![6], '2026-10-14');
  assert.deepEqual(ledger(tabs, 'DA_SALES_STORE').filter((row) => row[1] === 'cumulative' && row[5] === '2026-10-14').map((row) => [row[10], row[11]]), [[11000, 12]]);

  const again = plain(gs.refreshStoreKpi_('2026-10-14'));
  assert.deepEqual([again.kpiUpdated, again.kpiAppended, again.ledger.added, again.ledger.replaced], [[], [], 0, 0], 'a second recalculation writes nothing');

  tabs.CC_Daily!.push(['2026-10-16', '', 800, '']);
  assert.equal(send('2026-10-16', 'g17 16.xlsx', group17('WRITTEN', [['TARIK NASSIF', 800]]), true).status, 'Imported');
  assert.equal(kpi(tabs, 'Bedding')![6], '2026-10-14', 'October 15 is missing, so October 16 waits');
  assert.equal(kpi(tabs, 'Bedding')![1], 0.2);
});

test('a KPI whose snapshot line is missing is left as recorded, not rebuilt from the daily files alone', () => {
  const tabs = store();
  tabs.CC_Ledger = tabs.CC_Ledger!.filter((row) => row[0] !== 'FABW_STORE');
  tabs.CC_Kpi!.push(['Fabric Maintenance', 0.8, '', 'recorded', '2026-10-02', '2026-11-01', '2026-10-13']);
  const { send } = boot(tabs);
  send('2026-10-14', 'nw.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1000));
  send('2026-10-14', 'g17.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]), true);
  assert.deepEqual(kpi(tabs, 'Fabric Maintenance'), ['Fabric Maintenance', 0.8, '', 'recorded', '2026-10-02', '2026-11-01', '2026-10-13']);
  assert.equal(kpi(tabs, 'Bedding')![1], 0.2, 'the other KPIs still update');
  assert.equal(ledger(tabs, 'FABW_STORE').filter((row) => row[1] === 'cumulative').length, 0);
});

test('the checklist shows Imported, Missing, Failed and Needs Review for the chosen day', () => {
  const { send, gs, tabs } = boot();
  send('2026-10-14', 'nw.pdf', nwdsrPdf('written', '2026-10-14', '2026-10-14', 1500));
  send('2026-10-14', 'g17.xlsx', group17('WRITTEN', [['TARIK NASSIF', 1000]]), true);
  send('2026-10-14', 'nwd.pdf', nwdsrPdf('delivered', '2026-10-15', '2026-10-15', 10));
  send('2026-10-14', 'aslw.xlsx', asl('WRITTEN'), true);
  const view = plain(gs.uploads_({ date: '2026-10-14', session: manager }));
  const status = Object.fromEntries(view.checklist.map((item: any) => [item.label, item.status]));
  assert.deepEqual(status, {
    'SNAP Written': 'Missing', 'NWDSR Written': 'Imported', 'NWDSR Delivered': 'Failed', 'Group 17 Written': 'Needs Review', 'Group 17 Delivered': 'Missing',
    'ASL Written': 'Imported', 'ASL Delivered': 'Missing', 'PERQ Performance Stats by Location': 'Missing', 'PERQ Performance Stats by Salesperson': 'Missing',
  });
  assert.equal(view.imported, 2);
  assert.equal(view.total, 9);
  assert.match(view.checklist.find((item: any) => item.label === 'NWDSR Delivered').message, /is for 2026-10-15, not the business date 2026-10-14/);
  assert.equal(view.history.length, 4);
  assert.equal(view.lastSuccess.report, 'ASL Written');
  assert.equal(view.lastSuccess.via, 'upload');
  assert.equal(plain(gs.uploads_({ session: manager })).date, '2026-10-16', 'the page opens on yesterday');

  tabs.CC_Imports!.push(
    ['m1', 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-15_2026-10-15.xlsx', 'Data Analysis KPI 17 Delivered', 'imported', '2099-01-01T07:00:00Z', ''],
    ['m2', 'FABW.pdf', 'FABW Written', 'imported', '2099-01-02T07:00:00Z', ''],
    ['m3', 'Performance Stats by Location (10).xlsx', 'PERQ Performance Stats by Location', 'held: date unconfirmed', '2099-01-03T07:00:00Z', ''],
  );
  const mailbox = plain(gs.uploads_({ date: '2026-10-14', session: manager })).lastSuccess;
  assert.deepEqual([mailbox.report, mailbox.via, mailbox.at], ['Group 17 Delivered', 'mailbox', '2099-01-01T07:00:00Z'], 'a newer mailbox import of one of the nine reports counts; other reports and held files do not');
});

test('only a manager or admin can open the page or import', () => {
  const { gs } = boot();
  assert.deepEqual(plain([gs.ROUTES_.uploads, gs.ROUTES_.uploadReport]), [['manager', 'admin'], ['manager', 'admin']]);
  gs.requireSession_ = (token: string) => ({ role: token });
  assert.throws(() => gs.dispatch('uploadReport', { token: 'sales', date: '2026-10-14', fileName: 'x.pdf', base64: '' }), /not available for this login/);
  assert.throws(() => gs.dispatch('uploads', { token: 'sales' }), /not available for this login/);
  assert.equal(plain(gs.dispatch('uploads', { token: 'manager', date: '2026-10-14' })).role, 'manager');
});
