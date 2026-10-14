import assert from 'node:assert/strict';
import test from 'node:test';
import { payrollPeriod, storeOperatingPeriod } from '../config/periods.ts';
import { buildPerqPanel, type PerqEvidence } from './perqReference.ts';

const evidence: PerqEvidence = {
  snapshotMetadata: [
    {
      id: 'month-person',
      filter_start: '2026-10-01',
      filter_end: '2026-10-31',
      report_level: 'employee',
      reported_total: 12,
      source: 'person.png',
      source_run_time: 'UNKNOWN',
      coverage: 'interim',
      location: 'Store 17',
      measure: 'Ups + Be Backs',
      is_final_month_end: false,
    },
    {
      id: 'month-location',
      filter_start: '2026-10-01',
      filter_end: '2026-10-31',
      report_level: 'location',
      reported_total: 12,
      source: 'location.png',
      source_run_time: 'UNKNOWN',
      coverage: 'interim',
      location: 'Store 17',
      measure: 'Ups + Be Backs',
      is_final_month_end: false,
    },
    {
      id: 'window-person',
      filter_start: '2026-10-02',
      filter_end: '2026-10-31',
      report_level: 'employee',
      reported_total: 10,
      source: 'window-person.png',
      source_run_time: 'UNKNOWN',
      coverage: 'interim',
      location: 'Store 17',
      measure: 'Ups + Be Backs',
      is_final_month_end: false,
    },
    {
      id: 'window-location',
      filter_start: '2026-10-02',
      filter_end: '2026-10-31',
      report_level: 'location',
      reported_total: 10,
      source: 'window-location.png',
      source_run_time: 'UNKNOWN',
      coverage: 'interim',
      location: 'Store 17',
      measure: 'Ups + Be Backs',
      is_final_month_end: false,
    },
  ],
  employeeSnapshotRows: [
    row('month-person', 'EMON0904', 'Eric', 'Montes', 6),
    row('month-person', 'TNASSI', 'Ricky', 'Nassif', 6),
    row('window-person', 'EMON0904', 'Eric', 'Montes', 6),
    row('window-person', 'TNASSI', 'Ricky', 'Nassif', 4),
  ],
};

function row(snapshotId: string, code: string, first: string, last: string, opportunities: number) {
  return {
    snapshot_id: snapshotId,
    filter_start: snapshotId.startsWith('month') ? '2026-10-01' : '2026-10-02',
    filter_end: '2026-10-31',
    employee_code: code,
    display_first: first,
    display_last: last,
    role_at_snapshot: 'associate',
    ups_plus_be_backs: opportunities,
    source_screenshot: 'test.png',
    printed_generated_at: 'UNKNOWN',
    is_single_day: false,
  };
}

test('overlapping PERQ snapshots stay separate and do not become an October 1 daily row', () => {
  const panel = buildPerqPanel(
    evidence,
    [],
    { start: storeOperatingPeriod.start, end: storeOperatingPeriod.end },
    { start: payrollPeriod.start, end: payrollPeriod.end },
    { periodStart: '2026-10-02', periodEnd: '2026-10-11' },
  );
  assert.deepEqual(
    panel.windows.map((window) => window.opportunities),
    [12, 12, 10, 10],
  );
  const ricky = panel.team.find((member) => member.id === 'TNASSI');
  assert.equal(ricky?.opportunities, 6);
  assert.match(ricky?.boundaryNote ?? '', /not an October 1 daily record/);
  assert.match(panel.flags.join(' '), /not stored as daily PERQ records/);
  assert.match(panel.flags.join(' '), /not subtracted into daily opportunities/);
});
