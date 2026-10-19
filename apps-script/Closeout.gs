/**
 * End-of-day closeout. The closing manager attests that each step was done.
 * This page does not send the end-of-day email, does not change a report, and does not check locks or the alarm.
 * Alarm codes and lock combinations are not stored.
 */

var CLOSEOUT_TAB_ = 'CC_Closeout';
var CLOSEOUT_HEADERS_ = ['date', 'manager', 'steps', 'notes', 'status', 'completed_at', 'updated_at', 'updated_by'];
var CLOSEOUT_STEPS_ = [
  { key: 'perq-gone', group: 'Daily sales process', label: 'Everyone is marked Gone Home in PERQ before the final customer counts.' },
  { key: 'eod-reports', group: 'Daily sales process', label: 'The existing end-of-day reporting process is complete.' },
  { key: 'business-date', group: 'Before you send', label: 'Business date checked.' },
  { key: 'email-subject', group: 'Before you send', label: 'Email subject checked.' },
  { key: 'report-numbers', group: 'Before you send', label: 'Report numbers checked.' },
  { key: 'recipient-steele', group: 'Before you send', label: 'Recipient checked: John Steele.' },
  { key: 'recipient-ferguson', group: 'Before you send', label: 'Recipient checked: Jim Ferguson.' },
  { key: 'recipient-franco', group: 'Before you send', label: 'Recipient checked: Franco.' },
  { key: 'recipient-store', group: 'Before you send', label: 'Recipient checked: Store 17 Management.' },
  { key: 'back-doors', group: 'Before you go', label: 'Back doors locked.' },
  { key: 'back-lights', group: 'Before you go', label: 'Back area lights off.' },
  { key: 'main-lights', group: 'Before you go', label: 'Main lights off.' },
  { key: 'music', group: 'Before you go', label: 'Music off.' },
  { key: 'doors', group: 'Before you go', label: 'Both applicable doors locked.' },
  { key: 'deadbolts', group: 'Before you go', label: 'Key deadbolts in place.' },
  { key: 'alarm', group: 'Before you go', label: 'Alarm set. This is an attestation. The website does not know the alarm state.' },
  { key: 'go-home', group: 'Before you go', label: 'Go Home. Drive Safe.' },
];

function closeoutClean_(value, max) {
  return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function closeoutSecret_(text) {
  var value = String(text || '');
  if (/\b(alarm code|lock code|combination|deadbolt code|password|pin)\b/i.test(value)) return true;
  if (/\b\d{4,}\b/.test(value)) return true;
  return false;
}

function closeoutManager_(value) {
  var text = closeoutClean_(value, 40);
  if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(text)) throw new Error('Enter the closing manager’s name.');
  return text;
}

function closeoutNote_(value) {
  var text = closeoutClean_(value, 240);
  if (closeoutSecret_(text)) throw new Error('Do not store an alarm code, lock combination, or other building secret in the notes.');
  return text;
}

function closeoutSheet_() {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(CLOSEOUT_TAB_);
  if (!tab) {
    tab = spreadsheet.insertSheet(CLOSEOUT_TAB_);
    tab.getRange(1, 1, 1, CLOSEOUT_HEADERS_.length).setValues([CLOSEOUT_HEADERS_]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function closeoutRows_() {
  return sheet_(CLOSEOUT_TAB_).map(function (row) {
    var steps = {};
    try { steps = JSON.parse(String(row.steps || '{}')); } catch (error) { steps = {}; }
    return {
      date: isoDate_(row.date),
      manager: closeoutClean_(row.manager, 40),
      steps: steps,
      notes: closeoutClean_(row.notes, 240),
      status: closeoutClean_(row.status, 20),
      completedAt: closeoutClean_(row.completed_at, 40),
      updatedAt: closeoutClean_(row.updated_at, 40),
      updatedBy: closeoutClean_(row.updated_by, 40),
    };
  }).filter(function (row) { return row.date; });
}

function closeoutItems_(saved) {
  return CLOSEOUT_STEPS_.map(function (step) {
    var done = !!(saved && saved[step.key]);
    return { key: step.key, group: step.group, label: step.label, done: done };
  });
}

function closeoutStatus_(items) {
  var open = items.filter(function (item) { return !item.done; });
  return { status: open.length ? 'Incomplete' : 'Complete', open: open.map(function (item) { return item.label; }) };
}

function closeoutView_(record) {
  var items = closeoutItems_(record.steps);
  var score = closeoutStatus_(items);
  return {
    date: record.date,
    displayDate: briefDisplayDate_(record.date),
    manager: record.manager,
    notes: record.notes,
    items: items,
    status: score.status,
    open: score.open,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function closeout_(payload) {
  var today = todayNy_();
  var requested = isoDate_(payload && payload.date) || today;
  if (requested > today) requested = today;
  var rows = closeoutRows_().sort(function (left, right) { return left.date < right.date ? 1 : -1; });
  var current = null;
  rows.forEach(function (row) { if (row.date === requested) current = row; });
  var blank = { date: requested, manager: '', steps: {}, notes: '', status: 'Incomplete', completedAt: '', updatedAt: '', updatedBy: '' };
  return {
    role: payload.session ? payload.session.role : '',
    version: APP_VERSION_,
    kind: 'closeout',
    mail: false,
    checksAlarm: false,
    today: today,
    date: requested,
    current: closeoutView_(current || blank),
    history: rows.slice(0, 30).map(closeoutView_),
    steps: CLOSEOUT_STEPS_.map(function (step) { return { key: step.key, group: step.group, label: step.label }; }),
    notice: 'These boxes are the closing manager’s attestation. This page does not send the end-of-day email and does not check the locks or the alarm. Do not type an alarm code or a lock combination.',
  };
}

function saveCloseout_(payload) {
  payload = payload || {};
  var today = todayNy_();
  var date = isoDate_(payload.date) || today;
  if (!date || date > today) throw new Error('Choose a closing date that is not in the future.');
  var manager = closeoutManager_(payload.manager);
  var notes = closeoutNote_(payload.notes);
  var incoming = payload.steps || {};
  var steps = {};
  CLOSEOUT_STEPS_.forEach(function (step) { steps[step.key] = incoming[step.key] === true || String(incoming[step.key] || '') === 'yes'; });
  var score = closeoutStatus_(closeoutItems_(steps));
  var now = new Date().toISOString();
  var by = payload.session && (payload.session.username || payload.session.role) ? String(payload.session.username || payload.session.role) : 'manager';
  var prior = null;
  closeoutRows_().forEach(function (row) { if (row.date === date) prior = row; });
  var completedAt = score.status === 'Complete' ? ((prior && prior.completedAt) || now) : '';
  var record = {
    date: date,
    manager: manager,
    steps: steps,
    notes: notes,
    status: score.status,
    completedAt: completedAt,
    updatedAt: now,
    updatedBy: by,
  };
  var tab = closeoutSheet_();
  var values = tab.getDataRange().getValues();
  var line = [date, manager, JSON.stringify(steps), notes, score.status, completedAt, now, by];
  var index = -1;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) === date) index = r;
  }
  if (index === -1) tab.getRange(Math.max(tab.getLastRow(), 1) + 1, 1, 1, line.length).setValues([line]);
  else tab.getRange(index + 1, 1, 1, line.length).setValues([line]);
  forgetRead_(CLOSEOUT_TAB_);
  var page = closeout_(payload);
  page.saved = true;
  return page;
}
