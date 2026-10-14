import { importSources } from './sources.ts';
import { extractPdfPages } from './pdf/extractPdf.ts';
import { blockingIssues, parseReportFromPages } from './pdf/parseReport.ts';
import { placeSnapshot } from './snapshotStore.ts';
import { snapshotFromParsed } from './snapshotFromParsed.ts';
import type { ImportSourceId, IncomingReportFile, ReportIssue } from './types.ts';

export type ImportResult =
  | { ok: false; code: 'unknown-source' | 'empty-file' }
  | {
      ok: true;
      disposition: 'held-for-parser' | 'held-for-review' | 'duplicate' | 'needs-review' | 'committed';
      source: ImportSourceId;
      fileName: string;
      snapshotId?: string;
      reason?: string;
      issues?: readonly ReportIssue[];
    };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isPdf(file: IncomingReportFile): boolean {
  return file.mediaType === 'application/pdf' || file.fileName.toLowerCase().endsWith('.pdf');
}

/**
 * Manual upload and the company mailbox both pass report files here.
 * A recognized PDF is validated and stored in memory. The same file hash
 * does not add dollars. Mailbox download and scheduled import stay off.
 */
export async function acceptIncomingReport(file: IncomingReportFile): Promise<ImportResult> {
  const source = importSources.find((item) => item.id === file.source);
  if (!source) return { ok: false, code: 'unknown-source' };
  if (file.fileName.trim() === '' || file.bytes.byteLength === 0) return { ok: false, code: 'empty-file' };
  if (!isPdf(file)) {
    return { ok: true, disposition: 'held-for-parser', source: file.source, fileName: file.fileName };
  }

  const sha256 = await sha256Hex(file.bytes);
  const pages = await extractPdfPages(file.bytes);
  const parsed = parseReportFromPages(pages);
  const blocks = blockingIssues(parsed.issues);
  if (!parsed.recognized || blocks.length > 0) {
    return {
      ok: true,
      disposition: 'held-for-review',
      source: file.source,
      fileName: file.fileName,
      issues: blocks.length > 0 ? blocks : parsed.issues,
    };
  }

  const snapshot = snapshotFromParsed(parsed, {
    sha256,
    fileName: file.fileName,
    source: file.source,
    receivedAt: file.receivedAt,
    messageId: file.messageId ?? null,
  });
  if (!snapshot) {
    return {
      ok: true,
      disposition: 'held-for-review',
      source: file.source,
      fileName: file.fileName,
      issues: parsed.issues,
    };
  }

  const placed = placeSnapshot(snapshot);
  if (placed.action === 'duplicate') {
    return { ok: true, disposition: 'duplicate', source: file.source, fileName: file.fileName, snapshotId: placed.snapshotId };
  }
  if (placed.action === 'kept-current') {
    return {
      ok: true,
      disposition: 'needs-review',
      source: file.source,
      fileName: file.fileName,
      snapshotId: placed.snapshotId,
      reason: placed.reason,
    };
  }
  return {
    ok: true,
    disposition: 'committed',
    source: file.source,
    fileName: file.fileName,
    snapshotId: placed.snapshot.id,
  };
}
