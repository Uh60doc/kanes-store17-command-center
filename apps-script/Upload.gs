/**
 * UPLOAD REPORTS. A manager or admin uploads a business day's reports from the website. Each file is identified
 * from its contents (never from its name alone), checked for Store 17 and for the chosen business date, and written
 * through the same import code the mailbox uses: a day already on file is never added again, a later file that
 * disagrees is held back for review, and nothing is deleted. Every attempt is logged in CC_Uploads.
 */

var UPLOAD_QUIET_ = false;
var UPLOAD_MAX_BYTES_ = 15 * 1024 * 1024;
var UPLOAD_HEADERS_ = ['uploaded_at', 'business_date', 'role', 'file_name', 'sha256', 'report', 'report_start', 'report_end', 'status', 'message'];
var PERQ_UPLOAD_SOURCE_ = 'PERQ Ups + Be Backs';

var UPLOAD_REPORTS_ = [
  { key: 'snapWritten', label: 'SNAP Written', format: 'PDF', use: 'Salesperson written sales and store reconciliation' },
  { key: 'nwdsrWritten', label: 'NWDSR Written', format: 'PDF', use: 'Primary store written sales and purchasing customers' },
  { key: 'nwdsrDelivered', label: 'NWDSR Delivered', format: 'PDF', use: 'Primary store delivered sales' },
  { key: 'g17Written', label: 'Group 17 Written', format: 'Excel', use: 'Store and salesperson written KPIs and order counts' },
  { key: 'g17Delivered', label: 'Group 17 Delivered', format: 'Excel', use: 'Salesperson delivered sales, store and salesperson delivered KPIs' },
  { key: 'aslWritten', label: 'ASL Written', format: 'Excel', use: 'Store pillows, adjustable bases, furniture protection and rugs (written)' },
  { key: 'aslDelivered', label: 'ASL Delivered', format: 'Excel', use: 'Store pillows, adjustable bases, furniture protection and rugs (delivered)' },
  { key: 'perqLocation', label: 'PERQ Performance Stats by Location', format: 'Excel', use: 'Store opportunities (Ups + Be Backs)' },
  { key: 'perqSalesperson', label: 'PERQ Performance Stats by Salesperson', format: 'Excel', use: 'Salesperson opportunities (Ups + Be Backs)' },
];

function uploadReportLabel_(key) {
  var found = UPLOAD_REPORTS_.filter(function (item) { return item.key === key; })[0];
  return found ? found.label : '';
}

function uploadTab_() {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Uploads');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_Uploads');
  tab.getRange(1, 1, 1, UPLOAD_HEADERS_.length).setValues([UPLOAD_HEADERS_]);
  return tab;
}

function uploadRows_() {
  return sheet_('CC_Uploads').map(function (row) {
    return {
      at: String(row.uploaded_at || ''),
      date: isoDate_(row.business_date),
      role: String(row.role || ''),
      file: String(row.file_name || ''),
      sha256: String(row.sha256 || ''),
      report: String(row.report || ''),
      start: isoDate_(row.report_start),
      end: isoDate_(row.report_end),
      status: String(row.status || ''),
      message: String(row.message || ''),
    };
  });
}

function moneyPlain_(value) {
  if (value === null || value === undefined || value === '') return 'Not Available';
  var number = Number(value);
  return (number < 0 ? '-$' : '$') + Math.abs(number).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function uploadDayText_(iso) {
  var parts = isoParts_(iso);
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[parts.month - 1] + ' ' + parts.day + ', ' + parts.year;
}

function importRecordFor_(sha) {
  var found = null;
  sheet_('CC_Imports').forEach(function (row) { if (String(row.sha256) === sha) found = row; });
  return found;
}

function bytesStartWith_(bytes, codes) {
  var i;
  for (i = 0; i < codes.length; i += 1) {
    var value = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    if (value !== codes[i]) return false;
  }
  return true;
}

/** Every cell of the first visible worksheet as a grid of rows; empty cells are ''. */
function uploadGrid_(cells) {
  var rows = 0;
  var cols = 0;
  cells.forEach(function (cell) {
    if (cell.row > rows) rows = cell.row;
    if (cell.col > cols) cols = cell.col;
  });
  var grid = [];
  var r;
  for (r = 0; r < rows; r += 1) {
    var line = [];
    var c;
    for (c = 0; c < cols; c += 1) line.push('');
    grid.push(line);
  }
  cells.forEach(function (cell) { grid[cell.row - 1][cell.col - 1] = cell.value; });
  return grid;
}

function uploadText_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

/** What an Excel workbook is, from its first cells. Returns { key, grid, family, side } or { problem }. */
function classifyWorkbook_(bytes, fileName) {
  var files = {};
  try {
    Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', fileName)).forEach(function (blob) {
      if (/\.xml$|\.rels$/i.test(blob.getName())) files[blob.getName()] = blob.getDataAsString('UTF-8');
    });
  } catch (error) {
    return { problem: 'The file could not be opened as an Excel workbook.' };
  }
  var sheets;
  try {
    sheets = xlsxCells_(files).filter(function (sheet) { return !sheet.hidden; });
  } catch (error) {
    return { problem: 'The file is not an Excel .xlsx workbook.' };
  }
  if (!sheets.length) return { problem: 'The workbook has no visible worksheet.' };
  var grid = uploadGrid_(sheets[0].cells);
  var first = uploadText_(grid[0] && grid[0][0]);
  var second = uploadText_(grid[0] && grid[0][1]);
  if (/^Performance Stats by Location$/i.test(first)) return { key: 'perqLocation', grid: grid };
  if (/^Performance Stats by Salesperson$/i.test(first)) return { key: 'perqSalesperson', grid: grid };
  var family = /^GROUP 17$/i.test(first) ? 'group17' : /^GROUP ASL$/i.test(first) ? 'asl' : '';
  var side = /^WRITTEN ORDERS$/i.test(second) ? 'written' : /^DELIVERED ORDERS$/i.test(second) ? 'delivered' : '';
  if (family && side) {
    return { key: (family === 'asl' ? 'asl' : 'g17') + (side === 'written' ? 'Written' : 'Delivered'), grid: grid, family: family, side: side };
  }
  return { problem: 'This workbook is not one of the nine daily reports. Its first cell reads "' + (first || 'blank') + '".' };
}

/** The upload entry point: one file per call, so a large batch never runs into the Apps Script time limit. */
function uploadReport_(payload) {
  var date = isoDate_(payload.date);
  if (!date) throw new Error('Choose the business date first.');
  if (date > todayNy_()) throw new Error('The business date cannot be after today.');
  var fileName = String(payload.fileName || 'report').replace(/[\\\/]/g, '_').slice(0, 160);
  var base64 = String(payload.base64 || '');
  if (!base64) throw new Error(fileName + ' is empty.');
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > UPLOAD_MAX_BYTES_) throw new Error(fileName + ' is larger than 15 MB.');
  var sha = sha256Hex_(bytes);
  var context = { date: date, fileName: fileName, bytes: bytes, sha: sha, confirmed: isoDate_(payload.confirmDate) === date, role: payload.session.role };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    throw new Error('Another import is running. Wait a minute and import ' + fileName + ' again.');
  }
  var result;
  try {
    UPLOAD_QUIET_ = true;
    rosterCache_ = null;
    result = processUpload_(context);
  } catch (error) {
    result = { status: 'Failed', key: '', message: 'The import stopped: ' + String(error && error.message ? error.message : error) + ' Figures already on file were left in place.' };
    appendException_('Update Failed', fileName + ' (upload for ' + date + '): ' + result.message);
  } finally {
    UPLOAD_QUIET_ = false;
    lock.releaseLock();
  }
  uploadTab_().appendRow([new Date().toISOString(), date, context.role, fileName, sha, result.key ? uploadReportLabel_(result.key) : '', result.start || '', result.end || '', result.status, result.message]);
  return { file: fileName, sha256: sha, status: result.status, report: result.key ? uploadReportLabel_(result.key) : '', reportKey: result.key || '', start: result.start || '', end: result.end || '', message: result.message };
}

function processUpload_(context) {
  var prior = importRecordFor_(context.sha);
  var priorStatus = prior ? String(prior.status || '') : '';
  if (prior && priorStatus !== 'needs-review' && priorStatus !== 'failed' && priorStatus.indexOf('held') !== 0) {
    return {
      status: 'Already on file',
      key: '',
      message: 'This exact file was already imported on ' + String(prior.imported_at || '').slice(0, 10) + ' (' + priorStatus + (prior.note ? ': ' + String(prior.note) : '') + '). Nothing was changed.',
    };
  }
  if (bytesStartWith_(context.bytes, [37, 80, 68, 70])) return uploadPdf_(context);
  if (bytesStartWith_(context.bytes, [80, 75])) return uploadWorkbook_(context);
  return { status: 'Failed', key: '', message: 'This is not a PDF or an Excel .xlsx file, so it is not one of the nine daily reports. Nothing was changed.' };
}

// An answer that depends only on the business date chosen on screen (wrong date, date not confirmed)
// returns without this, so the file is not marked as seen and the mailbox import can still use it.
function finishImport_(context, result, importStatus, note) {
  recordImport_(context.sha, context.fileName, importStatus, note || result.message);
  var tab = SpreadsheetApp.openById(SPREADSHEET_ID_).getSheetByName('CC_Imports');
  if (tab && result.key) {
    var values = tab.getDataRange().getValues();
    var r;
    for (r = 1; r < values.length; r += 1) {
      if (String(values[r][0]) === context.sha) tab.getRange(r + 1, 3).setValue(uploadReportLabel_(result.key));
    }
  }
  return result;
}

function uploadPdf_(context) {
  var text;
  try {
    text = pdfText_(Utilities.newBlob(context.bytes, 'application/pdf', context.fileName));
  } catch (error) {
    return finishImport_(context, { status: 'Failed', key: '', message: 'The PDF could not be read. Try saving it again from the reporting site. Nothing was changed.' }, 'failed');
  }
  if (/SNAP\s*-\s*DELIVERED/i.test(text)) {
    return finishImport_(context, { status: 'Failed', key: '', message: 'This is SNAP Delivered, which is not one of the nine daily reports (delivered sales come from NWDSR Delivered). Nothing was changed.' }, 'not-used');
  }
  var parsed = parseCloudReport_(text);
  if (!parsed) {
    if (/SNAP\s*-\s*WRITTEN|NET WRITTEN STORE SALES|DELIVERED STORE SALES/i.test(text)) {
      return finishImport_(context, { status: 'Needs Review', key: '', message: 'The report type was found but the Store 17 total line was not. Check that the report was run for Store 17. Nothing was changed.' }, 'needs-review');
    }
    return finishImport_(context, { status: 'Failed', key: '', message: 'This PDF is not SNAP Written, NWDSR Written or NWDSR Delivered. Nothing was changed.' }, 'failed');
  }
  var key = parsed.reportType === 'SNAP Written' ? 'snapWritten' : parsed.reportType === 'NWDSR Written' ? 'nwdsrWritten' : 'nwdsrDelivered';
  var base = { key: key, start: parsed.start, end: parsed.end };
  if (!parsed.singleDay) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'This ' + parsed.reportType + ' report covers ' + parsed.start + ' through ' + parsed.end + '. Month-to-date reports are not added to daily figures. Upload the single-day report for ' + context.date + '. Nothing was changed.'), 'needs-review');
  }
  if (parsed.start !== context.date) {
    return uploadOutcome_(base, 'Failed', 'This ' + parsed.reportType + ' report is for ' + parsed.start + ', not the business date ' + context.date + '. Choose ' + parsed.start + ' as the business date to import it. Nothing was changed.');
  }
  var field = key === 'snapWritten' ? 'snapWritten' : key === 'nwdsrWritten' ? 'nwdsrWritten' : 'nwdsrDelivered';
  var before = dailyFacts_().filter(function (row) { return row.date === context.date; })[0];
  var existing = before ? before[field] : null;
  var decision = applyCloudReport_(parsed, text, context.sha);
  var extra = '';
  if (key === 'snapWritten') {
    var unmatched = snapAssociates_(text).filter(function (line) { return !rosterMatch_('', line.sourceName); }).map(function (line) { return line.sourceName; });
    extra = ' Salesperson lines: ' + (snapAssociates_(text).map(function (line) { return line.sourceName + ' ' + moneyPlain_(line.amount); }).join('; ') || 'none') + '.';
    if (unmatched.length) extra += ' Not on the roster: ' + unmatched.join(', ') + '. Add them (or an alias) in Admin > Manage Associates.';
  }
  if (key === 'nwdsrWritten' && parsed.purchasingCustomers !== null) extra = ' Purchasing customers: ' + parsed.purchasingCustomers + '.';
  if (decision === 'conflict') {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', parsed.reportType + ' for ' + context.date + ' shows ' + moneyPlain_(parsed.storeTotal) + ', but ' + moneyPlain_(existing) + ' is already on file. The recorded figure was kept and this file was not applied.'), 'needs-review');
  }
  if (key !== 'snapWritten') refreshStoreKpiQuietly_(context.date);
  if (existing !== null && existing === parsed.storeTotal) {
    return finishImport_(context, uploadOutcome_(base, 'Already on file', parsed.reportType + ' for ' + context.date + ' (Store 17 total ' + moneyPlain_(parsed.storeTotal) + ') was already on file with the same figure. Nothing was added.' + extra), 'duplicate');
  }
  return finishImport_(context, uploadOutcome_(base, 'Imported', parsed.reportType + ' for ' + context.date + ': Store 17 total ' + moneyPlain_(parsed.storeTotal) + ' saved.' + extra), 'imported', parsed.reportType + ' ' + parsed.start);
}

function uploadOutcome_(base, status, message) {
  return { key: base.key, start: base.start || '', end: base.end || '', status: status, message: message };
}

function uploadWorkbook_(context) {
  var info = classifyWorkbook_(context.bytes, context.fileName);
  if (!info.key) return finishImport_(context, { status: 'Failed', key: '', message: info.problem + ' Nothing was changed.' }, 'failed');
  if (info.key === 'perqLocation' || info.key === 'perqSalesperson') return uploadPerq_(context, info);
  return uploadKpiWorkbook_(context, info);
}

function canonicalKpiName_(family, side, date) {
  return 'DATA_ANALYSIS_KPI_' + (family === 'asl' ? 'ASL' : '17') + '_' + side.toUpperCase() + '_' + date + '_' + date + '.xlsx';
}

function uploadKpiWorkbook_(context, info) {
  var label = uploadReportLabel_(info.key);
  var named = /DATA_ANALYSIS_KPI_(17|ASL)_(WRITTEN|DELIVERED)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i.exec(context.fileName);
  var period = /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/.exec(context.fileName);
  var base = { key: info.key, start: context.date, end: context.date };
  if (named) {
    var namedFamily = named[1].toUpperCase() === 'ASL' ? 'asl' : 'group17';
    var namedSide = named[2].toLowerCase();
    if (namedFamily !== info.family || namedSide !== info.side) {
      return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'The file name says ' + (namedFamily === 'asl' ? 'ASL' : 'Group 17') + ' ' + namedSide + ', but the contents are ' + label + '. Check the file and upload it again. Nothing was changed.'), 'needs-review');
    }
  }
  if (period) {
    base.start = period[1];
    base.end = period[2];
    if (period[1] !== period[2]) {
      return finishImport_(context, uploadOutcome_(base, 'Needs Review', label + ' covers ' + period[1] + ' through ' + period[2] + '. Month-to-date reports are not added to the daily figures, so nothing was changed. Upload the single-day report for ' + context.date + '.'), 'needs-review');
    }
    if (period[1] !== context.date) {
      return uploadOutcome_(base, 'Failed', label + ' is for ' + period[1] + ', not the business date ' + context.date + '. Choose ' + period[1] + ' as the business date to import it. Nothing was changed.');
    }
  } else if (!context.confirmed) {
    return uploadOutcome_(base, 'Needs Review', 'This ' + label + ' file name has no report date and the workbook does not print one. Tick "These Excel files are for ' + context.date + '" and import it again. Nothing was changed.');
  }
  var date = context.date;
  var source = canonicalKpiName_(info.family, info.side, date);
  var records = kpiRecords_(info.grid, info.family, info.side, date, date, source);
  var storeView = info.family === 'asl' ? 'RUGS_STORE' : 'DA_SALES_STORE';
  var storeRecords = records.filter(function (record) { return /_STORE$/.test(record[0]); });
  var facts = dailyFacts_().filter(function (row) { return row.date === date; })[0] || {};
  var nwdsr = info.side === 'written' ? facts.nwdsrWritten : facts.nwdsrDelivered;
  var notes = [];
  if (!storeRecords.some(function (record) { return record[0] === storeView; })) {
    if (info.family === 'asl') {
      if (info.grid.length < 3) return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'The ASL workbook has no store rows. Check that the report finished running. Nothing was changed.'), 'needs-review');
      ['PILLOWS_STORE', 'BASES_STORE', 'FP_STORE'].forEach(function (view) { records.push(kpiRecord_(true, date, date, view, '', '', info.side, 0, 0, 0, 0, 0, source)); });
      records.push(kpiRecord_(true, date, date, 'RUGS_STORE', '', '', info.side, 0, 0, null, 0, null, source));
      notes.push('Store 17 is not listed, so it had no pillow, adjustable base, furniture protection or rug activity on this report; recorded as 0.');
    } else if (nwdsr === 0 && records.length === 0) {
      records.push(kpiRecord_(true, date, date, 'DA_SALES_STORE', '', '', info.side, 0, 0, null, null, null, source));
      records.push(kpiRecord_(true, date, date, 'BEDDING_STORE', '', '', info.side, 0, null, null, null, 0, source));
      ['FABW_STORE', 'PWAR_STORE', 'LTHW_STORE', 'MPPA_STORE', 'ATTACH_STORE'].forEach(function (view) { records.push(kpiRecord_(true, date, date, view, '', '', info.side, 0, 0, 0, 0, 0, source)); });
      records.push(kpiRecord_(true, date, date, 'FINANCE_STORE', '', '', info.side, null, null, null, null, 0, source));
      notes.push('The report has no sales lines and NWDSR ' + info.side + ' is $0, so the day is recorded as no sales.');
    } else {
      return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'Group 17 has no TOTAL line, so Store 17 sales could not be read. Nothing was changed.'), 'needs-review');
    }
  }
  var totalRecord = records.filter(function (record) { return record[0] === 'DA_SALES_STORE'; })[0];
  var total = totalRecord && totalRecord[10] !== '' ? Number(totalRecord[10]) : null;
  if (info.family === 'group17' && total !== null && nwdsr !== null && nwdsr !== undefined && Math.abs(total - nwdsr) > 1) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', label + ' TOTAL sales ' + moneyPlain_(total) + ' do not match NWDSR ' + (info.side === 'written' ? 'Written' : 'Delivered') + ' ' + moneyPlain_(nwdsr) + ' for ' + date + ', so this file may be for another day. Nothing was changed.'), 'needs-review');
  }
  if (info.family === 'group17' && (nwdsr === null || nwdsr === undefined)) {
    notes.push('NWDSR ' + (info.side === 'written' ? 'Written' : 'Delivered') + ' for ' + date + ' is not on file yet, so the store month KPIs wait for it before this day is added.');
  }
  var unmatched = [];
  if (info.family === 'group17') {
    var columns = kpiColumns_(info.grid);
    info.grid.slice(2).forEach(function (row) {
      var name = String(kpiCell_(row, columns.name) || '').trim();
      var identity = name && name.toUpperCase() !== 'TOTAL' ? kpiIdentity_(name) : null;
      if (identity && identity.unmatched && unmatched.indexOf(identity.display) === -1) unmatched.push(identity.display);
    });
  }
  var outcome = upsertKpiRecords_(records);
  // A name already on file from an earlier import was flagged then; only a newly saved name is flagged again.
  unmatched = unmatched.filter(function (display) {
    return outcome.addedKeys.some(function (key) { return key.split('|')[6] === display; });
  });
  records.forEach(function (record) {
    if (record[0] === 'BEDDING_STORE' && record[14] !== '') upsertDailyBedding_(date, info.side, record[14], source);
  });
  refreshStoreKpiQuietly_(date);
  var people = {};
  records.forEach(function (record) { if (/_PERSON$/.test(record[0])) people[record[8]] = true; });
  var listed = Object.keys(people).length;
  var rugs = records.filter(function (record) { return record[0] === 'RUGS_STORE'; })[0];
  var summary = label + ' for ' + date + ': ' + (info.family === 'asl'
    ? 'Store 17 line' + (rugs ? ', rugs sold ' + (rugs[11] === '' ? 0 : rugs[11]) : '') + '.'
    : (total !== null ? 'Store 17 sales ' + moneyPlain_(total) + ', ' : '') + listed + ' salesperson line' + (listed === 1 ? '' : 's') + '.');
  if (outcome.heldBack.length) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', summary + ' ' + outcome.heldBack.length + ' figure' + (outcome.heldBack.length === 1 ? '' : 's') + ' differ from the figures already recorded for ' + date + '. The recorded figures were kept and logged in CC_History for review. ' + notes.join(' ')), 'needs-review');
  }
  if (unmatched.length) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', summary + ' Saved. Not on the roster: ' + unmatched.join(', ') + '. Their figures are saved under the printed name; add them (or an alias) in Admin > Manage Associates. ' + notes.join(' ')), 'imported');
  }
  if (!outcome.added && !outcome.replaced) {
    return finishImport_(context, uploadOutcome_(base, 'Already on file', summary + ' Every figure was already on file with the same values. Nothing was added. ' + notes.join(' ')), 'duplicate');
  }
  return finishImport_(context, uploadOutcome_(base, 'Imported', summary + ' ' + outcome.added + ' figures saved' + (outcome.same ? ', ' + outcome.same + ' already on file' : '') + '. ' + notes.join(' ')), 'imported', label + ' ' + date);
}

/** "Active Deals 10/15/26 08:15pm" → 2026-10-15. */
function perqExportDate_(header) {
  var match = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(String(header || ''));
  if (!match) return '';
  var year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  return year + '-' + pad2_(Number(match[1])) + '-' + pad2_(Number(match[2]));
}

function parsePerqGrid_(key, grid) {
  if (key === 'perqLocation') {
    var store = null;
    grid.forEach(function (row) { if (store === null && /^Store 17\b/i.test(uploadText_(row[0]))) store = Number(row[1] || 0) || 0; });
    return { store17: store, people: [], exported: '' };
  }
  var headerIndex = -1;
  grid.forEach(function (row, i) { if (headerIndex < 0 && uploadText_(row[0]) === 'EmployeeCode') headerIndex = i; });
  if (headerIndex < 0) return { problem: 'The salesperson export has no EmployeeCode header row.' };
  var header = grid[headerIndex].map(uploadText_);
  var column = -1;
  var active = '';
  header.forEach(function (cell, i) {
    if (column < 0 && /^Ups \+ ?Be Backs$/i.test(cell)) column = i;
    if (!active && /^Active Deals/i.test(cell)) active = cell;
  });
  if (column < 0) return { problem: 'The salesperson export has no Ups + Be Backs column.' };
  var first = header.indexOf('FirstName');
  var last = header.indexOf('LastName');
  var people = grid.slice(headerIndex + 1).filter(function (row) { return uploadText_(row[0]); }).map(function (row) {
    var code = uploadText_(row[0]).toUpperCase();
    var printed = [first >= 0 ? uploadText_(row[first]) : '', last >= 0 ? uploadText_(row[last]) : ''].join(' ').trim();
    var match = rosterMatch_(code, code) || (printed ? rosterMatch_(code, printed) : null);
    return { code: match && match.employeeId ? match.employeeId : code, name: match ? match.name : printed || code, printed: printed, matched: !!match, opportunities: Number(row[column] || 0) || 0 };
  });
  return { store17: null, people: people, exported: perqExportDate_(active), exportedText: active.replace(/^Active Deals\s*/i, '') };
}

function perqOnFile_(date) {
  var store = null;
  var people = 0;
  var listed = 0;
  ledgerRows_().forEach(function (row) {
    if (row.grain !== 'daily' || row.reportDate !== date) return;
    if (row.view === 'PERQ_STORE' && row.eligible !== null) store = row.eligible;
    if (row.view === 'PERQ_PERSON' && row.eligible !== null) { people += row.eligible; listed += 1; }
  });
  return { store: store, people: people, listed: listed };
}

/** One PERQ daily count into CC_Closing and the PERQ_STORE / PERQ_PERSON ledger. Returns added, same or held. */
function recordPerqFact_(fact, fileName) {
  var outcome = 'same';
  var tab = closingSheet_();
  var values = tab.getDataRange().getValues();
  var found = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][1]) === fact.scope && String(values[r][2] || '').toUpperCase() === fact.code.toUpperCase() && isoDate_(values[r][6]) === fact.date && isoDate_(values[r][7]) === fact.date && String(values[r][8]) === PERQ_UPLOAD_SOURCE_) found = r;
  }
  var key = [fact.scope, fact.code.toUpperCase(), fact.date, fact.date].join('|');
  if (!found) {
    tab.appendRow([fact.date, fact.scope, fact.code, fact.name, '', fact.opportunities, fact.date, fact.date, PERQ_UPLOAD_SOURCE_, 'yes', fact.note, fact.date, '17']);
    outcome = 'added';
  } else if (numberOrNull_(values[found][5]) !== fact.opportunities) {
    holdBackDay_('CC_Closing', 'PERQ ' + key, values[found], String(fact.opportunities), fileName);
    outcome = 'held';
  }
  var view = fact.scope === 'store' ? 'PERQ_STORE' : 'PERQ_PERSON';
  var ledgerKey = [view, 'daily', fact.date, fact.date, fact.date, '', fact.code || 'STORE'].join('|');
  var ledger = upsertKpiRecords_([[view, 'daily', fact.date, fact.date, fact.date, fact.date, '17', fact.code, fact.name, '', '', '', fact.opportunities, '', '', PERQ_UPLOAD_SOURCE_, new Date().toISOString(), ledgerKey]]);
  if (ledger.heldBack.length) outcome = 'held';
  else if (ledger.added && outcome === 'same') outcome = 'added';
  return outcome;
}

function uploadPerq_(context, info) {
  var label = uploadReportLabel_(info.key);
  var date = context.date;
  var base = { key: info.key, start: date, end: date };
  if (!context.confirmed) {
    return uploadOutcome_(base, 'Needs Review', 'PERQ exports do not print the day they cover, so the business date must be confirmed. Tick "These Excel files are for ' + date + '" and import again. Nothing was changed.');
  }
  var parsed = parsePerqGrid_(info.key, info.grid);
  if (parsed.problem) return finishImport_(context, uploadOutcome_(base, 'Failed', parsed.problem + ' Nothing was changed.'), 'failed');
  if (parsed.exported && parsed.exported < date) {
    return uploadOutcome_(base, 'Failed', 'This export was saved ' + parsed.exportedText + ', before the business date ' + date + ', so it cannot hold that day. Nothing was changed.');
  }
  var onFile = perqOnFile_(date);
  var stamp = ' Uploaded as ' + context.fileName + ' (sha256 ' + context.sha.slice(0, 12) + '); business date confirmed by ' + context.role + '.';
  var outcomes = [];
  var message = '';
  var flags = [];
  if (info.key === 'perqLocation') {
    if (parsed.store17 === null) return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'Store 17 is not listed in this location export. Check the location filter. Nothing was changed.'), 'needs-review');
    outcomes.push(recordPerqFact_({ scope: 'store', code: '', name: '', opportunities: parsed.store17, date: date, note: 'Store 17 Ups + Be Backs for ' + date + ' only. Not added to any snapshot.' + stamp }, context.fileName));
    message = 'Store 17 opportunities for ' + date + ': ' + parsed.store17 + '.';
    if (onFile.listed && onFile.people > parsed.store17) flags.push('Salesperson opportunities on file for ' + date + ' add to ' + onFile.people + ', more than the store count of ' + parsed.store17 + '.');
    else if (onFile.listed && onFile.people < parsed.store17) message += ' Salesperson rows on file add to ' + onFile.people + ', so ' + (parsed.store17 - onFile.people) + ' not assigned to a salesperson.';
  } else {
    var matched = parsed.people.filter(function (person) { return person.matched; });
    var unmatched = parsed.people.filter(function (person) { return !person.matched; });
    var sum = matched.reduce(function (total, person) { return total + person.opportunities; }, 0) + unmatched.reduce(function (total, person) { return total + person.opportunities; }, 0);
    if (onFile.store !== null && sum > onFile.store) {
      return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'Salesperson opportunities add to ' + sum + ', more than the Store 17 count of ' + onFile.store + ' already on file for ' + date + '. Check that both exports are for the same day. Nothing was changed.'), 'needs-review');
    }
    matched.forEach(function (person) {
      outcomes.push(recordPerqFact_({ scope: 'person', code: person.code, name: person.name, opportunities: person.opportunities, date: date, note: 'Ups + Be Backs for ' + date + ' only. Not added to any snapshot.' + stamp }, context.fileName));
    });
    message = 'Salesperson opportunities for ' + date + ': ' + (matched.map(function (person) { return person.name + ' ' + person.opportunities; }).join(', ') || 'no salesperson rows') + '.';
    if (parsed.exportedText) message += ' Exported ' + parsed.exportedText + '.';
    if (unmatched.length) flags.push('Employee code' + (unmatched.length === 1 ? '' : 's') + ' not on the roster: ' + unmatched.map(function (person) { return person.code + (person.printed ? ' (' + person.printed + ')' : '') + ' ' + person.opportunities; }).join(', ') + '. Add the employee ID in Admin > Manage Associates, then upload this file again; the rows already saved will not be added twice.');
    if (onFile.store !== null && sum < onFile.store) {
      appendException_('Needs Review', 'PERQ ' + date + ': Store 17 shows ' + onFile.store + ' opportunities but the salesperson export adds to ' + sum + '. ' + (onFile.store - sum) + ' not assigned to anyone.');
      message += ' The store count on file is ' + onFile.store + ', so ' + (onFile.store - sum) + ' not assigned to a salesperson.';
    }
  }
  var held = outcomes.filter(function (item) { return item === 'held'; }).length;
  var added = outcomes.filter(function (item) { return item === 'added'; }).length;
  if (held) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', message + ' ' + held + ' count' + (held === 1 ? '' : 's') + ' differ from the count already recorded for ' + date + '. The recorded counts were kept and logged for review. ' + flags.join(' ')), 'needs-review');
  }
  if (flags.length) return finishImport_(context, uploadOutcome_(base, 'Needs Review', message + ' ' + flags.join(' ')), 'needs-review');
  if (!added) return finishImport_(context, uploadOutcome_(base, 'Already on file', message + ' Already on file with the same counts. Nothing was added.'), 'duplicate');
  return finishImport_(context, uploadOutcome_(base, 'Imported', message + ' Saved.'), 'imported', label + ' ' + date);
}

/* ---------- Store month KPIs (Home tiles) ---------- */

var STORE_KPI_FAMILIES_ = {
  group17: { anchor: 'DA_SALES', views: ['DA_SALES', 'BEDDING', 'FABW', 'PWAR', 'LTHW', 'MPPA', 'ATTACH', 'FINANCE'], source: /DATA_ANALYSIS_KPI_17_/i },
  asl: { anchor: 'RUGS', views: ['PILLOWS', 'BASES', 'FP', 'RUGS'], source: /DATA_ANALYSIS_KPI_ASL_/i },
};

function kpiRound_(value, places) {
  var factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

function kpiRateOrNull_(top, bottom) {
  return bottom === 0 ? null : kpiRound_(top / bottom, 3);
}

/**
 * The latest single-report store snapshot for the store month, then each following day whose report is on file.
 * A Group 17 day is added only when NWDSR for the same side and day is on file and matches its TOTAL. A missing open
 * day stops the count, so a later day is never added across a gap.
 */
function storeKpiCoverage_(ledger, family, side, period, facts, closed, today) {
  var spec = STORE_KPI_FAMILIES_[family];
  var prefixOf = function (row) { return row.view.replace(/_STORE$/, ''); };
  var storeRow = function (row) { return row.scope === 'STORE' && row.side === side && !row.code && !row.name && spec.views.indexOf(prefixOf(row)) !== -1 && spec.source.test(row.source); };
  var snapshot = '';
  ledger.forEach(function (row) {
    if (!storeRow(row) || row.grain !== 'cumulative' || !row.fitsTrack || row.periodStart !== period.start) return;
    if (row.source.indexOf(' + ') !== -1 || row.verifiedThrough > period.end) return;
    if (prefixOf(row) === spec.anchor && row.verifiedThrough > snapshot) snapshot = row.verifiedThrough;
  });
  var snapRows = {};
  var dayRows = {};
  ledger.forEach(function (row) {
    if (!storeRow(row)) return;
    var prefix = prefixOf(row);
    if (row.grain === 'cumulative' && snapshot && row.fitsTrack && row.periodStart === period.start && row.verifiedThrough === snapshot && row.source.indexOf(' + ') === -1) {
      snapRows[prefix] = laterLedger_(snapRows[prefix], row);
    }
    if (row.grain === 'daily' && row.reportDate) {
      if (!dayRows[row.reportDate]) dayRows[row.reportDate] = {};
      dayRows[row.reportDate][prefix] = row;
    }
  });
  var days = [];
  var issue = '';
  var limit = period.end < today ? period.end : today;
  var cursor = shiftDate_(snapshot || shiftDate_(period.start, -1), 1);
  while (cursor <= limit) {
    var day = dayRows[cursor];
    if (day && day[spec.anchor]) {
      if (family === 'group17') {
        var fact = facts[cursor];
        var nwdsr = fact ? (side === 'written' ? fact.nwdsrWritten : fact.nwdsrDelivered) : null;
        var sales = day.DA_SALES.sales === null ? 0 : day.DA_SALES.sales;
        if (nwdsr === null) { issue = 'NWDSR ' + side + ' for ' + cursor + ' is not on file yet.'; break; }
        if (Math.abs(sales - nwdsr) > 1) { issue = 'Group 17 ' + side + ' TOTAL ' + moneyPlain_(sales) + ' does not match NWDSR ' + side + ' ' + moneyPlain_(nwdsr) + ' for ' + cursor + '.'; break; }
      }
      days.push(cursor);
    } else if (!closed[cursor]) break;
    cursor = shiftDate_(cursor, 1);
  }
  var sources = [];
  Object.keys(snapRows).forEach(function (prefix) { if (sources.indexOf(snapRows[prefix].source) === -1) sources.push(snapRows[prefix].source); });
  days.forEach(function (date) {
    Object.keys(dayRows[date]).forEach(function (prefix) { if (sources.indexOf(dayRows[date][prefix].source) === -1) sources.push(dayRows[date][prefix].source); });
  });
  var unsnapped = snapshot ? spec.views.filter(function (prefix) { return !snapRows[prefix]; }) : [];
  return { family: family, side: side, snapshot: snapshot, snapRows: snapRows, dayRows: dayRows, days: days, through: days.length ? days[days.length - 1] : snapshot, issue: issue, sources: sources, unsnapped: unsnapped };
}

// The ledger views each CC_Kpi store line is built from. A line whose snapshot view is missing is left as recorded.
var STORE_KPI_LINE_VIEWS_ = {
  'Bedding': ['BEDDING', 'DA_SALES'], 'Mattress Protectors': ['MPPA'], 'Fabric Maintenance': ['FABW'], 'Leather Maintenance': ['LTHW'],
  'Power Upholstery': ['PWAR'], 'Total Attachment': ['ATTACH'], 'Finance': ['FINANCE', 'DA_SALES'], 'Average Ticket': ['DA_SALES'],
  'Adjustable Base Attachment': ['BASES'], 'Pillows': ['PILLOWS'], 'Wood / Furniture Protection': ['FP'], 'Rugs': ['RUGS'],
};

function countedFrom_(row) {
  return { qual: row && row.eligible !== null ? row.eligible : 0, sold: row && row.units !== null ? row.units : 0, dollars: row && row.sales !== null ? row.sales : 0 };
}

function addCounted_(left, right) {
  return { qual: left.qual + right.qual, sold: left.sold + right.sold, dollars: kpiRound_(left.dollars + right.dollars, 2) };
}

function storeKpiPart_(rows, family) {
  if (family === 'group17') {
    var sale = rows.DA_SALES;
    var sales = sale && sale.sales !== null ? sale.sales : 0;
    var finance = rows.FINANCE ? rows.FINANCE.percent : null;
    return {
      sales: sales,
      orders: sales === 0 ? 0 : (sale && sale.units !== null ? sale.units : null),
      financed: finance === null ? (sales === 0 ? 0 : null) : finance * sales,
      bedding: rows.BEDDING && rows.BEDDING.sales !== null ? rows.BEDDING.sales : 0,
      fabric: countedFrom_(rows.FABW), power: countedFrom_(rows.PWAR), leather: countedFrom_(rows.LTHW), pads: countedFrom_(rows.MPPA), attach: countedFrom_(rows.ATTACH),
    };
  }
  return {
    pillows: countedFrom_(rows.PILLOWS), bases: countedFrom_(rows.BASES), protection: countedFrom_(rows.FP),
    rugs: rows.RUGS && rows.RUGS.units !== null ? rows.RUGS.units : 0,
    rugDollars: rows.RUGS && rows.RUGS.sales !== null ? rows.RUGS.sales : 0,
  };
}

function combineStoreKpi_(left, right, family) {
  if (family === 'group17') {
    return {
      sales: kpiRound_(left.sales + right.sales, 2),
      orders: left.orders === null || right.orders === null ? null : left.orders + right.orders,
      financed: left.financed === null || right.financed === null ? null : left.financed + right.financed,
      bedding: kpiRound_(left.bedding + right.bedding, 2),
      fabric: addCounted_(left.fabric, right.fabric), power: addCounted_(left.power, right.power), leather: addCounted_(left.leather, right.leather),
      pads: addCounted_(left.pads, right.pads), attach: addCounted_(left.attach, right.attach),
    };
  }
  return {
    pillows: addCounted_(left.pillows, right.pillows), bases: addCounted_(left.bases, right.bases), protection: addCounted_(left.protection, right.protection),
    rugs: left.rugs + right.rugs, rugDollars: kpiRound_(left.rugDollars + right.rugDollars, 2),
  };
}

function storeKpiTotals_(coverage) {
  var parts = [];
  if (coverage.snapshot) parts.push(coverage.snapRows);
  coverage.days.forEach(function (date) { parts.push(coverage.dayRows[date]); });
  if (!parts.length) return null;
  var running = storeKpiPart_(parts[0], coverage.family);
  parts.slice(1).forEach(function (rows) { running = combineStoreKpi_(running, storeKpiPart_(rows, coverage.family), coverage.family); });
  return running;
}

function storeKpiThroughText_(period, coverage) {
  var snap = coverage.snapshot ? period.start + ' through ' + coverage.snapshot + ' snapshot' : '';
  var days = coverage.days.length > 1
    ? coverage.days[0] + ' through ' + coverage.days[coverage.days.length - 1] + ' daily files'
    : coverage.days.length ? coverage.days[0] + ' daily file' : '';
  if (snap && days) return snap + ' plus the ' + days;
  return snap || 'the ' + days;
}

/** Store-month cumulative ledger rows: the snapshot plus the days added to it. */
function storeKpiDerived_(period, coverage, value, importedAt) {
  var through = coverage.through;
  var out = [];
  var add = function (view, sales, units, eligible, attachments, percent) {
    var key = [view, 'cumulative', period.start, through, '', coverage.side, 'STORE'].join('|');
    var cell = function (number) { return number === null || number === undefined ? '' : number; };
    var prefix = view === 'AVERAGE_STORE' ? 'DA_SALES' : view.replace(/_STORE$/, '');
    if (coverage.unsnapped.indexOf(prefix) !== -1) return;
    out.push([view, 'cumulative', '', period.start, through, through, '17', '', '', coverage.side, cell(sales), cell(units), cell(eligible), cell(attachments), cell(percent), coverage.sources.join(' + '), importedAt, key]);
  };
  var qty = function (view, metric) {
    var percent = metric.qual === 0 ? 0 : kpiRound_(metric.sold / metric.qual, 3);
    add(view, metric.dollars, metric.sold, metric.qual, metric.sold, percent);
  };
  if (coverage.family === 'group17') {
    add('DA_SALES_STORE', value.sales, value.orders, null, null, null);
    add('BEDDING_STORE', value.bedding, null, null, null, kpiRateOrNull_(value.bedding, value.sales) === null ? 0 : kpiRateOrNull_(value.bedding, value.sales));
    qty('FABW_STORE', value.fabric);
    qty('PWAR_STORE', value.power);
    qty('LTHW_STORE', value.leather);
    qty('MPPA_STORE', value.pads);
    qty('ATTACH_STORE', value.attach);
    if (value.financed !== null) add('FINANCE_STORE', null, null, null, null, kpiRateOrNull_(value.financed, value.sales) === null ? 0 : kpiRateOrNull_(value.financed, value.sales));
    if (value.orders !== null && value.orders !== 0) add('AVERAGE_STORE', kpiRound_(value.sales / value.orders, 2), value.orders, null, null, null);
  } else {
    qty('PILLOWS_STORE', value.pillows);
    qty('BASES_STORE', value.bases);
    qty('FP_STORE', value.protection);
    add('RUGS_STORE', value.rugDollars, value.rugs, null, value.rugs, null);
  }
  return out;
}

/** CC_Kpi store rows: [metric, written, delivered, note] for one family. */
function storeKpiRows_(family, through, w, d) {
  var pct = function (top, bottom) { var value = kpiRateOrNull_(top, bottom); return value === null ? 0 : value; };
  var countNote = function (label, left, right) {
    return label + '. Written ' + (left ? left.sold : 0) + ' of ' + (left ? left.qual : 0) + ', delivered ' + (right ? right.sold : 0) + ' of ' + (right ? right.qual : 0) + '.';
  };
  var side = function (value, pick) { return value ? pick(value) : null; };
  if (family === 'group17') {
    return [
      ['Bedding', side(w, function (v) { return pct(v.bedding, v.sales); }), side(d, function (v) { return pct(v.bedding, v.sales); }), 'Bedding dollars ÷ sales, ' + through + '. Written ' + (w ? w.bedding : 0) + ' of ' + (w ? w.sales : 0) + ', delivered ' + (d ? d.bedding : 0) + ' of ' + (d ? d.sales : 0) + '.'],
      ['Mattress Protectors', side(w, function (v) { return pct(v.pads.sold, v.pads.qual); }), side(d, function (v) { return pct(v.pads.sold, v.pads.qual); }), countNote('Mattress Pads, ' + through, w && w.pads, d && d.pads)],
      ['Fabric Maintenance', side(w, function (v) { return pct(v.fabric.sold, v.fabric.qual); }), side(d, function (v) { return pct(v.fabric.sold, v.fabric.qual); }), countNote('Fabric, ' + through, w && w.fabric, d && d.fabric)],
      ['Leather Maintenance', side(w, function (v) { return pct(v.leather.sold, v.leather.qual); }), side(d, function (v) { return pct(v.leather.sold, v.leather.qual); }), countNote('Leather, ' + through, w && w.leather, d && d.leather)],
      ['Power Upholstery', side(w, function (v) { return pct(v.power.sold, v.power.qual); }), side(d, function (v) { return pct(v.power.sold, v.power.qual); }), countNote('Power furniture, ' + through, w && w.power, d && d.power)],
      ['Total Attachment', side(w, function (v) { return pct(v.attach.sold, v.attach.qual); }), side(d, function (v) { return pct(v.attach.sold, v.attach.qual); }), countNote('Group 17 TOTAL ATTACHMENTS, ' + through, w && w.attach, d && d.attach)],
      ['Finance', side(w, function (v) { return v.financed === null ? null : pct(v.financed, v.sales); }), side(d, function (v) { return v.financed === null ? null : pct(v.financed, v.sales); }), 'Financed dollars ÷ sales, ' + through + ". Financed dollars are each report's FIN % × its sales."],
      ['Average Ticket', side(w, function (v) { return v.orders ? kpiRound_(v.sales / v.orders, 2) : null; }), side(d, function (v) { return v.orders ? kpiRound_(v.sales / v.orders, 2) : null; }), 'Sales ÷ orders, ' + through + '. Written ' + (w ? w.sales : 0) + ' ÷ ' + (w ? w.orders : 0) + ', delivered ' + (d ? d.sales : 0) + ' ÷ ' + (d ? d.orders : 0) + '.'],
    ];
  }
  return [
    ['Adjustable Base Attachment', side(w, function (v) { return pct(v.bases.sold, v.bases.qual); }), side(d, function (v) { return pct(v.bases.sold, v.bases.qual); }), countNote('ASL Store 17 ADJ, ' + through, w && w.bases, d && d.bases)],
    ['Pillows', side(w, function (v) { return pct(v.pillows.sold, v.pillows.qual); }), side(d, function (v) { return pct(v.pillows.sold, v.pillows.qual); }), countNote('ASL Store 17 Pillows, ' + through, w && w.pillows, d && d.pillows)],
    ['Wood / Furniture Protection', side(w, function (v) { return pct(v.protection.sold, v.protection.qual); }), side(d, function (v) { return pct(v.protection.sold, v.protection.qual); }), countNote('ASL Store 17 FURNITURE PROTECTION, ' + through, w && w.protection, d && d.protection)],
    ['Rugs', side(w, function (v) { return v.rugs; }), side(d, function (v) { return v.rugs; }), 'ASL Store 17 rugs sold, ' + through + '.'],
  ];
}

/**
 * Recomputes the CC_Kpi store-month rows the Home tiles read, and the store cumulative ledger rows, from the
 * ledger: the store snapshot plus every daily report after it. Returns what changed. A row whose figures are
 * unchanged is left alone; a replaced CC_Kpi row is kept in CC_History.
 */
function refreshStoreKpi_(date) {
  var period = storePeriodContaining_(date);
  var today = todayNy_();
  var ledger = ledgerRows_();
  var facts = {};
  dailyFacts_().forEach(function (row) { facts[row.date] = row; });
  var closed = closedDates_();
  var importedAt = new Date().toISOString();
  var result = { period: period, kpiUpdated: [], kpiAppended: [], ledger: { added: 0, same: 0, replaced: 0 }, issues: [], through: {} };
  var tab = kpiSheet_();
  var kpi = tab.getDataRange().getValues();
  var derived = [];
  ['group17', 'asl'].forEach(function (family) {
    var written = storeKpiCoverage_(ledger, family, 'written', period, facts, closed, today);
    var delivered = storeKpiCoverage_(ledger, family, 'delivered', period, facts, closed, today);
    [written, delivered].forEach(function (coverage) { if (coverage.issue) result.issues.push(coverage.issue); });
    if (!written.through && !delivered.through) return;
    var w = storeKpiTotals_(written);
    var d = storeKpiTotals_(delivered);
    [[written, w], [delivered, d]].forEach(function (pair) {
      if (pair[0].days.length && pair[1]) derived = derived.concat(storeKpiDerived_(period, pair[0], pair[1], importedAt));
    });
    var through = written.through && delivered.through ? (written.through < delivered.through ? written.through : delivered.through) : (written.through || delivered.through);
    result.through[family] = through;
    var text = storeKpiThroughText_(period, written.through ? written : delivered);
    if (written.through && delivered.through && written.through !== delivered.through) text += ' (delivered through ' + delivered.through + ')';
    var unsnapped = written.unsnapped.concat(delivered.unsnapped);
    storeKpiRows_(family, text, w, d).forEach(function (line) {
      var missing = (STORE_KPI_LINE_VIEWS_[line[0]] || []).filter(function (prefix) { return unsnapped.indexOf(prefix) !== -1; });
      if (missing.length) {
        result.issues.push(line[0] + ' was left as recorded: the store snapshot through ' + (written.snapshot || delivered.snapshot) + ' has no ' + missing.join(' / ') + ' line, so the month total cannot be rebuilt from the daily files alone.');
        return;
      }
      var values = [line[0], line[1] === null ? '' : line[1], line[2] === null ? '' : line[2], line[3], period.start, period.end, through];
      var index = -1;
      var r;
      for (r = 1; r < kpi.length; r += 1) {
        if (String(kpi[r][0]) === line[0] && isoDate_(kpi[r][4]) === period.start && isoDate_(kpi[r][5]) === period.end) index = r;
      }
      if (index < 0) {
        tab.appendRow(values);
        kpi.push(values);
        result.kpiAppended.push(line[0]);
        return;
      }
      var current = kpi[index];
      var recordedThrough = isoDate_(current[6]);
      if (recordedThrough && recordedThrough > through) return;
      var same = fineNumber_(current[1]) === fineNumber_(values[1]) && fineNumber_(current[2]) === fineNumber_(values[2]) && String(current[3]) === values[3] && recordedThrough === through;
      if (same) return;
      archiveReplaced_('CC_Kpi', line[0] + '|' + period.start + '|' + period.end, current, 'store month through ' + through, 'A newer store-period snapshot replaced this row.');
      tab.getRange(index + 1, 1, 1, values.length).setValues([values]);
      kpi[index] = values;
      result.kpiUpdated.push(line[0]);
    });
  });
  if (derived.length) {
    var ledgerTab = ledgerSheet_();
    var existing = ledgerTab.getDataRange().getValues();
    var byKey = {};
    var r;
    for (r = 1; r < existing.length; r += 1) byKey[String(existing[r][17] || '')] = r + 1;
    var appends = [];
    derived.forEach(function (row) {
      var at = byKey[row[17]];
      if (at) {
        if (sameLedgerFigures_(existing[at - 1], row)) { result.ledger.same += 1; return; }
        archiveReplaced_('CC_Ledger', row[17], existing[at - 1], row[15], 'A newer store-period snapshot replaced this row.');
        ledgerTab.getRange(at, 1, 1, row.length).setValues([row]);
        result.ledger.replaced += 1;
        return;
      }
      appends.push(row);
    });
    if (appends.length) ledgerTab.getRange(existing.length + 1, 1, appends.length, appends[0].length).setValues(appends);
    result.ledger.added = appends.length;
  }
  return result;
}

function refreshStoreKpiQuietly_(date) {
  try {
    return refreshStoreKpi_(date);
  } catch (error) {
    appendException_('Update Failed', 'Store month KPIs were not recalculated after an upload for ' + date + '. ' + String(error && error.message ? error.message : error) + ' The previous figures were left in place.');
    return null;
  }
}

/* ---------- Status ---------- */

function uploadEvidence_() {
  var facts = {};
  dailyFacts_().forEach(function (row) { facts[row.date] = row; });
  var ledger = {};
  ledgerRows_().forEach(function (row) {
    if (row.grain !== 'daily' || !row.reportDate || row.code && row.view !== 'PERQ_PERSON') return;
    var key = row.view + '|' + row.side + '|' + row.reportDate;
    if (row.view === 'PERQ_PERSON') {
      var item = ledger[key] || (ledger[key] = { count: 0, opportunities: 0 });
      item.count += 1;
      item.opportunities += row.eligible || 0;
    } else ledger[key] = row;
  });
  var attempts = {};
  var uploads = uploadRows_();
  uploads.forEach(function (row) {
    var key = '';
    UPLOAD_REPORTS_.forEach(function (item) { if (item.label === row.report) key = item.key; });
    if (!key) return;
    attempts[key + '|' + row.date] = row;
  });
  return { facts: facts, ledger: ledger, attempts: attempts, uploads: uploads };
}

function uploadChecklist_(evidence, date) {
  var fact = evidence.facts[date] || {};
  var ledger = function (view, side) { return evidence.ledger[view + '|' + side + '|' + date] || null; };
  var asl = function (side) { return ledger('RUGS_STORE', side) || ledger('PILLOWS_STORE', side) || ledger('BASES_STORE', side) || ledger('FP_STORE', side); };
  var perqStore = ledger('PERQ_STORE', '');
  var perqPeople = ledger('PERQ_PERSON', '');
  return UPLOAD_REPORTS_.map(function (item) {
    var onFile = false;
    var detail = '';
    var check = '';
    if (item.key === 'snapWritten' && fact.snapWritten !== null && fact.snapWritten !== undefined) { onFile = true; detail = 'Store 17 total ' + moneyPlain_(fact.snapWritten); }
    if (item.key === 'nwdsrWritten' && fact.nwdsrWritten !== null && fact.nwdsrWritten !== undefined) { onFile = true; detail = 'Store 17 total ' + moneyPlain_(fact.nwdsrWritten); }
    if (item.key === 'nwdsrDelivered' && fact.nwdsrDelivered !== null && fact.nwdsrDelivered !== undefined) { onFile = true; detail = 'Store 17 total ' + moneyPlain_(fact.nwdsrDelivered); }
    if (item.key === 'g17Written' || item.key === 'g17Delivered') {
      var side = item.key === 'g17Written' ? 'written' : 'delivered';
      var row = ledger('DA_SALES_STORE', side);
      if (row) {
        onFile = true;
        detail = 'TOTAL sales ' + moneyPlain_(row.sales);
        var nwdsr = side === 'written' ? fact.nwdsrWritten : fact.nwdsrDelivered;
        if (nwdsr !== null && nwdsr !== undefined && Math.abs((row.sales || 0) - nwdsr) > 1) check = 'TOTAL ' + moneyPlain_(row.sales) + ' does not match NWDSR ' + side + ' ' + moneyPlain_(nwdsr) + '. The store month KPIs stop before this day until it is resolved.';
      }
    }
    if (item.key === 'aslWritten' || item.key === 'aslDelivered') {
      var aslRow = asl(item.key === 'aslWritten' ? 'written' : 'delivered');
      if (aslRow) {
        onFile = true;
        var rugs = ledger('RUGS_STORE', item.key === 'aslWritten' ? 'written' : 'delivered');
        detail = 'Store 17 line' + (rugs && rugs.units !== null ? ', rugs ' + rugs.units : '');
      }
    }
    if (item.key === 'perqLocation' && perqStore) { onFile = true; detail = 'Store 17 opportunities ' + perqStore.eligible; }
    if (item.key === 'perqSalesperson') {
      var attempt = evidence.attempts[item.key + '|' + date];
      if (perqPeople) { onFile = true; detail = perqPeople.count + ' salesperson row' + (perqPeople.count === 1 ? '' : 's') + ', ' + perqPeople.opportunities + ' opportunities'; }
      else if (attempt && (attempt.status === 'Imported' || attempt.status === 'Already on file')) { onFile = true; detail = 'No salesperson rows'; }
      if (perqPeople && perqStore && perqPeople.opportunities > perqStore.eligible) check = 'Salesperson opportunities (' + perqPeople.opportunities + ') exceed the store count (' + perqStore.eligible + ').';
    }
    var last = evidence.attempts[item.key + '|' + date] || null;
    var status = onFile ? 'Imported' : 'Missing';
    var message = detail;
    if (check) { status = 'Needs Review'; message = check; }
    else if (last && last.status === 'Needs Review') { status = 'Needs Review'; message = last.message; }
    else if (!onFile && last && last.status === 'Failed') { status = 'Failed'; message = last.message; }
    if (status === 'Missing') message = 'Not uploaded yet.';
    return { key: item.key, label: item.label, format: item.format, use: item.use, status: status, message: message, lastFile: last ? last.file : '', lastAt: last ? last.at : '' };
  });
}

var MAILBOX_REPORT_LABELS_ = {
  'Data Analysis KPI 17 Written': 'Group 17 Written',
  'Data Analysis KPI 17 Delivered': 'Group 17 Delivered',
  'Data Analysis KPI ASL Written': 'ASL Written',
  'Data Analysis KPI ASL Delivered': 'ASL Delivered',
};

/** The newest of the nine reports the mailbox import brought in. Files uploaded here are already in CC_Uploads. */
function lastMailboxImport_(uploads) {
  var uploaded = {};
  uploads.forEach(function (row) { uploaded[row.sha256] = true; });
  var labels = UPLOAD_REPORTS_.map(function (item) { return item.label; });
  var found = null;
  sheet_('CC_Imports').forEach(function (row) {
    var report = MAILBOX_REPORT_LABELS_[String(row.report_type)] || String(row.report_type || '');
    var at = row.imported_at instanceof Date ? row.imported_at.toISOString() : String(row.imported_at || '');
    if (String(row.status) !== 'imported' || labels.indexOf(report) === -1 || uploaded[String(row.sha256)] || !at) return;
    if (!found || at > found.at) found = { at: at, date: '', file: String(row.file_name || ''), report: report, via: 'mailbox' };
  });
  return found;
}

function uploads_(payload) {
  var today = todayNy_();
  var date = isoDate_(payload.date) || shiftDate_(today, -1);
  if (date > today) date = today;
  var refreshed = null;
  if (payload.refresh === true) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(20000)) {
      try {
        refreshRollup_();
        refreshed = refreshStoreKpiQuietly_(date);
        try { refreshMonthEnd_(); } catch (error) { appendException_('Update Failed', 'CC_MonthEnd could not be refreshed after an upload. The daily record was not changed.'); }
        noteHealth_('last_calculation', new Date().toISOString());
      } finally {
        lock.releaseLock();
      }
    }
  }
  var evidence = uploadEvidence_();
  var checklist = uploadChecklist_(evidence, date);
  var recent = [];
  var cursor = shiftDate_(today, -1);
  var i;
  for (i = 0; i < 10; i += 1) {
    var items = uploadChecklist_(evidence, cursor);
    recent.push({ date: cursor, imported: items.filter(function (item) { return item.status === 'Imported'; }).length, review: items.filter(function (item) { return item.status === 'Needs Review' || item.status === 'Failed'; }).length });
    cursor = shiftDate_(cursor, -1);
  }
  var complete = '';
  recent.forEach(function (day) { if (!complete && day.imported === UPLOAD_REPORTS_.length) complete = day.date; });
  var successes = evidence.uploads.filter(function (row) { return row.status === 'Imported'; });
  var last = successes.length ? successes[successes.length - 1] : null;
  if (last) last = { at: last.at, date: last.date, file: last.file, report: last.report, via: 'upload' };
  var mailbox = lastMailboxImport_(evidence.uploads);
  if (mailbox && (!last || mailbox.at > last.at)) last = mailbox;
  var storeKpi = sheet_('CC_Kpi').filter(function (row) { return String(row.metric) === 'Bedding' && isoDate_(row.period_start) === storePeriodContaining_(date).start; })[0];
  return {
    role: payload.session.role,
    today: today,
    date: date,
    dateText: uploadDayText_(date),
    reports: UPLOAD_REPORTS_,
    checklist: checklist,
    imported: checklist.filter(function (item) { return item.status === 'Imported'; }).length,
    total: UPLOAD_REPORTS_.length,
    recent: recent,
    latestComplete: complete,
    lastSuccess: last,
    kpiThrough: storeKpi ? isoDate_(storeKpi.verified_through) : '',
    refreshed: refreshed ? { issues: refreshed.issues, updated: refreshed.kpiUpdated.length + refreshed.kpiAppended.length } : null,
    history: evidence.uploads.slice(-40).reverse(),
  };
}
