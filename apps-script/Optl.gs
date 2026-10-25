/**
 * OPTL — Online Performance Tracking Log (Phase 1).
 * Spec authority: STORE17_OPTL_COMPLETE_CURSOR_SPEC_V1_2.md
 * Own Admin-area system. Demo records only. Does not write sales sheets.
 * Unlinked occurrence expiration: incident date + 180 Store 17 local calendar days.
 * STEP I/II/III are display labels; PIP I/II/III remain internal aliases.
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
 * Store 17 late-arrival classification (v1.2 confirmed).
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

function optlDemoEmployees_() {
  return [
    { employeeId: 'S17-DEMO-101', displayName: 'Alex Rivera', jobTitle: 'Sales Associate', department: 'Sales', hireDate: '2024-03-12', status: 'active', separationDate: null },
    { employeeId: 'S17-DEMO-102', displayName: 'Jordan Lee', jobTitle: 'Sales Associate', department: 'Sales', hireDate: '2023-08-01', status: 'active', separationDate: null },
    { employeeId: 'S17-DEMO-199', displayName: 'Casey Morgan (Former)', jobTitle: 'Sales Associate', department: 'Sales', hireDate: '2022-01-10', status: 'former', separationDate: '2026-06-15' },
  ];
}

function optlDemoEvents_() {
  return [
    { eventId: 'evt-demo-001', employeeId: 'S17-DEMO-101', incidentDate: '2026-01-15', section: 'B', category: 'Tardy', entryType: 'Occurrence', shortDescription: 'Tardy', quantitativeDetail: 12, status: 'active' },
    { eventId: 'evt-demo-002', employeeId: 'S17-DEMO-101', incidentDate: '2026-08-20', section: 'B', category: 'Tardy', entryType: 'Occurrence', shortDescription: 'Tardy', quantitativeDetail: 8, status: 'active' },
    { eventId: 'evt-demo-003', employeeId: 'S17-DEMO-101', incidentDate: '2026-09-05', section: 'A', category: 'Safety', entryType: 'Occurrence', shortDescription: 'Unsafe Behavior', quantitativeDetail: null, status: 'active' },
    { eventId: 'evt-demo-004', employeeId: 'S17-DEMO-101', incidentDate: '2026-09-28', section: 'A', category: 'Quality of Orders', entryType: 'Occurrence', shortDescription: 'Error on Ticket', quantitativeDetail: null, status: 'active' },
    { eventId: 'evt-demo-005', employeeId: 'S17-DEMO-101', incidentDate: '2026-04-01', section: 'A', category: 'Behavior', entryType: 'Occurrence', shortDescription: 'Unacceptable Behavior', quantitativeDetail: null, status: 'active' },
    { eventId: 'evt-demo-006', employeeId: 'S17-DEMO-102', incidentDate: '2026-10-02', section: 'A', category: 'Sales Performance', entryType: 'Occurrence', shortDescription: 'Below Goal −32%', quantitativeDetail: -32, status: 'active' },
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
    var expirationDate = optlOccurrenceExpiration_(event.incidentDate);
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

/**
 * Manager/Admin OPTL page payload. Phase 1 uses synthetic demo records only.
 * No personnel Sheet writes. Sales metrics are not read.
 */
function optl_(payload) {
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var employees = optlDemoEmployees_();
  var events = optlDemoEvents_();
  var selectedId = String((payload && payload.employeeId) || '') || (employees.filter(function (row) { return row.status === 'active'; })[0] || employees[0]).employeeId;
  var selected = null;
  employees.forEach(function (row) { if (row.employeeId === selectedId) selected = row; });
  if (!selected) selected = employees[0];
  var view = optlEmployeeView_(events, selected.employeeId, asOf);
  return {
    phase: 1,
    prototype: true,
    notice: 'Phase 1 prototype · demo records only · separate from sales reporting',
    asOfDate: asOf,
    timezone: OPTL_STORE_TZ_,
    employees: employees,
    selectedEmployeeId: selected.employeeId,
    employee: selected,
    matrixRows: view.matrixRows,
    history: view.history,
    slotLabels: OPTL_SLOT_LABELS_,
  };
}
