import { cardAssociates, employees, identifyEmployee } from '../config/roster.ts';
import type { ReportingPeriod } from '../domain/reportingCalendar.ts';

export interface PerqSnapshotMeta {
  id: string;
  filter_start: string;
  filter_end: string;
  report_level: 'employee' | 'location';
  reported_total: number;
  source: string;
  source_run_time: string;
  coverage: string;
  location: string;
  measure: string;
  is_final_month_end: boolean;
}

export interface PerqEmployeeRow {
  snapshot_id: string;
  filter_start: string;
  filter_end: string;
  employee_code: string;
  display_first: string;
  display_last: string;
  role_at_snapshot: string;
  ups_plus_be_backs: number;
  source_screenshot: string;
  printed_generated_at: string;
  is_single_day: boolean;
}

/** Cumulative PERQ evidence. Snapshots are not added together and are not daily rows. */
export interface PerqEvidence {
  snapshotMetadata: readonly PerqSnapshotMeta[];
  employeeSnapshotRows: readonly PerqEmployeeRow[];
}

export interface OpportunityLine {
  displayName: string;
  role: string;
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

export interface TeamMemberView {
  id: string;
  displayName: string;
  opportunities: number | null;
  opportunityLabel: string;
  boundaryNote: string | null;
}

export interface PerqPanel {
  loaded: boolean;
  windows: readonly OpportunityWindow[];
  team: readonly TeamMemberView[];
  flags: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMeta(value: unknown): value is PerqSnapshotMeta {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.filter_start === 'string' &&
    typeof value.filter_end === 'string' &&
    (value.report_level === 'employee' || value.report_level === 'location') &&
    typeof value.reported_total === 'number' &&
    typeof value.source_run_time === 'string' &&
    typeof value.coverage === 'string' &&
    typeof value.measure === 'string' &&
    typeof value.is_final_month_end === 'boolean'
  );
}

function isRow(value: unknown): value is PerqEmployeeRow {
  return (
    isRecord(value) &&
    typeof value.snapshot_id === 'string' &&
    typeof value.employee_code === 'string' &&
    typeof value.display_first === 'string' &&
    typeof value.display_last === 'string' &&
    typeof value.ups_plus_be_backs === 'number' &&
    typeof value.is_single_day === 'boolean'
  );
}

export function isPerqEvidence(value: unknown): value is PerqEvidence {
  return (
    isRecord(value) &&
    Array.isArray(value.snapshotMetadata) &&
    value.snapshotMetadata.every(isMeta) &&
    Array.isArray(value.employeeSnapshotRows) &&
    value.employeeSnapshotRows.every(isRow)
  );
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

function sourceName(row: PerqEmployeeRow): string {
  return `${row.display_first} ${row.display_last}`.replace(/\s+/g, ' ').trim();
}

function isManagerRow(row: PerqEmployeeRow): boolean {
  if (row.role_at_snapshot === 'management') return true;
  return identifyEmployee(row.employee_code, sourceName(row)).role === 'management';
}

function withoutManagers(rows: readonly PerqEmployeeRow[]): PerqEmployeeRow[] {
  return rows.filter((row) => !isManagerRow(row));
}

/**
 * The compiled extract misread two codes that the salesperson screenshots print clearly.
 * CPRI0909 matches the roster. TNASSIF is the roster alias for Ricky Nassif.
 */
const SCREENSHOT_CODES: Readonly<Record<string, string>> = {
  CPR10909: 'CPRI0909',
  TNASSI: 'TNASSIF',
};

export function applyScreenshotCodes(evidence: PerqEvidence): { evidence: PerqEvidence; notes: string[] } {
  const notes: string[] = [];
  if (evidence.employeeSnapshotRows.some((row) => row.employee_code === 'TNASSI')) {
    notes.push('The compiled extract lists TNASSI. The salesperson screenshots print TNASSIF.');
  }
  return {
    notes,
    evidence: {
      snapshotMetadata: evidence.snapshotMetadata,
      employeeSnapshotRows: evidence.employeeSnapshotRows.map((row) => ({
        ...row,
        employee_code: SCREENSHOT_CODES[row.employee_code] ?? row.employee_code,
      })),
    },
  };
}

export function validateReference(value: unknown): string[] {
  if (!isPerqEvidence(value)) return ['Verified PERQ reference is missing snapshots.'];
  const issues: string[] = [];
  for (const snapshot of value.snapshotMetadata) {
    const rows = value.employeeSnapshotRows.filter((row) => row.snapshot_id === snapshot.id);
    if (snapshot.report_level === 'employee') {
      const sum = rows.reduce((total, row) => total + row.ups_plus_be_backs, 0);
      if (sum !== snapshot.reported_total) {
        issues.push(`${snapshot.id} employee rows sum to ${sum}; the snapshot total is ${snapshot.reported_total}.`);
      }
    }
    for (const row of rows) {
      if (row.is_single_day && row.filter_start !== row.filter_end) {
        issues.push(`${row.employee_code} is marked as one day but covers ${row.filter_start} through ${row.filter_end}.`);
      }
    }
    const twin = value.snapshotMetadata.find(
      (other) =>
        other.id !== snapshot.id &&
        other.filter_start === snapshot.filter_start &&
        other.filter_end === snapshot.filter_end &&
        other.report_level !== snapshot.report_level,
    );
    if (twin && twin.reported_total !== snapshot.reported_total) {
      issues.push(
        `${snapshot.id} total is ${snapshot.reported_total} and ${twin.id} total is ${twin.reported_total} for the same filter.`,
      );
    }
  }
  return issues;
}

function statusFor(snapshot: PerqSnapshotMeta): string {
  const timing = snapshot.source_run_time === 'UNKNOWN' ? 'Report run time unknown.' : `Report run time ${snapshot.source_run_time}.`;
  const finality = snapshot.is_final_month_end ? 'Final month-end snapshot.' : 'Interim snapshot. The filter end is not a completed month.';
  return `${finality} ${timing} ${snapshot.coverage}`;
}

export function storeMonthOpportunities(evidence: PerqEvidence, store: Pick<ReportingPeriod, 'start' | 'end'>): number | null {
  const match = evidence.snapshotMetadata.find(
    (snapshot) =>
      snapshot.report_level === 'location' &&
      snapshot.filter_start === store.start &&
      snapshot.filter_end === store.end &&
      snapshot.is_final_month_end,
  );
  return match ? match.reported_total : null;
}

function memberId(code: string | null, displayName: string): string {
  if (code) return code;
  return displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function buildPerqPanel(
  evidence: PerqEvidence | null,
  readIssues: readonly string[],
  store: Pick<ReportingPeriod, 'start' | 'end'>,
  individual: Pick<ReportingPeriod, 'start' | 'end'>,
  written: { periodStart: string; periodEnd: string } | null,
): PerqPanel {
  const flags = [...readIssues];
  const team = cardAssociates.map((employee) => ({
    id: memberId(employee.code, employee.displayName),
    displayName: employee.displayName,
    opportunities: null as number | null,
    opportunityLabel: `Individual month ${displayDay(individual.start)} through ${displayDay(individual.end)}. PERQ for that window is not on file.`,
    boundaryNote: null as string | null,
  }));

  if (!evidence) {
    flags.unshift('A verified PERQ snapshot for this month is still required.');
    flags.push(
      `Store closing ratio uses Net Written purchasing customers and location Ups + Be Backs for ${displayDay(store.start)} through ${displayDay(store.end)}.`,
    );
    return { loaded: false, windows: [], team, flags };
  }

  const windows: OpportunityWindow[] = evidence.snapshotMetadata.map((snapshot) => {
    const ownRows = evidence.employeeSnapshotRows.filter((row) => row.snapshot_id === snapshot.id);
    const twinRows =
      snapshot.report_level === 'location'
        ? evidence.employeeSnapshotRows.filter(
            (row) => row.filter_start === snapshot.filter_start && row.filter_end === snapshot.filter_end && row.snapshot_id !== snapshot.id,
          )
        : ownRows;
    const managerOpportunities = twinRows.filter(isManagerRow).reduce((total, row) => total + row.ups_plus_be_backs, 0);
    const salespersonRows = withoutManagers(ownRows);
    return {
      id: snapshot.id,
      label: snapshot.report_level === 'location' ? 'Location report' : 'Employee report',
      periodStart: snapshot.filter_start,
      periodEnd: snapshot.filter_end,
      opportunities: snapshot.reported_total - managerOpportunities,
      status: statusFor(snapshot),
      lines: salespersonRows.map((row) => {
        const identity = identifyEmployee(row.employee_code, sourceName(row));
        return {
          displayName: identity.displayName,
          role: row.role_at_snapshot,
          opportunities: row.ups_plus_be_backs,
          note: '',
        };
      }),
    };
  });

  const seenCodes = new Set<string>();
  for (const row of evidence.employeeSnapshotRows) {
    const identity = identifyEmployee(row.employee_code, sourceName(row));
    if (identity.role === 'management') continue;
    const roster = employees.find((employee) => employee.displayName === identity.displayName);
    const knownAlias = roster?.code === row.employee_code || roster?.aliasCodes.includes(row.employee_code) === true;
    if (roster?.code && !knownAlias && !seenCodes.has(row.employee_code)) {
      seenCodes.add(row.employee_code);
      flags.push(`PERQ prints ${row.employee_code} for ${identity.displayName}. The roster code is ${roster.code}.`);
    }
  }

  for (const snapshot of evidence.snapshotMetadata) {
    if (snapshot.report_level !== 'employee') continue;
    const location = evidence.snapshotMetadata.find(
      (other) =>
        other.report_level === 'location' &&
        other.filter_start === snapshot.filter_start &&
        other.filter_end === snapshot.filter_end,
    );
    if (!location) {
      flags.push(
        `The ${displayDay(snapshot.filter_start)} through ${displayDay(snapshot.filter_end)} evidence is an employee report. No location report was supplied for that filter.`,
      );
      continue;
    }
    if (location.reported_total === snapshot.reported_total) {
      flags.push(
        `${displayDay(snapshot.filter_start)} through ${displayDay(snapshot.filter_end)} reconciles: employee rows and the location report are both ${snapshot.reported_total} Ups + Be Backs.`,
      );
    }
  }

  const fullStore = evidence.snapshotMetadata.find(
    (snapshot) => snapshot.report_level === 'location' && snapshot.filter_start === store.start && snapshot.filter_end === store.end,
  );
  if (!fullStore) {
    flags.push(
      `No location PERQ snapshot covers ${displayDay(store.start)} through ${displayDay(store.end)}. November 1 is still required before the store-month count is complete.`,
    );
  }

  const monthSnapshot = evidence.snapshotMetadata.find(
    (snapshot) =>
      snapshot.report_level === 'employee' &&
      snapshot.filter_start === individual.start &&
      snapshot.filter_end === individual.end,
  );
  const narrower = evidence.snapshotMetadata.find(
    (snapshot) =>
      snapshot.report_level === 'employee' &&
      snapshot.filter_start === store.start &&
      snapshot.filter_end === individual.end &&
      snapshot.filter_end !== store.end,
  );
  if (monthSnapshot) {
    const monthRows = withoutManagers(evidence.employeeSnapshotRows.filter((row) => row.snapshot_id === monthSnapshot.id));
    const narrowRows = narrower ? withoutManagers(evidence.employeeSnapshotRows.filter((row) => row.snapshot_id === narrower.id)) : [];
    for (const member of team) {
      const row = monthRows.find((item) => identifyEmployee(item.employee_code, sourceName(item)).displayName === member.displayName);
      if (!row) {
        member.opportunityLabel = 'This associate is absent from the verified PERQ snapshot. No opportunity count is recorded.';
        continue;
      }
      member.opportunities = row.ups_plus_be_backs;
      member.opportunityLabel = monthSnapshot.is_final_month_end
        ? `Cumulative Ups + Be Backs for ${displayDay(monthSnapshot.filter_start)} through ${displayDay(monthSnapshot.filter_end)}.`
        : `Interim cumulative snapshot filtered ${displayDay(monthSnapshot.filter_start)} through ${displayDay(monthSnapshot.filter_end)}. Report run time unknown.`;
      const other = narrowRows.find((item) => item.employee_code === row.employee_code);
      if (other && other.ups_plus_be_backs !== row.ups_plus_be_backs && monthSnapshot.source_run_time === 'UNKNOWN') {
        member.boundaryNote = `${row.ups_plus_be_backs} on the ${monthSnapshot.filter_start} filter and ${other.ups_plus_be_backs} on the ${narrower?.filter_start} filter. Run times are unknown, so the difference stays a conditional boundary note and is not an October 1 daily record.`;
      }
    }
    const listed = new Set(monthRows.map((row) => identifyEmployee(row.employee_code, sourceName(row)).displayName));
    const absent = cardAssociates.filter((employee) => !listed.has(employee.displayName)).map((employee) => employee.displayName);
    if (absent.length > 0) {
      flags.push(`${absent.join(' and ')} ${absent.length === 1 ? 'is' : 'are'} absent from the verified PERQ snapshot. No zero was added.`);
    }
  }

  if (monthSnapshot && narrower && monthSnapshot.source_run_time === 'UNKNOWN') {
    flags.push(
      `The ${monthSnapshot.filter_start} and ${narrower.filter_start} employee snapshots are separate filters. Run times are unknown, so row differences stay a conditional boundary note and are not stored as daily PERQ records.`,
    );
  }
  const cumulativeEmployee = evidence.snapshotMetadata.filter((snapshot) => snapshot.report_level === 'employee' && !snapshot.is_final_month_end);
  if (cumulativeEmployee.length > 1) {
    flags.push('These employee snapshots are separate cumulative filters. Their totals are not subtracted into daily opportunities.');
  }

  const writtenMatches =
    written !== null && written.periodStart === store.start && written.periodEnd === store.end && fullStore?.is_final_month_end === true;
  if (!writtenMatches) {
    const covered = written
      ? `Net Written on file covers ${displayDay(written.periodStart)} through ${displayDay(written.periodEnd)}.`
      : 'Net Written purchasing customers are not on file for the full store month.';
    flags.push(`${covered} Store closing ratio stays Not Available until that customer count and the location PERQ cover ${displayDay(store.start)} through ${displayDay(store.end)}.`);
  }
  flags.push(
    `Individual closing ratios use each associate's Data Analysis Group 17 Written order count ÷ their PERQ opportunities for ${displayDay(individual.start)} through ${displayDay(individual.end)}, both through the same verified date.`,
  );

  return { loaded: true, windows, team, flags };
}
