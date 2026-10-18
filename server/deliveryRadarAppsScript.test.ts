import assert from 'node:assert/strict';
import test from 'node:test';
import { plain } from './fakeSpreadsheet.ts';
import { cells, harness, session } from './octoberVerified.ts';

const csv = [
  'Order Number,Written Dollars,Scheduled Delivery Date,Scheduled Delivery Dollars,Status,Issue,Team,Owner,Written Date,Estimate',
  '1001,5000,10/20/2026,5000,Open,,Sales,Alex,10/01/2026,',
  '1002,2000,,,Open,Customer complaint,,Sam,09/01/2026,',
  '1003,800,10/01/2026,800,Open,,Operations,Pat,09/15/2026,',
  '1004,100,11/15/2026,100,Open,,Sales,Alex,10/10/2026,yes',
  '1005,3000,10/30/2026,,Scheduled,,Customer Service,Riley,10/05/2026,',
  '1006,50,next week,50,Delivered,,,Alex,10/02/2026,',
].join('\n');

const mapping = {
  orderNumber: 0, writtenDollars: 1, scheduledDate: 2, scheduledDollars: 3, status: 4,
  issue: 5, team: 6, owner: 7, writtenDate: 8, estimate: 9,
};

test('the radar stays pending until a mapped file is confirmed and does not change delivered sales', () => {
  const { gs, tabs } = harness();
  const before = plain(gs.home_({ session }));
  const page = plain(gs.delivery_({ session, filters: {} }));
  assert.deepEqual(plain(gs.ROUTES_).delivery, ['manager', 'admin']);
  assert.equal(plain(gs.ROUTES_).delivery.includes('sales'), false);
  assert.equal(page.metrics.status, 'pending');
  assert.equal(page.metrics.outstandingWritten, null);
  assert.equal(page.metrics.expectedRemaining, null);
  assert.equal(page.orders.length, 0);
  assert.equal(page.priority.length, 0);
  assert.equal(page.actualDelivered.dollars, before.month.delivered);
  assert.match(page.actualDelivered.note, /not included/);
  assert.equal(plain(gs.home_({ session })).month.delivered, before.month.delivered);
  assert.equal(plain(gs.home_({ session })).month.written, before.month.written);
  assert.equal(tabs.CC_RescueOrders, undefined);
});

test('a confirmed open-order file separates written, scheduled, delivered and estimates', () => {
  const { gs } = harness();
  const before = plain(gs.home_({ session }));
  const payload = { session, base64: Buffer.from(csv).toString('base64'), fileName: 'open-orders.csv', mapping, filters: {} };
  const preview = plain(gs.previewRescue_(payload));
  assert.equal(gs.sheet_('CC_RescueOrders').length, 0);
  assert.equal(preview.rowCount, 6);
  assert.equal(preview.suggested.orderNumber, 0);
  assert.equal(preview.suggested.scheduledDate, 2);
  const saved = plain(gs.confirmRescueImport_(payload));
  assert.equal(saved.saved, 6);
  assert.equal(saved.unreadableDates, 1);
  const page = saved.page;
  assert.equal(page.metrics.outstandingWritten.dollars, 10800);
  assert.equal(page.metrics.outstandingWritten.status, 'ready');
  assert.equal(page.metrics.scheduledFuture.dollars, 5000);
  assert.equal(page.metrics.scheduledFuture.status, 'partial');
  assert.equal(page.metrics.scheduledFuture.missing, 1);
  assert.equal(page.metrics.scheduledThisMonth.dollars, 5000);
  assert.equal(page.metrics.ordersWithoutDate.count, 1);
  assert.equal(page.metrics.pastDue.count, 1);
  assert.equal(page.metrics.pastDue.dollars, 800);
  assert.equal(page.metrics.unresolvedIssues.count, 1);
  assert.equal(page.metrics.atRisk.count, 2);
  assert.equal(page.metrics.expectedRemaining.dollars, 5000);
  assert.equal(page.metrics.expectedRemaining.status, 'partial');
  assert.equal(page.metrics.estimates.count, 1);
  assert.equal(page.actualDelivered.dollars, before.month.delivered);
  assert.notEqual(page.metrics.outstandingWritten.dollars, page.actualDelivered.dollars);
  const unreadable = page.orders.find((order: { orderNumber: string }) => order.orderNumber === '1006');
  assert.equal(unreadable.scheduledDate, '');
  assert.equal(unreadable.kind, 'delivered');
  const estimate = page.orders.find((order: { orderNumber: string }) => order.orderNumber === '1004');
  assert.equal(estimate.kind, 'estimate');
  const priority = page.priority.map((order: { orderNumber: string }) => order.orderNumber);
  assert.equal(priority[0], '1003');
  assert.ok(priority.includes('1002'));
  assert.ok(!priority.includes('1004'));
  assert.ok(!priority.includes('1006'));
  const noDate = page.orders.find((order: { orderNumber: string }) => order.orderNumber === '1002');
  assert.equal(noDate.actionTeam, 'customer_service');
  const past = page.orders.find((order: { orderNumber: string }) => order.orderNumber === '1003');
  assert.equal(past.actionTeam, 'operations');
  assert.equal(plain(gs.home_({ session })).month.delivered, before.month.delivered);
  assert.equal(plain(gs.home_({ session })).month.written, before.month.written);
});

test('a follow-up flag does not change the order date or the delivered total', () => {
  const { gs, tabs } = harness();
  const beforeTabs = JSON.stringify(cells(tabs.CC_Daily));
  const payload = { session, base64: Buffer.from(csv).toString('base64'), fileName: 'open-orders.csv', mapping, filters: {} };
  gs.confirmRescueImport_(payload);
  const flagged = plain(gs.saveRescueFlag_({ session, orderNumber: '1001', followUp: true, note: 'Call the customer', nextOwner: 'sales', filters: {} }));
  const order = flagged.page.orders.find((row: { orderNumber: string }) => row.orderNumber === '1001');
  assert.equal(order.scheduledDate, '2026-10-20');
  assert.equal(order.scheduledDollars, 5000);
  assert.equal(order.followUp, true);
  assert.equal(order.actionTeam, 'sales');
  assert.equal(order.actionSource, 'Manager follow-up');
  assert.equal(flagged.page.priority[0].orderNumber, '1001');
  assert.match(flagged.notice, /not changed/);
  const stored = gs.sheet_('CC_RescueOrders').find((row: { order_number: string }) => row.order_number === '1001');
  assert.equal(stored.scheduled_date, '2026-10-20');
  assert.equal(JSON.stringify(cells(tabs.CC_Daily)), beforeTabs);
  assert.throws(() => gs.saveRescueFlag_({ session, orderNumber: '9999', followUp: true, nextOwner: 'sales' }), /not on the confirmed/);
});

test('a scheduled-date filter hides orders that have no date', () => {
  const { gs } = harness();
  const payload = { session, base64: Buffer.from(csv).toString('base64'), fileName: 'open-orders.csv', mapping };
  gs.confirmRescueImport_(payload);
  const filtered = plain(gs.delivery_({ session, filters: { dateFrom: '2026-10-20', dateTo: '2026-10-20', team: 'sales' } }));
  assert.deepEqual(filtered.orders.map((order: { orderNumber: string }) => order.orderNumber), ['1001']);
});
