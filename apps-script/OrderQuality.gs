/**
 * Sales order quality checklist. A manager-supervised aid. It does not change a customer order
 * and it does not replace Kane's point-of-sale system.
 * The step sequence is the one requested for this tool. Policy details that are not in an approved
 * Document Center file are not invented here. Notes may not hold addresses, phones, payment data, or access codes.
 */

var ORDER_TAB_ = 'CC_OrderQuality';
var ORDER_HEADERS_ = ['id', 'created_at', 'created_by', 'order_ref', 'delivery', 'as_is', 'mattress', 'nocom', 'salesperson', 'steps', 'status', 'updated_at', 'updated_by'];
var ORDER_STEPS_ = [
  { key: 'customer', label: 'Verify customer information and order accuracy' },
  { key: 'spr', label: 'Review SPR' },
  { key: 'white-glove', label: 'Explain White Glove delivery', when: 'white-glove' },
  { key: 'no-contact', label: 'Explain No Contact delivery accurately', when: 'no-contact' },
  { key: 'delivery-choice', label: 'Verify delivery choice and customer understanding' },
  { key: 'access', label: 'Verify delivery access, stairs, floors, and other notes without recording codes' },
  { key: 'product', label: 'Review product and component accuracy' },
  { key: 'protector', label: 'Review mattress protector and applicable NOCOM requirements', when: 'protector' },
  { key: 'asis', label: 'Review AS-IS requirements where applicable', when: 'asis' },
  { key: 'maintenance', label: 'Verify maintenance and protection presentation' },
  { key: 'manager-to', label: 'Follow the approved Manager TO rule, including applicable exceptions' },
  { key: 'salesperson', label: 'Salesperson completes final order review', sign: 'sales' },
  { key: 'manager', label: 'Manager completes final order review', sign: 'manager' },
];

function orderClean_(value, max) {
  return String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function orderSensitive_(text) {
  var value = String(text || '');
  if (/@/.test(value)) return true;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(value)) return true;
  if (/\d{13,}/.test(value.replace(/\s+/g, ''))) return true;
  if (/\b(street|avenue|apt|apartment|gate code|alarm|password|card number|cvv|social security)\b/i.test(value)) return true;
  return false;
}

function orderRef_(value) {
  var text = orderClean_(value, 24).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9-]{4,20}$/.test(text)) throw new Error('Use a short order reference of letters and numbers. Do not enter a phone, address, or payment number.');
  if (text.replace(/\D/g, '').length >= 10) throw new Error('That reference looks like a phone or account number. Use a short order reference.');
  return text;
}

function orderNote_(value) {
  var text = orderClean_(value, 240);
  if (orderSensitive_(text)) throw new Error('Do not store an address, phone, payment number, alarm code, or gate code in this checklist.');
  return text;
}

function orderDelivery_(value) {
  return String(value || '') === 'no-contact' ? 'no-contact' : 'white-glove';
}

function orderYes_(value) {
  return value === true || String(value || '').toLowerCase() === 'yes';
}

function orderStaff_(value) {
  var text = orderClean_(value, 40);
  if (!text) return '';
  if (!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(text)) throw new Error('Enter the salesperson first and last name only. Do not enter a customer name with numbers.');
  if (orderSensitive_(text)) throw new Error('Do not store customer contact details on this checklist.');
  return text;
}

function orderApplies_(step, flags) {
  if (step.when === 'white-glove') return flags.delivery === 'white-glove';
  if (step.when === 'no-contact') return flags.delivery === 'no-contact';
  if (step.when === 'asis') return flags.asIs;
  if (step.when === 'protector') return flags.mattress || flags.nocom;
  return true;
}

function orderSheet_() {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(ORDER_TAB_);
  if (!tab) {
    tab = spreadsheet.insertSheet(ORDER_TAB_);
    tab.getRange(1, 1, 1, ORDER_HEADERS_.length).setValues([ORDER_HEADERS_]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function orderRows_() {
  return sheet_(ORDER_TAB_).map(function (row) {
    var steps = {};
    try { steps = JSON.parse(String(row.steps || '{}')); } catch (error) { steps = {}; }
    return {
      id: orderClean_(row.id, 40),
      createdAt: orderClean_(row.created_at, 40),
      createdBy: orderClean_(row.created_by, 40),
      orderRef: orderClean_(row.order_ref, 24),
      delivery: orderDelivery_(row.delivery),
      asIs: orderYes_(row.as_is),
      mattress: orderYes_(row.mattress),
      nocom: orderYes_(row.nocom),
      salesperson: orderClean_(row.salesperson, 40),
      steps: steps,
      status: orderClean_(row.status, 40),
      updatedAt: orderClean_(row.updated_at, 40),
      updatedBy: orderClean_(row.updated_by, 40),
    };
  }).filter(function (row) { return row.id; });
}

function orderTraining_() {
  var links = [];
  var rows = [];
  try { rows = docRows_(); } catch (error) { rows = []; }
  rows.forEach(function (row) {
    var view = docView_(row);
    if (view.status !== 'active') return;
    var text = (view.title + ' ' + view.category + ' ' + view.subcategory + ' ' + view.fileName).toLowerCase();
    if (!/checklist|white glove|no contact|nocom|as-is|as is|delivery|spr|maintenance|protection|sales order/.test(text)) return;
    links.push({ id: view.id, title: view.title, category: view.category, subcategory: view.subcategory });
  });
  return links;
}

function orderItem_(step, flags, saved) {
  var applies = orderApplies_(step, flags);
  var state = saved && saved.state ? String(saved.state) : '';
  if (!applies) state = 'na';
  else if (state !== 'done' && state !== 'exception') state = 'open';
  if (step.sign && state === 'exception') state = 'open';
  var note = saved && saved.note ? orderClean_(saved.note, 240) : '';
  if (state !== 'exception') note = step.sign ? '' : note;
  return {
    key: step.key,
    label: step.label,
    sign: step.sign || '',
    applies: applies,
    state: state,
    note: note,
    incomplete: applies && state === 'open',
  };
}

function orderScore_(items) {
  var open = items.filter(function (item) { return item.incomplete && item.sign !== 'manager'; });
  var manager = null;
  var salesperson = null;
  items.forEach(function (item) {
    if (item.sign === 'manager') manager = item;
    if (item.sign === 'sales') salesperson = item;
  });
  var managerDone = manager && manager.state === 'done';
  var salesDone = salesperson && salesperson.state === 'done';
  var status = 'Incomplete';
  if (!open.length && salesDone && managerDone) status = 'Complete';
  else if (!open.length && salesDone && !managerDone) status = 'Awaiting manager';
  return { status: status, incomplete: items.filter(function (item) { return item.incomplete; }), managerDone: !!managerDone };
}

function orderView_(record) {
  var flags = { delivery: record.delivery, asIs: record.asIs, mattress: record.mattress, nocom: record.nocom };
  var items = ORDER_STEPS_.map(function (step) { return orderItem_(step, flags, record.steps[step.key]); });
  var score = orderScore_(items);
  return {
    id: record.id,
    orderRef: record.orderRef,
    delivery: record.delivery,
    deliveryLabel: record.delivery === 'no-contact' ? 'No Contact' : 'White Glove',
    asIs: record.asIs,
    mattress: record.mattress,
    nocom: record.nocom,
    salesperson: record.salesperson,
    items: items,
    status: score.status,
    incomplete: score.incomplete.map(function (item) { return item.label; }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}

function orderReport_(views) {
  var tally = {};
  ORDER_STEPS_.forEach(function (step) { tally[step.key] = { key: step.key, label: step.label, open: 0, exception: 0 }; });
  views.forEach(function (view) {
    view.items.forEach(function (item) {
      if (!tally[item.key]) return;
      if (item.state === 'open' && item.applies) tally[item.key].open += 1;
      if (item.state === 'exception') tally[item.key].exception += 1;
    });
  });
  var problems = Object.keys(tally).map(function (key) { return tally[key]; }).filter(function (item) {
    return item.open + item.exception > 0 && item.key !== 'manager';
  }).sort(function (left, right) { return (right.open + right.exception) - (left.open + left.exception); });
  return {
    total: views.length,
    complete: views.filter(function (view) { return view.status === 'Complete'; }).length,
    awaiting: views.filter(function (view) { return view.status === 'Awaiting manager'; }).length,
    incomplete: views.filter(function (view) { return view.status === 'Incomplete'; }).length,
    problems: problems.slice(0, 6),
  };
}

function orderQuality_(payload) {
  var views = orderRows_().map(orderView_).sort(function (left, right) { return left.updatedAt < right.updatedAt ? 1 : -1; });
  var training = orderTraining_();
  return {
    role: payload.session ? payload.session.role : '',
    version: APP_VERSION_,
    kind: 'orderQuality',
    mail: false,
    changesOrders: false,
    steps: ORDER_STEPS_.map(function (step) { return { key: step.key, label: step.label, sign: step.sign || '', when: step.when || '' }; }),
    checks: views.slice(0, 40),
    report: orderReport_(views),
    training: training,
    policyOnFile: training.length > 0,
    notice: training.length
      ? 'This checklist does not change a customer order. Open the linked training document for the approved wording.'
      : 'The approved Sales Order Completion Checklist is not in the Document Center. These steps keep the requested sequence only. They do not add policy rules, Manager TO exceptions, or delivery scripts that are not on that file. Upload the current Store 17 checklist under New Hire, Sales Order Completion Checklist.',
  };
}

function orderWrite_(record) {
  var tab = orderSheet_();
  var values = tab.getDataRange().getValues();
  var line = [
    record.id,
    record.createdAt,
    record.createdBy,
    record.orderRef,
    record.delivery,
    record.asIs ? 'yes' : 'no',
    record.mattress ? 'yes' : 'no',
    record.nocom ? 'yes' : 'no',
    record.salesperson,
    JSON.stringify(record.steps),
    record.status,
    record.updatedAt,
    record.updatedBy,
  ];
  var index = -1;
  var r;
  for (r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === record.id) index = r;
  }
  if (index === -1) tab.getRange(Math.max(tab.getLastRow(), 1) + 1, 1, 1, line.length).setValues([line]);
  else tab.getRange(index + 1, 1, 1, line.length).setValues([line]);
  forgetRead_(ORDER_TAB_);
}

function saveOrderCheck_(payload) {
  payload = payload || {};
  var existing = null;
  if (payload.id) {
    orderRows_().forEach(function (row) { if (row.id === String(payload.id)) existing = row; });
    if (!existing) throw new Error('That checklist is not on file.');
  }
  var delivery = orderDelivery_(payload.delivery || (existing && existing.delivery));
  var flags = {
    delivery: delivery,
    asIs: payload.asIs === undefined && existing ? existing.asIs : orderYes_(payload.asIs),
    mattress: payload.mattress === undefined && existing ? existing.mattress : orderYes_(payload.mattress),
    nocom: payload.nocom === undefined && existing ? existing.nocom : orderYes_(payload.nocom),
  };
  var incoming = payload.steps || {};
  var steps = {};
  ORDER_STEPS_.forEach(function (step) {
    var prior = existing && existing.steps ? existing.steps[step.key] : null;
    var raw = incoming[step.key] || prior || {};
    var state = String(raw.state || '');
    var note = '';
    if (state === 'exception') {
      if (step.sign) throw new Error('The salesperson and manager sign-offs cannot be skipped with an exception.');
      note = orderNote_(raw.note);
      if (!note) throw new Error('A manager exception needs a short note, with no customer address, phone, or access code.');
    } else if (state === 'done' || state === 'open' || state === 'na') note = '';
    else state = 'open';
    if (!orderApplies_(step, flags)) state = 'na';
    else if (state === 'na') state = 'open';
    steps[step.key] = { state: state, note: note };
  });
  if (steps.manager.state === 'done' && steps.salesperson.state !== 'done') {
    throw new Error('The salesperson review is the step before the manager review.');
  }
  var items = ORDER_STEPS_.map(function (step) { return orderItem_(step, flags, steps[step.key]); });
  var score = orderScore_(items);
  var now = new Date().toISOString();
  var by = payload.session && (payload.session.username || payload.session.role) ? String(payload.session.username || payload.session.role) : 'manager';
  var record = {
    id: existing ? existing.id : ('oq-' + now.replace(/[^0-9]/g, '').slice(0, 14)),
    createdAt: existing ? existing.createdAt : now,
    createdBy: existing ? existing.createdBy : by,
    orderRef: orderRef_(payload.orderRef || (existing && existing.orderRef)),
    delivery: delivery,
    asIs: flags.asIs,
    mattress: flags.mattress,
    nocom: flags.nocom,
    salesperson: orderStaff_(payload.salesperson !== undefined ? payload.salesperson : (existing && existing.salesperson)),
    steps: steps,
    status: score.status,
    updatedAt: now,
    updatedBy: by,
  };
  orderWrite_(record);
  var page = orderQuality_(payload);
  page.saved = orderView_(record);
  return page;
}
