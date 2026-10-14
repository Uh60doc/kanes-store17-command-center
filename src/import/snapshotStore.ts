import type { ReportSnapshot } from './types.ts';

const snapshots: ReportSnapshot[] = [];

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

export type Placement =
  | { action: 'duplicate'; snapshotId: string }
  | { action: 'kept-current'; snapshotId: string; reason: 'older' | 'same-time-different-file' | 'missing-generated-time' }
  | { action: 'committed'; snapshot: ReportSnapshot };

function copySnapshot(snapshot: ReportSnapshot): ReportSnapshot {
  return {
    ...snapshot,
    metrics: { ...snapshot.metrics },
    daily: [...snapshot.daily],
    associates: [...snapshot.associates],
    projections: [...snapshot.projections],
    issues: [...snapshot.issues],
  };
}

function remember(snapshot: ReportSnapshot, status: ReportSnapshot['status'], supersedes: string | null): ReportSnapshot {
  const stored: ReportSnapshot = {
    ...snapshot,
    metrics: cleanMetrics(snapshot.metrics),
    daily: snapshot.daily.filter((point) => Number.isFinite(point.amount) && point.date !== ''),
    associates: [...snapshot.associates],
    projections: [...snapshot.projections],
    issues: [...snapshot.issues],
    status,
    supersedes,
  };
  snapshots.push(stored);
  return copySnapshot(stored);
}

/**
 * Same file hash adds no dollars. A later generation time replaces the current
 * row. A missing time, an older time, or the same time with a different file
 * leaves the current row in place.
 */
export function placeSnapshot(snapshot: ReportSnapshot): Placement {
  const sameFile = snapshots.find((item) => item.sha256 !== '' && item.sha256 === snapshot.sha256);
  if (sameFile) return { action: 'duplicate', snapshotId: sameFile.id };

  const current = snapshots.find(
    (item) => item.status === 'current' && snapshotIdentity(item) === snapshotIdentity(snapshot),
  );
  if (!current) return { action: 'committed', snapshot: remember(snapshot, 'current', null) };

  if (!snapshot.generatedAt || !current.generatedAt) {
    remember(snapshot, 'flagged', null);
    return { action: 'kept-current', snapshotId: current.id, reason: 'missing-generated-time' };
  }
  if (snapshot.generatedAt === current.generatedAt) {
    current.status = 'flagged';
    remember(snapshot, 'flagged', null);
    return { action: 'kept-current', snapshotId: current.id, reason: 'same-time-different-file' };
  }
  if (snapshot.generatedAt < current.generatedAt) {
    remember(snapshot, 'superseded', null);
    return { action: 'kept-current', snapshotId: current.id, reason: 'older' };
  }
  current.status = 'superseded';
  return { action: 'committed', snapshot: remember(snapshot, 'current', current.id) };
}

export function commitSnapshot(snapshot: ReportSnapshot): ReportSnapshot {
  const placed = placeSnapshot(snapshot);
  if (placed.action === 'committed') return placed.snapshot;
  const current = snapshots.find((item) => item.id === placed.snapshotId);
  return current ? copySnapshot(current) : copySnapshot(snapshot);
}

export function resetSnapshots(): void {
  snapshots.length = 0;
}

export function currentSnapshots(): ReportSnapshot[] {
  return snapshots.filter((item) => item.status === 'current').map((item) => copySnapshot(item));
}
