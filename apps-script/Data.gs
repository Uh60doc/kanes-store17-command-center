function sheet_(name) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) return [];
  var values = tab.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  var header = values[0].map(function (cell) { return String(cell || '').trim(); });
  var rows = [];
  values.slice(1).forEach(function (row) {
    if (String(row[0] || '') === '') return;
    var record = {};
    header.forEach(function (key, index) { record[key] = row[index]; });
    rows.push(record);
  });
  return rows;
}

function config_() {
  var map = {};
  sheet_('CC_Config').forEach(function (row) { map[String(row.key)] = row.value; });
  return map;
}

function isoDate_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'America/New_York', 'yyyy-MM-dd');
  }
  var text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function numberOrNull_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var number = Number(value);
  return isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function dailyFacts_() {
  return sheet_('CC_Daily').map(function (row) {
    return {
      date: isoDate_(row.date),
      snapWritten: numberOrNull_(row.snap_written),
      nwdsrWritten: numberOrNull_(row.nwdsr_written),
      nwdsrDelivered: numberOrNull_(row.nwdsr_delivered),
    };
  }).filter(function (row) { return row.date; });
}

function sumField_(rows, field, start, end) {
  var seen = false;
  var total = 0;
  rows.forEach(function (row) {
    if (row.date < start || row.date > end || row[field] === null) return;
    seen = true;
    total += row[field];
  });
  return seen ? Math.round(total * 100) / 100 : null;
}

function refreshRollup_() {
  var config = config_();
  var start = isoDate_(config.store_period_start) || '2026-10-02';
  var end = isoDate_(config.store_period_end) || '2026-11-01';
  var facts = dailyFacts_();
  var writtenGoal = numberOrNull_(config.written_goal);
  var deliveredGoal = numberOrNull_(config.delivered_goal);
  if (writtenGoal === null) writtenGoal = 400000;
  if (deliveredGoal === null) deliveredGoal = 320000;
  var nwdsrWritten = sumField_(facts, 'nwdsrWritten', start, end);
  var snapWritten = sumField_(facts, 'snapWritten', start, end);
  var nwdsrDelivered = sumField_(facts, 'nwdsrDelivered', start, end);
  var latest = '';
  facts.forEach(function (row) {
    if (row.date < start || row.date > end || row.nwdsrWritten === null) return;
    if (row.date > latest) latest = row.date;
  });
  var writtenRemaining = nwdsrWritten === null ? '' : Math.round((writtenGoal - nwdsrWritten) * 100) / 100;
  var deliveredRemaining = nwdsrDelivered === null ? '' : Math.round((deliveredGoal - nwdsrDelivered) * 100) / 100;
  var metrics = {
    nwdsr_written: [nwdsrWritten === null ? '' : nwdsrWritten, 'Primary written total. Sum of CC_Daily nwdsr_written for the store period. Blank cells are skipped.'],
    snap_written: [snapWritten === null ? '' : snapWritten, 'SNAP Written reconciliation only. Not used for written remaining.'],
    nwdsr_delivered: [nwdsrDelivered === null ? '' : nwdsrDelivered, 'Sum of CC_Daily nwdsr_delivered for the store period. Blank cells are skipped.'],
    written_remaining: [writtenRemaining, 'Written goal minus NWDSR written. The goal itself is not changed.'],
    delivered_remaining: [deliveredRemaining, 'Delivered goal minus NWDSR delivered. The goal itself is not changed.'],
    verified_through: [latest, 'Latest store-period date with NWDSR written on CC_Daily.'],
  };
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Rollup');
  if (!tab) {
    tab = spreadsheet.insertSheet('CC_Rollup');
    tab.getRange(1, 1, 1, 3).setValues([['metric', 'value', 'method']]);
  }
  var values = tab.getDataRange().getValues();
  if (!values.length || String(values[0][0] || '') !== 'metric') {
    tab.getRange(1, 1, 1, 3).setValues([['metric', 'value', 'method']]);
    values = tab.getDataRange().getValues();
  }
  var index = {};
  var r;
  for (r = 1; r < values.length; r += 1) index[String(values[r][0] || '')] = r + 1;
  Object.keys(metrics).forEach(function (metric) {
    var line = metrics[metric];
    if (index[metric]) {
      tab.getRange(index[metric], 2, 1, 2).setValues([[line[0], line[1]]]);
      return;
    }
    tab.appendRow([metric, line[0], line[1]]);
  });
  return {
    nwdsrWritten: nwdsrWritten,
    snapWritten: snapWritten,
    nwdsrDelivered: nwdsrDelivered,
    writtenRemaining: writtenRemaining,
    deliveredRemaining: deliveredRemaining,
    verifiedThrough: latest,
  };
}

function todayNy_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
}

function shiftDate_(iso, days) {
  var parts = iso.split('-');
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function moneyText_(value) {
  if (value === null || value === undefined || value === '') return 'Not Available';
  var number = Number(value);
  var sign = number < 0 ? '-' : '';
  return sign + '$' + Math.abs(Math.round(number)).toLocaleString('en-US');
}

function percentText_(value) {
  if (value === null || value === undefined || value === '') return 'Not Available';
  return (Number(value) * 100).toFixed(1) + '%';
}

function pad2_(value) {
  return (value < 10 ? '0' : '') + value;
}

function isoParts_(iso) {
  var parts = String(iso || '').split('-');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

function lastCalendarDay_(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Store month: the 2nd through the 1st of the next month. Salesperson month: the 1st through the last day. */
function periodFor_(category, year, month) {
  if (category === 'individual') {
    return {
      category: 'individual',
      year: year,
      month: month,
      start: year + '-' + pad2_(month) + '-01',
      end: year + '-' + pad2_(month) + '-' + pad2_(lastCalendarDay_(year, month)),
    };
  }
  var nextMonth = month === 12 ? 1 : month + 1;
  var nextYear = month === 12 ? year + 1 : year;
  return {
    category: 'store',
    year: year,
    month: month,
    start: year + '-' + pad2_(month) + '-02',
    end: nextYear + '-' + pad2_(nextMonth) + '-01',
  };
}

function storePeriodContaining_(iso) {
  var parts = isoParts_(iso);
  if (parts.day === 1) {
    var month = parts.month === 1 ? 12 : parts.month - 1;
    var year = parts.month === 1 ? parts.year - 1 : parts.year;
    return periodFor_('store', year, month);
  }
  return periodFor_('store', parts.year, parts.month);
}

function individualPeriodContaining_(iso) {
  var parts = isoParts_(iso);
  return periodFor_('individual', parts.year, parts.month);
}

function eachDate_(start, end) {
  var dates = [];
  var cursor = start;
  while (cursor && cursor <= end) {
    dates.push(cursor);
    cursor = shiftDate_(cursor, 1);
  }
  return dates;
}

/** A date is closed only when CC_SellingDays says NO, closed, false, or 0. Every other day is open. */
function closedDates_() {
  var closed = {};
  sheet_('CC_SellingDays').forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date) return;
    if (/^(n|no|closed|false|0)$/i.test(String(row.selling || '').trim())) closed[date] = true;
  });
  return closed;
}

function operatingDaysRemaining_(period, today, closed) {
  var count = 0;
  eachDate_(period.start, period.end).forEach(function (date) {
    if (date >= today && date <= period.end && !closed[date]) count += 1;
  });
  return count;
}

function goalForMonth_(config, period, key) {
  var specific = config[key + '_' + period.year + '-' + pad2_(period.month)];
  if (specific !== undefined && specific !== '') return numberOrNull_(specific);
  var configuredStart = isoDate_(config.store_period_start);
  var configuredEnd = isoDate_(config.store_period_end);
  if (configuredStart === period.start && configuredEnd === period.end) return numberOrNull_(config[key]);
  return null;
}

function pace_(goal, actual, daysLeft) {
  if (actual === null || goal === null || goal === '') return { remaining: null, pace: null };
  var remaining = Math.round((Number(goal) - actual) * 100) / 100;
  if (daysLeft === null || daysLeft <= 0) return { remaining: remaining, pace: null };
  return { remaining: remaining, pace: Math.round((remaining / daysLeft) * 100) / 100 };
}

function fineNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  var number = Number(value);
  return isFinite(number) ? Math.round(number * 10000) / 10000 : null;
}

function goalOr_(config, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(config, key) || config[key] === '' || config[key] === null || config[key] === undefined) return fallback;
  return fineNumber_(config[key]);
}

function protectorGoal_(config) {
  var value = goalOr_(config, 'mattress_protector_goal', 0.8);
  if (value === 1) return 0.8;
  return value;
}

function closingGoal_(config) {
  var value = numberOrNull_(config.closing_goal);
  return value === null ? 0.5 : value;
}

function approvedGoals_(config) {
  return {
    bedding: goalOr_(config, 'bedding_minimum', 0.2),
    mattress: protectorGoal_(config),
    fabric: goalOr_(config, 'fabric_maintenance_goal', 0.8),
    leather: goalOr_(config, 'leather_maintenance_goal', 0.8),
    power: goalOr_(config, 'power_maintenance_goal', 0.8),
    wood: goalOr_(config, 'wood_maintenance_goal', 0.5),
    maintenance: goalOr_(config, 'overall_maintenance_goal', null),
    rugs: goalOr_(config, 'rugs_goal', 12),
    averageTicket: goalOr_(config, 'average_ticket_goal', 2500),
    closing: closingGoal_(config),
    opportunities: goalOr_(config, 'opportunities_goal', null),
    adjustableBase: goalOr_(config, 'adjustable_base_goal', 0.35),
    pillow: goalOr_(config, 'pillow_goal', 0.65),
    powerBase: goalOr_(config, 'power_base_goal', 0.35),
    finance: goalOr_(config, 'finance_goal', 0.5),
    warranty: goalOr_(config, 'warranty_sales_goal', 0.055),
    individualVolume: goalOr_(config, 'individual_volume_goal', 65000),
  };
}

function ratio_(actual, goal) {
  if (actual === null || goal === null || Number(goal) === 0) return null;
  return Math.round((actual / Number(goal)) * 1000) / 1000;
}

function scoreboard_(config, snap, delivered, writtenGoal, deliveredGoal, writtenPace, deliveredPace, daysLeft, yesterdayRow, yesterday, missing) {
  return {
    daysLeft: daysLeft,
    provisional: missing.length > 0,
    missingDays: missing.length,
    written: {
      yesterday: yesterdayRow ? yesterdayRow.snapWritten : null,
      month: snap,
      goal: writtenGoal,
      achieved: ratio_(snap, writtenGoal),
      today: writtenPace.pace,
      remaining: writtenPace.remaining,
    },
    delivered: {
      yesterday: yesterdayRow ? yesterdayRow.nwdsrDelivered : null,
      month: delivered,
      goal: deliveredGoal,
      achieved: ratio_(delivered, deliveredGoal),
      today: deliveredPace.pace,
      remaining: deliveredPace.remaining,
    },
  };
}

function kpiRow_(name, written, delivered, goal, unit, note, reconcile) {
  return { name: name, written: written, delivered: delivered, goal: goal, unit: unit, note: note || '', reconcile: !!reconcile };
}

function storeKpis_(config, metrics, bedding, closing) {
  var goals = approvedGoals_(config);
  var beddingNote = metrics.bedding_percent ? String(metrics.bedding_percent.note || '') : '';
  closing = closing || { customers: null, opportunities: null, ratio: null, reconcile: false, note: '' };
  return [
    kpiRow_('Bedding', bedding, null, goals.bedding, 'percent', beddingNote),
    kpiRow_('Mattress Protectors', null, null, goals.mattress, 'percent', 'Eligible-opportunity attachment is not on file.'),
    kpiRow_('Fabric Maintenance', null, null, goals.fabric, 'percent', ''),
    kpiRow_('Leather Maintenance', null, null, goals.leather, 'percent', ''),
    kpiRow_('Power Maintenance', null, null, goals.power, 'percent', ''),
    kpiRow_('Wood Maintenance', null, null, goals.wood, 'percent', ''),
    kpiRow_('Overall Maintenance', null, null, goals.maintenance, 'percent', ''),
    kpiRow_('Rugs', null, null, goals.rugs, 'count', ''),
    kpiRow_('Average Ticket', null, null, goals.averageTicket, 'dollars', 'Written goal. Delivered average ticket is not on file.'),
    kpiRow_('Closing Ratio', closing.ratio, null, goals.closing, 'percent', closing.note, closing.reconcile),
    kpiRow_('Customer Opportunities', closing.opportunities, null, goals.opportunities, 'count', 'Location Ups + Be Backs for the same store dates.'),
    kpiRow_('Purchasing Customers', closing.customers, null, null, 'count', 'Net Written # OF CUST for the same store dates.'),
  ];
}

function activePerson_(row) {
  var role = String(row.role || 'associate');
  return role !== 'management' && role !== 'former' && role !== 'unknown';
}

// Daily SNAP lines live in CC_AssociateDays. SNAP_PERSON is a copy of those same lines and is not added again.
function snapAssociateLines_(individualStart, individualEnd) {
  var byDay = {};
  var order = [];
  var latest = '';
  sheet_('CC_AssociateDays').forEach(function (row) {
    var name = String(row.display_name || '');
    var date = isoDate_(row.date);
    if (!name || !date || date < individualStart || date > individualEnd) return;
    if (row.amount === '' || row.amount === null) return;
    if (date > latest) latest = date;
    var key = date + '|' + name;
    if (!byDay[key]) order.push(key);
    byDay[key] = {
      name: name,
      date: date,
      amount: Math.round(Number(row.amount) * 100) / 100,
      note: String(row.note || ''),
      role: String(row.role || ''),
    };
  });
  return { byDay: byDay, order: order, latest: latest };
}

function peopleRows_(individualStart, individualEnd) {
  var lines = snapAssociateLines_(individualStart, individualEnd);
  var totals = {};
  var seenAny = {};
  var days = {};
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    if (line.role === 'management' || line.role === 'unknown' || line.role === 'former') return;
    seenAny[line.name] = true;
    totals[line.name] = (totals[line.name] || 0) + line.amount;
    if (!days[line.name]) days[line.name] = [];
    days[line.name].push({ date: line.date, snapWritten: line.amount, note: line.note });
  });
  var goals = approvedGoals_(config_());
  var closingFacts = loadClosing_();
  var analysis = personAnalysisContext_({ start: individualStart, end: individualEnd });
  var roster = sheet_('CC_People').filter(activePerson_);
  var rows = roster.length ? roster.map(function (row) {
    var name = String(row.name);
    var written = Object.prototype.hasOwnProperty.call(totals, name)
      ? Math.round(totals[name] * 100) / 100
      : (seenAny[name] ? null : numberOrNull_(peopleSnapCell_(row)));
    return personRecord_(name, written, String(row.role || 'associate'), days[name] || [], goals, personClosing_(closingFacts, name, individualStart, individualEnd, goals.closing, analysis.ledger), personAnalysis_(analysis, name));
  }) : Object.keys(totals).map(function (name) {
    return personRecord_(name, Math.round(totals[name] * 100) / 100, 'associate', days[name] || [], goals, personClosing_(closingFacts, name, individualStart, individualEnd, goals.closing, analysis.ledger), personAnalysis_(analysis, name));
  });
  return rows;
}

var PERSON_ANALYSIS_VIEWS_ = ['DA_SALES', 'BEDDING', 'MPPA', 'FABW', 'LTHW', 'PWAR', 'FINANCE', 'AVERAGE'];
var PERSON_ANALYSIS_SOURCE_ = /DATA_ANALYSIS_KPI_17_/i;

/**
 * What the Data Analysis Group 17 reports cover for the salesperson month on one side: the latest salesperson
 * snapshot that starts on the 1st, then each following day whose Group 17 day file is on file. Days inside the
 * snapshot are never added to it, and nothing after a missing open day is counted.
 */
function personAnalysisCoverage_(ledger, side, period, closed) {
  var snapshot = '';
  var dayFiles = {};
  ledger.forEach(function (row) {
    if (row.side !== side || !PERSON_ANALYSIS_SOURCE_.test(row.source)) return;
    if (row.view === 'DA_SALES_PERSON' && row.grain === 'cumulative' && row.fitsTrack && row.periodStart === period.start && row.verifiedThrough > snapshot) snapshot = row.verifiedThrough;
    if (row.view === 'DA_SALES_STORE' && row.grain === 'daily') dayFiles[row.reportDate] = true;
  });
  var days = [];
  var through = snapshot;
  var cursor = snapshot ? shiftDate_(snapshot, 1) : period.start;
  while (cursor <= period.end) {
    if (dayFiles[cursor]) {
      days.push(cursor);
      through = cursor;
    } else if (!closed[cursor]) break;
    cursor = shiftDate_(cursor, 1);
  }
  return { side: side, period: period, snapshot: snapshot, days: days, through: through };
}

function personAnalysisLedger_() {
  return ledgerRows_().filter(function (row) {
    return row.scope === 'PERSON' || row.view === 'DA_SALES_STORE';
  });
}

function personAnalysisContext_(period) {
  var ledger = personAnalysisLedger_();
  var closed = closedDates_();
  return {
    ledger: ledger,
    written: personAnalysisCoverage_(ledger, 'written', period, closed),
    delivered: personAnalysisCoverage_(ledger, 'delivered', period, closed),
  };
}

/** One side for one salesperson. A covered report without a line for this person is 0 for that person. */
function personAnalysisSide_(ledger, name, coverage) {
  if (!coverage.through) return null;
  var parts = {};
  PERSON_ANALYSIS_VIEWS_.forEach(function (prefix) { parts[prefix] = {}; });
  ledger.forEach(function (row) {
    if (row.scope !== 'PERSON' || row.side !== coverage.side || !PERSON_ANALYSIS_SOURCE_.test(row.source)) return;
    var prefix = row.view.replace(/_PERSON$/, '');
    if (!parts[prefix] || !rowMatchesPerson_(row, name)) return;
    var part = '';
    if (row.grain === 'cumulative' && coverage.snapshot && row.fitsTrack && row.periodStart === coverage.period.start && row.verifiedThrough === coverage.snapshot) part = 'snapshot';
    if (row.grain === 'daily' && coverage.days.indexOf(row.reportDate) !== -1) part = row.reportDate;
    if (part) parts[prefix][part] = row;
  });
  var keys = (coverage.snapshot ? ['snapshot'] : []).concat(coverage.days);
  var sales = 0;
  var orders = 0;
  var bedding = 0;
  var financed = 0;
  keys.forEach(function (part) {
    var sale = parts.DA_SALES[part];
    var amount = sale && sale.sales !== null ? sale.sales : 0;
    sales += amount;
    if (orders !== null) orders = amount === 0 ? orders : (sale && sale.units !== null ? orders + sale.units : null);
    bedding += parts.BEDDING[part] && parts.BEDDING[part].sales !== null ? parts.BEDDING[part].sales : 0;
    if (financed !== null && amount !== 0) {
      var finance = parts.FINANCE[part];
      financed = finance && finance.percent !== null ? financed + finance.percent * amount : null;
    }
  });
  function counted(prefix) {
    var eligible = 0;
    var attachments = 0;
    keys.forEach(function (part) {
      var row = parts[prefix][part];
      if (!row) return;
      eligible += row.eligible || 0;
      attachments += row.attachments || 0;
    });
    return { value: eligible ? Math.round((attachments / eligible) * 1000) / 1000 : null, sold: attachments, detail: attachments + ' of ' + eligible, text: eligible ? '' : 'No qualifying sales' };
  }
  var round2 = function (value) { return Math.round(value * 100) / 100; };
  return {
    through: coverage.through,
    basis: (coverage.snapshot ? 'Group 17 salesperson report ' + coverage.period.start + ' through ' + coverage.snapshot : '') +
      (coverage.days.length ? (coverage.snapshot ? ' plus the ' : 'Group 17 ') + 'day files ' + coverage.days.join(', ') : ''),
    sales: round2(sales),
    orders: orders,
    beddingDollars: round2(bedding),
    bedding: { value: sales ? Math.round((bedding / sales) * 1000) / 1000 : null, detail: moneyText_(bedding) + ' of ' + moneyText_(sales), text: sales ? '' : 'No sales' },
    pads: counted('MPPA'),
    fabric: counted('FABW'),
    leather: counted('LTHW'),
    power: counted('PWAR'),
    finance: { value: sales && financed !== null ? Math.round((financed / sales) * 1000) / 1000 : null, detail: '', text: sales ? (financed === null ? 'Not on file' : '') : 'No sales' },
    average: { value: orders ? round2(sales / orders) : null, detail: orders === null ? '' : moneyText_(sales) + ' ÷ ' + orders + ' orders', text: orders === 0 ? 'No orders' : (orders === null ? 'Not on file' : '') },
  };
}

function personAnalysis_(context, name) {
  return { written: personAnalysisSide_(context.ledger, name, context.written), delivered: personAnalysisSide_(context.ledger, name, context.delivered) };
}

function analysisKpi_(name, unit, goal, analysis, field, note) {
  function side(value) {
    if (!value) return { value: null, detail: '', text: '' };
    var figure = value[field];
    return { value: figure.value, detail: figure.detail || '', text: figure.text || '' };
  }
  var written = side(analysis.written);
  var delivered = side(analysis.delivered);
  var row = kpiRow_(name, written.value, delivered.value, goal, unit, note);
  row.writtenDetail = written.detail;
  row.deliveredDetail = delivered.detail;
  row.writtenText = written.text;
  row.deliveredText = delivered.text;
  return row;
}

function notInReportKpi_(name, unit, goal) {
  var row = kpiRow_(name, null, null, goal, unit, 'The Group 17 report has no salesperson column for this. ASL reports it for the store only.');
  row.writtenText = 'Not in report';
  row.deliveredText = 'Not in report';
  return row;
}

function personRecord_(name, snapWritten, role, days, goals, closing, analysis) {
  closing = closing || { orders: null, opportunities: null, through: '', ratio: null, ratioStatus: 'Pending: PERQ opportunities and Group 17 Written orders', reconcile: false, versusGoal: null, points: null, note: '', goal: goals.closing };
  analysis = analysis || { written: null, delivered: null };
  var orders = kpiRow_('Orders', analysis.written ? analysis.written.orders : null, analysis.delivered ? analysis.delivered.orders : null, null, 'count', 'Group 17 sales ÷ average ticket.');
  return {
    name: name,
    role: role,
    written: snapWritten,
    snapWritten: snapWritten,
    deliveredSales: analysis.delivered ? analysis.delivered.sales : null,
    deliveredThrough: analysis.delivered ? analysis.delivered.through : '',
    deliveredBasis: analysis.delivered ? analysis.delivered.basis : '',
    writtenOrders: analysis.written ? analysis.written.orders : null,
    analysisWritten: analysis.written ? analysis.written.sales : null,
    analysisWrittenThrough: analysis.written ? analysis.written.through : '',
    analysisWrittenBasis: analysis.written ? analysis.written.basis : '',
    analysis: analysis,
    monthlyGoal: goals.individualVolume,
    closingOrders: closing.orders,
    opportunities: closing.opportunities,
    closingThrough: closing.through,
    closingRatio: closing.ratio,
    closingReconcile: closing.reconcile,
    closingVersus: closing.versusGoal,
    closingPoints: closing.points,
    closingNote: closing.note,
    closing: closing,
    leave: name === 'Renzo Del Solar' ? 'On vacation October 1 through October 12, 2026. Back October 13. Sales during vacation stay on the report and those days are not counted as worked.' : '',
    days: days.sort(function (left, right) { return left.date < right.date ? -1 : 1; }),
    kpis: [
      analysisKpi_('Bedding', 'percent', goals.bedding, analysis, 'bedding', 'Bedding dollars ÷ Group 17 sales.'),
      analysisKpi_('Mattress Pads', 'percent', goals.mattress, analysis, 'pads', 'Pads sold ÷ qualifying mattresses.'),
      notInReportKpi_('Adjustable Bases', 'percent', goals.adjustableBase),
      notInReportKpi_('Pillows', 'percent', goals.pillow),
      analysisKpi_('Fabric', 'percent', goals.fabric, analysis, 'fabric', 'Protection sold ÷ qualifying fabric pieces.'),
      analysisKpi_('Leather', 'percent', goals.leather, analysis, 'leather', 'Protection sold ÷ qualifying leather pieces.'),
      analysisKpi_('Power', 'percent', goals.power, analysis, 'power', 'Warranties sold ÷ qualifying power pieces.'),
      analysisKpi_('Financing', 'percent', goals.finance, analysis, 'finance', 'Financed dollars ÷ Group 17 sales.'),
      analysisKpi_('Average Ticket', 'dollars', goals.averageTicket, analysis, 'average', 'Group 17 sales ÷ orders.'),
      orders,
      closingKpi_(closing, goals.closing),
    ],
  };
}

function closingKpi_(closing, goal) {
  var row = kpiRow_('Closing Ratio', closing.ratio, null, goal, 'percent', closing.note, closing.reconcile);
  row.writtenText = closing.ratioStatus || '';
  row.writtenDetail = closing.through ? closing.orders + ' orders ÷ ' + closing.opportunities + ' opportunities through ' + closing.through : '';
  return row;
}

function attention_(facts, config, role) {
  var items = [];
  var yesterday = shiftDate_(todayNy_(), -1);
  var written = facts.filter(function (row) { return row.date === yesterday; })[0];
  if (!written || written.snapWritten === null) items.push('SNAP Written for ' + yesterday + ' has not arrived. Last verified figures stay in place.');
  if (!written || written.nwdsrDelivered === null) items.push('NWDSR Delivered for ' + yesterday + ' has not arrived.');
  sheet_('CC_Exceptions').slice(-8).forEach(function (row) {
    if (role === 'sales' && /management|password|credential/i.test(String(row.message))) return;
    items.push(String(row.message));
  });
  if (!items.length) items.push('No operational exceptions are open.');
  return items.slice(0, 8);
}

function storeCalendar_(facts, period, closed) {
  var byDate = {};
  facts.forEach(function (row) {
    if (row.date >= period.start && row.date <= period.end) byDate[row.date] = row;
  });
  return eachDate_(period.start, period.end).map(function (date) {
    var row = byDate[date];
    return row || { date: date, snapWritten: null, nwdsrWritten: null, nwdsrDelivered: null, closed: !!closed[date] };
  });
}

function verifiedRunRate_(days, field, closed) {
  var total = 0;
  var count = 0;
  days.forEach(function (day) {
    if (closed[day.date] || day[field] === null) return;
    total += day[field];
    count += 1;
  });
  if (!count) return null;
  var openDays = days.filter(function (day) { return !closed[day.date]; }).length;
  return Math.round(((total / count) * openDays) * 100) / 100;
}

function closingRatio_(customers, opportunities) {
  if (customers === null || opportunities === null || Number(opportunities) === 0) return { ratio: null, reconcile: false };
  var ratio = Math.round((customers / opportunities) * 1000) / 1000;
  return { ratio: ratio, reconcile: ratio > 1 };
}

function percentText_(ratio) {
  if (ratio === null || ratio === undefined) return 'Not Available';
  return (Number(ratio) * 100).toFixed(1) + '%';
}

function versusGoal_(ratio, goal, reconcile) {
  if (ratio === null || goal === null) return null;
  if (reconcile || ratio > 1) return 'Reconcile';
  var actual = Math.round(ratio * 1000);
  var target = Math.round(goal * 1000);
  if (actual === target) return 'On Target';
  return actual > target ? 'Above Goal' : 'Below Goal';
}

/** Percentage points from goal, one decimal, using the ratio as displayed. */
function pointsFromGoal_(ratio, goal) {
  if (ratio === null || goal === null) return null;
  return Math.round((Math.round(ratio * 1000) - Math.round(goal * 1000))) / 10;
}

function closingSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Closing');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Closing');
  tab.getRange(1, 1, 1, 13).setValues([['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note', 'verified_through', 'store']]);
  return tab;
}

function upsertClosing_(row) {
  var tab = closingSheet_();
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    var same = String(values[r][1]) === row.scope &&
      String(values[r][2] || '') === String(row.code || '') &&
      isoDate_(values[r][6]) === row.start &&
      isoDate_(values[r][7]) === row.end &&
      String(values[r][8]) === row.source;
    if (!same) continue;
    var existingCustomers = numberOrNull_(values[r][4]);
    var existingOpportunities = numberOrNull_(values[r][5]);
    if (row.customers !== '' && row.customers !== null && existingCustomers !== null && existingCustomers !== Number(row.customers)) {
      appendException_('Update Failed', 'Purchasing customers for ' + row.start + ' conflict with the count on file. The existing count was kept.');
      return 'conflict';
    }
    if (row.opportunities !== '' && row.opportunities !== null && existingOpportunities !== null && existingOpportunities !== Number(row.opportunities)) {
      appendException_('Update Failed', 'Opportunities for ' + (row.code || row.start) + ' conflict with the count on file. The existing count was kept.');
      return 'conflict';
    }
    if (row.customers !== '' && row.customers !== null && existingCustomers === null) tab.getRange(r + 1, 5).setValue(row.customers);
    if (row.opportunities !== '' && row.opportunities !== null && existingOpportunities === null) tab.getRange(r + 1, 6).setValue(row.opportunities);
    return 'imported';
  }
  // A blank date hides the row from sheet_(), so a cumulative row is dated by the last day it covers.
  tab.appendRow([
    row.date || row.end,
    row.scope,
    row.code || '',
    row.name || '',
    row.customers === null || row.customers === '' ? '' : row.customers,
    row.opportunities === null || row.opportunities === '' ? '' : row.opportunities,
    row.start,
    row.end,
    row.source,
    row.final || 'no',
    row.note || '',
    row.through || (row.start === row.end ? row.start : ''),
    '17',
  ]);
  return 'imported';
}

function ensureClosingFacts_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('closing_facts_v1') === 'yes' && sheet_('CC_Closing').length) return;
  var seeds = [
    { date: '2026-10-11', scope: 'store', code: '', name: '', customers: 6, opportunities: '', start: '2026-10-11', end: '2026-10-11', source: 'NWDSR Net Written # OF CUST', final: 'yes', note: 'Verified Net Written purchasing customers. The delivered report is not the numerator.' },
    { date: '2026-10-12', scope: 'store', code: '', name: '', customers: 4, opportunities: '', start: '2026-10-12', end: '2026-10-12', source: 'NWDSR Net Written # OF CUST', final: 'yes', note: 'Verified Net Written purchasing customers.' },
    { date: '2026-10-13', scope: 'store', code: '', name: '', customers: 4, opportunities: '', start: '2026-10-13', end: '2026-10-13', source: 'NWDSR Net Written # OF CUST', final: 'yes', note: 'Verified Net Written purchasing customers. The delivered report is not the numerator.' },
    { date: '', scope: 'person', code: 'EMON0904', name: 'Eric Montes Rodriguez', customers: '', opportunities: 32, start: '2026-10-01', end: '2026-10-31', source: 'PERQ Ups + Be Backs', final: 'no', note: 'Interim PERQ for October 1 through October 31. Run time unknown, so this snapshot is not the closing denominator.' },
    { date: '', scope: 'person', code: 'PGANDH', name: 'Prakash Gandhi', customers: '', opportunities: 31, start: '2026-10-01', end: '2026-10-31', source: 'PERQ Ups + Be Backs', final: 'no', note: 'Interim PERQ for October 1 through October 31. Run time unknown, so this snapshot is not the closing denominator.' },
    { date: '', scope: 'person', code: 'TNASSI', name: 'Ricky Nassif', customers: '', opportunities: 32, start: '2026-10-01', end: '2026-10-31', source: 'PERQ Ups + Be Backs', final: 'no', note: 'Interim PERQ for Ricky Nassif. Filter October 1 through October 31. Run time unknown, so this snapshot is not the closing denominator.' },
    { date: '', scope: 'person', code: 'RDELSO', name: 'Renzo Del Solar', customers: '', opportunities: 7, start: '2026-10-01', end: '2026-10-31', source: 'PERQ Ups + Be Backs', final: 'no', note: 'Interim PERQ for October 1 through October 31. Run time unknown, so this snapshot is not the closing denominator.' },
  ];
  var i;
  for (i = 0; i < seeds.length; i += 1) upsertClosing_(seeds[i]);
  props.setProperty('closing_facts_v1', 'yes');
}

function readClosing_() {
  return sheet_('CC_Closing').map(function (row) {
    return {
      scope: String(row.scope || ''),
      code: String(row.employee_code || '').trim(),
      name: String(row.display_name || '').trim(),
      customers: numberOrNull_(row.customers),
      opportunities: numberOrNull_(row.opportunities),
      start: isoDate_(row.period_start),
      end: isoDate_(row.period_end),
      through: isoDate_(row.verified_through) || isoDate_(row.period_end),
      final: String(row.final || '').toLowerCase() === 'yes',
      note: String(row.note || ''),
    };
  }).filter(function (row) { return row.start && row.end; });
}

function loadClosing_() {
  try {
    ensureClosingFacts_();
    var facts = readClosing_().filter(function (row) {
      return fitsTrack_(row.scope === 'store' ? 'STORE' : row.scope === 'person' ? 'PERSON' : '', row.start, row.end);
    });
    return mergePerq_(facts);
  } catch (error) {
    try { appendException_('Update Failed', 'Closing counts could not be read. Ratios stay Not Available.'); } catch (ignore) {}
    return [];
  }
}

function perqPersonMatch_(fact, code, name) {
  var factCode = String(fact.code || '').toLowerCase();
  var incomingCode = String(code || '').toLowerCase();
  if (factCode && incomingCode && factCode === incomingCode) return true;
  var factName = String(fact.name || '').toLowerCase();
  var incomingName = String(name || '').toLowerCase();
  if (!factName || !incomingName) return false;
  if (factName === incomingName) return true;
  var factAliases = personAliases_(fact.name);
  var incomingAliases = personAliases_(name);
  return factAliases.indexOf(incomingName) !== -1 || incomingAliases.indexOf(factName) !== -1;
}

/** PERQ rows fill a missing opportunity count. The same count is kept once. Sales dollars are never customers. */
function mergePerq_(facts) {
  var rows = [];
  try { rows = ledgerRows_(); } catch (error) { return facts; }
  rows.forEach(function (row) {
    if (row.view !== 'PERQ_STORE' && row.view !== 'PERQ_PERSON') return;
    if (!row.fitsTrack) return;
    var opportunities = row.eligible !== null ? row.eligible : row.units;
    if (opportunities === null || !row.periodStart || !row.periodEnd) return;
    var scope = row.view === 'PERQ_STORE' ? 'store' : 'person';
    var match = null;
    facts.forEach(function (fact) {
      if (fact.scope !== scope || fact.start !== row.periodStart || fact.end !== row.periodEnd) return;
      if (scope === 'store') {
        if (!fact.code) match = fact;
        return;
      }
      if (perqPersonMatch_(fact, row.code, row.name)) match = fact;
    });
    if (match) {
      if (match.opportunities === null) match.opportunities = opportunities;
      else if (match.opportunities !== opportunities) match.opportunityConflict = true;
      return;
    }
    facts.push({
      scope: scope,
      code: scope === 'store' ? '' : String(row.code || ''),
      name: scope === 'store' ? '' : String(row.name || ''),
      customers: null,
      opportunities: opportunities,
      start: row.periodStart,
      end: row.periodEnd,
      through: row.verifiedThrough || row.periodEnd,
      final: false,
      note: 'PERQ snapshot for ' + row.periodStart + ' through ' + row.periodEnd + '. A different period is not added to this count.',
    });
  });
  return facts;
}

function personAliases_(name) {
  var key = String(name || '').toLowerCase();
  var table = {
    'eric montes rodriguez': ['emon0904', 'eric montes rodriguez', 'eric montes'],
    'prakash gandhi': ['pgandh', 'prakash gandhi', 'prakash b gandhi'],
    'ricky nassif': ['tnassi', 'tnassif', 'ricky nassif', 'tarik nassif', 'ricky (tarik) nassif'],
    'renzo del solar': ['rdelso', 'renzo del solar', 'renzo delsolar'],
    'brenda sanchez': ['brenda sanchez'],
    'caroline amaro': ['caroline amaro'],
  };
  return table[key] || [key];
}

function rowMatchesPerson_(row, name) {
  var aliases = personAliases_(name);
  var presented = String(name || '').toLowerCase();
  if (aliases.indexOf(row.code.toLowerCase()) !== -1 || aliases.indexOf(row.name.toLowerCase()) !== -1) return true;
  var rowAliases = personAliases_(row.name);
  return rowAliases.indexOf(presented) !== -1 || (row.code && rowAliases.indexOf(row.code.toLowerCase()) !== -1 && aliases.indexOf(row.code.toLowerCase()) !== -1);
}

function dailyCountMap_(facts, scope, personName, field) {
  var map = {};
  var conflict = {};
  facts.forEach(function (row) {
    if (row.scope !== scope || row.start !== row.end || row[field] === null) return;
    if (field === 'opportunities' && row.opportunityConflict) conflict[row.start] = true;
    if (field === 'customers' && row.customerConflict) conflict[row.start] = true;
    if (scope === 'store' && row.code) return;
    if (scope === 'person' && !rowMatchesPerson_(row, personName)) return;
    if (Object.prototype.hasOwnProperty.call(map, row.start) && map[row.start] !== row[field]) conflict[row.start] = true;
    map[row.start] = row[field];
  });
  Object.keys(conflict).forEach(function (date) { delete map[date]; });
  return map;
}

/**
 * Count from start through date: the latest final cumulative row that ends on or before date,
 * plus that day's own count for every open day after it. A missing day leaves the count unknown.
 */
function countThrough_(facts, scope, name, start, date, field, closed, daily) {
  var cumulative = {};
  facts.forEach(function (row) {
    if (row.scope !== scope || row.start !== start || row.start === row.end || row[field] === null || !row.final) return;
    if (scope === 'store' && row.code) return;
    if (scope === 'person' && !rowMatchesPerson_(row, name)) return;
    var through = row.through || row.end;
    if (through > date || through < start) return;
    if (Object.prototype.hasOwnProperty.call(cumulative, through) && cumulative[through] !== row[field]) cumulative[through] = null;
    else cumulative[through] = row[field];
  });
  var bases = Object.keys(cumulative).filter(function (through) { return cumulative[through] !== null; }).sort().reverse().map(function (through) {
    return { through: through, total: cumulative[through] };
  });
  bases.push({ through: shiftDate_(start, -1), total: 0, daily: true });
  var b;
  for (b = 0; b < bases.length; b += 1) {
    var total = bases[b].total;
    var added = [];
    var complete = true;
    eachDate_(shiftDate_(bases[b].through, 1), date).forEach(function (day) {
      if (!complete || closed[day]) return;
      if (!Object.prototype.hasOwnProperty.call(daily, day)) {
        complete = false;
        return;
      }
      total += daily[day];
      added.push(day + ' ' + daily[day]);
    });
    if (!complete) continue;
    var parts = [];
    if (!bases[b].daily) parts.push(bases[b].total + ' for ' + start + ' through ' + bases[b].through);
    if (added.length) parts.push((bases[b].daily ? 'daily ' : 'plus daily ') + added.join(', '));
    return { total: total, source: parts.join(' ') || 'none' };
  }
  return null;
}

/** A daily store PERQ whose associate rows add up to the store count is complete, so an absent associate had 0 that day. */
function personDailyOpportunities_(facts, name) {
  var map = dailyCountMap_(facts, 'person', name, 'opportunities');
  var store = dailyCountMap_(facts, 'store', '', 'opportunities');
  Object.keys(store).forEach(function (date) {
    if (Object.prototype.hasOwnProperty.call(map, date)) return;
    var total = 0;
    var rows = 0;
    facts.forEach(function (row) {
      if (row.scope !== 'person' || row.start !== date || row.end !== date || row.opportunities === null) return;
      total += row.opportunities;
      rows += 1;
    });
    if (rows && total === store[date]) map[date] = 0;
  });
  return map;
}

var AWAITING_ = 'Awaiting Verified Data';

function saleOrders_(row) {
  return row.sales === 0 ? 0 : row.units;
}

/**
 * Data Analysis Group 17 Written order count for one salesperson from the 1st through date: the latest salesperson
 * snapshot that ends on or before date, plus each day after it whose Group 17 Written day file is on file. Days
 * inside the snapshot are never added again. A covered report without a line for this salesperson is 0. A missing
 * open day or an order count that could not be read leaves the total unknown.
 */
function personOrdersThrough_(ledger, name, period, date, closed) {
  var snapshots = {};
  var dayFiles = {};
  var dayOrders = {};
  ledger.forEach(function (row) {
    if (row.side !== 'written' || !PERSON_ANALYSIS_SOURCE_.test(row.source)) return;
    if (row.view === 'DA_SALES_STORE' && row.grain === 'daily' && row.reportDate >= period.start && row.reportDate <= date) dayFiles[row.reportDate] = true;
    if (row.view !== 'DA_SALES_PERSON') return;
    var mine = rowMatchesPerson_(row, name);
    if (row.grain === 'cumulative') {
      if (!row.fitsTrack || row.periodStart !== period.start || row.verifiedThrough < period.start || row.verifiedThrough > date) return;
      var snapshot = snapshots[row.verifiedThrough] || (snapshots[row.verifiedThrough] = { orders: 0, seen: false });
      if (!mine) return;
      var orders = saleOrders_(row);
      snapshot.orders = snapshot.seen && snapshot.orders !== orders ? null : orders;
      snapshot.seen = true;
    } else if (row.grain === 'daily' && mine) {
      var day = saleOrders_(row);
      dayOrders[row.reportDate] = Object.prototype.hasOwnProperty.call(dayOrders, row.reportDate) && dayOrders[row.reportDate] !== day ? null : day;
    }
  });
  var bases = Object.keys(snapshots).sort().reverse().concat(['']);
  var b;
  for (b = 0; b < bases.length; b += 1) {
    var base = bases[b];
    var total = base ? snapshots[base].orders : 0;
    if (total === null) continue;
    var added = [];
    var complete = true;
    eachDate_(base ? shiftDate_(base, 1) : period.start, date).forEach(function (day) {
      if (!complete) return;
      if (dayFiles[day]) {
        var count = Object.prototype.hasOwnProperty.call(dayOrders, day) ? dayOrders[day] : 0;
        if (count === null) complete = false;
        else {
          total += count;
          added.push(day + ' ' + count);
        }
      } else if (!closed[day]) complete = false;
    });
    if (!complete) continue;
    var parts = [];
    if (base) parts.push(snapshots[base].orders + ' for ' + period.start + ' through ' + base);
    if (added.length) parts.push((base ? 'plus day files ' : 'day files ') + added.join(', '));
    return { total: total, source: parts.join(' ') };
  }
  return null;
}

/**
 * Individual closing ratio = Data Analysis Group 17 Written order count ÷ the salesperson's PERQ Ups + Be Backs,
 * both from the 1st through the same verified date: the latest date on which both counts are on file.
 */
function personClosing_(facts, name, start, end, goal, ledger) {
  if (!ledger) {
    try { ledger = personAnalysisLedger_(); } catch (error) { ledger = []; }
  }
  var closed = closedDates_();
  var today = todayNy_();
  var last = end < today ? end : today;
  var period = { start: start, end: end };
  var dailyOpportunities = personDailyOpportunities_(facts, name);
  var opportunities = null;
  var orders = null;
  var through = '';
  var latestOpportunities = '';
  var latestOrders = '';
  eachDate_(start, last).reverse().forEach(function (date) {
    if (opportunities && orders) return;
    var counted = countThrough_(facts, 'person', name, start, date, 'opportunities', closed, dailyOpportunities);
    var written = personOrdersThrough_(ledger, name, period, date, closed);
    if (counted && !latestOpportunities) latestOpportunities = date;
    if (written && !latestOrders) latestOrders = date;
    if (!counted || !written) return;
    opportunities = counted;
    orders = written;
    through = date;
  });
  var computed = orders && opportunities ? closingRatio_(orders.total, opportunities.total) : { ratio: null, reconcile: false };
  var status = '';
  var note = '';
  if (!through) {
    var missing = [];
    if (!latestOpportunities) missing.push('PERQ opportunities');
    if (!latestOrders) missing.push('Group 17 Written orders');
    status = missing.length
      ? 'Pending: ' + missing.join(' and ')
      : (latestOpportunities < latestOrders ? 'Pending: PERQ verified only through ' + latestOpportunities : 'Pending: Group 17 Written verified only through ' + latestOrders);
    note = missing.length
      ? missing.join(' and ') + ' for this salesperson ' + (missing.length > 1 ? 'are' : 'is') + ' not on file for ' + start + ' through ' + end + '.'
      : 'PERQ is through ' + latestOpportunities + ' and Group 17 Written through ' + latestOrders + ', with no common verified date.';
  } else {
    note = 'Through ' + through + ': Group 17 Written orders ' + orders.source + '; PERQ Ups + Be Backs ' + opportunities.source + '.';
    if (latestOpportunities > through) note += ' PERQ through ' + latestOpportunities + ' waits for the Group 17 Written report for the same dates.';
    if (latestOrders > through) note += ' Group 17 Written through ' + latestOrders + ' waits for PERQ for the same dates.';
    if (opportunities.total === 0) status = 'No opportunities';
  }
  if (computed.reconcile) note += ' Above 100%. Flagged for reconciliation.';
  return {
    orders: orders ? orders.total : null,
    ordersSource: orders ? orders.source : '',
    opportunities: opportunities ? opportunities.total : null,
    opportunitiesSource: opportunities ? opportunities.source : '',
    through: through,
    opportunitiesThrough: through,
    ratio: computed.ratio,
    ratioStatus: status,
    reconcile: computed.reconcile,
    versusGoal: versusGoal_(computed.ratio, goal, computed.reconcile),
    points: pointsFromGoal_(computed.ratio, goal),
    note: note,
    goal: goal,
  };
}

var CLOSING_DAILY_HEADERS_ = [
  'Date', 'NWDSR Written purchasing customers', 'PERQ opportunities', 'Closing ratio', 'Store closing goal',
  'Difference from goal (pts)', 'Versus goal', 'Source reporting dates', 'Verification status',
  'MTD purchasing customers', 'MTD opportunities', 'MTD closing ratio', 'MTD difference from goal (pts)',
  'MTD versus goal', 'MTD sources', 'MTD verification status',
];

function viewNumber_(value) {
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function viewRatio_(value) {
  var number = viewNumber_(value);
  return number === null ? null : Math.round(number * 1000) / 1000;
}

function viewVersus_(value) {
  var text = String(value || '');
  return ['On Target', 'Above Goal', 'Below Goal', 'Reconcile'].indexOf(text) === -1 ? null : text;
}

function viewText_(value) {
  var text = String(value === null || value === undefined ? '' : value);
  return /^#[A-Z]/.test(text) ? 'Pending: calculation error on CC_ClosingDaily' : text;
}

/**
 * CC_ClosingDaily and CC_ClosingMTD are formulas over CC_Closing, so a new CC_Closing row updates them.
 * The dashboard shows their results and does not count again.
 */
function closingView_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var dailyTab = spreadsheet.getSheetByName('CC_ClosingDaily');
  var mtdTab = spreadsheet.getSheetByName('CC_ClosingMTD');
  if (!dailyTab || !mtdTab) return null;
  var values = dailyTab.getDataRange().getValues();
  var header = (values[0] || []).map(function (cell) { return String(cell || '').trim(); });
  if (header.slice(0, CLOSING_DAILY_HEADERS_.length).join('|') !== CLOSING_DAILY_HEADERS_.join('|')) return null;
  var days = [];
  var byDate = {};
  values.slice(1).forEach(function (row) {
    var date = isoDate_(row[0]);
    if (!date) return;
    var day = {
      date: date,
      customers: viewNumber_(row[1]),
      opportunities: viewNumber_(row[2]),
      ratio: viewRatio_(row[3]),
      points: viewNumber_(row[5]),
      versusGoal: viewVersus_(row[6]),
      sources: viewText_(row[7]),
      status: viewText_(row[8]),
      mtd: {
        customers: viewNumber_(row[9]),
        opportunities: viewNumber_(row[10]),
        ratio: viewRatio_(row[11]),
        points: viewNumber_(row[12]),
        versusGoal: viewVersus_(row[13]),
        sources: viewText_(row[14]),
        status: viewText_(row[15]),
      },
    };
    days.push(day);
    byDate[date] = day;
  });
  var summary = {};
  mtdTab.getDataRange().getValues().slice(1).forEach(function (row) { summary[String(row[0] || '').trim()] = row[1]; });
  return { days: days, byDate: byDate, summary: summary, start: isoDate_(summary['Period start']), end: isoDate_(summary['Period end']) };
}

function loadClosingView_() {
  try {
    return closingView_();
  } catch (error) {
    try { appendException_('Update Failed', 'CC_ClosingDaily could not be read. Store closing stays Pending.'); } catch (ignore) {}
    return null;
  }
}

function closingDayStatus_(day) {
  if (day.ratio !== null) return day.versusGoal || 'Reconcile';
  if (day.status === 'Verified: no opportunities') return 'No opportunities';
  return day.status || 'Pending';
}

function viewDayClosing_(view, date) {
  var day = view && view.byDate[date];
  if (!day) return { customers: null, opportunities: null, ratio: null, reconcile: false, versusGoal: null, status: 'Pending', note: date + ' is not on CC_ClosingDaily.' };
  return {
    customers: day.customers,
    opportunities: day.opportunities,
    ratio: day.ratio,
    reconcile: day.ratio !== null && day.ratio > 1,
    versusGoal: day.ratio === null ? null : day.versusGoal,
    status: day.status,
    note: day.status + '. ' + day.sources + '.',
  };
}

/** Store month to date as calculated on CC_ClosingMTD, with each CC_ClosingDaily row for the trend. */
function storeMonthClosing_(view, period, goal) {
  var pending = {
    customers: null, opportunities: null, ratio: null, reconcile: false, versusGoal: null, points: null, goal: goal,
    through: '', customerSource: '', opportunitySource: '', verification: 'Pending', provisional: false, matched: [], latest: null, trend: [],
  };
  if (!view) {
    pending.gap = 'The CC_ClosingDaily and CC_ClosingMTD tabs are not on the spreadsheet, so store closing is Pending.';
    pending.note = pending.gap;
    return pending;
  }
  if (view.start !== period.start) {
    pending.gap = 'CC_ClosingDaily covers ' + view.start + ' through ' + view.end + ', not ' + period.start + ' through ' + period.end + '.';
    pending.note = pending.gap;
    return pending;
  }
  var through = isoDate_(view.summary['MTD through']);
  var month = through ? view.byDate[through] : null;
  var sources = String(view.summary.Sources || '').split(' · ');
  var latestDate = isoDate_(view.summary['Latest daily date']);
  var latestDay = latestDate ? view.byDate[latestDate] : null;
  var lastDay = view.days.length ? view.days[view.days.length - 1] : null;
  var verification = month ? month.mtd.status : (lastDay ? lastDay.mtd.status : 'Pending');
  var note = month
    ? 'Month to date ' + period.start + ' through ' + through + ': ' + month.mtd.customers + ' purchasing customers ÷ ' + month.mtd.opportunities + ' opportunities = ' + percentText_(month.mtd.ratio) + '. ' + verification + '.'
    : 'Month to date is ' + verification + '.';
  return {
    customers: month ? month.mtd.customers : null,
    opportunities: month ? month.mtd.opportunities : null,
    ratio: month ? month.mtd.ratio : null,
    reconcile: !!(month && month.mtd.ratio !== null && month.mtd.ratio > 1),
    versusGoal: month ? month.mtd.versusGoal : null,
    points: month ? month.mtd.points : null,
    goal: goal,
    through: through,
    customerSource: month ? sources[0] || '' : '',
    opportunitySource: month ? sources[1] || '' : '',
    verification: verification,
    provisional: /^Provisional/.test(verification),
    matched: [],
    latest: latestDay ? {
      date: latestDay.date,
      customers: latestDay.customers,
      opportunities: latestDay.opportunities,
      ratio: latestDay.ratio,
      status: closingDayStatus_(latestDay),
      points: latestDay.points,
      verification: latestDay.status,
    } : null,
    trend: view.days.map(function (day) {
      return {
        date: day.date,
        customers: day.customers,
        opportunities: day.opportunities,
        ratio: day.ratio,
        status: closingDayStatus_(day),
        points: day.points,
        verification: day.status,
        sources: day.sources,
        mtdCustomers: day.mtd.customers,
        mtdOpportunities: day.mtd.opportunities,
        mtdRatio: day.mtd.ratio,
        mtdStatus: day.mtd.status,
      };
    }),
    gap: month ? '' : 'Month to date is ' + verification + '.',
    note: note,
  };
}

function withDayClosing_(days, view) {
  return days.map(function (day) {
    var closing = viewDayClosing_(view, day.date);
    return {
      date: day.date,
      snapWritten: day.snapWritten,
      nwdsrWritten: day.nwdsrWritten,
      nwdsrDelivered: day.nwdsrDelivered,
      closed: day.closed,
      purchasingCustomers: closing.customers,
      opportunities: closing.opportunities,
      closingRatio: closing.ratio,
      closingReconcile: closing.reconcile,
      closingVersus: closing.versusGoal,
      closingStatus: closing.status,
    };
  });
}

function savedPace_(budget, actualBefore, daysLeft) {
  if (budget === null || actualBefore === null || daysLeft === null || daysLeft <= 0) return null;
  return Math.round(((Number(budget) - actualBefore) / daysLeft) * 100) / 100;
}

function evenPace_(budget, totalDays) {
  if (budget === null || !totalDays) return null;
  return Math.round((Number(budget) / totalDays) * 100) / 100;
}

function goalPerformance_(actual, goal) {
  if (actual === null || goal === null) return { actual: actual, goal: goal, achieved: null, delta: null, result: null };
  return {
    actual: actual,
    goal: goal,
    achieved: Number(goal) === 0 ? null : Math.round((actual / Number(goal)) * 1000) / 1000,
    delta: Math.round((actual - goal) * 100) / 100,
    result: actual >= goal ? 'HIT' : 'MISSED',
  };
}

function operatingDayCount_(period, closed) {
  var count = 0;
  eachDate_(period.start, period.end).forEach(function (date) {
    if (!closed[date]) count += 1;
  });
  return count;
}

function sumBefore_(facts, field, start, date) {
  var prior = shiftDate_(date, -1);
  if (prior < start) return 0;
  return sumField_(facts, field, start, prior);
}

function configBlank_(config, key) {
  return !Object.prototype.hasOwnProperty.call(config, key) || config[key] === '' || config[key] === null || config[key] === undefined;
}

function putConfig_(key, value) {
  var tab = SpreadsheetApp.openById(SPREADSHEET_ID_).getSheetByName('CC_Config');
  if (!tab) return;
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === key) {
      tab.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  tab.appendRow([key, value]);
}

function ensureOfficialGoals_() {
  var config = config_();
  function fill(key, value) {
    if (configBlank_(config, key)) putConfig_(key, value);
  }
  fill('bedding_minimum', 0.2);
  fill('average_ticket_goal', 2500);
  fill('pillow_goal', 0.65);
  fill('pillow_goal_unit', 'percent');
  fill('adjustable_base_goal', 0.35);
  fill('adjustable_base_goal_unit', 'percent');
  fill('warranty_sales_goal', 0.055);
  fill('fabric_maintenance_goal', 0.8);
  fill('leather_maintenance_goal', 0.8);
  fill('power_maintenance_goal', 0.8);
  fill('power_base_goal', 0.35);
  fill('wood_maintenance_goal', 0.5);
  fill('finance_goal', 0.5);
  fill('rugs_goal', 12);
  fill('individual_volume_goal', 65000);
  if (configBlank_(config, 'mattress_protector_goal') || Number(config.mattress_protector_goal) === 1) putConfig_('mattress_protector_goal', 0.8);
  if (configBlank_(config, 'written_goal')) putConfig_('written_goal', 400000);
  if (configBlank_(config, 'delivered_goal')) putConfig_('delivered_goal', 320000);
  if (configBlank_(config, 'closing_goal')) putConfig_('closing_goal', 0.5);
}

function kpiActuals_() {
  return [
    ['Bedding', 0.206, 0.137, ''],
    ['Adjustable Base Attachment', 0.273, 0.25, ''],
    ['Pillows', null, null, 'Pillow Sold Qty is blank.'],
    ['Mattress Protectors', 0.3, 1, 'Source column is Mattress Pads.'],
    ['Overall Warranty % of Sales', null, null, 'No warranty percent of sales column.'],
    ['Fabric Maintenance', 0.587, 0.941, ''],
    ['Leather Maintenance', 0.6, 0.765, ''],
    ['Power Upholstery', 0.75, 0.857, ''],
    ['Power Adjustable Base', null, null, 'ADJ PWR percent is blank.'],
    ['Wood Kits', null, null, 'No UVWL wood kits column.'],
    ['Finance', 0.233, 0.443, ''],
    ['Average Ticket', 2040.52, 1257.71, ''],
    ['Rugs', 7, 3, ''],
  ];
}

function kpiSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Kpi');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Kpi');
  tab.getRange(1, 1, 1, 7).setValues([['metric', 'written', 'delivered', 'note', 'period_start', 'period_end', 'verified_through']]);
  return tab;
}

function ensureKpiActuals_() {
  var tab = kpiSheet_();
  var values = tab.getDataRange().getValues();
  var present = {};
  var r;
  for (r = 1; r < values.length; r += 1) present[String(values[r][0])] = true;
  kpiActuals_().forEach(function (row) {
    if (present[row[0]]) return;
    tab.appendRow([row[0], row[1] === null ? '' : row[1], row[2] === null ? '' : row[2], row[3], '2026-10-02', '2026-11-01']);
  });
}

/** CC_Kpi holds store figures, so only rows for the current store month are used. */
function readKpiActuals_() {
  var map = {};
  var store = storePeriodContaining_(todayNy_());
  sheet_('CC_Kpi').forEach(function (row) {
    if (!row.metric || String(row.metric) === 'Daily Bedding') return;
    if (isoDate_(row.period_start) !== store.start || isoDate_(row.period_end) !== store.end) return;
    map[String(row.metric)] = { written: fineNumber_(row.written), delivered: fineNumber_(row.delivered), note: String(row.note || ''), through: isoDate_(row.verified_through) };
  });
  // The built-in figures are the October 2026 store month only.
  if (!Object.keys(map).length && store.start === '2026-10-02') {
    kpiActuals_().forEach(function (row) {
      map[row[0]] = { written: row[1], delivered: row[2], note: row[3] };
    });
  }
  return map;
}

function homeKpiStrip_(goals, actuals, closing) {
  var specs = [
    ['Bedding', 'percent', goals.bedding],
    ['Adjustable Base Attachment', 'percent', goals.adjustableBase],
    ['Pillows', 'percent', goals.pillow],
    ['Mattress Protectors', 'percent', goals.mattress],
    ['Overall Warranty % of Sales', 'percent', goals.warranty],
    ['Fabric Maintenance', 'percent', goals.fabric],
    ['Leather Maintenance', 'percent', goals.leather],
    ['Power Upholstery', 'percent', goals.power],
    ['Power Adjustable Base', 'percent', goals.powerBase],
    ['Wood Kits', 'percent', goals.wood],
    ['Finance', 'percent', goals.finance],
    ['Closing Ratio', 'percent', goals.closing],
    ['Average Ticket', 'dollars', goals.averageTicket],
    ['Rugs', 'count', goals.rugs],
  ];
  return specs.map(function (spec) {
    if (spec[0] === 'Closing Ratio') {
      var dailyDetail = closing.latest && closing.latest.ratio !== null
        ? closing.latest.date + ' daily: ' + closing.latest.customers + ' ÷ ' + closing.latest.opportunities + ' = ' + percentText_(closing.latest.ratio)
        : '';
      return {
        name: spec[0],
        unit: spec[1],
        goal: spec[2],
        written: closing.ratio,
        delivered: null,
        through: closing.ratio !== null ? (closing.through || '') : '',
        detail: closing.ratio !== null && closing.customers !== null && closing.opportunities !== null
          ? closing.customers + ' customers ÷ ' + closing.opportunities + ' opportunities'
          : dailyDetail,
        note: closing.ratio !== null ? '' : (closing.gap || closing.note || ''),
        reconcile: !!closing.reconcile,
      };
    }
    var row = actuals[spec[0]] || { written: null, delivered: null, note: '' };
    return { name: spec[0], unit: spec[1], goal: spec[2], written: row.written, delivered: row.delivered, through: row.through || '', note: row.note || '', reconcile: false };
  });
}

function dailyGoalSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_DailyGoals');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_DailyGoals');
  tab.getRange(1, 1, 1, 4).setValues([['date', 'written_goal', 'delivered_goal', 'days_left']]);
  return tab;
}

function readSavedDailyGoals_() {
  var map = {};
  sheet_('CC_DailyGoals').forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date) return;
    map[date] = { written: fineNumber_(row.written_goal), delivered: fineNumber_(row.delivered_goal) };
  });
  return map;
}

function upsertDailyGoal_(date, written, delivered, daysLeft) {
  if (written === null && delivered === null) return;
  var tab = dailyGoalSheet_();
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) !== date) continue;
    if ((values[r][1] === '' || values[r][1] === null) && written !== null) tab.getRange(r + 1, 2).setValue(written);
    if ((values[r][2] === '' || values[r][2] === null) && delivered !== null) tab.getRange(r + 1, 3).setValue(delivered);
    return;
  }
  tab.appendRow([date, written === null ? '' : written, delivered === null ? '' : delivered, daysLeft]);
}

function ensureSavedDailyGoals_(period, today, closed, facts, writtenBudget, deliveredBudget) {
  eachDate_(period.start, period.end).forEach(function (date) {
    if (date >= today || closed[date]) return;
    var daysLeft = operatingDaysRemaining_(period, date, closed);
    upsertDailyGoal_(
      date,
      savedPace_(writtenBudget, sumBefore_(facts, 'snapWritten', period.start, date), daysLeft),
      savedPace_(deliveredBudget, sumBefore_(facts, 'nwdsrDelivered', period.start, date), daysLeft),
      daysLeft
    );
  });
}

function home_(payload) {
  try { ensureDailyTrigger_(); } catch (error) { appendException_('Update Failed', 'The daily import check could not be started.'); }
  try { ensureOfficialGoals_(); } catch (error) { appendException_('Update Failed', 'Official KPI goals could not be saved.'); }
  var config = config_();
  var facts = dailyFacts_();
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var closed = closedDates_();
  var start = store.start;
  var end = store.end;
  var yesterday = shiftDate_(today, -1);
  var days = storeCalendar_(facts, store, closed);
  var snap = sumField_(facts, 'snapWritten', start, end);
  var delivered = sumField_(facts, 'nwdsrDelivered', start, end);
  var writtenGoal = goalForMonth_(config, store, 'written_goal');
  var deliveredGoal = goalForMonth_(config, store, 'delivered_goal');
  if (writtenGoal === null && start === '2026-10-02' && end === '2026-11-01') writtenGoal = 400000;
  if (deliveredGoal === null && start === '2026-10-02' && end === '2026-11-01') deliveredGoal = 320000;
  var daysLeft = operatingDaysRemaining_(store, today, closed);
  var writtenPace = pace_(writtenGoal, snap, daysLeft);
  var deliveredPace = pace_(deliveredGoal, delivered, daysLeft);
  var yesterdayRow = facts.filter(function (row) { return row.date === yesterday; })[0] || null;
  var latest = facts.filter(function (row) { return row.snapWritten !== null && row.date >= start && row.date <= end; }).map(function (row) { return row.date; }).sort().pop() || '';
  var metrics = {};
  sheet_('CC_Metrics').forEach(function (row) { metrics[String(row.key)] = row; });
  var bedding = metrics.bedding_percent ? numberOrNull_(metrics.bedding_percent.value) : null;
  var closingView = loadClosingView_();
  var closingGoal = closingGoal_(config);
  var monthClosing = storeMonthClosing_(closingView, store, closingGoal);
  var yesterdayClosing = viewDayClosing_(closingView, yesterday);
  // Written actuals are SNAP. Delivered actuals are NWDSR Delivered.
  // NWDSR Written stays on the daily row and is not the written total: it may be unpaid or cancelled.
  // SNAP Delivered is not a required report.
  var missing = days.filter(function (day) {
    return day.date < today && !closed[day.date] && (day.snapWritten === null || day.nwdsrWritten === null || day.nwdsrDelivered === null);
  });
  var attention = attention_(facts, config, payload.session.role);
  if (missing.length) {
    attention.unshift(missing.length <= 4
      ? 'Store reports are incomplete for ' + missing.map(function (day) { return day.date; }).join(', ') + '. Blank is not zero.'
      : missing.length + ' store days are missing a verified report. Blank is not zero.');
  }
  var savedGoals = {};
  try {
    ensureSavedDailyGoals_(store, today, closed, facts, writtenGoal, deliveredGoal);
    savedGoals = readSavedDailyGoals_();
  } catch (error) {
    try { appendException_('Update Failed', 'Yesterday\'s goal could not be saved.'); } catch (ignore) {}
  }
  var yesterdaySaved = savedGoals[yesterday] || {};
  var yesterdayDays = operatingDaysRemaining_(store, yesterday, closed);
  var yesterdayWrittenGoal = yesterdaySaved.written !== undefined && yesterdaySaved.written !== null ? yesterdaySaved.written : savedPace_(writtenGoal, sumBefore_(facts, 'snapWritten', start, yesterday), yesterdayDays);
  var yesterdayDeliveredGoal = yesterdaySaved.delivered !== undefined && yesterdaySaved.delivered !== null ? yesterdaySaved.delivered : savedPace_(deliveredGoal, sumBefore_(facts, 'nwdsrDelivered', start, yesterday), yesterdayDays);
  var kpiActuals = {};
  try {
    ensureKpiActuals_();
    kpiActuals = readKpiActuals_();
  } catch (error) {
    kpiActuals_().forEach(function (row) { kpiActuals[row[0]] = { written: row[1], delivered: row[2], note: row[3] }; });
    try { appendException_('Update Failed', 'KPI workbook figures could not be saved.'); } catch (ignore) {}
  }
  var totalDays = operatingDayCount_(store, closed);
  var goals = approvedGoals_(config);
  var evenWritten = evenPace_(writtenGoal, totalDays);
  var evenDelivered = evenPace_(deliveredGoal, totalDays);
  var board = {
    yesterday: {
      written: goalPerformance_(yesterdayRow ? yesterdayRow.snapWritten : null, yesterdayWrittenGoal),
      delivered: goalPerformance_(yesterdayRow ? yesterdayRow.nwdsrDelivered : null, yesterdayDeliveredGoal),
    },
    today: {
      written: writtenPace.pace,
      delivered: deliveredPace.pace,
      daysLeft: daysLeft,
      writtenAdjustment: writtenPace.pace === null || evenWritten === null ? null : Math.round((writtenPace.pace - evenWritten) * 100) / 100,
      deliveredAdjustment: deliveredPace.pace === null || evenDelivered === null ? null : Math.round((deliveredPace.pace - evenDelivered) * 100) / 100,
    },
    month: {
      written: snap,
      delivered: delivered,
      writtenGoal: writtenGoal,
      deliveredGoal: deliveredGoal,
      writtenAchieved: ratio_(snap, writtenGoal),
      deliveredAchieved: ratio_(delivered, deliveredGoal),
      writtenLeft: writtenPace.remaining,
      deliveredLeft: deliveredPace.remaining,
      writtenForecast: verifiedRunRate_(days, 'snapWritten', closed),
      deliveredForecast: verifiedRunRate_(days, 'nwdsrDelivered', closed),
      provisional: missing.length > 0,
    },
    kpis: homeKpiStrip_(goals, kpiActuals, monthClosing),
  };
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    updated: healthValue_('last_calculation') || 'Not Available',
    period: start + ' through ' + end,
    individualPeriod: individual.start + ' through ' + individual.end,
    today: today,
    yesterday: {
      date: yesterday,
      written: yesterdayRow ? yesterdayRow.snapWritten : null,
      delivered: yesterdayRow ? yesterdayRow.nwdsrDelivered : null,
      missing: !yesterdayRow || yesterdayRow.snapWritten === null,
      customers: yesterdayClosing.customers,
      opportunities: yesterdayClosing.opportunities,
      closingRatio: yesterdayClosing.ratio,
      closingVersus: yesterdayClosing.versusGoal,
      closingNote: yesterdayClosing.note,
    },
    latest: latest,
    month: {
      written: snap,
      delivered: delivered,
      writtenGoal: writtenGoal,
      deliveredGoal: deliveredGoal,
      writtenLeft: writtenPace.remaining,
      deliveredLeft: deliveredPace.remaining,
    },
    todayGoal: {
      written: writtenPace.pace,
      delivered: deliveredPace.pace,
      daysLeft: daysLeft,
      goalOnFile: writtenGoal !== null,
    },
    projection: {
      written: verifiedRunRate_(days, 'snapWritten', closed),
      delivered: verifiedRunRate_(days, 'nwdsrDelivered', closed),
      provisional: missing.length > 0,
      note: missing.length
        ? 'Provisional. Built only from days that have a verified figure. ' + missing.length + ' store days are incomplete and were not counted as zero.'
        : 'From verified store days only. The official monthly budget is unchanged.',
    },
    bedding: {
      value: bedding,
      note: metrics.bedding_percent ? String(metrics.bedding_percent.note || '') : '',
      goal: Number(config.bedding_minimum || 0.2),
    },
    closing: { goal: closingGoal, mtd: monthClosing, yesterday: yesterdayClosing },
    goals: goals,
    board: board,
    scoreboard: scoreboard_(config, snap, delivered, writtenGoal, deliveredGoal, writtenPace, deliveredPace, daysLeft, yesterdayRow, yesterday, missing),
    kpis: storeKpis_(config, metrics, bedding, monthClosing),
    attachment: { value: null, goal: Number(config.attachment_goal || 0.9) },
    attention: attention.slice(0, 8),
    people: peopleRows_(individual.start, individual.end).slice(0, 8),
  };
}

function daily_(payload) {
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var closed = closedDates_();
  var view = loadClosingView_();
  var goal = closingGoal_(config_());
  return {
    role: payload.session.role,
    period: store.start + ' through ' + store.end,
    updated: healthValue_('last_calculation') || 'Not Available',
    goal: goal,
    closing: storeMonthClosing_(view, store, goal),
    days: withDayClosing_(storeCalendar_(dailyFacts_(), store, closed), view),
  };
}

function closing_(payload) {
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var goal = closingGoal_(config_());
  var month = storeMonthClosing_(loadClosingView_(), store, goal);
  return {
    role: payload.session.role,
    updated: healthValue_('last_calculation') || 'Not Available',
    period: store.start + ' through ' + store.end,
    individualPeriod: individual.start + ' through ' + individual.end,
    goal: goal,
    store: month,
    people: peopleRows_(individual.start, individual.end).map(function (person) {
      var closing = person.closing || {};
      return {
        name: person.name,
        orders: closing.orders === undefined ? null : closing.orders,
        ordersSource: closing.ordersSource || '',
        opportunities: closing.opportunities === undefined ? null : closing.opportunities,
        opportunitiesSource: closing.opportunitiesSource || '',
        through: closing.through || '',
        ratio: closing.ratio === undefined ? null : closing.ratio,
        ratioStatus: closing.ratioStatus || '',
        versusGoal: closing.versusGoal || null,
        points: closing.points === undefined ? null : closing.points,
        note: closing.note || '',
      };
    }),
  };
}

function metricCovers_(note, start, end) {
  var text = String(note || '');
  return text.indexOf(start) !== -1 && text.indexOf(end) !== -1;
}

function bedding_(payload) {
  try { ensureOfficialGoals_(); } catch (error) { appendException_('Update Failed', 'Official KPI goals could not be saved.'); }
  var config = config_();
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var metrics = {};
  sheet_('CC_Metrics').forEach(function (row) { metrics[String(row.key)] = row; });
  var beddingRow = metrics.bedding_percent;
  var beddingValue = beddingRow ? numberOrNull_(beddingRow.value) : null;
  var beddingNote = beddingRow ? String(beddingRow.note || '') : '';
  var covers = beddingValue !== null && metricCovers_(beddingNote, store.start, store.end);
  var people = peopleRows_(individual.start, individual.end).map(function (person) {
    var written = person.analysis.written;
    var delivered = person.analysis.delivered;
    return {
      name: person.name,
      beddingWritten: written ? written.beddingDollars : null,
      beddingDelivered: delivered ? delivered.beddingDollars : null,
      writtenPercent: written ? written.bedding.value : null,
      deliveredPercent: delivered ? delivered.bedding.value : null,
      units: null,
      protectorPercent: written ? written.pads.value : null,
      protectorUnits: written ? written.pads.sold : null,
      pillowUnits: null,
      pillowDollars: null,
      baseUnits: null,
      baseDollars: null,
      basePercent: null,
    };
  });
  return {
    role: payload.session.role,
    storePeriod: store.start + ' through ' + store.end,
    individualPeriod: individual.start + ' through ' + individual.end,
    updated: healthValue_('last_calculation') || 'Not Available',
    writtenPercent: covers ? beddingValue : null,
    writtenPercentNote: covers ? beddingNote : (beddingValue !== null ? 'A written bedding figure is on file for ' + beddingNote + '. It does not cover this store month, so it is not shown as the store bedding percentage.' : 'No bedding report covers this store month.'),
    deliveredPercent: null,
    beddingGoal: goalOr_(config, 'bedding_minimum', 0.2),
    protectorGoal: protectorGoal_(config),
    pillowGoal: goalOr_(config, 'pillow_goal', 0.65),
    pillowUnit: String(config.pillow_goal_unit || 'percent'),
    baseGoal: goalOr_(config, 'adjustable_base_goal', 0.35),
    baseUnit: String(config.adjustable_base_goal_unit || 'percent'),
    people: people,
  };
}

function normalizeGoal_(value, unit) {
  if (value === '' || value === null || value === undefined) return '';
  var number = Number(value);
  if (!isFinite(number)) throw new Error('Enter a number or leave the goal blank.');
  if (unit === 'percent' && number > 1) return Math.round((number / 100) * 10000) / 10000;
  return number;
}

function writeConfig_(key, value) {
  var allowed = { pillow_goal: true, pillow_goal_unit: true, adjustable_base_goal: true, adjustable_base_goal_unit: true };
  if (!allowed[key]) throw new Error('That setting cannot be changed here.');
  var tab = SpreadsheetApp.openById(SPREADSHEET_ID_).getSheetByName('CC_Config');
  if (!tab) throw new Error('CC_Config is missing.');
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === key) {
      tab.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  tab.appendRow([key, value]);
}

function saveBeddingGoals_(payload) {
  var units = { percent: true, count: true, dollars: true };
  var pillowUnit = units[payload.pillowUnit] ? payload.pillowUnit : 'percent';
  var baseUnit = units[payload.baseUnit] ? payload.baseUnit : 'percent';
  writeConfig_('pillow_goal', normalizeGoal_(payload.pillowGoal, pillowUnit));
  writeConfig_('pillow_goal_unit', pillowUnit);
  writeConfig_('adjustable_base_goal', normalizeGoal_(payload.baseGoal, baseUnit));
  writeConfig_('adjustable_base_goal_unit', baseUnit);
  return bedding_(payload);
}

function peopleSnapCell_(row) {
  if (row.snap_written !== undefined && row.snap_written !== '') return row.snap_written;
  if (row['SNAP Written'] !== undefined && row['SNAP Written'] !== '') return row['SNAP Written'];
  return row.written;
}

function refreshPeopleWritten_(individualStart, individualEnd) {
  var lines = snapAssociateLines_(individualStart, individualEnd);
  var totals = {};
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    if (line.role === 'management' || line.role === 'unknown' || line.role === 'former') return;
    totals[line.name] = Math.round(((totals[line.name] || 0) + line.amount) * 100) / 100;
  });
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_People');
  if (!tab) return lines.latest;
  var values = tab.getDataRange().getValues();
  if (String(values[0][2] || '').trim() === 'written') tab.getRange(1, 3).setValue('SNAP Written');
  var r;
  for (r = 1; r < values.length; r += 1) {
    var name = String(values[r][0] || '');
    var role = String(values[r][1] || 'associate');
    if (role === 'management' || role === 'former' || role === 'unknown') continue;
    if (!Object.prototype.hasOwnProperty.call(totals, name)) continue;
    if (numberOrNull_(values[r][2]) === totals[name]) continue;
    tab.getRange(r + 1, 3).setValue(totals[name]);
  }
  return lines.latest;
}

/**
 * Individual-month dates with no salesperson SNAP report. The daily SNAP report carries the salesperson lines,
 * so a date with a store SNAP figure or any salesperson line had its report. Other dates are Pending, not zero.
 */
function snapPendingDates_(individualStart, individualEnd, through) {
  var reported = {};
  sheet_('CC_AssociateDays').forEach(function (row) { reported[isoDate_(row.date)] = true; });
  dailyFacts_().forEach(function (row) { if (row.snapWritten !== null) reported[row.date] = true; });
  var closed = closedDates_();
  return eachDate_(individualStart, through < individualEnd ? through : individualEnd).filter(function (date) {
    return !reported[date] && !closed[date];
  });
}

function people_(payload) {
  var today = todayNy_();
  var individual = individualPeriodContaining_(today);
  var snapThrough = refreshPeopleWritten_(individual.start, individual.end);
  var people = peopleRows_(individual.start, individual.end);
  return {
    role: payload.session.role,
    period: individual.start + ' through ' + individual.end,
    snapThrough: snapThrough || null,
    snapPending: snapThrough ? snapPendingDates_(individual.start, individual.end, snapThrough) : [],
    snapLabel: 'SNAP written',
    analysisThrough: { written: (people[0] && people[0].analysisWrittenThrough) || null, delivered: (people[0] && people[0].deliveredThrough) || null },
    people: people,
    updated: healthValue_('last_calculation') || 'Not Available',
  };
}

function anniversaryPromotion_() {
  return {
    name: '78th Anniversary Sale',
    start: '2026-10-13',
    end: '2026-10-19',
    approved: 'yes',
    highlights: ['Featured floor samples are 50% off.', 'Davey Euro Top mattresses are 50% off.', '78-month 0% financing runs through October 26.'],
    featured: [
      { name: 'Palm Gate 5-piece King Bedroom', was: 3999.99, now: 1999.99, save: 2000, off: '50% OFF' },
      { name: 'Oakley White/Grey 4-piece Sectional', was: 2999.99, now: 1499.99, save: 1500, off: '50% OFF' },
      { name: 'Dallas Saddle 6-piece Manual Reclining Sectional', was: 2799.99, now: 1399.99, save: 1400, off: '50% OFF' },
    ],
    floorNote: 'Additional sale merchandise is marked on the showroom floor. A complete list will be provided.',
    mattressName: 'Davey Euro Top',
    mattressOff: '50% OFF',
    mattressLines: ['Queen: $599.50', 'King: $899.50'],
    mattressNote: 'Mattresses are not automatically eligible for additional discounts. Only an explicitly approved special applies.',
    exclusions: ['Special orders', 'Tempur-Pedic', 'Beautyrest Black'],
    beddingFinance: 'Size-based qualifying amounts are not in the approved promotion.',
    financing: [
      { months: 6, summary: 'No minimum, no down payment. Discounts allowed.', end: '2026-10-19', zeroInterest: false, highlight: false },
      { months: 12, summary: 'No minimum, no down payment. Discounts allowed.', end: '2026-10-19', zeroInterest: false, highlight: false },
      { months: 18, summary: 'No minimum, no down payment. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false },
      { months: 24, summary: '$1,999 minimum, plus tax and delivery. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false },
      { months: 48, summary: '$2,999 minimum, plus tax and delivery. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false },
      { months: 60, summary: '$5,999 minimum, 20% down, plus tax and delivery. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-19', zeroInterest: false, highlight: false },
      { months: 78, summary: 'SPECIAL 0% FINANCING. $5,999.99 minimum, 25% deposit using another payment method. Yellow Tag only. NO ADDITIONAL DISCOUNT.', end: '2026-10-26', zeroInterest: true, highlight: true },
    ],
  };
}

function promoSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Promotions');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Promotions');
  tab.getRange(1, 1, 1, 2).setValues([['id', 'body']]);
  return tab;
}

function ensureMorningPromotion_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('morning_promo_v1') === 'yes') return;
  var tab = promoSheet_();
  if (tab.getLastRow() < 2) tab.appendRow(['current', JSON.stringify(anniversaryPromotion_())]);
  props.setProperty('morning_promo_v1', 'yes');
}

function readPromotion_() {
  var rows = sheet_('CC_Promotions');
  var chosen = null;
  rows.forEach(function (row) {
    if (String(row.id || '') !== 'current' || !row.body) return;
    try { chosen = JSON.parse(String(row.body)); } catch (error) { chosen = null; }
  });
  return chosen;
}

function saleOnDate_(promotion, today) {
  if (!promotion || String(promotion.approved) !== 'yes') return null;
  if (today < promotion.start || today > promotion.end) return null;
  return promotion;
}

function financeOnDate_(promotion, today) {
  var terms = promotion && promotion.financing ? promotion.financing : [];
  return terms.filter(function (term) {
    return term && term.end >= today && !term.bedding;
  }).sort(function (left, right) { return Number(left.months) - Number(right.months); });
}

function beddingDailyMap_() {
  var map = {};
  sheet_('CC_Kpi').forEach(function (row) {
    if (String(row.metric) !== 'Daily Bedding') return;
    var start = isoDate_(row.period_start);
    if (!start || start !== isoDate_(row.period_end)) return;
    map[start] = { written: fineNumber_(row.written), delivered: fineNumber_(row.delivered) };
  });
  return map;
}

function storeBeddingLedger_(side, periodStart) {
  var best = null;
  ledgerRows_().forEach(function (row) {
    if (row.view !== 'BEDDING_STORE' || row.grain !== 'cumulative' || row.side !== side || row.code || row.name) return;
    if (!periodStart || !row.fitsTrack || row.periodStart !== periodStart) return;
    best = laterLedger_(best, row);
  });
  return best;
}

function managementName_(name) {
  var key = String(name || '').toLowerCase().replace(/[^a-z, ]/g, ' ').replace(/\s+/g, ' ').trim();
  var flipped = key;
  var comma = key.split(',');
  if (comma.length === 2) flipped = (comma[1] + ' ' + comma[0]).replace(/\s+/g, ' ').trim();
  var blocked = {
    'kelly meyers': true,
    'james meyers': true,
    'meyers james': true,
    'cordell primous': true,
    'primous cordell': true,
    'elizabeth perez': true,
    'perez elizabeth': true,
  };
  return !!blocked[key] || !!blocked[flipped];
}

function staffRole_(value) {
  var role = String(value || '').trim().toLowerCase();
  if (role === 'associate' || role === 'salesperson' || role === 'sales') return 'associate';
  if (role === 'manager' || role === 'management') return 'management';
  if (role === 'former') return 'former';
  if (!role) return '';
  return 'unknown';
}

function staffingSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Staffing');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Staffing');
  tab.getRange(1, 1, 1, 10).setValues([[
    'date', 'employee_code', 'display_name', 'role', 'worked', 'on_leave', 'nwdsr_written', 'perq_opportunities', 'source', 'note'
  ]]);
  return tab;
}

function ensureOctober14Staff_() {
  var tab = staffingSheet_();
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === '2026-10-14') return;
  }
  var confirmed = 'General Manager confirmation';
  var absent = 'Confirmed not working. No daily PERQ row. A missing opportunity count was not treated as zero and was not the reason for this status.';
  [
    ['2026-10-14', 'RDELSO', 'Renzo Del Solar', 'associate', 'yes', 'no', '', 4, confirmed, 'Confirmed as the only salesperson working. Daily PERQ is 4 opportunities, matching the store PERQ of 4. SNAP written is recorded sales activity, not this staffing record. Store purchasing customers were not assigned to this person.'],
    ['2026-10-14', 'PGANDH', 'Prakash Gandhi', 'associate', 'no', 'no', '', '', confirmed, absent],
    ['2026-10-14', 'EMON0904', 'Eric Montes Rodriguez', 'associate', 'no', 'no', '', '', confirmed, absent],
    ['2026-10-14', 'TNASSI', 'Ricky Nassif', 'associate', 'no', 'no', '', '', confirmed, absent],
    ['2026-10-14', '', 'Brenda Sanchez', 'associate', 'no', 'no', '', '', confirmed, absent],
  ].forEach(function (row) { tab.appendRow(row); });
}

function readStaffing_(date) {
  try { ensureOctober14Staff_(); } catch (error) { return []; }
  return sheet_('CC_Staffing').filter(function (row) { return isoDate_(row.date) === date; }).map(function (row) {
    var worked = String(row.worked || '').trim().toLowerCase();
    return {
      name: String(row.display_name || row.name || ''),
      role: staffRole_(row.role),
      worked: worked === 'yes' ? true : (worked === 'no' ? false : null),
      onLeave: /^(yes|y|leave)$/i.test(String(row.on_leave || '')),
      perqOpportunities: fineNumber_(row.perq_opportunities),
    };
  });
}

function staffingNote_(date, lines) {
  var working = lines.filter(function (line) { return line.worked === true && line.role === 'associate' && !line.onLeave; });
  var off = lines.filter(function (line) { return line.worked === false && line.role === 'associate' && !line.onLeave; });
  if (!working.length) return '';
  var note = 'Confirmed staff working ' + date + ': ' + working.map(function (line) { return line.name; }).join(', ') + (working.length === 1 ? ' only.' : '.');
  if (off.length === 1) note += ' ' + off[0].name + ' was confirmed not working.';
  else if (off.length > 1) note += ' ' + off.slice(0, -1).map(function (line) { return line.name; }).join(', ') + ', and ' + off[off.length - 1].name + ' were confirmed not working.';
  var handled = working.filter(function (line) { return line.perqOpportunities !== null && line.perqOpportunities > 0; });
  if (handled.length) {
    note += ' Daily PERQ shows ' + handled.map(function (line) {
      return line.name + ' handled ' + line.perqOpportunities + (line.perqOpportunities === 1 ? ' opportunity' : ' opportunities');
    }).join(', ') + '.';
  }
  note += ' A missing daily PERQ count is not zero and is not an absence.';
  note += ' Recorded sales activity is separate from confirmed staffing.';
  note += ' Store purchasing customers were not assigned to a salesperson.';
  return note;
}

function eligibleAssociate_(line) {
  return line.worked === true && line.role === 'associate' && !line.onLeave && !managementName_(line.name);
}

/** One day's SNAP Written by salesperson. With the day's SNAP report on file, a salesperson without a line wrote 0. */
function snapWrittenOn_(date) {
  var lines = snapAssociateLines_(date, date);
  var reported = lines.order.length > 0 || dailyFacts_().some(function (row) { return row.date === date && row.snapWritten !== null; });
  return {
    reported: reported,
    amountFor: function (name) {
      var aliases = personAliases_(name);
      var total = 0;
      lines.order.forEach(function (key) {
        var line = lines.byDay[key];
        if (line.name === name || aliases.indexOf(line.name.toLowerCase()) !== -1) total += line.amount;
      });
      return Math.round(total * 100) / 100;
    },
  };
}

function morningWinners_(lines, goal, snap) {
  if (!lines.length) return { status: 'pending', reason: 'Yesterday\'s working roster is not on file.', share: null, people: [] };
  if (goal === null) return { status: 'pending', reason: 'Yesterday\'s saved written goal is not on file.', share: null, people: [] };
  if (lines.some(function (line) { return line.worked === null; })) {
    return { status: 'pending', reason: 'Yesterday\'s working roster is incomplete.', share: null, people: [] };
  }
  if (lines.some(function (line) { return line.worked === true && (line.role === '' || line.role === 'unknown'); })) {
    return { status: 'pending', reason: 'Yesterday\'s staffing roles are incomplete.', share: null, people: [] };
  }
  var eligible = lines.filter(eligibleAssociate_);
  if (!eligible.length) return { status: 'pending', reason: 'No eligible salesperson is marked as worked.', share: null, people: [] };
  if (!snap || !snap.reported) {
    return { status: 'pending', reason: 'Yesterday\'s SNAP Written by salesperson is not on file.', share: null, people: [] };
  }
  var share = Math.round((goal / eligible.length) * 100) / 100;
  var people = [];
  eligible.forEach(function (line) {
    var written = snap.amountFor(line.name);
    if (written <= share) return;
    people.push({
      name: line.name,
      written: written,
      share: share,
      above: Math.round((written - share) * 100) / 100,
    });
  });
  return { status: 'ready', reason: '', share: share, people: people };
}

function workedCount_(lines) {
  if (!lines.length || lines.some(function (line) { return line.worked === null; })) return null;
  var count = 0;
  lines.forEach(function (line) {
    if (eligibleAssociate_(line)) count += 1;
  });
  return count > 0 ? count : null;
}

function morningClosing_(view, yesterday, goal) {
  function pack(day, scope) {
    return {
      value: day.ratio,
      scope: scope,
      date: day.date,
      period: '',
      goal: goal,
      customers: day.customers,
      opportunities: day.opportunities,
      reconcile: day.ratio !== null && day.ratio > 1,
    };
  }
  var days = view ? view.days : [];
  var complete = days.filter(function (day) { return day.customers !== null && day.opportunities !== null; });
  var yesterdayRow = complete.filter(function (day) { return day.date === yesterday; })[0];
  if (yesterdayRow) return pack(yesterdayRow, 'yesterday');
  if (!complete.length) return { value: null, scope: 'none', date: '', period: '', goal: goal, customers: null, opportunities: null, reconcile: false };
  return pack(complete[complete.length - 1], 'latest-daily');
}

function morningBeddingSide_(yesterday, side, homeValue, ledgerRow, goal, dailyMap) {
  dailyMap = dailyMap || {};
  var yesterdayRow = dailyMap[yesterday];
  var yesterdayValue = yesterdayRow ? yesterdayRow[side] : null;
  if (yesterdayValue !== null && yesterdayValue !== undefined) {
    return { value: yesterdayValue, scope: 'yesterday', date: yesterday, period: '', goal: goal };
  }
  var latest = '';
  Object.keys(dailyMap).sort().forEach(function (date) {
    var row = dailyMap[date];
    if (row[side] !== null && row[side] !== undefined) latest = date;
  });
  if (latest) return { value: dailyMap[latest][side], scope: 'latest-daily', date: latest, period: '', goal: goal };
  var value = homeValue !== null && homeValue !== undefined ? homeValue : (ledgerRow ? ledgerRow.percent : null);
  if (value === null || value === undefined) return { value: null, scope: 'none', date: '', period: '', goal: goal };
  return {
    value: value,
    scope: 'mtd',
    date: ledgerRow && ledgerRow.verifiedThrough ? ledgerRow.verifiedThrough : '',
    period: ledgerRow && ledgerRow.periodStart ? ledgerRow.periodStart + ' through ' + ledgerRow.periodEnd : '',
    goal: goal,
  };
}

function morning_(payload) {
  var home = home_(payload);
  try { ensureMorningPromotion_(); } catch (error) { appendException_('Update Failed', 'The morning promotion could not be saved.'); }
  var promotion = null;
  try { promotion = readPromotion_(); } catch (error) { promotion = null; }
  if (!promotion) promotion = anniversaryPromotion_();
  var yesterday = home.yesterday.date;
  var closingFigure = { value: null, scope: 'none', date: '', period: '', goal: home.closing.goal, customers: null, opportunities: null, reconcile: false };
  var homeBedding = { written: null, delivered: null, goal: 0.2 };
  (home.board && home.board.kpis ? home.board.kpis : []).forEach(function (row) {
    if (row.name === 'Bedding') homeBedding = row;
  });
  var beddingGoal = homeBedding.goal === null || homeBedding.goal === undefined ? 0.2 : homeBedding.goal;
  var beddingWritten = { value: null, scope: 'none', date: '', period: '', goal: beddingGoal };
  var beddingDelivered = { value: null, scope: 'none', date: '', period: '', goal: beddingGoal };
  try {
    closingFigure = morningClosing_(loadClosingView_(), yesterday, home.closing.goal);
    closingFigure.mtd = home.closing && home.closing.mtd ? home.closing.mtd : null;
    var storeStart = storePeriodContaining_(home.today).start;
    var dailyBedding = beddingDailyMap_();
    beddingWritten = morningBeddingSide_(yesterday, 'written', homeBedding.written, storeBeddingLedger_('written', storeStart), beddingGoal, dailyBedding);
    beddingDelivered = morningBeddingSide_(yesterday, 'delivered', homeBedding.delivered, storeBeddingLedger_('delivered', storeStart), beddingGoal, dailyBedding);
  } catch (error) {
    try { appendException_('Update Failed', 'Morning meeting figures could not be read. Last verified totals were left in place.'); } catch (ignore) {}
  }
  var staffing = [];
  var todayStaffing = [];
  try {
    staffing = readStaffing_(yesterday);
    todayStaffing = readStaffing_(home.today);
  } catch (error) {
    staffing = [];
    todayStaffing = [];
  }
  var writtenPerf = home.board.yesterday.written;
  var winners = morningWinners_(staffing, writtenPerf.goal, snapWrittenOn_(yesterday));
  var workedToday = workedCount_(todayStaffing);
  var personalShare = workedToday === null || home.board.today.written === null ? null : Math.round((home.board.today.written / workedToday) * 100) / 100;
  var gaps = [];
  if (home.yesterday.written === null) gaps.push('SNAP written');
  if (home.yesterday.delivered === null) gaps.push('NWDSR delivered');
  if (closingFigure.scope === 'none') gaps.push('closing ratio');
  if (beddingWritten.scope === 'none') gaps.push('written bedding');
  if (beddingDelivered.scope === 'none') gaps.push('delivered bedding');
  if (winners.status === 'pending') gaps.push(winners.reason);
  if (personalShare === null) gaps.push('today\'s working roster');
  if (gaps.length) {
    try { notifyOnce_('Morning meeting for ' + yesterday + ' is waiting on: ' + gaps.join('; ') + '.'); } catch (ignore) {}
  }
  return {
    role: payload.session.role,
    title: 'Morning meeting',
    date: home.today,
    updated: home.updated,
    yesterday: {
      date: yesterday,
      written: writtenPerf,
      delivered: home.board.yesterday.delivered,
      closing: closingFigure,
      beddingWritten: beddingWritten,
      beddingDelivered: beddingDelivered,
    },
    today: {
      written: home.board.today.written,
      delivered: home.board.today.delivered,
      beddingGoal: 0.2,
      closingGoal: home.closing.goal,
      personalShare: personalShare,
    },
    winners: winners,
    staffingNote: staffingNote_(yesterday, staffing),
    promotion: saleOnDate_(promotion, home.today),
    financing: financeOnDate_(promotion, home.today),
    beddingFinance: promotion.beddingFinance || 'Size-based qualifying amounts are not in the approved promotion.',
    reminders: [
      'NO ONE WALKS.',
      'Present maintenance plans.',
      'Review the customer\'s financing and delivery requirements.',
      'Complete the sales order checklist.',
      'Obtain required manager reviews.',
    ],
    editor: payload.session.role === 'admin' ? promotion : null,
  };
}

function promoLines_(value) {
  return String(value || '').split(/\n/).map(function (line) { return line.trim(); }).filter(function (line) { return line; });
}

function savePromotion_(payload) {
  var featured = promoLines_(payload.featured).map(function (line) {
    var parts = line.split('|');
    if (parts.length < 5) throw new Error('Each featured item needs name, was, now, save, and off, separated by |.');
    return {
      name: parts[0].trim(),
      was: Number(parts[1]),
      now: Number(parts[2]),
      save: Number(parts[3]),
      off: parts.slice(4).join('|').trim(),
    };
  });
  var financing = promoLines_(payload.financing).map(function (line) {
    var parts = line.split('|');
    if (parts.length < 4) throw new Error('Each financing line needs months, end date, 0% yes or no, and the summary.');
    var months = Number(parts[0]);
    var end = String(parts[1] || '').trim();
    var zero = /^y/i.test(parts[2].trim());
    var summary = parts.slice(3).join('|').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error('Financing end dates use YYYY-MM-DD.');
    if ((/(^|[^0-9.])0\s*%/.test(summary)) !== zero) throw new Error('Mark 0% only when the approved source says so.');
    if (months === 72 || months === 36 || months === 50) throw new Error('That term is not on the approved sheet.');
    return { months: months, end: end, zeroInterest: zero, highlight: months === 78, summary: summary };
  }).sort(function (left, right) { return left.months - right.months; });
  var promotion = {
    name: String(payload.name || '').trim(),
    start: String(payload.start || '').trim(),
    end: String(payload.end || '').trim(),
    approved: payload.approved ? 'yes' : 'no',
    highlights: promoLines_(payload.highlights),
    featured: featured,
    floorNote: String(payload.floorNote || '').trim(),
    mattressName: String(payload.mattressName || '').trim(),
    mattressOff: String(payload.mattressOff || '').trim(),
    mattressLines: promoLines_(payload.mattressLines),
    mattressNote: String(payload.mattressNote || '').trim(),
    exclusions: promoLines_(payload.exclusions),
    beddingFinance: String(payload.beddingFinance || '').trim(),
    financing: financing,
  };
  if (!promotion.name || !/^\d{4}-\d{2}-\d{2}$/.test(promotion.start) || !/^\d{4}-\d{2}-\d{2}$/.test(promotion.end)) {
    throw new Error('The promotion needs a name and YYYY-MM-DD dates.');
  }
  var tab = promoSheet_();
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === 'current') {
      tab.getRange(r + 1, 2).setValue(JSON.stringify(promotion));
      return morning_(payload);
    }
  }
  tab.appendRow(['current', JSON.stringify(promotion)]);
  return morning_(payload);
}

function health_(payload) {
  var facts = dailyFacts_();
  var yesterday = shiftDate_(todayNy_(), -1);
  var row = facts.filter(function (item) { return item.date === yesterday; })[0];
  var current = row && row.snapWritten !== null && row.nwdsrDelivered !== null;
  var rows = sheet_('CC_Health').map(function (item) {
    var key = String(item.key);
    var value = key === 'status' ? (current ? 'Current' : 'Report Missing') : String(item.value);
    return { key: key, value: value };
  });
  if (!rows.some(function (item) { return item.key === 'status'; })) rows.unshift({ key: 'status', value: current ? 'Current' : 'Report Missing' });
  var exceptions = sheet_('CC_Exceptions').filter(function (item) {
    return !/flagged for review/i.test(String(item.message || ''));
  }).slice(-12).map(function (item) {
    return { at: String(item.at || ''), severity: String(item.severity || ''), message: String(item.message || '') };
  });
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    rows: rows,
    exceptions: exceptions,
    imports: sheet_('CC_Imports').slice(-12).map(function (item) {
      return { file: String(item.file_name || item.sha256 || ''), status: String(item.status || ''), note: String(item.note || '') };
    }),
  };
}

function healthValue_(key) {
  var match = sheet_('CC_Health').filter(function (row) { return String(row.key) === key; })[0];
  return match ? String(match.value) : '';
}
