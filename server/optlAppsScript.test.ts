/**
 * OPTL Phase 1: unlinked occurrence expiration and Admin-route wiring.
 * Demo records only — no sales sheet writes.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { appsScriptServices } from './appsScriptServices.ts';

function loadOptl() {
  const { services } = appsScriptServices();
  const context: Record<string, unknown> = { ...services };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../apps-script/Optl.gs', import.meta.url), 'utf8'), context, {
    filename: 'Optl.gs',
  });
  return context as {
    optlAddCalendarDays_: (iso: string, days: number) => string;
    optlOccurrenceExpiration_: (iso: string) => string;
    optlUnlinkedActive_: (incident: string, asOf: string, exp?: string) => boolean;
    optlLateClassification_: (minutes: number) => {
      category: string | null;
      section: string | null;
      label: string | null;
      reason: string;
    };
    OPTL_SLOT_LABELS_: Record<string, string>;
    optlCategoryView_: (
      events: unknown[],
      section: string,
      category: string,
      asOf: string,
    ) => { active: { eventId: string; slotKey: string; incidentDate: string }[]; expired: { eventId: string }[] };
    optl_: (payload: Record<string, unknown>) => {
      selectedEmployeeId: string;
      matrixRows: unknown[];
      history: { status: string; eventId: string }[];
      notice: string;
    };
  };
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

test('OPTL matrix slots display STEP I/II/III labels', () => {
  const gs = loadOptl();
  assert.equal(gs.OPTL_SLOT_LABELS_['step-i'], 'STEP I');
  assert.equal(gs.OPTL_SLOT_LABELS_['step-ii'], 'STEP II');
  assert.equal(gs.OPTL_SLOT_LABELS_['step-iii'], 'STEP III');
});

test('optl_ returns the demo associate matrix without touching sales routes', () => {
  const gs = loadOptl();
  const page = gs.optl_({ asOfDate: '2026-10-25', employeeId: 'S17-DEMO-101' });
  assert.equal(page.selectedEmployeeId, 'S17-DEMO-101');
  assert.match(page.notice, /demo/i);
  assert.ok(page.matrixRows.length >= 6);
  assert.ok(page.history.some((line) => line.status === 'expired'));
  assert.ok(page.history.some((line) => line.status === 'active'));
});

test('Admin dropdown lists OPTL and Code.gs registers the optl route', () => {
  const html = readFileSync(new URL('../apps-script/Index.html', import.meta.url), 'utf8');
  assert.match(html, /\['optl', 'OPTL'\]/);
  assert.match(html, /function renderOptl/);
  const code = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  assert.match(code, /optl: \['manager', 'admin'\]/);
  assert.match(code, /if \(name === 'optl'\) return optl_\(payload\);/);
});
