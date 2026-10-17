var SPREADSHEET_ID_ = '1KtsfQPQRdg3IdNXomlM5t47IyE1psouxvgW-D8VSLfw';
var APP_VERSION_ = '1.0.0';

var ROUTES_ = {
  login: null,
  home: ['sales', 'manager', 'admin'],
  daily: ['sales', 'manager', 'admin'],
  closing: ['sales', 'manager', 'admin'],
  people: ['sales', 'manager', 'admin'],
  summary: ['manager', 'admin'],
  morning: ['sales', 'manager', 'admin'],
  savePromotion: ['admin'],
  health: ['manager', 'admin'],
  bedding: ['manager', 'admin'],
  saveBeddingGoals: ['admin'],
  changePassword: ['admin'],
  retry: ['admin'],
  runChecks: ['admin'],
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
};

// Routes that only read. Every other route can change figures, so the cached pages are dropped after it runs.
var READ_ONLY_ROUTES_ = { home: true, daily: true, closing: true, people: true, summary: true, morning: true, health: true, bedding: true, coverage: true, roster: true, evals: true, evalWorkbook: true, uploads: true, documents: true, docFile: true };
// Pages whose reply is reused until the data changes. Each reads every tab once while it is built.
var CACHED_PAGES_ = { home: true, daily: true, closing: true, people: true, summary: true, morning: true, bedding: true };
var MEMO_PAGES_ = { home: true, daily: true, closing: true, people: true, summary: true, morning: true, bedding: true, health: true, coverage: true };
var PAGE_CACHE_SECONDS_ = 1800;
var PAGE_CACHE_MAX_CHARS_ = 95000;

/** Changes whenever imported data, a recalculation, a saved setting or a hand edit to the workbook changes. */
function dataVersion_() {
  if (typeof PropertiesService === 'undefined') return '';
  return PropertiesService.getScriptProperties().getProperty('data_version') || 'initial';
}

/** Every cached page is keyed by the data version, so a new version retires them all at once. */
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
  var text = [version, name, payload.session.role, todayNy_(), JSON.stringify(params)].join('|');
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

/** A hand edit to the workbook (installable change trigger) retires every cached page. */
function workbookChanged_() {
  markDataChanged_('workbook edited');
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
  var writes = !READ_ONLY_ROUTES_[name] || (name === 'uploads' && payload.refresh === true);
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
  if (name === 'savePromotion') return savePromotion_(payload);
  if (name === 'health') return health_(payload);
  if (name === 'bedding') return bedding_(payload);
  if (name === 'saveBeddingGoals') return saveBeddingGoals_(payload);
  if (name === 'changePassword') return changePassword_(payload);
  if (name === 'retry') return retry_(payload);
  if (name === 'runChecks') return runChecks_(payload);
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
  throw new Error('That request is not available.');
}
