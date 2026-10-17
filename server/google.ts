import { GMAIL_SCOPE, SHEETS_SCOPE } from './access.ts';
import { readStored, writeAuth, type StoredGoogleAuth } from './tokenStore.ts';

interface AccessCache {
  token: string;
  expiresAt: number;
}

const accessByRefresh = new Map<string, AccessCache>();

export function clearAccessCache(): void {
  accessByRefresh.clear();
}

export function explainGoogleFailure(status: number, body: string): string {
  if (body.includes('accessNotConfigured') || body.includes('SERVICE_DISABLED')) {
    if (body.includes('gmail.googleapis.com')) return 'The Gmail API is not enabled for project store-17-command-center.';
    if (body.includes('sheets.googleapis.com')) return 'The Google Sheets API is not enabled for project store-17-command-center.';
    return 'A required Google API is not enabled for project store-17-command-center.';
  }
  if (status === 401) return 'Google rejected the saved sign-in. Connect again.';
  if (status === 403) return 'Google denied the request. Confirm the test user and the requested permission.';
  return 'The Google request failed.';
}

async function postForm(url: string, body: URLSearchParams, fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    parsed = { error: 'invalid_response' };
  }
  if (!response.ok) {
    const description = typeof parsed.error_description === 'string' ? parsed.error_description : explainGoogleFailure(response.status, text);
    throw new Error(description);
  }
  return parsed;
}

export async function exchangeCode(input: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; refreshToken: string | null; scopes: string[]; expiresAt: number }> {
  const parsed = await postForm(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
    }),
    input.fetchImpl ?? fetch,
  );
  const accessToken = stringField(parsed, 'access_token');
  if (!accessToken) throw new Error('Google did not return an access token.');
  const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
  return {
    accessToken,
    refreshToken: stringField(parsed, 'refresh_token'),
    scopes: String(parsed.scope ?? '').split(' ').filter(Boolean),
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function userEmail(accessToken: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(explainGoogleFailure(response.status, text));
  const parsed = JSON.parse(text) as { email?: string };
  if (!parsed.email) throw new Error('Google did not return the account email.');
  return parsed.email.toLowerCase();
}

export async function accessTokenFor(input: {
  clientId: string;
  clientSecret: string;
  tokenPath: string;
  requiredScope: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const stored = readStored(input.tokenPath);
  if (!stored.refreshToken) throw new Error('Google is not connected.');
  if (!stored.scopes.includes(input.requiredScope)) {
    throw new Error(
      input.requiredScope === GMAIL_SCOPE
        ? 'Gmail read-only permission has not been granted yet.'
        : 'Google Sheets permission has not been granted yet.',
    );
  }
  const cached = accessByRefresh.get(stored.refreshToken);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const fetchImpl = input.fetchImpl ?? fetch;
  const parsed = await postForm(
    'https://oauth2.googleapis.com/token',
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: stored.refreshToken,
      grant_type: 'refresh_token',
    }),
    fetchImpl,
  );
  const accessToken = stringField(parsed, 'access_token');
  if (!accessToken) throw new Error('Google did not refresh the sign-in.');
  const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600;
  accessByRefresh.set(stored.refreshToken, { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 });
  return accessToken;
}

export async function googleJson(input: {
  accessToken: string;
  url: string;
  method?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const response = await (input.fetchImpl ?? fetch)(input.url, {
    method: input.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(explainGoogleFailure(response.status, text));
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function saveConnection(tokenPath: string, patch: Partial<StoredGoogleAuth>): StoredGoogleAuth {
  const next: StoredGoogleAuth = {
    ...readStored(tokenPath),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeAuth(tokenPath, next);
  return next;
}

export function publicAuth(stored: StoredGoogleAuth): {
  email: string | null;
  scopes: string[];
  spreadsheetId: string | null;
  sheetReadAt: string | null;
  testWriteAt: string | null;
  gmailReadAt: string | null;
  sheetsGranted: boolean;
  gmailGranted: boolean;
} {
  return {
    email: stored.email,
    scopes: stored.scopes,
    spreadsheetId: stored.spreadsheetId,
    sheetReadAt: stored.sheetReadAt,
    testWriteAt: stored.testWriteAt,
    gmailReadAt: stored.gmailReadAt,
    sheetsGranted: stored.scopes.includes(SHEETS_SCOPE),
    gmailGranted: stored.scopes.includes(GMAIL_SCOPE),
  };
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}
