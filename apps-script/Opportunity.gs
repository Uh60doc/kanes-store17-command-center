/**
 * Goal coach. Reads the salesperson month already on file and illustrates what a higher average ticket,
 * another rug, or the protection bands could mean. It does not write sales, goals, or payroll.
 *
 * Pay rules come from the Store Sales Associate Commission Agreement on file:
 * - Area rugs (quarterly): 6%. A 12% tier at 13 rugs is not in that agreement.
 * - Fabric, furniture protection, protectors, pillows, leather, and power are one bucket:
 *   under $3,000 depends on the combined six-warranty attach rate; $3,000 through $4,500 is 20%; above $4,500 is 25%.
 * Furniture commission is paid on delivered sales. Written-ticket illustrations are not commission.
 */

var OPP_TICKET_GOAL_ = 2500;
var OPP_RUG_RATE_ = 0.06;
var OPP_PROTECT_LOW_ = 3000;
var OPP_PROTECT_HIGH_ = 4500;
var OPP_PAY_NEEDED_ = 'Pay rule confirmation needed';

function opportunityRound_(value) {
  return Math.round(Number(value) * 100) / 100;
}

function opportunityBlank_(value) {
  return value === null || value === undefined || value === '';
}

function opportunityTicket_(orders, sales, goal) {
  if (opportunityBlank_(goal)) goal = OPP_TICKET_GOAL_;
  else goal = Number(goal);
  if (opportunityBlank_(orders) || opportunityBlank_(sales)) {
    return { status: 'Pending', orders: opportunityBlank_(orders) ? null : orders, sales: opportunityBlank_(sales) ? null : sales, average: null, goal: goal, hypothetical: null, opportunity: null, basis: 'Group 17 written orders and written sales are not both on file.' };
  }
  orders = Number(orders);
  sales = opportunityRound_(sales);
  if (!orders) {
    return { status: 'No orders', orders: 0, sales: sales, average: null, goal: goal, hypothetical: 0, opportunity: null, basis: 'Group 17 written orders are 0, so an average ticket is not calculated.' };
  }
  var hypothetical = opportunityRound_(orders * goal);
  return {
    status: 'ready',
    orders: orders,
    sales: sales,
    average: opportunityRound_(sales / orders),
    goal: goal,
    hypothetical: hypothetical,
    opportunity: opportunityRound_(hypothetical - sales),
    basis: 'Group 17 written sales ÷ Group 17 written orders. The same order count at $' + goal + '. This is written sales, not delivered commission.',
  };
}

function opportunityGoalImpact_(snap, goal, illustratedWritten) {
  if (opportunityBlank_(snap) || opportunityBlank_(goal)) {
    return { status: 'Pending', actualPercent: null, illustratedPercent: null, note: 'SNAP written or the monthly goal is not on file, so goal progress stays Pending.' };
  }
  var actual = Number(snap) / Number(goal);
  var illustrated = opportunityBlank_(illustratedWritten) ? null : Number(illustratedWritten) / Number(goal);
  return {
    status: 'ready',
    actualPercent: Math.round(actual * 1000) / 1000,
    illustratedPercent: illustrated === null ? null : Math.round(illustrated * 1000) / 1000,
    note: 'SNAP is the official individual written figure. The illustration is Group 17 written sales at the scenario ticket. It is not added to SNAP and it is not commission.',
  };
}

/** Listed protection rate. Under $3,000 is not estimated. The rate is applied to the whole amount only as a labeled estimate. */
function opportunityProtectionRate_(dollars) {
  if (opportunityBlank_(dollars)) {
    return {
      status: OPP_PAY_NEEDED_,
      rate: null,
      amount: null,
      earnings: null,
      band: '',
      nextAmount: null,
      dollarsToNext: null,
      nextRate: null,
      nextEarnings: null,
      incremental: null,
      reason: 'Qualifying protection dollars are not on file. The agreement combines fabric, furniture protection, protectors, pillows, leather, and power. Pillows and furniture protection are store-only, so a salesperson total is not verified.',
    };
  }
  var amount = opportunityRound_(dollars);
  var band = '';
  var rate = null;
  var reason = '';
  if (amount > OPP_PROTECT_HIGH_) {
    band = 'Above $4,500';
    rate = 0.25;
  } else if (amount >= OPP_PROTECT_LOW_) {
    band = '$3,000 through $4,500';
    rate = 0.2;
  } else {
    return {
      status: OPP_PAY_NEEDED_,
      rate: null,
      amount: amount,
      earnings: null,
      band: 'Under $3,000',
      nextAmount: OPP_PROTECT_LOW_,
      dollarsToNext: opportunityRound_(OPP_PROTECT_LOW_ - amount),
      nextRate: 0.2,
      nextEarnings: opportunityRound_(OPP_PROTECT_LOW_ * 0.2),
      incremental: null,
      reason: 'Under $3,000 the agreement pays 20% only when the combined six-warranty attach rate is at least 80%. Otherwise it uses the end-of-month sales commission rate. That attach rate is not on file, so current earnings are not estimated. At $3,000 the listed rate is 20%.',
    };
  }
  var nextAmount = amount > OPP_PROTECT_HIGH_ ? null : opportunityRound_(OPP_PROTECT_HIGH_ + 0.01);
  var nextRate = nextAmount === null ? null : 0.25;
  var earnings = opportunityRound_(amount * rate);
  var nextEarnings = nextAmount === null ? null : opportunityRound_(nextAmount * nextRate);
  return {
    status: 'estimate',
    rate: rate,
    amount: amount,
    earnings: earnings,
    band: band,
    nextAmount: nextAmount,
    dollarsToNext: nextAmount === null ? 0 : opportunityRound_(nextAmount - amount),
    nextRate: nextRate,
    nextEarnings: nextEarnings,
    incremental: nextEarnings === null ? 0 : opportunityRound_(nextEarnings - earnings),
    reason: reason,
    assumption: 'The agreement lists one rate for the band. It does not say the rate applies only above the line. This estimate uses that rate on the whole amount. It is not payroll.',
  };
}

function opportunityRugIllustration_(extraCount, price) {
  var count = opportunityBlank_(extraCount) ? 0 : Number(extraCount);
  if (!count) {
    return { status: 'ready', extraCount: 0, price: opportunityBlank_(price) ? null : Number(price), sales: 0, commission: 0, rate: OPP_RUG_RATE_, note: 'No extra rugs are in this illustration. The agreement lists 6% for quarterly area rugs.' };
  }
  if (opportunityBlank_(price)) {
    return { status: OPP_PAY_NEEDED_, extraCount: count, price: null, sales: null, commission: null, rate: OPP_RUG_RATE_, note: 'Enter an average qualifying rug price. No verified rug price is on file, so 6% is not applied to a guessed price.' };
  }
  var sales = opportunityRound_(count * Number(price));
  return {
    status: 'estimate',
    extraCount: count,
    price: opportunityRound_(price),
    sales: sales,
    commission: opportunityRound_(sales * OPP_RUG_RATE_),
    rate: OPP_RUG_RATE_,
    note: 'Estimate only: 6% of the rug dollars in this illustration. The agreement does not confirm which rugs qualify, and a 12% tier is not in the agreement. Not payroll.',
  };
}

function opportunityTakeaways_(card) {
  var lines = [];
  var ticket = card.ticket;
  if (ticket.status === 'ready' && ticket.opportunity > 0) {
    lines.push('At your current ' + ticket.orders + ' transactions, reaching a $2,500 average ticket represents ' + moneyText_(ticket.opportunity) + ' in additional written sales. That is not commission.');
  } else if (ticket.status === 'ready' && ticket.opportunity <= 0) {
    lines.push('The Group 17 average ticket is already at or above $2,500 on the orders on file. That written figure is not commission.');
  } else if (ticket.status === 'Pending') {
    lines.push('Average-ticket coaching waits on Group 17 written orders and written sales.');
  } else if (ticket.status === 'No orders') {
    lines.push('No Group 17 written orders are on file, so there is no average ticket to compare. Nothing is treated as a missed sale.');
  }
  lines.push('Qualifying rug count and rug revenue are not on a salesperson report, so a rug commission stays pending. The agreement pays 6% on quarterly area rugs. A 12% tier at 13 rugs is ' + OPP_PAY_NEEDED_.toLowerCase() + '.');
  lines.push('Protection-plan earnings need the combined qualifying dollars. Until that total is on file, the current tier is ' + OPP_PAY_NEEDED_.toLowerCase() + '. The agreement lists 20% from $3,000 through $4,500 and 25% above $4,500.');
  return lines;
}

function opportunityCard_(person) {
  var written = person.analysis && person.analysis.written;
  var orders = written ? written.orders : null;
  var sales = written ? written.sales : null;
  var ticket = opportunityTicket_(orders, sales);
  var impact = opportunityGoalImpact_(person.snapWritten, person.monthlyGoal, ticket.hypothetical);
  var card = {
    name: person.name,
    period: '',
    snapWritten: person.snapWritten,
    monthlyGoal: person.monthlyGoal,
    deliveredSales: person.deliveredSales,
    deliveredThrough: person.deliveredThrough || '',
    writtenThrough: written ? written.through : '',
    ticket: ticket,
    goalImpact: impact,
    rugs: {
      count: null,
      dollars: null,
      status: 'Pending',
      rate: OPP_RUG_RATE_,
      rateLabel: '6% quarterly area rugs, from the commission agreement on file.',
      nextCount: null,
      nextRate: null,
      nextStatus: OPP_PAY_NEEDED_,
      nextReason: 'A 12% tier at 13 qualifying rugs per quarter is not in the Store Sales Associate Commission Agreement on file. It is not estimated.',
      reason: 'ASL rugs are a store total. No salesperson rug count or rug revenue is on file, so nothing is shown as zero.',
    },
    protection: {
      actual: null,
      status: OPP_PAY_NEEDED_,
      reason: 'The agreement\'s protection bucket is not a figure on the salesperson reports. Fabric, leather, power, and pad rates are tracked separately and are not added into a commission total.',
      bands: 'Under $3,000 depends on the six-warranty attach rate. $3,000 through $4,500 is 20%. Above $4,500 is 25%.',
    },
  };
  card.takeaways = opportunityTakeaways_(card);
  return card;
}

function opportunity_(payload) {
  var today = todayNy_();
  var individual = individualPeriodContaining_(today);
  var role = payload.session.role;
  var rules = {
    ticketGoal: OPP_TICKET_GOAL_,
    rugRate: OPP_RUG_RATE_,
    protectionLow: OPP_PROTECT_LOW_,
    protectionHigh: OPP_PROTECT_HIGH_,
    payNeeded: OPP_PAY_NEEDED_,
    source: 'Store Sales Associate Commission Agreement on file. Estimates are not payroll. Furniture commission is paid on delivered sales.',
  };
  if (role === 'sales') {
    return {
      role: role,
      access: 'shared-login',
      today: today,
      period: individual.start + ' through ' + individual.end,
      calendar: 'Salesperson month, the 1st through the last calendar day. Store month figures are not used here.',
      people: [],
      rules: rules,
      message: 'This shared sales login is not tied to one associate. Other associates\' earnings are not shown. A personal login is required before your own verified results appear here.',
    };
  }
  var people = peopleRows_(individual.start, individual.end).filter(function (person) {
    return person.role === 'associate';
  }).map(opportunityCard_);
  people.forEach(function (card) { card.period = individual.start + ' through ' + individual.end; });
  people.sort(function (left, right) { return left.name < right.name ? -1 : 1; });
  return {
    role: role,
    access: 'management',
    today: today,
    period: individual.start + ' through ' + individual.end,
    calendar: 'Salesperson month, the 1st through the last calendar day. Store month figures are not used here.',
    people: people,
    rules: rules,
    message: 'Actual results, hypothetical written sales, and estimated commissions are separate. Nothing on this page is official payroll.',
  };
}
