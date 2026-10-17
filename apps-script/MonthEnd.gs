/**
 * CC_MonthEnd: each store and salesperson month beside its official month-end final.
 *
 * verified_mtd is the month to date the pages use: the latest cumulative snapshot that starts on the track's first day
 * plus each later day's report, through the last date before an open day is missing. daily_records_total is what the
 * single-day records alone add up to; it is partial whenever a snapshot covers the early days, so it is never called a
 * month to date. snapshot_coverage and missing_or_unverified say which dates each part covers. The official final (a
 * report printed for exactly the finished month) is never added to either figure, and a variance is shown only when
 * the verified month to date reaches the period end. Store months run the 2nd through the 1st, salesperson months the
 * 1st through the last day, and neither track uses the other's records.
 */

var MONTH_END_TAB_ = 'CC_MonthEnd';
var MONTH_END_HEADERS_ = ['track', 'period_key', 'period_start', 'period_end', 'metric', 'side', 'person', 'employee_id', 'unit', 'verified_mtd', 'verified_through', 'qualified', 'sold', 'mtd_basis', 'daily_records_total', 'daily_record_dates', 'snapshot_coverage', 'missing_or_unverified', 'official_final', 'official_basis', 'variance', 'explanation', 'status'];
var MONTH_END_NOTES_TAB_ = 'CC_MonthEndNotes';
var MONTH_END_NOTES_HEADERS_ = ['period_key', 'track', 'metric', 'side', 'person', 'explanation', 'entered_by', 'entered_at'];
// storeKpiDerived_ joins its source files with ' + '. Those rows are calculated here, never reports, so never a final.
var DERIVED_LEDGER_SOURCE_ = /\.(xlsx|pdf|csv)\s\+\s/i;
var NO_SNAPSHOT_ = 'None: single-day reports only';

var STORE_SALES_METRICS_ = [
  { metric: 'NWDSR Written', side: 'written', field: 'nwdsrWritten', view: 'NWDSR_WRITTEN_STORE', source: 'NWDSR Net Written' },
  { metric: 'NWDSR Delivered', side: 'delivered', field: 'nwdsrDelivered', view: 'NWDSR_DELIVERED_STORE', source: 'NWDSR Delivered' },
  { metric: 'SNAP Written', side: 'written', field: 'snapWritten', view: 'SNAP_STORE', source: 'SNAP Written (reconciliation only)' },
];

// [metric, unit, figure, ledger views the figure needs]
var STORE_KPI_METRICS_ = {
  group17: [
    ['Data Analysis Group 17 sales', 'dollars', 'sales', ['DA_SALES']], ['Orders', 'count', 'orders', ['DA_SALES']],
    ['Bedding dollars', 'dollars', 'bedding', ['BEDDING']], ['Bedding %', 'percent', 'beddingRate', ['BEDDING', 'DA_SALES']],
    ['Average ticket', 'dollars', 'average', ['DA_SALES']], ['Financing', 'percent', 'finance', ['FINANCE', 'DA_SALES']],
    ['Mattress protectors', 'percent', 'pads', ['MPPA']], ['Fabric protection', 'percent', 'fabric', ['FABW']],
    ['Leather protection', 'percent', 'leather', ['LTHW']], ['Power upholstery', 'percent', 'power', ['PWAR']],
    ['Total attachment', 'percent', 'attach', ['ATTACH']],
  ],
  asl: [
    ['Adjustable bases', 'percent', 'bases', ['BASES']], ['Pillows', 'percent', 'pillows', ['PILLOWS']],
    ['Wood / Furniture Protection', 'percent', 'protection', ['FP']], ['Rugs', 'count', 'rugs', ['RUGS']],
  ],
};

var PERSON_KPI_METRICS_ = [
  ['Data Analysis Group 17 sales', 'dollars', 'sales'], ['Orders', 'count', 'orders'], ['Bedding dollars', 'dollars', 'bedding'],
  ['Bedding %', 'percent', 'beddingRate'], ['Average ticket', 'dollars', 'average'], ['Financing', 'percent', 'finance'],
  ['Mattress protectors', 'percent', 'pads'], ['Fabric protection', 'percent', 'fabric'], ['Leather protection', 'percent', 'leather'],
  ['Power upholstery', 'percent', 'power'], ['Total attachment', 'percent', 'attach'],
];

var MONTH_END_ORDER_ = ['NWDSR Written', 'NWDSR Delivered', 'SNAP Written', 'Purchasing customers', 'PERQ opportunities', 'Closing ratio',
  'Data Analysis Group 17 sales', 'Orders', 'Bedding dollars', 'Bedding %', 'Average ticket', 'Financing', 'Mattress protectors',
  'Fabric protection', 'Leather protection', 'Power upholstery', 'Total attachment', 'Adjustable bases', 'Pillows',
  'Wood / Furniture Protection', 'Rugs'];

function monthEndRound_(value, places) {
  var scale = Math.pow(10, places);
  return Math.round(value * scale) / scale;
}

function periodKey_(track, period) {
  return (track === 'Store' ? 'STORE-' : 'PERSON-') + period.year + '-' + pad2_(period.month);
}

/** "2026-10-02 to 2026-10-11, 2026-10-14" from a list of dates. */
function dateRunsText_(dates) {
  var sorted = dates.slice().sort();
  var runs = [];
  sorted.forEach(function (date) {
    var run = runs[runs.length - 1];
    if (run && shiftDate_(run[1], 1) === date) run[1] = date;
    else if (!run || run[1] !== date) runs.push([date, date]);
  });
  return runs.map(function (run) { return run[0] === run[1] ? run[0] : run[0] + ' to ' + run[1]; }).join(', ');
}

function datesText_(dates) {
  if (!dates.length) return 'None';
  return dateRunsText_(dates) + ' (' + dates.length + ' date' + (dates.length === 1 ? '' : 's') + ')';
}

/** Open days from the period start through last: verified through the last day before the first missing open day. */
function verifiedDays_(period, last, closed, has) {
  var through = '';
  var missing = [];
  eachDate_(period.start, last).forEach(function (date) {
    if (closed[date] || has(date)) {
      if (!missing.length) through = date;
      return;
    }
    missing.push(date);
  });
  return { through: through, missing: missing };
}

function monthEndMissing_(period, last, closed, covered) {
  return eachDate_(period.start, last).filter(function (date) { return !closed[date] && !covered(date); });
}

function missingText_(dates, extra) {
  var parts = [];
  if (dates.length) parts.push('Missing: ' + dateRunsText_(dates));
  (extra || []).forEach(function (text) { if (text) parts.push(text); });
  return parts.length ? parts.join('. ') : 'None';
}

function isOfficialFinalRow_(row, period) {
  return row.grain === 'cumulative' && row.periodStart === period.start && row.periodEnd === period.end &&
    (row.verifiedThrough || row.periodEnd) >= period.end && !DERIVED_LEDGER_SOURCE_.test(row.source);
}

function isClosingFinal_(fact, period) {
  return fact.start === period.start && fact.end === period.end && (fact.through || fact.end) >= period.end;
}

function monthEndNotes_() {
  var notes = {};
  sheet_(MONTH_END_NOTES_TAB_).forEach(function (row) {
    var text = String(row.explanation || '').trim();
    if (!text) return;
    notes[[row.period_key, row.metric, row.side, row.person].map(function (cell) { return String(cell || '').trim(); }).join('|')] = text;
  });
  return notes;
}

function ensureMonthEndNotes_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  if (spreadsheet.getSheetByName(MONTH_END_NOTES_TAB_)) return;
  spreadsheet.insertSheet(MONTH_END_NOTES_TAB_).getRange(1, 1, 1, MONTH_END_NOTES_HEADERS_.length).setValues([MONTH_END_NOTES_HEADERS_]);
}

/** Everything the month-end and history rows read, loaded once. */
function monthEndContext_(today) {
  var facts = {};
  dailyFacts_().forEach(function (row) { facts[row.date] = row; });
  var associates = sheet_('CC_AssociateDays').map(function (row) {
    return { date: isoDate_(row.date), source: String(row.source_name || ''), name: String(row.display_name || ''), role: String(row.role || ''), amount: numberOrNull_(row.amount), sha: String(row.sha256 || '') };
  }).filter(function (line) { return line.date && line.name && line.amount !== null; });
  return {
    today: today,
    ledger: ledgerRows_(),
    closing: loadClosing_(),
    closed: closedDates_(),
    facts: facts,
    associates: associates,
    notes: monthEndNotes_(),
    config: config_(),
  };
}

function rateFigure_(top, bottom, detail, zeroText) {
  if (top === null || bottom === null || bottom === undefined) return { value: null, detail: detail || '' };
  if (!bottom) return { value: zeroText, detail: detail || '' };
  return { value: monthEndRound_(top / bottom, 4), detail: detail || '' };
}

function countedFigure_(sold, qualified) {
  var figure = rateFigure_(sold, qualified, monthEndRound_(sold, 4) + ' sold of ' + monthEndRound_(qualified, 4) + ' qualified', 'No qualifying sales');
  figure.qualified = monthEndRound_(qualified, 4);
  figure.sold = monthEndRound_(sold, 4);
  return figure;
}

/** One figure from storeKpiTotals_. */
function storeKpiFigure_(totals, pick) {
  if (!totals) return null;
  if (pick === 'sales') return { value: totals.sales, detail: '' };
  if (pick === 'bedding') return { value: totals.bedding, detail: '' };
  if (pick === 'orders') return { value: totals.orders, detail: totals.orders === null ? 'An order count could not be read' : '' };
  if (pick === 'beddingRate') return rateFigure_(totals.bedding, totals.sales, moneyText_(totals.bedding) + ' of ' + moneyText_(totals.sales), 'No sales');
  if (pick === 'average') return totals.orders ? { value: monthEndRound_(totals.sales / totals.orders, 2), detail: moneyText_(totals.sales) + ' ÷ ' + totals.orders + ' orders' } : { value: totals.orders === 0 ? 'No orders' : null, detail: '' };
  if (pick === 'finance') return totals.financed === null ? { value: null, detail: 'FIN % is not on file for every report' } : rateFigure_(totals.financed, totals.sales, 'Financed dollars ÷ sales', 'No sales');
  if (pick === 'rugs') return { value: totals.rugs, detail: moneyText_(totals.rugDollars) + ' rug sales' };
  return countedFigure_(totals[pick].sold, totals[pick].qual);
}

var PERSON_TALLY_ = { pads: 'pads', fabric: 'fabric', leather: 'leather', power: 'power', attach: 'total' };

/** One figure from personAnalysisSide_. */
function personKpiFigure_(side, pick) {
  if (!side) return null;
  if (pick === 'sales') return { value: side.sales, detail: '' };
  if (pick === 'bedding') return { value: side.beddingDollars, detail: '' };
  if (pick === 'orders') return { value: side.orders, detail: side.orders === null ? 'An order count could not be read' : '' };
  if (pick === 'beddingRate') return rateFigure_(side.beddingDollars, side.sales, moneyText_(side.beddingDollars) + ' of ' + moneyText_(side.sales), 'No sales');
  if (pick === 'average') return side.orders ? { value: monthEndRound_(side.sales / side.orders, 2), detail: moneyText_(side.sales) + ' ÷ ' + side.orders + ' orders' } : { value: side.orders === 0 ? 'No orders' : null, detail: '' };
  if (pick === 'finance') return side.finance.value === null ? { value: side.sales ? null : 'No sales', detail: side.finance.text || '' } : { value: side.finance.value, detail: 'Financed dollars ÷ sales' };
  var tally = side.tallies[PERSON_TALLY_[pick]];
  if (!tally) return { value: null, detail: 'Group 17 Total Attachments is not on file for every report' };
  return countedFigure_(tally.sold, tally.qualified);
}

function monthEndLine_(track, period, metric, side, person, unit) {
  return {
    track: track, period: period, periodKey: periodKey_(track, period), metric: metric, side: side || '',
    person: person ? person.name : '', employeeId: person ? person.employeeId : '', unit: unit,
    verified: null, through: '', qualified: '', sold: '', basis: '', dailyTotal: null, dailyDates: 'None', snapshot: NO_SNAPSHOT_, missing: 'None', final: null, finalBasis: '',
  };
}

function finalBasisText_(row) {
  return 'Report ' + row.periodStart + ' to ' + row.periodEnd + (row.source ? ' (' + row.source + ')' : '');
}

function noFinalText_(period) {
  return 'No report printed for exactly ' + period.start + ' to ' + period.end + ' is on file';
}

function monthEndStatus_(line, variance, explanation, today) {
  var period = line.period;
  var verified = line.through ? 'verified through ' + line.through : 'no verified month to date yet';
  if (line.final === null) {
    if (period.end >= today) return 'In progress: ' + verified + '; official final after ' + period.end;
    return line.through === period.end ? 'Complete; awaiting official final' : 'Incomplete: ' + verified + '; awaiting official final';
  }
  if (line.through !== period.end) return 'Official final on file; daily record ' + verified + ', so no variance';
  if (variance === null) return 'Official final on file; no comparable figure';
  if (variance === 0) return 'Matches official final';
  return 'Variance: official final differs from verified month to date' + (explanation ? '' : '; explanation pending');
}

function monthEndRow_(ctx, line) {
  var complete = line.through === line.period.end;
  var variance = complete && typeof line.verified === 'number' && typeof line.final === 'number'
    ? (line.unit === 'percent' ? monthEndRound_((line.final - line.verified) * 100, 2) : monthEndRound_(line.final - line.verified, line.unit === 'count' ? 4 : 2))
    : null;
  var explanation = ctx.notes[[line.periodKey, line.metric, line.side, line.person].join('|')] || '';
  var cell = function (value, blank) { return value === null || value === undefined ? blank : value; };
  return [line.track, line.periodKey, line.period.start, line.period.end, line.metric, line.side, line.person, line.employeeId, line.unit,
    cell(line.verified, 'Pending'), line.through, line.qualified, line.sold, line.basis, cell(line.dailyTotal, 'None on file'), line.dailyDates, line.snapshot, line.missing,
    cell(line.final, 'Pending'), line.final === null ? (line.finalBasis || noFinalText_(line.period)) : line.finalBasis, cell(variance, ''), explanation, monthEndStatus_(line, variance, explanation, ctx.today)];
}

function applyFigure_(line, figure, finalFigure) {
  if (figure) {
    line.verified = figure.value;
    if (figure.qualified !== undefined) { line.qualified = figure.qualified; line.sold = figure.sold; }
    if (figure.detail) line.basis += (line.basis ? '. ' : '') + figure.detail;
  }
  if (finalFigure) line.final = typeof finalFigure.value === 'number' ? finalFigure.value : null;
}

/** The latest date through which countThrough_ can count, and that count. */
function monthEndCountThrough_(facts, scope, name, period, last, field, closed, daily) {
  var dates = eachDate_(period.start, last).reverse();
  var i;
  for (i = 0; i < dates.length; i += 1) {
    var counted = countThrough_(facts, scope, name, period.start, dates[i], field, closed, daily);
    if (counted) return { through: dates[i], counted: counted };
  }
  return null;
}

/** The cumulative counts on file for the period that start on its first day, oldest first, one per through date. */
function countSnapshots_(facts, scope, name, period, field) {
  var byThrough = {};
  facts.forEach(function (row) {
    if (row.scope !== scope || row.start !== period.start || row.start === row.end || row[field] === null || !row.final) return;
    if (scope === 'store' && row.code) return;
    if (scope === 'person' && !rowMatchesPerson_(row, name)) return;
    var through = row.through || row.end;
    if (through > period.end) return;
    byThrough[through] = byThrough[through] === undefined || byThrough[through] === row[field] ? row[field] : 'conflict';
  });
  return Object.keys(byThrough).sort().map(function (through) { return { through: through, total: byThrough[through] }; });
}

function closingFinalCount_(facts, scope, name, period, field) {
  var best = null;
  facts.forEach(function (row) {
    if (row.scope !== scope || !row.final || row[field] === null || !isClosingFinal_(row, period)) return;
    if (scope === 'store' && row.code) return;
    if (scope === 'person' && !rowMatchesPerson_(row, name)) return;
    if (!best || (row.through || row.end) > (best.through || best.end)) best = row;
  });
  return best;
}

function countLine_(ctx, line, facts, scope, name, period, last, field, daily, label) {
  var found = monthEndCountThrough_(facts, scope, name, period, last, field, ctx.closed, daily);
  var snapshots = countSnapshots_(facts, scope, name, period, field);
  var dates = Object.keys(daily).filter(function (date) { return date >= period.start && date <= period.end; }).sort();
  var latestSnapshot = '';
  snapshots.forEach(function (snap) { if (snap.total !== 'conflict' && snap.through <= last) latestSnapshot = snap.through; });
  if (found) {
    line.verified = found.counted.total;
    line.through = found.through;
    line.basis = label + ': ' + found.counted.source;
  } else line.basis = 'No count from ' + period.start + ' through any later day is complete';
  line.dailyTotal = dates.length ? dates.reduce(function (total, date) { return total + daily[date]; }, 0) : null;
  line.dailyDates = datesText_(dates);
  line.snapshot = snapshots.length ? snapshots.map(function (snap) { return period.start + ' to ' + snap.through + ' (' + (snap.total === 'conflict' ? 'conflicting counts, not used' : snap.total) + ')'; }).join('; ') +
    (found && found.counted.base ? '. Used: through ' + found.counted.base.through : '') : NO_SNAPSHOT_;
  line.missing = missingText_(monthEndMissing_(period, last, ctx.closed, function (date) { return (latestSnapshot && date <= latestSnapshot) || Object.prototype.hasOwnProperty.call(daily, date); }));
  return found;
}

function monthEndStoreLines_(ctx, period, last) {
  var lines = [];
  var ledger = ctx.ledger.filter(function (row) { return !isOfficialFinalRow_(row, period); });
  var finals = ctx.ledger.filter(function (row) { return row.scope === 'STORE' && !row.code && !row.name && isOfficialFinalRow_(row, period); });
  var closing = ctx.closing.filter(function (row) { return !isClosingFinal_(row, period); });

  STORE_SALES_METRICS_.forEach(function (spec) {
    var line = monthEndLine_('Store', period, spec.metric, spec.side, null, 'dollars');
    var has = function (date) { return !!(ctx.facts[date] && ctx.facts[date][spec.field] !== null); };
    var walk = verifiedDays_(period, last, ctx.closed, has);
    var dates = eachDate_(period.start, period.end).filter(has);
    var sum = function (through) {
      return monthEndRound_(dates.filter(function (date) { return date <= through; }).reduce(function (total, date) { return total + ctx.facts[date][spec.field]; }, 0), 2);
    };
    if (walk.through) {
      line.verified = sum(walk.through);
      line.through = walk.through;
      line.basis = spec.source + ' daily reports, ' + period.start + ' through ' + walk.through + ' (CC_Daily)';
    } else line.basis = spec.source + ' for ' + period.start + ' is not on file';
    line.dailyTotal = dates.length ? sum(period.end) : null;
    line.dailyDates = datesText_(dates);
    line.missing = missingText_(walk.missing);
    var final = finals.filter(function (row) { return row.view === spec.view && row.side === spec.side; })[0];
    if (final) { line.final = final.sales; line.finalBasis = finalBasisText_(final); }
    lines.push(line);
  });

  var customers = monthEndLine_('Store', period, 'Purchasing customers', 'written', null, 'count');
  var customerCount = countLine_(ctx, customers, closing, 'store', '', period, last, 'customers', dailyCountMap_(closing, 'store', '', 'customers'), 'NWDSR Net Written # OF CUST');
  var customerFinal = closingFinalCount_(ctx.closing, 'store', '', period, 'customers');
  if (customerFinal) { customers.final = customerFinal.customers; customers.finalBasis = 'NWDSR Net Written # OF CUST ' + customerFinal.start + ' to ' + customerFinal.end; }
  lines.push(customers);

  var opportunities = monthEndLine_('Store', period, 'PERQ opportunities', '', null, 'count');
  var opportunityCount = countLine_(ctx, opportunities, closing, 'store', '', period, last, 'opportunities', dailyCountMap_(closing, 'store', '', 'opportunities'), 'PERQ Location Ups + Be Backs');
  var opportunityFinal = closingFinalCount_(ctx.closing, 'store', '', period, 'opportunities');
  if (opportunityFinal) { opportunities.final = opportunityFinal.opportunities; opportunities.finalBasis = 'PERQ Location ' + opportunityFinal.start + ' to ' + opportunityFinal.end; }
  lines.push(opportunities);

  var ratio = monthEndLine_('Store', period, 'Closing ratio', 'written', null, 'percent');
  var dates = eachDate_(period.start, last).reverse();
  var i;
  for (i = 0; i < dates.length; i += 1) {
    var c = countThrough_(closing, 'store', '', period.start, dates[i], 'customers', ctx.closed, dailyCountMap_(closing, 'store', '', 'customers'));
    var o = countThrough_(closing, 'store', '', period.start, dates[i], 'opportunities', ctx.closed, dailyCountMap_(closing, 'store', '', 'opportunities'));
    if (!c || !o) continue;
    ratio.verified = o.total ? closingRatio_(c.total, o.total).ratio : 'No opportunities';
    ratio.through = dates[i];
    ratio.basis = c.total + ' purchasing customers ÷ ' + o.total + ' opportunities, both ' + period.start + ' through ' + dates[i];
    break;
  }
  if (!ratio.through) ratio.basis = 'Needs purchasing customers and PERQ opportunities verified through the same date';
  ratio.dailyTotal = 'Not applicable: a ratio is not summed';
  ratio.snapshot = 'See the purchasing customers and PERQ opportunities rows';
  ratio.missing = customerCount && opportunityCount && customerCount.through === opportunityCount.through ? 'None' : 'Customers verified through ' + (customerCount ? customerCount.through : 'none') + ', opportunities through ' + (opportunityCount ? opportunityCount.through : 'none');
  if (customerFinal && opportunityFinal && opportunityFinal.opportunities) {
    ratio.final = closingRatio_(customerFinal.customers, opportunityFinal.opportunities).ratio;
    ratio.finalBasis = customerFinal.customers + ' ÷ ' + opportunityFinal.opportunities + ' from the official finals';
  }
  lines.push(ratio);

  ['group17', 'asl'].forEach(function (family) {
    var spec = STORE_KPI_FAMILIES_[family];
    var familyName = family === 'asl' ? 'ASL' : 'Group 17';
    ['written', 'delivered'].forEach(function (side) {
      var coverage = storeKpiCoverage_(ledger, family, side, period, ctx.facts, ctx.closed, ctx.today);
      var verified = coverage.through ? storeKpiTotals_(coverage) : null;
      var dayDates = Object.keys(coverage.dayRows).filter(function (date) { return date >= period.start && date <= period.end && coverage.dayRows[date][spec.anchor]; }).sort();
      var dailyOnly = dayDates.length ? storeKpiTotals_({ family: family, snapshot: '', snapRows: {}, dayRows: coverage.dayRows, days: dayDates }) : null;
      var finalRows = {};
      finals.forEach(function (row) {
        var prefix = row.view.replace(/_STORE$/, '');
        if (row.side === side && spec.views.indexOf(prefix) !== -1 && spec.source.test(row.source)) finalRows[prefix] = row;
      });
      var final = finalRows[spec.anchor] ? storeKpiTotals_({ family: family, snapshot: period.end, snapRows: finalRows, dayRows: {}, days: [] }) : null;
      var snapSources = [];
      Object.keys(coverage.snapRows).forEach(function (prefix) { if (snapSources.indexOf(coverage.snapRows[prefix].source) === -1) snapSources.push(coverage.snapRows[prefix].source); });
      var missing = monthEndMissing_(period, last, ctx.closed, function (date) {
        return (coverage.snapshot && date <= coverage.snapshot) || !!(coverage.dayRows[date] && coverage.dayRows[date][spec.anchor]);
      });
      STORE_KPI_METRICS_[family].forEach(function (metric) {
        var line = monthEndLine_('Store', period, metric[0], side, null, metric[1]);
        var lacking = coverage.snapshot ? metric[3].filter(function (prefix) { return !coverage.snapRows[prefix]; }) : [];
        line.through = coverage.through;
        line.basis = coverage.through ? familyName + ' ' + side + ' ' + storeKpiThroughText_(period, coverage) : 'No ' + familyName + ' ' + side + ' report covers ' + period.start;
        if (lacking.length) {
          line.through = '';
          line.basis = 'The ' + familyName + ' snapshot through ' + coverage.snapshot + ' has no ' + lacking.join(' / ') + ' line, so the month to date cannot be rebuilt';
        } else applyFigure_(line, storeKpiFigure_(verified, metric[2]), null);
        var daily = storeKpiFigure_(dailyOnly, metric[2]);
        line.dailyTotal = daily ? daily.value : null;
        line.dailyDates = datesText_(dayDates) + (daily && daily.detail ? '; ' + daily.detail : '');
        line.snapshot = coverage.snapshot ? period.start + ' to ' + coverage.snapshot + ' (' + snapSources.join(', ') + ')' : NO_SNAPSHOT_;
        line.missing = missingText_(missing, [coverage.issue ? 'Unverified: ' + coverage.issue : '']);
        if (final && metric[3].every(function (prefix) { return finalRows[prefix]; })) {
          applyFigure_(line, null, storeKpiFigure_(final, metric[2]));
          line.finalBasis = finalBasisText_(finalRows[metric[3][0]]);
        }
        lines.push(line);
      });
    });
  });
  return lines;
}

/** Salespeople of the month: everyone on the roster as an associate during it, and anyone with a salesperson record in it. */
function monthEndPeople_(ctx, period) {
  var people = {};
  var order = [];
  function add(code, printed) {
    var match = rosterMatch_(code, printed);
    var name = match ? match.name : String(printed || code || '').trim();
    if (!name || people[name]) return;
    if (match && rosterRole_(match.raw, period.start) === 'management' && rosterRole_(match.raw, period.end) === 'management') return;
    people[name] = {
      name: name,
      employeeId: match ? match.employeeId : String(code || ''),
      position: match ? String(match.raw.position || '') : 'Not on the roster',
      status: match ? (rosterStatusOn_(match.raw, period.end) || String(match.raw.role || '')) : 'Not on the roster',
    };
    order.push(name);
  }
  membersDuring_(period.start, period.end).forEach(function (name) { add('', name); });
  ctx.ledger.forEach(function (row) {
    if (row.scope !== 'PERSON' || NOT_SUPPLIED_VIEWS_.indexOf(row.view) !== -1) return;
    var inPeriod = row.grain === 'daily' ? row.reportDate >= period.start && row.reportDate <= period.end : row.fitsTrack && row.periodStart === period.start;
    if (inPeriod) add(row.code, row.name || row.code);
  });
  ctx.associates.forEach(function (line) {
    if (line.date >= period.start && line.date <= period.end && line.role !== 'management') add('', line.name);
  });
  return order.sort().map(function (name) { return people[name]; });
}

function monthEndPersonLines_(ctx, period, last) {
  var lines = [];
  var ledger = ctx.ledger.filter(function (row) { return (row.scope === 'PERSON' || row.view === 'DA_SALES_STORE') && !isOfficialFinalRow_(row, period); });
  var finals = ctx.ledger.filter(function (row) { return row.scope === 'PERSON' && isOfficialFinalRow_(row, period); });
  var closing = ctx.closing.filter(function (row) { return !isClosingFinal_(row, period); });
  var snapDay = {};
  Object.keys(ctx.facts).forEach(function (date) { if (ctx.facts[date].snapWritten !== null) snapDay[date] = true; });
  ctx.associates.forEach(function (line) { snapDay[line.date] = true; });
  var snapWalk = verifiedDays_(period, last, ctx.closed, function (date) { return !!snapDay[date]; });
  var coverage = {
    written: personAnalysisCoverage_(ledger, 'written', period, ctx.closed),
    delivered: personAnalysisCoverage_(ledger, 'delivered', period, ctx.closed),
  };
  var dayFiles = { written: [], delivered: [] };
  ledger.forEach(function (row) {
    if (row.view === 'DA_SALES_STORE' && row.grain === 'daily' && PERSON_ANALYSIS_SOURCE_.test(row.source) && dayFiles[row.side] && row.reportDate >= period.start && row.reportDate <= period.end && dayFiles[row.side].indexOf(row.reportDate) === -1) dayFiles[row.side].push(row.reportDate);
  });
  var goal = closingGoal_(ctx.config);

  monthEndPeople_(ctx, period).forEach(function (person) {
    var snap = monthEndLine_('Person', period, 'SNAP Written', 'written', person, 'dollars');
    var mine = {};
    ctx.associates.forEach(function (line) {
      if (line.name !== person.name || line.date < period.start || line.date > period.end) return;
      mine[line.date] = monthEndRound_((mine[line.date] || 0) + line.amount, 2);
    });
    var lineDates = Object.keys(mine).sort();
    if (snapWalk.through) {
      snap.verified = monthEndRound_(eachDate_(period.start, snapWalk.through).reduce(function (total, date) { return total + (mine[date] || 0); }, 0), 2);
      snap.through = snapWalk.through;
      snap.basis = 'SNAP Written salesperson lines (CC_AssociateDays), ' + period.start + ' through ' + snapWalk.through + '. A reported day without a line for this salesperson is 0';
    } else snap.basis = 'SNAP Written for ' + period.start + ' is not on file';
    snap.dailyTotal = lineDates.length ? monthEndRound_(lineDates.reduce(function (total, date) { return total + mine[date]; }, 0), 2) : null;
    snap.dailyDates = datesText_(lineDates);
    snap.missing = missingText_(snapWalk.missing);
    var snapFinal = finals.filter(function (row) { return row.view === 'SNAP_PERSON' && rowMatchesPerson_(row, person.name); })[0];
    if (snapFinal) { snap.final = snapFinal.sales; snap.finalBasis = finalBasisText_(snapFinal); }
    else if (finals.some(function (row) { return row.view === 'SNAP_PERSON'; })) { snap.final = 0; snap.finalBasis = 'The official SNAP final has no line for this salesperson'; }
    lines.push(snap);

    var analysisFinal = {};
    ['written', 'delivered'].forEach(function (side) {
      var verified = personAnalysisSide_(ledger, person.name, coverage[side]);
      var daily = dayFiles[side].length ? personAnalysisSide_(ledger, person.name, { side: side, period: period, snapshot: '', days: dayFiles[side].slice().sort(), through: dayFiles[side].slice().sort().pop() }) : null;
      var finalRows = finals.filter(function (row) { return row.side === side && PERSON_ANALYSIS_SOURCE_.test(row.source); });
      var final = finalRows.some(function (row) { return row.view === 'DA_SALES_PERSON'; }) ? personAnalysisSide_(finalRows, person.name, { side: side, period: period, snapshot: period.end, days: [], through: period.end }) : null;
      analysisFinal[side] = final;
      var sideCoverage = coverage[side];
      var mineDates = [];
      ledger.forEach(function (row) {
        if (row.view === 'DA_SALES_PERSON' && row.grain === 'daily' && row.side === side && PERSON_ANALYSIS_SOURCE_.test(row.source) && row.reportDate >= period.start && row.reportDate <= period.end && rowMatchesPerson_(row, person.name) && mineDates.indexOf(row.reportDate) === -1) mineDates.push(row.reportDate);
      });
      var missing = monthEndMissing_(period, last, ctx.closed, function (date) { return (sideCoverage.snapshot && date <= sideCoverage.snapshot) || dayFiles[side].indexOf(date) !== -1; });
      PERSON_KPI_METRICS_.forEach(function (metric) {
        var line = monthEndLine_('Person', period, metric[0], side, person, metric[1]);
        line.through = verified ? verified.through : '';
        line.basis = verified ? verified.basis + '. A covered report without a line for this salesperson is 0' : 'No Group 17 ' + side + ' report covers ' + period.start;
        applyFigure_(line, personKpiFigure_(verified, metric[2]), final ? personKpiFigure_(final, metric[2]) : null);
        var dailyFigure = personKpiFigure_(daily, metric[2]);
        line.dailyTotal = dailyFigure ? dailyFigure.value : null;
        line.dailyDates = 'Day files ' + datesText_(dayFiles[side].slice().sort()) + '; lines for this salesperson on ' + (mineDates.length ? dateRunsText_(mineDates) : 'none') + (dailyFigure && dailyFigure.detail ? '; ' + dailyFigure.detail : '');
        line.snapshot = sideCoverage.snapshot ? period.start + ' to ' + sideCoverage.snapshot + ' (Group 17 ' + side + ' salesperson report)' : NO_SNAPSHOT_;
        line.missing = missingText_(missing);
        if (final) line.finalBasis = 'Group 17 ' + side + ' report ' + period.start + ' to ' + period.end;
        lines.push(line);
      });
    });

    var perq = monthEndLine_('Person', period, 'PERQ opportunities', '', person, 'count');
    var daily = personDailyOpportunities_(closing, person.name);
    countLine_(ctx, perq, closing, 'person', person.name, period, last, 'opportunities', daily, 'PERQ Salesperson Ups + Be Backs');
    if (perq.through) perq.basis += '. A day whose salesperson rows add up to the store count is 0 for anyone not listed';
    var perqFinal = closingFinalCount_(ctx.closing, 'person', person.name, period, 'opportunities');
    if (perqFinal) { perq.final = perqFinal.opportunities; perq.finalBasis = 'PERQ Salesperson ' + perqFinal.start + ' to ' + perqFinal.end; }
    lines.push(perq);

    var closingLine = monthEndLine_('Person', period, 'Closing ratio', 'written', person, 'percent');
    var result = personClosing_(closing, person.name, period.start, period.end, goal, ledger);
    closingLine.verified = result.through ? (result.opportunities ? result.ratio : 'No opportunities') : null;
    closingLine.through = result.through;
    closingLine.basis = result.through ? result.orders + ' Group 17 Written orders ÷ ' + result.opportunities + ' PERQ opportunities. ' + result.note : result.note;
    closingLine.dailyTotal = 'Not applicable: a ratio is not summed';
    closingLine.snapshot = 'See the Orders (written) and PERQ opportunities rows';
    closingLine.missing = result.through ? 'None' : result.ratioStatus;
    if (analysisFinal.written && analysisFinal.written.orders !== null && perqFinal && perqFinal.opportunities) {
      closingLine.final = closingRatio_(analysisFinal.written.orders, perqFinal.opportunities).ratio;
      closingLine.finalBasis = analysisFinal.written.orders + ' orders ÷ ' + perqFinal.opportunities + ' opportunities from the official finals';
    }
    lines.push(closingLine);
  });
  return lines;
}

/** Every row for one month of one track, in a fixed order. */
function monthEndRowsFor_(ctx, track, period) {
  var yesterday = shiftDate_(ctx.today, -1);
  var last = period.end < ctx.today ? period.end : yesterday;
  var lines = track === 'Store' ? monthEndStoreLines_(ctx, period, last) : monthEndPersonLines_(ctx, period, last);
  var rank = function (line) { var at = MONTH_END_ORDER_.indexOf(line.metric); return at === -1 ? MONTH_END_ORDER_.length : at; };
  lines.sort(function (left, right) {
    if (left.person !== right.person) return left.person < right.person ? -1 : 1;
    if (rank(left) !== rank(right)) return rank(left) - rank(right);
    return left.side === right.side ? 0 : (left.side === 'written' || left.side === '' ? -1 : 1);
  });
  return lines.map(function (line) { return monthEndRow_(ctx, line); });
}

/** Store months and salesperson months that have any record on file, by period key. */
function monthEndPeriodsWithData_(ctx) {
  var found = {};
  function add(track, date) {
    if (!date) return;
    var period = track === 'Store' ? storePeriodContaining_(date) : individualPeriodContaining_(date);
    found[periodKey_(track, period)] = { track: track, period: period };
  }
  ctx.ledger.forEach(function (row) {
    if (!row.scope || (row.grain === 'cumulative' && !row.fitsTrack)) return;
    add(row.scope === 'STORE' ? 'Store' : 'Person', row.grain === 'daily' ? row.reportDate : row.periodStart);
  });
  Object.keys(ctx.facts).forEach(function (date) { add('Store', date); });
  ctx.associates.forEach(function (line) { add('Person', line.date); });
  ctx.closing.forEach(function (row) { add(row.scope === 'store' ? 'Store' : 'Person', row.start); });
  return found;
}

/** The current store and salesperson months, plus the previous ones while they have records on file. */
function monthEndPeriods_(ctx) {
  var yesterday = shiftDate_(ctx.today, -1);
  var store = storePeriodContaining_(yesterday);
  var person = individualPeriodContaining_(yesterday);
  var previousStore = storePeriodContaining_(shiftDate_(store.start, -1));
  var previousPerson = individualPeriodContaining_(shiftDate_(person.start, -1));
  var withData = monthEndPeriodsWithData_(ctx);
  var periods = [['Store', store]];
  if (withData[periodKey_('Store', previousStore)]) periods.push(['Store', previousStore]);
  periods.push(['Person', person]);
  if (withData[periodKey_('Person', previousPerson)]) periods.push(['Person', previousPerson]);
  return periods;
}

function monthEndRows_(ctx) {
  var rows = [];
  monthEndPeriods_(ctx).forEach(function (entry) {
    rows = rows.concat(monthEndRowsFor_(ctx, entry[0], entry[1]));
  });
  return rows;
}

function refreshMonthEnd_() {
  ensureMonthEndNotes_();
  var rows = monthEndRows_(monthEndContext_(todayNy_()));
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName(MONTH_END_TAB_) || spreadsheet.insertSheet(MONTH_END_TAB_);
  var grid = [MONTH_END_HEADERS_].concat(rows);
  tab.clearContents();
  tab.getRange(1, 1, grid.length, MONTH_END_HEADERS_.length).setValues(grid);
  return rows.length;
}
