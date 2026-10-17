import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStoreDashboard, type StoreDashboardModel } from '../src/dashboard/model.ts';
import { acceptIncomingReport } from '../src/import/boundary.ts';
import type { ReportSnapshot } from '../src/import/types.ts';
import { currentSnapshots, resetSnapshots } from '../src/import/snapshotStore.ts';
import { assertTokenPathOutsideRepo } from './access.ts';
import { loadVerifiedPerq } from './perqReference.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function reportDirectories(): string[] {
  if (process.env.REPORT_DIR) return [process.env.REPORT_DIR];
  const root = path.join(homedir(), '.config', 'store17-command-center', 'reports');
  return ['starter', 'loose', 'daily'].map((name) => path.join(root, name));
}

function pdfsIn(dir: string): string[] {
  const files: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...pdfsIn(full));
    else if (name.toLowerCase().endsWith('.pdf')) files.push(full);
  }
  return files;
}

let cached: StoreDashboardModel | null = null;
let loading: Promise<StoreDashboardModel> | null = null;

async function importReports(): Promise<StoreDashboardModel> {
  const directories = reportDirectories();
  for (const directory of directories) assertTokenPathOutsideRepo(directory, repoRoot);
  let files: string[] = [];
  const perq = loadVerifiedPerq(repoRoot);
  try {
    files = directories.flatMap((directory) => pdfsIn(directory));
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

export function snapWrittenPdf(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const root = path.resolve(path.join(homedir(), '.config', 'store17-command-center', 'reports'));
  const folders = [path.join(root, 'starter', 'daily_single_date', date), path.join(root, 'daily', date)];
  for (const folder of folders) {
    let names: string[] = [];
    try {
      names = readdirSync(folder);
    } catch {
      continue;
    }
    const match = names.find((name) => /^SNAP_WRITTEN/i.test(name) && name.toLowerCase().endsWith('.pdf'));
    if (!match) continue;
    const full = path.resolve(folder, match);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) return null;
    return full;
  }
  return null;
}

export async function loadVerifiedSnapshots(): Promise<{ model: StoreDashboardModel; snapshots: ReportSnapshot[] }> {
  cached = null;
  const model = await importReports();
  return { model, snapshots: currentSnapshots() };
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
