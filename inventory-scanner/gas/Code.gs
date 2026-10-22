/**
 * Store 17 Annual Inventory — Apps Script backend.
 * Bind to spreadsheet STORE 17 INVENTORY (or a TEST COPY).
 * Protect writes with SYNC_TOKEN (Script Property). Do not commit secrets to git.
 */

var EXISTING_SPREADSHEET_ID = '1j0laH6BDbp35i3DWqs2of_aLJ9XSrDFiy_yEB3rZBxU';

var TABS = {
  PRODUCT_MASTER: 'PRODUCT_MASTER',
  INVENTORY_COUNTS: 'INVENTORY_COUNTS',
  UNIT_EVENTS: 'UNIT_EVENTS',
  EXPECTED_INVENTORY: 'EXPECTED_INVENTORY',
  ZONES_AREAS: 'ZONES_AREAS',
  IMPORT_BATCHES: 'IMPORT_BATCHES',
  AUDIT_LOG: 'AUDIT_LOG'
};

var UNIT_HEADERS = [
  'event_id', 'sku', 'zone', 'area', 'condition', 'status', 'source',
  'import_batch_id', 'description', 'group_name', 'created_at', 'voided_at',
  'void_reason', 'client_id', 'synced_at'
];

function getSpreadsheet_() {
  if (EXISTING_SPREADSHEET_ID) {
    return SpreadsheetApp.openById(EXISTING_SPREADSHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  if (headers && headers.length) {
    var last = sheet.getLastColumn();
    if (sheet.getLastRow() === 0 || last === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setNumberFormat('@');
    }
  }
  return sheet;
}

/** Non-destructive setup: create missing tabs; never wipe PRODUCT_MASTER / INVENTORY_COUNTS data. */
function setupStore() {
  var ss = getSpreadsheet_();
  ensureSheet_(ss, TABS.PRODUCT_MASTER, [
    'SKU', 'Group', 'Description', 'Product ID (*Dropped)', 'Vendor', 'Vendor SKU',
    'Finish', 'Dimensions', 'Site', 'Store', 'Locked', 'Reserved', 'Transfers', 'Total'
  ]);
  ensureSheet_(ss, TABS.INVENTORY_COUNTS, [
    'zone', 'area', 'sku', 'condition', 'quantity', 'updated_at', 'source'
  ]);
  ensureSheet_(ss, TABS.UNIT_EVENTS, UNIT_HEADERS);
  ensureSheet_(ss, TABS.EXPECTED_INVENTORY, [
    'sku', 'description', 'expected_qty', 'snapshot_date', 'source'
  ]);
  ensureSheet_(ss, TABS.ZONES_AREAS, [
    'zone', 'area', 'status', 'revision', 'assigned_to', 'updated_at'
  ]);
  ensureSheet_(ss, TABS.IMPORT_BATCHES, [
    'batch_id', 'type', 'checksum', 'added', 'created_at', 'replaced'
  ]);
  ensureSheet_(ss, TABS.AUDIT_LOG, [
    'id', 'at', 'action', 'detail', 'actor'
  ]);
  Logger.log('Setup complete: ' + ss.getUrl());
  return ss.getUrl();
}

function getSyncToken_() {
  return PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN') || '';
}

/** Run once in the editor after setting a strong token in Script Properties. */
function setSyncToken(token) {
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', String(token || ''));
}

function doGet(e) {
  return HtmlService.createHtmlOutput(
    '<p>Store 17 Inventory sync endpoint. POST JSON with action + token.</p>'
  );
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var token = getSyncToken_();
    if (!token || body.token !== token) {
      return jsonOut_({ ok: false, error: 'unauthorized' });
    }
    if (body.action === 'upsertEvents') {
      return jsonOut_(upsertEvents_(body.events || [], body.clientId || ''));
    }
    if (body.action === 'ping') {
      return jsonOut_({ ok: true, spreadsheetId: getSpreadsheet_().getId() });
    }
    return jsonOut_({ ok: false, error: 'unknown_action' });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function upsertEvents_(events, clientId) {
  var ss = getSpreadsheet_();
  var sheet = ensureSheet_(ss, TABS.UNIT_EVENTS, UNIT_HEADERS);
  var data = sheet.getDataRange().getValues();
  var idCol = 0;
  var existing = {};
  for (var r = 1; r < data.length; r++) {
    var id = String(data[r][idCol] || '');
    if (id) existing[id] = r + 1; // 1-based sheet row
  }
  var acked = [];
  var now = new Date().toISOString();
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (!ev || !ev.eventId) continue;
    var row = [
      String(ev.eventId),
      String(ev.sku || ''),
      String(ev.zoneId || ''),
      String(ev.areaId || ''),
      String(ev.condition || 'new'),
      String(ev.status || 'active'),
      String(ev.source || ''),
      String(ev.importBatchId || ''),
      String(ev.description || ''),
      String(ev.groupName || ''),
      String(ev.createdAt || now),
      String(ev.voidedAt || ''),
      String(ev.voidReason || ''),
      String(ev.clientId || clientId || ''),
      now
    ];
    if (existing[ev.eventId]) {
      sheet.getRange(existing[ev.eventId], 1, existing[ev.eventId], UNIT_HEADERS.length).setValues([row]);
    } else {
      sheet.appendRow(row);
      existing[ev.eventId] = sheet.getLastRow();
    }
    acked.push(String(ev.eventId));
  }
  rebuildInventoryCounts_(ss);
  return { ok: true, ackedEventIds: acked };
}

/** Aggregate active UNIT_EVENTS into INVENTORY_COUNTS (does not invent expected). */
function rebuildInventoryCounts_(ss) {
  var eventsSheet = ss.getSheetByName(TABS.UNIT_EVENTS);
  var countsSheet = ensureSheet_(ss, TABS.INVENTORY_COUNTS, [
    'zone', 'area', 'sku', 'condition', 'quantity', 'updated_at', 'source'
  ]);
  if (!eventsSheet) return;
  var data = eventsSheet.getDataRange().getValues();
  var agg = {};
  for (var r = 1; r < data.length; r++) {
    var status = String(data[r][5] || 'active');
    if (status === 'void') continue;
    var zone = String(data[r][2] || '');
    var area = String(data[r][3] || '');
    var sku = String(data[r][1] || '');
    var condition = String(data[r][4] || 'new');
    var key = zone + '|' + area + '|' + sku + '|' + condition;
    agg[key] = (agg[key] || 0) + 1;
  }
  countsSheet.clearContents();
  countsSheet.getRange(1, 1, 1, 7).setValues([[
    'zone', 'area', 'sku', 'condition', 'quantity', 'updated_at', 'source'
  ]]);
  var out = [];
  var now = new Date().toISOString();
  var keys = Object.keys(agg).sort();
  for (var i = 0; i < keys.length; i++) {
    var parts = keys[i].split('|');
    out.push([parts[0], parts[1], parts[2], parts[3], agg[keys[i]], now, 'unit_events']);
  }
  if (out.length) {
    countsSheet.getRange(2, 1, out.length + 1, 7).setValues(out);
    countsSheet.getRange(2, 3, out.length + 1, 3).setNumberFormat('@');
  }
}
