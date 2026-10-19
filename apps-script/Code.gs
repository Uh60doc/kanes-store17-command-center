var SPREADSHEET_ID_ = '1KtsfQPQRdg3IdNXomlM5t47IyE1psouxvgW-D8VSLfw';
var APP_VERSION_ = '1.0.26';

var ROUTES_ = {
  login: null,
  home: ['sales', 'manager', 'admin'],
  daily: ['sales', 'manager', 'admin'],
  closing: ['sales', 'manager', 'admin'],
  people: ['sales', 'manager', 'admin'],
  summary: ['manager', 'admin'],
  morning: ['sales', 'manager', 'admin'],
  brief: ['manager', 'admin'],
  saveBriefPlan: ['manager', 'admin'],
  previewBriefEmail: ['manager', 'admin'],
  sendBriefTest: ['admin'],
  saveBriefMailSettings: ['admin'],
  resendBriefEmail: ['manager', 'admin'],
  savePromotion: ['admin'],
  health: ['manager', 'admin'],
  bedding: ['manager', 'admin'],
  saveBeddingGoals: ['admin'],
  changePassword: ['admin'],
  retry: ['admin'],
  runChecks: ['admin'],
  runBackup: ['admin'],
  coverage: ['admin'],
  roster: ['admin'],
  saveAssociate: ['admin'],
  evals: ['manager', 'admin'],
  saveEval: ['manager', 'admin'],
  setEvalStatus: ['manager', 'admin'],
  prepareEvals: ['manager', 'admin'],
  evalWorkbook: ['manager', 'admin'],
  saveEvalMetric: ['manager', 'admin'],
  importEvalWorkbook: ['admin'],
  uploads: ['manager', 'admin'],
  uploadReport: ['manager', 'admin'],
  archiveOriginal: ['admin'],
  documents: ['sales', 'manager', 'admin'],
  docFile: ['sales', 'manager', 'admin'],
  uploadDocument: ['manager', 'admin'],
  editDocument: ['admin'],
  removeDocument: ['admin'],
  saveDocPacket: ['admin'],
  devLog: ['admin'],
  recordDevLog: ['admin'],
  dataPulse: ['sales', 'manager', 'admin'],
  coach: ['sales', 'manager', 'admin'],
  accel: ['sales', 'manager', 'admin'],
  recovery: ['manager', 'admin'],
  coaching: ['manager', 'admin'],
  evalPrep: ['manager', 'admin'],
  evalPrepWorkbook: ['manager', 'admin'],
  leakage: ['manager', 'admin'],
  delivery: ['manager', 'admin'],
  previewRescue: ['manager', 'admin'],
  confirmRescueImport: ['manager', 'admin'],
  saveRescueFlag: ['manager', 'admin'],
  actions: ['manager', 'admin'],
  saveAction: ['manager', 'admin'],
  reports: ['sales', 'manager', 'admin'],
  readiness: ['manager', 'admin'],
  recheckReports: ['manager', 'admin'],
  variance: ['manager', 'admin'],
  saveWrittenReview: ['manager', 'admin'],
};

// Routes that only read. Every other route can change figures, so the cached pages are dropped after it runs.
var READ_ONLY_ROUTES_ = { home: true, daily: true, closing: true, people: true, summary: true, morning: true, brief: true, previewBriefEmail: true, health: true, bedding: true, coverage: true, roster: true, evals: true, evalWorkbook: true, uploads: true, documents: true, docFile: true, devLog: true, dataPulse: true, coach: true, recovery: true, coaching: true, evalPrep: true, evalPrepWorkbook: true, leakage: true, delivery: true, previewRescue: true, accel: true, actions: true, reports: true, readiness: true, variance: true };
// Backups and restore drills write only their own logs, which no cached page reads; a problem they record moves the version itself.
var LOG_ONLY_ROUTES_ = { runBackup: true };
// Pages whose reply is reused until the data changes. Each reads every tab once while it is built.
var CACHED_PAGES_ = { home: true, daily: true, closing: true, people: true, summary: true, morning: true, brief: true, bedding: true, coach: true, recovery: true, coaching: true, evalPrep: true, leakage: true, delivery: true, accel: true, actions: true };
var MEMO_PAGES_ = { home: true, daily: true, closing: true, people: true, summary: true, morning: true, brief: true, bedding: true, health: true, coverage: true, coach: true, recovery: true, coaching: true, evalPrep: true, leakage: true, delivery: true, accel: true, actions: true, reports: true, readiness: true, variance: true };
var PAGE_CACHE_SECONDS_ = 1800;
var PAGE_CACHE_MAX_CHARS_ = 95000;

// Figure tabs only. Health, import, and exception logs are omitted so a 30-minute check that found nothing new does not look like new sales.
var DISPLAY_SOURCE_TABS_ = ['CC_Config', 'CC_Daily', 'CC_DailyGoals', 'CC_SellingDays', 'CC_AssociateDays', 'CC_People', 'CC_Staffing', 'CC_Closing', 'CC_ClosingDaily', 'CC_ClosingMTD', 'CC_Kpi', 'CC_Promotions'];

function fingerprintValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return isoDate_(value);
  if (value && typeof value === 'object') {
    var copy = Array.isArray(value) ? [] : {};
    Object.keys(value).sort().forEach(function (key) { copy[key] = fingerprintValue_(value[key]); });
    return copy;
  }
  return value;
}

function sourceFingerprint_() {
  var parts = DISPLAY_SOURCE_TABS_.map(function (name) {
    var rows = [];
    try { rows = sheet_(name); } catch (ignore) { rows = []; }
    return name + '=' + JSON.stringify(fingerprintValue_(rows));
  });
  if (typeof Utilities === 'undefined' || !Utilities.computeDigest) return parts.join('\n');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, parts.join('\n'));
  return digest.map(function (part) { var value = (part + 256) % 256; return (value < 16 ? '0' : '') + value.toString(16); }).join('');
}

/** Read-only clock for the open website. It does not import mail or write sales. */
function dataPulse_() {
  try {
    return { ok: true, version: dataVersion_(), imports: false };
  } catch (error) {
    return { ok: false, stale: true };
  }
}

/** Changes whenever imported data, a recalculation, a saved setting or a hand edit to the workbook changes. */
function dataVersion_() {
  if (typeof PropertiesService === 'undefined') return '';
  return PropertiesService.getScriptProperties().getProperty('data_version') || 'initial';
}

/** Every cached page is keyed by the data version and the software version, so a new deploy retires pages built by the previous release. */
function markDataChanged_(reason) {
  if (typeof PropertiesService === 'undefined') return;
  var version = new Date().toISOString() + ' ' + String(reason || '').slice(0, 60);
  PropertiesService.getScriptProperties().setProperty('data_version', version);
}

function pageCacheKey_(name, payload, version) {
  var params = {};
  Object.keys(payload).sort().forEach(function (key) {
    if (key !== 'token' && key !== 'session') params[key] = payload[key];
  });
  var text = [version, typeof APP_VERSION_ === 'undefined' ? '' : APP_VERSION_, name, payload.session.role, todayNy_(), JSON.stringify(params)].join('|');
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text);
  return 'page_' + digest.map(function (part) { var value = (part + 256) % 256; return (value < 16 ? '0' : '') + value.toString(16); }).join('');
}

/**
 * A page built from the current data version is reused; any import, recalculation or edit makes a new version, so a
 * reply from older data is never served. The figures' own "updated" time is read fresh on every reply.
 */
function cachedPage_(name, payload, build) {
  if (typeof CacheService === 'undefined') return build();
  var cache = CacheService.getScriptCache();
  var key = pageCacheKey_(name, payload, dataVersion_());
  var hit = cache.get(key);
  if (hit) {
    var reply = JSON.parse(hit);
    if (Object.prototype.hasOwnProperty.call(reply, 'updated')) reply.updated = healthValue_('last_calculation') || 'Not Available';
    return reply;
  }
  var built = build();
  var text = JSON.stringify(built);
  if (text.length <= PAGE_CACHE_MAX_CHARS_) {
    try { cache.put(key, text, PAGE_CACHE_SECONDS_); } catch (ignore) {}
  }
  return built;
}

/** Builds Home for each sign-in role after new data, so the first person to open it gets the cached page. */
function warmPages_() {
  ['sales', 'manager', 'admin'].forEach(function (role) {
    try {
      beginPageRead_();
      var payload = { session: { role: role } };
      cachedPage_('home', payload, function () { return home_(payload); });
    } catch (ignore) {
    } finally {
      endPageRead_();
    }
  });
}

/** CC_Rollup is recalculated when the data or the day has changed since it was last written, not on every visit. */
function refreshRollupIfStale_() {
  var props = typeof PropertiesService === 'undefined' ? null : PropertiesService.getScriptProperties();
  var stamp = dataVersion_() + '|' + todayNy_();
  if (props && props.getProperty('rollup_stamp') === stamp) return;
  refreshRollup_();
  if (props) props.setProperty('rollup_stamp', stamp);
}

/** Retires cached pages only when the figure tabs differ from the last published copy. */
function publishSourceChange_(reason) {
  if (typeof PropertiesService === 'undefined') return false;
  var props = PropertiesService.getScriptProperties();
  var current = '';
  try { current = sourceFingerprint_(); } catch (ignore) { current = ''; }
  if (!current) {
    markDataChanged_(reason);
    return true;
  }
  if (props.getProperty('source_fingerprint') === current) return false;
  props.setProperty('source_fingerprint', current);
  markDataChanged_(reason);
  return true;
}

/** A hand edit to the workbook (installable change trigger) retires every cached page. Imports suppress this so a health-log write is not treated as new sales. */
function workbookChanged_() {
  if (typeof PropertiesService !== 'undefined' && PropertiesService.getScriptProperties().getProperty('suppress_change_mark') === 'yes') return;
  publishSourceChange_('workbook edited');
}

function ensureChangeTrigger_() {
  var found = false;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'workbookChanged_') found = true;
  });
  if (!found) ScriptApp.newTrigger('workbookChanged_').forSpreadsheet(SPREADSHEET_ID_).onChange().create();
}

function doGet() {
  try {
    refreshRollupIfStale_();
  } catch (error) {
    appendException_('Update Failed', 'CC_Rollup was not recalculated. ' + String(error && error.message ? error.message : error));
  }
  try {
    if (typeof ensureDailyTrigger_ === 'function') ensureDailyTrigger_();
  } catch (error) {
    appendException_('Update Failed', 'The 30-minute update trigger could not be confirmed. ' + String(error && error.message ? error.message : error));
  }
  var page = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle("Kane's Store 17 Command Center")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  var frameMode = HtmlService.XFrameOptionsMode && HtmlService.XFrameOptionsMode.DENY;
  if (frameMode) page.setXFrameOptionsMode(frameMode);
  return page;
}

function dispatch(name, payload) {
  var route = ROUTES_[name];
  if (route === undefined) throw new Error('That request is not available.');
  payload = payload || {};
  if (route === null) return login_(payload);
  var session = requireSession_(payload.token);
  if (route.indexOf(session.role) === -1) throw new Error('That area is not available for this login.');
  payload.session = session;
  var writes = (!READ_ONLY_ROUTES_[name] && !LOG_ONLY_ROUTES_[name]) || (name === 'uploads' && payload.refresh === true);
  if (MEMO_PAGES_[name]) beginPageRead_();
  try {
    if (CACHED_PAGES_[name]) return cachedPage_(name, payload, function () { return route_(name, payload); });
    return route_(name, payload);
  } finally {
    endPageRead_();
    // A save that stopped part way may still have written, so the version moves either way.
    if (writes) markDataChanged_(name);
  }
}

function route_(name, payload) {
  if (name === 'home') return home_(payload);
  if (name === 'daily') return daily_(payload);
  if (name === 'closing') return closing_(payload);
  if (name === 'people') return people_(payload);
  if (name === 'summary') return summary_(payload);
  if (name === 'morning') return morning_(payload);
  if (name === 'brief') return brief_(payload);
  if (name === 'saveBriefPlan') return saveBriefPlan_(payload);
  if (name === 'previewBriefEmail') return previewBriefEmail_(payload);
  if (name === 'sendBriefTest') return sendBriefTest_(payload);
  if (name === 'saveBriefMailSettings') return saveBriefMailSettings_(payload);
  if (name === 'resendBriefEmail') return resendBriefEmail_(payload);
  if (name === 'savePromotion') return savePromotion_(payload);
  if (name === 'health') return health_(payload);
  if (name === 'bedding') return bedding_(payload);
  if (name === 'saveBeddingGoals') return saveBeddingGoals_(payload);
  if (name === 'changePassword') return changePassword_(payload);
  if (name === 'retry') return retry_(payload);
  if (name === 'runChecks') return runChecks_(payload);
  if (name === 'runBackup') return runBackupRoute_(payload);
  if (name === 'coverage') return coverage_(payload);
  if (name === 'roster') return roster_(payload);
  if (name === 'saveAssociate') return saveAssociate_(payload);
  if (name === 'evals') return evals_(payload);
  if (name === 'saveEval') return saveEvaluation_(payload);
  if (name === 'setEvalStatus') return setEvalStatus_(payload);
  if (name === 'prepareEvals') return prepareEvals_(payload);
  if (name === 'evalWorkbook') return evalWorkbook_(payload);
  if (name === 'saveEvalMetric') return saveEvalMetric_(payload);
  if (name === 'importEvalWorkbook') return importEvalWorkbook_(payload);
  if (name === 'uploads') return uploads_(payload);
  if (name === 'uploadReport') return uploadReport_(payload);
  if (name === 'archiveOriginal') return archiveOriginal_(payload);
  if (name === 'documents') return documents_(payload);
  if (name === 'docFile') return docFile_(payload);
  if (name === 'uploadDocument') return uploadDocument_(payload);
  if (name === 'editDocument') return editDocument_(payload);
  if (name === 'removeDocument') return removeDocument_(payload);
  if (name === 'saveDocPacket') return saveDocPacket_(payload);
  if (name === 'devLog') return devLog_(payload);
  if (name === 'recordDevLog') return recordDevLog_(payload);
  if (name === 'dataPulse') return dataPulse_(payload);
  if (name === 'coach') return opportunity_(payload);
  if (name === 'recovery') return recovery_(payload);
  if (name === 'coaching') return coaching_(payload);
  if (name === 'evalPrep') return evalPrep_(payload);
  if (name === 'evalPrepWorkbook') return evalPrepWorkbook_(payload);
  if (name === 'leakage') return leakage_(payload);
  if (name === 'delivery') return delivery_(payload);
  if (name === 'accel') return accelerator_(payload);
  if (name === 'actions') return actions_(payload);
  if (name === 'saveAction') return actionSave_(payload);
  if (name === 'reports') return reportCenter_(payload);
  if (name === 'readiness') return readiness_(payload);
  if (name === 'recheckReports') return recheckReports_(payload);
  if (name === 'variance') return variance_(payload);
  if (name === 'saveWrittenReview') return saveWrittenReview_(payload);
  if (name === 'previewRescue') return previewRescue_(payload);
  if (name === 'confirmRescueImport') return confirmRescueImport_(payload);
  if (name === 'saveRescueFlag') return saveRescueFlag_(payload);
  throw new Error('That request is not available.');
}
