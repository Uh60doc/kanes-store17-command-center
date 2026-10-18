/**
 * Attachment Goal Accelerator. Shows the verified attachment result, the approved goal, and how many more
 * successful attachments or qualifying dollars would reach it. A new eligible item changes the denominator.
 * An attachment on an item already qualified does not. Nothing here is commission or payroll.
 */

var ACCEL_PROTECT_TARGET_ = 4500;

function accelRound4_(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

function accelBlank_(value) {
  return value === null || value === undefined || value === '';
}

/** Whole attachments still needed on the current eligible count. The denominator does not grow. */
function accelAttachmentsNeeded_(sold, qualified, goal) {
  if (accelBlank_(sold) || accelBlank_(qualified) || accelBlank_(goal)) return null;
  if (!Number(qualified)) return null;
  return Math.max(0, Math.ceil(Math.round((Number(qualified) * Number(goal) - Number(sold)) * 1e6) / 1e6));
}

/**
 * What-if. onHand attaches to items already in the qualified count, so the denominator stays put.
 * newEligible adds eligible items. onNew is how many of those new items include the attachment.
 */
function accelScenario_(sold, qualified, goal, onHand, newEligible, onNew) {
  if (accelBlank_(sold) || accelBlank_(qualified)) return { status: 'pending', actual: null, sold: null, qualified: null, needed: null };
  var missed = Math.max(0, accelRound4_(Number(qualified) - Number(sold)));
  var hand = Math.max(0, Math.min(Number(onHand) || 0, missed));
  var added = Math.max(0, Number(newEligible) || 0);
  var attached = Math.max(0, Math.min(Number(onNew) || 0, added));
  var nextSold = accelRound4_(Number(sold) + hand + attached);
  var nextQualified = accelRound4_(Number(qualified) + added);
  var actual = nextQualified ? accelRound4_(nextSold / nextQualified) : null;
  return {
    status: actual === null ? 'na' : 'ready',
    sold: nextSold,
    qualified: nextQualified,
    actual: actual,
    onHand: hand,
    newEligible: added,
    onNew: attached,
    needed: accelAttachmentsNeeded_(nextSold, nextQualified, goal),
    met: actual !== null && !accelBlank_(goal) && nextSold >= nextQualified * Number(goal) - 1e-9,
  };
}

/**
 * Bedding percent is bedding dollars ÷ Group 17 sales, and bedding dollars are inside that sales total.
 * Extra bedding therefore raises both the numerator and the denominator. Other written sales raise only
 * the denominator.
 */
function accelBeddingDollars_(bedding, sales, goal) {
  if (accelBlank_(bedding) || accelBlank_(sales) || accelBlank_(goal) || !Number(sales)) return null;
  if (Number(goal) >= 1) return null;
  var raw = (Number(goal) * Number(sales) - Number(bedding)) / (1 - Number(goal));
  if (raw <= 1e-9) return 0;
  return Math.ceil(raw * 100) / 100;
}

function accelBeddingScenario_(bedding, sales, goal, extraBedding, extraOtherSales) {
  if (accelBlank_(bedding) || accelBlank_(sales)) return { status: 'pending', actual: null, bedding: null, sales: null, dollarsNeeded: null };
  var beddingAdd = Math.max(0, Number(extraBedding) || 0);
  var otherAdd = Math.max(0, Number(extraOtherSales) || 0);
  var nextBedding = Math.round((Number(bedding) + beddingAdd) * 100) / 100;
  var nextSales = Math.round((Number(sales) + beddingAdd + otherAdd) * 100) / 100;
  var actual = nextSales ? accelRound4_(nextBedding / nextSales) : null;
  return {
    status: actual === null ? 'na' : 'ready',
    bedding: nextBedding,
    sales: nextSales,
    actual: actual,
    extraBedding: beddingAdd,
    extraOtherSales: otherAdd,
    dollarsNeeded: accelBeddingDollars_(nextBedding, nextSales, goal),
    met: actual !== null && !accelBlank_(goal) && actual >= Number(goal) - 1e-9,
  };
}

function accelCountNeeded_(count, goal) {
  if (accelBlank_(count) || accelBlank_(goal)) return null;
  return Math.max(0, Math.ceil(Number(goal) - Number(count) - 1e-9));
}

function accelRateCard_(spec) {
  var sold = spec.sold;
  var qualified = spec.qualified;
  var goal = spec.goal;
  var actual = !accelBlank_(sold) && Number(qualified) ? accelRound4_(Number(sold) / Number(qualified)) : null;
  var needed = accelAttachmentsNeeded_(sold, qualified, goal);
  var status = actual === null ? (accelBlank_(sold) ? 'pending' : 'na') : (accelBlank_(goal) ? 'nogoal' : (needed === 0 ? 'at' : 'below'));
  return {
    key: spec.key,
    label: spec.label,
    customer: spec.customer,
    kind: 'rate',
    source: spec.source,
    through: spec.through || '',
    sold: accelBlank_(sold) ? null : accelRound4_(sold),
    qualified: accelBlank_(qualified) ? null : accelRound4_(qualified),
    dollars: accelBlank_(spec.dollars) ? null : Math.round(Number(spec.dollars) * 100) / 100,
    actual: actual,
    goal: accelBlank_(goal) ? null : Number(goal),
    difference: actual === null || accelBlank_(goal) ? null : Math.round((actual - Number(goal)) * 1000) / 10,
    needed: needed,
    dollarsNeeded: null,
    ratioToGoal: actual === null || !Number(goal) ? null : accelRound4_(actual / Number(goal)),
    status: status,
    note: spec.note || '',
  };
}

function accelBeddingCard_(spec) {
  var scenario = accelBeddingScenario_(spec.bedding, spec.sales, spec.goal, 0, 0);
  var actual = scenario.actual;
  var needed = scenario.dollarsNeeded;
  var status = actual === null ? 'pending' : (accelBlank_(spec.goal) ? 'nogoal' : (needed === 0 ? 'at' : 'below'));
  return {
    key: spec.key,
    label: spec.label,
    customer: spec.customer,
    kind: 'bedding',
    source: spec.source,
    through: spec.through || '',
    sold: null,
    qualified: null,
    bedding: accelBlank_(spec.bedding) ? null : Math.round(Number(spec.bedding) * 100) / 100,
    sales: accelBlank_(spec.sales) ? null : Math.round(Number(spec.sales) * 100) / 100,
    dollars: accelBlank_(spec.bedding) ? null : Math.round(Number(spec.bedding) * 100) / 100,
    actual: actual,
    goal: accelBlank_(spec.goal) ? null : Number(spec.goal),
    difference: actual === null || accelBlank_(spec.goal) ? null : Math.round((actual - Number(spec.goal)) * 1000) / 10,
    needed: null,
    dollarsNeeded: needed,
    ratioToGoal: actual === null || !Number(spec.goal) ? null : accelRound4_(actual / Number(spec.goal)),
    status: status,
    note: 'Bedding dollars ÷ Group 17 sales. Bedding dollars are part of that sales total, so additional bedding increases both.',
  };
}

function accelCountCard_(spec) {
  var needed = accelCountNeeded_(spec.count, spec.goal);
  var actual = accelBlank_(spec.count) ? null : Number(spec.count);
  var status = actual === null ? 'pending' : (accelBlank_(spec.goal) ? 'nogoal' : (needed === 0 ? 'at' : 'below'));
  return {
    key: spec.key,
    label: spec.label,
    customer: spec.customer,
    kind: 'count',
    source: spec.source,
    through: spec.through || '',
    count: actual,
    actual: actual,
    goal: accelBlank_(spec.goal) ? null : Number(spec.goal),
    difference: actual === null || accelBlank_(spec.goal) ? null : actual - Number(spec.goal),
    needed: needed,
    dollarsNeeded: null,
    ratioToGoal: actual === null || !Number(spec.goal) ? null : accelRound4_(actual / Number(spec.goal)),
    status: status,
    note: spec.note || 'A count goal. Additional rugs do not change an attachment denominator.',
  };
}

function accelProtectCard_(parts, target) {
  var known = 0;
  var missing = [];
  parts.forEach(function (part) {
    if (accelBlank_(part.dollars)) missing.push(part.label);
    else known += Number(part.dollars);
  });
  known = Math.round(known * 100) / 100;
  var complete = !missing.length;
  var dollarsNeeded = complete ? Math.max(0, Math.round((target - known) * 100) / 100) : null;
  return {
    key: 'protection',
    label: 'Maintenance and protection dollars',
    customer: 'Maintenance Plan',
    kind: 'protection',
    source: 'Fabric, furniture protection, protectors, pillows, leather, and power. The parts on file are added. A missing part is not treated as zero.',
    dollars: complete || known ? known : null,
    known: known,
    complete: complete,
    missing: missing,
    actual: complete ? known : null,
    goal: target,
    difference: dollarsNeeded === null ? null : Math.round((known - target) * 100) / 100,
    needed: null,
    dollarsNeeded: dollarsNeeded,
    ratioToGoal: complete && target ? accelRound4_(known / target) : null,
    status: complete ? (dollarsNeeded === 0 ? 'at' : 'below') : 'partial',
    note: 'Approved coaching target $' + target + '. This is not a commission rate and it is not an earnings estimate.',
  };
}

function accelClosest_(cards) {
  var open = cards.filter(function (card) { return card.status === 'below' && card.ratioToGoal !== null; });
  open.sort(function (left, right) { return right.ratioToGoal - left.ratioToGoal; });
  return open.length ? { key: open[0].key, label: open[0].label, customer: open[0].customer, ratioToGoal: open[0].ratioToGoal } : null;
}

function accelCoach_(card) {
  if (!card) return '';
  if (card.status === 'pending') return card.label + ' is Pending. No figure is shown as zero.';
  if (card.status === 'partial') return 'Part of the maintenance and protection dollars are on file ($' + card.known + '). The rest is Pending, so the gap to $' + card.goal + ' is not calculated. Goal coach is the place for commission scenarios.';
  if (card.status === 'na') return 'No eligible ' + card.label.toLowerCase() + ' items are on file, so a percentage is not calculated.';
  if (card.status === 'nogoal') return card.label + ' is on file. No approved goal is saved, so a gap is not calculated.';
  if (card.status === 'at') {
    return card.label + ' is already at the approved goal. Another ' + card.customer + ' still gives the customer the coverage.';
  }
  if (card.kind === 'bedding') {
    return 'About $' + card.dollarsNeeded + ' more bedding, with no other written sales added, would reach the bedding goal. That bedding is included in written sales, so the sales total grows by the same amount.';
  }
  if (card.kind === 'count') {
    return card.needed + ' more ' + card.customer.toLowerCase() + (card.needed === 1 ? '' : 's') + ' would reach the monthly goal. This is a count, not a rate.';
  }
  if (card.kind === 'protection') {
    return '$' + card.dollarsNeeded + ' more verified maintenance and protection sales would reach the $' + card.goal + ' coaching target. Commission on those dollars is not calculated here.';
  }
  return card.needed + ' more ' + card.customer + (card.needed === 1 ? '' : 's') + ' on items already eligible would reach the goal. Those items are already in the qualified count, so the denominator stays ' + card.qualified + '.';
}

function accelLedgerCard_(view, side, periodStart, spec) {
  var row = null;
  try { row = latestStoreLedger_(view, side, periodStart); } catch (error) { row = null; }
  if (!row || accelBlank_(row.eligible) || accelBlank_(row.attachments)) {
    return accelRateCard_({ key: spec.key, label: spec.label, customer: spec.customer, source: spec.source, goal: spec.goal, note: 'No verified ' + side + ' count is on file for this store month.', sold: null, qualified: null });
  }
  return accelRateCard_({
    key: spec.key, label: spec.label, customer: spec.customer, source: spec.source, goal: spec.goal,
    sold: row.attachments, qualified: row.eligible, dollars: row.sales, through: row.verifiedThrough,
  });
}

function accelStore_(side, goals) {
  var period = storePeriodContaining_(todayNy_());
  var cards = [
    accelLedgerCard_('FABW_STORE', side, period.start, { key: 'fabric', label: 'Fabric maintenance', customer: 'Fabric Maintenance Plan', source: 'Group 17 FABRIC', goal: goals.fabric }),
    accelLedgerCard_('LTHW_STORE', side, period.start, { key: 'leather', label: 'Leather maintenance', customer: 'Leather Maintenance Plan', source: 'Group 17 LEATHER', goal: goals.leather }),
    accelLedgerCard_('PWAR_STORE', side, period.start, { key: 'power', label: 'Power upholstery', customer: 'Power Maintenance Plan', source: 'Group 17 POWER FURNITURE', goal: goals.power }),
    accelLedgerCard_('MPPA_STORE', side, period.start, { key: 'pads', label: 'Mattress protectors', customer: 'Mattress protector', source: 'Group 17 MATTRESS PADS', goal: goals.mattress }),
    accelLedgerCard_('ATTACH_STORE', side, period.start, { key: 'total', label: 'Total Attachment', customer: 'attachment', source: 'Group 17 TOTAL ATTACHMENTS', goal: goals.attachment }),
    accelLedgerCard_('BASES_STORE', side, period.start, { key: 'bases', label: 'Adjustable base attachment', customer: 'adjustable base', source: 'ASL adjustable bases', goal: goals.adjustableBase }),
    accelLedgerCard_('PILLOWS_STORE', side, period.start, { key: 'pillows', label: 'Pillows', customer: 'pillow', source: 'ASL pillows', goal: goals.pillow }),
    accelLedgerCard_('FP_STORE', side, period.start, { key: 'wood', label: 'Wood / Furniture Protection', customer: 'Furniture Maintenance Plan', source: 'ASL Furniture Protection', goal: goals.wood }),
  ];
  var beddingRow = null;
  var salesRow = null;
  try {
    beddingRow = latestStoreLedger_('BEDDING_STORE', side, period.start);
    salesRow = latestStoreLedger_('DA_SALES_STORE', side, period.start);
  } catch (error) { beddingRow = null; salesRow = null; }
  var beddingThrough = beddingRow && beddingRow.verifiedThrough;
  var salesThrough = salesRow && salesRow.verifiedThrough;
  if (!beddingRow || !salesRow || !beddingThrough || beddingThrough !== salesThrough) {
    cards.push(accelBeddingCard_({ key: 'bedding', label: 'Bedding contribution', customer: 'bedding', source: 'Group 17 bedding ÷ sales', goal: goals.bedding, bedding: null, sales: null }));
  } else {
    cards.push(accelBeddingCard_({ key: 'bedding', label: 'Bedding contribution', customer: 'bedding', source: 'Group 17 bedding ÷ sales', goal: goals.bedding, bedding: beddingRow.sales, sales: salesRow.sales, through: beddingThrough }));
  }
  var rugs = null;
  try { rugs = latestStoreLedger_('RUGS_STORE', side, period.start); } catch (error) { rugs = null; }
  cards.push(accelCountCard_({
    key: 'rugs', label: 'Rugs', customer: 'rug', source: 'ASL rugs', goal: goals.rugs,
    count: rugs && !accelBlank_(rugs.units) ? rugs.units : null, through: rugs ? rugs.verifiedThrough : '',
    note: rugs ? 'ASL rug count for this side. Written and Delivered are not added together. Approved monthly goal ' + goals.rugs + '.' : 'No ASL rug count is on file. Nothing is shown as zero.',
  }));
  var dollarsOf = function (key) {
    var found = cards.filter(function (card) { return card.key === key; })[0];
    return found ? found.dollars : null;
  };
  cards.push(accelProtectCard_([
    { label: 'Fabric maintenance', dollars: dollarsOf('fabric') },
    { label: 'Leather maintenance', dollars: dollarsOf('leather') },
    { label: 'Power upholstery', dollars: dollarsOf('power') },
    { label: 'Mattress protectors', dollars: dollarsOf('pads') },
    { label: 'Pillows', dollars: dollarsOf('pillows') },
    { label: 'Wood / Furniture Protection', dollars: dollarsOf('wood') },
  ], ACCEL_PROTECT_TARGET_));
  cards.forEach(function (card) { card.coaching = accelCoach_(card); });
  return { scope: 'store', side: side, period: period.start + ' through ' + period.end, calendar: 'Store month, the 2nd through the 1st.', cards: cards, closest: accelClosest_(cards) };
}

function accelPersonSide_(analysis, goals, hire) {
  var side = analysis || null;
  var tallies = side && side.tallies ? side.tallies : {};
  var padGoal = hire.newHire ? 0.6 : goals.mattress;
  var beddingGoal = hire.newHire ? 0.15 : goals.bedding;
  var rugGoal = hire.newHire ? 6 : 12;
  var rate = function (key, label, customer, source, goal) {
    var tally = tallies[key];
    if (!tally) return accelRateCard_({ key: key, label: label, customer: customer, source: source, goal: goal, sold: null, qualified: null, note: 'No qualifying count is on file for this salesperson month.' });
    return accelRateCard_({ key: key, label: label, customer: customer, source: source, goal: goal, sold: tally.sold, qualified: tally.qualified, dollars: tally.dollars, through: side.through });
  };
  var cards = [
    rate('fabric', 'Fabric maintenance', 'Fabric Maintenance Plan', 'Group 17 FABRIC', goals.fabric),
    rate('leather', 'Leather maintenance', 'Leather Maintenance Plan', 'Group 17 LEATHER', goals.leather),
    rate('power', 'Power upholstery', 'Power Maintenance Plan', 'Group 17 POWER FURNITURE', goals.power),
    rate('pads', 'Mattress protectors', 'Mattress protector', 'Group 17 MATTRESS PADS', padGoal),
    rate('total', 'Total Attachment', 'attachment', 'Group 17 TOTAL ATTACHMENTS', goals.attachment),
  ];
  if (!side || accelBlank_(side.beddingDollars) || accelBlank_(side.sales)) {
    cards.push(accelBeddingCard_({ key: 'bedding', label: 'Bedding contribution', customer: 'bedding', source: 'Group 17 bedding ÷ sales', goal: beddingGoal, bedding: null, sales: null }));
  } else {
    cards.push(accelBeddingCard_({ key: 'bedding', label: 'Bedding contribution', customer: 'bedding', source: 'Group 17 bedding ÷ sales', goal: beddingGoal, bedding: side.beddingDollars, sales: side.sales, through: side.through }));
  }
  cards.push(accelCountCard_({
    key: 'rugs', label: 'Rugs', customer: 'rug', source: 'ASL rugs', goal: rugGoal, count: null,
    note: 'No salesperson rug count is on file. ASL rugs are a store total, so this goal stays Pending. The monthly goal is ' + rugGoal + (hire.newHire ? ' for a new hire.' : '.'),
  }));
  cards.push(accelRateCard_({ key: 'bases', label: 'Adjustable base attachment', customer: 'adjustable base', source: 'ASL', goal: goals.adjustableBase, sold: null, qualified: null, note: 'ASL reports adjustable bases for the store only.' }));
  cards.push(accelRateCard_({ key: 'pillows', label: 'Pillows', customer: 'pillow', source: 'ASL', goal: goals.pillow, sold: null, qualified: null, note: 'ASL reports pillows for the store only.' }));
  cards.push(accelRateCard_({ key: 'wood', label: 'Wood / Furniture Protection', customer: 'Furniture Maintenance Plan', source: 'ASL', goal: goals.wood, sold: null, qualified: null, note: 'ASL reports furniture protection for the store only.' }));
  var dollarsOf = function (key) {
    var found = cards.filter(function (card) { return card.key === key; })[0];
    return found ? found.dollars : null;
  };
  cards.push(accelProtectCard_([
    { label: 'Fabric maintenance', dollars: dollarsOf('fabric') },
    { label: 'Leather maintenance', dollars: dollarsOf('leather') },
    { label: 'Power upholstery', dollars: dollarsOf('power') },
    { label: 'Mattress protectors', dollars: dollarsOf('pads') },
    { label: 'Pillows', dollars: null },
    { label: 'Wood / Furniture Protection', dollars: null },
  ], ACCEL_PROTECT_TARGET_));
  cards.forEach(function (card) { card.coaching = accelCoach_(card); });
  return cards;
}

function accelerator_(payload) {
  var today = todayNy_();
  var individual = individualPeriodContaining_(today);
  var goals = approvedGoals_(config_());
  var side = payload.side === 'delivered' ? 'delivered' : 'written';
  var store = accelStore_(side, goals);
  var people = [];
  if (payload.session.role !== 'sales') {
    people = peopleRows_(individual.start, individual.end).filter(function (person) {
      return person.role === 'associate';
    }).map(function (person) {
      var hire = { newHire: false, hired: '', days: null };
      try { hire = briefHire_(person.name, today); } catch (error) { hire = { newHire: false, hired: '', days: null }; }
      var analysis = person.analysis && person.analysis[side];
      var cards = accelPersonSide_(analysis, goals, hire);
      return {
        name: person.name,
        newHire: !!hire.newHire,
        hired: hire.hired || '',
        cards: cards,
        closest: accelClosest_(cards),
      };
    }).sort(function (left, right) { return left.name < right.name ? -1 : 1; });
  }
  return {
    title: 'Attachment Goal Accelerator',
    today: today,
    side: side,
    role: payload.session.role,
    notice: 'Verified results and what-if counts stay separate. Adding an attachment on an item already eligible does not change the qualified count. A new eligible item does. This page does not calculate commission. Goal coach is the earnings illustration.',
    protectTarget: ACCEL_PROTECT_TARGET_,
    store: store,
    people: people,
    individualPeriod: individual.start + ' through ' + individual.end,
    individualCalendar: 'Salesperson month, the 1st through the last calendar day.',
  };
}
