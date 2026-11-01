/**
 * Former-employee sales stay on the printed name and in the store total.
 * They are located to Kelly Meyers and Liz Perez, not added to either manager or to an active salesperson.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const admin = session;

test('Brett Kehler is former; his delivered sale is located to Kelly Meyers and Liz Perez and the dollars stay put', () => {
  const { gs, tabs } = harness();
  const written = Number(plain(gs.home_({ session: admin })).month.written);
  const delivered = Number(plain(gs.home_({ session: admin })).month.delivered);
  gs.ensureRosterColumns_();
  assert.equal(gs.rosterMatch_('', 'BRETT KEHLER').name, 'Brett Kehler');
  assert.equal(gs.rosterMatch_('', 'KEHLER, BRETT').name, 'Brett Kehler');
  assert.equal(gs.rosterRole_(gs.rosterMatch_('', 'BRETT KEHLER').raw, '2026-10-31'), 'former');
  const kellyBefore = cells(tabs.CC_People).find((row) => row[0] === 'Kelly Meyers')![2];
  const lizBefore = cells(tabs.CC_People).find((row) => row[0] === 'Elizabeth Perez')![2];

  tabs.CC_Ledger.push([
    'DA_SALES_PERSON', 'daily', '2026-10-31', '2026-10-31', '2026-10-31', '2026-10-31', '17',
    '', 'BRETT KEHLER', 'delivered', -191.42, '', '', '', '',
    'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-31_2026-10-31.xlsx', '2026-11-01T00:00:00.000Z',
    'DA_SALES_PERSON|daily|2026-10-31|2026-10-31|2026-10-31|delivered|BRETT KEHLER',
  ]);
  tabs.CC_Ledger.push([
    'AVERAGE_PERSON', 'daily', '2026-10-31', '2026-10-31', '2026-10-31', '2026-10-31', '17',
    '', 'BRETT KEHLER', 'delivered', -191.42, '', '', '', '',
    'DATA_ANALYSIS_KPI_17_DELIVERED_2026-10-31_2026-10-31.xlsx', '2026-11-01T00:00:00.000Z',
    'AVERAGE_PERSON|daily|2026-10-31|2026-10-31|2026-10-31|delivered|BRETT KEHLER',
  ]);

  const page = plain(gs.people_({ session: admin }));
  const brett = page.formerSales.filter((item: { name: string }) => item.name === 'Brett Kehler');
  assert.equal(brett.length, 1, 'the average-ticket line is not a second sale');
  assert.equal(brett[0].sales, -191.42);
  assert.equal(brett[0].side, 'delivered');
  assert.equal(brett[0].date, '2026-10-31');
  assert.equal(brett[0].locatedTo, 'Kelly Meyers and Liz Perez');
  assert.ok(!page.formerSales.some((item: { name: string }) => /Kelly Meyers|Elizabeth Perez|Liz Perez/.test(item.name)));
  assert.ok(!page.people.some((person: { name: string }) => /Brett|Kelly|Elizabeth|Liz/.test(person.name)));
  assert.match(page.deliveredVariance.note, /located to Kelly Meyers and Liz Perez/);
  assert.match(page.deliveredVariance.note, /not forced to match/);

  const kelly = cells(tabs.CC_People).find((row) => row[0] === 'Kelly Meyers')!;
  const liz = cells(tabs.CC_People).find((row) => row[0] === 'Elizabeth Perez')!;
  assert.equal(kelly[2], kellyBefore);
  assert.equal(liz[2], lizBefore);
  assert.match(String(kelly[kelly.length - 2] || kelly.join(' ')), /located to Kelly Meyers and Liz Perez/);
  const saved = cells(tabs.CC_Ledger).filter((row) => String(row[8]).toUpperCase() === 'BRETT KEHLER' && row[0] === 'DA_SALES_PERSON');
  assert.equal(saved.length, 1);
  assert.equal(saved[0]![8], 'BRETT KEHLER');
  assert.equal(Number(saved[0]![10]), -191.42);
  assert.equal(Number(plain(gs.home_({ session: admin })).month.written), written);
  assert.equal(Number(plain(gs.home_({ session: admin })).month.delivered), delivered);
});
