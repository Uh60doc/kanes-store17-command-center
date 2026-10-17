/**
 * Backups and restore drills, in the owner's Google Drive under "Store 17 Command Center Backups":
 *
 *   Spreadsheet copies   a full copy of the production workbook: every tab, so CC_Config, the goal history, the import
 *                        logs (CC_Imports, CC_Uploads, CC_Exceptions), the daily and monthly history and the evaluation
 *                        records. Each copy is compared tab by tab with the workbook it came from.
 *   Report originals     a copy of every archived report file (CC_SourceArchive), made once per file.
 *   Evaluation files     a copy of every approved evaluation file (CC_EvalArchive), made once per file.
 *   Settings             the script settings that are not in the workbook, without passwords or sessions.
 *   Restore drills       a copy of the latest backup, checked in place of production. Production is never written.
 *
 * CC_Backups logs every backup and drill; CC_BackupFiles lists every file copied.
 */

var BACKUP_ROOT_NAME_ = 'Store 17 Command Center Backups';
var BACKUPS_TAB_ = 'CC_Backups';
var BACKUP_HEADERS_ = ['run_at', 'kind', 'trigger', 'status', 'file_name', 'file_id', 'tabs', 'rows', 'digest', 'data_version', 'files_copied', 'files_pending', 'seconds', 'note', 'tab_digests'];
var BACKUP_FILES_TAB_ = 'CC_BackupFiles';
var BACKUP_FILE_HEADERS_ = ['copied_at', 'register', 'key', 'file_name', 'source_file_id', 'backup_file_id'];
var BACKUP_KEEP_ = 30;
var BACKUP_DRILL_DAYS_ = 7;
// Script settings that are secrets or per-session state stay out of the settings backup.
var BACKUP_SECRET_KEYS_ = /^(hash_|salt_|epoch_|BOOTSTRAP_|sessions$|mail_)/;
var BACKUP_PAGES_ = ['home', 'daily', 'closing', 'people', 'morning', 'bedding'];

/** CC_Exceptions shows on Home, so a recorded backup problem retires the cached pages. */
function backupProblem_(message) {
  appendException_('Update Failed', message);
  if (typeof markDataChanged_ === 'function') markDataChanged_('backup problem');
}

function backupFolder_(name) {
  var props = PropertiesService.getScriptProperties();
  var open = function (key, folderName, parent) {
    var id = props.getProperty(key);
    if (id) {
      try { return DriveApp.getFolderById(id); } catch (error) { id = ''; }
    }
    var folder = parent ? parent.createFolder(folderName) : DriveApp.createFolder(folderName);
    props.setProperty(key, folder.getId());
    return folder;
  };
  var root = open('backup_root_folder', BACKUP_ROOT_NAME_, null);
  return name ? open('backup_folder_' + name, name, root) : root;
}

function md5Hex_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8).map(function (part) {
    var value = (part + 256) % 256;
    return (value < 16 ? '0' : '') + value.toString(16);
  }).join('');
}

/**
 * Rows and a digest for every tab. A formula cell is compared by its formula, so a copy that recalculates TODAY() on a
 * later day still matches; every other cell by its value.
 */
function tabDigests_(spreadsheet) {
  var out = {};
  spreadsheet.getSheets().forEach(function (sheet) {
    var range = sheet.getDataRange();
    var values = range.getValues();
    var formulas = range.getFormulas ? range.getFormulas() : [];
    var cells = values.map(function (row, r) {
      return row.map(function (value, c) {
        var formula = formulas[r] && formulas[r][c];
        return formula ? '=' + formula : value;
      });
    });
    var rows = values.filter(function (row) { return row.some(function (cell) { return cell !== '' && cell !== null; }); }).length;
    out[sheet.getName()] = { rows: rows, digest: md5Hex_(JSON.stringify(cells)) };
  });
  return out;
}

function digestTotals_(digests) {
  var names = Object.keys(digests).sort();
  return {
    tabs: names.length,
    rows: names.reduce(function (total, name) { return total + digests[name].rows; }, 0),
    digest: md5Hex_(names.map(function (name) { return name + ':' + digests[name].digest; }).join('|')),
  };
}

/** Tabs that differ between two digests, with a short reason for each. */
function digestDifferences_(expected, actual) {
  var out = [];
  Object.keys(expected).sort().forEach(function (name) {
    if (!actual[name]) out.push(name + ' is missing');
    else if (actual[name].digest !== expected[name].digest) out.push(name + ' differs (' + expected[name].rows + ' rows expected, ' + actual[name].rows + ' found)');
  });
  Object.keys(actual).sort().forEach(function (name) {
    if (!expected[name]) out.push(name + ' is extra');
  });
  return out;
}

function backupStamp_() {
  return Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HHmm');
}

function backupLog_(row) {
  var tab = qualityTab_(BACKUPS_TAB_, BACKUP_HEADERS_);
  tab.appendRow(BACKUP_HEADERS_.map(function (key) { return row[key] === undefined ? '' : row[key]; }));
}

function backupRows_() {
  var text = function (value) { return value instanceof Date ? value.toISOString() : String(value === null || value === undefined ? '' : value); };
  return sheet_(BACKUPS_TAB_).map(function (row, i) {
    var record = { sheetRow: i + 2 };
    BACKUP_HEADERS_.forEach(function (key) { record[key] = text(row[key]); });
    return record;
  });
}

/** The script settings that live outside the workbook: folder IDs, one-time flags and the quality baseline. */
function settingsSnapshot_() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var kept = {};
  Object.keys(props).sort().forEach(function (key) {
    if (!BACKUP_SECRET_KEYS_.test(key)) kept[key] = props[key];
  });
  var triggers = [];
  try {
    ScriptApp.getProjectTriggers().forEach(function (trigger) { triggers.push(trigger.getHandlerFunction()); });
  } catch (error) { triggers.push('not readable: ' + String(error && error.message ? error.message : error)); }
  return { saved_at: new Date().toISOString(), app_version: APP_VERSION_, spreadsheet_id: SPREADSHEET_ID_, config: sheet_('CC_Config'), script_properties: kept, triggers: triggers, left_out: 'Passwords, password salts, sign-in sessions and email send markers are not backed up. Reset passwords from the app after a restore.' };
}

/**
 * The workbook copy. Runs inside the script lock so no import writes between the digest of production and the copy.
 * Throws when production cannot be copied; a copy that differs is logged as Needs Review.
 */
function backupSpreadsheet_(trigger) {
  var started = Date.now();
  var live = book_();
  var expected = tabDigests_(live);
  var name = 'Command Center backup ' + backupStamp_();
  var copy = DriveApp.getFileById(SPREADSHEET_ID_).makeCopy(name, backupFolder_('Spreadsheet copies'));
  if (copy.getId() === SPREADSHEET_ID_) throw new Error('The backup copy has the production ID. Nothing was changed.');
  var actual = tabDigests_(SpreadsheetApp.openById(copy.getId()));
  var differences = digestDifferences_(expected, actual);
  var totals = digestTotals_(actual);
  return {
    run_at: new Date().toISOString(),
    kind: 'Spreadsheet',
    trigger: trigger,
    status: differences.length ? 'Needs Review' : 'Verified',
    file_name: name,
    file_id: copy.getId(),
    tabs: totals.tabs,
    rows: totals.rows,
    digest: totals.digest,
    data_version: dataVersion_(),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    note: differences.length ? 'The copy differs from production: ' + differences.join('; ') + '.' : 'All ' + totals.tabs + ' tabs (' + totals.rows + ' rows) match production cell for cell.',
    tab_digests: JSON.stringify(actual),
  };
}

/** Files the registers point to: archived report originals and approved evaluation files. */
function backupFileList_() {
  var files = [];
  sheet_(SOURCE_ARCHIVE_TAB_).forEach(function (row) {
    var id = String(row.drive_file_id || '');
    if (id) files.push({ register: SOURCE_ARCHIVE_TAB_, key: String(row.sha256 || id), name: String(row.file_name || ''), id: id, folder: 'Report originals' });
  });
  sheet_('CC_EvalArchive').forEach(function (row) {
    var id = String(row.file_id || '');
    if (id) files.push({ register: 'CC_EvalArchive', key: String(row.sha256 || id), name: String(row.file_name || ''), id: id, folder: 'Evaluation files' });
  });
  return files;
}

/** Copies each registered file once. Stops at the time budget; the next run carries on. */
function backupFiles_(deadline) {
  var done = {};
  sheet_(BACKUP_FILES_TAB_).forEach(function (row) { done[String(row.register) + '|' + String(row.key)] = true; });
  var files = backupFileList_();
  var pending = files.filter(function (file) {
    if (done[file.register + '|' + file.key]) return false;
    done[file.register + '|' + file.key] = true;
    return true;
  });
  var copied = 0;
  var failed = [];
  var tab = pending.length ? qualityTab_(BACKUP_FILES_TAB_, BACKUP_FILE_HEADERS_) : null;
  var i;
  for (i = 0; i < pending.length && Date.now() < deadline; i += 1) {
    var file = pending[i];
    try {
      var copy = DriveApp.getFileById(file.id).makeCopy(file.key.slice(0, 8) + ' ' + file.name, backupFolder_(file.folder));
      tab.appendRow([new Date().toISOString(), file.register, file.key, file.name, file.id, copy.getId()]);
      copied += 1;
    } catch (error) {
      failed.push(file.name + ' (' + String(error && error.message ? error.message : error) + ')');
    }
  }
  return { copied: copied, pending: pending.length - copied, total: files.length, failed: failed };
}

/** Keeps the newest BACKUP_KEEP_ workbook copies and the first copy of every month; older copies go to Drive trash. */
function pruneBackups_() {
  var rows = backupRows_().filter(function (row) { return row.kind === 'Spreadsheet' && (row.status === 'Verified' || row.status === 'Needs Review'); });
  var keep = {};
  rows.slice(-BACKUP_KEEP_).forEach(function (row) { keep[row.file_id] = true; });
  var months = {};
  rows.forEach(function (row) {
    var month = row.run_at.slice(0, 7);
    if (!months[month]) { months[month] = true; keep[row.file_id] = true; }
  });
  var retired = 0;
  var tab = book_().getSheetByName(BACKUPS_TAB_);
  rows.forEach(function (row) {
    if (keep[row.file_id] || row.file_id === SPREADSHEET_ID_) return;
    try { DriveApp.getFileById(row.file_id).setTrashed(true); } catch (error) { /* already removed by hand */ }
    tab.getRange(row.sheetRow, BACKUP_HEADERS_.indexOf('status') + 1).setValue('Retired');
    retired += 1;
  });
  return retired;
}

/** One backup: the workbook copy, the settings, the files not copied yet, then retention. */
function runBackup_(trigger, budgetMs) {
  var started = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('An import is running. Try the backup again in a minute.');
  var result;
  try {
    result = backupSpreadsheet_(trigger);
  } finally {
    lock.releaseLock();
  }
  var notes = [result.note];
  try {
    backupFolder_('Settings').createFile('Command Center settings ' + backupStamp_() + '.json', JSON.stringify(settingsSnapshot_(), null, 1), 'application/json');
  } catch (error) {
    notes.push('The settings file could not be saved: ' + String(error && error.message ? error.message : error) + '.');
  }
  var files = backupFiles_(started + (budgetMs || 240000));
  result.files_copied = files.copied;
  result.files_pending = files.pending;
  notes.push(files.copied + ' file(s) copied this run; ' + (files.total - files.pending) + ' of ' + files.total + ' archived report and evaluation files are backed up' + (files.pending ? ', ' + files.pending + ' left for the next run' : '') + '.');
  if (files.failed.length) notes.push('Could not copy: ' + files.failed.slice(0, 5).join('; ') + '.');
  result.note = notes.join(' ');
  result.seconds = Math.round((Date.now() - started) / 100) / 10;
  backupLog_(result);
  try { result.retired = pruneBackups_(); } catch (error) { backupProblem_('Old backups could not be retired. ' + String(error && error.message ? error.message : error)); }
  if (result.status !== 'Verified') backupProblem_('Backup ' + result.file_name + ' needs review: ' + result.note);
  if (files.failed.length && typeof queueNotice_ === 'function') queueNotice_('Backup could not copy ' + files.failed.length + ' archived file(s): ' + files.failed.slice(0, 3).join('; ') + '.');
  delete result.tab_digests;
  return result;
}

/** Runs fn with every read and write pointed at another spreadsheet, then puts production back. */
function withBook_(spreadsheet, fn) {
  var saved = { book: BOOK_, memo: READ_MEMO_, roster: rosterCache_, archive: sourceArchiveIndex_, evidence: archiveEvidenceCache_, quiet: UPLOAD_QUIET_ };
  BOOK_ = spreadsheet;
  READ_MEMO_ = null;
  rosterCache_ = null;
  sourceArchiveIndex_ = null;
  archiveEvidenceCache_ = null;
  // No email or notice is raised from a copy.
  UPLOAD_QUIET_ = true;
  try {
    return fn();
  } finally {
    BOOK_ = saved.book;
    READ_MEMO_ = saved.memo;
    rosterCache_ = saved.roster;
    sourceArchiveIndex_ = saved.archive;
    archiveEvidenceCache_ = saved.evidence;
    UPLOAD_QUIET_ = saved.quiet;
  }
}

function drillPages_(payload) {
  var out = {};
  var quiet = UPLOAD_QUIET_;
  // A page built for the comparison raises no notice.
  UPLOAD_QUIET_ = true;
  try {
    BACKUP_PAGES_.forEach(function (name) {
      beginPageRead_();
      try {
        var reply = JSON.parse(JSON.stringify(route_(name, payload)));
        delete reply.updated;
        out[name] = JSON.stringify(reply);
      } catch (error) {
        out[name] = 'ERROR ' + String(error && error.message ? error.message : error);
      } finally {
        endPageRead_();
      }
    });
  } finally {
    UPLOAD_QUIET_ = quiet;
  }
  return out;
}

/**
 * Restore drill. Copies the latest backup to a scratch workbook, checks every tab against the digest taken when the
 * backup was made, builds the dashboard pages and runs the quality checks from the scratch copy. When production has
 * not changed since the backup, each page must match production exactly. Production and the backup are only read.
 */
function runRestoreDrill_(trigger) {
  var started = Date.now();
  var backups = backupRows_().filter(function (row) { return row.kind === 'Spreadsheet' && row.status === 'Verified'; });
  var backup = backups[backups.length - 1];
  if (!backup) throw new Error('No verified backup is on file yet. Run a backup first.');
  if (backup.file_id === SPREADSHEET_ID_) throw new Error('The backup on file has the production ID. The drill did not run.');
  var name = 'Restore drill ' + backupStamp_() + ' from ' + backup.file_name;
  var scratch = DriveApp.getFileById(backup.file_id).makeCopy(name, backupFolder_('Restore drills'));
  if (scratch.getId() === SPREADSHEET_ID_ || scratch.getId() === backup.file_id) throw new Error('The scratch copy is not a new file. The drill stopped.');
  var copy = SpreadsheetApp.openById(scratch.getId());
  var problems = [];
  var expected = JSON.parse(backup.tab_digests || '{}');
  var actual = tabDigests_(copy);
  var differences = digestDifferences_(expected, actual);
  if (differences.length) problems.push('Restored tabs differ from the backup: ' + differences.join('; '));
  var totals = digestTotals_(actual);
  var payload = { session: { role: 'admin', username: 'restore drill' } };
  var restored = withBook_(copy, function () {
    var pages = drillPages_(payload);
    var ctx = qualityContext_(todayNy_());
    var checks = qualityChecks_(ctx, dayPackages_(ctx));
    return { pages: pages, checks: checks };
  });
  BACKUP_PAGES_.forEach(function (page) {
    if (/^ERROR /.test(restored.pages[page])) problems.push('The ' + page + ' page did not build from the restored copy: ' + restored.pages[page].slice(6));
  });
  var compared = '';
  if (dataVersion_() === backup.data_version) {
    var live = drillPages_(payload);
    var unequal = BACKUP_PAGES_.filter(function (page) { return live[page] !== restored.pages[page]; });
    if (unequal.length) problems.push('Built from the restored copy, these pages differ from production: ' + unequal.join(', '));
    compared = BACKUP_PAGES_.length - unequal.length + ' of ' + BACKUP_PAGES_.length + ' dashboard pages built from the restored copy are identical to production (' + BACKUP_PAGES_.join(', ') + ').';
  } else {
    compared = 'Production has new data since this backup, so the pages were built from the restored copy and checked for errors only.';
  }
  var counts = { PASS: 0, FLAG: 0, NOTE: 0 };
  restored.checks.forEach(function (check) { counts[check.status] = (counts[check.status] || 0) + 1; });
  var row = {
    run_at: new Date().toISOString(),
    kind: 'Restore drill',
    trigger: trigger,
    status: problems.length ? 'Failed' : 'Passed',
    file_name: name,
    file_id: scratch.getId(),
    tabs: totals.tabs,
    rows: totals.rows,
    digest: totals.digest,
    data_version: backup.data_version,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    note: (problems.length ? problems.join('. ') + '. ' : 'All ' + totals.tabs + ' tabs (' + totals.rows + ' rows) restored from ' + backup.file_name + ' match the backup cell for cell. ') + compared + ' Quality checks on the restored copy: ' + counts.PASS + ' PASS, ' + counts.FLAG + ' FLAG, ' + counts.NOTE + ' NOTE. Production was not written.',
  };
  backupLog_(row);
  // Only the latest drill copy is kept for inspection.
  backupRows_().filter(function (item) { return item.kind === 'Restore drill' && item.file_id && item.file_id !== row.file_id && item.status !== 'Retired'; }).forEach(function (item) {
    try { DriveApp.getFileById(item.file_id).setTrashed(true); } catch (error) { /* already removed */ }
    book_().getSheetByName(BACKUPS_TAB_).getRange(item.sheetRow, BACKUP_HEADERS_.indexOf('status') + 1).setValue('Retired');
  });
  if (problems.length) backupProblem_('Restore drill failed: ' + row.note);
  return row;
}

/** Nightly: a backup, and a restore drill when the last one is a week old. */
function scheduledBackup_() {
  var started = Date.now();
  try {
    runBackup_('nightly', 240000);
  } catch (error) {
    backupProblem_('The nightly backup did not run. ' + String(error && error.message ? error.message : error));
    if (typeof queueNotice_ === 'function') queueNotice_('The nightly backup did not run: ' + String(error && error.message ? error.message : error));
    return;
  }
  var drills = backupRows_().filter(function (row) { return row.kind === 'Restore drill'; });
  var last = drills.length ? drills[drills.length - 1].run_at.slice(0, 10) : '';
  if ((!last || last <= shiftDate_(todayNy_(), -BACKUP_DRILL_DAYS_)) && Date.now() - started < 150000) {
    try { runRestoreDrill_('weekly'); } catch (error) { backupProblem_('The weekly restore drill did not run. ' + String(error && error.message ? error.message : error)); }
  }
}

function ensureBackupTrigger_() {
  var found = false;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'scheduledBackup_') found = true;
  });
  if (!found) ScriptApp.newTrigger('scheduledBackup_').timeBased().everyDays(1).atHour(2).create();
}

/** Admin "Back up now" and "Test restore". */
function runBackupRoute_(payload) {
  var result = payload.mode === 'drill' ? runRestoreDrill_('manual by ' + payload.session.role) : runBackup_('manual by ' + payload.session.role, 150000);
  try { ensureBackupTrigger_(); } catch (error) { result.trigger_note = 'The nightly backup trigger could not be installed: ' + String(error && error.message ? error.message : error); }
  return { result: result, health: health_(payload) };
}

function backupHealth_() {
  var rows = backupRows_();
  var copies = rows.filter(function (row) { return row.kind === 'Spreadsheet'; });
  var drills = rows.filter(function (row) { return row.kind === 'Restore drill'; });
  var done = sheet_(BACKUP_FILES_TAB_).length;
  var strip = function (row) { return { at: row.run_at, kind: row.kind, trigger: row.trigger, status: row.status, name: row.file_name, tabs: row.tabs, rows: row.rows, seconds: row.seconds, note: row.note }; };
  var folderId = typeof PropertiesService === 'undefined' ? '' : PropertiesService.getScriptProperties().getProperty('backup_root_folder') || '';
  return {
    folder: folderId ? 'https://drive.google.com/drive/folders/' + folderId : '',
    latest: copies.length ? strip(copies[copies.length - 1]) : null,
    lastVerified: (copies.filter(function (row) { return row.status === 'Verified'; }).pop() || {}).run_at || '',
    drill: drills.length ? strip(drills[drills.length - 1]) : null,
    kept: copies.filter(function (row) { return row.status === 'Verified' || row.status === 'Needs Review'; }).length,
    filesBackedUp: done,
    recent: rows.slice(-6).reverse().map(strip),
  };
}
