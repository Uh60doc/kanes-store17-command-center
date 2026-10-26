/**
 * OPTL — Online Performance Tracking Log (Stage 2 in development).
 * Spec authority: STORE17_OPTL_COMPLETE_CURSOR_SPEC_V1_3.md (supersedes v1.2).
 * Own Admin-area system. Synthetic demo records only. Does not write sales sheets.
 * Unlinked occurrence expiration: incident date + 180 Store 17 local calendar days.
 * STEP I/II/III are display labels; PIP I/II/III remain internal aliases.
 * No live personnel Sheet, no email send, no auto-termination.
 */

var OPTL_OCCURRENCE_DAYS_ = 180;
var OPTL_STORE_TZ_ = 'America/New_York';

var OPTL_SECTION_A_ = ['Safety', 'Sales Performance', 'Quality of Orders', 'Behavior'];
var OPTL_SECTION_B_ = ['Attendance', 'Tardy'];
var OPTL_SLOT_KEYS_ = [
  'occurrence-1', 'occurrence-2', 'occurrence-3', 'occurrence-4', 'step-i',
  'occurrence-5', 'occurrence-6', 'step-ii', 'occurrence-7', 'step-iii',
  'occurrence-8', 'term',
];
var OPTL_SLOT_LABELS_ = {
  'occurrence-1': 'Occ 1', 'occurrence-2': 'Occ 2', 'occurrence-3': 'Occ 3', 'occurrence-4': 'Occ 4',
  'step-i': 'STEP I', 'occurrence-5': 'Occ 5', 'occurrence-6': 'Occ 6', 'step-ii': 'STEP II',
  'occurrence-7': 'Occ 7', 'step-iii': 'STEP III', 'occurrence-8': 'Occ 8', term: 'TERM',
};
/** Online STEP colors (print remains grayscale words). */
var OPTL_STEP_TONES_ = { 'step-i': 'step-yellow', 'step-ii': 'step-orange', 'step-iii': 'step-red', term: 'step-term' };
var OPTL_OCC_SLOTS_ = [
  'occurrence-1', 'occurrence-2', 'occurrence-3', 'occurrence-4',
  'occurrence-5', 'occurrence-6', 'occurrence-7', 'occurrence-8',
];

/** Declared managers for shared-login audit (manager-declared, not verified identity). */
var OPTL_DEMO_ACTING_MANAGERS_ = [
  'Pat Nguyen (GM)',
  'Sam Ortiz (ASM)',
  'Riley Chen (Floor Manager)',
];

function optlAddCalendarDays_(isoDate, days) {
  var parts = String(isoDate).slice(0, 10).split('-');
  var utc = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  utc.setUTCDate(utc.getUTCDate() + days);
  return Utilities.formatDate(utc, 'UTC', 'yyyy-MM-dd');
}

function optlOccurrenceExpiration_(incidentDate) {
  return optlAddCalendarDays_(incidentDate, OPTL_OCCURRENCE_DAYS_);
}

/** Active while asOf is strictly before the expiration calendar day. */
function optlUnlinkedActive_(incidentDate, asOfDate, expirationDate) {
  var exp = expirationDate || optlOccurrenceExpiration_(incidentDate);
  return String(asOfDate).slice(0, 10) < String(exp).slice(0, 10);
}

function optlToday_() {
  return Utilities.formatDate(new Date(), OPTL_STORE_TZ_, 'yyyy-MM-dd');
}

/**
 * Store 17 late-arrival classification (v1.2/v1.3 confirmed).
 * 0–15 min: none; 16–119: Tardy; 120+: Attendance (exactly 120 is Attendance).
 */
function optlLateClassification_(minutesLate) {
  var minutes = Number(minutesLate);
  if (!isFinite(minutes) || minutes < 0) {
    return { category: null, section: null, label: null, reason: 'invalid-minutes' };
  }
  if (minutes <= 15) {
    return { category: null, section: null, label: null, reason: 'within-grace' };
  }
  if (minutes < 120) {
    return {
      category: 'Tardy',
      section: 'B',
      label: 'Late — ' + Math.round(minutes) + ' min',
      reason: 'tardy',
    };
  }
  var hours = minutes / 60;
  var hourLabel = Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 10) / 10);
  return {
    category: 'Attendance',
    section: 'B',
    label: 'Late — ' + hourLabel + ' hr',
    reason: 'attendance',
  };
}

/** GM Stage 2 decision (4): typed full name + checkbox; no SSN. */
function optlAcknowledgmentSpec_() {
  return {
    mode: 'typed-full-name-plus-checkbox',
    requiresSsn: false,
    signatureRequiredForOfficial: false,
    officialAt: 'manager-issuance',
    fields: ['typedFullName', 'acknowledgedCheckbox', 'acknowledgedAt'],
    note: 'Ordinary acknowledgment is typed full name plus an explicit checkbox. Official STEP timing is manager issuance, not employee signature.',
  };
}

function optlDemoEmployees_() {
  return [
    {
      employeeId: 'S17-DEMO-101',
      displayName: 'FICTIONAL DEMO 101 — Not a real employee',
      jobTitle: 'Fictional demo only — not HR',
      department: 'Sales',
      hireDate: '2024-03-12',
      status: 'active',
      separationDate: null,
      employmentPeriods: [
        { periodId: 'emp-101-a', hireDate: '2024-03-12', separationDate: null, status: 'active' },
      ],
    },
    {
      employeeId: 'S17-DEMO-102',
      displayName: 'FICTIONAL DEMO 102 — Not a real employee',
      jobTitle: 'Fictional demo only — not HR',
      department: 'Sales',
      hireDate: '2023-08-01',
      status: 'active',
      separationDate: null,
      employmentPeriods: [
        { periodId: 'emp-102-a', hireDate: '2023-08-01', separationDate: null, status: 'active' },
      ],
    },
    {
      employeeId: 'S17-DEMO-103',
      displayName: 'FICTIONAL DEMO 103 — Not a real employee',
      jobTitle: 'Fictional demo only — not HR',
      department: 'Sales',
      hireDate: '2025-01-06',
      status: 'active',
      separationDate: null,
      employmentPeriods: [
        { periodId: 'emp-103-a', hireDate: '2025-01-06', separationDate: null, status: 'active' },
      ],
    },
    {
      employeeId: 'S17-DEMO-199',
      displayName: 'FICTIONAL DEMO 199 — Not a real employee (Former)',
      jobTitle: 'Fictional demo only — not HR',
      department: 'Sales',
      hireDate: '2022-01-10',
      status: 'former',
      separationDate: '2026-06-15',
      employmentPeriods: [
        { periodId: 'emp-199-a', hireDate: '2022-01-10', separationDate: '2026-06-15', status: 'ended' },
      ],
    },
  ];
}

/**
 * Synthetic demo events. Tardy quantitativeDetail must be >15 minutes (v1.3).
 * Jordan has 4 Safety occurrences → pending STEP I lock for Stage 2 demo.
 * Taylor has STEP I issued with linked freeze for chain demo.
 */
function optlDemoEvents_() {
  return [
    // Alex — valid tardies (>15); oldest will expire by 2026-10-25 asOf
    {
      eventId: 'evt-demo-001', employeeId: 'S17-DEMO-101', employmentPeriodId: 'emp-101-a',
      incidentDate: '2026-01-15', section: 'B', category: 'Tardy', entryType: 'Occurrence',
      shortDescription: 'Tardy — 22 min', quantitativeDetail: 22, status: 'active', scored: true,
      originalExpirationDate: '2026-07-14', effectiveExpirationDate: '2026-07-14',
    },
    {
      eventId: 'evt-demo-002', employeeId: 'S17-DEMO-101', employmentPeriodId: 'emp-101-a',
      incidentDate: '2026-08-20', section: 'B', category: 'Tardy', entryType: 'Occurrence',
      shortDescription: 'Tardy — 25 min', quantitativeDetail: 25, status: 'active', scored: true,
      originalExpirationDate: '2027-02-16', effectiveExpirationDate: '2027-02-16',
    },
    {
      eventId: 'evt-demo-003', employeeId: 'S17-DEMO-101', employmentPeriodId: 'emp-101-a',
      incidentDate: '2026-09-05', section: 'A', category: 'Safety', entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2027-03-04', effectiveExpirationDate: '2027-03-04',
    },
    {
      eventId: 'evt-demo-004', employeeId: 'S17-DEMO-101', employmentPeriodId: 'emp-101-a',
      incidentDate: '2026-09-28', section: 'A', category: 'Quality of Orders', entryType: 'Occurrence',
      shortDescription: 'Error on Ticket', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2027-03-27', effectiveExpirationDate: '2027-03-27',
    },
    {
      eventId: 'evt-demo-005', employeeId: 'S17-DEMO-101', employmentPeriodId: 'emp-101-a',
      incidentDate: '2026-04-01', section: 'A', category: 'Behavior', entryType: 'Occurrence',
      shortDescription: 'Unacceptable Behavior', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2026-09-28', effectiveExpirationDate: '2026-09-28',
    },
    // Jordan — one Sales Performance (no lock) … replaced by four Safety for pending STEP demo
    {
      eventId: 'evt-demo-006', employeeId: 'S17-DEMO-102', employmentPeriodId: 'emp-102-a',
      incidentDate: '2026-07-10', section: 'A', category: 'Safety', entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2027-01-06', effectiveExpirationDate: '2027-01-06',
    },
    {
      eventId: 'evt-demo-007', employeeId: 'S17-DEMO-102', employmentPeriodId: 'emp-102-a',
      incidentDate: '2026-08-02', section: 'A', category: 'Safety', entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2027-01-29', effectiveExpirationDate: '2027-01-29',
    },
    {
      eventId: 'evt-demo-008', employeeId: 'S17-DEMO-102', employmentPeriodId: 'emp-102-a',
      incidentDate: '2026-09-12', section: 'A', category: 'Safety', entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2027-03-11', effectiveExpirationDate: '2027-03-11',
    },
    {
      eventId: 'evt-demo-009', employeeId: 'S17-DEMO-102', employmentPeriodId: 'emp-102-a',
      incidentDate: '2026-10-02', section: 'A', category: 'Safety', entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior', quantitativeDetail: null, status: 'active', scored: true,
      originalExpirationDate: '2027-03-31', effectiveExpirationDate: '2027-03-31',
    },
    // Taylor — four Behavior + late-issued STEP I (clock = incident date of 4th occ; chain freeze +365)
    {
      eventId: 'evt-demo-010', employeeId: 'S17-DEMO-103', employmentPeriodId: 'emp-103-a',
      incidentDate: '2026-03-01', section: 'A', category: 'Behavior', entryType: 'Occurrence',
      shortDescription: 'Unacceptable Behavior', quantitativeDetail: null, status: 'active', scored: true,
      chainId: 'chain-103-beh', originalExpirationDate: '2026-08-28', effectiveExpirationDate: '2027-06-15',
      freezeReason: 'Inherited from STEP_I issued for incident 2026-06-15',
    },
    {
      eventId: 'evt-demo-011', employeeId: 'S17-DEMO-103', employmentPeriodId: 'emp-103-a',
      incidentDate: '2026-04-12', section: 'A', category: 'Behavior', entryType: 'Occurrence',
      shortDescription: 'Unacceptable Behavior', quantitativeDetail: null, status: 'active', scored: true,
      chainId: 'chain-103-beh', originalExpirationDate: '2026-10-09', effectiveExpirationDate: '2027-06-15',
      freezeReason: 'Inherited from STEP_I issued for incident 2026-06-15',
    },
    {
      eventId: 'evt-demo-012', employeeId: 'S17-DEMO-103', employmentPeriodId: 'emp-103-a',
      incidentDate: '2026-05-20', section: 'A', category: 'Behavior', entryType: 'Occurrence',
      shortDescription: 'Unacceptable Behavior', quantitativeDetail: null, status: 'active', scored: true,
      chainId: 'chain-103-beh', originalExpirationDate: '2026-11-16', effectiveExpirationDate: '2027-06-15',
      freezeReason: 'Inherited from STEP_I issued for incident 2026-06-15',
    },
    {
      eventId: 'evt-demo-013', employeeId: 'S17-DEMO-103', employmentPeriodId: 'emp-103-a',
      incidentDate: '2026-06-15', section: 'A', category: 'Behavior', entryType: 'Occurrence',
      shortDescription: 'Unacceptable Behavior', quantitativeDetail: null, status: 'active', scored: true,
      chainId: 'chain-103-beh', originalExpirationDate: '2026-12-12', effectiveExpirationDate: '2027-06-15',
      freezeReason: 'Inherited from STEP_I issued for incident 2026-06-15',
    },
    {
      eventId: 'evt-demo-014', employeeId: 'S17-DEMO-103', employmentPeriodId: 'emp-103-a',
      incidentDate: '2026-06-15', entryAt: '2026-07-01', section: 'A', category: 'Behavior', entryType: 'STEP_I',
      shortDescription: 'STEP I — Behavior', quantitativeDetail: null, status: 'active', scored: true,
      chainId: 'chain-103-beh', originalExpirationDate: '2027-06-15', effectiveExpirationDate: '2027-06-15',
      officialAtIssuance: true, createdByDeclared: 'Pat Nguyen (GM)',
    },
  ];
}

function optlSortEvents_(left, right) {
  if (left.incidentDate !== right.incidentDate) return left.incidentDate < right.incidentDate ? -1 : 1;
  return String(left.eventId).localeCompare(String(right.eventId));
}

function optlCategoryView_(events, section, category, asOfDate) {
  var usable = events.filter(function (event) {
    return event.section === section && event.category === category && event.entryType === 'Occurrence' && event.status === 'active';
  }).slice().sort(optlSortEvents_);
  var active = [];
  var expired = [];
  usable.forEach(function (event) {
    var expirationDate = event.effectiveExpirationDate || optlOccurrenceExpiration_(event.incidentDate);
    if (optlUnlinkedActive_(event.incidentDate, asOfDate, expirationDate)) {
      if (active.length < OPTL_OCC_SLOTS_.length) {
        active.push({
          eventId: event.eventId,
          incidentDate: event.incidentDate,
          expirationDate: expirationDate,
          shortDescription: event.shortDescription,
          slotKey: OPTL_OCC_SLOTS_[active.length],
        });
      }
    } else {
      expired.push({
        eventId: event.eventId,
        incidentDate: event.incidentDate,
        expirationDate: expirationDate,
        shortDescription: event.shortDescription,
      });
    }
  });
  return { section: section, category: category, active: active, expired: expired };
}

function optlMatrixRow_(view) {
  var bySlot = {};
  view.active.forEach(function (item) { bySlot[item.slotKey] = item; });
  return {
    section: view.section,
    category: view.category,
    cells: OPTL_SLOT_KEYS_.map(function (slotKey) {
      var hit = bySlot[slotKey];
      return {
        slotKey: slotKey,
        slotLabel: OPTL_SLOT_LABELS_[slotKey],
        occupied: !!hit,
        eventId: hit ? hit.eventId : null,
        incidentDate: hit ? hit.incidentDate : null,
        expirationDate: hit ? hit.expirationDate : null,
        shortDescription: hit ? hit.shortDescription : null,
        stepTone: OPTL_STEP_TONES_[slotKey] || null,
        pipState: 'none',
        reviewRequired: false,
      };
    }),
  };
}

function optlHistoryLines_(view) {
  var lines = view.active.map(function (item) {
    return {
      eventId: item.eventId,
      incidentDate: item.incidentDate,
      section: view.section,
      category: view.category,
      entryType: 'Occurrence',
      shortDescription: item.shortDescription,
      originalExpirationDate: item.expirationDate,
      effectiveExpirationDate: item.expirationDate,
      status: 'active',
    };
  }).concat(view.expired.map(function (item) {
    return {
      eventId: item.eventId,
      incidentDate: item.incidentDate,
      section: view.section,
      category: view.category,
      entryType: 'Occurrence',
      shortDescription: item.shortDescription,
      originalExpirationDate: item.expirationDate,
      effectiveExpirationDate: item.expirationDate,
      status: 'expired',
    };
  }));
  return lines.sort(optlSortEvents_);
}

function optlEmployeeView_(events, employeeId, asOfDate) {
  var forEmployee = events.filter(function (event) { return event.employeeId === employeeId; });
  var rows = [];
  var history = [];
  function add(section, categories) {
    categories.forEach(function (category) {
      var view = optlCategoryView_(forEmployee, section, category, asOfDate);
      rows.push(optlMatrixRow_(view));
      history = history.concat(optlHistoryLines_(view));
    });
  }
  add('A', OPTL_SECTION_A_);
  add('B', OPTL_SECTION_B_);
  history.sort(optlSortEvents_);
  return { matrixRows: rows, history: history };
}

var OPTL_STATE_PROP_KEY_ = 'optl_demo_state_v13';
var OPTL_PROP_CHUNK_CHARS_ = 8000;

function optlCloneDemoState_() {
  var state = optlEmptyState_();
  state.employees = JSON.parse(JSON.stringify(optlDemoEmployees_()));
  state.events = JSON.parse(JSON.stringify(optlDemoEvents_()));
  state.alertConfig = {
    commandCenter: true,
    emailEnabled: false,
    emailRecipients: [],
    testSendingDisabled: true,
    gmEmailAuthorized: false,
    note: 'Command Center alerts are recorded in-app. Live email stays off until recipients are verified and the GM authorizes delivery.',
  };
  return state;
}

/** Script properties cap each value at 9KB. Chunk so a saved entry still reloads after refresh. */
function optlSaveStateProperties_(state) {
  if (typeof PropertiesService === 'undefined') return false;
  var props = PropertiesService.getScriptProperties();
  var json = JSON.stringify(state);
  var count = Math.max(1, Math.ceil(json.length / OPTL_PROP_CHUNK_CHARS_));
  var previous = Number(props.getProperty(OPTL_STATE_PROP_KEY_ + '_n') || 0);
  var batch = {};
  var index;
  for (index = 0; index < count; index += 1) {
    batch[OPTL_STATE_PROP_KEY_ + '_' + index] = json.substring(index * OPTL_PROP_CHUNK_CHARS_, (index + 1) * OPTL_PROP_CHUNK_CHARS_);
  }
  for (index = count; index < previous; index += 1) {
    batch[OPTL_STATE_PROP_KEY_ + '_' + index] = '';
  }
  batch[OPTL_STATE_PROP_KEY_ + '_n'] = String(count);
  batch[OPTL_STATE_PROP_KEY_] = '';
  if (typeof props.setProperties === 'function') {
    props.setProperties(batch);
  } else {
    Object.keys(batch).forEach(function (key) { props.setProperty(key, batch[key]); });
  }
  return true;
}

function optlLoadStateProperties_() {
  if (typeof PropertiesService === 'undefined') return null;
  var props = PropertiesService.getScriptProperties();
  var count = Number(props.getProperty(OPTL_STATE_PROP_KEY_ + '_n') || 0);
  var json = '';
  if (count > 0) {
    var index;
    for (index = 0; index < count; index += 1) {
      json += props.getProperty(OPTL_STATE_PROP_KEY_ + '_' + index) || '';
    }
  } else {
    json = props.getProperty(OPTL_STATE_PROP_KEY_) || '';
  }
  if (!json) return null;
  var parsed = JSON.parse(json);
  if (!parsed || !parsed.employees || !parsed.events) return null;
  return parsed;
}

/**
 * Load OPTL state. Dedicated workbook when OPTL_SPREADSHEET_ID is set; otherwise
 * script properties hold the fictional demo so refreshes survive without a sales-sheet write.
 */
function optlLoadState_() {
  var bookId = optlSpreadsheetId_();
  if (bookId && typeof SpreadsheetApp !== 'undefined') {
    var fromBook = optlLoadStateFromBook_(optlOpenDedicatedBook_(bookId));
    if (fromBook) return fromBook;
  }
  try {
    var fromProps = optlLoadStateProperties_();
    if (fromProps) return fromProps;
  } catch (ignore) {}
  return optlCloneDemoState_();
}

/**
 * Dedicated workbook is the source of truth once OPTL_SPREADSHEET_ID is set.
 * Script properties are the fallback only, so a successful sheet save does not
 * also rewrite every property chunk.
 */
function optlSaveState_(state, tabs) {
  var started = Date.now();
  var bookId = optlSpreadsheetId_();
  if (bookId && typeof SpreadsheetApp !== 'undefined') {
    optlSaveStateToBook_(optlOpenDedicatedBook_(bookId), state, tabs);
    return { elapsedMs: Date.now() - started, storage: 'dedicated-sheet', savedBook: true };
  }
  if (!optlSaveStateProperties_(state)) {
    throw new Error('OPTL could not save. The sales spreadsheet was not used.');
  }
  return { elapsedMs: Date.now() - started, storage: 'properties', savedBook: false };
}

function optlTabsForAction_(action) {
  if (action === 'addEvent' || action === 'issueFormal') return ['OPTL_Events', 'OPTL_Audit', 'OPTL_Pending', 'OPTL_Alerts'];
  if (action === 'voidEvent') return ['OPTL_Events', 'OPTL_Audit', 'OPTL_Pending', 'OPTL_Exceptions', 'OPTL_Alerts'];
  if (action === 'newHire' || action === 'terminate' || action === 'rehire') return ['OPTL_Employees', 'OPTL_Periods', 'OPTL_Audit'];
  if (action === 'acknowledge') return ['OPTL_Acknowledgments', 'OPTL_Audit'];
  if (action === 'flagReview') return ['OPTL_Exceptions', 'OPTL_Audit'];
  return null;
}

function optlReplayRequest_(state, requestId) {
  if (!requestId) return null;
  var log = null;
  (state.requestLog || []).forEach(function (row) {
    if (row.id === requestId) log = row;
  });
  if (!log) return null;
  var replay = {
    ok: true,
    saved: true,
    duplicate: true,
    action: log.action,
    message: 'Already saved. Duplicate click ignored.',
    state: state,
  };
  (state.events || []).forEach(function (event) {
    if (log.eventId && event.eventId === log.eventId) replay.event = event;
  });
  (state.employees || []).forEach(function (row) {
    if (log.employeeId && row.employeeId === log.employeeId) replay.employee = row;
  });
  return replay;
}

function optlRememberRequest_(state, payload, result) {
  var requestId = String((payload && payload.clientRequestId) || '').trim();
  if (!requestId) return;
  state.requestLog = state.requestLog || [];
  state.requestLog.push({
    id: requestId,
    action: result.action,
    eventId: result.event ? result.event.eventId : '',
    employeeId: (result.event && result.event.employeeId) || (result.employee && result.employee.employeeId) || '',
    message: result.message || 'Saved.',
  });
  if (state.requestLog.length > 200) state.requestLog = state.requestLog.slice(-200);
}

function optlCommitAction_(state, payload, result) {
  if (!result.message) result.message = 'Saved.';
  optlRememberRequest_(state, payload, result);
  var timing = optlSaveState_(state, optlTabsForAction_(result.action));
  result.saved = true;
  result.ok = result.ok !== false;
  result.elapsedMs = timing.elapsedMs;
  result.storage = timing.storage;
  result.message = result.message + ' · ' + timing.storage + ' · ' + timing.elapsedMs + ' ms';
  result.state = state;
  return result;
}

function optlStandardLabels_() {
  return {
    Safety: ['Unsafe Behavior'],
    'Sales Performance': ['Below Goal'],
    'Quality of Orders': ['Error on Ticket'],
    Behavior: ['Unacceptable Behavior'],
    Attendance: ['Absent'],
    Tardy: ['Late'],
  };
}

function optlActorPayload_(payload) {
  return {
    actingManagerDeclared: payload && payload.actingManagerDeclared,
    actingManagerConfirmed: payload && payload.actingManagerConfirmed === true,
    asOfDate: payload && payload.asOfDate,
    reason: payload && payload.reason,
  };
}

function optlApplyAction_(state, payload) {
  var action = String((payload && payload.action) || '');
  var actor = optlActorPayload_(payload);
  var draft = (payload && payload.draft) || {};
  var result = { ok: true, action: action, saved: false };
  if (!action || action === 'load' || action === 'preview') return result;
  var requestId = String((payload && payload.clientRequestId) || '').trim();
  var replay = optlReplayRequest_(state, requestId);
  if (replay) return replay;
  if (action === 'resetDemo') {
    optlAssertActingManager_(actor);
    state = optlCloneDemoState_();
    result.message = 'Saved. Demo data was reset.';
    return optlCommitAction_(state, payload, result);
  }
  if (action === 'addEvent') {
    result.event = optlAddEvent_(state, draft, actor);
    result.message = 'Saved. The entry is on the active matrix and in permanent history.';
  } else if (action === 'issueFormal') {
    result.resolved = optlResolveEffectiveLevel_(state, draft, actor.asOfDate);
    if (payload.previewOnly) {
      result.message = 'Preview only — not issued';
      return result;
    }
    if (result.resolved.adjusted && !payload.acceptEffective) {
      result.ok = false;
      result.needsConfirm = true;
      result.message = result.resolved.reason;
      return result;
    }
    if (result.resolved.adjusted) draft.entryType = result.resolved.effective;
    result.event = optlIssueFormalAction_(state, draft, actor);
    result.message = 'Saved. Formal action issued.';
  } else if (action === 'voidEvent') {
    result.event = optlVoidEvent_(state, draft.eventId || payload.eventId, actor);
    result.message = 'Saved. The record was voided. History was kept.';
  } else if (action === 'newHire') {
    result.employee = optlNewHireEmployee_(state, draft, actor);
    result.message = 'Saved. New hire recorded.';
  } else if (action === 'terminate') {
    result.employee = optlTerminateEmployee_(state, draft.employeeId || payload.employeeId, draft, actor);
    result.message = 'Saved. Termination recorded. History was kept.';
  } else if (action === 'acknowledge') {
    result.acknowledgment = optlAcknowledgeEvent_(state, draft.eventId || payload.eventId, draft, actor);
    result.message = 'Saved. Acknowledgment recorded.';
  } else if (action === 'flagReview') {
    result.exception = optlFlagReviewRequired_(state, draft, actor);
    result.message = 'Saved. Review flag recorded.';
  } else if (action === 'rehire') {
    result.employee = optlRehireEmployee_(state, draft.employeeId || payload.employeeId, draft.hireDate || optlToday_(), actor);
    result.message = 'Saved. Rehire recorded. Prior history was kept.';
  } else {
    throw new Error('Unknown OPTL action: ' + action);
  }
  return optlCommitAction_(state, payload, result);
}

function optlDashboard_(state, asOf) {
  var pending = [];
  var exceptions = [];
  (state.pendingActions || []).forEach(function (row) {
    if (row.status === 'open') pending.push(row);
  });
  (state.exceptions || []).forEach(function (row) {
    if (row.status === 'open') exceptions.push(row);
  });
  return {
    pendingCount: pending.length,
    exceptionCount: exceptions.length,
    pending: pending,
    exceptions: exceptions,
    alerts: (state.alerts || []).slice(0, 25),
    alertConfig: state.alertConfig,
  };
}

function optlBuildPage_(state, payload, actionResult) {
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var employees = state.employees || [];
  var selectedId = String((payload && payload.employeeId) || '') ||
    (employees.filter(function (row) { return row.status === 'active'; })[0] || employees[0] || {}).employeeId;
  if (actionResult && actionResult.employee && actionResult.employee.employeeId) {
    selectedId = actionResult.employee.employeeId;
  }
  if (actionResult && actionResult.event && actionResult.event.employeeId) {
    selectedId = actionResult.event.employeeId;
  }
  var selected = null;
  employees.forEach(function (row) { if (row.employeeId === selectedId) selected = row; });
  if (!selected) selected = employees[0] || null;
  employees.forEach(function (row) {
    if (row.status === 'active') optlRefreshPending_(state, row.employeeId, asOf);
  });
  var view = selected
    ? optlEngineEmployeeView_(state, selected.employeeId, asOf)
    : { matrixRows: [], history: [], pendingActions: [], exceptions: [], lock: false };
  var actingDeclared = String((payload && payload.actingManagerDeclared) || '').trim();
  var actingConfirmed = !!(payload && payload.actingManagerConfirmed === true);
  var formalEvents = (state.events || []).filter(function (event) {
    return selected && event.employeeId === selected.employeeId &&
      (event.entryType === 'STEP_I' || event.entryType === 'STEP_II' || event.entryType === 'STEP_III' || event.entryType === 'TERM');
  });
  var pipPrint = null;
  if (payload && payload.printEventId) {
    try { pipPrint = optlBuildPipPrint_(state, payload.printEventId); } catch (ignore) { pipPrint = null; }
  } else if (formalEvents.length) {
    try { pipPrint = optlBuildPipPrint_(state, formalEvents[formalEvents.length - 1].eventId); } catch (ignore) { pipPrint = null; }
  }
  var eventNotes = null;
  if (payload && payload.notesEventId) {
    (state.events || []).forEach(function (event) {
      if (event.eventId === payload.notesEventId) eventNotes = event;
    });
  }
  return {
    phase: 3,
    stage: 'forms-print-alerts-development',
    prototype: true,
    notice: 'OPTL forms + print + alerts in development · synthetic demo only · no live HR Sheet · email send disabled',
    asOfDate: asOf,
    timezone: OPTL_STORE_TZ_,
    employees: employees,
    selectedEmployeeId: selected ? selected.employeeId : null,
    employee: selected,
    matrixRows: view.matrixRows,
    history: view.history,
    pendingActions: view.pendingActions,
    exceptions: view.exceptions,
    lock: view.lock,
    slotLabels: OPTL_SLOT_LABELS_,
    sectionA: OPTL_SECTION_A_,
    sectionB: OPTL_SECTION_B_,
    standardLabels: optlStandardLabels_(),
    actingManagers: OPTL_DEMO_ACTING_MANAGERS_,
    actingManagerDeclared: actingDeclared || null,
    actingManagerConfirmed: actingConfirmed,
    actingManagerAttribution: 'manager-declared',
    acknowledgment: optlAcknowledgmentSpec_(),
    acknowledgments: (state.acknowledgments || []).filter(function (row) {
      return selected && row.employeeId === selected.employeeId;
    }),
    alertConfig: state.alertConfig,
    dashboard: optlDashboard_(state, asOf),
    audit: (state.audit || []).slice(-40).reverse(),
    auditCount: (state.audit || []).length,
    formalEvents: formalEvents,
    pipPrint: pipPrint,
    eventNotes: eventNotes,
    actionResult: actionResult || null,
    storageMode: optlStorageMode_(),
    security: {
      storage: optlStorageMode_() === 'dedicated-sheet'
        ? 'Dedicated STORE 17 OPTL DATA workbook (not the sales spreadsheet)'
        : 'Demo persistence in script properties until the GM runs optlCreateDedicatedStore_ — sales spreadsheet is never used',
      email: 'Command Center alerts on. Live email blocked until recipients are verified and gmEmailAuthorized is set. Subjects omit incident details.',
      identity: 'Existing manager/admin login only (GM, Sales Manager, Operations Manager share that login). Every mutation records a manager-declared actor. Shared credentials cannot verify which person typed the password. No SSN field exists.',
      pipPrint: 'Kane\'s Personal Improvement Plan matches performance-improvement-plan-pip-blank.doc. Employee matrix print has no private notes.',
    },
    stillDemo: [
      'Synthetic employee IDs / PropertiesService demo state (not live Sheet)',
      'Email delivery (queued in Command Center alerts only — not sent)',
      'Paycor upload remains manual',
      'Live deployment / merge without GM approval',
    ],
  };
}

/**
 * Manager/Admin OPTL page + synthetic mutations.
 * No personnel Sheet writes. Sales metrics are not read. Email is not sent.
 */
function optlRun_(payload) {
  var state = optlLoadState_();
  var actionResult = null;
  if (payload && payload.action) {
    actionResult = optlApplyAction_(state, payload);
    if (actionResult.state) state = actionResult.state;
    else state = optlLoadState_();
  }
  var page = optlBuildPage_(state, payload || {}, actionResult);
  if (actionResult && actionResult.elapsedMs != null) page.saveElapsedMs = actionResult.elapsedMs;
  return page;
}

function optl_(payload) {
  if (payload && payload.action && typeof LockService !== 'undefined') {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return optlRun_(payload);
    } finally {
      lock.releaseLock();
    }
  }
  return optlRun_(payload);
}
