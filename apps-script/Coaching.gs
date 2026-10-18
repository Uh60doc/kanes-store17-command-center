/**
 * Manager coaching cards. One page per active associate from the salesperson month already on file.
 * Ticket dollars use opportunityTicket_. Protection and rug earnings use the Goal coach rules.
 * A missing figure stays Pending. Nothing here is saved, and no commission is called payroll.
 */

var COACH_ACTIONS_ = {
  average: 'Practice presenting the complete room before price, using the evaluation step for average sale.',
  closing: 'Practice the next be-back: confirm the room they want and ask for the order before they leave.',
  bedding: 'Practice bringing up sleep on a furniture sale and walking the mattress gallery.',
  fabric: 'Practice presenting fabric protection on an upholstered piece before the price.',
  leather: 'Practice presenting leather protection and the coverage for cracking, fading, and spills.',
  power: 'Practice presenting power protection on a power piece before the price.',
  pads: 'Practice presenting the mattress protector with a mattress and tying it to the warranty.',
  volume: 'Practice setting one call-back appointment from an open quote before the shift ends.',
};

function coachBlank_(value) {
  return value === null || value === undefined || value === '';
}

function coachGap_(actual, goal) {
  if (coachBlank_(actual) || coachBlank_(goal) || Number(goal) === 0) return null;
  if (Number(actual) + 1e-9 >= Number(goal)) return null;
  return (Number(goal) - Number(actual)) / Math.abs(Number(goal));
}

function coachLine_(key, label, actual, goal, unit, now, goalText, additional) {
  var gap = coachGap_(actual, goal);
  return {
    key: key,
    label: label,
    actual: coachBlank_(actual) ? null : actual,
    goal: coachBlank_(goal) ? null : goal,
    unit: unit,
    gap: gap,
    now: now,
    goalText: goalText,
    additional: additional,
    action: COACH_ACTIONS_[key] || '',
    strength: gap === null && !coachBlank_(actual) && !coachBlank_(goal),
  };
}

function coachAttach_(lines, key) {
  var found = null;
  (lines || []).forEach(function (line) { if (line.key === key) found = line; });
  return found;
}

function coachMoneyOrPending_(value) {
  return coachBlank_(value) ? 'Pending' : moneyText_(value);
}

function coachPercentOrPending_(value) {
  return coachBlank_(value) ? 'Pending' : percentText_(value);
}

function coachCard_(person, hire, period) {
  hire = hire || { newHire: false, hired: '', days: null };
  var written = person.analysis && person.analysis.written;
  var ticketGoal = hire.newHire ? 2100 : OPP_TICKET_GOAL_;
  var orders = written ? written.orders : null;
  var groupSales = written ? written.sales : null;
  var ticket = opportunityTicket_(orders, groupSales, ticketGoal);
  var beddingGoal = hire.newHire ? 0.15 : null;
  var padGoal = hire.newHire ? 0.6 : null;
  var bedding = written && written.bedding ? written.bedding.value : null;
  var kpis = {};
  (person.kpis || []).forEach(function (row) { kpis[row.name] = row; });
  if (beddingGoal === null && kpis.Bedding) beddingGoal = kpis.Bedding.goal;
  var attach = person.attachments && person.attachments.written ? person.attachments.written.lines : [];
  var fabric = coachAttach_(attach, 'fabric');
  var leather = coachAttach_(attach, 'leather');
  var power = coachAttach_(attach, 'power');
  var pads = coachAttach_(attach, 'pads');
  var fabricGoal = fabric && fabric.goal !== null ? fabric.goal : (kpis.Fabric ? kpis.Fabric.goal : null);
  var leatherGoal = leather && leather.goal !== null ? leather.goal : (kpis.Leather ? kpis.Leather.goal : null);
  var powerGoal = power && power.goal !== null ? power.goal : (kpis.Power ? kpis.Power.goal : null);
  if (padGoal === null) padGoal = pads && pads.goal !== null ? pads.goal : (kpis['Mattress Pads'] ? kpis['Mattress Pads'].goal : null);
  var closingGoal = person.closing && !coachBlank_(person.closing.goal) ? person.closing.goal : 0.5;
  var moreOrders = null;
  if (!coachBlank_(person.closingRatio) && !coachBlank_(person.opportunities) && Number(person.opportunities) > 0 && !coachBlank_(person.closingOrders)) {
    moreOrders = Math.max(0, Math.ceil(Number(closingGoal) * Number(person.opportunities) - Number(person.closingOrders)));
  }
  var lines = [
    coachLine_('average', 'Average ticket', ticket.average, ticketGoal, 'dollars',
      ticket.status === 'ready' ? ticket.orders + ' Group 17 written orders average ' + moneyText_(ticket.average) + '.' : (ticket.status === 'No orders' ? 'No Group 17 written orders are on file.' : 'Group 17 written orders or written sales are not both on file.'),
      (hire.newHire ? 'New-hire average-ticket goal ' : 'Average-ticket goal ') + moneyText_(ticketGoal) + '.',
      ticket.status === 'ready' && ticket.opportunity > 0 ? 'The same ' + ticket.orders + ' orders at ' + moneyText_(ticketGoal) + ' are ' + moneyText_(ticket.hypothetical) + ', which is ' + moneyText_(ticket.opportunity) + ' more Group 17 written sales. This is the Goal coach figure and it is not commission.' : 'No additional ticket dollars are calculated.'),
    coachLine_('closing', 'Closing ratio', person.closingRatio, closingGoal, 'percent',
      coachBlank_(person.closingRatio) ? 'Individual closing is Pending. ' + (person.closingNote || '') : percentText_(person.closingRatio) + ' from ' + person.closingOrders + ' Group 17 written orders and ' + person.opportunities + ' PERQ opportunities' + (person.closingThrough ? ' through ' + person.closingThrough : '') + '.',
      percentText_(closingGoal) + ' individual closing goal. This is not the store closing ratio.',
      moreOrders === null ? 'The extra orders to reach the goal are Pending until both counts are on file.' : (moreOrders ? moreOrders + ' more Group 17 written orders on the same PERQ opportunities would reach the goal. That count is not a forecast of new customers.' : 'The closing count on file is already at the goal.')),
    coachLine_('bedding', 'Bedding', bedding, beddingGoal, 'percent',
      coachBlank_(bedding) ? 'Bedding contribution is Pending.' : 'Bedding is ' + percentText_(bedding) + ' of Group 17 written sales' + (written && written.through ? ' through ' + written.through : '') + '.',
      coachBlank_(beddingGoal) ? 'Bedding goal is Pending.' : (hire.newHire ? 'New-hire bedding goal ' : 'Bedding goal ') + percentText_(beddingGoal) + '.',
      'The card does not invent bedding dollars beyond the Group 17 rate on file.'),
  ];
  function attachLine(key, label, row, goal, newHireNote) {
    var actual = row && row.status !== 'na' ? row.actual : null;
    var needed = row && row.needed !== null && row.needed !== undefined ? row.needed : null;
    return coachLine_(key, label, actual, goal, 'percent',
      coachBlank_(actual) ? label + ' is Pending. No qualifying items are on the Group 17 written report for this associate.' : label + ' is ' + percentText_(actual) + (row.sold !== null ? ' (' + row.sold + ' of ' + row.qualified + ').' : '.'),
      coachBlank_(goal) ? label + ' goal is Pending.' : (newHireNote || label + ' goal ') + percentText_(goal) + '.',
      needed === null ? 'Additional attachments are Pending.' : (needed ? needed + ' more attachment' + (Number(needed) === 1 ? '' : 's') + ' on the qualified items already on file would reach the goal.' : 'The attachment count on file is already at the goal.'));
  }
  lines.push(attachLine('fabric', 'Fabric maintenance', fabric, fabricGoal, ''));
  lines.push(attachLine('leather', 'Leather maintenance', leather, leatherGoal, ''));
  lines.push(attachLine('power', 'Power upholstery', power, powerGoal, ''));
  lines.push(attachLine('pads', 'Mattress protectors', pads, padGoal, hire.newHire ? 'New-hire mattress-protector goal ' : ''));
  var ranked = lines.filter(function (line) { return line.gap !== null; }).sort(function (left, right) { return right.gap - left.gap; }).slice(0, 3);
  var strengths = lines.filter(function (line) { return line.strength; }).map(function (line) { return line.label + ' is at the goal.'; });
  if (!coachBlank_(person.snapWritten) && !coachBlank_(person.monthlyGoal) && Number(person.snapWritten) >= Number(person.monthlyGoal)) {
    strengths.unshift('SNAP written is at the monthly goal.');
  }
  var protection = opportunityProtectionRate_(null);
  return {
    name: person.name,
    period: period,
    newHire: !!hire.newHire,
    hired: hire.hired || '',
    tenureDays: hire.days,
    snapWritten: coachBlank_(person.snapWritten) ? null : person.snapWritten,
    monthlyGoal: coachBlank_(person.monthlyGoal) ? null : person.monthlyGoal,
    writtenThrough: written && written.through ? written.through : '',
    orders: ticket.orders,
    ticket: ticket,
    closingRatio: coachBlank_(person.closingRatio) ? null : person.closingRatio,
    closingGoal: closingGoal,
    closingThrough: person.closingThrough || '',
    bedding: coachBlank_(bedding) ? null : bedding,
    beddingGoal: beddingGoal,
    fabric: fabric && !coachBlank_(fabric.actual) ? fabric.actual : null,
    fabricGoal: fabricGoal,
    leather: leather && !coachBlank_(leather.actual) ? leather.actual : null,
    leatherGoal: leatherGoal,
    power: power && !coachBlank_(power.actual) ? power.actual : null,
    powerGoal: powerGoal,
    pads: pads && !coachBlank_(pads.actual) ? pads.actual : null,
    padsGoal: padGoal,
    rugs: { count: null, goal: hire.newHire ? 6 : 12, note: 'No salesperson rug count is on file. ASL rugs are a store total, so this card does not score rugs or estimate rug commission.' },
    financial: {
      ticket: ticket.status === 'ready' && ticket.opportunity > 0 ? ticket.opportunity : null,
      ticketAtGoal: ticket.status === 'ready' && ticket.opportunity <= 0,
      ticketNote: ticket.basis || ticket.status,
      protection: protection.status,
      protectionNote: protection.reason,
    },
    strengths: strengths.slice(0, 4),
    opportunities: ranked.map(function (line) {
      return { label: line.label, now: line.now, goal: line.goalText, additional: line.additional, action: line.action };
    }),
    recognition: strengths.length ? strengths[0] : 'No verified metric is at its goal yet. Pending items are not treated as misses.',
  };
}

function coaching_(payload) {
  var today = todayNy_();
  var individual = individualPeriodContaining_(today);
  var period = individual.start + ' through ' + individual.end;
  var people = peopleRows_(individual.start, individual.end).filter(function (person) { return person.role === 'associate'; });
  var cards = people.map(function (person) {
    var hire = { newHire: false, hired: '', days: null };
    try { hire = briefHire_(person.name, today); } catch (error) { hire = { newHire: false, hired: '', days: null }; }
    return coachCard_(person, hire, period);
  }).sort(function (left, right) { return left.name < right.name ? -1 : 1; });
  return {
    role: payload.session.role,
    today: today,
    period: period,
    calendar: 'Salesperson month, the 1st through the last calendar day. Store totals are not changed.',
    cards: cards,
  };
}

function coachingText_(card) {
  var lines = [
    card.name + (card.newHire ? ' — NEW HIRE' : ''),
    card.period,
    card.newHire ? 'Hired ' + card.hired + ', day ' + card.tenureDays + ' of 90. New-hire goals apply.' : 'Established goals apply.',
    'SNAP written ' + coachMoneyOrPending_(card.snapWritten) + ' of ' + coachMoneyOrPending_(card.monthlyGoal),
    'Average ticket ' + coachMoneyOrPending_(card.ticket && card.ticket.average) + ' versus ' + coachMoneyOrPending_(card.ticket && card.ticket.goal) + ' on ' + (card.orders === null || card.orders === undefined ? 'Pending' : card.orders) + ' orders',
    'Closing ' + coachPercentOrPending_(card.closingRatio) + ' versus ' + coachPercentOrPending_(card.closingGoal),
    'Bedding ' + coachPercentOrPending_(card.bedding),
    'Fabric ' + coachPercentOrPending_(card.fabric) + ', leather ' + coachPercentOrPending_(card.leather),
    'Power ' + coachPercentOrPending_(card.power) + ', mattress protectors ' + coachPercentOrPending_(card.pads),
    'Rugs ' + card.rugs.note,
    (card.financial.ticketAtGoal ? 'Average ticket is already at the goal on the orders on file. ' : 'Ticket opportunity ' + coachMoneyOrPending_(card.financial.ticket) + '. ') + card.financial.protection,
    'Strengths: ' + (card.strengths.length ? card.strengths.join(' ') : 'None verified yet.'),
  ];
  card.opportunities.forEach(function (item, index) {
    lines.push((index + 1) + '. ' + item.label);
    lines.push('Now: ' + item.now);
    lines.push('Goal: ' + item.goal);
    lines.push('Additional: ' + item.additional);
    lines.push('Action: ' + item.action);
  });
  if (!card.opportunities.length) lines.push('No verified metric is below its goal.');
  return lines.join('\n');
}
