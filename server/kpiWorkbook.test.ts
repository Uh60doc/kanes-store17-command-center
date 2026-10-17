import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { attachmentFromDaily } from '../src/domain/kpiLedger.ts';
import { recordsFromKpi } from './kpiLedgerBuild.ts';
import { parseKpiWorkbook, storeSnapshot } from './kpiWorkbook.ts';
import { firstSheet, unzip } from './xlsxLite.ts';

const reportDir = '/tmp/kpi-oct2026/ORIGINAL_REPORTS';
const hasReports = existsSync(reportDir);

function zipStored(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const nameBytes = Buffer.from(name);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.concat([local, nameBytes, data]);
    locals.push(entry);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
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

test('a complete daily report counts a blank sold quantity as zero and keeps a negative sale', () => {
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>GROUP 17</t></is></c><c r="B1" t="inlineStr"><is><t>WRITTEN ORDERS</t></is></c><c r="F1" t="inlineStr"><is><t>FABRIC</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Sales Person</t></is></c><c r="B2" t="inlineStr"><is><t>Sales</t></is></c><c r="C2" t="inlineStr"><is><t>Avg Sales</t></is></c><c r="D2" t="inlineStr"><is><t>Fin %</t></is></c><c r="F2" t="inlineStr"><is><t>Qual Qty</t></is></c><c r="G2" t="inlineStr"><is><t>Sold Qty</t></is></c><c r="H2" t="inlineStr"><is><t>Sold $</t></is></c><c r="I2" t="inlineStr"><is><t>Attach %</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>RENZO DELSOLAR</t></is></c><c r="B3"><v>-40</v></c><c r="C3"><v>-40</v></c><c r="D3"><v>0</v></c><c r="F3"><v>4</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>TOTAL</t></is></c><c r="B4"><v>-40</v></c><c r="C4"><v>-40</v></c><c r="D4"><v>0</v></c><c r="F4"><v>4</v></c></row>
  </sheetData></worksheet>`;
  const report = parseKpiWorkbook(zipStored({ 'xl/worksheets/sheet1.xml': sheet }), 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-14_2026-10-14.xlsx');
  assert.equal(report.family, 'group17');
  assert.equal(report.side, 'written');
  assert.equal(report.start, '2026-10-14');
  assert.equal(report.end, '2026-10-14');
  assert.equal(report.store?.sales, -40);
  assert.equal(report.store?.averageSale, -40);
  assert.equal(report.store?.fabric.qual, 4);
  assert.equal(report.store?.fabric.sold, 0);
  assert.equal(report.store?.fabric.dollars, 0);
  assert.equal(report.store?.fabric.percent, 0);
});

test('a Group 17 day file keeps each salesperson\'s Data Analysis sales and order count at source precision', () => {
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>GROUP 17</t></is></c><c r="B1" t="inlineStr"><is><t>DELIVERED ORDERS</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Sales Person</t></is></c><c r="B2" t="inlineStr"><is><t>Sales</t></is></c><c r="C2" t="inlineStr"><is><t>Avg Sales</t></is></c><c r="D2" t="inlineStr"><is><t>Fin %</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>TARIK NASSIF</t></is></c><c r="B3"><v>3003.97</v></c><c r="C3"><v>1001.32</v></c><c r="D3"><v>50</v></c></row>
    <row r="4"><c r="A4" t="inlineStr"><is><t>ELIZABETH PEREZ</t></is></c><c r="B4"><v>-301.3</v></c><c r="C4"><v>-60.26</v></c></row>
    <row r="5"><c r="A5" t="inlineStr"><is><t>TOTAL</t></is></c><c r="B5"><v>2702.67</v></c><c r="C5"><v>337.83</v></c></row>
  </sheetData></worksheet>`;
  const report = parseKpiWorkbook(zipStored({ 'xl/worksheets/sheet1.xml': sheet }), 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-15_2026-10-15.xlsx');
  const sales = recordsFromKpi(report, '2026-10-15').filter((record) => record.view.startsWith('DA_SALES_'));
  assert.deepEqual(sales.map((record) => [record.view, record.grain, record.employeeName, record.side, record.salesDollars, record.unitCount, record.reportDate]), [
    ['DA_SALES_STORE', 'daily', '', 'delivered', 2702.67, 8, '2026-10-15'],
    ['DA_SALES_PERSON', 'daily', 'Ricky Nassif', 'delivered', 3003.97, 3, '2026-10-15'],
    ['DA_SALES_PERSON', 'daily', 'Elizabeth Perez', 'delivered', -301.3, 5, '2026-10-15'],
  ]);
  assert.equal(sales[1]?.recordKey, 'DA_SALES_PERSON|daily|2026-10-15|2026-10-15|2026-10-15|delivered|TNASSI');
});

test('a blank group is zero and 0% in a daily report but stays blank in a snapshot', () => {
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>GROUP 17</t></is></c><c r="B1" t="inlineStr"><is><t>DELIVERED ORDERS</t></is></c><c r="E1" t="inlineStr"><is><t>LEATHER</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>Sales Person</t></is></c><c r="B2" t="inlineStr"><is><t>Sales</t></is></c><c r="C2" t="inlineStr"><is><t>Avg Sales</t></is></c><c r="D2" t="inlineStr"><is><t>Fin %</t></is></c><c r="E2" t="inlineStr"><is><t>Qual Qty</t></is></c><c r="F2" t="inlineStr"><is><t>Sold Qty</t></is></c><c r="G2" t="inlineStr"><is><t>Sold $</t></is></c><c r="H2" t="inlineStr"><is><t>Attach %</t></is></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>TOTAL</t></is></c><c r="B3"><v>500</v></c><c r="C3"><v>250</v></c></row>
  </sheetData></worksheet>`;
  const bytes = zipStored({ 'xl/worksheets/sheet1.xml': sheet });
  const day = parseKpiWorkbook(bytes, 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-14_2026-10-14.xlsx').store;
  assert.equal(day?.finance, 0);
  assert.deepEqual([day?.leather.qual, day?.leather.sold, day?.leather.dollars, day?.leather.percent], [0, 0, 0, 0]);
  const snapshot = parseKpiWorkbook(bytes, 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-02_2026-11-01.xlsx').store;
  assert.equal(snapshot?.finance, null);
  assert.deepEqual([snapshot?.leather.qual, snapshot?.leather.sold, snapshot?.leather.percent], [null, null, null]);
});

test('a blank shared string does not become its index', () => {
  const strings = Array.from({ length: 20 }, () => '<si><t></t></si>').join('');
  const workbook = zipStored({
    'xl/sharedStrings.xml': `<?xml version="1.0"?><sst>${strings}</sst>`,
    'xl/worksheets/sheet1.xml': '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="s"><v>19</v></c><c r="B1"><v>20.6</v></c></row></sheetData></worksheet>',
  });
  const rows = firstSheet(unzip(workbook));
  assert.equal(rows[0]?.[0], null);
  assert.equal(rows[0]?.[1], '20.6');
});

function loadReports() {
  return readdirSync(reportDir)
    .filter((name) => name.endsWith('.xlsx'))
    .map((name) => parseKpiWorkbook(readFileSync(`${reportDir}/${name}`), name));
}

test('October store KPI files reconcile without adding the day snapshot', { skip: !hasReports }, () => {
  const reports = loadReports();
  const written = storeSnapshot(reports, 'group17', 'written', '2026-10-02', '2026-11-01');
  const delivered = storeSnapshot(reports, 'group17', 'delivered', '2026-10-02', '2026-11-01');
  const aslWritten = storeSnapshot(reports, 'asl', 'written', '2026-10-02', '2026-11-01');
  const aslDelivered = storeSnapshot(reports, 'asl', 'delivered', '2026-10-02', '2026-11-01');
  assert.ok(written && delivered && aslWritten && aslDelivered);
  assert.equal(written.sales, 106106.96);
  assert.equal(delivered.sales, 88039.94);
  assert.equal(written.averageSale, 2040.52);
  assert.equal(delivered.averageSale, 1257.71);
  assert.notEqual(aslWritten.averageSale, written.averageSale);
  assert.equal(written.finance, 0.233);
  assert.equal(delivered.finance, 0.443);
  assert.equal(written.beddingPercent, 0.206);
  assert.equal(delivered.beddingPercent, 0.137);
  assert.equal(written.fabric.percent, 0.587);
  assert.equal(delivered.fabric.percent, 0.941);
  assert.equal(written.power.percent, 0.75);
  assert.equal(delivered.power.percent, 0.857);
  assert.equal(written.leather.percent, 0.6);
  assert.equal(delivered.leather.percent, 0.765);
  assert.equal(written.pads.percent, 0.3);
  assert.equal(delivered.pads.percent, 1);
  assert.equal(aslWritten.adjustable?.percent, 0.273);
  assert.equal(aslDelivered.adjustable?.percent, 0.25);
  assert.equal(aslWritten.powerBasePercent, null);
  assert.equal(aslDelivered.powerBasePercent, null);
  assert.equal(aslWritten.pillows?.qual, 10);
  assert.equal(aslWritten.pillows?.sold, 0);
  assert.equal(aslWritten.pillows?.dollars, 0);
  assert.equal(aslWritten.pillows?.percent, 0);
  assert.equal(aslDelivered.pillows?.sold, 0);
  assert.equal(aslWritten.rugsQty, 7);
  assert.equal(aslDelivered.rugsQty, 3);
  const protection = (line: typeof aslWritten) => [line.furnitureProtection?.qual, line.furnitureProtection?.sold, line.furnitureProtection?.dollars, line.furnitureProtection?.percent];
  assert.deepEqual(protection(aslWritten), [20, 3, 149.97, 0.15]);
  assert.deepEqual(protection(aslDelivered), [28, 5, 299.94, 0.179]);
  assert.equal(written.furnitureProtection, null, 'Group 17 has no furniture protection group');
  assert.equal(written.fabric.mismatch, false);
  assert.equal(delivered.power.mismatch, false);

  const aslDay = reports.find((report) => report.family === 'asl' && report.side === 'written' && report.start === '2026-10-13' && report.end === '2026-10-13');
  const aslRecords = aslDay ? recordsFromKpi(aslDay, '2026-10-13') : [];
  assert.equal(aslRecords.some((row) => row.employeeName === '09' || row.view.endsWith('_PERSON')), false);
  assert.equal(aslRecords.some((row) => row.view === 'FABW_STORE'), false);
  const dayRecords = recordsFromKpi(reports.find((report) => report.filename.includes('17_WRITTEN_2026-10-13'))!, '2026-10-13');
  const snapshotRecords = recordsFromKpi(reports.find((report) => report.filename.includes('17_WRITTEN_2026-10-02_2026-11-01'))!, '2026-10-13');
  const counted = attachmentFromDaily([...dayRecords, ...snapshotRecords], 'FABW_STORE', 'written', '2026-10-02', '2026-11-01');
  const dayOnly = attachmentFromDaily(dayRecords, 'FABW_STORE', 'written', '2026-10-02', '2026-11-01');
  assert.equal(counted.attachments, dayOnly.attachments);
  assert.equal(dayRecords.some((row) => row.view === 'AVERAGE_STORE' && row.salesDollars !== null), true);
  const day = reports.find((report) => report.family === 'group17' && report.side === 'written' && report.start === '2026-10-13' && report.end === '2026-10-13');
  const deliveredDay = reports.find((report) => report.family === 'group17' && report.side === 'delivered' && report.start === '2026-10-13' && report.end === '2026-10-13');
  assert.equal(day?.store?.sales, 7105.89);
  assert.equal(deliveredDay?.store?.sales, 6933.21);
  assert.equal(storeSnapshot(reports, 'group17', 'written', '2026-10-02', '2026-11-01')?.sales, 106106.96);
  const aslTotal = reports.find((report) => report.filename.includes('ASL_WRITTEN_2026-10-02'))?.lines.find((line) => line.name === 'TOTAL');
  assert.notEqual(aslTotal?.sales, 106106.96);

  const blankStore = aslWritten && reports.find((report) => report.filename.includes('ASL_WRITTEN_2026-10-02'))?.lines.find((line) => line.name === '09');
  assert.equal(blankStore?.sales, null);

  const source = readFileSync(new URL('../apps-script/Data.gs', import.meta.url), 'utf8');
  const block = source.split('function kpiActuals_()')[1]?.split('function ')[0] ?? '';
  const seeded = [...block.matchAll(/\['([^']+)', (null|-?[0-9.]+), (null|-?[0-9.]+),/g)];
  const expected: Record<string, [number | null, number | null]> = {
    Bedding: [written.beddingPercent, delivered.beddingPercent],
    'Adjustable Base Attachment': [aslWritten.adjustable?.percent ?? null, aslDelivered.adjustable?.percent ?? null],
    Pillows: [null, null],
    'Mattress Protectors': [written.pads.percent, delivered.pads.percent],
    'Overall Warranty % of Sales': [null, null],
    'Fabric Maintenance': [written.fabric.percent, delivered.fabric.percent],
    'Leather Maintenance': [written.leather.percent, delivered.leather.percent],
    'Power Upholstery': [written.power.percent, delivered.power.percent],
    'Power Adjustable Base': [null, null],
    'Wood Kits': [null, null],
    Finance: [written.finance, delivered.finance],
    'Average Ticket': [written.averageSale, delivered.averageSale],
    Rugs: [aslWritten.rugsQty, aslDelivered.rugsQty],
  };
  assert.equal(seeded.length, Object.keys(expected).length);
  for (const match of seeded) {
    const name = match[1] ?? '';
    const pair = expected[name];
    assert.ok(pair, name);
    assert.equal(match[2] === 'null' ? null : Number(match[2]), pair[0], name);
    assert.equal(match[3] === 'null' ? null : Number(match[3]), pair[1], name);
  }
});

test('the Group 17 Total Attachments group is kept as printed, with its sold dollars, on ATTACH rows', () => {
  const head = (cells: [string, string][], r: number) => `<row r="${r}">${cells.map(([ref, text]) => `<c r="${ref}${r}" t="inlineStr"><is><t>${text}</t></is></c>`).join('')}</row>`;
  const nums = (name: string, values: [string, number][], r: number) => `<row r="${r}"><c r="A${r}" t="inlineStr"><is><t>${name}</t></is></c>${values.map(([ref, value]) => `<c r="${ref}${r}"><v>${value}</v></c>`).join('')}</row>`;
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>
    ${head([['A', 'GROUP 17'], ['B', 'DELIVERED ORDERS'], ['F', 'MATTRESS PADS'], ['J', 'TOTAL ATTACHMENTS %']], 1)}
    ${head([['A', 'Sales Person'], ['B', 'Sales'], ['C', 'Avg Sales'], ['D', 'Fin %'], ['F', 'Qual Qty'], ['G', 'Sold Qty'], ['H', 'Sold $'], ['I', 'Attach %'], ['J', 'Qual Qty'], ['K', 'Sold Qty'], ['L', 'Sold $'], ['M', 'Attach %']], 2)}
    ${nums('RENZO DELSOLAR', [['B', 32267.815], ['C', 1290.7126], ['F', 1], ['G', 2], ['H', 259.98], ['I', 200], ['J', 43], ['K', 44], ['L', 1357.57], ['M', 102.3]], 3)}
    ${nums('TOTAL', [['B', 32267.815], ['C', 1290.7126], ['F', 1], ['G', 2], ['H', 259.98], ['I', 200], ['J', 43], ['K', 44], ['L', 1357.57], ['M', 102.3]], 4)}
  </sheetData></worksheet>`;
  const report = parseKpiWorkbook(zipStored({ 'xl/worksheets/sheet1.xml': sheet }), 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-01_2026-10-13.xlsx');
  const renzo = report.lines.find((line) => line.name === 'RENZO DELSOLAR');
  assert.deepEqual([renzo?.totalAttach?.qual, renzo?.totalAttach?.sold, renzo?.totalAttach?.dollars, renzo?.totalAttach?.percent], [43, 44, 1357.57, 1.023],
    'sold above qualified is kept as printed');
  const attach = recordsFromKpi(report, '2026-10-13').filter((record) => record.view.startsWith('ATTACH_'));
  assert.deepEqual(attach.map((record) => [record.view, record.employeeName, record.eligible, record.attachments, record.salesDollars]), [
    ['ATTACH_STORE', '', 43, 44, 1357.57],
    ['ATTACH_PERSON', 'Renzo Del Solar', 43, 44, 1357.57],
  ]);
});
