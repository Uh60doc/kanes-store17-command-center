import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

export const PROJECT_ID = 'store-17-command-center';
export const EXPECTED_EMAIL = 'store17commandcenter@gmail.com';
export const EXPECTED_SHEET_TITLE = 'Store 17 Command Center';
export const OAUTH_CLIENT_TYPE = 'Web application';
export const REDIRECT_PATH = '/api/google/oauth/callback';
export const DEFAULT_APP_ORIGIN = 'http://localhost:5173';
export const API_HOST = '127.0.0.1';
export const API_PORT = 8787;

export const IDENTITY_SCOPES = ['openid', 'https://www.googleapis.com/auth/userinfo.email'] as const;
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const SHEETS_SCOPES = [...IDENTITY_SCOPES, SHEETS_SCOPE] as const;
export const GMAIL_SCOPES = [...SHEETS_SCOPES, GMAIL_SCOPE] as const;

/** Connection proof only. Never a place for sales figures. */
export const TEST_TAB = 'CC_Connection_Test';

/** Report import stays off until a later, explicit step. */
export const AUTOMATED_IMPORTS_ENABLED = false;

const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'client_secret',
  'id_token',
  'code',
  'code_verifier',
  'client_secret_basic',
]);

export function defaultRedirectUri(appOrigin = DEFAULT_APP_ORIGIN): string {
  return `${appOrigin}${REDIRECT_PATH}`;
}

export function assertTokenPathOutsideRepo(tokenPath: string, repoRoot: string): void {
  const resolved = path.resolve(tokenPath);
  const root = path.resolve(repoRoot);
  const inside = resolved === root || resolved.startsWith(root + path.sep);
  if (inside) {
    throw new Error('The Google token file must stay outside the git repository.');
  }
}

export function parseSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

export function assertTestTabWrite(range: string): void {
  const tab = range.split('!')[0]?.replace(/^'+|'+$/g, '');
  if (tab !== TEST_TAB) {
    throw new Error(`Refusing to write to "${tab ?? range}". The only write target is ${TEST_TAB}.`);
  }
}

export function spreadsheetReadUrl(spreadsheetId: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties(title,sheetId)`;
}

export function testTabWriteUrl(spreadsheetId: string): string {
  const range = `${TEST_TAB}!A1:C2`;
  assertTestTabWrite(range);
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
}

export function addTestTabUrl(spreadsheetId: string): string {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
}

export function gmailListUrl(): string {
  const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  url.searchParams.set('q', 'has:attachment filename:pdf');
  url.searchParams.set('maxResults', '5');
  return url.toString();
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SECRET_KEYS.has(key) ? '[redacted]' : redact(entry);
    }
    return output;
  }
  if (typeof value === 'string' && /ya29\.|1\/\/|refresh/i.test(value) && value.length > 40) {
    return '[redacted]';
  }
  return value;
}

export function authorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
  includeGrantedScopes: boolean;
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  if (input.includeGrantedScopes) url.searchParams.set('include_granted_scopes', 'true');
  return url.toString();
}

export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function randomUrlToken(): string {
  return randomBytes(32).toString('base64url');
}

export function testTabValues(testedAt: string): string[][] {
  return [
    ['tested_at', 'check', 'note'],
    [testedAt, 'ok', 'Connection test only. Other tabs were not changed. Automated import is off.'],
  ];
}
