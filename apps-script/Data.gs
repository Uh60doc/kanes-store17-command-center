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

function goalOr_(config, key, fallback) {
  if (!Object.prototype.hasOwnProperty.call(config, key) || config[key] === '' || config[key] === null || config[key] === undefined) return fallback;
  return numberOrNull_(config[key]);
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
    mattress: goalOr_(config, 'mattress_protector_goal', 1),
    fabric: goalOr_(config, 'fabric_maintenance_goal', null),
    leather: goalOr_(config, 'leather_maintenance_goal', null),
    power: goalOr_(config, 'power_maintenance_goal', null),
    wood: goalOr_(config, 'wood_maintenance_goal', null),
    maintenance: goalOr_(config, 'overall_maintenance_goal', null),
    rugs: goalOr_(config, 'rugs_goal', null),
    averageTicket: goalOr_(config, 'average_ticket_goal', 2500),
    closing: closingGoal_(config),
    opportunities: goalOr_(config, 'opportunities_goal', null),
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

function kpiRow_(name, written, delivered, goal, unit, note) {
  return { name: name, written: written, delivered: delivered, goal: goal, unit: unit, note: note || '' };
}

function storeKpis_(config, metrics, bedding) {
  var goals = approvedGoals_(config);
  var beddingNote = metrics.bedding_percent ? String(metrics.bedding_percent.note || '') : '';
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
    kpiRow_('Closing Ratio', null, null, goals.closing, 'percent', 'Needs closed customers and customer opportunities for the same store month.'),
    kpiRow_('Customer Opportunities', null, null, goals.opportunities, 'count', 'A full store-month opportunity count is not on file.'),
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
  var roster = sheet_('CC_People').filter(activePerson_);
  var rows = roster.length ? roster.map(function (row) {
    var name = String(row.name);
    var written = Object.prototype.hasOwnProperty.call(totals, name)
      ? Math.round(totals[name] * 100) / 100
      : (seenAny[name] ? null : numberOrNull_(row.written));
    return personRecord_(name, written, String(row.role || 'associate'), days[name] || [], goals);
  }) : Object.keys(totals).map(function (name) {
    return personRecord_(name, Math.round(totals[name] * 100) / 100, 'associate', days[name] || [], goals);
  });
  return rows;
}

function personRecord_(name, snapWritten, role, days, goals) {
  return {
    name: name,
    role: role,
    written: snapWritten,
    snapWritten: snapWritten,
    nwdsrWritten: null,
    nwdsrDelivered: null,
    monthlyGoal: null,
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
      kpiRow_('Closing Ratio', null, null, goals.closing, 'percent', ''),
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

function home_(payload) {
  try { ensureClosingGoal_(); } catch (error) { appendException_('Update Failed', 'The closing-ratio goal could not be updated.'); }
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
  var daysLeft = operatingDaysRemaining_(store, today, closed);
  var writtenPace = pace_(writtenGoal, snap, daysLeft);
  var deliveredPace = pace_(deliveredGoal, delivered, daysLeft);
  var yesterdayRow = facts.filter(function (row) { return row.date === yesterday; })[0] || null;
  var latest = facts.filter(function (row) { return row.snapWritten !== null && row.date >= start && row.date <= end; }).map(function (row) { return row.date; }).sort().pop() || '';
  var metrics = {};
  sheet_('CC_Metrics').forEach(function (row) { metrics[String(row.key)] = row; });
  var bedding = metrics.bedding_percent ? numberOrNull_(metrics.bedding_percent.value) : null;
  var missing = days.filter(function (day) {
    return day.date < today && !closed[day.date] && (day.snapWritten === null || day.nwdsrDelivered === null);
  });
  var attention = attention_(facts, config, payload.session.role);
  if (missing.length) {
    attention.unshift(missing.length <= 4
      ? 'Store reports are incomplete for ' + missing.map(function (day) { return day.date; }).join(', ') + '. Blank is not zero.'
      : missing.length + ' store days are missing a verified report. Blank is not zero.');
  }
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
    closing: { value: null, goal: closingGoal_(config) },
    goals: approvedGoals_(config),
    scoreboard: scoreboard_(config, snap, delivered, writtenGoal, deliveredGoal, writtenPace, deliveredPace, daysLeft, yesterdayRow, yesterday, missing),
    kpis: storeKpis_(config, metrics, bedding),
    attachment: { value: null, goal: Number(config.attachment_goal || 0.9) },
    attention: attention.slice(0, 8),
    people: peopleRows_(individual.start, individual.end).slice(0, 8),
  };
}

function daily_(payload) {
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var closed = closedDates_();
  return {
    role: payload.session.role,
    period: store.start + ' through ' + store.end,
    updated: healthValue_('last_calculation') || 'Not Available',
    days: storeCalendar_(dailyFacts_(), store, closed),
  };
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
