import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUrlToken } from './access.ts';

export interface Session {
  id: string;
  sheetReadAt: string | null;
  testWriteAt: string | null;
}

const sessions = new Map<string, Session>();

export function resetSessions(): void {
  sessions.clear();
}

export function signValue(value: string, secret: string): string {
  const mac = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function verifyValue(signed: string, secret: string): string | null {
  const dot = signed.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  const expected = signValue(value, secret);
  const left = Buffer.from(signed);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return value;
}

export function readCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean },
): void {
  const pieces = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) pieces.push('Secure');
  const current = res.getHeader('Set-Cookie');
  const next = pieces.join('; ');
  if (!current) res.setHeader('Set-Cookie', next);
  else if (Array.isArray(current)) res.setHeader('Set-Cookie', [...current, next]);
  else res.setHeader('Set-Cookie', [String(current), next]);
}

export function clearCookie(res: ServerResponse, name: string): void {
  setCookie(res, name, '', { maxAge: 0, secure: false });
}

export function createSession(): Session {
  const session = { id: randomUrlToken(), sheetReadAt: null, testWriteAt: null };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function sessionFromRequest(req: IncomingMessage, secret: string): Session | undefined {
  const signed = readCookies(req.headers.cookie).s17_session;
  if (!signed || !secret) return undefined;
  const id = verifyValue(signed, secret);
  if (!id) return undefined;
  return getSession(id);
}
