import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function load() {
  const sandbox: Record<string, unknown> = { SPREADSHEET_ID_: 'test' };
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../apps-script/Data.gs', import.meta.url), 'utf8'), sandbox);
  return sandbox as Record<string, (...args: unknown[]) => any>;
}

const through = '2026-10-15';
const actuals = (extra: Record<string, unknown> = {}) => ({
  Bedding: { written: 0.198, delivered: 0.12, note: '', through },
  'Average Ticket': { written: 1964.16, delivered: 1270.98, note: '', through },
  Rugs: { written: 7, delivered: 3, note: '', through },
  'Fabric Maintenance': { written: 0.631, delivered: 0.875, note: '', through },
  'Leather Maintenance': { written: 0.6, delivered: 0.778, note: '', through },
  'Power Upholstery': { written: 0.778, delivered: 0.875, note: '', through },
  'Mattress Protectors': { written: 0.3, delivered: 0.75, note: '', through },
  'Total Attachment': { written: 0.614, delivered: 0.856, note: '', through },
  'Adjustable Base Attachment': { written: 0.273, delivered: 0.2, note: '', through },
  Pillows: { written: 0, delivered: 0, note: '', through },
  'Wood / Furniture Protection': { written: 0.136, delivered: 0.229, note: '', through },
  Finance: { written: 0.234, delivered: 0.471, note: '', through },
  'Overall Warranty % of Sales': { written: null, delivered: null, note: 'Not verified.', through: '' },
  'Power Adjustable Base': { written: null, delivered: null, note: 'ADJ PWR % is blank.', through: '' },
  ...extra,
});
const closing = { ratio: 0.486, customers: 54, opportunities: 111, through, reconcile: false, latest: null };

test('Home MTD KPIs: Bedding, Closing Ratio, Average Ticket and Rugs lead, every other KPI follows once', () => {
  const gs = load();
  const goals = gs.approvedGoals_({ attachment_goal: 0.9 });
  const rows = plain(gs.homeKpiStrip_(goals, actuals(), closing)) as { name: string; tier: string; goal: number; written: number | null; delivered: number | null; through: string; detail: string }[];
  assert.deepEqual(rows.filter((row) => row.tier === 'primary').map((row) => row.name), ['Bedding', 'Closing Ratio', 'Average Ticket', 'Rugs']);
  assert.deepEqual(rows.filter((row) => row.tier === 'secondary').map((row) => row.name), [
    'Fabric Maintenance', 'Leather Maintenance', 'Power Upholstery', 'Mattress Protectors', 'Total Attachment',
    'Adjustable Base Attachment', 'Pillows', 'Wood / Furniture Protection', 'Financing',
  ]);
  assert.equal(new Set(rows.map((row) => row.name)).size, rows.length, 'no duplicate tiles');
  assert.equal(rows.some((row) => /Power Adjustable Base|Wood Kits|Warranty/.test(row.name)), false);

  const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
  const goalOf = (name: string) => byName[name]?.goal;
  assert.deepEqual(
    ['Fabric Maintenance', 'Leather Maintenance', 'Power Upholstery', 'Mattress Protectors', 'Wood / Furniture Protection', 'Closing Ratio', 'Bedding', 'Average Ticket', 'Rugs'].map(goalOf),
    [0.8, 0.8, 0.8, 0.8, 0.5, 0.5, 0.2, 2500, 12],
  );
  assert.equal(goalOf('Total Attachment'), 0.9);
  assert.deepEqual([byName['Closing Ratio']?.written, byName['Closing Ratio']?.delivered, byName['Closing Ratio']?.through], [0.486, null, through]);
  assert.deepEqual([byName.Financing?.written, byName.Financing?.delivered], [0.234, 0.471]);
  assert.match(byName['Wood / Furniture Protection']?.detail ?? '', /UVWL .* not added/);
});

test('Warranty % of Sales appears only with a verified store-period figure, and ADJ PWR % rides on the Adjustable Base tile', () => {
  const gs = load();
  const goals = gs.approvedGoals_({});
  const rows = plain(gs.homeKpiStrip_(goals, actuals({
    'Overall Warranty % of Sales': { written: 0.041, delivered: 0.038, note: '', through },
    'Power Adjustable Base': { written: 0.5, delivered: null, note: '', through },
  }), closing)) as { name: string; tier: string; goal: number; detail: string }[];
  const warranty = rows.filter((row) => row.name === 'Warranty % of Sales');
  assert.equal(warranty.length, 1);
  assert.deepEqual([warranty[0]?.tier, warranty[0]?.goal], ['secondary', 0.055]);
  assert.equal(rows.find((row) => row.name === 'Adjustable Base Attachment')?.detail, 'ADJ PWR % written 50.0%, delivered Pending');
  assert.equal(rows.some((row) => row.name === 'Power Adjustable Base'), false);

  const noDate = plain(gs.homeKpiStrip_(goals, actuals({ 'Overall Warranty % of Sales': { written: 0.041, delivered: null, note: '', through: '' } }), closing)) as { name: string }[];
  assert.equal(noDate.some((row) => row.name === 'Warranty % of Sales'), false);
});
