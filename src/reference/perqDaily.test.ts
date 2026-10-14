import assert from 'node:assert/strict';
import test from 'node:test';
import { placePerqDaily, type PerqDailyObservation } from './perqDaily.ts';

function row(overrides: Partial<PerqDailyObservation>): PerqDailyObservation {
  return {
    date: '2026-10-07',
    level: 'location',
    employeeCode: null,
    opportunities: 8,
    sha256: 'aaa',
    generatedAt: '2026-10-08T06:00',
    importedAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  };
}

test('a location report and an employee report for the same day both stay', () => {
  const first = placePerqDaily([], row({}));
  const second = placePerqDaily(first.current, row({ level: 'employee', employeeCode: 'TNASSI', sha256: 'bbb', opportunities: 3 }));
  assert.equal(second.current.length, 2);
  assert.equal(second.log.severity, 'accepted');
});

test('the same daily file is not added twice', () => {
  const first = placePerqDaily([], row({}));
  const second = placePerqDaily(first.current, row({}));
  assert.equal(second.current.length, 1);
  assert.equal(second.log.severity, 'duplicate');
});

test('a later run time corrects the daily row and a missing run time does not', () => {
  const first = placePerqDaily([], row({}));
  const corrected = placePerqDaily(first.current, row({ sha256: 'ccc', opportunities: 9, generatedAt: '2026-10-08T18:00' }));
  assert.equal(corrected.log.severity, 'correction');
  assert.equal(corrected.current[0]?.opportunities, 9);
  const held = placePerqDaily(corrected.current, row({ sha256: 'ddd', opportunities: 4, generatedAt: null }));
  assert.equal(held.log.severity, 'needs-review');
  assert.equal(held.current[0]?.opportunities, 9);
});
