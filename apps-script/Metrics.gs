/**
 * One approved definition per metric. Pages read their goals, source labels and reporting periods from here, and
 * CC_MetricDefinitions is written from this list with each verified-through date and goal resolved from the workbook.
 * goalKey is the CC_Config key; goalDefault is the official default used only while that cell is blank.
 */
var METRIC_DEFINITIONS_ = [
  { key: 'store_written', name: 'Store written sales', source: 'NWDSR Net Written', scope: 'Store', side: 'Written', unit: 'dollars', period: 'store', goalKey: 'written_goal', goalDefault: null, through: 'daily:nwdsrWritten',
    method: 'Sum of CC_Daily nwdsr_written for the store month. A day without a report is Pending, not zero. Remaining = written goal − this total.', pages: 'Home, Written, Morning meeting, Daily, CC_Rollup, Month-End' },
  { key: 'store_delivered', name: 'Store delivered sales', source: 'NWDSR Delivered', scope: 'Store', side: 'Delivered', unit: 'dollars', period: 'store', goalKey: 'delivered_goal', goalDefault: null, through: 'daily:nwdsrDelivered',
    method: 'Sum of CC_Daily nwdsr_delivered for the store month. A day without a report is Pending, not zero. Remaining = delivered goal − this total.', pages: 'Home, Delivered, Morning meeting, Daily, CC_Rollup, Month-End' },
  { key: 'store_snap_written', name: 'SNAP Written (reconciliation)', source: 'SNAP Written', scope: 'Store', side: 'Written', unit: 'dollars', period: 'store', goalKey: null, goalDefault: null, through: 'daily:snapWritten',
    method: 'Sum of CC_Daily snap_written for the store month. A separate reconciliation figure shown beside NWDSR Net Written with the variance (SNAP − NWDSR). Never used for the store goal, remaining or pace.', pages: 'Home, Written, Morning meeting, Daily, CC_Rollup, Month-End' },
  { key: 'store_written_daily_goal', name: 'Store daily written goal', source: 'NWDSR Net Written', scope: 'Store', side: 'Written', unit: 'dollars', period: 'store', goalKey: 'written_goal', goalDefault: null, through: 'daily:nwdsrWritten',
    method: '(Written goal − NWDSR Net Written before the day) ÷ open days left including the day. Saved for each past day on CC_DailyGoals.', pages: 'Home, Written, Morning meeting' },
  { key: 'store_delivered_daily_goal', name: 'Store daily delivered goal', source: 'NWDSR Delivered', scope: 'Store', side: 'Delivered', unit: 'dollars', period: 'store', goalKey: 'delivered_goal', goalDefault: null, through: 'daily:nwdsrDelivered',
    method: '(Delivered goal − NWDSR Delivered before the day) ÷ open days left including the day. Saved for each past day on CC_DailyGoals.', pages: 'Home, Delivered, Morning meeting' },
  { key: 'store_purchasing_customers', name: 'Purchasing customers', source: 'NWDSR Net Written # OF CUST', scope: 'Store', side: 'Written', unit: 'count', period: 'store', goalKey: null, goalDefault: null, through: 'closing',
    method: 'Sum of the daily NWDSR Net Written # OF CUST for the store month (CC_Closing). A cumulative report is a check, never added again.', pages: 'Home, Daily, Closing, Morning meeting, Month-End' },
  { key: 'store_opportunities', name: 'Customer opportunities', source: 'PERQ Location Ups + Be Backs', scope: 'Store', side: 'Not applicable', unit: 'count', period: 'store', goalKey: null, goalDefault: null, through: 'closing',
    method: 'The latest store-month PERQ location snapshot plus the daily location counts after it. Snapshots are never added together.', pages: 'Home, Daily, Closing, Morning meeting' },
  { key: 'store_closing', name: 'Store closing ratio', source: 'NWDSR Net Written # OF CUST ÷ PERQ Location Ups + Be Backs', scope: 'Store', side: 'Written', unit: 'percent', period: 'store', goalKey: 'closing_goal', goalDefault: 0.5, through: 'closing',
    method: 'Purchasing customers ÷ opportunities through the same verified date (CC_ClosingDaily / CC_ClosingMTD). The delivered report is not the numerator.', pages: 'Home, Daily, Closing, Morning meeting' },
  { key: 'kpi_bedding', name: 'Bedding %', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'bedding_minimum', goalDefault: 0.2, through: 'kpi:Bedding',
    method: 'Bedding dollars ÷ Group 17 sales for the store month, each side on its own (CC_Kpi Bedding).', pages: 'Home, Bedding, Morning meeting' },
  { key: 'store_bedding_dollars', name: 'Bedding sales $', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'dollars', period: 'store', goalKey: null, goalDefault: null, through: 'ledger:BEDDING_STORE',
    method: 'Latest store-month BEDDING_STORE cumulative row on CC_Ledger (snapshot plus later daily files, never both added).', pages: 'Bedding' },
  { key: 'kpi_average_ticket', name: 'Average ticket', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'dollars', period: 'store', goalKey: 'average_ticket_goal', goalDefault: 2500, through: 'kpi:Average Ticket',
    method: 'Group 17 sales ÷ orders for the store month (CC_Kpi Average Ticket).', pages: 'Home' },
  { key: 'kpi_rugs', name: 'Rugs', source: 'ASL Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'count', period: 'store', goalKey: 'rugs_goal', goalDefault: 12, through: 'kpi:Rugs',
    method: 'ASL Store 17 rugs sold for the store month (CC_Kpi Rugs).', pages: 'Home' },
  { key: 'kpi_fabric', name: 'Fabric Maintenance', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'fabric_maintenance_goal', goalDefault: 0.8, through: 'kpi:Fabric Maintenance',
    method: 'Fabric protection sold ÷ qualified for the store month (CC_Kpi Fabric Maintenance).', pages: 'Home, Sales Team scorecards' },
  { key: 'kpi_leather', name: 'Leather Maintenance', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'leather_maintenance_goal', goalDefault: 0.8, through: 'kpi:Leather Maintenance',
    method: 'Leather protection sold ÷ qualified for the store month (CC_Kpi Leather Maintenance).', pages: 'Home, Sales Team scorecards' },
  { key: 'kpi_power', name: 'Power Upholstery', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'power_maintenance_goal', goalDefault: 0.8, through: 'kpi:Power Upholstery',
    method: 'Power furniture warranties sold ÷ qualified for the store month (CC_Kpi Power Upholstery).', pages: 'Home, Sales Team scorecards' },
  { key: 'kpi_protectors', name: 'Mattress Protectors', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'mattress_protector_goal', goalDefault: 0.8, through: 'kpi:Mattress Protectors',
    method: 'Mattress pads sold ÷ qualified mattress sales for the store month (CC_Kpi Mattress Protectors).', pages: 'Home, Bedding, Sales Team scorecards' },
  { key: 'kpi_total_attachment', name: 'Total Attachment', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'attachment_goal', goalDefault: null, through: 'kpi:Total Attachment',
    method: 'Group 17 TOTAL ATTACHMENTS sold ÷ qualified for the store month (CC_Kpi Total Attachment).', pages: 'Home, Sales Team scorecards' },
  { key: 'kpi_adjustable_base', name: 'Adjustable Base Attachment', source: 'ASL Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'adjustable_base_goal', goalDefault: 0.35, through: 'kpi:Adjustable Base Attachment',
    method: 'ASL Store 17 ADJ attached ÷ qualified for the store month (CC_Kpi Adjustable Base Attachment).', pages: 'Home, Bedding' },
  { key: 'kpi_pillows', name: 'Pillows', source: 'ASL Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'pillow_goal', goalDefault: 0.65, through: 'kpi:Pillows',
    method: 'ASL Store 17 pillows attached ÷ qualified for the store month (CC_Kpi Pillows).', pages: 'Home, Bedding' },
  { key: 'kpi_wood', name: 'Wood / Furniture Protection', source: 'ASL Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'wood_maintenance_goal', goalDefault: 0.5, through: 'kpi:Wood / Furniture Protection',
    method: 'ASL Furniture Protection protected ÷ qualified items for the store month. UVWL wood and lacquer warranties are not added.', pages: 'Home' },
  { key: 'kpi_finance', name: 'Financing', source: 'Group 17 Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'finance_goal', goalDefault: 0.5, through: 'kpi:Finance',
    method: 'Financed dollars ÷ sales for the store month; financed dollars are each report\'s FIN % × its sales (CC_Kpi Finance).', pages: 'Home' },
  { key: 'kpi_warranty', name: 'Warranty % of Sales', source: 'NWDSR Written WARR PCT', scope: 'Store', side: 'Written', unit: 'percent', period: 'store', goalKey: 'warranty_sales_goal', goalDefault: 0.055, through: 'kpi:Overall Warranty % of Sales',
    method: 'Shown only when CC_Kpi holds a verified store-month figure. A single day\'s WARR PCT is not a month-to-date result.', pages: 'Home (when verified)' },
  { key: 'kpi_power_base', name: 'Power Adjustable Base', source: 'ASL Data Analysis', scope: 'Store', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'store', goalKey: 'power_base_goal', goalDefault: 0.35, through: 'kpi:Power Adjustable Base',
    method: 'ASL ADJ PWR %, shown on the Adjustable Base tile when printed.', pages: 'Home' },
  { key: 'person_written', name: 'Salesperson written sales and goal progress', source: 'SNAP Written by salesperson', scope: 'Person', side: 'Written', unit: 'dollars', period: 'person', goalKey: 'individual_volume_goal', goalDefault: 65000, through: 'snap:person',
    method: 'Sum of the salesperson\'s SNAP lines (CC_AssociateDays) for the salesperson month. Progress = SNAP Written ÷ the individual monthly goal.', pages: 'Sales Team, Associate summary, Morning meeting winners, Month-End' },
  { key: 'person_delivered', name: 'Salesperson delivered sales', source: 'Group 17 Data Analysis Delivered', scope: 'Person', side: 'Delivered', unit: 'dollars', period: 'person', goalKey: null, goalDefault: null, through: 'ledger:person:delivered',
    method: 'Group 17 Data Analysis Delivered sales for the salesperson month (DA_SALES_PERSON), snapshot plus later daily files.', pages: 'Sales Team, Associate summary' },
  { key: 'person_written_orders', name: 'Salesperson written orders', source: 'Group 17 Data Analysis Written', scope: 'Person', side: 'Written', unit: 'count', period: 'person', goalKey: null, goalDefault: null, through: 'ledger:person:written',
    method: 'Group 17 Data Analysis Written order count (unit_count on DA_SALES_PERSON) for the salesperson month.', pages: 'Sales Team, Closing, Associate summary' },
  { key: 'person_kpis', name: 'Salesperson KPI opportunities, attachments, dollars and percentages', source: 'Group 17 Data Analysis', scope: 'Person', side: 'Written and Delivered, kept separate', unit: 'percent', period: 'person', goalKey: null, goalDefault: null, through: 'ledger:person:written',
    method: 'Recalculated from month-to-date counts and dollars, never averaged. Goals are the store KPI goals.', pages: 'Sales Team scorecards, Bedding, Associate summary' },
  { key: 'person_opportunities', name: 'Salesperson customer opportunities', source: 'PERQ Salesperson Ups + Be Backs', scope: 'Person', side: 'Not applicable', unit: 'count', period: 'person', goalKey: null, goalDefault: null, through: 'perq:person',
    method: 'The salesperson\'s latest PERQ snapshot for the salesperson month plus the daily counts after it.', pages: 'Sales Team, Closing, Associate summary' },
  { key: 'person_closing', name: 'Salesperson closing ratio', source: 'Group 17 Data Analysis Written orders ÷ PERQ Salesperson Ups + Be Backs', scope: 'Person', side: 'Written', unit: 'percent', period: 'person', goalKey: 'closing_goal', goalDefault: 0.5, through: 'person:closing',
    method: 'Written orders ÷ PERQ opportunities, both from the 1st through the same verified date. Store customers are never divided among salespeople.', pages: 'Sales Team, Closing, Associate summary' },
];

var METRIC_DEFINITIONS_TAB_ = 'CC_MetricDefinitions';
var METRIC_DEFINITIONS_HEADERS_ = ['metric_key', 'metric', 'approved_source', 'scope', 'side', 'calculation', 'reporting_period', 'period_dates', 'verified_through', 'goal', 'goal_key', 'goal_effective', 'used_on'];

function metricDefinition_(key) {
  var found = null;
  METRIC_DEFINITIONS_.forEach(function (definition) { if (definition.key === key) found = definition; });
  if (!found) throw new Error('No approved definition for ' + key + '.');
  return found;
}

function metricSource_(key) {
  return metricDefinition_(key).source;
}

/** The configured goal for a metric, or its official default while the CC_Config cell is blank. */
function metricGoal_(key, config) {
  var definition = metricDefinition_(key);
  if (!definition.goalKey) return null;
  if (definition.goalKey === 'mattress_protector_goal') return protectorGoal_(config);
  if (definition.goalKey === 'closing_goal') return closingGoal_(config);
  return goalOr_(config, definition.goalKey, definition.goalDefault);
}

/** How the store and salesperson sales figures are sourced, in the words shown under the Home and Daily tables. */
function salesStandardText_() {
  return 'Store written is ' + metricSource_('store_written') + '. Store delivered is ' + metricSource_('store_delivered') + '. ' +
    metricSource_('store_snap_written') + ' is a separate reconciliation figure: it can legitimately differ from NWDSR, both are kept, and the variance is shown. ' +
    'Salesperson written sales and goal progress use ' + metricSource_('person_written') + '.';
}

function metricPeriodLabel_(period) {
  return period === 'store' ? 'Store month: the 2nd through the 1st of the next month' : 'Salesperson month: the 1st through the last day';
}

function metricGoalEffective_(definition, config, store) {
  if (!definition.goalKey) return '';
  if (definition.goalKey === 'written_goal' || definition.goalKey === 'delivered_goal') {
    var monthKey = definition.goalKey + '_' + store.year + '-' + pad2_(store.month);
    if (!configBlank_(config, monthKey)) return 'Store month ' + store.start + ' through ' + store.end + ' (CC_Config ' + monthKey + ')';
    if (isoDate_(config.store_period_start) === store.start && isoDate_(config.store_period_end) === store.end) return 'Store month ' + store.start + ' through ' + store.end + ' (CC_Config store_period_start / store_period_end)';
    if (store.start === '2026-10-02' && store.end === '2026-11-01') return 'Store month ' + store.start + ' through ' + store.end + ' (official October 2026 budget)';
    return 'No goal on file for store month ' + store.start + ' through ' + store.end;
  }
  var recorded = isoDate_(config[definition.goalKey + '_effective']);
  if (recorded) return recorded + ' (CC_Config ' + definition.goalKey + '_effective)';
  return configBlank_(config, definition.goalKey) ? 'Official default; no effective date recorded' : 'Not recorded in CC_Config';
}

/** Latest verified date for each registry source, read from the same tabs the pages read. */
function metricThroughResolver_(today) {
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var cache = {};
  function once(key, build) {
    if (!Object.prototype.hasOwnProperty.call(cache, key)) {
      try { cache[key] = build(); } catch (error) { cache[key] = ''; }
    }
    return cache[key];
  }
  function dailyThrough(field) {
    return once('daily:' + field, function () {
      var latest = '';
      dailyFacts_().forEach(function (row) {
        if (row.date < store.start || row.date > store.end || row[field] === null) return;
        if (row.date > latest) latest = row.date;
      });
      return latest;
    });
  }
  function ledger() { return once('ledger', function () { return ledgerRows_(); }); }
  function personLedgerThrough(side) {
    return once('ledger:person:' + side, function () {
      var latest = '';
      (ledger() || []).forEach(function (row) {
        if (row.view !== 'DA_SALES_PERSON' || row.side !== side || !row.fitsTrack) return;
        if (row.grain === 'cumulative' && row.periodStart !== individual.start) return;
        if (row.grain !== 'cumulative' && (row.periodStart < individual.start || row.periodEnd > individual.end)) return;
        var date = row.verifiedThrough || row.periodEnd;
        if (date > latest) latest = date;
      });
      return latest;
    });
  }
  function perqPersonThrough() {
    return once('perq:person', function () {
      var latest = '';
      sheet_('CC_Closing').forEach(function (row) {
        if (String(row.scope) !== 'person' || String(row.source || '').trim() !== 'PERQ Ups + Be Backs' || String(row.final || '').toLowerCase() !== 'yes') return;
        var start = isoDate_(row.period_start);
        var end = isoDate_(row.period_end);
        if (!start || start < individual.start || !end || end > individual.end) return;
        var date = isoDate_(row.verified_through) || end;
        if (date > latest) latest = date;
      });
      return latest;
    });
  }
  return function (through) {
    var parts = String(through || '').split(':');
    if (parts[0] === 'daily') return dailyThrough(parts[1]);
    if (parts[0] === 'closing') return once('closing', function () { return storeMonthClosing_(loadClosingView_(), store, closingGoal_(config_())).through || ''; });
    if (parts[0] === 'kpi') {
      var actuals = once('kpi', function () { return readKpiActuals_(); }) || {};
      var row = actuals[parts.slice(1).join(':')];
      return row && row.through ? row.through : '';
    }
    if (parts[0] === 'ledger' && parts[1] === 'person') return personLedgerThrough(parts[2]);
    if (parts[0] === 'ledger') {
      return once(through, function () {
        var written = latestStoreLedger_(parts[1], 'written', store.start);
        var delivered = latestStoreLedger_(parts[1], 'delivered', store.start);
        var w = written ? written.verifiedThrough : '';
        var d = delivered ? delivered.verifiedThrough : '';
        return w === d ? w : 'written ' + (w || 'Pending') + ', delivered ' + (d || 'Pending');
      });
    }
    if (parts[0] === 'snap') return once('snap:person', function () { return snapAssociateLines_(individual.start, individual.end).latest || ''; });
    if (parts[0] === 'perq') return perqPersonThrough();
    if (through === 'person:closing') {
      var orders = personLedgerThrough('written');
      var perq = perqPersonThrough();
      if (!orders || !perq) return '';
      return orders < perq ? orders : perq;
    }
    return '';
  };
}

/** Every approved definition with its period dates, verified-through date and goal resolved for `today`. */
function metricRegistry_(today) {
  today = today || todayNy_();
  var config = config_();
  var store = storePeriodContaining_(today);
  var individual = individualPeriodContaining_(today);
  var throughFor = metricThroughResolver_(today);
  var budgets = storeSalesGoals_(config, store);
  return METRIC_DEFINITIONS_.map(function (definition) {
    var period = definition.period === 'store' ? store : individual;
    var goal = metricGoal_(definition.key, config);
    if (definition.goalKey === 'written_goal') goal = budgets.written;
    if (definition.goalKey === 'delivered_goal') goal = budgets.delivered;
    return {
      key: definition.key,
      name: definition.name,
      source: definition.source,
      scope: definition.scope,
      side: definition.side,
      method: definition.method,
      unit: definition.unit,
      period: metricPeriodLabel_(definition.period),
      periodDates: period.start + ' through ' + period.end,
      verifiedThrough: throughFor(definition.through) || 'Pending',
      goal: goal,
      goalKey: definition.goalKey || '',
      goalEffective: metricGoalEffective_(definition, config, store),
      pages: definition.pages,
    };
  });
}

function refreshMetricRegistry_() {
  forgetRead_('CC_MetricDefinitions');
  var rows = metricRegistry_(todayNy_()).map(function (row) {
    return [row.key, row.name, row.source, row.scope, row.side, row.method, row.period, row.periodDates, row.verifiedThrough, row.goal === null ? '' : row.goal, row.goalKey, row.goalEffective, row.pages];
  });
  var spreadsheet = book_();
  var tab = spreadsheet.getSheetByName(METRIC_DEFINITIONS_TAB_) || spreadsheet.insertSheet(METRIC_DEFINITIONS_TAB_);
  var grid = [METRIC_DEFINITIONS_HEADERS_].concat(rows);
  tab.clearContents();
  tab.getRange(1, 1, grid.length, METRIC_DEFINITIONS_HEADERS_.length).setValues(grid);
  return rows.length;
}
