import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { payrollPeriod, storeOperatingPeriod } from '../src/config/periods.ts';
import { validateReference } from '../src/reference/perqReference.ts';
import { perqReferencePath, loadVerifiedPerq } from './perqReference.ts';

test('the verified PERQ file reconciles and leaves November 1 open', () => {
  const file = perqReferencePath();
  if (!existsSync(file)) return;
  const loaded = loadVerifiedPerq('/workspace');
  assert.equal(loaded.issues.length, 0);
  assert.ok(loaded.reference);
  assert.deepEqual(validateReference(loaded.reference), []);
  const window = loaded.reference.snapshots.find(
    (snapshot) => snapshot.periodStart === '2026-10-02' && snapshot.periodEnd === '2026-10-31',
  );
  const month = loaded.reference.snapshots.find(
    (snapshot) => snapshot.periodStart === payrollPeriod.start && snapshot.periodEnd === payrollPeriod.end,
  );
  assert.ok(window);
  assert.ok(month);
  const lineTotal = window.lines.reduce((total, line) => total + line.opportunities, 0);
  const additions = month.additions.reduce((total, line) => total + line.opportunities, 0);
  assert.equal(lineTotal, window.opportunities);
  assert.equal(window.opportunities + additions, month.opportunities);
  assert.equal(window.periodEnd < storeOperatingPeriod.end, true);
  assert.equal(
    loaded.reference.snapshots.some(
      (snapshot) => snapshot.periodStart === storeOperatingPeriod.start && snapshot.periodEnd === storeOperatingPeriod.end,
    ),
    false,
  );
});
