/** Same-day PERQ intake. A location report and an employee report for one date both stay. */

export interface PerqDailyObservation {
  date: string;
  level: 'location' | 'employee';
  employeeCode: string | null;
  opportunities: number;
  sha256: string;
  generatedAt: string | null;
  importedAt: string;
}

export interface PerqDailyLog {
  severity: 'duplicate' | 'correction' | 'accepted' | 'needs-review';
  message: string;
}

function key(row: PerqDailyObservation): string {
  return `${row.date}|${row.level}|${row.employeeCode ?? ''}`;
}

export function placePerqDaily(
  current: readonly PerqDailyObservation[],
  incoming: PerqDailyObservation,
): { current: PerqDailyObservation[]; log: PerqDailyLog } {
  const rows = [...current];
  const index = rows.findIndex((row) => key(row) === key(incoming));
  if (index === -1) {
    rows.push(incoming);
    return { current: rows, log: { severity: 'accepted', message: `${incoming.level} ${incoming.date} accepted.` } };
  }
  const existing = rows[index];
  if (!existing) return { current: rows, log: { severity: 'needs-review', message: 'The existing daily row could not be read.' } };
  if (existing.sha256 === incoming.sha256) {
    return { current: rows, log: { severity: 'duplicate', message: `${incoming.level} ${incoming.date} is the same file. It was not added again.` } };
  }
  if (!incoming.generatedAt || !existing.generatedAt) {
    return {
      current: rows,
      log: {
        severity: 'needs-review',
        message: `${incoming.level} ${incoming.date} has a different file and a missing run time. The current row was kept.`,
      },
    };
  }
  if (incoming.generatedAt > existing.generatedAt) {
    rows[index] = incoming;
    return {
      current: rows,
      log: { severity: 'correction', message: `${incoming.level} ${incoming.date} replaced the earlier row.` },
    };
  }
  return {
    current: rows,
    log: { severity: 'needs-review', message: `${incoming.level} ${incoming.date} is older than the current row. The current row was kept.` },
  };
}
