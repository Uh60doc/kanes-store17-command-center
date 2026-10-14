import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
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
  assert.equal(aslWritten.pillows?.sold, null);
  assert.equal(aslWritten.pillows?.percent, null);
  assert.equal(aslDelivered.pillows?.sold, null);
  assert.equal(aslWritten.rugsQty, 7);
  assert.equal(aslDelivered.rugsQty, 3);
  assert.equal(written.fabric.mismatch, false);
  assert.equal(delivered.power.mismatch, false);

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
