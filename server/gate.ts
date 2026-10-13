import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const COOKIE = 'store17_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

type Next = (error?: unknown) => void;

export interface GateConfig {
  password: string;
  sheetCsvUrl: string;
}

interface Session {
  expiresAt: number;
}

/**
 * Sign-in and sheet fetch stay on the server.
 * The password and the sheet address are read from the environment
 * and are never written into the client bundle.
 */
export function commandCenterMiddleware(config: GateConfig) {
  const sessions = new Map<string, Session>();

  return function gate(req: IncomingMessage, res: ServerResponse, next: Next): void {
    const url = new URL(req.url ?? '/', 'http://command-center.local');
    if (url.pathname !== '/api/session' && url.pathname !== '/api/sheet') {
      next();
      return;
    }

    res.setHeader('cache-control', 'no-store');
    const method = req.method ?? 'GET';

    if (url.pathname === '/api/session' && method === 'GET') {
      sendJson(res, validSession(req, sessions) ? 200 : 401, { signedIn: validSession(req, sessions) });
      return;
    }

    if (url.pathname === '/api/session' && method === 'DELETE') {
      const token = readCookie(req.headers.cookie, COOKIE);
      if (token) sessions.delete(token);
      res.setHeader('set-cookie', clearedCookie());
      sendJson(res, 200, { signedIn: false });
      return;
    }

    if (url.pathname === '/api/session' && method === 'POST') {
      void signIn(req, res, config.password, sessions);
      return;
    }

    if (url.pathname === '/api/sheet' && method === 'GET') {
      if (!validSession(req, sessions)) {
        sendJson(res, 401, { error: 'sign-in-required' });
        return;
      }
      void sendSheet(res, config.sheetCsvUrl);
      return;
    }

    sendJson(res, 405, { error: 'method-not-allowed' });
  };
}

async function signIn(
  req: IncomingMessage,
  res: ServerResponse,
  expected: string,
  sessions: Map<string, Session>,
): Promise<void> {
  if (expected.trim() === '') {
    sendJson(res, 503, { error: 'not-configured' });
    return;
  }

  let body: unknown;
  try {
    body = await readJson(req);
  } catch {
    sendJson(res, 400, { error: 'bad-request' });
    return;
  }

  const password =
    typeof body === 'object' && body !== null && 'password' in body && typeof body.password === 'string'
      ? body.password
      : '';

  if (!sameSecret(password, expected)) {
    sendJson(res, 401, { error: 'rejected' });
    return;
  }

  const token = randomBytes(32).toString('hex');
  sessions.set(token, { expiresAt: Date.now() + SESSION_MS });
  res.setHeader('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}`);
  sendJson(res, 200, { signedIn: true });
}

async function sendSheet(res: ServerResponse, sheetCsvUrl: string): Promise<void> {
  if (sheetCsvUrl.trim() === '') {
    sendJson(res, 503, { error: 'sheet-not-configured' });
    return;
  }

  try {
    const response = await fetch(sheetCsvUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'text/csv,text/plain,*/*' },
    });
    if (!response.ok) {
      sendJson(res, 502, { error: 'sheet-unavailable' });
      return;
    }
    const csv = await response.text();
    if (csv.length === 0 || csv.length > 1_000_000 || csv.trimStart().startsWith('<')) {
      sendJson(res, 502, { error: 'sheet-unavailable' });
      return;
    }
    sendJson(res, 200, { csv });
  } catch {
    sendJson(res, 502, { error: 'sheet-unavailable' });
  }
}

function validSession(req: IncomingMessage, sessions: Map<string, Session>): boolean {
  const token = readCookie(req.headers.cookie, COOKIE);
  if (!token) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function sameSecret(input: string, expected: string): boolean {
  const left = createHash('sha256').update(input, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function clearedCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 4_096) throw new Error('too-large');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  return JSON.parse(text) as unknown;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(payload);
}
