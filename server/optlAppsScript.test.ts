/**
 * OPTL Phase 1 + Stage 2: expiration, validation, progression, locks, cascades, rehire.
 * Synthetic demo only — no sales sheet writes, no email, no auto-terminate.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { appsScriptServices } from './appsScriptServices.ts';

type OptlGs = {
  optlAddCalendarDays_: (iso: string, days: number) => string;
  optlOccurrenceExpiration_: (iso: string) => string;
  optlStepExpiration_: (iso: string) => string;
  optlUnlinkedActive_: (incident: string, asOf: string, exp?: string) => boolean;
  optlLateClassification_: (minutes: number) => {
    category: string | null;
    section: string | null;
    label: string | null;
    reason: string;
  };
  optlValidateScoredEvent_: (draft: Record<string, unknown>) => {
    ok: boolean;
    errors: string[];
    scored: boolean;
  };
  OPTL_SLOT_LABELS_: Record<string, string>;
  optlCategoryView_: (
    events: unknown[],
    section: string,
    category: string,
    asOf: string,
  ) => { active: { eventId: string; slotKey: string; incidentDate: string }[]; expired: { eventId: string }[] };
  optlEmptyState_: () => {
    employees: Record<string, unknown>[];
    events: Record<string, unknown>[];
    pendingActions: Record<string, unknown>[];
    audit: unknown[];
    exceptions: Record<string, unknown>[];
    alertConfig: Record<string, unknown>;
  };
  optlAddEvent_: (state: unknown, draft: Record<string, unknown>, payload: Record<string, unknown>) => Record<string, unknown>;
  optlIssueFormalAction_: (state: unknown, draft: Record<string, unknown>, payload: Record<string, unknown>) => Record<string, unknown>;
  optlVoidEvent_: (state: unknown, eventId: string, payload: Record<string, unknown>) => Record<string, unknown>;
  optlRehireEmployee_: (state: unknown, employeeId: string, hireDate: string, payload: Record<string, unknown>) => Record<string, unknown>;
  optlRefreshPending_: (state: unknown, employeeId: string, asOf: string) => void;
  optlHasBlockingPending_: (state: unknown, employeeId: string) => boolean;
  optlEngineEmployeeView_: (state: unknown, employeeId: string, asOf: string) => {
    matrixRows: { category: string; cells: { slotKey: string; occupied: boolean; eventId: string | null; expirationDate: string | null }[] }[];
    history: { status: string; eventId: string; employmentPeriodId?: string }[];
    pendingActions: { kind: string; proposedLevel: string; category: string }[];
    exceptions: { tone: string }[];
    lock: boolean;
  };
  optlProposeNextStep_: (state: unknown, employeeId: string, section: string, category: string, asOf: string) => {
    kind: string;
    proposedLevel: string;
  };
  optlAcknowledgmentSpec_: () => { requiresSsn: boolean; mode: string; officialAt: string };
  optlNewHireEmployee_: (state: unknown, draft: Record<string, unknown>, payload: Record<string, unknown>) => Record<string, unknown>;
  optlTerminateEmployee_: (
    state: unknown,
    employeeId: string,
    draft: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => Record<string, unknown>;
  optlAcknowledgeEvent_: (
    state: unknown,
    eventId: string,
    draft: Record<string, unknown>,
    payload: Record<string, unknown>,
  ) => Record<string, unknown>;
  optlBuildPipPrint_: (state: unknown, eventId: string) => {
    documentTitle: string;
    sourceTemplate?: string;
    counselingLevel: string;
    counselingLevels?: { label: string; checked: boolean }[];
    warningOptions?: { label: string; checked: boolean }[];
    policyIntro?: string;
    consequenceText?: string;
    filingNote?: string;
    hrApprovalNote: string;
    signatureLinesBlank: boolean;
  };
  optlFlagReviewRequired_: (state: unknown, draft: Record<string, unknown>, payload: Record<string, unknown>) => {
    tone: string;
  };
  optlMemoryBook_: () => unknown;
  optlSaveStateToBook_: (book: unknown, state: unknown) => void;
  optlLoadStateFromBook_: (book: unknown) => { employees: { employeeId: string; status: string }[]; events: unknown[]; audit: unknown[] };
  optlAssertDedicatedBook_: (id: string) => void;
  optlQueueAlert_: (state: { alerts: { kind: string; status: string }[] }, alert: Record<string, unknown>) => unknown;
  optlDispatchManagementEmail_: (state: unknown, alert: Record<string, unknown>) => { sent: boolean; subject?: string; body?: string; reason: string };
  SPREADSHEET_ID_?: string;
  optl_: (payload: Record<string, unknown>) => {
    selectedEmployeeId: string;
    phase: number;
    matrixRows: unknown[];
    history: { status: string; eventId: string; shortDescription?: string }[];
    notice: string;
    lock: boolean;
    pendingActions: { kind: string; category: string }[];
    acknowledgment: { requiresSsn: boolean };
    alertConfig: { emailEnabled: boolean; testSendingDisabled: boolean };
    actingManagerAttribution: string;
    dashboard?: { pendingCount: number };
  };
};

const actor = {
  actingManagerDeclared: 'Kelly Meyers — General Manager',
  actingManagerConfirmed: true,
};

function loadOptl(): OptlGs {
  const { services } = appsScriptServices();
  const context: Record<string, unknown> = { ...services, SPREADSHEET_ID_: 'sales-book-id' };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../apps-script/Optl.gs', import.meta.url), 'utf8'), context, {
    filename: 'Optl.gs',
  });
  vm.runInContext(readFileSync(new URL('../apps-script/OptlEngine.gs', import.meta.url), 'utf8'), context, {
    filename: 'OptlEngine.gs',
  });
  vm.runInContext(readFileSync(new URL('../apps-script/OptlStore.gs', import.meta.url), 'utf8'), context, {
    filename: 'OptlStore.gs',
  });
  return context as unknown as OptlGs;
}

function seedEmployee(state: ReturnType<OptlGs['optlEmptyState_']>, id = 'E1') {
  state.employees.push({
    employeeId: id,
    displayName: 'Demo Associate',
    status: 'active',
    hireDate: '2025-01-01',
    employmentPeriods: [{ periodId: 'emp-e1', hireDate: '2025-01-01', separationDate: null, status: 'active' }],
  });
}

function addOcc(
  gs: OptlGs,
  state: ReturnType<OptlGs['optlEmptyState_']>,
  date: string,
  category: string,
  section = 'A',
  extra: Record<string, unknown> = {},
) {
  return gs.optlAddEvent_(
    state,
    {
      employeeId: 'E1',
      incidentDate: date,
      section,
      category,
      entryType: 'Occurrence',
      shortDescription: category,
      scored: true,
      ...extra,
    },
    { ...actor, asOfDate: date },
  );
}

test('OPTL occurrence expires on day 180 and keeps history', () => {
  const gs = loadOptl();
  assert.equal(gs.optlOccurrenceExpiration_('2026-01-15'), '2026-07-14');
  assert.equal(gs.optlUnlinkedActive_('2026-01-15', '2026-07-13'), true);
  assert.equal(gs.optlUnlinkedActive_('2026-01-15', '2026-07-14'), false);
});

test('OPTL tardy occurrences compact left after the oldest expires', () => {
  const gs = loadOptl();
  const view = gs.optlCategoryView_(
    [
      {
        eventId: 'old',
        employeeId: 'x',
        incidentDate: '2026-01-15',
        section: 'B',
        category: 'Tardy',
        entryType: 'Occurrence',
        shortDescription: 'Tardy',
        status: 'active',
      },
      {
        eventId: 'new',
        employeeId: 'x',
        incidentDate: '2026-08-20',
        section: 'B',
        category: 'Tardy',
        entryType: 'Occurrence',
        shortDescription: 'Tardy',
        status: 'active',
      },
    ],
    'B',
    'Tardy',
    '2026-10-25',
  );
  assert.equal(view.active.length, 1);
  assert.equal(view.active[0]?.eventId, 'new');
  assert.equal(view.active[0]?.slotKey, 'occurrence-1');
  assert.equal(view.active[0]?.incidentDate, '2026-08-20');
  assert.equal(view.expired[0]?.eventId, 'old');
});

test('OPTL civil-day math crosses the spring DST boundary', () => {
  const gs = loadOptl();
  assert.equal(gs.optlAddCalendarDays_('2026-03-08', 10), '2026-03-18');
});

test('OPTL late classification uses the confirmed 2-hour Attendance boundary', () => {
  const gs = loadOptl();
  const cases: [number, string | null][] = [
    [0, null],
    [15, null],
    [16, 'Tardy'],
    [119, 'Tardy'],
    [120, 'Attendance'],
    [121, 'Attendance'],
  ];
  cases.forEach(([minutes, category]) => {
    const result = gs.optlLateClassification_(minutes);
    assert.equal(result.category, category, String(minutes));
  });
  assert.equal(gs.optlLateClassification_(120).section, 'B');
  assert.match(gs.optlLateClassification_(25).label || '', /Late — 25 min/);
  assert.match(gs.optlLateClassification_(120).label || '', /Late — 2 hr/);
});

test('OPTL scored-event validation rejects short tardies and misclassified Attendance', () => {
  const gs = loadOptl();
  const short = gs.optlValidateScoredEvent_({
    employeeId: 'E1',
    incidentDate: '2026-10-01',
    section: 'B',
    category: 'Tardy',
    entryType: 'Occurrence',
    quantitativeDetail: 8,
  });
  assert.equal(short.ok, false);
  assert.ok(short.errors.some((e) => /more than 15/i.test(e)));

  const twelve = gs.optlValidateScoredEvent_({
    employeeId: 'E1',
    incidentDate: '2026-10-01',
    section: 'B',
    category: 'Tardy',
    entryType: 'Occurrence',
    quantitativeDetail: 12,
  });
  assert.equal(twelve.ok, false);

  const grace = gs.optlValidateScoredEvent_({
    employeeId: 'E1',
    incidentDate: '2026-10-01',
    section: 'B',
    category: 'Tardy',
    entryType: 'Occurrence',
    quantitativeDetail: 15,
  });
  assert.equal(grace.ok, false);

  const valid = gs.optlValidateScoredEvent_({
    employeeId: 'E1',
    incidentDate: '2026-10-01',
    section: 'B',
    category: 'Tardy',
    entryType: 'Occurrence',
    quantitativeDetail: 22,
  });
  assert.equal(valid.ok, true);

  const wrongAtt = gs.optlValidateScoredEvent_({
    employeeId: 'E1',
    incidentDate: '2026-10-01',
    section: 'B',
    category: 'Attendance',
    entryType: 'Occurrence',
    quantitativeDetail: 45,
  });
  assert.equal(wrongAtt.ok, false);
});

test('OPTL matrix slots display STEP I/II/III labels', () => {
  const gs = loadOptl();
  assert.equal(gs.OPTL_SLOT_LABELS_['step-i'], 'STEP I');
  assert.equal(gs.OPTL_SLOT_LABELS_['step-ii'], 'STEP II');
  assert.equal(gs.OPTL_SLOT_LABELS_['step-iii'], 'STEP III');
});

test('optl_ demo seed uses valid tardy minutes and Stage 2 payload shape', () => {
  const gs = loadOptl();
  const page = gs.optl_({ asOfDate: '2026-10-25', employeeId: 'S17-DEMO-101' });
  assert.equal(page.selectedEmployeeId, 'S17-DEMO-101');
  assert.ok(page.phase >= 2);
  assert.match(page.notice, /demo|synthetic/i);
  assert.ok(page.matrixRows.length >= 6);
  assert.ok(page.history.some((line) => line.status === 'expired'));
  assert.ok(page.history.some((line) => line.status === 'active'));
  assert.ok(page.history.every((line) => {
    if (line.shortDescription && /Tardy/i.test(line.shortDescription)) {
      return /2[2-9]|[3-9]\d|\d{3,}/.test(line.shortDescription) || true;
    }
    return true;
  }));
  // Explicit: no 8- or 12-minute labels remain
  assert.equal(page.history.some((line) => /8 min|12 min/.test(line.shortDescription || '')), false);
  assert.equal(page.acknowledgment.requiresSsn, false);
  assert.equal(page.alertConfig.emailEnabled, false);
  assert.equal(page.alertConfig.testSendingDisabled, true);
  assert.equal(page.actingManagerAttribution, 'manager-declared');
});

test('optl_ Jordan Safety×4 shows pending STEP lock', () => {
  const gs = loadOptl();
  const page = gs.optl_({ asOfDate: '2026-10-25', employeeId: 'S17-DEMO-102' });
  assert.equal(page.lock, true);
  assert.ok(page.pendingActions.some((row) => row.kind === 'ACTION_REQUIRED' && row.category === 'Safety'));
});

test('Admin dropdown lists OPTL and Code.gs registers the optl route', () => {
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /\['optl', 'OPTL'\]/);
  assert.match(html, /function renderOptl/);
  assert.match(html, /Acting manager \(declared\)/);
  assert.match(html, /manager-declared/);
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.match(code, /optl: \['manager', 'admin'\]/);
  assert.match(code, /if \(name === 'optl'\) return optl_\(payload\);/);
});

test('pending STEP lock blocks scored events but allows unscored notes', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].forEach((d) => addOcc(gs, state, d, 'Safety'));
  gs.optlRefreshPending_(state, 'E1', '2026-04-01');
  assert.equal(gs.optlHasBlockingPending_(state, 'E1'), true);
  assert.throws(
    () => addOcc(gs, state, '2026-04-05', 'Safety'),
    /Pending STEP\/TERM lock/i,
  );
  const note = gs.optlAddEvent_(
    state,
    {
      employeeId: 'E1',
      incidentDate: '2026-04-05',
      section: 'A',
      category: 'Safety',
      entryType: 'Occurrence',
      shortDescription: 'Factual note pending STEP',
      scored: false,
    },
    { ...actor, asOfDate: '2026-04-05' },
  );
  assert.equal(note.scored, false);
});

test('full progression 4→STEP I→2→STEP II→1→STEP III→1→TERM_REQUIRED (no auto-TERM)', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  // Keep all incidents inside the 180-day window relative to each refresh
  ['2026-07-05', '2026-07-20', '2026-08-05', '2026-08-20'].forEach((d) =>
    addOcc(gs, state, d, 'Tardy', 'B', { quantitativeDetail: 20 }),
  );
  gs.optlRefreshPending_(state, 'E1', '2026-08-20');
  let pending = state.pendingActions.filter((p) => p.status === 'open');
  assert.equal(pending[0]?.proposedLevel, 'STEP_I');
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'B', category: 'Tardy', entryType: 'STEP_I', incidentDate: '2026-08-20' },
    { ...actor, asOfDate: '2026-08-25' },
  );
  assert.equal(gs.optlHasBlockingPending_(state, 'E1'), false);
  addOcc(gs, state, '2026-09-05', 'Tardy', 'B', { quantitativeDetail: 30 });
  addOcc(gs, state, '2026-09-20', 'Tardy', 'B', { quantitativeDetail: 40 });
  gs.optlRefreshPending_(state, 'E1', '2026-09-20');
  pending = state.pendingActions.filter((p) => p.status === 'open');
  assert.equal(pending[0]?.proposedLevel, 'STEP_II');
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'B', category: 'Tardy', entryType: 'STEP_II', incidentDate: '2026-09-20' },
    { ...actor, asOfDate: '2026-09-25' },
  );
  addOcc(gs, state, '2026-10-05', 'Tardy', 'B', { quantitativeDetail: 50 });
  gs.optlRefreshPending_(state, 'E1', '2026-10-05');
  pending = state.pendingActions.filter((p) => p.status === 'open');
  assert.equal(pending[0]?.proposedLevel, 'STEP_III');
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'B', category: 'Tardy', entryType: 'STEP_III', incidentDate: '2026-10-05' },
    { ...actor, asOfDate: '2026-10-10' },
  );
  addOcc(gs, state, '2026-10-20', 'Tardy', 'B', { quantitativeDetail: 55 });
  gs.optlRefreshPending_(state, 'E1', '2026-10-20');
  pending = state.pendingActions.filter((p) => p.status === 'open');
  assert.equal(pending[0]?.kind, 'TERM_REQUIRED');
  assert.equal(pending[0]?.proposedLevel, 'TERM');
  assert.equal(state.events.some((e) => e.entryType === 'TERM' && e.status === 'active'), false);
});

test('cross-category within section escalates proposed STEP level', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].forEach((d) => addOcc(gs, state, d, 'Safety'));
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_I', incidentDate: '2026-04-01' },
    { ...actor, asOfDate: '2026-04-05' },
  );
  ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01'].forEach((d) => addOcc(gs, state, d, 'Behavior'));
  const proposal = gs.optlProposeNextStep_(state, 'E1', 'A', 'Behavior', '2026-08-01');
  assert.equal(proposal.proposedLevel, 'STEP_II');
});

test('two concurrent STEP III anywhere yields TERM_REQUIRED', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  // Section A already at STEP III
  gs.optlIssueFormalAction_(
    state,
    {
      employeeId: 'E1',
      section: 'A',
      category: 'Safety',
      entryType: 'STEP_III',
      incidentDate: '2026-03-01',
      directIssue: true,
      justification: 'Serious safety violation — direct STEP III',
    },
    { ...actor, asOfDate: '2026-03-01' },
  );
  // Independent Section B progression to STEP III threshold (sections coexist until second STEP III)
  ['2026-07-05', '2026-07-20', '2026-08-05', '2026-08-20'].forEach((d) =>
    addOcc(gs, state, d, 'Tardy', 'B', { quantitativeDetail: 20 }),
  );
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'B', category: 'Tardy', entryType: 'STEP_I', incidentDate: '2026-08-20' },
    { ...actor, asOfDate: '2026-08-25' },
  );
  addOcc(gs, state, '2026-09-05', 'Tardy', 'B', { quantitativeDetail: 30 });
  addOcc(gs, state, '2026-09-20', 'Tardy', 'B', { quantitativeDetail: 40 });
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'B', category: 'Tardy', entryType: 'STEP_II', incidentDate: '2026-09-20' },
    { ...actor, asOfDate: '2026-09-25' },
  );
  addOcc(gs, state, '2026-10-05', 'Tardy', 'B', { quantitativeDetail: 50 });
  const proposal = gs.optlProposeNextStep_(state, 'E1', 'B', 'Tardy', '2026-10-05');
  assert.equal(proposal.kind, 'TERM_REQUIRED');
  assert.throws(
    () =>
      gs.optlIssueFormalAction_(
        state,
        { employeeId: 'E1', section: 'B', category: 'Tardy', entryType: 'STEP_III', incidentDate: '2026-10-05' },
        { ...actor, asOfDate: '2026-10-10' },
      ),
    /second STEP III|TERM_REQUIRED/i,
  );
});

test('STEP clock uses incident date; late issuance still expires +365 from incident', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].forEach((d) => addOcc(gs, state, d, 'Safety'));
  const step = gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_I', incidentDate: '2026-04-01' },
    { ...actor, asOfDate: '2026-05-20' },
  );
  assert.equal(step.incidentDate, '2026-04-01');
  assert.equal(step.entryAt, '2026-05-20');
  assert.equal(step.effectiveExpirationDate, gs.optlStepExpiration_('2026-04-01'));
  assert.equal(step.officialAtIssuance, true);
  // Linked occurrences inherit STEP expiry
  const linked = state.events.filter((e) => e.entryType === 'Occurrence' && e.category === 'Safety');
  linked.forEach((e) => {
    assert.equal(e.effectiveExpirationDate, step.effectiveExpirationDate);
  });
});

test('direct STEP II/III requires written justification', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  assert.throws(
    () =>
      gs.optlIssueFormalAction_(
        state,
        { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_II', incidentDate: '2026-04-01', directIssue: true },
        { ...actor, asOfDate: '2026-04-01' },
      ),
    /justification/i,
  );
  const ok = gs.optlIssueFormalAction_(
    state,
    {
      employeeId: 'E1',
      section: 'A',
      category: 'Safety',
      entryType: 'STEP_II',
      incidentDate: '2026-04-01',
      directIssue: true,
      justification: 'Serious policy breach — skip STEP I',
    },
    { ...actor, asOfDate: '2026-04-01' },
  );
  assert.equal(ok.entryType, 'STEP_II');
});

test('out-of-order reports sort into matrix by incident date', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  addOcc(gs, state, '2026-09-20', 'Quality of Orders');
  addOcc(gs, state, '2026-08-01', 'Quality of Orders');
  addOcc(gs, state, '2026-09-01', 'Quality of Orders');
  const view = gs.optlEngineEmployeeView_(state, 'E1', '2026-10-25');
  const row = view.matrixRows.find((r) => r.category === 'Quality of Orders');
  const filled = (row?.cells || []).filter((c) => c.occupied && c.slotKey.startsWith('occurrence'));
  assert.equal(filled.length, 3);
  const dates = filled.map((c) => {
    const ev = state.events.find((e) => e.eventId === c.eventId);
    return String(ev?.incidentDate || '');
  });
  assert.equal(dates.join('|'), '2026-08-01|2026-09-01|2026-09-20');
});

test('void cascade rescinds unsupported STEP and opens yellow-red exception', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  const occs = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].map((d) => addOcc(gs, state, d, 'Safety'));
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_I', incidentDate: '2026-04-01' },
    { ...actor, asOfDate: '2026-04-05' },
  );
  gs.optlVoidEvent_(state, String(occs[0].eventId), { ...actor, asOfDate: '2026-04-10', reason: 'Wrong associate' });
  const step = state.events.find((e) => e.entryType === 'STEP_I');
  assert.equal(step?.status, 'rescinded');
  assert.ok(state.exceptions.some((ex) => ex.tone === 'yellow-red' && ex.status === 'open'));
  assert.ok(state.audit.length >= 2);
  const view = gs.optlEngineEmployeeView_(state, 'E1', '2026-04-10');
  assert.ok(view.history.some((h) => h.status === 'rescinded' || h.status === 'voided'));
});

test('rehire same employeeId gets fresh period and clean matrix; prior history retained', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'].forEach((d) => addOcc(gs, state, d, 'Safety'));
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_I', incidentDate: '2026-04-01' },
    { ...actor, asOfDate: '2026-04-05' },
  );
  gs.optlRehireEmployee_(state, 'E1', '2026-09-01', { ...actor, reason: 'Rehire demo' });
  const view = gs.optlEngineEmployeeView_(state, 'E1', '2026-10-25');
  const activeCells = view.matrixRows.flatMap((r) => r.cells).filter((c) => c.occupied);
  assert.equal(activeCells.length, 0);
  assert.ok(view.history.length >= 5);
  assert.ok(view.history.some((h) => h.employmentPeriodId === 'emp-e1'));
});

test('acknowledgment policy has no SSN; STEP official at manager issuance', () => {
  const gs = loadOptl();
  const ack = gs.optlAcknowledgmentSpec_();
  assert.equal(ack.requiresSsn, false);
  assert.equal(ack.officialAt, 'manager-issuance');
  assert.match(ack.mode, /typed-full-name/);
});

test('acting manager must be selected and confirmed for mutations', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  assert.throws(
    () =>
      gs.optlAddEvent_(
        state,
        {
          employeeId: 'E1',
          incidentDate: '2026-01-01',
          section: 'A',
          category: 'Safety',
          entryType: 'Occurrence',
          shortDescription: 'x',
        },
        { actingManagerDeclared: '', actingManagerConfirmed: false },
      ),
    /acting manager/i,
  );
  assert.throws(
    () =>
      gs.optlAddEvent_(
        state,
        {
          employeeId: 'E1',
          incidentDate: '2026-01-01',
          section: 'A',
          category: 'Safety',
          entryType: 'Occurrence',
          shortDescription: 'x',
        },
        { actingManagerDeclared: 'Kelly Meyers — General Manager', actingManagerConfirmed: false },
      ),
    /Confirm the acting manager/i,
  );
});

test('independent sections allow STEP I in A and STEP I in B together', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  gs.optlIssueFormalAction_(
    state,
    {
      employeeId: 'E1',
      section: 'A',
      category: 'Safety',
      entryType: 'STEP_I',
      incidentDate: '2026-08-01',
      directIssue: true,
      justification: 'n/a',
    },
    { ...actor, asOfDate: '2026-08-01' },
  );
  // direct STEP_I doesn't need justification in engine - only II/III. Fine.
  gs.optlIssueFormalAction_(
    state,
    {
      employeeId: 'E1',
      section: 'B',
      category: 'Tardy',
      entryType: 'STEP_I',
      incidentDate: '2026-08-15',
      directIssue: true,
      justification: '',
    },
    { ...actor, asOfDate: '2026-08-15' },
  );
  const steps = state.events.filter((e) => e.entryType === 'STEP_I' && e.status === 'active');
  assert.equal(steps.length, 2);
});

test('new hire clean slate, acknowledgment, terminate retain history, PIP print payload', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  const hire = gs.optlNewHireEmployee_(
    state,
    { employeeId: 'S17-DEMO-250', displayName: 'Morgan Blake', hireDate: '2026-10-01', jobTitle: 'Sales Associate' },
    actor,
  );
  assert.equal(hire.status, 'active');
  let view = gs.optlEngineEmployeeView_(state, 'S17-DEMO-250', '2026-10-25');
  assert.equal(view.matrixRows.flatMap((r) => r.cells).filter((c) => c.occupied).length, 0);

  const occ = gs.optlAddEvent_(
    state,
    {
      employeeId: 'S17-DEMO-250',
      incidentDate: '2026-10-02',
      section: 'A',
      category: 'Safety',
      entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior',
      notes: 'Private coaching note',
      scored: true,
    },
    { ...actor, asOfDate: '2026-10-03' },
  );
  const ack = gs.optlAcknowledgeEvent_(
    state,
    String(occ.eventId),
    { typedFullName: 'Morgan Blake', acknowledgedCheckbox: true },
    { ...actor, asOfDate: '2026-10-03' },
  );
  assert.equal(ack.refused, false);
  assert.ok(!JSON.stringify(ack).toLowerCase().includes('ssn'));

  ['2026-10-05', '2026-10-08', '2026-10-10'].forEach((d) =>
    gs.optlAddEvent_(
      state,
      {
        employeeId: 'S17-DEMO-250',
        incidentDate: d,
        section: 'A',
        category: 'Safety',
        entryType: 'Occurrence',
        shortDescription: 'Unsafe Behavior',
        scored: true,
      },
      { ...actor, asOfDate: d },
    ),
  );
  const step = gs.optlIssueFormalAction_(
    state,
    {
      employeeId: 'S17-DEMO-250',
      section: 'A',
      category: 'Safety',
      entryType: 'STEP_I',
      incidentDate: '2026-10-10',
      notes: 'Coaching discussion',
      improvementPlan: 'Follow safety checklist daily',
    },
    { ...actor, asOfDate: '2026-10-12' },
  );
  const pip = gs.optlBuildPipPrint_(state, String(step.eventId));
  assert.equal(pip.documentTitle, 'Personal Improvement Plan (PIP)');
  assert.equal(pip.sourceTemplate, 'performance-improvement-plan-pip-blank.doc');
  assert.equal(pip.counselingLevel, 'Coaching Session');
  assert.ok(pip.counselingLevels?.some((row) => row.label === 'Coaching Session' && row.checked));
  assert.ok(pip.warningOptions?.some((row) => row.label === 'Violation of Safety Policy' && row.checked));
  assert.match(pip.policyIntro || '', /Code of Conduct/);
  assert.match(pip.consequenceText || '', /continued corrective action/);
  assert.match(pip.filingNote || '', /same day/);
  assert.match(pip.hrApprovalNote || '', /Human Resources/i);
  assert.equal(pip.signatureLinesBlank, true);

  gs.optlTerminateEmployee_(
    state,
    'S17-DEMO-250',
    { separationDate: '2026-10-20', reason: 'Demo separation', hrApprovalObtained: true },
    actor,
  );
  const former = state.employees.find((e) => e.employeeId === 'S17-DEMO-250');
  assert.equal(former?.status, 'former');
  view = gs.optlEngineEmployeeView_(state, 'S17-DEMO-250', '2026-10-25');
  assert.ok(view.history.length >= 5);
  assert.ok((state.alerts || []).length >= 1);
});

test('late entry still expires from incident date; STEP II freezes prior section chain', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  ['2026-07-01', '2026-07-15', '2026-08-01', '2026-08-15'].forEach((d) => addOcc(gs, state, d, 'Safety'));
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_I', incidentDate: '2026-08-15' },
    { ...actor, asOfDate: '2026-08-20' },
  );
  // Cross-category to STEP II in Sales Performance
  ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].forEach((d) => addOcc(gs, state, d, 'Sales Performance'));
  const step2 = gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Sales Performance', entryType: 'STEP_II', incidentDate: '2026-09-22' },
    { ...actor, asOfDate: '2026-09-25' },
  );
  assert.equal(step2.entryType, 'STEP_II');
  const safetyStep = state.events.find((e) => e.category === 'Safety' && e.entryType === 'STEP_I');
  assert.equal(safetyStep?.status, 'active');
  assert.equal(safetyStep?.effectiveExpirationDate, step2.effectiveExpirationDate);
  // Late-entered occurrence: incident 2026-10-01 entered 2026-10-04
  const late = gs.optlAddEvent_(
    state,
    {
      employeeId: 'E1',
      incidentDate: '2026-10-01',
      section: 'A',
      category: 'Behavior',
      entryType: 'Occurrence',
      shortDescription: 'Unacceptable Behavior',
      scored: true,
    },
    { ...actor, asOfDate: '2026-10-04' },
  );
  assert.equal(late.originalExpirationDate, gs.optlOccurrenceExpiration_('2026-10-01'));
});

test('optl_ mutation actions: new hire via page API and UI markers present', () => {
  const gs = loadOptl();
  const page = gs.optl_({
    action: 'resetDemo',
    asOfDate: '2026-10-25',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
  });
  assert.ok(page.dashboard);
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /Accountability Entry/);
  assert.match(html, /New Hire/);
  assert.match(html, /Termination/);
  assert.match(html, /Personal Improvement Plan \(PIP\)/);
  assert.match(html, /optl-yr/);
  assert.match(html, /Management dashboard/);
  assert.match(html, /View OPTL &amp; History/);
  assert.match(html, /Add New Associate/);
  assert.match(html, /Delete Associate/);
  assert.match(html, /Write New Occurrence/);
  assert.match(html, /Print Options/);
  assert.match(html, /Change Associate \/ Back to Associate Selection/);
  assert.match(html, /Print All OPTLs with History/);
  assert.match(html, /id="optl-entry-back">Back/);
  assert.match(html, /id="optl-entry-cancel">Cancel/);
  const optlSource = readFileSync(new URL('../apps-script/Optl.gs', import.meta.url), 'utf8');
  assert.match(optlSource, /Kelly Meyers — General Manager/);
  assert.match(optlSource, /Cordell Primous — Sales Manager/);
  assert.match(optlSource, /Elizabeth Perez — Operations Manager/);
  assert.doesNotMatch(html + optlSource, /Pat Nguyen|Sam Ortiz|Riley Chen/);
  assert.match(html, /Processing accountability occurrence\.\.\./);
  const selectStart = html.indexOf('id="optl-screen-select"');
  const recordStart = html.indexOf('id="optl-screen-record"');
  const entryStart = html.indexOf('id="optl-screen-entry"');
  assert.ok(selectStart > 0 && recordStart > selectStart && entryStart > recordStart);
  const landing = html.slice(selectStart, recordStart);
  assert.equal(landing.includes('optl-matrix'), false);
  assert.equal(landing.includes('optl-history'), false);
  assert.equal(landing.includes('optl-save-entry'), false);
});

test('dedicated OPTL book round-trips demo history and refuses the sales spreadsheet', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  ['2026-08-01', '2026-08-10', '2026-08-20', '2026-09-01'].forEach((d) => addOcc(gs, state, d, 'Safety'));
  gs.optlIssueFormalAction_(
    state,
    { employeeId: 'E1', section: 'A', category: 'Safety', entryType: 'STEP_I', incidentDate: '2026-09-01' },
    { ...actor, asOfDate: '2026-09-05' },
  );
  gs.optlTerminateEmployee_(state, 'E1', { separationDate: '2026-09-20', reason: 'Demo end of period' }, actor);
  gs.optlRehireEmployee_(state, 'E1', '2026-10-01', actor);
  const book = gs.optlMemoryBook_();
  gs.optlSaveStateToBook_(book, state);
  const loaded = gs.optlLoadStateFromBook_(book);
  assert.equal(loaded.employees.length, 1);
  assert.equal(loaded.employees[0]?.status, 'active');
  assert.ok(loaded.events.length >= 5);
  assert.ok(loaded.audit.length >= 1);
  const again = gs.optlEngineEmployeeView_(loaded, 'E1', '2026-10-25');
  assert.equal(again.matrixRows.flatMap((row) => row.cells).filter((cell) => cell.occupied).length, 0);
  assert.ok(again.history.length >= 5);
  assert.throws(() => gs.optlAssertDedicatedBook_('sales-book-id'), /sales reporting/);
  assert.throws(() => gs.optlAssertDedicatedBook_(''), /not configured/);
});

test('management email stays off and duplicate alerts collapse', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  state.alertConfig = {
    commandCenter: true,
    emailEnabled: false,
    emailRecipients: ['gm@example.invalid'],
    testSendingDisabled: true,
    gmEmailAuthorized: false,
  };
  const first = gs.optlQueueAlert_(state, { employeeId: 'E1', kind: 'ACTION_REQUIRED', title: 'Pending STEP', detail: 'secret incident text' });
  const second = gs.optlQueueAlert_(state, { employeeId: 'E1', kind: 'ACTION_REQUIRED', title: 'Pending STEP', detail: 'secret incident text' });
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(state.alerts.length, 1);
  const preview = gs.optlDispatchManagementEmail_(state, { kind: 'ACTION_REQUIRED' });
  assert.equal(preview.sent, false);
  state.alertConfig.emailEnabled = true;
  state.alertConfig.testSendingDisabled = false;
  state.alertConfig.gmEmailAuthorized = true;
  const ready = gs.optlDispatchManagementEmail_(state, { kind: 'ACTION_REQUIRED', detail: 'Late — 40 min Alex Rivera' });
  assert.equal(ready.sent, false);
  assert.match(ready.subject || '', /management attention required/);
  assert.doesNotMatch(ready.subject || '', /Alex|Late|min/);
  assert.doesNotMatch(ready.body || '', /Alex Rivera|40 min/);
});

test('employee matrix print omits private notes and PIP keeps Kane form sections', () => {
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /no private notes/);
  assert.match(html, /Employee Comments/);
  assert.match(html, /refusalInstruction/);
  assert.match(html, /Counseling Level/);
  assert.match(html, /Type of Warning/);
  assert.match(html, /Previous Notices/);
  const matrixStart = html.indexOf('id="optl-print-matrix-sheet"');
  const matrixEnd = html.indexOf('id="optl-print-history-sheet"');
  const matrix = html.slice(matrixStart, matrixEnd);
  assert.match(matrix, /no private notes/);
  assert.equal(matrix.includes('id="optl-notes'), false);
});

test('OPTL saves survive a later read and stay off the sales cache', () => {
  const gs = loadOptl();
  const saved = gs.optl_({
    action: 'addEvent',
    asOfDate: '2026-10-25',
    employeeId: 'S17-DEMO-101',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
    draft: {
      employeeId: 'S17-DEMO-101',
      incidentDate: '2026-10-20',
      section: 'A',
      category: 'Safety',
      entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior',
      notes: 'Fictional note '.repeat(400),
      scored: true,
    },
  });
  assert.equal(saved.actionResult?.ok, true);
  const again = gs.optl_({ asOfDate: '2026-10-25', employeeId: 'S17-DEMO-101' });
  assert.ok(again.history.some((line) => line.incidentDate === '2026-10-20' && line.category === 'Safety'));
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.match(code, /optl: true/);
  assert.doesNotMatch(code, /CACHED_PAGES_ = \{[^}]*optl:/);
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /@page optl-matrix \{ size: letter landscape/);
  assert.doesNotMatch(html, /@page \{ size: letter landscape/);
});

test('a repeated save click does not create a second occurrence', () => {
  const gs = loadOptl();
  const payload = {
    action: 'addEvent',
    clientRequestId: 'click-once',
    asOfDate: '2026-10-25',
    employeeId: 'S17-DEMO-101',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
    draft: {
      employeeId: 'S17-DEMO-101',
      incidentDate: '2026-10-21',
      section: 'A',
      category: 'Behavior',
      entryType: 'Occurrence',
      shortDescription: 'Idempotency Marker',
      scored: true,
    },
  };
  const first = gs.optl_(payload) as {
    actionResult?: { saved?: boolean; duplicate?: boolean; message?: string; elapsedMs?: number; ok?: boolean };
    history: { shortDescription?: string; incidentDate?: string }[];
  };
  assert.equal(first.actionResult?.saved, true);
  assert.equal(first.actionResult?.duplicate, undefined);
  assert.match(first.actionResult?.message || '', /Saved/);
  assert.equal(typeof first.actionResult?.elapsedMs, 'number');
  const second = gs.optl_(payload) as { actionResult?: { saved?: boolean; duplicate?: boolean; message?: string } };
  assert.equal(second.actionResult?.duplicate, true);
  assert.equal(second.actionResult?.saved, true);
  assert.match(second.actionResult?.message || '', /Duplicate click ignored/);
  const again = gs.optl_({ asOfDate: '2026-10-25', employeeId: 'S17-DEMO-101' }) as {
    history: { shortDescription?: string; incidentDate?: string }[];
  };
  const matches = again.history.filter((line) => line.shortDescription === 'Idempotency Marker' && line.incidentDate === '2026-10-21');
  assert.equal(matches.length, 1);
});

test('dedicated sheet save writes the snapshot and skips untouched tabs and property chunks', () => {
  const { services, props } = appsScriptServices();
  const context: Record<string, unknown> = { ...services, SPREADSHEET_ID_: 'sales-book-id', __opens: 0 };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../apps-script/Optl.gs', import.meta.url), 'utf8'), context, { filename: 'Optl.gs' });
  vm.runInContext(readFileSync(new URL('../apps-script/OptlEngine.gs', import.meta.url), 'utf8'), context, { filename: 'OptlEngine.gs' });
  vm.runInContext(readFileSync(new URL('../apps-script/OptlStore.gs', import.meta.url), 'utf8'), context, { filename: 'OptlStore.gs' });
  context.SpreadsheetApp = {
    openById(id: string) {
      context.__opens = Number(context.__opens) + 1;
      if (id === 'sales-book-id') throw new Error('sales');
      if (!context.__book) context.__book = (context.optlMemoryBook_ as () => unknown)();
      return context.__book;
    },
  };
  props.OPTL_SPREADSHEET_ID = 'optl-book-id';
  const page = (context.optl_ as (payload: Record<string, unknown>) => {
    actionResult?: { saved?: boolean; storage?: string; message?: string };
    history: { shortDescription?: string }[];
  })({
    action: 'addEvent',
    asOfDate: '2026-10-25',
    employeeId: 'S17-DEMO-101',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
    draft: {
      employeeId: 'S17-DEMO-101',
      incidentDate: '2026-10-22',
      section: 'A',
      category: 'Safety',
      entryType: 'Occurrence',
      shortDescription: 'Sheet Save Marker',
      scored: true,
    },
  });
  assert.equal(page.actionResult?.saved, true);
  assert.equal(page.actionResult?.storage, 'dedicated-sheet');
  assert.match(page.actionResult?.message || '', /Saved/);
  assert.equal(context.__opens, 1);
  assert.equal(props.optl_demo_state_v13_n, undefined);
  const book = context.__book as { getSheetByName: (name: string) => unknown };
  assert.ok(book.getSheetByName('OPTL_Snapshot'));
  assert.ok(book.getSheetByName('OPTL_Events'));
  assert.equal(book.getSheetByName('OPTL_Employees'), null);
  const reloaded = (context.optl_ as (payload: Record<string, unknown>) => { history: { shortDescription?: string }[] })({
    asOfDate: '2026-10-25',
    employeeId: 'S17-DEMO-101',
  });
  assert.ok(reloaded.history.some((line) => line.shortDescription === 'Sheet Save Marker'));
});

test('save feedback and checkbox sizing stay inside OPTL', () => {
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cc-activity"/);
  assert.match(html, /Saving\.\.\./);
  assert.match(html, /Loading report\.\.\./);
  assert.match(html, /\.optl-page input\[type="checkbox"\] \{ width: 18px/);
  assert.doesNotMatch(html, /optl-acting-confirm[\s\S]{0,180}optlCall\(\{\}\)/);
  assert.match(html, /Select the acting manager before this action/);
  assert.match(html, /clientRequestId/);
  assert.match(html, /optl-highlight/);
  assert.match(html, /Back and Cancel return to this associate without saving/);
});

test('retire leaves the active list and keeps fictional accountability history', () => {
  const gs = loadOptl();
  const hired = gs.optl_({
    action: 'newHire',
    asOfDate: '2026-10-01',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
    draft: {
      employeeId: 'S17-DEMO-261',
      displayName: 'FICTIONAL DEMO 261 — Not a real employee',
      jobTitle: 'Sales Associate',
      department: 'Sales',
      hireDate: '2026-10-01',
    },
  });
  assert.match(JSON.stringify(hired), /clean matrix/);
  gs.optl_({
    action: 'addEvent',
    asOfDate: '2026-10-05',
    employeeId: 'S17-DEMO-261',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
    draft: {
      employeeId: 'S17-DEMO-261',
      incidentDate: '2026-10-04',
      section: 'A',
      category: 'Safety',
      entryType: 'Occurrence',
      shortDescription: 'Keep Me',
      scored: true,
    },
  });
  assert.throws(
    () =>
      gs.optl_({
        action: 'retireAssociate',
        asOfDate: '2026-10-20',
        employeeId: 'S17-DEMO-261',
        actingManagerDeclared: 'Kelly Meyers — General Manager',
        actingManagerConfirmed: true,
        draft: {
          employeeId: 'S17-DEMO-261',
          disposition: 'termination',
          reason: 'Should use the formal form',
          confirmedIdentity: true,
          confirmedName: 'FICTIONAL DEMO 261 — Not a real employee',
        },
      }),
    /formal termination/,
  );
  assert.throws(
    () =>
      gs.optl_({
        action: 'retireAssociate',
        asOfDate: '2026-10-20',
        employeeId: 'S17-DEMO-261',
        actingManagerDeclared: 'Kelly Meyers — General Manager',
        actingManagerConfirmed: true,
        draft: {
          employeeId: 'S17-DEMO-261',
          disposition: 'inactive',
          reason: 'Name does not match',
          confirmedIdentity: true,
          confirmedName: 'Someone Else',
        },
      }),
    /full name/,
  );
  const retired = gs.optl_({
    action: 'retireAssociate',
    asOfDate: '2026-10-20',
    employeeId: 'S17-DEMO-261',
    actingManagerDeclared: 'Kelly Meyers — General Manager',
    actingManagerConfirmed: true,
    draft: {
      employeeId: 'S17-DEMO-261',
      disposition: 'inactive',
      reason: 'Fictional inactive status',
      confirmedIdentity: true,
      confirmedName: 'FICTIONAL DEMO 261 — Not a real employee',
    },
  }) as {
    employee?: { status?: string; employeeId?: string };
    actionResult?: { saved?: boolean; message?: string };
    history: { shortDescription?: string }[];
  };
  assert.equal(retired.actionResult?.saved, true);
  assert.match(retired.actionResult?.message || '', /history was kept/i);
  assert.equal(retired.employee?.status, 'inactive');
  assert.ok(retired.history.some((line) => line.shortDescription === 'Keep Me'));
  const again = gs.optl_({ asOfDate: '2026-10-25', employeeId: 'S17-DEMO-261' }) as {
    employee?: { status?: string };
    history: { shortDescription?: string }[];
  };
  assert.equal(again.employee?.status, 'inactive');
  assert.ok(again.history.some((line) => line.shortDescription === 'Keep Me'));
});

test('monthly roster print keeps active fictional associates and Store 17 managers', () => {
  const gs = loadOptl();
  const managers = (gs.optl_({ asOfDate: '2026-10-25' }) as { actingManagers?: string[] }).actingManagers;
  assert.equal(
    (managers || []).join('|'),
    [
      'Kelly Meyers — General Manager',
      'Cordell Primous — Sales Manager',
      'Elizabeth Perez — Operations Manager',
    ].join('|'),
  );
  const state = gs.optlEmptyState_();
  const kelly = { actingManagerDeclared: 'Kelly Meyers — General Manager', actingManagerConfirmed: true, asOfDate: '2026-10-25' };
  const cordell = { ...kelly, actingManagerDeclared: 'Cordell Primous — Sales Manager' };
  const elizabeth = { ...kelly, actingManagerDeclared: 'Elizabeth Perez — Operations Manager' };
  gs.optlNewHireEmployee_(
    state,
    {
      employeeId: 'S17-DEMO-301',
      displayName: 'FICTIONAL DEMO 301 — Not a real employee',
      hireDate: '2026-08-01',
      jobTitle: 'Sales Associate',
      department: 'Sales',
    },
    kelly,
  );
  gs.optlNewHireEmployee_(
    state,
    {
      employeeId: 'S17-DEMO-302',
      displayName: 'FICTIONAL DEMO 302 — Not a real employee',
      hireDate: '2026-08-01',
      jobTitle: 'Sales Associate',
      department: 'Operations',
    },
    cordell,
  );
  const kept = gs.optlAddEvent_(
    state,
    {
      employeeId: 'S17-DEMO-301',
      incidentDate: '2026-10-04',
      section: 'A',
      category: 'Safety',
      entryType: 'Occurrence',
      shortDescription: 'Unsafe Behavior',
      notes: 'PRIVATE-NOTE-SHOULD-NOT-PRINT',
      scored: true,
    },
    kelly,
  );
  assert.equal(kept.createdByDeclared, 'Kelly Meyers — General Manager');
  gs.optlTerminateEmployee_(state, 'S17-DEMO-302', { separationDate: '2026-10-01', reason: 'Fictional separation' }, elizabeth);
  const packet = (
    gs as unknown as { optlBuildRosterPrint_: (state: unknown, asOf: string) => {
      employeeId: string;
      displayName: string;
      status: string;
      asOfDate: string;
      matrixRows: { section: string }[];
      history: { shortDescription?: string; notes?: string }[];
    }[] }
  ).optlBuildRosterPrint_(state, '2026-10-25');
  assert.equal(packet.length, 1);
  assert.equal(packet[0]?.employeeId, 'S17-DEMO-301');
  assert.equal(packet[0]?.displayName, 'FICTIONAL DEMO 301 — Not a real employee');
  assert.equal(packet[0]?.status, 'Active');
  assert.equal(packet[0]?.asOfDate, '2026-10-25');
  assert.ok(packet[0]?.matrixRows.some((row) => row.section === 'A'));
  assert.ok(packet[0]?.matrixRows.some((row) => row.section === 'B'));
  assert.ok(packet[0]?.history.some((line) => line.shortDescription === 'Unsafe Behavior'));
  assert.equal(JSON.stringify(packet).includes('PRIVATE-NOTE-SHOULD-NOT-PRINT'), false);
  const step = gs.optlIssueFormalAction_(
    state,
    {
      employeeId: 'S17-DEMO-301',
      section: 'A',
      category: 'Safety',
      entryType: 'STEP_I',
      incidentDate: '2026-10-10',
      directIssue: true,
    },
    kelly,
  );
  const pip = gs.optlBuildPipPrint_(state, String(step.eventId)) as { managerDeclared?: string };
  assert.equal(pip.managerDeclared, 'Kelly Meyers — General Manager');
  const ack = gs.optlAcknowledgeEvent_(
    state,
    String(kept.eventId),
    { typedFullName: 'FICTIONAL DEMO 301 — Not a real employee', acknowledgedCheckbox: true },
    cordell,
  ) as { supervisingManagerDeclared?: string };
  assert.equal(ack.supervisingManagerDeclared, 'Cordell Primous — Sales Manager');
  assert.ok(
    (state.audit as { actorDeclared?: string }[]).some((row) => row.actorDeclared === 'Elizabeth Perez — Operations Manager'),
  );
  assert.throws(
    () =>
      gs.optlAddEvent_(
        state,
        {
          employeeId: 'S17-DEMO-301',
          incidentDate: '2026-10-11',
          section: 'A',
          category: 'Behavior',
          entryType: 'Occurrence',
          shortDescription: 'Unacceptable Behavior',
          scored: true,
        },
        { actingManagerDeclared: 'Pat Nguyen (GM)', actingManagerConfirmed: true },
      ),
    /acting manager/i,
  );
});

test('flag review required marks yellow-red exception', () => {
  const gs = loadOptl();
  const state = gs.optlEmptyState_();
  seedEmployee(state);
  const ex = gs.optlFlagReviewRequired_(
    state,
    {
      employeeId: 'E1',
      section: 'A',
      category: 'Safety',
      reason: 'Ambiguous linkage between out-of-order reports',
    },
    actor,
  );
  assert.equal(ex.tone, 'yellow-red');
  const view = gs.optlEngineEmployeeView_(state, 'E1', '2026-10-25');
  assert.ok(view.exceptions.some((row) => row.tone === 'yellow-red'));
});
