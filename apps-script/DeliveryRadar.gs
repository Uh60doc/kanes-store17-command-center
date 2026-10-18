/**
 * Delivery Rescue Radar. A manager tool for outstanding orders that need a follow-up before a delivery is missed.
 * It reads only a file a manager maps and confirms. It does not invent orders, dates or dollars, and it does not
 * change a customer order or a delivery schedule. Written dollars are never counted as Delivered dollars.
 */

var RESCUE_ORDERS_ = 'CC_RescueOrders';
var RESCUE_FLAGS_ = 'CC_RescueFlags';
var RESCUE_FIELDS_ = [
  { key: 'orderNumber', label: 'Order number', required: true },
  { key: 'writtenDollars', label: 'Outstanding written dollars', required: false },
  { key: 'scheduledDate', label: 'Scheduled delivery date', required: false },
  { key: 'scheduledDollars', label: 'Scheduled delivery dollars', required: false },
  { key: 'status', label: 'Status', required: false },
  { key: 'issue', label: 'Unresolved issue', required: false },
  { key: 'team', label: 'Responsible team', required: false },
  { key: 'owner', label: 'Action owner', required: false },
  { key: 'writtenDate', label: 'Written date', required: false },
  { key: 'estimate', label: 'Estimate marker', required: false },
];
var RESCUE_ORDER_HEADERS_ = ['batch', 'imported_at', 'imported_by', 'source', 'order_number', 'written_dollars', 'scheduled_date', 'scheduled_dollars', 'status', 'issue', 'team', 'owner', 'written_date', 'estimate', 'date_note'];
var RESCUE_FLAG_HEADERS_ = ['order_number', 'follow_up', 'note', 'next_owner', 'updated_at', 'updated_by'];

function rescueSheet_(name, headers) {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) {
    tab = spreadsheet.insertSheet(name);
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function rescueText_(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function rescueMoney_(value) {
  if (value === null || value === undefined || rescueText_(value) === '') return { amount: null, ok: true };
  if (typeof value === 'number' && isFinite(value)) return { amount: Math.round(value * 100) / 100, ok: true };
  var text = rescueText_(value).replace(/[$,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { amount: null, ok: false };
  return { amount: Math.round(Number(text) * 100) / 100, ok: true };
}

/** A date is accepted only as ISO, US month/day/year, or an Excel serial in a mapped date column. */
function rescueDate_(value) {
  if (value === null || value === undefined || rescueText_(value) === '') return { date: '', ok: true };
  if (typeof value === 'number' && isFinite(value) && value > 20000 && value < 80000) {
    var parsed = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return { date: parsed.toISOString().slice(0, 10), ok: true };
  }
  var text = rescueText_(value);
  var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return { date: iso[1] + '-' + iso[2] + '-' + iso[3], ok: true };
  var us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return { date: us[3] + '-' + pad2_(Number(us[1])) + '-' + pad2_(Number(us[2])), ok: true };
  return { date: '', ok: false };
}

function rescueTeam_(value) {
  var text = rescueText_(value).toLowerCase();
  if (!text) return '';
  if (/customer|\bcs\b|service/.test(text)) return 'customer_service';
  if (/operat|warehouse|delivery/.test(text)) return 'operations';
  if (/sale/.test(text)) return 'sales';
  return '';
}

function rescueEstimate_(value) {
  return /^(y|yes|true|1|estimate|estimated)$/i.test(rescueText_(value));
}

function rescueIsDelivered_(status) {
  return /^(delivered|complete|completed)$/i.test(rescueText_(status));
}

function rescueCsvRows_(text) {
  var rows = [];
  var row = [];
  var cell = '';
  var quote = false;
  var source = String(text || '').replace(/^\uFEFF/, '');
  var i;
  var push = function () {
    row.push(cell);
    cell = '';
    if (row.some(function (value) { return rescueText_(value) !== ''; })) rows.push(row);
    row = [];
  };
  for (i = 0; i < source.length; i += 1) {
    var ch = source.charAt(i);
    if (quote) {
      if (ch === '"' && source.charAt(i + 1) === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quote = false;
      else cell += ch;
    } else if (ch === '"') quote = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source.charAt(i + 1) === '\n') i += 1;
      push();
    } else cell += ch;
  }
  if (cell !== '' || row.length) push();
  return rows;
}

function rescueTable_(base64, fileName) {
  var bytes = Utilities.base64Decode(String(base64 || ''));
  var name = rescueText_(fileName).toLowerCase();
  if (/\.xlsx$/.test(name)) {
    var files = {};
    Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', fileName)).forEach(function (blob) {
      files[blob.getName()] = blob.getDataAsString();
    });
    var sheets = xlsxCells_(files).filter(function (sheet) { return !sheet.hidden && sheet.cells.length; });
    if (!sheets.length) throw new Error('The workbook has no readable sheet.');
    var width = 0;
    sheets[0].cells.forEach(function (cell) { if (cell.col > width) width = cell.col; });
    var byRow = {};
    sheets[0].cells.forEach(function (cell) {
      if (!byRow[cell.row]) byRow[cell.row] = [];
      byRow[cell.row][cell.col - 1] = cell.value;
    });
    return Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).map(function (row) {
      var line = [];
      var col;
      for (col = 0; col < width; col += 1) line.push(byRow[row][col] === undefined ? '' : byRow[row][col]);
      return line;
    });
  }
  return rescueCsvRows_(Utilities.newBlob(bytes, 'text/csv', fileName || 'orders.csv').getDataAsString());
}

function rescueSuggest_(headers) {
  var hints = [
    ['orderNumber', /order\s*(#|no|num|number)|invoice|ticket\s*#/i],
    ['writtenDollars', /written|outstanding|balance/i],
    ['scheduledDate', /schedul|delivery\s*date/i],
    ['scheduledDollars', /scheduled\s*(dollar|amount|\$)|delivery\s*(dollar|amount|\$)/i],
    ['status', /^status$|order\s*status/i],
    ['issue', /issue|problem|hold/i],
    ['team', /team|department/i],
    ['owner', /owner|assigned/i],
    ['writtenDate', /written\s*date|order\s*date|sale\s*date/i],
    ['estimate', /estimate/i],
  ];
  var used = {};
  var mapping = {};
  hints.forEach(function (hint) {
    var index = headers.findIndex(function (header, at) { return !used[at] && hint[1].test(rescueText_(header)); });
    if (index >= 0) { mapping[hint[0]] = index; used[index] = true; }
  });
  return mapping;
}

function previewRescue_(payload) {
  var table = rescueTable_(payload.base64, payload.fileName);
  if (table.length < 2) throw new Error('The file needs a header row and at least one order row. Nothing was saved.');
  var headers = table[0].map(rescueText_);
  if (headers.filter(Boolean).length < 1) throw new Error('The first row has no column names. Nothing was saved.');
  return {
    fileName: rescueText_(payload.fileName),
    headers: headers,
    rowCount: table.length - 1,
    sample: table.slice(1, 4).map(function (row) { return headers.map(function (_header, index) { return row[index] === undefined ? '' : row[index]; }); }),
    suggested: rescueSuggest_(headers),
    fields: RESCUE_FIELDS_,
    notice: 'This is a preview. Nothing is saved until you confirm the column mapping. Blank dates stay blank.',
  };
}

function rescueCell_(row, mapping, key) {
  var index = mapping[key];
  if (index === undefined || index === null || index === '' || Number(index) < 0) return '';
  return row[Number(index)] === undefined ? '' : row[Number(index)];
}

function confirmRescueImport_(payload) {
  var mapping = payload.mapping || {};
  if (mapping.orderNumber === undefined || mapping.orderNumber === null || mapping.orderNumber === '' || Number(mapping.orderNumber) < 0) {
    throw new Error('Map the order-number column before confirming. Nothing was saved.');
  }
  var table = rescueTable_(payload.base64, payload.fileName);
  var batch = Utilities.getUuid();
  var importedAt = new Date().toISOString();
  var who = payload.session && payload.session.username ? payload.session.username : '';
  var source = rescueText_(payload.fileName);
  var lines = [];
  var skipped = 0;
  var unreadableDates = 0;
  table.slice(1).forEach(function (row) {
    var orderNumber = rescueText_(rescueCell_(row, mapping, 'orderNumber'));
    if (!orderNumber) { skipped += 1; return; }
    var written = rescueMoney_(rescueCell_(row, mapping, 'writtenDollars'));
    var scheduledMoney = rescueMoney_(rescueCell_(row, mapping, 'scheduledDollars'));
    var scheduled = rescueDate_(rescueCell_(row, mapping, 'scheduledDate'));
    var writtenDate = rescueDate_(rescueCell_(row, mapping, 'writtenDate'));
    if (!scheduled.ok || !writtenDate.ok) unreadableDates += 1;
    var teamRaw = rescueText_(rescueCell_(row, mapping, 'team'));
    var team = rescueTeam_(teamRaw);
    lines.push([
      batch, importedAt, who, source, orderNumber,
      written.ok ? (written.amount === null ? '' : written.amount) : '',
      scheduled.ok ? scheduled.date : '',
      scheduledMoney.ok ? (scheduledMoney.amount === null ? '' : scheduledMoney.amount) : '',
      rescueText_(rescueCell_(row, mapping, 'status')),
      rescueText_(rescueCell_(row, mapping, 'issue')),
      team, rescueText_(rescueCell_(row, mapping, 'owner')),
      writtenDate.ok ? writtenDate.date : '',
      rescueEstimate_(rescueCell_(row, mapping, 'estimate')) ? 'yes' : '',
      (!scheduled.ok ? 'Scheduled date was not a readable date. ' : '') + (!writtenDate.ok ? 'Written date was not a readable date. ' : '') + (teamRaw && !team ? 'Responsible team was not Sales, Operations or Customer Service. ' : ''),
    ]);
  });
  if (!lines.length) throw new Error('No order numbers were found in the mapped column. Nothing was saved.');
  var tab = rescueSheet_(RESCUE_ORDERS_, RESCUE_ORDER_HEADERS_);
  tab.getRange(tab.getLastRow() + 1, 1, lines.length, RESCUE_ORDER_HEADERS_.length).setValues(lines);
  return {
    saved: lines.length,
    skipped: skipped,
    unreadableDates: unreadableDates,
    batch: batch,
    notice: 'Saved ' + lines.length + ' order' + (lines.length === 1 ? '' : 's') + ' from ' + (source || 'the file') + '. This does not change the order in Kane\'s system.',
    page: delivery_(payload),
  };
}

function rescueNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var amount = Number(value);
  return isFinite(amount) ? amount : null;
}

function rescueOrders_() {
  var rows = sheet_(RESCUE_ORDERS_);
  if (!rows.length) return [];
  var latest = rows.reduce(function (best, row) { return rescueText_(row.imported_at) > best ? rescueText_(row.imported_at) : best; }, '');
  var flags = {};
  sheet_(RESCUE_FLAGS_).forEach(function (row) { flags[rescueText_(row.order_number)] = row; });
  return rows.filter(function (row) { return rescueText_(row.imported_at) === latest; }).map(function (row) {
    var flag = flags[rescueText_(row.order_number)] || {};
    return {
      orderNumber: rescueText_(row.order_number),
      writtenDollars: rescueNumber_(row.written_dollars),
      scheduledDate: rescueText_(row.scheduled_date),
      scheduledDollars: rescueNumber_(row.scheduled_dollars),
      status: rescueText_(row.status),
      issue: rescueText_(row.issue),
      team: rescueText_(row.team),
      owner: rescueText_(row.owner),
      writtenDate: rescueText_(row.written_date),
      estimate: rescueText_(row.estimate) === 'yes',
      dateNote: rescueText_(row.date_note),
      source: rescueText_(row.source),
      importedAt: rescueText_(row.imported_at),
      followUp: rescueText_(flag.follow_up) === 'yes',
      followNote: rescueText_(flag.note),
      nextOwner: rescueText_(flag.next_owner),
    };
  });
}

function rescueAge_(writtenDate, today) {
  if (!writtenDate) return null;
  return Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(writtenDate + 'T00:00:00Z')) / 86400000);
}

function rescueOpen_(order) {
  return !order.estimate && !rescueIsDelivered_(order.status);
}

function rescueBucket_(orders, include) {
  var known = 0;
  var missing = 0;
  var count = 0;
  orders.forEach(function (order) {
    if (!include(order)) return;
    count += 1;
    var amount = include.amount(order);
    if (amount === null || amount === undefined) missing += 1;
    else known += amount;
  });
  if (!count) return { status: 'none', dollars: 0, count: 0, missing: 0 };
  if (missing) return { status: 'partial', dollars: Math.round(known * 100) / 100, count: count, missing: missing };
  return { status: 'ready', dollars: Math.round(known * 100) / 100, count: count, missing: 0 };
}

function rescueInStoreMonth_(date, period) {
  return !!(date && date >= period.start && date <= period.end);
}

function rescueMetrics_(orders, today) {
  if (!orders.length) {
    return {
      status: 'pending',
      notice: 'No open-order or delivery-schedule report is on file. Outstanding orders, scheduled dates and dollars stay Pending. Nothing is shown as zero.',
      outstandingWritten: null,
      scheduledFuture: null,
      scheduledThisMonth: null,
      ordersWithoutDate: null,
      pastDue: null,
      unresolvedIssues: null,
      atRisk: null,
      expectedRemaining: null,
      estimates: null,
    };
  }
  var period = storePeriodContaining_(today);
  var open = orders.filter(rescueOpen_);
  var outstanding = rescueBucket_(open, Object.assign(function (order) { return true; }, { amount: function (order) { return order.writtenDollars; } }));
  var future = rescueBucket_(open, Object.assign(function (order) { return order.scheduledDate > today; }, { amount: function (order) { return order.scheduledDollars; } }));
  var month = rescueBucket_(open, Object.assign(function (order) { return rescueInStoreMonth_(order.scheduledDate, period); }, { amount: function (order) { return order.scheduledDollars; } }));
  var remaining = rescueBucket_(open, Object.assign(function (order) { return order.scheduledDate >= today && rescueInStoreMonth_(order.scheduledDate, period); }, { amount: function (order) { return order.scheduledDollars; } }));
  var noDate = open.filter(function (order) { return !order.scheduledDate; });
  var past = open.filter(function (order) { return order.scheduledDate && order.scheduledDate < today; });
  var issues = open.filter(function (order) { return order.issue; });
  var risk = open.filter(function (order) { return !order.scheduledDate || (order.scheduledDate && order.scheduledDate < today) || order.issue; });
  var estimates = orders.filter(function (order) { return order.estimate; });
  return {
    status: 'ready',
    notice: 'Figures below come from the confirmed open-order file. Scheduled dollars are not Delivered dollars. Written dollars are not copied into a scheduled amount.',
    period: period,
    outstandingWritten: outstanding,
    scheduledFuture: future,
    scheduledThisMonth: month,
    ordersWithoutDate: { count: noDate.length },
    pastDue: rescueBucket_(past, Object.assign(function () { return true; }, { amount: function (order) { return order.scheduledDollars; } })),
    unresolvedIssues: { count: issues.length },
    atRisk: { count: risk.length },
    expectedRemaining: remaining,
    estimates: { count: estimates.length },
    deliveredOnFile: orders.filter(function (order) { return rescueIsDelivered_(order.status); }).length,
  };
}

function rescueOwner_(order) {
  if (order.nextOwner) return { team: order.nextOwner, name: order.owner, source: 'Manager follow-up' };
  if (order.team) return { team: order.team, name: order.owner, source: 'Responsible team on the file' };
  if (/customer|service|complaint/i.test(order.issue)) return { team: 'customer_service', name: order.owner, source: 'Suggested from the issue text' };
  if (order.scheduledDate && order.scheduledDate < order.today) return { team: 'operations', name: order.owner, source: 'Suggested because the scheduled date is past' };
  if (!order.scheduledDate) return { team: 'sales', name: order.owner, source: 'Suggested because no delivery date is on the file' };
  if (order.owner) return { team: 'operations', name: order.owner, source: 'Owner on the file' };
  return { team: 'operations', source: 'Suggested for a scheduled delivery' };
}

function rescueAction_(order, owner) {
  if (order.followUp) return 'Manager flagged this order for follow-up. The order and its delivery date were not changed.';
  if (!order.scheduledDate) return 'Sales: ask for a delivery date. No date was added here.';
  if (order.scheduledDate < order.today) return 'Operations: the scheduled date is past. The date was not moved.';
  if (order.issue) return (owner.team === 'customer_service' ? 'Customer Service' : 'The responsible team') + ': the file lists an unresolved issue. The order was not changed.';
  return 'Scheduled. No Command Center action changes the delivery.';
}

function rescueDecorate_(order, today) {
  var copy = {};
  Object.keys(order).forEach(function (key) { copy[key] = order[key]; });
  copy.today = today;
  copy.age = rescueAge_(order.writtenDate, today);
  copy.kind = order.estimate ? 'estimate' : (rescueIsDelivered_(order.status) ? 'delivered' : (order.scheduledDate ? 'scheduled' : 'open'));
  var owner = rescueOwner_(copy);
  copy.actionTeam = owner.team;
  copy.actionName = owner.name || order.owner || '';
  copy.actionSource = owner.source;
  copy.action = rescueAction_(copy, owner);
  return copy;
}

function rescueOnList_(order, period) {
  if (order.followUp) return true;
  if (order.kind === 'delivered' || order.kind === 'estimate') return false;
  if (order.issue || !order.scheduledDate || order.scheduledDate < order.today) return true;
  return rescueInStoreMonth_(order.scheduledDate, period);
}

function rescuePriority_(orders, today) {
  var period = storePeriodContaining_(today || (orders[0] && orders[0].today) || '2026-10-17');
  var rank = function (order) {
    if (order.followUp) return 0;
    if (order.scheduledDate && order.scheduledDate < order.today) return 1;
    if (order.issue) return 2;
    if (!order.scheduledDate) return 3;
    return 4;
  };
  return orders.filter(function (order) { return rescueOnList_(order, period); }).sort(function (a, b) {
    var diff = rank(a) - rank(b);
    if (diff) return diff;
    return (a.scheduledDate || '9999-99-99').localeCompare(b.scheduledDate || '9999-99-99');
  });
}

function rescueFilter_(orders, filters) {
  var from = rescueText_(filters.dateFrom);
  var to = rescueText_(filters.dateTo);
  var status = rescueText_(filters.status).toLowerCase();
  var team = rescueText_(filters.team);
  var minAge = rescueText_(filters.minAge);
  var maxAge = rescueText_(filters.maxAge);
  return orders.filter(function (order) {
    if (from && (!order.scheduledDate || order.scheduledDate < from)) return false;
    if (to && (!order.scheduledDate || order.scheduledDate > to)) return false;
    if (status && rescueText_(order.status).toLowerCase() !== status) return false;
    if (team && order.actionTeam !== team && order.team !== team) return false;
    if (minAge !== '' && (order.age === null || order.age < Number(minAge))) return false;
    if (maxAge !== '' && (order.age === null || order.age > Number(maxAge))) return false;
    return true;
  });
}

function delivery_(payload) {
  var home = home_(payload);
  var today = todayNy_();
  var orders = rescueOrders_().map(function (order) { return rescueDecorate_(order, today); });
  var filters = payload.filters || {};
  var visible = rescueFilter_(orders, filters);
  var metrics = rescueMetrics_(orders, today);
  return {
    title: 'Delivery Rescue Radar',
    today: today,
    notice: 'Management follow-up only. This is not Kane\'s order system. Flagging an order does not change the order or the delivery schedule. Written dollars are not Delivered dollars.',
    actualDelivered: {
      kind: 'actual',
      dollars: home.month.delivered,
      through: home.freshness.delivered.through,
      goal: home.month.deliveredGoal,
      source: 'NWDSR Delivered',
      note: 'Actual Delivered sales already on file. Outstanding and scheduled amounts are separate and are not included here.',
    },
    source: orders.length ? { file: orders[0].source, importedAt: orders[0].importedAt, orders: orders.length } : null,
    metrics: metrics,
    statuses: orders.reduce(function (list, order) {
      if (order.status && list.indexOf(order.status) === -1) list.push(order.status);
      return list;
    }, []),
    priority: rescuePriority_(orders, today).slice(0, 25),
    orders: visible,
    fields: RESCUE_FIELDS_,
    filters: filters,
  };
}

function saveRescueFlag_(payload) {
  var orderNumber = rescueText_(payload.orderNumber);
  var known = rescueOrders_().some(function (order) { return order.orderNumber === orderNumber; });
  if (!known) throw new Error('That order is not on the confirmed open-order file. Nothing was changed.');
  var team = rescueTeam_(payload.nextOwner) || (rescueText_(payload.nextOwner) === '' ? '' : '');
  if (rescueText_(payload.nextOwner) && !team) throw new Error('Next action is Sales, Operations or Customer Service.');
  var tab = rescueSheet_(RESCUE_FLAGS_, RESCUE_FLAG_HEADERS_);
  var rows = sheet_(RESCUE_FLAGS_);
  var line = [orderNumber, payload.followUp ? 'yes' : '', rescueText_(payload.note).slice(0, 240), team, new Date().toISOString(), payload.session && payload.session.username ? payload.session.username : ''];
  var index = rows.findIndex(function (row) { return rescueText_(row.order_number) === orderNumber; });
  if (index === -1) tab.getRange(tab.getLastRow() + 1, 1, 1, line.length).setValues([line]);
  else tab.getRange(index + 2, 1, 1, line.length).setValues([line]);
  return { saved: true, orderNumber: orderNumber, notice: 'Follow-up saved in the Command Center only. The customer order and delivery schedule were not changed.', page: delivery_(payload) };
}
