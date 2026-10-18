/**
 * Report Center. The Daily Management Summary uses the Morning Start-Up sources
 * and the approved store calculations. It does not send email and it does not
 * rebuild the Morning Start-Up message.
 */

function reportCompleteNumber_(onFile, value) {
  if (!onFile) return { pending: true, value: null };
  if (value === null || value === undefined || value === '') return { pending: false, value: 0 };
  var number = Number(value);
  return isFinite(number) ? { pending: false, value: Math.round(number * 100) / 100 } : { pending: true, value: null };
}

function reportChosenDate_(value, today) {
  var fallback = shiftDate_(today, -1);
  if (!value) return fallback;
  try {
    var date = validDate_(value);
    return date >= today ? fallback : date;
  } catch (error) {
    return fallback;
  }
}

function reportAscii_(value) {
  return String(value == null ? '' : value)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function reportLine_(key, label, result, goal, versus, status, source, bar) {
  return {
    key: key,
    label: label,
    result: result,
    goal: goal || '',
    versus: versus || '',
    status: status,
    source: source || '',
    bar: bar === null || bar === undefined ? null : bar,
  };
}

function reportStatus_(actual, goal) {
  var word = briefStatusWord_(actual, goal);
  if (word === 'Above' || word === 'At goal') return word === 'At goal' ? 'even' : 'hit';
  if (word === 'Below') return 'short';
  return 'pending';
}

function reportVersus_(actual, goal, unit) {
  if (unit === 'percent') return briefKpiDiff_(actual, goal, 'percent');
  if (unit === 'count') return briefKpiDiff_(actual, goal, 'count');
  if (briefBlank_(actual) || briefBlank_(goal)) return 'Pending';
  return briefSignedMoney_(Math.round((Number(actual) - Number(goal)) * 100) / 100);
}

function reportBar_(actual, goal) {
  if (briefBlank_(actual) || briefBlank_(goal) || Number(goal) <= 0) return null;
  var ratio = Number(actual) / Number(goal);
  if (!isFinite(ratio) || ratio < 0) return null;
  return Math.round(Math.min(ratio, 1) * 1000) / 1000;
}

function reportMoneyLine_(key, label, actual, goal, source) {
  var pending = briefBlank_(actual);
  return reportLine_(
    key,
    label,
    pending ? 'Pending' : moneyText_(actual),
    briefBlank_(goal) ? 'Pending' : moneyText_(goal),
    reportVersus_(actual, goal, 'dollars'),
    reportStatus_(actual, goal),
    source,
    reportBar_(actual, goal)
  );
}

function reportFindKpi_(kpis, name) {
  var found = null;
  (kpis || []).forEach(function (row) { if (row.name === name) found = row; });
  return found;
}

function reportKpiLine_(key, label, row, reportDate, sameMonth) {
  if (!sameMonth || !row) {
    return reportLine_(key, label, 'Pending', 'Pending', 'Pending', 'pending', 'Store-month figure is not on file for this report date.', null);
  }
  var through = row.writtenThrough || row.through || '';
  if (through && reportDate && through > reportDate) {
    return reportLine_(key, label, 'Pending', briefKpiCell_(row.goal, row.unit), 'Pending', 'pending', 'Verified through ' + through + ', which is after ' + reportDate + '. Not restated as the ' + reportDate + ' result.', null);
  }
  var number = reportCompleteNumber_(!briefBlank_(row.written), row.written);
  var actual = number.pending ? null : number.value;
  var scope = through ? ('Store month through ' + through + (through < reportDate ? '. Does not include ' + reportDate + '.' : '.')) : 'Store-month through date is Pending.';
  return reportLine_(
    key,
    label,
    number.pending ? 'Pending' : briefKpiCell_(actual, row.unit),
    briefKpiCell_(row.goal, row.unit),
    reportVersus_(actual, row.goal, row.unit === 'dollars' ? 'dollars' : (row.unit === 'count' ? 'count' : 'percent')),
    reportStatus_(actual, row.goal),
    scope.trim(),
    reportBar_(actual, row.goal)
  );
}

function reportFact_(facts, date) {
  var found = null;
  facts.forEach(function (row) { if (row.date === date) found = row; });
  return found;
}

function reportDaily_(payload, today) {
  var date = reportChosenDate_(payload && payload.date, today);
  var home = home_({ session: payload.session });
  var store = storePeriodContaining_(date);
  var individual = individualPeriodContaining_(date);
  var currentStore = storePeriodContaining_(today);
  var sameMonth = store.start === currentStore.start;
  var closed = closedDates_();
  var facts = dailyFacts_();
  var budgets = storeSalesGoals_(config_(), store);
  var row = reportFact_(facts, date);
  var savedGoals = {};
  try { savedGoals = readSavedDailyGoals_(); } catch (error) { savedGoals = {}; }
  var saved = savedGoals[date] || {};
  var daysLeft = operatingDaysRemaining_(store, date, closed);
  var writtenPace = saved.written !== undefined && saved.written !== null ? saved.written : savedPace_(budgets.written, sumBefore_(facts, 'nwdsrWritten', store.start, date), daysLeft);
  var deliveredPace = saved.delivered !== undefined && saved.delivered !== null ? saved.delivered : savedPace_(budgets.delivered, sumBefore_(facts, 'nwdsrDelivered', store.start, date), daysLeft);
  var writtenThrough = latestFactDate_(facts, 'nwdsrWritten', store.start, shiftDate_(date, 1), shiftDate_(date, 1));
  var deliveredThrough = latestFactDate_(facts, 'nwdsrDelivered', store.start, shiftDate_(date, 1), shiftDate_(date, 1));
  var writtenMtd = writtenThrough ? sumField_(facts, 'nwdsrWritten', store.start, writtenThrough) : null;
  var deliveredMtd = deliveredThrough ? sumField_(facts, 'nwdsrDelivered', store.start, deliveredThrough) : null;
  var labels = home.labels || { written: 'NWDSR Net Written', delivered: 'NWDSR Delivered', snap: 'SNAP Written' };
  var writtenOnFile = !!(row && row.nwdsrWritten !== null);
  var deliveredOnFile = !!(row && row.nwdsrDelivered !== null);
  var writtenDay = reportCompleteNumber_(writtenOnFile, row ? row.nwdsrWritten : null);
  var deliveredDay = reportCompleteNumber_(deliveredOnFile, row ? row.nwdsrDelivered : null);
  var dayNote = closed[date] ? ' The store was closed. Nothing was estimated.' : '';
  var lines = [
    reportMoneyLine_('written', 'NWDSR Written', writtenDay.pending ? null : writtenDay.value, writtenPace, (writtenDay.pending ? 'NWDSR Written for ' + date + ' is not on file.' : labels.written + ' · ' + date) + dayNote),
    reportMoneyLine_('delivered', 'NWDSR Delivered', deliveredDay.pending ? null : deliveredDay.value, deliveredPace, (deliveredDay.pending ? 'NWDSR Delivered for ' + date + ' is not on file.' : labels.delivered + ' · ' + date) + dayNote),
    reportLine_('written-pace', 'Written pace', briefBlank_(writtenPace) ? 'Pending' : moneyText_(writtenPace), briefBlank_(budgets.written) ? 'Pending' : moneyText_(budgets.written), briefBlank_(writtenPace) ? 'Pending' : 'Required pace', briefBlank_(writtenPace) ? 'pending' : 'ready', 'Remaining NWDSR written budget ÷ open days left, including ' + date + '.', null),
    reportLine_('delivered-pace', 'Delivered pace', briefBlank_(deliveredPace) ? 'Pending' : moneyText_(deliveredPace), briefBlank_(budgets.delivered) ? 'Pending' : moneyText_(budgets.delivered), briefBlank_(deliveredPace) ? 'Pending' : 'Required pace', briefBlank_(deliveredPace) ? 'pending' : 'ready', 'Remaining NWDSR delivered budget ÷ open days left, including ' + date + '.', null),
    reportMoneyLine_('written-mtd', 'Written MTD', writtenThrough && writtenThrough <= date ? writtenMtd : null, budgets.written, writtenThrough ? ('NWDSR Written ' + store.start + ' through ' + writtenThrough + (writtenThrough < date ? '. ' + date + ' not included.' : '.')) : ('NWDSR Written month to date is Pending.')),
    reportMoneyLine_('delivered-mtd', 'Delivered MTD', deliveredThrough && deliveredThrough <= date ? deliveredMtd : null, budgets.delivered, deliveredThrough ? ('NWDSR Delivered ' + store.start + ' through ' + deliveredThrough + (deliveredThrough < date ? '. ' + date + ' not included.' : '.')) : ('NWDSR Delivered month to date is Pending.')),
  ];
  var view = loadClosingView_();
  var dayClosing = viewDayClosing_(view, date);
  var closingGoal = home.closing ? home.closing.goal : null;
  var customersOnFile = dayClosing.customers !== null;
  var opportunitiesOnFile = dayClosing.opportunities !== null;
  lines.push(reportLine_(
    'customers',
    'Purchasing customers',
    customersOnFile ? String(dayClosing.customers) : 'Pending',
    '',
    customersOnFile ? 'On file' : 'Pending',
    customersOnFile ? 'ready' : 'pending',
    customersOnFile ? ('NWDSR Written purchasing customers for ' + date) : ('NWDSR Written purchasing customers for ' + date + ' are not on file.'),
    null
  ));
  lines.push(reportLine_(
    'opportunities',
    'PERQ opportunities',
    opportunitiesOnFile ? String(dayClosing.opportunities) : 'Pending',
    '',
    opportunitiesOnFile ? 'On file' : 'Pending',
    opportunitiesOnFile ? 'ready' : 'pending',
    opportunitiesOnFile ? ('PERQ Store opportunities for ' + date) : ('PERQ Store opportunities for ' + date + ' are not on file.'),
    null
  ));
  lines.push(reportLine_(
    'closing',
    'Store closing',
    briefBlank_(dayClosing.ratio) ? 'Pending' : percentText_(dayClosing.ratio),
    briefBlank_(closingGoal) ? 'Pending' : percentText_(closingGoal),
    reportVersus_(dayClosing.ratio, closingGoal, 'percent'),
    reportStatus_(dayClosing.ratio, closingGoal),
    briefBlank_(dayClosing.ratio) ? ('Store closing for ' + date + ' is Pending. Not estimated.') : (dayClosing.customers + ' customers ÷ ' + dayClosing.opportunities + ' PERQ opportunities.'),
    reportBar_(dayClosing.ratio, closingGoal)
  ));
  var monthClosing = home.closing && home.closing.mtd ? home.closing.mtd : null;
  var monthThrough = monthClosing && monthClosing.through ? monthClosing.through : '';
  var monthRatio = monthClosing && monthThrough && monthThrough <= date ? monthClosing.ratio : null;
  lines.push(reportLine_(
    'closing-mtd',
    'Closing MTD',
    briefBlank_(monthRatio) ? 'Pending' : percentText_(monthRatio),
    briefBlank_(closingGoal) ? 'Pending' : percentText_(closingGoal),
    reportVersus_(monthRatio, closingGoal, 'percent'),
    reportStatus_(monthRatio, closingGoal),
    monthThrough ? ('Store closing through ' + monthThrough + (monthThrough < date ? '. Later days Pending.' : '.') + (monthClosing.customers !== null ? ' ' + monthClosing.customers + ' / ' + monthClosing.opportunities + '.' : '')) : 'Store closing month to date is Pending.',
    reportBar_(monthRatio, closingGoal)
  ));
  var kpis = sameMonth && home.board ? home.board.kpis : [];
  lines.push(reportKpiLine_('ticket', 'Average ticket', reportFindKpi_(kpis, 'Average Ticket'), date, sameMonth));
  lines.push(reportKpiLine_('bedding', 'Bedding', reportFindKpi_(kpis, 'Bedding'), date, sameMonth));
  var maintenance = reportKpiLine_('maintenance', 'Maintenance attachments', reportFindKpi_(kpis, 'Total Attachment'), date, sameMonth);
  var parts = ['Fabric Maintenance', 'Leather Maintenance', 'Power Upholstery', 'Mattress Protectors'].map(function (name) {
    var item = reportFindKpi_(kpis, name);
    if (!item) return name.replace(' Maintenance', '').replace(' Upholstery', '') + ' Pending';
    var piece = reportKpiLine_(name, name, item, date, sameMonth);
    var shortName = name === 'Mattress Protectors' ? 'Pads' : name.replace(' Maintenance', '').replace(' Upholstery', '');
    return shortName + ' ' + piece.result;
  });
  maintenance.source = (maintenance.source ? maintenance.source + ' ' : '') + parts.join(' · ') + '.';
  lines.push(maintenance);
  lines.push(reportKpiLine_('rugs', 'Rugs', reportFindKpi_(kpis, 'Rugs'), date, sameMonth));

  var winners = home.winners || { status: 'pending', reason: 'PERQ Report Pending', people: [], date: date };
  if (date !== priorBusinessDay_(today)) {
    try {
      winners = salesWinnersPack_(today, null, date).winners;
    } catch (error) {
      winners = { status: 'pending', reason: 'Sales winners for ' + date + ' could not be read.', people: [], date: date, snapReported: false };
    }
  }
  var first = briefPlace_(winners, 1);
  var second = briefPlace_(winners, 2);
  var third = briefPlace_(winners, 3);
  var quiet = briefNoWritten_(winners);
  var winnerBlock = {
    status: first.text === 'Pending' ? 'pending' : 'ready',
    text: first.text === 'Pending' ? 'Pending' : ('1st ' + first.text + ' · 2nd ' + second.text + ' · 3rd ' + third.text),
    quiet: quiet.text,
    source: first.source || (winners.reason || ''),
    date: winners.date || date,
  };

  var missing = [];
  lines.forEach(function (line) {
    if (line.status !== 'pending') return;
    if (line.key === 'written' || line.key === 'delivered' || line.key === 'customers' || line.key === 'opportunities' || line.key === 'closing') missing.push(line.label + ' for ' + date);
  });
  if (winnerBlock.status === 'pending') missing.push('Sales winners for ' + (winnerBlock.date || date));
  var priorities = reportPriorities_(date, today, home, lines, missing, winnerBlock);
  var sources = reportSources_(date, lines, winnerBlock, labels);
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'daily',
    ready: true,
    title: 'Daily Management Summary',
    date: date,
    displayDate: briefDisplayDate_(date),
    today: today,
    closed: !!closed[date],
    storePeriod: store.start + ' through ' + store.end,
    individualPeriod: individual.start + ' through ' + individual.end,
    calendarNote: 'Store month runs the 2nd through the 1st and uses NWDSR Written and Delivered. The salesperson month runs the 1st through the last calendar day and uses SNAP Written.',
    mail: false,
    verification: reportVerification_(date, today, store, individual, sources),
    sources: sources,
    lines: lines,
    winners: winnerBlock,
    priorities: priorities.items,
    prioritySource: priorities.source,
    notice: 'Preview, print, or download this page. No email is sent.',
  };
}

function reportPriorities_(date, today, home, lines, missing, winners) {
  var meeting = shiftDate_(date, 1);
  var plan = { saved: false, actions: [] };
  try { plan = briefPlanRow_(meeting); } catch (error) { plan = { saved: false, actions: [] }; }
  if (plan.saved) return { items: plan.actions.slice(0, 3), source: 'Saved morning plan for ' + meeting + '. Not emailed.' };
  if (date === home.yesterday.date) {
    var startupMissing = [];
    try { startupMissing = briefStartupMissing_(home, home.winners); } catch (error) { startupMissing = missing; }
    return { items: briefDefaultPriorities_(home, startupMissing).slice(0, 3), source: 'Same three priorities as the Morning Start-Up. Not emailed.' };
  }
  var items = [];
  if (missing.length) items.push('Obtain the missing verified reports: ' + missing.slice(0, 4).join('; ') + '.');
  var written = null;
  var delivered = null;
  var closing = null;
  lines.forEach(function (line) {
    if (line.key === 'written') written = line;
    if (line.key === 'delivered') delivered = line;
    if (line.key === 'closing') closing = line;
  });
  if (written && written.status === 'short') items.push('Recover the written shortfall of ' + written.versus.replace(/^-/, '') + ' against the saved daily goal.');
  if (delivered && delivered.status === 'short') items.push('Recover the delivered shortfall of ' + delivered.versus.replace(/^-/, '') + ' against the saved daily goal.');
  if (closing && closing.status === 'short') items.push('Coach the floor on closing: ' + closing.result + ' against a ' + closing.goal + ' goal.');
  if (winners && winners.status === 'pending' && items.length < 3) items.push('Confirm yesterday\'s sales winners once PERQ and SNAP for ' + (winners.date || date) + ' are both on file.');
  return { items: items.slice(0, 3), source: 'Built from verified gaps for ' + date + '. Not emailed.' };
}

function reportSources_(date, lines, winners, labels) {
  var sources = [];
  lines.forEach(function (line) {
    sources.push({ name: line.label, state: line.status === 'pending' ? 'Pending' : 'Verified', detail: line.source });
  });
  sources.push({
    name: 'Sales winners',
    state: winners.status === 'pending' ? 'Pending' : 'Verified',
    detail: (winners.source || 'PERQ and SNAP') + ' · ' + (winners.date || date),
  });
  sources.push({ name: labels.written || 'NWDSR Written', state: 'Named', detail: 'Store written standard. Not used as Delivered.' });
  sources.push({ name: labels.delivered || 'NWDSR Delivered', state: 'Named', detail: 'Store delivered standard. Written is not counted as Delivered.' });
  return sources;
}

function reportVerification_(date, today, store, individual, sources) {
  var pending = sources.filter(function (item) { return item.state === 'Pending'; }).map(function (item) { return item.name; });
  return 'Report date ' + briefDisplayDate_(date) + ' · prepared ' + briefDisplayDate_(today) + ' · America/New_York. Store month ' +
    store.start + ' through ' + store.end + ' (NWDSR Written and Delivered). Salesperson month ' +
    individual.start + ' through ' + individual.end + ' (SNAP Written). ' +
    (pending.length ? ('Pending: ' + pending.join(', ') + '.') : 'Every line on this page has a verified figure.');
}

function reportCatalog_(today) {
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  return {
    kinds: [
      { key: 'daily', label: 'Daily', ready: true },
      { key: 'weekly', label: 'Weekly', ready: true },
      { key: 'monthly', label: 'Monthly', ready: false },
      { key: 'individual', label: 'Individual', ready: false },
    ],
    storePeriod: store.start + ' through ' + store.end,
    individualPeriod: individual.start + ' through ' + individual.end,
    calendarNote: 'Store month runs the 2nd through the 1st and uses NWDSR Written and Delivered. The salesperson month runs the 1st through the last calendar day and uses SNAP Written.',
  };
}

function reportUnbuilt_(payload, today, kind) {
  var catalog = reportCatalog_(today);
  var start = '';
  var end = '';
  try { start = payload && payload.start ? validDate_(payload.start) : ''; } catch (error) { start = ''; }
  try { end = payload && payload.end ? validDate_(payload.end) : ''; } catch (error) { end = ''; }
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: kind,
    ready: false,
    title: kind === 'weekly' ? 'Weekly report' : (kind === 'monthly' ? 'Monthly report' : 'Individual report'),
    date: '',
    displayDate: '',
    today: today,
    period: { start: start, end: end },
    storePeriod: catalog.storePeriod,
    individualPeriod: catalog.individualPeriod,
    calendarNote: catalog.calendarNote,
    mail: false,
    verification: 'This report is not built yet. No figures are shown and nothing was estimated.',
    sources: [],
    lines: [],
    winners: { status: 'pending', text: 'Pending', quiet: '', source: '', date: '' },
    priorities: [],
    prioritySource: '',
    notice: 'The ' + kind + ' report is not built yet. No figures are shown.',
    pdf: '',
    catalog: catalog,
  };
}

function reportWeekday_(iso) {
  var parts = String(iso || '').split('-');
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return date.getUTCDay();
}

/** The Monday–Sunday week that ended before today. Sunday itself is not a completed week. */
function reportLastCompletedWeek_(today) {
  var weekday = reportWeekday_(today);
  var backToSunday = weekday === 0 ? 7 : weekday;
  var sunday = shiftDate_(today, -backToSunday);
  return { start: shiftDate_(sunday, -6), end: sunday, partial: false, span: 'completed' };
}

function reportCompletedWeek_(today, anchor) {
  var last = reportLastCompletedWeek_(today);
  if (!anchor) return last;
  var day = '';
  try { day = validDate_(anchor); } catch (error) { return last; }
  if (!day || day >= today) return last;
  var weekday = reportWeekday_(day);
  var monday = shiftDate_(day, weekday === 0 ? -6 : 1 - weekday);
  var sunday = shiftDate_(monday, 6);
  if (sunday >= today) return last;
  return { start: monday, end: sunday, partial: false, span: 'completed' };
}

function reportWeekToDate_(today) {
  var yesterday = shiftDate_(today, -1);
  var weekday = reportWeekday_(today);
  var monday = shiftDate_(today, weekday === 0 ? -6 : 1 - weekday);
  return { start: monday, end: yesterday < monday ? monday : yesterday, partial: true, span: 'week-to-date', open: yesterday >= monday };
}

function reportCustomRange_(payload, today) {
  var yesterday = shiftDate_(today, -1);
  var last = reportLastCompletedWeek_(today);
  var start = '';
  var end = '';
  try { start = payload && payload.start ? validDate_(payload.start) : ''; } catch (error) { start = ''; }
  try { end = payload && payload.end ? validDate_(payload.end) : ''; } catch (error) { end = ''; }
  if (!start) start = last.start;
  if (!end) end = last.end;
  if (start > end) { var swap = start; start = end; end = swap; }
  if (end >= today) end = yesterday;
  if (start >= today) start = yesterday;
  if (start > end) start = end;
  var full = reportWeekday_(start) === 1 && reportWeekday_(end) === 0 && end === shiftDate_(start, 6);
  return { start: start, end: end, partial: !full, span: 'custom', open: true };
}

function reportSpan_(payload, today) {
  var span = String(payload && payload.span || 'completed');
  if (span === 'week-to-date') return reportWeekToDate_(today);
  if (span === 'custom') return reportCustomRange_(payload, today);
  return reportCompletedWeek_(today, payload && (payload.end || payload.start || payload.date));
}

function reportRangeField_(facts, field, start, end, closed) {
  var missing = [];
  var total = 0;
  var seen = false;
  eachDate_(start, end).forEach(function (date) {
    if (closed[date]) return;
    var row = reportFact_(facts, date);
    var value = row ? row[field] : null;
    if (value === null || value === undefined) { missing.push(date); return; }
    seen = true;
    total += Number(value);
  });
  if (missing.length || !seen) return { pending: true, value: null, missing: missing };
  return { pending: false, value: Math.round(total * 100) / 100, missing: [] };
}

function reportRangeClosing_(view, start, end, closed) {
  var customers = 0;
  var opportunities = 0;
  var missingCustomers = [];
  var missingOpportunities = [];
  var seen = false;
  eachDate_(start, end).forEach(function (date) {
    if (closed[date]) return;
    seen = true;
    var day = viewDayClosing_(view, date);
    if (day.customers === null) missingCustomers.push(date);
    else customers += Number(day.customers);
    if (day.opportunities === null) missingOpportunities.push(date);
    else opportunities += Number(day.opportunities);
  });
  return {
    customers: !seen || missingCustomers.length ? null : Math.round(customers * 100) / 100,
    opportunities: !seen || missingOpportunities.length ? null : Math.round(opportunities * 100) / 100,
    missingCustomers: missingCustomers,
    missingOpportunities: missingOpportunities,
  };
}

function reportDateList_(dates) {
  if (!dates.length) return '';
  if (dates.length <= 3) return dates.join(', ');
  return dates.slice(0, 3).join(', ') + ' and ' + (dates.length - 3) + ' more';
}

function reportWeekly_(payload, today) {
  var span = reportSpan_(payload, today);
  var start = span.start;
  var end = span.end;
  var home = home_({ session: payload.session });
  var facts = dailyFacts_();
  var closed = closedDates_();
  var store = storePeriodContaining_(end);
  var individual = individualPeriodContaining_(end);
  var currentStore = storePeriodContaining_(today);
  var sameMonth = store.start === currentStore.start;
  var labels = home.labels || { written: 'NWDSR Net Written', delivered: 'NWDSR Delivered' };
  var written = reportRangeField_(facts, 'nwdsrWritten', start, end, closed);
  var delivered = reportRangeField_(facts, 'nwdsrDelivered', start, end, closed);
  var view = loadClosingView_();
  var closing = reportRangeClosing_(view, start, end, closed);
  var closingGoal = home.closing ? home.closing.goal : null;
  var ratio = closing.customers !== null && closing.opportunities ? Math.round((closing.customers / closing.opportunities) * 1000) / 1000 : null;
  var weekly = [
    reportLine_('week-written', 'Written', written.pending ? 'Pending' : moneyText_(written.value), '', written.pending ? 'Pending' : 'On file', written.pending ? 'pending' : 'ready', written.pending ? ('NWDSR Written missing for ' + reportDateList_(written.missing) + '. Not counted as zero.') : (labels.written + ' · ' + start + ' through ' + end), null),
    reportLine_('week-delivered', 'Delivered', delivered.pending ? 'Pending' : moneyText_(delivered.value), '', delivered.pending ? 'Pending' : 'On file', delivered.pending ? 'pending' : 'ready', delivered.pending ? ('NWDSR Delivered missing for ' + reportDateList_(delivered.missing) + '. Not counted as zero.') : (labels.delivered + ' · ' + start + ' through ' + end), null),
    reportLine_('week-customers', 'Purchasing customers', closing.customers === null ? 'Pending' : String(closing.customers), '', closing.customers === null ? 'Pending' : 'On file', closing.customers === null ? 'pending' : 'ready', closing.customers === null ? ('Purchasing customers missing for ' + reportDateList_(closing.missingCustomers) + '.') : ('NWDSR Written purchasing customers · ' + start + ' through ' + end), null),
    reportLine_('week-opportunities', 'PERQ opportunities', closing.opportunities === null ? 'Pending' : String(closing.opportunities), '', closing.opportunities === null ? 'Pending' : 'On file', closing.opportunities === null ? 'pending' : 'ready', closing.opportunities === null ? ('PERQ missing for ' + reportDateList_(closing.missingOpportunities) + '.') : ('PERQ Store opportunities · ' + start + ' through ' + end), null),
    reportLine_('week-closing', 'Store closing', ratio === null ? 'Pending' : percentText_(ratio), briefBlank_(closingGoal) ? '' : percentText_(closingGoal), reportVersus_(ratio, closingGoal, 'percent'), reportStatus_(ratio, closingGoal), ratio === null ? 'Store closing needs purchasing customers and PERQ for every open day in this period.' : (closing.customers + ' customers ÷ ' + closing.opportunities + ' opportunities.'), reportBar_(ratio, closingGoal)),
    reportLine_('week-ticket', 'Average ticket', 'Pending', '', 'Pending', 'pending', 'A weekly average ticket is not on a verified file. The store-month ticket is with the KPIs.', null),
  ];
  weekly.forEach(function (line) { line.scope = 'week'; });

  var writtenThrough = latestFactDate_(facts, 'nwdsrWritten', store.start, shiftDate_(end, 1), shiftDate_(end, 1));
  var deliveredThrough = latestFactDate_(facts, 'nwdsrDelivered', store.start, shiftDate_(end, 1), shiftDate_(end, 1));
  if (writtenThrough && writtenThrough > end) writtenThrough = end;
  if (deliveredThrough && deliveredThrough > end) deliveredThrough = end;
  var budgets = storeSalesGoals_(config_(), store);
  var writtenMtd = writtenThrough ? sumField_(facts, 'nwdsrWritten', store.start, writtenThrough) : null;
  var deliveredMtd = deliveredThrough ? sumField_(facts, 'nwdsrDelivered', store.start, deliveredThrough) : null;
  var writtenPace = pace_(budgets.written, writtenMtd, writtenThrough ? operatingDaysRemaining_(store, shiftDate_(writtenThrough, 1), closed) : null);
  var deliveredPace = pace_(budgets.delivered, deliveredMtd, deliveredThrough ? operatingDaysRemaining_(store, shiftDate_(deliveredThrough, 1), closed) : null);
  var projectedDays = storeCalendar_(facts, store, closed).map(function (day) {
    if (day.date <= end) return day;
    return { date: day.date, nwdsrWritten: null, nwdsrDelivered: null, snapWritten: null, closed: day.closed };
  });
  var writtenProjection = verifiedRunRate_(projectedDays, 'nwdsrWritten', closed);
  var deliveredProjection = verifiedRunRate_(projectedDays, 'nwdsrDelivered', closed);
  var month = [
    reportMoneyLine_('mtd-written', 'Written MTD', writtenMtd, budgets.written, 'Store month ' + store.start + ' through ' + (writtenThrough || 'Pending') + '. Not the week total.'),
    reportMoneyLine_('mtd-delivered', 'Delivered MTD', deliveredMtd, budgets.delivered, 'Store month ' + store.start + ' through ' + (deliveredThrough || 'Pending') + '. Not the week total.'),
    reportLine_('mtd-written-pct', 'Written goal', briefBlank_(writtenMtd) || briefBlank_(budgets.written) ? 'Pending' : percentText_(writtenMtd / budgets.written), '100%', reportVersus_(writtenMtd, budgets.written, 'dollars'), reportStatus_(writtenMtd, budgets.written), 'Written actual ÷ the store-month written budget.', reportBar_(writtenMtd, budgets.written)),
    reportLine_('mtd-delivered-pct', 'Delivered goal', briefBlank_(deliveredMtd) || briefBlank_(budgets.delivered) ? 'Pending' : percentText_(deliveredMtd / budgets.delivered), '100%', reportVersus_(deliveredMtd, budgets.delivered, 'dollars'), reportStatus_(deliveredMtd, budgets.delivered), 'Delivered actual ÷ the store-month delivered budget.', reportBar_(deliveredMtd, budgets.delivered)),
    reportLine_('mtd-written-left', 'Written remaining', writtenPace.remaining === null ? 'Pending' : moneyText_(writtenPace.remaining), '', writtenPace.pace === null ? 'Pending' : ('Pace ' + moneyText_(writtenPace.pace)), writtenPace.remaining === null ? 'pending' : 'ready', 'Budget minus written MTD. Pace is the remainder ÷ open store days after ' + (writtenThrough || 'the verified day') + '.', null),
    reportLine_('mtd-delivered-left', 'Delivered remaining', deliveredPace.remaining === null ? 'Pending' : moneyText_(deliveredPace.remaining), '', deliveredPace.pace === null ? 'Pending' : ('Pace ' + moneyText_(deliveredPace.pace)), deliveredPace.remaining === null ? 'pending' : 'ready', 'Budget minus delivered MTD. Pace is the remainder ÷ open store days after ' + (deliveredThrough || 'the verified day') + '.', null),
    reportMoneyLine_('mtd-written-projection', 'Written projection', writtenProjection, budgets.written, 'Projection. Verified daily run rate × open store days. Days after ' + end + ' are not in the average. Missing days are not zero.'),
    reportMoneyLine_('mtd-delivered-projection', 'Delivered projection', deliveredProjection, budgets.delivered, 'Projection. Verified daily run rate × open store days. Days after ' + end + ' are not in the average. Missing days are not zero.'),
  ];
  month.forEach(function (line) { line.scope = 'store-month'; });

  var kpis = sameMonth && home.board ? home.board.kpis : [];
  var kpiSpecs = [
    ['bedding', 'Bedding', 'Bedding'],
    ['fabric', 'Fabric', 'Fabric Maintenance'],
    ['leather', 'Leather', 'Leather Maintenance'],
    ['power', 'Power', 'Power Upholstery'],
    ['pads', 'Pads', 'Mattress Protectors'],
    ['rugs', 'Rugs', 'Rugs'],
    ['ticket', 'Avg ticket', 'Average Ticket'],
    ['pillows', 'Pillows', 'Pillows'],
  ];
  var kpiLines = kpiSpecs.map(function (spec) {
    var row = sameMonth ? reportFindKpi_(kpis, spec[2]) : null;
    if (!row || briefBlank_(row.written)) {
      var pending = reportLine_(spec[0], spec[1], 'Pending', row ? briefKpiCell_(row.goal, row.unit) : '', 'Pending', 'pending', sameMonth ? 'Store-month figure is not on file.' : 'This week is outside the current store month. Current KPIs are not restated here.', null);
      pending.scope = 'store-month';
      return pending;
    }
    var through = row.writtenThrough || row.through || '';
    var line = reportLine_(spec[0], spec[1], briefKpiCell_(row.written, row.unit), briefKpiCell_(row.goal, row.unit), reportVersus_(row.written, row.goal, row.unit === 'dollars' ? 'dollars' : (row.unit === 'count' ? 'count' : 'percent')), reportStatus_(row.written, row.goal), 'Store month through ' + (through || 'Pending') + '. Not this week.', reportBar_(row.written, row.goal));
    line.scope = 'store-month';
    return line;
  });

  var snap = reportRangeField_(facts, 'snapWritten', start, end, closed);
  var top = [];
  if (!snap.pending) {
    var totals = {};
    var snapLines = snapAssociateLines_(start, end);
    snapLines.order.forEach(function (key) {
      var line = snapLines.byDay[key];
      if (!line || line.role === 'management' || line.role === 'former') return;
      totals[line.name] = (totals[line.name] || 0) + line.amount;
    });
    Object.keys(totals).forEach(function (name) {
      if (totals[name] > 0) top.push({ name: name, written: Math.round(totals[name] * 100) / 100 });
    });
    top.sort(function (a, b) { return b.written - a.written || (a.name < b.name ? -1 : 1); });
    top = top.slice(0, 3);
  }
  var coaching = [];
  var wins = [];
  try {
    peopleRows_(individual.start, individual.end).forEach(function (person) {
      var gaps = briefPersonShortfalls_(person);
      var weight = gaps.length;
      if (!briefBlank_(person.closingRatio) && person.closing && !briefBlank_(person.closing.goal)) weight += Math.max(0, Number(person.closing.goal) - Number(person.closingRatio)) * 10;
      if (gaps.length) coaching.push({ name: person.name, text: gaps[0], weight: weight });
      if (!briefBlank_(person.monthlyGoal) && !briefBlank_(person.snapWritten) && Number(person.snapWritten) >= Number(person.monthlyGoal)) {
        wins.push(person.name + ' is at the salesperson-month SNAP goal.');
      }
    });
  } catch (error) { coaching = []; }
  coaching.sort(function (a, b) { return b.weight - a.weight; });
  coaching = coaching.slice(0, 2);
  var hires = [];
  try {
    sheet_('CC_People').forEach(function (row) {
      if (typeof rosterRole_ === 'function' && rosterRole_(row, end) !== 'associate') return;
      var hire = briefHire_(String(row.name || ''), end);
      if (hire.newHire) hires.push(String(row.name) + (hire.days !== null ? ' · day ' + hire.days + ' of 90' : ''));
    });
  } catch (error) { hires = []; }

  kpiLines.forEach(function (line) {
    if (line.status === 'hit' || line.status === 'even') wins.push(line.label + ' is at the store-month goal (' + line.result + ').');
  });
  var attention = [];
  if (written.pending) attention.push('NWDSR Written is missing for ' + reportDateList_(written.missing) + '.');
  if (delivered.pending) attention.push('NWDSR Delivered is missing for ' + reportDateList_(delivered.missing) + '.');
  if (closing.opportunities === null) attention.push('PERQ is missing, so the week closing ratio stays Pending.');
  kpiLines.forEach(function (line) {
    if (line.status === 'short') attention.push(line.label + ' is ' + line.result + ' versus ' + line.goal + ' for the store month.');
  });
  var priorities = [];
  if (written.pending || delivered.pending || closing.opportunities === null) priorities.push('Obtain the missing verified reports before treating this week as complete.');
  if (coaching.length) priorities.push('Coach ' + coaching[0].name + ' on ' + coaching[0].text + '.');
  if (writtenPace.pace !== null) priorities.push('Hold the required written pace of ' + moneyText_(writtenPace.pace) + ' on the remaining open store days.');
  var lastYear = { written: 'Pending', delivered: 'Pending', note: 'Last year is Pending. No verified last-year week is on file.' };
  try {
    var ly = briefLastYearStore_(config_(), store);
    if (ly && ly.confirmed && ly.written && !briefBlank_(ly.written.value)) lastYear.written = moneyText_(ly.written.value);
    if (ly && ly.confirmed && ly.delivered && !briefBlank_(ly.delivered.value)) lastYear.delivered = moneyText_(ly.delivered.value);
    if (lastYear.written === 'Pending' && lastYear.delivered === 'Pending') lastYear.note = 'Last year is Pending. ' + ((ly && ly.written && ly.written.basis) || 'No verified last-year figure was invented.');
  } catch (error) { lastYear.note = 'Last year is Pending. No verified last-year figure was invented.'; }

  var partialLabel = span.partial ? (span.span === 'week-to-date' ? 'Partial · week to date' : 'Partial · custom range') : 'Completed week';
  var verification = partialLabel + ' · ' + briefDisplayDate_(start) + ' through ' + briefDisplayDate_(end) + ' · prepared ' + briefDisplayDate_(today) +
    '. Store month ' + store.start + ' through ' + store.end + ' (NWDSR). Salesperson month ' + individual.start + ' through ' + individual.end +
    ' (SNAP). Weekly totals are only the days in this period. ' + lastYear.note;
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'weekly',
    layout: 'weekly',
    ready: true,
    title: 'Weekly Executive Report',
    span: span.span,
    partial: !!span.partial,
    partialLabel: partialLabel,
    date: end,
    displayDate: briefDisplayDate_(start) + ' – ' + briefDisplayDate_(end),
    today: today,
    period: { start: start, end: end },
    storePeriod: store.start + ' through ' + store.end,
    individualPeriod: individual.start + ' through ' + individual.end,
    calendarNote: 'Weekly figures use only this period. Store month is the 2nd through the 1st (NWDSR). Salesperson month is the 1st through the last calendar day (SNAP).',
    mail: false,
    verification: verification,
    lastYear: lastYear,
    weekly: weekly,
    month: month,
    kpis: kpiLines,
    lines: weekly.concat(month).concat(kpiLines),
    people: {
      pending: snap.pending,
      source: snap.pending ? ('SNAP Written missing for ' + reportDateList_(snap.missing) + '. Rankings stay Pending.') : ('SNAP Written · ' + start + ' through ' + end + '. Not NWDSR.'),
      top: top,
      coaching: coaching,
      coachingSource: 'Salesperson month ' + individual.start + ' through ' + individual.end + '. Not the week total.',
      hires: hires.slice(0, 3),
    },
    summary: {
      wins: wins.slice(0, 3),
      attention: attention.slice(0, 3),
      priorities: priorities.slice(0, 3),
    },
    winners: { status: 'pending', text: '', quiet: '', source: '', date: '' },
    priorities: priorities.slice(0, 3),
    prioritySource: 'Recommended from verified gaps. Not emailed.',
    notice: 'Preview, print, or download this page. No email is sent.',
  };
}

function reportCenter_(payload) {
  var today = todayNy_();
  var kind = String(payload && payload.kind || 'daily');
  if (kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly' && kind !== 'individual') kind = 'daily';
  var page = kind === 'daily' ? reportDaily_(payload, today) : (kind === 'weekly' ? reportWeekly_(payload, today) : reportUnbuilt_(payload, today, kind));
  page.catalog = reportCatalog_(today);
  page.pdf = page.ready ? (page.layout === 'weekly' ? reportWeeklyPdf_(page) : reportPdf_(page)) : '';
  return page;
}

function reportWrap_(text, width) {
  var words = reportAscii_(text).split(' ');
  var lines = [];
  var current = '';
  words.forEach(function (word) {
    if (!word) return;
    var next = current ? current + ' ' + word : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else current = next;
  });
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function reportPdfEscape_(text) {
  return reportAscii_(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function reportPdf_(page) {
  var commands = [];
  function paint(r, g, b) { commands.push(r + ' ' + g + ' ' + b + ' rg'); }
  function text(x, y, size, value, bold) {
    commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + reportPdfEscape_(value) + ') Tj ET');
  }
  commands.push('0.06 0.13 0.16 rg 0 742 612 50 re f');
  commands.push('0.05 0.50 0.53 rg 0 736 612 6 re f');
  paint(1, 1, 1);
  text(36, 762, 9, "KANE'S FURNITURE  ·  STORE 17", true);
  text(36, 748, 14, 'Daily Management Summary', true);
  paint(0.06, 0.13, 0.16);
  text(36, 716, 11, reportAscii_(page.displayDate) + '   ·   prepared ' + reportAscii_(briefDisplayDate_(page.today)), true);
  var verify = reportWrap_(page.verification, 108);
  var y = 700;
  verify.slice(0, 3).forEach(function (line) {
    text(36, y, 9, line, false);
    y -= 12;
  });
  y -= 6;
  paint(0.05, 0.50, 0.53);
  text(36, y, 8, 'MEASURE', true);
  text(190, y, 8, 'RESULT', true);
  text(280, y, 8, 'GOAL', true);
  text(370, y, 8, 'VERSUS GOAL', true);
  text(470, y, 8, '', true);
  y -= 4;
  commands.push('0.75 0.8 0.82 RG 36 ' + y.toFixed(1) + ' m 576 ' + y.toFixed(1) + ' l S');
  y -= 14;
  (page.lines || []).forEach(function (line) {
    if (y < 150) return;
    paint(0.06, 0.13, 0.16);
    text(36, y, 9, line.label, true);
    text(190, y, 9, line.result, line.status !== 'pending');
    text(280, y, 9, line.goal, false);
    if (line.status === 'hit' || line.status === 'even') paint(0.04, 0.42, 0.23);
    else if (line.status === 'short') paint(0.61, 0.11, 0.20);
    else if (line.status === 'pending') paint(0.45, 0.32, 0.05);
    else paint(0.06, 0.13, 0.16);
    text(370, y, 9, line.status === 'ready' ? line.versus : (line.status === 'hit' ? 'Hit  ' + line.versus : (line.status === 'short' ? 'Short  ' + line.versus : (line.status === 'even' ? 'At goal  ' + line.versus : 'Pending'))), true);
    if (line.bar !== null && line.bar !== undefined) {
      commands.push('0.85 0.88 0.90 rg 500 ' + (y + 1).toFixed(1) + ' 76 5 re f');
      if (line.status === 'short') commands.push('0.61 0.11 0.20 rg');
      else commands.push('0.04 0.42 0.23 rg');
      commands.push('500 ' + (y + 1).toFixed(1) + ' ' + Math.max(2, line.bar * 76).toFixed(1) + ' 5 re f');
    }
    y -= 13;
  });
  y -= 8;
  paint(0.05, 0.50, 0.53);
  text(36, y, 10, 'Sales winners  ·  ' + reportAscii_(page.winners && page.winners.date), true);
  y -= 13;
  paint(0.06, 0.13, 0.16);
  reportWrap_(page.winners && page.winners.status === 'pending' ? 'Pending. ' + (page.winners.source || '') : page.winners.text, 108).slice(0, 2).forEach(function (line) {
    text(36, y, 9, line, false);
    y -= 12;
  });
  if (page.winners && page.winners.quiet && page.winners.quiet !== 'Pending') {
    reportWrap_('No written sale: ' + page.winners.quiet, 108).slice(0, 1).forEach(function (line) {
      text(36, y, 9, line, false);
      y -= 12;
    });
  }
  y -= 6;
  paint(0.05, 0.50, 0.53);
  text(36, y, 10, 'Management priorities', true);
  y -= 13;
  paint(0.06, 0.13, 0.16);
  var priorities = page.priorities && page.priorities.length ? page.priorities : ['No additional priority is supported by verified data.'];
  priorities.slice(0, 3).forEach(function (item, index) {
    reportWrap_((index + 1) + '. ' + item, 108).slice(0, 2).forEach(function (line) {
      if (y < 48) return;
      text(36, y, 9, line, false);
      y -= 12;
    });
  });
  paint(0.25, 0.32, 0.36);
  text(36, 36, 8, reportAscii_(page.calendarNote).slice(0, 140), false);
  text(36, 26, 8, 'No email sent. Written is not Delivered. A missing report stays Pending.', false);
  return reportPdfFinish_(commands);
}

function reportTone_(status) {
  if (status === 'hit' || status === 'even') return [0.04, 0.42, 0.23];
  if (status === 'short') return [0.61, 0.11, 0.20];
  if (status === 'pending') return [0.45, 0.32, 0.05];
  return [0.06, 0.13, 0.16];
}

function reportWeeklyPdf_(page) {
  var commands = [];
  function paint(r, g, b) { commands.push(r + ' ' + g + ' ' + b + ' rg'); }
  function text(x, y, size, value, bold) {
    commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + reportPdfEscape_(value) + ') Tj ET');
  }
  commands.push('0.06 0.13 0.16 rg 0 748 612 44 re f');
  commands.push('0.05 0.50 0.53 rg 0 742 612 6 re f');
  paint(1, 1, 1);
  text(36, 768, 8, "KANE'S FURNITURE  ·  STORE 17  ·  EXECUTIVE", true);
  text(36, 754, 13, 'Weekly Executive Report', true);
  paint(0.06, 0.13, 0.16);
  text(36, 726, 10, reportAscii_(page.partialLabel) + '  ·  ' + reportAscii_(page.displayDate), true);
  var y = 712;
  reportWrap_(page.verification, 112).slice(0, 2).forEach(function (line) {
    text(36, y, 8, line, false);
    y -= 10;
  });
  y -= 4;
  function band(title, rows) {
    paint(0.05, 0.50, 0.53);
    text(36, y, 9, title, true);
    y -= 12;
    rows.forEach(function (line) {
      if (y < 86) return;
      paint(0.06, 0.13, 0.16);
      text(36, y, 8, line.label, true);
      var tone = reportTone_(line.status);
      paint(tone[0], tone[1], tone[2]);
      text(150, y, 8, line.result + (line.goal ? '  /  ' + line.goal : '') + (line.versus && line.versus !== 'On file' && line.versus !== 'Pending' ? '  ' + line.versus : ''), true);
      y -= 10;
    });
    y -= 4;
  }
  band('WEEK', page.weekly || []);
  band('STORE MONTH', page.month || []);
  band('STORE-MONTH KPIs', page.kpis || []);
  paint(0.05, 0.50, 0.53);
  text(36, y, 9, 'PEOPLE', true);
  y -= 11;
  paint(0.06, 0.13, 0.16);
  var people = page.people || {};
  var topText = people.pending ? 'Top associates Pending. ' + (people.source || '') : ((people.top || []).map(function (person, index) { return (index + 1) + '. ' + person.name + ' ' + moneyText_(person.written); }).join('   ') || 'No SNAP Written in this period.');
  reportWrap_(topText, 112).slice(0, 2).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  var coach = (people.coaching || []).map(function (item) { return item.name + ': ' + item.text; }).join(' · ') || 'No verified coaching gap.';
  reportWrap_('Coach: ' + coach, 112).slice(0, 1).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  text(36, y, 8, 'New hires: ' + ((people.hires && people.hires.length) ? people.hires.join('; ') : 'None in the 90-day window.'), false);
  y -= 12;
  var summary = page.summary || {};
  function column(x, title, items) {
    paint(0.05, 0.50, 0.53);
    text(x, y, 8, title, true);
    var row = y - 11;
    paint(0.06, 0.13, 0.16);
    (items && items.length ? items : ['None verified.']).slice(0, 3).forEach(function (item, index) {
      reportWrap_((index + 1) + '. ' + item, 36).slice(0, 2).forEach(function (line) {
        text(x, row, 7.5, line, false);
        row -= 9;
      });
    });
  }
  var columns = y;
  column(36, 'WINS', summary.wins);
  column(230, 'ATTENTION', summary.attention);
  column(420, 'NEXT WEEK', summary.priorities);
  y = columns - 62;
  paint(0.25, 0.32, 0.36);
  text(36, 28, 7.5, reportAscii_(page.calendarNote).slice(0, 150), false);
  text(36, 18, 7.5, 'No email sent. Last year stays Pending until verified. Written is not Delivered.', false);
  return reportPdfFinish_(commands);
}

function reportPdfFinish_(commands) {
  var stream = commands.join('\n');
  var objects = [];
  function add(body) { objects.push(body); return objects.length; }
  var font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  var font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  var content = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  var pageId = add('<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 612 792] /Contents ' + content + ' 0 R /Resources << /Font << /F1 ' + font1 + ' 0 R /F2 ' + font2 + ' 0 R >> >> >>');
  var pages = add('<< /Type /Pages /Count 1 /Kids [' + pageId + ' 0 R] >>');
  var catalog = add('<< /Type /Catalog /Pages ' + pages + ' 0 R >>');
  objects[pageId - 1] = objects[pageId - 1].replace('Parent PAGES 0 R', 'Parent ' + pages + ' 0 R');
  var body = '%PDF-1.4\n';
  var offsets = [0];
  objects.forEach(function (item, index) {
    offsets.push(body.length);
    body += (index + 1) + ' 0 obj\n' + item + '\nendobj\n';
  });
  var xref = body.length;
  body += 'xref\n0 ' + (objects.length + 1) + '\n';
  body += '0000000000 65535 f \n';
  offsets.slice(1).forEach(function (offset) {
    var textOffset = String(offset);
    while (textOffset.length < 10) textOffset = '0' + textOffset;
    body += textOffset + ' 00000 n \n';
  });
  body += 'trailer << /Size ' + (objects.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  var bytes = [];
  var i;
  for (i = 0; i < body.length; i += 1) bytes.push(body.charCodeAt(i));
  return Utilities.base64Encode(bytes);
}
