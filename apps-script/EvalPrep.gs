/**
 * Manager preview of a three-month review from the salesperson months already on file.
 * It does not write sales, evaluation rows, comments, or signatures.
 * The workbook download uses the evaluation workbook already used for Store 17 historical reviews.
 */

var EVAL_PREP_FORM_ = 'This is a draft for the manager to review. The download uses the evaluation workbook already used for Store 17 historical reviews. No separate corporate PDF is on file; send that template if a different form should be used. Employee comments and signature lines are left blank.';

function evalPrepBlank_(value) {
  return value === null || value === undefined || value === '';
}

function evalPrepServiceMonth_(hire, monthStart) {
  if (!hire) return null;
  var hired = isoParts_(hire);
  var month = isoParts_(monthStart);
  return (month.year - hired.year) * 12 + (month.month - hired.month) + 1;
}

function evalPrepVolumeGoal_(serviceMonth) {
  if (serviceMonth === null) return { amount: null, text: 'Pending', note: 'Hire date is not on file, so the tenure-adjusted written goal stays Pending.' };
  if (serviceMonth < 1) return { amount: null, text: 'Not employed', note: 'This month is before the hire date.' };
  if (serviceMonth === 1) return { amount: 0, text: '$0', note: 'Month 1 is a training month. The written goal is $0.' };
  if (serviceMonth === 2 || serviceMonth === 3) return { amount: 45000, text: '$45,000', note: 'New-hire written goal for month ' + serviceMonth + ' is $45,000.' };
  return { amount: 65000, text: '$65,000', note: 'Month 4 onward uses the $65,000 written goal.' };
}

function evalPrepRateGoal_(key, newHire) {
  var metric = null;
  EVAL_METRICS_.forEach(function (row) { if (row.key === key) metric = row; });
  if (!metric) return null;
  var goal = newHire ? metric.newHire : metric.standard;
  if (goal && typeof goal === 'object') return goal.count;
  return goal === undefined ? null : goal;
}

function evalPrepLine_(person, key) {
  var lines = person.attachments && person.attachments.written ? person.attachments.written.lines : [];
  var found = null;
  lines.forEach(function (line) { if (line.key === key) found = line; });
  return found;
}

function evalPrepHold_(month, hire, today, leave) {
  if (hire && hire > month.end) return 'before';
  var notes = [];
  if (today <= month.end) notes.push('This month is still open, so the figure is not scored.');
  if (hire && hire > month.start && hire <= month.end) {
    var end = month.end < today ? month.end : today;
    notes.push('Hired ' + hire + ', so this month covers ' + (daysBetween_(hire, end) + 1) + ' calendar days. It is not scored against a full-month goal.');
  }
  if (leave && month.start.slice(0, 7) === '2026-10') notes.push(leave + ' Written results for this month are not scored against the full monthly goal.');
  return notes.length ? notes.join(' ') : '';
}

function evalPrepCell_(actual, goal, unit, hold, pendingNote) {
  if (hold === 'before') return { status: 'Not employed', value: null, text: 'Not yet hired', unit: unit, scored: false, met: null, note: 'Hired after this month.', goal: goal };
  if (evalPrepBlank_(actual)) return { status: 'Pending Verification', value: null, text: 'Pending', unit: unit, scored: false, met: null, note: pendingNote || 'Not on file. Not shown as zero.', goal: goal };
  var scored = !hold && !evalPrepBlank_(goal);
  var met = scored ? Number(actual) + 1e-9 >= Number(goal) : null;
  return { status: 'Verified', value: Number(actual), text: evalNumberText_(actual, unit), unit: unit, scored: scored, met: met, note: hold || '', goal: goal };
}

function evalPrepMetric_(key, label, source, unit, goal, cells) {
  var verified = cells.filter(function (cell) { return cell.met !== null; });
  return {
    key: key, label: label, source: source, unit: unit,
    goal: goal, goalText: evalPrepBlank_(goal) ? 'Pending' : evalGoalText_(goal, unit),
    values: cells,
    metText: verified.length ? verified.filter(function (cell) { return cell.met; }).length + ' of ' + verified.length : '—',
  };
}

function evalPrepCard_(row, packs, info, today) {
  var hire = isoDate_(row.hire_date);
  var lastService = evalPrepServiceMonth_(hire, info.months[2].start);
  var newHire = lastService !== null && lastService >= 1 && lastService < 4;
  var people = packs.map(function (pack) {
    var found = null;
    pack.people.forEach(function (person) { if (person.name === String(row.name)) found = person; });
    return found;
  });
  function rateCells(read, goal, unit, pendingNote) {
    return info.months.map(function (month, index) {
      var person = people[index] || { snapWritten: null, leave: '' };
      var hold = evalPrepHold_(month, hire, today, person.leave || '');
      var actual = hold === 'before' ? null : read(person);
      return evalPrepCell_(actual, goal, unit, hold, pendingNote);
    });
  }
  var volumeCells = info.months.map(function (month, index) {
    var person = people[index] || { snapWritten: null, leave: '' };
    var service = evalPrepServiceMonth_(hire, month.start);
    var goal = evalPrepVolumeGoal_(service);
    var hold = evalPrepHold_(month, hire, today, person.leave || '');
    var cell = evalPrepCell_(hold === 'before' ? null : person.snapWritten, goal.amount, 'dollars', hold, 'SNAP Written for this month is not on file. It is not shown as zero.');
    cell.goal = goal.amount;
    cell.goalText = goal.text;
    cell.note = [goal.note, cell.note].filter(Boolean).join(' ');
    if (goal.amount === 0) cell.met = null;
    return cell;
  });
  var ticketGoal = evalPrepRateGoal_('average', newHire);
  var beddingGoal = evalPrepRateGoal_('mattress', newHire);
  var fabricGoal = evalPrepRateGoal_('fabric', newHire);
  var leatherGoal = evalPrepRateGoal_('leather', newHire);
  var powerGoal = evalPrepRateGoal_('power', newHire);
  var padGoal = evalPrepRateGoal_('protector', newHire);
  var financeGoal = evalPrepRateGoal_('finance', newHire);
  var rugGoal = evalPrepRateGoal_('rugs', newHire);
  function written(person, field) {
    var side = person.analysis && person.analysis.written;
    if (!side) return null;
    if (field === 'average') return side.average && side.average.value !== undefined ? side.average.value : null;
    if (field === 'bedding') return side.bedding && side.bedding.value !== undefined ? side.bedding.value : null;
    if (field === 'finance') return side.finance && side.finance.value !== undefined ? side.finance.value : null;
    return null;
  }
  function attach(person, key) {
    var line = evalPrepLine_(person, key);
    if (!line || line.status === 'na' || line.status === 'pending') return null;
    return line.actual;
  }
  var metrics = [
    evalPrepMetric_('volume', 'Written sales (SNAP)', 'SNAP Written by salesperson', 'dollars', null, volumeCells),
    evalPrepMetric_('average', 'Average ticket', 'Group 17 written sales ÷ written orders', 'dollars', ticketGoal, rateCells(function (person) { return written(person, 'average'); }, ticketGoal, 'dollars', 'Group 17 written orders are not on file.')),
    evalPrepMetric_('closing', 'Closing ratio', 'Group 17 written orders ÷ PERQ opportunities', 'percent', 0.5, rateCells(function (person) { return person.closingRatio; }, 0.5, 'percent', 'Individual closing is not on file for this month.')),
    evalPrepMetric_('bedding', 'Bedding', 'Bedding dollars ÷ Group 17 written sales', 'percent', beddingGoal, rateCells(function (person) { return written(person, 'bedding'); }, beddingGoal, 'percent', 'Bedding is not on file for this month.')),
    evalPrepMetric_('fabric', 'Fabric maintenance', 'Group 17 fabric protection', 'percent', fabricGoal, rateCells(function (person) { return attach(person, 'fabric'); }, fabricGoal, 'percent', 'No qualifying fabric items are on file.')),
    evalPrepMetric_('leather', 'Leather maintenance', 'Group 17 leather protection', 'percent', leatherGoal, rateCells(function (person) { return attach(person, 'leather'); }, leatherGoal, 'percent', 'No qualifying leather items are on file.')),
    evalPrepMetric_('power', 'Power upholstery', 'Group 17 power protection', 'percent', powerGoal, rateCells(function (person) { return attach(person, 'power'); }, powerGoal, 'percent', 'No qualifying power items are on file.')),
    evalPrepMetric_('protector', 'Mattress protectors', 'Group 17 mattress protectors', 'percent', padGoal, rateCells(function (person) { return attach(person, 'pads'); }, padGoal, 'percent', 'No qualifying mattresses are on file.')),
    evalPrepMetric_('finance', 'Financing', 'Financed dollars ÷ Group 17 written sales', 'percent', financeGoal, rateCells(function (person) { return written(person, 'finance'); }, financeGoal, 'percent', 'Financing is not on file for this month.')),
  ];
  var rugCells = info.months.map(function () {
    return { status: 'Pending Verification', value: null, text: 'Pending', unit: 'count', scored: false, met: null, note: 'No salesperson rug count is on file. ASL rugs are a store total.', goal: rugGoal };
  });
  metrics.push(evalPrepMetric_('rugs', 'Rugs', 'Not on a salesperson report', 'count', rugGoal, rugCells));
  metrics[0].goalText = 'Tenure schedule';
  var employed = volumeCells.filter(function (cell) { return cell.status !== 'Not employed'; });
  var pendingVolume = employed.some(function (cell) { return cell.status !== 'Verified'; });
  var three = null;
  if (!pendingVolume && employed.length) {
    three = 0;
    employed.forEach(function (cell) { three += Number(cell.value); });
    three = Math.round(three * 100) / 100;
  }
  var misses = [];
  metrics.forEach(function (metric) {
    if (metric.key === 'rugs' || metric.key === 'volume' && metric.values.every(function (cell) { return cell.goal === 0 || cell.goal === null || cell.met !== false; })) return;
    var latest = null;
    metric.values.forEach(function (cell, index) { if (cell.met === false) latest = { cell: cell, index: index }; });
    if (!latest || !latest.cell.goal) return;
    misses.push({ metric: metric, index: latest.index, gap: (Number(latest.cell.goal) - Number(latest.cell.value)) / Math.abs(Number(latest.cell.goal)) });
  });
  misses.sort(function (left, right) { return right.gap - left.gap; });
  var focus = misses.slice(0, 2).map(function (item) {
    var month = info.months[item.index];
    var cell = item.metric.values[item.index];
    var advice = EVAL_ADVICE_[item.metric.key] || EVAL_ADVICE_[item.metric.key === 'bedding' ? 'mattress' : item.metric.key] || '';
    if (item.metric.key === 'bedding') advice = EVAL_ADVICE_.mattress;
    if (item.metric.key === 'protector') advice = EVAL_ADVICE_.protector;
    if (item.metric.key === 'closing') advice = 'Review that month\'s PERQ opportunities and Group 17 written orders with the associate.';
    var goalText = item.metric.key === 'volume' ? (cell.goalText || item.metric.goalText) : item.metric.goalText;
    return {
      metric: item.metric.label,
      prior: month.name + ' ' + cell.text,
      goal: goalText,
      plan: month.name + ' result: ' + cell.text + ' versus ' + goalText + '. ' + advice + ' Measured on ' + item.metric.source + ' for the next calendar month. The month meets the goal when that report is at or above ' + goalText + '.',
    };
  });
  var strengths = [];
  metrics.forEach(function (metric) {
    var months = [];
    metric.values.forEach(function (cell, index) { if (cell.met === true) months.push(info.months[index].name); });
    if (months.length) strengths.push(metric.label + ' is at the goal in ' + months.join(' and ') + '.');
  });
  var nextStart = shiftMonth_(info.months[2].key, 1);
  var nextService = evalPrepServiceMonth_(hire, nextStart + '-01');
  var nextGoal = evalPrepVolumeGoal_(nextService);
  var short = String(row.preferred_name || String(row.name).split(' ')[0]);
  var writtenNote = three === null ? 'Three-month written sales stay Pending until every employed month has SNAP Written on file.' : 'Written sales on the employed months in this review add to ' + moneyText_(three) + '. An open or partial month is included in that sum and is not scored as a miss.';
  var comments = 'Draft for the manager to edit before any evaluation is final. ' + short + ' ' + writtenNote + (focus.length ? ' The draft focus areas are ' + focus.map(function (item) { return item.metric; }).join(' and ') + '.' : ' No verified, scored metric is below its goal.');
  if (!strengths.length) comments += ' No scored metric is at its goal yet. Pending items are not treated as misses.';
  return {
    name: String(row.name),
    preferred: short,
    employeeId: String(row.employee_id || ''),
    hireDate: hire,
    position: String(row.position || ''),
    status: String(row.status || ''),
    statusEffective: isoDate_(row.status_effective),
    priorStatus: String(row.prior_status || ''),
    history: String(row.roster_note || ''),
    newHire: newHire,
    serviceMonth: lastService,
    months: info.months.map(function (month) { return { key: month.key, name: month.name, label: month.label, start: month.start, end: month.end }; }),
    volumeGoals: volumeCells.map(function (cell) { return { goal: cell.goal, text: cell.goalText }; }),
    threeMonthWritten: three,
    threeMonthNote: writtenNote,
    metrics: metrics,
    strengths: strengths.slice(0, 4),
    focus: focus,
    nextGoal: { month: monthLabel_(nextStart), amount: nextGoal.amount, text: nextGoal.text, note: nextGoal.note },
    recognition: strengths.length ? strengths.join(' ') : 'No scored metric is at its goal yet. Pending and partial months are not treated as misses.',
    comments: comments,
    orders: info.months.map(function (month, index) {
      var person = people[index];
      var side = person && person.analysis && person.analysis.written;
      return { month: month.name, orders: side ? side.orders : null, through: side ? side.through : '' };
    }),
  };
}

function evalPrepContext_(cycle, today) {
  var info = evalCycleInfo_(cycle);
  var packs = info.months.map(function (month) {
    return { people: peopleRows_(month.start, month.end, { cachedSnap: false }) };
  });
  var cards = sheet_('CC_People').filter(function (row) { return rosterRole_(row, today) === 'associate'; }).map(function (row) {
    return evalPrepCard_(row, packs, info, today);
  }).sort(function (left, right) { return left.name < right.name ? -1 : 1; });
  return { info: info, cards: cards };
}

function evalPrep_(payload) {
  var today = todayNy_();
  var cycle = payload.cycle ? String(payload.cycle) : evaluationCycle_(today).cycle;
  var context = evalPrepContext_(cycle, today);
  var current = evaluationCycle_(today).cycle;
  return {
    role: payload.session.role,
    today: today,
    cycle: cycle,
    label: context.info.label,
    prepare: context.info.prepare,
    deliverBy: context.info.deliverBy,
    months: context.info.months,
    calendar: 'Salesperson months, the 1st through the last calendar day. Store totals are not changed.',
    form: EVAL_PREP_FORM_,
    cycles: [0, -1, -2].map(function (delta) {
      var key = shiftMonth_(current, delta);
      var item = evalCycleInfo_(key);
      return { cycle: key, label: item.label + ' · ' + item.months[0].name + '–' + item.months[2].name };
    }),
    cards: context.cards,
  };
}

function evalPrepWorkbookCard_(card, info) {
  var metrics = card.metrics.map(function (metric) {
    return {
      key: metric.key, label: metric.label, source: metric.source, unit: metric.unit,
      goal: metric.key === 'volume' ? null : metric.goal,
      goalText: metric.goalText,
      values: metric.values.map(function (cell) {
        return { status: cell.status, value: cell.value, unit: cell.unit || metric.unit, text: cell.text, met: cell.met, source: metric.source, note: cell.note || '' };
      }),
      metText: metric.metText,
    };
  });
  var focus = [0, 1].map(function (index) { return card.focus[index] || { metric: '', prior: '', goal: '', plan: '' }; });
  return {
    cycle: info.cycle,
    cycleLabel: info.label,
    months: info.months,
    prepare: info.prepare,
    deliverBy: info.deliverBy,
    name: card.name,
    shortName: card.preferred,
    employeeId: card.employeeId,
    hireDate: card.hireDate,
    tenureDays: card.hireDate ? daysBetween_(card.hireDate, info.prepare) : null,
    template: card.newHire ? 'newHire' : 'standard',
    tenureLabel: card.newHire ? 'NEW HIRE (under four months)' : 'Standard',
    templateLabel: card.newHire ? 'NEW HIRE (under four months)' : '3-Month Performance and Coaching Evaluation',
    status: 'Draft for manager review',
    revision: 0,
    verification: metrics.some(function (metric) { return metric.values.some(function (cell) { return cell.status === 'Pending Verification'; }); }) ? 'Pending Verification' : 'Verified',
    pendingMonths: [],
    volumeGoal: null,
    volumeGoalNote: 'Written goals follow tenure: month 1 is $0, months 2 and 3 are $45,000, and month 4 onward is $65,000. ' + card.threeMonthNote,
    metrics: metrics,
    focus: focus,
    recognition: card.recognition,
    comments: card.comments,
    managerName: '',
    preparedAt: new Date().toISOString(),
    approvedAt: '',
    givenOn: '',
  };
}

function evalPrepWorkbook_(payload) {
  var today = todayNy_();
  var cycle = payload.cycle ? String(payload.cycle) : evaluationCycle_(today).cycle;
  var context = evalPrepContext_(cycle, today);
  var names = payload.names && payload.names.length ? payload.names : null;
  var chosen = context.cards.filter(function (card) { return !names || names.indexOf(card.name) !== -1; });
  if (!chosen.length) throw new Error('Choose at least one associate.');
  var evaluations = chosen.map(function (card) { return evalPrepWorkbookCard_(card, context.info); });
  var bytes = evalWorkbookBytes_(evaluations, context.info);
  var fileName = 'Store17_Eval_Draft_' + context.info.label.replace(' ', '_') + (chosen.length === 1 ? '_' + safeFilePart_(chosen[0].name) : '') + '.xlsx';
  return { fileName: fileName, base64: bytesBase64_(bytes), draft: true };
}
