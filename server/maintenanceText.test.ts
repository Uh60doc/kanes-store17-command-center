import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMppa, parseRugs, parseUvwl } from './maintenanceText.ts';

const mppa = `
FROM 02-OCT-2026 TO 11-OCT-2026
PGANDH             PRAKASH       GANDHI                    5.0           2.0        40.0                                        40.0             1.0              20.0
EMON0904           ERIC          MONTES                    3.0           1.0        33.3                                        33.3             2.0              66.7
JMEYERS            JAMES         MEYERS                    1.0
                      17 - ORLANDO Totals:                 9.0           3.0        33.3                                        33.3             3.0              33.3
`;

test('the October MPPA written report keeps mattress, protector, and base counts', () => {
  const report = parseMppa(mppa);
  assert.ok(report);
  const store = report.lines.find((line) => line.name === 'STORE');
  assert.equal(store?.mattressSales, 9);
  assert.equal(store?.padSales, 3);
  assert.equal(store?.padPercent, 0.333);
  assert.equal(store?.baseSales, 3);
  assert.equal(store?.basePercent, 0.333);
  assert.equal(report.lines.filter((line) => line.code).length, 2);
  assert.equal(report.start, '2026-10-02');
  assert.equal(report.end, '2026-10-11');
});

test('wood kits and rugs keep their own counts', () => {
  const wood = parseUvwl(`
FROM 02-OCT-2026 TO 11-OCT-2026
PGANDH             PRAKASH GANDHI                               5.0                         2.0            40.0
                       17 - ORLANDO Totals:                    13.0                         3.0            23.1
`);
  assert.equal(wood?.lines.find((line) => line.name === 'STORE')?.woodWarranties, 3);
  assert.equal(wood?.lines.find((line) => line.name === 'STORE')?.woodPercent, 0.231);
  const rugs = parseRugs(`
WRITTEN RUG SALES BY SALESPERSON 02-OCT-2026 thru 11-OCT-2026
ERIC MONTES                                                                   5              1,384
                                                       Totals:                6              1,584
`);
  assert.equal(rugs?.lines.find((line) => line.name === 'STORE')?.rugCount, 6);
  assert.equal(rugs?.lines.find((line) => line.name === 'STORE')?.rugDollars, 1584);
});
