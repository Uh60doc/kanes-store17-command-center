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
  var scope = through ? ('Store month through ' + through + (through < reportDate ? '. Does not include ' + reportDate : '') + '. ' + (row.note || '')) : (row.note || 'Store month. Through date is Pending.');
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
    reportMoneyLine_('written', 'NWDSR Written', writtenDay.pending ? null : writtenDay.value, writtenPace, (writtenDay.pending ? 'NWDSR Written for ' + date + ' is not on file.' : labels.written + ' for ' + date) + dayNote),
    reportMoneyLine_('delivered', 'NWDSR Delivered', deliveredDay.pending ? null : deliveredDay.value, deliveredPace, (deliveredDay.pending ? 'NWDSR Delivered for ' + date + ' is not on file.' : labels.delivered + ' for ' + date) + dayNote),
    reportLine_('written-pace', 'Written pace', briefBlank_(writtenPace) ? 'Pending' : moneyText_(writtenPace), briefBlank_(budgets.written) ? 'Pending' : moneyText_(budgets.written), briefBlank_(writtenPace) ? 'Pending' : 'Required pace', briefBlank_(writtenPace) ? 'pending' : 'ready', 'Remaining store written budget divided by open days left, including ' + date + '. A saved goal counts only on the NWDSR basis.', null),
    reportLine_('delivered-pace', 'Delivered pace', briefBlank_(deliveredPace) ? 'Pending' : moneyText_(deliveredPace), briefBlank_(budgets.delivered) ? 'Pending' : moneyText_(budgets.delivered), briefBlank_(deliveredPace) ? 'Pending' : 'Required pace', briefBlank_(deliveredPace) ? 'pending' : 'ready', 'Remaining store delivered budget divided by open days left, including ' + date + '.', null),
    reportMoneyLine_('written-mtd', 'Written MTD', writtenThrough && writtenThrough <= date ? writtenMtd : null, budgets.written, writtenThrough ? ('NWDSR Written ' + store.start + ' through ' + writtenThrough + (writtenThrough < date ? '. ' + date + ' is not included.' : '')) : ('NWDSR Written month to date is Pending for ' + date)),
    reportMoneyLine_('delivered-mtd', 'Delivered MTD', deliveredThrough && deliveredThrough <= date ? deliveredMtd : null, budgets.delivered, deliveredThrough ? ('NWDSR Delivered ' + store.start + ' through ' + deliveredThrough + (deliveredThrough < date ? '. ' + date + ' is not included.' : '')) : ('NWDSR Delivered month to date is Pending for ' + date)),
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
    briefBlank_(dayClosing.ratio) ? (dayClosing.note || ('Store closing for ' + date + ' is Pending. Not estimated.')) : (dayClosing.customers + ' purchasing customers divided by ' + dayClosing.opportunities + ' PERQ opportunities.'),
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
    monthThrough ? ('Store closing month to date through ' + monthThrough + (monthThrough < date ? '. Later days stay Pending.' : '') + (monthClosing.customers !== null ? ' ' + monthClosing.customers + ' purchasing customers / ' + monthClosing.opportunities + ' opportunities.' : '')) : 'Store closing month to date is Pending.',
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
      { key: 'weekly', label: 'Weekly', ready: false },
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

function reportCenter_(payload) {
  var today = todayNy_();
  var kind = String(payload && payload.kind || 'daily');
  if (kind !== 'daily' && kind !== 'weekly' && kind !== 'monthly' && kind !== 'individual') kind = 'daily';
  var page = kind === 'daily' ? reportDaily_(payload, today) : reportUnbuilt_(payload, today, kind);
  page.catalog = reportCatalog_(today);
  page.pdf = page.ready ? reportPdf_(page) : '';
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
