import { cardAssociates, identifyEmployee, type EmployeeRole } from '../config/roster.ts';
import type { ReportingPeriod } from '../domain/reportingCalendar.ts';

export interface VerifiedPerqLine {
  sourceName: string;
  opportunities: number;
}

export interface VerifiedPerqAddition {
  sourceName: string;
  date: string;
  opportunities: number;
}

/** One cumulative PERQ snapshot. It is not a daily series. */
export interface VerifiedPerqSnapshot {
  id: string;
  periodStart: string;
  periodEnd: string;
  opportunities: number;
  lines: readonly VerifiedPerqLine[];
  additions: readonly VerifiedPerqAddition[];
}

export interface VerifiedPerqReference {
  snapshots: readonly VerifiedPerqSnapshot[];
}

export interface OpportunityLine {
  displayName: string;
  role: EmployeeRole;
  onCard: boolean;
  opportunities: number;
  note: string;
}

export interface OpportunityWindow {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  opportunities: number;
  status: string;
  lines: readonly OpportunityLine[];
}

export interface PerqPanel {
  loaded: boolean;
  windows: readonly OpportunityWindow[];
  flags: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLine(value: unknown): value is VerifiedPerqLine {
  return isRecord(value) && typeof value.sourceName === 'string' && typeof value.opportunities === 'number' && Number.isFinite(value.opportunities);
}

function isAddition(value: unknown): value is VerifiedPerqAddition {
  return (
    isRecord(value) &&
    typeof value.sourceName === 'string' &&
    typeof value.date === 'string' &&
    typeof value.opportunities === 'number' &&
    Number.isFinite(value.opportunities)
  );
}

export function isVerifiedPerqReference(value: unknown): value is VerifiedPerqReference {
  if (!isRecord(value) || !Array.isArray(value.snapshots)) return false;
  return value.snapshots.every(
    (snapshot) =>
      isRecord(snapshot) &&
      typeof snapshot.id === 'string' &&
      typeof snapshot.periodStart === 'string' &&
      typeof snapshot.periodEnd === 'string' &&
      typeof snapshot.opportunities === 'number' &&
      Array.isArray(snapshot.lines) &&
      snapshot.lines.every(isLine) &&
      Array.isArray(snapshot.additions) &&
      snapshot.additions.every(isAddition),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Issues that mean the snapshot must not be shown or used as a denominator. */
export function validateReference(value: unknown): string[] {
  if (!isVerifiedPerqReference(value)) return ['Verified PERQ reference is missing snapshots.'];
  const issues: string[] = [];
  for (const snapshot of value.snapshots) {
    if (snapshot.lines.length > 0) {
      const lines = sum(snapshot.lines.map((line) => line.opportunities));
      if (lines !== snapshot.opportunities) {
        issues.push(`${snapshot.id} lines sum to ${lines}; the snapshot total is ${snapshot.opportunities}.`);
      }
    }
    for (const addition of snapshot.additions) {
      if (addition.date < snapshot.periodStart || addition.date > snapshot.periodEnd) {
        issues.push(`${addition.sourceName} on ${addition.date} falls outside ${snapshot.id}.`);
      }
    }
    if (snapshot.additions.length === 0) continue;
    const bases = value.snapshots.filter(
      (other) =>
        other.id !== snapshot.id &&
        other.periodStart >= snapshot.periodStart &&
        other.periodEnd <= snapshot.periodEnd &&
        (other.periodStart !== snapshot.periodStart || other.periodEnd !== snapshot.periodEnd),
    );
    if (bases.length !== 1) {
      issues.push(`${snapshot.id} states additions and needs one narrower snapshot beside it.`);
      continue;
    }
    const base = bases[0];
    const added = sum(snapshot.additions.map((addition) => addition.opportunities));
    if (base.opportunities + added !== snapshot.opportunities) {
      issues.push(
        `${snapshot.id} total is ${snapshot.opportunities}. ${base.id} is ${base.opportunities} and the stated additions are ${added}.`,
      );
    }
    for (const addition of snapshot.additions) {
      if (addition.date >= base.periodStart && addition.date <= base.periodEnd) {
        issues.push(`${addition.sourceName} on ${addition.date} is already inside ${base.id}.`);
      }
    }
  }
  return issues;
}

function displayDay(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)));
}

function toLines(entries: readonly { sourceName: string; opportunities: number; note: string }[]): OpportunityLine[] {
  return entries.map((entry) => {
    const identity = identifyEmployee(null, entry.sourceName);
    return {
      displayName: identity.displayName,
      role: identity.role,
      onCard: identity.onCard,
      opportunities: entry.opportunities,
      note: entry.note,
    };
  });
}

function assemble(
  base: VerifiedPerqSnapshot,
  wider: VerifiedPerqSnapshot,
): { sourceName: string; opportunities: number; note: string }[] {
  const extras = new Map<string, { opportunities: number; dates: string[] }>();
  for (const addition of wider.additions) {
    const current = extras.get(addition.sourceName) ?? { opportunities: 0, dates: [] };
    current.opportunities += addition.opportunities;
    current.dates.push(addition.date);
    extras.set(addition.sourceName, current);
  }
  const seen = new Set<string>();
  const rows = base.lines.map((line) => {
    seen.add(line.sourceName);
    const extra = extras.get(line.sourceName);
    const note = extra ? `Includes ${extra.opportunities} on ${extra.dates.map(displayDay).join(', ')}.` : '';
    return { sourceName: line.sourceName, opportunities: line.opportunities + (extra?.opportunities ?? 0), note };
  });
  for (const [sourceName, extra] of extras) {
    if (seen.has(sourceName)) continue;
    rows.push({
      sourceName,
      opportunities: extra.opportunities,
      note: `Recorded on ${extra.dates.map(displayDay).join(', ')}.`,
    });
  }
  return rows;
}

export interface ClosedCustomerPeriod {
  periodStart: string;
  periodEnd: string;
}

/**
 * Store-month opportunities only when a snapshot covers the store period exactly.
 * A shorter window is preserved and is not returned here.
 */
export function storeMonthOpportunities(reference: VerifiedPerqReference, store: Pick<ReportingPeriod, 'start' | 'end'>): number | null {
  const match = reference.snapshots.find((snapshot) => snapshot.periodStart === store.start && snapshot.periodEnd === store.end);
  return match ? match.opportunities : null;
}

export function buildPerqPanel(
  reference: VerifiedPerqReference | null,
  readIssues: readonly string[],
  store: Pick<ReportingPeriod, 'start' | 'end'>,
  individual: Pick<ReportingPeriod, 'start' | 'end'>,
  delivered: ClosedCustomerPeriod | null,
): PerqPanel {
  const flags = [...readIssues];
  const deliveredMatchesStore = delivered !== null && delivered.periodStart === store.start && delivered.periodEnd === store.end;
  if (!deliveredMatchesStore) {
    const covered = delivered
      ? `NWDSR delivered on file covers ${displayDay(delivered.periodStart)} through ${displayDay(delivered.periodEnd)}.`
      : 'NWDSR delivered closed customers are not on file.';
    flags.push(
      `${covered} Store closing ratio uses closed customers for ${displayDay(store.start)} through ${displayDay(store.end)}.`,
    );
  }
  flags.push(
    `Individual closing ratios use associate closed-customer counts for ${displayDay(individual.start)} through ${displayDay(individual.end)}. Those counts are still required.`,
  );
  if (!reference) {
    flags.unshift('A verified PERQ snapshot for this month is still required.');
    return { loaded: false, windows: [], flags };
  }

  const partials = reference.snapshots.filter(
    (snapshot) => snapshot.periodStart === store.start && snapshot.periodEnd < store.end && snapshot.periodEnd >= store.start,
  );
  const fullStore = reference.snapshots.find((snapshot) => snapshot.periodStart === store.start && snapshot.periodEnd === store.end);
  const month = reference.snapshots.find(
    (snapshot) => snapshot.periodStart === individual.start && snapshot.periodEnd === individual.end,
  );

  const windows: OpportunityWindow[] = [];

  for (const partial of partials) {
    windows.push({
      id: partial.id,
      label: 'Store window on file',
      periodStart: partial.periodStart,
      periodEnd: partial.periodEnd,
      opportunities: partial.opportunities,
      status: `Cumulative snapshot through ${displayDay(partial.periodEnd)}. The store month continues through ${displayDay(store.end)}.`,
      lines: toLines(partial.lines.map((line) => ({ ...line, note: '' }))),
    });
  }

  if (fullStore) {
    windows.push({
      id: fullStore.id,
      label: 'Store month',
      periodStart: fullStore.periodStart,
      periodEnd: fullStore.periodEnd,
      opportunities: fullStore.opportunities,
      status: `Cumulative snapshot for ${displayDay(fullStore.periodStart)} through ${displayDay(fullStore.periodEnd)}.`,
      lines: toLines(fullStore.lines.map((line) => ({ ...line, note: '' }))),
    });
  } else if (partials.length > 0) {
    const partial = partials[partials.length - 1];
    flags.push(
      `Verified PERQ for ${displayDay(partial.periodStart)} through ${displayDay(partial.periodEnd)} is ${partial.opportunities} UPS + Be Backs. ${displayDay(store.end)} is still required before the store-month count is complete.`,
    );
  } else {
    flags.push(`A store PERQ snapshot for ${displayDay(store.start)} through ${displayDay(store.end)} is still required.`);
  }

  if (month) {
    const base = partials.find((partial) => partial.periodStart >= month.periodStart && partial.periodEnd <= month.periodEnd);
    const entries = base && month.additions.length > 0 ? assemble(base, month) : month.lines.map((line) => ({ ...line, note: '' }));
    const lines = toLines(entries);
    const additionText =
      month.additions.length > 0
        ? month.additions
            .map((addition) => `${addition.opportunities} for ${identifyEmployee(null, addition.sourceName).displayName} on ${displayDay(addition.date)}`)
            .join('; ')
        : '';
    windows.push({
      id: month.id,
      label: 'Individual month',
      periodStart: month.periodStart,
      periodEnd: month.periodEnd,
      opportunities: month.opportunities,
      status: additionText
        ? `Cumulative calendar month. The difference from the matching store window is ${additionText}.`
        : `Cumulative snapshot for ${displayDay(month.periodStart)} through ${displayDay(month.periodEnd)}.`,
      lines,
    });
    const listed = new Set(lines.map((line) => line.displayName));
    const absent = cardAssociates.filter((employee) => !listed.has(employee.displayName)).map((employee) => employee.displayName);
    if (absent.length > 0) {
      flags.push(`${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} absent from the verified PERQ snapshot.`);
    }
  } else {
    flags.push(
      `An individual PERQ snapshot for ${displayDay(individual.start)} through ${displayDay(individual.end)} is still required.`,
    );
  }

  return { loaded: true, windows, flags };
}
