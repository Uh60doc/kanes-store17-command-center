import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  AUTOMATED_IMPORTS_ENABLED,
  DEFAULT_APP_ORIGIN,
  GMAIL_SCOPE,
  SHEETS_SCOPE,
  TEST_TAB,
  assertTestTabWrite,
  assertTokenPathOutsideRepo,
  authorizationUrl,
  defaultRedirectUri,
  gmailListUrl,
  parseSpreadsheetId,
  redact,
  testTabWriteUrl,
} from './access.ts';
import { createApp } from './app.ts';
import type { ServerConfig } from './config.ts';
import { clearAccessCache } from './google.ts';
import { resetSessions } from './session.ts';
import { writeAuth, type StoredGoogleAuth } from './tokenStore.ts';

const SECRET = 'test-session-secret-not-used-in-production';

function config(tokenPath: string): ServerConfig {
  return {
    clientId: 'test-client-id.apps.googleusercontent.com',
    clientSecret: 'test-client-secret-value',
    redirectUri: defaultRedirectUri(),
    sessionSecret: SECRET,
    tokenPath,
    appOrigin: DEFAULT_APP_ORIGIN,
    apiPort: 0,
    missing: [],
  };
}

async function withServer(
  tokenPath: string,
  fetchImpl: typeof fetch,
  run: (base: string) => Promise<void>,
): Promise<void> {
  resetSessions();
  clearAccessCache();
  const server = createApp(config(tokenPath), { fetch: fetchImpl });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

test('oauth client is a web app and the redirect URI is the local API callback', () => {
  assert.equal(defaultRedirectUri(), 'http://localhost:5173/api/google/oauth/callback');
  const url = new URL(
    authorizationUrl({
      clientId: 'client',
      redirectUri: defaultRedirectUri(),
      scopes: [SHEETS_SCOPE],
      state: 'state',
      codeChallenge: 'challenge',
      includeGrantedScopes: false,
    }),
  );
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), defaultRedirectUri());
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('client_secret'), null);
  assert.equal(url.searchParams.get('scope'), SHEETS_SCOPE);
});

test('gmail permission is read-only and automated import stays off', () => {
  assert.equal(GMAIL_SCOPE, 'https://www.googleapis.com/auth/gmail.readonly');
  assert.equal(AUTOMATED_IMPORTS_ENABLED, false);
  const list = new URL(gmailListUrl());
  assert.equal(list.origin + list.pathname, 'https://gmail.googleapis.com/gmail/v1/users/me/messages');
  assert.equal(list.searchParams.get('q'), 'has:attachment filename:pdf');
  assert.equal(list.pathname.includes('attachments'), false);
});

test('token files inside the repository are rejected', () => {
  assert.throws(() => assertTokenPathOutsideRepo('/workspace/google-oauth.json', '/workspace'));
  assert.doesNotThrow(() => assertTokenPathOutsideRepo('/tmp/store17/google-oauth.json', '/workspace'));
});

test('the only sheet write target is the connection test tab', () => {
  assert.equal(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/abc123abc123abc123abc1/edit'), 'abc123abc123abc123abc1');
  assert.throws(() => assertTestTabWrite('October Sales!A1'));
  const url = new URL(testTabWriteUrl('sheet-id-sheet-id-sheet-id'));
  assert.match(decodeURIComponent(url.pathname), new RegExp(`${TEST_TAB}!`));
  assert.equal(url.pathname.endsWith('/spreadsheets'), false);
});

test('responses do not contain OAuth secrets', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 's17-token-'));
  const tokenPath = path.join(root, 'google-oauth.json');
  try {
    await withServer(tokenPath, fetch, async (base) => {
      const setup = await fetch(`${base}/api/google/setup`);
      const body = await setup.text();
      assert.equal(setup.status, 200);
      assert.equal(body.includes('test-client-secret-value'), false);
      assert.equal(body.includes('refresh_token'), false);
      assert.match(body, /http:\/\/localhost:5173\/api\/google\/oauth\/callback/);
      const blocked = await fetch(`${base}/api/google/import`, { method: 'POST', headers: { Origin: DEFAULT_APP_ORIGIN } });
      assert.equal(blocked.status, 403);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sheet write waits for a read and only touches the test tab', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 's17-token-'));
  const tokenPath = path.join(root, 'google-oauth.json');
  const calls: { url: string; method: string; body: string }[] = [];
  const stored: StoredGoogleAuth = {
    refreshToken: '1//test-refresh-token-value',
    email: 'store17commandcenter@gmail.com',
    scopes: ['openid', 'https://www.googleapis.com/auth/userinfo.email', SHEETS_SCOPE],
    spreadsheetId: 'existing-sheet-id-123456',
    sheetReadAt: null,
    testWriteAt: null,
    gmailReadAt: null,
    updatedAt: new Date().toISOString(),
  };
  writeAuth(tokenPath, stored);
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, method, body });
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'ya29.test-access', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    }
    if (method === 'GET' && url.includes('/spreadsheets/')) {
      return new Response(JSON.stringify({ spreadsheetId: stored.spreadsheetId, properties: { title: 'Store 17 Command Center' }, sheets: [{ properties: { title: 'October', sheetId: 1 } }] }), { status: 200 });
    }
    if (method === 'POST' && url.includes(':batchUpdate')) {
      return new Response(JSON.stringify({ replies: [{}] }), { status: 200 });
    }
    if (method === 'PUT') {
      return new Response(JSON.stringify({ updatedCells: 6 }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    await withServer(tokenPath, mockFetch, async (base) => {
      const headers = { Origin: DEFAULT_APP_ORIGIN, 'Content-Type': 'application/json' };
      const early = await fetch(`${base}/api/google/sheets/write-test`, { method: 'POST', headers });
      assert.equal(early.status, 401);
      const resumed = await fetch(`${base}/api/google/resume`, { method: 'POST', headers });
      assert.equal(resumed.status, 200);
      const cookie = resumed.headers.get('set-cookie') ?? '';
      assert.equal(cookie.includes('1//test-refresh-token-value'), false);
      const session = cookie.split(';')[0];
      const blocked = await fetch(`${base}/api/google/sheets/write-test`, { method: 'POST', headers: { ...headers, Cookie: session } });
      assert.equal(blocked.status, 409);
      assert.equal(calls.some((call) => call.method === 'PUT'), false);
      const read = await fetch(`${base}/api/google/sheets/read`, { method: 'POST', headers: { ...headers, Cookie: session } });
      assert.equal(read.status, 200);
      const readBody = await read.text();
      assert.equal(readBody.includes('ya29.test-access'), false);
      assert.equal(readBody.includes('test-client-secret-value'), false);
      calls.length = 0;
      const write = await fetch(`${base}/api/google/sheets/write-test`, { method: 'POST', headers: { ...headers, Cookie: session } });
      const writeBody = await write.text();
      assert.equal(write.status, 200, writeBody);
      assert.equal(writeBody.includes('test-client-secret-value'), false);
      assert.equal(writeBody.includes('1//test-refresh-token-value'), false);
      assert.equal(calls.some((call) => call.method === 'POST' && call.url.endsWith('/spreadsheets')), false);
      const put = calls.find((call) => call.method === 'PUT');
      assert.ok(put);
      assert.match(decodeURIComponent(put.url), /CC_Connection_Test!A1/);
      const add = calls.find((call) => call.url.includes(':batchUpdate'));
      assert.ok(add);
      assert.match(add.body, /CC_Connection_Test/);
      assert.equal(add.body.includes('October'), false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('redact removes token fields', () => {
  const cleaned = redact({ access_token: 'ya29.secret', nested: { refresh_token: '1//secret' }, ok: 'visible' }) as {
    access_token: string;
    nested: { refresh_token: string };
    ok: string;
  };
  assert.equal(cleaned.access_token, '[redacted]');
  assert.equal(cleaned.nested.refresh_token, '[redacted]');
  assert.equal(cleaned.ok, 'visible');
});
