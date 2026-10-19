/**
 * New-hire training progress. Managers mark each block and confirm floor readiness.
 * The page does not score quizzes, does not approve anyone by itself, and does not change the roster or a sales goal.
 * Day files come from the Document Center when they are there. A missing file stays missing.
 */

var TRAINING_TAB_ = 'CC_Training';
var TRAINING_HEADERS_ = ['id', 'name', 'hire_date', 'start_date', 'blocks', 'ready', 'ready_initials', 'ready_at', 'notes', 'updated_at', 'updated_by'];
var TRAINING_BLOCKS_ = [
  { key: 'day1-materials', day: 1, label: 'Day 1 approved training materials.' },
  { key: 'day2-materials', day: 2, label: 'Day 2 approved training materials.' },
  { key: 'day3-materials', day: 3, label: 'Day 3 approved training materials.' },
  { key: 'day4-materials', day: 4, label: 'Day 4 approved training materials.' },
  { key: 'day4-shadow', day: 4, label: 'Two-hour Customer Service shadowing. Teach how order errors create avoidable service issues.', track: 'practice' },
  { key: 'day5-materials', day: 5, label: 'Day 5 approved training materials.' },
  { key: 'day5-roleplay', day: 5, label: 'Customer role-play.', track: 'roleplay' },
  { key: 'day5-objections', day: 5, label: 'Basic objections.', track: 'roleplay' },
  { key: 'day5-floor', day: 5, label: 'Supervised floor exposure.', track: 'practice' },
  { key: 'day5-ticket', day: 5, label: 'Dummy ticket writing.', track: 'ticket' },
  { key: 'day5-checklist', day: 5, label: 'Use of the Sales Order Completion Checklist.', track: 'ticket' },
];
var TRAINING_GOALS_ = [
  { month: 1, amount: 0, text: '$0', note: 'Month 1 is training. The written goal is $0.' },
  { month: 2, amount: 45000, text: '$45,000', note: 'Month 2 written goal is $45,000.' },
  { month: 3, amount: 45000, text: '$45,000', note: 'Month 3 written goal is $45,000.' },
  { month: 4, amount: 65000, text: '$65,000', note: 'Month 4 onward written goal is $65,000.' },
];

function trainingClean_(value, max) {
  return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function trainingName_(value) {
  var text = trainingClean_(value, 40);
  if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(text)) throw new Error('Enter the new hire’s name.');
  return text;
}

function trainingInitials_(value, required) {
  var text = trainingClean_(value, 4).toUpperCase();
  if (!text && !required) return '';
  if (!/^[A-Z]{2,4}$/.test(text)) throw new Error('Enter the trainer or manager initials, two to four letters.');
  return text;
}

function trainingNote_(value) {
  var text = trainingClean_(value, 240);
  if (/\b(score|quiz|test result|percent|grade)\b/i.test(text) || /\b\d{2,}\b/.test(text)) throw new Error('Do not store a test score, quiz result, or a long number in the notes.');
  return text;
}

function trainingSheet_() {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(TRAINING_TAB_);
  if (!tab) {
    tab = spreadsheet.insertSheet(TRAINING_TAB_);
    tab.getRange(1, 1, 1, TRAINING_HEADERS_.length).setValues([TRAINING_HEADERS_]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function trainingRows_() {
  return sheet_(TRAINING_TAB_).map(function (row) {
    var blocks = {};
    try { blocks = JSON.parse(String(row.blocks || '{}')); } catch (error) { blocks = {}; }
    return {
      id: trainingClean_(row.id, 40),
      name: trainingClean_(row.name, 40),
      hireDate: isoDate_(row.hire_date),
      startDate: isoDate_(row.start_date),
      blocks: blocks,
      ready: String(row.ready || '') === 'yes',
      readyInitials: trainingClean_(row.ready_initials, 4).toUpperCase(),
      readyAt: trainingClean_(row.ready_at, 40),
      notes: trainingClean_(row.notes, 240),
      updatedAt: trainingClean_(row.updated_at, 40),
      updatedBy: trainingClean_(row.updated_by, 40),
    };
  }).filter(function (row) { return row.id && row.name; });
}

function trainingLibrary_() {
  var docs = [];
  try {
    docRows_().forEach(function (row) {
      var view = docView_(row);
      if (view.status !== 'active' || !view.id) return;
      var text = (view.title + ' ' + view.category + ' ' + view.subcategory + ' ' + view.fileName).toLowerCase();
      if (view.category !== 'New Hire' && view.category !== 'Training' && !/training|new hire|role-play|role play|checklist|shadow/.test(text)) return;
      docs.push({ id: view.id, title: view.title, category: view.category, subcategory: view.subcategory, text: text });
    });
  } catch (error) { docs = []; }
  return docs;
}

function trainingLinks_(block, docs) {
  return docs.filter(function (doc) {
    if (block.key === 'day4-shadow') return /shadow|customer service/.test(doc.text);
    if (block.key === 'day5-roleplay' || block.key === 'day5-objections') return /role-play|role play|objection/.test(doc.text);
    if (block.key === 'day5-ticket' || block.key === 'day5-checklist') return /checklist|ticket/.test(doc.text);
    if (block.key === 'day5-floor') return /supervised|floor exposure/.test(doc.text);
    if (new RegExp('day\\s*0?' + block.day + '\\b').test(doc.text)) return true;
    return /-materials$/.test(block.key) && /day\s*1\s*[\u2013\-]\s*5|days?\s*1\s*(through|to)\s*5/.test(doc.text);
  }).map(function (doc) {
    return { id: doc.id, title: doc.title, category: doc.category, subcategory: doc.subcategory };
  });
}

function trainingItems_(saved, docs) {
  var prior = saved || {};
  return TRAINING_BLOCKS_.map(function (block) {
    var row = prior[block.key] || {};
    var done = !!row.done;
    return {
      key: block.key,
      day: block.day,
      label: block.label,
      track: block.track || '',
      done: done,
      initials: done ? trainingClean_(row.initials, 4).toUpperCase() : '',
      at: done ? trainingClean_(row.at, 40) : '',
      by: done ? trainingClean_(row.by, 40) : '',
      links: trainingLinks_(block, docs),
    };
  });
}

function trainingDay_(start, today) {
  if (!start) return { number: null, calendarDay: null, label: 'Set the training start date.' };
  if (start > today) return { number: 0, calendarDay: 0, label: 'Training has not started.' };
  var calendar = daysBetween_(start, today) + 1;
  if (calendar > 5) return { number: 5, calendarDay: calendar, label: 'Calendar day ' + calendar + '. The five training days are past. That does not mean this associate is ready for the floor.' };
  return { number: calendar, calendarDay: calendar, label: 'Day ' + calendar + ' of 5.' };
}

function trainingGoalNow_(hire, today) {
  if (!hire) return { month: null, text: 'Pending', note: 'Hire date is not on file, so the written goal stays Pending.' };
  var goal = evalPrepVolumeGoal_(evalPrepServiceMonth_(hire, today.slice(0, 7) + '-01'));
  return { month: evalPrepServiceMonth_(hire, today.slice(0, 7) + '-01'), text: goal.text, note: goal.note, amount: goal.amount };
}

function trainingRoster_() {
  var today = todayNy_();
  var rows = [];
  try { rows = sheet_('CC_People').map(function (row) { return rosterRecord_(row, today); }); } catch (error) { rows = []; }
  return rows.filter(function (row) {
    if (!row.onSalesTeam || !row.hireDate || row.currentStatus === 'Terminated') return false;
    var days = daysBetween_(row.hireDate, today);
    return days >= 0 && days < 120;
  }).map(function (row) { return { name: row.name, hireDate: row.hireDate }; });
}

function trainingView_(record, docs, today) {
  var items = trainingItems_(record.blocks, docs);
  var open = items.filter(function (item) { return !item.done; });
  var tracks = {
    practice: items.filter(function (item) { return item.track === 'practice' && item.done; }).length + ' of ' + items.filter(function (item) { return item.track === 'practice'; }).length,
    roleplay: items.filter(function (item) { return item.track === 'roleplay' && item.done; }).length + ' of ' + items.filter(function (item) { return item.track === 'roleplay'; }).length,
    ticket: items.filter(function (item) { return item.track === 'ticket' && item.done; }).length + ' of ' + items.filter(function (item) { return item.track === 'ticket'; }).length,
  };
  var blocksDone = open.length === 0;
  var ready = blocksDone && record.ready;
  var status = ready ? 'Ready for the floor' : (blocksDone ? 'Blocks complete' : 'Incomplete');
  return {
    id: record.id,
    name: record.name,
    hireDate: record.hireDate,
    hireDisplay: record.hireDate ? briefDisplayDate_(record.hireDate) : '',
    startDate: record.startDate,
    startDisplay: record.startDate ? briefDisplayDate_(record.startDate) : '',
    day: trainingDay_(record.startDate, today),
    goal: trainingGoalNow_(record.hireDate, today),
    items: items,
    open: open.map(function (item) { return 'Day ' + item.day + ': ' + item.label; }),
    tracks: tracks,
    blocksDone: blocksDone,
    ready: ready,
    readyInitials: ready ? record.readyInitials : '',
    readyAt: ready ? record.readyAt : '',
    status: status,
    notes: record.notes,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function training_(payload) {
  var today = todayNy_();
  var docs = trainingLibrary_();
  var rows = trainingRows_().sort(function (left, right) { return left.updatedAt < right.updatedAt ? 1 : -1; });
  var wanted = trainingClean_(payload && payload.id, 40);
  var current = null;
  rows.forEach(function (row) { if (row.id === wanted) current = row; });
  return {
    role: payload.session ? payload.session.role : '',
    version: APP_VERSION_,
    kind: 'training',
    mail: false,
    scores: false,
    autoReady: false,
    materialsOnFile: docs.length > 0,
    today: today,
    goals: TRAINING_GOALS_,
    steps: TRAINING_BLOCKS_.map(function (block) { return { key: block.key, day: block.day, label: block.label, track: block.track || '' }; }),
    roster: trainingRoster_(),
    people: rows.map(function (row) { return trainingView_(row, docs, today); }),
    current: current ? trainingView_(current, docs, today) : null,
    notice: docs.length
      ? 'Training files already in the Document Center are linked on the matching day. A file on file is not a completion. A manager marks each block, and floor readiness is a separate confirmation.'
      : 'The approved new-hire packet is not in the Document Center. Upload it under New Hire, Day 1–5 Training Materials. These blocks are only the requirements named for this tracker. Nothing is marked complete until a manager does it.',
  };
}

function saveTraining_(payload) {
  payload = payload || {};
  if (payload.score !== undefined || payload.quiz !== undefined || payload.grade !== undefined) throw new Error('This tracker does not store test scores.');
  var today = todayNy_();
  var name = trainingName_(payload.name);
  var hire = isoDate_(payload.hireDate);
  var start = isoDate_(payload.startDate);
  if (!hire || !start) throw new Error('Enter the hire date and the training start date.');
  if (hire > today) throw new Error('The hire date cannot be in the future.');
  if (start < hire) throw new Error('Training cannot start before the hire date.');
  if (start > today) throw new Error('The training start date cannot be in the future.');
  var notes = trainingNote_(payload.notes);
  var incoming = payload.blocks || {};
  var by = payload.session && (payload.session.username || payload.session.role) ? String(payload.session.username || payload.session.role) : 'manager';
  var now = new Date().toISOString();
  var prior = null;
  var id = trainingClean_(payload.id, 40);
  trainingRows_().forEach(function (row) { if (row.id === id) prior = row; });
  var blocks = {};
  TRAINING_BLOCKS_.forEach(function (block) {
    var row = incoming[block.key] || {};
    var done = row.done === true || String(row.done || '') === 'yes';
    if (!done) return;
    var earlier = prior && prior.blocks ? prior.blocks[block.key] : null;
    blocks[block.key] = {
      done: true,
      initials: trainingInitials_(row.initials, true),
      at: earlier && earlier.at ? trainingClean_(earlier.at, 40) : now,
      by: earlier && earlier.by ? trainingClean_(earlier.by, 40) : by,
    };
  });
  var items = trainingItems_(blocks, []);
  var blocksDone = items.every(function (item) { return item.done; });
  var wantReady = payload.ready === true || String(payload.ready || '') === 'yes';
  if (wantReady && !blocksDone) throw new Error('Floor readiness stays open until every training block is marked. Five calendar days do not make this associate ready.');
  var readyInitials = wantReady ? trainingInitials_(payload.readyInitials, true) : '';
  var readyAt = '';
  if (wantReady) readyAt = prior && prior.ready && prior.readyAt ? prior.readyAt : now;
  var recordId = prior ? prior.id : (id || Utilities.getUuid());
  var line = [recordId, name, hire, start, JSON.stringify(blocks), wantReady ? 'yes' : '', readyInitials, readyAt, notes, now, by];
  var tab = trainingSheet_();
  var values = tab.getDataRange().getValues();
  var index = -1;
  var r;
  for (r = 1; r < values.length; r += 1) if (trainingClean_(values[r][0], 40) === recordId) index = r;
  if (index === -1) tab.getRange(Math.max(tab.getLastRow(), 1) + 1, 1, 1, line.length).setValues([line]);
  else tab.getRange(index + 1, 1, 1, line.length).setValues([line]);
  forgetRead_(TRAINING_TAB_);
  var page = training_({ session: payload.session, id: recordId });
  page.saved = true;
  return page;
}
