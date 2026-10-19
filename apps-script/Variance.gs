/**
 * Written Sales Reality. NWDSR Written stays the official store total.
 * SNAP Written is a separate comparison. The dollar gap is never removed from official written sales,
 * and it is never labeled as air tickets unless a manager writes that review note themselves.
 * Review labels are manager notes, not findings. Nothing here emails anyone.
 */

var VARIANCE_TAB_ = 'CC_WrittenReview';
var VARIANCE_HEADERS_ = ['date', 'category', 'explanation', 'references', 'by', 'updated'];
var VARIANCE_CATEGORIES_ = [
  { key: 'unresolved', label: 'Unresolved' },
  { key: 'possible-air', label: 'Possible air-ticket activity' },
  { key: 'timing', label: 'Timing or reporting difference' },
  { key: 'adjustment', label: 'Cancellation or adjustment' },
  { key: 'other', label: 'Other' },
];

function varianceRound_(value) {
  return Math.round(Number(value) * 100) / 100;
}

function varianceThreshold_() {
  var config = {};
  try { config = config_(); } catch (error) { config = {}; }
  var number = Number(config.written_gap_threshold);
  if (!isFinite(number) || number < 0) return 1000;
  return Math.round(number);
}

function varianceCategory_(key) {
  var found = 'unresolved';
  VARIANCE_CATEGORIES_.forEach(function (item) { if (item.key === String(key || '')) found = item.key; });
  return found;
}

function varianceCategoryLabel_(key) {
  var label = 'Unresolved';
  VARIANCE_CATEGORIES_.forEach(function (item) { if (item.key === key) label = item.label; });
  return label;
}

function varianceSignPercent_(ratio) {
  if (ratio === null || ratio === undefined) return 'Pending';
  var text = percentText_(ratio);
  if (Number(ratio) > 0) return '+' + text;
  return text;
}

function varianceIndex_(facts) {
  var map = {};
  (facts || []).forEach(function (row) { if (row.date) map[row.date] = row; });
  return map;
}

function varianceReviews_() {
  var map = {};
  sheet_(VARIANCE_TAB_).forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date) return;
    var category = varianceCategory_(row.category);
    map[date] = {
      category: category,
      label: varianceCategoryLabel_(category),
      explanation: String(row.explanation || '').replace(/\s+/g, ' ').trim(),
      references: String(row.references || '').replace(/\s+/g, ' ').trim(),
      by: String(row.by || ''),
      updated: String(row.updated || ''),
      caveat: 'Manager review label. Not an automatic conclusion and not a change to official written sales.',
    };
  });
  return map;
}

function varianceDay_(date, factsMap, closed, reviews, threshold) {
  var row = factsMap[date] || null;
  var nwdsr = row ? row.nwdsrWritten : null;
  var snap = row ? row.snapWritten : null;
  var coverage = closed[date] ? 'closed' : (nwdsr === null && snap === null ? 'missing-both' : (nwdsr === null ? 'missing-nwdsr' : (snap === null ? 'missing-snap' : 'both')));
  var comparable = coverage === 'both';
  var dollars = comparable ? varianceRound_(nwdsr - snap) : null;
  var percent = comparable && Number(nwdsr) !== 0 ? Math.round(((nwdsr - snap) / Number(nwdsr)) * 1000) / 1000 : null;
  var review = reviews[date] || null;
  var large = comparable && Math.abs(dollars) >= threshold;
  return {
    date: date,
    display: briefDisplayDate_(date),
    short: String(date).slice(5),
    nwdsr: comparable ? nwdsr : null,
    snap: comparable ? snap : null,
    nwdsrText: nwdsr === null ? 'Pending' : moneyText_(nwdsr),
    snapText: snap === null ? 'Pending' : moneyText_(snap),
    dollars: dollars,
    dollarsText: dollars === null ? 'Pending' : reportSnapSignMoney_(dollars),
    percent: percent,
    percentText: varianceSignPercent_(percent),
    coverage: coverage,
    comparable: comparable,
    large: large,
    review: review,
    unresolved: large && (!review || review.category === 'unresolved'),
  };
}

function varianceOpenDays_(start, end, factsMap, closed, reviews, threshold) {
  var days = [];
  if (!start || !end || start > end) return days;
  eachDate_(start, end).forEach(function (date) {
    if (closed[date]) return;
    days.push(varianceDay_(date, factsMap, closed, reviews, threshold));
  });
  return days;
}

function varianceWindow_(key, label, days) {
  var comparable = (days || []).filter(function (day) { return day.comparable; });
  var holes = (days || []).filter(function (day) { return !day.comparable; }).map(function (day) { return day.date; });
  var nwdsr = null;
  var snap = null;
  if (comparable.length) {
    nwdsr = 0;
    snap = 0;
    comparable.forEach(function (day) {
      nwdsr += day.nwdsr;
      snap += day.snap;
    });
    nwdsr = varianceRound_(nwdsr);
    snap = varianceRound_(snap);
  }
  var dollars = nwdsr === null ? null : varianceRound_(nwdsr - snap);
  var percent = nwdsr === null || Number(nwdsr) === 0 ? null : Math.round(((nwdsr - snap) / nwdsr) * 1000) / 1000;
  var dates = comparable.map(function (day) { return day.date; });
  var coverage = '';
  if (!days || !days.length) coverage = 'No open day is in this period.';
  else if (!comparable.length) coverage = 'No day in this period has both NWDSR Written and SNAP Written. The comparison stays Pending and missing days are not treated as zero.';
  else if (holes.length) coverage = 'Incomplete coverage. Totals use only ' + dates.length + ' day' + (dates.length === 1 ? '' : 's') + ' with both reports (' + dates[0] + ' through ' + dates[dates.length - 1] + '). Missing a report: ' + reportDateList_(holes) + '. Those dates are not treated as zero and are not in the total.';
  else coverage = 'Both reports are on file for every open day in this comparison (' + dates[0] + ' through ' + dates[dates.length - 1] + ').';
  return {
    key: key,
    label: label,
    nwdsr: nwdsr,
    snap: snap,
    dollars: dollars,
    percent: percent,
    nwdsrText: nwdsr === null ? 'Pending' : moneyText_(nwdsr),
    snapText: snap === null ? 'Pending' : moneyText_(snap),
    dollarsText: dollars === null ? 'Pending' : reportSnapSignMoney_(dollars),
    percentText: varianceSignPercent_(percent),
    verifiedThrough: dates.length ? dates[dates.length - 1] : '',
    verifiedDates: dates.length ? (briefDisplayDate_(dates[0]) + ' through ' + briefDisplayDate_(dates[dates.length - 1])) : 'Pending',
    comparableCount: dates.length,
    incomplete: !dates.length || holes.length > 0,
    incompleteDates: holes,
    coverage: coverage,
    official: 'NWDSR Written stays the official store total. This difference is not subtracted from it.',
  };
}

function varianceSeven_(yesterday, factsMap, closed, reviews, threshold) {
  var cursor = yesterday;
  var found = [];
  var skipped = [];
  var steps = 0;
  while (found.length < 7 && cursor && steps < 400) {
    if (!closed[cursor]) {
      var day = varianceDay_(cursor, factsMap, closed, reviews, threshold);
      if (day.comparable) found.push(day);
      else skipped.push(cursor);
    }
    cursor = shiftDate_(cursor, -1);
    steps += 1;
  }
  found.reverse();
  var window = varianceWindow_('seven', 'Last seven comparable verified days', found);
  var extra = [];
  if (found.length < 7) extra.push('Only ' + found.length + ' comparable verified days are on file.');
  if (skipped.length) extra.push('Open days skipped because one report is missing: ' + reportDateList_(skipped) + '.');
  if (found.length >= 2) {
    var openBetween = 0;
    eachDate_(found[0].date, found[found.length - 1].date).forEach(function (date) { if (!closed[date]) openBetween += 1; });
    if (openBetween !== found.length) extra.push('These verified days are not one continuous run.');
  }
  if (extra.length) {
    window.incomplete = true;
    window.coverage = extra.join(' ') + ' ' + window.coverage;
  }
  return { window: window, days: found };
}

function varianceSheet_() {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(VARIANCE_TAB_);
  if (!tab) {
    tab = spreadsheet.insertSheet(VARIANCE_TAB_);
    tab.getRange(1, 1, 1, VARIANCE_HEADERS_.length).setValues([VARIANCE_HEADERS_]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function varianceUpsert_(date, category, explanation, references, session) {
  var tab = varianceSheet_();
  var values = tab.getDataRange().getValues();
  var by = session && (session.username || session.role) ? String(session.username || session.role) : 'manager';
  var line = [date, category, explanation, references, by, new Date().toISOString()];
  var index = -1;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === date) index = r;
  }
  if (index === -1) tab.getRange(tab.getLastRow() + 1, 1, 1, line.length).setValues([line]);
  else tab.getRange(index + 1, 1, 1, line.length).setValues([line]);
  forgetRead_(VARIANCE_TAB_);
}

function varianceBrief_(start, end) {
  var today = todayNy_();
  var yesterday = priorBusinessDay_(today);
  var finish = end && end < yesterday ? end : yesterday;
  var begin = start || finish;
  if (begin > finish) begin = finish;
  var factsMap = varianceIndex_(dailyFacts_());
  var closed = closedDates_();
  var reviews = varianceReviews_();
  var threshold = varianceThreshold_();
  var days = varianceOpenDays_(begin, finish, factsMap, closed, reviews, threshold);
  var window = varianceWindow_('report', 'This report', days);
  var unresolved = days.filter(function (day) { return day.unresolved; });
  var latest = null;
  days.forEach(function (day) { if (day.comparable) latest = day; });
  var text = unresolved.length
    ? ('Unresolved written differences above $' + threshold.toLocaleString('en-US') + ': ' + unresolved.length + '. Latest comparable day ' + (latest ? latest.dollarsText : 'Pending') + '. Comparable NWDSR minus SNAP ' + window.dollarsText + '.')
    : ('No unresolved written difference above $' + threshold.toLocaleString('en-US') + '. Comparable NWDSR minus SNAP ' + window.dollarsText + '.');
  text += ' Not removed from official NWDSR Written.';
  if (window.incomplete) text += ' Coverage is incomplete, so this is not a same-date total for every open day.';
  return { count: unresolved.length, dollars: window.dollarsText, text: text };
}

function variance_(payload) {
  var today = todayNy_();
  var yesterday = priorBusinessDay_(today);
  var factsMap = varianceIndex_(dailyFacts_());
  var closed = closedDates_();
  var reviews = varianceReviews_();
  var threshold = varianceThreshold_();
  var store = storePeriodContaining_(today);
  var monthEnd = yesterday > store.end ? store.end : yesterday;
  if (monthEnd < store.start) monthEnd = store.start;
  var monthDays = yesterday < store.start ? [] : varianceOpenDays_(store.start, monthEnd, factsMap, closed, reviews, threshold);
  var yesterdayDay = varianceDay_(yesterday, factsMap, closed, reviews, threshold);
  var seven = varianceSeven_(yesterday, factsMap, closed, reviews, threshold);
  var focus = String(payload && payload.focus || 'month');
  if (['yesterday', 'seven', 'month', 'custom'].indexOf(focus) === -1) focus = 'month';
  var customStart = isoDate_(payload && payload.start) || store.start;
  var customEnd = isoDate_(payload && payload.end) || monthEnd;
  if (customStart > customEnd) {
    var swap = customStart;
    customStart = customEnd;
    customEnd = swap;
  }
  var excludedFuture = '';
  if (customEnd > yesterday) {
    excludedFuture = ' Dates after ' + yesterday + ' are not a finished business day and are left out.';
    customEnd = yesterday;
  }
  var customDays = varianceOpenDays_(customStart, customEnd, factsMap, closed, reviews, threshold);
  var customWindow = varianceWindow_('custom', 'Selected period', customDays);
  if (excludedFuture) {
    customWindow.incomplete = true;
    customWindow.coverage += excludedFuture;
  }
  var windows = [
    varianceWindow_('yesterday', 'Yesterday', yesterdayDay.coverage === 'closed' ? [] : [yesterdayDay]),
    seven.window,
    varianceWindow_('month', 'Current store month', monthDays),
    customWindow,
  ];
  var active = focus === 'yesterday' ? [yesterdayDay] : (focus === 'seven' ? seven.days : (focus === 'custom' ? customDays : monthDays));
  var unresolved = active.filter(function (day) { return day.unresolved; });
  return {
    role: payload.session ? payload.session.role : '',
    version: APP_VERSION_,
    kind: 'variance',
    mail: false,
    today: today,
    yesterday: yesterday,
    focus: focus,
    threshold: threshold,
    start: customStart,
    end: customEnd,
    storePeriod: store.start + ' through ' + store.end,
    categories: VARIANCE_CATEGORIES_,
    orderEvidence: false,
    orderNote: 'No order-level written file is on this workbook. A reference a manager types is a note, not proof.',
    notice: 'NWDSR Written is the official store written measure. SNAP Written is an independent comparison. The difference is not subtracted from official written sales. A review label is a manager note, not a finding.',
    windows: windows,
    days: active,
    unresolved: unresolved,
    chart: active.map(function (day) {
      return { date: day.date, label: day.short, dollars: day.dollars, large: day.large, text: day.dollarsText };
    }),
  };
}

function saveWrittenReview_(payload) {
  if (payload && payload.threshold !== undefined && payload.threshold !== null && String(payload.threshold) !== '') {
    var number = Number(payload.threshold);
    if (!isFinite(number) || number < 0 || number > 1000000) throw new Error('Enter a dollar threshold of zero or more.');
    putConfig_('written_gap_threshold', Math.round(number));
  }
  if (payload && payload.date) {
    var date = isoDate_(payload.date);
    if (!date) throw new Error('Choose the business date for this note.');
    var category = varianceCategory_(payload.category);
    var explanation = String(payload.explanation || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    var references = String(payload.references || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (category !== 'unresolved' && !explanation) throw new Error('Add a short explanation with that review label.');
    varianceUpsert_(date, category, explanation, references, payload.session);
  }
  return variance_(payload || {});
}
