var LEDGER_VIEWS_ = [
  'SNAP_STORE', 'SNAP_PERSON', 'NWDSR_WRITTEN_STORE', 'NWDSR_WRITTEN_PERSON',
  'NWDSR_DELIVERED_STORE', 'NWDSR_DELIVERED_PERSON', 'PERQ_STORE', 'PERQ_PERSON',
  'BEDDING_STORE', 'BEDDING_PERSON', 'MPPA_STORE', 'MPPA_PERSON', 'BASES_STORE', 'BASES_PERSON',
  'PILLOWS_STORE', 'PILLOWS_PERSON', 'FABW_STORE', 'FABW_PERSON', 'LTHW_STORE', 'LTHW_PERSON',
  'PWAR_STORE', 'PWAR_PERSON', 'UVWL_STORE', 'UVWL_PERSON', 'FINANCE_STORE', 'FINANCE_PERSON',
  'RUGS_STORE', 'RUGS_PERSON', 'AVERAGE_STORE', 'AVERAGE_PERSON', 'DA_SALES_STORE', 'DA_SALES_PERSON'
];

// NWDSR Net Written and Delivered are store-level ranking reports, so no report supplies these salesperson views.
var NOT_SUPPLIED_VIEWS_ = ['NWDSR_WRITTEN_PERSON', 'NWDSR_DELIVERED_PERSON'];

function ledgerSheet_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
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
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
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
  return {
    role: payload.session.role,
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
