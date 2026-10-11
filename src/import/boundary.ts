import { commitSnapshot } from './snapshotStore.ts';
import { importSources } from './sources.ts';
import type { ImportSourceId, IncomingReportFile, ReportSnapshot } from './types.ts';

export type ImportResult =
  | { ok: false; code: 'unknown-source' | 'empty-file' }
  | {
      ok: true;
      disposition: 'held-for-parser';
      source: ImportSourceId;
      fileName: string;
    }
  | {
      ok: true;
      disposition: 'committed';
      source: ImportSourceId;
      fileName: string;
      snapshotId: string;
    };

/**
 * No sample reports are available, so nothing is parsed.
 * Returning null keeps every actual empty instead of inventing a number.
 */
function parseReport(_file: IncomingReportFile): ReportSnapshot | null {
  return null;
}

/**
 * Single import boundary.
 *
 * Manual upload and the company mailbox both pass report files here.
 * They do not write snapshots themselves. A parsed file is committed
 * through `commitSnapshot` — one snapshot path for both sources.
 *
 * Phase 1 has no parser and no connected source.
 */
export function acceptIncomingReport(file: IncomingReportFile): ImportResult {
  const source = importSources.find((item) => item.id === file.source);
  if (!source) {
    return { ok: false, code: 'unknown-source' };
  }
  if (file.fileName.trim() === '' || file.bytes.byteLength === 0) {
    return { ok: false, code: 'empty-file' };
  }

  const parsed = parseReport(file);
  if (!parsed) {
    return {
      ok: true,
      disposition: 'held-for-parser',
      source: file.source,
      fileName: file.fileName,
    };
  }

  const stored = commitSnapshot(parsed);
  return {
    ok: true,
    disposition: 'committed',
    source: file.source,
    fileName: file.fileName,
    snapshotId: stored.id,
  };
}
