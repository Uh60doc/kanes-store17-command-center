/**
 * PERMANENT HISTORY. Every tab here only grows or fills a blank; none rewrites an imported record.
 *
 * CC_DailyHistory    One row per business date, report, scope, salesperson and side, written once with the figures as
 *                    first imported. A later report that disagrees is noted on the original date's row
 *                    (later_report_note) and the recorded figures stay: a cancellation belongs to the day it is reported.
 * CC_SourceArchive   Each original report file kept once (by SHA-256) in the private Drive folder
 *                    "Store 17 Command Center Report Archive", filed by year, month and business date.
 * CC_PeriodCalendar  Each store month (the 2nd through the 1st) and salesperson month (the 1st through the last day)
 *                    with the last-year period it is compared with. A store month's last-year period is Pending until
 *                    the GM confirms it in CC_Config; a confirmed mapping is kept.
 * CC_GoalHistory     Each month's goals, captured while the month is open and locked when it ends.
 * CC_MonthlyHistory  Each completed month's verified month to date beside its official final, goal and last year. A row
 *                    is locked (Final) once it matches a complete official final or the month has been over for
 *                    MONTH_LOCK_DAYS_; after that only a blank or Pending cell is filled, and a later difference is noted.
 * CC_LastYear        Verified last-year figures entered from supplied reports. A missing figure is Pending, never estimated.
 */

var DAILY_HISTORY_TAB_ = 'CC_DailyHistory';
var DAILY_HISTORY_HEADERS_ = ['record_key', 'business_date', 'store_month', 'person_month', 'view', 'scope', 'employee_id', 'employee_name', 'side', 'sales_dollars', 'unit_count', 'eligible', 'attachments', 'kpi_percent', 'customers', 'reported_negative', 'verification_status', 'source_report', 'source_tab', 'imported_at', 'recorded_at', 'ly_date', 'source_file', 'source_sha256', 'archive_file_id', 'later_report_note'];
// Columns 1-21 are the record as first imported and are never written again.
var DAILY_HISTORY_FIXED_ = 21;
var SOURCE_ARCHIVE_TAB_ = 'CC_SourceArchive';
var SOURCE_ARCHIVE_HEADERS_ = ['archived_at', 'sha256', 'file_name', 'report', 'report_start', 'report_end', 'folder_path', 'drive_file_id', 'origin', 'note'];
var SOURCE_ARCHIVE_ROOT_ = 'Store 17 Command Center Report Archive';
var PERIOD_CALENDAR_TAB_ = 'CC_PeriodCalendar';
var PERIOD_CALENDAR_HEADERS_ = ['period_key', 'track', 'year', 'month', 'period_start', 'period_end', 'days', 'open_days', 'closed_days', 'ly_period_key', 'ly_start', 'ly_end', 'ly_mapping', 'calendar_status', 'ly_status'];
var GOAL_HISTORY_TAB_ = 'CC_GoalHistory';
var GOAL_HISTORY_HEADERS_ = ['goal_record_key', 'period_key', 'track', 'period_start', 'period_end', 'goal_key', 'metric_key', 'goal', 'goal_basis', 'status', 'captured_at', 'locked_at'];
var MONTHLY_HISTORY_TAB_ = 'CC_MonthlyHistory';
var MONTHLY_HISTORY_HEADERS_ = ['history_key', 'period_key', 'track', 'period_start', 'period_end', 'metric', 'side', 'employee_id', 'person', 'position_at_close', 'status_at_close', 'unit', 'verified_total', 'verified_through', 'coverage', 'qualified', 'sold', 'mtd_basis', 'daily_records_total', 'missing_or_unverified', 'official_final', 'official_basis', 'variance', 'explanation', 'goal', 'goal_basis', 'last_year', 'last_year_basis', 'history_status', 'first_recorded_at', 'updated_at', 'locked_at', 'after_lock_note'];
var LAST_YEAR_TAB_ = 'CC_LastYear';
var LAST_YEAR_HEADERS_ = ['ly_start', 'ly_end', 'track', 'metric', 'side', 'employee_id', 'person', 'value', 'unit', 'source_report', 'source_sha256', 'verified_by', 'entered_at', 'note'];
var MONTH_LOCK_DAYS_ = 10;
// A completed month whose rows are all Final is not recalculated after this many days.
var MONTH_RECHECK_DAYS_ = 62;
var FIRST_CONFIRMED_STORE_MONTH_ = '2026-10-02';
var NO_LY_DAY_ = 'No matching last-year day';

var HISTORY_GOAL_METRICS_ = [
  ['Store', 'NWDSR Written', 'store_written'], ['Store', 'NWDSR Delivered', 'store_delivered'], ['Store', 'Closing ratio', 'store_closing'],
  ['Store', 'Bedding %', 'kpi_bedding'], ['Store', 'Average ticket', 'kpi_average_ticket'], ['Store', 'Financing', 'kpi_finance'],
  ['Store', 'Mattress protectors', 'kpi_protectors'], ['Store', 'Fabric protection', 'kpi_fabric'], ['Store', 'Leather protection', 'kpi_leather'],
  ['Store', 'Power upholstery', 'kpi_power'], ['Store', 'Total attachment', 'kpi_total_attachment'], ['Store', 'Adjustable bases', 'kpi_adjustable_base'],
  ['Store', 'Pillows', 'kpi_pillows'], ['Store', 'Wood / Furniture Protection', 'kpi_wood'], ['Store', 'Rugs', 'kpi_rugs'],
  ['Person', 'SNAP Written', 'person_written'], ['Person', 'Closing ratio', 'person_closing'],
  ['Person', 'Bedding %', 'kpi_bedding'], ['Person', 'Average ticket', 'kpi_average_ticket'], ['Person', 'Financing', 'kpi_finance'],
  ['Person', 'Mattress protectors', 'kpi_protectors'], ['Person', 'Fabric protection', 'kpi_fabric'], ['Person', 'Leather protection', 'kpi_leather'],
  ['Person', 'Power upholstery', 'kpi_power'], ['Person', 'Total attachment', 'kpi_total_attachment'],
];

var sourceArchiveIndex_ = null;
var archiveEvidenceCache_ = null;

/* ---------- shared helpers ---------- */

function historyTab_(name, headers) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) {
    tab = spreadsheet.insertSheet(name);
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
    return tab;
  }
  var head = tab.getLastRow() ? tab.getRange(1, 1, 1, headers.length).getValues()[0].map(function (cell) { return String(cell || '').trim(); }) : [];
  var prefix = head.filter(function (cell) { return cell; });
  if (prefix.length < headers.length && prefix.every(function (cell, i) { return cell === headers[i]; })) tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  return tab;
}

/** A cell as text for comparison: Sheets turns ISO dates into Dates and number strings into numbers on read-back. */
function historyNorm_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return isNaN(value.getTime()) ? '' : isoDate_(value);
  if (typeof value === 'number') return String(Math.round(value * 10000) / 10000);
  var text = String(value === null || value === undefined ? '' : value).trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return String(Math.round(Number(text) * 10000) / 10000);
  return text;
}

function historyBlank_(value) {
  return historyNorm_(value) === '';
}

function historyCell_(value) {
  return value === null || value === undefined ? '' : value;
}

function historyRows_(tab, width) {
  var values = tab.getDataRange().getValues();
  return values.map(function (row) {
    var copy = row.slice(0, width);
    while (copy.length < width) copy.push('');
    return copy;
  });
}

function historyDayGap_(start, end) {
  var a = isoParts_(start);
  var b = isoParts_(end);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
}

function historyNow_() {
  return new Date().toISOString();
}

/** The report a file or ledger source is, in the words CC_Uploads uses. Empty when it is not one of the daily reports. */
function canonicalReportType_(text) {
  var value = String(text || '');
  var side = /WRITTEN/i.test(value) ? 'Written' : /DELIVERED/i.test(value) ? 'Delivered' : '';
  if (/PERQ|Performance[ _]Stats/i.test(value)) return /Salesperson/i.test(value) ? 'PERQ Performance Stats by Salesperson' : /Location/i.test(value) ? 'PERQ Performance Stats by Location' : '';
  if (/KPI[ _]ASL|GROUP ASL|^ASL\b/i.test(value)) return side ? 'ASL ' + side : '';
  if (/KPI[ _]17|Group 17/i.test(value)) return side ? 'Group 17 ' + side : '';
  if (/NWDSR/i.test(value)) return side ? 'NWDSR ' + side : '';
  if (/SNAP[ _]*W|Snapw/i.test(value)) return 'SNAP Written';
  return '';
}

/* ---------- period calendar and last-year mapping ---------- */

function storeLastYear_(config, period) {
  var month = period.year + '-' + pad2_(period.month);
  var start = isoDate_(config['prior_year_start_' + month]);
  var end = isoDate_(config['prior_year_end_' + month]);
  if (start && end) return { start: start, end: end, confirmed: true, status: 'Confirmed: CC_Config prior_year_start_' + month + ' / prior_year_end_' + month };
  if (isoDate_(config.store_period_start) === period.start && isoDate_(config.prior_year_start) && isoDate_(config.prior_year_end)) {
    return { start: isoDate_(config.prior_year_start), end: isoDate_(config.prior_year_end), confirmed: true, status: 'Confirmed: CC_Config prior_year_start / prior_year_end for the store month starting ' + period.start };
  }
  var proposed = periodFor_('individual', period.year - 1, period.month);
  return { start: proposed.start, end: proposed.end, confirmed: false, status: 'Pending GM confirmation (proposed: the same calendar month last year, ' + proposed.start + ' to ' + proposed.end + ')' };
}

function calendarEntry_(ctx, track, period) {
  var days = eachDate_(period.start, period.end);
  var closed = days.filter(function (date) { return ctx.closed[date]; }).length;
  var ly;
  if (track === 'Store') ly = storeLastYear_(ctx.config, period);
  else {
    var last = periodFor_('individual', period.year - 1, period.month);
    ly = { start: last.start, end: last.end, confirmed: true, status: 'Confirmed: salesperson months compare calendar month to calendar month' };
  }
  var lyDays = historyDayGap_(ly.start, ly.end) + 1;
  var mapping = track === 'Store'
    ? 'Day for day in order: ' + period.start + ' is compared with ' + ly.start + (lyDays === days.length ? '' : '. ' + days.length + ' store days and ' + lyDays + ' last-year days: a day without a partner has ' + NO_LY_DAY_.toLowerCase())
    : 'Same calendar date one year earlier' + (period.month === 2 ? '; February 29 has ' + NO_LY_DAY_.toLowerCase() : '');
  return {
    key: periodKey_(track, period), track: track, period: period, ly: ly,
    row: [periodKey_(track, period), track, period.year, period.month, period.start, period.end, days.length, days.length - closed, closed,
      (track === 'Store' ? 'STORE-' : 'PERSON-') + ly.start.slice(0, 7), ly.start, ly.end, mapping,
      track === 'Store' ? (period.start < FIRST_CONFIRMED_STORE_MONTH_ ? 'Pending GM confirmation: store months before October 2026 are not confirmed' : 'Store month: the 2nd through the 1st') : 'Salesperson month: the 1st through the last day',
      ly.status],
  };
}

/** The last-year date a business date is compared with, or why there is none. */
function lastYearDate_(entry, date) {
  if (!entry) return '';
  if (entry.track === 'Person') {
    var parts = isoParts_(date);
    if (parts.month === 2 && parts.day === 29) return NO_LY_DAY_;
    return (parts.year - 1) + '-' + pad2_(parts.month) + '-' + pad2_(parts.day);
  }
  var mapped = shiftDate_(entry.ly.start, historyDayGap_(entry.period.start, date));
  if (mapped > entry.ly.end) return NO_LY_DAY_;
  return entry.ly.confirmed ? mapped : 'Pending GM confirmation (proposed ' + mapped + ')';
}

/** Months from January 2026 through next month, and every earlier month with a record, for both tracks. */
function historyPeriods_(ctx) {
  var found = {};
  var withData = monthEndPeriodsWithData_(ctx);
  Object.keys(withData).forEach(function (key) { found[key] = withData[key]; });
  var next = isoParts_(shiftDate_(individualPeriodContaining_(ctx.today).end, 1));
  var year;
  var month;
  for (year = 2026; year <= next.year; year += 1) {
    for (month = 1; month <= 12; month += 1) {
      if (year === next.year && month > next.month) break;
      var store = periodFor_('store', year, month);
      var person = periodFor_('individual', year, month);
      found[periodKey_('Store', store)] = { track: 'Store', period: store };
      found[periodKey_('Person', person)] = { track: 'Person', period: person };
    }
  }
  return Object.keys(found).sort().map(function (key) { return found[key]; });
}

function refreshPeriodCalendar_(ctx) {
  var tab = historyTab_(PERIOD_CALENDAR_TAB_, PERIOD_CALENDAR_HEADERS_);
  var kept = {};
  historyRows_(tab, PERIOD_CALENDAR_HEADERS_.length).slice(1).forEach(function (row) {
    if (/^Confirmed/.test(String(row[14]))) kept[String(row[0])] = row;
  });
  var calendar = {};
  var grid = [PERIOD_CALENDAR_HEADERS_];
  historyPeriods_(ctx).forEach(function (item) {
    var entry = calendarEntry_(ctx, item.track, item.period);
    var previous = kept[entry.key];
    if (previous && !entry.ly.confirmed) {
      entry.ly = { start: isoDate_(previous[10]), end: isoDate_(previous[11]), confirmed: true, status: String(previous[14]) };
      [9, 10, 11, 12, 14].forEach(function (i) { entry.row[i] = previous[i]; });
    }
    calendar[entry.key] = entry;
    grid.push(entry.row);
  });
  tab.clearContents();
  tab.getRange(1, 1, grid.length, PERIOD_CALENDAR_HEADERS_.length).setValues(grid);
  return calendar;
}

/* ---------- original report archive ---------- */

function sourceArchiveTab_() {
  return historyTab_(SOURCE_ARCHIVE_TAB_, SOURCE_ARCHIVE_HEADERS_);
}

function archiveIndex_() {
  if (sourceArchiveIndex_) return sourceArchiveIndex_;
  var index = {};
  sheet_(SOURCE_ARCHIVE_TAB_).forEach(function (row) {
    var sha = String(row.sha256 || '');
    if (sha && !index[sha]) index[sha] = { id: String(row.drive_file_id || ''), path: String(row.folder_path || ''), file: String(row.file_name || '') };
  });
  sourceArchiveIndex_ = index;
  return index;
}

/** YYYY/YYYY-MM/YYYY-MM-DD for a single-day report, YYYY/YYYY-MM/Period reports for a longer one, else Undated. */
function archivePath_(start, end) {
  if (!start) return 'Undated';
  var month = start.slice(0, 4) + '/' + start.slice(0, 7);
  return !end || end === start ? month + '/' + start : month + '/Period reports';
}

function archiveFolder_(path) {
  var props = PropertiesService.getScriptProperties();
  var open = function (key, name, parent) {
    var id = props.getProperty(key);
    if (id) {
      try { return DriveApp.getFolderById(id); } catch (error) { id = ''; }
    }
    var folder = parent ? parent.createFolder(name) : DriveApp.createFolder(name);
    props.setProperty(key, folder.getId());
    return folder;
  };
  var folder = open('archive_root_folder', SOURCE_ARCHIVE_ROOT_, null);
  var walked = [];
  path.split('/').forEach(function (part) {
    walked.push(part);
    folder = open('archive_folder_' + walked.join('/'), part, folder);
  });
  return folder;
}

/** Keeps one original file per SHA-256. The Drive file is private to the archive owner and is never written again. */
function archiveSource_(blob, sha, fileName, report, start, end, origin, note) {
  var index = archiveIndex_();
  if (index[sha]) return { created: false, id: index[sha].id, path: index[sha].path };
  var path = archivePath_(start, end);
  var file = archiveFolder_(path).createFile(blob.setName(fileName));
  file.setDescription('Original ' + (report || 'report') + ' ' + (start || '') + (end && end !== start ? ' to ' + end : '') + '. SHA-256 ' + sha + '. Kept by the Store 17 Command Center; do not edit.');
  sourceArchiveTab_().appendRow([historyNow_(), sha, fileName, report || '', start || '', end || '', path, file.getId(), origin || '', note || '']);
  index[sha] = { id: file.getId(), path: path, file: fileName };
  return { created: true, id: file.getId(), path: path };
}

function archiveNoteDates_(note) {
  var match = /(\d{4}-\d{2}-\d{2})(?:\s+(?:through|to)\s+(\d{4}-\d{2}-\d{2}))?/.exec(String(note || ''));
  return match ? { start: match[1], end: match[2] || match[1] } : null;
}

/**
 * Why a file belongs in the archive: the report it was recorded as and the dates it covers, from CC_Uploads,
 * CC_Imports, CC_AssociateDays (by SHA-256) or a CC_Ledger row naming the file. Null when nothing on record used it.
 * A re-saved copy whose figures were already on file (duplicate) is not the source of a record, so it is only taken
 * when an admin backfills an original that is otherwise missing.
 */
function archiveEvidence_(sha, fileName, allowDuplicate) {
  var found = null;
  sheet_('CC_Uploads').forEach(function (row) {
    if (found || String(row.sha256 || '') !== sha || !String(row.report || '') || !/^Imported$/i.test(String(row.status || ''))) return;
    var date = isoDate_(row.business_date);
    found = { report: String(row.report), start: isoDate_(row.report_start) || date, end: isoDate_(row.report_end) || date, basis: 'CC_Uploads ' + String(row.status || '') };
  });
  if (found) return found;
  sheet_('CC_Imports').forEach(function (row) {
    var status = String(row.status || '');
    if (found || String(row.sha256 || '') !== sha || /^(failed|needs-review|not used)$/i.test(status) || /^held/i.test(status) || (status === 'duplicate' && !allowDuplicate)) return;
    var dates = archiveNoteDates_(row.note) || archiveNoteDates_(row.file_name) || { start: '', end: '' };
    found = { report: String(row.report_type || '') || canonicalReportType_(row.file_name), start: dates.start, end: dates.end, basis: 'CC_Imports ' + status };
  });
  if (found) return found;
  if (!archiveEvidenceCache_) {
    var bySha = {};
    var byFile = {};
    sheet_('CC_AssociateDays').forEach(function (row) {
      var lineSha = String(row.sha256 || '');
      if (lineSha && !bySha[lineSha]) bySha[lineSha] = { report: 'SNAP Written', start: isoDate_(row.date), end: isoDate_(row.date), basis: 'CC_AssociateDays SNAP Written salesperson lines' };
    });
    ledgerRows_().forEach(function (row) {
      if (!row.source || byFile[row.source] || DERIVED_LEDGER_SOURCE_.test(row.source)) return;
      var start = row.grain === 'daily' ? row.reportDate : row.periodStart;
      byFile[row.source] = { report: canonicalReportType_(row.source) || row.view, start: start, end: row.grain === 'daily' ? row.reportDate : row.periodEnd, basis: 'CC_Ledger rows name this file (matched by file name)', byName: true };
    });
    archiveEvidenceCache_ = { bySha: bySha, byFile: byFile };
  }
  return archiveEvidenceCache_.bySha[sha] || archiveEvidenceCache_.byFile[fileName] || null;
}

/** Archives a file only when a record on file came from it. Returns null when it was not used for any record. */
function archiveRecordedOriginal_(blob, sha, fileName, origin) {
  var index = archiveIndex_();
  if (index[sha]) return { created: false, id: index[sha].id, path: index[sha].path };
  var evidence = archiveEvidence_(sha, fileName, false);
  if (!evidence) return null;
  return archiveSource_(blob, sha, fileName, evidence.report, evidence.start, evidence.end, origin, 'Recorded: ' + evidence.basis);
}

/** Admin: keep an original that was imported before the archive existed. A file nothing on record used is refused. */
function archiveOriginal_(payload) {
  var fileName = String(payload.fileName || 'report').replace(/[\\\/]/g, '_').slice(0, 160);
  var base64 = String(payload.base64 || '');
  if (!base64) throw new Error(fileName + ' is empty.');
  var bytes = Utilities.base64Decode(base64);
  if (bytes.length > UPLOAD_MAX_BYTES_) throw new Error(fileName + ' is larger than 15 MB.');
  var sha = sha256Hex_(bytes);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    throw new Error('Another import is running. Wait a minute and archive ' + fileName + ' again.');
  }
  try {
    sourceArchiveTab_();
    var index = archiveIndex_();
    if (index[sha]) return { file: fileName, sha256: sha, status: 'Already archived', path: index[sha].path, message: 'This exact file is already in the archive as ' + index[sha].file + '.' };
    var evidence = archiveEvidence_(sha, fileName, true);
    if (!evidence) return { file: fileName, sha256: sha, status: 'Not archived', path: '', message: 'No record on file came from this file (CC_Uploads, CC_Imports, CC_AssociateDays or CC_Ledger), so it was not archived. Import it through Upload Reports first.' };
    var sameName = evidence.byName ? Object.keys(index).filter(function (key) { return index[key].file === fileName; })[0] : '';
    if (sameName) return { file: fileName, sha256: sha, status: 'Not archived', path: index[sameName].path, message: 'A different file named ' + fileName + ' is already archived, and the records name the file only, so this copy was not archived.' };
    var mime = bytesStartWith_(bytes, [37, 80, 68, 70]) ? 'application/pdf' : bytesStartWith_(bytes, [80, 75]) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream';
    var saved = archiveSource_(Utilities.newBlob(bytes, mime, fileName), sha, fileName, evidence.report, evidence.start, evidence.end, 'backfill', 'Recorded: ' + evidence.basis);
    return { file: fileName, sha256: sha, status: saved.created ? 'Archived' : 'Already archived', path: saved.path, message: evidence.report + ' ' + evidence.start + (evidence.end && evidence.end !== evidence.start ? ' to ' + evidence.end : '') + ' (' + evidence.basis + ').' };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- daily history register ---------- */

/** The files on record, so each daily figure can name the report it came from. */
function historySources_() {
  var byFile = {};
  var bySha = {};
  var byTypeDate = {};
  function add(entry, type, date) {
    if (entry.file && !byFile[entry.file]) byFile[entry.file] = entry;
    if (entry.sha && !bySha[entry.sha]) bySha[entry.sha] = entry;
    if (type && date && !byTypeDate[type + '|' + date]) byTypeDate[type + '|' + date] = entry;
  }
  sheet_('CC_Imports').forEach(function (row) {
    var status = String(row.status || '');
    if (/^(failed|needs-review|not used)$/i.test(status) || /^held/i.test(status)) return;
    var dates = archiveNoteDates_(row.note) || archiveNoteDates_(row.file_name);
    var type = canonicalReportType_(String(row.report_type || '') + ' ' + String(row.file_name || ''));
    add({ file: String(row.file_name || ''), sha: String(row.sha256 || '') }, type, dates && dates.start === dates.end ? dates.start : '');
  });
  uploadRows_().forEach(function (row) {
    if (!row.report || /^Failed$/i.test(row.status)) return;
    add({ file: row.file, sha: row.sha256 }, row.report, row.start && row.start === row.end ? row.start : '');
  });
  return { byFile: byFile, bySha: bySha, byTypeDate: byTypeDate };
}

function historyViewType_(view, side, source) {
  if (/^SNAP_/.test(view)) return 'SNAP Written';
  if (view === 'NWDSR_WRITTEN_STORE' || view === 'CUSTOMERS_STORE') return 'NWDSR Written';
  if (view === 'NWDSR_DELIVERED_STORE') return 'NWDSR Delivered';
  if (view === 'PERQ_STORE') return 'PERQ Performance Stats by Location';
  if (view === 'PERQ_PERSON') return 'PERQ Performance Stats by Salesperson';
  var named = canonicalReportType_(source);
  if (named) return named;
  var family = /^(BASES|PILLOWS|FP|RUGS)_/.test(view) ? 'ASL ' : 'Group 17 ';
  return side ? family + (side === 'delivered' ? 'Delivered' : 'Written') : '';
}

/** Each later report that was held back because it differed from a recorded day (CC_History), by "tab|record key". */
function laterReportNotes_() {
  var notes = {};
  sheet_('CC_History').forEach(function (row) {
    var replaced = String(row.replaced_by || '');
    if (replaced.indexOf('not applied') !== 0) return;
    var key = String(row.tab || '') + '|' + String(row.record_key || '');
    var figure = /Later figure:\s*([^.]*(?:\.\d+)?)/.exec(String(row.reason || ''));
    var at = row.archived_at instanceof Date ? row.archived_at.toISOString() : String(row.archived_at || '');
    var text = at.slice(0, 10) + ': a later report (' + replaced.replace(/^not applied:\s*/, '') + ') showed ' + (figure ? figure[1].trim() : 'a different figure') + '; the figure recorded for this date was kept';
    (notes[key] = notes[key] || []).push(text);
  });
  return notes;
}

function historyPerson_(code, name) {
  var match = code || name ? rosterMatch_(code, name) : null;
  return { id: match && match.employeeId ? match.employeeId : String(code || ''), name: match ? match.name : String(name || code || '') };
}

/** Every single-day figure on file, once each: ledger rows first, then CC_Daily, CC_Closing and CC_AssociateDays lines not in the ledger. */
function dailyHistoryCandidates_(ctx) {
  var out = [];
  var seen = {};
  var lineSources = {};
  ctx.associates.forEach(function (line) {
    var key = line.date + '|' + line.name.toUpperCase();
    (lineSources[key] = lineSources[key] || []).push(line);
  });
  function add(candidate) {
    candidate.key = [candidate.view, candidate.date, candidate.side, String(candidate.who || 'STORE').toUpperCase()].join('|');
    if (seen[candidate.key]) return;
    seen[candidate.key] = true;
    out.push(candidate);
  }
  ctx.ledger.forEach(function (row) {
    if (row.grain !== 'daily' || !row.reportDate || !row.scope || DERIVED_LEDGER_SOURCE_.test(row.source)) return;
    var person = row.scope === 'PERSON' ? historyPerson_(row.code, row.name) : { id: '', name: '' };
    var noteKeys = ['CC_Ledger|' + row.key];
    var sha = '';
    if (row.view === 'SNAP_PERSON') {
      (lineSources[row.reportDate + '|' + String(row.name).toUpperCase()] || []).forEach(function (line) {
        noteKeys.push('CC_AssociateDays|' + line.date + '|' + line.source);
        if (!sha) sha = line.sha;
      });
    }
    if (row.view === 'PERQ_STORE' || row.view === 'PERQ_PERSON') noteKeys.push('CC_Closing|PERQ ' + [row.view === 'PERQ_STORE' ? 'store' : 'person', String(row.code || '').toUpperCase(), row.reportDate, row.reportDate].join('|'));
    add({
      date: row.reportDate, view: row.view, scope: row.scope === 'STORE' ? 'Store' : 'Person', who: row.code || row.name, employeeId: person.id, employeeName: person.name,
      side: row.side, sales: row.sales, units: row.units, eligible: row.eligible, attachments: row.attachments, percent: row.percent, customers: null,
      sourceReport: row.source, sourceTab: 'CC_Ledger', importedAt: row.importedAt, noteKeys: noteKeys, sha: sha, status: 'Verified: single-day report',
    });
  });
  Object.keys(ctx.facts).sort().forEach(function (date) {
    STORE_SALES_METRICS_.forEach(function (spec) {
      var value = ctx.facts[date][spec.field];
      if (value === null) return;
      add({ date: date, view: spec.view, scope: 'Store', who: '', employeeId: '', employeeName: '', side: spec.side, sales: value, units: null, eligible: null, attachments: null, percent: null, customers: null,
        sourceReport: spec.source.replace(/ \(.*\)$/, ''), sourceTab: 'CC_Daily', importedAt: '', noteKeys: [], sha: '', status: 'Verified: single-day report' });
    });
  });
  sheet_('CC_Closing').forEach(function (row) {
    var start = isoDate_(row.period_start);
    if (!start || start !== isoDate_(row.period_end)) return;
    var scope = String(row.scope || '');
    var code = String(row.employee_code || '').trim();
    var status = String(row.final || '').toLowerCase() === 'yes' ? 'Verified: single-day report' : 'Unverified: ' + (String(row.note || '') || 'not marked final');
    var customers = numberOrNull_(row.customers);
    var opportunities = numberOrNull_(row.opportunities);
    if (scope === 'store' && !code && customers !== null) {
      add({ date: start, view: 'CUSTOMERS_STORE', scope: 'Store', who: '', employeeId: '', employeeName: '', side: 'written', sales: null, units: null, eligible: null, attachments: null, percent: null, customers: customers,
        sourceReport: String(row.source || ''), sourceTab: 'CC_Closing', importedAt: '', noteKeys: [], sha: '', status: status });
    }
    if (opportunities !== null && (scope === 'store' || scope === 'person')) {
      var person = scope === 'person' ? historyPerson_(code, row.display_name) : { id: '', name: '' };
      add({ date: start, view: scope === 'store' ? 'PERQ_STORE' : 'PERQ_PERSON', scope: scope === 'store' ? 'Store' : 'Person', who: scope === 'store' ? '' : code || String(row.display_name || ''), employeeId: person.id, employeeName: person.name,
        side: '', sales: null, units: null, eligible: opportunities, attachments: null, percent: null, customers: null, sourceReport: String(row.source || ''), sourceTab: 'CC_Closing', importedAt: '',
        noteKeys: ['CC_Closing|PERQ ' + [scope, code.toUpperCase(), start, start].join('|')], sha: '', status: status });
    }
  });
  ctx.associates.forEach(function (line) {
    var person = historyPerson_('', line.name);
    add({ date: line.date, view: 'SNAP_PERSON', scope: 'Person', who: line.name, employeeId: person.id, employeeName: line.name, side: 'written', sales: line.amount, units: null, eligible: null, attachments: null, percent: null, customers: null,
      sourceReport: 'SNAP Written', sourceTab: 'CC_AssociateDays', importedAt: '', noteKeys: ['CC_AssociateDays|' + line.date + '|' + line.source], sha: line.sha, status: 'Verified: single-day report' });
  });
  return out;
}

function historyFigures_(candidate) {
  return [candidate.sales, candidate.units, candidate.eligible, candidate.attachments, candidate.percent, candidate.customers].map(historyCell_);
}

function dailyHistoryRow_(candidate, calendar, sources, archive, notes, now) {
  var figures = historyFigures_(candidate);
  var negative = '';
  figures.forEach(function (value) { if (negative === '' && typeof value === 'number' && value < 0) negative = value; });
  var store = storePeriodContaining_(candidate.date);
  var person = individualPeriodContaining_(candidate.date);
  var type = historyViewType_(candidate.view, candidate.side, candidate.sourceReport);
  var source = sources.byFile[candidate.sourceReport] || (candidate.sha && sources.bySha[candidate.sha]) || sources.byTypeDate[type + '|' + candidate.date] || null;
  var sha = source ? source.sha : candidate.sha;
  var entry = calendar[candidate.scope === 'Store' ? periodKey_('Store', store) : periodKey_('Person', person)];
  var later = [];
  candidate.noteKeys.forEach(function (key) { (notes[key] || []).forEach(function (text) { if (later.indexOf(text) === -1) later.push(text); }); });
  return [candidate.key, candidate.date, periodKey_('Store', store), periodKey_('Person', person), candidate.view, candidate.scope, candidate.employeeId, candidate.employeeName, candidate.side]
    .concat(figures)
    .concat([negative, candidate.status, candidate.sourceReport, candidate.sourceTab, candidate.importedAt, now,
      lastYearDate_(entry, candidate.date), source ? source.file : '', sha || '', sha && archive[sha] ? archive[sha].id : '', later.join('. ')]);
}

function refreshDailyHistory_(ctx, calendar) {
  var width = DAILY_HISTORY_HEADERS_.length;
  var tab = historyTab_(DAILY_HISTORY_TAB_, DAILY_HISTORY_HEADERS_);
  var values = historyRows_(tab, width);
  var index = {};
  var r;
  for (r = 1; r < values.length; r += 1) if (String(values[r][0])) index[String(values[r][0])] = r;
  var sources = historySources_();
  var archive = archiveIndex_();
  var notes = laterReportNotes_();
  var now = historyNow_();
  var appends = [];
  var changed = false;
  var filled = 0;
  dailyHistoryCandidates_(ctx).forEach(function (candidate) {
    var row = dailyHistoryRow_(candidate, calendar, sources, archive, notes, now);
    var at = index[candidate.key];
    if (at === undefined) { appends.push(row); return; }
    var current = values[at];
    var i;
    for (i = DAILY_HISTORY_FIXED_; i < width - 1; i += 1) {
      var replaceable = historyBlank_(current[i]) || (i === DAILY_HISTORY_FIXED_ && /^Pending/.test(String(current[i])));
      if (replaceable && !historyBlank_(row[i]) && historyNorm_(row[i]) !== historyNorm_(current[i])) { current[i] = row[i]; changed = true; filled += 1; }
    }
    var later = String(row[width - 1] || '');
    var differs = [];
    for (i = 9; i <= 14; i += 1) if (historyNorm_(row[i]) !== historyNorm_(current[i])) differs.push(DAILY_HISTORY_HEADERS_[i] + ' ' + (historyBlank_(row[i]) ? 'blank' : row[i]));
    if (differs.length) later = (later ? later + '. ' : '') + candidate.sourceTab + ' now shows ' + differs.join(', ') + '; the figures first recorded for this date are kept';
    if (later && later !== String(current[width - 1] || '')) { current[width - 1] = later; changed = true; }
  });
  if (changed && values.length > 1) tab.getRange(2, DAILY_HISTORY_FIXED_ + 1, values.length - 1, width - DAILY_HISTORY_FIXED_).setValues(values.slice(1).map(function (row) { return row.slice(DAILY_HISTORY_FIXED_, width); }));
  appends.sort(function (a, b) { return a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : (a[1] < b[1] ? -1 : 1); });
  if (appends.length) tab.getRange(values.length + 1, 1, appends.length, width).setValues(appends);
  return { added: appends.length, filled: filled, total: values.length - 1 + appends.length };
}

/* ---------- goal history ---------- */

function historyGoal_(ctx, track, period, metricKey, open) {
  var definition = metricDefinition_(metricKey);
  if (!definition.goalKey) return { goal: null, basis: 'No goal for this metric' };
  var monthKey = definition.goalKey + '_' + period.year + '-' + pad2_(period.month);
  if (!configBlank_(ctx.config, monthKey)) return { goal: fineNumber_(ctx.config[monthKey]), basis: 'CC_Config ' + monthKey };
  if (definition.goalKey === 'written_goal' || definition.goalKey === 'delivered_goal') {
    var goals = storeSalesGoals_(ctx.config, period);
    var goal = definition.goalKey === 'written_goal' ? goals.written : goals.delivered;
    return { goal: goal, basis: metricGoalEffective_(definition, ctx.config, period) };
  }
  if (!open) return { goal: null, basis: 'Not on file: the month ended before its goal was captured and CC_Config has no ' + monthKey };
  return { goal: metricGoal_(metricKey, ctx.config), basis: (configBlank_(ctx.config, definition.goalKey) ? 'Official default (CC_Config ' + definition.goalKey + ' blank)' : 'CC_Config ' + definition.goalKey) + ', captured while the ' + track.toLowerCase() + ' month was open' };
}

function refreshGoalHistory_(ctx, calendar) {
  var width = GOAL_HISTORY_HEADERS_.length;
  var tab = historyTab_(GOAL_HISTORY_TAB_, GOAL_HISTORY_HEADERS_);
  var values = historyRows_(tab, width);
  var index = {};
  var r;
  for (r = 1; r < values.length; r += 1) if (String(values[r][0])) index[String(values[r][0])] = r;
  var withData = monthEndPeriodsWithData_(ctx);
  var current = {};
  current[periodKey_('Store', storePeriodContaining_(ctx.today))] = true;
  current[periodKey_('Person', individualPeriodContaining_(ctx.today))] = true;
  var now = historyNow_();
  var appends = [];
  var changed = false;
  var goals = {};
  Object.keys(calendar).sort().forEach(function (key) {
    var entry = calendar[key];
    if (!withData[key] && !current[key]) return;
    var open = entry.period.end >= ctx.today;
    HISTORY_GOAL_METRICS_.forEach(function (spec) {
      if (spec[0] !== entry.track) return;
      var goalKey = key + '|' + spec[1];
      var at = index[goalKey];
      var row = at === undefined ? null : values[at];
      if (row && String(row[9]) === 'Locked') { goals[goalKey] = { goal: row[7], basis: String(row[8]) }; return; }
      var found = historyGoal_(ctx, entry.track, entry.period, spec[2], open);
      var definition = metricDefinition_(spec[2]);
      var fresh = [goalKey, key, entry.track, entry.period.start, entry.period.end, definition.goalKey || '', spec[2], historyCell_(found.goal), found.basis, open ? 'Open' : 'Locked', now, open ? '' : now];
      if (!row) {
        appends.push(fresh);
        goals[goalKey] = { goal: fresh[7], basis: fresh[8] };
        return;
      }
      // An open row keeps the goal captured while the month ran unless a month-specific goal now exists.
      var replace = open ? (historyNorm_(row[7]) !== historyNorm_(fresh[7]) || String(row[8]) !== fresh[8]) : (found.goal !== null && historyNorm_(row[7]) !== historyNorm_(fresh[7]));
      if (replace) {
        archiveReplaced_(GOAL_HISTORY_TAB_, goalKey, row, 'goal ' + historyCell_(found.goal) + ' (' + found.basis + ')', 'The goal changed while the month was open. The earlier goal is kept here.');
        row[7] = fresh[7];
        row[8] = fresh[8];
        row[10] = now;
        changed = true;
      }
      if (!open) { row[9] = 'Locked'; row[11] = now; changed = true; }
      goals[goalKey] = { goal: row[7], basis: String(row[8]) };
    });
  });
  if (changed && values.length > 1) tab.getRange(2, 1, values.length - 1, width).setValues(values.slice(1));
  if (appends.length) tab.getRange(values.length + 1, 1, appends.length, width).setValues(appends);
  return goals;
}

/* ---------- last year ---------- */

function lastYearRows_() {
  return sheet_(LAST_YEAR_TAB_).map(function (row) {
    return {
      start: isoDate_(row.ly_start), end: isoDate_(row.ly_end), track: String(row.track || '').trim().toLowerCase(), metric: String(row.metric || '').trim(),
      side: String(row.side || '').trim().toLowerCase(), employeeId: String(row.employee_id || '').trim(), person: String(row.person || '').trim(),
      value: numberOrNull_(row.value), source: String(row.source_report || ''), verifiedBy: String(row.verified_by || '').trim(),
    };
  });
}

/** SNAP is compared with SNAP and NWDSR with NWDSR; a figure from the other report is never used. */
function lastYearSameReport_(metric, source) {
  if (/^NWDSR/.test(metric)) return /NWDSR/i.test(source);
  if (/^SNAP/.test(metric)) return /SNAP/i.test(source) && !/NWDSR/i.test(source);
  return true;
}

function lastYearFor_(entry, lyRows, line) {
  if (!entry) return { value: 'Pending', basis: 'No period calendar entry' };
  if (!entry.ly.confirmed) return { value: 'Pending', basis: 'Last-year period ' + entry.ly.status };
  var rejected = false;
  var match = null;
  lyRows.forEach(function (row) {
    if (match || row.start !== entry.ly.start || row.end !== entry.ly.end || row.track !== line.track.toLowerCase() || row.metric !== line.metric) return;
    if ((row.side || '') !== String(line.side || '').toLowerCase()) return;
    if (line.track === 'Person') {
      var same = (row.employeeId && line.employeeId && row.employeeId.toLowerCase() === String(line.employeeId).toLowerCase()) || (row.person && rowMatchesPerson_({ code: row.employeeId, name: row.person }, line.person));
      if (!same) return;
    } else if (row.person || row.employeeId) return;
    if (!lastYearSameReport_(line.metric, row.source)) { rejected = true; return; }
    if (row.value === null || !row.verifiedBy) return;
    match = row;
  });
  if (match) return { value: match.value, basis: 'CC_LastYear ' + match.source + ' ' + entry.ly.start + ' to ' + entry.ly.end + ', verified by ' + match.verifiedBy };
  return { value: 'Pending', basis: 'No verified last-year report for ' + entry.ly.start + ' to ' + entry.ly.end + ' is on file' + (rejected ? '; a figure from a different report was not used' : '') };
}

/* ---------- monthly history ---------- */

function monthlyHistoryLines_(ctx, entry, goals, lyRows) {
  var people = {};
  if (entry.track === 'Person') monthEndPeople_(ctx, entry.period).forEach(function (person) { people[person.name] = person; });
  return monthEndRowsFor_(ctx, entry.track, entry.period).map(function (cells) {
    var row = {};
    MONTH_END_HEADERS_.forEach(function (name, i) { row[name] = cells[i]; });
    var person = people[row.person] || null;
    var goal = goals[entry.key + '|' + row.metric] || { goal: '', basis: 'No goal for this metric' };
    var ly = lastYearFor_(entry, lyRows, { track: entry.track, metric: row.metric, side: row.side, employeeId: row.employee_id, person: row.person });
    var complete = row.verified_through === entry.period.end;
    var settled = typeof row.official_final === 'number' && complete;
    var aged = historyDayGap_(entry.period.end, ctx.today) > MONTH_LOCK_DAYS_;
    return {
      key: [entry.key, row.metric, row.side, row.person].join('|'),
      lock: settled || aged,
      cells: [[entry.key, row.metric, row.side, row.person].join('|'), entry.key, entry.track, entry.period.start, entry.period.end, row.metric, row.side, row.employee_id, row.person,
        person ? person.position : '', person ? person.status : '', row.unit, row.verified_mtd, row.verified_through,
        'Daily records: ' + row.daily_record_dates + '. Cumulative snapshot: ' + row.snapshot_coverage, row.qualified, row.sold, row.mtd_basis, row.daily_records_total, row.missing_or_unverified,
        row.official_final, row.official_basis, row.variance, row.explanation, historyCell_(goal.goal), goal.basis, ly.value, ly.basis],
    };
  });
}

function monthlyVariance_(row, finalValue) {
  if (historyNorm_(row[13]) !== historyNorm_(row[4]) || typeof finalValue !== 'number') return '';
  var verified = Number(historyNorm_(row[12]));
  if (historyBlank_(row[12]) || !isFinite(verified)) return '';
  return String(row[11]) === 'percent' ? monthEndRound_((finalValue - verified) * 100, 2) : monthEndRound_(finalValue - verified, String(row[11]) === 'count' ? 4 : 2);
}

function refreshMonthlyHistory_(ctx, calendar, goals) {
  var width = MONTHLY_HISTORY_HEADERS_.length;
  var tab = historyTab_(MONTHLY_HISTORY_TAB_, MONTHLY_HISTORY_HEADERS_);
  var values = historyRows_(tab, width);
  var index = {};
  var finalByPeriod = {};
  var r;
  for (r = 1; r < values.length; r += 1) {
    var key = String(values[r][0]);
    if (!key) continue;
    index[key] = r;
    var period = String(values[r][1]);
    finalByPeriod[period] = finalByPeriod[period] !== false && String(values[r][28]) === 'Final';
  }
  var lyRows = lastYearRows_();
  var withData = monthEndPeriodsWithData_(ctx);
  var now = historyNow_();
  var appends = [];
  var changed = false;
  var counts = { added: 0, updated: 0, locked: 0, filledAfterLock: 0, periods: [] };
  Object.keys(calendar).sort().forEach(function (periodKey) {
    var entry = calendar[periodKey];
    if (entry.period.end >= ctx.today || !withData[periodKey]) return;
    if (finalByPeriod[periodKey] && historyDayGap_(entry.period.end, ctx.today) > MONTH_RECHECK_DAYS_) return;
    counts.periods.push(periodKey);
    monthlyHistoryLines_(ctx, entry, goals, lyRows).forEach(function (line) {
      var status = line.lock ? 'Final' : 'Open: month ended; awaiting a matching official final with complete daily coverage, or ' + MONTH_LOCK_DAYS_ + ' days after the month';
      var at = index[line.key];
      if (at === undefined) {
        appends.push(line.cells.concat([status, now, now, line.lock ? now : '', '']));
        counts.added += 1;
        if (line.lock) counts.locked += 1;
        return;
      }
      var row = values[at];
      if (String(row[28]) === 'Final') {
        var filled = false;
        var filledNote = '';
        if (/^(Pending)?$/.test(historyNorm_(row[12])) && typeof line.cells[12] === 'number') {
          archiveReplaced_(MONTHLY_HISTORY_TAB_, line.key, row.slice(), 'filled ' + ctx.today, 'The month locked before any verified figure was on file. The row as it was is kept here.');
          for (var c = 12; c <= 19; c += 1) row[c] = line.cells[c];
          row[22] = monthlyVariance_(row, row[20]);
          filledNote = 'Filled ' + ctx.today + ' from reports received after the month locked: verified_total ' + line.cells[12] + ' through ' + line.cells[13];
          filled = true;
        }
        if (/^Pending$/.test(historyNorm_(row[20])) && typeof line.cells[20] === 'number') {
          row[20] = line.cells[20];
          row[21] = line.cells[21];
          row[22] = monthlyVariance_(row, line.cells[20]);
          filled = true;
        }
        if (historyBlank_(row[23]) && !historyBlank_(line.cells[23])) { row[23] = line.cells[23]; filled = true; }
        if (/^Pending$/.test(historyNorm_(row[26])) && typeof line.cells[26] === 'number') { row[26] = line.cells[26]; row[27] = line.cells[27]; filled = true; }
        var differs = [12, 13, 20].filter(function (i) { return i !== 20 || typeof line.cells[20] === 'number'; }).filter(function (i) { return historyNorm_(row[i]) !== historyNorm_(line.cells[i]); });
        var note = differs.length ? 'Recalculated ' + ctx.today + ': ' + differs.map(function (i) { return MONTHLY_HISTORY_HEADERS_[i] + ' ' + line.cells[i]; }).join(', ') + '. The locked figures are kept' : filledNote;
        if (note && note.replace(/^Recalculated \S+: /, '') !== String(row[32] || '').replace(/^Recalculated \S+: /, '')) { row[32] = note; filled = true; }
        if (filled) { row[30] = now; changed = true; counts.filledAfterLock += 1; }
        return;
      }
      var same = line.cells.every(function (cell, i) { return historyNorm_(cell) === historyNorm_(row[i]); });
      if (!same) {
        archiveReplaced_(MONTHLY_HISTORY_TAB_, line.key, row, 'recalculated ' + ctx.today, 'The month was not locked yet. The earlier month-end figures are kept here.');
        line.cells.forEach(function (cell, i) { row[i] = cell; });
        row[30] = now;
        changed = true;
        counts.updated += 1;
      }
      if (line.lock) { row[28] = 'Final'; row[31] = now; changed = true; counts.locked += 1; }
      else if (String(row[28]) !== status) { row[28] = status; changed = true; }
    });
  });
  if (changed && values.length > 1) tab.getRange(2, 1, values.length - 1, width).setValues(values.slice(1));
  if (appends.length) tab.getRange(values.length + 1, 1, appends.length, width).setValues(appends);
  return counts;
}

/* ---------- refresh ---------- */

function ensureHistoryTabs_() {
  historyTab_(LAST_YEAR_TAB_, LAST_YEAR_HEADERS_);
  sourceArchiveTab_();
}

/** Calendar, daily register, goals and completed months, in that order. Nothing already recorded is rewritten. */
function refreshHistory_() {
  ensureMonthEndNotes_();
  ensureHistoryTabs_();
  var ctx = monthEndContext_(todayNy_());
  var calendar = refreshPeriodCalendar_(ctx);
  var daily = refreshDailyHistory_(ctx, calendar);
  var goals = refreshGoalHistory_(ctx, calendar);
  var monthly = refreshMonthlyHistory_(ctx, calendar, goals);
  return { calendar: Object.keys(calendar).length, daily: daily, goals: Object.keys(goals).length, monthly: monthly };
}
