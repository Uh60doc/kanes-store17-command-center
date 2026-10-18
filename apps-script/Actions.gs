/**
 * Daily management action center. Managers assign follow-up and keep the completed history.
 * Suggestions come only from verified gaps and are not saved until a manager approves one.
 * Nothing here emails an employee, changes a customer order, or writes a sales figure.
 */

var ACTION_TAB_ = 'CC_Actions';
var ACTION_LOG_ = 'CC_ActionLog';
var ACTION_HEADERS_ = ['id', 'created_at', 'created_by', 'description', 'assignee', 'lane', 'due', 'status', 'note', 'completed_at', 'suggestion_key'];
var ACTION_LOG_HEADERS_ = ['action_id', 'at', 'by', 'status', 'note'];
var ACTION_STATUSES_ = ['Open', 'In Progress', 'Completed', 'Blocked'];

function actionSheet_(name, headers) {
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(name);
  if (!tab) {
    tab = spreadsheet.insertSheet(name);
    tab.getRange(1, 1, 1, headers.length).setValues([headers]);
    tab.setFrozenRows(1);
  }
  return tab;
}

function actionText_(value) {
  return String(value === null || value === undefined ? '' : value).replace(/\s+/g, ' ').trim();
}

function actionLane_(value) {
  return actionText_(value).toLowerCase() === 'operations' ? 'operations' : (actionText_(value).toLowerCase() === 'sales' ? 'sales' : '');
}

function actionStatus_(value) {
  var text = actionText_(value);
  return ACTION_STATUSES_.indexOf(text) === -1 ? '' : text;
}

function actionDue_(value) {
  var text = actionText_(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function actionRows_() {
  return sheet_(ACTION_TAB_).map(function (row) {
    return {
      id: actionText_(row.id),
      createdAt: actionText_(row.created_at),
      createdBy: actionText_(row.created_by),
      description: actionText_(row.description),
      assignee: actionText_(row.assignee),
      lane: actionLane_(row.lane) || 'sales',
      due: actionDue_(row.due),
      status: actionStatus_(row.status) || 'Open',
      note: actionText_(row.note),
      completedAt: actionText_(row.completed_at),
      suggestionKey: actionText_(row.suggestion_key),
    };
  }).filter(function (row) { return row.id; });
}

/** Open and in-progress work, overdue first, then the soonest due date. */
function actionRank_(actions, today) {
  return actions.filter(function (action) {
    return action.status === 'Open' || action.status === 'In Progress';
  }).sort(function (left, right) {
    var leftOver = left.due && left.due < today ? 0 : 1;
    var rightOver = right.due && right.due < today ? 0 : 1;
    if (leftOver !== rightOver) return leftOver - rightOver;
    if (left.due !== right.due) return (left.due || '9999-99-99').localeCompare(right.due || '9999-99-99');
    return (left.createdAt || '').localeCompare(right.createdAt || '');
  });
}

function actionOverdue_(actions, today) {
  return actionRank_(actions, today).filter(function (action) { return action.due && action.due < today; });
}

function actionHistory_(actions) {
  return actions.filter(function (action) { return action.status === 'Completed'; }).sort(function (left, right) {
    return (right.completedAt || '').localeCompare(left.completedAt || '');
  });
}

function actionLaneNote_(lane) {
  if (lane === 'operations') return 'Operations: inventory exceptions and fulfillment. This does not change a customer order.';
  return 'Sales: salesperson coaching, sales-process accuracy, and preventing avoidable order problems. This does not change a customer order.';
}

function actionSuggestPerq_(home, today) {
  var trend = home && home.closing && home.closing.mtd && home.closing.mtd.trend ? home.closing.mtd.trend : [];
  var missing = trend.filter(function (day) {
    return day && day.date && /PERQ not received/.test(String(day.sources || '')) && /NWDSR Written \d{4}/.test(String(day.sources || ''));
  });
  if (!missing.length) return null;
  var latest = missing.sort(function (left, right) { return left.date < right.date ? 1 : -1; })[0];
  return {
    key: 'perq-' + latest.date,
    lane: 'sales',
    description: 'Follow up on the missing PERQ report for ' + latest.date + '. Closing for that day stays Pending until the report is on file.',
    assignee: 'Store manager',
    due: today,
    basis: latest.sources,
  };
}

function actionSuggestKpi_(home, today) {
  var kpis = home && home.board && home.board.kpis ? home.board.kpis : [];
  var best = null;
  kpis.forEach(function (kpi) {
    if (kpi.written === null || kpi.written === undefined || kpi.goal === null || kpi.goal === undefined || Number(kpi.goal) === 0) return;
    if (Number(kpi.written) >= Number(kpi.goal) - 1e-9) return;
    var ratio = Number(kpi.written) / Number(kpi.goal);
    if (!best || ratio < best.ratio) best = { name: kpi.name, written: kpi.written, goal: kpi.goal, ratio: ratio, through: kpi.writtenThrough || kpi.through || '' };
  });
  if (!best) return null;
  return {
    key: 'kpi-' + best.name,
    lane: 'sales',
    description: 'Review the missed Store KPI: ' + best.name + '.',
    assignee: 'Store manager',
    due: today,
    basis: best.name + ' is below the approved goal' + (best.through ? ' through ' + best.through : '') + '.',
  };
}

function actionSuggestTicket_(today) {
  var best = null;
  peopleRows_(individualPeriodContaining_(today).start, individualPeriodContaining_(today).end).forEach(function (person) {
    if (person.role !== 'associate') return;
    var hire = { newHire: false };
    try { hire = briefHire_(person.name, today); } catch (error) { hire = { newHire: false }; }
    var goal = hire.newHire ? 2100 : (typeof OPP_TICKET_GOAL_ === 'number' ? OPP_TICKET_GOAL_ : 2500);
    var ticket = opportunityTicket_(person.writtenOrders, person.analysisWritten, goal);
    if (ticket.status !== 'ready' || !(ticket.opportunity > 0)) return;
    if (!best || ticket.opportunity > best.opportunity) best = { name: person.name, average: ticket.average, goal: goal, orders: ticket.orders, opportunity: ticket.opportunity };
  });
  if (!best) return null;
  return {
    key: 'ticket-' + best.name,
    lane: 'sales',
    description: 'Coach ' + best.name + ' on average ticket.',
    assignee: best.name,
    due: today,
    basis: best.orders + ' Group 17 written orders average $' + best.average + ' versus the $' + best.goal + ' goal. This is not commission.',
  };
}

function actionSuggestAttachment_(today) {
  var goals = approvedGoals_(config_());
  var store = accelStore_('written', goals);
  var card = store.closest ? store.cards.filter(function (item) { return item.key === store.closest.key; })[0] : null;
  if (!card || card.status !== 'below') return null;
  return {
    key: 'attach-' + card.key,
    lane: 'sales',
    description: 'Practice the ' + card.customer + ' presentation. ' + card.label + ' is the closest open store goal.',
    assignee: 'Store manager',
    due: today,
    basis: card.coaching || card.label,
  };
}

function actionSuggestRescue_(today) {
  var orders = [];
  try {
    orders = rescueOrders_().map(function (order) { return rescueDecorate_(order, today); });
  } catch (error) { orders = []; }
  var suggestions = [];
  var sales = orders.filter(function (order) { return order.kind === 'open' && !order.scheduledDate; })[0];
  if (sales) {
    suggestions.push({
      key: 'rescue-sales-' + sales.orderNumber,
      lane: 'sales',
      description: 'Follow up on order ' + sales.orderNumber + '. It needs Sales involvement because no delivery date is on the file.',
      assignee: sales.actionName || 'Store manager',
      due: today,
      basis: 'Confirmed open-order file. The order and its date are not changed.',
    });
  }
  var ops = orders.filter(function (order) {
    return order.scheduledDate && order.scheduledDate < today && order.kind !== 'delivered' && order.kind !== 'estimate';
  })[0];
  if (ops) {
    suggestions.push({
      key: 'rescue-ops-' + ops.orderNumber,
      lane: 'operations',
      description: 'Follow up on order ' + ops.orderNumber + '. The scheduled delivery date ' + ops.scheduledDate + ' is past.',
      assignee: 'Operations',
      due: today,
      basis: 'Confirmed open-order file. Fulfillment follow-up only. The delivery date is not moved.',
    });
  }
  return suggestions;
}

function actionSuggestions_(home, today, existing) {
  var openKeys = {};
  existing.forEach(function (action) {
    if (action.suggestionKey && action.status !== 'Completed') openKeys[action.suggestionKey] = true;
  });
  var list = [];
  [actionSuggestPerq_(home, today), actionSuggestKpi_(home, today), actionSuggestTicket_(today), actionSuggestAttachment_(today)].forEach(function (item) {
    if (item) list.push(item);
  });
  actionSuggestRescue_(today).forEach(function (item) { list.push(item); });
  return list.filter(function (item) { return !openKeys[item.key]; }).map(function (item) {
    item.laneNote = actionLaneNote_(item.lane);
    item.approval = 'Suggested from a verified gap. It is not assigned until a manager approves it. No message is sent.';
    return item;
  });
}

function actionAssignees_() {
  var names = ['Store manager', 'Operations'];
  try {
    sheet_('CC_People').forEach(function (row) {
      if (rosterRole_(row, todayNy_()) === 'associate' && actionText_(row.name) && names.indexOf(actionText_(row.name)) === -1) names.push(actionText_(row.name));
    });
  } catch (error) { /* roster stays the two roles */ }
  return names;
}

function actionLog_(id, status, note, by) {
  var tab = actionSheet_(ACTION_LOG_, ACTION_LOG_HEADERS_);
  tab.getRange(tab.getLastRow() + 1, 1, 1, ACTION_LOG_HEADERS_.length).setValues([[id, new Date().toISOString(), by, status, actionText_(note).slice(0, 240)]]);
}

function actionSave_(payload) {
  var description = actionText_(payload.description).slice(0, 180);
  if (!description) throw new Error('Enter the action. Nothing was saved.');
  var lane = actionLane_(payload.lane);
  if (!lane) throw new Error('Choose Sales or Operations.');
  var status = actionStatus_(payload.status || 'Open');
  if (!status) throw new Error('Status is Open, In Progress, Completed, or Blocked.');
  var due = actionDue_(payload.due);
  if (!due) throw new Error('Enter a due date.');
  var assignee = actionText_(payload.assignee).slice(0, 80);
  if (!assignee) throw new Error('Choose who owns the action.');
  var note = actionText_(payload.note).slice(0, 240);
  var suggestionKey = actionText_(payload.suggestionKey).slice(0, 80);
  var who = payload.session && payload.session.username ? payload.session.username : '';
  var existing = actionRows_();
  var id = actionText_(payload.id);
  var current = existing.filter(function (action) { return action.id === id; })[0];
  if (id && !current) throw new Error('That action is not on the list.');
  if (!current && suggestionKey && existing.some(function (action) { return action.suggestionKey === suggestionKey && action.status !== 'Completed'; })) {
    throw new Error('That suggestion is already an open action. Nothing new was created.');
  }
  var now = new Date().toISOString();
  var completedAt = current ? current.completedAt : '';
  if (status === 'Completed' && !completedAt) completedAt = now;
  var line = [id || Utilities.getUuid(), current ? current.createdAt : now, current ? current.createdBy : who, description, assignee, lane, due, status, note, completedAt, suggestionKey || (current ? current.suggestionKey : '')];
  var tab = actionSheet_(ACTION_TAB_, ACTION_HEADERS_);
  if (!current) tab.getRange(tab.getLastRow() + 1, 1, 1, line.length).setValues([line]);
  else {
    var index = existing.findIndex(function (action) { return action.id === id; });
    tab.getRange(index + 2, 1, 1, line.length).setValues([line]);
  }
  actionLog_(line[0], status, note, who);
  return { saved: true, id: line[0], notice: 'Saved in the Command Center only. No employee message was sent, and no order was changed.', page: actions_(payload) };
}

function actions_(payload) {
  var today = todayNy_();
  var home = home_(payload);
  var actions = actionRows_();
  var ranked = actionRank_(actions, today);
  return {
    title: 'Daily Management Action Center',
    today: today,
    notice: 'Managers assign the follow-up. Suggestions stay unassigned until you approve them. Nothing on this page emails an employee or changes a customer order.',
    boundary: 'Sales managers handle salesperson behavior, sales-process accuracy, and prevention of avoidable order problems. Operations handles inventory exceptions and fulfillment.',
    priorities: ranked.slice(0, 3),
    overdue: actionOverdue_(actions, today),
    open: ranked,
    blocked: actions.filter(function (action) { return action.status === 'Blocked'; }),
    history: actionHistory_(actions),
    suggestions: actionSuggestions_(home, today, actions),
    assignees: actionAssignees_(),
    statuses: ACTION_STATUSES_,
    lanes: [
      { key: 'sales', label: 'Sales' },
      { key: 'operations', label: 'Operations' },
    ],
  };
}
