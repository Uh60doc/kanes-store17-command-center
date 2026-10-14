import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { isVerifiedPerqReference, validateReference, type VerifiedPerqReference } from '../src/reference/perqReference.ts';
import { assertTokenPathOutsideRepo } from './access.ts';

export function perqReferencePath(): string {
  return (
    process.env.PERQ_REFERENCE_PATH ||
    path.join(homedir(), '.config', 'store17-command-center', 'reference', 'perq-october-2026.json')
  );
}

export function loadVerifiedPerq(repoRoot: string): { reference: VerifiedPerqReference | null; issues: string[] } {
  const file = perqReferencePath();
  if (!existsSync(file)) return { reference: null, issues: [] };
  assertTokenPathOutsideRepo(file, repoRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return { reference: null, issues: ['Verified PERQ reference could not be read.'] };
  }
  const issues = validateReference(parsed);
  if (issues.length > 0 || !isVerifiedPerqReference(parsed)) return { reference: null, issues };
  return { reference: parsed, issues: [] };
}
