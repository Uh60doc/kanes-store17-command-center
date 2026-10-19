/**
 * 13-week store trend. Completed Monday–Sunday weeks are built from daily records.
 * A cumulative snapshot is never added to those days. A missing day stays Pending.
 * The current partial week is returned separately and is not part of the 13.
 */

function trendRound_(value, places) {
  var scale = Math.pow(10, places);
  return Math.round(Number(value) * scale) / scale;
}

/** Weighted rate. A missing part stays null. Percents are not averaged. */
function trendRate_(parts, places) {
  var numerator = 0;
  var denominator = 0;
  var index;
  for (index = 0; index < parts.length; index += 1) {
    if (!parts[index] || parts[index].numerator === null || parts[index].denominator === null) return null;
    numerator += Number(parts[index].numerator);
    denominator += Number(parts[index].denominator);
  }
  if (!denominator) return null;
  return trendRound_(numerator / denominator, places);
}

function trendAverage_(values) {
  if (!values.length) return null;
  var total = 0;
  values.forEach(function (value) { total += Number(value); });
  return trendRound_(total / values.length, 2);
}

function trendWeeks_(today) {
  var weeks = [];
  var week = reportLastCompletedWeek_(today);
  var seen = {};
  while (weeks.length < 13) {
    if (!week || seen[week.start]) break;
    seen[week.start] = true;
    weeks.unshift({ start: week.start, end: week.end, partial: false });
    var older = reportCompletedWeek_(today, shiftDate_(week.start, -1));
    if (!older || older.start === week.start) break;
    week = older;
  }
  return weeks;
}

function trendOpen_(start, end, closed) {
  var days = [];
  eachDate_(start, end).forEach(function (date) { if (!closed[date]) days.push(date); });
  return days;
}

function trendLedger_(rows) {
  var map = {};
  rows.forEach(function (row) {
    if (row.grain !== 'daily' || row.scope !== 'STORE' || row.code || row.name || !row.reportDate) return;
    var key = row.view + '|' + row.side + '|' + row.reportDate;
    var current = map[key];
    if (!current || String(row.verifiedThrough || '') > String(current.verifiedThrough || '')) map[key] = row;
  });
  return map;
}

function trendText_(unit, value) {
  if (value === null || value === undefined) return 'Pending';
  if (unit === 'dollars') return moneyText_(value);
  if (unit === 'percent') return percentText_(value);
  return String(trendRound_(value, 2));
}

function trendPoint_(week, pack, unit, closed) {
  var open = trendOpen_(week.start, week.end, closed);
  var coverage = pack.pending
    ? ('Pending. Missing ' + (reportDateList_(pack.missing || []) || 'a verified daily report') + '. Not counted as zero.')
    : (open.length + ' open days. ' + briefDisplayDate_(week.start) + ' through ' + briefDisplayDate_(week.end) + '.');
  return {
    start: week.start,
    end: week.end,
    partial: !!week.partial,
    label: briefDisplayDate_(week.end).replace(/, \d{4}$/, ''),
    display: briefDisplayDate_(week.start) + ' – ' + briefDisplayDate_(week.end),
    value: pack.pending ? null : pack.value,
    text: pack.pending ? 'Pending' : trendText_(unit, pack.value),
    numerator: pack.pending ? null : pack.numerator,
    denominator: pack.pending ? null : pack.denominator,
    coverage: coverage,
    moving: null,
    movingText: '',
  };
}

function trendBlank_(missing) {
  return { pending: true, value: null, missing: missing, numerator: null, denominator: null };
}

function trendFieldWeek_(facts, field, week, closed) {
  var pack = reportRangeField_(facts, field, week.start, week.end, closed);
  return { pending: pack.pending, value: pack.value, missing: pack.missing, numerator: pack.value, denominator: null };
}

function trendCountWeek_(view, field, week, closed) {
  var pack = reportRangeClosing_(view, week.start, week.end, closed);
  var value = pack[field];
  var missing = field === 'customers' ? pack.missingCustomers : pack.missingOpportunities;
  if (value === null) return trendBlank_(missing);
  return { pending: false, value: value, missing: [], numerator: value, denominator: null };
}

function trendClosingWeek_(view, week, closed) {
  var pack = reportRangeClosing_(view, week.start, week.end, closed);
  if (pack.customers === null || pack.opportunities === null) {
    return trendBlank_(pack.missingCustomers.concat(pack.missingOpportunities));
  }
  if (!pack.opportunities) return { pending: true, value: null, missing: [], numerator: pack.customers, denominator: 0 };
  return {
    pending: false,
    value: trendRound_(pack.customers / pack.opportunities, 3),
    missing: [],
    numerator: pack.customers,
    denominator: pack.opportunities,
  };
}

function trendLedgerWeek_(map, spec, week, closed) {
  var missing = [];
  var numerator = 0;
  var denominator = 0;
  var open = false;
  eachDate_(week.start, week.end).forEach(function (date) {
    if (closed[date]) return;
    open = true;
    var row = map[spec.view + '|' + spec.side + '|' + date];
    var sales = spec.salesView ? map[spec.salesView + '|' + spec.side + '|' + date] : null;
    if (spec.mode === 'bedding') {
      if (!row || !sales || row.sales === null || sales.sales === null) { missing.push(date); return; }
      numerator += Number(row.sales);
      denominator += Number(sales.sales);
    } else if (spec.mode === 'ticket') {
      if (!row || row.sales === null || row.units === null) { missing.push(date); return; }
      numerator += Number(row.sales);
      denominator += Number(row.units);
    } else if (spec.mode === 'count') {
      if (!row || row.units === null) { missing.push(date); return; }
      numerator += Number(row.units);
    } else if (!row || row.attachments === null || row.eligible === null) missing.push(date);
    else {
      numerator += Number(row.attachments);
      denominator += Number(row.eligible);
    }
  });
  if (!open || missing.length) return trendBlank_(missing);
  if (spec.mode === 'count') return { pending: false, value: trendRound_(numerator, 2), missing: [], numerator: numerator, denominator: null };
  if (!denominator) return { pending: true, value: null, missing: [], numerator: trendRound_(numerator, 2), denominator: 0 };
  var places = spec.unit === 'dollars' ? 2 : 3;
  return { pending: false, value: trendRound_(numerator / denominator, places), missing: [], numerator: trendRound_(numerator, 2), denominator: denominator };
}

function trendSpecs_(goals) {
  return [
    { key: 'written', label: 'NWDSR Written', unit: 'dollars', goal: null, source: 'NWDSR Written on CC_Daily. Not SNAP and not Delivered.' },
    { key: 'delivered', label: 'NWDSR Delivered', unit: 'dollars', goal: null, source: 'NWDSR Delivered on CC_Daily. Not Written.' },
    { key: 'opportunities', label: 'PERQ opportunities', unit: 'count', goal: null, source: 'PERQ store opportunities. Not purchasing customers.' },
    { key: 'customers', label: 'Purchasing customers', unit: 'count', goal: null, source: 'NWDSR purchasing customers. Not PERQ opportunities.' },
    { key: 'closing', label: 'Store closing', unit: 'percent', goal: goals.closing, source: 'Purchasing customers ÷ PERQ opportunities for the same open days.' },
    { key: 'ticket', label: 'Average ticket', unit: 'dollars', goal: goals.averageTicket, source: 'Group 17 written sales ÷ Group 17 written orders. Not NWDSR.' },
    { key: 'bedding', label: 'Bedding', unit: 'percent', goal: goals.bedding, source: 'Group 17 written bedding dollars ÷ Group 17 written sales.' },
    { key: 'fabric', label: 'Fabric maintenance', unit: 'percent', goal: goals.fabric, source: 'Group 17 written fabric protection sold ÷ qualified.' },
    { key: 'leather', label: 'Leather maintenance', unit: 'percent', goal: goals.leather, source: 'Group 17 written leather protection sold ÷ qualified.' },
    { key: 'power', label: 'Power upholstery', unit: 'percent', goal: goals.power, source: 'Group 17 written power protection sold ÷ qualified.' },
    { key: 'pads', label: 'Mattress protectors', unit: 'percent', goal: goals.mattress, source: 'Group 17 written mattress protectors sold ÷ qualified.' },
    { key: 'rugs', label: 'Rugs sold', unit: 'count', goal: null, monthGoal: goals.rugs, source: 'ASL written rugs. The rug goal is a store-month count, not a weekly goal.' },
    { key: 'pillows', label: 'Pillows', unit: 'percent', goal: goals.pillow, source: 'ASL written pillows attached ÷ qualified.' },
    { key: 'bases', label: 'Adjustable bases', unit: 'percent', goal: goals.adjustableBase, source: 'ASL written adjustable bases attached ÷ qualified.' },
    { key: 'protection', label: 'Furniture protection', unit: 'percent', goal: goals.wood, source: 'ASL written furniture protection ÷ qualified.' },
  ];
}

function trendMeasure_(spec, week, facts, view, map, closed) {
  if (spec.key === 'written') return trendFieldWeek_(facts, 'nwdsrWritten', week, closed);
  if (spec.key === 'delivered') return trendFieldWeek_(facts, 'nwdsrDelivered', week, closed);
  if (spec.key === 'opportunities') return trendCountWeek_(view, 'opportunities', week, closed);
  if (spec.key === 'customers') return trendCountWeek_(view, 'customers', week, closed);
  if (spec.key === 'closing') return trendClosingWeek_(view, week, closed);
  if (spec.key === 'ticket') return trendLedgerWeek_(map, { view: 'DA_SALES_STORE', side: 'written', mode: 'ticket', unit: 'dollars' }, week, closed);
  if (spec.key === 'bedding') return trendLedgerWeek_(map, { view: 'BEDDING_STORE', salesView: 'DA_SALES_STORE', side: 'written', mode: 'bedding' }, week, closed);
  if (spec.key === 'rugs') return trendLedgerWeek_(map, { view: 'RUGS_STORE', side: 'written', mode: 'count' }, week, closed);
  var views = { fabric: 'FABW_STORE', leather: 'LTHW_STORE', power: 'PWAR_STORE', pads: 'MPPA_STORE', pillows: 'PILLOWS_STORE', bases: 'BASES_STORE', protection: 'FP_STORE' };
  return trendLedgerWeek_(map, { view: views[spec.key], side: 'written', mode: 'ratio' }, week, closed);
}

function trendMoving_(points, unit) {
  points.forEach(function (point, index) {
    var window = points.slice(index - 3, index + 1);
    if (window.length < 4 || window.some(function (item) { return item.value === null; })) return;
    var value = unit === 'percent' || unit === 'dollars' && point.denominator !== null
      ? trendRate_(window, unit === 'dollars' ? 2 : 3)
      : trendAverage_(window.map(function (item) { return item.value; }));
    if (unit === 'dollars' && point.denominator === null) value = trendAverage_(window.map(function (item) { return item.value; }));
    if (value === null) return;
    point.moving = value;
    point.movingText = trendText_(unit, value);
  });
}

function trendVerified_(points) {
  return points.filter(function (point) { return point.value !== null; });
}

function trendCompare_(points, unit) {
  var verified = trendVerified_(points);
  if (verified.length < 8) {
    return { ready: false, text: verified.length + ' verified week' + (verified.length === 1 ? '' : 's') + ' on file. The four-week comparison needs 8 verified weeks. Nothing was estimated.' };
  }
  var recent = verified.slice(-4);
  var prior = verified.slice(-8, -4);
  var recentValue = unit === 'percent' || recent[0].denominator !== null ? trendRate_(recent, unit === 'dollars' ? 2 : 3) : trendAverage_(recent.map(function (item) { return item.value; }));
  var priorValue = unit === 'percent' || prior[0].denominator !== null ? trendRate_(prior, unit === 'dollars' ? 2 : 3) : trendAverage_(prior.map(function (item) { return item.value; }));
  if (unit === 'dollars' && recent[0].denominator === null) {
    recentValue = trendAverage_(recent.map(function (item) { return item.value; }));
    priorValue = trendAverage_(prior.map(function (item) { return item.value; }));
  }
  if (recentValue === null || priorValue === null) return { ready: false, text: 'The four-week comparison stays Pending.' };
  var delta = trendRound_(recentValue - priorValue, unit === 'percent' ? 3 : 2);
  return {
    ready: true,
    recent: recentValue,
    prior: priorValue,
    delta: delta,
    text: 'Last four verified weeks ' + trendText_(unit, recentValue) + ' versus the preceding four ' + trendText_(unit, priorValue) + ' (' + (delta > 0 ? '+' : '') + trendText_(unit, delta) + ').',
  };
}

function trendPair_(points) {
  var verified = trendVerified_(points);
  if (verified.length < 2) return null;
  return { latest: verified[verified.length - 1], prior: verified[verified.length - 2] };
}

function trendAlerts_(series, weeks, closed) {
  var alerts = [];
  function byKey(key) {
    var found = null;
    series.forEach(function (item) { if (item.key === key) found = item; });
    return found;
  }
  ['written', 'delivered'].forEach(function (key) {
    var item = byKey(key);
    var run = [];
    item.points.forEach(function (point) {
      if (point.value === null) run = [];
      else run.push(point);
    });
    var last = run.slice(-3);
    if (last.length < 3) alerts.push(item.label + ' is not marked as declining. ' + trendVerified_(item.points).length + ' verified week' + (trendVerified_(item.points).length === 1 ? '' : 's') + ' on file, and a decline needs 3 consecutive verified weeks.');
    else if (last[2].value < last[1].value && last[1].value < last[0].value) alerts.push(item.label + ' is lower in each of the last 3 verified weeks, ending ' + last[2].display + '.');
  });
  function below(key, goal, words) {
    var item = byKey(key);
    var latest = item.points[item.points.length - 1];
    if (!latest || latest.value === null) alerts.push(item.label + ' for the latest completed week is Pending, so it is not marked against the goal.');
    else if (goal !== null && latest.value < Number(goal) - 1e-9) alerts.push(item.label + ' for ' + latest.display + ' is ' + latest.text + ', below the ' + trendText_(item.unit, goal) + ' goal. ' + words);
  }
  var closing = byKey('closing');
  below('closing', closing.goal, 'This is one verified week, not a forecast.');
  below('ticket', byKey('ticket').goal, 'Group 17 written orders. Not commission.');
  below('bedding', byKey('bedding').goal, 'Group 17 written bedding.');
  ['fabric', 'leather', 'power', 'pads'].forEach(function (key) { below(key, byKey(key).goal, 'Written attachments.'); });
  var rugs = byKey('rugs');
  var latestWeek = weeks[weeks.length - 1];
  var latestRugs = rugs.points[rugs.points.length - 1];
  if (!latestRugs || latestRugs.value === null) alerts.push('Rug pace for the latest completed week is Pending. No weekly rug count was estimated.');
  else if (rugs.monthGoal === null || rugs.monthGoal === undefined) alerts.push('Rug pace stays Pending. No approved store-month rug goal is on file.');
  else {
    var month = storePeriodContaining_(latestWeek.end);
    if (latestWeek.start < month.start) alerts.push('Rug pace is not prorated. ' + latestRugs.display + ' crosses two store months.');
    else {
      var monthDays = trendOpen_(month.start, month.end, closed).length;
      var weekDays = trendOpen_(latestWeek.start, latestWeek.end, closed).length;
      if (!monthDays || !weekDays) alerts.push('Rug pace stays Pending. Open store days are not on file.');
      else {
        var share = trendRound_(Number(rugs.monthGoal) * weekDays / monthDays, 2);
        if (latestRugs.value + 1e-9 < share) alerts.push('Rugs for ' + latestRugs.display + ' are ' + latestRugs.text + '. A straight-line share of the ' + rugs.monthGoal + ' store-month goal is ' + share + ' for this week. This is not a separate weekly goal.');
      }
    }
  }
  return alerts;
}

function trendInsights_(series) {
  var improved = null;
  var declined = null;
  series.forEach(function (item) {
    var pair = trendPair_(item.points);
    if (!pair) return;
    var delta = pair.latest.value - pair.prior.value;
    if (delta > 0 && (!improved || delta / (Math.abs(pair.prior.value) || 1) > improved.ratio)) improved = { item: item, pair: pair, delta: delta, ratio: delta / (Math.abs(pair.prior.value) || 1) };
    if (delta < 0 && (!declined || delta / (Math.abs(pair.prior.value) || 1) < declined.ratio)) declined = { item: item, pair: pair, delta: delta, ratio: delta / (Math.abs(pair.prior.value) || 1) };
  });
  var attention = null;
  series.forEach(function (item) {
    if (item.goal === null || item.goal === undefined) return;
    var latest = item.points[item.points.length - 1];
    if (!latest || latest.value === null || latest.value >= Number(item.goal) - 1e-9) return;
    var gap = (Number(item.goal) - latest.value) / Number(item.goal);
    if (!attention || gap > attention.gap) attention = { item: item, latest: latest, gap: gap };
  });
  var improvedText = improved
    ? (improved.item.label + ' improved from ' + improved.pair.prior.text + ' (' + improved.pair.prior.display + ') to ' + improved.pair.latest.text + ' (' + improved.pair.latest.display + ').')
    : 'No verified KPI is higher than its prior verified week.';
  var declinedText = declined
    ? (declined.item.label + ' declined from ' + declined.pair.prior.text + ' (' + declined.pair.prior.display + ') to ' + declined.pair.latest.text + ' (' + declined.pair.latest.display + ').')
    : 'No verified KPI is lower than its prior verified week.';
  var attentionText = attention
    ? (attention.item.label + ' needs attention. ' + attention.latest.display + ' is ' + attention.latest.text + ' versus the ' + trendText_(attention.item.unit, attention.item.goal) + ' goal.')
    : 'No latest completed week is both verified and below an approved goal.';
  var focusText = attention
    ? ('Next week, review ' + attention.item.label + '. The latest verified result is ' + attention.latest.text + ' against ' + trendText_(attention.item.unit, attention.item.goal) + '.')
    : 'Next week, obtain the missing daily reports before treating a Pending week as a change in performance.';
  return [
    { key: 'improved', label: 'What improved', text: improvedText },
    { key: 'declined', label: 'What declined', text: declinedText },
    { key: 'attention', label: 'Needs attention', text: attentionText },
    { key: 'focus', label: 'Next week', text: focusText },
  ];
}

function trendSeries_(weeks, facts, view, map, closed, goals) {
  return trendSpecs_(goals).map(function (spec) {
    var points = weeks.map(function (week) { return trendPoint_(week, trendMeasure_(spec, week, facts, view, map, closed), spec.unit, closed); });
    trendMoving_(points, spec.unit);
    var verified = trendVerified_(points).length;
    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      goal: spec.goal === undefined ? null : spec.goal,
      goalText: spec.goal === null || spec.goal === undefined ? '' : trendText_(spec.unit, spec.goal),
      monthGoal: spec.monthGoal === undefined ? null : spec.monthGoal,
      source: spec.source,
      points: points,
      verified: verified,
      comparison: trendCompare_(points, spec.unit),
    };
  });
}

function trend_(payload, today) {
  var weeks = trendWeeks_(today);
  var partialSpan = reportWeekToDate_(today);
  var partialWeek = { start: partialSpan.start, end: partialSpan.end, partial: true };
  var facts = dailyFacts_();
  var closed = closedDates_();
  var view = loadClosingView_();
  var map = {};
  try { map = trendLedger_(ledgerRows_()); } catch (error) { map = {}; }
  var goals = approvedGoals_(config_());
  var series = trendSeries_(weeks, facts, view, map, closed, goals);
  var partial = trendSeries_([partialWeek], facts, view, map, closed, goals);
  var verifiedWritten = 0;
  series.forEach(function (item) { if (item.key === 'written') verifiedWritten = item.verified; });
  var coverage = verifiedWritten + ' of ' + weeks.length + ' completed weeks ' + (verifiedWritten === 1 ? 'has' : 'have') + ' verified NWDSR Written. A week with a missing open day stays Pending. Older months that are not on file are not estimated, and they do not remove the weeks that are on file.';
  var balanceWeek = null;
  var writtenBalance = { nwdsr: 'Pending', snap: 'Pending', current: 'Pending', variance: 'Pending', nwdsrLy: 'Pending', ly: 'Pending', dollars: 'Pending', percent: 'Pending', currentDates: 'Pending', lyDates: 'Pending', note: '' };
  try {
    balanceWeek = String(payload && payload.view || 'completed') === 'partial' ? partialWeek : (weeks.length ? weeks[weeks.length - 1] : null);
    if (balanceWeek) writtenBalance = reportWeekSnapLy_(facts, closed, balanceWeek.start, balanceWeek.end);
  } catch (error) { writtenBalance = writtenBalance; }
  var viewName = String(payload && payload.view || 'completed') === 'partial' ? 'partial' : 'completed';
  var metric = String(payload && payload.metric || 'written');
  var selected = null;
  (viewName === 'partial' ? partial : series).forEach(function (item) { if (item.key === metric) selected = item; });
  if (!selected) selected = (viewName === 'partial' ? partial : series)[0];
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'trend',
    layout: 'trend',
    ready: true,
    title: '13-week store trend',
    view: viewName,
    metric: selected.key,
    date: weeks.length ? weeks[weeks.length - 1].end : today,
    displayDate: weeks.length ? (briefDisplayDate_(weeks[0].start) + ' – ' + briefDisplayDate_(weeks[weeks.length - 1].end)) : '',
    today: today,
    period: weeks.length ? { start: weeks[0].start, end: weeks[weeks.length - 1].end } : { start: '', end: '' },
    partialPeriod: { start: partialWeek.start, end: partialWeek.end, label: 'Partial week to date · ' + briefDisplayDate_(partialWeek.start) + ' – ' + briefDisplayDate_(partialWeek.end) },
    weeksRequested: 13,
    weeksShown: weeks.length,
    coverage: coverage,
    calendarNote: 'Each week uses the business dates on the daily reports. Store Written is NWDSR Written and Store Delivered is NWDSR Delivered. Attachment rates use Group 17 or ASL written daily files. Salesperson calendar months are not combined with these store weeks.',
    mail: false,
    series: series,
    partial: partial,
    selected: selected,
    insights: trendInsights_(series),
    alerts: trendAlerts_(series, weeks, closed),
    writtenBalance: writtenBalance,
    notice: 'Preview, print, or download this one-page summary. No email is sent.',
    verification: '13 completed Monday–Sunday weeks requested. Prepared ' + briefDisplayDate_(today) + '. ' + coverage,
  };
}

function trendPdf_(page) {
  var commands = [];
  var y = 760;
  function paint(r, g, b) { commands.push(r + ' ' + g + ' ' + b + ' rg'); }
  function text(x, yy, size, value, bold) {
    commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td (' + reportPdfEscape_(value) + ') Tj ET');
  }
  commands.push('0.06 0.13 0.16 rg 0 742 612 50 re f');
  commands.push('0.05 0.50 0.53 rg 0 736 612 6 re f');
  paint(1, 1, 1);
  text(36, 766, 8, "KANE'S FURNITURE  ·  STORE 17", true);
  text(36, 750, 13, '13-week store trend', true);
  paint(0.06, 0.13, 0.16);
  text(36, y, 9, reportAscii_(page.view === 'partial' ? page.partialPeriod.label : page.displayDate), true);
  y -= 14;
  reportWrap_(page.verification, 108).slice(0, 3).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  y -= 6;
  text(36, y, 9, 'WEEKLY TREND SUMMARY', true);
  y -= 13;
  (page.insights || []).forEach(function (item) {
    text(36, y, 8, item.label, true);
    y -= 11;
    reportWrap_(item.text, 108).slice(0, 2).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  });
  y -= 4;
  text(36, y, 9, reportAscii_(page.selected.label).toUpperCase(), true);
  y -= 12;
  text(36, y, 8, reportAscii_(page.selected.source), false);
  y -= 12;
  text(36, y, 8, page.selected.comparison && page.selected.comparison.text ? page.selected.comparison.text : '', false);
  y -= 12;
  if (page.writtenBalance) {
    reportBalanceCompact_(page.writtenBalance).slice(0, 2).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  }
  y -= 2;
  (page.selected.points || []).forEach(function (point) {
    if (y < 70 || point.value === null) return;
    text(36, y, 8, point.display, true);
    text(220, y, 8, point.text, false);
    text(320, y, 8, point.movingText ? ('4-week ' + point.movingText) : '', false);
    y -= 11;
  });
  y -= 4;
  text(36, y, 9, 'EARLY WARNINGS', true);
  y -= 12;
  (page.alerts || []).slice(0, 6).forEach(function (item) {
    if (y < 40) return;
    reportWrap_(item, 108).slice(0, 2).forEach(function (line) { text(36, y, 7.5, line, false); y -= 9; });
  });
  text(36, 22, 8, 'Page 1 of 1  ·  No email sent', false);
  return reportPdfBook_([commands]);
}
