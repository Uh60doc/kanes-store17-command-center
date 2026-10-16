/**
 * CC_MonthEnd: for each store and salesperson period, the daily tracked total beside the official month-end report.
 * The daily record is never changed by the final, and the final is never added to it. A variance is shown only when
 * every open day of the period has its daily report and a full-period report verified through the period end exists.
 */

var MONTH_END_TAB_ = 'CC_MonthEnd';
var MONTH_END_HEADERS_ = ['track', 'period_start', 'period_end', 'metric', 'side', 'person', 'unit', 'daily_tracked', 'daily_basis', 'official_final', 'official_basis', 'variance', 'status'];

var MONTH_END_METRICS_ = {
  NWDSR_WRITTEN: { label: 'NWDSR Written', unit: 'dollars', order: 1 },
  NWDSR_DELIVERED: { label: 'NWDSR Delivered', unit: 'dollars', order: 2 },
  SNAP: { label: 'SNAP Written', unit: 'dollars', order: 3 },
  PERQ: { label: 'PERQ opportunities', unit: 'count', field: 'eligible', order: 5 },
  BEDDING: { label: 'Bedding dollars', unit: 'dollars', order: 7 },
  MPPA: { label: 'Mattress protectors', unit: 'percent', order: 8 },
  BASES: { label: 'Adjustable bases', unit: 'percent', order: 9 },
  PILLOWS: { label: 'Pillows', unit: 'percent', order: 10 },
  FABW: { label: 'Fabric protection', unit: 'percent', order: 11 },
  LTHW: { label: 'Leather protection', unit: 'percent', order: 12 },
  PWAR: { label: 'Power warranty', unit: 'percent', order: 13 },
  UVWL: { label: 'Wood protection', unit: 'percent', order: 14 },
  RUGS: { label: 'Rugs', unit: 'count', field: 'units', order: 15 },
  FINANCE: { label: 'Finance', unit: 'percent', rate: true, order: 16 },
  AVERAGE: { label: 'Average ticket', unit: 'dollars', rate: true, order: 17 },
};

function monthEndRound_(value, places) {
  var scale = Math.pow(10, places);
  return Math.round(value * scale) / scale;
}

/** Open days of the period, and the ones that have already ended by yesterday. */
function monthEndDays_(period, closed, today) {
  var open = eachDate_(period.start, period.end).filter(function (date) { return !closed[date]; });
  var yesterday = shiftDate_(today, -1);
  return { open: open, elapsed: open.filter(function (date) { return date <= yesterday; }), over: period.end <= yesterday };
}

function monthEndCoverage_(days, covered) {
  var onFile = days.elapsed.filter(function (date) { return covered[date]; }).length;
  var complete = days.over && onFile === days.open.length;
  var basis = onFile + ' of ' + days.elapsed.length + ' open days ' + (days.over ? 'in the period' : 'so far');
  return { onFile: onFile, complete: complete, basis: basis, current: onFile === days.elapsed.length };
}

function monthEndStatus_(coverage, final, variance, period) {
  if (!coverage.complete) {
    if (!coverage.current) return 'Daily incomplete: ' + coverage.basis;
    return final ? 'Official final on file; daily period not finished' : 'In progress: official final after ' + period.end;
  }
  if (!final) return 'Awaiting official final';
  if (variance === null) return 'Official final on file; no comparable daily figure';
  return variance === 0 ? 'Matches official final' : 'Variance: official final differs from daily tracked';
}

function monthEndFinal_(rows, period) {
  var best = null;
  rows.forEach(function (row) {
    if (row.grain !== 'cumulative' || row.periodStart !== period.start || row.periodEnd !== period.end) return;
    if ((row.verifiedThrough || row.periodEnd) < period.end) return;
    if (!best || row.verifiedThrough > best.verifiedThrough) best = row;
  });
  return best;
}

function monthEndFigure_(metric, rows) {
  if (metric.unit === 'percent') {
    var eligible = 0;
    var attachments = 0;
    var seen = false;
    rows.forEach(function (row) {
      if (row.eligible === null && row.attachments === null) return;
      seen = true;
      eligible += row.eligible || 0;
      attachments += row.attachments || 0;
    });
    return { value: eligible ? monthEndRound_(attachments / eligible, 4) : 'No eligible sales', detail: attachments + ' of ' + eligible + ' eligible' + (seen ? '' : ' (no lines)') };
  }
  var field = metric.field || 'sales';
  var total = 0;
  rows.forEach(function (row) { total += row[field] || 0; });
  return { value: monthEndRound_(total, 2), detail: '' };
}

function monthEndFinalFigure_(metric, row) {
  if (!row) return null;
  if (metric.rate) return metric.unit === 'percent' ? row.percent : row.sales;
  if (metric.unit === 'percent') return row.eligible ? monthEndRound_((row.attachments || 0) / row.eligible, 4) : row.percent;
  return metric.field ? row[metric.field] : row.sales;
}

function monthEndRow_(track, period, label, side, person, unit, daily, dailyBasis, final, finalBasis, variance, status) {
  return [track, period.start, period.end, label, side, person, unit, daily === null ? 'Pending' : daily, dailyBasis, final === null ? 'Pending' : final, finalBasis, variance === null ? '' : variance, status];
}

/** Every row for one period of one track. Ledger rows outside the track's period are never used. */
function monthEndRowsFor_(track, period, ledger, closing, closed, today) {
  var scope = track === 'Store' ? 'STORE' : 'PERSON';
  var days = monthEndDays_(period, closed, today);
  var groups = {};
  var storeDays = {};
  var storeDaily = {};
  ledger.forEach(function (row) {
    var prefix = String(row.view || '').replace(/_(STORE|PERSON)$/, '');
    if (!MONTH_END_METRICS_[prefix] || !row.fitsTrack) return;
    var inPeriod = row.grain === 'daily' ? row.reportDate >= period.start && row.reportDate <= period.end : row.periodStart === period.start;
    if (!inPeriod) return;
    if (row.grain === 'daily' && row.scope === 'STORE') {
      var dayKey = prefix + '|' + row.side;
      storeDays[dayKey] = storeDays[dayKey] || {};
      storeDays[dayKey][row.reportDate] = true;
      storeDaily[dayKey + '|' + row.reportDate] = row;
    }
    if (row.scope !== scope) return;
    var person = scope === 'PERSON' ? (row.code || row.name) : '';
    var key = prefix + '|' + row.side + '|' + person;
    groups[key] = groups[key] || { prefix: prefix, side: row.side, person: person, name: row.name || row.code, daily: [], cumulative: [] };
    groups[key][row.grain === 'daily' ? 'daily' : 'cumulative'].push(row);
  });

  var personDay = {};
  ledger.forEach(function (row) {
    if (row.view !== 'PERQ_PERSON' || row.grain !== 'daily' || row.eligible === null) return;
    personDay[row.reportDate] = (personDay[row.reportDate] || 0) + row.eligible;
  });

  var out = [];
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    var metric = MONTH_END_METRICS_[group.prefix];
    var final = monthEndFinal_(group.cumulative, period);
    var finalValue = monthEndFinalFigure_(metric, final);
    var finalBasis = final ? 'Report ' + final.periodStart + ' to ' + final.periodEnd + ', verified through ' + final.verifiedThrough + (final.source ? ' (' + final.source + ')' : '') : 'No full-period report verified through ' + period.end;
    var sideLabel = group.side || '';
    if (metric.rate) {
      out.push([group.prefix, monthEndRow_(track, period, metric.label, sideLabel, group.name, metric.unit, null, 'Not added: daily rates and averages are not summed', finalValue, finalBasis, null, final ? 'Official final only' : 'Awaiting official final')]);
      return;
    }
    var covered = {};
    var storeKey = group.prefix + '|' + group.side;
    if (scope === 'STORE') covered = storeDays[storeKey] || {};
    else if (group.prefix === 'PERQ') {
      Object.keys(storeDays[storeKey] || {}).forEach(function (date) {
        var store = storeDaily[storeKey + '|' + date];
        if (store && store.eligible !== null && personDay[date] === store.eligible) covered[date] = true;
      });
      group.daily.forEach(function (row) { covered[row.reportDate] = true; });
    } else covered = storeDays[storeKey] || {};
    var coverage = monthEndCoverage_(days, covered);
    var figure = monthEndFigure_(metric, group.daily);
    var dailyValue = coverage.onFile ? figure.value : null;
    var variance = coverage.complete && typeof dailyValue === 'number' && typeof finalValue === 'number'
      ? monthEndRound_(metric.unit === 'percent' ? (finalValue - dailyValue) * 100 : finalValue - dailyValue, metric.unit === 'percent' ? 1 : 2)
      : null;
    var dailyBasis = (figure.detail ? figure.detail + '; ' : '') + coverage.basis + (scope === 'PERSON' && group.prefix !== 'PERQ' ? '. A reported day without a line for this person is 0' : '');
    out.push([group.prefix, monthEndRow_(track, period, metric.label, sideLabel, scope === 'PERSON' ? group.name : '', metric.unit, dailyValue, dailyBasis, finalValue, finalBasis, variance, monthEndStatus_(coverage, final, variance, period))]);
  });

  if (scope === 'STORE') out = out.concat(monthEndClosingRows_(period, days, closing, ledger));
  else out.push(['CUSTOMERS', monthEndRow_(track, period, 'Purchasing customers', '', 'Each salesperson', 'count', null, 'No report gives a salesperson\'s own Net Written # OF CUST', null, 'Store customers are not divided among salespeople', null, AWAITING_)]);

  out.sort(function (left, right) {
    var a = MONTH_END_METRICS_[left[0]] ? MONTH_END_METRICS_[left[0]].order : left[0] === 'CUSTOMERS' ? 4 : 6;
    var b = MONTH_END_METRICS_[right[0]] ? MONTH_END_METRICS_[right[0]].order : right[0] === 'CUSTOMERS' ? 4 : 6;
    if (a !== b) return a - b;
    var person = String(left[1][5]).localeCompare(String(right[1][5]));
    return person || String(left[1][4]).localeCompare(String(right[1][4]));
  });
  return out.map(function (entry) { return entry[1]; });
}

/** Store purchasing customers from CC_Closing, and the store closing ratio from the two month totals. */
function monthEndClosingRows_(period, days, closing, ledger) {
  var daily = {};
  var conflict = {};
  var finalRow = null;
  closing.forEach(function (row) {
    if (row.scope !== 'store' || row.code || !row.final || row.customers === null) return;
    if (row.start === row.end && row.start >= period.start && row.start <= period.end) {
      if (Object.prototype.hasOwnProperty.call(daily, row.start) && daily[row.start] !== row.customers) conflict[row.start] = true;
      daily[row.start] = row.customers;
    } else if (row.start === period.start && row.end === period.end && (row.through || row.end) >= period.end) {
      if (!finalRow || row.through > finalRow.through) finalRow = row;
    }
  });
  Object.keys(conflict).forEach(function (date) { delete daily[date]; });
  var covered = {};
  var total = 0;
  Object.keys(daily).forEach(function (date) { covered[date] = true; total += daily[date]; });
  var coverage = monthEndCoverage_(days, covered);
  var customers = coverage.onFile ? total : null;
  var finalCustomers = finalRow ? finalRow.customers : null;
  var variance = coverage.complete && finalRow ? finalCustomers - customers : null;
  var rows = [['CUSTOMERS', monthEndRow_('Store', period, 'Purchasing customers', '', '', 'count', customers, 'NWDSR Net Written # OF CUST; ' + coverage.basis,
    finalCustomers, finalRow ? 'Report ' + finalRow.start + ' to ' + finalRow.end + ', verified through ' + finalRow.through : 'No full-period report verified through ' + period.end,
    variance, monthEndStatus_(coverage, finalRow, variance, period))]];

  var oppDays = {};
  var opportunities = 0;
  var oppFinal = null;
  ledger.forEach(function (row) {
    if (row.view !== 'PERQ_STORE' || !row.fitsTrack || row.eligible === null) return;
    if (row.grain === 'daily' && row.reportDate >= period.start && row.reportDate <= period.end) {
      oppDays[row.reportDate] = true;
      opportunities += row.eligible;
    }
  });
  oppFinal = monthEndFinal_(ledger.filter(function (row) { return row.view === 'PERQ_STORE' && row.fitsTrack; }), period);
  var oppCoverage = monthEndCoverage_(days, oppDays);
  var bothCurrent = coverage.current && oppCoverage.current && opportunities > 0;
  var ratio = bothCurrent ? monthEndRound_(customers / opportunities, 4) : null;
  var finalRatio = finalRow && oppFinal && oppFinal.eligible ? monthEndRound_(finalCustomers / oppFinal.eligible, 4) : null;
  var complete = coverage.complete && oppCoverage.complete;
  var ratioVariance = complete && ratio !== null && finalRatio !== null ? monthEndRound_((finalRatio - ratio) * 100, 1) : null;
  var ratioStatus = complete
    ? (finalRatio === null ? 'Awaiting official final' : ratioVariance === 0 ? 'Matches official final' : 'Variance: official final differs from daily tracked')
    : (bothCurrent ? 'In progress: official final after ' + period.end : 'Daily incomplete: customers ' + coverage.basis + ', PERQ ' + oppCoverage.basis);
  rows.push(['RATIO', monthEndRow_('Store', period, 'Closing ratio', '', '', 'percent', ratio, bothCurrent ? customers + ' customers ÷ ' + opportunities + ' opportunities from daily reports' : 'Needs every day\'s customers and PERQ count. See CC_ClosingMTD for the snapshot-based month to date',
    finalRatio, finalRatio === null ? 'Needs full-period customers and PERQ reports' : finalCustomers + ' ÷ ' + oppFinal.eligible, ratioVariance, ratioStatus)]);
  return rows;
}

/** The current store and salesperson periods, plus the previous ones while daily NWDSR Written reports are on file for them. */
function monthEndPeriods_(today, ledger) {
  var yesterday = shiftDate_(today, -1);
  var periods = [];
  var store = storePeriodContaining_(yesterday);
  var person = individualPeriodContaining_(yesterday);
  var previousStore = storePeriodContaining_(shiftDate_(store.start, -1));
  var previousPerson = individualPeriodContaining_(shiftDate_(person.start, -1));
  var hasDaily = function (period) {
    return ledger.some(function (row) { return row.view === 'NWDSR_WRITTEN_STORE' && row.grain === 'daily' && row.reportDate >= period.start && row.reportDate <= period.end; });
  };
  periods.push(['Store', store]);
  if (hasDaily(previousStore)) periods.push(['Store', previousStore]);
  periods.push(['Person', person]);
  if (hasDaily(previousPerson)) periods.push(['Person', previousPerson]);
  return periods;
}

function monthEndRows_(ledger, closing, closed, today) {
  var rows = [];
  monthEndPeriods_(today, ledger).forEach(function (entry) {
    rows = rows.concat(monthEndRowsFor_(entry[0], entry[1], ledger, closing, closed, today));
  });
  return rows;
}

function refreshMonthEnd_() {
  var rows = monthEndRows_(ledgerRows_(), readClosing_(), closedDates_(), todayNy_());
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName(MONTH_END_TAB_) || spreadsheet.insertSheet(MONTH_END_TAB_);
  var grid = [MONTH_END_HEADERS_].concat(rows);
  tab.clearContents();
  tab.getRange(1, 1, grid.length, MONTH_END_HEADERS_.length).setValues(grid);
  return rows.length;
}
