var SPREADSHEET_ID_ = '1KtsfQPQRdg3IdNXomlM5t47IyE1psouxvgW-D8VSLfw';
var APP_VERSION_ = '1.0.0';

var ROUTES_ = {
  login: null,
  home: ['sales', 'manager', 'admin'],
  daily: ['sales', 'manager', 'admin'],
  people: ['sales', 'manager', 'admin'],
  morning: ['manager', 'admin'],
  health: ['manager', 'admin'],
  changePassword: ['admin'],
  retry: ['admin'],
};

function doGet() {
  var page = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle("Kane's Management Command Center")
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
  if (name === 'people') return people_(payload);
  if (name === 'morning') return morning_(payload);
  if (name === 'health') return health_(payload);
  if (name === 'changePassword') return changePassword_(payload);
  if (name === 'retry') return retry_(payload);
  throw new Error('That request is not available.');
}
