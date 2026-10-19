/**
 * October 16 NWDSR Written is $10,495 and SNAP Written is $7,432.
 * Store written through that day is $120,488. Store closing stays 54 / 111 through October 15.
 * Every matching screen has to serve those same figures.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

test('canonical October figures match across the screens that share them', () => {
  const { gs, tabs } = harness();
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-16', storeTotal: 10495 }), 'imported');
  assert.equal(gs.writeDailyAmount_({ reportType: 'SNAP Written', start: '2026-10-16', storeTotal: 7432 }), 'imported');
  assert.equal(gs.writeDailyAmount_({ reportType: 'NWDSR Written', start: '2026-10-16', storeTotal: 10495 }), 'same');
  const dailyBefore = JSON.stringify(cells(tabs.CC_Daily));
  const closingBefore = JSON.stringify(cells(tabs.CC_Closing));
  const ledgerBefore = JSON.stringify(cells(tabs.CC_Ledger));
  const audit = plain(gs.runConsistencyAudit_('october contract'));
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), dailyBefore, 'the audit does not rewrite CC_Daily');
  assert.equal(JSON.stringify(cells(tabs.CC_Closing)), closingBefore, 'the audit does not rewrite CC_Closing');
  assert.equal(JSON.stringify(cells(tabs.CC_Ledger)), ledgerBefore, 'the audit does not rewrite CC_Ledger');

  const metric = (id: string) => audit.metrics.find((row: { id: string }) => row.id === id);
  assert.equal(metric('store_written_day').value, 10495);
  assert.equal(metric('store_written_day').verifiedThrough, '2026-10-16');
  assert.equal(metric('store_written').value, 120488);
  assert.equal(metric('store_written').verifiedThrough, '2026-10-16');
  assert.equal(metric('store_snap_day').value, 7432);
  assert.equal(metric('nwdsr_minus_snap').value, 3063);
  assert.equal(metric('store_closing').customers, 54);
  assert.equal(metric('store_closing').opportunities, 111);
  assert.equal(metric('store_closing').value, 0.486);
  assert.equal(metric('store_closing').verifiedThrough, '2026-10-15');
  assert.equal(metric('store_closing').completeness === 'Pending', false);

  const home = plain(gs.home_({ session }));
  assert.equal(home.yesterday.closingRatio, null, 'October 16 closing stays pending without that day\'s PERQ');
  assert.equal(home.month.written, 120488);
  assert.equal(audit.status, 'PASS', JSON.stringify(audit.findings.filter((row: { status: string }) => row.status === 'FAIL')));
  assert.ok(audit.checked > 10);
  assert.equal(audit.discrepancies, 0);
  assert.ok(audit.findings.some((row: { page: string; status: string }) => row.page === 'Sales Team' && row.status === 'NOTE'));

  const again = plain(gs.runConsistencyAudit_('reimport'));
  assert.equal(again.status, 'PASS');
  assert.equal(plain(gs.home_({ session })).month.written, 120488);
  const daily = cells(tabs.CC_Daily);
  assert.ok(daily.some((row) => String(row[0]).slice(0, 10) === '2026-10-16' && Number(row[2]) === 10495));
});
