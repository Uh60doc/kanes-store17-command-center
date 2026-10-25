/**
 * Dedicated OPTL workbook (STORE 17 OPTL DATA). Never the sales spreadsheet.
 * Demo records only until the GM authorizes a live book id in script property OPTL_SPREADSHEET_ID.
 * Page loads do not create a spreadsheet.
 */

var OPTL_STORE_TABS_ = [
  'OPTL_Snapshot', 'OPTL_Employees', 'OPTL_Periods', 'OPTL_Events',
  'OPTL_Acknowledgments', 'OPTL_Pending', 'OPTL_Exceptions', 'OPTL_Audit', 'OPTL_Alerts', 'OPTL_Config',
];

function optlSpreadsheetId_() {
  try {
    if (typeof PropertiesService === 'undefined') return '';
    return String(PropertiesService.getScriptProperties().getProperty('OPTL_SPREADSHEET_ID') || '').trim();
  } catch (ignore) {
    return '';
  }
}

function optlAssertDedicatedBook_(id) {
  if (!id) throw new Error('OPTL spreadsheet id is not configured.');
  if (typeof SPREADSHEET_ID_ !== 'undefined' && String(id) === String(SPREADSHEET_ID_)) {
    throw new Error('OPTL storage must not use the sales reporting spreadsheet.');
  }
}

function optlMemoryBook_() {
  var sheets = {};
  function ensure(name) {
    if (!sheets[name]) sheets[name] = [];
    return {
      clear: function () { sheets[name] = []; },
      getDataRange: function () {
        return { getValues: function () { return sheets[name].length ? sheets[name] : [['']]; } };
      },
      getRange: function (row, col, numRows, numCols) {
        return {
          setValues: function (grid) { sheets[name] = grid; },
        };
      },
    };
  }
  return {
    getSheetByName: function (name) { return sheets[name] ? ensure(name) : null; },
    insertSheet: function (name) { sheets[name] = []; return ensure(name); },
    _sheets: sheets,
  };
}

function optlPutGrid_(book, name, grid) {
  var sh = book.getSheetByName(name);
  if (!sh) sh = book.insertSheet(name);
  sh.clear();
  if (!grid || !grid.length || !grid[0].length) return;
  sh.getRange(1, 1, grid.length, grid[0].length).setValues(grid);
}

function optlReadGrid_(book, name) {
  var sh = book.getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  if (!values || !values.length || !values[0] || values[0][0] === '') return [];
  return values;
}

function optlObjectsToGrid_(rows, columns) {
  var grid = [columns];
  (rows || []).forEach(function (row) {
    grid.push(columns.map(function (key) {
      var value = row[key];
      if (value === undefined || value === null) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return value;
    }));
  });
  return grid;
}

function optlSaveStateToBook_(book, state) {
  var snapshot = JSON.stringify(state);
  optlPutGrid_(book, 'OPTL_Snapshot', [['key', 'json'], ['state', snapshot], ['savedAt', optlToday_()]]);
  optlPutGrid_(book, 'OPTL_Employees', optlObjectsToGrid_(state.employees || [], [
    'employeeId', 'displayName', 'jobTitle', 'department', 'hireDate', 'status', 'separationDate', 'terminationReason',
  ]));
  var periods = [];
  (state.employees || []).forEach(function (employee) {
    (employee.employmentPeriods || []).forEach(function (period) {
      periods.push({
        periodId: period.periodId,
        employeeId: employee.employeeId,
        hireDate: period.hireDate,
        separationDate: period.separationDate,
        status: period.status,
      });
    });
  });
  optlPutGrid_(book, 'OPTL_Periods', optlObjectsToGrid_(periods, ['periodId', 'employeeId', 'hireDate', 'separationDate', 'status']));
  optlPutGrid_(book, 'OPTL_Events', optlObjectsToGrid_(state.events || [], [
    'eventId', 'employeeId', 'employmentPeriodId', 'incidentDate', 'entryAt', 'section', 'category', 'entryType',
    'shortDescription', 'quantitativeDetail', 'status', 'scored', 'originalExpirationDate', 'effectiveExpirationDate',
    'chainId', 'freezeReason', 'createdByDeclared', 'voidReason', 'notes',
  ]));
  optlPutGrid_(book, 'OPTL_Acknowledgments', optlObjectsToGrid_(state.acknowledgments || [], [
    'acknowledgmentId', 'eventId', 'employeeId', 'typedFullName', 'refused', 'refusalNote', 'acknowledgedAt', 'supervisingManagerDeclared',
  ]));
  optlPutGrid_(book, 'OPTL_Pending', optlObjectsToGrid_(state.pendingActions || [], [
    'pendingId', 'employeeId', 'section', 'category', 'kind', 'proposedLevel', 'status', 'reason',
  ]));
  optlPutGrid_(book, 'OPTL_Exceptions', optlObjectsToGrid_(state.exceptions || [], [
    'exceptionId', 'employeeId', 'section', 'category', 'eventId', 'status', 'tone', 'reason',
  ]));
  optlPutGrid_(book, 'OPTL_Audit', optlObjectsToGrid_(state.audit || [], [
    'auditId', 'action', 'at', 'actorDeclared', 'actorAttribution', 'reason', 'employeeId', 'eventId',
  ]));
  optlPutGrid_(book, 'OPTL_Alerts', optlObjectsToGrid_(state.alerts || [], [
    'alertId', 'kind', 'employeeId', 'title', 'status', 'emailSent', 'emailBlockedReason', 'createdAt',
  ]));
  optlPutGrid_(book, 'OPTL_Config', [
    ['key', 'value'],
    ['schema', 'optl-store-v1'],
    ['alertConfig', JSON.stringify(state.alertConfig || {})],
    ['book', 'STORE 17 OPTL DATA'],
    ['salesSpreadsheet', 'forbidden'],
  ]);
}

function optlLoadStateFromBook_(book) {
  var grid = optlReadGrid_(book, 'OPTL_Snapshot');
  var json = '';
  grid.slice(1).forEach(function (row) {
    if (String(row[0]) === 'state') json = String(row[1] || '');
  });
  if (!json) return null;
  var state = JSON.parse(json);
  if (!state.employees || !state.events) return null;
  return state;
}

/**
 * GM runs this once from the Apps Script editor after review.
 * Creates STORE 17 OPTL DATA, stores its id, seeds fictional demo rows.
 * Does not run on page load and does not touch the sales book.
 */
function optlCreateDedicatedStore_() {
  if (typeof SpreadsheetApp === 'undefined') throw new Error('SpreadsheetApp is only available inside Apps Script.');
  var existing = optlSpreadsheetId_();
  if (existing) throw new Error('OPTL_SPREADSHEET_ID is already set. Refusing to create a second book.');
  var created = SpreadsheetApp.create('STORE 17 OPTL DATA — FICTIONAL DEMO');
  var id = created.getId();
  optlAssertDedicatedBook_(id);
  PropertiesService.getScriptProperties().setProperty('OPTL_SPREADSHEET_ID', id);
  var state = optlCloneDemoState_();
  state.alertConfig.dataClass = 'FICTIONAL-DEMO-NOT-REAL-EMPLOYEES';
  optlSaveStateToBook_(SpreadsheetApp.openById(id), state);
  return {
    spreadsheetId: id,
    name: 'STORE 17 OPTL DATA — FICTIONAL DEMO',
    seeded: 'FICTIONAL-DEMO-NOT-REAL-EMPLOYEES',
    salesSpreadsheetTouched: false,
    emailSent: false,
  };
}

function optlStorageMode_() {
  var id = optlSpreadsheetId_();
  if (!id) return 'unconfigured-demo-properties';
  return 'dedicated-sheet';
}
