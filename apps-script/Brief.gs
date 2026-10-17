/**
 * Morning Manager Brief: one printable start-up page and two automatic management emails.
 * Figures come from home_() and peopleRows_() — the same Home and Sales Team calculations.
 * Production delivery stays off until an Admin enables it.
 */

var BRIEF_MAIL_TO_ = 'Store17MGMT-Mail@kanesfurniture.onmicrosoft.com';
var BRIEF_KIND_STARTUP_ = 'startup';
var BRIEF_KIND_MTD_ = 'mtd';
var BRIEF_PLANS_TAB_ = 'CC_BriefPlans';
var BRIEF_MAIL_TAB_ = 'CC_BriefMail';
var BRIEF_HISTORY_TAB_ = 'CC_BriefHistory';
var BRIEF_PLANS_HEADERS_ = ['date', 'action1', 'action2', 'action3', 'notes', 'updated_at', 'updated_by'];
var BRIEF_MAIL_HEADERS_ = ['sent_at', 'business_date', 'kind', 'channel', 'status', 'to_address', 'subject', 'version', 'missing', 'reason', 'by_role'];
var BRIEF_HISTORY_HEADERS_ = ['business_date', 'kind', 'version', 'generated_at', 'subject', 'html', 'text', 'missing', 'partial', 'promotion_name', 'promotion_changed'];

function briefEsc_(value) {
  return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function briefBlank_(value) {
  return value === null || value === undefined || value === '';
}

function briefMoney_(value) {
  return briefBlank_(value) ? 'Pending' : moneyText_(value);
}

function briefPercent_(value) {
  return briefBlank_(value) ? 'Pending' : percentText_(value);
}

function briefCount_(value) {
  return briefBlank_(value) ? 'Pending' : String(Math.round(Number(value)));
}

function briefSignedMoney_(value) {
  if (briefBlank_(value)) return 'Pending';
  var number = Number(value);
  return (number > 0 ? '+' : '') + moneyText_(number);
}

function briefPoints_(actual, goal) {
  if (briefBlank_(actual) || briefBlank_(goal)) return 'Pending';
  var points = Math.round((Number(actual) - Number(goal)) * 1000) / 10;
  return (points > 0 ? '+' : '') + points.toFixed(1) + ' pts';
}

function briefDisplayDate_(iso) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var parts = String(iso || '').split('-');
  var month = months[Number(parts[1]) - 1];
  var day = Number(parts[2]);
  if (!month || !day || !parts[0]) return String(iso || '');
  return month + ' ' + day + ', ' + parts[0];
}

function briefSubjectDate_(iso) {
  return briefDisplayDate_(iso) || iso;
}

function briefValidEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function briefNormalizeEmail_(value) {
  return String(value || '').trim().toLowerCase();
}

function briefEnsureTab_(name, headers) {
  forgetRead_(name);
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) {
    tab = spreadsheet.insertSheet(name);
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
    return tab;
  }
  var head = String(tab.getRange(1, 1).getValue() || '');
  if (head !== headers[0]) tab.getRange(1, 1, 1, headers.length).setValues([headers]);
  return tab;
}

function ensureBriefMailDefaults_() {
  var config = config_();
  if (configBlank_(config, 'brief_mail_enabled')) putConfig_('brief_mail_enabled', 'no');
  if (configBlank_(config, 'brief_mail_to')) putConfig_('brief_mail_to', BRIEF_MAIL_TO_);
}

function briefMailEnabled_() {
  try { ensureBriefMailDefaults_(); } catch (error) {}
  return String(config_().brief_mail_enabled || '').trim().toLowerCase() === 'yes';
}

function briefMailTo_() {
  try { ensureBriefMailDefaults_(); } catch (error) {}
  var configured = String(config_().brief_mail_to || '').trim();
  return briefValidEmail_(configured) ? configured : BRIEF_MAIL_TO_;
}

function briefKpiByName_(kpis, name) {
  var match = null;
  (kpis || []).forEach(function (row) { if (row && row.name === name) match = row; });
  return match;
}

function briefLastYearStore_(config, store) {
  var pending = function (reason) { return { value: null, basis: reason }; };
  if (typeof storeLastYear_ !== 'function') {
    return {
      period: '',
      confirmed: false,
      written: pending('Pending: last-year comparison is not available.'),
      delivered: pending('Pending: last-year comparison is not available.'),
    };
  }
  var ly = storeLastYear_(config, store);
  var period = ly.start && ly.end ? ly.start + ' through ' + ly.end : '';
  if (!ly.confirmed) {
    var wait = pending('Pending: ' + ly.status);
    return { period: period, confirmed: false, written: wait, delivered: wait };
  }
  var rows = typeof lastYearRows_ === 'function' ? lastYearRows_() : [];
  function pick(metric) {
    var match = null;
    rows.forEach(function (row) {
      if (row.start !== ly.start || row.end !== ly.end) return;
      if (String(row.track || '').toLowerCase() !== 'store') return;
      if (row.metric !== metric) return;
      if (row.person || row.employeeId) return;
      if (row.value === null || !row.verifiedBy) return;
      if (typeof lastYearSameReport_ === 'function' && !lastYearSameReport_(metric, row.source)) return;
      match = row;
    });
    if (!match) return pending('Pending: no verified last-year ' + metric + ' for ' + ly.start + ' through ' + ly.end + ' is on CC_LastYear.');
    return { value: match.value, basis: 'CC_LastYear ' + match.source + ' ' + ly.start + ' through ' + ly.end + ', verified by ' + match.verifiedBy };
  }
  return { period: period, confirmed: true, written: pick('NWDSR Written'), delivered: pick('NWDSR Delivered') };
}

function briefPersonShortfalls_(person) {
  var items = [];
  if (!briefBlank_(person.monthlyGoal) && !briefBlank_(person.snapWritten) && Number(person.snapWritten) < Number(person.monthlyGoal)) {
    items.push('SNAP Written ' + briefPercent_(person.snapWritten / person.monthlyGoal) + ' of monthly goal');
  }
  if (!briefBlank_(person.closingRatio) && !briefBlank_(person.closing && person.closing.goal) && Number(person.closingRatio) < Number(person.closing.goal)) {
    items.push('Closing ' + briefPercent_(person.closingRatio) + ' vs ' + briefPercent_(person.closing.goal));
  }
  (person.kpis || []).forEach(function (kpi) {
    if (!kpi || kpi.name === 'Closing Ratio' || kpi.name === 'Orders') return;
    if (briefBlank_(kpi.written) || briefBlank_(kpi.goal)) return;
    if (Number(kpi.written) >= Number(kpi.goal)) return;
    items.push(kpi.name + ' ' + (kpi.unit === 'percent' ? briefPercent_(kpi.written) : (kpi.unit === 'dollars' ? briefMoney_(kpi.written) : briefCount_(kpi.written))) + ' vs goal');
  });
  var lines = person.attachments && person.attachments.written ? person.attachments.written.lines : [];
  (lines || []).forEach(function (line) {
    if (!line || line.status !== 'below') return;
    items.push(line.name + ' ' + briefPercent_(line.actual) + ' vs ' + briefPercent_(line.goal));
  });
  var unique = [];
  items.forEach(function (item) { if (unique.indexOf(item) === -1) unique.push(item); });
  return unique.slice(0, 4);
}

function briefPlanRow_(date) {
  var found = null;
  sheet_(BRIEF_PLANS_TAB_).forEach(function (row) {
    if (isoDate_(row.date) === date) found = row;
  });
  if (!found) return { date: date, actions: [], notes: '', saved: false };
  var actions = [found.action1, found.action2, found.action3].map(function (line) { return String(line || '').trim(); }).filter(function (line) { return line; });
  return { date: date, actions: actions, notes: String(found.notes || ''), saved: actions.length > 0, updatedAt: String(found.updated_at || ''), updatedBy: String(found.updated_by || '') };
}

function briefDefaultPriorities_(home, missing) {
  var actions = [];
  if (missing.length) actions.push('Obtain the missing verified reports: ' + missing.slice(0, 4).join('; ') + '.');
  var written = home.board && home.board.yesterday ? home.board.yesterday.written : null;
  if (written && written.result === 'MISSED' && !briefBlank_(written.delta)) {
    actions.push('Recover yesterday\'s written shortfall of ' + moneyText_(Math.abs(written.delta)) + ' against the saved daily goal.');
  }
  var delivered = home.board && home.board.yesterday ? home.board.yesterday.delivered : null;
  if (delivered && delivered.result === 'MISSED' && !briefBlank_(delivered.delta)) {
    actions.push('Recover yesterday\'s delivered shortfall of ' + moneyText_(Math.abs(delivered.delta)) + ' against the saved daily goal.');
  }
  if (home.todayGoal && !briefBlank_(home.todayGoal.written)) {
    actions.push('Hit today\'s written goal of ' + moneyText_(home.todayGoal.written) + ' and delivered goal of ' + (briefBlank_(home.todayGoal.delivered) ? 'Pending' : moneyText_(home.todayGoal.delivered)) + '.');
  }
  var closing = home.yesterday || {};
  if (!briefBlank_(closing.closingRatio) && home.closing && !briefBlank_(home.closing.goal) && Number(closing.closingRatio) < Number(home.closing.goal)) {
    actions.push('Coach the floor on closing: yesterday was ' + percentText_(closing.closingRatio) + ' against a ' + percentText_(home.closing.goal) + ' goal.');
  }
  if (actions.length < 3) actions.push('Present maintenance plans on every qualified written sale.');
  return actions.slice(0, 3);
}

function briefCoaching_(home, people) {
  var candidates = [];
  (people || []).forEach(function (person) {
    if (!briefBlank_(person.closingRatio) && person.closing && !briefBlank_(person.closing.goal) && Number(person.closingRatio) < Number(person.closing.goal)) {
      candidates.push({
        weight: Number(person.closing.goal) - Number(person.closingRatio),
        text: 'Coach ' + person.name + ' on closing: ' + percentText_(person.closingRatio) + ' versus ' + percentText_(person.closing.goal) +
          (person.closingThrough ? ' through ' + person.closingThrough : '') + ' (Group 17 written orders ÷ individual PERQ).',
      });
    }
  });
  if (candidates.length) {
    candidates.sort(function (a, b) { return b.weight - a.weight; });
    return candidates[0].text;
  }
  var written = home.board && home.board.yesterday ? home.board.yesterday.written : null;
  if (written && written.result === 'MISSED' && !briefBlank_(written.actual)) {
    return 'Coach the sales floor on written sales: yesterday finished ' + moneyText_(written.actual) + ' versus the saved goal of ' + moneyText_(written.goal) + '.';
  }
  var kpis = home.board && home.board.kpis ? home.board.kpis : [];
  var i;
  for (i = 0; i < kpis.length; i += 1) {
    var row = kpis[i];
    if (briefBlank_(row.written) || briefBlank_(row.goal)) continue;
    if (Number(row.written) >= Number(row.goal)) continue;
    return 'Coach store ' + row.name + ': written ' + (row.unit === 'percent' ? percentText_(row.written) : (row.unit === 'dollars' ? moneyText_(row.written) : String(row.written))) +
      ' versus goal ' + (row.unit === 'percent' ? percentText_(row.goal) : (row.unit === 'dollars' ? moneyText_(row.goal) : String(row.goal))) +
      (row.through ? ' through ' + row.through : '') + '.';
  }
  return 'No coaching item is supported by verified data.';
}

function briefShoutOut_(winners) {
  if (!winners || winners.status !== 'ready' || !winners.people || !winners.people.length) {
    return { text: 'Pending', source: winners && winners.reason ? winners.reason : 'PERQ Report Pending' };
  }
  if (!winners.snapReported) {
    return { text: 'Pending', source: winners.reason || ('SNAP Written by salesperson for ' + winners.date + ' is not on file') };
  }
  var top = [];
  var best = null;
  winners.people.forEach(function (person) {
    if (briefBlank_(person.written)) return;
    if (best === null || Number(person.written) > best) {
      best = Number(person.written);
      top = [person];
    } else if (Number(person.written) === best) top.push(person);
  });
  if (best === null) return { text: 'Pending', source: 'SNAP Written by salesperson for ' + winners.date + ' is not on file' };
  if (best <= 0) return { text: 'No exceptional verified sale on the complete SNAP report.', source: 'SNAP Written by salesperson ' + winners.date };
  var names = top.map(function (person) { return person.name + ' ' + moneyText_(person.written); }).join('; ');
  var extra = top.some(function (person) { return !briefBlank_(person.above); })
    ? ' Exceeded the individual share of yesterday\'s written goal.'
    : '';
  return { text: names + extra, source: 'SNAP Written by salesperson ' + winners.date };
}

function briefTopPeople_(winners) {
  if (!winners || winners.status !== 'ready' || !winners.people || !winners.people.length) {
    return { text: 'Pending', source: winners && winners.reason ? winners.reason : 'PERQ Report Pending' };
  }
  if (!winners.snapReported) {
    return { text: 'Pending', source: winners.reason || ('SNAP Written by salesperson for ' + winners.date + ' is not on file') };
  }
  var ranked = winners.people.filter(function (person) { return !briefBlank_(person.written); });
  if (!ranked.length) return { text: 'Pending', source: 'SNAP Written by salesperson for ' + winners.date + ' is not on file' };
  var best = Number(ranked[0].written);
  var leaders = ranked.filter(function (person) { return Number(person.written) === best; });
  return {
    text: leaders.map(function (person) { return person.name + ' ' + moneyText_(person.written); }).join('; '),
    source: 'SNAP Written by salesperson ' + winners.date,
  };
}

function lastBriefPromotion_() {
  var found = null;
  sheet_(BRIEF_HISTORY_TAB_).forEach(function (row) {
    if (String(row.kind) !== BRIEF_KIND_STARTUP_) return;
    found = { name: String(row.promotion_name || ''), changed: String(row.promotion_changed || '') === 'yes' };
  });
  return found;
}

function briefPromotionInfo_(today) {
  var raw = null;
  try { raw = readPromotion_(); } catch (error) { raw = null; }
  var current = saleOnDate_(raw, today);
  var last = null;
  try { last = lastBriefPromotion_(); } catch (error) { last = null; }
  if (!current) {
    return { name: '', details: false, current: null, note: 'No approved promotion is on the calendar.' };
  }
  var changed = !last || last.name !== current.name;
  return { name: current.name, details: changed, current: current, note: '' };
}

function briefMissingSources_(home, winners, people) {
  var missing = [];
  var yesterday = home.yesterday || {};
  var labels = home.labels || {};
  if (briefBlank_(yesterday.written)) missing.push((labels.written || 'NWDSR Net Written') + ' for ' + yesterday.date);
  if (briefBlank_(yesterday.delivered)) missing.push((labels.delivered || 'NWDSR Delivered') + ' for ' + yesterday.date);
  if (briefBlank_(yesterday.opportunities)) missing.push('PERQ opportunities for ' + yesterday.date);
  if (briefBlank_(yesterday.customers)) missing.push('Net Written purchasing customers for ' + yesterday.date);
  if (briefBlank_(yesterday.closingRatio)) missing.push('Closing ratio for ' + yesterday.date + (yesterday.closingNote ? ' (' + yesterday.closingNote + ')' : ''));
  if (winners && winners.status !== 'ready') missing.push('Individual PERQ for ' + (winners.date || 'the prior business day'));
  if (winners && winners.status === 'ready' && winners.people && winners.people.length && !winners.snapReported) {
    missing.push('SNAP Written by salesperson for ' + winners.date);
  }
  if (briefBlank_(home.todayGoal && home.todayGoal.written)) missing.push('Today\'s written goal (store written remaining ÷ open days left)');
  if (briefBlank_(home.todayGoal && home.todayGoal.delivered)) missing.push('Today\'s delivered goal (store delivered remaining ÷ open days left)');
  if (briefBlank_(home.month && home.month.written)) missing.push((labels.written || 'NWDSR Net Written') + ' store month-to-date');
  if (briefBlank_(home.month && home.month.delivered)) missing.push((labels.delivered || 'NWDSR Delivered') + ' store month-to-date');
  (home.board && home.board.kpis ? home.board.kpis : []).forEach(function (row) {
    if (briefBlank_(row.written) && (row.name === 'Closing Ratio' || briefBlank_(row.delivered))) {
      missing.push('Store ' + row.name + (row.note ? ' (' + row.note + ')' : ' not on a verified store-month report'));
    }
  });
  var snapPending = people && people.snapPending ? people.snapPending : [];
  if (snapPending.length) missing.push('Salesperson SNAP for ' + snapPending.join(', '));
  return missing;
}

function briefBrandHeader_(useCid) {
  var kanes = '';
  var store = '';
  if (useCid) {
    kanes = '<img src="cid:kanes" alt="Kane\'s Furniture" width="140" style="display:block;height:auto;max-width:140px;border:0" />';
    store = '<img src="cid:store17" alt="Store 17" width="72" style="display:block;height:auto;max-width:72px;border:0" />';
  } else {
    if (typeof KANES_LOGO_JPEG_ !== 'undefined') {
      kanes = '<img src="data:image/jpeg;base64,' + KANES_LOGO_JPEG_ + '" alt="Kane\'s Furniture" width="140" style="display:block;height:auto;max-width:140px;border:0" />';
    }
    if (typeof STORE17_LOGO_PNG_ !== 'undefined') {
      store = '<img src="data:image/png;base64,' + STORE17_LOGO_PNG_ + '" alt="Store 17" width="72" style="display:block;height:auto;max-width:72px;border:0" />';
    }
  }
  if (!kanes && !store) {
    return '<div style="font:700 18px Segoe UI,Helvetica,Arial,sans-serif;color:#0b3b40;letter-spacing:0.04em">KANE\'S FURNITURE · STORE 17</div>';
  }
  return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
    (kanes ? '<td style="padding:0 16px 0 0;vertical-align:middle">' + kanes + '</td>' : '') +
    (store ? '<td style="padding:0;vertical-align:middle">' + store + '</td>' : '') +
    '</tr></table>';
}

function briefEmailWrap_(title, date, inner, useCid, banner) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8" /><title>' + briefEsc_(title) + '</title></head>' +
    '<body style="margin:0;padding:0;background:#f4f6f7;color:#102027">' +
    '<div style="max-width:720px;margin:0 auto;padding:16px 12px;font:14px/1.35 Segoe UI,Helvetica,Arial,sans-serif;background:#ffffff">' +
    briefBrandHeader_(useCid) +
    '<p style="margin:12px 0 0;color:#0b7f88;font:700 11px/1.2 Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:0.08em">KANE\'S FURNITURE · STORE 17</p>' +
    '<h1 style="margin:4px 0 2px;font:700 22px/1.15 Segoe UI,Helvetica,Arial,sans-serif;color:#102027">' + briefEsc_(title) + '</h1>' +
    '<p style="margin:0 0 10px;color:#3d5660">America/New_York · ' + briefEsc_(briefDisplayDate_(date)) + '</p>' +
    (banner || '') + inner +
    '</div></body></html>';
}

function briefBanner_(missing, partial) {
  if (!partial && !missing.length) return '';
  var lines = missing.length
    ? 'Missing or unverified sources: ' + missing.join('; ') + '.'
    : 'This report is partial. Missing figures are Pending and are not treated as zero.';
  return '<div style="margin:0 0 12px;padding:8px 10px;border:1px solid #b45309;background:#fff7ed;color:#7c2d12;font:13px/1.35 Segoe UI,Helvetica,Arial,sans-serif"><strong>Partial report — not final.</strong> ' + briefEsc_(lines) + '</div>';
}

function briefRow_(label, value, note) {
  return '<tr><td style="padding:4px 8px 4px 0;border-bottom:1px solid #d7e2e6;width:42%;color:#3d5660">' + briefEsc_(label) +
    '</td><td style="padding:4px 0;border-bottom:1px solid #d7e2e6;font-weight:700">' + briefEsc_(value) +
    (note ? '<div style="font-weight:400;color:#3d5660;font-size:12px">' + briefEsc_(note) + '</div>' : '') +
    '</td></tr>';
}

function briefSection_(title, body) {
  return '<h2 style="margin:14px 0 6px;font:700 13px/1.2 Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:0.08em;color:#0b7f88">' +
    briefEsc_(title) + '</h2>' + body;
}

function briefFooter_(pack, kind) {
  return '<p style="margin:14px 0 0;color:#5b7380;font-size:11px">Report version ' + briefEsc_(pack.version) +
    ' · ' + briefEsc_(kind) + ' · figures as of ' + briefEsc_(pack.updated || 'Not Available') +
    '. Unverified numbers are labeled Pending and are not final. Store month is the 2nd through the 1st. Salesperson month is the 1st through the last day.</p>';
}

function briefVsGoal_(perf, source) {
  if (!perf || briefBlank_(perf.actual)) return { value: 'Pending', note: source };
  if (briefBlank_(perf.goal) || !perf.result) return { value: briefMoney_(perf.actual), note: source + ' · saved goal is not on file' };
  return {
    value: briefMoney_(perf.actual) + ' vs ' + briefMoney_(perf.goal) + ' · ' + perf.result,
    note: source + (briefBlank_(perf.delta) ? '' : ' · ' + briefSignedMoney_(perf.delta)),
  };
}

function briefStartupInner_(pack) {
  var y = pack.yesterday;
  var written = briefVsGoal_(y.written, pack.labels.written || 'NWDSR Net Written');
  var delivered = briefVsGoal_(y.delivered, pack.labels.delivered || 'NWDSR Delivered');
  var promoBody = '';
  if (!pack.promotion.name) {
    promoBody = '<p style="margin:0">No approved promotion is on the calendar.</p>';
  } else if (!pack.promotion.details) {
    promoBody = '<p style="margin:0;font-weight:700">' + briefEsc_(pack.promotion.name) + '</p><p style="margin:4px 0 0;color:#3d5660">The promotion has not changed. Name only.</p>';
  } else {
    var promo = pack.promotion.current;
    promoBody = '<p style="margin:0;font-weight:700">' + briefEsc_(promo.name) + '</p>' +
      '<p style="margin:4px 0 0;color:#3d5660">' + briefEsc_(promo.start) + ' through ' + briefEsc_(promo.end) + ' · new or changed promotion details from the approved calendar.</p>' +
      '<ul style="margin:6px 0 0;padding-left:18px">' + (promo.highlights || []).map(function (line) { return '<li>' + briefEsc_(line) + '</li>'; }).join('') + '</ul>';
  }
  var priorities = '<ol style="margin:6px 0 0;padding-left:20px">' + pack.priorities.map(function (line) { return '<li>' + briefEsc_(line) + '</li>'; }).join('') + '</ol>';
  return briefSection_('Yesterday · ' + briefDisplayDate_(y.date),
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">' +
      briefRow_('Written sales versus goal', written.value, written.note) +
      briefRow_('Delivered sales versus goal', delivered.value, delivered.note) +
      briefRow_('Customer opportunities', briefCount_(y.opportunities), briefBlank_(y.opportunities) ? 'PERQ Ups + Be Backs' : 'PERQ Ups + Be Backs · ' + y.date) +
      briefRow_('Purchasing customers', briefCount_(y.customers), briefBlank_(y.customers) ? 'Net Written customers' : 'Net Written customers · ' + y.date) +
      briefRow_('Closing Ratio', briefPercent_(y.closingRatio), briefBlank_(y.closingRatio) ? (y.closingNote || 'Net Written customers ÷ PERQ') : y.customers + ' customers ÷ ' + y.opportunities + ' opportunities') +
      briefRow_('Top performing salesperson(s)', pack.top.text, pack.top.source) +
      briefRow_('Shout-out', pack.shout.text, pack.shout.source) +
      '</table>') +
    briefSection_('Today · ' + briefDisplayDate_(pack.today),
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">' +
      briefRow_('Today\'s Written goal', briefMoney_(pack.todayWritten), 'Remaining store written budget ÷ open days left, including today.') +
      briefRow_('Today\'s Delivered goal', briefMoney_(pack.todayDelivered), 'Remaining store delivered budget ÷ open days left, including today.') +
      '</table>' +
      '<p style="margin:8px 0 0;font-weight:700">Three priority actions</p>' + priorities +
      '<p style="margin:8px 0 0;font-weight:700">Coaching opportunity</p><p style="margin:4px 0 0">' + briefEsc_(pack.coaching) + '</p>') +
    briefSection_('Current promotion', promoBody) +
    briefFooter_(pack, 'Morning Start-Up');
}

function briefKpiCell_(value, unit) {
  if (briefBlank_(value)) return 'Pending';
  if (unit === 'percent') return percentText_(value);
  if (unit === 'dollars') return moneyText_(value);
  return String(value);
}

function briefKpiDiff_(actual, goal, unit) {
  if (briefBlank_(actual) || briefBlank_(goal)) return 'Pending';
  if (unit === 'percent') return briefPoints_(actual, goal);
  if (unit === 'dollars') return briefSignedMoney_(Number(actual) - Number(goal));
  var delta = Math.round((Number(actual) - Number(goal)) * 100) / 100;
  return (delta > 0 ? '+' : '') + String(delta);
}

function briefMtdInner_(pack) {
  var month = pack.month;
  var ly = pack.lastYear;
  var sales = '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">' +
    briefRow_('Written MTD versus $400,000 goal', briefBlank_(month.written) ? 'Pending' : (briefMoney_(month.written) + ' vs ' + briefMoney_(month.writtenGoal) + ' · ' + briefPercent_(month.writtenAchieved)), pack.labels.written + ' · store month ' + pack.storePeriod) +
    briefRow_('Delivered MTD versus $320,000 goal', briefBlank_(month.delivered) ? 'Pending' : (briefMoney_(month.delivered) + ' vs ' + briefMoney_(month.deliveredGoal) + ' · ' + briefPercent_(month.deliveredAchieved)), pack.labels.delivered + ' · store month ' + pack.storePeriod) +
    briefRow_('Remaining to written goal', briefMoney_(month.writtenLeft), 'Written goal minus NWDSR written') +
    briefRow_('Remaining to delivered goal', briefMoney_(month.deliveredLeft), 'Delivered goal minus NWDSR delivered') +
    briefRow_('Required daily written pace', briefMoney_(pack.todayWritten), pack.daysLeft === null ? 'Open days left are not on file' : pack.daysLeft + ' open days left including today') +
    briefRow_('Required daily delivered pace', briefMoney_(pack.todayDelivered), pack.daysLeft === null ? 'Open days left are not on file' : pack.daysLeft + ' open days left including today') +
    briefRow_('Last-year written', briefBlank_(ly.written.value) ? 'Pending' : moneyText_(ly.written.value), ly.written.basis) +
    briefRow_('Last-year delivered', briefBlank_(ly.delivered.value) ? 'Pending' : moneyText_(ly.delivered.value), ly.delivered.basis) +
    '</table>';
  var kpiHead = '<tr>' +
    ['KPI', 'Written', 'W Goal', 'W Diff', 'Delivered', 'D Goal', 'D Diff', 'Cutoff'].map(function (h) {
      return '<th style="text-align:left;padding:4px 6px;border-bottom:2px solid #0b7f88;font:700 11px/1.2 Segoe UI,Helvetica,Arial,sans-serif;color:#0b7f88">' + h + '</th>';
    }).join('') + '</tr>';
  var kpiRows = pack.kpis.map(function (row) {
    var deliveredGoal = row.name === 'Closing Ratio' ? '' : briefKpiCell_(row.goal, row.unit);
    var delivered = row.name === 'Closing Ratio' ? '—' : briefKpiCell_(row.written && row.name === 'Closing Ratio' ? null : row.delivered, row.unit);
    if (row.name === 'Closing Ratio') delivered = '—';
    return '<tr>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(row.name) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefKpiCell_(row.written, row.unit)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefKpiCell_(row.goal, row.unit)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefKpiDiff_(row.written, row.goal, row.unit)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(row.name === 'Closing Ratio' ? '—' : briefKpiCell_(row.delivered, row.unit)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(row.name === 'Closing Ratio' ? '—' : deliveredGoal) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(row.name === 'Closing Ratio' ? '—' : briefKpiDiff_(row.delivered, row.goal, row.unit)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(row.through || (row.note ? 'Pending' : '')) + '</td>' +
      '</tr>';
  }).join('');
  var teamHead = '<tr>' +
    ['Associate', 'SNAP Written MTD', 'Monthly Written goal', '% to goal', 'Data Analysis Delivered MTD', 'Written orders', 'PERQ opportunities', 'Closing Ratio', 'Key KPI shortfalls'].map(function (h) {
      return '<th style="text-align:left;padding:4px 6px;border-bottom:2px solid #0b7f88;font:700 11px/1.2 Segoe UI,Helvetica,Arial,sans-serif;color:#0b7f88">' + h + '</th>';
    }).join('') + '</tr>';
  var teamRows = pack.people.map(function (person) {
    var pct = briefBlank_(person.snapWritten) || briefBlank_(person.monthlyGoal) ? 'Pending' : percentText_(person.snapWritten / person.monthlyGoal);
    var shortfalls = (person.shortfalls || []).join('; ') || 'None verified';
    return '<tr>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(person.name) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefMoney_(person.snapWritten)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefMoney_(person.monthlyGoal)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(pct) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefMoney_(person.deliveredSales)) + (person.deliveredThrough ? '<div style="color:#3d5660;font-size:11px">through ' + briefEsc_(person.deliveredThrough) + '</div>' : '') + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefBlank_(person.writtenOrders) ? 'Pending' : String(person.writtenOrders)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefBlank_(person.opportunities) ? 'Pending' : String(person.opportunities)) + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6">' + briefEsc_(briefPercent_(person.closingRatio)) + (person.closingThrough ? '<div style="color:#3d5660;font-size:11px">through ' + briefEsc_(person.closingThrough) + '</div>' : '') + '</td>' +
      '<td style="padding:4px 6px;border-bottom:1px solid #d7e2e6;font-size:12px">' + briefEsc_(shortfalls) + '</td>' +
      '</tr>';
  }).join('');
  return '<p style="margin:0 0 8px;color:#3d5660"><strong>Store reporting period:</strong> ' + briefEsc_(pack.storePeriod) +
    ' (2nd of the month through the 1st of the following month).<br /><strong>Individual salesperson period:</strong> ' +
    briefEsc_(pack.individualPeriod) + ' (1st through the last calendar day). ' + briefEsc_(pack.goalEffective) + '</p>' +
    briefSection_('Store sales', sales) +
    briefSection_('Store performance', '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px">' + kpiHead + kpiRows + '</table>') +
    briefSection_('Sales team', '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px">' + teamHead + teamRows + '</table>') +
    briefFooter_(pack, 'MTD Performance');
}

function briefStartupHtml_(pack, useCid) {
  return briefEmailWrap_('STORE 17 | MORNING START-UP', pack.today, briefStartupInner_(pack), useCid, briefBanner_(pack.missing, pack.partial));
}

function briefMtdHtml_(pack, useCid) {
  return briefEmailWrap_('STORE 17 | MTD PERFORMANCE', pack.today, briefMtdInner_(pack), useCid, briefBanner_(pack.missing, pack.partial));
}

function briefStartupText_(pack) {
  var y = pack.yesterday;
  var written = briefVsGoal_(y.written, pack.labels.written || 'NWDSR Net Written');
  var delivered = briefVsGoal_(y.delivered, pack.labels.delivered || 'NWDSR Delivered');
  var lines = [
    'STORE 17 | MORNING START-UP | ' + briefSubjectDate_(pack.today),
    'Kane\'s Furniture · Store 17 · America/New_York',
    pack.partial ? 'PARTIAL REPORT — NOT FINAL' : '',
    '',
    'YESTERDAY · ' + y.date,
    'Written sales versus goal: ' + written.value + ' (' + written.note + ')',
    'Delivered sales versus goal: ' + delivered.value + ' (' + delivered.note + ')',
    'Customer opportunities: ' + briefCount_(y.opportunities),
    'Purchasing customers: ' + briefCount_(y.customers),
    'Closing Ratio: ' + briefPercent_(y.closingRatio),
    'Top performing salesperson(s): ' + pack.top.text + (pack.top.source ? ' (' + pack.top.source + ')' : ''),
    'Shout-out: ' + pack.shout.text + (pack.shout.source ? ' (' + pack.shout.source + ')' : ''),
    '',
    'TODAY · ' + pack.today,
    'Today\'s Written goal: ' + briefMoney_(pack.todayWritten),
    'Today\'s Delivered goal: ' + briefMoney_(pack.todayDelivered),
    'Priority actions:',
  ];
  pack.priorities.forEach(function (line, i) { lines.push((i + 1) + '. ' + line); });
  lines.push('Coaching: ' + pack.coaching);
  lines.push('');
  if (!pack.promotion.name) lines.push('CURRENT PROMOTION: No approved promotion is on the calendar.');
  else if (!pack.promotion.details) lines.push('CURRENT PROMOTION: ' + pack.promotion.name + ' (name only; the promotion has not changed).');
  else lines.push('CURRENT PROMOTION: ' + pack.promotion.name + ' (new or changed approved promotion details).');
  if (pack.missing.length) {
    lines.push('');
    lines.push('Missing sources: ' + pack.missing.join('; '));
  }
  return lines.filter(function (line, i, all) { return line || all[i - 1]; }).join('\n');
}

function briefMtdText_(pack) {
  var month = pack.month;
  var lines = [
    'STORE 17 | MTD PERFORMANCE | ' + briefSubjectDate_(pack.today),
    'Kane\'s Furniture · Store 17 · America/New_York',
    'Store period: ' + pack.storePeriod + ' (2nd through the 1st).',
    'Salesperson period: ' + pack.individualPeriod + ' (1st through the last day).',
    pack.partial ? 'PARTIAL REPORT — NOT FINAL' : '',
    '',
    'STORE SALES',
    'Written MTD: ' + briefMoney_(month.written) + ' vs ' + briefMoney_(month.writtenGoal) + ' (' + briefPercent_(month.writtenAchieved) + ')',
    'Delivered MTD: ' + briefMoney_(month.delivered) + ' vs ' + briefMoney_(month.deliveredGoal) + ' (' + briefPercent_(month.deliveredAchieved) + ')',
    'Remaining written: ' + briefMoney_(month.writtenLeft) + ' · daily pace ' + briefMoney_(pack.todayWritten),
    'Remaining delivered: ' + briefMoney_(month.deliveredLeft) + ' · daily pace ' + briefMoney_(pack.todayDelivered),
    'Last-year written: ' + (briefBlank_(pack.lastYear.written.value) ? 'Pending' : moneyText_(pack.lastYear.written.value)) + ' — ' + pack.lastYear.written.basis,
    'Last-year delivered: ' + (briefBlank_(pack.lastYear.delivered.value) ? 'Pending' : moneyText_(pack.lastYear.delivered.value)) + ' — ' + pack.lastYear.delivered.basis,
    '',
    'STORE PERFORMANCE',
  ];
  pack.kpis.forEach(function (row) {
    lines.push(row.name + ': written ' + briefKpiCell_(row.written, row.unit) + ' vs ' + briefKpiCell_(row.goal, row.unit) +
      (row.name === 'Closing Ratio' ? '' : ' · delivered ' + briefKpiCell_(row.delivered, row.unit)) +
      (row.through ? ' · through ' + row.through : ''));
  });
  lines.push('');
  lines.push('SALES TEAM');
  pack.people.forEach(function (person) {
    var pct = briefBlank_(person.snapWritten) || briefBlank_(person.monthlyGoal) ? 'Pending' : percentText_(person.snapWritten / person.monthlyGoal);
    lines.push(person.name + ': SNAP ' + briefMoney_(person.snapWritten) + ' / goal ' + briefMoney_(person.monthlyGoal) + ' (' + pct +
      ') · DA delivered ' + briefMoney_(person.deliveredSales) + ' · orders ' + (briefBlank_(person.writtenOrders) ? 'Pending' : person.writtenOrders) +
      ' · PERQ ' + (briefBlank_(person.opportunities) ? 'Pending' : person.opportunities) +
      ' · closing ' + briefPercent_(person.closingRatio) +
      (person.shortfalls && person.shortfalls.length ? ' · shortfalls: ' + person.shortfalls.join('; ') : ''));
  });
  if (pack.missing.length) {
    lines.push('');
    lines.push('Missing sources: ' + pack.missing.join('; '));
  }
  return lines.filter(function (line, i, all) { return line || all[i - 1]; }).join('\n');
}

function briefVersion_(pack) {
  var key = [APP_VERSION_, pack.today, pack.yesterday.date, pack.yesterday.written && pack.yesterday.written.actual, pack.month.written, pack.month.delivered, pack.missing.join('|')].join('~');
  if (typeof Utilities === 'undefined' || !Utilities.computeDigest) return APP_VERSION_ + '-' + pack.today;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, key);
  return APP_VERSION_ + '-' + digest.slice(0, 4).map(function (part) {
    var value = (part + 256) % 256;
    return (value < 16 ? '0' : '') + value.toString(16);
  }).join('');
}

function briefGoalEffective_(config, store) {
  if (typeof metricGoalEffective_ !== 'function') return 'Individual written goals use the established person_written / individual_volume_goal setting.';
  var definition = { goalKey: 'individual_volume_goal' };
  return 'Employee written goals: ' + metricGoalEffective_(definition, config, store) + '. Store written and delivered budgets: ' +
    metricGoalEffective_({ goalKey: 'written_goal' }, config, store) + '.';
}

function briefPack_(payload) {
  try { ensureBriefMailDefaults_(); } catch (error) {}
  var home = home_(payload);
  var today = home.today;
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var people = peopleRows_(individual.start, individual.end).map(function (person) {
    var copy = {};
    Object.keys(person).forEach(function (key) { copy[key] = person[key]; });
    copy.shortfalls = briefPersonShortfalls_(person);
    return copy;
  });
  var winners = home.winners || { date: priorBusinessDay_(today), status: 'pending', reason: 'PERQ Report Pending', people: [] };
  var missing = briefMissingSources_(home, winners, { snapPending: [] });
  try {
    var snapThrough = '';
    people.forEach(function (person) {
      (person.days || []).forEach(function (day) { if (day.date > snapThrough) snapThrough = day.date; });
    });
    if (snapThrough) {
      var pendingDays = snapPendingDates_(individual.start, individual.end, snapThrough);
      if (pendingDays.length) missing.push('Salesperson SNAP for ' + pendingDays.join(', '));
    }
  } catch (error) {}
  var plan = briefPlanRow_(today);
  var priorities = plan.saved ? plan.actions.slice(0, 3) : briefDefaultPriorities_(home, missing);
  while (priorities.length < 3) priorities.push(briefDefaultPriorities_(home, missing)[priorities.length] || 'Hit today\'s written and delivered goals.');
  var promotion = briefPromotionInfo_(today);
  var pack = {
    today: today,
    updated: home.updated,
    labels: home.labels || { written: 'NWDSR Net Written', delivered: 'NWDSR Delivered', snap: 'SNAP Written' },
    storePeriod: home.period,
    individualPeriod: home.individualPeriod,
    yesterday: {
      date: home.yesterday.date,
      written: home.board.yesterday.written,
      delivered: home.board.yesterday.delivered,
      opportunities: home.yesterday.opportunities,
      customers: home.yesterday.customers,
      closingRatio: home.yesterday.closingRatio,
      closingNote: home.yesterday.closingNote,
    },
    todayWritten: home.todayGoal.written,
    todayDelivered: home.todayGoal.delivered,
    daysLeft: home.todayGoal.daysLeft,
    month: home.board.month,
    kpis: home.board.kpis || [],
    people: people,
    winners: winners,
    top: briefTopPeople_(winners),
    shout: briefShoutOut_(winners),
    priorities: priorities.slice(0, 3),
    plan: plan,
    coaching: briefCoaching_(home, people),
    promotion: promotion,
    lastYear: briefLastYearStore_(config_(), store),
    missing: missing,
    partial: missing.length > 0,
    goalEffective: briefGoalEffective_(config_(), store),
    home: home,
  };
  pack.version = briefVersion_(pack);
  pack.startupSubject = 'STORE 17 | MORNING START-UP | ' + briefSubjectDate_(today);
  pack.mtdSubject = 'STORE 17 | MTD PERFORMANCE | ' + briefSubjectDate_(today);
  pack.startupInner = '<div style="padding:8px 4px">' + briefBrandHeader_(false) +
    '<p style="margin:12px 0 0;color:#0b7f88;font:700 11px/1.2 Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:0.08em">KANE\'S FURNITURE · STORE 17</p>' +
    '<h1 style="margin:4px 0 2px;font:700 22px/1.15 Segoe UI,Helvetica,Arial,sans-serif;color:#102027">STORE 17 | MORNING START-UP</h1>' +
    '<p style="margin:0 0 10px;color:#3d5660">America/New_York · ' + briefEsc_(briefDisplayDate_(pack.today)) + '</p>' +
    briefBanner_(pack.missing, pack.partial) + briefStartupInner_(pack) + '</div>';
  pack.mtdInner = '<div style="padding:8px 4px">' + briefBrandHeader_(false) +
    '<p style="margin:12px 0 0;color:#0b7f88;font:700 11px/1.2 Segoe UI,Helvetica,Arial,sans-serif;letter-spacing:0.08em">KANE\'S FURNITURE · STORE 17</p>' +
    '<h1 style="margin:4px 0 2px;font:700 22px/1.15 Segoe UI,Helvetica,Arial,sans-serif;color:#102027">STORE 17 | MTD PERFORMANCE</h1>' +
    '<p style="margin:0 0 10px;color:#3d5660">America/New_York · ' + briefEsc_(briefDisplayDate_(pack.today)) + '</p>' +
    briefBanner_(pack.missing, pack.partial) + briefMtdInner_(pack) + '</div>';
  pack.startupHtml = briefStartupHtml_(pack, false);
  pack.mtdHtml = briefMtdHtml_(pack, false);
  pack.startupHtmlCid = briefStartupHtml_(pack, true);
  pack.mtdHtmlCid = briefMtdHtml_(pack, true);
  pack.startupText = briefStartupText_(pack);
  pack.mtdText = briefMtdText_(pack);
  return pack;
}

function briefInlineImages_() {
  var images = {};
  try {
    if (typeof KANES_LOGO_JPEG_ !== 'undefined') {
      images.kanes = Utilities.newBlob(Utilities.base64Decode(KANES_LOGO_JPEG_), 'image/jpeg', 'kanes.jpeg');
    }
    if (typeof STORE17_LOGO_PNG_ !== 'undefined') {
      images.store17 = Utilities.newBlob(Utilities.base64Decode(STORE17_LOGO_PNG_), 'image/png', 'store17.png');
    }
  } catch (error) {
    return {};
  }
  return images;
}

function briefMailRows_() {
  return sheet_(BRIEF_MAIL_TAB_);
}

function logBriefMail_(row) {
  briefEnsureTab_(BRIEF_MAIL_TAB_, BRIEF_MAIL_HEADERS_);
  forgetRead_(BRIEF_MAIL_TAB_);
  briefEnsureTab_(BRIEF_MAIL_TAB_, BRIEF_MAIL_HEADERS_).appendRow([
    row.sentAt || new Date().toISOString(),
    row.date,
    row.kind,
    row.channel,
    row.status,
    row.to,
    row.subject,
    row.version || '',
    (row.missing || []).join('; '),
    row.reason || '',
    row.by || 'system',
  ]);
}

function saveBriefHistory_(pack, kind) {
  briefEnsureTab_(BRIEF_HISTORY_TAB_, BRIEF_HISTORY_HEADERS_);
  var html = kind === BRIEF_KIND_STARTUP_ ? pack.startupHtmlCid : pack.mtdHtmlCid;
  var text = kind === BRIEF_KIND_STARTUP_ ? pack.startupText : pack.mtdText;
  var subject = kind === BRIEF_KIND_STARTUP_ ? pack.startupSubject : pack.mtdSubject;
  forgetRead_(BRIEF_HISTORY_TAB_);
  briefEnsureTab_(BRIEF_HISTORY_TAB_, BRIEF_HISTORY_HEADERS_).appendRow([
    pack.today,
    kind,
    pack.version,
    new Date().toISOString(),
    subject,
    html,
    text,
    pack.missing.join('; '),
    pack.partial ? 'yes' : 'no',
    pack.promotion.name || '',
    pack.promotion.details ? 'yes' : 'no',
  ]);
}

function briefAlreadySent_(date, kind) {
  var props = typeof PropertiesService === 'undefined' ? null : PropertiesService.getScriptProperties();
  if (props && props.getProperty('brief_sent_' + kind + '_' + date) === 'yes') return true;
  return briefMailRows_().some(function (row) {
    return isoDate_(row.business_date) === date && String(row.kind) === kind && String(row.status) === 'sent' && String(row.channel) === 'automatic';
  });
}

function markBriefSent_(date, kind) {
  if (typeof PropertiesService === 'undefined') return;
  PropertiesService.getScriptProperties().setProperty('brief_sent_' + kind + '_' + date, 'yes');
}

function sendBriefKind_(pack, kind, to, channel, by) {
  var subject = kind === BRIEF_KIND_STARTUP_ ? pack.startupSubject : pack.mtdSubject;
  var html = kind === BRIEF_KIND_STARTUP_ ? pack.startupHtmlCid : pack.mtdHtmlCid;
  var text = kind === BRIEF_KIND_STARTUP_ ? pack.startupText : pack.mtdText;
  logBriefMail_({ date: pack.today, kind: kind, channel: channel, status: 'attempt', to: to, subject: subject, version: pack.version, missing: pack.missing, by: by });
  try {
    var images = briefInlineImages_();
    var options = {
      to: to,
      subject: subject,
      htmlBody: html,
      body: text,
      name: 'Kane\'s Store 17 Command Center',
    };
    if (images.kanes || images.store17) options.inlineImages = images;
    MailApp.sendEmail(options);
    logBriefMail_({ date: pack.today, kind: kind, channel: channel, status: 'sent', to: to, subject: subject, version: pack.version, missing: pack.missing, by: by });
    saveBriefHistory_(pack, kind);
    if (channel === 'automatic') markBriefSent_(pack.today, kind);
    return { sent: true, kind: kind, to: to, subject: subject, version: pack.version, partial: pack.partial };
  } catch (error) {
    var reason = String(error && error.message ? error.message : error);
    logBriefMail_({ date: pack.today, kind: kind, channel: channel, status: 'failed', to: to, subject: subject, version: pack.version, missing: pack.missing, reason: reason, by: by });
    return { sent: false, kind: kind, to: to, subject: subject, reason: reason };
  }
}

/**
 * After 6:00 AM ET, send Start-Up then MTD once per New York business date when production is enabled.
 * Incomplete figures still send as a clearly labeled partial report.
 */
function maybeSendBriefEmails_() {
  if (!briefMailEnabled_()) return { sent: false, reason: 'production delivery is off' };
  if (nowHourNy_() < 6) return { sent: false, reason: 'before 6:00 AM America/New_York' };
  var lock = typeof LockService !== 'undefined' ? LockService.getScriptLock() : null;
  if (lock && !lock.tryLock(5000)) return { sent: false, reason: 'another send is in progress' };
  try {
    var payload = { session: { role: 'admin' } };
    var pack = briefPack_(payload);
    var to = briefMailTo_();
    var results = [];
    if (briefAlreadySent_(pack.today, BRIEF_KIND_STARTUP_)) {
      results.push({ sent: false, kind: BRIEF_KIND_STARTUP_, reason: 'already sent today' });
    } else {
      results.push(sendBriefKind_(pack, BRIEF_KIND_STARTUP_, to, 'automatic', 'scheduler'));
    }
    if (briefAlreadySent_(pack.today, BRIEF_KIND_MTD_)) {
      results.push({ sent: false, kind: BRIEF_KIND_MTD_, reason: 'already sent today' });
    } else {
      results.push(sendBriefKind_(pack, BRIEF_KIND_MTD_, to, 'automatic', 'scheduler'));
    }
    return { sent: results.some(function (row) { return row.sent; }), results: results, date: pack.today, partial: pack.partial };
  } finally {
    if (lock) lock.releaseLock();
  }
}

function briefLogs_(limit) {
  return briefMailRows_().slice(-(limit || 20)).reverse().map(function (row) {
    return {
      at: String(row.sent_at || ''),
      date: isoDate_(row.business_date),
      kind: String(row.kind || ''),
      channel: String(row.channel || ''),
      status: String(row.status || ''),
      to: String(row.to_address || ''),
      subject: String(row.subject || ''),
      version: String(row.version || ''),
      missing: String(row.missing || ''),
      reason: String(row.reason || ''),
      by: String(row.by_role || ''),
    };
  });
}

function brief_(payload) {
  var pack = briefPack_(payload);
  var role = payload.session.role;
  return {
    role: role,
    today: pack.today,
    updated: pack.updated,
    version: pack.version,
    storePeriod: pack.storePeriod,
    individualPeriod: pack.individualPeriod,
    partial: pack.partial,
    missing: pack.missing,
    priorities: pack.priorities,
    plan: pack.plan,
    coaching: pack.coaching,
    startup: { subject: pack.startupSubject, html: pack.startupInner, mailHtml: pack.startupHtml, text: pack.startupText },
    mtd: { subject: pack.mtdSubject, html: pack.mtdInner, mailHtml: pack.mtdHtml, text: pack.mtdText },
    mail: {
      enabled: briefMailEnabled_(),
      to: briefMailTo_(),
      liveList: BRIEF_MAIL_TO_,
      logs: briefLogs_(16),
      canSendTest: role === 'admin',
      canEnable: role === 'admin',
      canResend: role === 'manager' || role === 'admin',
    },
    homeWritten: pack.home.yesterday.written,
    homeDelivered: pack.home.yesterday.delivered,
    homeMonthWritten: pack.home.month.written,
    homeMonthDelivered: pack.home.month.delivered,
    peopleCount: pack.people.length,
  };
}

function saveBriefPlan_(payload) {
  var today = todayNy_();
  var actions = [payload.action1, payload.action2, payload.action3].map(function (line) { return String(line || '').trim(); });
  if (actions.filter(function (line) { return line; }).length !== 3) throw new Error('Enter three priority actions for management.');
  var notes = String(payload.notes || '').trim();
  var tab = briefEnsureTab_(BRIEF_PLANS_TAB_, BRIEF_PLANS_HEADERS_);
  var values = tab.getDataRange().getValues();
  var stamp = new Date().toISOString();
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (isoDate_(values[r][0]) !== today) continue;
    tab.getRange(r + 1, 2, 1, 6).setValues([[actions[0], actions[1], actions[2], notes, stamp, payload.session.role]]);
    return brief_(payload);
  }
  tab.appendRow([today, actions[0], actions[1], actions[2], notes, stamp, payload.session.role]);
  return brief_(payload);
}

function previewBriefEmail_(payload) {
  var kind = String(payload.kind || BRIEF_KIND_STARTUP_);
  if (kind !== BRIEF_KIND_STARTUP_ && kind !== BRIEF_KIND_MTD_) throw new Error('Choose Morning Start-Up or MTD Performance.');
  var pack = briefPack_(payload);
  return {
    kind: kind,
    subject: kind === BRIEF_KIND_STARTUP_ ? pack.startupSubject : pack.mtdSubject,
    html: kind === BRIEF_KIND_STARTUP_ ? pack.startupHtml : pack.mtdHtml,
    text: kind === BRIEF_KIND_STARTUP_ ? pack.startupText : pack.mtdText,
    partial: pack.partial,
    missing: pack.missing,
    version: pack.version,
  };
}

function sendBriefTest_(payload) {
  if (payload.session.role !== 'admin') throw new Error('Only an Admin can send a test management email.');
  var to = String(payload.to || '').trim();
  if (!briefValidEmail_(to)) throw new Error('Enter the test address explicitly. The live management list is not used automatically.');
  if (briefNormalizeEmail_(to) === briefNormalizeEmail_(BRIEF_MAIL_TO_) && payload.allowProduction !== true) {
    throw new Error('That is the live management list. Enter a different test address, or confirm a live send after enabling production delivery.');
  }
  var kind = String(payload.kind || BRIEF_KIND_STARTUP_);
  if (kind !== BRIEF_KIND_STARTUP_ && kind !== BRIEF_KIND_MTD_) throw new Error('Choose Morning Start-Up or MTD Performance.');
  var pack = briefPack_(payload);
  return sendBriefKind_(pack, kind, to, 'test', payload.session.role);
}

function saveBriefMailSettings_(payload) {
  if (payload.session.role !== 'admin') throw new Error('Only an Admin can change automatic delivery.');
  var enabled = payload.enabled === true || payload.enabled === 'yes' || payload.enabled === 'on';
  putConfig_('brief_mail_enabled', enabled ? 'yes' : 'no');
  if (payload.to !== undefined && String(payload.to).trim()) {
    var to = String(payload.to).trim();
    if (!briefValidEmail_(to)) throw new Error('Enter a valid production recipient address.');
    putConfig_('brief_mail_to', to);
  }
  return brief_(payload);
}

function resendBriefEmail_(payload) {
  var kind = String(payload.kind || BRIEF_KIND_STARTUP_);
  if (kind !== BRIEF_KIND_STARTUP_ && kind !== BRIEF_KIND_MTD_) throw new Error('Choose Morning Start-Up or MTD Performance.');
  var pack = briefPack_(payload);
  var to = String(payload.to || '').trim();
  if (to) {
    if (payload.session.role !== 'admin') throw new Error('Only an Admin can send a copy to a test address.');
    if (!briefValidEmail_(to)) throw new Error('Enter the test address explicitly.');
    if (briefNormalizeEmail_(to) === briefNormalizeEmail_(BRIEF_MAIL_TO_) && !briefMailEnabled_()) {
      throw new Error('Automatic production delivery is off. The live management list was not used.');
    }
    return sendBriefKind_(pack, kind, to, 'resend', payload.session.role);
  }
  if (!briefMailEnabled_()) throw new Error('Automatic production delivery is off. Preview the email here, or ask an Admin to send a test to a chosen address.');
  return sendBriefKind_(pack, kind, briefMailTo_(), 'resend', payload.session.role);
}
