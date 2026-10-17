/**
 * Automated data quality. After every scheduled import, every upload batch and every manual recalculation the checks
 * below read the workbook once and record what they found. They never change an imported or reported figure: a
 * problem is flagged with its explanation and stays flagged until the data that caused it is corrected.
 *
 * CC_QualityChecks  the latest result of every check (PASS, FLAG, NOTE). NOTE is a legitimate, explained difference.
 * CC_QualityRuns    one row per run.
 * CC_DataStatus     CURRENT / COMPLETE / PARTIAL / NEEDS REVIEW / MISSING for each metric, period and business day.
 * CC_Alerts         missing reports and flagged checks. An alert is resolved automatically when the report arrives and
 *                   passes validation, or when the check passes. Rows are never deleted.
 */

var QUALITY_TAB_ = 'CC_QualityChecks';
var QUALITY_HEADERS_ = ['check_id', 'area', 'status', 'subject', 'explanation', 'metrics', 'checked_at'];
var QUALITY_RUNS_TAB_ = 'CC_QualityRuns';
var QUALITY_RUN_HEADERS_ = ['run_at', 'trigger', 'checks', 'passed', 'flagged', 'noted', 'active_alerts', 'resolved_alerts', 'store_month_status', 'person_month_status', 'seconds'];
var DATA_STATUS_TAB_ = 'CC_DataStatus';
var DATA_STATUS_HEADERS_ = ['kind', 'key', 'name', 'approved_source', 'period_dates', 'verified_through', 'expected_through', 'status', 'explanation', 'checked_at'];
var ALERTS_TAB_ = 'CC_Alerts';
var ALERT_HEADERS_ = ['alert_key', 'category', 'severity', 'business_date', 'report', 'message', 'status', 'first_seen', 'last_seen', 'resolved_at', 'resolution', 'emailed_at'];

var QUALITY_AREAS_ = {
  'business-date': 'Business date',
  'reporting-period': 'Reporting period',
  'approved-source': 'Approved metric source',
  'duplicate-import': 'Duplicate imports',
  'cumulative-daily': 'Cumulative and daily totals',
  'employee-match': 'Employee matching',
  'written-delivered': 'Written versus Delivered',
  'kpi-math': 'KPI qualified and sold',
  'closing-math': 'Closing ratio',
  'store-reconcile': 'Store totals',
  'history-retained': 'Verified history',
  'report-package': 'Required reports',
};

// The approved sources from Tasks 1 and 2. A code change that moves a metric to another report fails this check.
var APPROVED_SOURCES_ = {
  store_written: 'NWDSR Net Written',
  store_delivered: 'NWDSR Delivered',
  store_snap_written: 'SNAP Written',
  store_purchasing_customers: 'NWDSR Net Written # OF CUST',
  store_opportunities: 'PERQ Location Ups + Be Backs',
  store_closing: 'NWDSR Net Written # OF CUST ÷ PERQ Location Ups + Be Backs',
  person_written: 'SNAP Written by salesperson',
  person_delivered: 'Group 17 Data Analysis Delivered',
  person_closing: 'Group 17 Data Analysis Written orders ÷ PERQ Salesperson Ups + Be Backs',
};

// Which metrics each required daily report feeds, so a report problem marks those metrics for review.
var REPORT_METRICS_ = {
  snapWritten: ['store_snap_written', 'person_written'],
  nwdsrWritten: ['store_written', 'store_written_daily_goal', 'store_purchasing_customers', 'store_closing', 'kpi_warranty'],
  nwdsrDelivered: ['store_delivered', 'store_delivered_daily_goal'],
  g17Written: ['kpi_bedding', 'store_bedding_dollars', 'kpi_average_ticket', 'kpi_fabric', 'kpi_leather', 'kpi_power', 'kpi_protectors', 'kpi_total_attachment', 'kpi_finance', 'person_written_orders', 'person_kpis', 'person_closing'],
  g17Delivered: ['kpi_bedding', 'store_bedding_dollars', 'kpi_average_ticket', 'kpi_fabric', 'kpi_leather', 'kpi_power', 'kpi_protectors', 'kpi_total_attachment', 'kpi_finance', 'person_delivered', 'person_kpis'],
  aslWritten: ['kpi_rugs', 'kpi_adjustable_base', 'kpi_pillows', 'kpi_wood', 'kpi_power_base'],
  aslDelivered: ['kpi_rugs', 'kpi_adjustable_base', 'kpi_pillows', 'kpi_wood', 'kpi_power_base'],
  perqLocation: ['store_opportunities', 'store_closing'],
  perqSalesperson: ['person_opportunities', 'person_closing'],
};

var STATUS_RANK_ = { 'NEEDS REVIEW': 4, MISSING: 3, PARTIAL: 2, CURRENT: 1, COMPLETE: 0 };

function qualityTab_(name, headers) {
  forgetRead_(name);
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) {
    tab = spreadsheet.insertSheet(name);
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return tab;
}

function rewriteTab_(name, headers, rows) {
  var tab = qualityTab_(name, headers);
  var grid = [headers].concat(rows.map(function (row) {
    var line = row.slice(0, headers.length);
    while (line.length < headers.length) line.push('');
    return line;
  }));
  tab.clearContents();
  tab.getRange(1, 1, grid.length, headers.length).setValues(grid);
}

/** The hour in New York, 0–23. Reports for a day are due at report_due_hour (CC_Config, default 10) the next day. */
function nowHourNy_() {
  var hour = Number(Utilities.formatDate(new Date(), 'America/New_York', 'H'));
  return isFinite(hour) ? hour : 24;
}

function reportDueHour_(config) {
  var hour = Number(config.report_due_hour);
  return config.report_due_hour !== '' && config.report_due_hour !== undefined && isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 10;
}

function qualityKeyCount_(values, label) {
  var seen = {};
  var repeated = [];
  values.forEach(function (key) {
    if (!key) return;
    if (seen[key] === 1) repeated.push(key);
    seen[key] = (seen[key] || 0) + 1;
  });
  return { label: label, total: values.filter(Boolean).length, repeated: repeated };
}

function near_(left, right, tolerance) {
  return left !== null && right !== null && Math.abs(left - right) <= tolerance;
}

/* ---------- context: every tab the checks use, read once ---------- */

function qualityContext_(today) {
  var config = config_();
  var yesterday = shiftDate_(today, -1);
  var store = storePeriodContaining_(today);
  var person = individualPeriodContaining_(today);
  var dayStore = storePeriodContaining_(yesterday);
  var dayPerson = individualPeriodContaining_(yesterday);
  var ctx = {
    today: today,
    yesterday: yesterday,
    store: store,
    person: person,
    windowStart: dayStore.start < dayPerson.start ? dayStore.start : dayPerson.start,
    dueHour: reportDueHour_(config),
    hour: nowHourNy_(),
    config: config,
    closed: closedDates_(),
    facts: dailyFacts_(),
    dailyRows: sheet_('CC_Daily'),
    ledger: ledgerRows_(),
    kpi: sheet_('CC_Kpi'),
    closing: sheet_('CC_Closing'),
    closingDaily: sheet_('CC_ClosingDaily'),
    closingMtd: {},
    rollup: {},
    monthEnd: sheet_('CC_MonthEnd'),
    imports: sheet_('CC_Imports'),
    uploads: uploadRows_(),
    register: sheet_('CC_DailyHistory'),
    archive: sheet_('CC_SourceArchive'),
    monthly: sheet_('CC_MonthlyHistory'),
    goals: sheet_('CC_GoalHistory'),
    replaced: sheet_('CC_History'),
    definitions: sheet_('CC_MetricDefinitions'),
    scopeAudit: sheet_('CC_ScopeAudit'),
    associateDays: sheet_('CC_AssociateDays'),
    roster: rosterRows_(),
  };
  sheet_('CC_ClosingMTD').forEach(function (row) { ctx.closingMtd[String(row.Metric || '').trim()] = row.Value; });
  sheet_('CC_Rollup').forEach(function (row) { ctx.rollup[String(row.metric || '')] = row.value; });
  ctx.evidence = uploadEvidence_();
  ctx.packageMemo = {};
  return ctx;
}

/** Day D's reports are due once D is before yesterday, or D is yesterday and the due hour has passed. */
function reportDue_(ctx, date) {
  return date < ctx.yesterday || (date === ctx.yesterday && ctx.hour >= ctx.dueHour);
}

/* ---------- required reports: one package of nine per business day ---------- */

function cumulativeCover_(ctx, views, side, track, date) {
  var period = track === 'STORE' ? storePeriodContaining_(date) : individualPeriodContaining_(date);
  var best = '';
  ctx.ledger.forEach(function (row) {
    if (views.indexOf(row.view) === -1 || row.grain !== 'cumulative' || !row.fitsTrack || row.side !== side) return;
    if (track === 'STORE' && (row.code || row.name)) return;
    if (row.periodStart !== period.start || row.verifiedThrough < date) return;
    if (row.verifiedThrough > best) best = row.verifiedThrough;
  });
  return best;
}

function perqSnapshotCover_(ctx, scope, date) {
  var period = scope === 'store' ? storePeriodContaining_(date) : individualPeriodContaining_(date);
  var best = '';
  ctx.closing.forEach(function (row) {
    if (String(row.scope) !== scope || String(row.source || '').trim() !== 'PERQ Ups + Be Backs' || String(row.final || '').toLowerCase() !== 'yes') return;
    var start = isoDate_(row.period_start);
    var end = isoDate_(row.period_end);
    var through = isoDate_(row.verified_through) || end;
    if (start !== period.start || start === end || through < date) return;
    if (through > best) best = through;
  });
  return best;
}

/** One report for one day: Imported, Covered by a month-to-date report, Needs Review, Failed, Missing or Awaiting. */
function packageItem_(ctx, date, key) {
  var memo = ctx.packageMemo[date];
  if (!memo) {
    memo = {};
    uploadChecklist_(ctx.evidence, date).forEach(function (item) { memo[item.key] = item; });
    ctx.packageMemo[date] = memo;
  }
  var item = memo[key];
  var result = { key: key, label: item.label, status: item.status, detail: item.message };
  if (item.status !== 'Missing') return result;
  var cover = '';
  if (key === 'g17Written' || key === 'g17Delivered') cover = cumulativeCover_(ctx, ['DA_SALES_STORE'], key === 'g17Written' ? 'written' : 'delivered', 'STORE', date);
  if (key === 'aslWritten' || key === 'aslDelivered') cover = cumulativeCover_(ctx, ['RUGS_STORE', 'PILLOWS_STORE', 'BASES_STORE', 'FP_STORE'], key === 'aslWritten' ? 'written' : 'delivered', 'STORE', date);
  if (key === 'perqLocation') cover = perqSnapshotCover_(ctx, 'store', date) || cumulativeCover_(ctx, ['PERQ_STORE'], '', 'STORE', date);
  if (key === 'perqSalesperson') cover = perqSnapshotCover_(ctx, 'person', date) || cumulativeCover_(ctx, ['PERQ_PERSON'], '', 'PERSON', date);
  if (cover) return { key: key, label: item.label, status: 'Covered', detail: 'Covered by the month-to-date report verified through ' + cover + '.' };
  if (!reportDue_(ctx, date)) return { key: key, label: item.label, status: 'Awaiting', detail: 'Due by ' + ctx.dueHour + ':00 on ' + shiftDate_(date, 1) + '.' };
  return result;
}

/** The reports a day needs: store reports from the store month, PERQ by salesperson from the salesperson month. */
function requiredReports_(ctx, date) {
  if (ctx.closed[date]) return [];
  var store = storePeriodContaining_(ctx.yesterday);
  var person = individualPeriodContaining_(ctx.yesterday);
  var inStore = date >= store.start && date <= store.end;
  var inPerson = date >= person.start && date <= person.end;
  return UPLOAD_REPORTS_.map(function (report) { return report.key; }).filter(function (key) {
    if (key === 'perqSalesperson') return inPerson;
    if (key === 'snapWritten') return inStore || inPerson;
    return inStore;
  });
}

function dayPackages_(ctx) {
  var days = [];
  eachDate_(ctx.windowStart, ctx.yesterday).forEach(function (date) {
    var keys = requiredReports_(ctx, date);
    if (!keys.length) return;
    var items = keys.map(function (key) { return packageItem_(ctx, date, key); });
    var onFile = items.filter(function (item) { return item.status === 'Imported' || item.status === 'Covered'; });
    var review = items.filter(function (item) { return item.status === 'Needs Review' || item.status === 'Failed'; });
    var missing = items.filter(function (item) { return item.status === 'Missing'; });
    var awaiting = items.filter(function (item) { return item.status === 'Awaiting'; });
    var status = review.length ? 'NEEDS REVIEW' : onFile.length === items.length ? 'COMPLETE' : onFile.length || awaiting.length ? 'PARTIAL' : 'MISSING';
    var text = onFile.length + ' of ' + items.length + ' required reports on file and verified';
    if (review.length) text += '; needs review: ' + review.map(function (item) { return item.label + ' (' + item.detail + ')'; }).join('; ');
    if (missing.length) text += '; missing: ' + missing.map(function (item) { return item.label; }).join(', ');
    if (awaiting.length) text += '; not due yet: ' + awaiting.map(function (item) { return item.label; }).join(', ') + ' (due by ' + ctx.dueHour + ':00 on ' + shiftDate_(date, 1) + ')';
    days.push({ date: date, status: status, items: items, onFile: onFile.length, total: items.length, text: text + '.' });
  });
  return days;
}

/* ---------- the checks ---------- */

function qualityChecks_(ctx, packages) {
  var out = [];
  function add(id, status, subject, explanation, metrics) {
    out.push({ id: id, area: QUALITY_AREAS_[id], status: status, subject: subject, explanation: explanation, metrics: metrics || [] });
  }
  checkBusinessDates_(ctx, add);
  checkReportingPeriods_(ctx, add);
  checkApprovedSources_(ctx, add);
  checkDuplicates_(ctx, add);
  checkCumulativeDaily_(ctx, add);
  checkEmployeeMatching_(ctx, add);
  checkWrittenDelivered_(ctx, add);
  checkKpiMath_(ctx, add);
  checkClosingMath_(ctx, add);
  checkStoreTotals_(ctx, add);
  checkHistoryRetained_(ctx, add);
  checkReportPackages_(ctx, packages, add);
  return out;
}

function checkBusinessDates_(ctx, add) {
  var problems = 0;
  ctx.dailyRows.forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date) { problems += 1; add('business-date', 'FLAG', 'CC_Daily ' + String(row.date), 'A CC_Daily row is dated "' + String(row.date) + '", which is not a business date. Pages skip it.', ['store_written', 'store_delivered', 'store_snap_written']); return; }
    if (date >= ctx.today) { problems += 1; add('business-date', 'FLAG', 'CC_Daily ' + date, 'CC_Daily holds a figure for ' + date + ', which has not finished as a business day. A daily report covers a finished day.', ['store_written', 'store_delivered', 'store_snap_written']); }
  });
  var daily = ctx.ledger.filter(function (row) { return row.grain === 'daily'; });
  daily.forEach(function (row) {
    var date = row.reportDate || row.periodStart;
    if (date && date < ctx.today) return;
    problems += 1;
    add('business-date', 'FLAG', row.view + ' ' + (date || 'no date'), row.view + ' has a single-day row for ' + (date || 'no date') + ' from ' + row.source + '. A single-day report must be for a finished business day.', []);
  });
  ctx.uploads.forEach(function (row) {
    if (row.status !== 'Imported' || !row.start || row.start !== row.end || row.start === row.date) return;
    problems += 1;
    add('business-date', 'FLAG', row.file, row.file + ' was imported for business date ' + row.date + ' but prints ' + row.start + '.', []);
  });
  if (!problems) add('business-date', 'PASS', 'All daily records', ctx.dailyRows.length + ' CC_Daily days and ' + daily.length + ' single-day report rows are each dated to a finished business day; imported uploads match their printed date.');
}

function checkReportingPeriods_(ctx, add) {
  var documented = {};
  ctx.scopeAudit.forEach(function (row) {
    documented[[row.record, isoDate_(row.period_start), isoDate_(row.period_end), String(row.employee_name || ''), String(row.side || ''), String(row.source_report || '')].join('|')] = true;
  });
  var explained = 0;
  var unexplained = {};
  ctx.ledger.forEach(function (row) {
    if (!row.scope || row.fitsTrack) return;
    if (documented[[row.view, row.periodStart, row.periodEnd, row.name, row.side, row.source].join('|')]) { explained += 1; return; }
    var key = row.view + ' ' + row.periodStart + ' to ' + row.periodEnd;
    unexplained[key] = unexplained[key] || { count: 0, source: row.source, scope: row.scope };
    unexplained[key].count += 1;
  });
  Object.keys(unexplained).forEach(function (key) {
    var item = unexplained[key];
    add('reporting-period', 'FLAG', key, item.count + ' row(s) from ' + item.source + ' cover ' + key.split(' ').slice(1).join(' ') + ', which is not a ' + (item.scope === 'STORE' ? 'store month (the 2nd through the 1st)' : 'salesperson month (the 1st through the last day)') + ' and is not documented in CC_ScopeAudit. They are kept and left out of every figure; confirm the report period.', []);
  });
  if (explained) add('reporting-period', 'NOTE', 'Rows outside their reporting period', explained + ' CC_Ledger rows were printed for a period that does not match their Store or Person month. Each is documented in CC_ScopeAudit, kept on file, and left out of the figures.');
  var bad = 0;
  ctx.kpi.forEach(function (row) {
    var start = isoDate_(row.period_start);
    var end = isoDate_(row.period_end);
    if (!row.metric || String(row.metric) === 'Daily Bedding' || fitsTrack_('STORE', start, end)) return;
    bad += 1;
    add('reporting-period', 'FLAG', 'CC_Kpi ' + row.metric + ' ' + start + ' to ' + end, 'The CC_Kpi row for ' + row.metric + ' covers ' + start + ' to ' + end + ', which is not a store month. Home ignores it.', []);
  });
  ctx.monthEnd.forEach(function (row) {
    var track = String(row.track) === 'Person' ? 'PERSON' : 'STORE';
    var start = isoDate_(row.period_start);
    var end = isoDate_(row.period_end);
    var period = track === 'STORE' ? storePeriodContaining_(start) : individualPeriodContaining_(start);
    if (period.start === start && period.end === end) return;
    bad += 1;
    add('reporting-period', 'FLAG', 'CC_MonthEnd ' + row.track + ' ' + row.metric + ' ' + start, 'CC_MonthEnd ' + row.track + ' row ' + row.metric + ' is dated ' + start + ' to ' + end + ', which is not a ' + row.track + ' month.', []);
  });
  var mtdStart = isoDate_(ctx.closingMtd['Period start']);
  var mtdEnd = isoDate_(ctx.closingMtd['Period end']);
  if (mtdStart && (mtdStart !== ctx.store.start || mtdEnd !== ctx.store.end)) {
    bad += 1;
    add('reporting-period', 'FLAG', 'CC_ClosingMTD period', 'CC_ClosingMTD covers ' + mtdStart + ' to ' + mtdEnd + ' but the current store month is ' + ctx.store.start + ' to ' + ctx.store.end + '.', ['store_closing']);
  }
  if (!bad && !Object.keys(unexplained).length) add('reporting-period', 'PASS', 'Store and Person months', 'Every figure in use matches its period: store month ' + ctx.store.start + ' to ' + ctx.store.end + ', salesperson month ' + ctx.person.start + ' to ' + ctx.person.end + ' (CC_Kpi, CC_MonthEnd, CC_ClosingMTD).');
}

function checkApprovedSources_(ctx, add) {
  var problems = 0;
  Object.keys(APPROVED_SOURCES_).forEach(function (key) {
    var source = '';
    try { source = metricSource_(key); } catch (error) { source = ''; }
    if (source === APPROVED_SOURCES_[key]) return;
    problems += 1;
    add('approved-source', 'FLAG', key, 'The code now takes ' + key + ' from "' + (source || 'nothing') + '" but the approved source is "' + APPROVED_SOURCES_[key] + '".', [key]);
  });
  if (metricDefinition_('store_snap_written').goalKey) {
    problems += 1;
    add('approved-source', 'FLAG', 'store_snap_written', 'SNAP Written is tied to a goal. It is a reconciliation figure only; the store goal uses NWDSR Net Written.', ['store_snap_written']);
  }
  var tab = {};
  ctx.definitions.forEach(function (row) { tab[String(row.metric_key)] = String(row.approved_source || ''); });
  METRIC_DEFINITIONS_.forEach(function (definition) {
    if (tab[definition.key] === definition.source) return;
    problems += 1;
    add('approved-source', 'FLAG', 'CC_MetricDefinitions ' + definition.key, 'CC_MetricDefinitions shows "' + (tab[definition.key] || 'no row') + '" for ' + definition.name + '; the approved source is "' + definition.source + '". Pages use the approved source and the tab is rewritten on the next refresh.', [definition.key]);
  });
  var snapDelivered = ctx.imports.filter(function (row) { return /not.used/i.test(String(row.status || '')); }).length;
  if (snapDelivered) add('approved-source', 'NOTE', 'Files kept but not used', snapDelivered + ' imported file(s) are logged as not used (for example SNAP Delivered, which is not the delivered standard). No figure came from them.');
  if (!problems) add('approved-source', 'PASS', 'All metrics', METRIC_DEFINITIONS_.length + ' metrics use their approved source. Store written is NWDSR Net Written, store delivered is NWDSR Delivered, SNAP Written is reconciliation only, salesperson written is SNAP by salesperson.');
}

function checkDuplicates_(ctx, add) {
  var groups = [
    qualityKeyCount_(ctx.imports.map(function (row) { return String(row.sha256 || ''); }), 'CC_Imports files (sha256)'),
    qualityKeyCount_(ctx.dailyRows.map(function (row) { return isoDate_(row.date); }), 'CC_Daily business dates'),
    qualityKeyCount_(ctx.ledger.map(function (row) { return row.key; }), 'CC_Ledger record keys'),
    qualityKeyCount_(ctx.kpi.map(function (row) { return [row.metric, isoDate_(row.period_start), isoDate_(row.period_end)].join('|'); }), 'CC_Kpi metric and period'),
    qualityKeyCount_(ctx.closing.map(function (row) { return [row.scope, row.employee_code, row.source, isoDate_(row.period_start), isoDate_(row.period_end)].join('|'); }), 'CC_Closing counts'),
    qualityKeyCount_(ctx.register.map(function (row) { return String(row.record_key || ''); }), 'CC_DailyHistory record keys'),
    qualityKeyCount_(ctx.archive.map(function (row) { return String(row.sha256 || ''); }), 'CC_SourceArchive originals'),
    qualityKeyCount_(ctx.uploads.filter(function (row) { return row.status === 'Imported'; }).map(function (row) { return row.sha256; }), 'CC_Uploads imported files'),
  ];
  var problems = 0;
  groups.forEach(function (group) {
    group.repeated.forEach(function (key) {
      problems += 1;
      add('duplicate-import', 'FLAG', group.label + ' ' + key, group.label + ' has "' + key + '" more than once. A repeated import would count the same report twice; the totals were not changed by this check.', []);
    });
  });
  if (!problems) add('duplicate-import', 'PASS', 'All keyed tabs', groups.map(function (group) { return group.label + ' ' + group.total; }).join(', ') + ': no key appears twice.');
}

function closingNumber_(value) {
  return fineNumber_(value === 'Pending' ? '' : value);
}

function checkCumulativeDaily_(ctx, add) {
  var problems = 0;
  ctx.ledger.forEach(function (row) {
    if (row.grain !== 'daily' || row.periodStart === row.periodEnd) return;
    problems += 1;
    add('cumulative-daily', 'FLAG', row.view + ' ' + row.periodStart + ' to ' + row.periodEnd, 'A row filed as a single day covers ' + row.periodStart + ' to ' + row.periodEnd + ' (' + row.source + '). It would be added on top of the month-to-date report.', []);
  });
  var through = isoDate_(ctx.closingMtd['MTD through']);
  var checked = [];
  if (through) {
    var customers = 0;
    var custSeen = false;
    var perqSnapshot = null;
    ctx.closing.forEach(function (row) {
      if (String(row.scope) !== 'store' || String(row.employee_code || '') || String(row.final || '').toLowerCase() !== 'yes') return;
      var start = isoDate_(row.period_start);
      var end = isoDate_(row.period_end);
      var source = String(row.source || '').trim();
      if (source === 'NWDSR Net Written # OF CUST' && start === end && start >= ctx.store.start && start <= through) { customers += Number(row.customers) || 0; custSeen = true; }
      if (source === 'PERQ Ups + Be Backs' && start === ctx.store.start && start !== end) {
        var at = isoDate_(row.verified_through) || end;
        if (at <= through && (!perqSnapshot || at > perqSnapshot.through)) perqSnapshot = { through: at, value: Number(row.opportunities) || 0 };
      }
    });
    var opportunities = null;
    if (perqSnapshot) {
      opportunities = perqSnapshot.value;
      ctx.closing.forEach(function (row) {
        if (String(row.scope) !== 'store' || String(row.employee_code || '') || String(row.source || '').trim() !== 'PERQ Ups + Be Backs' || String(row.final || '').toLowerCase() !== 'yes') return;
        var start = isoDate_(row.period_start);
        if (start !== isoDate_(row.period_end) || start <= perqSnapshot.through || start > through) return;
        opportunities += Number(row.opportunities) || 0;
      });
    }
    var shownCustomers = closingNumber_(ctx.closingMtd['Purchasing customers']);
    var shownOpportunities = closingNumber_(ctx.closingMtd.Opportunities);
    if (custSeen && shownCustomers !== null) {
      checked.push('purchasing customers ' + shownCustomers);
      if (shownCustomers !== customers) { problems += 1; add('cumulative-daily', 'FLAG', 'Purchasing customers through ' + through, 'CC_ClosingMTD shows ' + shownCustomers + ' purchasing customers through ' + through + ', but the single-day NWDSR Net Written counts add to ' + customers + '. A month-to-date report may have been added on top of the daily counts.', ['store_purchasing_customers', 'store_closing']); }
    }
    if (opportunities !== null && shownOpportunities !== null) {
      checked.push('opportunities ' + shownOpportunities + ' (PERQ snapshot through ' + perqSnapshot.through + ' plus later days)');
      if (shownOpportunities !== opportunities) { problems += 1; add('cumulative-daily', 'FLAG', 'PERQ opportunities through ' + through, 'CC_ClosingMTD shows ' + shownOpportunities + ' opportunities, but the latest PERQ snapshot (through ' + perqSnapshot.through + ') plus the later daily counts is ' + opportunities + '. Snapshots must never be added together or to the days they cover.', ['store_opportunities', 'store_closing']); }
    }
  }
  ['written', 'delivered'].forEach(function (side) {
    var snapshot = latestStoreLedger_('DA_SALES_STORE', side, ctx.store.start);
    var row = ctx.monthEnd.filter(function (line) { return String(line.track) === 'Store' && String(line.metric) === 'Data Analysis Group 17 sales' && String(line.side) === side && isoDate_(line.period_start) === ctx.store.start; })[0];
    if (!row) return;
    var reported = fineNumber_(row.verified_mtd);
    var at = isoDate_(row.verified_through);
    if (reported === null || !at) return;
    var expected = snapshot && snapshot.verifiedThrough <= at ? snapshot.sales || 0 : 0;
    var after = snapshot && snapshot.verifiedThrough <= at ? snapshot.verifiedThrough : '';
    ctx.ledger.forEach(function (line) {
      if (line.view !== 'DA_SALES_STORE' || line.grain !== 'daily' || line.side !== side || line.code || line.name) return;
      var date = line.reportDate || line.periodStart;
      if (date < ctx.store.start || date > at || (after && date <= after)) return;
      expected += line.sales || 0;
    });
    expected = Math.round(expected * 100) / 100;
    checked.push('Group 17 ' + side + ' ' + moneyPlain_(reported));
    if (!near_(expected, reported, 0.01)) { problems += 1; add('cumulative-daily', 'FLAG', 'Group 17 ' + side + ' through ' + at, 'CC_MonthEnd shows Group 17 ' + side + ' sales of ' + moneyPlain_(reported) + ' through ' + at + ', but the latest month-to-date file plus the later daily files is ' + moneyPlain_(expected) + '.', side === 'written' ? ['person_written_orders', 'kpi_bedding'] : ['person_delivered', 'kpi_bedding']); }
  });
  if (!problems) add('cumulative-daily', 'PASS', 'Month-to-date figures', 'Single-day rows each cover one day; month-to-date figures use the latest cumulative report plus only the days after it' + (checked.length ? ' (' + checked.join('; ') + ')' : '') + '.');
}

function checkEmployeeMatching_(ctx, add) {
  var unmatched = {};
  function note(name, code, where, date) {
    var key = aliasKey_(name) || String(code || '').toLowerCase();
    if (!key) return;
    var item = unmatched[key] || (unmatched[key] = { name: name || code, where: {}, dates: [] });
    item.where[where] = true;
    if (date && item.dates.indexOf(date) === -1) item.dates.push(date);
  }
  ctx.ledger.forEach(function (row) {
    if (row.scope !== 'PERSON' || !row.fitsTrack || row.periodStart < ctx.person.start || row.periodStart > ctx.person.end) return;
    if (row.view === 'SNAP_PERSON') return;
    if (rosterMatch_(row.code, row.name)) return;
    note(row.name, row.code, row.view.replace(/_PERSON$/, ''), row.grain === 'daily' ? row.periodStart : '');
  });
  ctx.associateDays.forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date || date < ctx.person.start || date > ctx.person.end) return;
    if (rosterMatch_('', row.source_name || row.display_name)) return;
    note(String(row.display_name || row.source_name || ''), '', 'SNAP ' + moneyPlain_(fineNumber_(row.amount)), date);
  });
  var ids = qualityKeyCount_(ctx.roster.map(function (entry) { return entry.employeeId.toLowerCase(); }), 'employee ID');
  ids.repeated.forEach(function (id) {
    add('employee-match', 'FLAG', 'Roster employee ID ' + id, 'Employee ID ' + id + ' is on more than one roster row, so report lines with that ID cannot be matched to one person.', ['person_written', 'person_kpis']);
  });
  Object.keys(unmatched).sort().forEach(function (key) {
    var item = unmatched[key];
    add('employee-match', 'FLAG', item.name, item.name + ' appears on ' + Object.keys(item.where).join(', ') + (item.dates.length ? ' (' + item.dates.sort().join(', ') + ')' : '') + ' in the salesperson month but does not match one roster person (CC_People). The lines stay in store totals and on file under the printed name (month end shows "Not on the roster"); they are not credited to any roster salesperson. Add the name or alias to the roster, with a Transferred or Terminated status if they do not sell at Store 17.', ['person_written', 'person_kpis', 'person_delivered']);
  });
  if (!ids.repeated.length && !Object.keys(unmatched).length) add('employee-match', 'PASS', 'Salesperson month', 'Every salesperson line from ' + ctx.person.start + ' matches exactly one roster person.');
}

var VIEW_SIDES_ = { SNAP_STORE: 'written', SNAP_PERSON: 'written', NWDSR_WRITTEN_STORE: 'written', NWDSR_WRITTEN_PERSON: 'written', NWDSR_DELIVERED_STORE: 'delivered', NWDSR_DELIVERED_PERSON: 'delivered', PERQ_STORE: '', PERQ_PERSON: '' };

function checkWrittenDelivered_(ctx, add) {
  var wrong = {};
  ctx.ledger.forEach(function (row) {
    var expected = Object.prototype.hasOwnProperty.call(VIEW_SIDES_, row.view) ? VIEW_SIDES_[row.view] : null;
    var problem = '';
    if (expected !== null && row.side !== expected) problem = 'is filed as "' + row.side + '" but ' + row.view + ' is ' + (expected || 'neither written nor delivered');
    if (expected === null && row.side !== 'written' && row.side !== 'delivered') problem = 'has side "' + row.side + '"; KPI rows must be written or delivered';
    var file = String(row.source || '').toUpperCase();
    if (!problem && /DELIVERED/.test(file) && !/WRITTEN/.test(file) && row.side === 'written') problem = 'comes from a Delivered file but is filed as written';
    if (!problem && /WRITTEN/.test(file) && !/DELIVERED/.test(file) && row.side === 'delivered') problem = 'comes from a Written file but is filed as delivered';
    if (!problem) return;
    var key = row.view + ' ' + row.source;
    wrong[key] = wrong[key] || { count: 0, problem: problem };
    wrong[key].count += 1;
  });
  Object.keys(wrong).forEach(function (key) {
    add('written-delivered', 'FLAG', key, wrong[key].count + ' row(s) of ' + key + ' ' + wrong[key].problem + '. Written and delivered are never combined; check the import.', []);
  });
  if (!Object.keys(wrong).length) add('written-delivered', 'PASS', 'All report rows', ctx.ledger.length + ' CC_Ledger rows are filed on the side their report prints; NWDSR Written, NWDSR Delivered and SNAP Written stay in separate CC_Daily columns.');
}

function checkKpiMath_(ctx, add) {
  var checked = 0;
  var problems = 0;
  ctx.ledger.forEach(function (row) {
    if (row.eligible === null || row.eligible <= 0 || row.attachments === null || row.percent === null) return;
    checked += 1;
    var expected = Math.round((row.attachments / row.eligible) * 1000) / 1000;
    if (near_(row.percent, expected, 0.0011)) return;
    problems += 1;
    add('kpi-math', 'FLAG', row.view + ' ' + (row.name || 'Store 17') + ' ' + row.periodStart + (row.periodEnd !== row.periodStart ? ' to ' + row.periodEnd : ''), row.source + ' prints ' + percentText_(row.percent) + ' for ' + (row.name || 'Store 17') + ', but its own counts are ' + row.attachments + ' sold of ' + row.eligible + ' qualified (' + percentText_(expected) + '). The reported value was kept; confirm the report.', []);
  });
  ctx.kpi.forEach(function (row) {
    var match = /Written (-?[\d.]+) of (-?[\d.]+), delivered (-?[\d.]+) of (-?[\d.]+)/.exec(String(row.note || ''));
    if (!match || isoDate_(row.period_start) !== ctx.store.start) return;
    [[fineNumber_(row.written), Number(match[1]), Number(match[2]), 'written'], [fineNumber_(row.delivered), Number(match[3]), Number(match[4]), 'delivered']].forEach(function (side) {
      if (side[0] === null || !side[2]) return;
      checked += 1;
      var expected = Math.round((side[1] / side[2]) * 1000) / 1000;
      if (near_(side[0], expected, 0.0011)) return;
      problems += 1;
      add('kpi-math', 'FLAG', 'CC_Kpi ' + row.metric + ' ' + side[3], 'CC_Kpi ' + row.metric + ' ' + side[3] + ' is ' + percentText_(side[0]) + ' but ' + side[1] + ' sold of ' + side[2] + ' qualified is ' + percentText_(expected) + '.', []);
    });
  });
  ctx.monthEnd.forEach(function (row) {
    var sold = fineNumber_(row.sold);
    var qualified = fineNumber_(row.qualified);
    var value = fineNumber_(row.verified_mtd);
    if (String(row.unit) !== 'percent' || sold === null || !qualified || value === null) return;
    checked += 1;
    var expected = Math.round((sold / qualified) * 1000) / 1000;
    if (near_(value, expected, 0.0011)) return;
    problems += 1;
    add('kpi-math', 'FLAG', 'CC_MonthEnd ' + row.track + ' ' + row.metric + ' ' + row.side + ' ' + (row.person || ''), 'CC_MonthEnd ' + row.metric + ' is ' + percentText_(value) + ' but ' + sold + ' sold of ' + qualified + ' qualified is ' + percentText_(expected) + '.', []);
  });
  if (!problems) add('kpi-math', 'PASS', 'Attachment counts and rates', checked + ' KPI rates (report rows, CC_Kpi and CC_MonthEnd) equal sold ÷ qualified from their own counts, recalculated rather than averaged.');
}

function checkClosingMath_(ctx, add) {
  var checked = 0;
  var problems = 0;
  function check(subject, customers, opportunities, ratio, metrics) {
    if (customers === null || !opportunities || ratio === null) return;
    checked += 1;
    var expected = customers / opportunities;
    if (near_(ratio, expected, 0.0006)) return;
    problems += 1;
    add('closing-math', 'FLAG', subject, subject + ' shows ' + percentText_(ratio) + ' but ' + customers + ' ÷ ' + opportunities + ' is ' + percentText_(expected) + '.', metrics);
  }
  check('Store closing month to date (CC_ClosingMTD)', closingNumber_(ctx.closingMtd['Purchasing customers']), closingNumber_(ctx.closingMtd.Opportunities), closingNumber_(ctx.closingMtd['Closing ratio']), ['store_closing']);
  ctx.closingDaily.forEach(function (row) {
    var date = isoDate_(row.Date);
    check('Store closing ' + date, closingNumber_(row['NWDSR Written purchasing customers']), closingNumber_(row['PERQ opportunities']), closingNumber_(row['Closing ratio']), ['store_closing']);
    check('Store closing month to date on ' + date, closingNumber_(row['MTD purchasing customers']), closingNumber_(row['MTD opportunities']), closingNumber_(row['MTD closing ratio']), ['store_closing']);
  });
  var byPeriod = {};
  ctx.monthEnd.forEach(function (row) {
    if (String(row.track) !== 'Store') return;
    var key = isoDate_(row.period_start);
    byPeriod[key] = byPeriod[key] || {};
    byPeriod[key][String(row.metric)] = row;
  });
  Object.keys(byPeriod).forEach(function (start) {
    var rows = byPeriod[start];
    if (!rows['Closing ratio'] || !rows['Purchasing customers'] || !rows['PERQ opportunities']) return;
    var customers = fineNumber_(rows['Purchasing customers'].verified_mtd);
    var opportunities = fineNumber_(rows['PERQ opportunities'].verified_mtd);
    var ratio = fineNumber_(rows['Closing ratio'].verified_mtd);
    if (customers === null || !opportunities || ratio === null) return;
    checked += 1;
    var expected = Math.round((customers / opportunities) * 1000) / 1000;
    if (near_(ratio, expected, 0.0006)) return;
    problems += 1;
    add('closing-math', 'FLAG', 'CC_MonthEnd store closing ' + start, 'CC_MonthEnd store closing for the month from ' + start + ' is ' + percentText_(ratio) + ' but ' + customers + ' ÷ ' + opportunities + ' is ' + percentText_(expected) + '.', ['store_closing']);
  });
  if (!problems) add('closing-math', 'PASS', 'Store closing ratio', checked + ' closing ratios equal purchasing customers ÷ PERQ opportunities for the same dates' + (ctx.closingMtd['Closing ratio'] !== undefined ? ' (month to date ' + closingNumber_(ctx.closingMtd['Purchasing customers']) + ' ÷ ' + closingNumber_(ctx.closingMtd.Opportunities) + ')' : '') + '.');
}

function checkStoreTotals_(ctx, add) {
  var problems = 0;
  var rollupStore = storePeriodContaining_(ctx.today);
  var sums = {};
  [['nwdsrWritten', 'nwdsr_written', 'store_written', 'NWDSR Written'], ['nwdsrDelivered', 'nwdsr_delivered', 'store_delivered', 'NWDSR Delivered'], ['snapWritten', 'snap_written', 'store_snap_written', 'SNAP Written']].forEach(function (spec) {
    var total = sumField_(ctx.facts, spec[0], rollupStore.start, rollupStore.end);
    sums[spec[0]] = total;
    var shown = fineNumber_(ctx.rollup[spec[1]]);
    if (total === null && shown === null) return;
    if (near_(total, shown, 0.005)) return;
    problems += 1;
    add('store-reconcile', 'FLAG', 'CC_Rollup ' + spec[1], 'CC_Rollup shows ' + moneyPlain_(shown) + ' for ' + spec[3] + ' but the daily reports for ' + rollupStore.start + ' to ' + rollupStore.end + ' add to ' + moneyPlain_(total) + '.', [spec[2]]);
  });
  ctx.monthEnd.forEach(function (row) {
    if (String(row.track) !== 'Store') return;
    var spec = { 'NWDSR Written': 'nwdsrWritten', 'NWDSR Delivered': 'nwdsrDelivered', 'SNAP Written': 'snapWritten' }[String(row.metric)];
    var metric = { 'NWDSR Written': 'store_written', 'NWDSR Delivered': 'store_delivered', 'SNAP Written': 'store_snap_written' }[String(row.metric)];
    var through = isoDate_(row.verified_through);
    var shown = fineNumber_(row.verified_mtd);
    if (!spec || !through || shown === null) return;
    var start = isoDate_(row.period_start);
    var total = sumField_(ctx.facts, spec, start, through);
    if (near_(total, shown, 0.005)) return;
    problems += 1;
    add('store-reconcile', 'FLAG', 'CC_MonthEnd ' + row.metric + ' ' + start, 'CC_MonthEnd shows ' + moneyPlain_(shown) + ' for ' + row.metric + ' through ' + through + ' but the daily reports from ' + start + ' add to ' + moneyPlain_(total) + '. The month-end figure was not changed.', start === ctx.store.start ? [metric] : []);
  });
  ctx.monthEnd.forEach(function (row) {
    if (!/explanation pending/i.test(String(row.status || ''))) return;
    problems += 1;
    add('store-reconcile', 'FLAG', 'Official final ' + row.track + ' ' + row.metric + ' ' + (row.side || '') + ' ' + (row.person || '') + ' ' + isoDate_(row.period_start), 'The official month-end final for ' + row.metric + (row.person ? ' (' + row.person + ')' : '') + ', ' + isoDate_(row.period_start) + ' to ' + isoDate_(row.period_end) + ', is ' + String(row.official_final) + ' and differs from the verified month to date ' + String(row.verified_mtd) + ' by ' + String(row.variance) + '. Both are kept; record the explanation on CC_MonthEndNotes.', []);
  });
  if (sums.snapWritten !== null && sums.nwdsrWritten !== null && sums.snapWritten !== sums.nwdsrWritten) {
    add('store-reconcile', 'NOTE', 'SNAP Written vs NWDSR Net Written', 'Store month to date SNAP Written ' + moneyPlain_(sums.snapWritten) + ' and NWDSR Net Written ' + moneyPlain_(sums.nwdsrWritten) + ' differ by ' + moneyPlain_(Math.round((sums.snapWritten - sums.nwdsrWritten) * 100) / 100) + '. This is a legitimate difference between the two reports; both are kept and NWDSR is the store standard.');
  }
  var g17 = ctx.monthEnd.filter(function (row) { return String(row.track) === 'Store' && String(row.metric) === 'Data Analysis Group 17 sales' && String(row.side) === 'written' && isoDate_(row.period_start) === ctx.store.start; })[0];
  var nwdsr = ctx.monthEnd.filter(function (row) { return String(row.track) === 'Store' && String(row.metric) === 'NWDSR Written' && isoDate_(row.period_start) === ctx.store.start; })[0];
  if (g17 && nwdsr && fineNumber_(g17.verified_mtd) !== null && fineNumber_(nwdsr.verified_mtd) !== null && fineNumber_(g17.verified_mtd) !== fineNumber_(nwdsr.verified_mtd)) {
    add('store-reconcile', 'NOTE', 'Group 17 vs NWDSR written', 'Group 17 written ' + moneyPlain_(fineNumber_(g17.verified_mtd)) + ' (KPI denominator) and NWDSR Net Written ' + moneyPlain_(fineNumber_(nwdsr.verified_mtd)) + ' differ by ' + moneyPlain_(Math.round((fineNumber_(g17.verified_mtd) - fineNumber_(nwdsr.verified_mtd)) * 100) / 100) + '. Data Analysis rounds to cents and NWDSR to dollars; both are kept.');
  }
  if (!problems) add('store-reconcile', 'PASS', 'Store month totals', 'CC_Rollup and CC_MonthEnd equal the matching-scope daily reports: NWDSR Written ' + moneyPlain_(sums.nwdsrWritten) + ', NWDSR Delivered ' + moneyPlain_(sums.nwdsrDelivered) + ', SNAP Written ' + moneyPlain_(sums.snapWritten) + ' for ' + rollupStore.start + ' to ' + rollupStore.end + '.');
}

function qualityBaseline_() {
  if (typeof PropertiesService === 'undefined') return {};
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('quality_history_baseline') || '{}'); } catch (error) { return {}; }
}

function checkHistoryRetained_(ctx, add) {
  var problems = 0;
  var ledgerIndex = {};
  ctx.ledger.forEach(function (row) {
    if (row.grain !== 'daily') return;
    ledgerIndex[[row.view, row.reportDate || row.periodStart, row.side, row.code || row.name || 'STORE'].join('|')] = row;
  });
  var customers = {};
  ctx.closing.forEach(function (row) {
    var start = isoDate_(row.period_start);
    if (String(row.scope) === 'store' && String(row.source || '').trim() === 'NWDSR Net Written # OF CUST' && start === isoDate_(row.period_end)) customers[start] = fineNumber_(row.customers);
  });
  var daily = {};
  ctx.facts.forEach(function (row) { daily[row.date] = row; });
  var dailyField = { NWDSR_WRITTEN_STORE: 'nwdsrWritten', NWDSR_DELIVERED_STORE: 'nwdsrDelivered', SNAP_STORE: 'snapWritten' };
  ctx.register.forEach(function (row) {
    var date = isoDate_(row.business_date);
    var view = String(row.view || '');
    var entity = String(row.employee_id || '') || String(row.employee_name || '') || 'STORE';
    if (String(row.source_tab) === 'CC_Closing') {
      var count = customers[date];
      if (count === undefined || count !== fineNumber_(row.customers)) {
        problems += 1;
        add('history-retained', 'FLAG', row.record_key, 'The verified purchasing customers for ' + date + ' (' + row.customers + ') are ' + (count === undefined ? 'no longer on CC_Closing' : 'now ' + count + ' on CC_Closing') + '. A recorded day must not change or disappear.', ['store_purchasing_customers']);
      }
      return;
    }
    var source = ledgerIndex[[view, date, String(row.side || ''), entity].join('|')] || ledgerIndex[[view, date, String(row.side || ''), String(row.employee_name || '') || 'STORE'].join('|')];
    var figures = ['sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent'];
    var sourceFigures = source ? [source.sales, source.units, source.eligible, source.attachments, source.percent] : null;
    var changed = !source || figures.some(function (field, i) { return fineNumber_(row[field]) !== sourceFigures[i]; });
    if (changed) {
      problems += 1;
      add('history-retained', 'FLAG', row.record_key, 'The verified ' + view + ' record for ' + date + (entity !== 'STORE' ? ' (' + (row.employee_name || entity) + ')' : '') + ' is ' + (source ? 'different on CC_Ledger now' : 'no longer on CC_Ledger') + '. The permanent register still holds the verified figures.', []);
    }
    var field = dailyField[view];
    if (field && daily[date] && fineNumber_(row.sales_dollars) !== daily[date][field]) {
      problems += 1;
      add('history-retained', 'FLAG', 'CC_Daily ' + view + ' ' + date, 'CC_Daily shows ' + moneyPlain_(daily[date][field]) + ' for ' + view + ' on ' + date + ' but the verified record is ' + moneyPlain_(fineNumber_(row.sales_dollars)) + '.', []);
    }
    if (field && !daily[date]) {
      problems += 1;
      add('history-retained', 'FLAG', 'CC_Daily ' + date, 'The verified ' + view + ' day ' + date + ' is no longer on CC_Daily.', []);
    }
  });
  var counts = {
    CC_DailyHistory: ctx.register.length,
    CC_MonthlyHistory: ctx.monthly.length,
    CC_GoalHistory: ctx.goals.length,
    CC_SourceArchive: ctx.archive.length,
    CC_History: ctx.replaced.length,
    CC_Imports: ctx.imports.length,
  };
  var baseline = qualityBaseline_();
  Object.keys(counts).forEach(function (name) {
    if (baseline[name] === undefined || counts[name] >= baseline[name]) return;
    problems += 1;
    add('history-retained', 'FLAG', name + ' row count', name + ' had ' + baseline[name] + ' rows at an earlier check and now has ' + counts[name] + '. History tabs only grow; restore the missing rows from the latest backup.', []);
  });
  ctx.historyCounts = counts;
  if (!problems) add('history-retained', 'PASS', 'Permanent history', ctx.register.length + ' verified daily records still match their source rows; no history tab has lost rows (' + Object.keys(counts).map(function (name) { return name + ' ' + counts[name]; }).join(', ') + ').');
}

function checkReportPackages_(ctx, packages, add) {
  var problems = 0;
  packages.forEach(function (day) {
    day.items.forEach(function (item) {
      if (item.status !== 'Needs Review' && item.status !== 'Failed') return;
      problems += 1;
      add('report-package', 'FLAG', item.label + ' ' + day.date, item.label + ' for ' + day.date + ': ' + item.detail, REPORT_METRICS_[item.key]);
    });
  });
  var complete = packages.filter(function (day) { return day.status === 'COMPLETE'; }).length;
  var missing = [];
  packages.forEach(function (day) {
    day.items.forEach(function (item) { if (item.status === 'Missing') missing.push(item.label + ' ' + day.date); });
  });
  if (missing.length) add('report-package', 'NOTE', 'Missing reports', missing.length + ' required report(s) have not arrived: ' + missing.slice(0, 12).join(', ') + (missing.length > 12 ? ', …' : '') + '. Each is an active alert until it arrives and passes validation.');
  if (!problems) add('report-package', 'PASS', 'Reports on file', complete + ' of ' + packages.length + ' business days from ' + ctx.windowStart + ' have every required report on file and verified; no report on file needs review.');
}

/* ---------- data status ---------- */

function lastDueDay_(ctx, period) {
  var cursor = ctx.yesterday < period.end ? ctx.yesterday : period.end;
  while (cursor >= period.start) {
    if (!ctx.closed[cursor] && reportDue_(ctx, cursor)) return cursor;
    cursor = shiftDate_(cursor, -1);
  }
  return '';
}

function throughDate_(text) {
  var dates = String(text || '').match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (!dates.length) return '';
  if (/Pending/.test(String(text)) && dates.length < 2) return { partial: dates[0] };
  return dates.sort()[0];
}

function metricStatuses_(ctx, packages, checks) {
  var flagged = {};
  checks.forEach(function (check) {
    if (check.status !== 'FLAG') return;
    check.metrics.forEach(function (key) { (flagged[key] = flagged[key] || []).push(check.subject); });
  });
  var missingAfter = function (keys, after, period) {
    var labels = {};
    packages.forEach(function (day) {
      if (day.date <= after || day.date < period.start || day.date > period.end) return;
      day.items.forEach(function (item) {
        if (item.status !== 'Missing' || !REPORT_METRICS_[item.key] || REPORT_METRICS_[item.key].filter(function (key) { return keys.indexOf(key) !== -1; }).length === 0) return;
        labels[item.label + ' ' + day.date] = true;
      });
    });
    return Object.keys(labels);
  };
  return metricRegistry_(ctx.today).map(function (row) {
    var definition = metricDefinition_(row.key);
    var period = definition.period === 'store' ? ctx.store : ctx.person;
    var expected = lastDueDay_(ctx, period);
    var raw = row.verifiedThrough === 'Pending' ? '' : row.verifiedThrough;
    var through = throughDate_(raw);
    var status;
    var explanation;
    if (flagged[row.key]) {
      status = 'NEEDS REVIEW';
      explanation = 'Flagged: ' + flagged[row.key].slice(0, 3).join('; ') + '. See the quality checks.';
    } else if (!expected) {
      status = 'CURRENT';
      explanation = 'No report for this period is due yet.';
    } else if (!through) {
      status = 'MISSING';
      explanation = 'No verified ' + row.source + ' for ' + row.periodDates + ' yet. Shown as Pending, never as zero.';
    } else if (typeof through === 'object') {
      status = 'PARTIAL';
      explanation = row.verifiedThrough + '. One side has no verified report yet.';
    } else if (through >= expected) {
      status = period.end < ctx.today ? 'COMPLETE' : 'CURRENT';
      explanation = status === 'COMPLETE' ? 'Every required report for ' + row.periodDates + ' is on file and verified.' : 'Up to date through ' + through + ', the latest business day due. The period is still open, so it is not complete.';
    } else {
      var gaps = missingAfter([row.key], through, period);
      status = 'PARTIAL';
      explanation = 'Verified through ' + through + '; expected through ' + expected + '.' + (gaps.length ? ' Not yet arrived: ' + gaps.slice(0, 6).join(', ') + (gaps.length > 6 ? ', …' : '') + '.' : ' A later report has not been verified yet.');
    }
    return { kind: 'Metric', key: row.key, name: row.name, source: row.source, periodDates: row.periodDates, through: raw || 'Pending', expected: expected, status: status, explanation: explanation };
  });
}

function periodStatus_(ctx, packages, label, key, period) {
  var days = packages.filter(function (day) { return day.date >= period.start && day.date <= period.end && reportDue_(ctx, day.date); });
  var status;
  var explanation;
  if (!days.length) {
    status = 'CURRENT';
    explanation = 'No report for this period is due yet.';
  } else if (days.some(function (day) { return day.status === 'NEEDS REVIEW'; })) {
    status = 'NEEDS REVIEW';
    explanation = days.filter(function (day) { return day.status === 'NEEDS REVIEW'; }).map(function (day) { return day.date; }).join(', ') + ' have a report that needs review.';
  } else if (days.every(function (day) { return day.status === 'COMPLETE'; })) {
    status = period.end < ctx.today ? 'COMPLETE' : 'CURRENT';
    explanation = 'Every required report for ' + days.length + ' business day(s) through ' + days[days.length - 1].date + ' is on file and verified.' + (status === 'CURRENT' ? ' The period is still open.' : '');
  } else if (days.every(function (day) { return day.onFile === 0; })) {
    status = 'MISSING';
    explanation = 'No required report for ' + period.start + ' to ' + period.end + ' has arrived.';
  } else {
    var short = days.filter(function (day) { return day.status !== 'COMPLETE'; });
    status = 'PARTIAL';
    explanation = short.length + ' of ' + days.length + ' business day(s) are missing reports: ' + short.slice(-5).map(function (day) { return day.date + ' (' + day.onFile + ' of ' + day.total + ')'; }).join(', ') + '.';
  }
  var latest = '';
  days.forEach(function (day) { if (day.status === 'COMPLETE') latest = day.date; });
  return { kind: 'Period', key: key, name: label, source: 'All required daily reports', periodDates: period.start + ' through ' + period.end, through: latest || 'Pending', expected: days.length ? days[days.length - 1].date : '', status: status, explanation: explanation };
}

function closedPeriodStatus_(ctx, label, key, track, period) {
  var periodKey = periodKey_(track, period);
  var rows = ctx.monthly.filter(function (row) { return String(row.period_key) === periodKey; });
  var status;
  var explanation;
  if (!rows.length) {
    status = 'MISSING';
    explanation = 'No month-end record for ' + periodKey + ' is on CC_MonthlyHistory.';
  } else if (ctx.monthEnd.some(function (row) { return String(row.period_key) === periodKey && /explanation pending/i.test(String(row.status || '')); })) {
    status = 'NEEDS REVIEW';
    explanation = 'An official final differs from the verified month to date and the explanation is pending (CC_MonthEnd).';
  } else if (rows.every(function (row) { return String(row.history_status) === 'Final'; })) {
    status = 'COMPLETE';
    explanation = rows.length + ' month-end figures are Final on CC_MonthlyHistory.';
  } else {
    status = 'PARTIAL';
    explanation = rows.filter(function (row) { return String(row.history_status) !== 'Final'; }).length + ' of ' + rows.length + ' month-end figures are not Final yet.';
  }
  return { kind: 'Period', key: key, name: label, source: 'Month-end record', periodDates: period.start + ' through ' + period.end, through: '', expected: '', status: status, explanation: explanation };
}

/* ---------- alerts ---------- */

function alertRows_() {
  var values = sheetValues_(ALERTS_TAB_);
  if (!values || values.length < 2) return [];
  var header = values[0].map(function (cell) { return String(cell || '').trim(); });
  return values.slice(1).filter(function (row) { return String(row[0] || ''); }).map(function (row) {
    var record = {};
    ALERT_HEADERS_.forEach(function (key) {
      var i = header.indexOf(key);
      var cell = i === -1 ? '' : row[i];
      record[key] = Object.prototype.toString.call(cell) === '[object Date]' ? cell.toISOString() : String(cell === null || cell === undefined ? '' : cell);
    });
    return record;
  });
}

function writeAlerts_(rows) {
  rewriteTab_(ALERTS_TAB_, ALERT_HEADERS_, rows.map(function (row) { return ALERT_HEADERS_.map(function (key) { return row[key] || ''; }); }));
}

/** The missing-report warnings logged before alerts existed become alert rows, so their resolution is recorded. */
function legacyMissingAlerts_() {
  var labels = {};
  UPLOAD_REPORTS_.forEach(function (report) { labels[report.label] = report.key; });
  var rows = [];
  var seen = {};
  sheet_('CC_Exceptions').forEach(function (row) {
    if (String(row.severity) !== 'Report Missing') return;
    var message = String(row.message || '');
    var date = (message.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
    if (!date) return;
    var listed = /is missing (.+?)\./.exec(message);
    var names = listed ? listed[1].split(/,\s*/) : ['SNAP Written', 'NWDSR Written', 'NWDSR Delivered'];
    var at = row.at instanceof Date ? row.at.toISOString() : String(row.at || '');
    names.forEach(function (name) {
      var key = labels[name.trim()];
      if (!key || seen[date + key]) return;
      seen[date + key] = true;
      rows.push({ alert_key: 'report|' + date + '|' + key, category: 'Report', severity: 'Missing', business_date: date, report: name.trim(), message: message, status: 'Active', first_seen: at, last_seen: at, resolved_at: '', resolution: '', emailed_at: 'before alert tracking' });
    });
  });
  return rows;
}

function currentAlerts_(ctx, packages, checks) {
  var alerts = [];
  packages.forEach(function (day) {
    day.items.forEach(function (item) {
      if (item.status !== 'Missing' && item.status !== 'Needs Review' && item.status !== 'Failed') return;
      var missing = item.status === 'Missing';
      alerts.push({
        alert_key: 'report|' + day.date + '|' + item.key,
        category: 'Report',
        severity: missing ? 'Missing' : 'Needs Review',
        business_date: day.date,
        report: item.label,
        message: missing ? item.label + ' for ' + day.date + ' has not arrived. Figures that depend on it stay at the last verified date; nothing is counted as zero.' : item.label + ' for ' + day.date + ' needs review: ' + item.detail,
      });
    });
  });
  checks.forEach(function (check) {
    if (check.status !== 'FLAG' || check.id === 'report-package') return;
    alerts.push({ alert_key: 'quality|' + check.id + '|' + check.subject, category: 'Quality', severity: 'Needs Review', business_date: '', report: check.area, message: check.explanation });
  });
  return alerts;
}

function resolutionFor_(ctx, alert, checks) {
  if (alert.category === 'Report') {
    var parts = alert.alert_key.split('|');
    var date = parts[1];
    var item = packageItem_(ctx, date, parts[2]);
    if (item.status === 'Imported' || item.status === 'Covered') return { status: 'Resolved', text: item.label + ' for ' + date + ' arrived and passed validation' + (item.detail ? ' (' + item.detail.replace(/\.$/, '') + ')' : '') + '.' };
    if (item.status === 'Awaiting') return { status: 'Withdrawn', text: 'Raised before the report was due. ' + item.label + ' for ' + date + ' is due by ' + ctx.dueHour + ':00 on ' + shiftDate_(date, 1) + ' and is raised again then if it has not arrived.' };
    if (ctx.closed[date]) return { status: 'Resolved', text: date + ' is a closed day on CC_SellingDays, so no report is required.' };
    if (date < ctx.windowStart) return { status: 'Closed', text: 'The reporting month ended without this report. The gap stays visible on Month-End.' };
    return { status: 'Resolved', text: 'No longer required for ' + date + '.' };
  }
  var id = alert.alert_key.split('|')[1];
  var pass = checks.filter(function (check) { return check.id === id && check.status === 'PASS'; })[0];
  return { status: 'Resolved', text: 'The check passed on ' + ctx.today + (pass ? ': ' + pass.explanation : '.') };
}

/** Opens new alerts, refreshes open ones, and resolves those whose report arrived or whose check now passes. */
function syncAlerts_(ctx, packages, checks, now) {
  var existing = alertRows_();
  if (!alertsTracked_()) {
    var known = {};
    existing.forEach(function (row) { known[row.alert_key] = true; });
    legacyMissingAlerts_().forEach(function (row) { if (!known[row.alert_key]) existing.push(row); });
  }
  var current = currentAlerts_(ctx, packages, checks);
  var wanted = {};
  current.forEach(function (alert) { wanted[alert.alert_key] = alert; });
  var open = {};
  var resolved = 0;
  existing.forEach(function (row) {
    if (row.status !== 'Active') return;
    var next = wanted[row.alert_key];
    if (next) {
      row.severity = next.severity;
      row.message = next.message;
      row.last_seen = now;
      open[row.alert_key] = true;
      return;
    }
    var outcome = resolutionFor_(ctx, row, checks);
    row.status = outcome.status;
    row.resolved_at = now;
    row.resolution = outcome.text;
    resolved += 1;
  });
  current.forEach(function (alert) {
    if (open[alert.alert_key]) return;
    existing.push({ alert_key: alert.alert_key, category: alert.category, severity: alert.severity, business_date: alert.business_date, report: alert.report, message: alert.message, status: 'Active', first_seen: now, last_seen: now, resolved_at: '', resolution: '', emailed_at: '' });
  });
  writeAlerts_(existing);
  return { rows: existing, active: existing.filter(function (row) { return row.status === 'Active'; }).length, resolved: resolved };
}

/**
 * A one-off notice (a file that could not be read, an import that stopped). It goes into the next consolidated email.
 * The same message is queued once, as notifyOnce_ emailed it once before.
 */
function queueNotice_(message) {
  var text = String(message);
  var key = 'notice|' + text.slice(0, 90);
  var props = typeof PropertiesService === 'undefined' ? null : PropertiesService.getScriptProperties();
  if (props && props.getProperty('mail_' + text.slice(0, 90))) return;
  var rows = sheetValues_(ALERTS_TAB_) ? alertRows_() : [];
  if (rows.some(function (row) { return row.alert_key === key; })) return;
  var tab = qualityTab_(ALERTS_TAB_, ALERT_HEADERS_);
  var now = new Date().toISOString();
  tab.appendRow([key, 'Notice', 'Notice', '', '', text, 'Logged', now, now, '', '', '']);
  if (props) props.setProperty('mail_' + text.slice(0, 90), now);
}

/**
 * At most one consolidated email a day to admin_email, sent when a problem has appeared that was not emailed yet. It
 * lists every outstanding problem and what was resolved since the last email. A problem that appears after the day's
 * email waits for the next day's; it is on System health and Home straight away.
 */
function sendAlertDigest_(rows) {
  if (typeof UPLOAD_QUIET_ !== 'undefined' && UPLOAD_QUIET_) return { sent: false, reason: 'manual upload' };
  var active = rows.filter(function (row) { return row.status === 'Active'; });
  var notices = rows.filter(function (row) { return row.category === 'Notice' && !row.emailed_at; });
  var fresh = active.filter(function (row) { return !row.emailed_at; });
  if (!fresh.length && !notices.length) return { sent: false, reason: 'nothing new' };
  var email = String(config_().admin_email || '');
  if (!email) return { sent: false, reason: 'no admin_email' };
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('alert_digest_day') === todayNy_()) return { sent: false, reason: 'already emailed today' };
  var since = props.getProperty('alert_digest_at') || '';
  var body = alertDigestText_(active, notices, rows.filter(function (row) { return row.status === 'Resolved' && row.resolved_at > since; }));
  MailApp.sendEmail(email, 'Command Center: ' + active.length + ' outstanding report problem' + (active.length === 1 ? '' : 's'), body);
  var now = new Date().toISOString();
  active.concat(notices).forEach(function (row) { if (!row.emailed_at) row.emailed_at = now; });
  writeAlerts_(rows);
  props.setProperty('alert_digest_at', now);
  props.setProperty('alert_digest_day', todayNy_());
  return { sent: true, active: active.length, notices: notices.length };
}

function alertDigestText_(active, notices, resolved) {
  var lines = ['Store 17 Command Center found ' + active.length + ' outstanding report problem' + (active.length === 1 ? '' : 's') + '. Figures already verified were left in place; nothing missing is counted as zero.', ''];
  var missing = {};
  active.filter(function (row) { return row.category === 'Report' && row.severity === 'Missing'; }).forEach(function (row) {
    (missing[row.business_date] = missing[row.business_date] || []).push(row.report);
  });
  if (Object.keys(missing).length) {
    lines.push('Missing reports');
    Object.keys(missing).sort().forEach(function (date) { lines.push('- ' + date + ': ' + missing[date].join(', ')); });
    lines.push('');
  }
  var review = active.filter(function (row) { return row.severity === 'Needs Review'; });
  if (review.length) {
    lines.push('Needs review');
    review.forEach(function (row) { lines.push('- ' + row.message); });
    lines.push('');
  }
  if (notices.length) {
    lines.push('Other notices');
    notices.forEach(function (row) { lines.push('- ' + row.message); });
    lines.push('');
  }
  if (resolved.length) {
    lines.push('Resolved since the last email (' + resolved.length + ')');
    resolved.slice(0, 15).forEach(function (row) { lines.push('- ' + row.resolution); });
    lines.push('');
  }
  lines.push('Open System health in the Command Center for details. Another email is sent only when a new problem appears.');
  return lines.join('\n');
}

/* ---------- run ---------- */

/**
 * Runs every check, updates data status and alerts, and logs the run. Called after imports and recalculations, inside
 * the script lock the caller holds. Returns a short summary.
 */
function runQualityChecks_(trigger) {
  var started = Date.now();
  var now = new Date().toISOString();
  var today = todayNy_();
  var ctx;
  var packages;
  var checks;
  var statuses;
  beginPageRead_();
  try {
    ctx = qualityContext_(today);
    packages = dayPackages_(ctx);
    checks = qualityChecks_(ctx, packages);
    var periods = [
      periodStatus_(ctx, packages, 'Store month to date', 'store-month', ctx.store),
      periodStatus_(ctx, packages, 'Salesperson month to date', 'person-month', ctx.person),
    ];
    var priorStore = storePeriodContaining_(shiftDate_(ctx.store.start, -1));
    var priorPerson = individualPeriodContaining_(shiftDate_(ctx.person.start, -1));
    periods.push(closedPeriodStatus_(ctx, 'Previous store month', 'store-month-prior', 'Store', priorStore));
    periods.push(closedPeriodStatus_(ctx, 'Previous salesperson month', 'person-month-prior', 'Person', priorPerson));
    var days = packages.slice().reverse().filter(function (day) { return reportDue_(ctx, day.date); }).map(function (day) {
      return { kind: 'Day', key: day.date, name: 'Business day ' + day.date, source: day.total + ' required reports', periodDates: day.date, through: day.onFile + ' of ' + day.total, expected: '', status: day.status, explanation: day.text };
    });
    statuses = periods.concat(metricStatuses_(ctx, packages, checks), days);
  } finally {
    endPageRead_();
  }
  rewriteTab_(QUALITY_TAB_, QUALITY_HEADERS_, checks.map(function (check) { return [check.id, check.area, check.status, check.subject, check.explanation, check.metrics.join(', '), now]; }));
  rewriteTab_(DATA_STATUS_TAB_, DATA_STATUS_HEADERS_, statuses.map(function (row) { return [row.kind, row.key, row.name, row.source, row.periodDates, row.through, row.expected, row.status, row.explanation, now]; }));
  var alerts = syncAlerts_(ctx, packages, checks, now);
  var baseline = qualityBaseline_();
  Object.keys(ctx.historyCounts || {}).forEach(function (name) { baseline[name] = Math.max(baseline[name] || 0, ctx.historyCounts[name]); });
  if (typeof PropertiesService !== 'undefined') PropertiesService.getScriptProperties().setProperty('quality_history_baseline', JSON.stringify(baseline));
  var summary = {
    trigger: trigger,
    checks: checks.length,
    passed: checks.filter(function (check) { return check.status === 'PASS'; }).length,
    flagged: checks.filter(function (check) { return check.status === 'FLAG'; }).length,
    noted: checks.filter(function (check) { return check.status === 'NOTE'; }).length,
    active: alerts.active,
    resolved: alerts.resolved,
    storeMonth: statuses[0].status,
    personMonth: statuses[1].status,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  qualityTab_(QUALITY_RUNS_TAB_, QUALITY_RUN_HEADERS_).appendRow([now, trigger, summary.checks, summary.passed, summary.flagged, summary.noted, summary.active, summary.resolved, summary.storeMonth, summary.personMonth, summary.seconds]);
  noteHealth_('quality_checked_at', now);
  noteHealth_('data_status', 'Store month ' + summary.storeMonth + ' · Salesperson month ' + summary.personMonth);
  noteHealth_('status', alertStatus_(alerts.rows));
  summary.alertRows = alerts.rows;
  return summary;
}

/** Report Missing while a required report is outstanding, Needs Review while a check is flagged, otherwise Current. */
function alertStatus_(rows) {
  var active = rows.filter(function (row) { return row.status === 'Active'; });
  if (active.some(function (row) { return row.severity === 'Missing'; })) return 'Report Missing';
  if (active.some(function (row) { return row.severity === 'Needs Review'; })) return 'Needs Review';
  return 'Current';
}

/**
 * The checks after an import, upload batch or recalculation. A failure here is logged and never undoes the update.
 * The consolidated email goes out only from the scheduled import, as before.
 */
function qualityAfterUpdate_(trigger, email) {
  try {
    var summary = runQualityChecks_(trigger);
    if (email) {
      try { summary.email = sendAlertDigest_(summary.alertRows); } catch (error) { appendException_('Update Failed', 'The consolidated alert email could not be sent. ' + String(error && error.message ? error.message : error)); }
    }
    return summary;
  } catch (error) {
    appendException_('Update Failed', 'The quality checks could not run after the ' + trigger + '. No figure was changed. ' + String(error && error.message ? error.message : error));
    return null;
  }
}

/** True once the checks have run, so alerts replace the older missing-report warnings. */
function alertsTracked_() {
  return !!sheetValues_(QUALITY_RUNS_TAB_);
}

/** Home "Needs attention": outstanding reports by day, newest first, then flagged checks. */
function alertAttention_(rows, role) {
  var missing = {};
  var items = [];
  rows.forEach(function (row) {
    if (row.category === 'Report' && row.severity === 'Missing') (missing[row.business_date] = missing[row.business_date] || []).push(row.report);
  });
  Object.keys(missing).sort().reverse().forEach(function (date) {
    items.push('Not yet arrived for ' + date + ': ' + missing[date].join(', ') + '. Figures that depend on them stay at the last verified date; nothing is counted as zero.');
  });
  rows.forEach(function (row) {
    if (row.severity !== 'Needs Review') return;
    if (role === 'sales' && row.category === 'Quality') return;
    items.push(row.message);
  });
  return items;
}

/** Admin "Run checks now": the checks alone, without importing mail. No email is sent from here. */
function runChecks_(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('An import is running. Try again in a minute.');
  var summary;
  try {
    summary = runQualityChecks_('manual check by ' + payload.session.role);
  } finally {
    lock.releaseLock();
  }
  delete summary.alertRows;
  return { summary: summary, health: health_(payload) };
}

/* ---------- read side for System health and Home ---------- */

function activeAlerts_() {
  return sheetValues_(ALERTS_TAB_) ? alertRows_().filter(function (row) { return row.status === 'Active'; }) : [];
}

function qualityHealth_() {
  var alerts = sheetValues_(ALERTS_TAB_) ? alertRows_() : [];
  var resolved = alerts.filter(function (row) { return row.status === 'Resolved' || row.status === 'Closed' || row.status === 'Withdrawn'; }).sort(function (a, b) { return a.resolved_at < b.resolved_at ? 1 : -1; });
  var runs = sheet_(QUALITY_RUNS_TAB_);
  var last = runs.length ? runs[runs.length - 1] : null;
  var text = function (value) { return value instanceof Date ? value.toISOString() : String(value === null || value === undefined ? '' : value); };
  return {
    lastRun: last ? { at: text(last.run_at), trigger: text(last.trigger), checks: text(last.checks), passed: text(last.passed), flagged: text(last.flagged), noted: text(last.noted), seconds: text(last.seconds) } : null,
    checks: sheet_(QUALITY_TAB_).map(function (row) { return { id: text(row.check_id), area: text(row.area), status: text(row.status), subject: text(row.subject), explanation: text(row.explanation) }; }),
    status: sheet_(DATA_STATUS_TAB_).map(function (row) { return { kind: text(row.kind), key: text(row.key), name: text(row.name), source: text(row.approved_source), periodDates: text(row.period_dates), through: text(row.verified_through), expected: text(row.expected_through), status: text(row.status), explanation: text(row.explanation) }; }),
    active: alerts.filter(function (row) { return row.status === 'Active'; }).map(function (row) { return { category: row.category, severity: row.severity, date: row.business_date, report: row.report, message: row.message, since: row.first_seen, emailed: row.emailed_at }; }),
    resolved: resolved.slice(0, 15).map(function (row) { return { category: row.category, status: row.status, date: row.business_date, report: row.report, message: row.message, since: row.first_seen, resolvedAt: row.resolved_at, resolution: row.resolution }; }),
    resolvedCount: resolved.length,
    notices: alerts.filter(function (row) { return row.category === 'Notice'; }).slice(-8).reverse().map(function (row) { return { at: row.first_seen, message: row.message, emailed: row.emailed_at }; }),
  };
}
