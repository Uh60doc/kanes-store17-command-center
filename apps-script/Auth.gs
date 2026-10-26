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

// The only people who can sign in. Each one keeps their own password.
var SIGN_IN_USERS_ = {
  liz: { role: 'admin', name: 'Liz' },
  cordell: { role: 'admin', name: 'Cordell' },
  kelly: { role: 'admin', name: 'Kelly' },
};
var FIRST_PASSWORD_ = 'ADMIN';

function signInUser_(username) {
  return SIGN_IN_USERS_[String(username || '').trim().toLowerCase()] || null;
}

function passwordReady_(username) {
  return PropertiesService.getScriptProperties().getProperty('ready_user_' + username) === 'yes';
}

function issueSession_(username, role, extra) {
  extra = extra || {};
  var props = PropertiesService.getScriptProperties();
  var token = Utilities.getUuid() + Utilities.getUuid();
  var session = {
    role: role,
    username: username,
    epoch: props.getProperty('epoch_user_' + username) || '0',
    expires: Date.now() + SESSION_MS_,
  };
  if (extra.mustSetPassword) session.mustSetPassword = true;
  saveSession_(token, session);
  var ownName = '';
  if (role === 'sales' && typeof employeeReportOn_ === 'function' && employeeReportOn_()) ownName = String(config_()['employee_report_' + username] || '').trim();
  var result = { token: token, role: role, username: username, ownReport: !!ownName, ownName: ownName };
  if (extra.mustSetPassword) result.mustSetPassword = true;
  if (extra.name) result.name = extra.name;
  return result;
}

function login_(payload) {
  var username = String((payload && payload.username) || '').trim().toLowerCase();
  var password = String((payload && payload.password) || '');
  if (locked_(username)) throw new Error('Too many attempts. Wait 15 minutes.');
  var user = signInUser_(username);
  if (!user) {
    recordFailure_(username || 'unknown');
    throw new Error('That username or password is not valid.');
  }
  if (!passwordReady_(username)) {
    if (password !== FIRST_PASSWORD_) {
      recordFailure_(username);
      throw new Error('That username or password is not valid.');
    }
    clearFailures_(username);
    return issueSession_(username, user.role, { mustSetPassword: true, name: user.name });
  }
  var props = PropertiesService.getScriptProperties();
  var hash = props.getProperty('hash_user_' + username) || '';
  var salt = props.getProperty('salt_user_' + username) || '';
  if (!hash || !salt || !same_(hashPassword_(password, salt), hash)) {
    recordFailure_(username);
    throw new Error('That username or password is not valid.');
  }
  clearFailures_(username);
  return issueSession_(username, user.role);
}

function choosePassword_(payload) {
  var username = String((payload && payload.username) || '').trim().toLowerCase();
  var current = String((payload && payload.password) || '');
  var next = payload && payload.newPassword !== undefined && payload.newPassword !== null ? String(payload.newPassword) : '';
  if (locked_(username)) throw new Error('Too many attempts. Wait 15 minutes.');
  var user = signInUser_(username);
  if (!user) {
    recordFailure_(username || 'unknown');
    throw new Error('That username or password is not valid.');
  }
  if (passwordReady_(username)) throw new Error('A password is already saved. Sign in with it.');
  var setup = readSession_(payload && payload.token);
  var setupOk = !!(setup && setup.mustSetPassword && setup.username === username && (PropertiesService.getScriptProperties().getProperty('epoch_user_' + username) || '0') === setup.epoch);
  if (!setupOk && current !== FIRST_PASSWORD_) {
    recordFailure_(username);
    throw new Error('That username or password is not valid.');
  }
  if (!next) throw new Error('Enter a password.');
  var props = PropertiesService.getScriptProperties();
  var salt = Utilities.getUuid();
  props.setProperty('salt_user_' + username, salt);
  props.setProperty('hash_user_' + username, hashPassword_(next, salt));
  props.setProperty('ready_user_' + username, 'yes');
  props.setProperty('epoch_user_' + username, String(Date.now()));
  clearFailures_(username);
  return issueSession_(username, user.role);
}

function requireSession_(token) {
  var session = readSession_(token);
  if (!session || !signInUser_(session.username)) throw new Error('Sign in required.');
  var epoch = PropertiesService.getScriptProperties().getProperty('epoch_user_' + session.username) || '0';
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

function dropUserSessions_(username) {
  var all = readSessionMap_();
  Object.keys(all).forEach(function (key) {
    if (all[key] && all[key].username === username) delete all[key];
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

function changePassword_() {
  throw new Error('Liz, Cordell, and Kelly each create a password at sign-in.');
}

/** Clears one person's saved password so the starting password works again. */
function resetSignIn_(payload) {
  var username = String((payload && payload.username) || '').trim().toLowerCase();
  if (!signInUser_(username)) throw new Error('That username is not allowed.');
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('hash_user_' + username);
  props.deleteProperty('salt_user_' + username);
  props.deleteProperty('ready_user_' + username);
  props.setProperty('epoch_user_' + username, String(Date.now()));
  dropUserSessions_(username);
  return { ok: true, username: username };
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
