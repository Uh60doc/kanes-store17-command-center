import type { ReportSnapshot } from './types.ts';

const snapshots: ReportSnapshot[] = [];

export function resetSnapshots(): void {
  snapshots.length = 0;
}

export function snapshotIdentity(
  snapshot: Pick<
    ReportSnapshot,
    'reportType' | 'storeNumber' | 'periodStart' | 'periodEnd' | 'calendar'
  >,
): string {
  return [
    snapshot.reportType,
    String(snapshot.storeNumber),
    snapshot.calendar,
    snapshot.periodStart,
    snapshot.periodEnd,
  ].join('|');
}

function cleanMetrics(metrics: ReportSnapshot['metrics']): ReportSnapshot['metrics'] {
  const clean: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Newest valid snapshot for the same report type, store, calendar, and
 * date range replaces the current one. Older rows are kept and marked
 * superseded. Snapshots are not added together. Omitted metrics stay omitted.
 */
export function commitSnapshot(snapshot: ReportSnapshot): ReportSnapshot {
  const stored: ReportSnapshot = {
    ...snapshot,
    metrics: cleanMetrics(snapshot.metrics),
    daily: snapshot.daily.filter((point) => Number.isFinite(point.amount) && point.date !== ''),
    issues: [...snapshot.issues],
    status: 'current',
  };

  for (const existing of snapshots) {
    if (existing.status === 'current' && snapshotIdentity(existing) === snapshotIdentity(stored)) {
      existing.status = 'superseded';
      stored.supersedes = existing.id;
    }
  }

  snapshots.push(stored);
  return { ...stored, metrics: { ...stored.metrics }, daily: [...stored.daily], issues: [...stored.issues] };
}

export function currentSnapshots(): ReportSnapshot[] {
  return snapshots
    .filter((item) => item.status === 'current')
    .map((item) => ({
      ...item,
      metrics: { ...item.metrics },
      daily: [...item.daily],
      issues: [...item.issues],
    }));
}
