/** Yesterday's goal stays the pace saved for that day. Today is recalculated apart from it. */

export function savedDailyPace(budget: number | null, actualBefore: number | null, daysLeft: number | null): number | null {
  if (budget === null || actualBefore === null || daysLeft === null || daysLeft <= 0) return null;
  return Math.round(((budget - actualBefore) / daysLeft) * 100) / 100;
}

export function evenDailyPace(budget: number | null, totalDays: number | null): number | null {
  if (budget === null || totalDays === null || totalDays <= 0) return null;
  return Math.round((budget / totalDays) * 100) / 100;
}

export function paceAdjustment(todayPace: number | null, budget: number | null, totalDays: number | null): number | null {
  const even = evenDailyPace(budget, totalDays);
  if (todayPace === null || even === null) return null;
  return Math.round((todayPace - even) * 100) / 100;
}

export function goalPerformance(actual: number | null, goal: number | null): {
  achieved: number | null;
  delta: number | null;
  result: 'HIT' | 'MISSED' | null;
} {
  if (actual === null || goal === null) return { achieved: null, delta: null, result: null };
  return {
    achieved: goal === 0 ? null : Math.round((actual / goal) * 1000) / 1000,
    delta: Math.round((actual - goal) * 100) / 100,
    result: actual >= goal ? 'HIT' : 'MISSED',
  };
}
