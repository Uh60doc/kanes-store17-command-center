/**
 * Three-month evaluations. A cycle is named for its issue month (2026-11) and covers the last three completed
 * salesperson months (August 1-31, September 1-30, October 1-31), never the store operating period.
 *
 * CC_EvalMetrics holds one value per associate, month and metric with its source. Rows are appended, never edited;
 * the latest row wins and earlier rows stay as the record of what was reported. CC_Evaluations holds one row per
 * cycle and associate with the editable coaching text and the status. An approved evaluation is frozen: its
 * snapshot and workbook are archived in CC_EvalArchive and Drive, and later data changes never alter it.
 */
var EVAL_STATUSES_ = ['Draft', 'Ready for Review', 'Approved', 'Given to Associate'];
var EVAL_MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var EVAL_METRIC_HEADERS_ = ['month', 'name', 'employee_id', 'metric', 'value', 'unit', 'status', 'source', 'note', 'recorded_at', 'recorded_by', 'origin'];
var EVAL_HEADERS_ = ['cycle', 'name', 'employee_id', 'status', 'revision', 'template', 'volume_goal', 'focus1_metric', 'focus1_prior', 'focus1_goal', 'focus1_plan', 'focus2_metric', 'focus2_prior', 'focus2_goal', 'focus2_plan', 'recognition', 'comments', 'manager_name', 'prepared_at', 'ready_at', 'approved_at', 'approved_by', 'given_on', 'given_recorded_at', 'given_by', 'updated_at', 'source', 'note', 'goals_json'];
var EVAL_ARCHIVE_HEADERS_ = ['archived_at', 'cycle', 'name', 'revision', 'kind', 'file_id', 'file_name', 'sha256', 'bytes', 'snapshot_json', 'note'];
var EVAL_EDITABLE_ = ['volume_goal', 'focus1_metric', 'focus1_prior', 'focus1_goal', 'focus1_plan', 'focus2_metric', 'focus2_prior', 'focus2_goal', 'focus2_plan', 'recognition', 'comments', 'manager_name', 'template'];

/**
 * Rows follow the established evaluation format. Standard goals are the company sales goal metrics with the approved
 * 80% Fabric, Leather and Power; new-hire goals (under 90 days) are the established new-hire template. CC_Config keys
 * eval_goal_<key> and eval_new_hire_goal_<key> replace a goal without a code change.
 */
var EVAL_METRICS_ = [
  { key: 'volume', label: 'Sales Volume', source: 'SPR TOTAL line 8', unit: 'dollars', standard: null, newHire: null },
  { key: 'average', label: 'Average Sale', source: 'WDSRR', unit: 'dollars', standard: 2500, newHire: 2100 },
  { key: 'mattress', label: 'Mattress % of Total Sales', source: 'WDSRR', unit: 'percent', standard: 0.2, newHire: 0.15 },
  { key: 'adjBase', label: 'Adjustable Base Attachment (MPPA)', source: 'WDSRR', unit: 'percent', standard: 0.35, newHire: 0.3 },
  { key: 'pillows', label: 'Pillows (MPPA)', source: 'WDSRR', unit: 'percent', standard: 0.65, newHire: { count: 5 } },
  { key: 'protector', label: 'Mattress Protector Attachment (MPPA)', source: 'WDSRR', unit: 'percent', standard: 0.8, newHire: 0.6 },
  { key: 'warranty', label: 'Overall Warranty % of Total Sales', source: 'WDSRR', unit: 'percent', standard: 0.055, newHire: 0.0425 },
  { key: 'fabric', label: 'Fabric Protection Attachment % (FABW)', source: 'WDSRR', unit: 'percent', standard: 0.8, newHire: 0.8 },
  { key: 'power', label: 'Power Upholstery Attachment % (PWAR)', source: 'WDSRR', unit: 'percent', standard: 0.8, newHire: 0.8 },
  { key: 'powerAdj', label: 'Power Adj Base Attachment % (PWAR)', source: 'WDSRR', unit: 'percent', standard: 0.5, newHire: 0.5 },
  { key: 'leather', label: 'Leather Protection Attachment % (LTHW)', source: 'WDSRR', unit: 'percent', standard: 0.8, newHire: 0.8 },
  { key: 'wood', label: 'Wood Kits / Furniture Protection (UVWL)', source: 'WDSRR', unit: 'percent', standard: 0.5, newHire: { count: 5 } },
  { key: 'finance', label: 'Finance % of Total Sales', source: 'WDSRR', unit: 'percent', standard: 0.5, newHire: 0.5 },
  { key: 'rugs', label: 'Rugs (RUGSD)', source: 'WDSRR', unit: 'count', standard: { count: 12 }, newHire: { count: 6 } },
];

var EVAL_ADVICE_ = {
  volume: 'Follow up on every be-back and open quote from the month, and set call-back appointments each shift so more of the traffic turns into written sales.',
  average: 'Present the complete room (bedding, protection and accessories) before discussing price, so each ticket reflects everything the customer needs.',
  mattress: 'Bring up sleep on every furniture sale and walk each customer through the mattress gallery.',
  adjBase: 'Demonstrate an adjustable base with every mattress presentation, starting with the customer lying down on it.',
  pillows: 'Fit the customer for a pillow on every mattress sale.',
  protector: 'Present the mattress protector with every mattress and explain that it protects the mattress warranty.',
  warranty: 'Offer protection on every ticket and explain the coverage before the total is given.',
  fabric: 'Present fabric protection on every upholstered piece and explain the stain and spill coverage before the price.',
  power: 'Present power protection on every power piece and explain the motor and mechanism coverage.',
  powerAdj: 'Offer power protection on every adjustable base.',
  leather: 'Present leather protection on every leather piece and explain the coverage for cracking, fading and spills.',
  wood: 'Offer furniture protection on every case-goods piece and dining set.',
  finance: 'Offer the financing options early on every larger sale, before the customer hears the total.',
  rugs: 'Show a rug with every living room and bedroom set.',
};

function evalTab_(name, headers) {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(name);
  if (tab) return tab;
  tab = spreadsheet.insertSheet(name);
  tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  return tab;
}

function monthKey_(year, month) { return year + '-' + pad2_(month); }

function shiftMonth_(key, delta) {
  var parts = key.split('-');
  var index = Number(parts[0]) * 12 + Number(parts[1]) - 1 + delta;
  return monthKey_(Math.floor(index / 12), (index % 12) + 1);
}

function monthLabel_(key) {
  var parts = key.split('-');
  return EVAL_MONTH_NAMES_[Number(parts[1]) - 1] + ' ' + parts[0];
}

/** The issue month and its three covered salesperson months. */
function evalCycleInfo_(cycle) {
  if (!/^\d{4}-\d{2}$/.test(String(cycle))) throw new Error('Choose an evaluation month.');
  var months = [-3, -2, -1].map(function (delta) {
    var key = shiftMonth_(cycle, delta);
    var parts = key.split('-');
    var period = periodFor_('individual', Number(parts[0]), Number(parts[1]));
    return { key: key, label: monthLabel_(key), name: EVAL_MONTH_NAMES_[Number(parts[1]) - 1], start: period.start, end: period.end };
  });
  return { cycle: cycle, label: monthLabel_(cycle), months: months, prepare: cycle + '-03', deliverBy: cycle + '-06' };
}

/** The New York calendar day of a stored ISO timestamp. */
function stampDay_(stamp) {
  var when = new Date(String(stamp));
  return isNaN(when.getTime()) ? String(stamp).slice(0, 10) : isoDate_(when);
}

function daysBetween_(start, end) {
  var a = isoParts_(start);
  var b = isoParts_(end);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

function evalGoalValue_(metric, template, config) {
  var key = (template === 'newHire' ? 'eval_new_hire_goal_' : 'eval_goal_') + metric.key;
  var configured = config[key];
  if (configured !== undefined && configured !== '' && configured !== null) {
    var text = String(configured).trim();
    var count = /^(\d+(?:\.\d+)?)\s*(?:per|\/)\s*month$/i.exec(text);
    if (count) return { count: Number(count[1]) };
    var number = Number(text.replace(/[$,%]/g, ''));
    if (isFinite(number)) return metric.unit === 'percent' && /%$/.test(text) ? number / 100 : number;
  }
  return template === 'newHire' ? metric.newHire : metric.standard;
}

function goalUnit_(metric, goal) {
  if (goal && typeof goal === 'object') return 'count';
  return metric.unit;
}

function evalNumberText_(value, unit) {
  if (value === null || value === undefined || value === '') return '';
  var number = Number(value);
  if (unit === 'dollars') return (number < 0 ? '-$' : '$') + Math.abs(Math.round(number)).toLocaleString('en-US');
  if (unit === 'percent') return (Math.round(number * 1000) / 10).toFixed(1) + '%';
  return String(Math.round(number * 100) / 100);
}

function evalGoalText_(goal, unit) {
  if (goal === null || goal === undefined || goal === '') return 'Manager sets';
  if (typeof goal === 'object') return goal.count + ' per month';
  if (unit === 'percent' && Math.round(goal * 1000) !== Math.round(goal * 10000) / 10) return (Math.round(goal * 10000) / 100).toFixed(2) + '%';
  return evalNumberText_(goal, unit);
}

function evalMetricRows_() {
  return sheet_('CC_EvalMetrics').map(function (row) {
    return {
      month: String(row.month || '').slice(0, 7),
      name: String(row.name || ''),
      metric: String(row.metric || ''),
      value: row.value === '' || row.value === null || row.value === undefined ? null : Number(row.value),
      unit: String(row.unit || ''),
      status: String(row.status || ''),
      source: String(row.source || ''),
      note: String(row.note || ''),
      recordedAt: String(row.recorded_at || ''),
      recordedBy: String(row.recorded_by || ''),
      origin: String(row.origin || ''),
    };
  });
}

/** The latest recorded value for one associate, month and metric; earlier rows stay on the sheet. */
function evalCell_(rows, month, name, metricKey) {
  var best = null;
  rows.forEach(function (row) {
    if (row.month !== month.key || row.name !== name || row.metric !== metricKey) return;
    if (!best || row.recordedAt >= best.recordedAt) best = row;
  });
  return best;
}

function evalSavedRows_() {
  return sheet_('CC_Evaluations').map(function (row) {
    var out = {};
    EVAL_HEADERS_.forEach(function (key) { out[key] = row[key] === undefined || row[key] === null ? '' : row[key]; });
    out.cycle = String(out.cycle).slice(0, 7);
    out.revision = Number(out.revision || 1);
    out.given_on = isoDate_(out.given_on) || String(out.given_on || '');
    return out;
  });
}

function evalArchiveRows_() {
  return sheet_('CC_EvalArchive').map(function (row) {
    return {
      archivedAt: String(row.archived_at || ''), cycle: String(row.cycle || '').slice(0, 7), name: String(row.name || ''), revision: Number(row.revision || 0),
      kind: String(row.kind || ''), fileId: String(row.file_id || ''), fileName: String(row.file_name || ''), sha256: String(row.sha256 || ''),
      bytes: Number(row.bytes || 0), snapshot: String(row.snapshot_json || ''), note: String(row.note || ''),
    };
  });
}

/** Associates in a cycle: on the Sales Team on the preparation day (or today, before it) and hired by the last covered day. */
function evalAssociates_(info, today, saved) {
  var on = today < info.prepare ? today : info.prepare;
  var names = [];
  var rows = sheet_('CC_People');
  rows.forEach(function (row) {
    var hired = isoDate_(row.hire_date);
    if (rosterRole_(row, on) !== 'associate') return;
    if (hired && hired > info.months[2].end) return;
    names.push(String(row.name));
  });
  saved.forEach(function (row) { if (row.cycle === info.cycle && names.indexOf(row.name) === -1) names.push(row.name); });
  return names.map(function (name) {
    var found = null;
    rows.forEach(function (row) { if (String(row.name) === name) found = row; });
    return { name: name, employeeId: found ? String(found.employee_id || '') : '', hireDate: found ? isoDate_(found.hire_date) : '' };
  });
}

/** Each associate's last approved volume goal carries forward: the goal ladder is kept, never reset. */
function carriedVolumeGoal_(saved, name, cycle) {
  var best = null;
  saved.forEach(function (row) {
    if (row.name !== name || row.cycle >= cycle) return;
    if (row.status !== 'Approved' && row.status !== 'Given to Associate') return;
    var goal = Number(row.volume_goal);
    if (row.volume_goal === '' || !isFinite(goal)) return;
    if (!best || row.cycle > best.cycle) best = { cycle: row.cycle, goal: goal };
  });
  return best;
}

function evalMetricsFor_(info, person, template, volumeGoal, rows, config, today, goalOverrides) {
  return EVAL_METRICS_.map(function (metric) {
    var goal = metric.key === 'volume' ? volumeGoal : evalGoalValue_(metric, template, config);
    if (goalOverrides && Object.prototype.hasOwnProperty.call(goalOverrides, metric.key)) goal = goalOverrides[metric.key];
    var unit = goalUnit_(metric, goal);
    var values = info.months.map(function (month) {
      var cell = evalCell_(rows, month, person.name, metric.key);
      if (cell && cell.status === 'Verified' && cell.value !== null && isFinite(cell.value)) {
        var valueUnit = cell.unit || metric.unit;
        var comparable = goal !== null && goal !== undefined && goal !== '' && valueUnit === unit;
        var target = typeof goal === 'object' && goal ? goal.count : goal;
        return { status: 'Verified', value: cell.value, unit: valueUnit, text: evalNumberText_(cell.value, valueUnit), met: comparable ? cell.value >= target - 1e-9 : null, source: cell.source, note: cell.note };
      }
      if (cell && cell.status === 'Not Available') return { status: 'Not Available', value: null, unit: metric.unit, text: 'Not available', met: null, source: cell.source, note: cell.note };
      if (person.hireDate && person.hireDate > month.end) return { status: 'Not Employed', value: null, unit: metric.unit, text: 'Not yet hired', met: null, source: '', note: 'Hired ' + person.hireDate + '.' };
      var open = month.end >= today;
      return { status: 'Pending Verification', value: null, unit: metric.unit, text: 'Pending Verification', met: null, source: metric.source, note: open ? 'The month is not complete yet.' : metric.source + ' for ' + month.label + ' is not verified yet.' };
    });
    var verified = values.filter(function (value) { return value.met !== null; });
    var notInWorkbook = goalOverrides && Object.prototype.hasOwnProperty.call(goalOverrides, metric.key) && goalOverrides[metric.key] === null;
    return {
      key: metric.key, label: metric.label, source: metric.source, unit: unit,
      goal: typeof goal === 'object' && goal ? goal.count : goal, goalText: notInWorkbook ? 'Not in workbook' : evalGoalText_(goal, unit),
      values: values,
      metText: verified.length ? verified.filter(function (value) { return value.met; }).length + ' of ' + verified.length : '—',
    };
  });
}

function latestVerified_(metric) {
  var i;
  for (i = metric.values.length - 1; i >= 0; i -= 1) if (metric.values[i].status === 'Verified' && metric.values[i].met !== null) return { index: i, value: metric.values[i] };
  return null;
}

function shortfall_(metric) {
  var latest = latestVerified_(metric);
  if (!latest || latest.value.met || !metric.goal) return null;
  return (metric.goal - latest.value.value) / metric.goal;
}

function gapText_(metric, value) {
  if (metric.unit === 'percent') {
    var points = Math.round((value - metric.goal) * 1000) / 10;
    return Math.abs(points).toFixed(1) + ' points ' + (points >= 0 ? 'above' : 'under');
  }
  var diff = value - metric.goal;
  if (metric.unit === 'count') return evalNumberText_(Math.abs(diff), metric.unit) + ' ' + (diff >= 0 ? 'above' : 'short of');
  return evalNumberText_(Math.abs(diff), metric.unit) + ' ' + (diff >= 0 ? 'above' : 'under');
}

/** Draft coaching text from verified figures only. With nothing verified, the text says so instead of guessing. */
function draftCoaching_(evaluation, info) {
  var tenureNote = '';
  if (evaluation.hireDate) {
    var hiredInCycle = evaluation.hireDate > info.months[0].start;
    if (hiredInCycle) {
      var firstMonth = null;
      info.months.forEach(function (month) { if (!firstMonth && evaluation.hireDate <= month.end) firstMonth = month; });
      var days = firstMonth ? daysBetween_(evaluation.hireDate, firstMonth.end) + 1 : 0;
      tenureNote = evaluation.shortName + ' joined Store 17 on ' + evaluation.hireDate + (firstMonth ? ', so ' + firstMonth.label + ' covers ' + days + ' of its ' + (daysBetween_(firstMonth.start, firstMonth.end) + 1) + ' days' : '') + '. Results are read with that limited selling time in mind.';
    }
  }
  var candidates = evaluation.metrics.filter(function (metric) { return shortfall_(metric) !== null; });
  candidates.sort(function (a, b) { return shortfall_(b) - shortfall_(a); });
  var met = evaluation.metrics.filter(function (metric) { var latest = latestVerified_(metric); return latest && latest.value.met; });
  var anyVerified = evaluation.metrics.some(function (metric) { return latestVerified_(metric); });
  var focus = candidates.slice(0, 2).map(function (metric) {
    var latest = latestVerified_(metric);
    var month = info.months[latest.index];
    var trail = metric.values.map(function (value, i) { return value.status === 'Verified' ? info.months[i].name + ' ' + value.text : null; }).filter(Boolean);
    var plan = month.name + ' result: ' + latest.value.text + ', ' + gapText_(metric, latest.value.value) + ' the ' + metric.goalText + ' goal.' +
      (trail.length > 1 ? ' Three-month trend: ' + trail.join(', ') + '.' : '') + ' ' + EVAL_ADVICE_[metric.key] +
      ' Review progress with a manager each week. Goal by month end: ' + metric.goalText + '.';
    return { metric: metric.label, prior: latest.value.text, goal: metric.goalText, plan: plan };
  });
  var recognition = '';
  var comments = '';
  if (!anyVerified) {
    recognition = 'Pending Verification: recognition will be written once the ' + info.months[0].name + ' through ' + info.months[2].name + ' reports are verified.';
    comments = 'Pending Verification: no verified figures are on file for ' + info.months[0].label + ' through ' + info.months[2].label + ', so no performance comments are drafted.' + (tenureNote ? ' ' + tenureNote : '');
  } else {
    var allThree = evaluation.metrics.filter(function (metric) {
      var verified = metric.values.filter(function (value) { return value.met !== null; });
      return verified.length >= 2 && verified.every(function (value) { return value.met; });
    });
    var praise = (allThree.length ? allThree : met).slice(0, 3).map(function (metric) { return metric.label.replace(/\s*\(.*\)$/, '').replace(/ %$/, ''); });
    var improved = null;
    evaluation.metrics.forEach(function (metric) {
      var verified = metric.values.filter(function (value) { return value.status === 'Verified' && value.met !== null; });
      if (verified.length < 2 || !metric.goal) return;
      var change = (verified[verified.length - 1].value - verified[0].value) / metric.goal;
      if (change > 0.05 && (!improved || change > improved.change)) improved = { metric: metric, change: change, from: verified[0].text, to: verified[verified.length - 1].text };
    });
    recognition = (praise.length ? (allThree.length ? 'Met the goal every verified month in: ' : 'At or above goal in the latest month: ') + praise.join(', ') + '.' : 'No goal was met in the latest verified month; recognize effort and any improvement noted below.') +
      (improved ? ' Improvement: ' + improved.metric.label.replace(/\s*\(.*\)$/, '') + ' moved from ' + improved.from + ' to ' + improved.to + '.' : '');
    var latestMonth = null;
    evaluation.metrics.forEach(function (metric) { var latest = latestVerified_(metric); if (latest && (latestMonth === null || latest.index > latestMonth)) latestMonth = latest.index; });
    var counted = evaluation.metrics.filter(function (metric) { var value = metric.values[latestMonth]; return value && value.met !== null; });
    var hits = counted.filter(function (metric) { return metric.values[latestMonth].met; });
    comments = evaluation.shortName + ' met ' + hits.length + ' of ' + counted.length + ' goals with verified figures in ' + info.months[latestMonth].label + '.' +
      (focus.length ? ' The two coaching focus areas for next month are ' + focus.map(function (item) { return item.metric.replace(/\s*\(.*\)$/, ''); }).join(' and ') + '.' : ' Keep the current results steady next month.') +
      (tenureNote ? ' ' + tenureNote : '');
    if (evaluation.verification !== 'Verified') comments += ' Some months are still Pending Verification; update these comments once the reports are verified.';
  }
  return { focus: focus, recognition: recognition, comments: comments };
}

function shortName_(name, preferred) {
  return preferred || String(name || '').split(' ')[0];
}

/** One evaluation as shown, printed and exported. Approved evaluations come from their frozen snapshot. */
function assembleEvaluation_(info, person, saved, rows, config, today, archive, allSaved) {
  if (saved && (saved.status === 'Approved' || saved.status === 'Given to Associate')) {
    var frozen = null;
    archive.forEach(function (entry) {
      if (entry.cycle === info.cycle && entry.name === person.name && entry.revision === saved.revision && entry.snapshot && /approved evaluation/.test(entry.kind)) frozen = entry;
    });
    if (frozen) {
      var snapshot = JSON.parse(frozen.snapshot);
      snapshot.status = saved.status;
      snapshot.givenOn = saved.given_on || '';
      snapshot.givenBy = String(saved.given_by || '');
      snapshot.frozen = true;
      snapshot.archiveFileId = frozen.fileId;
      snapshot.archiveFileName = frozen.fileName;
      return snapshot;
    }
  }
  var roster = null;
  sheet_('CC_People').forEach(function (row) { if (String(row.name) === person.name) roster = row; });
  var preferred = roster ? String(roster.preferred_name || '') : '';
  var tenure = person.hireDate ? daysBetween_(person.hireDate, info.prepare) : null;
  var template = saved && saved.template ? String(saved.template) : (tenure !== null && tenure < 90 ? 'newHire' : 'standard');
  var carried = carriedVolumeGoal_(allSaved, person.name, info.cycle);
  var historical = !!(saved && /^historical/.test(String(saved.source || '')));
  var volumeGoal = saved && saved.volume_goal !== '' && saved.volume_goal !== undefined && isFinite(Number(saved.volume_goal))
    ? Number(saved.volume_goal)
    : (historical ? null : carried ? carried.goal : (template === 'newHire' ? null : numberOrNull_(config.individual_volume_goal) || 65000));
  var goalOverrides = null;
  if (saved && saved.goals_json) {
    try { goalOverrides = JSON.parse(String(saved.goals_json)); } catch (error) { goalOverrides = null; }
  }
  var metrics = evalMetricsFor_(info, person, template, volumeGoal, rows, config, today, goalOverrides);
  var pending = [];
  metrics.forEach(function (metric) {
    metric.values.forEach(function (value, i) { if (value.status === 'Pending Verification' && pending.indexOf(info.months[i].label) === -1) pending.push(info.months[i].label); });
  });
  var evaluation = {
    cycle: info.cycle, cycleLabel: info.label, months: info.months, prepare: info.prepare, deliverBy: info.deliverBy,
    name: person.name, shortName: shortName_(person.name, preferred), employeeId: person.employeeId, hireDate: person.hireDate, tenureDays: tenure,
    store: roster ? '17' + (String(roster.store || '17') === '17' ? '' : ' / ' + roster.store) : '17',
    template: template, templateLabel: template === 'newHire' ? 'New Hire Coaching Evaluation (under 90 days)' : '3-Month Performance and Coaching Evaluation',
    status: saved ? String(saved.status) : 'Not prepared', revision: saved ? saved.revision : 0,
    verification: pending.length ? 'Pending Verification' : 'Verified', pendingMonths: pending,
    volumeGoal: volumeGoal, volumeGoalNote: historical ? 'As printed in the historical workbook.' : saved && saved.volume_goal !== '' ? 'Set in review.' : (carried ? 'Carried from the ' + monthLabel_(carried.cycle) + ' evaluation.' : (volumeGoal === null ? 'New-hire volume goal is set by the manager.' : 'Individual monthly goal on CC_Config.')),
    metrics: metrics,
    preparedAt: saved ? String(saved.prepared_at || '') : '', approvedAt: saved ? String(saved.approved_at || '') : '', approvedBy: saved ? String(saved.approved_by || '') : '',
    givenOn: saved ? saved.given_on || '' : '', givenBy: saved ? String(saved.given_by || '') : '',
    managerName: saved ? String(saved.manager_name || '') : '',
    source: saved ? String(saved.source || '') : '', note: saved ? String(saved.note || '') : '',
    frozen: false,
  };
  var draft = draftCoaching_(evaluation, info);
  evaluation.draft = draft;
  var pick = function (field, fallback) { return saved && String(saved[field] || '') !== '' ? String(saved[field]) : (historical ? '' : fallback); };
  evaluation.focus = [0, 1].map(function (i) {
    var generated = draft.focus[i] || { metric: '', prior: '', goal: '', plan: '' };
    var n = i + 1;
    return { metric: pick('focus' + n + '_metric', generated.metric), prior: pick('focus' + n + '_prior', generated.prior), goal: pick('focus' + n + '_goal', generated.goal), plan: pick('focus' + n + '_plan', generated.plan) };
  });
  evaluation.recognition = pick('recognition', draft.recognition);
  evaluation.comments = pick('comments', draft.comments);
  return evaluation;
}

function evalContext_(cycle, today) {
  var info = evalCycleInfo_(cycle);
  var saved = evalSavedRows_();
  var archive = evalArchiveRows_();
  var rows = evalMetricRows_();
  var config = config_();
  var people = evalAssociates_(info, today, saved);
  var evaluations = people.map(function (person) {
    var row = null;
    saved.forEach(function (entry) { if (entry.cycle === cycle && entry.name === person.name) row = entry; });
    return assembleEvaluation_(info, person, row, rows, config, today, archive, saved);
  });
  return { info: info, saved: saved, archive: archive, evaluations: evaluations };
}

/**
 * Drafts for this month's cycle are prepared automatically from the 3rd through the 6th, the delivery window. Outside
 * it a manager prepares them from EVALS. A cycle with an archived historical workbook is never re-drafted, and
 * existing rows are never replaced.
 */
function prepareDueEvaluations_(today) {
  var parts = isoParts_(today);
  if (parts.day < 3 || parts.day > 6) return 0;
  var cycle = monthKey_(parts.year, parts.month);
  if (evalArchiveRows_().some(function (entry) { return entry.cycle === cycle && entry.kind === 'historical original'; })) return 0;
  return prepareCycle_(cycle, today, 'scheduled');
}

function prepareCycle_(cycle, today, by) {
  var info = evalCycleInfo_(cycle);
  if (today < info.prepare) throw new Error('Drafts for ' + info.label + ' are prepared on ' + info.prepare + ', after ' + info.months[2].label + ' is complete.');
  var context = evalContext_(cycle, today);
  var tab = evalTab_('CC_Evaluations', EVAL_HEADERS_);
  var made = 0;
  var stamp = new Date().toISOString();
  context.evaluations.forEach(function (evaluation) {
    if (evaluation.status !== 'Not prepared') return;
    var line = {
      cycle: cycle, name: evaluation.name, employee_id: evaluation.employeeId, status: 'Draft', revision: 1, template: evaluation.template,
      volume_goal: '',
      focus1_metric: evaluation.focus[0].metric, focus1_prior: evaluation.focus[0].prior, focus1_goal: evaluation.focus[0].goal, focus1_plan: evaluation.focus[0].plan,
      focus2_metric: evaluation.focus[1].metric, focus2_prior: evaluation.focus[1].prior, focus2_goal: evaluation.focus[1].goal, focus2_plan: evaluation.focus[1].plan,
      recognition: evaluation.recognition, comments: evaluation.comments, prepared_at: stamp, updated_at: stamp, source: 'prepared ' + by,
      note: evaluation.verification === 'Verified' ? 'All three months verified when prepared.' : 'Pending Verification when prepared: ' + evaluation.pendingMonths.join(', ') + '.',
    };
    tab.appendRow(EVAL_HEADERS_.map(function (key) { return line[key] === undefined ? '' : line[key]; }));
    made += 1;
  });
  return made;
}

function evalRowIndex_(tab, cycle, name) {
  var values = tab.getDataRange().getValues();
  var header = values[0].map(function (cell) { return String(cell || '').trim(); });
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][header.indexOf('cycle')]).slice(0, 7) === cycle && String(values[r][header.indexOf('name')]) === name) return { row: r + 1, header: header, values: values[r] };
  }
  return null;
}

function writeEvalFields_(tab, found, fields) {
  Object.keys(fields).forEach(function (key) {
    var col = found.header.indexOf(key);
    if (col === -1) return;
    tab.getRange(found.row, col + 1).setValue(fields[key]);
  });
}

function evalText_(value, max) {
  var text = String(value === null || value === undefined ? '' : value).replace(/\r\n/g, '\n').trim();
  if (text.length > max) throw new Error('Keep each comment under ' + max + ' characters.');
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return text;
}

function saveEvaluation_(payload) {
  var cycle = String(payload.cycle || '');
  var info = evalCycleInfo_(cycle);
  var tab = evalTab_('CC_Evaluations', EVAL_HEADERS_);
  var found = evalRowIndex_(tab, cycle, String(payload.name || ''));
  if (!found) throw new Error('Prepare the ' + info.label + ' drafts first.');
  var status = String(found.values[found.header.indexOf('status')]);
  if (status !== 'Draft' && status !== 'Ready for Review') throw new Error('An ' + status.toLowerCase() + ' evaluation is locked. An admin can reopen it as a new revision.');
  var fields = {};
  var input = payload.fields || {};
  EVAL_EDITABLE_.forEach(function (key) {
    if (input[key] === undefined) return;
    if (key === 'volume_goal') {
      var text = String(input[key]).replace(/[$,\s]/g, '');
      if (text !== '' && !(isFinite(Number(text)) && Number(text) > 0)) throw new Error('Enter the volume goal in dollars.');
      fields[key] = text === '' ? '' : Number(text);
    } else if (key === 'template') {
      if (['standard', 'newHire'].indexOf(String(input[key])) === -1) throw new Error('Choose the standard or new-hire template.');
      fields[key] = String(input[key]);
    } else {
      fields[key] = evalText_(input[key], key.indexOf('plan') !== -1 || key === 'comments' || key === 'recognition' ? 2500 : 120);
    }
  });
  fields.updated_at = new Date().toISOString();
  writeEvalFields_(tab, found, fields);
  return evals_({ session: payload.session, cycle: cycle, name: payload.name });
}

function saveEvalMetric_(payload) {
  var month = String(payload.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose the month.');
  var metric = null;
  EVAL_METRICS_.forEach(function (entry) { if (entry.key === payload.metric) metric = entry; });
  if (!metric) throw new Error('Choose the metric.');
  var name = String(payload.name || '');
  if (!sheet_('CC_People').some(function (row) { return String(row.name) === name; })) throw new Error('Choose an associate on the roster.');
  var status = payload.status === 'Not Available' ? 'Not Available' : 'Verified';
  var source = evalText_(payload.source, 200);
  if (!source) throw new Error('Name the report and date the figure comes from.');
  var value = '';
  if (status === 'Verified') {
    var text = String(payload.value === undefined ? '' : payload.value).replace(/[$,\s]/g, '');
    var percentInput = /%$/.test(text);
    var number = Number(text.replace(/%$/, ''));
    if (text === '' || !isFinite(number)) throw new Error('Enter the figure as printed on the report.');
    value = metric.unit === 'percent' && (percentInput || number > 1.5) ? Math.round((number / 100) * 10000) / 10000 : number;
  }
  if (month >= todayNy_().slice(0, 7)) throw new Error('Only completed salesperson months can be recorded.');
  evalTab_('CC_EvalMetrics', EVAL_METRIC_HEADERS_).appendRow([month, name, '', metric.key, value, metric.unit, status, source, evalText_(payload.note, 300), new Date().toISOString(), payload.session.role, 'entered in review']);
  return evals_({ session: payload.session, cycle: payload.cycle, name: name });
}

function evalArchiveFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('eval_archive_folder');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (error) { id = ''; }
  }
  var folder = DriveApp.createFolder('Store 17 Evaluations Archive');
  props.setProperty('eval_archive_folder', folder.getId());
  return folder;
}

function sha256Hex_(bytes) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}

/** Saves bytes to the archive folder and records them. The Drive file is never written again. */
function archiveFile_(base64, fileName, kind, cycle, name, revision, snapshot, note) {
  var bytes = Utilities.base64Decode(base64);
  var blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);
  var file = evalArchiveFolder_().createFile(blob);
  var sha = sha256Hex_(bytes);
  evalTab_('CC_EvalArchive', EVAL_ARCHIVE_HEADERS_).appendRow([new Date().toISOString(), cycle, name || '', revision || '', kind, file.getId(), fileName, sha, bytes.length, snapshot ? JSON.stringify(snapshot) : '', note || '']);
  return { fileId: file.getId(), sha256: sha };
}

function safeFilePart_(text) {
  return String(text || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function setEvalStatus_(payload) {
  var cycle = String(payload.cycle || '');
  var name = String(payload.name || '');
  var target = String(payload.status || '');
  var today = todayNy_();
  var info = evalCycleInfo_(cycle);
  var tab = evalTab_('CC_Evaluations', EVAL_HEADERS_);
  var found = evalRowIndex_(tab, cycle, name);
  if (!found) throw new Error('Prepare the ' + info.label + ' drafts first.');
  var current = String(found.values[found.header.indexOf('status')]);
  var revision = Number(found.values[found.header.indexOf('revision')] || 1);
  var allowed = {
    'Draft>Ready for Review': true, 'Ready for Review>Draft': true, 'Ready for Review>Approved': true,
    'Approved>Given to Associate': true, 'Approved>Draft': payload.session.role === 'admin',
  };
  if (target === 'Reopen') target = 'Draft';
  if (EVAL_STATUSES_.indexOf(target) === -1) throw new Error('Choose Draft, Ready for Review, Approved, or Given to Associate.');
  if (!allowed[current + '>' + target]) {
    if (current === 'Approved' && target === 'Draft') throw new Error('Only an admin can reopen an approved evaluation.');
    throw new Error('A ' + current + ' evaluation cannot move to ' + target + '.');
  }
  var context = evalContext_(cycle, today);
  var evaluation = null;
  context.evaluations.forEach(function (entry) { if (entry.name === name) evaluation = entry; });
  if (target === 'Approved' && evaluation.verification !== 'Verified') throw new Error('Pending Verification: ' + evaluation.pendingMonths.join(', ') + ' still has figures that are not verified. Record them or mark them Not available with the reason before approving.');
  var summary = name + ': ' + current + ' → ' + target + (target === 'Given to Associate' ? ' on ' + (payload.givenOn || today) : '') + '.';
  if (target === 'Approved') summary += ' The evaluation is frozen and its workbook is archived in Drive.';
  if (current === 'Approved' && target === 'Draft') summary += ' Revision ' + (revision + 1) + ' starts as a draft. The approved revision ' + revision + ' stays in the archive unchanged.';
  if (payload.confirm !== true) return { confirmed: false, summary: summary };
  var stamp = new Date().toISOString();
  var fields = { status: target, updated_at: stamp };
  if (target === 'Ready for Review') fields.ready_at = stamp;
  if (target === 'Approved') {
    fields.approved_at = stamp;
    fields.approved_by = payload.session.role;
    evaluation.status = 'Approved';
    evaluation.approvedAt = stamp;
    evaluation.approvedBy = payload.session.role;
    evaluation.revision = revision;
    delete evaluation.draft;
    var bytes = evalWorkbookBytes_([evaluation], info);
    archiveFile_(bytesBase64_(bytes), 'Store17_Evaluation_' + cycle + '_' + safeFilePart_(name) + '_r' + revision + '.xlsx', 'approved evaluation', cycle, name, revision, evaluation, 'Approved by ' + payload.session.role + '.');
  }
  if (target === 'Given to Associate') {
    var given = validDate_(payload.givenOn) || today;
    if (given > today) throw new Error('The date given cannot be in the future.');
    fields.given_on = given;
    fields.given_recorded_at = stamp;
    fields.given_by = payload.session.role;
  }
  if (current === 'Approved' && target === 'Draft') {
    fields.revision = revision + 1;
    fields.approved_at = '';
    fields.approved_by = '';
  }
  writeEvalFields_(tab, found, fields);
  if (target === 'Approved') archiveMonthlyWorkbook_(cycle, today);
  var result = evals_({ session: payload.session, cycle: cycle, name: name });
  result.confirmed = true;
  result.saved = summary;
  return result;
}

/** When every evaluation in the cycle is approved, the full monthly workbook is archived once for that set. */
function archiveMonthlyWorkbook_(cycle, today) {
  var context = evalContext_(cycle, today);
  var ready = context.evaluations.length && context.evaluations.every(function (entry) { return entry.status === 'Approved' || entry.status === 'Given to Associate'; });
  if (!ready) return null;
  var key = context.evaluations.map(function (entry) { return entry.name + ' r' + entry.revision; }).join('; ');
  var done = context.archive.some(function (entry) { return entry.cycle === cycle && entry.kind === 'monthly workbook' && entry.note === key; });
  if (done) return null;
  var bytes = evalWorkbookBytes_(context.evaluations, context.info);
  return archiveFile_(bytesBase64_(bytes), 'Store17_Sales_Evaluations_' + context.info.label.replace(' ', '_') + '.xlsx', 'monthly workbook', cycle, '', '', null, key);
}

function evalCycleList_(today, saved, archive) {
  var current = evaluationCycle_(today).cycle;
  var list = [current];
  var thisMonth = today.slice(0, 7);
  if (list.indexOf(thisMonth) === -1) list.push(thisMonth);
  saved.forEach(function (row) { if (list.indexOf(row.cycle) === -1) list.push(row.cycle); });
  archive.forEach(function (row) { if (row.cycle && list.indexOf(row.cycle) === -1) list.push(row.cycle); });
  list.sort().reverse();
  return list.map(function (cycle) { var info = evalCycleInfo_(cycle); return { cycle: cycle, label: info.label, covers: info.months[0].label + ' – ' + info.months[2].label }; });
}

function evals_(payload) {
  var today = todayNy_();
  try { prepareDueEvaluations_(today); } catch (error) { appendException_('Update Failed', 'Evaluation drafts could not be prepared. ' + String(error && error.message ? error.message : error)); }
  var cycle = payload.cycle ? String(payload.cycle) : evaluationCycle_(today).cycle;
  var context = evalContext_(cycle, today);
  var archive = context.archive.filter(function (entry) { return entry.cycle === cycle; }).map(function (entry) {
    return { archivedAt: entry.archivedAt, name: entry.name, revision: entry.revision, kind: entry.kind, fileName: entry.fileName, sha256: entry.sha256, id: entry.fileId };
  });
  return {
    role: payload.session.role,
    today: today,
    cycle: cycle,
    info: context.info,
    canPrepare: today >= context.info.prepare,
    prepared: context.evaluations.some(function (entry) { return entry.status !== 'Not prepared'; }),
    cycles: evalCycleList_(today, context.saved, context.archive),
    statuses: EVAL_STATUSES_,
    metrics: EVAL_METRICS_.map(function (metric) { return { key: metric.key, label: metric.label, unit: metric.unit, source: metric.source }; }),
    evaluations: context.evaluations,
    archive: archive,
    logo: 'data:image/jpeg;base64,' + KANES_LOGO_JPEG_,
  };
}

function prepareEvals_(payload) {
  var today = todayNy_();
  var cycle = String(payload.cycle || '');
  if (payload.confirm !== true) {
    var info = evalCycleInfo_(cycle);
    if (today < info.prepare) throw new Error('Drafts for ' + info.label + ' are prepared on ' + info.prepare + ', after ' + info.months[2].label + ' is complete.');
    var waiting = evalContext_(cycle, today).evaluations.filter(function (entry) { return entry.status === 'Not prepared'; });
    var summary = 'Prepare ' + waiting.length + ' ' + info.label + ' draft' + (waiting.length === 1 ? '' : 's') + ' (' + waiting.map(function (entry) { return entry.name; }).join(', ') + ') covering ' + info.months[0].label + ' through ' + info.months[2].label + '.';
    if (today > info.deliverBy) summary += ' The delivery window for this month ended on ' + info.deliverBy + '. If these evaluations were already given from a workbook, an admin should upload that workbook instead: a draft here would block the upload.';
    return { confirmed: false, summary: summary };
  }
  var made = prepareCycle_(cycle, today, payload.session.role);
  var result = evals_({ session: payload.session, cycle: payload.cycle });
  result.saved = made ? made + ' draft' + (made === 1 ? '' : 's') + ' prepared.' : 'Every associate already has a draft.';
  return result;
}

/** The workbook for chosen associates. Approved ones use their frozen snapshot; a saved archive file is returned byte for byte. */
function evalWorkbook_(payload) {
  if (payload.archiveId) {
    var entry = null;
    evalArchiveRows_().forEach(function (row) { if (row.fileId === String(payload.archiveId)) entry = row; });
    if (!entry) throw new Error('That archived workbook is not on file.');
    var blob = DriveApp.getFileById(entry.fileId).getBlob();
    var stored = blob.getBytes();
    if (entry.sha256 && sha256Hex_(stored) !== entry.sha256) throw new Error('The archived file no longer matches its recorded fingerprint. It was not returned.');
    return { fileName: entry.fileName, base64: Utilities.base64Encode(stored), sha256: entry.sha256, archived: true };
  }
  var today = todayNy_();
  var cycle = String(payload.cycle || '');
  var context = evalContext_(cycle, today);
  var names = payload.names && payload.names.length ? payload.names : null;
  var chosen = context.evaluations.filter(function (entry) { return !names || names.indexOf(entry.name) !== -1; });
  if (!chosen.length) throw new Error('Choose at least one associate.');
  var bytes = evalWorkbookBytes_(chosen, context.info);
  var fileName = 'Store17_Sales_Evaluations_' + context.info.label.replace(' ', '_') + (chosen.length === 1 ? '_' + safeFilePart_(chosen[0].name) : '') + '.xlsx';
  return { fileName: fileName, base64: bytesBase64_(bytes), archived: false };
}

function evalSheetName_(name, used) {
  var base = String(name || 'Associate').replace(/[\[\]:*?\/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Associate';
  var candidate = base;
  var n = 2;
  while (used.indexOf(candidate.toLowerCase()) !== -1) { candidate = base.slice(0, 28) + ' ' + n; n += 1; }
  used.push(candidate.toLowerCase());
  return candidate;
}

var EVAL_COLORS_ = { navy: '0F2A3A', teal: '0E7C86', tealLight: 'E3F3F4', gray: 'F2F5F7', line: 'B7C3CC', text: '1B2833', muted: '5B6B78', good: 'E3F4EA', goodText: '0B6B3A', bad: 'FBE5E8', badText: '9B1C33', amber: 'FFF4D6', amberText: '7A5A00', white: 'FFFFFF' };

function lineCount_(text, charsPerLine) {
  return String(text || '').split('\n').reduce(function (sum, line) { return sum + Math.max(1, Math.ceil(line.length / charsPerLine)); }, 0);
}

/** Header band with both logos, reused at the top of page 2. Returns the next free row. */
function evalBand_(sheet, row, evaluation, compact) {
  var c = EVAL_COLORS_;
  sheet.height(row, compact ? 22 : 26);
  sheet.height(row + 1, compact ? 20 : 24);
  sheet.height(row + 2, 18);
  sheet.height(row + 3, compact ? 6 : 10);
  var first = isoParts_(evaluation.months[0].start);
  var last = isoParts_(evaluation.months[2].end);
  var span = evaluation.months[0].name.slice(0, 3) + ' 1, ' + first.year + ' – ' + evaluation.months[2].name.slice(0, 3) + ' ' + last.day + ', ' + last.year;
  sheet.merge(row, 2, row, 6, compact ? evaluation.name + ' · ' + evaluation.cycleLabel + ' (continued)' : (evaluation.template === 'newHire' ? 'New Hire Coaching Evaluation' : '3-Month Performance & Coaching Evaluation'), { bold: true, size: compact ? 12 : 14, color: c.navy, align: 'center', valign: 'bottom' });
  sheet.merge(row + 1, 2, row + 1, 6, compact ? "Kane's Furniture · Store 17 · South Orlando" : "Kane's Furniture · Store 17 · South Orlando" + (evaluation.template === 'newHire' ? ' · under 90 days' : ''), { size: 10, color: c.teal, bold: true, align: 'center' });
  sheet.merge(row + 2, 2, row + 2, 6, 'Issued ' + evaluation.cycleLabel + ' · covers ' + span + ' (calendar months)', { size: 9, color: c.muted, italic: true, align: 'center' });
  sheet.merge(row + 3, 1, row + 3, 7, '', { border: { bottom: 'medium ' + c.teal } });
  sheet.picture('kanes.jpeg', row, 1, 1.5, 0.655, 0.05, 0.04);
  sheet.picture('store17.png', row, 7, 0.82, 0.82, 0.12, 0.0);
  return row + 4;
}

function evalSheet_(styles, evaluation, used) {
  var c = EVAL_COLORS_;
  var sheet = new XlsxSheet_(evalSheetName_(evaluation.name, used), styles);
  sheet.widths = [32, 12, 12, 13, 13, 13, 12];
  sheet.footer = '&L&8Kane\'s Furniture Store 17 · Confidential&C&8' + evaluation.name + ' · ' + evaluation.cycleLabel + '&R&8Page &P of &N';
  var thin = 'thin ' + c.line;
  var box = { left: thin, right: thin, top: thin, bottom: thin };
  var label = { bold: true, size: 9, color: c.muted, fill: c.gray, border: box, indent: 1 };
  var value = { size: 10, bold: true, color: c.text, border: box, indent: 1 };
  var band = { bold: true, size: 10, color: c.white, fill: c.navy, indent: 1 };
  var row = evalBand_(sheet, 1, evaluation, false);

  row += 1;
  var info = [
    ['Salesperson', evaluation.name, 'Employee ID', evaluation.employeeId || 'Not on file'],
    ['Store', 'Store 17 · South Orlando', 'Hire date', evaluation.hireDate || 'Not on file'],
    ['Evaluation', evaluation.cycleLabel + (evaluation.revision > 1 ? ' · revision ' + evaluation.revision : ''), 'Deliver by', evaluation.deliverBy],
    ['Status', evaluation.status + (evaluation.verification === 'Verified' ? '' : ' · Pending Verification'), 'Template', evaluation.template === 'newHire' ? 'New hire (under 90 days)' : 'Standard'],
  ];
  info.forEach(function (line) {
    var flagged = line[0] === 'Status' && evaluation.verification !== 'Verified';
    sheet.height(row, flagged ? 28 : 19);
    sheet.set(row, 1, line[0], label);
    sheet.merge(row, 2, row, 3, line[1], flagged ? { size: 9, bold: true, color: c.amberText, fill: c.amber, border: box, indent: 1, wrap: true, valign: 'center' } : value);
    sheet.set(row, 4, line[2], label);
    sheet.merge(row, 5, row, 7, line[3], value);
    row += 1;
  });

  row += 1;
  sheet.height(row, 20);
  sheet.merge(row, 1, row, 7, 'PERFORMANCE RESULTS · LAST THREE COMPLETED MONTHS', band);
  row += 1;
  var head = { bold: true, size: 9, color: c.white, fill: c.teal, border: box, align: 'center', wrap: true };
  sheet.height(row, 30);
  ['Sales metric', 'Source', 'Goal'].concat(evaluation.months.map(function (month) { return month.label; })).concat(['Goals met']).forEach(function (text, i) {
    sheet.set(row, i + 1, text, i === 0 ? { bold: true, size: 9, color: c.white, fill: c.teal, border: box, indent: 1 } : head);
  });
  row += 1;
  sheet.height(row, 15);
  var rangeStyle = { size: 8, italic: true, color: c.muted, fill: c.tealLight, border: box, align: 'center' };
  sheet.set(row, 1, 'Reporting dates', { size: 8, italic: true, color: c.muted, fill: c.tealLight, border: box, indent: 1 });
  sheet.set(row, 2, '', rangeStyle);
  sheet.set(row, 3, '', rangeStyle);
  evaluation.months.forEach(function (month, i) {
    var start = isoParts_(month.start);
    var end = isoParts_(month.end);
    sheet.set(row, 4 + i, month.name.slice(0, 3) + ' ' + start.day + '–' + end.day + ', ' + start.year, rangeStyle);
  });
  sheet.set(row, 7, '', rangeStyle);
  row += 1;
  evaluation.metrics.forEach(function (metric, index) {
    var stripe = index % 2 ? c.white : 'F8FAFB';
    sheet.height(row, 18);
    sheet.set(row, 1, metric.label, { size: 9.5, color: c.text, fill: stripe, border: box, indent: 1 });
    sheet.set(row, 2, metric.source, { size: 8, color: c.muted, fill: stripe, border: box, align: 'center' });
    var goalFormat = metric.unit === 'dollars' ? '$#,##0' : metric.unit === 'percent' ? (Math.round(metric.goal * 1000) !== Math.round(metric.goal * 10000) / 10 ? '0.00%' : '0.0%') : '0';
    if (metric.goal === null || metric.goal === undefined || metric.goal === '' || metric.unit === 'count') sheet.set(row, 3, metric.goalText, { size: 9.5, bold: true, color: c.text, fill: stripe, border: box, align: 'center' });
    else sheet.set(row, 3, Number(metric.goal), { size: 9.5, bold: true, color: c.text, fill: stripe, border: box, align: 'center', format: goalFormat });
    metric.values.forEach(function (cell, i) {
      if (cell.status === 'Verified') {
        var format = cell.unit === 'dollars' ? '$#,##0' : cell.unit === 'percent' ? '0.0%' : '0';
        var tone = cell.met === true ? { fill: c.good, color: c.goodText } : cell.met === false ? { fill: c.bad, color: c.badText } : { fill: stripe, color: c.text };
        sheet.set(row, 4 + i, cell.value, { size: 10, bold: true, color: tone.color, fill: tone.fill, border: box, align: 'center', format: format });
      } else {
        var muted = cell.status === 'Pending Verification' ? { fill: c.amber, color: c.amberText } : { fill: c.gray, color: c.muted };
        sheet.set(row, 4 + i, cell.status === 'Pending Verification' ? 'Pending' : cell.text, { size: 8, italic: true, color: muted.color, fill: muted.fill, border: box, align: 'center' });
      }
    });
    sheet.set(row, 7, metric.metText, { size: 9, color: c.text, fill: stripe, border: box, align: 'center' });
    row += 1;
  });
  var notes = 'Green: at or above goal. Red: below goal. Pending: the source report for that month is not verified, so no figure is shown. Sales volume is SPR TOTAL line 8; the other metrics are WDSRR based on delivered unless specified. Volume goal: ' + evaluation.volumeGoalNote;
  var noteLines = lineCount_(notes, 120);
  sheet.height(row, Math.max(24, noteLines * 11.5));
  sheet.merge(row, 1, row, 7, notes, { size: 8, italic: true, color: c.muted, wrap: true, valign: 'top' });
  row += 2;

  sheet.height(row, 20);
  sheet.merge(row, 1, row, 7, 'COACHING FOCUS AREAS · PRIOR MONTH AND NEXT MONTH GOALS', band);
  row += 1;
  var halves = [[1, 3], [4, 7]];
  var focusLabel = { bold: true, size: 8.5, color: c.muted, fill: c.gray, border: box, indent: 0 };
  [['Focus metric #', 'metric'], ['Prior month', 'prior'], ['Next month goal', 'goal']].forEach(function (line) {
    sheet.height(row, 19);
    evaluation.focus.forEach(function (focus, i) {
      var cols = halves[i];
      sheet.set(row, cols[0], line[0] === 'Focus metric #' ? 'Focus metric #' + (i + 1) : line[0], focusLabel);
      sheet.merge(row, cols[0] + 1, row, cols[1], focus[line[1]] || '—', { size: 10, bold: true, color: line[1] === 'metric' ? c.teal : c.text, border: box, indent: 1 });
    });
    row += 1;
  });
  sheet.height(row, 18);
  evaluation.focus.forEach(function (focus, i) { sheet.merge(row, halves[i][0], row, halves[i][1], 'Focus metric #' + (i + 1) + ' action plan', { bold: true, size: 9, color: c.white, fill: c.teal, border: box, indent: 1 }); });
  row += 1;
  var planLines = Math.max(lineCount_(evaluation.focus[0].plan, 58), lineCount_(evaluation.focus[1].plan, 53), 6);
  var planRows = 6;
  var perRow = Math.max(15, Math.ceil((planLines * 13.2 + 8) / planRows));
  var r;
  for (r = 0; r < planRows; r += 1) sheet.height(row + r, perRow);
  evaluation.focus.forEach(function (focus, i) {
    sheet.merge(row, halves[i][0], row + planRows - 1, halves[i][1], focus.plan || '', { size: 10, color: c.text, border: box, wrap: true, valign: 'top', indent: 1 });
  });
  row += planRows;
  sheet.breaks.push(row);
  row += 1;

  row = evalBand_(sheet, row, evaluation, true);
  row += 1;
  var textSection = function (title, text, minLines) {
    sheet.height(row, 20);
    sheet.merge(row, 1, row, 7, title, band);
    row += 1;
    var lines = Math.max(lineCount_(text, 105), minLines);
    var rows = 4;
    var height = Math.max(16, Math.ceil((lines * 13.2 + 10) / rows));
    var k;
    for (k = 0; k < rows; k += 1) sheet.height(row + k, height);
    sheet.merge(row, 1, row + rows - 1, 7, text || '', { size: 10, color: c.text, border: box, wrap: true, valign: 'top', indent: 1 });
    row += rows + 1;
  };
  textSection('RECOGNITION · SALES CONSULTANT SPOTLIGHT (HIGHLIGHTS, ANNIVERSARIES, RANKINGS, IMPROVEMENT)', evaluation.recognition, 4);
  textSection('OVERALL PERFORMANCE COMMENTS', evaluation.comments, 6);

  sheet.height(row, 20);
  sheet.merge(row, 1, row, 7, 'ACKNOWLEDGEMENT', band);
  row += 1;
  sheet.height(row, 30);
  sheet.merge(row, 1, row, 7, 'By signing, the salesperson confirms this evaluation was reviewed with them. A signature does not mean agreement with every comment.', { size: 9, italic: true, color: c.muted, wrap: true, valign: 'center', indent: 1 });
  row += 1;
  var line = { border: { bottom: 'thin ' + c.text } };
  var sign = function (title, dateLabel, prefill) {
    sheet.height(row, 34);
    sheet.set(row, 1, title, { bold: true, size: 10, color: c.text, valign: 'bottom', indent: 1 });
    sheet.merge(row, 2, row, 4, prefill || '', { size: 10, color: c.text, valign: 'bottom', border: { bottom: 'thin ' + c.text } });
    sheet.set(row, 5, dateLabel, { bold: true, size: 10, color: c.text, valign: 'bottom', align: 'right' });
    sheet.merge(row, 6, row, 7, '', line);
    row += 1;
  };
  sign('Salesperson signature', 'Date');
  sign('Manager signature', 'Date');
  sign('Manager name (print)', '', evaluation.managerName);
  row += 1;
  sheet.height(row, 16);
  sheet.merge(row, 1, row, 7, 'Prepared ' + (evaluation.preparedAt ? stampDay_(evaluation.preparedAt) : 'not yet') + (evaluation.approvedAt ? ' · approved ' + stampDay_(evaluation.approvedAt) : '') + (evaluation.givenOn ? ' · given to associate ' + evaluation.givenOn : ' · given to associate: record after the meeting') + '.', { size: 8, italic: true, color: c.muted, indent: 1 });
  return sheet;
}

function evalWorkbookBytes_(evaluations, info) {
  var styles = new XlsxStyles_();
  var used = [];
  var sheets = evaluations.map(function (evaluation) { return evalSheet_(styles, evaluation, used); });
  var media = [
    { name: 'kanes.jpeg', type: 'jpeg', bytes: base64Bytes_(KANES_LOGO_JPEG_) },
    { name: 'store17.png', type: 'png', bytes: base64Bytes_(STORE17_LOGO_PNG_) },
  ];
  return xlsxWorkbook_(sheets, media, "Store 17 Sales Evaluations · " + info.label);
}
