import { homedir } from 'node:os';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { API_PORT, DEFAULT_APP_ORIGIN, assertTokenPathOutsideRepo, defaultRedirectUri } from './access.ts';

export interface ServerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionSecret: string;
  tokenPath: string;
  appOrigin: string;
  apiPort: number;
  missing: string[];
}

function readEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  const text = readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadDotEnv(repoRoot: string, env: NodeJS.ProcessEnv = process.env): void {
  const fromFile = {
    ...readEnvFile(path.join(repoRoot, '.env')),
    ...readEnvFile(path.join(repoRoot, '.env.local')),
  };
  for (const [key, value] of Object.entries(fromFile)) {
    if (env[key] === undefined) env[key] = value;
  }
}

export function loadConfig(repoRoot: string, env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const appOrigin = (env.APP_ORIGIN || DEFAULT_APP_ORIGIN).replace(/\/$/, '');
  const tokenPath =
    env.GOOGLE_TOKEN_STORE || path.join(homedir(), '.config', 'store17-command-center', 'google-oauth.json');
  assertTokenPathOutsideRepo(tokenPath, repoRoot);
  const missing: string[] = [];
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  const sessionSecret = env.SESSION_SECRET?.trim() ?? '';
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!sessionSecret) missing.push('SESSION_SECRET');
  return {
    clientId,
    clientSecret,
    redirectUri: (env.GOOGLE_REDIRECT_URI || defaultRedirectUri(appOrigin)).trim(),
    sessionSecret,
    tokenPath,
    appOrigin,
    apiPort: Number(env.API_PORT || API_PORT),
    missing,
  };
}
