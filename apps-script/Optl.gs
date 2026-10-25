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
      displayName: 'Alex Rivera',
      jobTitle: 'Sales Associate',
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
      displayName: 'Jordan Lee',
      jobTitle: 'Sales Associate',
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
      displayName: 'Taylor Brooks',
      jobTitle: 'Sales Associate',
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
      displayName: 'Casey Morgan (Former)',
      jobTitle: 'Sales Associate',
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

function optlCloneDemoState_() {
  var state = optlEmptyState_();
  state.employees = JSON.parse(JSON.stringify(optlDemoEmployees_()));
  state.events = JSON.parse(JSON.stringify(optlDemoEvents_()));
  state.alertConfig = {
    commandCenter: true,
    emailEnabled: false,
    emailRecipients: [],
    testSendingDisabled: true,
    note: 'Command Center alerts planned; manager email waits for configured/approved recipients. Test sending is disabled.',
  };
  return state;
}

/**
 * Manager/Admin OPTL page payload. Stage 2 uses synthetic demo records only.
 * No personnel Sheet writes. Sales metrics are not read. Email is not sent.
 */
function optl_(payload) {
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var state = optlCloneDemoState_();
  var employees = state.employees;
  var selectedId = String((payload && payload.employeeId) || '') ||
    (employees.filter(function (row) { return row.status === 'active'; })[0] || employees[0]).employeeId;
  var selected = null;
  employees.forEach(function (row) { if (row.employeeId === selectedId) selected = row; });
  if (!selected) selected = employees[0];

  // Refresh pending from thresholds (Jordan Safety ×4 → ACTION_REQUIRED)
  employees.forEach(function (row) {
    if (row.status === 'active') optlRefreshPending_(state, row.employeeId, asOf);
  });

  var view = optlEngineEmployeeView_(state, selected.employeeId, asOf);
  var actingDeclared = String((payload && payload.actingManagerDeclared) || '').trim();
  var actingConfirmed = !!(payload && payload.actingManagerConfirmed === true);

  return {
    phase: 2,
    stage: 'stage-2-development',
    prototype: true,
    notice: 'Stage 2 in development · synthetic demo only · no live HR Sheet · email send disabled',
    asOfDate: asOf,
    timezone: OPTL_STORE_TZ_,
    employees: employees,
    selectedEmployeeId: selected.employeeId,
    employee: selected,
    matrixRows: view.matrixRows,
    history: view.history,
    pendingActions: view.pendingActions,
    exceptions: view.exceptions,
    lock: view.lock,
    slotLabels: OPTL_SLOT_LABELS_,
    actingManagers: OPTL_DEMO_ACTING_MANAGERS_,
    actingManagerDeclared: actingDeclared || null,
    actingManagerConfirmed: actingConfirmed,
    actingManagerAttribution: 'manager-declared',
    acknowledgment: optlAcknowledgmentSpec_(),
    alertConfig: state.alertConfig,
    auditCount: state.audit.length,
    security: {
      storage: 'Not created — STORE 17 OPTL DATA Sheet blocked until GM approval',
      email: 'Disabled until recipients configured and approved; test sending off',
      identity: 'Shared manager login · actions require explicit acting-manager declaration',
      pipPrint: 'Kane\'s Personal Improvement Plan template retained for later print; HR approval note still applies',
    },
    stillDemo: [
      'Employee records (synthetic IDs only)',
      'In-memory engine — no Sheet persistence',
      'Entry / new-hire / TERM forms (UI stubs)',
      'Email delivery (planned, not sent)',
      'PIP print from Kane\'s template (later)',
      'Live deployment / merge',
    ],
  };
}
