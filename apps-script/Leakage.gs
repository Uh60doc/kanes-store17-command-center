/**
 * Sales leakage detector. Store figures use the store month. Associate figures use the salesperson month.
 * Closing and average-ticket illustrations are separate. They are not added together and they are not lost revenue.
 * PERQ opportunities, NWDSR purchasing customers, and Data Analysis written orders stay different counts.
 */

function leakageBlank_(value) {
  return value === null || value === undefined || value === '';
}

function leakageRound_(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** Extra dollars from raising a count to a ratio, priced at the current dollars per count. Missing inputs stay null. */
function leakageExtra_(count, opportunities, ratio, dollarsEach) {
  if (leakageBlank_(count) || leakageBlank_(opportunities) || leakageBlank_(ratio) || leakageBlank_(dollarsEach)) return null;
  var extra = Number(ratio) * Number(opportunities) - Number(count);
  if (extra <= 0) return 0;
  return leakageRound_(extra * Number(dollarsEach));
}

function leakageTicketDollars_(orders, sales, goal) {
  var ticket = opportunityTicket_(orders, sales, goal);
  if (ticket.status !== 'ready') return { dollars: null, ticket: ticket };
  return { dollars: ticket.opportunity > 0 ? ticket.opportunity : 0, ticket: ticket };
}

function leakageMix_(sales, actualDollars, rate) {
  if (leakageBlank_(sales) || leakageBlank_(actualDollars) || leakageBlank_(rate) || !Number(sales)) return null;
  var gap = leakageRound_(Number(sales) * Number(rate) - Number(actualDollars));
  return gap > 0 ? gap : 0;
}

function leakageRank_(items) {
  return items.filter(function (item) { return item.dollars !== null && item.dollars > 0; }).sort(function (left, right) { return right.dollars - left.dollars; });
}

function leakageBiggest_(ranked) {
  var found = null;
  ranked.forEach(function (item) { if (!found && item.kind === 'incremental') found = item; });
  return found;
}

function leakageAttach_(person) {
  var lines = person.attachments && person.attachments.written ? person.attachments.written.lines : [];
  return ['fabric', 'leather', 'power', 'pads'].map(function (key) {
    var row = null;
    lines.forEach(function (line) { if (line.key === key) row = line; });
    var actual = row && row.status !== 'na' && row.status !== 'pending' ? row.actual : null;
    return {
      key: key,
      label: row ? row.name : key,
      actual: actual,
      goal: row ? row.goal : null,
      needed: row && row.needed !== null && row.needed !== undefined ? row.needed : null,
      qualified: row ? row.qualified : null,
      sold: row ? row.sold : null,
      dollars: null,
      note: 'No verified price for a missed attachment is on file, so this dollar opportunity stays Pending. The count is not turned into sales.',
    };
  });
}

function leakagePerson_(person, hire) {
  hire = hire || { newHire: false };
  var written = person.analysis && person.analysis.written;
  var orders = written ? written.orders : null;
  var sales = written ? written.sales : null;
  var ticketGoal = hire.newHire ? 2100 : OPP_TICKET_GOAL_;
  var ticket = leakageTicketDollars_(orders, sales, ticketGoal);
  var average = ticket.ticket.average;
  var closingGoal = person.closing && !leakageBlank_(person.closing.goal) ? person.closing.goal : 0.5;
  var closingDollars = leakageExtra_(person.closingOrders, person.opportunities, closingGoal, average);
  var beddingRate = written && written.bedding ? written.bedding.value : null;
  var beddingGoal = hire.newHire ? 0.15 : null;
  (person.kpis || []).forEach(function (row) { if (beddingGoal === null && row.name === 'Bedding') beddingGoal = row.goal; });
  var beddingDollars = leakageMix_(sales, written ? written.beddingDollars : null, beddingGoal);
  var items = [
    { key: 'closing', label: 'Closing ratio', kind: 'incremental', dollars: closingDollars, note: 'Extra Group 17 written orders to reach the closing goal, priced at the current average ticket. The ticket is not also raised.' },
    { key: 'ticket', label: 'Average ticket', kind: 'incremental', dollars: ticket.dollars, note: ticket.ticket.basis || ticket.ticket.status },
    { key: 'bedding', label: 'Bedding mix', kind: 'mix', dollars: beddingDollars, note: 'Bedding dollars short of the mix goal on Group 17 written sales already on file. This is not new written sales and it is not added to closing or ticket.' },
  ];
  var ranked = leakageRank_(items);
  var biggest = leakageBiggest_(ranked);
  return {
    name: person.name,
    newHire: !!hire.newHire,
    snapWritten: leakageBlank_(person.snapWritten) ? null : person.snapWritten,
    monthlyGoal: leakageBlank_(person.monthlyGoal) ? null : person.monthlyGoal,
    orders: ticket.ticket.orders,
    groupSales: ticket.ticket.sales,
    average: average,
    ticketGoal: ticketGoal,
    ticket: ticket.dollars,
    ticketStatus: ticket.ticket.status,
    closingOrders: leakageBlank_(person.closingOrders) ? null : person.closingOrders,
    opportunities: leakageBlank_(person.opportunities) ? null : person.opportunities,
    closingRatio: leakageBlank_(person.closingRatio) ? null : person.closingRatio,
    closingGoal: closingGoal,
    closingThrough: person.closingThrough || '',
    writtenThrough: written && written.through ? written.through : '',
    closing: closingDollars,
    beddingRate: beddingRate,
    beddingGoal: beddingGoal,
    bedding: beddingDollars,
    attachments: leakageAttach_(person),
    ranked: ranked,
    biggest: biggest,
  };
}

function leakage_(payload) {
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var facts = dailyFacts_();
  var closed = closedDates_();
  var days = storeCalendar_(facts, store, closed);
  var view = loadClosingView_();
  var closingGoal = closingGoal_(config_());
  var month = storeMonthClosing_(view, store, closingGoal);
  var economics = recoveryEconomics_(days, view);
  var orders = recoveryAnalysisOrders_(store);
  var budgets = storeSalesGoals_(config_(), store);
  var written = sumField_(facts, 'nwdsrWritten', store.start, store.end);
  var closingDollars = leakageExtra_(month.customers, month.opportunities, closingGoal, economics.dollarsPerCustomer);
  var ticket = leakageTicketDollars_(orders.orders, null, OPP_TICKET_GOAL_);
  var storeItems = [
    { key: 'closing', label: 'Store closing', kind: 'incremental', dollars: closingDollars, note: 'Extra NWDSR purchasing customers to reach the closing goal, priced at the current NWDSR dollars per purchasing customer. PERQ opportunities are not treated as orders.' },
    { key: 'ticket', label: 'Store average ticket', kind: 'incremental', dollars: ticket.dollars, note: orders.note + ' The $2,500 goal is not applied to PERQ opportunities or to a partial order file.' },
  ];
  var storeRanked = leakageRank_(storeItems);
  var people = peopleRows_(individual.start, individual.end).filter(function (person) { return person.role === 'associate'; }).map(function (person) {
    var hire = { newHire: false };
    try { hire = briefHire_(person.name, today); } catch (error) { hire = { newHire: false }; }
    return leakagePerson_(person, hire);
  }).sort(function (left, right) {
    var a = left.biggest ? left.biggest.dollars : -1;
    var b = right.biggest ? right.biggest.dollars : -1;
    return b - a;
  });
  return {
    role: payload.session.role,
    today: today,
    store: {
      period: store.start + ' through ' + store.end,
      calendar: 'Store month, the 2nd through the 1st.',
      written: written,
      writtenGoal: budgets.written,
      customers: month.customers,
      opportunities: month.opportunities,
      closingRatio: month.ratio,
      closingGoal: closingGoal,
      closingThrough: month.through || '',
      dollarsPerCustomer: economics.dollarsPerCustomer,
      orders: orders.orders,
      ordersNote: orders.note,
      closing: closingDollars,
      ticket: ticket.dollars,
      ticketGoal: OPP_TICKET_GOAL_,
      ranked: storeRanked,
      biggest: leakageBiggest_(storeRanked),
    },
    individual: {
      period: individual.start + ' through ' + individual.end,
      calendar: 'Salesperson month, the 1st through the last calendar day. These figures are not the store month.',
    },
    people: people,
    notice: 'These are separate illustrations. Closing and average ticket are not added together. None of these figures are actual lost revenue, and none are written to sales.',
  };
}
