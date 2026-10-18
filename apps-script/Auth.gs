var SESSION_MS_ = 12 * 60 * 60 * 1000;

function hashPassword_(password, salt) {
  var digest = Utilities.newBlob(String(salt) + '\n' + String(password)).getBytes();
  var i;
  for (i = 0; i < 2000; i += 1) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest);
  }
  return Utilities.base64Encode(digest);
}

function same_(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  var diff = 0;
  var i;
  for (i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

var USER_ROLES_ = {
  sales17: 'sales',
  store17: 'manager',
  kelly: 'admin',
};

function login_(payload) {
  var username = String((payload && payload.username) || '').trim().toLowerCase();
  var password = String((payload && payload.password) || '');
  if (locked_(username)) throw new Error('Too many attempts. Wait 15 minutes.');
  var role = USER_ROLES_[username] || '';
  var props = PropertiesService.getScriptProperties();
  var hash = role ? props.getProperty('hash_' + role) : '';
  var salt = role ? props.getProperty('salt_' + role) : '';
  if (!role || !hash || !salt || !same_(hashPassword_(password, salt), hash)) {
    recordFailure_(username || 'unknown');
    throw new Error('That username or password is not valid.');
  }
  clearFailures_(username);
  var token = Utilities.getUuid() + Utilities.getUuid();
  saveSession_(token, {
    role: role,
    username: username,
    epoch: props.getProperty('epoch_' + role) || '0',
    expires: Date.now() + SESSION_MS_,
  });
  var ownName = '';
  if (role === 'sales' && typeof employeeReportOn_ === 'function' && employeeReportOn_()) ownName = String(config_()['employee_report_' + username] || '').trim();
  return { token: token, role: role, ownReport: !!ownName, ownName: ownName };
}

function requireSession_(token) {
  var session = readSession_(token);
  if (!session) throw new Error('Sign in required.');
  var epoch = PropertiesService.getScriptProperties().getProperty('epoch_' + session.role) || '0';
  if (epoch !== session.epoch) throw new Error('Sign in required.');
  return session;
}

function saveSession_(token, session) {
  var props = PropertiesService.getScriptProperties();
  var all = readSessionMap_();
  var now = Date.now();
  Object.keys(all).forEach(function (key) {
    if (!all[key] || all[key].expires < now) delete all[key];
  });
  var keys = Object.keys(all);
  if (keys.length > 40) delete all[keys[0]];
  all[token] = session;
  props.setProperty('sessions', JSON.stringify(all));
}

function readSession_(token) {
  if (!token) return null;
  var session = readSessionMap_()[String(token)];
  if (!session || session.expires < Date.now()) return null;
  return session;
}

function readSessionMap_() {
  var raw = PropertiesService.getScriptProperties().getProperty('sessions') || '{}';
  try {
    var parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

function dropRoleSessions_(role) {
  var all = readSessionMap_();
  Object.keys(all).forEach(function (key) {
    if (all[key] && all[key].role === role) delete all[key];
  });
  PropertiesService.getScriptProperties().setProperty('sessions', JSON.stringify(all));
}

function locked_(username) {
  return CacheService.getScriptCache().get('lock_' + username) === '1';
}

function recordFailure_(username) {
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('fail_' + username) || '0') + 1;
  cache.put('fail_' + username, String(count), 900);
  if (count >= 8) cache.put('lock_' + username, '1', 900);
}

function clearFailures_(username) {
  var cache = CacheService.getScriptCache();
  cache.remove('fail_' + username);
  cache.remove('lock_' + username);
}

function changePassword_(payload) {
  var role = String(payload.role || '').toLowerCase();
  var password = String(payload.password || '');
  if (role !== 'sales' && role !== 'manager' && role !== 'admin') throw new Error('Choose sales, manager, or admin.');
  if (password.length < 10) throw new Error('Use at least 10 characters.');
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid();
  props.setProperty('salt_' + role, salt);
  props.setProperty('hash_' + role, hashPassword_(password, salt));
  props.setProperty('epoch_' + role, String(Date.now()));
  dropRoleSessions_(role);
  if (role === 'admin') {
    var token = Utilities.getUuid() + Utilities.getUuid();
    saveSession_(token, { role: 'admin', epoch: props.getProperty('epoch_admin'), expires: Date.now() + SESSION_MS_ });
    return { ok: true, token: token, role: 'admin' };
  }
  return { ok: true };
}

function bootstrapPasswords_() {
  var props = PropertiesService.getScriptProperties();
  ['sales', 'manager', 'admin'].forEach(function (role) {
    var plain = props.getProperty('BOOTSTRAP_' + role.toUpperCase());
    if (!plain || String(plain).length < 10) return;
    var salt = Utilities.getUuid();
    props.setProperty('salt_' + role, salt);
    props.setProperty('hash_' + role, hashPassword_(plain, salt));
    props.setProperty('epoch_' + role, String(Date.now()));
    props.deleteProperty('BOOTSTRAP_' + role.toUpperCase());
  });
}
