/**
 * CC_DevLog — simple development version and progress tracking.
 *
 * The General Manager opens the Command Center Google Sheet remotely and reads this tab.
 * Newest assignment is on row 2, directly under the header.
 *
 * Statuses (only these four): QUEUED, STARTED, COMPLETED, BLOCKED.
 * Daily report imports and routine spreadsheet calculations do not add versions.
 * A development version in this tab is not live until that change is deployed.
 *
 * Future Cursor development tasks, after this tracker is installed:
 *   var started = startDevTask('Short description', 'optional note');
 *   finishDevTask(started.taskNumber, 'Tested successfully');
 *   blockDevTask(started.taskNumber, 'Brief reason');
 *
 * Preferred write path (admin session on the deployed web app):
 *   google.script.run.dispatch('recordDevLog', { action: 'start', description: '...', notes: '...' });
 *   google.script.run.dispatch('recordDevLog', { action: 'finish', taskNumber: 1, notes: '...' });
 *   google.script.run.dispatch('recordDevLog', { action: 'block', taskNumber: 1, notes: 'Brief reason' });
 *
 * clasp Execution API (`clasp run`) is not enabled on this project. Do not treat a failed run as a sheet update.
 * If a write fails, the function throws. Report that problem instead of claiming the log was updated.
 * Do not store credentials in this tab.
 */

var DEVLOG_TAB_ = 'CC_DevLog';
var DEVLOG_HEADERS_ = ['Version', 'Task Number', 'Task Description', 'Status', 'Last Updated (Eastern Time)', 'Notes'];
var DEVLOG_STATUSES_ = { QUEUED: true, STARTED: true, COMPLETED: true, BLOCKED: true };
/** Software version already on CC_Config / the live app before this tracker. Next assignment is 1.0.1. */
var DEVLOG_BASE_VERSION_ = '1.0.0';

function ensureDevLogTab_() {
  forgetRead_(DEVLOG_TAB_);
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(DEVLOG_TAB_);
  if (!tab) {
    tab = spreadsheet.insertSheet(DEVLOG_TAB_);
    tab.getRange(1, 1, 1, DEVLOG_HEADERS_.length).setValues([DEVLOG_HEADERS_]);
    try {
      tab.setFrozenRows(1);
      tab.setColumnWidth(1, 80);
      tab.setColumnWidth(2, 110);
      tab.setColumnWidth(3, 280);
      tab.setColumnWidth(4, 120);
      tab.setColumnWidth(5, 220);
      tab.setColumnWidth(6, 420);
    } catch (ignore) {}
    return tab;
  }
  var head = String(tab.getRange(1, 1).getValue() || '');
  if (head !== DEVLOG_HEADERS_[0]) tab.getRange(1, 1, 1, DEVLOG_HEADERS_.length).setValues([DEVLOG_HEADERS_]);
  return tab;
}

function devLogNowEt_() {
  var now = new Date();
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    try {
      return Utilities.formatDate(now, 'America/New_York', 'M/d/yyyy h:mm a');
    } catch (ignore) {}
  }
  return now.toISOString();
}

function parseDevPatch_(version) {
  var match = String(version || '').trim().match(/^1\.0\.(\d+)$/);
  return match ? Number(match[1]) : null;
}

function nextDevVersion_(rows) {
  var max = parseDevPatch_(DEVLOG_BASE_VERSION_);
  if (max === null) max = 0;
  (rows || []).forEach(function (row) {
    var patch = parseDevPatch_(row.version);
    if (patch !== null && patch > max) max = patch;
  });
  return '1.0.' + (max + 1);
}

function nextDevTaskNumber_(rows) {
  var max = 0;
  (rows || []).forEach(function (row) {
    var n = Number(row.taskNumber);
    if (isFinite(n) && n > max) max = n;
  });
  return max + 1;
}

function devLogRecords_() {
  ensureDevLogTab_();
  return sheet_(DEVLOG_TAB_).map(function (row) {
    return {
      version: String(row.Version || row.version || '').trim(),
      taskNumber: Number(row['Task Number'] || row.taskNumber || 0),
      description: String(row['Task Description'] || row.description || '').trim(),
      status: String(row.Status || row.status || '').trim().toUpperCase(),
      updated: String(row['Last Updated (Eastern Time)'] || row.updated || ''),
      notes: String(row.Notes || row.notes || ''),
    };
  }).filter(function (row) { return row.version || row.taskNumber; });
}

function devLogLine_(record) {
  return [record.version, record.taskNumber, record.description, record.status, record.updated, record.notes];
}

function rewriteDevLog_(records) {
  var tab = ensureDevLogTab_();
  var grid = [DEVLOG_HEADERS_].concat((records || []).map(devLogLine_));
  tab.clearContents();
  tab.getRange(1, 1, grid.length, DEVLOG_HEADERS_.length).setValues(grid);
  forgetRead_(DEVLOG_TAB_);
}

function findDevLogIndex_(records, taskNumber) {
  var n = Number(taskNumber);
  for (var i = 0; i < records.length; i += 1) if (Number(records[i].taskNumber) === n) return i;
  return -1;
}

function withDevLogLock_(work) {
  var lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(15000);
  try {
    return work();
  } finally {
    if (lock) try { lock.releaseLock(); } catch (ignore) {}
  }
}

function startDevTask(description, notes) {
  if (description && typeof description === 'object' && !Array.isArray(description)) {
    notes = description.notes;
    description = description.description;
  }
  return withDevLogLock_(function () {
    var text = String(description || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Enter a short task description.');
    if (text.length > 120) throw new Error('Keep the task description under 120 characters.');
    var note = String(notes || '').replace(/\s+/g, ' ').trim();
    if (note.length > 400) note = note.slice(0, 400);
    var records = devLogRecords_();
    var record = {
      version: nextDevVersion_(records),
      taskNumber: nextDevTaskNumber_(records),
      description: text,
      status: 'STARTED',
      updated: devLogNowEt_(),
      notes: note,
    };
    records.unshift(record);
    rewriteDevLog_(records);
    return record;
  });
}

function updateDevTask(taskNumber, status, notes) {
  if (taskNumber && typeof taskNumber === 'object' && !Array.isArray(taskNumber)) {
    notes = taskNumber.notes;
    status = taskNumber.status;
    taskNumber = taskNumber.taskNumber;
  }
  return withDevLogLock_(function () {
    var wanted = String(status || '').trim().toUpperCase();
    if (!DEVLOG_STATUSES_[wanted]) throw new Error('Status must be QUEUED, STARTED, COMPLETED or BLOCKED.');
    var records = devLogRecords_();
    var index = findDevLogIndex_(records, taskNumber);
    if (index === -1) throw new Error('Task ' + taskNumber + ' is not on CC_DevLog.');
    var record = records[index];
    record.status = wanted;
    record.updated = devLogNowEt_();
    if (notes !== undefined && notes !== null && String(notes).trim() !== '') {
      record.notes = String(notes).replace(/\s+/g, ' ').trim().slice(0, 400);
    }
    rewriteDevLog_(records);
    return record;
  });
}

function finishDevTask(taskNumber, notes) {
  if (taskNumber && typeof taskNumber === 'object' && !Array.isArray(taskNumber)) {
    notes = taskNumber.notes;
    taskNumber = taskNumber.taskNumber;
  }
  return updateDevTask(taskNumber, 'COMPLETED', notes);
}

function blockDevTask(taskNumber, notes) {
  if (taskNumber && typeof taskNumber === 'object' && !Array.isArray(taskNumber)) {
    notes = taskNumber.notes;
    taskNumber = taskNumber.taskNumber;
  }
  if (!String(notes || '').trim()) throw new Error('Explain the blocker in the notes.');
  return updateDevTask(taskNumber, 'BLOCKED', notes);
}

function queueDevTask(description, notes) {
  if (description && typeof description === 'object' && !Array.isArray(description)) {
    notes = description.notes;
    description = description.description;
  }
  return withDevLogLock_(function () {
    var text = String(description || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('Enter a short task description.');
    var note = String(notes || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    var records = devLogRecords_();
    var record = {
      version: nextDevVersion_(records),
      taskNumber: nextDevTaskNumber_(records),
      description: text,
      status: 'QUEUED',
      updated: devLogNowEt_(),
      notes: note,
    };
    records.unshift(record);
    rewriteDevLog_(records);
    return record;
  });
}

function firstWithStatus_(records, status) {
  for (var i = 0; i < records.length; i += 1) if (records[i].status === status) return records[i];
  return null;
}

function devLogStatus_() {
  var records = [];
  try {
    records = devLogRecords_();
  } catch (error) {
    return {
      error: String(error && error.message ? error.message : error),
      productionVersion: typeof APP_VERSION_ === 'undefined' ? '' : APP_VERSION_,
      sheet: DEVLOG_TAB_,
    };
  }
  var lastCompleted = firstWithStatus_(records, 'COMPLETED');
  var lastStarted = firstWithStatus_(records, 'STARTED') || records[0] || null;
  var latest = records[0] || null;
  var production = typeof APP_VERSION_ === 'undefined' ? '' : APP_VERSION_;
  return {
    productionVersion: production,
    latestVersion: latest ? latest.version : '',
    latestTask: latest,
    lastCompleted: lastCompleted,
    lastStarted: lastStarted,
    lastUpdated: latest ? latest.updated : '',
    deployedMatchesLatestCompleted: !!(lastCompleted && lastCompleted.version === production),
    aheadOfProduction: !!(latest && latest.version && latest.version !== production),
    sheet: DEVLOG_TAB_,
    rows: records.slice(0, 8),
  };
}

function devLog_(payload) {
  return { role: payload.session.role, development: devLogStatus_() };
}

/** Admin-only write path for Cursor. The Admin page does not expose these actions. */
function recordDevLog_(payload) {
  var action = String(payload && payload.action || '').trim().toLowerCase();
  if (action === 'start') return startDevTask(payload.description, payload.notes);
  if (action === 'finish' || action === 'complete') return finishDevTask(payload.taskNumber, payload.notes);
  if (action === 'block') return blockDevTask(payload.taskNumber, payload.notes);
  if (action === 'queue') return queueDevTask(payload.description, payload.notes);
  throw new Error('Choose start, finish, block, or queue.');
}
