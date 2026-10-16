function installDailyTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'scheduledImport_') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('scheduledImport_').timeBased().everyMinutes(30).create();
}

function retry_(payload) {
  scheduledImport_();
  return { ok: true };
}

function scheduledImport_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    importMailbox_();
    refreshRollup_();
    try { refreshMonthEnd_(); } catch (error) { appendException_('Update Failed', 'CC_MonthEnd could not be refreshed. The daily record was not changed.'); }
    markMissingReports_();
    noteHealth_('last_calculation', new Date().toISOString());
    noteHealth_('version', APP_VERSION_);
  } catch (error) {
    noteHealth_('status', 'Update Failed');
    appendException_('Update Failed', String(error && error.message ? error.message : error));
    notifyOnce_('Command Center import failed. Last verified figures were left in place. ' + String(error && error.message ? error.message : error));
  } finally {
    lock.releaseLock();
  }
}

function ensureDailyTrigger_() {
  var found = false;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'scheduledImport_') found = true;
  });
  if (!found) ScriptApp.newTrigger('scheduledImport_').timeBased().everyMinutes(30).create();
}

function importMailbox_() {
  var threads = GmailApp.search('has:attachment filename:pdf newer_than:45d', 0, 40);
  var accepted = 0;
  threads.forEach(function (thread) {
    if (accepted >= 40) return;
    thread.getMessages().forEach(function (message) {
      if (accepted >= 40) return;
      message.getAttachments().forEach(function (attachment) {
        if (accepted >= 40) return;
        if (!/\.pdf$/i.test(attachment.getName())) return;
        if (importAttachment_(message.getId(), attachment)) accepted += 1;
      });
    });
  });
  noteHealth_('last_import', new Date().toISOString());
  if (!healthValue_('status')) noteHealth_('status', 'Current');
}

function importAttachment_(messageId, attachment) {
  var bytes = attachment.getBytes();
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  var sha = digest.map(function (part) {
    var value = (part + 256) % 256;
    return (value < 16 ? '0' : '') + value.toString(16);
  }).join('');
  if (knownSha_(sha)) return false;
  if (/\.xlsx$/i.test(attachment.getName())) return importKpiAttachment_(sha, attachment);
  var text = '';
  try {
    text = pdfText_(attachment.copyBlob().setName(attachment.getName()));
  } catch (error) {
    recordImport_(sha, attachment.getName(), 'needs-review', 'The file could not be read. No figure was changed.');
    appendException_('Update Failed', attachment.getName() + ' could not be read.');
    notifyOnce_(attachment.getName() + ' could not be read. No figure was changed.');
    return true;
  }
  if (/SNAP\s*-\s*DELIVERED/i.test(text)) {
    recordImport_(sha, attachment.getName(), 'not-used', 'SNAP Delivered is not the delivered standard. No figure was changed.');
    return true;
  }
  var parsed = parseCloudReport_(text);
  if (!parsed) {
    if (/SNAP\s*-\s*WRITTEN|NET WRITTEN STORE SALES|DELIVERED STORE SALES/i.test(text)) {
      recordImport_(sha, attachment.getName(), 'needs-review', 'The store total was not identified. No figure was changed.');
      notifyOnce_(attachment.getName() + ' could not be identified. No figure was changed.');
    } else {
      recordImport_(sha, attachment.getName(), 'logged-not-daily', 'The file is on record. SNAP written, NWDSR written, and NWDSR delivered were not changed.');
    }
    return true;
  }
  if (!parsed.singleDay) {
    recordImport_(sha, attachment.getName(), 'cumulative-not-added', parsed.reportType + ' ' + parsed.start + ' through ' + parsed.end + ' was recorded and was not added to the daily table.');
    if (parsed.reportType === 'NWDSR Written' && parsed.purchasingCustomers !== null) {
      upsertClosing_({ date: parsed.end, scope: 'store', code: '', name: '', customers: parsed.purchasingCustomers, opportunities: '', start: parsed.start, end: parsed.end, through: parsed.end, source: 'NWDSR Net Written # OF CUST', final: 'yes', note: 'Cumulative Net Written purchasing customers for the printed period. Dollars were not added again.' });
    }
    return true;
  }
  var decision = writeDailyAmount_(parsed);
  if (decision !== 'conflict' && parsed.reportType === 'SNAP Written') writeSnapAssociates_(parsed, text, sha);
  if (decision !== 'conflict' && parsed.reportType === 'NWDSR Written' && parsed.purchasingCustomers !== null) {
    upsertClosing_({ date: parsed.start, scope: 'store', code: '', name: '', customers: parsed.purchasingCustomers, opportunities: '', start: parsed.start, end: parsed.end, source: 'NWDSR Net Written # OF CUST', final: 'yes', note: 'Net Written # OF CUST for the report date.' });
  }
  recordImport_(sha, attachment.getName(), decision, parsed.reportType + ' ' + parsed.start);
  return true;
}

function pdfText_(blob) {
  var created = Drive.Files.insert({ title: 'CC temp ' + new Date().getTime(), mimeType: MimeType.GOOGLE_DOCS }, blob, { convert: true });
  try {
    return DocumentApp.openById(created.id).getBody().getText();
  } finally {
    DriveApp.getFileById(created.id).setTrashed(true);
  }
}

function parseCloudReport_(text) {
  var reportType = '';
  // SNAP Delivered is ignored. Delivered sales use NWDSR Delivered.
  // SNAP Written is the actual written total. NWDSR Written may be unpaid or cancelled.
  if (/SNAP\s*-\s*WRITTEN/i.test(text)) reportType = 'SNAP Written';
  else if (/NET WRITTEN STORE SALES/i.test(text)) reportType = 'NWDSR Written';
  else if (/DELIVERED STORE SALES/i.test(text)) reportType = 'NWDSR Delivered';
  var period = /FROM\s+(\d{2})-([A-Z]{3})-(\d{4})\s+TO\s+(\d{2})-([A-Z]{3})-(\d{4})/i.exec(text);
  if (!reportType || !period) return null;
  var months = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  var start = isoFromParts_(period[1], months[period[2].toUpperCase()], period[3]);
  var end = isoFromParts_(period[4], months[period[5].toUpperCase()], period[6]);
  if (!start || !end) return null;
  var total = null;
  var purchasingCustomers = null;
  var lines = String(text).split(/\r?\n/);
  var i;
  for (i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    if (reportType === 'SNAP Written') {
      var snap = /17\s*-\s*ORLANDO\s+Totals:\s*(-?\d[\d,]*(?:\.\d+)?)\s+(-?\d[\d,]*(?:\.\d+)?)/i.exec(line);
      if (snap) total = moneyToken_(snap[2]);
    } else {
      var nw = /KANE FURNITURE #17\s+Totals:\s*(-?\d[\d,]*(?:\.\d+)?)(?:\s+(-?\d[\d,]*(?:\.\d+)?))?(?:\s+(-?\d[\d,]*(?:\.\d+)?))?/i.exec(line);
      if (nw) {
        total = moneyToken_(nw[1]);
        if (reportType === 'NWDSR Written' && nw[3]) {
          var customers = moneyToken_(nw[3]);
          if (customers !== null && customers >= 0 && customers === Math.round(customers)) purchasingCustomers = customers;
        }
      }
    }
  }
  if (total === null) return null;
  return { reportType: reportType, start: start, end: end, singleDay: start === end, storeTotal: total, purchasingCustomers: purchasingCustomers };
}

function isoFromParts_(day, month, year) {
  if (!month) return '';
  return String(year) + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}

function moneyToken_(token) {
  var cleaned = String(token).replace(/[$,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100) / 100;
}

function knownSha_(sha) {
  return sheet_('CC_Imports').some(function (row) {
    var status = String(row.status);
    return String(row.sha256) === sha && status !== 'needs-review' && status !== 'failed';
  });
}

function snapAssociates_(text) {
  var found = [];
  var lines = String(text).split(/\r?\n/);
  var i;
  for (i = 0; i < lines.length; i += 1) {
    var line = lines[i].trim();
    if (/totals:/i.test(line)) continue;
    var row = /^([A-Z][A-Z' .-]+,\s*[A-Z][A-Z' .-]+?)\s+(-?\d[\d,]*(?:\.\d+)?)\b/i.exec(line);
    if (!row) continue;
    var amount = moneyToken_(row[2]);
    if (amount === null) continue;
    found.push({ sourceName: row[1].replace(/\s+/g, ' ').trim(), amount: amount });
  }
  return found;
}

function writeSnapAssociates_(parsed, text, sha) {
  var lines = snapAssociates_(text);
  if (!lines.length) return;
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_AssociateDays');
  if (!tab) return;
  var values = tab.getDataRange().getValues();
  var known = {};
  var r;
  for (r = 1; r < values.length; r += 1) known[String(values[r][1]).toUpperCase()] = values[r];
  lines.forEach(function (line) {
    var prior = known[line.sourceName.toUpperCase()];
    var display = prior ? String(prior[2]) : line.sourceName;
    var role = prior ? String(prior[3]) : 'unknown';
    var existing = 0;
    for (r = 1; r < values.length; r += 1) {
      if (isoDate_(values[r][0]) === parsed.start && String(values[r][1]).toUpperCase() === line.sourceName.toUpperCase()) existing = r + 1;
    }
    if (existing) {
      var current = numberOrNull_(tab.getRange(existing, 5).getValue());
      if (current !== line.amount) holdBackDay_('CC_AssociateDays', parsed.start + '|' + line.sourceName, values[existing - 1], String(line.amount), 'sha256 ' + sha);
      return;
    }
    tab.appendRow([parsed.start, line.sourceName, display, role, line.amount, sha]);
  });
  var period = individualPeriodContaining_(parsed.start);
  refreshPeopleWritten_(period.start, period.end);
}

function writeDailyAmount_(parsed) {
  var field = parsed.reportType === 'SNAP Written' ? 1 : parsed.reportType === 'NWDSR Written' ? 2 : 3;
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Daily');
  if (!tab) throw new Error('CC_Daily is missing.');
  var values = tab.getDataRange().getValues();
  var target = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === parsed.start) target = r + 1;
  }
  if (!target) {
    target = Math.max(values.length, 1) + 1;
    tab.getRange(target, 1).setValue(parsed.start);
  }
  var current = numberOrNull_(tab.getRange(target, field + 1).getValue());
  if (current !== null && current !== parsed.storeTotal) {
    var conflict = parsed.reportType + ' ' + parsed.start + ' conflicts with the figure already on file. The existing figure was kept.';
    appendException_('Update Failed', conflict);
    notifyOnce_(conflict);
    refreshRollup_();
    return 'conflict';
  }
  tab.getRange(target, field + 1).setValue(parsed.storeTotal);
  var ledgerView = parsed.reportType === 'SNAP Written' ? 'SNAP_STORE' : parsed.reportType === 'NWDSR Written' ? 'NWDSR_WRITTEN_STORE' : 'NWDSR_DELIVERED_STORE';
  var ledgerSide = parsed.reportType === 'NWDSR Delivered' ? 'delivered' : 'written';
  upsertLedgerDaily_(ledgerView, ledgerSide, parsed.start, parsed.storeTotal, parsed.reportType);
  refreshRollup_();
  return 'imported';
}

function recordImport_(sha, fileName, status, note) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Imports');
  if (!tab) return;
  var existing = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < existing.length; r += 1) {
    if (String(existing[r][0]) === sha) {
      tab.getRange(r + 1, 4, 1, 3).setValues([[status, new Date().toISOString(), note]]);
      return;
    }
  }
  tab.appendRow([sha, fileName, '', status, new Date().toISOString(), note]);
}

function markMissingReports_() {
  var yesterday = shiftDate_(todayNy_(), -1);
  var facts = dailyFacts_();
  var row = facts.filter(function (item) { return item.date === yesterday; })[0];
  var missing = [];
  if (!row || row.snapWritten === null) missing.push('SNAP Written');
  if (!row || row.nwdsrWritten === null) missing.push('NWDSR Written');
  if (!row || row.nwdsrDelivered === null) missing.push('NWDSR Delivered');
  if (missing.length) {
    noteHealth_('status', 'Report Missing');
    var message = yesterday + ' is missing ' + missing.join(', ') + '. Older verified totals were not replaced.';
    appendException_('Report Missing', message);
    notifyOnce_('Command Center is missing ' + missing.join(', ') + ' for ' + yesterday + '. The last verified totals are still on the board.');
    return;
  }
  noteHealth_('status', 'Current');
}

function noteHealth_(key, value) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Health');
  if (!tab) return;
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === key) {
      tab.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  tab.appendRow([key, value]);
}

function appendException_(severity, message) {
  var spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID_);
  var tab = spreadsheet.getSheetByName('CC_Exceptions');
  if (!tab) return;
  var values = tab.getDataRange().getValues();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][2]) === message) return;
  }
  tab.appendRow([new Date().toISOString(), severity, message]);
}

function notifyOnce_(message) {
  var props = PropertiesService.getScriptProperties();
  var key = 'mail_' + message.slice(0, 90);
  if (props.getProperty(key)) return;
  var email = String(config_().admin_email || '');
  if (!email) return;
  MailApp.sendEmail(email, 'Command Center needs attention', message);
  props.setProperty(key, new Date().toISOString());
}
