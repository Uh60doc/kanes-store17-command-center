/**
 * Read-only integrity snapshot. It does not change a sales figure, a closing count, or a historical register.
 * integrityAudit_ is the on-demand inventory the coverage register is built from.
 */
function integrityAudit_() {
  var book = book_();
  var names = book.getSheets().map(function (sheet) {
    return { name: sheet.getName(), rows: Math.max(0, sheet.getLastRow() - 1) };
  });
  function historical(metric) {
    var rows = [];
    try { rows = historicalRows_(metric); } catch (error) { return { error: String(error && error.message ? error.message : error) }; }
    var dates = rows.map(function (row) { return row.date; }).sort();
    function one(date) {
      var found = null;
      rows.forEach(function (row) { if (row.date === date) found = row; });
      if (!found) return null;
      return { dollars: found.dollars, verification: found.verification, status: found.status, source: found.source, notes: found.notes };
    }
    return {
      count: rows.length,
      first: dates[0] || '',
      last: dates[dates.length - 1] || '',
      verifiedZero: rows.filter(function (row) { return row.verification === 'Verified zero'; }).map(function (row) { return row.date; }),
      unverified: rows.filter(function (row) { return row.verification !== 'Verified' && row.verification !== 'Verified zero'; }).length,
      oct1: one('2025-10-01'),
      oct17: one('2025-10-17'),
      oct31: one('2025-10-31'),
      nov1: one('2025-11-01'),
    };
  }
  var daily = [];
  try { daily = dailyFacts_(); } catch (error) { daily = []; }
  var dailyDates = daily.map(function (row) { return row.date; }).filter(Boolean).sort();
  function dailySpan(start, end) {
    var rows = daily.filter(function (row) { return row.date >= start && row.date <= end; });
    function filled(field) { return rows.filter(function (row) { return row[field] !== null && row[field] !== undefined && row[field] !== ''; }).length; }
    return { days: rows.length, nwdsrWritten: filled('nwdsrWritten'), nwdsrDelivered: filled('nwdsrDelivered'), snapWritten: filled('snapWritten') };
  }
  var lastYear = [];
  try { lastYear = sheet_('CC_LastYear'); } catch (error) { lastYear = []; }
  var closing = [];
  try { closing = sheet_('CC_Closing'); } catch (error) { closing = []; }
  var perq18 = closing.filter(function (row) {
    return isoDate_(row.period_start) === '2026-10-18' || isoDate_(row.verified_through) === '2026-10-18';
  }).map(function (row) {
    return {
      scope: row.scope,
      code: row.employee_code || row.code || '',
      name: row.employee_name || row.name || '',
      customers: row.purchasing_customers,
      opportunities: row.opportunities,
      source: row.source,
      start: isoDate_(row.period_start),
      end: isoDate_(row.period_end),
      through: isoDate_(row.verified_through),
      final: row.final,
      note: String(row.notes || '').slice(0, 180),
    };
  });
  var ledgerHits = [];
  try {
    sheet_('CC_Ledger').forEach(function (row) {
      if (String(row.view) === 'PERQ_STORE' && isoDate_(row.period_start) === '2026-10-18') {
        ledgerHits.push({ grain: row.grain, eligible: row.eligible, sold: row.sold, source: row.source_file || row.source, code: row.employee_code || '', name: row.employee_name || '' });
      }
    });
  } catch (error) { ledgerHits = [{ error: String(error.message || error) }]; }
  var triggers = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      triggers.push(trigger.getHandlerFunction() + ' ' + trigger.getEventType());
    });
  } catch (error) { triggers = [String(error.message || error)]; }
  var registry = [];
  try {
    registry = metricRegistry_('2026-10-20').map(function (row) {
      return { key: row.key, through: row.verifiedThrough, goal: row.goal, dates: row.periodDates };
    });
  } catch (error) { registry = [{ error: String(error.message || error) }]; }
  var customers18 = closing.filter(function (row) {
    return String(row.scope) === 'store' && String(row.source) === 'NWDSR Net Written # OF CUST' && isoDate_(row.period_start) === '2026-10-18';
  }).map(function (row) { return { customers: row.customers, opportunities: row.opportunities, final: row.final }; });
  var daily2026 = daily.filter(function (row) { return row.date >= '2026-10-01' && row.date <= '2026-11-02'; }).map(function (row) {
    return { date: row.date, snap: row.snapWritten, written: row.nwdsrWritten, delivered: row.nwdsrDelivered };
  });
  function historicalDay(metric, date) {
    var found = null;
    try { historicalRows_(metric).forEach(function (row) { if (row.date === date) found = { dollars: row.dollars, verification: row.verification, source: row.source }; }); } catch (error) { return { error: String(error.message || error) }; }
    return found;
  }
  var nov2 = {
    snap: historicalDay('SNAP Written', '2025-11-02'),
    written: historicalDay('NWDSR Written', '2025-11-02'),
    delivered: historicalDay('NWDSR Delivered', '2025-11-02'),
  };
  var statusCounts = {};
  try {
    sheet_('CC_DataStatus').forEach(function (row) {
      var key = String(row.kind || '') + ':' + String(row.status || '');
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    });
  } catch (error) { statusCounts.error = String(error.message || error); }
  function tabSpan(name) {
    var tab = book.getSheetByName(name);
    if (!tab) return { missing: true };
    var values = tab.getDataRange().getValues();
    var headers = (values[0] || []).map(function (cell) { return String(cell); });
    var dates = [];
    var c;
    for (c = 0; c < headers.length; c += 1) {
      if (!/date|period|through/i.test(headers[c])) continue;
      var r;
      for (r = 1; r < values.length; r += 1) {
        var iso = isoDate_(values[r][c]);
        if (iso) dates.push(iso);
      }
    }
    dates.sort();
    return { rows: Math.max(0, values.length - 1), headers: headers.slice(0, 8), first: dates[0] || '', last: dates[dates.length - 1] || '' };
  }
  var spans = {};
  ['SNAP_STORE', 'NWDSR_WRITTEN_STORE', 'NWDSR_DELIVERED_STORE', 'PERQ_STORE', 'PERQ_PERSON', 'BEDDING_STORE', 'DA_SALES_STORE', 'CC_Kpi', 'CC_Alerts'].forEach(function (name) {
    spans[name] = tabSpan(name);
  });
  var sums = {};
  try {
    var facts = dailyFacts_();
    sums.written = sumField_(facts, 'nwdsrWritten', '2026-10-02', '2026-11-01');
    sums.delivered = sumField_(facts, 'nwdsrDelivered', '2026-10-02', '2026-11-01');
    sums.snap = sumField_(facts, 'snapWritten', '2026-10-02', '2026-11-01');
    var lyDates = [];
    var cursor = '2025-10-01';
    while (cursor <= '2025-10-31') { lyDates.push(cursor); cursor = shiftDate_(cursor, 1); }
    var lySnap = reportLySeries_(facts, lyDates, 'snapWritten', 'SNAP Written');
    var lyWritten = reportLySeries_(facts, lyDates, 'nwdsrWritten', 'NWDSR Written');
    var lyDelivered = reportLySeries_(facts, lyDates, 'nwdsrDelivered', 'NWDSR Delivered');
    sums.lySnap = { pending: lySnap.pending, value: lySnap.value, onFile: lySnap.onFile, expected: lySnap.expected, missing: lySnap.missing || [] };
    sums.lyWritten = { pending: lyWritten.pending, value: lyWritten.value, onFile: lyWritten.onFile, expected: lyWritten.expected, missing: lyWritten.missing || [] };
    sums.lyDelivered = { pending: lyDelivered.pending, value: lyDelivered.value, onFile: lyDelivered.onFile, expected: lyDelivered.expected, missing: (lyDelivered.missing || []).slice(0, 8) };
  } catch (error) { sums.error = String(error.message || error); }
  var checks = { pass: 0, flag: 0, note: 0 };
  try {
    sheet_('CC_QualityChecks').forEach(function (row) {
      var status = String(row.status || '');
      if (status === 'PASS') checks.pass += 1;
      else if (status === 'FLAG') checks.flag += 1;
      else if (status === 'NOTE') checks.note += 1;
    });
  } catch (error) { checks.error = String(error.message || error); }
  return {
    sheets: names,
    historical: {
      snap: historical('SNAP Written'),
      written: historical('NWDSR Written'),
      delivered: historical('NWDSR Delivered'),
    },
    daily: { count: daily.length, first: dailyDates[0] || '', last: dailyDates[dailyDates.length - 1] || '', currentStoreMonth: dailySpan('2026-10-02', '2026-11-01'), priorStoreWindow: dailySpan('2025-10-01', '2025-11-01') },
    lastYearRows: lastYear.length,
    perqOctober18: perq18,
    perqLedgerOctober18: ledgerHits,
    triggers: triggers,
    registry: registry,
    quality: checks,
    customers18: customers18,
    daily2026: daily2026,
    nov2: nov2,
    statusCounts: statusCounts,
    spans: spans,
    sums: sums,
  };
}

/**
 * Copies a verified CC_Daily store total onto the permanent register when the same amount is already
 * on the matching source tab. A blank day is left blank. An existing register amount is left as it is.
 */
function fileVerifiedDaysOntoRegisters_() {
  var specs = [
    { metric: 'SNAP Written', view: 'SNAP_STORE', field: 'snapWritten' },
    { metric: 'NWDSR Written', view: 'NWDSR_WRITTEN_STORE', field: 'nwdsrWritten' },
    { metric: 'NWDSR Delivered', view: 'NWDSR_DELIVERED_STORE', field: 'nwdsrDelivered' },
  ];
  var ledger = ledgerRows_();
  var result = { added: [], already: 0, skipped: [] };
  dailyFacts_().forEach(function (day) {
    specs.forEach(function (spec) {
      var amount = day[spec.field];
      if (amount === null || amount === undefined || amount === '') return;
      if (historicalAmount_(spec.metric, day.date)) { result.already += 1; return; }
      var source = null;
      ledger.forEach(function (row) {
        if (source || row.view !== spec.view || row.grain !== 'daily') return;
        if (row.code || row.name) return;
        if (row.periodStart !== day.date || row.periodEnd !== day.date) return;
        if (row.sales === null || Number(row.sales) !== Number(amount)) return;
        source = row;
      });
      if (!source) {
        result.skipped.push(spec.metric + ' ' + day.date);
        return;
      }
      var filed = recordHistoricalDay_({
        metric: spec.metric,
        date: day.date,
        dollars: amount,
        source: source.source || spec.view,
        verification: 'Verified',
        note: 'Filed from the verified ' + spec.view + ' daily row. The CC_Daily amount matched. Current-year sales were not changed.',
      });
      if (filed.status === 'added' || filed.status === 'filled') result.added.push(spec.metric + ' ' + day.date + ' ' + amount);
      else result.skipped.push(spec.metric + ' ' + day.date + ' ' + filed.status);
    });
  });
  return result;
}

var COVERAGE_TAB_ = 'CC_MetricCoverage';
var COVERAGE_HEADERS_ = ['Metric', 'Source Tab', 'Current-Year Coverage', 'Last-Year Coverage', 'Verified Through', 'Status', 'Issue'];

function metricCoverageRows_() {
  var today = todayNy_();
  var registry = metricRegistry_(today);
  var byKey = {};
  registry.forEach(function (row) { byKey[row.key] = row; });
  var facts = dailyFacts_();
  var store = storePeriodContaining_(today);
  var currentEnd = shiftDate_(today, -1);
  if (currentEnd > store.end) currentEnd = store.end;
  if (currentEnd < store.start) currentEnd = store.start;
  var closed = closedDates_();
  var currentDates = [];
  eachDate_(store.start, currentEnd).forEach(function (date) { if (!closed[date]) currentDates.push(date); });
  var ly = { confirmed: false, start: '', end: '' };
  try { ly = storeLastYear_(config_(), store); } catch (error) { ly = ly; }
  var writtenThrough = byKey.store_written ? String(byKey.store_written.verifiedThrough || '') : '';
  function dayCoverage(field) {
    var missing = [];
    var latest = '';
    currentDates.forEach(function (date) {
      var row = null;
      facts.forEach(function (item) { if (item.date === date) row = item; });
      var amount = row ? row[field] : null;
      if (amount !== null && amount !== undefined && amount !== '') { if (date > latest) latest = date; }
      else missing.push(date);
    });
    var holes = missing.filter(function (date) { return !latest || date < latest; });
    var waiting = missing.filter(function (date) { return latest && date > latest; });
    var text = (currentDates.length - missing.length) + ' of ' + currentDates.length + ' open days on CC_Daily, ' + store.start + ' through ' + currentEnd;
    if (latest) text += '. Verified through ' + latest;
    if (waiting.length) text += '. Not yet imported: ' + waiting.join(', ');
    if (holes.length) text += '. Missing inside the verified range: ' + holes.join(', ');
    return { holes: holes, text: text };
  }
  function lyCoverage(metric) {
    if (!ly.confirmed || !ly.start || !ly.end) return { complete: false, text: 'Last-year store period is not confirmed' };
    var dates = eachDate_(ly.start, ly.end);
    var missing = [];
    dates.forEach(function (date) { if (!historicalAmount_(metric, date)) missing.push(date); });
    var tab = historicalTabName_(metric);
    if (!missing.length) return { complete: true, text: dates.length + ' of ' + dates.length + ' days on ' + tab + ', ' + ly.start + ' through ' + ly.end };
    return { complete: false, text: (dates.length - missing.length) + ' of ' + dates.length + ' days on ' + tab + '. Missing ' + missing.join(', ') };
  }
  var sales = {
    store_written: { field: 'nwdsrWritten', metric: 'NWDSR Written', tab: 'NWDSR_WRITTEN_STORE and NWDSR_WRITTEN_LY' },
    store_delivered: { field: 'nwdsrDelivered', metric: 'NWDSR Delivered', tab: 'NWDSR_DELIVERED_STORE and NWDSR_DELIVERED_LY' },
    store_snap_written: { field: 'snapWritten', metric: 'SNAP Written', tab: 'SNAP_STORE and SNAP_WRITTEN_LY' },
  };
  return METRIC_DEFINITIONS_.map(function (definition) {
    var live = byKey[definition.key] || {};
    var through = live.verifiedThrough || 'Pending';
    var current = through === 'Pending' ? 'No verified current-period figure' : 'Verified through ' + through + ' (' + live.periodDates + ')';
    var last = 'No last-year comparison is shown';
    var status = through === 'Pending' ? 'MISSING' : 'PASS';
    var issue = '';
    var sale = sales[definition.key];
    if (sale) {
      var days = dayCoverage(sale.field);
      current = days.text;
      var prior = lyCoverage(sale.metric);
      last = prior.text;
      if (days.holes.length) { status = 'PARTIAL'; issue = 'A day inside the verified range has no ' + definition.name + ' amount.'; }
      else if (!prior.complete) { status = 'PARTIAL'; issue = prior.text + ' This is not a completed last-year comparison.'; }
      else { status = 'PASS'; issue = ''; }
    } else if (definition.key === 'kpi_bedding' || definition.key === 'store_bedding_dollars') {
      last = 'Shown as Not Available. BEDDING_STORE has no prior-year bedding report.';
      status = through === 'Pending' ? 'MISSING' : 'PARTIAL';
      issue = 'Bedding versus last year stays Not Available until a verified prior-year bedding report is imported.';
    } else if (definition.key === 'kpi_warranty' || definition.key === 'kpi_power_base') {
      status = 'MISSING';
      issue = 'CC_Kpi does not have a verified store-month figure, so the page leaves this Pending.';
    } else if (through !== 'Pending' && writtenThrough && through < writtenThrough && through.indexOf('through') === -1 && through.indexOf(',') === -1) {
      status = 'PARTIAL';
      issue = definition.name + ' is verified through ' + through + '. Store written is verified through ' + writtenThrough + '.';
    } else if (String(through).indexOf(',') !== -1) {
      status = 'PARTIAL';
      issue = 'Written and delivered are not verified through the same date: ' + through + '.';
    }
    return [definition.name, sale ? sale.tab : definition.source, current, last, through, status, issue];
  });
}

function writeMetricCoverage_() {
  var rows = metricCoverageRows_();
  rewriteTab_(COVERAGE_TAB_, COVERAGE_HEADERS_, rows);
  var counts = { PASS: 0, PARTIAL: 0, MISSING: 0, MISMATCH: 0, 'NEEDS REVIEW': 0, ERROR: 0 };
  rows.forEach(function (row) { if (counts[row[5]] !== undefined) counts[row[5]] += 1; });
  return { rows: rows.length, counts: counts, open: rows.filter(function (row) { return row[5] !== 'PASS'; }).map(function (row) { return { metric: row[0], status: row[5], issue: row[6], through: row[4] }; }) };
}

function applyIntegrityRepair_() {
  var started = null;
  try { started = startDevTask('Data integrity audit', 'Read-only inventory first. Filing verified current-year days onto the historical registers. No sales amount is changed.'); } catch (error) { started = { error: String(error.message || error) }; }
  var filed = fileVerifiedDaysOntoRegisters_();
  var coverage = writeMetricCoverage_();
  var quality = null;
  try { quality = runQualityChecks_('integrity audit'); } catch (error) { quality = { error: String(error.message || error) }; }
  var active = [];
  try {
    active = activeAlerts_().map(function (row) { return { date: row.business_date, report: row.report, message: row.message, severity: row.severity }; });
  } catch (error) { active = [{ message: String(error.message || error) }]; }
  var finished = null;
  if (started && started.taskNumber) {
    try { finished = finishDevTask(started.taskNumber, 'Filed ' + filed.added.length + ' verified days onto the historical registers. Coverage is on CC_MetricCoverage. Current-year sales were not changed.'); } catch (error) { finished = { error: String(error.message || error) }; }
  }
  return {
    filed: { added: filed.added, already: filed.already, skipped: filed.skipped },
    coverage: coverage,
    quality: quality && quality.error ? quality : { passed: quality && quality.passed, flagged: quality && quality.flagged, noted: quality && quality.noted },
    activeAlerts: active.slice(0, 25),
    devlog: finished || started,
  };
}
