var LEDGER_VIEWS_ = [
  'SNAP_STORE', 'SNAP_PERSON', 'NWDSR_WRITTEN_STORE', 'NWDSR_WRITTEN_PERSON',
  'NWDSR_DELIVERED_STORE', 'NWDSR_DELIVERED_PERSON', 'PERQ_STORE', 'PERQ_PERSON',
  'BEDDING_STORE', 'BEDDING_PERSON', 'MPPA_STORE', 'MPPA_PERSON', 'BASES_STORE', 'BASES_PERSON',
  'PILLOWS_STORE', 'PILLOWS_PERSON', 'FABW_STORE', 'FABW_PERSON', 'LTHW_STORE', 'LTHW_PERSON',
  'PWAR_STORE', 'PWAR_PERSON', 'UVWL_STORE', 'UVWL_PERSON', 'FINANCE_STORE', 'FINANCE_PERSON',
  'RUGS_STORE', 'RUGS_PERSON', 'AVERAGE_STORE', 'AVERAGE_PERSON', 'DA_SALES_STORE', 'DA_SALES_PERSON',
  'ATTACH_STORE', 'ATTACH_PERSON', 'FP_STORE', 'FP_PERSON', 'PET_STORE', 'PET_PERSON', 'PWRBASE_STORE', 'PWRBASE_PERSON'
];

// NWDSR Net Written and Delivered are store-level ranking reports, so no report supplies these salesperson views.
var NOT_SUPPLIED_VIEWS_ = ['NWDSR_WRITTEN_PERSON', 'NWDSR_DELIVERED_PERSON'];

function ledgerSheet_() {
  forgetRead_('CC_Ledger');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_Ledger');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Ledger');
  tab.getRange(1, 1, 1, 18).setValues([[
    'view', 'grain', 'report_date', 'period_start', 'period_end', 'verified_through', 'store',
    'employee_code', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible',
    'attachments', 'kpi_percent', 'source_report', 'imported_at', 'record_key'
  ]]);
  return tab;
}

/** STORE or PERSON, from the view name. Everything else is neither track. */
function viewScope_(view) {
  var match = /_(STORE|PERSON)$/.exec(String(view || ''));
  return match ? match[1] : '';
}

/**
 * The reporting track a record belongs to decides which dates it may cover.
 * STORE: the 2nd through the 1st of the next month. PERSON: the 1st through the last calendar day.
 * A single-day record fits either track. A cumulative record must start on its track's first day
 * and end inside that same period.
 */
function trackPeriod_(scope, start) {
  if (!start) return null;
  return scope === 'STORE' ? storePeriodContaining_(start) : individualPeriodContaining_(start);
}

function fitsTrack_(scope, start, end) {
  if (scope !== 'STORE' && scope !== 'PERSON') return false;
  if (!start || !end || end < start) return false;
  if (start === end) return true;
  var period = trackPeriod_(scope, start);
  return period.start === start && end <= period.end;
}

/**
 * A multi-day report is an official month-end final only when its printed period is exactly one finished reporting
 * month: STORE for the 2nd through the 1st, PERSON for the 1st through the last day. A report imported on or before
 * the period's last day cannot be the final, so the period must have ended before today.
 */
function officialFinalTrack_(start, end, today) {
  if (!start || !end || start === end || end >= today) return '';
  var store = storePeriodContaining_(start);
  if (store.start === start && store.end === end) return 'STORE';
  var person = individualPeriodContaining_(start);
  if (person.start === start && person.end === end) return 'PERSON';
  return '';
}

/** One official final as a cumulative CC_Ledger row. It sits beside the daily rows and is never added to them. */
function officialFinalRow_(view, start, end, code, name, side, figures, source) {
  var cell = function (value) { return value === null || value === undefined ? '' : value; };
  return [view, 'cumulative', '', start, end, end, '17', code || '', name || '', side, cell(figures.sales), cell(figures.units), cell(figures.eligible), cell(figures.attachments), cell(figures.percent), source, new Date().toISOString(),
    [view, 'cumulative', start, end, '', side, code || name || 'STORE'].join('|')];
}

function ledgerRows_() {
  return sheet_('CC_Ledger').map(function (row) {
    var view = String(row.view || '');
    var periodStart = isoDate_(row.period_start);
    var periodEnd = isoDate_(row.period_end);
    return {
      scope: viewScope_(view),
      fitsTrack: fitsTrack_(viewScope_(view), periodStart, periodEnd),
      view: view,
      grain: String(row.grain || ''),
      reportDate: isoDate_(row.report_date),
      periodStart: isoDate_(row.period_start),
      periodEnd: isoDate_(row.period_end),
      verifiedThrough: isoDate_(row.verified_through),
      code: String(row.employee_code || ''),
      name: String(row.employee_name || ''),
      side: String(row.side || ''),
      sales: fineNumber_(row.sales_dollars),
      units: fineNumber_(row.unit_count),
      eligible: fineNumber_(row.eligible),
      attachments: fineNumber_(row.attachments),
      percent: fineNumber_(row.kpi_percent),
      source: String(row.source_report || ''),
      key: String(row.record_key || ''),
      importedAt: row.imported_at instanceof Date ? row.imported_at.toISOString() : String(row.imported_at || ''),
    };
  });
}

function laterLedger_(current, candidate) {
  if (!current) return candidate;
  if (candidate.verifiedThrough > current.verifiedThrough) return candidate;
  if (candidate.verifiedThrough === current.verifiedThrough && candidate.periodEnd > current.periodEnd) return candidate;
  return current;
}

/** A row from another period is never a stand-in: no match is Pending. */
function latestStoreLedger_(view, side, periodStart) {
  var best = null;
  if (viewScope_(view) !== 'STORE' || !periodStart) return null;
  ledgerRows_().forEach(function (row) {
    if (row.view !== view || row.grain !== 'cumulative' || row.side !== side || row.code || row.name) return;
    if (!row.fitsTrack || row.periodStart !== periodStart) return;
    best = laterLedger_(best, row);
  });
  return best;
}

function latestPersonLedger_(view, side, name, periodStart) {
  var best = null;
  if (viewScope_(view) !== 'PERSON' || !periodStart) return null;
  ledgerRows_().forEach(function (row) {
    if (row.view !== view || row.grain !== 'cumulative' || row.side !== side || row.name !== name) return;
    if (!row.fitsTrack || row.periodStart !== periodStart) return;
    best = laterLedger_(best, row);
  });
  return best;
}

function historySheet_() {
  forgetRead_('CC_History');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_History');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_History');
  tab.getRange(1, 1, 1, 6).setValues([['archived_at', 'tab', 'record_key', 'reason', 'replaced_by', 'previous_row']]);
  return tab;
}

/** Keep the row a corrected report replaces. CC_History is append-only. */
function archiveReplaced_(tabName, key, previousRow, replacedBy, reason) {
  historySheet_().appendRow([new Date().toISOString(), tabName, key, reason || 'Corrected report replaced this row.', replacedBy || '', JSON.stringify(previousRow)]);
}

var NOT_APPLIED_ = 'Later report for a recorded day differs. The recorded day was kept and this figure was not applied.';

/**
 * A recorded day is the historical record. A later pull that disagrees is logged, never applied: a cancellation
 * belongs to the day it is reported on.
 */
function holdBackDay_(tabName, key, previousRow, laterFigure, source) {
  archiveReplaced_(tabName, key, previousRow, 'not applied: ' + (source || ''), NOT_APPLIED_ + ' Later figure: ' + laterFigure + '.');
  appendException_('Needs Review', key + ' re-pull (' + (source || 'unknown file') + ') shows ' + laterFigure + ', which differs from the recorded day. The recorded figure was kept.');
}

/** Sales, units, eligible, attachments, and percent: the figures of a ledger row. */
function sameLedgerFigures_(left, right) {
  var i;
  for (i = 10; i <= 14; i += 1) {
    if (fineNumber_(left[i]) !== fineNumber_(right[i])) return false;
  }
  return true;
}

function ledgerFigureText_(row) {
  return [10, 11, 12, 13, 14].map(function (i) { return row[i] === '' || row[i] === null || row[i] === undefined ? '-' : String(row[i]); }).join(' / ');
}

function sameRowValues_(left, right, upTo) {
  var i;
  for (i = 0; i < upTo; i += 1) {
    if (String(left[i] === null || left[i] === undefined ? '' : left[i]) !== String(right[i] === null || right[i] === undefined ? '' : right[i])) return false;
  }
  return true;
}

function ledgerFigure_(row, unit) {
  if (!row) return null;
  if (unit === 'count') return row.units !== null ? row.units : row.attachments;
  if (unit === 'dollars') return row.sales;
  return row.percent;
}

function ledgerDetail_(row) {
  if (!row) return '';
  if (row.eligible !== null && row.attachments !== null) return row.attachments + ' of ' + row.eligible;
  if (row.sales !== null) return '';
  return '';
}

function ledgerSources_() {
  var grouped = {};
  ledgerRows_().forEach(function (row) {
    if (!grouped[row.view]) grouped[row.view] = { view: row.view, rows: 0, outOfScope: 0, through: '', source: '' };
    if (!row.fitsTrack) {
      grouped[row.view].outOfScope += 1;
      return;
    }
    grouped[row.view].rows += 1;
    if (row.verifiedThrough >= grouped[row.view].through) {
      grouped[row.view].through = row.verifiedThrough;
      grouped[row.view].source = row.source;
    }
  });
  return LEDGER_VIEWS_.map(function (view) {
    return grouped[view] || { view: view, rows: 0, outOfScope: 0, through: '', source: '' };
  });
}

function coverage_(payload) {
  var today = todayNy_();
  var store = storePeriodContaining_(today);
  var through = '';
  sheet_('CC_Daily').forEach(function (row) {
    var date = isoDate_(row.date);
    if (!date || date < store.start || date > store.end || date >= today) return;
    if (fineNumber_(row.nwdsr_written) === null && fineNumber_(row.snap_written) === null && fineNumber_(row.nwdsr_delivered) === null) return;
    if (date > through) through = date;
  });
  return {
    role: payload.session.role,
    period: store.start + ' through ' + store.end,
    through: through,
    today: today,
    standard: salesStandardText_(),
    rows: sheet_('CC_Coverage').map(function (row) {
      return {
        report: String(row.report || ''),
        earliest: String(row.earliest || ''),
        latest: String(row.latest || ''),
        dailyRecords: String(row.verified_daily_records || ''),
        dailyDates: String(row.daily_dates || ''),
        cumulative: String(row.cumulative_only || ''),
        missing: String(row.missing_daily_dates || ''),
        sheets: String(row.sheets_status || ''),
      };
    }),
  };
}

function sources_(payload) {
  var imports = sheet_('CC_Imports');
  var last = imports.length ? imports[imports.length - 1] : null;
  return {
    role: payload.session.role,
    spreadsheet: 'Store 17 Command Center',
    sources: ledgerSources_(),
    lastImport: last ? { file: String(last.file_name || ''), status: String(last.status || ''), at: String(last.imported_at || ''), note: String(last.note || '') } : null,
    missing: ledgerSources_().filter(function (row) { return !row.rows && NOT_SUPPLIED_VIEWS_.indexOf(row.view) === -1; }).map(function (row) { return row.view; }),
    notSupplied: NOT_SUPPLIED_VIEWS_,
  };
}

function scopeBlockerIdentity_(row) {
  var date = isoDate_(row[2]) || isoDate_(row[3]);
  return [String(row[0] || ''), String(row[1] || ''), date, String(row[9] || ''), String(row[7] || ''), String(row[8] || '')].join('|');
}

/** Name match ignores a code that one copy has and the other does not. Amounts within a cent are the same reported figure. */
function scopeBlockerName_(row) {
  var date = isoDate_(row[2]) || isoDate_(row[3]);
  return [String(row[0] || ''), String(row[1] || ''), date, String(row[9] || ''), String(row[8] || '').trim().toUpperCase()].join('|');
}

function sameReportedAmount_(left, right) {
  var a = fineNumber_(left);
  var b = fineNumber_(right);
  if (a === null || b === null) return String(left || '') === String(right || '');
  return Math.abs(a - b) < 0.015;
}

/**
 * STORE and PERSON tabs are one formula in A1. A typed row below that formula stops the result from expanding, so A1
 * shows #REF!. Those tabs are not a second copy of the ledger. A typed row already on CC_Ledger is removed. A typed
 * row that is not on CC_Ledger is appended there first, so a historical or negative line is not dropped.
 */
function repairScopeViewSheets_() {
  if (typeof LEDGER_VIEWS_ === 'undefined') return [];
  var book = book_();
  var ledgerTab = ledgerSheet_();
  var ledgerValues = ledgerTab.getDataRange().getValues();
  var known = {};
  var r;
  for (r = 1; r < ledgerValues.length; r += 1) {
    var existingKey = String(ledgerValues[r][17] || '');
    if (existingKey) known['key:' + existingKey] = ledgerValues[r];
    known['id:' + scopeBlockerIdentity_(ledgerValues[r])] = ledgerValues[r];
    known['name:' + scopeBlockerName_(ledgerValues[r])] = ledgerValues[r];
  }
  var repaired = [];
  LEDGER_VIEWS_.forEach(function (name) {
    var tab = book.getSheetByName(name);
    if (!tab || !tab.getRange) return;
    var origin = tab.getRange(1, 1);
    var formula = String(origin.getFormula() || '');
    if (formula.indexOf('CC_Ledger') === -1) return;
    if (String(origin.getDisplayValue() || '') !== '#REF!') return;
    var last = tab.getLastRow();
    if (last < 2) return;
    var width = Math.max(tab.getLastColumn ? tab.getLastColumn() : 18, 18);
    var values = tab.getRange(2, 1, last - 1, width).getValues();
    var kept = [];
    values.forEach(function (row) {
      if (!String(row[0] || '').trim()) return;
      var key = String(row[17] || '');
      var id = scopeBlockerIdentity_(row);
      var prior = (key && known['key:' + key]) || known['id:' + id] || known['name:' + scopeBlockerName_(row)];
      if (!prior) {
        var copy = row.slice(0, 18);
        while (copy.length < 18) copy.push('');
        if (!copy[17]) copy[17] = [copy[0], copy[1], isoDate_(copy[2]) || isoDate_(copy[3]), isoDate_(copy[3]), isoDate_(copy[4]), copy[9], copy[7] || copy[8] || 'STORE'].join('|');
        ledgerTab.appendRow(copy);
        known['key:' + copy[17]] = copy;
        known['id:' + id] = copy;
        known['name:' + scopeBlockerName_(copy)] = copy;
        kept.push(String(copy[17]));
        return;
      }
      if (!sameReportedAmount_(prior[10], row[10]) && typeof appendException_ === 'function') {
        appendException_('Needs Review', name + ' had a typed row for ' + id + ' of ' + row[10] + '. CC_Ledger already has ' + prior[10] + ' for that record and was kept. The typed row was only blocking the calculated tab.');
      }
    });
    tab.getRange(2, 1, last - 1, width).clearContent();
    repaired.push(name + (kept.length ? ' (saved to CC_Ledger: ' + kept.join(', ') + ')' : ''));
  });
  if (repaired.length) forgetRead_('CC_Ledger');
  return repaired;
}

function upsertLedgerDaily_(view, side, date, dollars, source) {
  if (dollars === null || dollars === undefined || dollars === '') return;
  var key = [view, 'daily', date, date, date, side, 'STORE'].join('|');
  var tab = ledgerSheet_();
  var values = tab.getDataRange().getValues();
  if (!values.length) return;
  var headers = values[0].map(function (cell) { return String(cell); });
  var keyCol = headers.indexOf('record_key');
  if (keyCol < 0) return;
  var payload = [view, 'daily', date, date, date, date, '17', '', '', side, dollars, '', '', '', '', source, new Date().toISOString(), key];
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][keyCol]) !== key) continue;
    var current = fineNumber_(values[r][headers.indexOf('sales_dollars')]);
    if (current !== fineNumber_(dollars)) holdBackDay_('CC_Ledger', key, values[r], String(dollars), source);
    return;
  }
  tab.appendRow(payload);
}
