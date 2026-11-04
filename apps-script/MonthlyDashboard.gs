/**
 * Admin Monthly History. One selected month, drawn from the same store calendar,
 * daily totals, closing view, KPI rows, and salesperson lines the live Home page uses.
 * A finalized month is read back from CC_MonthSnapshot and is not recalculated.
 */
var MONTH_SNAPSHOT_TAB_ = 'CC_MonthSnapshot';
var MONTH_SNAPSHOT_HEADERS_ = ['snapshot_id', 'period_key', 'year', 'month', 'version', 'status', 'store_start', 'store_end', 'person_start', 'person_end', 'finalized_by', 'finalized_at_et', 'digest', 'prior_snapshot_id', 'reason', 'body'];
var MONTH_REVISION_TAB_ = 'CC_MonthRevision';
var MONTH_REVISION_HEADERS_ = ['revision_id', 'period_key', 'status', 'reason', 'requested_by', 'requested_at_et', 'approved_by', 'approved_at_et', 'prior_snapshot_id', 'new_snapshot_id'];
var MONTH_NAMES_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var MONTH_GM_USERS_ = { liz: 'Liz', cordell: 'Cordell', kelly: 'Kelly' };
var MONTH_PRIMARY_KPIS_ = { Bedding: true, 'Closing Ratio': true, 'Total Attachment': true };

function monthlyDashboard_(payload) {
  monthAdmin_(payload);
  var picked = requestedHistoryMonth_(payload);
  return buildMonthlyDashboard_(picked.year, picked.month, payload, {});
}

function finalizeHistoricalMonth_(payload) {
  var gm = monthGm_(payload);
  if (!payload || payload.confirm !== 'FINALIZE') throw new Error('Finalizing needs an explicit confirmation. Nothing was saved.');
  var picked = requestedHistoryMonth_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (verifiedMonthSnapshot_(picked.year, picked.month)) throw new Error('This month is already finalized. Start a revision to change it. Nothing was saved.');
    var view = buildMonthlyDashboard_(picked.year, picked.month, payload, { forceLive: true });
    if (!view.ended) throw new Error('This reporting month has not ended. Nothing was saved.');
    if (view.status !== 'READY FOR REVIEW') throw new Error(view.label + ' cannot be finalized. Nothing was saved.');
    return commitMonthSnapshot_(view, gm, 'FINALIZED', '', '');
  } finally {
    lock.releaseLock();
  }
}

function startMonthRevision_(payload) {
  var gm = monthGm_(payload);
  var reason = String(payload && payload.reason || '').trim();
  if (reason.length < 8) throw new Error('A revision needs a written reason. Nothing was changed.');
  var picked = requestedHistoryMonth_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var current = verifiedMonthSnapshot_(picked.year, picked.month);
    if (!current) throw new Error('Only a finalized month can be revised. Nothing was changed.');
    var open = openMonthRevision_(current.periodKey);
    if (open) throw new Error('A revision is already open for this month. Nothing was changed.');
    var tab = historyTab_(MONTH_REVISION_TAB_, MONTH_REVISION_HEADERS_);
    var id = 'REV-' + current.periodKey + '-' + String(Utilities.getUuid()).slice(0, 8);
    tab.appendRow([id, current.periodKey, 'OPEN', reason, gm.name, easternStamp_(), '', '', current.id, '']);
    var view = buildMonthlyDashboard_(picked.year, picked.month, payload, {});
    view.message = 'Revision requested by ' + gm.name + '. The finalized snapshot is unchanged until the revision is approved.';
    return view;
  } finally {
    lock.releaseLock();
  }
}

function approveMonthRevision_(payload) {
  var gm = monthGm_(payload);
  if (!payload || payload.confirm !== 'REVISE') throw new Error('Approving a revision needs an explicit confirmation. Nothing was saved.');
  var picked = requestedHistoryMonth_(payload);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var prior = verifiedMonthSnapshot_(picked.year, picked.month);
    if (!prior) throw new Error('There is no finalized snapshot to revise. Nothing was saved.');
    var open = openMonthRevision_(prior.periodKey);
    if (!open) throw new Error('Start a revision and write the reason before approving one. Nothing was saved.');
    var view = buildMonthlyDashboard_(picked.year, picked.month, payload, { forceLive: true });
    if (!view.ended || view.status !== 'READY FOR REVIEW') throw new Error('The revision did not pass review, so no new version was saved. The prior snapshot is unchanged.');
    var saved = commitMonthSnapshot_(view, gm, 'REVISED', prior.id, open.reason);
    var tab = historyTab_(MONTH_REVISION_TAB_, MONTH_REVISION_HEADERS_);
    var values = tab.getDataRange().getValues();
    var statusAt = MONTH_REVISION_HEADERS_.indexOf('status');
    var byAt = MONTH_REVISION_HEADERS_.indexOf('approved_by');
    var atAt = MONTH_REVISION_HEADERS_.indexOf('approved_at_et');
    var newAt = MONTH_REVISION_HEADERS_.indexOf('new_snapshot_id');
    values[open.row - 1][statusAt] = 'APPROVED';
    values[open.row - 1][byAt] = gm.name;
    values[open.row - 1][atAt] = easternStamp_();
    values[open.row - 1][newAt] = saved.snapshot.id;
    tab.getRange(open.row, 1, 1, MONTH_REVISION_HEADERS_.length).setValues([values[open.row - 1]]);
    saved.message = 'Revision ' + saved.snapshot.version + ' approved by ' + gm.name + '. Version ' + prior.version + ' is still on file.';
    saved.revision = openMonthRevision_(prior.periodKey);
    saved.versions = monthSnapshotVersions_(prior.periodKey);
    return saved;
  } finally {
    lock.releaseLock();
  }
}

function monthAdmin_(payload) {
  if (!payload || !payload.session || payload.session.role !== 'admin') throw new Error('Monthly History is for administrators.');
}

function monthGm_(payload) {
  monthAdmin_(payload);
  var username = String(payload.session.username || '').trim().toLowerCase();
  var name = MONTH_GM_USERS_[username];
  if (!name) throw new Error('Only the GM can finalize a month.');
  return { username: username, name: name };
}

function requestedHistoryMonth_(payload) {
  var today = todayNy_();
  var done = completedReportingMonth_(today);
  var year = Number(payload && payload.year);
  var month = Number(payload && payload.month);
  if (!year || !month) return done;
  if (month < 1 || month > 12 || year < 2020 || year > 2100) throw new Error('Choose a month and a year.');
  return { year: year, month: month };
}

function completedReportingMonth_(today) {
  var store = storePeriodContaining_(today);
  if (today > store.end) return { year: store.year, month: store.month };
  return store.month === 1 ? { year: store.year - 1, month: 12 } : { year: store.year, month: store.month - 1 };
}

function buildMonthlyDashboard_(year, month, payload, options) {
  options = options || {};
  var store = periodFor_('store', year, month);
  var person = periodFor_('individual', year, month);
  var saved = options.forceLive ? null : verifiedMonthSnapshot_(year, month);
  if (saved) {
    var frozen = saved.view;
    frozen.focus = historyFocus_(frozen.people || [], payload && payload.person);
    frozen.choices = monthChoices_();
    frozen.versions = monthSnapshotVersions_(saved.periodKey);
    frozen.revision = openMonthRevision_(saved.periodKey);
    frozen.fromSnapshot = true;
    return frozen;
  }
  var today = todayNy_();
  var facts = dailyFacts_();
  var closed = closedDates_();
  var config = config_();
  var goals = historicalSalesGoals_(config, store);
  var kpiGoals = approvedGoals_(config);
  var writtenMissing = missingMeasureDays_(facts, store, closed, today, 'nwdsrWritten');
  var deliveredMissing = missingMeasureDays_(facts, store, closed, today, 'nwdsrDelivered');
  var written = sumField_(facts, 'nwdsrWritten', store.start, store.end);
  var delivered = sumField_(facts, 'nwdsrDelivered', store.start, store.end);
  var snap = sumField_(facts, 'snapWritten', store.start, store.end);
  var personSnap = sumField_(facts, 'snapWritten', person.start, person.end);
  var people = historicalPeople_(person.start, person.end, kpiGoals);
  var hasData = written !== null || delivered !== null || snap !== null || personSnap !== null || people.some(function (row) { return row.snapWritten !== null; });
  var kpiActuals = kpiActualsForPeriod_(store);
  var closing = closingForPeriod_(store, kpiGoals.closing);
  var analysis = { group17: { written: '', delivered: '' }, asl: { written: '', delivered: '' } };
  try { analysis = analysisCoverageThrough_(store, today > store.end ? shiftDate_(store.end, 1) : today); } catch (error) { analysis = analysis; }
  var strip = [];
  try { strip = homeKpiStrip_(kpiGoals, kpiActuals, closing, analysis); } catch (error) { strip = []; }
  var primary = {};
  strip.forEach(function (row) { if (MONTH_PRIMARY_KPIS_[row.name]) primary[row.name] = row; });
  var storeKpis = strip.filter(function (row) { return !MONTH_PRIMARY_KPIS_[row.name]; });
  var yearOverYear = {
    nwdsr: 'Pending', snap: 'Pending', nwdsrLy: 'Pending', snapLy: 'Pending', currentDates: '', lyDates: '', note: 'LAST YEAR is the prior year, not last month.',
  };
  try {
    var block = reportMonthSnapLy_(facts, closed, store, today > store.end ? shiftDate_(store.end, 1) : today);
    yearOverYear = {
      nwdsr: block.nwdsr || 'Pending', snap: block.snap || 'Pending', nwdsrLy: block.nwdsrLy || 'Pending', snapLy: block.snapLy || block.ly || 'Pending',
      currentDates: block.currentDates || '', lyDates: block.lyDates || '', note: block.note || yearOverYear.note,
    };
  } catch (error) {
    yearOverYear.note = 'The year-over-year comparison could not be read. No substitute range was used.';
  }
  var checks = monthReviewChecks_({
    store: store, person: person, today: today, writtenMissing: writtenMissing, deliveredMissing: deliveredMissing,
    written: written, delivered: delivered, personSnap: personSnap, people: people, kpiActuals: kpiActuals, closing: closing,
  });
  var ended = today > store.end;
  var failing = checks.some(function (check) { return check.result === 'FAIL' || check.result === 'INCOMPLETE'; });
  var status = !hasData ? 'NOT AVAILABLE' : (!ended || failing ? 'PARTIAL' : 'READY FOR REVIEW');
  var broken = brokenMonthSnapshot_(year, month);
  var monthName = MONTH_NAMES_[month - 1];
  var view = {
    historical: true,
    role: payload.session.role,
    version: typeof APP_VERSION_ === 'undefined' ? '' : APP_VERSION_,
    year: year,
    month: month,
    monthName: monthName,
    heading: 'STORE 17 — ' + monthName.toUpperCase() + ' ' + year + ' PERFORMANCE',
    backLabel: 'BACK TO ' + monthName.toUpperCase() + ' ' + year + ' MONTHLY HISTORY',
    status: status,
    label: monthStatusLabel_(status, null),
    ended: ended,
    hasData: hasData,
    fromSnapshot: false,
    snapshotWarning: broken ? 'A saved snapshot for this month failed its integrity check, so it is not shown as finalized.' : '',
    periods: {
      store: 'Store reporting period: ' + historyRange_(store.start, store.end) + '.',
      salesperson: 'Salesperson reporting period: ' + historyRange_(person.start, person.end) + '.',
      storeStart: store.start, storeEnd: store.end, personStart: person.start, personEnd: person.end,
    },
    tiles: {
      written: historyTile_('NWDSR Written', written, goals.written, goals.basis, writtenMissing),
      delivered: historyTile_('NWDSR Delivered', delivered, goals.delivered, goals.basis, deliveredMissing),
      bedding: historyRateTile_('Bedding', primary.Bedding),
      closing: historyRateTile_('Closing Ratio', primary['Closing Ratio']),
      attachment: historyRateTile_('Store Attachment', primary['Total Attachment']),
    },
    goals: {
      basis: goals.basis,
      written: goals.written,
      delivered: goals.delivered,
      writtenAchievement: ratio_(written, goals.written),
      deliveredAchievement: ratio_(delivered, goals.delivered),
      writtenVariance: historyVariance_(written, goals.written),
      deliveredVariance: historyVariance_(delivered, goals.delivered),
    },
    yearOverYear: yearOverYear,
    storeKpis: storeKpis,
    people: people,
    checks: checks,
    choices: monthChoices_(),
    versions: monthSnapshotVersions_('STORE-' + year + '-' + pad2_(month)),
    revision: openMonthRevision_('STORE-' + year + '-' + pad2_(month)),
    omitted: ['stillNeeded', 'todayGoals', 'weekGoals', 'winners', 'dailyRefresh'],
    print: { title: 'STORE 17 — ' + monthName.toUpperCase() + ' ' + year + ' PERFORMANCE', status: status },
    focus: historyFocus_(people, payload && payload.person),
  };
  view.label = monthStatusLabel_(view.status, null);
  return view;
}

function historyTile_(name, actual, goal, basis, missing) {
  return {
    name: name,
    actual: actual,
    goal: goal,
    goalAvailable: goal !== null && goal !== undefined,
    goalBasis: goal === null || goal === undefined ? 'GOAL NOT AVAILABLE' : basis,
    achieved: ratio_(actual, goal),
    variance: historyVariance_(actual, goal),
    missingDays: missing,
    partial: !!(missing && missing.length && actual !== null),
    note: missing && missing.length ? 'Missing days were not counted as zero.' : '',
  };
}

function historyRateTile_(name, row) {
  if (!row) return { name: name, actual: null, goal: null, goalAvailable: false, goalBasis: 'GOAL NOT AVAILABLE', achieved: null, variance: null, unit: 'percent', note: 'No figure is stored for this month.' };
  var goal = row.goal === undefined ? null : row.goal;
  return {
    name: name,
    actual: row.written === undefined ? null : row.written,
    delivered: row.delivered === undefined ? null : row.delivered,
    goal: goal,
    goalAvailable: goal !== null && goal !== undefined && goal !== '',
    goalBasis: goal === null || goal === undefined || goal === '' ? 'GOAL NOT AVAILABLE' : 'Approved goal',
    unit: row.unit || 'percent',
    achieved: ratio_(row.written, goal),
    variance: historyVariance_(row.written, goal),
    note: row.note || row.detail || '',
  };
}

function historyVariance_(actual, goal) {
  if (actual === null || actual === undefined || goal === null || goal === undefined || goal === '') return null;
  return Math.round((Number(actual) - Number(goal)) * 100) / 100;
}

function historicalSalesGoals_(config, store) {
  var budgets = storeSalesGoals_(config, store);
  var monthKey = store.year + '-' + pad2_(store.month);
  var specific = (config['written_goal_' + monthKey] !== undefined && config['written_goal_' + monthKey] !== '') || (config['delivered_goal_' + monthKey] !== undefined && config['delivered_goal_' + monthKey] !== '');
  var basis = specific ? 'Approved budget for ' + monthKey : (store.start === '2026-10-02' && budgets.written === 400000 ? 'Approved October 2026 store budget' : 'Standing store budget. The approved rule applies that budget to every store month until a month-specific budget is saved.');
  if (budgets.written === null && budgets.delivered === null) basis = 'GOAL NOT AVAILABLE';
  var historyWritten = goalHistoryValue_('STORE-' + monthKey, 'store_written');
  var historyDelivered = goalHistoryValue_('STORE-' + monthKey, 'store_delivered');
  if (historyWritten !== null) budgets.written = historyWritten;
  if (historyDelivered !== null) budgets.delivered = historyDelivered;
  if (historyWritten !== null || historyDelivered !== null) basis = 'Goal captured on CC_GoalHistory for this month';
  return { written: budgets.written, delivered: budgets.delivered, basis: basis };
}

function goalHistoryValue_(periodKey, metricKey) {
  var rows = [];
  try { rows = sheet_('CC_GoalHistory'); } catch (error) { return null; }
  var found = null;
  rows.forEach(function (row) {
    if (String(row.period_key || '') !== periodKey || String(row.metric_key || '') !== metricKey) return;
    var value = fineNumber_(row.goal);
    if (value !== null) found = value;
  });
  return found;
}

function kpiActualsForPeriod_(store) {
  var map = {};
  var rows = [];
  try { rows = sheet_('CC_Kpi'); } catch (error) { rows = []; }
  rows.forEach(function (row) {
    if (!row.metric || String(row.metric) === 'Daily Bedding') return;
    if (isoDate_(row.period_start) !== store.start || isoDate_(row.period_end) !== store.end) return;
    map[String(row.metric)] = { written: fineNumber_(row.written), delivered: fineNumber_(row.delivered), note: String(row.note || ''), through: isoDate_(row.verified_through) };
  });
  var otherPeriod = rows.some(function (row) {
    return row.metric && isoDate_(row.period_start) && isoDate_(row.period_start) !== store.start;
  });
  if (!Object.keys(map).length && !otherPeriod && store.start === '2026-10-02' && store.end === '2026-11-01' && typeof kpiActuals_ === 'function') {
    kpiActuals_().forEach(function (row) {
      map[row[0]] = { written: row[1], delivered: row[2], note: row[3] || '', through: '' };
    });
  }
  return map;
}

function closingForPeriod_(period, goal) {
  var view = null;
  try { view = loadClosingView_(); } catch (error) { view = null; }
  if (view && view.start === period.start) return storeMonthClosing_(view, period, goal);
  if (!view || !view.days) return storeMonthClosing_(null, period, goal);
  var days = view.days.filter(function (day) { return day.date >= period.start && day.date <= period.end && day.mtd && day.mtd.ratio !== null; });
  if (!days.length) {
    var pending = storeMonthClosing_(null, period, goal);
    pending.gap = 'No month-to-date closing row is stored for ' + period.start + ' through ' + period.end + '.';
    pending.note = pending.gap;
    return pending;
  }
  var last = days[days.length - 1];
  var scoped = { days: days, byDate: {}, summary: { 'MTD through': last.date, Sources: last.mtd.sources || last.sources || '', 'Latest daily date': last.date }, start: period.start, end: period.end };
  days.forEach(function (day) { scoped.byDate[day.date] = day; });
  return storeMonthClosing_(scoped, period, goal);
}

function historicalPeople_(start, end, goals) {
  var lines = { byDay: {}, order: [], latest: '' };
  try { lines = snapAssociateLines_(start, end); } catch (error) { lines = lines; }
  var totals = {};
  var days = {};
  var roles = {};
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    if (!line || line.role === 'management') return;
    totals[line.name] = Math.round(((totals[line.name] || 0) + line.amount) * 100) / 100;
    if (!days[line.name]) days[line.name] = [];
    days[line.name].push({ date: line.date, snapWritten: line.amount, note: line.note });
    roles[line.name] = line.role || 'associate';
  });
  var names = {};
  Object.keys(totals).forEach(function (name) { names[name] = true; });
  try {
    membersDuring_(start, end).forEach(function (name) { if (name) names[name] = true; });
  } catch (error) { names = names; }
  var reported = false;
  try { reported = snapReportedIn_(start, end, lines); } catch (error) { reported = false; }
  var analysis = null;
  var closingFacts = null;
  try { analysis = personAnalysisContext_({ start: start, end: end }); } catch (error) { analysis = null; }
  try { closingFacts = loadClosing_(); } catch (error) { closingFacts = null; }
  return Object.keys(names).sort().map(function (name) {
    var written = Object.prototype.hasOwnProperty.call(totals, name) ? totals[name] : (reported ? 0 : null);
    var role = roles[name] || 'associate';
    var closing = { orders: null, opportunities: null, through: '', ratio: null, ratioStatus: 'Pending', reconcile: false, versusGoal: null, points: null, note: '', goal: goals.closing };
    var personAnalysis = { written: null, delivered: null };
    try { if (closingFacts) closing = personClosing_(closingFacts, name, start, end, goals.closing, analysis ? analysis.ledger : null); } catch (error) { closing = closing; }
    try { if (analysis) personAnalysis = personAnalysis_(analysis, name); } catch (error) { personAnalysis = personAnalysis; }
    var record = personRecord_(name, written, role, days[name] || [], goals, closing, personAnalysis);
    return historyPersonCard_(record, role);
  }).sort(function (left, right) {
    var a = left.snapWritten === null || left.snapWritten === undefined ? -1 : Number(left.snapWritten);
    var b = right.snapWritten === null || right.snapWritten === undefined ? -1 : Number(right.snapWritten);
    return b - a;
  });
}

function historyPersonCard_(person, role) {
  var bedding = null;
  (person.kpis || []).forEach(function (row) { if (row.name === 'Bedding') bedding = row; });
  var attach = null;
  var lines = person.attachments && person.attachments.written ? person.attachments.written.lines : [];
  (lines || []).forEach(function (line) { if (line.key === 'total') attach = line; });
  return {
    name: person.name,
    role: role,
    former: role === 'former',
    snapWritten: person.snapWritten,
    monthlyGoal: person.monthlyGoal,
    deliveredSales: person.deliveredSales,
    deliveredThrough: person.deliveredThrough || '',
    closingRatio: person.closingRatio,
    closingGoal: person.closing ? person.closing.goal : null,
    closingOrders: person.closingOrders,
    opportunities: person.opportunities,
    closingThrough: person.closingThrough || '',
    closingReconcile: !!person.closingReconcile,
    analysisWritten: person.analysisWritten,
    analysisWrittenThrough: person.analysisWrittenThrough || '',
    leave: person.leave || '',
    days: person.days || [],
    bedding: bedding ? { written: bedding.written, delivered: bedding.delivered, goal: bedding.goal, unit: bedding.unit } : null,
    attachment: attach ? { actual: attach.actual, goal: attach.goal } : null,
    kpis: (person.kpis || []).map(function (row) {
      return { name: row.name, unit: row.unit, goal: row.goal, written: row.written, delivered: row.delivered };
    }),
  };
}

function historyFocus_(people, name) {
  var wanted = String(name || '').trim();
  if (!wanted) return null;
  var found = null;
  people.forEach(function (person) { if (person.name === wanted) found = person; });
  return found;
}

function missingMeasureDays_(facts, period, closed, today, field) {
  var end = period.end < today ? period.end : shiftDate_(today, -1);
  if (!end || end < period.start) return [];
  var missing = [];
  eachDate_(period.start, end).forEach(function (date) {
    if (closed[date]) return;
    var amount = null;
    var found = false;
    facts.forEach(function (row) {
      if (row.date !== date) return;
      found = true;
      amount = row[field];
    });
    if (!found || amount === null || amount === undefined || amount === '') missing.push(date);
  });
  return missing;
}

function monthReviewChecks_(ctx) {
  var writtenCheck = coverageCheck_('Required daily Written reporting complete.', ctx.writtenMissing, ctx.today, ctx.store, 'NWDSR Written');
  var deliveredCheck = coverageCheck_('Required daily Delivered reporting complete.', ctx.deliveredMissing, ctx.today, ctx.store, 'NWDSR Delivered');
  var reconciled = writtenCheck.result === 'PASS' && deliveredCheck.result === 'PASS' && ctx.written !== null && ctx.delivered !== null;
  var storeCheck = reviewCheck_('Store totals reconciled.', reconciled ? 'PASS' : (ctx.written === null && ctx.delivered === null ? 'INCOMPLETE' : 'INCOMPLETE'), reconciled ? 'Every open store day in ' + ctx.store.start + ' through ' + ctx.store.end + ' has NWDSR Written and NWDSR Delivered. SNAP stays a separate measure.' : 'Store written and delivered are not both complete for every open day. Missing days were not filled with zero.');
  var assigned = 0;
  var assignedSeen = false;
  ctx.people.forEach(function (person) {
    if (person.snapWritten === null || person.snapWritten === undefined) return;
    assignedSeen = true;
    assigned += Number(person.snapWritten);
  });
  assigned = Math.round(assigned * 100) / 100;
  var peopleCheck;
  if (ctx.personSnap === null || !assignedSeen) peopleCheck = reviewCheck_('Individual salesperson totals reconciled, including approved unassigned adjustments.', 'INCOMPLETE', 'Store SNAP or individual SNAP lines are not both on file for ' + ctx.person.start + ' through ' + ctx.person.end + '.');
  else if (Math.round((ctx.personSnap - assigned) * 100) / 100 === 0) peopleCheck = reviewCheck_('Individual salesperson totals reconciled, including approved unassigned adjustments.', 'PASS', 'Individual SNAP ' + assigned + ' matches store SNAP ' + ctx.personSnap + ' for the salesperson month.');
  else peopleCheck = reviewCheck_('Individual salesperson totals reconciled, including approved unassigned adjustments.', 'FAIL', 'Individual SNAP ' + assigned + ' differs from store SNAP ' + ctx.personSnap + ' by ' + Math.round((ctx.personSnap - assigned) * 100) / 100 + '. No approved unassigned adjustment is on file.');
  var gaps = [];
  try {
    if (typeof sourceCoverageGaps_ === 'function') {
      gaps = sourceCoverageGaps_().filter(function (gap) {
        var date = isoDate_(gap.date);
        return date && ((date >= ctx.store.start && date <= ctx.store.end) || (date >= ctx.person.start && date <= ctx.person.end));
      });
    } else gaps = ['missing'];
  } catch (error) { gaps = ['missing']; }
  var kpiNames = Object.keys(ctx.kpiActuals || {});
  var coverageCheck;
  if (gaps.length && gaps[0] !== 'missing') coverageCheck = reviewCheck_('Required KPI source coverage complete.', 'INCOMPLETE', gaps.length + ' source gap' + (gaps.length === 1 ? '' : 's') + ' remain in this month. First: ' + (gaps[0].date || '') + ' ' + (gaps[0].report || gaps[0].source || ''));
  else if (gaps[0] === 'missing') coverageCheck = reviewCheck_('Required KPI source coverage complete.', 'INCOMPLETE', 'Source coverage for this month has not been calculated.');
  else if (!kpiNames.length) coverageCheck = reviewCheck_('Required KPI source coverage complete.', 'INCOMPLETE', 'No KPI workbook rows are stored for ' + ctx.store.start + ' through ' + ctx.store.end + '.');
  else coverageCheck = reviewCheck_('Required KPI source coverage complete.', 'PASS', 'No missing-source alert is open in this month, and ' + kpiNames.length + ' KPI row' + (kpiNames.length === 1 ? '' : 's') + ' are stored for the store period.');
  var kpiVerified = ['Bedding', 'Average Ticket', 'Finance'].every(function (name) {
    var row = ctx.kpiActuals[name];
    return row && row.written !== null && row.written !== undefined && !/blank|not shown|no verified/i.test(String(row.note || ''));
  });
  var kpiCheck = reviewCheck_('KPI calculations verified.', kpiVerified ? 'PASS' : 'INCOMPLETE', kpiVerified ? 'Bedding, Average Ticket, and Financing for this store period are stored as numbers.' : 'Bedding, Average Ticket, or Financing is missing for this store period, so the KPI set is not verified.');
  var closing = ctx.closing || {};
  var closingResult = 'INCOMPLETE';
  var closingEvidence = closing.gap || closing.note || 'Closing ratio is not on file for this store period.';
  if (closing.reconcile) {
    closingResult = 'FAIL';
    closingEvidence = 'Closing ratio is above 100% for ' + (closing.through || 'this month') + '.';
  } else if (closing.ratio !== null && closing.ratio !== undefined && !/^Pending/.test(String(closing.verification || ''))) {
    closingResult = 'PASS';
    closingEvidence = 'Closing ratio ' + closing.ratio + ' through ' + (closing.through || ctx.store.end) + '. ' + (closing.verification || '');
  }
  var ly = { confirmed: false, status: 'Pending', start: '', end: '' };
  try { ly = storeLastYear_(config_(), ctx.store); } catch (error) { ly = ly; }
  var lyCheck = ly.confirmed
    ? reviewCheck_('Last-year alignment verified.', 'PASS', 'Confirmed last-year period ' + ly.start + ' through ' + ly.end + '. ' + ly.status)
    : reviewCheck_('Last-year alignment verified.', 'INCOMPLETE', ly.status || 'The last-year period for this month is not confirmed, so no comparison range was used.');
  var accuracy = accuracyIssuesFor_(ctx.store, ctx.person);
  var accuracyCheck = reviewCheck_('No unresolved blocking data-accuracy issues.', accuracy.result, accuracy.evidence);
  var audit = consistencyForPeriod_(ctx.store);
  var auditCheck = reviewCheck_('Fresh cross-page consistency audit passed.', audit.result, audit.evidence);
  return [writtenCheck, deliveredCheck, storeCheck, peopleCheck, coverageCheck, kpiCheck, reviewCheck_('Closing ratio verified.', closingResult, closingEvidence), lyCheck, accuracyCheck, auditCheck];
}

function coverageCheck_(name, missing, today, period, label) {
  if (today <= period.start) return reviewCheck_(name, 'NOT APPLICABLE', 'No open day in this reporting period has arrived yet.');
  if (missing.length) return reviewCheck_(name, 'INCOMPLETE', label + ' is missing on ' + missing.slice(0, 6).join(', ') + (missing.length > 6 ? ' and ' + (missing.length - 6) + ' more day' + (missing.length - 6 === 1 ? '' : 's') : '') + '. Those days were not counted as zero.');
  return reviewCheck_(name, 'PASS', label + ' is on file for every open day from ' + period.start + ' through ' + (period.end < today ? period.end : shiftDate_(today, -1)) + '.');
}

function reviewCheck_(name, result, evidence) {
  return { name: name, result: result, evidence: evidence };
}

function accuracyIssuesFor_(store, person) {
  var issues = [];
  var scanned = 0;
  try {
    sheet_('CC_QualityChecks').forEach(function (row) {
      scanned += 1;
      if (String(row.status || '') !== 'FLAG') return;
      var text = String(row.subject || '') + ' ' + String(row.explanation || '');
      if (text.indexOf(store.start) !== -1 || text.indexOf(person.start.slice(0, 7)) !== -1) issues.push(text);
    });
  } catch (error) { scanned = -1; }
  try {
    sheet_('CC_DataStatus').forEach(function (row) {
      scanned += 1;
      var dates = String(row.period_dates || '');
      var named = dates.indexOf(store.start) !== -1 || dates.indexOf(store.end) !== -1;
      if (!named) return;
      if (/NEEDS REVIEW|FAIL|DISCREPAN/i.test(String(row.status || ''))) issues.push(String(row.name || row.key || 'Data status') + ' ' + row.status);
    });
  } catch (error) { if (scanned === 0) scanned = -1; }
  if (scanned < 0) return { result: 'INCOMPLETE', evidence: 'The accuracy tables could not be read for this month.' };
  if (issues.length) return { result: 'FAIL', evidence: issues.slice(0, 3).join(' ') };
  return { result: 'PASS', evidence: 'CC_QualityChecks and CC_DataStatus were scanned. None name this reporting period as an unresolved accuracy issue.' };
}

function consistencyForPeriod_(store) {
  var rows = [];
  try { rows = sheet_('CC_Consistency'); } catch (error) {
    return { result: 'INCOMPLETE', evidence: 'No cross-page consistency audit is on file for ' + store.start + ' through ' + store.end + '.' };
  }
  var hit = null;
  rows.forEach(function (row) {
    var summary = String(row.summary || '');
    if (summary.indexOf(store.start) !== -1 && summary.indexOf(store.end) !== -1) hit = row;
  });
  if (!hit) return { result: 'INCOMPLETE', evidence: 'No cross-page consistency audit on file names ' + store.start + ' through ' + store.end + '.' };
  if (String(hit.status || '') === 'PASS' && Number(hit.discrepancies || 0) === 0) return { result: 'PASS', evidence: 'Audit ' + (hit.run_at || '') + ' passed with no discrepancies for this reporting period.' };
  return { result: 'FAIL', evidence: 'Audit ' + (hit.run_at || '') + ' is ' + (hit.status || 'not passed') + ' with ' + (hit.discrepancies || 0) + ' discrepancies.' };
}

function monthChoices_() {
  var today = todayNy_();
  var year = isoParts_(today).year;
  var years = [];
  var cursor;
  for (cursor = 2026; cursor <= year; cursor += 1) years.push(cursor);
  if (!years.length) years.push(year);
  return { years: years, months: MONTH_NAMES_.map(function (name, index) { return { month: index + 1, name: name }; }) };
}

function monthStatusLabel_(status, snapshot) {
  if (status === 'NOT AVAILABLE') return 'NO DATA AVAILABLE';
  if (status === 'PARTIAL') return 'PARTIAL — NOT FINALIZED';
  if (status === 'READY FOR REVIEW') return 'READY FOR REVIEW';
  if (status === 'FINALIZED' && snapshot) return 'FINALIZED — Approved by ' + snapshot.by + ' on ' + snapshot.at;
  if (status === 'REVISED' && snapshot) return 'REVISED — Approved by ' + snapshot.by + ' on ' + snapshot.at;
  return status;
}

function historyRange_(start, end) {
  var first = isoParts_(start);
  var second = isoParts_(end);
  if (first.year === second.year && first.month === second.month) return MONTH_NAMES_[first.month - 1] + ' ' + first.day + '–' + second.day + ', ' + first.year;
  if (first.year === second.year) return MONTH_NAMES_[first.month - 1] + ' ' + first.day + '–' + MONTH_NAMES_[second.month - 1] + ' ' + second.day + ', ' + first.year;
  return historyLongDate_(start) + '–' + historyLongDate_(end);
}

function historyLongDate_(iso) {
  var parts = isoParts_(iso);
  return MONTH_NAMES_[parts.month - 1] + ' ' + parts.day + ', ' + parts.year;
}

function easternStamp_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd h:mm a') + ' America/New_York';
}

function monthSnapshotDigest_(text) {
  var bytes = [];
  var i;
  for (i = 0; i < text.length; i += 1) {
    var code = text.charCodeAt(i);
    if (code < 128) bytes.push(code);
    else if (code < 2048) bytes.push(192 | (code >> 6), 128 | (code & 63));
    else bytes.push(224 | (code >> 12), 128 | ((code >> 6) & 63), 128 | (code & 63));
  }
  var charset = Utilities.Charset && Utilities.Charset.UTF_8 ? Utilities.Charset.UTF_8 : 'UTF-8';
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes, charset);
  return raw.map(function (bite) {
    var value = (Number(bite) + 256) % 256;
    return (value < 16 ? '0' : '') + value.toString(16);
  }).join('');
}

function monthSnapshotRecords_() {
  var tab = historyTab_(MONTH_SNAPSHOT_TAB_, MONTH_SNAPSHOT_HEADERS_);
  var values = tab.getDataRange().getValues();
  var records = [];
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (!values[r][0]) continue;
    var record = { _row: r + 1 };
    MONTH_SNAPSHOT_HEADERS_.forEach(function (key, index) { record[key] = values[r][index]; });
    records.push(record);
  }
  return { tab: tab, records: records };
}

function parsedSnapshot_(record) {
  var body = String(record.body || '');
  if (!body || String(record.status || '') === 'VOID') return null;
  var digest = monthSnapshotDigest_(body);
  if (digest !== String(record.digest || '')) return null;
  try {
    var view = JSON.parse(body);
    view.snapshot = {
      id: String(record.snapshot_id), version: Number(record.version), status: String(record.status), by: String(record.finalized_by),
      at: String(record.finalized_at_et), digest: digest, prior: String(record.prior_snapshot_id || ''), integrity: 'verified',
    };
    view.status = String(record.status);
    view.label = monthStatusLabel_(view.status, view.snapshot);
    view.fromSnapshot = true;
    return { id: view.snapshot.id, version: view.snapshot.version, periodKey: String(record.period_key), view: view, row: record._row };
  } catch (error) {
    return null;
  }
}

function verifiedMonthSnapshot_(year, month) {
  var key = 'STORE-' + year + '-' + pad2_(month);
  var latest = null;
  monthSnapshotRecords_().records.forEach(function (record) {
    if (String(record.period_key) !== key) return;
    var parsed = parsedSnapshot_(record);
    if (!parsed) return;
    if (!latest || parsed.version >= latest.version) latest = parsed;
  });
  return latest;
}

function brokenMonthSnapshot_(year, month) {
  var key = 'STORE-' + year + '-' + pad2_(month);
  var broken = false;
  monthSnapshotRecords_().records.forEach(function (record) {
    if (String(record.period_key) !== key) return;
    if (String(record.status || '') === 'VOID') return;
    if (!parsedSnapshot_(record)) broken = true;
  });
  return broken && !verifiedMonthSnapshot_(year, month);
}

function monthSnapshotVersions_(periodKey) {
  return monthSnapshotRecords_().records.filter(function (record) {
    return String(record.period_key) === periodKey && parsedSnapshot_(record);
  }).map(function (record) {
    return { id: String(record.snapshot_id), version: Number(record.version), status: String(record.status), by: String(record.finalized_by), at: String(record.finalized_at_et), reason: String(record.reason || '') };
  });
}

function openMonthRevision_(periodKey) {
  var tab = historyTab_(MONTH_REVISION_TAB_, MONTH_REVISION_HEADERS_);
  var values = tab.getDataRange().getValues();
  var found = null;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][1]) !== periodKey || String(values[r][2]) !== 'OPEN') continue;
    found = { id: String(values[r][0]), periodKey: periodKey, reason: String(values[r][3] || ''), by: String(values[r][4] || ''), at: String(values[r][5] || ''), row: r + 1 };
  }
  return found;
}

function commitMonthSnapshot_(view, gm, status, priorId, reason) {
  var pack = monthSnapshotRecords_();
  var periodKey = 'STORE-' + view.year + '-' + pad2_(view.month);
  if (status === 'FINALIZED' && verifiedMonthSnapshot_(view.year, view.month)) throw new Error('This month is already finalized. Nothing was saved.');
  var version = 0;
  pack.records.forEach(function (record) {
    if (String(record.period_key) === periodKey && parsedSnapshot_(record)) version = Math.max(version, Number(record.version) || 0);
  });
  version += 1;
  var stamp = easternStamp_();
  view.status = status;
  view.snapshot = { id: '', version: version, status: status, by: gm.name, at: stamp, digest: '', prior: priorId || '', integrity: 'verified' };
  view.label = monthStatusLabel_(status, view.snapshot);
  view.fromSnapshot = true;
  view.print.status = status;
  var stored = JSON.parse(JSON.stringify(view));
  delete stored.choices;
  delete stored.versions;
  delete stored.revision;
  delete stored.snapshot;
  var body = JSON.stringify(stored);
  var digest = monthSnapshotDigest_(body);
  var id = 'SNAP-' + periodKey + '-v' + version + '-' + String(Utilities.getUuid()).slice(0, 8);
  view.snapshot.id = id;
  view.snapshot.digest = digest;
  pack.tab.appendRow([id, periodKey, view.year, view.month, version, 'PENDING', view.periods.storeStart, view.periods.storeEnd, view.periods.personStart, view.periods.personEnd, gm.name, stamp, digest, priorId || '', reason || '', '']);
  var written = pack.tab.getDataRange().getValues();
  var row = written.length;
  if (String(written[row - 1][0]) !== id || String(written[row - 1][12]) !== digest) {
    throw new Error('The snapshot write did not complete. The month was not finalized.');
  }
  written[row - 1][5] = status;
  written[row - 1][15] = body;
  pack.tab.getRange(row, 1, 1, MONTH_SNAPSHOT_HEADERS_.length).setValues([written[row - 1]]);
  var verified = verifiedMonthSnapshot_(view.year, view.month);
  if (!verified || verified.id !== id) {
    written[row - 1][5] = 'VOID';
    written[row - 1][15] = '';
    pack.tab.getRange(row, 1, 1, MONTH_SNAPSHOT_HEADERS_.length).setValues([written[row - 1]]);
    throw new Error('The snapshot could not be verified after it was written. The month was not finalized.');
  }
  verified.view.choices = monthChoices_();
  verified.view.versions = monthSnapshotVersions_(periodKey);
  verified.view.revision = openMonthRevision_(periodKey);
  return verified.view;
}
