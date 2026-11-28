import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db, type UserRow } from './db.ts';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const DEVICE_TTL_MS = 1000 * 60 * 60 * 24 * 180; // 180 days
export const SESSION_COOKIE_NAME = 'vc_session';
export const DEVICE_COOKIE_NAME = 'vc_device';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function createSessionToken(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();

  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(tokenHash, userId, expiresAt, now.toISOString());

  // Prune expired sessions occasionally without blocking callers
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());

  return token;
}

export function verifySessionToken(token: string): number | null {
  if (!token || token.length < 32 || token.length > 256) return null;
  const tokenHash = sha256Hex(token);
  const row = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: number; expires_at: string } | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  return row.user_id;
}

export function revokeSessionToken(req: Request): void {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length).trim();
  } else {
    token = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
  }
  if (token) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256Hex(token));
  }
}

export function parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    if (key === name) {
      return decodeURIComponent(pair.slice(idx + 1).trim());
    }
  }
  return null;
}

function isHttpsRequest(req: Request): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    return true;
  }
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('https://')) {
    return true;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('https://')) {
    return true;
  }
  return req.secure;
}

function formatHttpOnlyCookie(
  req: Request,
  name: string,
  value: string,
  maxAgeSeconds: number
): string {
  const encoded = encodeURIComponent(value);
  if (isHttpsRequest(req)) {
    return `${name}=${encoded}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=None; Partitioned`;
  }
  return `${name}=${encoded}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict`;
}

export function setSessionCookie(req: Request, res: Response, token: string): void {
  const maxAgeSeconds = Math.floor(TOKEN_TTL_MS / 1000);
  res.append('Set-Cookie', formatHttpOnlyCookie(req, SESSION_COOKIE_NAME, token, maxAgeSeconds));
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.append('Set-Cookie', formatHttpOnlyCookie(req, SESSION_COOKIE_NAME, '', 0));
}

export function rememberUserOnDevice(req: Request, res: Response, userId: number): void {
  let deviceId = parseCookieValue(req.headers.cookie, DEVICE_COOKIE_NAME);
  if (!deviceId || deviceId.length < 32) {
    deviceId = crypto.randomBytes(32).toString('hex');
  }
  const deviceIdHash = sha256Hex(deviceId);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO device_accounts (device_id_hash, user_id, last_used_at)
    VALUES (?, ?, ?)
    ON CONFLICT(device_id_hash, user_id) DO UPDATE SET last_used_at = excluded.last_used_at
  `).run(deviceIdHash, userId, now);

  const maxAgeSeconds = Math.floor(DEVICE_TTL_MS / 1000);
  res.append('Set-Cookie', formatHttpOnlyCookie(req, DEVICE_COOKIE_NAME, deviceId, maxAgeSeconds));
}

export interface RememberedAccountSummary {
  email: string;
  name: string;
  city: string;
}

export function getDeviceRememberedAccounts(req: Request): RememberedAccountSummary[] {
  const deviceId = parseCookieValue(req.headers.cookie, DEVICE_COOKIE_NAME);
  if (!deviceId || deviceId.length < 32) return [];
  const deviceIdHash = sha256Hex(deviceId);

  const rows = db
    .prepare(`
      SELECT u.email, u.name, u.city
      FROM device_accounts d
      JOIN users u ON u.id = d.user_id
      WHERE d.device_id_hash = ?
      ORDER BY d.last_used_at DESC
      LIMIT 8
    `)
    .all(deviceIdHash) as unknown as RememberedAccountSummary[];

  return rows;
}

export function verifyDeviceAccountAccess(req: Request, email: string): UserRow | null {
  const deviceId = parseCookieValue(req.headers.cookie, DEVICE_COOKIE_NAME);
  if (!deviceId || deviceId.length < 32) return null;
  const deviceIdHash = sha256Hex(deviceId);
  const cleanEmail = email.trim().toLowerCase();

  const row = db
    .prepare(`
      SELECT u.*
      FROM device_accounts d
      JOIN users u ON u.id = d.user_id
      WHERE d.device_id_hash = ? AND u.email = ?
    `)
    .get(deviceIdHash, cleanEmail) as unknown as UserRow | undefined;

  if (!row) return null;

  db.prepare(
    'UPDATE device_accounts SET last_used_at = ? WHERE device_id_hash = ? AND user_id = ?'
  ).run(new Date().toISOString(), deviceIdHash, row.id);

  return row;
}

export function forgetDeviceAccount(req: Request, email: string): void {
  const deviceId = parseCookieValue(req.headers.cookie, DEVICE_COOKIE_NAME);
  if (!deviceId || deviceId.length < 32) return;
  const deviceIdHash = sha256Hex(deviceId);
  const cleanEmail = email.trim().toLowerCase();

  const user = db
    .prepare('SELECT id FROM users WHERE email = ?')
    .get(cleanEmail) as { id: number } | undefined;
  if (!user) return;

  db.prepare('DELETE FROM device_accounts WHERE device_id_hash = ? AND user_id = ?').run(
    deviceIdHash,
    user.id
  );
}

export function hasValidCsrfCheck(req: Request): boolean {
  if (req.headers['x-requested-with'] === 'XMLHttpRequest') {
    return true;
  }
  const origin = req.headers.origin;
  const host =
    (typeof req.headers['x-forwarded-host'] === 'string' &&
      req.headers['x-forwarded-host'].split(',')[0].trim()) ||
    req.headers.host;
  if (typeof origin === 'string' && typeof host === 'string') {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

export interface AuthenticatedRequest extends Request {
  userId?: number;
  currentUser?: UserRow;
  sessionToken?: string;
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  let usedCookie = false;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length).trim();
  } else {
    token = parseCookieValue(req.headers.cookie, SESSION_COOKIE_NAME);
    usedCookie = Boolean(token);
  }

  if (!token) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  if (
    usedCookie &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase()) &&
    !hasValidCsrfCheck(req)
  ) {
    res.status(403).json({ error: 'Cross-site request blocked.' });
    return;
  }

  const userId = verifySessionToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(userId) as unknown as UserRow | undefined;
  if (!user) {
    res.status(401).json({ error: 'Account not found. Please sign in again.' });
    return;
  }

  req.userId = user.id;
  req.currentUser = user;
  req.sessionToken = token;
  next();
}
