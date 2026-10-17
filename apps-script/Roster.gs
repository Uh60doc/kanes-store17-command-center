/**
 * CC_People is the roster. Columns name, role and SNAP Written come first and keep their positions; the roster
 * columns follow. `name` is the display name every historical record is keyed by, so it never changes after hire.
 * Status changes are dated: before status_effective the prior_status still applies. Nothing here touches sales,
 * KPI or evaluation rows, so a termination never removes history.
 */
var ROSTER_COLUMNS_ = ['employee_id', 'full_name', 'preferred_name', 'hire_date', 'store', 'position', 'status', 'status_effective', 'prior_status', 'aliases', 'roster_note', 'updated_at'];
var ROSTER_STATUSES_ = ['Active', 'Leave', 'Management', 'Transferred', 'Terminated'];
var ROSTER_HISTORY_HEADERS_ = ['changed_at', 'action', 'employee_id', 'name', 'field', 'before', 'after', 'effective_date', 'by_role', 'note'];

var ROSTER_SEED_ = {
  'Renzo Del Solar': { employee_id: 'RDELSO', full_name: 'Renzo Del Solar', preferred_name: 'Renzo', position: 'Sales Associate', status: 'Active', aliases: 'RENZO DELSOLAR; DELSOLAR, RENZO' },
  'Prakash Gandhi': { employee_id: 'PGANDH', full_name: 'Prakash B. Gandhi', preferred_name: 'Prakash', position: 'Sales Associate', status: 'Active', aliases: 'PRAKASH B GANDHI; GANDHI, PRAKASH' },
  'Eric Montes Rodriguez': { employee_id: 'EMON0904', full_name: 'Eric Montes Rodriguez', preferred_name: 'Eric', position: 'Sales Associate', status: 'Active', aliases: 'ERIC MONTES; MONTES, ERIC' },
  'Ricky Nassif': { employee_id: 'TNASSI', full_name: 'Tarik Nassif', preferred_name: 'Ricky', position: 'Sales Associate', status: 'Active', aliases: 'TNASSIF; TARIK NASSIF; NASSIF, TARIK; RICKY (TARIK) NASSIF' },
  'Brenda Sanchez': { employee_id: '', full_name: 'Brenda Sanchez', preferred_name: 'Brenda', hire_date: '2026-10-12', position: 'Sales Associate', status: 'Active', aliases: 'SANCHEZ, BRENDA', roster_note: 'Employee ID not on file yet.' },
  'Caroline Amaro': { employee_id: '', full_name: 'Caroline Amaro', preferred_name: 'Caroline', hire_date: '2026-10-19', position: 'Sales Associate', status: 'Terminated', status_effective: '2026-10-16', prior_status: 'Active', aliases: 'AMARO, CAROLINE', roster_note: 'Scheduled to start October 19, 2026. Terminated October 16, 2026, before starting.' },
};
var ROSTER_SEED_EXTRA_ = [
  { name: 'Cordell Primous', role: 'management', employee_id: 'CPRI0909', full_name: 'Cordell Primous', preferred_name: 'Cordell', position: 'Sales Manager', status: 'Management', aliases: 'PRIMOUS, CORDELL', roster_note: 'Sales manager. On leave until his expected return October 17, 2026.' },
  { name: 'Kelly Meyers', role: 'management', employee_id: 'JMEYERS', full_name: 'James Meyers', preferred_name: 'Kelly', position: 'General Manager', status: 'Management', aliases: 'JAMES MEYERS; MEYERS, JAMES', roster_note: '' },
  { name: 'Elizabeth Perez', role: 'management', employee_id: 'EPEREZ', full_name: 'Elizabeth Perez', preferred_name: 'Elizabeth', position: 'Operations Manager', status: 'Management', aliases: 'PEREZ, ELIZABETH', roster_note: '' },
  { name: 'Valentina Lopez', role: 'former', employee_id: '', full_name: 'Valentina Lopez', preferred_name: 'Valentina', position: 'Sales Associate', status: 'Terminated', aliases: 'LOPEZ, VALENTINA', roster_note: 'Former associate. Termination date not on file.' },
  /** GM-confirmed former identities. Maria Rafalik stays unmatched and is intentionally not seeded. */
  { name: 'Mukhtar Junaid', role: 'former', employee_id: '', full_name: 'Mukhtar Junaid', preferred_name: 'Jimmy', position: 'Sales Associate', status: 'Terminated', aliases: 'MUKHTAR JUNAID; MUKHTAR, JUNAID; JUNAID, MUKHTAR; JIMMY', roster_note: 'Former associate. Went by Jimmy. GM confirmed Mukhtar Junaid / Jimmy only — no other alias or employee ID. Termination date not on file.' },
  { name: 'Filepe Chaves', role: 'former', employee_id: '', full_name: 'Filepe Chaves', preferred_name: 'Filepe', position: 'Sales Associate', status: 'Terminated', aliases: 'CHAVES FELIPE; FELIPE CHAVES; CHAVES, FELIPE; FILEPE CHAVES; CHAVES, FILEPE', roster_note: 'Former associate. GM confirmed first name Filepe and last name Chaves. Report aliases CHAVES FELIPE and FELIPE CHAVES. Preserve original report spellings. Termination date not on file.' },
];

var rosterCache_ = null;

function rosterStatus_(value) {
  var text = String(value || '').trim().toLowerCase();
  var found = '';
  ROSTER_STATUSES_.forEach(function (status) { if (status.toLowerCase() === text) found = status; });
  return found;
}

function statusRole_(status) {
  if (status === 'Active' || status === 'Leave') return 'associate';
  if (status === 'Management') return 'management';
  if (status === 'Transferred' || status === 'Terminated') return 'former';
  return '';
}

/** The status in force on a date: a change dated after that day has not happened yet. */
function rosterStatusOn_(row, date) {
  var status = rosterStatus_(row.status);
  if (!status) return '';
  var effective = isoDate_(row.status_effective);
  if (effective && date < effective) return rosterStatus_(row.prior_status) || '';
  return status;
}

/** associate, management, former or unknown on a date. Rows without a roster status keep the role column. */
function rosterRole_(row, date) {
  var status = rosterStatus_(row.status);
  if (!status) {
    var legacy = String(row.role || 'associate');
    if (legacy === 'management' || legacy === 'former' || legacy === 'unknown') return legacy;
    return 'associate';
  }
  var on = rosterStatusOn_(row, date);
  if (!on) return 'former';
  var role = statusRole_(on);
  var hired = isoDate_(row.hire_date);
  if (role === 'associate' && hired && date < hired) return 'former';
  return role;
}

function aliasKey_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9,()' ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function nameTokens_(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(function (part) { return part.length > 0; }).sort();
}

function sameNameTokens_(left, right) {
  var a = nameTokens_(left);
  var b = nameTokens_(right);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  var shorter = a.length <= b.length ? a : b;
  var longer = a.length <= b.length ? b : a;
  if (shorter.length < 2) return false;
  return shorter.every(function (token) { return longer.indexOf(token) !== -1; });
}

function rosterRows_() {
  if (rosterCache_) return rosterCache_;
  rosterCache_ = sheet_('CC_People').map(function (row) {
    var aliases = String(row.aliases || '').split(/[;\n]/).map(aliasKey_).filter(Boolean);
    return {
      name: String(row.name || ''),
      raw: row,
      employeeId: String(row.employee_id || '').trim(),
      fullName: String(row.full_name || ''),
      aliases: aliases,
    };
  });
  return rosterCache_;
}

/** Report names and codes the roster verifies for a display name, lowercased. */
function rosterAliases_(name) {
  var key = String(name || '').toLowerCase();
  var out = [];
  rosterRows_().forEach(function (entry) {
    if (entry.name.toLowerCase() !== key) return;
    if (entry.employeeId) out.push(entry.employeeId.toLowerCase());
    if (entry.fullName) out.push(aliasKey_(entry.fullName));
    entry.aliases.forEach(function (alias) { out.push(alias); });
  });
  return out;
}

/** The roster entry an imported report line belongs to: employee ID first, then verified aliases and names. */
function rosterMatch_(code, sourceName) {
  var rows = rosterRows_();
  var id = String(code || '').trim().toLowerCase();
  var byId = id ? rows.filter(function (entry) { return entry.employeeId && entry.employeeId.toLowerCase() === id; }) : [];
  if (byId.length === 1) return byId[0];
  var source = aliasKey_(sourceName);
  if (!source) return null;
  var exact = rows.filter(function (entry) {
    return aliasKey_(entry.name) === source || aliasKey_(entry.fullName) === source || entry.aliases.indexOf(source) !== -1;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  var close = rows.filter(function (entry) {
    return sameNameTokens_(entry.name, sourceName) || (entry.fullName && sameNameTokens_(entry.fullName, sourceName)) ||
      entry.aliases.some(function (alias) { return sameNameTokens_(alias, sourceName); });
  });
  if (close.length) return close.length === 1 ? close[0] : null;
  if (nameTokens_(sourceName).length !== 1) return null;
  var first = rows.filter(function (entry) {
    var preferred = aliasKey_(entry.raw.preferred_name);
    return (preferred && preferred === source) || aliasKey_(entry.name.split(' ')[0]) === source;
  });
  return first.length === 1 ? first[0] : null;
}

function rosterTab_() {
  forgetRead_('CC_People');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_People');
  if (!tab) {
    tab = spreadsheet.insertSheet('CC_People');
    tab.getRange(1, 1, 1, 3).setValues([['name', 'role', 'SNAP Written']]);
  }
  return tab;
}

function rosterHistoryTab_() {
  forgetRead_('CC_RosterHistory');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_RosterHistory');
  if (tab) return tab;
  tab = spreadsheet.insertSheet('CC_RosterHistory');
  tab.getRange(1, 1, 1, ROSTER_HISTORY_HEADERS_.length).setValues([ROSTER_HISTORY_HEADERS_]);
  return tab;
}

/**
 * Roster seeds and AssociateDays rematches write only when not building quiet production pages.
 * Restore drills may still write on a scratch copy (BOOK_ is not production).
 */
function rosterWritesAllowed_() {
  if (typeof UPLOAD_QUIET_ === 'undefined' || !UPLOAD_QUIET_) return true;
  try {
    return book_().getId() !== SPREADSHEET_ID_;
  } catch (error) {
    return false;
  }
}

/** Adds the roster columns and fills them once from the verified roster. Existing cells are never overwritten. */
function ensureRosterColumns_() {
  var tab = rosterTab_();
  var values = tab.getDataRange().getValues();
  var header = values[0].map(function (cell) { return String(cell || '').trim(); });
  var missing = ROSTER_COLUMNS_.filter(function (column) { return header.indexOf(column) === -1; });
  var stamp = new Date().toISOString();
  var history = rosterHistoryTab_();
  var changed = false;
  var r;
  var present = {};
  for (r = 1; r < values.length; r += 1) {
    var listed = String(values[r][0] || '');
    if (listed) present[listed] = true;
  }
  if (!rosterWritesAllowed_()) return false;
  if (missing.length) {
    var start = header.length + 1;
    tab.getRange(1, start, 1, missing.length).setValues([missing]);
    header = header.concat(missing);
    for (r = 1; r < values.length; r += 1) {
      var name = String(values[r][0] || '');
      if (!name) continue;
      var seed = ROSTER_SEED_[name] || {};
      var role = String(values[r][1] || 'associate');
      var fill = {
        employee_id: seed.employee_id || '',
        full_name: seed.full_name || name,
        preferred_name: seed.preferred_name || name.split(' ')[0],
        hire_date: seed.hire_date || '',
        store: '17',
        position: seed.position || (role === 'management' ? 'Management' : 'Sales Associate'),
        status: seed.status || (role === 'management' ? 'Management' : role === 'former' ? 'Terminated' : 'Active'),
        status_effective: seed.status_effective || '',
        prior_status: seed.prior_status || '',
        aliases: seed.aliases || '',
        roster_note: seed.roster_note || '',
        updated_at: stamp,
      };
      var line = missing.map(function (column) { return fill[column]; });
      tab.getRange(r + 1, start, 1, missing.length).setValues([line]);
      history.appendRow([stamp, 'roster columns added', fill.employee_id, name, 'all', '', JSON.stringify(fill), fill.status_effective, 'system', 'Filled from the verified roster. No sales, KPI or evaluation rows were changed.']);
    }
    changed = true;
  }
  // Seed only — rematch AssociateDays from Sales Team / rematchAssociateDays_, never as a side effect here.
  if (ensureKnownFormerEmployees_(tab, header, present, stamp, history)) changed = true;
  if (changed) rosterCache_ = null;
  return changed;
}

/** Appends GM-confirmed former (and management) seed rows that are still missing. Never overwrites an existing row. */
function ensureKnownFormerEmployees_(tab, header, present, stamp, history) {
  present = present || {};
  stamp = stamp || new Date().toISOString();
  history = history || rosterHistoryTab_();
  if (!header || !header.length) header = tab.getRange(1, 1, 1, tab.getLastColumn()).getValues()[0].map(function (cell) { return String(cell || '').trim(); });
  var added = false;
  ROSTER_SEED_EXTRA_.forEach(function (extra) {
    if (present[extra.name]) return;
    var already = false;
    Object.keys(present).forEach(function (name) {
      if (already) return;
      if (aliasKey_(name) === aliasKey_(extra.name) || sameNameTokens_(name, extra.name)) already = true;
    });
    if (already) return;
    var line = header.map(function (column) {
      if (column === 'name') return extra.name;
      if (column === 'role') return extra.role;
      if (column === 'store') return '17';
      if (column === 'updated_at') return stamp;
      return extra[column] !== undefined ? extra[column] : '';
    });
    tab.appendRow(line);
    history.appendRow([stamp, 'roster record added', extra.employee_id || '', extra.name, 'all', '', JSON.stringify(extra), '', 'system', 'GM-confirmed identity added so report names match. Historical sales stay on file; not an active salesperson card.']);
    present[extra.name] = true;
    added = true;
  });
  if (added) rosterCache_ = null;
  return added;
}

/**
 * Updates CC_AssociateDays display name and role when a printed source now matches the roster.
 * Never changes the source name, amount, date, or SHA. Store totals are untouched.
 */
function rematchAssociateDays_() {
  ensureRosterColumns_();
  if (!rosterWritesAllowed_()) return 0;
  forgetRead_('CC_AssociateDays');
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName('CC_AssociateDays');
  if (!tab) return 0;
  var values = tab.getDataRange().getValues();
  if (values.length < 2) return 0;
  var updated = 0;
  var r;
  for (r = 1; r < values.length; r += 1) {
    var date = isoDate_(values[r][0]);
    var source = String(values[r][1] || '');
    var display = String(values[r][2] || '');
    var role = String(values[r][3] || '');
    var match = rosterMatch_('', source) || rosterMatch_('', display);
    if (!match) continue;
    var nextDisplay = match.name;
    var nextRole = rosterRole_(match.raw, date || todayNy_());
    if (display === nextDisplay && role === nextRole) continue;
    tab.getRange(r + 1, 3, 1, 2).setValues([[nextDisplay, nextRole]]);
    updated += 1;
  }
  if (updated) forgetRead_('CC_AssociateDays');
  return updated;
}

function rosterRecord_(row, today) {
  var status = rosterStatus_(row.status) || (String(row.role) === 'management' ? 'Management' : String(row.role) === 'former' ? 'Terminated' : 'Active');
  var effective = isoDate_(row.status_effective);
  var current = rosterStatusOn_(row, today) || status;
  var role = rosterRole_(row, today);
  var hired = isoDate_(row.hire_date);
  return {
    name: String(row.name || ''),
    employeeId: String(row.employee_id || ''),
    fullName: String(row.full_name || ''),
    preferredName: String(row.preferred_name || ''),
    hireDate: hired,
    store: String(row.store || '17'),
    position: String(row.position || ''),
    status: status,
    statusEffective: effective,
    priorStatus: rosterStatus_(row.prior_status),
    currentStatus: current,
    scheduled: effective && today < effective ? status + ' on ' + effective : '',
    startsLater: !!(hired && today < hired && statusRole_(current) === 'associate'),
    onSalesTeam: role === 'associate',
    aliases: String(row.aliases || ''),
    note: String(row.roster_note || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function roster_(payload) {
  ensureRosterColumns_();
  rosterCache_ = null;
  var today = todayNy_();
  var associates = sheet_('CC_People').map(function (row) { return rosterRecord_(row, today); });
  var history = sheet_('CC_RosterHistory').slice(-25).reverse().map(function (row) {
    return { at: String(row.changed_at || ''), action: String(row.action || ''), name: String(row.name || ''), field: String(row.field || ''), before: String(row.before || ''), after: String(row.after || ''), effective: isoDate_(row.effective_date), by: String(row.by_role || '') };
  });
  return { role: payload.session.role, today: today, statuses: ROSTER_STATUSES_, associates: associates, history: history };
}

function validDate_(value) {
  var text = String(value || '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || shiftDate_(text, 0) !== text) throw new Error('Use a real date (YYYY-MM-DD): ' + text);
  return text;
}

function rosterField_(value, max) {
  var text = String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length > max) throw new Error('Keep each field under ' + max + ' characters.');
  if (/^[=+@-]/.test(text)) text = "'" + text;
  return text;
}

function defaultDisplayName_(fullName, preferred) {
  var parts = String(fullName || '').split(' ').filter(Boolean);
  if (!parts.length) return '';
  if (!preferred) return parts.join(' ');
  var rest = parts.slice(1).filter(function (part) { return !/^[A-Z]\.?$/.test(part); });
  return [preferred].concat(rest).join(' ');
}

/**
 * Builds the change for one roster record. action: hire, update, status, rehire.
 * Returns the row values to write, the field-by-field changes, and the plain-language summary for confirmation.
 */
function planRosterChange_(payload, header, values, today) {
  var action = String(payload.action || '');
  if (['hire', 'update', 'status', 'rehire'].indexOf(action) === -1) throw new Error('Choose hire, update, status change, or rehire.');
  var input = payload.record || {};
  var col = function (name) { return header.indexOf(name); };
  var rowIndex = -1;
  var r;
  if (action !== 'hire') {
    var target = String(payload.name || '');
    for (r = 1; r < values.length; r += 1) if (String(values[r][col('name')]) === target) rowIndex = r;
    if (rowIndex === -1) throw new Error('That associate is not on the roster.');
  }
  var before = {};
  header.forEach(function (column, index) { before[column] = rowIndex === -1 ? '' : values[rowIndex][index]; });
  before.hire_date = isoDate_(before.hire_date) || '';
  before.status_effective = isoDate_(before.status_effective) || '';
  var after = {};
  Object.keys(before).forEach(function (key) { after[key] = before[key]; });
  var currentStatus = rosterStatusOn_(before, today) || rosterStatus_(before.status);

  var setText = function (field, key, max) {
    if (input[key] === undefined) return;
    after[field] = rosterField_(input[key], max);
  };
  if (action === 'hire' || action === 'update') {
    setText('full_name', 'fullName', 80);
    setText('preferred_name', 'preferredName', 40);
    setText('employee_id', 'employeeId', 20);
    setText('store', 'store', 20);
    setText('position', 'position', 40);
    setText('aliases', 'aliases', 300);
    setText('roster_note', 'note', 300);
    if (input.hireDate !== undefined) after.hire_date = validDate_(input.hireDate);
    after.employee_id = String(after.employee_id || '').toUpperCase();
  }
  if (action === 'hire') {
    if (!after.full_name) throw new Error('Enter the full name.');
    if (!after.hire_date) throw new Error('Enter the hire date.');
    var display = rosterField_(input.displayName || defaultDisplayName_(after.full_name, after.preferred_name), 80);
    if (!display) throw new Error('Enter the display name.');
    after.name = display;
    after.store = after.store || '17';
    after.position = after.position || 'Sales Associate';
    var hireStatus = rosterStatus_(input.status) || 'Active';
    if (hireStatus === 'Transferred' || hireStatus === 'Terminated') throw new Error('A new hire starts Active, Leave, or Management.');
    after.status = hireStatus;
    after.status_effective = after.hire_date;
    after.prior_status = '';
  }
  if (action === 'status' || action === 'rehire') {
    var next = action === 'rehire' ? 'Active' : rosterStatus_(input.status);
    if (!next) throw new Error('Choose Active, Leave, Management, Transferred, or Terminated.');
    var effective = validDate_(input.effectiveDate) || today;
    var formerNow = currentStatus === 'Transferred' || currentStatus === 'Terminated';
    if (action === 'rehire' && !formerNow) throw new Error('Rehire is for a transferred or terminated associate. ' + before.name + ' is ' + currentStatus + '.');
    if (action === 'status' && next === rosterStatus_(before.status) && effective === before.status_effective) throw new Error(before.name + ' is already ' + next + ' from ' + effective + '.');
    if (before.hire_date && effective < before.hire_date && action !== 'rehire') throw new Error('The effective date is before the hire date ' + before.hire_date + '.');
    after.prior_status = currentStatus;
    after.status = next;
    after.status_effective = effective;
    if (action === 'rehire') after.hire_date = effective;
    if (input.note !== undefined && String(input.note).trim()) after.roster_note = rosterField_(input.note, 300);
  }
  after.role = statusRole_(rosterStatusOn_(after, today) || after.status) || 'former';

  var others = [];
  for (r = 1; r < values.length; r += 1) if (r !== rowIndex && String(values[r][col('name')] || '')) others.push(r);
  if (after.employee_id) {
    others.forEach(function (index) {
      if (String(values[index][col('employee_id')] || '').toUpperCase() === after.employee_id) {
        throw new Error('Employee ID ' + after.employee_id + ' already belongs to ' + values[index][col('name')] + '. Edit or rehire that record instead.');
      }
    });
  }
  if (action === 'hire') {
    others.forEach(function (index) {
      var existing = String(values[index][col('name')]);
      var existingFull = String(values[index][col('full_name')] || '');
      if (aliasKey_(existing) === aliasKey_(after.name) || (existingFull && aliasKey_(existingFull) === aliasKey_(after.full_name))) {
        throw new Error(existing + ' is already on the roster. Use Rehire or edit that record so the history stays on one record.');
      }
    });
  }

  var changes = [];
  var watched = ['name', 'full_name', 'preferred_name', 'employee_id', 'hire_date', 'store', 'position', 'status', 'status_effective', 'aliases', 'roster_note'];
  watched.forEach(function (field) {
    var was = String(before[field] === undefined ? '' : before[field]);
    var now = String(after[field] === undefined ? '' : after[field]);
    if (was !== now) changes.push({ field: field, before: was, after: now });
  });
  if (!changes.length) throw new Error('Nothing changed.');

  var who = after.name;
  var summary;
  if (action === 'hire') summary = 'Hire ' + who + ' (' + (after.employee_id || 'no employee ID yet') + ') as ' + after.position + ', ' + after.status + ' from ' + after.hire_date + '.';
  else if (action === 'rehire') summary = 'Rehire ' + who + ' as Active from ' + after.status_effective + '. The earlier record, sales and evaluations stay with the same person.';
  else if (action === 'status') summary = 'Change ' + who + ' from ' + currentStatus + ' to ' + after.status + ' effective ' + after.status_effective + '.';
  else summary = 'Update ' + who + ': ' + changes.map(function (change) { return change.field.replace(/_/g, ' '); }).join(', ') + '.';
  var team = after.role === 'associate' ? 'On the Sales Team' : 'Not on the Sales Team';
  var effectiveRole = rosterRole_(after, today);
  var teamNote = effectiveRole === 'associate' ? 'Shows on the Sales Team today.' : (after.status_effective && today < after.status_effective ? team + ' from ' + after.status_effective + '; until then the current status applies.' : 'Leaves the active Sales Team. Past sales, KPIs and evaluations are kept.');
  if (effectiveRole === 'former' && after.hire_date && today < after.hire_date && statusRole_(after.status) === 'associate') teamNote = 'Joins the Sales Team on the hire date ' + after.hire_date + '.';
  return { action: action, rowIndex: rowIndex, after: after, before: before, changes: changes, summary: summary, teamNote: teamNote };
}

function saveAssociate_(payload) {
  ensureRosterColumns_();
  var lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock) lock.waitLock(20000);
  try {
    var tab = rosterTab_();
    var values = tab.getDataRange().getValues();
    var header = values[0].map(function (cell) { return String(cell || '').trim(); });
    var today = todayNy_();
    var plan = planRosterChange_(payload, header, values, today);
    var preview = { summary: plan.summary, teamNote: plan.teamNote, changes: plan.changes };
    if (payload.confirm !== true) return { confirmed: false, preview: preview };
    plan.after.updated_at = new Date().toISOString();
    var line = header.map(function (column) {
      if (column === 'SNAP Written' && plan.rowIndex !== -1) return values[plan.rowIndex][header.indexOf(column)];
      return plan.after[column] === undefined ? '' : plan.after[column];
    });
    if (plan.rowIndex === -1) tab.appendRow(line);
    else tab.getRange(plan.rowIndex + 1, 1, 1, header.length).setValues([line]);
    var history = rosterHistoryTab_();
    plan.changes.forEach(function (change) {
      history.appendRow([plan.after.updated_at, plan.action, plan.after.employee_id || '', plan.after.name, change.field, change.before, change.after, plan.after.status_effective || '', payload.session.role, plan.summary]);
    });
    rosterCache_ = null;
    var result = roster_(payload);
    result.confirmed = true;
    result.saved = preview;
    return result;
  } finally {
    if (lock) lock.releaseLock();
  }
}

/** Associates on the roster at any point in a date range, for reports and evaluations about that range. */
function membersDuring_(start, end) {
  return sheet_('CC_People').filter(function (row) {
    return rosterRole_(row, start) === 'associate' || rosterRole_(row, end) === 'associate' || servedBetween_(row, start, end);
  }).map(function (row) { return String(row.name); });
}

function servedBetween_(row, start, end) {
  if (!rosterStatus_(row.status)) return false;
  var hired = isoDate_(row.hire_date);
  var effective = isoDate_(row.status_effective);
  var status = rosterStatus_(row.status);
  if (statusRole_(status) !== 'former' || !effective) return false;
  if (statusRole_(rosterStatus_(row.prior_status)) !== 'associate') return false;
  if (hired && hired > end) return false;
  if (hired && effective <= hired) return false;
  return effective > start;
}
