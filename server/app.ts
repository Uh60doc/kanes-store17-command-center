import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  AUTOMATED_IMPORTS_ENABLED,
  EXPECTED_EMAIL,
  EXPECTED_SHEET_TITLE,
  GMAIL_SCOPE,
  GMAIL_SCOPES,
  IDENTITY_SCOPES,
  OAUTH_CLIENT_TYPE,
  PROJECT_ID,
  SHEETS_SCOPE,
  SHEETS_SCOPES,
  TEST_TAB,
  addTestTabUrl,
  authorizationUrl,
  codeChallenge,
  gmailListUrl,
  parseSpreadsheetId,
  randomUrlToken,
  redact,
  spreadsheetReadUrl,
  testTabValues,
  testTabWriteUrl,
} from './access.ts';
import type { ServerConfig } from './config.ts';
import {
  accessTokenFor,
  clearAccessCache,
  exchangeCode,
  googleJson,
  publicAuth,
  saveConnection,
  userEmail,
} from './google.ts';
import {
  clearCookie,
  createSession,
  deleteSession,
  readCookies,
  sessionFromRequest,
  setCookie,
  signValue,
  verifyValue,
  type Session,
} from './session.ts';
import { loadStoreDashboard } from './reports.ts';
import { readStored } from './tokenStore.ts';

export interface AppDeps {
  fetch: typeof fetch;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(redact(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(payload);
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function originAllowed(req: IncomingMessage, appOrigin: string): boolean {
  return req.headers.origin === appOrigin;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 20_000) throw new Error('The request body is too large.');
    chunks.push(buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function queryOf(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  return url.searchParams;
}

function pathOf(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
}

interface HandlerCtx {
  config: ServerConfig;
  fetchImpl: typeof fetch;
  secure: boolean;
}

function requireSession(ctx: HandlerCtx, req: IncomingMessage, res: ServerResponse): Session | null {
  if (!ctx.config.sessionSecret) {
    send(res, 503, { error: 'SESSION_SECRET is not set.' });
    return null;
  }
  const session = sessionFromRequest(req, ctx.config.sessionSecret);
  if (!session) {
    send(res, 401, { error: 'Connect Google before this step.' });
    return null;
  }
  return session;
}

export function createApp(config: ServerConfig, deps: AppDeps = { fetch: globalThis.fetch }) {
  const ctx: HandlerCtx = {
    config,
    fetchImpl: deps.fetch,
    secure: config.appOrigin.startsWith('https://'),
  };

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const pathname = pathOf(req);
    if (method === 'GET' && pathname === '/api/dashboard') {
      send(res, 200, await loadStoreDashboard());
      return;
    }
    if (method === 'GET' && pathname === '/api/google/setup') {
      send(res, 200, setupPayload(config));
      return;
    }
    if (method === 'GET' && pathname === '/api/google/status') {
      send(res, 200, statusPayload(config, req));
      return;
    }
    if (method === 'POST' && pathname === '/api/google/import') {
      send(res, 403, { error: 'Automated Gmail import is off. Read tests do not save reports.' });
      return;
    }
    if (method === 'GET' && pathname === '/api/google/oauth/start') {
      startOauth(ctx, req, res);
      return;
    }
    if (method === 'GET' && pathname === '/api/google/oauth/callback') {
      await finishOauth(ctx, req, res);
      return;
    }
    if (method === 'POST' && !originAllowed(req, config.appOrigin)) {
      send(res, 403, { error: 'This action has to start from the local dashboard.' });
      return;
    }
    if (method === 'POST' && pathname === '/api/google/resume') {
      resume(ctx, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/google/disconnect') {
      disconnect(config, req, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/google/spreadsheet') {
      await saveSpreadsheet(config, req, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/google/sheets/read') {
      await readSpreadsheet(ctx, req, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/google/sheets/write-test') {
      await writeTestTab(ctx, req, res);
      return;
    }
    if (method === 'POST' && pathname === '/api/google/gmail/read-test') {
      await readGmail(ctx, req, res);
      return;
    }
    send(res, 404, { error: 'Not found.' });
  }

  return createServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'The request failed.';
      if (!res.headersSent) send(res, 400, { error: message });
    });
  });
}

function setupPayload(config: ServerConfig) {
  return {
    projectId: PROJECT_ID,
    expectedEmail: EXPECTED_EMAIL,
    expectedSheetTitle: EXPECTED_SHEET_TITLE,
    oauthClientType: OAUTH_CLIENT_TYPE,
    redirectUri: config.redirectUri,
    javascriptOrigins: [],
    scopes: {
      identity: [...IDENTITY_SCOPES],
      sheets: SHEETS_SCOPE,
      gmail: GMAIL_SCOPE,
    },
    sheetsConnectScopes: [...SHEETS_SCOPES],
    gmailConnectScopes: [...GMAIL_SCOPES],
    testTab: TEST_TAB,
    automatedImportsEnabled: AUTOMATED_IMPORTS_ENABLED,
    configured: config.missing.length === 0,
    missing: config.missing,
  };
}

function statusPayload(config: ServerConfig, req: IncomingMessage) {
  const stored = readStored(config.tokenPath);
  const session = config.sessionSecret ? sessionFromRequest(req, config.sessionSecret) : undefined;
  return {
    ...setupPayload(config),
    signedIn: Boolean(session),
    ...publicAuth(stored),
    connected: Boolean(session) && stored.refreshToken !== '',
  };
}

function startOauth(ctx: HandlerCtx, req: IncomingMessage, res: ServerResponse): void {
  const { config, secure } = ctx;
  if (config.missing.length > 0) {
    send(res, 503, { error: `Add ${config.missing.join(', ')} to .env.local and restart the server.` });
    return;
  }
  const purpose = queryOf(req).get('purpose') === 'gmail' ? 'gmail' : 'sheets';
  const state = randomUrlToken();
  const verifier = randomUrlToken();
  setCookie(res, 's17_oauth_state', signValue(state, config.sessionSecret), { maxAge: 600, secure });
  setCookie(res, 's17_oauth_verifier', signValue(verifier, config.sessionSecret), { maxAge: 600, secure });
  setCookie(res, 's17_oauth_purpose', signValue(purpose, config.sessionSecret), { maxAge: 600, secure });
  const url = authorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: purpose === 'gmail' ? GMAIL_SCOPES : SHEETS_SCOPES,
    state,
    codeChallenge: codeChallenge(verifier),
    includeGrantedScopes: purpose === 'gmail',
  });
  redirect(res, url);
}

async function finishOauth(ctx: HandlerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { config, fetchImpl, secure } = ctx;
  const params = queryOf(req);
  const fail = (reason: string) => redirect(res, `${config.appOrigin}/?google=error&reason=${encodeURIComponent(reason)}`);
  if (params.get('error')) {
    fail('Google did not grant permission.');
    return;
  }
  const cookies = readCookies(req.headers.cookie);
  const state = verifyValue(cookies.s17_oauth_state ?? '', config.sessionSecret);
  const verifier = verifyValue(cookies.s17_oauth_verifier ?? '', config.sessionSecret);
  const code = params.get('code');
  if (!state || !verifier || state !== params.get('state') || !code) {
    fail('The sign-in session expired. Start again.');
    return;
  }
  clearCookie(res, 's17_oauth_state');
  clearCookie(res, 's17_oauth_verifier');
  clearCookie(res, 's17_oauth_purpose');
  try {
    const token = await exchangeCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      code,
      codeVerifier: verifier,
      fetchImpl,
    });
    const email = await userEmail(token.accessToken, fetchImpl);
    if (email !== EXPECTED_EMAIL) {
      fail(`Signed in as ${email}. Use ${EXPECTED_EMAIL}.`);
      return;
    }
    const previous = readStored(config.tokenPath);
    saveConnection(config.tokenPath, {
      refreshToken: token.refreshToken ?? previous.refreshToken,
      email,
      scopes: [...new Set([...previous.scopes, ...token.scopes])],
    });
    const session = createSession();
    setCookie(res, 's17_session', signValue(session.id, config.sessionSecret), { maxAge: 60 * 60 * 12, secure });
    redirect(res, `${config.appOrigin}/?google=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sign-in failed.';
    fail(message);
  }
}

function resume(ctx: HandlerCtx, res: ServerResponse): void {
  const { config, secure } = ctx;
  const stored = readStored(config.tokenPath);
  if (!stored.refreshToken || stored.email !== EXPECTED_EMAIL) {
    send(res, 401, { error: 'There is no saved connection for the Store 17 mailbox.' });
    return;
  }
  if (!config.sessionSecret) {
    send(res, 503, { error: 'SESSION_SECRET is not set.' });
    return;
  }
  const session = createSession();
  session.sheetReadAt = stored.sheetReadAt;
  session.testWriteAt = stored.testWriteAt;
  setCookie(res, 's17_session', signValue(session.id, config.sessionSecret), { maxAge: 60 * 60 * 12, secure });
  send(res, 200, { connected: true, email: stored.email });
}

function disconnect(config: ServerConfig, req: IncomingMessage, res: ServerResponse): void {
  const session = config.sessionSecret ? sessionFromRequest(req, config.sessionSecret) : undefined;
  if (session) deleteSession(session.id);
  clearAccessCache();
  const stored = readStored(config.tokenPath);
  saveConnection(config.tokenPath, {
    refreshToken: '',
    scopes: [],
    email: null,
    spreadsheetId: stored.spreadsheetId,
  });
  clearCookie(res, 's17_session');
  send(res, 200, { connected: false });
}

async function saveSpreadsheet(config: ServerConfig, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (await readBody(req)) as { spreadsheet?: string };
  const spreadsheetId = parseSpreadsheetId(body.spreadsheet ?? '');
  if (!spreadsheetId) {
    send(res, 400, { error: 'Paste the URL of the existing Store 17 Command Center spreadsheet.' });
    return;
  }
  saveConnection(config.tokenPath, { spreadsheetId, sheetReadAt: null, testWriteAt: null });
  send(res, 200, { spreadsheetId });
}

async function readSpreadsheet(ctx: HandlerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { config, fetchImpl } = ctx;
  const session = requireSession(ctx, req, res);
  if (!session) return;
  const stored = readStored(config.tokenPath);
  if (!stored.spreadsheetId) {
    send(res, 400, { error: 'Save the existing spreadsheet URL first.' });
    return;
  }
  const accessToken = await accessTokenFor({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenPath: config.tokenPath,
    requiredScope: SHEETS_SCOPE,
    fetchImpl,
  });
  const document = (await googleJson({
    accessToken,
    url: spreadsheetReadUrl(stored.spreadsheetId),
    fetchImpl,
  })) as {
    spreadsheetId?: string;
    properties?: { title?: string };
    sheets?: { properties?: { title?: string; sheetId?: number } }[];
  };
  const title = document.properties?.title ?? '';
  const sheets = (document.sheets ?? []).map((sheet) => ({
    title: sheet.properties?.title ?? '',
    sheetId: sheet.properties?.sheetId ?? null,
  }));
  const first = sheets.find((sheet) => sheet.title && sheet.title !== TEST_TAB);
  let preview: { sheetTitle: string; rows: string[][] } | null = null;
  if (first) {
    const range = `${quoteSheet(first.title)}!A1:F8`;
    const values = (await googleJson({
      accessToken,
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(stored.spreadsheetId)}/values/${encodeURIComponent(range)}`,
      fetchImpl,
    })) as { values?: string[][] };
    preview = { sheetTitle: first.title, rows: (values.values ?? []).slice(0, 8).map((row) => row.slice(0, 6)) };
  }
  const readAt = new Date().toISOString();
  session.sheetReadAt = readAt;
  saveConnection(config.tokenPath, { sheetReadAt: readAt });
  send(res, 200, {
    spreadsheetId: document.spreadsheetId ?? stored.spreadsheetId,
    title,
    titleMatches: title.trim().toLowerCase() === EXPECTED_SHEET_TITLE.toLowerCase(),
    sheets,
    preview,
  });
}

async function writeTestTab(ctx: HandlerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { config, fetchImpl } = ctx;
  const session = requireSession(ctx, req, res);
  if (!session) return;
  const stored = readStored(config.tokenPath);
  if (!stored.spreadsheetId) {
    send(res, 400, { error: 'Save the existing spreadsheet URL first.' });
    return;
  }
  if (!session.sheetReadAt && !stored.sheetReadAt) {
    send(res, 409, { error: 'Read the spreadsheet successfully before writing the test tab.' });
    return;
  }
  const accessToken = await accessTokenFor({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenPath: config.tokenPath,
    requiredScope: SHEETS_SCOPE,
    fetchImpl,
  });
  const meta = (await googleJson({
    accessToken,
    url: spreadsheetReadUrl(stored.spreadsheetId),
    fetchImpl,
  })) as { sheets?: { properties?: { title?: string } }[] };
  const titles = (meta.sheets ?? []).map((sheet) => sheet.properties?.title ?? '');
  if (!titles.includes(TEST_TAB)) {
    await googleJson({
      accessToken,
      url: addTestTabUrl(stored.spreadsheetId),
      method: 'POST',
      body: { requests: [{ addSheet: { properties: { title: TEST_TAB } } }] },
      fetchImpl,
    });
  }
  const writeUrl = testTabWriteUrl(stored.spreadsheetId);
  await googleJson({
    accessToken,
    url: writeUrl,
    method: 'PUT',
    body: { values: testTabValues(new Date().toISOString()) },
    fetchImpl,
  });
  const writtenAt = new Date().toISOString();
  session.testWriteAt = writtenAt;
  saveConnection(config.tokenPath, { testWriteAt: writtenAt });
  send(res, 200, {
    spreadsheetId: stored.spreadsheetId,
    tab: TEST_TAB,
    changedOtherTabs: false,
    createdSpreadsheet: false,
  });
}

async function readGmail(ctx: HandlerCtx, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { config, fetchImpl } = ctx;
  const session = requireSession(ctx, req, res);
  if (!session) return;
  if (!AUTOMATED_IMPORTS_ENABLED && queryOf(req).get('import') === '1') {
    send(res, 403, { error: 'Automated Gmail import is off.' });
    return;
  }
  const accessToken = await accessTokenFor({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    tokenPath: config.tokenPath,
    requiredScope: GMAIL_SCOPE,
    fetchImpl,
  });
  const profile = (await googleJson({
    accessToken,
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    fetchImpl,
  })) as { emailAddress?: string };
  if ((profile.emailAddress ?? '').toLowerCase() !== EXPECTED_EMAIL) {
    send(res, 403, { error: `Gmail is signed in as ${profile.emailAddress ?? 'an unexpected account'}.` });
    return;
  }
  const list = (await googleJson({
    accessToken,
    url: gmailListUrl(),
    fetchImpl,
  })) as { messages?: { id: string }[] };
  const messages = [];
  for (const message of (list.messages ?? []).slice(0, 5)) {
    const full = (await googleJson({
      accessToken,
      url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=full`,
      fetchImpl,
    })) as {
      id?: string;
      payload?: { headers?: { name: string; value: string }[]; parts?: GmailPart[]; filename?: string; body?: { attachmentId?: string } };
    };
    messages.push({
      id: full.id ?? message.id,
      subject: headerValue(full.payload?.headers, 'Subject'),
      from: headerValue(full.payload?.headers, 'From'),
      date: headerValue(full.payload?.headers, 'Date'),
      attachmentNames: attachmentNames(full.payload),
    });
  }
  const readAt = new Date().toISOString();
  saveConnection(config.tokenPath, { gmailReadAt: readAt });
  send(res, 200, {
    email: profile.emailAddress,
    imported: false,
    attachmentsDownloaded: false,
    messages,
  });
}

interface GmailPart {
  filename?: string;
  body?: { attachmentId?: string };
  parts?: GmailPart[];
}

function attachmentNames(part: GmailPart | undefined): string[] {
  if (!part) return [];
  const names: string[] = [];
  if (part.filename && part.body?.attachmentId) names.push(part.filename);
  for (const child of part.parts ?? []) names.push(...attachmentNames(child));
  return names;
}

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function quoteSheet(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function listen(config: ServerConfig) {
  const server = createApp(config);
  server.listen(config.apiPort, '127.0.0.1');
  return server;
}
