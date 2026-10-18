/**
 * Store sales recovery simulator. Reads the store month and illustrates remaining Written sales.
 * Nothing here is saved. Actual NWDSR, SNAP, and Delivered records are not changed.
 *
 * The remaining-sales model is:
 *   remaining PERQ opportunities × closing ratio × dollars per NWDSR purchasing customer.
 * PERQ opportunities, NWDSR purchasing customers, and Data Analysis written orders are different counts.
 * They are not substituted for one another. The $2,500 ticket is the approved order-level goal;
 * using it here assumes one purchasing customer stands for one order, and that assumption is labeled.
 */

function recoveryRound_(value) {
  return Math.round(Number(value) * 100) / 100;
}

function recoveryBlank_(value) {
  return value === null || value === undefined || value === '';
}

/** Remaining written dollars. A missing input stays Pending instead of becoming zero. */
function recoveryRemaining_(days, dailyOpportunities, closingRatio, dollarsPerCustomer, traffic) {
  if (recoveryBlank_(days) || recoveryBlank_(dailyOpportunities) || recoveryBlank_(closingRatio) || recoveryBlank_(dollarsPerCustomer) || recoveryBlank_(traffic)) return null;
  var opportunities = Number(dailyOpportunities) * Number(days) * Number(traffic);
  return recoveryRound_(opportunities * Number(closingRatio) * Number(dollarsPerCustomer));
}

function recoveryMonthEnd_(actual, remaining) {
  if (recoveryBlank_(actual) || recoveryBlank_(remaining)) return null;
  return recoveryRound_(Number(actual) + Number(remaining));
}

function recoveryScenario_(name, actual, budget, days, dailyOpportunities, closingRatio, dollarsPerCustomer, traffic, note) {
  var remaining = recoveryRemaining_(days, dailyOpportunities, closingRatio, dollarsPerCustomer, traffic);
  var monthEnd = recoveryMonthEnd_(actual, remaining);
  return {
    name: name,
    remaining: remaining,
    monthEnd: monthEnd,
    gap: monthEnd === null || recoveryBlank_(budget) ? null : recoveryRound_(Number(budget) - monthEnd),
    reaches: monthEnd === null || recoveryBlank_(budget) ? null : monthEnd >= Number(budget),
    note: note || '',
  };
}

function recoveryEconomics_(days, view) {
  var matchedWritten = 0;
  var matchedCustomers = 0;
  var matchedDays = 0;
  var opportunityTotal = 0;
  var opportunityDays = 0;
  var writtenSum = 0;
  var writtenDays = 0;
  days.forEach(function (day) {
    if (day.closed) return;
    if (!recoveryBlank_(day.nwdsrWritten)) {
      writtenSum += Number(day.nwdsrWritten);
      writtenDays += 1;
    }
    var close = view && view.byDate ? view.byDate[day.date] : null;
    if (!close) return;
    if (!recoveryBlank_(day.nwdsrWritten) && !recoveryBlank_(close.customers)) {
      matchedWritten += Number(day.nwdsrWritten);
      matchedCustomers += Number(close.customers);
      matchedDays += 1;
    }
    if (!recoveryBlank_(close.opportunities)) {
      opportunityTotal += Number(close.opportunities);
      opportunityDays += 1;
    }
  });
  return {
    dollarsPerCustomer: matchedCustomers ? recoveryRound_(matchedWritten / matchedCustomers) : null,
    matchedWritten: matchedDays ? recoveryRound_(matchedWritten) : null,
    matchedCustomers: matchedDays ? matchedCustomers : null,
    matchedDays: matchedDays,
    dailyOpportunities: opportunityDays ? recoveryRound_(opportunityTotal / opportunityDays) : null,
    opportunityTotal: opportunityDays ? opportunityTotal : null,
    opportunityDays: opportunityDays,
    dailyWritten: writtenDays ? recoveryRound_(writtenSum / writtenDays) : null,
    writtenDays: writtenDays,
  };
}

/** Daily Data Analysis store orders. Cumulative snapshots are not added. */
function recoveryAnalysisOrders_(period) {
  var byDate = {};
  try {
    ledgerRows_().forEach(function (row) {
      if (row.view !== 'DA_SALES_STORE' || row.grain !== 'daily' || row.side !== 'written') return;
      if (!row.reportDate || row.reportDate < period.start || row.reportDate > period.end) return;
      var current = byDate[row.reportDate];
      if (!current || row.verifiedThrough > current.verifiedThrough) byDate[row.reportDate] = row;
    });
  } catch (error) {
    return { orders: null, sales: null, days: 0 };
  }
  var orders = 0;
  var sales = 0;
  var days = 0;
  var incomplete = false;
  Object.keys(byDate).forEach(function (date) {
    var row = byDate[date];
    if (recoveryBlank_(row.units)) incomplete = true;
    else orders += Number(row.units);
    if (!recoveryBlank_(row.sales)) sales += Number(row.sales);
    days += 1;
  });
  return {
    orders: days && !incomplete ? orders : null,
    sales: days ? recoveryRound_(sales) : null,
    days: days,
  };
}

function recovery_(payload) {
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var closed = closedDates_();
  var facts = dailyFacts_();
  var days = storeCalendar_(facts, store, closed);
  var actualWritten = sumField_(facts, 'nwdsrWritten', store.start, store.end);
  var actualDelivered = sumField_(facts, 'nwdsrDelivered', store.start, store.end);
  var budgets = storeSalesGoals_(config_(), store);
  var daysLeft = operatingDaysRemaining_(store, today, closed);
  var view = loadClosingView_();
  var closingGoal = closingGoal_(config_());
  var monthClosing = storeMonthClosing_(view, store, closingGoal);
  var economics = recoveryEconomics_(days, view);
  var orders = recoveryAnalysisOrders_(store);
  var trendRemaining = recoveryBlank_(economics.dailyWritten) || recoveryBlank_(daysLeft) ? null : recoveryRound_(economics.dailyWritten * daysLeft);
  var trendEnd = recoveryMonthEnd_(actualWritten, trendRemaining);
  var goal = recoveryScenario_('Goal', actualWritten, budgets.written, daysLeft, economics.dailyOpportunities, 0.5, economics.dollarsPerCustomer, 1, 'Remaining days at a 50% closing ratio, the recent daily PERQ rate, and the actual NWDSR dollars per purchasing customer. The average ticket is not also raised.');
  var stretch = recoveryScenario_('Stretch', actualWritten, budgets.written, daysLeft, economics.dailyOpportunities, 0.6, 2500, 1, 'Remaining days at 60% closing and $2,500 per purchasing customer. Those two changes are already combined here. Do not add the separate closing and ticket effects on top.');
  return {
    role: payload.session.role,
    today: today,
    period: store.start + ' through ' + store.end,
    calendar: 'Store month, the 2nd through the 1st. Closed dates on CC_SellingDays stay closed.',
    budget: budgets.written,
    deliveredBudget: budgets.delivered,
    daysLeft: daysLeft,
    actual: {
      written: actualWritten,
      delivered: actualDelivered,
      writtenLeft: actualWritten === null || budgets.written === null ? null : recoveryRound_(budgets.written - actualWritten),
      deliveredLeft: actualDelivered === null || budgets.delivered === null ? null : recoveryRound_(budgets.delivered - actualDelivered),
    },
    closing: {
      customers: monthClosing.customers,
      opportunities: monthClosing.opportunities,
      ratio: monthClosing.ratio,
      through: monthClosing.through || '',
      goal: closingGoal,
    },
    economics: economics,
    orders: orders,
    trend: {
      name: 'Current trend',
      remaining: trendRemaining,
      monthEnd: trendEnd,
      gap: trendEnd === null || budgets.written === null ? null : recoveryRound_(budgets.written - trendEnd),
      reaches: trendEnd === null || budgets.written === null ? null : trendEnd >= budgets.written,
      note: 'Actual NWDSR Written plus the average verified daily NWDSR Written times the remaining open days. This card does not use closing ratio or average ticket.',
    },
    goal: goal,
    stretch: stretch,
    assumptions: [
      'PERQ customer opportunities, NWDSR purchasing customers, and Data Analysis written orders are different counts. This model does not swap them.',
      'Closing ratio means NWDSR purchasing customers divided by PERQ store opportunities.',
      'The actual ticket in this model is NWDSR Written divided by NWDSR purchasing customers on days where both are on file.',
      'The $2,500 choice is the approved average-ticket goal. Using it assumes one purchasing customer stands for one written order.',
      'A combined scenario already includes each selected change. Add the separate effects only when you want to see one change at a time.',
      'Simulation results are not written to sales records.',
    ],
  };
}
