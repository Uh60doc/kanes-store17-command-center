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
    writtenBalance: reportDayBalance_(facts, closed, date),
    notice: 'Preview, print, or download this page. No email is sent.',
  };
}

function reportBalanceCompact_(block) {
  block = block || {};
  return [
    'NWDSR Written ' + (block.nwdsr || 'Pending') + '   SNAP Written ' + (block.snap || block.current || 'Pending') + '   NWDSR minus SNAP ' + (block.variance || 'Pending'),
    'NWDSR Written LAST YEAR ' + (block.nwdsrLy || 'Pending') + '   SNAP Written LY ' + (block.ly || 'Pending'),
    'SNAP versus SNAP LAST YEAR ' + (block.dollars || 'Pending') + (block.percent && block.percent !== 'Pending' ? '  ' + block.percent : '') + '   Not removed from the store total',
  ];
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
      { key: 'monthly', label: 'Monthly', ready: true },
      { key: 'individual', label: 'Individual', ready: true },
      { key: 'meeting', label: 'Generate Meeting Packet', ready: true },
      { key: 'trend', label: '13-week trend', ready: true },
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

function reportSnapSignMoney_(value) {
  if (briefBlank_(value)) return 'Pending';
  var text = moneyText_(value);
  if (Number(value) > 0) return '+' + text;
  return text;
}

function reportSnapSignPercent_(current, ly) {
  if (briefBlank_(current) || briefBlank_(ly) || Number(ly) === 0) return 'Pending';
  var ratio = (Number(current) - Number(ly)) / Number(ly);
  var text = percentText_(ratio);
  if (ratio > 0) return '+' + text;
  return text;
}

function reportOpenDates_(start, end, closed) {
  var dates = [];
  eachDate_(start, end).forEach(function (date) { if (!closed[date]) dates.push(date); });
  return dates;
}

function reportMetricWindow_(facts, dates, field) {
  var missing = [];
  var total = 0;
  var seen = false;
  dates.forEach(function (date) {
    var row = reportFact_(facts, date);
    var value = row ? row[field] : null;
    if (value === null || value === undefined) { missing.push(date); return; }
    seen = true;
    total += Number(value);
  });
  if (!dates.length || missing.length || !seen) return { pending: true, value: null, missing: missing };
  return { pending: false, value: Math.round(total * 100) / 100, missing: [] };
}

function reportSnapWindow_(facts, dates) {
  return reportMetricWindow_(facts, dates, 'snapWritten');
}

/** A verified CC_LastYear store total is used only for this metric and these exact dates. */
function reportMetricArchive_(start, end, metric) {
  if (!start || !end) return { value: null, basis: '' };
  var rows = [];
  try { rows = lastYearRows_(); } catch (error) { return { value: null, basis: '' }; }
  var match = null;
  var rejected = false;
  rows.forEach(function (row) {
    if (match || row.start !== start || row.end !== end) return;
    if (String(row.track || '').toLowerCase() !== 'store') return;
    if (row.metric !== metric) return;
    if (row.person || row.employeeId) return;
    if (typeof lastYearSameReport_ === 'function' && !lastYearSameReport_(metric, row.source)) { rejected = true; return; }
    if (row.value === null || !row.verifiedBy) return;
    match = row;
  });
  if (!match) return { value: null, basis: rejected ? 'A figure from a different report was not used.' : '' };
  return { value: match.value, basis: 'CC_LastYear ' + match.source + ', ' + start + ' through ' + end + ', verified by ' + match.verifiedBy + '.' };
}

function reportSnapArchive_(start, end) {
  return reportMetricArchive_(start, end, 'SNAP Written');
}

function reportMetricSeries_(facts, dates, field, metric) {
  var daily = reportMetricWindow_(facts, dates, field);
  var start = dates.length ? dates[0] : '';
  var end = dates.length ? dates[dates.length - 1] : '';
  var contiguous = !!(dates.length && end === shiftDate_(start, dates.length - 1));
  var archive = daily.pending && contiguous ? reportMetricArchive_(start, end, metric) : { value: null, basis: '' };
  var value = daily.pending ? archive.value : daily.value;
  var pending = value === null || value === undefined;
  var source = daily.pending
    ? (pending ? ('Pending. ' + (dates.length ? ('Missing ' + metric + ' for ' + reportDateList_(daily.missing) + '.') : 'No comparable dates.') + (archive.basis ? ' ' + archive.basis : '')) : archive.basis)
    : ('CC_Daily ' + metric + ', ' + start + ' through ' + end + '. Not added to any other report.');
  return { pending: pending, value: pending ? null : value, source: source };
}

function reportSnapComparison_(facts, currentDates, lyDates, lyLabel) {
  var current = reportMetricSeries_(facts, currentDates, 'snapWritten', 'SNAP Written');
  var nwdsr = reportMetricSeries_(facts, currentDates, 'nwdsrWritten', 'NWDSR Written');
  var lyDaily = reportMetricSeries_(facts, lyDates, 'snapWritten', 'SNAP Written');
  var nwdsrLy = reportMetricSeries_(facts, lyDates, 'nwdsrWritten', 'NWDSR Written');
  var dollars = current.pending || lyDaily.pending ? null : Math.round((current.value - lyDaily.value) * 100) / 100;
  var variance = current.pending || nwdsr.pending ? null : Math.round((nwdsr.value - current.value) * 100) / 100;
  var currentStart = currentDates.length ? currentDates[0] : '';
  var currentEnd = currentDates.length ? currentDates[currentDates.length - 1] : '';
  var lyStart = lyDates.length ? lyDates[0] : '';
  var lyEnd = lyDates.length ? lyDates[lyDates.length - 1] : '';
  return {
    label: 'Written comparison',
    nwdsr: nwdsr.pending ? 'Pending' : moneyText_(nwdsr.value),
    current: current.pending ? 'Pending' : moneyText_(current.value),
    snap: current.pending ? 'Pending' : moneyText_(current.value),
    currentDates: currentStart ? (briefDisplayDate_(currentStart) + ' - ' + briefDisplayDate_(currentEnd)) : 'Pending',
    variance: variance === null ? 'Pending' : reportSnapSignMoney_(variance),
    nwdsrLy: nwdsrLy.pending ? 'Pending' : moneyText_(nwdsrLy.value),
    ly: lyDaily.pending ? 'Pending' : moneyText_(lyDaily.value),
    snapLy: lyDaily.pending ? 'Pending' : moneyText_(lyDaily.value),
    lyDates: lyStart ? (briefDisplayDate_(lyStart) + ' - ' + briefDisplayDate_(lyEnd)) : 'Pending',
    dollars: dollars === null ? 'Pending' : reportSnapSignMoney_(dollars),
    percent: reportSnapSignPercent_(current.pending ? null : current.value, lyDaily.pending ? null : lyDaily.value),
    note: (lyLabel ? lyLabel + ' ' : '') + 'Supplemental. SNAP Written is kept separate from NWDSR Written and is not the store budget. LAST YEAR is the prior year, not last month. The NWDSR minus SNAP difference is not removed from the store total.',
    source: 'Current SNAP Written ' + (current.pending ? ('Pending. Missing ' + (currentDates.length ? reportDateList_(reportMetricWindow_(facts, currentDates, 'snapWritten').missing) : '') + '.') : ('CC_Daily SNAP Written, ' + currentStart + ' through ' + currentEnd + '.')) + ' Last year: ' + lyDaily.source,
  };
}

function reportDayBalance_(facts, closed, date) {
  if (!date || closed[date]) return reportSnapComparison_(facts, [], [], 'LAST YEAR is the prior year, not last month.');
  return reportSnapComparison_(facts, [date], [shiftDate_(date, -364)], 'LAST YEAR is the same weekday 52 weeks earlier, not last month.');
}

function reportWeekSnapLy_(facts, closed, start, end) {
  var currentDates = reportOpenDates_(start, end, closed);
  var lyDates = currentDates.map(function (date) { return shiftDate_(date, -364); });
  return reportSnapComparison_(facts, currentDates, lyDates, 'Same Monday-Sunday week, 52 weeks earlier.');
}

function reportMonthSnapLy_(facts, closed, store, asOf) {
  var ly = { confirmed: false, start: '', end: '', status: 'Pending' };
  try { ly = storeLastYear_(config_(), store); } catch (error) { ly = ly; }
  var currentEnd = shiftDate_(asOf, -1);
  if (currentEnd > store.end) currentEnd = store.end;
  if (currentEnd < store.start) currentEnd = store.start;
  var currentDates = reportOpenDates_(store.start, currentEnd, closed);
  var proposed = ly.start && ly.end ? (briefDisplayDate_(ly.start) + ' - ' + briefDisplayDate_(ly.end)) : 'Pending';
  if (!ly.confirmed) {
    var waiting = reportSnapComparison_(facts, currentDates, [], 'Last-year store period is not confirmed.');
    waiting.ly = 'Pending';
    waiting.snapLy = 'Pending';
    waiting.nwdsrLy = 'Pending';
    waiting.lyDates = proposed;
    waiting.dollars = 'Pending';
    waiting.percent = 'Pending';
    waiting.note = 'Last-year period is not confirmed (' + (ly.status || 'Pending') + '). SNAP Written LY stays Pending. ' + waiting.note;
    return waiting;
  }
  var lyDates = [];
  var unpaired = false;
  currentDates.forEach(function (date) {
    var mapped = shiftDate_(ly.start, historyDayGap_(store.start, date));
    if (!mapped || mapped > ly.end) { unpaired = true; return; }
    lyDates.push(mapped);
  });
  var block = reportSnapComparison_(facts, currentDates, unpaired ? [] : lyDates, 'Day for day inside the confirmed last-year period ' + ly.start + ' through ' + ly.end + '.');
  if (unpaired) {
    block.ly = 'Pending';
    block.snapLy = 'Pending';
    block.nwdsrLy = 'Pending';
    block.lyDates = proposed;
    block.dollars = 'Pending';
    block.percent = 'Pending';
    block.source = 'A current open day has no partner inside ' + ly.start + ' through ' + ly.end + '.';
    block.note = 'A current day has no partner in the confirmed last-year period. ' + block.note;
  }
  return block;
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
  weekly.forEach(function (line) {
    line.scope = 'week';
    line.caption = line.status === 'pending' ? 'Missing day stays Pending' : (briefDisplayDate_(start) + ' – ' + briefDisplayDate_(end));
  });

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
  month.forEach(function (line) {
    line.scope = 'store-month';
    var through = line.key.indexOf('delivered') !== -1 ? deliveredThrough : writtenThrough;
    var prefix = line.key.indexOf('projection') !== -1 ? 'Projection through ' : 'Store month through ';
    line.caption = prefix + (through ? briefDisplayDate_(through) : 'Pending');
  });

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
  var snapLy = reportWeekSnapLy_(facts, closed, start, end);
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
    snapLy: snapLy,
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

function reportAssociates_(today) {
  var names = [];
  sheet_('CC_People').forEach(function (row) {
    if (rosterRole_(row, today) === 'associate') names.push(String(row.name || ''));
  });
  return names.filter(function (name) { return name; }).sort();
}

function employeeReportOn_() {
  return /^(1|true|yes|on)$/i.test(String(config_().employee_report_access || ''));
}

function employeeReportName_(session) {
  var user = String(session && session.username || '').trim().toLowerCase();
  if (!user) return '';
  return String(config_()['employee_report_' + user] || '').trim();
}

function reportGuard_(payload, kind) {
  if (!payload.session || payload.session.role !== 'sales') return '';
  if (kind !== 'individual') throw new Error('This login can open only its own salesperson report.');
  if (!employeeReportOn_()) throw new Error('Employee access is not enabled.');
  var name = employeeReportName_(payload.session);
  if (!name) throw new Error('This login is not linked to an associate.');
  return name;
}

function reportPersonSnap_(name, start, end) {
  var pending = snapPendingDates_(start, end, end);
  if (pending.length) return { value: null, pending: true, missing: pending };
  var total = 0;
  var lines = snapAssociateLines_(start, end);
  lines.order.forEach(function (key) {
    var line = lines.byDay[key];
    if (line.name === name) total += line.amount;
  });
  return { value: Math.round(total * 100) / 100, pending: false, missing: [] };
}

function reportWeekOrders_(ledger, name, start, end, closed) {
  var missing = [];
  var orders = 0;
  var sales = 0;
  eachDate_(start, end).forEach(function (date) {
    if (closed[date]) return;
    var file = false;
    var units = null;
    var amount = null;
    ledger.forEach(function (row) {
      if (row.side !== 'written' || row.grain !== 'daily' || row.reportDate !== date || !PERSON_ANALYSIS_SOURCE_.test(row.source)) return;
      if (row.view === 'DA_SALES_STORE') file = true;
      if (row.view === 'DA_SALES_PERSON' && rowMatchesPerson_(row, name)) {
        units = saleOrders_(row);
        amount = row.sales === null || row.sales === undefined ? null : Number(row.sales);
      }
    });
    if (!file) { missing.push(date); return; }
    orders += units === null ? 0 : Number(units);
    sales += amount === null ? 0 : amount;
  });
  if (missing.length) return { pending: true, missing: missing, orders: null, sales: null };
  return { pending: false, missing: [], orders: orders, sales: Math.round(sales * 100) / 100 };
}

function reportWeekTraffic_(facts, name, start, end, closed) {
  var map = personDailyOpportunities_(facts, name);
  var missing = [];
  var total = 0;
  eachDate_(start, end).forEach(function (date) {
    if (closed[date]) return;
    if (!Object.prototype.hasOwnProperty.call(map, date)) { missing.push(date); return; }
    total += Number(map[date]);
  });
  if (missing.length) return { pending: true, missing: missing, value: null };
  return { pending: false, missing: [], value: total };
}

function reportStaffing_(name, start, end) {
  var rows = [];
  try {
    sheet_('CC_Staffing').forEach(function (row) {
      var date = isoDate_(row.date);
      if (!date || date < start || date > end) return;
      if (String(row.display_name || row.name || '') !== name) return;
      rows.push(row);
    });
  } catch (error) { rows = []; }
  if (!rows.length) return reportLine_('activity', 'Selling activity', 'Pending', '', 'Pending', 'pending', 'No verified staffing record for this associate in this week. Working days are not assumed.', null);
  var worked = 0;
  var off = 0;
  rows.forEach(function (row) {
    var flag = String(row.worked || '').trim().toLowerCase();
    if (flag === 'yes') worked += 1;
    else if (flag === 'no') off += 1;
  });
  var line = reportLine_('activity', 'Selling activity', worked + ' working', '', off + ' confirmed off', 'ready', 'CC_Staffing confirmations in this week. Unconfirmed open days are not counted as worked or as off.', null);
  line.scope = 'week';
  return line;
}

function reportRateLine_(key, label, actual, goal, unit, source) {
  var goalText = briefBlank_(goal) ? '' : briefKpiCell_(goal, unit);
  if (briefBlank_(actual)) {
    var pending = reportLine_(key, label, 'Pending', goalText, 'Pending', 'pending', source, null);
    pending.scope = 'salesperson-month';
    return pending;
  }
  var versusUnit = unit === 'dollars' ? 'dollars' : (unit === 'count' ? 'count' : 'percent');
  var line = reportLine_(key, label, briefKpiCell_(actual, unit), goalText, reportVersus_(actual, goal, versusUnit), reportStatus_(actual, goal), source, reportBar_(actual, goal));
  line.scope = 'salesperson-month';
  return line;
}

function reportIndividual_(payload, today) {
  var span = reportSpan_(payload, today);
  if (span.span === 'custom') span = reportCompletedWeek_(today, payload && (payload.end || payload.start || payload.date));
  var start = span.start;
  var end = span.end;
  var associates = reportAssociates_(today);
  var locked = payload.session && payload.session.role === 'sales' ? employeeReportName_(payload.session) : '';
  var requested = locked || String(payload.name || '');
  if (requested && associates.indexOf(requested) === -1) throw new Error('Choose a current associate. Management and former associates are not on this coaching report.');
  var name = requested || associates[0] || '';
  if (!name) throw new Error('Choose a current associate. Management and former associates are not on this coaching report.');
  if (locked && name !== locked) throw new Error('This login can open only its own salesperson report.');
  var hired = '';
  sheet_('CC_People').forEach(function (row) { if (String(row.name || '') === name) hired = isoDate_(row.hire_date); });
  var individual = individualPeriodContaining_(end);
  var service = evalPrepServiceMonth_(hired, individual.start);
  var goal = evalPrepVolumeGoal_(service);
  var employed = !(hired && hired > end);
  var partialLabel = span.partial ? 'Partial · week to date' : 'Completed week';
  var monthNote = 'Salesperson month ' + individual.start + ' through ' + end + '. Not this week.';
  var closed = closedDates_();
  var weekSnap = employed ? reportPersonSnap_(name, start, end) : { value: null, pending: false, missing: [] };
  var mtdSnap = employed ? reportPersonSnap_(name, individual.start, end) : { value: null, pending: false, missing: [] };
  var ledger = [];
  try { ledger = personAnalysisLedger_(); } catch (error) { ledger = []; }
  var weekOrders = employed ? reportWeekOrders_(ledger, name, start, end, closed) : { pending: false, orders: null, sales: null, missing: [] };
  var facts = [];
  try { facts = loadClosing_(); } catch (error) { facts = []; }
  var traffic = employed ? reportWeekTraffic_(facts, name, start, end, closed) : { pending: false, value: null, missing: [] };
  var analysis = personAnalysisContext_({ start: individual.start, end: end });
  var side = personAnalysisSide_(ledger, name, analysis.written);
  var goals = approvedGoals_(config_());
  var newHireRates = service !== null && service >= 1 && service < 4;
  var ticketGoal = goals.averageTicket || 2500;
  var beddingGoal = newHireRates ? evalPrepRateGoal_('mattress', true) : goals.bedding;
  var fabricGoal = newHireRates ? evalPrepRateGoal_('fabric', true) : goals.fabric;
  var leatherGoal = newHireRates ? evalPrepRateGoal_('leather', true) : goals.leather;
  var powerGoal = newHireRates ? evalPrepRateGoal_('power', true) : goals.power;
  var padGoal = newHireRates ? evalPrepRateGoal_('protector', true) : goals.mattress;
  var rugGoal = newHireRates ? evalPrepRateGoal_('rugs', true) : goals.rugs;
  var monthLabel = side && side.through ? ('Salesperson month through ' + briefDisplayDate_(side.through) + '. Not this week.') : 'Group 17 written coverage through this week is not on file. The later month total is not used.';
  function moneyPending(key, label, pack, source) {
    if (!employed) return reportLine_(key, label, 'Not employed', '', 'Hired ' + briefDisplayDate_(hired), 'pending', 'Hired after this week.', null);
    if (pack.pending) return reportLine_(key, label, 'Pending', '', 'Pending', 'pending', source + ' Missing: ' + reportDateList_(pack.missing) + '. Not counted as zero.', null);
    return reportLine_(key, label, moneyText_(pack.value), '', 'On file', 'ready', source, null);
  }
  var written = moneyPending('snap-week', 'SNAP Written', weekSnap, 'SNAP Written for this week only.');
  var mtd = moneyPending('snap-mtd', 'SNAP Written MTD', mtdSnap, monthNote + ' SNAP Written.');
  written.scope = 'week';
  mtd.scope = 'salesperson-month';
  var goalLine = reportLine_('volume-goal', 'Monthly goal', goal.amount === null ? 'Pending' : moneyText_(goal.amount), '', goal.amount === 0 ? 'Training month' : (goal.amount === null ? 'Pending' : 'On file'), goal.amount === null ? 'pending' : 'ready', goal.note, null);
  var pct;
  var left;
  if (!employed) {
    pct = reportLine_('volume-pct', 'Percent to goal', 'Not employed', '', 'Pending', 'pending', 'Hired after this week.', null);
    left = reportLine_('volume-left', 'Remaining', 'Not employed', '', 'Pending', 'pending', 'Hired after this week.', null);
  } else if (goal.amount === 0) {
    pct = reportLine_('volume-pct', 'Percent to goal', 'Not scored', '$0', 'Training month', 'ready', 'Month 1 is a training month. The $0 goal is not scored as a miss.', null);
    left = reportLine_('volume-left', 'Remaining', '$0', '', 'Training month', 'ready', 'Nothing is owed against the $0 training goal.', null);
  } else if (goal.amount === null || mtdSnap.pending) {
    pct = reportLine_('volume-pct', 'Percent to goal', 'Pending', goal.amount === null ? '' : '100%', 'Pending', 'pending', goal.amount === null ? goal.note : 'SNAP Written MTD is not complete, so the percent stays Pending.', null);
    left = reportLine_('volume-left', 'Remaining', 'Pending', '', 'Pending', 'pending', 'Remaining dollars wait for a complete SNAP Written MTD and a verified goal.', null);
  } else {
    pct = reportLine_('volume-pct', 'Percent to goal', percentText_(mtdSnap.value / goal.amount), '100%', reportVersus_(mtdSnap.value, goal.amount, 'dollars'), reportStatus_(mtdSnap.value, goal.amount), 'SNAP Written MTD ÷ the tenure written goal. Not NWDSR.', reportBar_(mtdSnap.value, goal.amount));
    var remain = Math.max(0, Math.round((goal.amount - mtdSnap.value) * 100) / 100);
    left = reportLine_('volume-left', 'Remaining', moneyText_(remain), '', 'On file', 'ready', 'Tenure goal minus SNAP Written MTD. Not the week total.', null);
  }
  var ordersLine = !employed
    ? reportLine_('orders', 'Written orders', 'Not employed', '', 'Pending', 'pending', 'Hired after this week.', null)
    : (weekOrders.pending
      ? reportLine_('orders', 'Written orders', 'Pending', '', 'Pending', 'pending', 'Group 17 written day files are missing for ' + reportDateList_(weekOrders.missing) + '. The salesperson-month order count is not used as this week. Not SNAP dollars.', null)
      : reportLine_('orders', 'Written orders', String(weekOrders.orders), '', 'On file', 'ready', 'Group 17 written orders for the open days in this week. A covered day with no line is 0. Not SNAP dollars.', null));
  var ticketLine;
  var ticketActual = null;
  var ticketOrders = null;
  var ticketScope = '';
  if (!employed) ticketLine = reportLine_('ticket', 'Average ticket', 'Not employed', moneyText_(ticketGoal), 'Pending', 'pending', 'Hired after this week.', null);
  else if (!weekOrders.pending && weekOrders.orders) {
    ticketActual = Math.round((weekOrders.sales / weekOrders.orders) * 100) / 100;
    ticketOrders = weekOrders.orders;
    ticketScope = 'This week. Group 17 written sales ÷ Group 17 written orders. Not SNAP dollars.';
    ticketLine = reportLine_('ticket', 'Average ticket', moneyText_(ticketActual), moneyText_(ticketGoal), reportVersus_(ticketActual, ticketGoal, 'dollars'), reportStatus_(ticketActual, ticketGoal), ticketScope, reportBar_(ticketActual, ticketGoal));
  } else if (side && side.orders && side.average && !briefBlank_(side.average.value)) {
    ticketActual = side.average.value;
    ticketOrders = side.orders;
    ticketScope = 'Salesperson month through ' + side.through + '. Not this week. Group 17 written sales ÷ Group 17 written orders. Not SNAP dollars.';
    ticketLine = reportLine_('ticket', 'Average ticket', moneyText_(ticketActual), moneyText_(ticketGoal), reportVersus_(ticketActual, ticketGoal, 'dollars'), reportStatus_(ticketActual, ticketGoal), ticketScope, reportBar_(ticketActual, ticketGoal));
    ticketLine.scope = 'salesperson-month';
  } else ticketLine = reportLine_('ticket', 'Average ticket', 'Pending', moneyText_(ticketGoal), 'Pending', 'pending', 'No complete Group 17 written order count is on file for this week, and the salesperson-month ticket through the week end is not on file.', null);
  var trafficLine = !employed
    ? reportLine_('perq', 'PERQ opportunities', 'Not employed', '', 'Pending', 'pending', 'Hired after this week.', null)
    : (traffic.pending
      ? reportLine_('perq', 'PERQ opportunities', 'Pending', '', 'Pending', 'pending', 'PERQ for this salesperson is missing for ' + reportDateList_(traffic.missing) + '. Not counted as zero.', null)
      : reportLine_('perq', 'PERQ opportunities', String(traffic.value), '', 'On file', 'ready', 'PERQ Ups + Be Backs for this salesperson on the open days in this week.', null));
  var closingLine;
  if (!employed) closingLine = reportLine_('closing', 'Week closing', 'Not employed', '', 'Pending', 'pending', 'Hired after this week.', null);
  else if (weekOrders.pending || traffic.pending) closingLine = reportLine_('closing', 'Week closing', 'Pending', percentText_(goals.closing), 'Pending', 'pending', 'Week closing needs Group 17 written orders and PERQ for every open day in this week.', null);
  else if (!traffic.value) closingLine = reportLine_('closing', 'Week closing', 'No opportunities', percentText_(goals.closing), 'Pending', 'pending', 'PERQ opportunities for this week are 0, so the ratio is not calculated.', null);
  else {
    var ratio = Math.round((weekOrders.orders / traffic.value) * 1000) / 1000;
    closingLine = reportLine_('closing', 'Week closing', percentText_(ratio), percentText_(goals.closing), reportVersus_(ratio, goals.closing, 'percent'), reportStatus_(ratio, goals.closing), weekOrders.orders + ' Group 17 written orders ÷ ' + traffic.value + ' PERQ opportunities. Not SNAP dollars.', reportBar_(ratio, goals.closing));
  }
  var monthClosing = null;
  try { monthClosing = employed ? personClosing_(facts, name, individual.start, end, goals.closing, ledger) : null; } catch (error) { monthClosing = null; }
  var monthClosingLine = reportLine_('month-closing', 'Month closing', !monthClosing || monthClosing.ratio === null ? 'Pending' : percentText_(monthClosing.ratio), percentText_(goals.closing), !monthClosing || monthClosing.ratio === null ? 'Pending' : reportVersus_(monthClosing.ratio, goals.closing, 'percent'), !monthClosing || monthClosing.ratio === null ? 'pending' : reportStatus_(monthClosing.ratio, goals.closing), (monthClosing && monthClosing.note ? monthClosing.note + ' ' : '') + 'Salesperson month. Not this week.', monthClosing && monthClosing.ratio !== null ? reportBar_(monthClosing.ratio, goals.closing) : null);
  monthClosingLine.scope = 'salesperson-month';
  var activity = employed ? reportStaffing_(name, start, end) : reportLine_('activity', 'Selling activity', 'Not employed', '', 'Pending', 'pending', 'Hired after this week.', null);
  var performance = [written, mtd, goalLine, pct, left, ordersLine, ticketLine, trafficLine, closingLine, monthClosingLine, activity];
  performance.forEach(function (line) { if (!line.scope) line.scope = 'week'; line.section = 'performance'; });
  var quality = [
    reportRateLine_('bedding', 'Bedding', side && side.bedding ? side.bedding.value : null, beddingGoal, 'percent', monthLabel + ' Bedding dollars ÷ Group 17 written sales.'),
    reportRateLine_('fabric', 'Fabric maintenance', side && side.fabric ? side.fabric.value : null, fabricGoal, 'percent', monthLabel + ' Group 17 fabric protection.'),
    reportRateLine_('leather', 'Leather maintenance', side && side.leather ? side.leather.value : null, leatherGoal, 'percent', monthLabel + ' Group 17 leather protection.'),
    reportRateLine_('power', 'Power upholstery', side && side.power ? side.power.value : null, powerGoal, 'percent', monthLabel + ' Group 17 power protection.'),
    reportRateLine_('pads', 'Mattress protectors', side && side.pads ? side.pads.value : null, padGoal, 'percent', monthLabel + ' Group 17 mattress protectors.'),
    reportLine_('rugs', 'Rugs', 'Pending', briefBlank_(rugGoal) ? '' : String(rugGoal), 'Pending', 'pending', 'No salesperson rug count is on file. ASL rugs are a store total, so this stays Pending.', null),
  ];
  var protect = null;
  var tallies = side && side.tallies ? side.tallies : null;
  if (tallies && tallies.fabric && tallies.leather && tallies.power && tallies.pads && tallies.fabric.dollars !== null && tallies.leather.dollars !== null && tallies.power.dollars !== null && tallies.pads.dollars !== null) {
    protect = Math.round((tallies.fabric.dollars + tallies.leather.dollars + tallies.power.dollars + tallies.pads.dollars) * 100) / 100;
  }
  var protectLine = reportLine_('protection', 'Protection dollars', protect === null ? 'Pending' : moneyText_(protect), '', protect === null ? 'Pending' : 'On file', protect === null ? 'pending' : 'ready', protect === null ? (monthLabel + ' Protection dollars are not on every Group 17 category.') : (monthLabel + ' Fabric, leather, power, and mattress-protector dollars. Not added to SNAP Written.'), null);
  protectLine.scope = 'salesperson-month';
  quality.push(protectLine);
  quality.forEach(function (line) { line.section = 'quality'; if (!line.scope) line.scope = 'salesperson-month'; });
  var opportunity = [];
  if (ticketActual === null || ticketOrders === null) opportunity.push('Ticket opportunity is Pending. It needs the same verified Group 17 order count and Group 17 average ticket.');
  else {
    var gap = Math.round((ticketGoal - ticketActual) * ticketOrders * 100) / 100;
    opportunity.push((gap > 0 ? moneyText_(gap) + ' between the verified average ticket and ' + moneyText_(ticketGoal) + ' on ' + ticketOrders + ' Group 17 orders. ' : 'The verified average ticket is at or above ' + moneyText_(ticketGoal) + ' on ' + ticketOrders + ' Group 17 orders. ') + ticketScope);
  }
  var attachments = personAttachments_({ written: side, delivered: null }, { fabric: fabricGoal, leather: leatherGoal, power: powerGoal, mattress: padGoal, attachment: goals.attachment });
  var gaps = [];
  (attachments.written.lines || []).forEach(function (line) {
    if (line.status === 'below' && line.needed) gaps.push(line.name + ' needs ' + line.needed + ' more on the verified eligible count (' + line.sold + ' of ' + line.qualified + ').');
  });
  if (side && side.bedding && !briefBlank_(side.bedding.value) && !briefBlank_(beddingGoal) && Number(side.bedding.value) < Number(beddingGoal)) gaps.push('Bedding is ' + percentText_(side.bedding.value) + ' versus ' + percentText_(beddingGoal) + ' for the salesperson month.');
  if (!gaps.length) opportunity.push('No verified attachment gap is on file for this period.');
  gaps.slice(0, 3).forEach(function (item) { opportunity.push(item); });
  if (goal.amount === 0) opportunity.push('Progress toward the monthly goal: training month, $0 written goal, not scored.');
  else if (goal.amount === null || mtdSnap.pending || !employed) opportunity.push('Progress toward the monthly goal stays Pending until SNAP Written and the tenure goal are both verified.');
  else opportunity.push('Progress toward the monthly goal: ' + moneyText_(mtdSnap.value) + ' of ' + moneyText_(goal.amount) + ' SNAP Written (' + percentText_(mtdSnap.value / goal.amount) + ').');
  var strengths = [];
  var improvements = [];
  if (goal.amount === 0 && employed) strengths.push('The written goal is the $0 training goal and is not scored as a miss.');
  if (!mtdSnap.pending && employed && goal.amount > 0 && mtdSnap.value >= goal.amount) strengths.push('SNAP Written is at the ' + moneyText_(goal.amount) + ' monthly goal.');
  quality.forEach(function (line) {
    if (line.status === 'hit' || line.status === 'even') strengths.push(line.label + ' is at the goal (' + line.result + ').');
    if (line.status === 'short') improvements.push(line.label + ' is ' + line.result + ' versus ' + (line.goal || 'the goal') + '.');
  });
  if (ticketLine.status === 'short') improvements.push('Average ticket is ' + ticketLine.result + ' versus ' + moneyText_(ticketGoal) + '.');
  if (closingLine.status === 'short') improvements.push('Week closing is ' + closingLine.result + ' versus ' + percentText_(goals.closing) + '.');
  if (weekSnap.pending || mtdSnap.pending) improvements.push('A missing SNAP day stays Pending and is not coached as zero.');
  var seen = {};
  strengths = strengths.filter(function (item) { if (seen[item]) return false; seen[item] = true; return true; }).slice(0, 2);
  var seenGap = {};
  improvements = improvements.filter(function (item) { if (seenGap[item]) return false; seenGap[item] = true; return true; }).slice(0, 2);
  if (!strengths.length) strengths.push('No verified strength is on this report.');
  else if (strengths.length === 1) strengths.push('No second verified strength.');
  if (!improvements.length) improvements.push('No verified gap is on this report.');
  else if (improvements.length === 1) improvements.push('No second verified gap.');
  var nextGoal = improvements[0].indexOf('No verified') === 0 ? 'Obtain the missing verified reports before setting a numeric coaching goal.' : ('Next week: ' + improvements[0]);
  var verification = partialLabel + ' · ' + briefDisplayDate_(start) + ' through ' + briefDisplayDate_(end) + ' · ' + name + (newHireRates ? ' · NEW HIRE' : '') + ' · prepared ' + briefDisplayDate_(today) + '. SNAP Written is the individual written volume. Group 17 is the order count and average ticket. PERQ is the traffic. ' + (hired ? ('Hired ' + briefDisplayDate_(hired) + '. ') : 'Hire date is not on file. ') + 'No email sent.';
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'individual',
    layout: 'individual',
    ready: true,
    title: 'Weekly Salesperson Report',
    name: name,
    associates: locked ? [locked] : associates,
    access: { enabled: employeeReportOn_(), self: locked },
    newHire: newHireRates,
    hired: hired,
    span: span.span,
    partial: !!span.partial,
    partialLabel: partialLabel,
    date: end,
    displayDate: name + ' · ' + briefDisplayDate_(start) + ' – ' + briefDisplayDate_(end),
    today: today,
    period: { start: start, end: end },
    storePeriod: '',
    individualPeriod: individual.start + ' through ' + individual.end,
    calendarNote: 'SNAP Written is the official individual written volume. Group 17 written orders and the average ticket are a different report and are not mixed with SNAP dollars. PERQ is salesperson traffic. Store month is not this report.',
    mail: false,
    verification: verification,
    performance: performance,
    quality: quality,
    opportunity: opportunity.slice(0, 4),
    coaching: { strengths: strengths, improvements: improvements, goal: nextGoal, notes: 'Manager notes stay on this printed page. Nothing is saved or emailed.' },
    lines: performance.concat(quality),
    winners: { status: 'pending', text: '', quiet: '', source: '', date: '' },
    priorities: [nextGoal],
    prioritySource: 'One coaching goal from the verified gaps. Not emailed.',
    notice: 'Preview, print, or download this page. No email is sent.',
  };
}

function reportMonthFacts_(field, facts, store, asOf, closed) {
  var through = latestFactDate_(facts, field, store.start, store.end, asOf);
  var missing = [];
  eachDate_(store.start, shiftDate_(asOf, -1)).forEach(function (date) {
    if (date > store.end || closed[date]) return;
    var row = null;
    facts.forEach(function (item) { if (item.date === date) row = item; });
    if (!row || row[field] === null || row[field] === undefined) missing.push(date);
  });
  return { through: through, value: through ? sumField_(facts, field, store.start, through) : null, missing: missing };
}

function reportKpiMap_(store) {
  var map = {};
  try {
    sheet_('CC_Kpi').forEach(function (row) {
      if (!row.metric || String(row.metric) === 'Daily Bedding') return;
      if (isoDate_(row.period_start) !== store.start || isoDate_(row.period_end) !== store.end) return;
      map[String(row.metric)] = { written: fineNumber_(row.written), delivered: fineNumber_(row.delivered), note: String(row.note || ''), through: isoDate_(row.verified_through) };
    });
  } catch (error) { map = {}; }
  if (!Object.keys(map).length && store.start === '2026-10-02' && store.end === '2026-11-01') {
    kpiActuals_().forEach(function (row) {
      map[row[0]] = { written: row[1], delivered: row[2], note: row[3], through: '' };
    });
  }
  return map;
}

function reportProgressText_(actual, goal) {
  if (briefBlank_(actual) || briefBlank_(goal) || Number(goal) === 0) return 'Pending';
  return percentText_(Number(actual) / Number(goal));
}

function reportCell_(value, unit) {
  if (briefBlank_(value)) return 'Pending';
  if (unit === 'dollars') return moneyText_(value);
  if (unit === 'count') return String(value);
  return percentText_(value);
}

function reportLyValue_(metric, ly, unit) {
  if (metric === 'NWDSR Written' || metric === 'NWDSR Delivered') {
    var side = metric === 'NWDSR Written' ? ly.written : ly.delivered;
    if (ly.confirmed && side && !briefBlank_(side.value)) return reportCell_(side.value, unit);
    return 'Pending';
  }
  var found = null;
  try {
    lastYearRows_().forEach(function (row) {
      if (found || row.track !== 'store' || row.metric !== metric || row.person || row.employeeId) return;
      if (ly.period && row.start + ' through ' + row.end !== ly.period) return;
      if (row.value === null || !row.verifiedBy) return;
      found = row;
    });
  } catch (error) { found = null; }
  if (found) return reportCell_(found.value, unit);
  return 'N/A';
}

function reportScoreRow_(key, label, actual, goal, unit, source, lyMetric, ly) {
  var pending = briefBlank_(actual);
  var ratio = pending || briefBlank_(goal) || Number(goal) === 0 ? null : Number(actual) / Number(goal);
  return {
    key: key,
    label: label,
    actual: pending ? 'Pending' : reportCell_(actual, unit),
    progress: reportProgressText_(actual, goal),
    variance: pending || briefBlank_(goal) ? 'Pending' : reportVersus_(actual, goal, unit === 'percent' ? 'percent' : (unit === 'count' ? 'count' : 'dollars')),
    budget: briefBlank_(goal) ? 'Pending' : reportCell_(goal, unit),
    ly: reportLyValue_(lyMetric, ly, unit),
    status: reportStatus_(actual, goal),
    ratio: ratio === null || !isFinite(ratio) ? null : ratio,
    source: source,
  };
}

function reportMonthly_(payload, today) {
  var anchor = today;
  try { if (payload && payload.date) anchor = validDate_(payload.date); } catch (error) { anchor = today; }
  if (!anchor || anchor > today) anchor = today;
  var store = storePeriodContaining_(anchor);
  var asOf = today <= store.end ? today : shiftDate_(store.end, 1);
  var partial = asOf <= store.end;
  var facts = dailyFacts_();
  var closed = closedDates_();
  var config = config_();
  var budgets = storeSalesGoals_(config, store);
  var goals = approvedGoals_(config);
  var written = reportMonthFacts_('nwdsrWritten', facts, store, asOf, closed);
  var delivered = reportMonthFacts_('nwdsrDelivered', facts, store, asOf, closed);
  var ly = { confirmed: false, period: '', written: { value: null }, delivered: { value: null } };
  try { ly = briefLastYearStore_(config, store); } catch (error) { ly = ly; }
  var closing = { ratio: null, goal: closingGoal_(config), through: '', note: 'Store closing is Pending.' };
  try { closing = storeMonthClosing_(loadClosingView_(), store, closing.goal); } catch (error) { closing = closing; }
  var kpis = reportKpiMap_(store);
  function kpiSource(name) {
    var row = kpis[name] || {};
    var through = row.through || '';
    var note = row.note ? ' ' + row.note : '';
    if (briefBlank_(row.written)) return 'Not on the verified store KPI file for this store month.' + note;
    return 'Store KPI' + (through ? ' through ' + through : '') + '. Not a salesperson figure.' + note;
  }
  function dollarSource(pack, label) {
    if (pack.value === null) return label + ' is not on file for this store month. Not counted as zero. SNAP is not used.';
    return label + ' through ' + pack.through + (pack.missing.length ? '. Missing ' + reportDateList_(pack.missing) + ' not counted as zero.' : '.') + ' SNAP is not used.';
  }
  var rows = [
    reportScoreRow_('written', 'Written sales', written.value, budgets.written, 'dollars', dollarSource(written, 'NWDSR Written'), 'NWDSR Written', ly),
    reportScoreRow_('delivered', 'Delivered sales', delivered.value, budgets.delivered, 'dollars', dollarSource(delivered, 'NWDSR Delivered'), 'NWDSR Delivered', ly),
    reportScoreRow_('closing', 'Closing ratio', closing.ratio, closing.goal, 'percent', closing.ratio === null ? (closing.note || closing.gap || 'Store closing is Pending.') : ('Purchasing customers ÷ PERQ opportunities through ' + (closing.through || 'Pending') + '. Not SNAP.'), 'Closing ratio', ly),
    reportScoreRow_('ticket', 'Average ticket', kpis['Average Ticket'] ? kpis['Average Ticket'].written : null, goals.averageTicket, 'dollars', kpiSource('Average Ticket'), 'Average Ticket', ly),
    reportScoreRow_('bedding', 'Bedding', kpis.Bedding ? kpis.Bedding.written : null, goals.bedding, 'percent', kpiSource('Bedding'), 'Bedding', ly),
    reportScoreRow_('fabric', 'Fabric maintenance', kpis['Fabric Maintenance'] ? kpis['Fabric Maintenance'].written : null, goals.fabric, 'percent', kpiSource('Fabric Maintenance'), 'Fabric Maintenance', ly),
    reportScoreRow_('leather', 'Leather maintenance', kpis['Leather Maintenance'] ? kpis['Leather Maintenance'].written : null, goals.leather, 'percent', kpiSource('Leather Maintenance'), 'Leather Maintenance', ly),
    reportScoreRow_('power', 'Power upholstery', kpis['Power Upholstery'] ? kpis['Power Upholstery'].written : null, goals.power, 'percent', kpiSource('Power Upholstery'), 'Power Upholstery', ly),
    reportScoreRow_('pads', 'Mattress protectors', kpis['Mattress Protectors'] ? kpis['Mattress Protectors'].written : null, goals.mattress, 'percent', kpiSource('Mattress Protectors'), 'Mattress Protectors', ly),
    reportScoreRow_('rugs', 'Rugs sold', kpis.Rugs ? kpis.Rugs.written : null, goals.rugs, 'count', kpiSource('Rugs'), 'Rugs', ly),
  ];
  if (kpis.Finance && !briefBlank_(kpis.Finance.written)) rows.push(reportScoreRow_('finance', 'Financing', kpis.Finance.written, goals.finance, 'percent', kpiSource('Finance'), 'Finance', ly));
  if (kpis.Pillows && !briefBlank_(kpis.Pillows.written)) rows.push(reportScoreRow_('pillows', 'Pillows', kpis.Pillows.written, goals.pillow, 'percent', kpiSource('Pillows'), 'Pillows', ly));
  if (kpis['Adjustable Base Attachment'] && !briefBlank_(kpis['Adjustable Base Attachment'].written)) rows.push(reportScoreRow_('bases', 'Adjustable bases', kpis['Adjustable Base Attachment'].written, goals.adjustableBase, 'percent', kpiSource('Adjustable Base Attachment'), 'Adjustable Base Attachment', ly));
  var strengths = [];
  var gaps = [];
  rows.forEach(function (row) {
    if (row.status === 'hit' || row.status === 'even') strengths.push(row.label + ' is ' + row.actual + ' versus the budget ' + row.budget + '.');
    if (row.status === 'short') gaps.push(row);
  });
  strengths = strengths.slice(0, 3);
  var strengthFill = ['No metric on this page is at its budget.', 'No second verified strength.', 'No third verified strength.'];
  while (strengths.length < 3) strengths.push(strengthFill[strengths.length]);
  var dollarGaps = gaps.filter(function (row) { return row.key === 'written' || row.key === 'delivered'; });
  var otherGaps = gaps.filter(function (row) { return row.key !== 'written' && row.key !== 'delivered'; });
  otherGaps.sort(function (a, b) {
    if (a.ratio === null) return 1;
    if (b.ratio === null) return -1;
    return a.ratio - b.ratio;
  });
  var priorities = dollarGaps.concat(otherGaps).slice(0, 3).map(function (row) { return row.label + ' is ' + row.actual + ' versus ' + row.budget + '.'; });
  var gapFill = ['No verified gap is on this page.', 'No second verified gap.', 'No third verified gap.'];
  while (priorities.length < 3) priorities.push(gapFill[priorities.length]);
  var monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var monthName = monthNames[Number(String(store.start).slice(5, 7)) - 1] + ' ' + String(store.start).slice(0, 4);
  var snapLy = reportMonthSnapLy_(facts, closed, store, asOf);
  var assessment = 'Store 17, ' + briefDisplayDate_(store.start) + ' through ' + briefDisplayDate_(store.end) + (partial ? ', is still open. ' : '. ') +
    'NWDSR Written is ' + rows[0].actual + ' of the ' + rows[0].budget + ' budget' + (written.through ? ' through ' + briefDisplayDate_(written.through) : '') + '. ' +
    'NWDSR Delivered is ' + rows[1].actual + ' of the ' + rows[1].budget + ' budget' + (delivered.through ? ' through ' + briefDisplayDate_(delivered.through) : '') + '. ' +
    'These are the verified figures. This page does not explain why the result moved.';
  var focus = priorities[0].indexOf('No verified gap') === 0
    ? 'No verified gap is on file, so no next-month focus is set.'
    : ((partial ? 'Principal focus while this store month is still open: ' : 'Principal focus for the next store month: ') + priorities[0]);
  var partialLabel = partial ? 'Partial · store month in progress' : 'Completed store month';
  var verification = partialLabel + ' · Store 17 · ' + briefDisplayDate_(store.start) + ' through ' + briefDisplayDate_(store.end) + ' · prepared ' + briefDisplayDate_(today) +
    '. Written through ' + (written.through ? briefDisplayDate_(written.through) : 'Pending') + '. Delivered through ' + (delivered.through ? briefDisplayDate_(delivered.through) : 'Pending') +
    '. Closing through ' + (closing.through ? briefDisplayDate_(closing.through) : 'Pending') + '. Last year is ' + rows[0].ly + ' for NWDSR Written and ' + rows[1].ly + ' for NWDSR Delivered. No email sent.';
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'monthly',
    layout: 'monthly',
    ready: true,
    title: 'Monthly Executive Scorecard',
    partial: partial,
    partialLabel: partialLabel,
    date: store.end,
    displayDate: 'Store 17 · ' + monthName + ' · ' + briefDisplayDate_(store.start) + ' – ' + briefDisplayDate_(store.end),
    today: today,
    period: { start: store.start, end: store.end },
    storePeriod: store.start + ' through ' + store.end,
    individualPeriod: individualPeriodContaining_(store.start).start + ' through ' + individualPeriodContaining_(store.start).end,
    calendarNote: 'Store month is the 2nd through the 1st and uses NWDSR Written and Delivered. The salesperson month is the 1st through the last calendar day and is not this report. SNAP is not Store Written.',
    mail: false,
    verification: verification,
    rows: rows,
    lines: rows,
    snapLy: snapLy,
    assessment: assessment,
    summary: { strengths: strengths, priorities: priorities, focus: focus },
    winners: { status: 'pending', text: '', quiet: '', source: '', date: '' },
    priorities: [focus],
    prioritySource: 'From verified gaps only. Not emailed.',
    notice: 'Preview, print, or download this page. No email is sent.',
  };
}

function reportMonthlyPdf_(page) {
  var commands = [];
  function paint(r, g, b) { commands.push(r + ' ' + g + ' ' + b + ' rg'); }
  function text(x, y, size, value, bold) {
    commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + reportPdfEscape_(value) + ') Tj ET');
  }
  commands.push('0.06 0.13 0.16 rg 0 568 792 44 re f');
  commands.push('0.05 0.50 0.53 rg 0 562 792 6 re f');
  paint(1, 1, 1);
  text(36, 588, 8, "KANE'S FURNITURE  ·  STORE 17  ·  EXECUTIVE", true);
  text(36, 574, 13, 'Monthly Executive Scorecard', true);
  paint(0.06, 0.13, 0.16);
  text(36, 546, 9, reportAscii_(page.partialLabel) + '  ·  ' + reportAscii_(page.displayDate), true);
  var y = 532;
  reportWrap_(page.verification, 150).slice(0, 3).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  y -= 4;
  paint(0.05, 0.50, 0.53);
  text(36, y, 8, 'MEASURE', true);
  text(190, y, 8, 'ACTUAL', true);
  text(300, y, 8, 'PROGRESS', true);
  text(400, y, 8, 'VARIANCE', true);
  text(520, y, 8, 'BUDGET', true);
  text(640, y, 8, 'NWDSR LY', true);
  y -= 12;
  (page.rows || []).forEach(function (row) {
    paint(0.06, 0.13, 0.16);
    text(36, y, 8, row.label, true);
    var tone = reportTone_(row.status);
    paint(tone[0], tone[1], tone[2]);
    text(190, y, 8, row.actual, true);
    text(300, y, 8, row.progress, false);
    text(400, y, 8, row.variance, false);
    paint(0.06, 0.13, 0.16);
    text(520, y, 8, row.budget, true);
    text(640, y, 8, row.ly, false);
    y -= 14;
  });
  y -= 4;
  var snapLy = page.snapLy || {};
  paint(0.54, 0.42, 0.18);
  text(36, y, 8, 'WRITTEN COMPARISON  ·  SNAP WRITTEN LY', true);
  y -= 11;
  paint(0.06, 0.13, 0.16);
  reportBalanceCompact_(snapLy).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  y -= 2;
  paint(0.06, 0.13, 0.16);
  reportWrap_(page.assessment, 150).slice(0, 3).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  y -= 6;
  var summary = page.summary || {};
  var columnTop = y;
  function column(x, title, items, width) {
    paint(0.05, 0.50, 0.53);
    text(x, columnTop, 8, title, true);
    var row = columnTop - 12;
    paint(0.06, 0.13, 0.16);
    (items || []).slice(0, 3).forEach(function (item, index) {
      reportWrap_((index + 1) + '. ' + item, width).forEach(function (line) { text(x, row, 8, line, false); row -= 10; });
      row -= 2;
    });
    if (row < y) y = row;
  }
  column(36, 'STRENGTHS', summary.strengths, 48);
  column(290, 'IMPROVE', summary.priorities, 48);
  column(544, 'NEXT MONTH', [summary.focus || ''], 40);
  text(36, 18, 8, 'No email sent. Last year stays Pending until verified. SNAP is not Store Written.', false);
  return reportPdfFinish_(commands, '0 0 792 612');
}

function reportMeetingPick_(lines, key) {
  var found = null;
  (lines || []).forEach(function (line) { if (line.key === key) found = line; });
  return found;
}

function reportMeetingMoney_(text) {
  var cleaned = String(text || '').replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  var number = Number(cleaned);
  return isFinite(number) ? number : null;
}

function reportMeetingPerson_(page) {
  var performance = page.performance || [];
  var quality = page.quality || [];
  var ticket = reportMeetingPick_(performance, 'ticket');
  var weekTicket = !!(ticket && ticket.status !== 'pending' && String(ticket.source || '').indexOf('This week.') === 0);
  return {
    name: page.name,
    newHire: !!page.newHire,
    employed: reportMeetingPick_(performance, 'snap-week') ? reportMeetingPick_(performance, 'snap-week').result !== 'Not employed' : false,
    snapWeek: reportMeetingPick_(performance, 'snap-week'),
    snapMtd: reportMeetingPick_(performance, 'snap-mtd'),
    goal: reportMeetingPick_(performance, 'volume-goal'),
    percent: reportMeetingPick_(performance, 'volume-pct'),
    orders: reportMeetingPick_(performance, 'orders'),
    ticket: ticket,
    weekTicket: weekTicket,
    closing: reportMeetingPick_(performance, 'closing'),
    bedding: reportMeetingPick_(quality, 'bedding'),
    fabric: reportMeetingPick_(quality, 'fabric'),
    leather: reportMeetingPick_(quality, 'leather'),
    power: reportMeetingPick_(quality, 'power'),
    pads: reportMeetingPick_(quality, 'pads'),
    rugs: reportMeetingPick_(quality, 'rugs'),
    opportunity: (page.coaching && page.coaching.improvements && page.coaching.improvements[0]) || 'No verified coaching gap.',
    nextGoal: (page.coaching && page.coaching.goal) || 'Pending',
  };
}

function reportMeetingIllustrations_(session, weekly) {
  var recovery = null;
  var leak = null;
  try { recovery = recovery_({ session: session }); } catch (error) { recovery = null; }
  try { leak = leakage_({ session: session }); } catch (error) { leak = null; }
  var hypothetical = 'Illustration only. Not guaranteed sales and not commission.';
  var items = [];
  function moneyOrPending(value) { return value === null || value === undefined ? 'Pending' : moneyText_(value); }
  if (!recovery) {
    items.push({ label: '50% closing', value: 'Pending', note: hypothetical + ' The Sales Recovery Simulator could not be read.' });
    items.push({ label: '55% closing', value: 'Pending', note: hypothetical });
  } else {
    var at55 = recoveryScenario_(
      '55% closing',
      recovery.actual.written,
      recovery.budget,
      recovery.daysLeft,
      recovery.economics.dailyOpportunities,
      0.55,
      recovery.economics.dollarsPerCustomer,
      1,
      'Remaining open store days at 55% closing, the recent daily PERQ rate, and the verified NWDSR dollars per purchasing customer.'
    );
    items.push({
      label: '50% closing',
      value: moneyOrPending(recovery.goal.remaining),
      note: hypothetical + ' Remaining written dollars from the Sales Recovery Simulator if the rest of this store month closes at 50%. Month-end illustration ' + moneyOrPending(recovery.goal.monthEnd) + '. Not the meeting-week total.',
    });
    items.push({
      label: '55% closing',
      value: moneyOrPending(at55.remaining),
      note: hypothetical + ' Same simulator at 55% closing. Month-end illustration ' + moneyOrPending(at55.monthEnd) + '. Not added to the 50% illustration.',
    });
  }
  var ticket = leak && leak.store ? leak.store.ticket : null;
  items.push({
    label: '$2,500 average ticket',
    value: moneyOrPending(ticket),
    note: hypothetical + ' Sales Leakage Detector store ticket illustration. It is not added to the closing illustrations, and it is not the meeting-week ticket.',
  });
  var attachments = [];
  ((leak && leak.people) || []).forEach(function (person) {
    (person.attachments || []).forEach(function (row) {
      if (row.needed === null || row.needed === undefined || Number(row.needed) <= 0) return;
      attachments.push(person.name + ': ' + (row.label || row.key) + ' needs ' + row.needed + ' more on the verified eligible count. Dollar value Pending.');
    });
  });
  if (!attachments.length) attachments.push('No verified attachment count gap is on file. Dollar amounts stay Pending because no missed-attachment price is on file.');
  var pace = reportMeetingPick_(weekly.month, 'mtd-written-left');
  var help = pace && pace.versus && pace.versus !== 'Pending'
    ? ('The verified written pace on the weekly report is ' + pace.versus + '. That pace is not an illustration.')
    : 'The verified written pace is Pending on the weekly report.';
  if (recovery && recovery.goal && recovery.goal.reaches === true) help += ' The 50% closing illustration reaches the written budget. That result is not guaranteed.';
  else if (recovery && recovery.goal && recovery.goal.gap !== null && recovery.goal.gap !== undefined) help += ' The 50% closing illustration is still ' + moneyText_(recovery.goal.gap) + ' short of the written budget. That result is not guaranteed.';
  else help += ' Whether a closing illustration reaches the written budget stays Pending.';
  return { items: items, attachments: attachments.slice(0, 3), help: help, notice: 'Hypothetical amounts are labeled Illustration. They are not guaranteed sales or commission earnings, and they are not added to NWDSR or SNAP.' };
}

function reportMeetingRecognition_(weekly, people) {
  var items = [];
  if (weekly.people && weekly.people.pending) items.push('Top weekly salesperson is Pending. SNAP Written for the week is not complete, so nobody is ranked.');
  else if (weekly.people && weekly.people.top && weekly.people.top.length) items.push('Top weekly salesperson: ' + weekly.people.top[0].name + ', SNAP Written ' + moneyText_(weekly.people.top[0].written) + '. This is not NWDSR.');
  else items.push('No associate has verified SNAP Written in this week.');
  var best = null;
  people.forEach(function (person) {
    if (!person.weekTicket || !person.ticket) return;
    var amount = reportMeetingMoney_(person.ticket.result);
    if (amount === null) return;
    if (!best || amount > best.amount) best = { name: person.name, amount: amount, result: person.ticket.result };
  });
  if (best) items.push('Strongest verified week average ticket: ' + best.name + ' at ' + best.result + '. Group 17 for this week. Not SNAP dollars.');
  else items.push('No verified week average ticket is on file, so no ticket recognition is given.');
  var attached = [];
  people.forEach(function (person) {
    ['bedding', 'fabric', 'leather', 'power', 'pads'].forEach(function (key) {
      var line = person[key];
      if (line && (line.status === 'hit' || line.status === 'even')) attached.push(person.name + ' ' + line.label + ' is at the goal (' + line.result + ').');
    });
  });
  if (attached.length) items.push('Strong attachment: ' + attached.slice(0, 3).join(' '));
  else items.push('No verified attachment result is at its goal.');
  var lastYear = weekly.lastYear || {};
  if (lastYear.written && lastYear.written !== 'Pending') items.push('Verified last-year store written is ' + lastYear.written + '. A week-versus-week improvement is not on file.');
  else items.push('No prior comparable week is on file, so no improvement versus an earlier week is shown.');
  return items.slice(0, 4);
}

function reportMeeting_(payload, today) {
  var packet = String(payload && payload.packet || 'full') === 'executive' ? 'executive' : 'full';
  var request = { session: payload.session, span: 'completed', end: payload && (payload.end || payload.date) };
  var weekly = reportWeekly_(request, today);
  var people = [];
  if (packet === 'full') {
    reportAssociates_(today).forEach(function (name) {
      people.push(reportMeetingPerson_(reportIndividual_({ session: payload.session, span: 'completed', end: weekly.period.end, name: name }, today)));
    });
  }
  var illustrations = packet === 'full' ? reportMeetingIllustrations_(payload.session, weekly) : { items: [], attachments: [], help: '', notice: '' };
  var recognition = packet === 'full' ? reportMeetingRecognition_(weekly, people) : [];
  var due = shiftDate_(weekly.period.end, 7);
  var openActions = [];
  if (packet === 'full') {
    try { openActions = actionRank_(actionRows_(), today).slice(0, 3); } catch (error) { openActions = []; }
  }
  var followups = people.map(function (person) {
    return { name: person.name, text: person.nextGoal, owner: 'Store manager', due: due };
  });
  var partialLabel = weekly.partialLabel || 'Completed week';
  var verification = 'Monday Sales Meeting Packet · ' + partialLabel + ' · ' + weekly.displayDate + ' · prepared ' + briefDisplayDate_(today) +
    '. Section 1 uses the weekly executive report. Salesperson lines use each weekly salesperson report. Store dollars are NWDSR. Individual dollars are SNAP. ' +
    (packet === 'executive' ? 'Executive summary only. ' : '') + 'No email sent.';
  return {
    role: payload.session.role,
    version: APP_VERSION_,
    kind: 'meeting',
    layout: 'meeting',
    packet: packet,
    ready: true,
    title: packet === 'executive' ? 'Executive Summary' : 'Monday Sales Meeting Packet',
    partial: !!weekly.partial,
    partialLabel: partialLabel,
    date: weekly.period.end,
    displayDate: 'Store 17 · ' + weekly.displayDate,
    today: today,
    period: weekly.period,
    storePeriod: weekly.storePeriod,
    individualPeriod: weekly.individualPeriod,
    calendarNote: 'Store week and store month use NWDSR Written and Delivered. Salesperson lines use SNAP Written for the salesperson month. The two calendars are not added together.',
    mail: false,
    verification: verification,
    weekly: weekly.weekly,
    month: weekly.month,
    kpis: weekly.kpis,
    lastYear: weekly.lastYear,
    snapLy: weekly.snapLy,
    people: people,
    illustrations: illustrations,
    recognition: recognition,
    priorities: (weekly.summary && weekly.summary.priorities) || [],
    followups: followups,
    actions: openActions,
    actionDue: due,
    notes: 'Meeting notes stay on this printed page. Nothing is saved or emailed.',
    lines: weekly.lines,
    winners: { status: 'pending', text: '', quiet: '', source: '', date: '' },
    prioritySource: 'Store priorities come from the weekly executive report. Coaching goals come from each salesperson report. Open Action Center items are listed when they exist.',
    notice: 'Preview, print, or download this packet. No email is sent.',
  };
}

function reportPdfBook_(streams) {
  var objects = [];
  function add(body) { objects.push(body); return objects.length; }
  var font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  var font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  var pageIds = [];
  streams.forEach(function (commands) {
    var stream = commands.join('\n');
    var content = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    pageIds.push(add('<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 612 792] /Contents ' + content + ' 0 R /Resources << /Font << /F1 ' + font1 + ' 0 R /F2 ' + font2 + ' 0 R >> >> >>'));
  });
  var pages = add('<< /Type /Pages /Count ' + pageIds.length + ' /Kids [' + pageIds.map(function (id) { return id + ' 0 R'; }).join(' ') + '] >>');
  var catalog = add('<< /Type /Catalog /Pages ' + pages + ' 0 R >>');
  pageIds.forEach(function (id) {
    objects[id - 1] = objects[id - 1].replace('Parent PAGES 0 R', 'Parent ' + pages + ' 0 R');
  });
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

function reportMeetingPdf_(page) {
  var streams = [];
  var commands = [];
  var y = 720;
  var section = 'Store 17';
  function paint(r, g, b) { commands.push(r + ' ' + g + ' ' + b + ' rg'); }
  function text(x, yy, size, value, bold) {
    commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + yy.toFixed(1) + ' Td (' + reportPdfEscape_(value) + ') Tj ET');
  }
  function header() {
    commands.push('0.06 0.13 0.16 rg 0 742 612 50 re f');
    commands.push('0.05 0.50 0.53 rg 0 736 612 6 re f');
    paint(1, 1, 1);
    text(36, 766, 8, "KANE'S FURNITURE  ·  STORE 17", true);
    text(36, 750, 13, reportAscii_(page.title), true);
    paint(0.06, 0.13, 0.16);
    text(36, y, 9, reportAscii_(page.displayDate) + '  ·  ' + reportAscii_(section), true);
    y -= 16;
  }
  function finishPage() { streams.push(commands); }
  function nextPage(name) {
    if (commands.length) finishPage();
    commands = [];
    y = 720;
    section = name;
    header();
  }
  function need(height) { if (y < 40 + height) nextPage(section); }
  function paragraph(value, width, size) {
    reportWrap_(value, width).forEach(function (line) {
      need(12);
      text(36, y, size || 9, line, false);
      y -= 11;
    });
  }
  function row(label, result, extra) {
    need(13);
    paint(0.06, 0.13, 0.16);
    text(36, y, 9, label, true);
    text(168, y, 9, result, false);
    if (extra) text(300, y, 8, extra, false);
    y -= 12;
  }
  nextPage('Executive summary');
  paragraph(page.verification, 108, 8);
  y -= 2;
  (page.weekly || []).forEach(function (line) { row(line.label, line.result, line.goal || ''); });
  y -= 2;
  var snapLy = page.snapLy || {};
  paint(0.54, 0.42, 0.18);
  text(36, y, 9, 'WRITTEN COMPARISON', true);
  y -= 12;
  row('NWDSR Written', snapLy.nwdsr || 'Pending', snapLy.currentDates || '');
  row('SNAP Written', snapLy.current || 'Pending', 'Supplemental');
  row('NWDSR minus SNAP', snapLy.variance || 'Pending', 'Not removed from the store total');
  row('NWDSR Written LAST YEAR', snapLy.nwdsrLy || 'Pending', snapLy.lyDates || '');
  row('SNAP Written LY', snapLy.ly || 'Pending', 'LAST YEAR, not last month');
  y -= 2;
  text(36, y, 9, 'STORE-MONTH KPIs  ·  NOT THIS WEEK', true);
  y -= 13;
  (page.kpis || []).forEach(function (line) { row(line.label, line.result, line.goal || ''); });
  y -= 2;
  text(36, y, 9, 'STORE MONTH THROUGH THE WEEK', true);
  y -= 13;
  (page.month || []).forEach(function (line) { row(line.label, line.result, line.versus && line.versus !== 'Pending' ? line.versus : ''); });
  var lastYear = page.lastYear || {};
  row('NWDSR LY written', lastYear.written || 'Pending', '');
  row('NWDSR LY delivered', lastYear.delivered || 'Pending', 'Not invented');
  if (page.packet === 'executive') {
    finishPage();
  } else {
    var index = 0;
    while (index < (page.people || []).length) {
      nextPage('Sales team');
      var slot = 0;
      while (slot < 2 && index < page.people.length) {
        var person = page.people[index];
        need(188);
        paint(0.05, 0.50, 0.53);
        text(36, y, 11, person.name + (person.newHire ? '  ·  NEW HIRE' : ''), true);
        y -= 14;
        paint(0.06, 0.13, 0.16);
        [person.snapWeek, person.snapMtd, person.goal, person.percent, person.orders, person.ticket, person.closing, person.bedding, person.fabric, person.leather, person.power, person.pads, person.rugs].forEach(function (line) {
          if (!line) return;
          need(12);
          text(36, y, 8, line.label, true);
          text(170, y, 8, line.result, false);
          text(280, y, 8, line.goal || '', false);
          y -= 11;
        });
        paragraph('Coaching opportunity: ' + person.opportunity, 100, 8);
        paragraph('Coming week: ' + person.nextGoal, 100, 8);
        y -= 8;
        index += 1;
        slot += 1;
      }
    }
    nextPage('Sales opportunities');
    paragraph(page.illustrations.notice || '', 100, 8);
    y -= 4;
    (page.illustrations.items || []).forEach(function (item) {
      row(item.label, item.value, '');
      paragraph(item.note, 100, 8);
    });
    y -= 4;
    text(36, y, 9, 'ATTACHMENT OPPORTUNITIES', true);
    y -= 14;
    (page.illustrations.attachments || []).forEach(function (item, itemIndex) { paragraph((itemIndex + 1) + '. ' + item, 100, 8); });
    y -= 6;
    paragraph(page.illustrations.help || '', 100, 8);
    nextPage('Recognition');
    (page.recognition || []).forEach(function (item, itemIndex) { paragraph((itemIndex + 1) + '. ' + item, 100, 9); y -= 4; });
    nextPage('Management action plan');
    text(36, y, 9, 'STORE PRIORITIES', true);
    y -= 14;
    var priorities = page.priorities || [];
    if (!priorities.length) paragraph('No verified store priority is on the weekly report.', 100, 9);
    priorities.forEach(function (item, itemIndex) {
      paragraph((itemIndex + 1) + '. ' + item, 100, 9);
      paragraph('Manager responsible: Store manager. Due ' + page.actionDue + '.', 100, 8);
    });
    y -= 6;
    text(36, y, 9, 'COACHING FOLLOW-UP', true);
    y -= 14;
    (page.followups || []).forEach(function (item) {
      paragraph(item.name + ': ' + item.text + ' Owner ' + item.owner + '. Due ' + item.due + '.', 100, 8);
    });
    y -= 6;
    text(36, y, 9, 'ACTION CENTER', true);
    y -= 14;
    if (!(page.actions || []).length) paragraph('No open Action Center item is on file.', 100, 9);
    (page.actions || []).forEach(function (action) {
      paragraph(action.description + ' Owner ' + (action.assignee || 'Store manager') + '. Due ' + (action.due || 'Pending') + '. ' + action.status + '.', 100, 8);
    });
    y -= 8;
    text(36, y, 9, 'MEETING NOTES', true);
    y -= 16;
    paragraph(page.notes, 100, 8);
    var line = 0;
    while (line < 4) {
      need(16);
      commands.push('0.7 0.76 0.78 RG 36 ' + (y).toFixed(1) + ' m 560 ' + y.toFixed(1) + ' l S');
      y -= 16;
      line += 1;
    }
    finishPage();
  }
  var total = streams.length;
  streams.forEach(function (stream, streamIndex) {
    stream.push('BT /F1 8 Tf 36 22 Td (' + reportPdfEscape_('Page ' + (streamIndex + 1) + ' of ' + total + '  ·  No email sent') + ') Tj ET');
  });
  return reportPdfBook_(streams);
}

function reportCenter_(payload) {
  var today = todayNy_();
  var kind = String(payload && payload.kind || 'daily');
  if (kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly' && kind !== 'individual' && kind !== 'meeting' && kind !== 'trend') kind = 'daily';
  var locked = reportGuard_(payload, kind);
  if (locked) payload.name = locked;
  var page = kind === 'daily' ? reportDaily_(payload, today) : (kind === 'weekly' ? reportWeekly_(payload, today) : (kind === 'individual' ? reportIndividual_(payload, today) : (kind === 'monthly' ? reportMonthly_(payload, today) : (kind === 'meeting' ? reportMeeting_(payload, today) : (kind === 'trend' ? trend_(payload, today) : reportUnbuilt_(payload, today, kind))))));
  page.catalog = reportCatalog_(today);
  if (payload.session && payload.session.role === 'sales') page.catalog.kinds = [{ key: 'individual', label: 'My report', ready: true }];
  var pdf = '';
  if (page.ready && page.layout === 'weekly') pdf = reportWeeklyPdf_(page);
  else if (page.ready && page.layout === 'individual') pdf = reportIndividualPdf_(page);
  else if (page.ready && page.layout === 'monthly') pdf = reportMonthlyPdf_(page);
  else if (page.ready && page.layout === 'meeting') pdf = reportMeetingPdf_(page);
  else if (page.ready && page.layout === 'trend') pdf = trendPdf_(page);
  else if (page.ready) pdf = reportPdf_(page);
  page.pdf = pdf;
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
  y -= 4;
  if (y > 120 && page.writtenBalance) {
    paint(0.54, 0.42, 0.18);
    text(36, y, 9, 'WRITTEN COMPARISON  ·  SNAP WRITTEN LY', true);
    y -= 12;
    paint(0.06, 0.13, 0.16);
    reportBalanceCompact_(page.writtenBalance).forEach(function (line) {
      if (y < 96) return;
      text(36, y, 8, line, false);
      y -= 10;
    });
  }
  y -= 4;
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
      text(150, y, 8, line.result + (line.goal ? '  /  ' + line.goal : '') + (line.versus && line.versus !== 'On file' && line.versus !== 'Pending' ? '  ' + line.versus : '') + (line.caption ? '  ·  ' + line.caption : ''), true);
      y -= 10;
    });
    y -= 4;
  }
  band('WEEK', page.weekly || []);
  var snapLy = page.snapLy || {};
  paint(0.54, 0.42, 0.18);
  text(36, y, 8, 'WRITTEN COMPARISON  ·  SNAP WRITTEN LY', true);
  y -= 11;
  paint(0.06, 0.13, 0.16);
  reportBalanceCompact_(snapLy).forEach(function (line) {
    if (y < 86) return;
    text(36, y, 8, line, false);
    y -= 10;
  });
  y -= 2;
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

function reportIndividualPdf_(page) {
  var commands = [];
  function paint(r, g, b) { commands.push(r + ' ' + g + ' ' + b + ' rg'); }
  function text(x, y, size, value, bold) {
    commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + reportPdfEscape_(value) + ') Tj ET');
  }
  commands.push('0.06 0.13 0.16 rg 0 748 612 44 re f');
  commands.push('0.05 0.50 0.53 rg 0 742 612 6 re f');
  paint(1, 1, 1);
  text(36, 768, 8, "KANE'S FURNITURE  ·  STORE 17  ·  SALESPERSON", true);
  text(36, 754, 13, 'Weekly Salesperson Report', true);
  paint(0.06, 0.13, 0.16);
  text(36, 726, 10, reportAscii_(page.partialLabel) + '  ·  ' + reportAscii_(page.displayDate), true);
  var y = 712;
  reportWrap_(page.verification, 112).slice(0, 2).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  y -= 2;
  function band(title, rows) {
    paint(0.05, 0.50, 0.53);
    text(36, y, 9, title, true);
    y -= 11;
    rows.forEach(function (line) {
      if (y < 78) return;
      paint(0.06, 0.13, 0.16);
      text(36, y, 8, line.label, true);
      var tone = reportTone_(line.status);
      paint(tone[0], tone[1], tone[2]);
      text(168, y, 8, line.result + (line.goal ? '  /  ' + line.goal : ''), true);
      y -= 10;
    });
    y -= 2;
  }
  band('PERFORMANCE', page.performance || []);
  band('SALES QUALITY', page.quality || []);
  paint(0.05, 0.50, 0.53);
  text(36, y, 9, 'OPPORTUNITY', true);
  y -= 11;
  paint(0.06, 0.13, 0.16);
  (page.opportunity || []).slice(0, 3).forEach(function (item) {
    reportWrap_(item, 112).slice(0, 1).forEach(function (line) { text(36, y, 8, line, false); y -= 10; });
  });
  var coaching = page.coaching || {};
  paint(0.05, 0.50, 0.53);
  text(36, y, 8, 'STRENGTHS', true);
  text(230, y, 8, 'IMPROVE', true);
  text(420, y, 8, 'NEXT WEEK', true);
  y -= 11;
  paint(0.06, 0.13, 0.16);
  var row = y;
  (coaching.strengths || []).slice(0, 2).forEach(function (item, index) {
    reportWrap_((index + 1) + '. ' + item, 32).slice(0, 2).forEach(function (line) { text(36, row, 7.5, line, false); row -= 9; });
  });
  row = y;
  (coaching.improvements || []).slice(0, 2).forEach(function (item, index) {
    reportWrap_((index + 1) + '. ' + item, 32).slice(0, 2).forEach(function (line) { text(230, row, 7.5, line, false); row -= 9; });
  });
  reportWrap_(coaching.goal || '', 32).slice(0, 3).forEach(function (line) { text(420, y, 7.5, line, false); y -= 9; });
  text(36, 36, 8, 'Manager notes:', true);
  commands.push('0.7 0.76 0.78 RG 36 28 m 560 28 l S');
  commands.push('36 16 m 560 16 l S');
  text(36, 6, 7, 'No email sent. Notes on this page are not saved.', false);
  return reportPdfFinish_(commands);
}

function reportPdfFinish_(commands, box) {
  var stream = commands.join('\n');
  var objects = [];
  function add(body) { objects.push(body); return objects.length; }
  var font1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  var font2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  var content = add('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
  var pageId = add('<< /Type /Page /Parent PAGES 0 R /MediaBox [' + (box || '0 0 612 792') + '] /Contents ' + content + ' 0 R /Resources << /Font << /F1 ' + font1 + ' 0 R /F2 ' + font2 + ' 0 R >> >> >>');
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
