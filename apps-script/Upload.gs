/**
 * UPLOAD REPORTS. A manager or admin uploads a business day's reports from the website. Each file is identified
 * from its contents (never from its name alone). A PDF is filed on the FROM/TO dates it prints. A Data Analysis
 * workbook is filed on the period in its file name. The DATE/TIME line and a PERQ "Active Deals" stamp are when the
 * file was run, not the business date. The date selected on the page is used only when the file does not print one.
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
  { key: 'g17Written', label: 'Data KPI Individual — Written', format: 'Excel (.xlsx)', use: 'Individual salesperson written KPIs and order counts for Store 17. Not official Store Written dollars.' },
  { key: 'g17Delivered', label: 'Data KPI Individual — Delivered', format: 'Excel (.xlsx)', use: 'Individual salesperson delivered KPIs for Store 17. Not official Store Delivered dollars.' },
  { key: 'aslWritten', label: 'Data KPI Store — Written', format: 'Excel (.xlsx)', use: 'Store 17 written KPIs from the All Stores Listed row. Not official Store Written dollars.' },
  { key: 'aslDelivered', label: 'Data KPI Store — Delivered', format: 'Excel (.xlsx)', use: 'Store 17 delivered KPIs from the All Stores Listed row. Not official Store Delivered dollars.' },
  { key: 'perqLocation', label: 'PERQ Performance Stats by Location', format: 'Excel', use: 'Store opportunities (Ups + Be Backs)' },
  { key: 'perqSalesperson', label: 'PERQ Performance Stats by Salesperson', format: 'Excel', use: 'Salesperson opportunities (Ups + Be Backs)' },
];

function uploadReportLabel_(key) {
  var found = UPLOAD_REPORTS_.filter(function (item) { return item.key === key; })[0];
  return found ? found.label : '';
}

function uploadTab_() {
  var spreadsheet = book_();
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
    var archived = !Object.keys(files).some(function (name) { return /(?:^|\/)xl\/workbook\.xml$/i.test(name); });
    if (archived) return { problem: 'This is a ZIP archive, not an Excel .xlsx workbook. Choose the ZIP on Upload reports and each PDF or Excel file inside is imported on its own.' };
    return { problem: 'The file is not an Excel .xlsx workbook.' };
  }
  if (!sheets.length) return { problem: 'The workbook has no visible worksheet.' };
  var grid = uploadGrid_(sheets[0].cells);
  var first = uploadText_(grid[0] && grid[0][0]);
  var second = uploadText_(grid[0] && grid[0][1]);
  if (/^Performance Stats by Location$/i.test(first)) return { key: 'perqLocation', grid: grid };
  if (/^Performance Stats by Salesperson$/i.test(first)) return { key: 'perqSalesperson', grid: grid };
  // The 17 workbook (sheet SLSP KPI, headed STORE 17 or older GROUP 17) is one row per salesperson.
  // The ASL workbook (sheet KPI, headed GROUP ASL) is All Stores Listed: one row per store. Only row 17 is kept.
  var family = /^(?:GROUP 17|STORE 17)$/i.test(first) ? 'group17' : /^GROUP ASL$/i.test(first) ? 'asl' : '';
  var side = /^WRITTEN ORDERS$/i.test(second) ? 'written' : /^DELIVERED ORDERS$/i.test(second) ? 'delivered' : '';
  if (family && side) {
    return { key: (family === 'asl' ? 'asl' : 'g17') + (side === 'written' ? 'Written' : 'Delivered'), grid: grid, family: family, side: side };
  }
  return { problem: 'This workbook is not one of the nine daily reports. Its first cell reads "' + (first || 'blank') + '".' };
}

/** Report type and printed dates only. This does not compare totals and does not write. */
function describeUpload_(context) {
  var described = { report: (typeof canonicalReportType_ === 'function' ? canonicalReportType_(context.fileName) : '') || 'Received upload', start: context.date, end: context.date, key: '' };
  var period = /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/.exec(context.fileName || '');
  if (period) { described.start = period[1]; described.end = period[2]; }
  try {
    if (bytesStartWith_(context.bytes, [37, 80, 68, 70])) {
      var text = pdfText_(Utilities.newBlob(context.bytes, 'application/pdf', context.fileName));
      var parsed = typeof parseCloudReport_ === 'function' ? parseCloudReport_(text) : null;
      if (parsed) {
        described.key = parsed.reportType === 'SNAP Written' ? 'snapWritten' : parsed.reportType === 'NWDSR Written' ? 'nwdsrWritten' : 'nwdsrDelivered';
        described.report = uploadReportLabel_(described.key) || described.report;
        if (parsed.start) described.start = parsed.start;
        if (parsed.end) described.end = parsed.end;
      }
    } else if (bytesStartWith_(context.bytes, [80, 75])) {
      var info = classifyWorkbook_(context.bytes, context.fileName);
      if (info && info.key) {
        described.key = info.key;
        described.report = uploadReportLabel_(info.key) || described.report;
      }
    }
  } catch (error) { /* identification can fail; the bytes are still archived before any comparison */ }
  return described;
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
  var context = { date: date, fileName: fileName, bytes: bytes, sha: sha, confirmed: isoDate_(payload.confirmDate) === date, adoptDate: payload.adoptReportDate === true, deferRefresh: payload.deferRefresh === true, role: payload.session.role };
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (error) {
    throw new Error('Another import is running. Wait a minute and import ' + fileName + ' again.');
  }
  var result;
  try {
    UPLOAD_QUIET_ = true;
    rosterCache_ = null;
    var described = describeUpload_(context);
    var mime = bytesStartWith_(context.bytes, [37, 80, 68, 70]) ? 'application/pdf' : (bytesStartWith_(context.bytes, [80, 75]) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream');
    var archive = null;
    var archiveError = '';
    try {
      archive = archiveReceivedOriginal_(Utilities.newBlob(context.bytes, mime, fileName), sha, fileName, described);
    } catch (error) {
      archiveError = String(error && error.message ? error.message : error);
    }
    if (archiveError || !archive || !archive.archived) {
      result = {
        status: 'Storage Failure',
        key: described.key || '',
        start: described.start || date,
        end: described.end || date,
        message: 'Storage failure. ' + fileName + ' was received for ' + (described.start || date) + ' (source hash ' + sha + ') but the original could not be archived' + (archiveError ? ': ' + archiveError : '') + '. The file is not safely on file. Nothing was imported and no business-rule comparison was run.',
      };
      appendException_('Update Failed', fileName + ' (upload for ' + date + '): ' + result.message);
    } else {
      try {
        result = processUpload_(context);
      } catch (error) {
        result = { status: 'Failed', key: described.key || '', start: described.start || '', end: described.end || '', message: 'The import stopped: ' + String(error && error.message ? error.message : error) + ' Figures already on file were left in place. The original was archived before the comparison.' };
        appendException_('Update Failed', fileName + ' (upload for ' + date + '): ' + result.message);
      }
      result.archivePath = archive.path || '';
      result.archiveId = archive.id || '';
      try { annotateArchivedUpload_(sha, result); } catch (error) {
        appendException_('Update Failed', fileName + ' (upload for ' + date + '): the archive note could not be updated. The original file was kept. ' + String(error && error.message ? error.message : error));
      }
      if (result.archivePath && String(result.message || '').indexOf('Archive location') === -1) {
        result.message += ' Original archived at ' + result.archivePath + ' before validation.';
      }
    }
  } finally {
    UPLOAD_QUIET_ = false;
    lock.releaseLock();
  }
  var validation = recordUploadValidation_(context, result);
  uploadTab_().appendRow([new Date().toISOString(), context.date, context.role, fileName, sha, result.key ? uploadReportLabel_(result.key) : (describedReport_(result) || ''), result.start || '', result.end || '', result.status, result.message]);
  return { file: fileName, sha256: sha, status: result.status, statusLabel: validation.statusLabel, report: result.key ? uploadReportLabel_(result.key) : '', reportKey: result.key || '', start: result.start || '', end: result.end || '', message: result.message, validation: validation, archivePath: result.archivePath || '', states: validation.states || '' };
}

function describedReport_(result) {
  return result && result.key ? uploadReportLabel_(result.key) : '';
}

/** File this upload on the date printed in the report. A date after today is refused. */
function adoptUploadDate_(context, reportDate) {
  var date = isoDate_(reportDate);
  if (!date || date > todayNy_()) return false;
  context.date = date;
  return true;
}

/** The page date is not the business date when the report prints a different one. A run stamp is never the business date. */
function uploadFilingNote_(chosen, filed, runStamp) {
  var note = '';
  if (chosen && filed && chosen !== filed) note += ' Filed on ' + filed + ', the date printed in the report. The date selected on the page was ' + chosen + '.';
  if (runStamp) note += ' Ran ' + runStamp + '. That is when the report was run, not the business date.';
  return note;
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
  return { status: 'Ignored', key: '', message: 'This is not a PDF or an Excel .xlsx file, so it is not one of the nine daily reports. Ignored. Nothing was changed.' };
}

// An answer that depends only on the business date chosen on screen (wrong date, date not confirmed) is
// Failed and returns without this: the file is not marked as seen, so the mailbox import can still use it,
// and a report already on file for that day keeps its Imported status.
function finishImport_(context, result, importStatus, note) {
  recordImport_(context.sha, context.fileName, importStatus, note || result.message);
  var tab = book_().getSheetByName('CC_Imports');
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
    return finishImport_(context, { status: 'Failed', key: '', message: 'The PDF ' + context.fileName + ' for ' + context.date + ' could not be read (' + String(error && error.message ? error.message : error) + '). No figure was changed. The original is kept in the source archive. This is a file-read failure.' }, 'failed');
  }
  if (/SNAP\s*-\s*DELIVERED/i.test(text)) {
    return { status: 'Ignored', key: '', message: 'This is SNAP Delivered, which is not one of the nine daily reports. Delivered sales come from NWDSR Delivered. Ignored. Nothing was changed.' };
  }
  var parsed = parseCloudReport_(text);
  if (!parsed) {
    if (/SNAP\s*-\s*WRITTEN|NET WRITTEN STORE SALES|DELIVERED STORE SALES/i.test(text)) {
      return finishImport_(context, { status: 'Needs Review', key: '', message: context.fileName + ' for ' + context.date + ' is a SNAP or NWDSR report, but the Store 17 total line was not found. No figure was changed. The original is kept in the source archive. Check that the report was run for Store 17.' }, 'needs-review');
    }
    return { status: 'Ignored', key: '', message: 'This PDF is not SNAP Written, NWDSR Written or NWDSR Delivered. Ignored. Nothing was changed.' };
  }
  var key = parsed.reportType === 'SNAP Written' ? 'snapWritten' : parsed.reportType === 'NWDSR Written' ? 'nwdsrWritten' : 'nwdsrDelivered';
  var chosen = context.date;
  var base = { key: key, start: parsed.start, end: parsed.end };
  if (!parsed.singleDay) {
    var final = recordPdfFinal_(parsed, text, context.fileName);
    if (final) {
      return finishImport_(context, uploadOutcome_(base, 'Imported', parsed.reportType + ' ' + parsed.start + ' through ' + parsed.end + ' is the official month-end final for the ' + (final.track === 'STORE' ? 'store' : 'salesperson') + ' month. It was recorded beside the daily record on CC_MonthEnd and was not added to the daily figures.'), 'official-final');
    }
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'This ' + parsed.reportType + ' report covers ' + parsed.start + ' through ' + parsed.end + '. Month-to-date reports are not added to daily figures. Upload the single-day report for ' + context.date + '. Nothing was changed.'), 'needs-review');
  }
  if (parsed.start !== context.date && !adoptUploadDate_(context, parsed.start)) {
    return uploadOutcome_(base, 'Failed', 'This ' + parsed.reportType + ' report prints ' + parsed.start + ', which is after today, so it was not filed. Nothing was changed.');
  }
  var filing = uploadFilingNote_(chosen, context.date, parsed.runStamp);
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
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', parsed.reportType + ' for ' + context.date + ' shows ' + moneyPlain_(parsed.storeTotal) + ', but ' + moneyPlain_(existing) + ' is already on file. The recorded figure was kept and this file was not applied.' + filing + ' ' + uploadConflictAction_(key, context.date, context.fileName)), 'needs-review');
  }
  if (key !== 'snapWritten' && !context.deferRefresh) refreshStoreKpiQuietly_(context.date);
  if (decision === 'same' || (existing !== null && existing === parsed.storeTotal)) {
    return finishImport_(context, uploadOutcome_(base, 'Already on file', parsed.reportType + ' for ' + context.date + ' (Store 17 total ' + moneyPlain_(parsed.storeTotal) + ') was already on file with the same figure. Nothing was added. Reconciled to the existing row; a manual backfill or earlier import was not overwritten. Original file ' + context.fileName + '; source date ' + parsed.start + '.' + extra + filing), 'duplicate');
  }
  return finishImport_(context, uploadOutcome_(base, 'Imported', parsed.reportType + ' for ' + context.date + ': Store 17 total ' + moneyPlain_(parsed.storeTotal) + ' saved.' + extra + filing), 'imported', parsed.reportType + ' ' + parsed.start);
}

function uploadOutcome_(base, status, message) {
  return { key: base.key, start: base.start || '', end: base.end || '', status: status, message: message };
}

function uploadFileExtension_(fileName) {
  var match = /\.([A-Za-z0-9]+)$/.exec(String(fileName || ''));
  return match ? match[1].toLowerCase() : '';
}

function uploadDestination_(key) {
  if (key === 'snapWritten') return 'CC_Daily snap_written and CC_AssociateDays. Individual written only. Official Store Written is not changed.';
  if (key === 'nwdsrWritten') return 'CC_Daily nwdsr_written. Official Store Written.';
  if (key === 'nwdsrDelivered') return 'CC_Daily nwdsr_delivered. Official Store Delivered.';
  if (key === 'g17Written' || key === 'g17Delivered') return 'CC_Ledger salesperson KPI rows. Individual KPI only. CC_Daily store totals are not changed.';
  if (key === 'aslWritten' || key === 'aslDelivered') return 'CC_Ledger and CC_Kpi store KPI rows, Store 17 only. Store KPI only. CC_Daily store totals are not changed.';
  if (key === 'perqLocation' || key === 'perqSalesperson') return 'CC_Closing opportunities. Store sales are not changed.';
  return 'None. This file is not one of the nine daily reports.';
}

function kpiDailyAmount_(view, side, date, field) {
  var found = null;
  ledgerRows_().forEach(function (row) {
    if (row.view !== view || row.grain !== 'daily' || row.side !== side || row.reportDate !== date || row.code || row.name) return;
    found = row[field];
  });
  return found;
}

function group17GapSentence_(date, side) {
  var viewSide = side === 'delivered' ? 'delivered' : 'written';
  var individual = canonicalKpiName_('group17', viewSide, date);
  var store = canonicalKpiName_('asl', viewSide, date);
  return 'This file does not fill Data KPI Individual — ' + (viewSide === 'written' ? 'Written' : 'Delivered') + ' or Data KPI Store — ' + (viewSide === 'written' ? 'Written' : 'Delivered') + '. The individual workbook is ' + individual + '. The store workbook is ' + store + '.';
}

function uploadConflictAction_(key, date, fileName) {
  var label = uploadReportLabel_(key) || 'This report';
  var text = 'File ' + fileName + ' (' + (uploadFileExtension_(fileName) || 'no extension') + ') is ' + label + '. Destination: ' + uploadDestination_(key) + '. A different total for the same report type and business date is held. A difference from another report type is not a reason to hold or reject a file. The recorded figure stays until this same-source difference is reviewed.';
  if (key === 'snapWritten' || key === 'nwdsrWritten' || key === 'nwdsrDelivered') text += ' ' + group17GapSentence_(date, key === 'nwdsrDelivered' ? 'delivered' : 'written');
  return text;
}

/** Classifies one file and says whether import would save, hold, or skip it. Nothing is written. */
function previewUpload_(payload) {
  var date = isoDate_(payload.date);
  if (!date) throw new Error('Choose the business date first.');
  var fileName = String(payload.fileName || 'report').replace(/[\\\/]/g, '_').slice(0, 160);
  var base64 = String(payload.base64 || '');
  if (!base64) throw new Error(fileName + ' is empty.');
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > UPLOAD_MAX_BYTES_) throw new Error(fileName + ' is larger than 15 MB.');
  var sha = sha256Hex_(bytes);
  var prior = importRecordFor_(sha);
  var priorStatus = prior ? String(prior.status || '') : '';
  var card = function (extra) {
    return {
      fileName: fileName,
      extension: uploadFileExtension_(fileName),
      reportType: extra.reportType || (prior ? String(prior.report_type || '') : ''),
      businessDate: extra.businessDate || '',
      periodStart: extra.periodStart || '',
      periodEnd: extra.periodEnd || '',
      destination: extra.destination || '',
      existing: extra.existing || 'No report of this type is on file for this date.',
      disposition: extra.disposition,
      reason: extra.reason || '',
      action: extra.action || '',
    };
  };
  if (prior && priorStatus !== 'needs-review' && priorStatus !== 'failed' && priorStatus.indexOf('held') !== 0) {
    return card({
      businessDate: date,
      disposition: 'skip',
      existing: 'This exact file was already imported on ' + String(prior.imported_at || '').slice(0, 10) + ' (' + priorStatus + ').',
      reason: 'Duplicate file. The contents match a file already imported.',
      action: 'Nothing will be changed.',
    });
  }
  if (bytesStartWith_(bytes, [37, 80, 68, 70])) return card(previewPdf_(date, fileName, bytes));
  if (bytesStartWith_(bytes, [80, 75])) return card(previewWorkbook_(date, fileName, bytes));
  return card({ disposition: 'skip', reason: fileName + ' is not a PDF or an Excel .xlsx file.', action: 'Nothing will be imported.' });
}

function previewPdf_(chosen, fileName, bytes) {
  var text;
  try {
    text = pdfText_(Utilities.newBlob(bytes, 'application/pdf', fileName));
  } catch (error) {
    return { disposition: 'hold', reason: 'The PDF could not be read (' + String(error && error.message ? error.message : error) + ').', action: 'No figure will be changed. The file is not imported.' };
  }
  if (/SNAP\s*-\s*DELIVERED/i.test(text)) {
    return { reportType: 'SNAP Delivered', disposition: 'skip', reason: 'SNAP Delivered is not a daily report. Delivered sales come from NWDSR Delivered.', action: 'This file will be skipped. Nothing will be changed.' };
  }
  var parsed = parseCloudReport_(text);
  if (!parsed) {
    var recognized = /SNAP\s*-\s*WRITTEN|NET WRITTEN STORE SALES|DELIVERED STORE SALES/i.test(text);
    return {
      disposition: recognized ? 'hold' : 'skip',
      reason: recognized ? fileName + ' looks like SNAP or NWDSR, but the Store 17 total line was not found.' : fileName + ' is not SNAP Written, NWDSR Written, or NWDSR Delivered.',
      action: recognized ? 'No figure will be changed. Run the report for Store 17 and upload that file.' : 'This file will be skipped. Nothing will be changed.',
    };
  }
  var key = parsed.reportType === 'SNAP Written' ? 'snapWritten' : parsed.reportType === 'NWDSR Written' ? 'nwdsrWritten' : 'nwdsrDelivered';
  var field = key === 'snapWritten' ? 'snapWritten' : key === 'nwdsrWritten' ? 'nwdsrWritten' : 'nwdsrDelivered';
  var filed = parsed.singleDay ? parsed.start : '';
  var facts = filed ? dailyFacts_().filter(function (row) { return row.date === filed; })[0] : null;
  var existing = facts ? facts[field] : null;
  var run = parsed.runStamp ? ' Ran ' + parsed.runStamp + '. That is when the report was run, not the business date.' : '';
  var base = {
    reportType: parsed.reportType,
    businessDate: filed || parsed.start,
    periodStart: parsed.start,
    periodEnd: parsed.end,
    destination: uploadDestination_(key),
  };
  if (!parsed.singleDay) {
    return Object.assign(base, {
      disposition: 'hold',
      existing: 'A month-to-date ' + parsed.reportType + ' report is not added to a daily total.',
      reason: parsed.reportType + ' covers ' + parsed.start + ' through ' + parsed.end + '.' + run,
      action: 'Upload the single-day ' + parsed.reportType + ' report. Nothing will be added to the daily figures.',
    });
  }
  if (parsed.start > todayNy_()) {
    return Object.assign(base, { disposition: 'hold', reason: parsed.reportType + ' prints ' + parsed.start + ', which is after today.' + run, action: 'The file will not be filed. Nothing will be changed.' });
  }
  if (existing === null || existing === undefined) {
    return Object.assign(base, {
      disposition: 'import',
      existing: 'No ' + parsed.reportType + ' figure is on file for ' + parsed.start + '.',
      reason: 'Store 17 total ' + moneyPlain_(parsed.storeTotal) + '.' + run + (chosen !== parsed.start ? ' The page date was ' + chosen + '. The file will be filed on the printed date.' : ''),
      action: 'The file will be imported to ' + uploadDestination_(key) + ' ' + group17GapSentence_(parsed.start, key === 'nwdsrDelivered' ? 'delivered' : 'written'),
    });
  }
  if (existing === parsed.storeTotal) {
    return Object.assign(base, {
      disposition: 'skip',
      existing: parsed.reportType + ' for ' + parsed.start + ' is already on file at ' + moneyPlain_(existing) + '.',
      reason: 'The file prints the same total.' + run,
      action: 'Nothing will be added. The recorded figure stays.',
    });
  }
  return Object.assign(base, {
    disposition: 'hold',
    existing: parsed.reportType + ' for ' + parsed.start + ' is already on file at ' + moneyPlain_(existing) + '.',
    reason: 'This file prints ' + moneyPlain_(parsed.storeTotal) + '. Same report type, same business date, different total.' + run,
    action: uploadConflictAction_(key, parsed.start, fileName),
  });
}

function previewWorkbook_(chosen, fileName, bytes) {
  var info = classifyWorkbook_(bytes, fileName);
  if (!info.key) {
    var skip = /not one of the nine daily reports/i.test(info.problem || '');
    return { disposition: skip ? 'skip' : 'hold', reason: info.problem || 'The workbook could not be classified.', action: skip ? 'Nothing will be imported.' : 'Nothing will be changed.' };
  }
  if (info.key === 'perqLocation' || info.key === 'perqSalesperson') return previewPerq_(chosen, fileName, info);
  return previewKpi_(chosen, fileName, info);
}

function previewPerq_(chosen, fileName, info) {
  var parsed = parsePerqGrid_(info.key, info.grid);
  var label = uploadReportLabel_(info.key);
  if (parsed.problem) return { reportType: label, destination: uploadDestination_(info.key), disposition: 'hold', reason: parsed.problem, action: 'Nothing will be changed.' };
  var date = chosen;
  var onFile = perqOnFile_(date);
  var count = info.key === 'perqLocation' ? parsed.store17 : parsed.people.reduce(function (sum, person) { return sum + person.opportunities; }, 0);
  var existingCount = info.key === 'perqLocation' ? onFile.store : (onFile.listed ? onFile.people : null);
  var same = existingCount !== null && existingCount === count;
  return {
    reportType: label,
    businessDate: date,
    periodStart: date,
    periodEnd: date,
    destination: uploadDestination_(info.key),
    existing: existingCount === null ? 'No ' + label + ' count is on file for ' + date + '.' : label + ' for ' + date + ' is already on file at ' + existingCount + '.',
    disposition: existingCount === null ? 'import' : (same ? 'skip' : 'hold'),
    reason: 'Opportunities ' + count + '.' + (parsed.exportedText ? ' Active Deals ' + parsed.exportedText + ' is the run time, not the business date.' : ' PERQ does not print a business date, so it is filed on the date selected on the page.'),
    action: existingCount === null ? 'The file will be imported. Store sales will not change.' : (same ? 'Nothing will be added.' : 'The recorded opportunity count stays. This difference is inside PERQ, not a difference from NWDSR or SNAP.'),
  };
}

function previewKpi_(chosen, fileName, info) {
  var label = uploadReportLabel_(info.key);
  var named = /DATA_ANALYSIS_KPI_(17|ASL)_(WRITTEN|DELIVERED)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i.exec(fileName);
  var period = /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/.exec(fileName);
  var start = period ? period[1] : chosen;
  var end = period ? period[2] : chosen;
  var card = {
    reportType: label,
    businessDate: start === end ? start : '',
    periodStart: start,
    periodEnd: end,
    destination: uploadDestination_(info.key),
  };
  if (named) {
    var namedFamily = named[1].toUpperCase() === 'ASL' ? 'asl' : 'group17';
    var namedSide = named[2].toLowerCase();
    if (namedFamily !== info.family || namedSide !== info.side) {
      return Object.assign(card, { disposition: 'hold', reason: 'The file name says ' + (namedFamily === 'asl' ? 'Data KPI Store' : 'Data KPI Individual') + ' ' + namedSide + ', but the contents are ' + label + '.', action: 'Nothing will be changed. Upload the file whose contents match its name.' });
    }
  }
  if (start > todayNy_()) return Object.assign(card, { disposition: 'hold', reason: label + ' prints ' + start + ', which is after today.', action: 'The file will not be filed.' });
  if (start !== end) {
    var finalTrack = typeof officialFinalTrack_ === 'function' ? officialFinalTrack_(start, end, todayNy_()) : '';
    if (end >= todayNy_()) return Object.assign(card, { disposition: 'hold', existing: 'A month-to-date snapshot has to end on a finished day.', reason: label + ' covers ' + start + ' through ' + end + ', which includes today.', action: 'Upload it through yesterday. Daily figures will not be changed.' });
    if (finalTrack) return Object.assign(card, { disposition: 'import', existing: 'This period is not added to the daily KPI rows.', reason: label + ' ' + start + ' through ' + end + ' is an official ' + finalTrack.toLowerCase() + ' month final.', action: 'It will be recorded beside the daily record. Daily figures and Store NWDSR totals will not be changed.' });
    var storePeriod = storePeriodContaining_(start);
    var personPeriod = individualPeriodContaining_(start);
    var storeFit = storePeriod.start === start && end <= storePeriod.end;
    var personFit = personPeriod.start === start && end <= personPeriod.end;
    if (!storeFit && !personFit) return Object.assign(card, { disposition: 'hold', reason: label + ' covers ' + start + ' through ' + end + '. A store snapshot starts on the 2nd and a salesperson snapshot on the 1st.', action: 'Nothing will be changed.' });
    return Object.assign(card, { disposition: 'import', existing: 'Days inside this period are not added again.', reason: label + ' ' + start + ' through ' + end + ' is a month-to-date snapshot.', action: 'KPI rows for the period will be saved. CC_Daily store totals will not be changed.' });
  }
  var source = canonicalKpiName_(info.family, info.side, start);
  var records = kpiRecords_(info.grid, info.family, info.side, start, start, source);
  var facts = dailyFacts_().filter(function (row) { return row.date === start; })[0] || {};
  var nwdsr = info.side === 'written' ? facts.nwdsrWritten : facts.nwdsrDelivered;
  var people = records.filter(function (record) { return record[0] === 'DA_SALES_PERSON'; });
  var storeSales = records.filter(function (record) { return record[0] === 'DA_SALES_STORE'; })[0];
  var total = storeSales && storeSales[10] !== '' ? Number(storeSales[10]) : null;
  if (info.family === 'group17' && !people.length && nwdsr !== 0) {
    return Object.assign(card, { disposition: 'hold', reason: label + ' for ' + start + ' has no salesperson lines.', action: 'Nothing will be changed. This is a structural failure. It is not compared with NWDSR or the store KPI workbook.' });
  }
  if (info.family === 'asl' && !storeSales && !records.some(function (record) { return record[0] === 'RUGS_STORE'; })) {
    return Object.assign(card, { disposition: 'hold', reason: label + ' for ' + start + ' has no Store 17 row.', action: 'Nothing will be changed. Another store\'s row is not used for Store 17.' });
  }
  var nwdsrNote = '';
  if (info.family === 'asl' && total !== null && nwdsr !== null && nwdsr !== undefined && Math.abs(total - nwdsr) > 1) {
    nwdsrNote = ' Data KPI Store sales ' + moneyPlain_(total) + ' and NWDSR ' + (info.side === 'written' ? 'Written' : 'Delivered') + ' ' + moneyPlain_(nwdsr) + ' differ. That is a reconciliation note. Both figures are kept, and the difference does not block this import.';
  }
  if (info.family === 'group17') {
    return Object.assign(card, {
      existing: 'Individual KPI rows are saved on their own. They are not compared with NWDSR or Data KPI Store.',
      disposition: 'import',
      reason: people.length + ' salesperson line' + (people.length === 1 ? '' : 's') + ' for ' + start + '. A different total from NWDSR or the store KPI workbook does not block this file.',
      action: 'Salesperson KPI rows will be saved. A line that already matches is not added again. A different figure for the same salesperson and date is held and the recorded figure stays. Official Store Written and Delivered will not change.',
    });
  }
  var current = kpiDailyAmount_('DA_SALES_STORE', info.side, start, 'sales');
  if (current === null) current = kpiDailyAmount_('RUGS_STORE', info.side, start, 'units');
  var compared = total !== null ? total : (storeSales ? null : (records.filter(function (record) { return record[0] === 'RUGS_STORE'; })[0] || [])[11]);
  if (current === null) {
    return Object.assign(card, {
      existing: 'No ' + label + ' row is on file for ' + start + '.',
      disposition: 'import',
      reason: (total !== null ? 'Store 17 KPI sales ' + moneyPlain_(total) + '.' : label + ' for ' + start + '.') + nwdsrNote,
      action: 'The Store 17 row will be imported to CC_Ledger and CC_Kpi. Other stores on the sheet are ignored. ' + (nwdsr !== null && nwdsr !== undefined ? 'NWDSR ' + (info.side === 'written' ? 'Written' : 'Delivered') + ' stays ' + moneyPlain_(nwdsr) + '.' : 'No NWDSR figure for this day will be created from this workbook.'),
    });
  }
  if (compared === null || current === compared || (typeof compared === 'number' && typeof current === 'number' && Math.abs(current - compared) < 0.001)) {
    return Object.assign(card, { existing: label + ' for ' + start + ' is already on file' + (total !== null ? ' at ' + moneyPlain_(total) : '') + '.', disposition: 'skip', reason: 'The workbook matches the stored store KPI figure.' + nwdsrNote, action: 'Nothing will be added. Store NWDSR totals will not be changed.' });
  }
  return Object.assign(card, {
    existing: label + ' for ' + start + ' is already on file at ' + current + '.',
    disposition: 'hold',
    reason: 'This workbook prints ' + compared + '. Same store KPI source, same business date, different figure.' + nwdsrNote,
    action: 'The recorded store KPI figure stays. Store NWDSR totals will not be changed. A difference from the individual workbook or from SNAP is not this hold.',
  });
}

function uploadWorkbook_(context) {
  var info = classifyWorkbook_(context.bytes, context.fileName);
  if (!info.key) {
    if (/not one of the nine daily reports/i.test(info.problem || '')) return { status: 'Ignored', key: '', message: info.problem + ' Ignored. Nothing was changed.' };
    return finishImport_(context, { status: 'Failed', key: '', message: info.problem + ' Nothing was changed.' }, 'failed');
  }
  if (info.key === 'perqLocation' || info.key === 'perqSalesperson') return uploadPerq_(context, info);
  return uploadKpiWorkbook_(context, info);
}

function canonicalKpiName_(family, side, date) {
  return 'DATA_ANALYSIS_KPI_' + (family === 'asl' ? 'ASL' : '17') + '_' + side.toUpperCase() + '_' + date + '_' + date + '.xlsx';
}

function uploadKpiWorkbook_(context, info) {
  var label = uploadReportLabel_(info.key);
  var chosen = context.date;
  var named = /DATA_ANALYSIS_KPI_(17|ASL)_(WRITTEN|DELIVERED)_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i.exec(context.fileName);
  var period = /(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/.exec(context.fileName);
  var base = { key: info.key, start: context.date, end: context.date };
  if (named) {
    var namedFamily = named[1].toUpperCase() === 'ASL' ? 'asl' : 'group17';
    var namedSide = named[2].toLowerCase();
    if (namedFamily !== info.family || namedSide !== info.side) {
      return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'The file name says ' + (namedFamily === 'asl' ? 'Data KPI Store' : 'Data KPI Individual') + ' ' + namedSide + ', but the contents are ' + label + '. Check the file and upload it again. Nothing was changed.'), 'needs-review');
    }
  }
  if (period) {
    base.start = period[1];
    base.end = period[2];
    if (period[1] !== period[2]) {
      var snapshotName = 'DATA_ANALYSIS_KPI_' + (info.family === 'asl' ? 'ASL' : '17') + '_' + info.side.toUpperCase() + '_' + period[1] + '_' + period[2] + '.xlsx';
      var final = recordKpiFinal_(info.grid, info.family, info.side, period[1], period[2], snapshotName);
      if (final) {
        return finishImport_(context, uploadOutcome_(base, 'Imported', label + ' ' + period[1] + ' through ' + period[2] + ' is the official month-end final for the ' + (final.track === 'STORE' ? 'store' : 'salesperson') + ' month: ' + final.rows + ' figures recorded beside the daily record on CC_MonthEnd. The daily figures were not changed.'), 'official-final');
      }
      if (period[2] >= todayNy_()) {
        return finishImport_(context, uploadOutcome_(base, 'Needs Review', label + ' covers ' + period[1] + ' through ' + period[2] + ', which includes today. A month-to-date snapshot has to end on a finished day. Upload it through yesterday, and upload the single-day file once the day is closed. Nothing was changed.'), 'needs-review');
      }
      var snapshot = recordKpiSnapshot_(info.grid, info.family, info.side, period[1], period[2], snapshotName);
      if (snapshot) {
        if (!context.deferRefresh) refreshStoreKpiQuietly_(period[2]);
        var track = snapshot.store ? 'store' : 'salesperson';
        var saved = snapshot.outcome || {};
        return finishImport_(context, uploadOutcome_(base, 'Imported', label + ' ' + period[1] + ' through ' + period[2] + ' is the ' + track + ' month-to-date snapshot: ' + snapshot.rows + ' figures, including pillows, adjustable bases, mattress pads, furniture protection, rugs and pet protection when the file prints them. Days inside ' + period[1] + ' through ' + period[2] + ' are not added again. ' + (saved.added || 0) + ' new, ' + (saved.replaced || 0) + ' replaced, ' + (saved.same || 0) + ' already on file.'), 'imported', label + ' ' + period[1] + ' through ' + period[2]);
      }
      return finishImport_(context, uploadOutcome_(base, 'Needs Review', label + ' covers ' + period[1] + ' through ' + period[2] + '. A store snapshot has to start on the 2nd, and a salesperson snapshot on the 1st. Nothing was changed.'), 'needs-review');
    }
    if (period[1] !== context.date && !(period[1] === period[2] && adoptUploadDate_(context, period[1]))) {
      return uploadOutcome_(base, 'Failed', label + ' prints ' + period[1] + ', which is after today, so it was not filed. Nothing was changed.');
    }
  } else {
    base.start = context.date;
    base.end = context.date;
  }
  var date = context.date;
  var filing = uploadFilingNote_(chosen, date, '');
  var source = canonicalKpiName_(info.family, info.side, date);
  var records = kpiRecords_(info.grid, info.family, info.side, date, date, source);
  var facts = dailyFacts_().filter(function (row) { return row.date === date; })[0] || {};
  var nwdsr = info.side === 'written' ? facts.nwdsrWritten : facts.nwdsrDelivered;
  var notes = [];
  var personRecords = records.filter(function (record) { return /_PERSON$/.test(record[0]); });
  var hasStoreSales = records.some(function (record) { return record[0] === 'DA_SALES_STORE'; });
  var hasStoreLine = records.some(function (record) { return /_STORE$/.test(record[0]); });
  if (info.family === 'group17' && !personRecords.length) {
    if (nwdsr === 0) notes.push('The individual workbook has no salesperson lines and NWDSR ' + info.side + ' is $0. No store KPI rows were added from this file.');
    else return finishImport_(context, uploadOutcome_(base, 'Needs Review', label + ' for ' + date + ' (' + context.fileName + ') has no salesperson lines. The workbook was not applied. The original is kept in the source archive. This is a structural failure. It is not compared with NWDSR or Data KPI Store.'), 'needs-review');
  }
  if (info.family === 'asl' && !hasStoreLine) {
    if (info.grid.length < 3) return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'The Data KPI Store workbook has no store rows. Check that the report finished running. Nothing was changed.'), 'needs-review');
    ['PILLOWS_STORE', 'BASES_STORE', 'FP_STORE', 'PET_STORE'].forEach(function (view) { records.push(kpiRecord_(true, date, date, view, '', '', info.side, 0, 0, 0, 0, 0, source)); });
    records.push(kpiRecord_(true, date, date, 'RUGS_STORE', '', '', info.side, 0, 0, null, 0, null, source));
    records.push(kpiRecord_(true, date, date, 'PWRBASE_STORE', '', '', info.side, null, null, null, null, 0, source));
    if (nwdsr === 0) {
      records.push(kpiRecord_(true, date, date, 'DA_SALES_STORE', '', '', info.side, 0, 0, null, null, null, source));
      notes.push('Store 17 is not listed and NWDSR ' + info.side + ' is $0, so store KPI sales are recorded as $0.');
    }
    notes.push('Store 17 is not listed, so pillow, adjustable base, furniture protection, rug and pet activity are recorded as 0. Other stores on the sheet are not used.');
  }
  var totalRecord = records.filter(function (record) { return record[0] === 'DA_SALES_STORE'; })[0];
  var total = totalRecord && totalRecord[10] !== '' ? Number(totalRecord[10]) : null;
  if (info.family === 'asl' && total !== null && nwdsr !== null && nwdsr !== undefined && Math.abs(total - nwdsr) > 1) {
    var standard = info.side === 'written' ? 'NWDSR Written' : 'NWDSR Delivered';
    notes.push('Data KPI Store sales ' + moneyPlain_(total) + ' and ' + standard + ' ' + moneyPlain_(nwdsr) + ' differ by ' + moneyPlain_(Math.round(Math.abs(total - nwdsr) * 100) / 100) + ' for ' + date + '. SNAP, NWDSR, Data KPI Store, and Data KPI Individual do not have to match. Both figures are kept. ' + standard + ' stays the ' + (info.side === 'written' ? 'written' : 'delivered') + ' standard. This workbook is saved for the store KPIs. The difference is a reconciliation note, not an error.');
  }
  if (info.family === 'asl' && hasStoreSales && (nwdsr === null || nwdsr === undefined)) {
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
  if (!context.deferRefresh) refreshStoreKpiQuietly_(date);
  var people = {};
  records.forEach(function (record) { if (/_PERSON$/.test(record[0])) people[record[8]] = true; });
  var listed = Object.keys(people).length;
  var rugs = records.filter(function (record) { return record[0] === 'RUGS_STORE'; })[0];
  var summary = label + ' for ' + date + ': ' + (info.family === 'asl'
    ? 'Store 17 line' + (total !== null ? ', KPI sales ' + moneyPlain_(total) : '') + (rugs ? ', rugs sold ' + (rugs[11] === '' ? 0 : rugs[11]) : '') + '.'
    : listed + ' salesperson line' + (listed === 1 ? '' : 's') + '. Individual KPI only. Store KPI rows and official Store Written and Delivered were not changed.');
  if (outcome.heldBack.length) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', summary + ' ' + outcome.heldBack.length + ' figure' + (outcome.heldBack.length === 1 ? '' : 's') + ' differ from the figures already recorded for ' + date + '. The recorded figures were kept and logged in CC_History for review. ' + notes.join(' ') + filing), 'needs-review');
  }
  if (unmatched.length) {
    return finishImport_(context, uploadOutcome_(base, 'Needs Review', summary + ' Saved. Not on the roster: ' + unmatched.join(', ') + '. Their figures are saved under the printed name; add them (or an alias) in Admin > Manage Associates. ' + notes.join(' ') + filing), 'imported');
  }
  if (!outcome.added && !outcome.replaced) {
    return finishImport_(context, uploadOutcome_(base, 'Already on file', summary + ' Every figure was already on file with the same values. Nothing was added. Reconciled to the existing rows; a manual backfill or earlier import was not overwritten. Original file ' + context.fileName + '; source date ' + date + '. ' + notes.join(' ') + filing), 'duplicate');
  }
  return finishImport_(context, uploadOutcome_(base, 'Imported', summary + ' ' + outcome.added + ' figures saved' + (outcome.same ? ', ' + outcome.same + ' already on file' : '') + '. ' + notes.join(' ') + filing), 'imported', label + ' ' + date);
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

/**
 * A store PERQ count the General Manager confirmed. The previous closing row and ledger row are kept on CC_History.
 * The count stays on the store. It is not copied onto a salesperson, including the manager who sent the report.
 */
function applyConfirmedStoreOpportunities_(date, opportunities, reason) {
  date = isoDate_(date);
  opportunities = Number(opportunities);
  if (!date || !isFinite(opportunities)) throw new Error('A business date and a store opportunity count are required.');
  var why = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!why) throw new Error('Record why the store opportunity count is being set.');
  var closing = book_().getSheetByName('CC_Closing');
  if (!closing) throw new Error('CC_Closing is not on the spreadsheet.');
  var values = closing.getDataRange().getValues();
  var found = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][1]) !== 'store' || String(values[r][2] || '') || String(values[r][8]) !== PERQ_UPLOAD_SOURCE_) continue;
    if (isoDate_(values[r][6]) === date && isoDate_(values[r][7]) === date) found = r;
  }
  if (!found) throw new Error('No store PERQ row for ' + date + '.');
  var previous = numberOrNull_(values[found][5]);
  if (previous !== opportunities) archiveReplaced_('CC_Closing', 'PERQ store||' + date + '|' + date, values[found], String(opportunities), why);
  if (previous !== opportunities) closing.getRange(found + 1, 6).setValue(opportunities);
  var note = String(values[found][10] || '');
  var trail = 'Store opportunities for ' + date + ' are ' + opportunities + '. ' + why + ' Previous store count ' + (previous === null ? 'blank' : previous) + '. This is the store total, not a salesperson.';
  if (note.indexOf(why) === -1) closing.getRange(found + 1, 11).setValue((note ? note + ' ' : '') + trail);
  var ledger = book_().getSheetByName('CC_Ledger');
  if (!ledger) throw new Error('CC_Ledger is not on the spreadsheet.');
  var rows = ledger.getDataRange().getValues();
  var hit = 0;
  for (r = 1; r < rows.length; r += 1) {
    if (String(rows[r][0]) !== 'PERQ_STORE' || String(rows[r][1]) !== 'daily' || isoDate_(rows[r][2]) !== date) continue;
    if (String(rows[r][7] || '') || String(rows[r][8] || '')) continue;
    hit = r;
  }
  if (!hit) throw new Error('No PERQ_STORE daily ledger row for ' + date + '.');
  var priorEligible = fineNumber_(rows[hit][12]);
  if (priorEligible !== opportunities) {
    archiveReplaced_('CC_Ledger', String(rows[hit][17] || ('PERQ_STORE|' + date)), rows[hit], String(opportunities), why);
    ledger.getRange(hit + 1, 13).setValue(opportunities);
  }
  forgetRead_('CC_Closing');
  forgetRead_('CC_Ledger');
  forgetRead_('CC_History');
  var notes = syncPerqPresenceNotes_();
  return { date: date, opportunities: opportunities, previousClosing: previous, previousLedger: priorEligible, notesCleared: notes };
}

/** Once a daily store PERQ row exists, a customer note must not keep saying that report is missing. */
function syncPerqPresenceNotes_() {
  var counts = {};
  ledgerRows_().forEach(function (row) {
    if (row.view !== 'PERQ_STORE' || row.grain !== 'daily' || !row.reportDate || row.eligible === null) return;
    if (row.code || row.name) return;
    counts[row.reportDate] = row.eligible;
  });
  var tab = book_().getSheetByName('CC_Closing');
  if (!tab) return 0;
  var values = tab.getDataRange().getValues();
  var cleared = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][1]) !== 'store') continue;
    var date = isoDate_(values[r][6]);
    if (!date || counts[date] === undefined) continue;
    var note = String(values[r][10] || '');
    if (!/PERQ report missing|PERQ not received|closing Pending/i.test(note)) continue;
    var next = note
      .replace(/;?\s*PERQ report missing,?\s*closing Pending\.?/ig, '')
      .replace(/PERQ not received\.?/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
    next = (next ? next.replace(/[.;\s]+$/, '') + '. ' : '') + 'PERQ Store opportunities for ' + date + ' are on file (' + counts[date] + '). This is the store count, not a salesperson.';
    tab.getRange(r + 1, 11).setValue(next);
    cleared += 1;
  }
  if (cleared) forgetRead_('CC_Closing');
  return cleared;
}

function uploadPerq_(context, info) {
  var label = uploadReportLabel_(info.key);
  var date = context.date;
  var base = { key: info.key, start: date, end: date };
  context.confirmed = true;
  var parsed = parsePerqGrid_(info.key, info.grid);
  if (parsed.problem) return finishImport_(context, uploadOutcome_(base, 'Failed', parsed.problem + ' Nothing was changed.'), 'failed');
  var onFile = perqOnFile_(date);
  var stamp = ' Uploaded as ' + context.fileName + ' (sha256 ' + context.sha.slice(0, 12) + '); business date ' + uploadDayText_(date) + ', the date selected on Upload reports. PERQ does not print the day it covers.';
  if (parsed.exportedText) stamp += ' Active Deals ' + parsed.exportedText + ' is when the file was run, not the business date.';
  var outcomes = [];
  var message = '';
  var flags = [];
  if (info.key === 'perqLocation') {
    if (parsed.store17 === null) return finishImport_(context, uploadOutcome_(base, 'Needs Review', 'Store 17 is not listed in this location export. Check the location filter. Nothing was changed.'), 'needs-review');
    outcomes.push(recordPerqFact_({ scope: 'store', code: '', name: '', opportunities: parsed.store17, date: date, note: 'Store 17 Ups + Be Backs for ' + date + ' only. Not added to any snapshot.' + stamp }, context.fileName));
    message = 'Store 17 opportunities for ' + uploadDayText_(date) + ': ' + parsed.store17 + '. Filed on ' + uploadDayText_(date) + ', the date selected on Upload reports. PERQ does not print the day it covers.';
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
    message = 'Salesperson opportunities for ' + uploadDayText_(date) + ': ' + (matched.map(function (person) { return person.name + ' ' + person.opportunities; }).join(', ') || 'no salesperson rows') + '. Filed on ' + uploadDayText_(date) + ', the date selected on Upload reports. PERQ does not print the day it covers.';
    if (parsed.exportedText) message += ' Active Deals ' + parsed.exportedText + ' is when the file was run, not the business date.';
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
  if (!added) return finishImport_(context, uploadOutcome_(base, 'Already on file', message + ' Already on file with the same counts. Nothing was added. Reconciled to the existing rows; a manual backfill or earlier import was not overwritten. Original file ' + context.fileName + '; source date ' + date + '.'), 'duplicate');
  return finishImport_(context, uploadOutcome_(base, 'Imported', message + ' Saved.'), 'imported', label + ' ' + date);
}

/* ---------- Store month KPIs (Home tiles) ---------- */

var STORE_KPI_FAMILIES_ = {
  // Store KPI rows are written from the ASL Store 17 row. Rows already saved from a 17 workbook TOTAL
  // keep their original source name and still count, so verified figures are not rewritten.
  group17: { anchor: 'DA_SALES', views: ['DA_SALES', 'BEDDING', 'FABW', 'PWAR', 'LTHW', 'MPPA', 'ATTACH', 'FINANCE'], source: /DATA_ANALYSIS_KPI_(ASL|17)_/i },
  asl: { anchor: 'RUGS', views: ['PILLOWS', 'BASES', 'FP', 'RUGS', 'PET', 'PWRBASE'], source: /DATA_ANALYSIS_KPI_(ASL|17)_/i },
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
 * A rebuilt total (its source joins the files with " + ") is not a new snapshot and is not added on top of the days.
 * A column the snapshot does not have, such as pet protection, is taken from a cumulative row that ends on the
 * same through-date. Its daily pieces are not added again.
 * A store KPI day is added when that day's Data KPI Store row is on file and NWDSR for the same side is on file.
 * The totals do not have to match. SNAP, NWDSR, Data KPI Store, and Data KPI Individual keep their own figures.
 * A difference is noted and does not stop the store-month KPIs. A missing workbook, or NWDSR not on file yet, still stops the count.
 * A verified $0 NWDSR day with no store KPI file is not a hole.
 */
function storeKpiCoverage_(ledger, family, side, period, facts, closed, today) {
  var spec = STORE_KPI_FAMILIES_[family];
  var prefixOf = function (row) { return row.view.replace(/_STORE$/, ''); };
  var storeRow = function (row) { return row.scope === 'STORE' && row.side === side && !row.code && !row.name && spec.views.indexOf(prefixOf(row)) !== -1 && spec.source.test(row.source); };
  var snapshot = '';
  var nwdsrLimit = '';
  if (family === 'group17') {
    Object.keys(facts).forEach(function (date) {
      if (date < period.start || date > period.end) return;
      var amount = side === 'written' ? facts[date].nwdsrWritten : facts[date].nwdsrDelivered;
      if (amount === null || amount === undefined) return;
      if (date > nwdsrLimit) nwdsrLimit = date;
    });
  }
  ledger.forEach(function (row) {
    if (!storeRow(row) || row.grain !== 'cumulative' || !row.fitsTrack || row.periodStart !== period.start) return;
    if (row.source.indexOf(' + ') !== -1 || row.verifiedThrough > period.end) return;
    // A Data KPI Store snapshot cannot run past the last official NWDSR day for that side.
    if (nwdsrLimit && row.verifiedThrough > nwdsrLimit) return;
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
  var zeroDays = [];
  var differences = [];
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
        if (Math.abs(sales - nwdsr) > 1) differences.push(cursor + ': Data KPI Store ' + side + ' ' + moneyPlain_(sales) + ' and NWDSR ' + side + ' ' + moneyPlain_(nwdsr) + ' differ. Both figures are kept.');
      }
      days.push(cursor);
    } else if (!closed[cursor]) {
      var emptyFact = facts[cursor];
      var emptyAmount = emptyFact ? (side === 'delivered' ? emptyFact.nwdsrDelivered : (family === 'group17' ? emptyFact.nwdsrWritten : null)) : null;
      if (emptyAmount === 0) zeroDays.push(cursor);
      else break;
    }
    cursor = shiftDate_(cursor, 1);
  }
  var through = days.length ? days[days.length - 1] : snapshot;
  // A column missing from the single-report snapshot can still be on file as one total through this same date.
  if (through) {
    var complete = {};
    ledger.forEach(function (row) {
      if (!storeRow(row) || row.grain !== 'cumulative' || !row.fitsTrack || row.periodStart !== period.start || row.verifiedThrough !== through) return;
      var prefix = prefixOf(row);
      if (snapRows[prefix]) return;
      complete[prefix] = laterLedger_(complete[prefix], row);
    });
    Object.keys(complete).forEach(function (prefix) {
      snapRows[prefix] = complete[prefix];
      days.forEach(function (date) {
        if (dayRows[date]) delete dayRows[date][prefix];
      });
    });
  }
  var sources = [];
  Object.keys(snapRows).forEach(function (prefix) { if (sources.indexOf(snapRows[prefix].source) === -1) sources.push(snapRows[prefix].source); });
  days.forEach(function (date) {
    Object.keys(dayRows[date]).forEach(function (prefix) { if (sources.indexOf(dayRows[date][prefix].source) === -1) sources.push(dayRows[date][prefix].source); });
  });
  var unsnapped = snapshot ? spec.views.filter(function (prefix) { return !snapRows[prefix]; }) : [];
  return { family: family, side: side, snapshot: snapshot, snapRows: snapRows, dayRows: dayRows, days: days, zeroDays: zeroDays, through: through, issue: issue, differences: differences, sources: sources, unsnapped: unsnapped };
}

// The ledger views each CC_Kpi store line is built from. A line whose snapshot view is missing is left as recorded.
var STORE_KPI_LINE_VIEWS_ = {
  'Bedding': ['BEDDING', 'DA_SALES'], 'Mattress Protectors': ['MPPA'], 'Fabric Maintenance': ['FABW'], 'Leather Maintenance': ['LTHW'],
  'Power Upholstery': ['PWAR'], 'Total Attachment': ['ATTACH'], 'Finance': ['FINANCE', 'DA_SALES'], 'Average Ticket': ['DA_SALES'],
  'Adjustable Base Attachment': ['BASES'], 'Pillows': ['PILLOWS'], 'Wood / Furniture Protection': ['FP'], 'Rugs': ['RUGS'],
  'Pet Protections': ['PET'], 'Power Adjustable Base': ['PWRBASE'],
};

function countedFrom_(row) {
  return {
    qual: row && row.eligible !== null ? row.eligible : 0,
    sold: row && row.units !== null ? row.units : 0,
    dollars: row && row.sales !== null ? row.sales : 0,
    // A printed row with a blank qualified quantity is not zero. A missing row still counts as 0 of 0.
    qualBlank: !!(row && (row.eligible === null || row.eligible === undefined)),
  };
}

function addCounted_(left, right) {
  return {
    qual: left.qual + right.qual,
    sold: left.sold + right.sold,
    dollars: kpiRound_(left.dollars + right.dollars, 2),
    qualBlank: !!(left.qualBlank || right.qualBlank),
  };
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
    pillows: countedFrom_(rows.PILLOWS), bases: countedFrom_(rows.BASES), protection: countedFrom_(rows.FP), pet: countedFrom_(rows.PET),
    rugs: rows.RUGS && rows.RUGS.units !== null ? rows.RUGS.units : 0,
    rugDollars: rows.RUGS && rows.RUGS.sales !== null ? rows.RUGS.sales : 0,
    powerBase: rows.PWRBASE && rows.PWRBASE.percent !== null ? rows.PWRBASE.percent : null,
    powerBaseQual: rows.BASES && rows.BASES.eligible !== null ? rows.BASES.eligible : 0,
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
    pet: addCounted_(left.pet, right.pet),
    rugs: left.rugs + right.rugs, rugDollars: kpiRound_(left.rugDollars + right.rugDollars, 2),
    powerBase: blendPowerBase_(left, right),
    powerBaseQual: (left.powerBaseQual || 0) + (right.powerBaseQual || 0),
  };
}

function blendPowerBase_(left, right) {
  if (left.powerBase === null || left.powerBase === undefined) return right.powerBase;
  if (right.powerBase === null || right.powerBase === undefined) return left.powerBase;
  var lq = left.powerBaseQual || 0;
  var rq = right.powerBaseQual || 0;
  if (!lq && !rq) return left.powerBase;
  return kpiRound_((left.powerBase * lq + right.powerBase * rq) / ((lq + rq) || 1), 3);
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
    if (metric.qualBlank) {
      add(view, metric.dollars, metric.sold, null, metric.sold, null);
      return;
    }
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
    qty('PET_STORE', value.pet);
    add('RUGS_STORE', value.rugDollars, value.rugs, null, value.rugs, null);
    if (value.powerBase !== null && value.powerBase !== undefined && coverage.unsnapped.indexOf('PWRBASE') === -1) add('PWRBASE_STORE', null, null, null, null, value.powerBase);
  }
  return out;
}

/** Blank qualified quantity stays blank: the tile is pets sold, not an attachment percent of zero. */
function petFigure_(value) {
  if (!value || !value.pet) return null;
  if (value.pet.qualBlank) return value.pet.sold;
  var rate = kpiRateOrNull_(value.pet.sold, value.pet.qual);
  return rate === null ? 0 : rate;
}

function petNote_(through, written, delivered) {
  var blank = (written && written.pet && written.pet.qualBlank) || (delivered && delivered.pet && delivered.pet.qualBlank);
  var soldText = function (value) {
    if (!value || !value.pet) return '0 sold';
    return value.pet.sold + ' sold ($' + value.pet.dollars + ')';
  };
  if (blank) return 'Pet protections sold, ' + through + '. Qualified quantity was blank on the report, so this is pets sold, not an attachment percent. Written ' + soldText(written) + ', delivered ' + soldText(delivered) + '.';
  var left = written && written.pet;
  var right = delivered && delivered.pet;
  return 'Pet protections, ' + through + '. Written ' + (left ? left.sold : 0) + ' of ' + (left ? left.qual : 0) + ', delivered ' + (right ? right.sold : 0) + ' of ' + (right ? right.qual : 0) + '.';
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
      ['Total Attachment', side(w, function (v) { return pct(v.attach.sold, v.attach.qual); }), side(d, function (v) { return pct(v.attach.sold, v.attach.qual); }), countNote('Data KPI Store total attachments, ' + through, w && w.attach, d && d.attach)],
      ['Finance', side(w, function (v) { return v.financed === null ? null : pct(v.financed, v.sales); }), side(d, function (v) { return v.financed === null ? null : pct(v.financed, v.sales); }), 'Financed dollars ÷ sales, ' + through + ". Financed dollars are each report's FIN % × its sales."],
      ['Average Ticket', side(w, function (v) { return v.orders ? kpiRound_(v.sales / v.orders, 2) : null; }), side(d, function (v) { return v.orders ? kpiRound_(v.sales / v.orders, 2) : null; }), 'Sales ÷ orders, ' + through + '. Written ' + (w ? w.sales : 0) + ' ÷ ' + (w ? w.orders : 0) + ', delivered ' + (d ? d.sales : 0) + ' ÷ ' + (d ? d.orders : 0) + '.'],
    ];
  }
  return [
    ['Adjustable Base Attachment', side(w, function (v) { return pct(v.bases.sold, v.bases.qual); }), side(d, function (v) { return pct(v.bases.sold, v.bases.qual); }), countNote('Data KPI Store adjustable bases, ' + through, w && w.bases, d && d.bases)],
    ['Pillows', side(w, function (v) { return pct(v.pillows.sold, v.pillows.qual); }), side(d, function (v) { return pct(v.pillows.sold, v.pillows.qual); }), countNote('Data KPI Store pillows, ' + through, w && w.pillows, d && d.pillows)],
    ['Wood / Furniture Protection', side(w, function (v) { return pct(v.protection.sold, v.protection.qual); }), side(d, function (v) { return pct(v.protection.sold, v.protection.qual); }), countNote('Data KPI Store furniture protection, ' + through, w && w.protection, d && d.protection)],
    ['Rugs', side(w, function (v) { return v.rugs; }), side(d, function (v) { return v.rugs; }), 'Data KPI Store rugs sold, ' + through + '.'],
    ['Pet Protections', side(w, petFigure_), side(d, petFigure_), petNote_(through, w, d)],
    ['Power Adjustable Base', side(w, function (v) { return v.powerBase; }), side(d, function (v) { return v.powerBase; }), 'ADJ PWR %, ' + through + '.'],
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
  var result = { period: period, kpiUpdated: [], kpiAppended: [], ledger: { added: 0, same: 0, replaced: 0 }, issues: [], notes: [], through: {} };
  var tab = kpiSheet_();
  var kpi = tab.getDataRange().getValues();
  var derived = [];
  ['group17', 'asl'].forEach(function (family) {
    var written = storeKpiCoverage_(ledger, family, 'written', period, facts, closed, today);
    var delivered = storeKpiCoverage_(ledger, family, 'delivered', period, facts, closed, today);
    [written, delivered].forEach(function (coverage) {
      if (coverage.issue) result.issues.push(coverage.issue);
      (coverage.differences || []).forEach(function (note) { result.notes.push(note); });
    });
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

/* ---------- Validation record ---------- */

var UPLOAD_VALIDATION_HEADERS_ = ['validation_id', 'uploaded_at', 'sha256', 'file_name', 'business_date', 'report_type', 'scope', 'status_label', 'internal_status', 'rule', 'expected', 'actual', 'difference', 'affected', 'imported', 'figures_changed', 'automatic', 'action', 'actor', 'emailed_at', 'resolution'];

function uploadValidationTab_() {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_UploadValidation');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_UploadValidation');
  tab.getRange(1, 1, 1, UPLOAD_VALIDATION_HEADERS_.length).setValues([UPLOAD_VALIDATION_HEADERS_]);
  return tab;
}

function uploadValidationRows_() {
  return sheet_('CC_UploadValidation').map(function (row) {
    return {
      validationId: String(row.validation_id || ''),
      at: String(row.uploaded_at || ''),
      sha256: String(row.sha256 || ''),
      fileName: String(row.file_name || ''),
      businessDate: isoDate_(row.business_date),
      reportType: String(row.report_type || ''),
      scope: String(row.scope || ''),
      statusLabel: String(row.status_label || ''),
      internalStatus: String(row.internal_status || ''),
      rule: String(row.rule || ''),
      expected: String(row.expected || ''),
      actual: String(row.actual || ''),
      difference: String(row.difference || ''),
      affected: String(row.affected || ''),
      imported: String(row.imported || ''),
      figuresChanged: String(row.figures_changed || ''),
      automatic: String(row.automatic || ''),
      action: String(row.action || ''),
      actor: String(row.actor || ''),
      emailedAt: String(row.emailed_at || ''),
      resolution: String(row.resolution || ''),
    };
  }).filter(function (row) { return row.validationId; });
}

/** The words shown on screen. Internal statuses stay stable for the checklist. */
function uploadPublicStatus_(status, message) {
  var text = String(message || '');
  if (status === 'Storage Failure') return 'SOURCE UNAVAILABLE';
  if (status === 'Not retained') return 'PREVIOUSLY RECEIVED — ORIGINAL NOT RETAINED';
  if (status === 'Archived') return 'RECEIVED AND ARCHIVED — NOT IMPORTED';
  if (status === 'Incomplete') return 'IMPORTED BUT INCOMPLETE';
  if (status === 'Imported') return /Not on the roster|differ from the figures already recorded/i.test(text) ? 'IMPORTED — REVIEW REQUIRED' : 'IMPORTED & VERIFIED';
  if (status === 'Already on file') return 'DUPLICATE — ALREADY IMPORTED';
  if (status === 'Ignored' || status === 'Unsupported') return 'REJECTED — INVALID FILE';
  if (status === 'Failed') return /could not be read|import stopped|could not be opened|not an Excel|empty/i.test(text) ? 'PROCESSING ERROR' : 'HELD — ACTION REQUIRED';
  if (status === 'Needs Review') return /Saved\.|figures saved|salesperson line/i.test(text) && /Not on the roster|differ from the figures already recorded/i.test(text) ? 'IMPORTED — REVIEW REQUIRED' : 'HELD — ACTION REQUIRED';
  if (status === 'Missing') return 'NEVER RECEIVED';
  if (status === 'Covered' || status === 'Not expected') return status;
  return status ? 'HELD — ACTION REQUIRED' : '';
}

function uploadScope_(key) {
  if (key === 'aslWritten' || key === 'aslDelivered') return 'Data KPI Store, Store 17 row only';
  if (key === 'g17Written' || key === 'g17Delivered') return 'Data KPI Individual, Store 17 salespeople';
  if (key === 'snapWritten') return 'Individual written sales';
  if (!key) return 'Not identified';
  return 'Store 17';
}

function uploadValidationParts_(status, message) {
  var text = String(message || '');
  var money = text.match(/shows (\$[0-9,]+(?:\.\d+)?), but (\$[0-9,]+(?:\.\d+)?) is already on file/);
  if (money) {
    return {
      rule: 'Same report type and business date already has a different verified total.',
      expected: 'The total already on file, ' + money[2] + ', unless a reviewed correction replaces it.',
      actual: 'This file prints ' + money[1] + '.',
      difference: money[1] + ' versus ' + money[2] + '.',
      affected: 'The daily total for this report type. Other report types were not compared as a failure.',
    };
  }
  if (/no salesperson lines/i.test(text)) {
    return { rule: 'Data KPI Individual must contain salesperson rows.', expected: 'One row per salesperson on the first visible worksheet.', actual: 'No salesperson line was found.', difference: 'Not applicable.', affected: 'Individual KPI rows for this workbook. Store KPI rows were not changed.' };
  }
  if (/no Store 17 row|no store rows/i.test(text)) {
    return { rule: 'Data KPI Store must list Store 17.', expected: 'A row named 17 on the All Stores Listed worksheet.', actual: 'Store 17 was not found.', difference: 'Not applicable.', affected: 'Store KPI rows for this workbook.' };
  }
  if (/file name says/i.test(text)) {
    return { rule: 'When the file name names a report family, the worksheet contents must be that family.', expected: 'Contents that match the report named in the file.', actual: text, difference: 'Name and contents disagree.', affected: 'The whole workbook. Nothing was saved.' };
  }
  if (/not one of the nine|not a PDF or an Excel|not SNAP Written, NWDSR/i.test(text)) {
    return { rule: 'The file must be one of the nine daily reports, identified from its contents.', expected: 'SNAP Written, NWDSR Written, NWDSR Delivered, Data KPI Individual Written or Delivered, Data KPI Store Written or Delivered, or PERQ.', actual: 'The contents do not match one of those reports.', difference: 'Not applicable.', affected: 'No dataset.' };
  }
  if (/reconciliation note, not an error/i.test(text)) {
    return { rule: 'Data KPI Store and NWDSR are different report definitions and are not required to match.', expected: 'Each source kept under its own definition.', actual: text, difference: 'Informational. Not a validation failure.', affected: 'Store KPI rows only. Official Store Written and Delivered were not changed.' };
  }
  if (status === 'Storage Failure') {
    return { rule: 'The original file is archived before any business-rule comparison.', expected: 'A stored original with its filename, business date, report type, upload time, source hash, and archive location.', actual: text || 'The archive did not keep the file.', difference: 'Not a difference between report totals.', affected: 'Nothing was imported. The file is not safely on file.' };
  }
  if (status === 'Imported') {
    return { rule: 'Report type, date, scope, and required figures were read from the contents. A difference from another source does not block this report.', expected: 'A supported report for a finished business date.', actual: 'The required figures were read.', difference: 'None that blocks this source.', affected: 'The destination for this report type.' };
  }
  if (status === 'Already on file') {
    return { rule: 'The same source data is already on file.', expected: 'No second copy.', actual: 'This file matches data already verified.', difference: 'None.', affected: 'No dataset. Nothing was added.' };
  }
  return { rule: 'The file could not be imported as a complete verified report.', expected: 'A supported report whose figures can be saved without replacing a verified total.', actual: text || 'No further detail was returned.', difference: 'Not applicable.', affected: 'See the message. Verified figures were left in place.' };
}

function uploadValidationActor_(label) {
  if (label === 'IMPORTED & VERIFIED' || label === 'DUPLICATE — ALREADY IMPORTED') return 'System';
  if (label === 'REJECTED — INVALID FILE' || label === 'PROCESSING ERROR') return 'Source report provider';
  return 'GM';
}

function uploadDiagnosticSubject_(validation) {
  var kind = validation.statusLabel === 'IMPORTED — REVIEW REQUIRED' ? 'Upload Review Required' : (validation.statusLabel === 'PROCESSING ERROR' ? 'Upload Processing Error' : (validation.statusLabel === 'REJECTED — INVALID FILE' ? 'Upload Rejected' : 'Upload Held'));
  var when = validation.businessDate ? uploadDayText_(validation.businessDate) : 'Undated';
  return 'STORE 17 | ' + kind + ' | ' + when + ' ' + (validation.reportType || 'report');
}

function uploadDiagnosticBody_(validation) {
  return [
    'REPORT: ' + validation.fileName,
    'BUSINESS DATE: ' + (validation.businessDate || 'Not identified'),
    'REPORT TYPE: ' + (validation.reportType || 'Not identified'),
    'STATUS: ' + validation.statusLabel,
    '',
    'WHAT FAILED:',
    validation.rule,
    '',
    'EXPECTED:',
    validation.expected,
    '',
    'ACTUAL:',
    validation.actual,
    '',
    'DIFFERENCE:',
    validation.difference,
    '',
    'WHAT THE SYSTEM DID:',
    validation.automatic,
    '',
    'WHAT WAS NOT IMPORTED:',
    validation.affected,
    '',
    'WHAT NEEDS TO HAPPEN:',
    validation.action,
    '',
    'WHO NEEDS TO ACT:',
    validation.actor,
    '',
    'VALIDATION REFERENCE:',
    validation.validationId,
  ].join('\n');
}

function sendUploadDiagnostic_(validation) {
  var label = validation.statusLabel;
  var notify = label === 'HELD — ACTION REQUIRED' || label === 'REJECTED — INVALID FILE' || label === 'PROCESSING ERROR' || label === 'IMPORTED — REVIEW REQUIRED' || label === 'SOURCE UNAVAILABLE';
  if (!notify) return '';
  if (validation.emailedAt) return validation.emailedAt;
  var email = '';
  try { email = String(config_().admin_email || '').trim(); } catch (error) { email = ''; }
  if (!email || typeof MailApp === 'undefined' || !MailApp.sendEmail) return '';
  MailApp.sendEmail(email, uploadDiagnosticSubject_(validation), uploadDiagnosticBody_(validation));
  return new Date().toISOString();
}

/** Saves one validation record and emails the GM only when the action is new. */
function recordUploadValidation_(context, result) {
  var message = String(result.message || '');
  var label = uploadPublicStatus_(result.status, message);
  var parts = uploadValidationParts_(result.status, message);
  var imported = result.status === 'Imported' || label === 'IMPORTED — REVIEW REQUIRED';
  var reportType = result.key ? uploadReportLabel_(result.key) : '';
  var businessDate = result.start && result.start === result.end ? result.start : (result.start || context.date || '');
  var action = message || 'No further action.';
  var validationId = 'UV-' + String(context.sha || '').slice(0, 12) + '-' + sha256Hex_(label + '|' + action).slice(0, 8);
  var automatic = (result.status === 'Storage Failure' ? 'SOURCE UNAVAILABLE. ' : 'RECEIVED. ') + (result.archivePath ? 'ARCHIVED at ' + result.archivePath + '. ' : (result.status === 'Storage Failure' ? '' : ''));
  automatic += 'Identified the report from its contents, checked the business date, and compared it only with the same source. A difference from NWDSR, SNAP, or the other Data KPI workbook is a reconciliation note, not a rejection. ';
  automatic += label === 'IMPORTED & VERIFIED' ? 'STRUCTURALLY VALIDATED. IMPORTED. METRIC COVERAGE VERIFIED.' : (label === 'DUPLICATE — ALREADY IMPORTED' ? 'The duplicate was skipped. The first original stays archived.' : (imported ? 'IMPORTED. HELD — the unresolved portion was marked.' : (result.status === 'Storage Failure' ? 'No comparison was run.' : 'HELD — the file was not applied. The original was not discarded for a cross-source difference.')));
  if (/reconciliation note/i.test(message)) automatic += ' RECONCILIATION NOTED.';
  var row = {
    validationId: validationId,
    at: new Date().toISOString(),
    sha256: context.sha,
    fileName: context.fileName,
    businessDate: businessDate,
    reportType: reportType,
    scope: uploadScope_(result.key),
    statusLabel: label,
    internalStatus: result.status,
    rule: parts.rule,
    expected: parts.expected,
    actual: parts.actual,
    difference: parts.difference,
    affected: parts.affected,
    imported: imported ? 'Yes' : 'No',
    figuresChanged: result.status === 'Imported' ? 'New or matching figures were saved. A different verified total was not overwritten.' : 'No. Existing verified figures were not changed.',
    automatic: automatic,
    action: action,
    actor: uploadValidationActor_(label),
    emailedAt: '',
    resolution: label === 'IMPORTED & VERIFIED' || label === 'DUPLICATE — ALREADY IMPORTED' ? 'Resolved' : 'Open',
  };
  var tab = uploadValidationTab_();
  var values = tab.getDataRange().getValues();
  var existing = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === validationId) existing = r + 1;
  }
  if (existing) {
    row.emailedAt = String(tab.getRange(existing, 20).getValue() || '');
    row.at = String(tab.getRange(existing, 2).getValue() || row.at);
  } else {
    row.emailedAt = sendUploadDiagnostic_(row);
  }
  var line = [row.validationId, row.at, row.sha256, row.fileName, row.businessDate, row.reportType, row.scope, row.statusLabel, row.internalStatus, row.rule, row.expected, row.actual, row.difference, row.affected, row.imported, row.figuresChanged, row.automatic, row.action, row.actor, row.emailedAt, row.resolution];
  if (existing) tab.getRange(existing, 1, 1, line.length).setValues([line]);
  else tab.appendRow(line);
  if (typeof forgetRead_ === 'function') forgetRead_('CC_UploadValidation');
  row.states = automatic;
  return row;
}

function uploadHistory_(payload) {
  return { role: payload.session.role, rows: uploadValidationRows_().slice(-40).reverse() };
}

/** Checks a stored validation again. It does not write a second copy of any total. */
function retryUploadValidation_(payload) {
  var id = String(payload.validationId || '');
  var found = null;
  uploadValidationRows_().forEach(function (row) { if (row.validationId === id) found = row; });
  if (!found) throw new Error('That validation record is not on file.');
  return {
    validationId: id,
    statusLabel: found.statusLabel,
    resolution: found.resolution,
    duplicated: false,
    figuresChanged: 'No. Retry did not write another copy.',
    message: found.resolution === 'Resolved'
      ? 'Retry checked ' + id + '. The source is already verified, so nothing was added.'
      : 'Retry checked ' + id + '. The issue is unchanged, so no second email was sent and no total was written again. ' + found.action,
  };
}

/* ---------- Status ---------- */

function uploadEvidence_() {
  var facts = {};
  dailyFacts_().forEach(function (row) { facts[row.date] = row; });
  var ledger = {};
  var cumulative = [];
  ledgerRows_().forEach(function (row) {
    if (row.grain === 'cumulative' && row.fitsTrack) cumulative.push(row);
    if (row.grain !== 'daily' || !row.reportDate) return;
    if (row.code && row.view !== 'PERQ_PERSON' && row.view !== 'DA_SALES_PERSON') return;
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
  var archiveBySha = {};
  sheet_('CC_SourceArchive').forEach(function (row) {
    var sha = String(row.sha256 || '');
    if (!sha || !String(row.drive_file_id || '')) return;
    archiveBySha[sha] = { id: String(row.drive_file_id), path: String(row.folder_path || ''), file: String(row.file_name || '') };
  });
  return { facts: facts, ledger: ledger, cumulative: cumulative, attempts: attempts, uploads: uploads, archiveBySha: archiveBySha };
}

/** A logged read whose original is gone. A logged dollar total is not a source of KPI rows. */
function uploadWasDiscarded_(last) {
  if (!last) return false;
  var status = String(last.status || '');
  var message = String(last.message || '');
  if (/^(Imported|Already on file|Covered|Not expected)$/i.test(status)) return false;
  if (/^Storage Failure$/i.test(status) || /^Noted$/i.test(status)) return true;
  return /was not saved|workbook was not saved|original was not retained|not retained|differs from NWDSR|do not match NWDSR/i.test(message) && !/reconciliation note/i.test(message);
}

function uploadReceipt_(onFile, status, last, archived) {
  if (status === 'Covered' || status === 'Not expected') return 'Fully imported and verified';
  if (status === 'Imported' || status === 'Incomplete' || (onFile && status !== 'Needs Review' && status !== 'Failed')) {
    if (last && /differ from the figures already recorded|Not on the roster/i.test(String(last.message || ''))) return 'Imported but incomplete';
    return status === 'Imported' || onFile ? 'Fully imported and verified' : 'Never received';
  }
  if (onFile && (status === 'Needs Review' || status === 'Failed')) return 'Imported but incomplete';
  if (archived) return 'Received and archived but not imported';
  if (uploadWasDiscarded_(last) || (last && String(last.status) === 'Storage Failure')) return 'Previously received but not retained';
  return 'Never received';
}

function uploadReceiptStates_(receipt) {
  if (receipt === 'Fully imported and verified') return 'RECEIVED. ARCHIVED. STRUCTURALLY VALIDATED. IMPORTED. METRIC COVERAGE VERIFIED.';
  if (receipt === 'Imported but incomplete') return 'RECEIVED. ARCHIVED. STRUCTURALLY VALIDATED. IMPORTED. HELD — coverage is incomplete.';
  if (receipt === 'Received and archived but not imported') return 'RECEIVED. ARCHIVED. HELD — not imported.';
  if (receipt === 'Previously received but not retained') return 'RECEIVED. SOURCE UNAVAILABLE. ORIGINAL NOT RETAINED.';
  return '';
}

/** A day inside an imported month-to-date report is already provided. It is not a missing daily file. */
function uploadCover_(evidence, date, key) {
  var views = [];
  var side = '';
  var track = 'STORE';
  if (key === 'g17Written' || key === 'g17Delivered') { views = ['DA_SALES_PERSON']; side = key === 'g17Written' ? 'written' : 'delivered'; track = 'PERSON'; }
  else if (key === 'aslWritten' || key === 'aslDelivered') { views = ['DA_SALES_STORE', 'RUGS_STORE', 'PILLOWS_STORE', 'BASES_STORE', 'FP_STORE']; side = key === 'aslWritten' ? 'written' : 'delivered'; }
  else if (key === 'perqLocation') views = ['PERQ_STORE'];
  else if (key === 'perqSalesperson') { views = ['PERQ_PERSON']; track = 'PERSON'; }
  else return '';
  var period = track === 'STORE' ? storePeriodContaining_(date) : individualPeriodContaining_(date);
  var best = '';
  (evidence.cumulative || []).forEach(function (row) {
    if (views.indexOf(row.view) === -1 || row.side !== side) return;
    if (track === 'STORE' && (row.code || row.name)) return;
    if (row.periodStart !== period.start || !row.verifiedThrough || row.verifiedThrough < date) return;
    if (row.verifiedThrough > best) best = row.verifiedThrough;
  });
  return best;
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
      var person = ledger('DA_SALES_PERSON', side);
      if (person && /DATA_ANALYSIS_KPI_17_/i.test(person.source || '')) {
        onFile = true;
        detail = 'Salesperson KPI lines are on file. They are not the official store total.';
      }
    }
    if (item.key === 'aslWritten' || item.key === 'aslDelivered') {
      var aslSide = item.key === 'aslWritten' ? 'written' : 'delivered';
      var aslSales = ledger('DA_SALES_STORE', aslSide);
      var aslRow = asl(aslSide);
      var storeSource = (aslSales && aslSales.source) || (aslRow && aslRow.source) || '';
      if ((aslSales || aslRow) && /DATA_ANALYSIS_KPI_(ASL|17)_/i.test(storeSource)) {
        onFile = true;
        var rugs = ledger('RUGS_STORE', aslSide);
        detail = 'Store 17 KPI line' + (aslSales && aslSales.sales !== null ? ', KPI sales ' + moneyPlain_(aslSales.sales) : '') + (rugs && rugs.units !== null ? ', rugs ' + rugs.units : '');
        var nwdsr = aslSide === 'written' ? fact.nwdsrWritten : fact.nwdsrDelivered;
        if (aslSales && nwdsr !== null && nwdsr !== undefined && Math.abs((aslSales.sales || 0) - nwdsr) > 1) detail += '. Data KPI Store ' + moneyPlain_(aslSales.sales) + ' and NWDSR ' + (aslSide === 'written' ? 'Written' : 'Delivered') + ' ' + moneyPlain_(nwdsr) + ' differ. Both figures are kept. NWDSR stays the ' + aslSide + ' standard. The difference is a reconciliation note, not an error.';
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
    var dayText = uploadDayText_(date);
    if (check) { status = 'Needs Review'; message = check; }
    else if (!onFile && last && last.status === 'Needs Review') { status = 'Needs Review'; message = last.message; }
    else if (!onFile && last && last.status === 'Failed' && /must be confirmed|Tick "These Excel files are for|not the business date|before the business date|prints .* which is after today/i.test(last.message)) status = 'Missing';
    else if (!onFile && last && last.status === 'Failed') { status = 'Failed'; message = last.message; }
    else if (!onFile && last && last.status === 'Storage Failure') { status = 'Storage Failure'; message = last.message; }
    if ((item.key === 'g17Delivered' || item.key === 'aslDelivered') && fact.nwdsrDelivered === 0 && !onFile && !check) {
      status = 'Not expected';
      message = dayText + '. Delivered $0.';
    }
    if (status === 'Missing') {
      var cover = uploadCover_(evidence, date, item.key);
      if (cover) {
        status = 'Covered';
        message = 'Already provided. The month-to-date report is verified through ' + uploadDayText_(cover) + '.';
      } else message = 'Never received for ' + dayText + '.';
    }
    var archived = !!(last && last.sha256 && evidence.archiveBySha && evidence.archiveBySha[last.sha256] && evidence.archiveBySha[last.sha256].id);
    var receipt = uploadReceipt_(onFile, status, last, archived);
    if (receipt === 'Imported but incomplete' && status === 'Imported') status = 'Incomplete';
    if (receipt === 'Previously received but not retained') {
      status = 'Not retained';
      var family = item.key.indexOf('asl') === 0 ? 'asl' : (item.key.indexOf('g17') === 0 ? 'group17' : '');
      var side = /Delivered/.test(item.key) ? 'delivered' : 'written';
      var required = family ? canonicalKpiName_(family, side, date) : item.label;
      message = 'PREVIOUSLY RECEIVED — ORIGINAL NOT RETAINED. The required file is ' + required + '. ' + (last && last.file ? last.file : 'An earlier file') + ' was received and was not retained. This is not "never received." The upload log proves the file was read. The original is not in the archive. Individual KPI values are not reconstructed from the logged total. A SNAP PDF, an NWDSR PDF, and the other Data KPI workbook do not fill this row. NWDSR store totals are left as they are.' + (last && last.message ? ' ' + last.message : '');
    } else if (receipt === 'Received and archived but not imported' && (status === 'Missing' || status === 'Archived')) {
      status = 'Archived';
      message = 'RECEIVED AND ARCHIVED — NOT IMPORTED. ' + item.label + ' for ' + dayText + ' is in the archive' + (archived && evidence.archiveBySha[last.sha256].path ? ' at ' + evidence.archiveBySha[last.sha256].path : '') + ' and was not imported.' + (last && last.message ? ' ' + last.message : '');
    } else if (receipt === 'Received and archived but not imported') {
      message = 'RECEIVED AND ARCHIVED — NOT IMPORTED. ' + (message || '');
    } else if (receipt === 'Imported but incomplete') {
      message = 'IMPORTED BUT INCOMPLETE. ' + (message || (last && last.message) || '');
    } else if (receipt === 'Never received' && status === 'Missing') {
      message = 'Never received for ' + dayText + '.';
    }
    return { key: item.key, label: item.label, format: item.format, use: item.use, display: dayText + ' — ' + item.label + ' — ' + item.format, status: status, statusLabel: uploadPublicStatus_(status, message), receipt: receipt, states: uploadReceiptStates_(receipt), message: message, date: date, dateText: dayText, lastFile: last ? last.file : '', lastAt: last ? last.at : '' };
  });
}

var MAILBOX_REPORT_LABELS_ = {
  'Data Analysis KPI 17 Written': 'Data KPI Individual — Written',
  'Data Analysis KPI 17 Delivered': 'Data KPI Individual — Delivered',
  'Data Analysis KPI ASL Written': 'Data KPI Store — Written',
  'Data Analysis KPI ASL Delivered': 'Data KPI Store — Delivered',
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
        try { refreshHistory_(); } catch (error) { appendException_('Update Failed', 'Permanent history could not be refreshed after an upload. Nothing already recorded was changed. ' + String(error && error.message ? error.message : error)); }
        try { refreshMetricRegistry_(); } catch (error) { appendException_('Update Failed', 'CC_MetricDefinitions could not be refreshed after an upload. ' + String(error && error.message ? error.message : error)); }
        noteHealth_('last_calculation', new Date().toISOString());
        var quality = typeof qualityAfterUpdate_ === 'function' ? qualityAfterUpdate_('upload by ' + payload.session.role, false) : null;
        if (!refreshed) refreshed = { issues: [], kpiUpdated: [], kpiAppended: [] };
        refreshed.quality = quality;
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
    recent.push({
      date: cursor,
      dateText: uploadDayText_(cursor),
      imported: items.filter(function (item) { return item.status === 'Imported'; }).length,
      review: items.filter(function (item) { return item.status === 'Needs Review' || item.status === 'Failed'; }).length,
      missing: items.filter(function (item) { return item.status === 'Missing' || item.status === 'Failed' || item.status === 'Needs Review' || item.status === 'Not retained' || item.status === 'Archived' || item.status === 'Incomplete' || item.status === 'Storage Failure'; }).map(function (item) { return item.label; }),
    });
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
  var audit = refreshed && refreshed.quality && refreshed.quality.consistency;
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
    refreshed: refreshed ? { issues: refreshed.issues || [], updated: (refreshed.kpiUpdated || []).length + (refreshed.kpiAppended || []).length } : null,
    dashboardRefreshed: payload.refresh === true && !!refreshed,
    consistency: audit ? { status: String(audit.status || ''), checked: audit.checked || 0, matched: audit.matched || 0, discrepancies: audit.discrepancies || 0 } : null,
    history: evidence.uploads.slice(-40).reverse(),
    validationHistory: uploadValidationRows_().slice(-30).reverse(),
  };
}
