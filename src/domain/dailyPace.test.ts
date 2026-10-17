import assert from 'node:assert/strict';
import test from 'node:test';
import { evenDailyPace, goalPerformance, paceAdjustment, savedDailyPace } from './dailyPace.ts';

test('yesterday uses the pace saved for that day, not today\'s recalculation', () => {
  const yesterday = savedDailyPace(400000, 90594, 20);
  const today = savedDailyPace(400000, 97280, 19);
  assert.equal(yesterday, 15470.3);
  assert.equal(today, 15932.63);
  assert.notEqual(yesterday, today);
  const result = goalPerformance(6686, yesterday);
  assert.equal(result.result, 'MISSED');
  assert.equal(result.achieved, 0.432);
  assert.equal(result.delta, -8784.3);
  assert.equal(goalPerformance(null, yesterday).result, null);
  assert.equal(paceAdjustment(today, 400000, 31), 3029.4);
  assert.equal(evenDailyPace(400000, 31), 12903.23);
});
