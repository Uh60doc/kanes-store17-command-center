import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStoreDashboard, type StoreDashboardModel } from '../src/dashboard/model.ts';
import { acceptIncomingReport } from '../src/import/boundary.ts';
import { currentSnapshots, resetSnapshots } from '../src/import/snapshotStore.ts';
import { assertTokenPathOutsideRepo } from './access.ts';
import { loadVerifiedPerq } from './perqReference.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function reportDirectory(): string {
  return process.env.REPORT_DIR || path.join(homedir(), '.config', 'store17-command-center', 'reports', 'starter');
}

function pdfsIn(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...pdfsIn(full));
    else if (name.toLowerCase().endsWith('.pdf')) files.push(full);
  }
  return files;
}

let cached: StoreDashboardModel | null = null;
let loading: Promise<StoreDashboardModel> | null = null;

async function importReports(): Promise<StoreDashboardModel> {
  const directory = reportDirectory();
  assertTokenPathOutsideRepo(directory, repoRoot);
  let files: string[] = [];
  const perq = loadVerifiedPerq(repoRoot);
  try {
    files = pdfsIn(directory);
  } catch {
    return buildStoreDashboard([], perq.reference, perq.issues);
  }
  resetSnapshots();
  const receivedAt = new Date().toISOString();
  for (const file of files) {
    await acceptIncomingReport({
      source: 'manual-upload',
      fileName: path.basename(file),
      mediaType: 'application/pdf',
      bytes: new Uint8Array(readFileSync(file)),
      receivedAt,
    });
  }
  const model = buildStoreDashboard(currentSnapshots(), perq.reference, perq.issues);
  if (files.length > 0) cached = model;
  return model;
}

export function loadStoreDashboard(): Promise<StoreDashboardModel> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = importReports().finally(() => {
      loading = null;
    });
  }
  return loading;
}
