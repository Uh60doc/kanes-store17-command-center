var SPREADSHEET_ID_ = '1KtsfQPQRdg3IdNXomlM5t47IyE1psouxvgW-D8VSLfw';
var APP_VERSION_ = '1.0.0';

var ROUTES_ = {
  login: null,
  home: ['sales', 'manager', 'admin'],
  daily: ['sales', 'manager', 'admin'],
  closing: ['sales', 'manager', 'admin'],
  people: ['sales', 'manager', 'admin'],
  morning: ['sales', 'manager', 'admin'],
  savePromotion: ['admin'],
  health: ['manager', 'admin'],
  bedding: ['manager', 'admin'],
  saveBeddingGoals: ['admin'],
  changePassword: ['admin'],
  retry: ['admin'],
  coverage: ['admin'],
};

function doGet() {
  try {
    refreshRollup_();
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
  if (name === 'home') return home_(payload);
  if (name === 'daily') return daily_(payload);
  if (name === 'closing') return closing_(payload);
  if (name === 'people') return people_(payload);
  if (name === 'morning') return morning_(payload);
  if (name === 'savePromotion') return savePromotion_(payload);
  if (name === 'health') return health_(payload);
  if (name === 'bedding') return bedding_(payload);
  if (name === 'saveBeddingGoals') return saveBeddingGoals_(payload);
  if (name === 'changePassword') return changePassword_(payload);
  if (name === 'retry') return retry_(payload);
  if (name === 'coverage') return coverage_(payload);
  throw new Error('That request is not available.');
}
