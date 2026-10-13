export interface PerformanceTier {
  tone: 'red' | 'orange' | 'yellow' | 'lime' | 'dark-green' | 'green';
  /** Share of the distance to the next goal, from 0 to 100. */
  fillPercent: number;
  nextGoal: number | null;
  nextLabel: string;
}

/** Delivered-sales thermometer. Missing amounts never call this. */
export function deliveredTier(amount: number): PerformanceTier {
  const steps: { below: number; tone: PerformanceTier['tone']; next: number }[] = [
    { below: 60_000, tone: 'red', next: 60_000 },
    { below: 75_000, tone: 'orange', next: 75_000 },
    { below: 95_000, tone: 'yellow', next: 95_000 },
    { below: 115_000, tone: 'lime', next: 115_000 },
  ];
  for (const step of steps) {
    if (amount < step.below) {
      return {
        tone: step.tone,
        fillPercent: fill(amount, step.next),
        nextGoal: step.next,
        nextLabel: 'Next goal',
      };
    }
  }
  return { tone: 'dark-green', fillPercent: 100, nextGoal: null, nextLabel: 'Top tier' };
}

/** Bedding color only after a real percentage is imported. Target is 20%. */
export function beddingTier(ratio: number): PerformanceTier {
  return {
    tone: ratio < 0.2 ? 'red' : 'green',
    fillPercent: fill(ratio, 0.2),
    nextGoal: 0.2,
    nextLabel: 'Minimum',
  };
}

/** Maintenance-plan dollars. $4,500 and above is green with no further goal. */
export function maintenanceTier(amount: number): PerformanceTier {
  if (amount < 3_000) {
    return { tone: 'red', fillPercent: fill(amount, 3_000), nextGoal: 3_000, nextLabel: 'Next goal' };
  }
  if (amount < 4_500) {
    return { tone: 'yellow', fillPercent: fill(amount, 4_500), nextGoal: 4_500, nextLabel: 'Next goal' };
  }
  return { tone: 'green', fillPercent: 100, nextGoal: null, nextLabel: 'Goal reached' };
}

/** Rug color uses the quarterly count. A missing count is not zero and is not red. */
export function rugTier(count: number): PerformanceTier {
  if (count <= 0) {
    return { tone: 'red', fillPercent: 0, nextGoal: 12, nextLabel: 'Monthly goal' };
  }
  if (count < 13) {
    return { tone: 'yellow', fillPercent: fill(count, 12), nextGoal: 12, nextLabel: 'Monthly goal' };
  }
  return { tone: 'green', fillPercent: 100, nextGoal: null, nextLabel: 'Quarterly goal reached' };
}

function fill(amount: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.max(0, Math.min(100, (amount / goal) * 100));
}
