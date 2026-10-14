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

function sellingLeft_(today, periodEnd) {
  var days = sheet_('CC_SellingDays').map(function (row) {
    return { date: isoDate_(row.date), selling: /^y(es)?|true|1$/i.test(String(row.selling || '')) };
  }).filter(function (row) { return row.date; });
  if (!days.length) return null;
  return days.filter(function (day) { return day.selling && day.date >= today && day.date <= periodEnd; }).length;
}

function pace_(goal, actual, daysLeft) {
  if (actual === null) return { remaining: null, pace: null };
  var remaining = Math.round((Number(goal) - actual) * 100) / 100;
  if (daysLeft === null || daysLeft <= 0) return { remaining: remaining, pace: null };
  return { remaining: remaining, pace: Math.round((remaining / daysLeft) * 100) / 100 };
}

function peopleRows_() {
  var totals = {};
  sheet_('CC_AssociateDays').forEach(function (row) {
    if (String(row.role) === 'management' || String(row.role) === 'unknown') return;
    var name = String(row.display_name || '');
    if (!name || row.amount === '' || row.amount === null) return;
    totals[name] = (totals[name] || 0) + Number(row.amount);
  });
  var roster = sheet_('CC_People').filter(function (row) { return String(row.role) !== 'management'; });
  var rows = roster.length ? roster.map(function (row) {
    var name = String(row.name);
    var written = Object.prototype.hasOwnProperty.call(totals, name) ? Math.round(totals[name] * 100) / 100 : numberOrNull_(row.written);
    return { name: name, written: written, role: String(row.role || 'associate') };
  }) : Object.keys(totals).map(function (name) {
    return { name: name, written: Math.round(totals[name] * 100) / 100, role: 'associate' };
  });
  return rows.sort(function (left, right) { return (right.written || -999999) - (left.written || -999999); });
}

function attention_(facts, config, role) {
  var items = [];
  var yesterday = shiftDate_(todayNy_(), -1);
  var written = facts.filter(function (row) { return row.date === yesterday; })[0];
  if (!written || written.snapWritten === null) items.push('SNAP Written for ' + yesterday + ' has not arrived. Last verified figures stay in place.');
  if (!written || written.nwdsrDelivered === null) items.push('NWDSR Delivered for ' + yesterday + ' has not arrived.');
  facts.forEach(function (row) {
    if (row.snapWritten !== null && row.snapWritten < 0) {
      items.push(row.date + ' SNAP Written is ' + moneyText_(row.snapWritten) + ' and is flagged for review.');
    }
  });
  sheet_('CC_Exceptions').slice(-8).forEach(function (row) {
    if (role === 'sales' && /management|password|credential/i.test(String(row.message))) return;
    items.push(String(row.message));
  });
  if (!items.length) items.push('No operational exceptions are open.');
  return items.slice(0, 8);
}

function home_(payload) {
  var config = config_();
  var facts = dailyFacts_();
  var start = String(config.store_period_start || '2026-10-02');
  var end = String(config.store_period_end || '2026-11-01');
  var today = todayNy_();
  var yesterday = shiftDate_(today, -1);
  var snap = sumField_(facts, 'snapWritten', start, end);
  var delivered = sumField_(facts, 'nwdsrDelivered', start, end);
  var daysLeft = sellingLeft_(today, end);
  var writtenPace = pace_(config.written_goal, snap, daysLeft);
  var deliveredPace = pace_(config.delivered_goal, delivered, daysLeft);
  var yesterdayRow = facts.filter(function (row) { return row.date === yesterday; })[0] || null;
  var latest = facts.filter(function (row) { return row.snapWritten !== null; }).map(function (row) { return row.date; }).sort().pop() || '';
  var metrics = {};
  sheet_('CC_Metrics').forEach(function (row) { metrics[String(row.key)] = row; });
  var bedding = metrics.bedding_percent ? numberOrNull_(metrics.bedding_percent.value) : null;
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    updated: healthValue_('last_calculation') || 'Not Available',
    period: start + ' through ' + end,
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
      writtenGoal: Number(config.written_goal),
      deliveredGoal: Number(config.delivered_goal),
      writtenLeft: writtenPace.remaining,
      deliveredLeft: deliveredPace.remaining,
    },
    todayGoal: {
      written: writtenPace.pace,
      delivered: deliveredPace.pace,
      daysLeft: daysLeft,
    },
    bedding: {
      value: bedding,
      note: metrics.bedding_percent ? String(metrics.bedding_percent.note || '') : '',
      goal: Number(config.bedding_minimum || 0.2),
    },
    closing: { value: null, goal: Number(config.closing_goal || 0.5) },
    attachment: { value: null, goal: Number(config.attachment_goal || 0.9) },
    attention: attention_(facts, config, payload.session.role),
    people: peopleRows_().slice(0, 8),
  };
}

function daily_(payload) {
  var facts = dailyFacts_();
  return {
    role: payload.session.role,
    period: String(config_().store_period_start || '') + ' through ' + String(config_().store_period_end || ''),
    updated: healthValue_('last_calculation') || 'Not Available',
    days: facts,
  };
}

function people_(payload) {
  return { role: payload.session.role, people: peopleRows_(), updated: healthValue_('last_calculation') || 'Not Available' };
}

function morning_(payload) {
  var home = home_(payload);
  return {
    role: payload.session.role,
    title: 'Morning meeting',
    date: home.today,
    period: home.period,
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
  var rows = sheet_('CC_Health').map(function (row) {
    return { key: String(row.key), value: String(row.value) };
  });
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    rows: rows,
    imports: sheet_('CC_Imports').slice(-12).map(function (row) {
      return { file: String(row.file_name || row.sha256 || ''), status: String(row.status || ''), note: String(row.note || '') };
    }),
  };
}

function healthValue_(key) {
  var match = sheet_('CC_Health').filter(function (row) { return String(row.key) === key; })[0];
  return match ? String(match.value) : '';
}
