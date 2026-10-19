/**
 * One read of the approved store figures, then a comparison with every page that serves the same scope.
 * This does not add a second way to add up sales. The numbers come from home_(), which already uses
 * sumField_(), storeMonthClosing_() and the metric registry.
 */
var CONSISTENCY_RUNS_ = 'CC_Consistency';
var CONSISTENCY_FINDINGS_ = 'CC_ConsistencyFindings';
var CONSISTENCY_RUN_HEADERS_ = ['run_at', 'trigger', 'status', 'checked', 'matched', 'discrepancies', 'warnings', 'summary'];
var CONSISTENCY_FINDING_HEADERS_ = ['run_at', 'status', 'page', 'metric', 'expected', 'actual', 'reason'];

function consistencyBlank_(value) {
  return value === null || value === undefined || value === '';
}

function consistencyShow_(value, unit) {
  if (consistencyBlank_(value)) return 'Pending';
  if (unit === 'percent') return percentText_(value);
  if (unit === 'count') return String(Math.round(Number(value)));
  if (unit === 'dollars') return moneyText_(value);
  return String(value);
}

function consistencyParse_(value) {
  if (consistencyBlank_(value)) return null;
  if (typeof value === 'number') return value;
  var text = String(value).replace(/,/g, '').trim();
  if (/^pending$/i.test(text) || /^not available$/i.test(text)) return null;
  if (text.indexOf('%') !== -1) return Number(text.replace(/[^0-9.-]/g, '')) / 100;
  if (text.indexOf('$') !== -1) return Number(text.replace(/[^0-9.-]/g, ''));
  var number = Number(text);
  return isFinite(number) ? number : text;
}

/** Display rounding is not a discrepancy. Dollars agree to the cent or to the displayed dollar. Ratios agree at one decimal percent. */
function consistencyMatch_(expected, actual, unit) {
  var left = consistencyParse_(expected);
  var right = consistencyParse_(actual);
  if (left === null && right === null) return true;
  if (typeof left !== 'number' || typeof right !== 'number') return String(left) === String(right);
  if (unit === 'percent') return percentText_(left) === percentText_(right);
  if (unit === 'count') return Math.round(left) === Math.round(right);
  return Math.round(left * 100) === Math.round(right * 100) || Math.round(left) === Math.round(right);
}

function consistencyCheck_(findings, page, metric, expected, actual, unit, reason) {
  var ok = consistencyMatch_(expected, actual, unit);
  findings.push({
    status: ok ? 'PASS' : 'FAIL',
    page: page,
    metric: metric,
    expected: consistencyShow_(expected, unit),
    actual: consistencyShow_(actual, unit),
    reason: ok ? 'Matches the canonical result for this scope and period.' : reason,
  });
}

function consistencyNote_(findings, page, metric, expected, actual, reason) {
  findings.push({ status: 'NOTE', page: page, metric: metric, expected: expected, actual: actual, reason: reason });
}

function consistencyWarn_(findings, page, metric, reason) {
  findings.push({ status: 'WARNING', page: page, metric: metric, expected: '', actual: '', reason: reason });
}

function consistencyLine_(lines, key) {
  var found = null;
  (lines || []).forEach(function (line) { if (line.key === key) found = line; });
  return found;
}

function consistencySum_(days, field) {
  var total = 0;
  var any = false;
  (days || []).forEach(function (day) {
    if (consistencyBlank_(day[field])) return;
    total += Number(day[field]);
    any = true;
  });
  return any ? Math.round(total * 100) / 100 : null;
}

function metricService_(session) {
  var home = home_({ session: session });
  var parts = String(home.period || '').split(' through ');
  var start = parts[0] || '';
  var end = parts[1] || '';
  var personParts = String(home.individualPeriod || '').split(' through ');
  var closing = home.closing && home.closing.mtd ? home.closing.mtd : {};
  var fresh = home.freshness || {};
  var dayWritten = home.yesterday ? home.yesterday.written : null;
  var daySnap = home.yesterday ? home.yesterday.snapWritten : null;
  var gap = consistencyBlank_(dayWritten) || consistencyBlank_(daySnap) ? null : Math.round((Number(dayWritten) - Number(daySnap)) * 100) / 100;
  var at = home.updated || 'Not Available';
  function dollars(id, value, sourceKey, scope, periodStart, periodEnd, through, complete) {
    var definition = metricDefinition_(sourceKey);
    return {
      id: id,
      value: consistencyBlank_(value) ? null : value,
      source: definition.source,
      scope: scope,
      periodStart: periodStart,
      periodEnd: periodEnd,
      verifiedThrough: through || 'Pending',
      completeness: complete,
      definition: definition.method,
      calculatedAt: at,
    };
  }
  var writtenThrough = fresh.written && fresh.written.through ? fresh.written.through : '';
  var deliveredThrough = fresh.delivered && fresh.delivered.through ? fresh.delivered.through : '';
  var snapThrough = fresh.snap && fresh.snap.through ? fresh.snap.through : '';
  var day = home.yesterday ? home.yesterday.date : '';
  var metrics = [
    dollars('store_written_day', dayWritten, 'store_written', 'Store day', day, day, consistencyBlank_(dayWritten) ? '' : day, consistencyBlank_(dayWritten) ? 'Pending' : 'Complete'),
    dollars('store_written', home.month.written, 'store_written', 'Store month', start, end, writtenThrough, consistencyBlank_(home.month.written) ? 'Pending' : 'Complete'),
    dollars('store_delivered', home.month.delivered, 'store_delivered', 'Store month', start, end, deliveredThrough, consistencyBlank_(home.month.delivered) ? 'Pending' : 'Complete'),
    dollars('store_snap_day', daySnap, 'store_snap_written', 'Store day', day, day, consistencyBlank_(daySnap) ? '' : day, consistencyBlank_(daySnap) ? 'Pending' : 'Complete'),
    dollars('store_snap', home.month.snapWritten, 'store_snap_written', 'Store month', start, end, snapThrough, consistencyBlank_(home.month.snapWritten) ? 'Pending' : 'Complete'),
    {
      id: 'nwdsr_minus_snap',
      value: gap,
      source: 'NWDSR Net Written minus SNAP Written',
      scope: 'Store day',
      periodStart: day,
      periodEnd: day,
      verifiedThrough: consistencyBlank_(gap) ? 'Pending' : day,
      completeness: consistencyBlank_(gap) ? 'Pending' : 'Complete',
      definition: 'The two written systems stay separate. The difference is NWDSR minus SNAP for the same day. Neither figure is rewritten.',
      calculatedAt: at,
    },
    {
      id: 'store_closing',
      value: consistencyBlank_(closing.ratio) ? null : closing.ratio,
      source: metricDefinition_('store_closing').source,
      scope: 'Store month, matching dates only',
      periodStart: start,
      periodEnd: end,
      verifiedThrough: closing.through || 'Pending',
      completeness: consistencyBlank_(closing.ratio) ? 'Pending' : (closing.provisional ? 'Partial' : 'Verified'),
      definition: metricDefinition_('store_closing').method,
      calculatedAt: at,
      customers: consistencyBlank_(closing.customers) ? null : closing.customers,
      opportunities: consistencyBlank_(closing.opportunities) ? null : closing.opportunities,
    },
  ];
  return { home: home, metrics: metrics, personPeriod: personParts[0] ? (personParts[0] + ' through ' + personParts[1]) : '' };
}

function consistencyById_(metrics, id) {
  var found = null;
  metrics.forEach(function (metric) { if (metric.id === id) found = metric; });
  return found || { value: null, verifiedThrough: 'Pending' };
}

function consistencyTextHas_(text, value, unit) {
  var shown = consistencyBlank_(value) ? 'Pending' : (unit === 'percent' ? percentText_(value) : moneyText_(value));
  return String(text || '').indexOf(shown) !== -1;
}

function consistencyPdfText_(pdf) {
  var text = String(pdf || '');
  if (text.indexOf('%PDF') === 0) return text;
  try {
    var bytes = Utilities.base64Decode(text);
    return bytes.map(function (bite) { return String.fromCharCode(bite < 0 ? bite + 256 : bite); }).join('');
  } catch (error) {
    return text;
  }
}

function consistencySameWindow_(note, through) {
  return !!through && String(note || '').indexOf(through) !== -1;
}

function consistencySurfaces_(session, pack, findings) {
  var home = pack.home;
  var written = consistencyById_(pack.metrics, 'store_written');
  var writtenDay = consistencyById_(pack.metrics, 'store_written_day');
  var delivered = consistencyById_(pack.metrics, 'store_delivered');
  var snapDay = consistencyById_(pack.metrics, 'store_snap_day');
  var gap = consistencyById_(pack.metrics, 'nwdsr_minus_snap');
  var closing = consistencyById_(pack.metrics, 'store_closing');
  consistencyCheck_(findings, 'Home', 'Store written MTD', written.value, home.board && home.board.month ? home.board.month.written : null, 'dollars', 'The Home board written total does not match the store-month written total.');
  consistencyCheck_(findings, 'Home', 'Store delivered MTD', delivered.value, home.board && home.board.month ? home.board.month.delivered : null, 'dollars', 'The Home board delivered total does not match the store-month delivered total.');
  var signedGap = consistencyBlank_(gap.value) ? null : Math.round(Number(gap.value) * -100) / 100;
  consistencyCheck_(findings, 'Home', 'SNAP variance', signedGap, home.yesterday ? home.yesterday.snapVariance : null, 'dollars', 'The shown SNAP variance is not SNAP minus NWDSR for the same day.');

  try {
    var daily = daily_({ session: session });
    consistencyCheck_(findings, 'Daily', 'Store written MTD', written.value, consistencySum_(daily.days, 'nwdsrWritten'), 'dollars', 'The Daily calendar does not add up to the store-month NWDSR Written total.');
    consistencyCheck_(findings, 'Daily', 'Store delivered MTD', delivered.value, consistencySum_(daily.days, 'nwdsrDelivered'), 'dollars', 'The Daily calendar does not add up to the store-month NWDSR Delivered total.');
    consistencyCheck_(findings, 'Daily', 'Store closing', closing.value, daily.closing ? daily.closing.ratio : null, 'percent', 'Daily store closing does not match the matching-date closing ratio.');
    consistencyCheck_(findings, 'Daily', 'Purchasing customers', closing.customers, daily.closing ? daily.closing.customers : null, 'count', 'Daily purchasing customers do not match the closing coverage.');
    consistencyCheck_(findings, 'Daily', 'PERQ opportunities', closing.opportunities, daily.closing ? daily.closing.opportunities : null, 'count', 'Daily PERQ opportunities do not match the closing coverage.');
    (daily.days || []).forEach(function (day) {
      if (!consistencyBlank_(day.opportunities) || consistencyBlank_(day.closingRatio)) return;
      findings.push({ status: 'FAIL', page: 'Daily', metric: 'Closing ' + day.date, expected: 'Pending', actual: consistencyShow_(day.closingRatio, 'percent'), reason: 'A closing ratio was shown without PERQ opportunities for ' + day.date + '.' });
    });
  } catch (error) {
    consistencyWarn_(findings, 'Daily', 'Page', 'The Daily page could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var closingPage = closing_({ session: session });
    consistencyCheck_(findings, 'Closing', 'Store closing', closing.value, closingPage.store ? closingPage.store.ratio : null, 'percent', 'The Closing page ratio does not match the matching-date store closing.');
    consistencyCheck_(findings, 'Closing', 'Purchasing customers', closing.customers, closingPage.store ? closingPage.store.customers : null, 'count', 'The Closing page customer count does not match.');
    consistencyCheck_(findings, 'Closing', 'PERQ opportunities', closing.opportunities, closingPage.store ? closingPage.store.opportunities : null, 'count', 'The Closing page opportunity count does not match.');
  } catch (error) {
    consistencyWarn_(findings, 'Closing', 'Page', 'The Closing page could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var brief = brief_({ session: session });
    consistencyCheck_(findings, 'Morning email', 'Store written day', writtenDay.value, brief.homeWritten, 'dollars', 'The Morning Start-Up preview does not use yesterday\'s NWDSR Written.');
    consistencyCheck_(findings, 'MTD email', 'Store written MTD', written.value, brief.homeMonthWritten, 'dollars', 'The MTD email preview does not use the store-month NWDSR Written total.');
    consistencyCheck_(findings, 'MTD email', 'Store delivered MTD', delivered.value, brief.homeMonthDelivered, 'dollars', 'The MTD email preview does not use the store-month NWDSR Delivered total.');
    if (!consistencyTextHas_(brief.startup && brief.startup.text, writtenDay.value, 'dollars')) {
      findings.push({ status: 'FAIL', page: 'Morning email', metric: 'Email text written', expected: consistencyShow_(writtenDay.value, 'dollars'), actual: 'Not in the preview', reason: 'The Morning Start-Up text does not show the canonical written figure.' });
    } else {
      findings.push({ status: 'PASS', page: 'Morning email', metric: 'Email text written', expected: consistencyShow_(writtenDay.value, 'dollars'), actual: consistencyShow_(writtenDay.value, 'dollars'), reason: 'Matches the canonical result for this scope and period.' });
    }
    if (!consistencyTextHas_(brief.mtd && brief.mtd.text, written.value, 'dollars')) {
      findings.push({ status: 'FAIL', page: 'MTD email', metric: 'Email text written MTD', expected: consistencyShow_(written.value, 'dollars'), actual: 'Not in the preview', reason: 'The MTD email text does not show the canonical written total.' });
    } else {
      findings.push({ status: 'PASS', page: 'MTD email', metric: 'Email text written MTD', expected: consistencyShow_(written.value, 'dollars'), actual: consistencyShow_(written.value, 'dollars'), reason: 'Matches the canonical result for this scope and period.' });
    }
    if (!consistencyTextHas_(brief.mtd && brief.mtd.text, closing.value, 'percent')) {
      findings.push({ status: 'FAIL', page: 'MTD email', metric: 'Email text closing', expected: consistencyShow_(closing.value, 'percent'), actual: 'Not in the preview', reason: 'The MTD email text does not show the matching-date closing ratio.' });
    } else {
      findings.push({ status: 'PASS', page: 'MTD email', metric: 'Email text closing', expected: consistencyShow_(closing.value, 'percent'), actual: consistencyShow_(closing.value, 'percent'), reason: 'Matches the canonical result for this scope and period.' });
    }
  } catch (error) {
    consistencyWarn_(findings, 'Email', 'Page', 'The email previews could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var leakage = leakage_({ session: session });
    consistencyCheck_(findings, 'Leakage baseline', 'Store written MTD', written.value, leakage.store ? leakage.store.written : null, 'dollars', 'The leakage actual baseline does not use store-month NWDSR Written.');
    consistencyCheck_(findings, 'Leakage baseline', 'Store closing', closing.value, leakage.store ? leakage.store.closingRatio : null, 'percent', 'The leakage actual baseline closing ratio does not match.');
  } catch (error) {
    consistencyWarn_(findings, 'Leakage baseline', 'Page', 'The leakage baseline could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var recovery = recovery_({ session: session });
    consistencyCheck_(findings, 'Recovery baseline', 'Store written MTD', written.value, recovery.actual ? recovery.actual.written : null, 'dollars', 'The recovery actual baseline does not use store-month NWDSR Written.');
    consistencyCheck_(findings, 'Recovery baseline', 'Store delivered MTD', delivered.value, recovery.actual ? recovery.actual.delivered : null, 'dollars', 'The recovery actual baseline does not use store-month NWDSR Delivered.');
    consistencyCheck_(findings, 'Recovery baseline', 'Store closing', closing.value, recovery.closing ? recovery.closing.ratio : null, 'percent', 'The recovery actual baseline closing ratio does not match.');
    consistencyCheck_(findings, 'Recovery baseline', 'Written budget', home.month.writtenGoal, recovery.budget, 'dollars', 'The recovery budget does not match the store written goal.');
  } catch (error) {
    consistencyWarn_(findings, 'Recovery baseline', 'Page', 'The recovery baseline could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var quietNotice = notifyOnce_;
    notifyOnce_ = function () { return null; };
    var morning;
    try {
      morning = morning_({ session: session });
    } finally {
      notifyOnce_ = quietNotice;
    }
    var morningWritten = morning.yesterday && morning.yesterday.written ? morning.yesterday.written.actual : null;
    consistencyCheck_(findings, 'Morning meeting', 'Store written day', writtenDay.value, morningWritten, 'dollars', 'The morning meeting does not show yesterday\'s NWDSR Written.');
    consistencyCheck_(findings, 'Morning meeting', 'SNAP written day', snapDay.value, morning.yesterday ? morning.yesterday.snapWritten : null, 'dollars', 'The morning meeting SNAP figure does not match.');
    consistencyCheck_(findings, 'Morning meeting', 'Yesterday closing', home.yesterday.closingRatio, morning.yesterday ? morning.yesterday.closingRatio : null, 'percent', 'The morning meeting daily closing ratio does not match.');
  } catch (error) {
    consistencyWarn_(findings, 'Morning meeting', 'Page', 'The morning meeting could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var management = reportDaily_({ session: session, date: home.yesterday.date }, home.today);
    var dayLine = consistencyLine_(management.lines, 'written');
    var mtdLine = consistencyLine_(management.lines, 'written-mtd');
    consistencyCheck_(findings, 'Daily summary', 'Store written day', writtenDay.value, dayLine ? dayLine.result : null, 'dollars', 'The daily management summary does not show yesterday\'s NWDSR Written.');
    if (mtdLine && consistencySameWindow_(mtdLine.source, written.verifiedThrough)) {
      consistencyCheck_(findings, 'Daily summary', 'Store written MTD', written.value, mtdLine.result, 'dollars', 'The daily summary month-to-date written total covers the same date and does not match.');
    } else {
      consistencyNote_(findings, 'Daily summary', 'Store written MTD', consistencyShow_(written.value, 'dollars') + ' through ' + (written.verifiedThrough || 'Pending'), mtdLine ? mtdLine.result : 'Pending', 'This summary\'s month-to-date coverage is not the same verified-through date, so the totals are not required to match.');
    }
    var dailyPdf = consistencyPdfText_(reportPdf_(management));
    if (dayLine && dailyPdf.indexOf(reportPdfEscape_(String(dayLine.result))) === -1) {
      findings.push({ status: 'FAIL', page: 'Daily PDF', metric: 'Store written day', expected: String(dayLine.result), actual: 'Not in the PDF', reason: 'The daily PDF does not contain the written figure shown in the preview.' });
    } else if (dayLine) {
      findings.push({ status: 'PASS', page: 'Daily PDF', metric: 'Store written day', expected: String(dayLine.result), actual: String(dayLine.result), reason: 'The PDF uses the same snapshot as the preview.' });
    }
  } catch (error) {
    consistencyWarn_(findings, 'Daily summary', 'Page', 'The daily management summary could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var weekly = reportWeekly_({ session: session }, home.today);
    var weekMtd = consistencyLine_(weekly.month, 'mtd-written');
    var weekDelivered = consistencyLine_(weekly.month, 'mtd-delivered');
    if (weekMtd && consistencySameWindow_(weekMtd.source, written.verifiedThrough)) {
      consistencyCheck_(findings, 'Weekly executive', 'Store written MTD', written.value, weekMtd.result, 'dollars', 'The weekly report store-month written total covers the same date and does not match.');
    } else {
      consistencyNote_(findings, 'Weekly executive', 'Store written MTD', consistencyShow_(written.value, 'dollars') + ' through ' + (written.verifiedThrough || 'Pending'), weekMtd ? (weekMtd.result + ' · ' + weekMtd.source) : 'Pending', 'The weekly report states its own store-month coverage. A different end date is not a discrepancy.');
    }
    if (weekDelivered && consistencySameWindow_(weekDelivered.source, delivered.verifiedThrough)) {
      consistencyCheck_(findings, 'Weekly executive', 'Store delivered MTD', delivered.value, weekDelivered.result, 'dollars', 'The weekly report store-month delivered total covers the same date and does not match.');
    }
    var weeklyPdf = consistencyPdfText_(reportWeeklyPdf_(weekly));
    if (weekMtd && weeklyPdf.indexOf(reportPdfEscape_(String(weekMtd.result))) === -1) {
      findings.push({ status: 'FAIL', page: 'Weekly PDF', metric: 'Store written MTD', expected: String(weekMtd.result), actual: 'Not in the PDF', reason: 'The weekly PDF does not contain the written figure shown in the preview.' });
    } else if (weekMtd) {
      findings.push({ status: 'PASS', page: 'Weekly PDF', metric: 'Store written MTD', expected: String(weekMtd.result), actual: String(weekMtd.result), reason: 'The PDF uses the same snapshot as the preview.' });
    }
  } catch (error) {
    consistencyWarn_(findings, 'Weekly executive', 'Page', 'The weekly executive report could not be read. ' + String(error && error.message ? error.message : error));
  }

  try {
    var people = peopleRows_(individualPeriodContaining_(home.today).start, individualPeriodContaining_(home.today).end);
    var associateWritten = 0;
    var anyAssociate = false;
    people.forEach(function (person) {
      if (person.role !== 'associate' || consistencyBlank_(person.written)) return;
      associateWritten += Number(person.written);
      anyAssociate = true;
    });
    consistencyNote_(findings, 'Sales Team', 'Associate SNAP vs store NWDSR', consistencyShow_(written.value, 'dollars') + ' NWDSR', anyAssociate ? moneyText_(associateWritten) + ' SNAP associates' : 'Pending', 'Active salesperson SNAP totals use a different source and can exclude former employees and management. They are not required to equal store NWDSR Written.');
  } catch (error) {
    consistencyWarn_(findings, 'Sales Team', 'Page', 'Salesperson totals could not be read. ' + String(error && error.message ? error.message : error));
  }
}

function consistencySummarize_(findings) {
  var checked = findings.filter(function (row) { return row.status === 'PASS' || row.status === 'FAIL'; }).length;
  var matched = findings.filter(function (row) { return row.status === 'PASS'; }).length;
  var discrepancies = findings.filter(function (row) { return row.status === 'FAIL'; });
  var warnings = findings.filter(function (row) { return row.status === 'WARNING'; });
  var status = discrepancies.length ? 'FAIL' : (warnings.length ? 'WARNING' : 'PASS');
  var summary = discrepancies.length
    ? discrepancies.slice(0, 3).map(function (row) { return row.page + ' ' + row.metric + ': ' + row.reason; }).join(' ')
    : (warnings.length ? warnings[0].reason : 'Matching scopes agree. Different periods and SNAP versus NWDSR are left separate.');
  if (summary.length > 400) summary = summary.slice(0, 397) + '...';
  return { status: status, checked: checked, matched: matched, discrepancies: discrepancies.length, warnings: warnings.length, summary: summary };
}

function consistencyStamp_() {
  try {
    return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm') + ' ET';
  } catch (error) {
    return new Date().toISOString();
  }
}

function consistencyPersist_(result) {
  try {
    var runs = sheet_(CONSISTENCY_RUNS_).map(function (row) {
      return [row.run_at, row.trigger, row.status, row.checked, row.matched, row.discrepancies, row.warnings, row.summary];
    });
    runs.push([result.at, result.trigger, result.status, result.checked, result.matched, result.discrepancies, result.warnings, result.summary]);
    if (runs.length > 30) runs = runs.slice(runs.length - 30);
    rewriteTab_(CONSISTENCY_RUNS_, CONSISTENCY_RUN_HEADERS_, runs);
    rewriteTab_(CONSISTENCY_FINDINGS_, CONSISTENCY_FINDING_HEADERS_, result.findings.filter(function (row) {
      return row.status !== 'PASS';
    }).slice(0, 40).map(function (row) {
      return [result.at, row.status, row.page, row.metric, row.expected, row.actual, row.reason];
    }));
  } catch (error) {
    result.saved = false;
    result.summary = (result.summary + ' The audit log could not be saved.').slice(0, 400);
  }
}

function runConsistencyAudit_(trigger) {
  var session = { role: 'admin', username: 'consistency' };
  var pack = metricService_(session);
  var findings = [];
  consistencySurfaces_(session, pack, findings);
  var summary = consistencySummarize_(findings);
  var result = {
    at: consistencyStamp_(),
    trigger: String(trigger || 'manual'),
    status: summary.status,
    checked: summary.checked,
    matched: summary.matched,
    discrepancies: summary.discrepancies,
    warnings: summary.warnings,
    summary: summary.summary,
    metrics: pack.metrics,
    findings: findings.filter(function (row) { return row.status !== 'PASS'; }),
    passes: summary.matched,
  };
  consistencyPersist_(result);
  return result;
}

function consistencyAge_(stamp) {
  var match = String(stamp || '').match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return null;
  var parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]) + 4, Number(match[5])));
  return Math.round((Date.now() - parsed.getTime()) / 60000);
}

function consistencyRead_() {
  var runs = [];
  var findings = [];
  try {
    runs = sheet_(CONSISTENCY_RUNS_).map(function (row) {
      return {
        at: String(row.run_at || ''),
        trigger: String(row.trigger || ''),
        status: String(row.status || ''),
        checked: Number(row.checked || 0),
        matched: Number(row.matched || 0),
        discrepancies: Number(row.discrepancies || 0),
        warnings: Number(row.warnings || 0),
        summary: String(row.summary || ''),
      };
    });
    findings = sheet_(CONSISTENCY_FINDINGS_).map(function (row) {
      return { at: String(row.run_at || ''), status: String(row.status || ''), page: String(row.page || ''), metric: String(row.metric || ''), expected: String(row.expected || ''), actual: String(row.actual || ''), reason: String(row.reason || '') };
    });
  } catch (error) {
    runs = [];
  }
  var last = runs.length ? runs[runs.length - 1] : null;
  var age = last ? consistencyAge_(last.at) : null;
  var stale = !last || age === null || age > 45;
  return {
    role: 'manager',
    status: last ? last.status : 'WARNING',
    stale: stale,
    staleText: !last ? 'No consistency audit has run yet.' : (stale ? 'This audit is more than 45 minutes old.' : ''),
    last: last,
    runs: runs.slice(-12).reverse(),
    findings: last ? findings.filter(function (row) { return row.at === last.at; }) : [],
    notice: 'Store written is NWDSR. Salesperson written is SNAP. A different date range is not a discrepancy. Missing reports stay Pending.',
  };
}

function consistency_(payload) {
  if (payload.session.role === 'sales') throw new Error('Data consistency is for managers.');
  var view = consistencyRead_();
  try {
    view.metrics = metricService_(payload.session).metrics;
  } catch (error) {
    view.metrics = [];
    view.metricError = 'The canonical figures could not be read. ' + String(error && error.message ? error.message : error);
  }
  return view;
}

function runConsistency_(payload) {
  if (payload.session.role === 'sales') throw new Error('Data consistency is for managers.');
  var result = runConsistencyAudit_('manual by ' + payload.session.role);
  var view = consistencyRead_();
  view.metrics = result.metrics;
  view.status = result.status;
  view.stale = false;
  view.staleText = '';
  return view;
}
