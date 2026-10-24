/**
 * Morning Report Readiness. A manager view of whether the previous business day's reports have arrived, been imported,
 * and updated the website. It reads CC_Health, CC_Imports, CC_Uploads, CC_DataStatus's quality package, and the same
 * checklist Upload Reports uses. It does not import mail, does not add a second copy of a file, and does not email.
 */

var READINESS_LABELS_ = {
  snapWritten: 'SNAP Written',
  nwdsrWritten: 'NWDSR Written',
  nwdsrDelivered: 'NWDSR Delivered',
  g17Written: 'Data Analysis Group 17 Written',
  g17Delivered: 'Data Analysis Group 17 Delivered',
  aslWritten: 'Data Analysis ASL Written',
  aslDelivered: 'Data Analysis ASL Delivered',
  perqLocation: 'PERQ Store opportunities',
  perqSalesperson: 'PERQ Salesperson opportunities',
};

function readinessContext_(today) {
  try {
    return qualityContext_(today);
  } catch (error) {
    return {
      today: today,
      yesterday: shiftDate_(today, -1),
      store: storePeriodContaining_(today),
      person: individualPeriodContaining_(today),
      dueHour: 10,
      hour: 24,
      closed: closedDates_(),
      facts: dailyFacts_(),
      ledger: [],
      closing: [],
      imports: [],
      uploads: [],
      evidence: { facts: {}, ledger: {}, attempts: {}, uploads: [] },
      packageMemo: {},
    };
  }
}

function readinessCover_(ctx, key, date) {
  if (key === 'g17Written' || key === 'g17Delivered') return cumulativeCover_(ctx, ['DA_SALES_STORE'], key === 'g17Written' ? 'written' : 'delivered', 'STORE', date);
  if (key === 'aslWritten' || key === 'aslDelivered') return cumulativeCover_(ctx, ['RUGS_STORE', 'PILLOWS_STORE', 'BASES_STORE', 'FP_STORE'], key === 'aslWritten' ? 'written' : 'delivered', 'STORE', date);
  if (key === 'perqLocation') return perqSnapshotCover_(ctx, 'store', date) || cumulativeCover_(ctx, ['PERQ_STORE'], '', 'STORE', date);
  if (key === 'perqSalesperson') return perqSnapshotCover_(ctx, 'person', date) || cumulativeCover_(ctx, ['PERQ_PERSON'], '', 'PERSON', date);
  var field = key === 'snapWritten' ? 'snapWritten' : (key === 'nwdsrDelivered' ? 'nwdsrDelivered' : 'nwdsrWritten');
  if (key !== 'snapWritten' && key !== 'nwdsrWritten' && key !== 'nwdsrDelivered') return '';
  return latestFactDate_(ctx.facts, field, '2000-01-01', shiftDate_(date, 1), shiftDate_(date, 1)) || '';
}

function readinessSource_(attempt, archive) {
  var file = attempt ? String(attempt.file || '') : '';
  var sha = attempt ? String(attempt.sha256 || '') : '';
  var saved = sha && archive[sha] ? archive[sha] : null;
  var id = saved && saved.id ? String(saved.id) : '';
  return {
    file: (saved && saved.file) || file,
    url: id ? ('https://drive.google.com/file/d/' + id + '/view') : '',
  };
}

function readinessItem_(ctx, date, key, archive) {
  var packed = packageItem_(ctx, date, key);
  var checklist = ctx.packageMemo[date] && ctx.packageMemo[date][key] ? ctx.packageMemo[date][key] : { status: packed.status, message: packed.detail, lastAt: '', lastFile: '' };
  var attempt = ctx.evidence && ctx.evidence.attempts ? ctx.evidence.attempts[key + '|' + date] : null;
  var notExpected = packed.status === 'Not expected';
  var onFile = packed.status === 'Imported' || packed.status === 'Covered' || packed.status === 'Needs Review' || notExpected;
  var failed = packed.status === 'Failed' || packed.status === 'Needs Review';
  var received = notExpected ? '$0' : (onFile ? 'Received' : (packed.status === 'Awaiting' ? 'Not due' : 'Missing'));
  var imported = notExpected ? '$0' : (onFile && !failed ? 'Imported' : (failed ? 'Failed' : 'Pending'));
  var through = onFile ? date : (readinessCover_(ctx, key, date) || '');
  var source = readinessSource_(attempt, archive);
  if (!source.file && checklist.lastFile) source.file = checklist.lastFile;
  return {
    key: key,
    label: READINESS_LABELS_[key] || packed.label || key,
    date: date,
    received: received,
    imported: imported,
    through: through || 'Pending',
    updated: (attempt && attempt.at) || checklist.lastAt || '',
    file: source.file,
    url: source.url,
    detail: packed.detail || checklist.message || '',
    failed: failed,
  };
}

function readinessStatus_(items, due) {
  if (!items.length) return 'READY';
  if (items.some(function (item) { return item.failed; })) return 'ERROR';
  var received = items.filter(function (item) { return item.received === 'Received' || item.received === '$0'; }).length;
  if (received === items.length) return 'READY';
  if (!due && received === 0) return 'NOT DUE';
  if (received === 0) return 'MISSING';
  return 'PARTIAL';
}

function readinessWaiting_(items) {
  var lines = [];
  items.forEach(function (item) {
    if (item.received === 'Received' || item.received === '$0') return;
    var names = [];
    (REPORT_METRICS_[item.key] || []).forEach(function (metric) {
      var definition = typeof metricDefinition_ === 'function' ? metricDefinition_(metric) : null;
      var name = definition && definition.name ? definition.name : metric;
      if (names.indexOf(name) === -1) names.push(name);
    });
    if (names.length) lines.push({ report: item.label, waiting: item.received === 'Not due' ? 'Not due yet' : item.received, metrics: names.join(', ') });
  });
  return lines;
}

function readiness_(payload) {
  var today = todayNy_();
  var requested = isoDate_(payload && payload.date);
  var date = requested && requested < today ? requested : priorBusinessDay_(today);
  var ctx = readinessContext_(today);
  var closed = !!(ctx.closed && ctx.closed[date]);
  var due = typeof reportDue_ === 'function' ? reportDue_(ctx, date) : true;
  var archive = {};
  try { archive = archiveIndex_(); } catch (error) { archive = {}; }
  var keys = closed || typeof requiredReports_ !== 'function' ? [] : requiredReports_(ctx, date);
  var items = keys.map(function (key) { return readinessItem_(ctx, date, key, archive); });
  var status = closed ? 'READY' : readinessStatus_(items, due);
  var missing = items.filter(function (item) { return item.received === 'Missing'; }).map(function (item) { return item.label; });
  var headline = status === 'READY'
    ? (closed ? 'The store was closed. No reports were expected.' : 'All required reports for this day are on the website.')
    : (status === 'NOT DUE'
      ? 'These reports are not due yet.'
      : (missing.length ? ('Missing: ' + missing.join(', ') + '.') : 'A report needs review before this day is ready.'));
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'readiness',
    mail: false,
    today: today,
    date: date,
    displayDate: briefDisplayDate_(date),
    due: due,
    dueText: 'Reports for a finished day are due by ' + (ctx.dueHour || 10) + ':00 the next morning. Before that hour, a missing file is not an error.',
    closed: closed,
    status: status,
    headline: headline,
    items: items,
    missing: missing,
    waiting: readinessWaiting_(items),
    lastUpdate: healthValue_('last_calculation') || 'Pending',
    notice: 'This checklist is report completeness. The Data Refresh indicator is only the website connection. Recheck runs the existing validation and does not import another copy. No email is sent.',
  };
}

/** Manager recheck: the same quality run System health uses. It does not import mail or rewrite a verified figure. */
function recheckReports_(payload) {
  runChecks_(payload);
  var page = readiness_(payload);
  page.rechecked = true;
  return page;
}
