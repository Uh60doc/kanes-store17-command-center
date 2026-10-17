import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import test from 'node:test';
import { planPerqImport, type PerqFile, type Sheets } from './importPerqDays.ts';
import { HELD_BLOCK, NOT_PERQ, PERQ_DAYS, dayCounts, parsePerqExport, type PerqExport } from './perqDays.ts';
import { unzip } from './xlsxLite.ts';

const CLOSING = ['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through', 'store'];
const LEDGER = ['view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store', 'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'];
const PERQ = 'PERQ Ups + Be Backs';

const location = (store17: number): PerqExport => ({ kind: 'location', store17, people: [], exportedAt: '' });
const salesperson = (people: [string, string, number][]): PerqExport => ({
  kind: 'salesperson', store17: null, exportedAt: '', people: people.map(([code, name, opportunities]) => ({ code, name, opportunities })),
});
const day = (date: string) => PERQ_DAYS.find((item) => item.date === date)!;

function emptySheets(): Sheets {
  return {
    closing: [CLOSING],
    ledger: [LEDGER],
    imports: [['sha256', 'file_name', 'report_type', 'status', 'imported_at', 'note']],
    exceptions: [['at', 'severity', 'message']],
    coverage: [['report', 'earliest', 'latest', 'verified_daily_records', 'daily_dates', 'cumulative_only', 'missing_daily_dates', 'sheets_status'], ['PERQ', '', '', '0', '', '', '', '']],
  };
}

/** October 14 and 15 files, one held export, and the mislabeled ASL workbook. */
function sampleFiles(): PerqFile[] {
  const oct14 = day('2026-10-14');
  const oct15 = day('2026-10-15');
  return [
    { name: 'Performance Stats by Location (13).xlsx', sha256: oct14.location[0], parsed: location(4) },
    { name: 'Performance Stats by Salesperson (15).xlsx', sha256: oct14.salesperson[0], parsed: salesperson([['RDELSO', 'Renzo Del Solar', 4]]) },
    { name: 'Performance Stats by Location (14).xlsx', sha256: oct15.location[0], parsed: location(7) },
    { name: 'Performance_Stats_by_Location.xlsx', sha256: oct15.location[1], parsed: location(7) },
    { name: 'Performance Stats by Salesperson (16).xlsx', sha256: oct15.salesperson[0], parsed: salesperson([['EMON0904', 'Eric Montes Rodriguez', 3], ['TNASSI', 'Ricky Nassif', 3]]) },
    { name: 'Performance Stats by Location (1).xlsx', sha256: HELD_BLOCK.exports[0].location, parsed: location(9) },
    { name: 'Performance_Stats_by_Salesperson.xlsx', sha256: Object.keys(NOT_PERQ)[0], parsed: null },
  ];
}

test('a PERQ location export reads Store 17 and a salesperson export maps roster codes and blank counts', () => {
  assert.deepEqual(parsePerqExport([['Performance Stats by Location'], ['Location', 'Ups + Be Backs'], ['Store 16 Kissimmee', 5], ['Store 17 South Orlando', 7]]).store17, 7);
  const people = parsePerqExport([
    ['Performance Stats by Salesperson'],
    ['EmployeeCode', 'Name', 'Active Deals 10/15/26 08:15pm', 'Ups + Be Backs'],
    ['TNASSIF', 'Ricky Nassif', 4, 3],
    ['EMON0904', 'Eric Montes', 2, null],
  ]);
  assert.equal(people.exportedAt, '10/15/26 08:15pm');
  assert.deepEqual(people.people, [
    { code: 'TNASSI', name: 'Ricky Nassif', opportunities: 3 },
    { code: 'EMON0904', name: 'Eric Montes Rodriguez', opportunities: 0 },
  ]);
  assert.throws(() => parsePerqExport([['GROUP ASL'], ['Sales Person']]), /not a PERQ Performance Stats export/);
});

test('a day keeps opportunities the salesperson rows do not cover as unassigned', () => {
  const oct15 = day('2026-10-15');
  const exports = new Map<string, PerqExport>([
    [oct15.location[0], location(7)],
    [oct15.salesperson[0], salesperson([['EMON0904', 'Eric Montes Rodriguez', 3], ['TNASSI', 'Ricky Nassif', 3]])],
  ]);
  const counts = dayCounts(oct15, exports)!;
  assert.equal(counts.store, 7);
  assert.equal(counts.unassigned, 1);
  assert.equal(dayCounts(day('2026-10-12'), exports), null);
  exports.set(oct15.location[1], location(8));
  assert.throws(() => dayCounts(oct15, exports), /disagree/);
  exports.set(oct15.location[1], location(5));
  exports.delete(oct15.location[0]);
  assert.throws(() => dayCounts(oct15, exports), /exceed the store count/);
});

test('the PERQ import adds proven days once, holds undated exports, and flags the unassigned opportunity', () => {
  const sheets = emptySheets();
  sheets.closing.push(['2026-10-14', 'store', '', '', '', 4, '2026-10-14', '2026-10-14', PERQ, 'yes', '', '2026-10-14', '17']);
  const plan = planPerqImport({ files: sampleFiles(), archives: [{ name: 'Performance_Stats_by_Salesperson (13).zip', sha256: 'zip' }], sheets, importedAt: 'now' });

  const daily = plan.appends.CC_Closing.filter((row) => row[6] === row[7]);
  assert.deepEqual(daily.map((row) => [row[0], row[1], row[2], row[5]]), [
    ['2026-10-14', 'person', 'RDELSO', 4],
    ['2026-10-15', 'store', '', 7],
    ['2026-10-15', 'person', 'EMON0904', 3],
    ['2026-10-15', 'person', 'TNASSI', 3],
  ]);
  assert.match(String(daily[1][10]), /1 opportunity is not assigned to any salesperson/);
  assert.ok(!plan.appends.CC_Closing.some((row) => row[1] === 'person' && row[6] === '2026-10-15' && !['EMON0904', 'TNASSI'].includes(String(row[2]))));
  assert.ok(!plan.appends.CC_Closing.some((row) => row[6] === row[7] && row[6] >= HELD_BLOCK.start && row[6] <= HELD_BLOCK.end));
  assert.deepEqual(plan.appends.CC_Closing.filter((row) => row[1] === 'store' && row[6] !== row[7]).map((row) => [row[6], row[7], row[5]]), [
    ['2026-10-02', '2026-10-11', 87],
    ['2026-10-02', '2026-10-13', 100],
  ]);

  const ledgerKeys = plan.appends.CC_Ledger.map((row) => row[17]);
  assert.ok(ledgerKeys.includes('PERQ_STORE|daily|2026-10-15|2026-10-15|2026-10-15||STORE'));
  assert.ok(ledgerKeys.includes('PERQ_PERSON|daily|2026-10-15|2026-10-15|2026-10-15||TNASSI'));
  assert.ok(ledgerKeys.includes('PERQ_STORE|cumulative|2026-10-02|2026-10-11|||STORE'));

  const status = Object.fromEntries(plan.appends.CC_Imports.map((row) => [row[1], row[3]]));
  assert.equal(status['Performance Stats by Location (14).xlsx'], 'imported');
  assert.equal(status['Performance_Stats_by_Location.xlsx'], 'duplicate');
  assert.equal(status['Performance Stats by Location (1).xlsx'], 'held: date unconfirmed');
  assert.equal(status['Performance_Stats_by_Salesperson.xlsx'], 'not used');
  assert.equal(status['Performance_Stats_by_Salesperson (13).zip'], 'imported');
  assert.ok(plan.appends.CC_Exceptions.some((row) => /2026-10-15: Store 17 shows 7 opportunities .* 1 opportunity is not assigned to anyone/.test(String(row[2]))));
  assert.deepEqual(plan.updates.map((item) => item.range), ['CC_Coverage!A2:H2']);
  assert.equal(plan.updates[0].values[0][4], '2026-10-14, 2026-10-15');
});

test('a second PERQ import adds nothing', () => {
  const sheets = emptySheets();
  const first = planPerqImport({ files: sampleFiles(), archives: [], sheets, importedAt: 'first' });
  sheets.closing.push(...first.appends.CC_Closing);
  sheets.ledger.push(...first.appends.CC_Ledger);
  sheets.imports.push(...first.appends.CC_Imports);
  sheets.exceptions.push(...first.appends.CC_Exceptions);
  for (const update of first.updates) sheets.coverage[Number(/A(\d+)/.exec(update.range)![1]) - 1] = update.values[0];
  const second = planPerqImport({ files: sampleFiles(), archives: [], sheets, importedAt: 'second' });
  assert.deepEqual(Object.values(second.appends).map((rows) => rows.length), [0, 0, 0, 0]);
  assert.equal(second.updates.length, 0);
  assert.equal(second.history.length, 0);
});

test('a later PERQ count for a recorded day is logged and not applied', () => {
  const sheets = emptySheets();
  const recorded = ['2026-10-15', 'store', '', '', '', 6, '2026-10-15', '2026-10-15', PERQ, 'yes', '', '2026-10-15', '17'];
  sheets.closing.push(recorded);
  const plan = planPerqImport({ files: sampleFiles(), archives: [], sheets, importedAt: 'now' });
  assert.ok(!plan.appends.CC_Closing.some((row) => row[1] === 'store' && row[6] === '2026-10-15'));
  assert.equal(plan.history.length, 1);
  assert.match(String(plan.history[0][3]), /recorded count was kept .* Later count: 7\./);
  assert.ok(plan.appends.CC_Exceptions.some((row) => /store\|\|2026-10-15\|2026-10-15 later shows 7/.test(String(row[2]))));
});

test('unzip reads an archive whose local headers leave the sizes to a data descriptor', () => {
  const data = Buffer.from('<x/>');
  const name = Buffer.from('a.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0x0008, 6);
  local.writeUInt16LE(name.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc32(data), 4);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(data.length, 12);
  const body = Buffer.concat([local, name, data, descriptor]);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0008, 8);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const directory = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(body.length, 16);
  assert.equal(unzip(Buffer.concat([body, directory, end])).get('a.xml')?.toString(), '<x/>');
});
