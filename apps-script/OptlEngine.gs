/**
 * OPTL Stage 2 engine (synthetic / in-memory). Spec v1.3 GM Stage 2 decisions.
 * Does not write Sheets, send email, or auto-terminate.
 * Depends on Optl.gs helpers (dates, sections, slots, late classification).
 */

var OPTL_STEP_DAYS_ = 365;
var OPTL_ENTRY_TYPES_SCORED_ = { Occurrence: true, STEP_I: true, STEP_II: true, STEP_III: true, TERM: true };

function optlStepExpiration_(incidentDate) {
  return optlAddCalendarDays_(incidentDate, OPTL_STEP_DAYS_);
}

function optlNewId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

function optlEmptyState_() {
  return {
    employees: [],
    events: [],
    pendingActions: [],
    audit: [],
    exceptions: [],
    acknowledgments: [],
    alerts: [],
    alertConfig: {
      commandCenter: true,
      emailEnabled: false,
      emailRecipients: [],
      testSendingDisabled: true,
      note: 'Command Center alerts are recorded in-app. Manager email waits for configured/approved recipients. Test sending is disabled.',
    },
  };
}

function optlQueueAlert_(state, alert) {
  state.alerts = state.alerts || [];
  state.alerts.unshift({
    alertId: optlNewId_('alrt'),
    createdAt: optlToday_() + 'T12:00:00',
    channel: 'command-center',
    emailQueued: false,
    emailBlockedReason: (state.alertConfig && state.alertConfig.testSendingDisabled)
      ? 'Email sending disabled until recipients are configured and approved'
      : null,
    status: 'open',
    employeeId: alert.employeeId || null,
    kind: alert.kind || 'notice',
    title: alert.title || 'OPTL alert',
    detail: alert.detail || '',
  });
}

/** Map STEP/TERM to Kane's PIP counseling-level checkbox labels. */
function optlPipCounselingLabel_(entryType) {
  if (entryType === 'STEP_I') return 'Coaching Session';
  if (entryType === 'STEP_II') return 'Counseling Session';
  if (entryType === 'STEP_III') return 'Final Counseling Session';
  if (entryType === 'TERM') return 'Termination Session';
  return '';
}

/**
 * Resolve requested formal level against section progression + dual STEP III rule.
 * Manager sees effective required action before finalizing.
 */
function optlResolveEffectiveLevel_(state, draft, asOfDate) {
  var asOf = String(asOfDate || optlToday_()).slice(0, 10);
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === draft.employeeId) employee = row; });
  var period = employee ? optlActiveEmploymentPeriod_(employee) : null;
  var periodId = period ? period.periodId : null;
  var requested = draft.entryType || 'Occurrence';
  if (requested === 'Occurrence') {
    return { requested: requested, effective: 'Occurrence', adjusted: false, reason: '' };
  }
  var proposal = optlProposeNextStep_(state, draft.employeeId, draft.section, draft.category, asOf);
  var effective = requested;
  var reason = '';
  if (!draft.directIssue) {
    effective = proposal.proposedLevel;
    if (effective !== requested) {
      reason = 'Threshold/section rules require ' + String(effective).replace(/_/g, ' ') + ' instead of ' + String(requested).replace(/_/g, ' ');
    }
  } else {
    var stepIIIs = optlCountActiveStepIII_(state.events, draft.employeeId, periodId, asOf);
    if (requested === 'STEP_III' && stepIIIs >= 1) {
      effective = 'TERM';
      reason = 'Second concurrent STEP III is not permitted; effective action is TERM';
    }
  }
  return {
    requested: requested,
    effective: effective,
    adjusted: effective !== requested,
    reason: reason,
    proposalKind: proposal.kind,
  };
}

function optlAudit_(state, action, payload) {
  state.audit.push({
    auditId: optlNewId_('aud'),
    action: action,
    at: optlToday_() + 'T12:00:00',
    actorDeclared: payload.actingManagerDeclared || null,
    actorAttribution: 'manager-declared',
    reason: payload.reason || '',
    before: payload.before || null,
    after: payload.after || null,
    eventId: payload.eventId || null,
    employeeId: payload.employeeId || null,
  });
}

/** Reject invalid scored tardies and similar; unscored factual notes may still be kept separately. */
function optlValidateScoredEvent_(draft) {
  var errors = [];
  if (!draft || !draft.employeeId) errors.push('employeeId required');
  if (!draft.incidentDate) errors.push('incidentDate required');
  if (draft.section !== 'A' && draft.section !== 'B') errors.push('section must be A or B');
  if (!draft.category) errors.push('category required');
  if (!draft.entryType) errors.push('entryType required');
  if (draft.scored === false) {
    return { ok: errors.length === 0, errors: errors, scored: false };
  }
  if (draft.category === 'Tardy' || draft.entryType === 'Occurrence' && draft.section === 'B' && draft.category === 'Tardy') {
    var minutes = draft.quantitativeDetail;
    if (minutes !== null && minutes !== undefined && minutes !== '') {
      var cls = optlLateClassification_(minutes);
      if (cls.reason === 'within-grace' || cls.category === null) {
        errors.push('Tardy scored events require more than 15 minutes late');
      }
      if (cls.category === 'Attendance') {
        errors.push('120+ minutes must be Attendance, not Tardy');
      }
      if (cls.category === 'Tardy' && draft.category !== 'Tardy') {
        errors.push('classification mismatch');
      }
    }
  }
  if (draft.category === 'Attendance' && draft.quantitativeDetail !== null && draft.quantitativeDetail !== undefined && draft.quantitativeDetail !== '') {
    var mins = Number(draft.quantitativeDetail);
    if (isFinite(mins) && mins > 15 && mins < 120) {
      errors.push('16–119 minutes must be Tardy, not Attendance');
    }
  }
  return { ok: errors.length === 0, errors: errors, scored: true };
}

function optlActiveEmploymentPeriod_(employee) {
  var periods = employee.employmentPeriods || [];
  var active = null;
  periods.forEach(function (period) {
    if (period.status === 'active') active = period;
  });
  return active;
}

function optlPendingForEmployee_(state, employeeId) {
  return (state.pendingActions || []).filter(function (row) {
    return row.employeeId === employeeId && row.status === 'open';
  });
}

function optlHasBlockingPending_(state, employeeId) {
  return optlPendingForEmployee_(state, employeeId).some(function (row) {
    return row.kind === 'ACTION_REQUIRED' || row.kind === 'TERM_REQUIRED';
  });
}

function optlSectionCurrentStep_(events, employeeId, section, periodId, asOfDate) {
  var level = null;
  var rank = { STEP_I: 1, STEP_II: 2, STEP_III: 3 };
  events.forEach(function (event) {
    if (event.employeeId !== employeeId || event.section !== section) return;
    if (periodId && event.employmentPeriodId && event.employmentPeriodId !== periodId) return;
    if (event.status !== 'active') return;
    if (!rank[event.entryType]) return;
    var exp = event.effectiveExpirationDate || optlStepExpiration_(event.incidentDate);
    if (!optlUnlinkedActive_(event.incidentDate, asOfDate, exp) && event.entryType.indexOf('STEP') === 0) {
      // treat expired steps as inactive for current level
      return;
    }
    if (!level || rank[event.entryType] > rank[level]) level = event.entryType;
  });
  return level;
}

function optlCountActiveStepIII_(events, employeeId, periodId, asOfDate) {
  var count = 0;
  events.forEach(function (event) {
    if (event.employeeId !== employeeId) return;
    if (periodId && event.employmentPeriodId && event.employmentPeriodId !== periodId) return;
    if (event.status !== 'active' || event.entryType !== 'STEP_III') return;
    var exp = event.effectiveExpirationDate || optlStepExpiration_(event.incidentDate);
    if (optlUnlinkedActive_(event.incidentDate, asOfDate, exp)) count += 1;
  });
  return count;
}

/**
 * Next formal level if a category reaches its STEP threshold.
 * Does not auto-issue. Returns ACTION_REQUIRED / TERM_REQUIRED proposal.
 */
function optlProposeNextStep_(state, employeeId, section, category, asOfDate) {
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === employeeId) employee = row; });
  var period = employee ? optlActiveEmploymentPeriod_(employee) : null;
  var periodId = period ? period.periodId : null;
  var current = optlSectionCurrentStep_(state.events, employeeId, section, periodId, asOfDate);
  var stepIIIs = optlCountActiveStepIII_(state.events, employeeId, periodId, asOfDate);
  var proposed = 'STEP_I';
  if (current === 'STEP_I') proposed = 'STEP_II';
  else if (current === 'STEP_II') proposed = 'STEP_III';
  else if (current === 'STEP_III') proposed = 'TERM';

  if (proposed === 'STEP_III' && stepIIIs >= 1) {
    return {
      kind: 'TERM_REQUIRED',
      proposedLevel: 'TERM',
      section: section,
      category: category,
      reason: 'Second concurrent STEP III is not permitted; TERM required — manager action pending',
    };
  }
  if (proposed === 'TERM') {
    return {
      kind: 'TERM_REQUIRED',
      proposedLevel: 'TERM',
      section: section,
      category: category,
      reason: 'Occurrence threshold after STEP III requires TERM — manager action pending',
    };
  }
  return {
    kind: 'ACTION_REQUIRED',
    proposedLevel: proposed,
    section: section,
    category: category,
    reason: 'Category threshold reached; manager must issue ' + proposed.replace('_', ' '),
  };
}

function optlCategoryOccurrenceCount_(events, employeeId, section, category, periodId, asOfDate) {
  var count = 0;
  events.forEach(function (event) {
    if (event.employeeId !== employeeId) return;
    if (event.section !== section || event.category !== category) return;
    if (periodId && event.employmentPeriodId && event.employmentPeriodId !== periodId) return;
    if (event.entryType !== 'Occurrence' || event.status !== 'active') return;
    if (event.scored === false) return;
    var exp = event.effectiveExpirationDate || optlOccurrenceExpiration_(event.incidentDate);
    if (optlUnlinkedActive_(event.incidentDate, asOfDate, exp)) count += 1;
  });
  return count;
}

/** Workbook thresholds: 4 → STEP I, +2 → STEP II, +1 → STEP III, +1 → TERM relative to issued steps in category chain. */
function optlCategoryNeedsAction_(events, employeeId, section, category, periodId, asOfDate) {
  var occ = optlCategoryOccurrenceCount_(events, employeeId, section, category, periodId, asOfDate);
  var issuedInCategory = null;
  var rank = { STEP_I: 1, STEP_II: 2, STEP_III: 3 };
  events.forEach(function (event) {
    if (event.employeeId !== employeeId || event.category !== category || event.section !== section) return;
    if (periodId && event.employmentPeriodId && event.employmentPeriodId !== periodId) return;
    if (event.status !== 'active') return;
    if (!rank[event.entryType]) return;
    var exp = event.effectiveExpirationDate || optlStepExpiration_(event.incidentDate);
    if (!optlUnlinkedActive_(event.incidentDate, asOfDate, exp)) return;
    if (!issuedInCategory || rank[event.entryType] > rank[issuedInCategory]) issuedInCategory = event.entryType;
  });
  if (!issuedInCategory && occ >= 4) return true;
  if (issuedInCategory === 'STEP_I' && occ >= 6) return true;
  if (issuedInCategory === 'STEP_II' && occ >= 7) return true;
  if (issuedInCategory === 'STEP_III' && occ >= 8) return true;
  return false;
}

function optlRefreshPending_(state, employeeId, asOfDate) {
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === employeeId) employee = row; });
  if (!employee) return;
  var period = optlActiveEmploymentPeriod_(employee);
  var periodId = period ? period.periodId : null;
  // Drop open ACTION_REQUIRED that no longer apply; keep TERM_REQUIRED until cleared by issue/void cascade.
  state.pendingActions = (state.pendingActions || []).filter(function (row) {
    if (row.employeeId !== employeeId || row.status !== 'open') return true;
    if (row.kind === 'TERM_REQUIRED') return true;
    return optlCategoryNeedsAction_(state.events, employeeId, row.section, row.category, periodId, asOfDate);
  });
  var sections = [
    { section: 'A', categories: OPTL_SECTION_A_ },
    { section: 'B', categories: OPTL_SECTION_B_ },
  ];
  sections.forEach(function (block) {
    block.categories.forEach(function (category) {
      if (!optlCategoryNeedsAction_(state.events, employeeId, block.section, category, periodId, asOfDate)) return;
      var already = state.pendingActions.some(function (row) {
        return row.status === 'open' && row.employeeId === employeeId && row.section === block.section && row.category === category;
      });
      if (already) return;
      var proposal = optlProposeNextStep_(state, employeeId, block.section, category, asOfDate);
      state.pendingActions.push({
        pendingId: optlNewId_('pend'),
        employeeId: employeeId,
        employmentPeriodId: periodId,
        section: block.section,
        category: category,
        kind: proposal.kind,
        proposedLevel: proposal.proposedLevel,
        reason: proposal.reason,
        status: 'open',
        createdAt: asOfDate,
      });
      optlQueueAlert_(state, {
        employeeId: employeeId,
        kind: proposal.kind,
        title: proposal.kind.replace(/_/g, ' '),
        detail: block.section + '/' + category + ' · ' + proposal.reason,
      });
    });
  });
}

function optlAssertActingManager_(payload) {
  var name = String((payload && payload.actingManagerDeclared) || '').trim();
  if (!name) throw new Error('Select and confirm the acting manager (manager-declared attribution).');
  if (!(payload && payload.actingManagerConfirmed === true)) {
    throw new Error('Confirm the acting manager before recording an OPTL action.');
  }
  return name;
}

/**
 * Add a scored occurrence or unscored factual note.
 * GM decision (1): pending STEP/TERM blocks further scored/formal entries; unscored factual capture allowed.
 */
function optlAddEvent_(state, draft, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var scored = draft.scored !== false;
  if (scored) {
    var validation = optlValidateScoredEvent_(draft);
    if (!validation.ok) throw new Error(validation.errors.join('; '));
    if (optlHasBlockingPending_(state, draft.employeeId)) {
      throw new Error('Pending STEP/TERM lock: scored accountability is blocked until the manager issues the pending action. Unscored factual notes are still allowed.');
    }
  }
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === draft.employeeId) employee = row; });
  if (!employee) throw new Error('Unknown employee');
  var period = optlActiveEmploymentPeriod_(employee);
  if (!period) throw new Error('No active employment period');
  var originalExp = optlOccurrenceExpiration_(draft.incidentDate);
  var event = {
    eventId: optlNewId_('evt'),
    employeeId: draft.employeeId,
    employmentPeriodId: period.periodId,
    incidentDate: String(draft.incidentDate).slice(0, 10),
    entryAt: asOf,
    section: draft.section,
    category: draft.category,
    entryType: draft.entryType || 'Occurrence',
    shortDescription: draft.shortDescription || '',
    quantitativeDetail: draft.quantitativeDetail === undefined ? null : draft.quantitativeDetail,
    status: 'active',
    scored: scored,
    notes: draft.notes || '',
    originalExpirationDate: originalExp,
    effectiveExpirationDate: originalExp,
    chainId: null,
    createdByDeclared: manager,
  };
  // Auto-label late arrivals when minutes provided
  if (scored && (draft.category === 'Tardy' || draft.category === 'Attendance') && draft.quantitativeDetail !== null && draft.quantitativeDetail !== undefined && draft.quantitativeDetail !== '') {
    var late = optlLateClassification_(draft.quantitativeDetail);
    if (late.label) event.shortDescription = draft.shortDescription || late.label;
    if (late.category && draft.autoClassify !== false) {
      event.category = late.category;
      event.section = late.section;
    }
  }
  state.events.push(event);
  optlAudit_(state, scored ? 'add-scored-event' : 'add-unscored-note', {
    actingManagerDeclared: manager,
    employeeId: draft.employeeId,
    eventId: event.eventId,
    after: event,
    reason: payload.reason || '',
  });
  if (scored) optlRefreshPending_(state, draft.employeeId, asOf);
  return event;
}

/**
 * Issue a formal STEP/TERM. Official at manager issuance (not employee signature).
 * Clock uses incident date. Direct STEP II/III requires written justification.
 */
function optlIssueFormalAction_(state, draft, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var level = draft.entryType;
  if (level !== 'STEP_I' && level !== 'STEP_II' && level !== 'STEP_III' && level !== 'TERM') {
    throw new Error('Formal action must be STEP_I, STEP_II, STEP_III, or TERM');
  }
  if ((level === 'STEP_II' || level === 'STEP_III' || level === 'TERM') && draft.directIssue) {
    if (!String(draft.justification || '').trim()) {
      throw new Error('Direct STEP II/III/TERM requires written justification');
    }
  }
  if (optlHasBlockingPending_(state, draft.employeeId) === false && draft.requiresPending !== false && !draft.directIssue) {
    // Allow issue when pending exists OR directIssue; if threshold path, prefer pending.
  }
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === draft.employeeId) employee = row; });
  if (!employee) throw new Error('Unknown employee');
  var period = optlActiveEmploymentPeriod_(employee);
  if (!period) throw new Error('No active employment period');

  var stepIIIs = optlCountActiveStepIII_(state.events, draft.employeeId, period.periodId, asOf);
  if (level === 'STEP_III' && stepIIIs >= 1) {
    throw new Error('Cannot issue a second STEP III; resolve TERM_REQUIRED instead');
  }

  var incidentDate = String(draft.incidentDate || asOf).slice(0, 10);
  var chainId = draft.chainId || optlNewId_('chain');
  // Threshold path may elevate requested STEP I→II etc. Second STEP III never auto-issues; manager must choose TERM.
  var resolved = optlResolveEffectiveLevel_(state, draft, asOf);
  if (!draft.directIssue && resolved.effective !== level && resolved.effective !== 'Occurrence') {
    if (resolved.effective === 'TERM' && level !== 'TERM') {
      throw new Error('TERM_REQUIRED — complete the Termination / TERM issuance form; cannot issue another STEP III');
    }
    level = resolved.effective;
  }
  if (level === 'STEP_III' && optlCountActiveStepIII_(state.events, draft.employeeId, period.periodId, asOf) >= 1) {
    throw new Error('Cannot issue a second STEP III; resolve TERM_REQUIRED instead');
  }
  var exp = level === 'TERM' ? null : optlStepExpiration_(incidentDate);

  var formal = {
    eventId: optlNewId_('evt'),
    employeeId: draft.employeeId,
    employmentPeriodId: period.periodId,
    incidentDate: incidentDate,
    entryAt: asOf,
    section: draft.section,
    category: draft.category,
    entryType: level,
    shortDescription: draft.shortDescription || ('STEP ' + String(level).replace('STEP_', '').replace('_', ' ')),
    quantitativeDetail: null,
    status: 'active',
    scored: true,
    notes: draft.notes || '',
    peopleInvolved: draft.peopleInvolved || '',
    locationDetail: draft.locationDetail || 'Store 17',
    companyImpact: draft.companyImpact || '',
    policyViolated: draft.policyViolated || '',
    priorConversations: draft.priorConversations || '',
    improvementPlan: draft.improvementPlan || '',
    warningTypes: draft.warningTypes || [],
    originalExpirationDate: exp,
    effectiveExpirationDate: exp,
    chainId: chainId,
    createdByDeclared: manager,
    justification: draft.justification || '',
    directIssue: !!draft.directIssue,
    officialAtIssuance: true,
    pipCounselingLabel: optlPipCounselingLabel_(level),
    hrApprovalRequired: level === 'STEP_II' || level === 'STEP_III' || level === 'TERM',
    hrApprovalObtained: !!draft.hrApprovalObtained,
  };
  state.events.push(formal);

  // Freeze section progressive PIP chain: category occs + prior STEPs in section + already-linked chain members.
  if (exp) {
    var priorChainIds = {};
    state.events.forEach(function (event) {
      if (event.employeeId !== draft.employeeId) return;
      if (event.employmentPeriodId !== period.periodId) return;
      if (event.section !== draft.section) return;
      if (event.status !== 'active') return;
      if (event.entryType && String(event.entryType).indexOf('STEP') === 0 && event.chainId) {
        priorChainIds[event.chainId] = true;
      }
    });
    state.events.forEach(function (event) {
      if (event.employeeId !== draft.employeeId) return;
      if (event.employmentPeriodId !== period.periodId) return;
      if (event.section !== draft.section) return;
      if (event.status !== 'active') return;
      if (event.eventId === formal.eventId) return;
      var link = false;
      if (event.category === draft.category && event.entryType === 'Occurrence' && event.scored !== false) link = true;
      if (event.chainId && (event.chainId === chainId || priorChainIds[event.chainId])) link = true;
      if (event.entryType && String(event.entryType).indexOf('STEP') === 0) link = true;
      if (!link) return;
      event.chainId = chainId;
      event.effectiveExpirationDate = exp;
      event.freezeReason = 'Inherited from ' + level + ' issued for incident ' + incidentDate;
    });
    formal.chainId = chainId;
  }

  // Close matching pending
  state.pendingActions.forEach(function (row) {
    if (row.employeeId !== draft.employeeId || row.status !== 'open') return;
    if (row.section === draft.section && (row.category === draft.category || level === 'TERM' || row.kind === 'TERM_REQUIRED')) {
      row.status = 'closed';
      row.closedAt = asOf;
      row.closedByDeclared = manager;
      row.resolvedEventId = formal.eventId;
    }
  });

  optlAudit_(state, 'issue-formal-action', {
    actingManagerDeclared: manager,
    employeeId: draft.employeeId,
    eventId: formal.eventId,
    after: formal,
    reason: draft.justification || 'Manager issued formal action',
  });

  formal.alertPlan = {
    commandCenter: !!(state.alertConfig && state.alertConfig.commandCenter),
    email: false,
    emailBlockedReason: 'Test/production OPTL email sending is disabled until recipients are configured and approved',
  };
  optlQueueAlert_(state, {
    employeeId: draft.employeeId,
    kind: level === 'TERM' ? 'TERM_ISSUED' : 'STEP_ISSUED',
    title: (formal.pipCounselingLabel || level) + ' issued',
    detail: draft.category + ' · incident ' + incidentDate + ' · manager-declared: ' + manager,
  });

  optlRefreshPending_(state, draft.employeeId, asOf);
  return formal;
}

/**
 * Void/correct supporting occurrence; rescind unsupported STEPs from active matrix;
 * keep RESCINDED in history; cascade.
 */
function optlVoidEvent_(state, eventId, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var target = null;
  state.events.forEach(function (event) { if (event.eventId === eventId) target = event; });
  if (!target) throw new Error('Event not found');
  if (target.status === 'voided' || target.status === 'rescinded') throw new Error('Event already inactive');
  var before = JSON.parse(JSON.stringify(target));
  target.status = target.entryType && String(target.entryType).indexOf('STEP') === 0 ? 'rescinded' : 'voided';
  target.voidedAt = asOf;
  target.voidedByDeclared = manager;
  target.voidReason = payload.reason || 'Manager correction';
  optlAudit_(state, target.status === 'rescinded' ? 'rescind-step' : 'void-occurrence', {
    actingManagerDeclared: manager,
    employeeId: target.employeeId,
    eventId: target.eventId,
    before: before,
    after: target,
    reason: payload.reason || '',
  });

  // Rescind later formal actions in same category/section that depended on occurrence counts
  var employeeId = target.employeeId;
  optlRefreshPending_(state, employeeId, asOf);
  // If a STEP is active but category no longer meets threshold for that level, rescind it from active.
  state.events.slice().forEach(function (event) {
    if (event.employeeId !== employeeId || event.status !== 'active') return;
    if (!event.entryType || String(event.entryType).indexOf('STEP') !== 0) return;
    var periodId = event.employmentPeriodId;
    var stillNeeded = optlCategoryNeedsAction_(state.events, employeeId, event.section, event.category, periodId, asOf);
    // Also rescind if supporting occ count below the step's gate
    var occ = optlCategoryOccurrenceCount_(state.events, employeeId, event.section, event.category, periodId, asOf);
    var ok = true;
    if (event.entryType === 'STEP_I' && occ < 4 && !event.directIssue) ok = false;
    if (event.entryType === 'STEP_II' && occ < 6 && !event.directIssue) ok = false;
    if (event.entryType === 'STEP_III' && occ < 7 && !event.directIssue) ok = false;
    if (!ok) {
      var prior = JSON.parse(JSON.stringify(event));
      event.status = 'rescinded';
      event.voidedAt = asOf;
      event.voidedByDeclared = manager;
      event.voidReason = 'Supporting occurrences no longer justify this STEP after correction';
      optlAudit_(state, 'rescind-step', {
        actingManagerDeclared: manager,
        employeeId: employeeId,
        eventId: event.eventId,
        before: prior,
        after: event,
        reason: event.voidReason,
      });
      state.exceptions.push({
        exceptionId: optlNewId_('ex'),
        employeeId: employeeId,
        section: event.section,
        category: event.category,
        eventId: event.eventId,
        severity: 'review',
        status: 'open',
        reason: 'STEP rescinded after void; confirm Paycor paper follow-up if a signed form exists',
        tone: 'yellow-red',
        createdAt: asOf,
      });
    }
  });
  optlRefreshPending_(state, employeeId, asOf);
  return target;
}

/** Rehire: same employeeId, new employment period, clean active matrix; prior history retained. */
function optlRehireEmployee_(state, employeeId, hireDate, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === employeeId) employee = row; });
  if (!employee) throw new Error('Unknown employee');
  employee.employmentPeriods = employee.employmentPeriods || [];
  employee.employmentPeriods.forEach(function (period) {
    if (period.status === 'active') {
      period.status = 'ended';
      period.separationDate = period.separationDate || hireDate;
    }
  });
  var period = {
    periodId: optlNewId_('emp'),
    hireDate: String(hireDate).slice(0, 10),
    separationDate: null,
    status: 'active',
  };
  employee.employmentPeriods.push(period);
  employee.status = 'active';
  employee.separationDate = null;
  optlAudit_(state, 'rehire', {
    actingManagerDeclared: manager,
    employeeId: employeeId,
    after: period,
    reason: payload.reason || 'Rehire — fresh employment period; prior history retained',
  });
  return employee;
}

function optlEventActiveOn_(event, asOfDate) {
  if (event.status !== 'active') return false;
  if (event.entryType === 'TERM') return true;
  var exp = event.effectiveExpirationDate;
  if (!exp) {
    exp = event.entryType && String(event.entryType).indexOf('STEP') === 0
      ? optlStepExpiration_(event.incidentDate)
      : optlOccurrenceExpiration_(event.incidentDate);
  }
  return optlUnlinkedActive_(event.incidentDate, asOfDate, exp);
}

function optlBuildCategoryMatrix_(events, employeeId, section, category, periodId, asOfDate) {
  var occ = [];
  var steps = {};
  events.forEach(function (event) {
    if (event.employeeId !== employeeId) return;
    if (event.section !== section || event.category !== category) return;
    if (periodId && event.employmentPeriodId && event.employmentPeriodId !== periodId) return;
    if (!optlEventActiveOn_(event, asOfDate)) return;
    if (event.scored === false) return;
    if (event.entryType === 'Occurrence') occ.push(event);
    if (event.entryType === 'STEP_I') steps['step-i'] = event;
    if (event.entryType === 'STEP_II') steps['step-ii'] = event;
    if (event.entryType === 'STEP_III') steps['step-iii'] = event;
    if (event.entryType === 'TERM') steps.term = event;
  });
  occ.sort(optlSortEvents_);
  var bySlot = {};
  occ.forEach(function (event, index) {
    if (index >= OPTL_OCC_SLOTS_.length) return;
    bySlot[OPTL_OCC_SLOTS_[index]] = event;
  });
  Object.keys(steps).forEach(function (key) { bySlot[key] = steps[key]; });
  return {
    section: section,
    category: category,
    cells: OPTL_SLOT_KEYS_.map(function (slotKey) {
      var hit = bySlot[slotKey];
      return {
        slotKey: slotKey,
        slotLabel: OPTL_SLOT_LABELS_[slotKey],
        occupied: !!hit,
        eventId: hit ? hit.eventId : null,
        incidentDate: hit ? hit.incidentDate : null,
        expirationDate: hit ? hit.effectiveExpirationDate || hit.originalExpirationDate : null,
        shortDescription: hit ? hit.shortDescription : null,
        stepTone: OPTL_STEP_TONES_[slotKey] || null,
        pipState: hit && String(hit.entryType).indexOf('STEP') === 0 ? 'current' : 'none',
        reviewRequired: false,
      };
    }),
  };
}

function optlEngineEmployeeView_(state, employeeId, asOfDate) {
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === employeeId) employee = row; });
  var period = employee ? optlActiveEmploymentPeriod_(employee) : null;
  var periodId = period ? period.periodId : null;
  optlRefreshPending_(state, employeeId, asOfDate);
  var rows = [];
  var history = [];
  function walk(section, categories) {
    categories.forEach(function (category) {
      rows.push(optlBuildCategoryMatrix_(state.events, employeeId, section, category, periodId, asOfDate));
    });
  }
  walk('A', OPTL_SECTION_A_);
  walk('B', OPTL_SECTION_B_);
  state.events.forEach(function (event) {
    if (event.employeeId !== employeeId) return;
    // History includes prior periods
    var exp = event.effectiveExpirationDate || event.originalExpirationDate ||
      (event.entryType && String(event.entryType).indexOf('STEP') === 0
        ? optlStepExpiration_(event.incidentDate)
        : optlOccurrenceExpiration_(event.incidentDate));
    var status = event.status;
    if (status === 'active' && event.entryType !== 'TERM' && exp && !optlUnlinkedActive_(event.incidentDate, asOfDate, exp)) {
      status = 'expired';
    }
    history.push({
      eventId: event.eventId,
      incidentDate: event.incidentDate,
      section: event.section,
      category: event.category,
      entryType: event.entryType,
      shortDescription: event.shortDescription,
      originalExpirationDate: event.originalExpirationDate || exp,
      effectiveExpirationDate: event.effectiveExpirationDate || exp,
      status: status,
      employmentPeriodId: event.employmentPeriodId,
      scored: event.scored !== false,
    });
  });
  history.sort(optlSortEvents_);
  // Mark review boxes from open exceptions
  (state.exceptions || []).forEach(function (ex) {
    if (ex.employeeId !== employeeId || ex.status !== 'open') return;
    rows.forEach(function (row) {
      if (row.section !== ex.section || row.category !== ex.category) return;
      row.cells.forEach(function (cell) {
        if (cell.eventId === ex.eventId || !cell.occupied && ex.eventId) {
          if (cell.eventId === ex.eventId) cell.reviewRequired = true;
        }
      });
    });
  });
  return {
    matrixRows: rows,
    history: history,
    pendingActions: optlPendingForEmployee_(state, employeeId),
    exceptions: (state.exceptions || []).filter(function (row) { return row.employeeId === employeeId && row.status === 'open'; }),
    lock: optlHasBlockingPending_(state, employeeId),
  };
}

/** New Hire — synthetic roster only; clean active matrix. */
function optlNewHireEmployee_(state, draft, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var employeeId = String(draft.employeeId || '').trim();
  if (!employeeId) throw new Error('Employee ID required');
  var exists = false;
  state.employees.forEach(function (row) { if (row.employeeId === employeeId) exists = true; });
  if (exists) throw new Error('Employee ID already exists');
  var hireDate = String(draft.hireDate || optlToday_()).slice(0, 10);
  var employee = {
    employeeId: employeeId,
    displayName: String(draft.displayName || '').trim() || employeeId,
    jobTitle: draft.jobTitle || 'Sales Associate',
    department: draft.department || 'Sales',
    hireDate: hireDate,
    status: 'active',
    separationDate: null,
    employmentPeriods: [
      { periodId: optlNewId_('emp'), hireDate: hireDate, separationDate: null, status: 'active' },
    ],
  };
  state.employees.push(employee);
  optlAudit_(state, 'new-hire', {
    actingManagerDeclared: manager,
    employeeId: employeeId,
    after: employee,
    reason: payload.reason || 'New hire — clean slate matrix',
  });
  optlQueueAlert_(state, {
    employeeId: employeeId,
    kind: 'NEW_HIRE',
    title: 'New hire added to OPTL roster',
    detail: employee.displayName + ' · ' + hireDate,
  });
  return employee;
}

/**
 * Termination form — moves to Former; retains full history/matrix for reprint.
 * Does not auto-fire from TERM_REQUIRED; manager must complete this form.
 */
function optlTerminateEmployee_(state, employeeId, draft, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === employeeId) employee = row; });
  if (!employee) throw new Error('Unknown employee');
  var separationDate = String((draft && draft.separationDate) || optlToday_()).slice(0, 10);
  var period = optlActiveEmploymentPeriod_(employee);
  if (period) {
    period.status = 'ended';
    period.separationDate = separationDate;
  }
  employee.status = 'former';
  employee.separationDate = separationDate;
  employee.terminationReason = (draft && draft.reason) || '';
  employee.terminationNotes = (draft && draft.notes) || '';
  // Close open pending; record TERM event if not already present for this period
  state.pendingActions.forEach(function (row) {
    if (row.employeeId === employeeId && row.status === 'open') {
      row.status = 'closed';
      row.closedAt = separationDate;
      row.closedByDeclared = manager;
    }
  });
  var hasTerm = state.events.some(function (event) {
    return event.employeeId === employeeId && event.entryType === 'TERM' && event.status === 'active' &&
      (!period || event.employmentPeriodId === period.periodId);
  });
  if (!hasTerm) {
    state.events.push({
      eventId: optlNewId_('evt'),
      employeeId: employeeId,
      employmentPeriodId: period ? period.periodId : null,
      incidentDate: separationDate,
      entryAt: separationDate,
      section: (draft && draft.section) || 'A',
      category: (draft && draft.category) || 'Behavior',
      entryType: 'TERM',
      shortDescription: 'Termination Session',
      status: 'active',
      scored: true,
      notes: (draft && draft.notes) || '',
      createdByDeclared: manager,
      officialAtIssuance: true,
      pipCounselingLabel: 'Termination Session',
      hrApprovalRequired: true,
      hrApprovalObtained: !!(draft && draft.hrApprovalObtained),
    });
  }
  optlAudit_(state, 'terminate-employee', {
    actingManagerDeclared: manager,
    employeeId: employeeId,
    after: { separationDate: separationDate, reason: employee.terminationReason },
    reason: employee.terminationReason || 'Termination form completed',
  });
  optlQueueAlert_(state, {
    employeeId: employeeId,
    kind: 'TERMINATED',
    title: 'Associate moved to Former Employees',
    detail: employee.displayName + ' · ' + separationDate + ' · history retained',
  });
  return employee;
}

/**
 * Supervised acknowledgment — typed full name + checkbox, or manager-documented refusal.
 * No SSN. Does not make STEP official (issuance already did).
 */
function optlAcknowledgeEvent_(state, eventId, draft, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var target = null;
  state.events.forEach(function (event) { if (event.eventId === eventId) target = event; });
  if (!target) throw new Error('Event not found');
  var refused = !!(draft && draft.refused === true);
  var typedName = String((draft && draft.typedFullName) || '').trim();
  if (!refused) {
    if (!typedName) throw new Error('Typed full name is required for acknowledgment');
    if (!(draft && draft.acknowledgedCheckbox === true)) {
      throw new Error('Employee must check the acknowledgment statement');
    }
  }
  var ack = {
    acknowledgmentId: optlNewId_('ack'),
    eventId: eventId,
    employeeId: target.employeeId,
    typedFullName: refused ? '' : typedName,
    refused: refused,
    refusalNote: refused ? (draft.refusalNote || 'Employee Refused to Sign') : '',
    statement: 'I acknowledge this matter was discussed with me. Acknowledgment does not necessarily mean agreement.',
    acknowledgedAt: asOf + 'T12:00:00',
    supervisingManagerDeclared: manager,
    actorAttribution: 'manager-declared',
  };
  state.acknowledgments = state.acknowledgments || [];
  state.acknowledgments.push(ack);
  target.acknowledgmentId = ack.acknowledgmentId;
  target.acknowledgmentStatus = refused ? 'refused' : 'acknowledged';
  optlAudit_(state, refused ? 'acknowledgment-refused' : 'acknowledgment-recorded', {
    actingManagerDeclared: manager,
    employeeId: target.employeeId,
    eventId: eventId,
    after: ack,
    reason: refused ? ack.refusalNote : 'Supervised acknowledgment',
  });
  return ack;
}

/** Flag an ambiguous linkage for yellow/red REVIEW_REQUIRED on the exact matrix box. */
function optlFlagReviewRequired_(state, draft, payload) {
  var manager = optlAssertActingManager_(payload || {});
  var asOf = String((payload && payload.asOfDate) || optlToday_()).slice(0, 10);
  var ex = {
    exceptionId: optlNewId_('ex'),
    employeeId: draft.employeeId,
    section: draft.section,
    category: draft.category,
    eventId: draft.eventId || null,
    slotKey: draft.slotKey || null,
    severity: 'review',
    status: 'open',
    reason: draft.reason || 'Unresolvable ordering/linkage — management review required',
    tone: 'yellow-red',
    createdAt: asOf,
    createdByDeclared: manager,
  };
  state.exceptions.push(ex);
  optlAudit_(state, 'flag-review-required', {
    actingManagerDeclared: manager,
    employeeId: draft.employeeId,
    eventId: draft.eventId || null,
    after: ex,
    reason: ex.reason,
  });
  return ex;
}

/** Build Kane's PIP print payload from a formal STEP/TERM event. Never invents facts. */
function optlBuildPipPrint_(state, eventId) {
  var event = null;
  state.events.forEach(function (row) { if (row.eventId === eventId) event = row; });
  if (!event) throw new Error('Event not found');
  if (!(event.entryType === 'STEP_I' || event.entryType === 'STEP_II' || event.entryType === 'STEP_III' || event.entryType === 'TERM')) {
    throw new Error('PIP print requires a formal STEP or TERM');
  }
  var employee = null;
  state.employees.forEach(function (row) { if (row.employeeId === event.employeeId) employee = row; });
  var openReview = (state.exceptions || []).some(function (ex) {
    return ex.employeeId === event.employeeId && ex.status === 'open';
  });
  return {
    documentTitle: 'Personal Improvement Plan (PIP)',
    brand: 'Kane\'s Furniture',
    store: 'Store 17',
    locationStoreNumber: '17',
    employeeName: employee ? employee.displayName : event.employeeId,
    jobTitle: employee ? employee.jobTitle : '',
    dateOfDiscussion: event.entryAt || event.incidentDate,
    counselingLevel: event.pipCounselingLabel || optlPipCounselingLabel_(event.entryType),
    entryType: event.entryType,
    warningTypes: event.warningTypes || [],
    category: event.category,
    incidentDate: event.incidentDate,
    peopleInvolved: event.peopleInvolved || '',
    locationDetail: event.locationDetail || 'Store 17',
    companyImpact: event.companyImpact || '',
    policyViolated: event.policyViolated || '',
    priorConversations: event.priorConversations || '',
    description: event.notes || event.shortDescription || '',
    improvementPlan: event.improvementPlan || '',
    consequencesNonTerm: 'Further infractions may result in continued corrective action up to and including termination.',
    previousNoticesUnknown: true,
    hrApprovalRequired: !!event.hrApprovalRequired,
    hrApprovalObtained: !!event.hrApprovalObtained,
    hrApprovalNote: 'Approval from Human Resources or your department\'s Executive is requested for Disciplinary Action resulting in a Counseling, Final Counseling, or Termination',
    managerDeclared: event.createdByDeclared || '',
    watermark: openReview ? 'PENDING MANAGEMENT REVIEW' : (event.hrApprovalRequired && !event.hrApprovalObtained ? 'HR APPROVAL REQUESTED — NOT YET CONFIRMED' : null),
    signatureLinesBlank: true,
    refusalInstruction: 'Managers: should the associate refuse to sign, write "Employee Refused to Sign" where they would sign per procedure. The document is still valid if refused to sign.',
    privateNotesExcluded: true,
  };
}
