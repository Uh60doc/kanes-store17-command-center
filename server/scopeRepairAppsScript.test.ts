/**
 * Calculated STORE and PERSON tabs are one formula in A1. A typed row in the spill range makes A1 show #REF!.
 * The repair removes those blockers and keeps CC_Ledger as the source of the figures.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { harness, verifiedOctober } from './octoberVerified.ts';
import { table } from './snapshotGrid.ts';

const FORMULA = '=FILTER(CC_Ledger!A2:R,TRUE)';

test('a #REF! on a calculated person tab is cleared without changing a verified ledger amount', () => {
  const tabs = verifiedOctober();
  const before = table(tabs, 'CC_Ledger').map((row) => `${row.record_key}|${row.sales_dollars}`);
  tabs.DA_SALES_PERSON = [
    [FORMULA],
    ['DA_SALES_PERSON', 'daily', '2026-10-14', '2026-10-14', '2026-10-14', '2026-10-14', '17', 'PGANDH', 'Prakash Gandhi', 'delivered', 924.99, 1, '', '', '', 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-14_2026-10-14.xlsx', '2026-10-16T20:26:43.734Z'],
    ['DA_SALES_PERSON', 'daily', '2026-10-14', '2026-10-14', '2026-10-14', '2026-10-14', '17', 'PGANDH', 'Prakash Gandhi', 'delivered', 9999, 1, '', '', '', 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-14_2026-10-14.xlsx', '2026-10-16T20:26:43.734Z'],
    ['DA_SALES_PERSON', 'daily', '2026-09-15', '2026-09-15', '2026-09-15', '2026-09-15', '17', 'FTEST', 'Former Associate', 'delivered', -75, 1, '', '', '', 'DATA_ANALYSIS_KPI_17_DELIVERED_2026-09-15_2026-09-15.xlsx', '2026-09-16T00:00:00.000Z'],
  ];
  tabs.CC_Ledger.push([
    'SNAP_PERSON', 'daily', '2026-10-16', '2026-10-16', '2026-10-16', '2026-10-16', '17', '', 'Renzo Del Solar', 'written', 96, 1, '', '', '', 'output (1)(4).pdf', '2026-10-18T00:00:00.000Z',
    'SNAP_PERSON|daily|2026-10-16|2026-10-16|2026-10-16|written|Renzo Del Solar',
  ]);
  tabs.CC_Ledger.push([
    'AVERAGE_STORE', 'daily', '2026-10-16', '2026-10-16', '2026-10-16', '2026-10-16', '17', '', '', 'written', 2099.1, '', '', '', '', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-16_2026-10-16.xlsx', '2026-10-18T00:00:00.000Z',
    'AVERAGE_STORE|daily|2026-10-16|2026-10-16|2026-10-16|written|STORE',
  ]);
  tabs.SNAP_PERSON = [
    [FORMULA],
    ['SNAP_PERSON', 'daily', '2026-10-16', '2026-10-16', '2026-10-16', '2026-10-16', '17', 'RDELSO', 'Renzo Del Solar', 'written', 96, 1, '', '', '', 'output (1)(4).pdf', '2026-10-17T23:38:47.493Z'],
  ];
  tabs.AVERAGE_STORE = [
    [FORMULA],
    ['AVERAGE_STORE', 'daily', '2026-10-16', '2026-10-16', '2026-10-16', '2026-10-16', '17', '', '', 'written', 2099.096, '', '', '', '', 'DATA_ANALYSIS_KPI_17_WRITTEN_2026-10-16_2026-10-16.xlsx', '2026-10-17T23:38:47.493Z'],
  ];
  tabs.SNAP_STORE = [[FORMULA]];
  tabs.BEDDING_STORE = [['typed header'], ['leave me']];
  const { gs } = harness(tabs);
  const notes: string[] = [];
  (gs as unknown as Record<string, unknown>).appendException_ = (severity: string, message: string) => { notes.push(`${severity} ${message}`); };

  const repaired = plain(gs.repairScopeViewSheets_()) as string[];
  assert.deepEqual(repaired, [
    'SNAP_PERSON',
    'AVERAGE_STORE',
    'DA_SALES_PERSON (saved to CC_Ledger: DA_SALES_PERSON|daily|2026-09-15|2026-09-15|2026-09-15|delivered|FTEST)',
  ]);
  assert.equal(String(tabs.DA_SALES_PERSON[0]![0]), FORMULA);
  assert.equal(tabs.DA_SALES_PERSON.slice(1).every((row) => row.every((cell) => cell === '')), true);
  assert.deepEqual(tabs.SNAP_STORE, [[FORMULA]]);
  assert.deepEqual(tabs.BEDDING_STORE, [['typed header'], ['leave me']]);

  const ledger = table(tabs, 'CC_Ledger');
  const prakash = ledger.filter((row) => row.record_key === 'DA_SALES_PERSON|daily|2026-10-14|2026-10-14|2026-10-14|delivered|PGANDH');
  assert.equal(prakash.length, 1);
  assert.equal(prakash[0]!.sales_dollars, '924.99');
  const felipe = ledger.filter((row) => row.record_key === 'DA_SALES_PERSON|daily|2026-10-14|2026-10-14|2026-10-14|delivered|FELIPE CHAVES');
  assert.equal(felipe.length, 1);
  assert.equal(felipe[0]!.sales_dollars, '-320');
  const renzo = ledger.filter((row) => row.record_key.includes('2026-10-16') && row.view === 'SNAP_PERSON' && row.employee_name === 'Renzo Del Solar');
  assert.equal(renzo.length, 1);
  assert.equal(renzo[0]!.employee_code, '');
  assert.equal(renzo[0]!.sales_dollars, '96');
  const average = ledger.filter((row) => row.record_key === 'AVERAGE_STORE|daily|2026-10-16|2026-10-16|2026-10-16|written|STORE');
  assert.equal(average.length, 1);
  assert.equal(average[0]!.sales_dollars, '2099.1');
  const former = ledger.filter((row) => row.employee_code === 'FTEST');
  assert.equal(former.length, 1);
  assert.equal(former[0]!.sales_dollars, '-75');
  assert.equal(former[0]!.side, 'delivered');
  assert.match(notes.join('\n'), /Needs Review.*9999.*924\.99/);
  assert.doesNotMatch(notes.join('\n'), /2099/);

  const again = plain(gs.repairScopeViewSheets_()) as string[];
  assert.deepEqual(again, []);
  assert.equal(table(tabs, 'CC_Ledger').filter((row) => row.employee_code === 'FTEST').length, 1);
  const after = table(tabs, 'CC_Ledger').filter((row) => row.employee_code !== 'FTEST' && !row.record_key.includes('2026-10-16|2026-10-16|2026-10-16|written|Renzo Del Solar') && row.record_key !== 'AVERAGE_STORE|daily|2026-10-16|2026-10-16|2026-10-16|written|STORE').map((row) => `${row.record_key}|${row.sales_dollars}`);
  assert.deepEqual(after, before);
});
