import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { storeOperatingPeriod } from '../src/config/periods.ts';
import { validateReference } from '../src/reference/perqReference.ts';
import { loadVerifiedPerq, perqReferencePath } from './perqReference.ts';

test('the packaged PERQ snapshots reconcile inside each filter and leave November 1 open', () => {
  const file = perqReferencePath();
  if (!existsSync(file)) return;
  const loaded = loadVerifiedPerq('/workspace');
  assert.ok(loaded.reference);
  assert.equal(loaded.reference.employeeSnapshotRows.some((row) => row.employee_code === 'CPR10909'), false);
  assert.equal(loaded.reference.employeeSnapshotRows.some((row) => row.employee_code === 'CPRI0909'), true);
  assert.equal(loaded.issues.join(' ').includes('CPR10909'), false);
  const evidence = loaded.reference;
  for (const snapshot of evidence.snapshotMetadata) {
    assert.equal(snapshot.source_run_time, 'UNKNOWN');
    assert.equal(snapshot.is_final_month_end, false);
    if (snapshot.report_level === 'employee') {
      const rows = evidence.employeeSnapshotRows.filter((row) => row.snapshot_id === snapshot.id);
      const sum = rows.reduce((total, row) => total + row.ups_plus_be_backs, 0);
      assert.equal(sum, snapshot.reported_total);
      assert.equal(rows.every((row) => row.is_single_day === false), true);
    }
    const twin = evidence.snapshotMetadata.find(
      (other) =>
        other.report_level !== snapshot.report_level &&
        other.filter_start === snapshot.filter_start &&
        other.filter_end === snapshot.filter_end,
    );
    if (twin) assert.equal(twin.reported_total, snapshot.reported_total);
  }
  assert.equal(
    evidence.snapshotMetadata.some(
      (snapshot) => snapshot.filter_start === storeOperatingPeriod.start && snapshot.filter_end === storeOperatingPeriod.end,
    ),
    false,
  );
  assert.deepEqual(validateReference(evidence), []);
});
