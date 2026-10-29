var BOOK_ = null;

/** One spreadsheet handle per server call: every openById is a round trip to Sheets. */
function book_() {
  if (!BOOK_) BOOK_ = SpreadsheetApp.openById(SPREADSHEET_ID_);
  return BOOK_;
}

var READ_MEMO_ = null;
// Pages write these while they draw (saved daily goals, replaced rows, the log, alerts), so they are always read fresh.
var READ_MEMO_SKIP_ = { CC_DailyGoals: true, CC_History: true, CC_Exceptions: true, CC_Health: true };

/** A read-only request reads each tab once. Off by default, so imports and saves always read what they just wrote. */
function beginPageRead_() {
  READ_MEMO_ = {};
}

function endPageRead_() {
  READ_MEMO_ = null;
}

/** Called by every function that writes a tab, so a read later in the same request sees the write. */
function forgetRead_(name) {
  if (READ_MEMO_) delete READ_MEMO_[name];
}

function sheetValues_(name) {
  var memo = READ_MEMO_ && !READ_MEMO_SKIP_[name];
  if (memo && Object.prototype.hasOwnProperty.call(READ_MEMO_, name)) return READ_MEMO_[name];
  var tab = book_().getSheetByName(name);
  var values = tab ? tab.getDataRange().getValues() : null;
  if (memo) READ_MEMO_[name] = values;
  return values;
}

function sheet_(name) {
  var values = sheetValues_(name);
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

/** The store-month written and delivered budgets. A month key such as written_goal_2026-11 overrides the standing goal. */
function storeSalesGoals_(config, store) {
  var writtenGoal = goalForMonth_(config, store, 'written_goal');
  var deliveredGoal = goalForMonth_(config, store, 'delivered_goal');
  if (writtenGoal === null && store.start === '2026-10-02' && store.end === '2026-11-01') writtenGoal = 400000;
  if (deliveredGoal === null && store.start === '2026-10-02' && store.end === '2026-11-01') deliveredGoal = 320000;
  return { written: writtenGoal, delivered: deliveredGoal };
}

function refreshRollup_() {
  forgetRead_('CC_Rollup');
  var config = config_();
  var store = storePeriodContaining_(todayNy_());
  var start = store.start;
  var end = store.end;
  var facts = dailyFacts_();
  var budgets = storeSalesGoals_(config, store);
  var writtenGoal = budgets.written;
  var deliveredGoal = budgets.delivered;
  var daysLeft = operatingDaysRemaining_(store, todayNy_(), closedDates_());
  var nwdsrWritten = sumField_(facts, 'nwdsrWritten', start, end);
  var snapWritten = sumField_(facts, 'snapWritten', start, end);
  var nwdsrDelivered = sumField_(facts, 'nwdsrDelivered', start, end);
  var latest = '';
  facts.forEach(function (row) {
    if (row.date < start || row.date > end || row.nwdsrWritten === null) return;
    if (row.date > latest) latest = row.date;
  });
  var writtenPace = pace_(writtenGoal, nwdsrWritten, daysLeft);
  var deliveredPace = pace_(deliveredGoal, nwdsrDelivered, daysLeft);
  var blankIfNull = function (value) { return value === null ? '' : value; };
  var writtenRemaining = blankIfNull(writtenPace.remaining);
  var deliveredRemaining = blankIfNull(deliveredPace.remaining);
  var metrics = {
    nwdsr_written: [blankIfNull(nwdsrWritten), 'Primary written total (' + metricSource_('store_written') + '). Sum of CC_Daily nwdsr_written for the store period ' + start + ' through ' + end + '. Blank cells are skipped.'],
    snap_written: [blankIfNull(snapWritten), 'SNAP Written reconciliation only. Not used for written remaining.'],
    nwdsr_delivered: [blankIfNull(nwdsrDelivered), 'Sum of CC_Daily nwdsr_delivered for the store period ' + start + ' through ' + end + '. Blank cells are skipped.'],
    written_remaining: [writtenRemaining, 'Written goal minus NWDSR written. The goal itself is not changed.'],
    delivered_remaining: [deliveredRemaining, 'Delivered goal minus NWDSR delivered. The goal itself is not changed.'],
    written_pace: [blankIfNull(writtenPace.pace), 'Today\'s written goal on Home: written remaining ÷ ' + (daysLeft === null ? 'open days left' : daysLeft + ' open days left') + ' including today.'],
    delivered_pace: [blankIfNull(deliveredPace.pace), 'Today\'s delivered goal on Home: delivered remaining ÷ ' + (daysLeft === null ? 'open days left' : daysLeft + ' open days left') + ' including today.'],
    verified_through: [latest, 'Latest store-period date with NWDSR written on CC_Daily.'],
  };
  var spreadsheet = book_();
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

/**
 * Management confirms one closed date. The row is for that date only.
 * Another year is not marked closed, including a holiday that fell on a different date.
 */
function confirmStoreClosure_(date, by, note) {
  var iso = isoDate_(date);
  if (!iso) return { status: 'ignored', reason: 'Not a business date' };
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_SellingDays');
  if (!tab) {
    tab = spreadsheet.insertSheet('CC_SellingDays');
    tab.getRange(1, 1, 1, 5).setValues([['date', 'selling', 'confirmed_by', 'confirmed_at', 'note']]);
  }
  var values = tab.getDataRange().getValues();
  var headers = values.length ? values[0].map(function (cell) { return String(cell || '').trim(); }) : ['date', 'selling'];
  if (!headers[0]) headers[0] = 'date';
  if (headers.indexOf('selling') === -1) headers.push('selling');
  ['confirmed_by', 'confirmed_at', 'note'].forEach(function (name) {
    if (headers.indexOf(name) === -1) headers.push(name);
  });
  if (values.length) tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  else tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  var now = new Date().toISOString();
  var who = String(by || 'management');
  var text = String(note || 'Confirmed closed. This date only. Not copied onto another year.');
  var target = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === iso) target = r + 1;
  }
  var previous = target ? values[target - 1].slice() : '';
  var row = headers.map(function () { return ''; });
  row[headers.indexOf('date')] = iso;
  row[headers.indexOf('selling')] = 'closed';
  row[headers.indexOf('confirmed_by')] = who;
  row[headers.indexOf('confirmed_at')] = now;
  row[headers.indexOf('note')] = text;
  if (!target) tab.appendRow(row);
  else tab.getRange(target, 1, 1, headers.length).setValues([row]);
  if (typeof archiveReplaced_ === 'function') archiveReplaced_('CC_SellingDays', iso, previous, who, text);
  forgetRead_('CC_SellingDays');
  return { status: 'confirmed', date: iso, confirmedBy: who, confirmedAt: now };
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
  // The standing written and delivered goals apply to every store month. CC_Config dates do not have to be edited at month end.
  return numberOrNull_(config[key]);
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
    bedding: metricGoal_('kpi_bedding', config),
    mattress: metricGoal_('kpi_protectors', config),
    fabric: metricGoal_('kpi_fabric', config),
    leather: metricGoal_('kpi_leather', config),
    power: metricGoal_('kpi_power', config),
    wood: metricGoal_('kpi_wood', config),
    rugs: metricGoal_('kpi_rugs', config),
    averageTicket: metricGoal_('kpi_average_ticket', config),
    closing: metricGoal_('store_closing', config),
    adjustableBase: metricGoal_('kpi_adjustable_base', config),
    pillow: metricGoal_('kpi_pillows', config),
    powerBase: metricGoal_('kpi_power_base', config),
    finance: metricGoal_('kpi_finance', config),
    warranty: metricGoal_('kpi_warranty', config),
    individualVolume: metricGoal_('person_written', config),
    attachment: metricGoal_('kpi_total_attachment', config),
  };
}

function ratio_(actual, goal) {
  if (actual === null || goal === null || Number(goal) === 0) return null;
  return Math.round((actual / Number(goal)) * 1000) / 1000;
}

function kpiRow_(name, written, delivered, goal, unit, note, reconcile) {
  return { name: name, written: written, delivered: delivered, goal: goal, unit: unit, note: note || '', reconcile: !!reconcile };
}

function activePerson_(row) {
  return rosterRole_(row, todayNy_()) === 'associate';
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

/** A SNAP report is on file for this salesperson month when any associate line or store SNAP total is dated inside it. */
function snapReportedIn_(start, end, lines) {
  if (lines && lines.latest) return true;
  var reported = false;
  dailyFacts_().forEach(function (row) {
    if (row.date >= start && row.date <= end && row.snapWritten !== null) reported = true;
  });
  return reported;
}

/**
 * options.only limits the rows to one salesperson. options.cachedSnap false keeps a person with no lines Pending.
 * The dashboard never reuses the SNAP Written cell on CC_People: that cell is only a copy of the current
 * salesperson month, and a new month must not inherit the previous month's dollars.
 * A filed SNAP report with no line for this person is $0. No report yet is Pending, not zero.
 */
function peopleRows_(individualStart, individualEnd, options) {
  options = options || {};
  var lines = snapAssociateLines_(individualStart, individualEnd);
  var totals = {};
  var days = {};
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    if (line.role === 'management' || line.role === 'unknown' || line.role === 'former') return;
    totals[line.name] = (totals[line.name] || 0) + line.amount;
    if (!days[line.name]) days[line.name] = [];
    days[line.name].push({ date: line.date, snapWritten: line.amount, note: line.note });
  });
  var reported = snapReportedIn_(individualStart, individualEnd, lines);
  var goals = approvedGoals_(config_());
  var closingFacts = loadClosing_();
  var analysis = personAnalysisContext_({ start: individualStart, end: individualEnd });
  var roster = options.only
    ? sheet_('CC_People').filter(function (row) { return String(row.name) === options.only; })
    : sheet_('CC_People').filter(activePerson_);
  var rows = roster.length ? roster.map(function (row) {
    var name = String(row.name);
    var written = Object.prototype.hasOwnProperty.call(totals, name)
      ? Math.round(totals[name] * 100) / 100
      : (options.cachedSnap === false ? null : (reported ? 0 : null));
    return personRecord_(name, written, String(row.role || 'associate'), days[name] || [], goals, personClosing_(closingFacts, name, individualStart, individualEnd, goals.closing, analysis.ledger), personAnalysis_(analysis, name));
  }) : Object.keys(totals).map(function (name) {
    return personRecord_(name, Math.round(totals[name] * 100) / 100, 'associate', days[name] || [], goals, personClosing_(closingFacts, name, individualStart, individualEnd, goals.closing, analysis.ledger), personAnalysis_(analysis, name));
  });
  return rows;
}

var PERSON_ANALYSIS_VIEWS_ = ['DA_SALES', 'BEDDING', 'MPPA', 'FABW', 'LTHW', 'PWAR', 'ATTACH', 'FINANCE', 'AVERAGE', 'PILLOWS', 'BASES', 'FP', 'PET', 'RUGS', 'PWRBASE'];
var PERSON_ANALYSIS_SOURCE_ = /DATA_ANALYSIS_KPI_17_/i;

/** Dates whose official store total for this side is verified $0. Those days have no Group 17 salesperson file. */
function verifiedStoreZeroDates_(side) {
  var field = side === 'delivered' ? 'nwdsrDelivered' : 'nwdsrWritten';
  var dates = {};
  dailyFacts_().forEach(function (row) {
    if (row[field] === 0) dates[row.date] = true;
  });
  return dates;
}

/**
 * What the Data Analysis Group 17 reports cover for the salesperson month on one side: the latest salesperson
 * snapshot that starts on the 1st, then each following day whose Group 17 day file is on file. Days inside the
 * snapshot are never added to it. A closed day, or a day whose NWDSR total is verified $0, is not a hole.
 * A later day is not counted across a day that is still missing.
 */
function personAnalysisCoverage_(ledger, side, period, closed) {
  var snapshot = '';
  var dayFiles = {};
  ledger.forEach(function (row) {
    if (row.side !== side || !PERSON_ANALYSIS_SOURCE_.test(row.source)) return;
    if (row.view === 'DA_SALES_PERSON' && row.grain === 'cumulative' && row.fitsTrack && row.periodStart === period.start && row.verifiedThrough <= period.end && row.verifiedThrough > snapshot) snapshot = row.verifiedThrough;
    if (row.view === 'DA_SALES_STORE' && row.grain === 'daily') dayFiles[row.reportDate] = true;
  });
  var zeros = verifiedStoreZeroDates_(side);
  var days = [];
  var zeroDays = [];
  var through = snapshot;
  var cursor = snapshot ? shiftDate_(snapshot, 1) : period.start;
  while (cursor <= period.end) {
    if (dayFiles[cursor]) {
      days.push(cursor);
      through = cursor;
    } else if (closed[cursor]) {
      // The store was closed. There is no file, and the day is not a hole.
    } else if (zeros[cursor]) {
      zeroDays.push(cursor);
      through = cursor;
    } else break;
    cursor = shiftDate_(cursor, 1);
  }
  return { side: side, period: period, snapshot: snapshot, days: days, zeroDays: zeroDays, through: through };
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
  var reported = {};
  PERSON_ANALYSIS_VIEWS_.forEach(function (prefix) { reported[prefix] = false; });
  ledger.forEach(function (row) {
    if (row.scope !== 'PERSON' || row.side !== coverage.side || !PERSON_ANALYSIS_SOURCE_.test(row.source)) return;
    var prefix = row.view.replace(/_PERSON$/, '');
    if (!Object.prototype.hasOwnProperty.call(reported, prefix)) return;
    var inSnapshot = row.grain === 'cumulative' && coverage.snapshot && row.fitsTrack && row.periodStart === coverage.period.start && row.verifiedThrough === coverage.snapshot;
    var inDay = row.grain === 'daily' && coverage.days.indexOf(row.reportDate) !== -1;
    if (inSnapshot || inDay) reported[prefix] = true;
  });
  function counted(prefix) {
    if (!reported[prefix] && (prefix === 'PILLOWS' || prefix === 'BASES' || prefix === 'FP' || prefix === 'PET' || prefix === 'RUGS' || prefix === 'PWRBASE')) {
      return { value: null, detail: '', text: 'Not in report' };
    }
    var eligible = 0;
    var attachments = 0;
    var dollars = 0;
    var qualBlank = false;
    keys.forEach(function (part) {
      var row = parts[prefix][part];
      if (!row) return;
      if (row.eligible === null || row.eligible === undefined) qualBlank = true;
      else eligible += row.eligible;
      attachments += row.attachments || 0;
      dollars += row.sales || 0;
    });
    var round4 = function (value) { return Math.round(value * 10000) / 10000; };
    // Pet qualified quantity is often blank while sold quantity is printed. That is pets sold, not 0%.
    if (prefix === 'PET' && qualBlank) {
      return { value: null, sold: round4(attachments), detail: moneyText_(Math.round(dollars * 100) / 100), text: round4(attachments) + ' sold' };
    }
    return { value: eligible ? Math.round((attachments / eligible) * 1000) / 1000 : null, sold: attachments, detail: attachments + ' of ' + eligible, text: eligible ? '' : 'No qualifying sales' };
  }
  function rugFigure() {
    if (!reported.RUGS) return { value: null, detail: '', text: 'Not in report' };
    var sold = 0;
    var dollars = 0;
    keys.forEach(function (part) {
      var row = parts.RUGS[part];
      if (!row) return;
      sold += row.units || 0;
      dollars += row.sales || 0;
    });
    var round4 = function (value) { return Math.round(value * 10000) / 10000; };
    return { value: round4(sold), detail: moneyText_(Math.round(dollars * 100) / 100), text: '' };
  }
  // Group 17 quantities can be fractional on Delivered, so sums are rounded to 4 places. A covered part with
  // category lines but no Total Attachments line was loaded before that group was kept: the total is not on file.
  function tally(prefix) {
    var qualified = 0;
    var sold = 0;
    var dollars = 0;
    var complete = true;
    keys.forEach(function (part) {
      var row = parts[prefix][part];
      if (!row) {
        if (prefix === 'ATTACH' && ['FABW', 'PWAR', 'LTHW', 'MPPA'].some(function (other) { return parts[other][part] && (parts[other][part].eligible || parts[other][part].attachments); })) complete = false;
        return;
      }
      qualified += row.eligible || 0;
      sold += row.attachments || 0;
      if (dollars !== null) dollars = row.sales === null ? ((row.attachments || 0) === 0 ? dollars : null) : dollars + row.sales;
    });
    var round4 = function (value) { return Math.round(value * 10000) / 10000; };
    return complete ? { qualified: round4(qualified), sold: round4(sold), dollars: dollars === null ? null : Math.round(dollars * 100) / 100 } : null;
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
    pillows: counted('PILLOWS'),
    bases: counted('BASES'),
    protection: counted('FP'),
    pet: counted('PET'),
    rugs: rugFigure(),
    powerBase: reported.PWRBASE ? counted('PWRBASE') : { value: null, detail: '', text: 'Not in report' },
    reported: reported,
    tallies: { fabric: tally('FABW'), leather: tally('LTHW'), power: tally('PWAR'), pads: tally('MPPA'), total: tally('ATTACH'), pillows: reported.PILLOWS ? tally('PILLOWS') : null, bases: reported.BASES ? tally('BASES') : null, protection: reported.FP ? tally('FP') : null, pet: reported.PET ? tally('PET') : null },
    finance: { value: sales && financed !== null ? Math.round((financed / sales) * 1000) / 1000 : null, detail: '', text: sales ? (financed === null ? 'Not on file' : '') : 'No sales' },
    average: { value: orders ? round2(sales / orders) : null, detail: orders === null ? '' : moneyText_(sales) + ' ÷ ' + orders + ' orders', text: orders === 0 ? 'No orders' : (orders === null ? 'Not on file' : '') },
  };
}

function personAnalysis_(context, name) {
  return { written: personAnalysisSide_(context.ledger, name, context.written), delivered: personAnalysisSide_(context.ledger, name, context.delivered) };
}

var ATTACHMENT_CATEGORIES_ = [
  { key: 'fabric', name: 'Fabric', source: 'FABRIC', goal: 'fabric' },
  { key: 'leather', name: 'Leather', source: 'LEATHER', goal: 'leather' },
  { key: 'power', name: 'Power Upholstery', source: 'POWER FURNITURE', goal: 'power' },
  { key: 'pads', name: 'Mattress Protectors (Pads)', source: 'MATTRESS PADS', goal: 'mattress' },
  { key: 'total', name: 'Total Attachment', source: 'TOTAL ATTACHMENTS', goal: 'attachment' },
];

/**
 * One attachment category from Group 17 quantities. Missed = MAX(0, qualified - sold). Actual = sold ÷ qualified.
 * To hit goal = MAX(0, CEILING(qualified × goal - sold)): the same as CEILING(qualified × goal) - sold for whole
 * quantities, and still whole attachments when Group 17 Delivered prints halves. The difference is rounded to
 * 6 places first so 5 × 0.8 - 4 is 0, not 4.4e-16.
 */
function attachmentLine_(category, tally, goal) {
  var line = { key: category.key, name: category.name, source: 'Group 17 ' + category.source, goal: goal, qualified: null, sold: null, missed: null, actual: null, points: null, needed: null, dollars: null, status: 'pending', flag: '' };
  if (!tally) return line;
  var round4 = function (value) { return Math.round(value * 10000) / 10000; };
  line.qualified = tally.qualified;
  line.sold = tally.sold;
  line.dollars = tally.dollars;
  line.missed = round4(Math.max(0, tally.qualified - tally.sold));
  if (goal !== null) line.needed = Math.max(0, Math.ceil(Math.round((tally.qualified * goal - tally.sold) * 1e6) / 1e6));
  if (tally.sold > tally.qualified) line.flag = 'Sold exceeds qualified. The source figures are kept as printed and flagged for review.';
  if (!tally.qualified) {
    line.status = 'na';
    return line;
  }
  line.actual = Math.round((tally.sold / tally.qualified) * 10000) / 10000;
  if (goal !== null) {
    line.points = Math.round((tally.sold / tally.qualified - goal) * 1000) / 10;
    line.status = tally.sold >= tally.qualified * goal - 1e-9 ? 'at' : 'below';
  } else line.status = 'nogoal';
  return line;
}

/** Written or Delivered attachment scorecard for one salesperson. Written and Delivered are never combined. */
function attachmentSide_(side, goals) {
  var tallies = side ? side.tallies : null;
  var lines = ATTACHMENT_CATEGORIES_.map(function (category) {
    return attachmentLine_(category, tallies ? tallies[category.key] : null, goals[category.goal] === undefined ? null : goals[category.goal]);
  });
  var flags = [];
  var total = lines[4];
  if (tallies && total.qualified !== null && lines.slice(0, 4).every(function (line) { return line.qualified !== null; })) {
    var round4 = function (value) { return Math.round(value * 10000) / 10000; };
    var qualified = round4(lines.slice(0, 4).reduce(function (sum, line) { return sum + line.qualified; }, 0));
    var sold = round4(lines.slice(0, 4).reduce(function (sum, line) { return sum + line.sold; }, 0));
    if (qualified !== total.qualified || sold !== total.sold) {
      flags.push('Group 17 Total Attachments (' + total.sold + ' of ' + total.qualified + ') differs from the four categories (' + sold + ' of ' + qualified + '). Flagged for review.');
    }
  }
  if (tallies && !tallies.total) flags.push('Group 17 Total Attachments is not on file for every report in this range, so the total is Pending.');
  lines.forEach(function (line) { if (line.flag) flags.push(line.name + ': ' + line.flag); });
  return { through: side ? side.through : '', basis: side ? side.basis : '', lines: lines, flags: flags };
}

function personAttachments_(analysis, goals) {
  return { written: attachmentSide_(analysis.written, goals), delivered: attachmentSide_(analysis.delivered, goals) };
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

function reportedKpi_(name, unit, goal, analysis, field, prefix, note) {
  var seen = function (side) { return side && side.reported && side.reported[prefix]; };
  if (!seen(analysis.written) && !seen(analysis.delivered)) return notInReportKpi_(name, unit, goal);
  return analysisKpi_(name, unit, goal, analysis, field, note);
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
    attachments: personAttachments_(analysis, goals),
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
      reportedKpi_('Adjustable Bases', 'percent', goals.adjustableBase, analysis, 'bases', 'BASES', 'Adjustable bases sold ÷ qualified.'),
      reportedKpi_('Pillows', 'percent', goals.pillow, analysis, 'pillows', 'PILLOWS', 'Pillows sold ÷ qualified.'),
      reportedKpi_('Furniture Protection', 'percent', goals.wood, analysis, 'protection', 'FP', 'Furniture protection sold ÷ qualified.'),
      reportedKpi_('Pet Protections', 'percent', null, analysis, 'pet', 'PET', 'Pet protection sold ÷ qualified.'),
      reportedKpi_('Rugs', 'count', goals.rugs, analysis, 'rugs', 'RUGS', 'Rugs sold on the Group 17 report.'),
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
  // Once the quality checks run, missing reports come from the active alerts, which resolve when the report arrives.
  var tracked = typeof alertsTracked_ === 'function' && alertsTracked_();
  if (tracked) {
    items = alertAttention_(activeAlerts_(), role);
  } else {
    var yesterday = shiftDate_(todayNy_(), -1);
    var written = facts.filter(function (row) { return row.date === yesterday; })[0];
    if (!written || written.nwdsrWritten === null) items.push('NWDSR Net Written for ' + yesterday + ' has not arrived. Last verified figures stay in place.');
    if (!written || written.nwdsrDelivered === null) items.push('NWDSR Delivered for ' + yesterday + ' has not arrived.');
    if (!written || written.snapWritten === null) items.push('SNAP Written for ' + yesterday + ' has not arrived. Salesperson written sales and the SNAP reconciliation wait for it.');
  }
  sheet_('CC_Exceptions').slice(-8).forEach(function (row) {
    if (tracked && String(row.severity) === 'Report Missing') return;
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
  forgetRead_('CC_Closing');
  var spreadsheet = book_();
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
    'mukhtar junaid': ['mukhtar junaid', 'mukhtar, junaid', 'junaid, mukhtar', 'jimmy'],
    'filepe chaves': ['filepe chaves', 'felipe chaves', 'chaves felipe', 'chaves, felipe', 'chaves, filepe'],
  };
  var aliases = (table[key] || [key]).slice();
  rosterAliases_(name).forEach(function (alias) { if (aliases.indexOf(alias) === -1) aliases.push(alias); });
  return aliases;
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
    var addedDays = [];
    var complete = true;
    eachDate_(shiftDate_(bases[b].through, 1), date).forEach(function (day) {
      if (!complete || closed[day]) return;
      if (!Object.prototype.hasOwnProperty.call(daily, day)) {
        complete = false;
        return;
      }
      total += daily[day];
      added.push(day + ' ' + daily[day]);
      addedDays.push(day);
    });
    if (!complete) continue;
    var parts = [];
    if (!bases[b].daily) parts.push(bases[b].total + ' for ' + start + ' through ' + bases[b].through);
    if (added.length) parts.push((bases[b].daily ? 'daily ' : 'plus daily ') + added.join(', '));
    return { total: total, source: parts.join(' ') || 'none', base: bases[b].daily ? null : { through: bases[b].through, total: bases[b].total }, days: addedDays };
  }
  return null;
}

/**
 * Daily PERQ opportunities for one salesperson. A day with any salesperson export counts 0 for everyone that export
 * does not name, and a listed 0 stays 0. A day off or a zero day does not stop the month. The store total does not
 * have to match the named rows. An opportunity the store export did not assign is not given to anyone. A day with no
 * salesperson export stays unknown. Two different counts for the same person on the same day stay unknown.
 */
function personDailyOpportunities_(facts, name) {
  var map = dailyCountMap_(facts, 'person', name, 'opportunities');
  var covered = {};
  var own = {};
  facts.forEach(function (row) {
    if (row.scope !== 'person' || row.start !== row.end || row.opportunities === null) return;
    covered[row.start] = true;
    if (!rowMatchesPerson_(row, name)) return;
    if (row.opportunityConflict || (Object.prototype.hasOwnProperty.call(own, row.start) && own[row.start] !== row.opportunities)) own[row.start] = null;
    else if (own[row.start] !== null) own[row.start] = row.opportunities;
  });
  Object.keys(covered).forEach(function (date) {
    if (own[date] === null || Object.prototype.hasOwnProperty.call(map, date)) return;
    map[date] = 0;
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
  var values = sheetValues_('CC_ClosingDaily');
  var summaryValues = sheetValues_('CC_ClosingMTD');
  if (!values || !summaryValues) return null;
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
  summaryValues.slice(1).forEach(function (row) { summary[String(row[0] || '').trim()] = row[1]; });
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

function homeWeekTargets_(store, today, closed, facts, writtenGoal, deliveredGoal, savedGoals) {
  var weekday = reportWeekday_(today);
  var monday = shiftDate_(today, weekday === 0 ? -6 : 1 - weekday);
  var sunday = shiftDate_(monday, 6);
  var written = 0;
  var delivered = 0;
  var days = 0;
  eachDate_(monday, sunday).forEach(function (date) {
    if (date < store.start || date > store.end || closed[date]) return;
    var daysLeft = operatingDaysRemaining_(store, date, closed);
    var saved = savedGoals[date] || {};
    var dayWritten = saved.written !== undefined && saved.written !== null ? saved.written : savedPace_(writtenGoal, sumBefore_(facts, 'nwdsrWritten', store.start, date), daysLeft);
    var dayDelivered = saved.delivered !== undefined && saved.delivered !== null ? saved.delivered : savedPace_(deliveredGoal, sumBefore_(facts, 'nwdsrDelivered', store.start, date), daysLeft);
    if (dayWritten === null || dayDelivered === null) return;
    written += dayWritten;
    delivered += dayDelivered;
    days += 1;
  });
  return {
    start: monday,
    end: sunday,
    days: days,
    written: days ? Math.round(written * 100) / 100 : null,
    delivered: days ? Math.round(delivered * 100) / 100 : null,
  };
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
  forgetRead_('CC_Config');
  var tab = book_().getSheetByName('CC_Config');
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
    ['Overall Warranty % of Sales', null, null, 'NWDSR Written WARR PCT is printed per report, rounded to 0.1%. No verified store-period figure yet, so it is not shown on Home.'],
    ['Fabric Maintenance', 0.587, 0.941, ''],
    ['Leather Maintenance', 0.6, 0.765, ''],
    ['Power Upholstery', 0.75, 0.857, ''],
    ['Power Adjustable Base', null, null, 'ASL ADJ PWR % is blank for Store 17. Kept with the Adjustable Base Attachment tile, not shown as its own tile.'],
    ['Wood Kits', null, null, 'No UVWL wood kits column.'],
    ['Finance', 0.233, 0.443, ''],
    ['Average Ticket', 2040.52, 1257.71, ''],
    ['Rugs', 7, 3, ''],
  ];
}

function kpiSheet_() {
  forgetRead_('CC_Kpi');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_Kpi');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Kpi');
  tab.getRange(1, 1, 1, 7).setValues([['metric', 'written', 'delivered', 'note', 'period_start', 'period_end', 'verified_through']]);
  return tab;
}

function ensureKpiActuals_() {
  var values = sheetValues_('CC_Kpi') || [];
  var present = {};
  var r;
  for (r = 1; r < values.length; r += 1) present[String(values[r][0])] = true;
  var missing = kpiActuals_().filter(function (row) { return !present[row[0]]; });
  if (!missing.length) return;
  var tab = kpiSheet_();
  missing.forEach(function (row) {
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

/**
 * Home MTD KPI tiles in display order: four primary tiles, then the secondary group.
 * [display name, CC_Kpi metric, unit, goal, tier, detail]. Warranty % of Sales is listed only when CC_Kpi holds a
 * verified store-period figure: a single day's NWDSR WARR PCT is not a month-to-date result.
 * ADJ PWR % stays on the CC_Kpi 'Power Adjustable Base' row and is shown on the Adjustable Base tile when printed.
 */
function homeKpiSpecs_(goals, actuals) {
  var specs = [
    ['Bedding', 'Bedding', 'percent', goals.bedding, 'primary', ''],
    ['Closing Ratio', 'Closing Ratio', 'percent', goals.closing, 'primary', ''],
    ['Average Ticket', 'Average Ticket', 'dollars', goals.averageTicket, 'primary', ''],
    ['Rugs', 'Rugs', 'count', goals.rugs, 'primary', ''],
    ['Fabric Maintenance', 'Fabric Maintenance', 'percent', goals.fabric, 'secondary', ''],
    ['Leather Maintenance', 'Leather Maintenance', 'percent', goals.leather, 'secondary', ''],
    ['Power Upholstery', 'Power Upholstery', 'percent', goals.power, 'secondary', ''],
    ['Mattress Protectors', 'Mattress Protectors', 'percent', goals.mattress, 'secondary', ''],
    ['Total Attachment', 'Total Attachment', 'percent', goals.attachment, 'secondary', ''],
    ['Adjustable Base Attachment', 'Adjustable Base Attachment', 'percent', goals.adjustableBase, 'secondary', ''],
    ['Pillows', 'Pillows', 'percent', goals.pillow, 'secondary', ''],
    ['Wood / Furniture Protection', 'Wood / Furniture Protection', 'percent', goals.wood, 'secondary', ''],
    ['Financing', 'Finance', 'percent', goals.finance, 'secondary', ''],
  ];
  var warranty = actuals['Overall Warranty % of Sales'];
  if (warranty && warranty.written !== null && warranty.written !== undefined && warranty.through) {
    specs.push(['Warranty % of Sales', 'Overall Warranty % of Sales', 'percent', goals.warranty, 'secondary', '']);
  }
  var pet = actuals['Pet Protections'];
  if (pet && pet.through && (pet.written !== null || pet.delivered !== null)) {
    var petUnit = /qualified quantity was blank/i.test(String(pet.note || '')) ? 'count' : 'percent';
    specs.push(['Pet Protections', 'Pet Protections', petUnit, null, 'secondary', '']);
  }
  return specs;
}

function latestFactDate_(facts, field, start, end, today) {
  var latest = '';
  facts.forEach(function (row) {
    if (!row.date || row.date < start || row.date > end || row.date >= today) return;
    if (row[field] === null || row[field] === undefined) return;
    if (row.date > latest) latest = row.date;
  });
  return latest;
}

function factAmount_(facts, date, field) {
  var amount = null;
  facts.forEach(function (row) {
    if (row.date === date) amount = row[field];
  });
  return amount;
}

/** Written and delivered Data Analysis coverage, from the same store-KPI coverage the refresh uses. */
function analysisCoverageThrough_(period, today) {
  var coverage = { group17: { written: '', delivered: '' }, asl: { written: '', delivered: '' } };
  if (typeof storeKpiCoverage_ !== 'function' || typeof ledgerRows_ !== 'function') return coverage;
  try {
    var ledger = ledgerRows_();
    var facts = {};
    dailyFacts_().forEach(function (row) { facts[row.date] = row; });
    var closed = closedDates_();
    ['group17', 'asl'].forEach(function (family) {
      var written = storeKpiCoverage_(ledger, family, 'written', period, facts, closed, today);
      var delivered = storeKpiCoverage_(ledger, family, 'delivered', period, facts, closed, today);
      coverage[family] = { written: written.through || '', delivered: delivered.through || '' };
    });
  } catch (error) {
    try { appendException_('Update Failed', 'Data Analysis verified-through dates could not be read. Stored KPI figures were left in place.'); } catch (ignore) {}
  }
  return coverage;
}

/**
 * Open days that are only partly verified. A day with NWDSR Written on file is not treated as missing.
 * PERQ stays pending after the closing ratio's verified-through date.
 */
function pendingSourceReports_(facts, period, today, closed, closingThrough) {
  var pending = [];
  var yesterday = shiftDate_(today, -1);
  if (yesterday < period.start) return pending;
  eachDate_(period.start, yesterday).forEach(function (date) {
    if (closed[date]) return;
    var fact = null;
    facts.forEach(function (row) { if (row.date === date) fact = row; });
    var reports = [];
    if (!fact || fact.nwdsrWritten === null) reports.push('NWDSR Written');
    if (!fact || fact.snapWritten === null) reports.push('SNAP Written');
    if (!fact || fact.nwdsrDelivered === null) reports.push('NWDSR Delivered');
    if (closingThrough && date > closingThrough) reports.push('PERQ');
    if (!reports.length) return;
    var anyOnFile = !!(fact && (fact.nwdsrWritten !== null || fact.snapWritten !== null || fact.nwdsrDelivered !== null));
    if (!anyOnFile && date !== yesterday) return;
    pending.push({ date: date, reports: reports });
  });
  return pending;
}

function homeKpiFamily_(name) {
  if (name === 'Rugs' || name === 'Adjustable Base Attachment' || name === 'Pillows' || name === 'Pet Protections' || name === 'Wood / Furniture Protection') return 'asl';
  return 'group17';
}

function homeKpiStrip_(goals, actuals, closing, analysis) {
  return homeKpiSpecs_(goals, actuals).map(function (spec) {
    var name = spec[0];
    var tier = spec[4];
    if (name === 'Closing Ratio') {
      var dailyDetail = closing.latest && closing.latest.ratio !== null
        ? closing.latest.date + ' daily: ' + closing.latest.customers + ' ÷ ' + closing.latest.opportunities + ' = ' + percentText_(closing.latest.ratio)
        : '';
      return {
        name: name,
        tier: tier,
        unit: spec[2],
        goal: spec[3],
        written: closing.ratio,
        delivered: null,
        through: closing.ratio !== null ? (closing.through || '') : '',
        writtenThrough: closing.ratio !== null ? (closing.through || '') : '',
        deliveredThrough: '',
        detail: closing.ratio !== null && closing.customers !== null && closing.opportunities !== null
          ? closing.customers + ' customers ÷ ' + closing.opportunities + ' opportunities'
          : dailyDetail,
        note: closing.ratio !== null ? '' : (closing.gap || closing.note || ''),
        reconcile: !!closing.reconcile,
      };
    }
    var row = actuals[spec[1]] || { written: null, delivered: null, note: '' };
    var detail = spec[5];
    var powerBase = actuals['Power Adjustable Base'];
    if (name === 'Adjustable Base Attachment' && powerBase && (powerBase.written !== null || powerBase.delivered !== null)) {
      detail = 'ADJ PWR % written ' + (powerBase.written === null ? 'Pending' : percentText_(powerBase.written)) + ', delivered ' + (powerBase.delivered === null ? 'Pending' : percentText_(powerBase.delivered));
    }
    if (name === 'Pet Protections' && spec[2] === 'count') {
      detail = 'Pets sold. Qualified quantity was blank on the report, so this is not an attachment percent.';
    }
    var family = analysis && analysis[homeKpiFamily_(name)];
    var writtenThrough = family ? (family.written || '') : (row.through || '');
    var deliveredThrough = family ? (family.delivered || '') : (row.through || '');
    return {
      name: name,
      tier: tier,
      unit: spec[2],
      goal: spec[3],
      written: row.written,
      delivered: row.delivered,
      through: row.through || writtenThrough || deliveredThrough || '',
      writtenThrough: writtenThrough,
      deliveredThrough: deliveredThrough,
      detail: detail,
      note: row.note || '',
      reconcile: false,
    };
  });
}

var DAILY_GOAL_HEADERS_ = ['date', 'written_goal', 'delivered_goal', 'days_left', 'written_basis'];

function dailyGoalSheet_() {
  forgetRead_('CC_DailyGoals');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_DailyGoals');
  if (!tab) tab = spreadsheet.insertSheet('CC_DailyGoals');
  if (String(tab.getRange(1, 5).getValue() || '') !== DAILY_GOAL_HEADERS_[4]) tab.getRange(1, 1, 1, DAILY_GOAL_HEADERS_.length).setValues([DAILY_GOAL_HEADERS_]);
  return tab;
}

/** A saved written goal counts only when it was worked out from the approved store written source. */
function readSavedDailyGoals_() {
  var map = {};
  var basis = metricSource_('store_written_daily_goal');
  sheet_('CC_DailyGoals').forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date) return;
    map[date] = { written: String(row.written_basis || '') === basis ? fineNumber_(row.written_goal) : null, delivered: fineNumber_(row.delivered_goal) };
  });
  return map;
}

/**
 * Saves a past day's goal once. A written goal saved on another basis (the older SNAP Written goals) is recalculated
 * from NWDSR Net Written; the row it replaces is kept on CC_History.
 */
function upsertDailyGoal_(date, written, delivered, daysLeft) {
  if (written === null && delivered === null) return;
  var basis = metricSource_('store_written_daily_goal');
  var tab = dailyGoalSheet_();
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) !== date) continue;
    var savedBlank = values[r][1] === '' || values[r][1] === null;
    if (written !== null && (savedBlank || String(values[r][4] || '') !== basis)) {
      if (!savedBlank && fineNumber_(values[r][1]) !== written) {
        archiveReplaced_('CC_DailyGoals', date, values[r], 'written_goal ' + written + ' (' + basis + ')', 'Store written is ' + basis + '. This written goal was worked out from SNAP Written and was recalculated from ' + basis + '.');
      }
      tab.getRange(r + 1, 2).setValue(written);
      tab.getRange(r + 1, 5).setValue(basis);
    }
    if ((values[r][2] === '' || values[r][2] === null) && delivered !== null) tab.getRange(r + 1, 3).setValue(delivered);
    return;
  }
  tab.appendRow([date, written === null ? '' : written, delivered === null ? '' : delivered, daysLeft, written === null ? '' : basis]);
}

/** upsertDailyGoal_ would write: no saved row, a written goal blank or on another basis, or a blank delivered goal. */
function dailyGoalNeedsSave_(saved, written, delivered, basis) {
  if (written === null && delivered === null) return false;
  if (!saved) return true;
  if (written !== null && (saved[1] === '' || saved[1] === null || String(saved[4] || '') !== basis)) return true;
  return delivered !== null && (saved[2] === '' || saved[2] === null);
}

/**
 * Pages load in parallel; the lock keeps two of them from re-basing (and archiving) the same saved row twice. The
 * saved goals are read once, and the lock is taken only when a day still has to be saved.
 */
function ensureSavedDailyGoals_(period, today, closed, facts, writtenBudget, deliveredBudget) {
  var basis = metricSource_('store_written_daily_goal');
  var saved = {};
  (sheetValues_('CC_DailyGoals') || []).slice(1).forEach(function (row) {
    var date = isoDate_(row[0]);
    if (date && !saved[date]) saved[date] = row;
  });
  var due = [];
  eachDate_(period.start, period.end).forEach(function (date) {
    if (date >= today || closed[date]) return;
    var daysLeft = operatingDaysRemaining_(period, date, closed);
    var written = savedPace_(writtenBudget, sumBefore_(facts, 'nwdsrWritten', period.start, date), daysLeft);
    var delivered = savedPace_(deliveredBudget, sumBefore_(facts, 'nwdsrDelivered', period.start, date), daysLeft);
    if (dailyGoalNeedsSave_(saved[date], written, delivered, basis)) due.push([date, written, delivered, daysLeft]);
  });
  if (!due.length) return;
  var lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(10000)) return;
  try {
    due.forEach(function (day) { upsertDailyGoal_(day[0], day[1], day[2], day[3]); });
  } finally {
    if (lock) lock.releaseLock();
  }
}

/**
 * Cumulative store-month chart. NWDSR Written is this year's store sales. SNAP Written last year is the
 * same day-for-day partner inside the confirmed prior period. A missing day is a gap, not zero, and a
 * last-year day that is not on file is left off rather than drawn.
 */
function homeChart_(facts, days, store, today, config) {
  var ly = { confirmed: false, start: '', end: '', status: 'Pending' };
  try { ly = storeLastYear_(config, store); } catch (error) { ly = ly; }
  var byDate = {};
  facts.forEach(function (row) { byDate[row.date] = row; });
  var running = 0;
  var lyRunning = 0;
  return days.map(function (day) {
    var daily = day.nwdsrWritten;
    var cumulative = null;
    if (day.date < today && daily !== null && daily !== undefined && daily !== '') {
      running += Number(daily);
      cumulative = Math.round(running * 100) / 100;
    }
    var snapLy = null;
    if (ly.confirmed && day.date < today && !day.closed) {
      var mapped = shiftDate_(ly.start, historyDayGap_(store.start, day.date));
      var lyAmount = null;
      if (mapped && mapped <= ly.end) {
        var hist = typeof historicalAmount_ === 'function' ? historicalAmount_('SNAP Written', mapped) : null;
        if (hist && hist.dollars !== null && hist.dollars !== undefined) lyAmount = Number(hist.dollars);
        if (lyAmount === null) {
          var lyRow = byDate[mapped];
          if (lyRow && lyRow.snapWritten !== null && lyRow.snapWritten !== undefined && lyRow.snapWritten !== '') lyAmount = Number(lyRow.snapWritten);
        }
      }
      if (lyAmount !== null) {
        lyRunning += lyAmount;
        snapLy = Math.round(lyRunning * 100) / 100;
      }
    }
    return {
      date: day.date,
      written: cumulative,
      dailyWritten: day.date < today ? daily : null,
      snapLy: snapLy,
      closed: !!day.closed,
      lyConfirmed: !!ly.confirmed,
    };
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
  var written = sumField_(facts, 'nwdsrWritten', start, end);
  var snap = sumField_(facts, 'snapWritten', start, end);
  var delivered = sumField_(facts, 'nwdsrDelivered', start, end);
  var budgets = storeSalesGoals_(config, store);
  var writtenGoal = budgets.written;
  var deliveredGoal = budgets.delivered;
  var stretchWritten = goalOr_(config, 'stretch_written', null);
  var stretchDelivered = goalOr_(config, 'stretch_delivered', null);
  var daysLeft = operatingDaysRemaining_(store, today, closed);
  var writtenPace = pace_(writtenGoal, written, daysLeft);
  var deliveredPace = pace_(deliveredGoal, delivered, daysLeft);
  var yesterdayRow = facts.filter(function (row) { return row.date === yesterday; })[0] || null;
  var yesterdayWritten = yesterdayRow ? yesterdayRow.nwdsrWritten : null;
  var yesterdaySnap = yesterdayRow ? yesterdayRow.snapWritten : null;
  var latest = facts.filter(function (row) { return row.nwdsrWritten !== null && row.date >= start && row.date <= end; }).map(function (row) { return row.date; }).sort().pop() || '';
  var closingView = loadClosingView_();
  var closingGoal = closingGoal_(config);
  var monthClosing = storeMonthClosing_(closingView, store, closingGoal);
  var yesterdayClosing = viewDayClosing_(closingView, yesterday);
  var labels = { written: metricSource_('store_written'), delivered: metricSource_('store_delivered'), snap: metricSource_('store_snap_written') };
  var missing = days.filter(function (day) {
    return day.date < today && !closed[day.date] && (day.snapWritten === null || day.nwdsrWritten === null || day.nwdsrDelivered === null);
  });
  var attention = attention_(facts, config, payload.session.role);
  var deliveredThrough = latestFactDate_(facts, 'nwdsrDelivered', start, end, today);
  var snapThrough = latestFactDate_(facts, 'snapWritten', start, end, today);
  var analysisThrough = analysisCoverageThrough_(store, today);
  var pendingReports = pendingSourceReports_(facts, store, today, closed, monthClosing.through);
  var savedGoals = {};
  try {
    ensureSavedDailyGoals_(store, today, closed, facts, writtenGoal, deliveredGoal);
    savedGoals = readSavedDailyGoals_();
  } catch (error) {
    try { appendException_('Update Failed', 'Yesterday\'s goal could not be saved.'); } catch (ignore) {}
  }
  var yesterdaySaved = savedGoals[yesterday] || {};
  var yesterdayDays = operatingDaysRemaining_(store, yesterday, closed);
  var yesterdayWrittenGoal = yesterdaySaved.written !== undefined && yesterdaySaved.written !== null ? yesterdaySaved.written : savedPace_(writtenGoal, sumBefore_(facts, 'nwdsrWritten', start, yesterday), yesterdayDays);
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
  var snapVariance = function (snapValue, writtenValue) {
    return snapValue === null || writtenValue === null ? null : Math.round((snapValue - writtenValue) * 100) / 100;
  };
  var board = {
    yesterday: {
      written: goalPerformance_(yesterdayWritten, yesterdayWrittenGoal),
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
      written: written,
      delivered: delivered,
      snapWritten: snap,
      snapVariance: snapVariance(snap, written),
      writtenGoal: writtenGoal,
      deliveredGoal: deliveredGoal,
      writtenAchieved: ratio_(written, writtenGoal),
      deliveredAchieved: ratio_(delivered, deliveredGoal),
      writtenLeft: writtenPace.remaining,
      deliveredLeft: deliveredPace.remaining,
      writtenForecast: verifiedRunRate_(days, 'nwdsrWritten', closed),
      deliveredForecast: verifiedRunRate_(days, 'nwdsrDelivered', closed),
      provisional: missing.length > 0,
    },
    kpis: homeKpiStrip_(goals, kpiActuals, monthClosing, analysisThrough),
  };
  var writtenBalance = {
    yesterday: { nwdsr: 'Pending', snap: 'Pending', current: 'Pending', variance: 'Pending', nwdsrLy: 'Pending', ly: 'Pending', snapLy: 'Pending', dollars: 'Pending', percent: 'Pending', currentDates: 'Pending', lyDates: 'Pending', note: 'LAST YEAR is the prior year, not last month.' },
    month: { nwdsr: 'Pending', snap: 'Pending', current: 'Pending', variance: 'Pending', nwdsrLy: 'Pending', ly: 'Pending', snapLy: 'Pending', dollars: 'Pending', percent: 'Pending', currentDates: 'Pending', lyDates: 'Pending', note: 'LAST YEAR is the prior year, not last month.' },
  };
  try {
    writtenBalance.yesterday = reportDayBalance_(facts, closed, yesterday);
    writtenBalance.month = reportMonthSnapLy_(facts, closed, store, today);
  } catch (error) {
    try { appendException_('Update Failed', 'The written comparison could not be read. Store totals were left in place.'); } catch (ignore) {}
  }
  var winnersPack = { winners: { date: priorBusinessDay_(today), status: 'pending', reason: 'PERQ Report Pending', detail: '', people: [] }, roster: { notes: [] } };
  try {
    winnersPack = salesWinnersPack_(today, yesterdayWrittenGoal, payload && payload.day);
  } catch (error) {
    if (payload && payload.day) throw error;
    try { appendException_('Update Failed', 'Yesterday\'s sales winners could not be read. Last verified totals were left in place.'); } catch (ignore) {}
  }
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    updated: healthValue_('last_calculation') || 'Not Available',
    period: start + ' through ' + end,
    individualPeriod: individual.start + ' through ' + individual.end,
    today: today,
    labels: labels,
    standard: salesStandardText_(),
    yesterday: {
      date: yesterday,
      written: yesterdayWritten,
      delivered: yesterdayRow ? yesterdayRow.nwdsrDelivered : null,
      missing: yesterdayWritten === null,
      snapWritten: yesterdaySnap,
      snapVariance: snapVariance(yesterdaySnap, yesterdayWritten),
      customers: yesterdayClosing.customers,
      opportunities: yesterdayClosing.opportunities,
      closingRatio: yesterdayClosing.ratio,
      closingVersus: yesterdayClosing.versusGoal,
      closingNote: yesterdayClosing.note,
    },
    latest: latest,
    month: {
      written: written,
      delivered: delivered,
      snapWritten: snap,
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
      written: verifiedRunRate_(days, 'nwdsrWritten', closed),
      delivered: verifiedRunRate_(days, 'nwdsrDelivered', closed),
      provisional: missing.length > 0,
      note: missing.length
        ? 'Provisional. Built only from days that have a verified figure for that measure. A missing report is pending and was not counted as zero.'
        : 'From verified store days only. The official monthly budget is unchanged.',
    },
    closing: { goal: closingGoal, mtd: monthClosing, yesterday: yesterdayClosing },
    freshness: {
      written: { through: latest, day: factAmount_(facts, latest, 'nwdsrWritten'), mtd: written },
      snap: { through: snapThrough, day: factAmount_(facts, latest, 'snapWritten'), mtd: snap },
      delivered: { through: deliveredThrough, day: factAmount_(facts, latest, 'nwdsrDelivered'), mtd: delivered },
      analysis: {
        written: analysisThrough.group17.written,
        delivered: analysisThrough.group17.delivered,
        aslWritten: analysisThrough.asl.written,
        aslDelivered: analysisThrough.asl.delivered,
      },
      closing: { through: monthClosing.through || '' },
      pending: pendingReports,
    },
    goals: goals,
    board: board,
    attention: attention.slice(0, 8),
    people: peopleRows_(individual.start, individual.end).slice(0, 8),
    winners: winnersPack.winners,
    rosterNotes: winnersPack.roster.notes || [],
    writtenBalance: writtenBalance,
    chart: homeChart_(facts, days, store, today, config),
    week: homeWeekTargets_(store, today, closed, facts, writtenGoal, deliveredGoal, savedGoals),
    stretch: {
      written: stretchWritten,
      delivered: stretchDelivered,
      writtenLeft: stretchWritten === null || written === null ? null : Math.round((Number(stretchWritten) - written) * 100) / 100,
      deliveredLeft: stretchDelivered === null || delivered === null ? null : Math.round((Number(stretchDelivered) - delivered) * 100) / 100,
    },
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
    standard: salesStandardText_(),
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

/**
 * Store bedding figures for one side. Percentages are the CC_Kpi store-month figures the Home tiles show; dollars and
 * units are the matching store-month cumulative rows on CC_Ledger.
 */
function storeBeddingSide_(side, actuals, periodStart) {
  function pick(metric) {
    var row = actuals[metric];
    return row && row[side] !== null && row[side] !== undefined ? row[side] : null;
  }
  var bedding = latestStoreLedger_('BEDDING_STORE', side, periodStart);
  var pads = latestStoreLedger_('MPPA_STORE', side, periodStart);
  var pillows = latestStoreLedger_('PILLOWS_STORE', side, periodStart);
  var bases = latestStoreLedger_('BASES_STORE', side, periodStart);
  return {
    beddingPercent: pick('Bedding'),
    beddingDollars: bedding ? bedding.sales : null,
    protectors: pick('Mattress Protectors'),
    protectorUnits: pads ? pads.units : null,
    protectorDollars: pads ? pads.sales : null,
    pillows: pick('Pillows'),
    pillowUnits: pillows ? pillows.units : null,
    pillowDollars: pillows ? pillows.sales : null,
    bases: pick('Adjustable Base Attachment'),
    baseUnits: bases ? bases.units : null,
    baseDollars: bases ? bases.sales : null,
    through: actuals.Bedding && actuals.Bedding.through ? actuals.Bedding.through : '',
    ledgerThrough: bedding ? bedding.verifiedThrough : '',
  };
}

function bedding_(payload) {
  try { ensureOfficialGoals_(); } catch (error) { appendException_('Update Failed', 'Official KPI goals could not be saved.'); }
  var config = config_();
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var actuals = {};
  try { actuals = readKpiActuals_(); } catch (error) { actuals = {}; }
  var storeSides = { written: storeBeddingSide_('written', actuals, store.start), delivered: storeBeddingSide_('delivered', actuals, store.start) };
  function percentNote(side) {
    var figure = storeSides[side];
    if (figure.beddingPercent === null) return 'No verified ' + side + ' bedding figure covers store month ' + store.start + ' through ' + store.end + '.';
    return 'Bedding dollars ÷ Group 17 ' + side + ' sales, ' + store.start + ' through ' + (figure.through || 'the latest verified date') + '. Same figure as the Home Bedding tile.';
  }
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
      writtenThrough: written ? written.through : '',
      deliveredThrough: delivered ? delivered.through : '',
    };
  });
  return {
    role: payload.session.role,
    storePeriod: store.start + ' through ' + store.end,
    individualPeriod: individual.start + ' through ' + individual.end,
    updated: healthValue_('last_calculation') || 'Not Available',
    writtenPercent: storeSides.written.beddingPercent,
    writtenPercentNote: percentNote('written'),
    deliveredPercent: storeSides.delivered.beddingPercent,
    deliveredPercentNote: percentNote('delivered'),
    store: storeSides,
    beddingGoal: metricGoal_('kpi_bedding', config),
    protectorGoal: metricGoal_('kpi_protectors', config),
    pillowGoal: metricGoal_('kpi_pillows', config),
    pillowUnit: String(config.pillow_goal_unit || 'percent'),
    baseGoal: metricGoal_('kpi_adjustable_base', config),
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
  forgetRead_('CC_Config');
  var tab = book_().getSheetByName('CC_Config');
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
  forgetRead_('CC_People');
  var lines = snapAssociateLines_(individualStart, individualEnd);
  var totals = {};
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    if (line.role === 'management' || line.role === 'unknown' || line.role === 'former') return;
    totals[line.name] = Math.round(((totals[line.name] || 0) + line.amount) * 100) / 100;
  });
  var spreadsheet = book_();
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
  // Seed GM-confirmed former identities, then rematch AssociateDays display/role (source amounts untouched).
  if (typeof rematchAssociateDays_ === 'function') rematchAssociateDays_();
  else if (typeof ensureRosterColumns_ === 'function') ensureRosterColumns_();
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
    deliveredVariance: salesTeamDeliveredVariance_(people, individual, today),
    today: today,
    evaluation: evaluationCycle_(today),
    updated: healthValue_('last_calculation') || 'Not Available',
  };
}

/**
 * Labels why active Sales Team Delivered need not equal official Store Delivered.
 * Never adjusts either figure. Former-employee and unmatched dollars stay in store totals.
 */
function salesTeamDeliveredVariance_(people, individual, today) {
  var activeSum = 0;
  var counted = 0;
  (people || []).forEach(function (person) {
    if (person.deliveredSales === null || person.deliveredSales === undefined) return;
    activeSum += Number(person.deliveredSales);
    counted += 1;
  });
  activeSum = Math.round(activeSum * 100) / 100;
  var store = storePeriodContaining_(today);
  var storeDelivered = sumField_(dailyFacts_(), 'nwdsrDelivered', store.start, store.end);
  var through = (people[0] && people[0].deliveredThrough) || '';
  var storeDeliveredThrough = latestFactDate_(dailyFacts_(), 'nwdsrDelivered', store.start, store.end, today);
  var differs = counted > 0 && storeDelivered !== null && Math.abs(activeSum - storeDelivered) > 0.009;
  return {
    activeAssociateDelivered: counted ? activeSum : null,
    activeAssociateCount: counted,
    storeDelivered: storeDelivered,
    storeDeliveredThrough: storeDeliveredThrough || null,
    storePeriod: store.start + ' through ' + store.end,
    salespersonPeriod: individual.start + ' through ' + individual.end,
    deliveredThrough: through || null,
    differs: differs,
    note: 'Official Store Delivered is NWDSR Delivered for the store month (' + store.start + ' through ' + store.end + ')' + (storeDeliveredThrough ? ', verified through ' + storeDeliveredThrough : '') + ', and remains the authoritative store measure. Current Sales Team Delivered is the sum of active associates from Group 17 Delivered for the salesperson month (' + individual.start + ' through ' + individual.end + '). It does not include former employees, unmatched names, or management, and those dollars are never reassigned to another associate. The calendars also differ (store 2nd–1st vs salesperson 1st–last day). The two figures are not forced to match.',
  };
}

function activeAssociates_() {
  return sheet_('CC_People').filter(activePerson_).map(function (row) { return String(row.name); });
}

/**
 * Monthly Sales Team Review. The issue month covers the three salesperson months that just finished (the 1st through
 * the last calendar day). It is prepared on the 2nd and the associate meeting is still due by the 6th. Through the
 * 6th the open cycle is this month's; from the 7th the screen moves to next month's preview.
 */
function evaluationCycle_(today) {
  var parts = isoParts_(today);
  var year = parts.month === 12 ? parts.year + 1 : parts.year;
  var month = parts.month === 12 ? 1 : parts.month + 1;
  if (parts.day < 7) {
    year = parts.year;
    month = parts.month;
  }
  var months = [3, 2, 1].map(function (back) {
    var m = month - back;
    var y = year;
    if (m < 1) { m += 12; y -= 1; }
    return periodFor_('individual', y, m);
  });
  var label = year + '-' + pad2_(month);
  return { cycle: label, prepare: label + '-02', deliverBy: label + '-06', covers: months.map(function (period) { return { start: period.start, end: period.end }; }) };
}

/** Printable associate summary for one salesperson and a date range inside one salesperson month. */
function summary_(payload) {
  var today = todayNy_();
  var month = individualPeriodContaining_(today);
  var start = payload.start ? String(payload.start) : month.start;
  var end = payload.end ? String(payload.end) : month.end;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || shiftDate_(start, 0) !== start || shiftDate_(end, 0) !== end) throw new Error('Choose a start and end date.');
  if (end < start) throw new Error('The end date is before the start date.');
  var period = individualPeriodContaining_(start);
  if (end > period.end) throw new Error('Choose dates inside one salesperson month, the 1st through the last day.');
  if (start > today) throw new Error('The start date is in the future.');
  var associates = activeAssociates_();
  membersDuring_(start, end).forEach(function (member) { if (associates.indexOf(member) === -1) associates.push(member); });
  var name = String(payload.name || associates[0] || '');
  if (associates.indexOf(name) === -1) throw new Error('Choose an associate who was on the Sales Team during those dates.');
  var lines = snapAssociateLines_(start, end);
  var currentMonth = start === month.start && end === month.end;
  var person = peopleRows_(start, end, { only: name, cachedSnap: currentMonth })[0] || null;
  var goals = approvedGoals_(config_());
  return {
    role: payload.session.role,
    name: name,
    associates: associates,
    start: start,
    end: end,
    period: { start: period.start, end: period.end },
    fromFirst: start === period.start,
    snapThrough: lines.latest || null,
    snapPending: lines.latest ? snapPendingDates_(start, end, lines.latest) : [],
    person: person,
    goals: { bedding: goals.bedding, averageTicket: goals.averageTicket, closing: goals.closing, individualVolume: goals.individualVolume, fabric: goals.fabric, leather: goals.leather, power: goals.power, mattress: goals.mattress, attachment: goals.attachment },
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
  forgetRead_('CC_Promotions');
  var spreadsheet = book_();
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

function promoBodies_() {
  var rows = [];
  sheet_('CC_Promotions').forEach(function (row) {
    if (!row.body) return;
    var body = null;
    try { body = JSON.parse(String(row.body)); } catch (error) { body = null; }
    if (body) rows.push({ id: String(row.id || ''), body: body });
  });
  return rows;
}

function readPromoById_(id) {
  var found = null;
  promoBodies_().forEach(function (row) {
    if (row.id === id) found = row.body;
  });
  return found;
}

/** The approved sale whose dates cover this day. A pending draft is never used. */
function promotionForDate_(today) {
  var best = null;
  var bestId = '';
  promoBodies_().forEach(function (row) {
    if (row.id === 'pending' || row.id.indexOf('removed-') === 0) return;
    var sale = saleOnDate_(row.body, today);
    if (!sale) return;
    var later = !best || String(sale.start) > String(best.start);
    var sameStartCurrent = best && sale.start === best.start && row.id === 'current' && bestId !== 'current';
    if (later || sameStartCurrent) {
      best = sale;
      bestId = row.id;
    }
  });
  return best;
}

/** Financing still follows an approved term end date after the sale window closes. */
function financingPromotion_(today) {
  var active = promotionForDate_(today);
  if (active) return active;
  var best = null;
  promoBodies_().forEach(function (row) {
    if (row.id === 'pending' || String(row.body.approved) !== 'yes') return;
    if (!financeOnDate_(row.body, today).length) return;
    if (!best || String(row.body.end) > String(best.end)) best = row.body;
  });
  return best;
}

function upsertPromo_(id, body) {
  var tab = promoSheet_();
  var values = tab.getDataRange().getValues();
  var encoded = JSON.stringify(body);
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === id) {
      tab.getRange(r + 1, 2).setValue(encoded);
      forgetRead_('CC_Promotions');
      return;
    }
  }
  tab.appendRow([id, encoded]);
  forgetRead_('CC_Promotions');
}

function clearPromo_(id) {
  var tab = promoSheet_();
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === id) {
      tab.getRange(r + 1, 1, 1, 2).setValues([['', '']]);
      forgetRead_('CC_Promotions');
      return;
    }
  }
}

function archiveApproved_(body) {
  if (!body || String(body.approved) !== 'yes' || !body.start || !body.end) return;
  var base = 'history-' + body.start + '-' + body.end;
  var id = base;
  var version = 2;
  var existing = readPromoById_(id);
  while (existing) {
    if (JSON.stringify(existing) === JSON.stringify(body)) return;
    id = base + '-v' + version;
    version += 1;
    if (version > 20) return;
    existing = readPromoById_(id);
  }
  upsertPromo_(id, body);
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
  forgetRead_('CC_Staffing');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_Staffing');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Staffing');
  tab.getRange(1, 1, 1, 10).setValues([[
    'date', 'employee_code', 'display_name', 'role', 'worked', 'on_leave', 'nwdsr_written', 'perq_opportunities', 'source', 'note'
  ]]);
  return tab;
}

function ensureOctober14Staff_() {
  var values = sheetValues_('CC_Staffing') || [];
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === '2026-10-14') return;
  }
  var tab = staffingSheet_();
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
      code: String(row.employee_code || '').trim(),
      name: String(row.display_name || row.name || ''),
      role: staffRole_(row.role),
      worked: worked === 'yes' ? true : (worked === 'no' ? false : null),
      onLeave: /^(yes|y|leave)$/i.test(String(row.on_leave || '')),
      perqOpportunities: fineNumber_(row.perq_opportunities),
    };
  });
}

/** The last business day before today. Days CC_SellingDays marks closed are skipped. */
function priorBusinessDay_(today) {
  var closed = closedDates_();
  var date = shiftDate_(today, -1);
  var steps = 0;
  while (closed[date] && steps < 31) {
    date = shiftDate_(date, -1);
    steps += 1;
  }
  return date;
}

/** Store and salesperson PERQ opportunities exported for exactly this business date. Multi-day snapshots are never used. */
function perqDay_(date) {
  var store = null;
  var storeConflict = false;
  var people = [];
  loadClosing_().forEach(function (fact) {
    if (fact.start !== date || fact.end !== date || fact.opportunities === null) return;
    if (fact.scope === 'store' && !fact.code) {
      if (fact.opportunityConflict || (store !== null && store !== fact.opportunities)) storeConflict = true;
      store = fact.opportunities;
    } else if (fact.scope === 'person') {
      people.push(fact);
    }
  });
  return { store: storeConflict ? null : store, people: people };
}

/** associate, management, leave, nonsales, former or unknown on a date, from the effective-dated roster. */
function salesRoleOn_(entry, name, date) {
  if (managementName_(name)) return 'management';
  if (!entry) return 'unknown';
  var role = rosterRole_(entry.raw, date);
  if (role !== 'associate') return role === 'management' || role === 'former' ? role : 'unknown';
  if (rosterStatusOn_(entry.raw, date) === 'Leave') return 'leave';
  var position = String(entry.raw.position || '').trim();
  if (position && !/\bsales/i.test(position)) return 'nonsales';
  return 'associate';
}

function notCountedWhy_(role, date) {
  if (role === 'management') return 'management';
  if (role === 'leave') return 'on leave on ' + date;
  if (role === 'nonsales') return 'not in a sales position';
  if (role === 'former') return 'not employed as a salesperson on ' + date;
  return 'not on the roster';
}

function nameList_(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function opportunityText_(count) {
  return count + (count === 1 ? ' opportunity' : ' opportunities');
}

/**
 * Who worked the sales floor on one business date. The General Manager confirmed that the named, non-management
 * associates on that day's individual PERQ report are the working salespeople, including anyone listed with 0
 * opportunities. CC_Staffing rows are manual confirmations and exceptions and take precedence over PERQ. A missing
 * sale never marks anyone absent, and store opportunities PERQ did not assign to a salesperson are never given to anyone.
 */
function workingRoster_(date) {
  var perq = perqDay_(date);
  var manual = {};
  readStaffing_(date).forEach(function (line) {
    var entry = rosterMatch_(line.code, line.name);
    var name = entry ? entry.name : line.name;
    if (name) manual[name.toLowerCase()] = { line: line, entry: entry, name: name };
  });
  var listed = [];
  var seen = {};
  var listedTotal = 0;
  perq.people.forEach(function (fact) {
    var entry = rosterMatch_(fact.code, fact.name);
    var name = entry ? entry.name : String(fact.name || fact.code);
    var key = name.toLowerCase();
    if (seen[key]) {
      if (seen[key].opportunities !== fact.opportunities) seen[key].conflict = true;
      return;
    }
    seen[key] = { name: name, opportunities: fact.opportunities, conflict: !!fact.opportunityConflict, role: salesRoleOn_(entry, name, date) };
    listed.push(seen[key]);
    listedTotal += fact.opportunities;
  });

  var people = [];
  var notCounted = [];
  var exceptions = [];
  listed.forEach(function (person) {
    var confirm = manual[person.name.toLowerCase()];
    if (confirm && (confirm.line.worked === false || confirm.line.onLeave)) {
      exceptions.push(person.name + ' is on the PERQ report, but CC_Staffing confirms ' + (confirm.line.onLeave ? 'leave' : 'not working') + ' on ' + date + ', so is not counted.');
      return;
    }
    var role = confirm && (confirm.line.role === 'management' || confirm.line.role === 'former') ? confirm.line.role : person.role;
    if (role !== 'associate') {
      notCounted.push(person.name + ' (' + notCountedWhy_(role, date) + ')');
      return;
    }
    people.push({ name: person.name, opportunities: person.conflict ? null : person.opportunities, source: confirm && confirm.line.worked === true ? 'perq+staffing' : 'perq' });
  });
  Object.keys(manual).forEach(function (key) {
    var confirm = manual[key];
    if (confirm.line.worked !== true || confirm.line.onLeave || seen[key]) return;
    var role = confirm.line.role === 'management' || confirm.line.role === 'former' ? confirm.line.role : salesRoleOn_(confirm.entry, confirm.name, date);
    if (role === 'leave' || (role === 'unknown' && confirm.line.role === 'associate')) role = 'associate';
    if (role !== 'associate') {
      notCounted.push(confirm.name + ' (' + notCountedWhy_(role, date) + ')');
      return;
    }
    people.push({ name: confirm.name, opportunities: confirm.line.perqOpportunities, source: 'staffing' });
  });

  if (!perq.people.length && !people.length) {
    return {
      date: date, status: 'pending', source: '', reason: 'PERQ Report Pending',
      detail: 'The individual PERQ report for ' + date + ' is not on file yet. Nobody is marked absent while it is missing.',
      people: [], notes: [], store: perq.store, listedTotal: null,
    };
  }

  // A daily export that names every active salesperson and shows zeros may be the employee list, not who worked.
  var active = rosterRows_().filter(function (entry) { return salesRoleOn_(entry, entry.name, date) === 'associate'; });
  var everyone = active.length > 1 && active.every(function (entry) { return !!seen[entry.name.toLowerCase()]; });
  var unconfirmed = [];
  if (everyone) {
    people = people.filter(function (person) {
      if (person.source !== 'perq' || person.opportunities !== 0) return true;
      unconfirmed.push(person.name);
      return false;
    });
  }

  var notes = [];
  var fromPerq = people.filter(function (person) { return person.source !== 'staffing'; });
  var fromStaffing = people.filter(function (person) { return person.source === 'staffing'; });
  if (fromPerq.length) {
    notes.push('Working salespeople on ' + date + ' from the individual PERQ report: ' + nameList_(fromPerq.map(function (person) {
      return person.name + (person.opportunities === null ? ' (opportunities conflict between exports)' : ' (' + opportunityText_(person.opportunities) + ')');
    })) + '.');
  } else if (perq.people.length) {
    notes.push('No sales associate is on the individual PERQ report for ' + date + '.');
  } else {
    notes.push('The individual PERQ report for ' + date + ' is not on file. The working roster is the CC_Staffing confirmation.');
  }
  var confirmed = people.filter(function (person) { return person.source === 'perq+staffing'; });
  if (confirmed.length) notes.push('CC_Staffing also confirms ' + nameList_(confirmed.map(function (person) { return person.name; })) + '.');
  if (fromStaffing.length) notes.push('Confirmed in CC_Staffing without a PERQ line: ' + nameList_(fromStaffing.map(function (person) { return person.name; })) + '.');
  exceptions.forEach(function (line) { notes.push(line); });
  if (unconfirmed.length) {
    notes.push('The PERQ salesperson export lists every active salesperson, so it may be the employee list rather than who worked. ' +
      nameList_(unconfirmed) + ' with 0 opportunities ' + (unconfirmed.length === 1 ? 'is' : 'are') + ' not counted until confirmed in CC_Staffing.');
  }
  if (notCounted.length) notes.push('On the PERQ report but not counted as salespeople: ' + nameList_(notCounted) + '.');
  if (perq.store !== null && perq.people.length) {
    var gap = Math.round((perq.store - listedTotal) * 100) / 100;
    if (gap > 0) {
      notes.push('Store PERQ shows ' + perq.store + ' opportunities but the salesperson report adds to ' + listedTotal + '. ' +
        opportunityText_(gap) + (gap === 1 ? ' is' : ' are') + ' not assigned to any salesperson and ' + (gap === 1 ? 'was' : 'were') + ' not given to anyone.');
    } else if (gap < 0) {
      notes.push('The salesperson report adds to ' + listedTotal + ' opportunities, more than the store PERQ of ' + perq.store + '. Check the two exports.');
    }
  }
  notes.push('Nobody is marked absent because of a missing sale.');
  return { date: date, status: 'ready', source: perq.people.length ? 'perq' : 'staffing', reason: '', detail: '', people: people, notes: notes, store: perq.store, listedTotal: perq.people.length ? listedTotal : null };
}

function eligibleAssociate_(line) {
  return line.worked === true && line.role === 'associate' && !line.onLeave && !managementName_(line.name);
}

/**
 * One day's SNAP Written by salesperson. With that day's salesperson lines on file, a salesperson without a line wrote
 * 0. A store SNAP total without salesperson lines is complete only when the store wrote nothing.
 */
function snapWrittenOn_(date) {
  var lines = snapAssociateLines_(date, date);
  var storeTotal = null;
  dailyFacts_().forEach(function (row) { if (row.date === date && row.snapWritten !== null) storeTotal = row.snapWritten; });
  var reported = lines.order.length > 0 || storeTotal === 0;
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

/**
 * Prior completed business day's working roster and SNAP ranking. A chosen day is only the winners section;
 * Written, Delivered and the other Home figures stay on calendar today / yesterday.
 */
function salesWinnersPack_(today, writtenGoal, askedDay) {
  var winnersDay = priorBusinessDay_(today);
  var chosenDay = false;
  if (askedDay) {
    var asked = validDate_(askedDay);
    if (asked >= today) throw new Error('Choose a business day before today.');
    chosenDay = asked !== winnersDay;
    winnersDay = asked;
  }
  var roster;
  try {
    roster = workingRoster_(winnersDay);
  } catch (error) {
    try { appendException_('Update Failed', 'The working roster for ' + winnersDay + ' could not be read. ' + String(error && error.message ? error.message : error)); } catch (ignore) {}
    roster = { date: winnersDay, status: 'pending', reason: 'PERQ Report Pending', detail: 'The working roster for ' + winnersDay + ' could not be read.', people: [], notes: [] };
  }
  var yesterday = shiftDate_(today, -1);
  var snap = snapWrittenOn_(winnersDay);
  if (roster.status === 'ready' && snap.reported) {
    var outside = snapOutsideWorking_(winnersDay, roster.people);
    if (outside.length) {
      roster.notes = (roster.notes || []).concat(
        'SNAP Written also lists ' + nameList_(outside) + '. A SNAP line, including an adjustment, is not proof someone worked, so ' +
        (outside.length === 1 ? 'that name is' : 'those names are') + ' not in yesterday\'s sales winners.'
      );
    }
  }
  return {
    winnersDay: winnersDay,
    chosenDay: chosenDay,
    roster: roster,
    winners: morningWinners_(roster, winnersDay === yesterday ? writtenGoal : null, snap),
  };
}

/**
 * SNAP display names for this date that do not match anyone on the working roster.
 * Their dollars stay on the SNAP report and are not used to decide who worked.
 */
function snapOutsideWorking_(date, people) {
  var lines = snapAssociateLines_(date, date);
  var extra = [];
  var seen = {};
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    var matched = (people || []).some(function (person) {
      var aliases = personAliases_(person.name);
      return line.name === person.name || aliases.indexOf(String(line.name || '').toLowerCase()) !== -1;
    });
    if (matched) return;
    var label = String(line.name || '');
    var keyName = label.toLowerCase();
    if (!label || seen[keyName]) return;
    seen[keyName] = true;
    extra.push(label);
  });
  extra.sort();
  return extra;
}

/** 1st, 2nd and 3rd by SNAP Written, plus associates who worked and wrote nothing. $0 is not a place. */
function winnersBoard_(people, snapReported) {
  var empty = { places: [], noWritten: [], alsoWrote: [] };
  if (!snapReported) return empty;
  var ranked = (people || []).filter(function (person) { return person.written !== null && person.written !== undefined; });
  var sellers = ranked.filter(function (person) { return Number(person.written) > 0; });
  var places = [];
  var alsoWrote = [];
  var place = 0;
  var last = null;
  sellers.forEach(function (person) {
    if (last === null || Number(person.written) !== last) {
      place += 1;
      last = Number(person.written);
    }
    var row = { place: place, name: person.name, written: person.written, opportunities: person.opportunities, source: person.source };
    if (place <= 3) places.push(row);
    else alsoWrote.push(row);
  });
  var noWritten = ranked.filter(function (person) { return Number(person.written) === 0; }).map(function (person) {
    return { name: person.name, written: 0, opportunities: person.opportunities, source: person.source };
  });
  return { places: places, noWritten: noWritten, alsoWrote: alsoWrote };
}

/** Every salesperson on the working roster, ranked by SNAP Written for the same date. Missing SNAP is Pending, never $0. */
function morningWinners_(roster, goal, snap) {
  var result = { date: roster.date, status: 'pending', reason: roster.reason, detail: roster.detail || '', share: null, snapReported: false, people: [], places: [], noWritten: [], alsoWrote: [] };
  if (roster.status !== 'ready') return result;
  result.status = 'ready';
  result.reason = '';
  if (!roster.people.length) {
    result.reason = 'No sales associate is on the working roster for ' + roster.date + '.';
    return result;
  }
  var reported = !!(snap && snap.reported);
  var share = goal === null || goal === undefined ? null : Math.round((goal / roster.people.length) * 100) / 100;
  result.snapReported = reported;
  result.share = share;
  result.people = roster.people.map(function (person) {
    var written = reported ? snap.amountFor(person.name) : null;
    return {
      name: person.name,
      written: written,
      opportunities: person.opportunities,
      source: person.source,
      share: share,
      above: written !== null && share !== null && written > share ? Math.round((written - share) * 100) / 100 : null,
    };
  });
  result.people.sort(function (a, b) {
    if (a.written !== null && b.written !== null && a.written !== b.written) return b.written - a.written;
    return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
  });
  var board = winnersBoard_(result.people, reported);
  result.places = board.places;
  result.noWritten = board.noWritten;
  result.alsoWrote = board.alsoWrote;
  if (!reported) result.reason = 'SNAP Written for ' + roster.date + ' is not on file yet, so each salesperson shows Pending.';
  return result;
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
  var financePromo = null;
  var editorBody = null;
  var pendingDraft = null;
  try {
    promotion = promotionForDate_(home.today);
    financePromo = financingPromotion_(home.today);
    if (!promotion && !financePromo && !promoBodies_().length) {
      var seed = anniversaryPromotion_();
      promotion = saleOnDate_(seed, home.today);
      financePromo = seed;
    }
    if (payload.session.role === 'admin') {
      pendingDraft = readPromoById_('pending');
      editorBody = pendingDraft && String(pendingDraft.approved) !== 'yes' ? pendingDraft : (readPromotion_() || anniversaryPromotion_());
    }
  } catch (error) {
    promotion = null;
    financePromo = null;
  }
  var yesterday = home.yesterday.date;
  var closingFigure = { value: null, scope: 'none', date: '', period: '', goal: home.closing.goal, customers: null, opportunities: null, reconcile: false };
  var beddingGoal = home.goals.bedding;
  var homeBedding = { written: null, delivered: null, goal: beddingGoal };
  (home.board && home.board.kpis ? home.board.kpis : []).forEach(function (row) {
    if (row.name === 'Bedding') homeBedding = row;
  });
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
  var todayStaffing = [];
  try {
    todayStaffing = readStaffing_(home.today);
  } catch (error) {
    todayStaffing = [];
  }
  var writtenPerf = home.board.yesterday.written;
  var pack = salesWinnersPack_(home.today, writtenPerf.goal, payload.day);
  var winnersDay = pack.winnersDay;
  var chosenDay = pack.chosenDay;
  var roster = pack.roster;
  var winners = pack.winners;
  var workedToday = workedCount_(todayStaffing);
  var personalShare = workedToday === null || home.board.today.written === null ? null : Math.round((home.board.today.written / workedToday) * 100) / 100;
  var gaps = [];
  if (home.yesterday.written === null) gaps.push(home.labels.written);
  if (home.yesterday.delivered === null) gaps.push('NWDSR delivered');
  if (closingFigure.scope === 'none') gaps.push('closing ratio');
  if (beddingWritten.scope === 'none') gaps.push('written bedding');
  if (beddingDelivered.scope === 'none') gaps.push('delivered bedding');
  if (!chosenDay && winners.status === 'pending') gaps.push('individual PERQ for ' + winnersDay);
  if (!chosenDay && winners.status === 'ready' && winners.people.length && !winners.snapReported) gaps.push('SNAP Written by salesperson for ' + winnersDay);
  if (personalShare === null) gaps.push('today\'s working roster');
  if (gaps.length) {
    try { notifyOnce_('Morning meeting for ' + yesterday + ' is waiting on: ' + gaps.join('; ') + '.'); } catch (ignore) {}
  }
  return {
    role: payload.session.role,
    title: 'Morning meeting',
    date: home.today,
    storePeriod: home.period,
    individualPeriod: home.individualPeriod,
    updated: home.updated,
    labels: home.labels,
    yesterday: {
      date: yesterday,
      written: writtenPerf,
      snapWritten: home.yesterday.snapWritten,
      snapVariance: home.yesterday.snapVariance,
      writtenBalance: home.writtenBalance ? home.writtenBalance.yesterday : null,
      delivered: home.board.yesterday.delivered,
      customers: home.yesterday.customers,
      opportunities: home.yesterday.opportunities,
      closingRatio: home.yesterday.closingRatio,
      closing: closingFigure,
      beddingWritten: beddingWritten,
      beddingDelivered: beddingDelivered,
    },
    today: {
      written: home.board.today.written,
      delivered: home.board.today.delivered,
      beddingGoal: beddingGoal,
      closingGoal: home.closing.goal,
      personalShare: personalShare,
    },
    winners: winners,
    rosterNotes: roster.notes || [],
    promotion: promotion,
    financing: financeOnDate_(financePromo, home.today),
    beddingFinance: (financePromo && financePromo.beddingFinance) || 'Size-based qualifying amounts are not in the approved promotion.',
    reminders: [
      'NO ONE WALKS.',
      'Present maintenance plans.',
      'Review the customer\'s financing and delivery requirements.',
      'Complete the sales order checklist.',
      'Obtain required manager reviews.',
    ],
    editor: editorBody,
    review: pendingDraft && pendingDraft.changes ? {
      file: pendingDraft.sourceFile || '',
      comparedWith: pendingDraft.comparedWith || '',
      changes: pendingDraft.changes,
      financingUnread: !!pendingDraft.financingUnread,
      offersUnread: !!pendingDraft.offersUnread,
    } : null,
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
    marquee: String(payload.marquee || '').trim(),
    mainFinance: String(payload.mainFinance || '').trim(),
    restrictions: String(payload.restrictions || '').trim(),
    fullText: String(payload.fullText || '').trim().slice(0, 20000),
  };
  if (!promotion.name || !/^\d{4}-\d{2}-\d{2}$/.test(promotion.start) || !/^\d{4}-\d{2}-\d{2}$/.test(promotion.end)) {
    throw new Error('The promotion needs a name and YYYY-MM-DD dates.');
  }
  var previous = readPromotion_();
  var pending = readPromoById_('pending');
  if (pending) {
    if (!promotion.marquee && pending.marquee) promotion.marquee = pending.marquee;
    if (!promotion.mainFinance && pending.mainFinance) promotion.mainFinance = pending.mainFinance;
    if (!promotion.restrictions && pending.restrictions) promotion.restrictions = pending.restrictions;
    if (!promotion.fullText && pending.fullText) promotion.fullText = pending.fullText;
    if (pending.changes) promotion.changes = pending.changes;
    if (pending.comparedWith) promotion.comparedWith = pending.comparedWith;
    if (pending.sourceFile) promotion.sourceFile = pending.sourceFile;
    if (pending.financingUnread) promotion.financingUnread = true;
    if (pending.offersUnread) promotion.offersUnread = true;
  }
  if (promotion.financing.length) promotion.financingUnread = false;
  if (promotion.highlights.length || promotion.featured.length) promotion.offersUnread = false;
  var sameSale = previous && previous.name === promotion.name && previous.start === promotion.start && previous.end === promotion.end;
  if (promotion.approved !== 'yes' && !sameSale) {
    promotion.approved = 'no';
    upsertPromo_('pending', promotion);
    return morning_(payload);
  }
  if (promotion.approved === 'yes' && previous && String(previous.approved) === 'yes' && JSON.stringify(previous) !== JSON.stringify(promotion)) {
    archiveApproved_(previous);
  }
  upsertPromo_('current', promotion);
  if (promotion.approved === 'yes') clearPromo_('pending');
  return morning_(payload);
}

function promoMonthIndex_(name) {
  var months = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
    jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  return months[String(name || '').toLowerCase()] || 0;
}

function promoIso_(year, month, day) {
  var y = Number(year);
  var m = Number(month);
  var d = Number(day);
  if (y < 100) y += 2000;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
}

function promoSpanDays_(start, end) {
  var left = Date.parse(start + 'T12:00:00Z');
  var right = Date.parse(end + 'T12:00:00Z');
  if (!isFinite(left) || !isFinite(right)) return 99;
  return Math.round((right - left) / 86400000);
}

function promoSpokenDate_(iso) {
  var parts = String(iso || '').split('-');
  var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var month = names[Number(parts[1]) - 1];
  if (!month || !parts[2]) return iso;
  return month + ' ' + Number(parts[2]) + ', ' + parts[0];
}

function promoDatePairs_(text) {
  var flat = String(text || '').replace(/[\u2013\u2014]/g, '-');
  var month = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  var weekday = '(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\\s+)?';
  var pairs = [];
  var match;
  var dated = new RegExp(weekday + month + '\\s+(\\d{1,2}),?\\s+(20\\d{2})\\s*(?:-|through|to)\\s*' + weekday + month + '\\s+(\\d{1,2}),?\\s+(20\\d{2})', 'ig');
  while ((match = dated.exec(flat))) {
    var start = promoIso_(match[3], promoMonthIndex_(match[1]), match[2]);
    var end = promoIso_(match[6], promoMonthIndex_(match[4]), match[5]);
    if (start && end && start <= end) pairs.push({ start: start, end: end, index: match.index });
  }
  var named = new RegExp(month + '\\s+(\\d{1,2})\\s*(?:-|through|to)\\s*(?:' + month + '\\s+)?(\\d{1,2}),?\\s*(20\\d{2})', 'ig');
  while ((match = named.exec(flat))) {
    var startMonth = promoMonthIndex_(match[1]);
    var endMonth = match[3] ? promoMonthIndex_(match[3]) : startMonth;
    var startShort = promoIso_(match[5], startMonth, match[2]);
    var endShort = promoIso_(match[5], endMonth, match[4]);
    if (startShort && endShort && startShort <= endShort) pairs.push({ start: startShort, end: endShort, index: match.index });
  }
  var numeric = /(\d{1,2})[./](\d{1,2})[./](20\d{2})\s*(?:-|through|to)\s*(\d{1,2})[./](\d{1,2})[./](20\d{2})/g;
  while ((match = numeric.exec(flat))) {
    var startN = promoIso_(match[3], match[1], match[2]);
    var endN = promoIso_(match[6], match[4], match[5]);
    if (startN && endN && startN <= endN) pairs.push({ start: startN, end: endN, index: match.index });
  }
  return pairs;
}

function promoSingleDate_(text) {
  var flat = String(text || '').replace(/[\u2013\u2014]/g, '-');
  var month = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  var named = new RegExp(month + '\\s+(\\d{1,2}),?\\s*(20\\d{2})', 'i').exec(flat);
  if (named) return promoIso_(named[3], promoMonthIndex_(named[1]), named[2]);
  var numeric = /(\d{1,2})[./](\d{1,2})[./](20\d{2})/.exec(flat);
  if (numeric) return promoIso_(numeric[3], numeric[1], numeric[2]);
  return '';
}

function promoMoneyToken_(value) {
  var number = Number(String(value || '').replace(/[$,]/g, ''));
  if (!isFinite(number)) return '';
  var text = number.toFixed(2).replace(/\.00$/, '');
  var parts = text.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return '$' + parts.join('.');
}

function financingFromBlock_(months, body, saleEnd) {
  var text = String(body || '').replace(/\s+/g, ' ').trim();
  var zero = /(^|[^0-9])0\s*%|zero interest|0 interest/i.test(text);
  var noMin = /no minimum/i.test(text);
  var min = /\$\s*(\d[\d,]*(?:\.\d{2})?)/.exec(text);
  var deposit = /(\d{1,2})\s*%\s*(?:down|deposit)/i.exec(text) || /(?:down|deposit)[^%]{0,40}?(\d{1,2})\s*%/i.exec(text);
  var noDown = /no down payment|no deposit/i.test(text);
  var yellow = /yellow tag only/i.test(text);
  var noExtra = /no additional discount/i.test(text);
  var discountsOk = /discounts allowed|discounted items/i.test(text);
  var ownDates = promoDatePairs_(text);
  var end = ownDates.length ? ownDates[0].end : (promoSingleDate_(text) || saleEnd);
  var sentences = [months + (zero ? ' months at 0% interest.' : ' months.')];
  if (/credit card/i.test(text)) sentences.push('Use the Kane\'s Furniture credit card.');
  if (noMin) sentences.push('No minimum purchase.');
  else if (min) sentences.push('Minimum purchase is ' + promoMoneyToken_(min[1]) + '.');
  else sentences.push('Minimum purchase was not printed in this offer.');
  if (noDown) sentences.push('No down payment.');
  else if (deposit) sentences.push('Required deposit is ' + deposit[1] + '%.');
  if (/another payment/i.test(text)) sentences.push('Pay the deposit with another payment method.');
  if (/equal monthly payments/i.test(text)) sentences.push('Equal monthly payments are required.');
  if (/plus tax and delivery/i.test(text)) sentences.push('Plus tax and delivery.');
  if (ownDates.length) sentences.push('This offer runs ' + promoSpokenDate_(ownDates[0].start) + ' through ' + promoSpokenDate_(ownDates[0].end) + '.');
  else if (end) sentences.push('This offer ends ' + promoSpokenDate_(end) + '.');
  if (yellow) sentences.push('Yellow Tag only.');
  if (noExtra) sentences.push('No additional discount.');
  if (discountsOk) sentences.push('Discounts are allowed.');
  return {
    months: months,
    end: end,
    zeroInterest: zero,
    highlight: !!(zero && months >= 60),
    bedding: /bedding only|code:\s*bed\b/i.test(text),
    summary: sentences.join(' '),
  };
}

function promoMoneyList_(line) {
  return String(line || '').match(/\$\s*\d[\d,]*(?:\.\d{2})?/g) || [];
}

function parseFinancingTerms_(text, saleEnd) {
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  var blocks = [];
  var current = '';
  function push() {
    if (current) blocks.push(current);
    current = '';
  }
  lines.forEach(function (line) {
    var clean = line.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (/^code\s*:/i.test(clean) || /^\d{1,2}\s*-?\s*months?\b/i.test(clean)) {
      push();
      current = clean;
      return;
    }
    if (current && !/^(\*|disclaimer|non advertised|bedding financing|advertised offers)\b/i.test(clean)) current += ' ' + clean;
    else push();
  });
  push();
  var found = [];
  blocks.forEach(function (block) {
    var monthMatch = /(\d{1,2})\s*-?\s*months?\b/i.exec(block);
    if (!monthMatch) return;
    var months = Number(monthMatch[1]);
    if (months < 1 || months > 84) return;
    if (!/minimum|down payment|deposit|discount|yellow tag|0\s*%|interest/i.test(block)) return;
    var term = financingFromBlock_(months, block, saleEnd);
    var key = String(months) + (term.bedding ? '-bedding' : '');
    var prior = -1;
    found.forEach(function (item, index) {
      if (String(item.months) + (item.bedding ? '-bedding' : '') === key) prior = index;
    });
    if (prior === -1 || term.summary.length > found[prior].summary.length) {
      if (prior === -1) found.push(term);
      else found[prior] = term;
    }
  });
  return found.sort(function (left, right) { return left.months - right.months; });
}

function headlineFeatured_(text) {
  var found = {};
  String(text || '').split('\n').forEach(function (line) {
    var prices = promoMoneyList_(line);
    if (prices.length < 2) return;
    var was = Number(prices[0].replace(/[$,\s]/g, ''));
    var now = Number(prices[prices.length - 1].replace(/[$,\s]/g, ''));
    if (!isFinite(was) || !isFinite(now) || now >= was) return;
    var percent = /(\d{1,2})\s*%/.exec(line);
    if (percent && Math.abs(Math.round((1 - now / was) * 100) - Number(percent[1])) > 3) return;
    var off = percent ? percent[1] + '% OFF' : '';
    var name = '';
    if (/palm gate/i.test(line)) name = 'Palm Gate 5-piece King Bedroom';
    else if (/oakley white/i.test(line)) name = 'Oakley White 4-piece Sectional';
    else if (/oakley grey/i.test(line)) name = 'Oakley Grey 4-piece Sectional';
    else if (/dallas saddle/i.test(line) && /manual/i.test(line)) name = 'Dallas Saddle 6-piece Manual Reclining Sectional';
    else if (/dallas saddle/i.test(line) && /pwr|power/i.test(line)) name = 'Dallas Saddle 6-piece Power Reclining Sectional';
    if (!name || found[name]) return;
    found[name] = { name: name, was: was, now: now, save: Math.round((was - now) * 100) / 100, off: off };
  });
  var order = [
    'Palm Gate 5-piece King Bedroom',
    'Oakley White 4-piece Sectional',
    'Oakley Grey 4-piece Sectional',
    'Dallas Saddle 6-piece Manual Reclining Sectional',
  ];
  var items = [];
  order.forEach(function (name) { if (found[name]) items.push(found[name]); });
  var white = found['Oakley White 4-piece Sectional'];
  var grey = found['Oakley Grey 4-piece Sectional'];
  if (white && grey && white.was === grey.was && white.now === grey.now && white.off === grey.off) {
    items = items.filter(function (item) { return item.name.indexOf('Oakley') !== 0; });
    items.splice(1, 0, { name: 'Oakley White/Grey 4-piece Sectional', was: white.was, now: white.now, save: white.save, off: white.off });
  }
  return { items: items, power: found['Dallas Saddle 6-piece Power Reclining Sectional'] || null };
}

function parseOfferLines_(text) {
  var offers = [];
  String(text || '').split(/\n/).forEach(function (line) {
    var clean = line.replace(/\s+/g, ' ').trim();
    if (!clean || clean.length > 180) return;
    if (/^\d{1,2}\s*-?\s*months?\b/i.test(clean)) return;
    if (/marquee/i.test(clean)) return;
    if (/^(exclusions?|restrictions?|queen|king|twin|full)\b/i.test(clean)) return;
    if (!/(\d+\s*%|\boff\b|\$\d)/i.test(clean)) return;
    if (!/[.]$/.test(clean)) clean += '.';
    offers.push(clean);
  });
  return offers;
}

function parseFeatured_(text) {
  var items = [];
  String(text || '').split(/\n/).forEach(function (line) {
    var clean = line.replace(/\s+/g, ' ').trim();
    var prices = clean.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g) || [];
    if (prices.length < 2) return;
    var name = clean.split(/\$/)[0].replace(/\b(was|now|reg\.?|regular)\b/ig, ' ').replace(/\s+/g, ' ').trim().replace(/[:\-–]+$/, '');
    if (!name || name.length < 4) return;
    var was = Number(prices[0].replace(/[$,]/g, ''));
    var now = Number(prices[1].replace(/[$,]/g, ''));
    if (!isFinite(was) || !isFinite(now) || now >= was) return;
    var off = '';
    var percent = /(\d{1,2})\s*%/.exec(clean);
    if (percent) off = percent[1] + '% OFF';
    items.push({ name: name, was: was, now: now, save: Math.round((was - now) * 100) / 100, off: off });
  });
  return items;
}

function promoSaleWindow_(text) {
  var active = /active in[\s\S]{0,180}/i.exec(text);
  var source = active ? promoDatePairs_(active[0]) : [];
  var pairs = (source.length ? source : promoDatePairs_(text)).filter(function (pair) {
    return promoSpanDays_(pair.start, pair.end) <= 20;
  });
  pairs.sort(function (left, right) { return left.index - right.index; });
  return pairs[0] || null;
}

function parseStoreMarquee_(text) {
  var chosen = '';
  String(text || '').split('\n').forEach(function (line) {
    var clean = line.replace(/\s+/g, ' ').trim();
    if (/#17\b/.test(clean) && /anniversary/i.test(clean)) chosen = clean;
  });
  if (!chosen) {
    String(text || '').split('\n').forEach(function (line, index, lines) {
      if (chosen || !/marquee/i.test(line)) return;
      var same = line.replace(/.*marquee\s*[:\-]?/i, '').replace(/\s+/g, ' ').trim();
      chosen = same && !/^store\s*17$/i.test(same) ? same : String(lines[index + 1] || '').replace(/\s+/g, ' ').trim();
    });
  }
  return chosen.replace(/^stores?\s+#(?:(?!-\s).)*-\s*/i, '').trim();
}

function parseBeddingFinance_(text) {
  var block = /code:\s*bed\b[\s\S]{0,500}/i.exec(text);
  if (!block) return '';
  var body = block[0].split(/\n\s*\*/)[0].replace(/\s+/g, ' ');
  var sizes = /\$(\d[\d,]*)\s*twin\/twin xl,\s*\$(\d[\d,]*)\s*queen\/full,\s*\$(\d[\d,]*)\s*king/i.exec(body);
  if (!sizes) return '';
  var sentences = [
    'Bedding only. 48 months.',
    'Twin and Twin XL minimum is ' + promoMoneyToken_(sizes[1]) + '.',
    'Queen and Full minimum is ' + promoMoneyToken_(sizes[2]) + '.',
    'King minimum is ' + promoMoneyToken_(sizes[3]) + '.',
    'Plus tax and delivery.',
  ];
  if (/cannot be used with discounted/i.test(body)) sentences.push('Do not use this on a discounted item.');
  if (/free delivery on premium bedding/i.test(body)) sentences.push('Free delivery on premium bedding.');
  return sentences.join(' ');
}

function parsePromotionText_(text) {
  var raw = String(text || '').replace(/\r/g, '').trim();
  if (!raw) throw new Error('No words could be read from that PDF. Nothing was saved.');
  var window = promoSaleWindow_(raw);
  if (!window) throw new Error('The sale dates could not be read. Nothing was approved.');
  var name = /78th anniversary sale/i.test(raw) ? '78th Anniversary Sale' : '';
  if (!name && /78th anniversary event/i.test(raw)) name = '78th Anniversary Event';
  if (!name) {
    var nameMatch = /([^\n]{0,80}anniversary sale[^\n]{0,40})/i.exec(raw) || /([^\n]{0,60}\bsale\b[^\n]{0,40})/i.exec(raw);
    name = nameMatch ? nameMatch[1].replace(/\s+/g, ' ').trim() : '';
    name = name.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
  }
  if (!name) throw new Error('The sale name could not be read. Nothing was approved.');
  var kaneSheet = /code:\s*(?:\d{3}|bed)\b/i.test(raw);
  var financing = parseFinancingTerms_(raw, window.end).filter(function (term) { return !term.bedding; });
  var headline = kaneSheet ? headlineFeatured_(raw) : { items: parseFeatured_(raw), power: null };
  var featured = headline.items;
  var offers = parseOfferLines_(raw).filter(function (line) {
    return !featured.some(function (item) { return line.indexOf(item.name) === 0; });
  });
  var highlights = [];
  if (kaneSheet) {
    if (featured.some(function (item) { return item.off === '50% OFF'; })) highlights.push('Featured floor samples are 50% off.');
    if (/davey euro top/i.test(raw)) highlights.push('Davey Euro Top mattresses are 50% off.');
    var delivery = /free immediate delivery with minimum purchase of \$(\d[\d,]*)/i.exec(raw);
    if (delivery) highlights.push('Free delivery when you buy ' + promoMoneyToken_(delivery[1]) + ' or more, in the carton.');
    if (/\$300 gift card with the purchase of select premium mattresses/i.test(raw)) highlights.push('A $300 gift card comes with select premium mattresses.');
  }
  if (!highlights.length) highlights = offers.slice(0, 4);
  var marquee = parseStoreMarquee_(raw);
  var exclusionMatch = /excludes\s+([^\.]+)/i.exec(raw) || /exclusions?\s*[:\-]\s*([^\n]+)/i.exec(raw);
  var exclusions = exclusionMatch ? exclusionMatch[1].split(/,|&| and /).map(function (part) {
    return part.replace(/\.$/, '').replace(/\s+/g, ' ').trim();
  }).filter(function (part) { return part; }).map(function (part) {
    if (/tempur/i.test(part)) return 'Tempur-Pedic';
    if (/beautyrest/i.test(part)) return 'Beautyrest Black';
    return part.charAt(0).toUpperCase() + part.slice(1);
  }) : [];
  var restrictionLines = [];
  if (/not valid with any other offer/i.test(raw)) restrictionLines.push('Not valid with any other offer.');
  if (/within 21 days/i.test(raw)) restrictionLines.push('Take delivery within 21 days.');
  if (/cannot be further discounted/i.test(raw)) restrictionLines.push('Mattress sets can count toward the minimum. They cannot be discounted more.');
  if (/discounts can not be combined|discounts cannot be combined/i.test(raw)) restrictionLines.push('Discounts cannot be combined with another promotion.');
  if (/red tag merchandise/i.test(raw)) restrictionLines.push('Red Tag, AS-IS, gift cards, and warranties are not discounted.');
  raw.split('\n').forEach(function (line) {
    var clean = line.replace(/\s+/g, ' ').trim();
    if (/^(restrictions?|not eligible)\b/i.test(clean)) restrictionLines.push(clean.replace(/\.$/, '') + '.');
  });
  var floorBits = [];
  var adjustable = /free adjustable base[\s\S]{0,220}/i.exec(raw);
  if (adjustable && /\$599/.test(adjustable[0]) && /\$799/.test(adjustable[0]) && /\$1,?199/.test(adjustable[0])) {
    floorBits.push('Free adjustable base upgrade on the same size. Twin sets must be over $599. Queen sets must be over $799. King sets must be over $1,199.');
  }
  if (headline.power) floorBits.push('Dallas Saddle power sectional is ' + promoMoneyToken_(headline.power.now) + '.');
  if (kaneSheet) floorBits.push('The full item list is in the promotion.');
  var main = null;
  financing.forEach(function (term) {
    if (term.highlight) main = term;
  });
  if (!main) financing.forEach(function (term) { if (!main && term.zeroInterest) main = term; });
  if (!main && financing.length) main = financing[0];
  var mattressLines = [];
  raw.split('\n').forEach(function (line) {
    if (!/davey/i.test(line)) return;
    var prices = promoMoneyList_(line);
    if (prices.length < 2) return;
    var sale = promoMoneyToken_(prices[prices.length - 1].replace(/[$,\s]/g, ''));
    if (/qn|queen/i.test(line)) mattressLines.push('Queen: ' + sale);
    if (/kg|king/i.test(line) && !/queen/i.test(line)) mattressLines.push('King: ' + sale);
  });
  if (!mattressLines.length && !kaneSheet) {
    raw.split('\n').forEach(function (line) {
      if (/^(queen|king)\b/i.test(line.trim()) && /\$\d/.test(line)) {
        var clean = line.replace(/\s+/g, ' ').trim();
        if (mattressLines.indexOf(clean) === -1) mattressLines.push(clean);
      }
    });
  }
  var beddingFinance = parseBeddingFinance_(raw) || 'Size-based qualifying amounts are not in the approved promotion.';
  return {
    name: name,
    start: window.start,
    end: window.end,
    approved: 'no',
    highlights: highlights.slice(0, 4),
    featured: featured,
    floorNote: floorBits.join(' '),
    mattressName: /davey euro top/i.test(raw) ? 'Davey Euro Top' : '',
    mattressOff: /davey euro top[\s\S]{0,240}50\s*%/i.test(raw) ? '50% OFF' : '',
    mattressLines: mattressLines,
    mattressNote: /cannot be further discounted/i.test(raw)
      ? 'Mattress sets can count toward the minimum purchase. They cannot be discounted more.'
      : (/not automatically eligible/i.test(raw) ? 'Mattresses are not automatically eligible for additional discounts. Only an explicitly approved special applies.' : ''),
    exclusions: exclusions,
    restrictions: restrictionLines.join(' '),
    beddingFinance: beddingFinance,
    financing: financing,
    financingUnread: financing.length === 0,
    offersUnread: highlights.length === 0 && featured.length === 0,
    marquee: marquee,
    mainFinance: main ? main.summary : '',
    fullText: raw.slice(0, 20000),
  };
}

function promoFactNumbers_(text) {
  var found = [];
  var match;
  var pattern = /\$[\d,]+(?:\.\d{2})?|\d{1,3}\s*%/g;
  while ((match = pattern.exec(String(text || '')))) found.push(match[0].replace(/[\s,]/g, '').toLowerCase());
  return found;
}

function comparePromotions_(before, after) {
  var changes = [];
  function add(label, from, to) {
    if (String(from || '') === String(to || '')) return;
    changes.push({ label: label, from: String(from || '—'), to: String(to || '—') });
  }
  add('Sale name', before && before.name, after.name);
  add('Start date', before && before.start, after.start);
  add('End date', before && before.end, after.end);
  add('Marquee', before && before.marquee, after.marquee);
  var oldHighlights = (before && before.highlights) || [];
  var newHighlights = after.highlights || [];
  newHighlights.forEach(function (line) {
    if (oldHighlights.indexOf(line) === -1) add('Selling point added', '—', line);
  });
  oldHighlights.forEach(function (line) {
    if (newHighlights.indexOf(line) === -1) add('Selling point removed', line, '—');
  });
  var oldFeatured = {};
  ((before && before.featured) || []).forEach(function (item) { oldFeatured[item.name] = item; });
  var newFeatured = {};
  (after.featured || []).forEach(function (item) { newFeatured[item.name] = item; });
  Object.keys(newFeatured).forEach(function (name) {
    var prior = oldFeatured[name];
    var item = newFeatured[name];
    if (!prior) {
      add(name, '—', promoMoneyToken_(item.now));
      return;
    }
    add(name + ' was', promoMoneyToken_(prior.was), promoMoneyToken_(item.was));
    add(name + ' now', promoMoneyToken_(prior.now), promoMoneyToken_(item.now));
    add(name + ' off', prior.off, item.off);
  });
  Object.keys(oldFeatured).forEach(function (name) {
    if (!newFeatured[name]) add(name, promoMoneyToken_(oldFeatured[name].now), '—');
  });
  var oldTerms = {};
  ((before && before.financing) || []).forEach(function (term) { oldTerms[String(term.months)] = term; });
  if (after.financingUnread) {
    add('Financing', 'Not copied from the old sale', 'Not read from this PDF');
  } else {
    (after.financing || []).forEach(function (term) {
      var prior = oldTerms[String(term.months)];
      var label = term.months + '-month financing';
      if (!prior) {
        add(label, '—', term.summary);
        return;
      }
      add(label + ' end date', prior.end, term.end);
      if (!!prior.zeroInterest !== !!term.zeroInterest) add(label + ' 0%', prior.zeroInterest ? 'yes' : 'no', term.zeroInterest ? 'yes' : 'no');
      var oldNumbers = promoFactNumbers_(prior.summary);
      var newNumbers = promoFactNumbers_(term.summary);
      var missing = oldNumbers.filter(function (token) { return newNumbers.indexOf(token) === -1; });
      var added = newNumbers.filter(function (token) { return oldNumbers.indexOf(token) === -1; });
      var addedRule = (/credit card/i.test(term.summary) && !/credit card/i.test(prior.summary))
        || (/equal monthly/i.test(term.summary) && !/equal monthly/i.test(prior.summary));
      if (missing.length || added.length || addedRule) add(label + ' terms', prior.summary, term.summary);
      delete oldTerms[String(term.months)];
    });
    Object.keys(oldTerms).forEach(function (months) {
      add(months + '-month financing', oldTerms[months].summary, 'Not in the new PDF');
    });
  }
  if (after.offersUnread) add('Offers', 'Not copied from the old sale', 'Not read from this PDF');
  var oldExcluded = ((before && before.exclusions) || []).join(', ');
  var newExcluded = (after.exclusions || []).join(', ');
  add('Exclusions', oldExcluded, newExcluded);
  add('Restrictions', before && before.restrictions, after.restrictions);
  add('Bedding financing', before && before.beddingFinance, after.beddingFinance);
  return changes;
}

function latestApprovedPromotion_() {
  var best = null;
  promoBodies_().forEach(function (row) {
    if (row.id === 'pending' || String(row.body.approved) !== 'yes') return;
    if (!best || String(row.body.end) > String(best.end) || (row.body.end === best.end && row.id === 'current')) best = row.body;
  });
  return best;
}

function reviewPromotionPdf_(payload) {
  var fileName = String(payload.fileName || '').trim();
  if (!/\.pdf$/i.test(fileName)) throw new Error('Upload the promotion as a PDF.');
  var bytes = Utilities.base64Decode(String(payload.base64 || ''));
  if (!bytes || !bytes.length) throw new Error('The PDF was empty. Nothing was saved.');
  var blob = Utilities.newBlob(bytes, 'application/pdf', fileName);
  var text = pdfText_(blob);
  var parsed = parsePromotionText_(text);
  parsed.sourceFile = fileName;
  parsed.approved = 'no';
  var prior = latestApprovedPromotion_();
  parsed.changes = comparePromotions_(prior, parsed);
  parsed.comparedWith = prior ? prior.name + ' ' + prior.start + ' through ' + prior.end : 'No earlier approved sale';
  upsertPromo_('pending', parsed);
  var page = morning_(payload);
  page.review = {
    file: fileName,
    comparedWith: parsed.comparedWith,
    changes: parsed.changes,
    financingUnread: !!parsed.financingUnread,
    offersUnread: !!parsed.offersUnread,
  };
  return page;
}

function health_(payload) {
  var facts = dailyFacts_();
  var yesterday = shiftDate_(todayNy_(), -1);
  var row = facts.filter(function (item) { return item.date === yesterday; })[0];
  var current = row && row.snapWritten !== null && row.nwdsrWritten !== null && row.nwdsrDelivered !== null;
  var tracked = typeof alertsTracked_ === 'function' && alertsTracked_();
  var quality = tracked ? qualityHealth_() : null;
  var status = tracked ? alertStatus_(activeAlerts_()) : current ? 'Current' : 'Report Missing';
  var rows = sheet_('CC_Health').map(function (item) {
    var key = String(item.key);
    var value = key === 'status' ? status : String(item.value);
    return { key: key, value: value };
  });
  if (!rows.some(function (item) { return item.key === 'status'; })) rows.unshift({ key: 'status', value: status });
  var exceptions = sheet_('CC_Exceptions').filter(function (item) {
    if (tracked && String(item.severity) === 'Report Missing') return false;
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
    quality: quality,
    backups: typeof backupHealth_ === 'function' ? backupHealth_() : null,
  };
}

function healthValue_(key) {
  var match = sheet_('CC_Health').filter(function (row) { return String(row.key) === key; })[0];
  return match ? String(match.value) : '';
}
