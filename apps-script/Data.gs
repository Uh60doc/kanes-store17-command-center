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
  if (value === null) return 0.4;
  if (value === 0.5 && PropertiesService.getScriptProperties().getProperty('closing_goal_set_40') !== 'yes') return 0.4;
  return value;
}

function ensureClosingGoal_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('closing_goal_set_40') === 'yes') return;
  var tab = SpreadsheetApp.openById(SPREADSHEET_ID_).getSheetByName('CC_Config');
  if (!tab) return;
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === 'closing_goal' && Number(values[r][1]) === 0.5) tab.getRange(r + 1, 2).setValue(0.4);
  }
  props.setProperty('closing_goal_set_40', 'yes');
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

function peopleRows_(individualStart, individualEnd) {
  var totals = {};
  var seenAny = {};
  var days = {};
  sheet_('CC_AssociateDays').forEach(function (row) {
    if (String(row.role) === 'management' || String(row.role) === 'unknown' || String(row.role) === 'former') return;
    var name = String(row.display_name || '');
    if (!name) return;
    seenAny[name] = true;
    var date = isoDate_(row.date);
    if (!date || date < individualStart || date > individualEnd) return;
    if (row.amount === '' || row.amount === null) return;
    totals[name] = (totals[name] || 0) + Number(row.amount);
    if (!days[name]) days[name] = [];
    days[name].push({ date: date, snapWritten: Math.round(Number(row.amount) * 100) / 100 });
  });
  var goals = approvedGoals_(config_());
  var closingFacts = loadClosing_();
  var roster = sheet_('CC_People').filter(activePerson_);
  var rows = roster.length ? roster.map(function (row) {
    var name = String(row.name);
    var written = Object.prototype.hasOwnProperty.call(totals, name)
      ? Math.round(totals[name] * 100) / 100
      : (seenAny[name] ? null : numberOrNull_(row.written));
    return personRecord_(name, written, String(row.role || 'associate'), days[name] || [], goals, personClosing_(closingFacts, name, individualStart, individualEnd, goals.closing));
  }) : Object.keys(totals).map(function (name) {
    return personRecord_(name, Math.round(totals[name] * 100) / 100, 'associate', days[name] || [], goals, personClosing_(closingFacts, name, individualStart, individualEnd, goals.closing));
  });
  return rows;
}

function personRecord_(name, snapWritten, role, days, goals, closing) {
  closing = closing || { customers: null, opportunities: null, ratio: null, reconcile: false, versusGoal: null, note: '', goal: goals.closing };
  return {
    name: name,
    role: role,
    written: snapWritten,
    snapWritten: snapWritten,
    nwdsrWritten: null,
    nwdsrDelivered: null,
    monthlyGoal: null,
    purchasingCustomers: closing.customers,
    opportunities: closing.opportunities,
    closingRatio: closing.ratio,
    closingReconcile: closing.reconcile,
    closingVersus: closing.versusGoal,
    closingNote: closing.note,
    closing: closing,
    days: days.sort(function (left, right) { return left.date < right.date ? -1 : 1; }),
    kpis: [
      kpiRow_('Bedding', null, null, goals.bedding, 'percent', ''),
      kpiRow_('Mattress Protectors', null, null, goals.mattress, 'percent', ''),
      kpiRow_('Fabric Maintenance', null, null, goals.fabric, 'percent', ''),
      kpiRow_('Leather Maintenance', null, null, goals.leather, 'percent', ''),
      kpiRow_('Power Maintenance', null, null, goals.power, 'percent', ''),
      kpiRow_('Wood Maintenance', null, null, goals.wood, 'percent', ''),
      kpiRow_('Overall Maintenance', null, null, goals.maintenance, 'percent', ''),
      kpiRow_('Rugs', null, null, goals.rugs, 'count', ''),
      kpiRow_('Average Ticket', null, null, goals.averageTicket, 'dollars', ''),
      kpiRow_('Closing Ratio', closing.ratio, null, goals.closing, 'percent', closing.note, closing.reconcile),
    ],
  };
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

function coverageEnd_(dates, values) {
  var present = [];
  var i;
  for (i = 0; i < dates.length; i += 1) {
    if (Object.prototype.hasOwnProperty.call(values, dates[i])) present.push(dates[i]);
  }
  if (!present.length) return null;
  var latest = present[present.length - 1];
  for (i = 0; i < dates.length; i += 1) {
    if (dates[i] > latest) break;
    if (!Object.prototype.hasOwnProperty.call(values, dates[i])) return null;
  }
  return latest;
}

function coveredTotal_(dates, values) {
  var end = coverageEnd_(dates, values);
  if (end === null) return null;
  var total = 0;
  var i;
  for (i = 0; i < dates.length; i += 1) {
    if (dates[i] > end) break;
    total += values[dates[i]];
  }
  return total;
}

function officialClosing_(periodCustomers, periodOpportunities, dates, customers, opportunities) {
  if (periodCustomers !== null && periodOpportunities !== null) {
    var periodRatio = closingRatio_(periodCustomers, periodOpportunities);
    return { customers: periodCustomers, opportunities: periodOpportunities, ratio: periodRatio.ratio, reconcile: periodRatio.reconcile };
  }
  var customerEnd = periodCustomers === null ? coverageEnd_(dates, customers) : null;
  var opportunityEnd = periodOpportunities === null ? coverageEnd_(dates, opportunities) : null;
  var customerTotal = periodCustomers !== null ? periodCustomers : coveredTotal_(dates, customers);
  var opportunityTotal = periodOpportunities !== null ? periodOpportunities : coveredTotal_(dates, opportunities);
  var sameDaily = periodCustomers === null && periodOpportunities === null && customerEnd !== null && customerEnd === opportunityEnd;
  var computed = sameDaily ? closingRatio_(customerTotal, opportunityTotal) : { ratio: null, reconcile: false };
  return { customers: customerTotal, opportunities: opportunityTotal, ratio: computed.ratio, reconcile: computed.reconcile };
}

function versusGoal_(ratio, goal, reconcile) {
  if (ratio === null || goal === null) return null;
  if (reconcile || ratio > 1) return 'Reconcile';
  return ratio >= goal ? 'At or above goal' : 'Below goal';
}

function closingSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Closing');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Closing');
  tab.getRange(1, 1, 1, 11).setValues([['date', 'scope', 'employee_code', 'display_name', 'customers', 'opportunities', 'period_start', 'period_end', 'source', 'final', 'note']]);
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
  tab.appendRow([
    row.date || '',
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
      final: String(row.final || '').toLowerCase() === 'yes',
      note: String(row.note || ''),
    };
  }).filter(function (row) { return row.start && row.end; });
}

function loadClosing_() {
  try {
    ensureClosingFacts_();
    return readClosing_();
  } catch (error) {
    try { appendException_('Update Failed', 'Closing counts could not be read. Ratios stay Not Available.'); } catch (ignore) {}
    return [];
  }
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
  facts.forEach(function (row) {
    if (row.scope !== scope || row.start !== row.end || row[field] === null) return;
    if (scope === 'store' && row.code) return;
    if (scope === 'person' && !rowMatchesPerson_(row, personName)) return;
    map[row.start] = row[field];
  });
  return map;
}

function periodCount_(facts, scope, personName, start, end, field, finalOnly) {
  var chosen = null;
  facts.forEach(function (row) {
    if (row.scope !== scope || row.start !== start || row.end !== end || row.start === row.end || row[field] === null) return;
    if (finalOnly && !row.final) return;
    if (scope === 'store' && row.code) return;
    if (scope === 'person' && !rowMatchesPerson_(row, personName)) return;
    if (!chosen || (row.final && !chosen.final)) chosen = row;
  });
  return chosen ? chosen[field] : null;
}

function elapsedDates_(period, today, closed) {
  var dates = [];
  eachDate_(period.start, period.end).forEach(function (date) {
    if (date <= today && !closed[date]) dates.push(date);
  });
  return dates;
}

function storeMonthClosing_(facts, period, today, closed, goal) {
  var dates = elapsedDates_(period, today, closed);
  var result = officialClosing_(
    periodCount_(facts, 'store', '', period.start, period.end, 'customers', false),
    periodCount_(facts, 'store', '', period.start, period.end, 'opportunities', true),
    dates,
    dailyCountMap_(facts, 'store', '', 'customers'),
    dailyCountMap_(facts, 'store', '', 'opportunities')
  );
  var verified = facts.filter(function (row) {
    return row.scope === 'store' && !row.code && row.start === row.end && row.customers !== null && row.start >= period.start && row.start <= period.end;
  }).sort(function (left, right) { return left.start < right.start ? -1 : 1; });
  var note = verified.length
    ? 'Verified Net Written purchasing customers: ' + verified.map(function (row) { return row.start + ' is ' + row.customers; }).join(', ') + '. A day without a count is Not Available, not zero.'
    : 'No Net Written purchasing-customer count is on file for this store month.';
  if (result.opportunities === null) note += ' No location PERQ covers ' + period.start + ' through ' + period.end + '.';
  if (result.reconcile) note += ' The ratio is above 100% and is flagged for reconciliation.';
  return {
    customers: result.customers,
    opportunities: result.opportunities,
    ratio: result.ratio,
    reconcile: result.reconcile,
    versusGoal: versusGoal_(result.ratio, goal, result.reconcile),
    note: note,
  };
}

function dayClosing_(facts, date, goal) {
  var customers = null;
  var opportunities = null;
  facts.forEach(function (row) {
    if (row.scope !== 'store' || row.code || row.start !== date || row.end !== date) return;
    if (row.customers !== null) customers = row.customers;
    if (row.opportunities !== null) opportunities = row.opportunities;
  });
  var computed = closingRatio_(customers, opportunities);
  var note = '';
  if (customers === null || opportunities === null) note = 'Purchasing customers and opportunities are not both on file for this day.';
  if (customers !== null && opportunities === null) note = 'Opportunities for this day are Not Available, so the ratio was not calculated.';
  if (opportunities !== null && customers === null) note = 'Purchasing customers for this day are Not Available, so the ratio was not calculated.';
  if (opportunities === 0) note = 'Zero opportunities. The ratio was not divided.';
  if (computed.reconcile) note = 'Above 100%. Flagged for reconciliation.';
  return {
    customers: customers,
    opportunities: opportunities,
    ratio: computed.ratio,
    reconcile: computed.reconcile,
    versusGoal: versusGoal_(computed.ratio, goal, computed.reconcile),
    note: note,
  };
}

function personClosing_(facts, name, start, end, goal) {
  var dates = eachDate_(start, end).filter(function (date) { return date <= todayNy_(); });
  var result = officialClosing_(
    periodCount_(facts, 'person', name, start, end, 'customers', false),
    periodCount_(facts, 'person', name, start, end, 'opportunities', true),
    dates,
    dailyCountMap_(facts, 'person', name, 'customers'),
    dailyCountMap_(facts, 'person', name, 'opportunities')
  );
  var interim = null;
  facts.forEach(function (row) {
    if (row.scope !== 'person' || row.final || row.start !== start || row.end !== end || row.opportunities === null) return;
    if (!rowMatchesPerson_(row, name)) return;
    interim = row;
  });
  var opportunities = result.opportunities;
  var note = '';
  if (opportunities === null && interim) {
    opportunities = interim.opportunities;
    note = interim.note;
  }
  if (result.customers === null) note += (note ? ' ' : '') + 'Purchasing customers for this associate are not on file. The store customer count is not assigned to this person.';
  if (opportunities === null) note += (note ? ' ' : '') + 'PERQ opportunities for this associate are not on file. No zero was added.';
  if (result.reconcile) note += ' Above 100%. Flagged for reconciliation.';
  return {
    customers: result.customers,
    opportunities: opportunities,
    ratio: result.ratio,
    reconcile: result.reconcile,
    versusGoal: versusGoal_(result.ratio, goal, result.reconcile),
    note: note,
    goal: goal,
  };
}

function withDayClosing_(days, facts, goal) {
  return days.map(function (day) {
    var closing = dayClosing_(facts, day.date, goal);
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
  if (configBlank_(config, 'closing_goal')) putConfig_('closing_goal', 0.4);
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
  tab.getRange(1, 1, 1, 6).setValues([['metric', 'written', 'delivered', 'note', 'period_start', 'period_end']]);
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

function readKpiActuals_() {
  var map = {};
  sheet_('CC_Kpi').forEach(function (row) {
    var start = isoDate_(row.period_start);
    var end = isoDate_(row.period_end);
    if (start && start !== '2026-10-02') return;
    if (end && end !== '2026-11-01') return;
    if (!row.metric) return;
    map[String(row.metric)] = { written: fineNumber_(row.written), delivered: fineNumber_(row.delivered), note: String(row.note || '') };
  });
  if (!Object.keys(map).length) {
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
      return {
        name: spec[0],
        unit: spec[1],
        goal: spec[2],
        written: closing.ratio,
        delivered: null,
        note: closing.ratio === null ? 'Needs Net Written customers and PERQ for the same dates.' : '',
        reconcile: !!closing.reconcile,
      };
    }
    var row = actuals[spec[0]] || { written: null, delivered: null, note: '' };
    return { name: spec[0], unit: spec[1], goal: spec[2], written: row.written, delivered: row.delivered, note: row.note || '', reconcile: false };
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
  try { ensureClosingGoal_(); } catch (error) { appendException_('Update Failed', 'The closing-ratio goal could not be updated.'); }
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
  var closingFacts = loadClosing_();
  var closingGoal = closingGoal_(config);
  var monthClosing = storeMonthClosing_(closingFacts, store, today, closed, closingGoal);
  var yesterdayClosing = dayClosing_(closingFacts, yesterday, closingGoal);
  var missing = days.filter(function (day) {
    return day.date < today && !closed[day.date] && (day.snapWritten === null || day.nwdsrDelivered === null);
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
  var facts = loadClosing_();
  var goal = closingGoal_(config_());
  return {
    role: payload.session.role,
    period: store.start + ' through ' + store.end,
    updated: healthValue_('last_calculation') || 'Not Available',
    goal: goal,
    closing: storeMonthClosing_(facts, store, today, closed, goal),
    days: withDayClosing_(storeCalendar_(dailyFacts_(), store, closed), facts, goal),
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
    return {
      name: person.name,
      mattressWritten: null,
      mattressDelivered: null,
      writtenPercent: null,
      deliveredPercent: null,
      units: null,
      protectorPercent: null,
      protectorUnits: null,
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

function people_(payload) {
  var individual = individualPeriodContaining_(todayNy_());
  return {
    role: payload.session.role,
    period: individual.start + ' through ' + individual.end,
    people: peopleRows_(individual.start, individual.end),
    updated: healthValue_('last_calculation') || 'Not Available',
  };
}

function morning_(payload) {
  var home = home_(payload);
  return {
    role: payload.session.role,
    title: 'Morning meeting',
    date: home.today,
    period: home.period,
    individualPeriod: home.individualPeriod,
    updated: home.updated,
    yesterday: home.yesterday,
    month: home.month,
    todayGoal: home.todayGoal,
    bedding: home.bedding,
    closing: home.closing,
    people: home.people.slice(0, 4),
    attention: home.attention,
  };
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
