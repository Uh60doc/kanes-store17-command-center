var LEDGER_VIEWS_ = [
  'SNAP_STORE', 'SNAP_PERSON', 'NWDSR_WRITTEN_STORE', 'NWDSR_WRITTEN_PERSON',
  'NWDSR_DELIVERED_STORE', 'NWDSR_DELIVERED_PERSON', 'PERQ_STORE', 'PERQ_PERSON',
  'BEDDING_STORE', 'BEDDING_PERSON', 'MPPA_STORE', 'MPPA_PERSON', 'BASES_STORE', 'BASES_PERSON',
  'PILLOWS_STORE', 'PILLOWS_PERSON', 'FABW_STORE', 'FABW_PERSON', 'LTHW_STORE', 'LTHW_PERSON',
  'PWAR_STORE', 'PWAR_PERSON', 'UVWL_STORE', 'UVWL_PERSON', 'FINANCE_STORE', 'FINANCE_PERSON',
  'RUGS_STORE', 'RUGS_PERSON'
];

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

function ledgerRows_() {
  return sheet_('CC_Ledger').map(function (row) {
    return {
      view: String(row.view || ''),
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

function latestStoreLedger_(view, side, periodStart) {
  var best = null;
  var fallback = null;
  ledgerRows_().forEach(function (row) {
    if (row.view !== view || row.grain !== 'cumulative' || row.side !== side || row.code || row.name) return;
    fallback = laterLedger_(fallback, row);
    if (periodStart && row.periodStart === periodStart) best = laterLedger_(best, row);
  });
  return best || fallback;
}

function latestPersonLedger_(view, side, name, periodStart) {
  var best = null;
  var fallback = null;
  ledgerRows_().forEach(function (row) {
    if (row.view !== view || row.grain !== 'cumulative' || row.side !== side || row.name !== name) return;
    fallback = laterLedger_(fallback, row);
    if (!periodStart || row.periodStart === periodStart) best = laterLedger_(best, row);
  });
  return best || fallback;
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
    if (!grouped[row.view]) grouped[row.view] = { view: row.view, rows: 0, through: '', source: '' };
    grouped[row.view].rows += 1;
    if (row.verifiedThrough >= grouped[row.view].through) {
      grouped[row.view].through = row.verifiedThrough;
      grouped[row.view].source = row.source;
    }
  });
  return LEDGER_VIEWS_.map(function (view) {
    return grouped[view] || { view: view, rows: 0, through: '', source: '' };
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
    missing: ledgerSources_().filter(function (row) { return !row.rows; }).map(function (row) { return row.view; }),
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
    if (current === Number(dollars)) return;
    tab.getRange(r + 1, 1, 1, payload.length).setValues([payload]);
    return;
  }
  tab.appendRow(payload);
}
