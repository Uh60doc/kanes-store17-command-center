/**
 * GM confirmation: former identities, store-level last-year, associate vs store delivered variance.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session, tabText } from './octoberVerified.ts';

const admin = session;

test('Mukhtar/Jimmy and Filepe Chaves match as former; Maria stays unmatched; amounts unchanged', () => {
  const { gs, tabs } = harness();
  const written = Number(plain(gs.home_({ session: admin })).month.written);
  const delivered = Number(plain(gs.home_({ session: admin })).month.delivered);
  const identityTabs = ['CC_People', 'CC_RosterHistory', 'CC_AssociateDays', 'CC_QualityChecks', 'CC_QualityRuns', 'CC_DataStatus', 'CC_Alerts', 'CC_Health'];
  const beforeSales = tabText(tabs, identityTabs);

  gs.ensureRosterColumns_();
  assert.equal(gs.rosterMatch_('', 'MUKHTAR, JUNAID').name, 'Mukhtar Junaid');
  assert.equal(gs.rosterMatch_('', 'Jimmy').name, 'Mukhtar Junaid');
  assert.equal(gs.rosterMatch_('', 'CHAVES, FELIPE').name, 'Filepe Chaves');
  assert.equal(gs.rosterMatch_('', 'FELIPE CHAVES').name, 'Filepe Chaves');
  assert.equal(gs.rosterMatch_('', 'MARIA RAFALIK'), null);
  assert.equal(gs.rosterMatch_('', 'Maria Rafalik'), null);

  const rematched = gs.rematchAssociateDays_();
  assert.ok(rematched >= 2, `expected AssociateDays rematch for former identities, got ${rematched}`);
  const mukhtar = cells(tabs.CC_AssociateDays).find((row) => String(row[1]).toUpperCase() === 'MUKHTAR, JUNAID')!;
  assert.equal(mukhtar[2], 'Mukhtar Junaid');
  assert.equal(mukhtar[3], 'former');
  assert.equal(Number(mukhtar[4]), -2599);
  const chaves = cells(tabs.CC_AssociateDays).find((row) => String(row[1]).toUpperCase() === 'CHAVES, FELIPE')!;
  assert.equal(chaves[2], 'Filepe Chaves');
  assert.equal(chaves[3], 'former');
  assert.equal(Number(chaves[4]), -180);
  assert.equal(String(chaves[1]), 'CHAVES, FELIPE', 'original report spelling is preserved');

  const people = plain(gs.people_({ session: admin }));
  assert.ok(!people.people.some((person: { name: string }) => /Mukhtar|Filepe|Maria|Jimmy/i.test(person.name)), 'former and unmatched stay off the active board');
  assert.ok(people.deliveredVariance);
  assert.match(people.deliveredVariance.note, /not forced to match/i);
  assert.equal(Number(plain(gs.home_({ session: admin })).month.written), written);
  assert.equal(Number(plain(gs.home_({ session: admin })).month.delivered), delivered);
  assert.equal(tabText(tabs, identityTabs), beforeSales, 'store sales and KPI tabs unchanged; identity rematch is allowlisted');
});

test('last-year comparisons stay store-level; person track does not invent individual prior-year figures', () => {
  const { gs } = harness();
  const ly = plain(gs.lastYearFor_({ ly: { start: '2025-10-01', end: '2025-10-31', confirmed: true, status: 'ok' }, track: 'Person' }, [], { track: 'Person', metric: 'SNAP Written', side: '', employeeId: 'PGANDH', person: 'Prakash Gandhi' }));
  assert.equal(ly.value, 'Pending');
  assert.match(ly.basis, /store-level/i);
  const storeLy = plain(gs.briefLastYearStore_(plain(gs.config_()), { start: '2026-10-02', end: '2026-11-01', year: 2026, month: 10 }));
  assert.ok(storeLy.written);
  assert.ok(storeLy.delivered);
});
