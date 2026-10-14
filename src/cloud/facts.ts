/** Cloud table rules. Blank figures stay blank. The monthly goal is never rewritten. */

import { operatingDaysRemaining } from '../domain/reportingCalendar.ts';

export interface DailyFact {
  date: string;
  snapWritten: number | null;
  nwdsrWritten: number | null;
  nwdsrDelivered: number | null;
}

export type DailyField = 'snapWritten' | 'nwdsrWritten' | 'nwdsrDelivered';

export interface SellingDay {
  date: string;
  selling: boolean;
}

export function money(value: number): number {
  return Math.round(value * 100) / 100;
}

export function sumColumn(rows: readonly DailyFact[], field: DailyField, start: string, end: string): number | null {
  let seen = false;
  let total = 0;
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    const value = row[field];
    if (value === null) continue;
    seen = true;
    total += value;
  }
  return seen ? money(total) : null;
}

/**
 * Remaining dollars and the pace for the selling days still on the calendar.
 * A missing actual leaves the pace blank. The monthly goal is not returned and is not changed.
 */
export function requiredPace(
  goal: number | null,
  actual: number | null,
  sellingDaysRemaining: number | null,
): { remaining: number | null; pace: number | null } {
  if (actual === null || goal === null) return { remaining: null, pace: null };
  const remaining = money(goal - actual);
  if (sellingDaysRemaining === null || sellingDaysRemaining <= 0) return { remaining, pace: null };
  return { remaining, pace: money(remaining / sellingDaysRemaining) };
}

/**
 * Selling days from today through the period end.
 * A listed day with selling false is closed. Every other date in the span is open,
 * including when the closure list is empty.
 */
export function sellingDaysRemaining(
  days: readonly SellingDay[],
  today: string,
  periodStart: string,
  periodEnd: string,
): number {
  const closed = days.filter((day) => !day.selling).map((day) => day.date);
  return operatingDaysRemaining({ start: periodStart, end: periodEnd }, today, closed);
}

/**
 * Month-end run rate from days that actually have a figure.
 * Missing days are left out of both the total and the count. They are not zeroes.
 * The official monthly goal is not an input and is not changed.
 */
export function projectedMonthEnd(
  verifiedTotal: number | null,
  verifiedDayCount: number,
  operatingDayCount: number,
): number | null {
  if (verifiedTotal === null || verifiedDayCount <= 0 || operatingDayCount <= 0) return null;
  return money((verifiedTotal / verifiedDayCount) * operatingDayCount);
}

export type ImportDecision = 'imported' | 'duplicate' | 'conflict';

/**
 * A repeated file does nothing. A second file for the same day does not add onto the first.
 * A conflicting total is kept out and the existing figure stays.
 */
export function applyDailyAmount(
  rows: readonly DailyFact[],
  input: { date: string; field: DailyField; amount: number; sha256: string },
  importedShas: ReadonlySet<string>,
): { rows: DailyFact[]; decision: ImportDecision } {
  if (importedShas.has(input.sha256)) return { rows: rows.map((row) => ({ ...row })), decision: 'duplicate' };
  const next = rows.map((row) => ({ ...row }));
  let row = next.find((item) => item.date === input.date);
  if (!row) {
    row = { date: input.date, snapWritten: null, nwdsrWritten: null, nwdsrDelivered: null };
    next.push(row);
    next.sort((left, right) => left.date.localeCompare(right.date));
  }
  const current = row[input.field];
  if (current !== null && money(current) !== money(input.amount)) return { rows: next, decision: 'conflict' };
  row[input.field] = money(input.amount);
  return { rows: next, decision: 'imported' };
}

export function dayAmount(rows: readonly DailyFact[], date: string, field: DailyField): number | null {
  const row = rows.find((item) => item.date === date);
  return row ? row[field] : null;
}
