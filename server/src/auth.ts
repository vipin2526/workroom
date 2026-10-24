import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';
import type { Principal } from './types.js';
import { IS_PRODUCTION } from './wake-config.js';

const SECRET = process.env.JWT_SECRET ?? (IS_PRODUCTION ? '' : 'roomforge-dev-secret');
if (!SECRET) throw new Error('JWT_SECRET is required in production');
if (IS_PRODUCTION && SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters in production');
}
const AGENT_PREFIX = 'rf_';
const SESSION_COOKIE = 'rf_session';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface AuthedRequest extends Request {
  principal?: Principal;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signSessionToken(userId: string, sessionVersion = 0): string {
  return jwt.sign({ ver: sessionVersion }, SECRET, { subject: userId, expiresIn: '7d' });
}

export function newAgentToken(): string {
  return AGENT_PREFIX + crypto.randomBytes(24).toString('base64url');
}

export function hashAgentToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function resolveToken(token: string): Principal | null {
  if (!token) return null;

  if (token.startsWith(AGENT_PREFIX)) {
    const row = db
      .prepare('SELECT id, name, handle, avatar FROM agents WHERE token_hash = ?')
      .get(hashAgentToken(token)) as
      | { id: string; name: string; handle: string | null; avatar: string | null }
      | undefined;
    return row
      ? {
          type: 'agent',
          id: row.id,
          name: row.name,
          ...(row.handle ? { handle: row.handle } : {}),
          ...(row.avatar ? { avatar: row.avatar } : {}),
        }
      : null;
  }

  try {
    const payload = jwt.verify(token, SECRET) as { sub?: string; ver?: number };
    if (!payload.sub) return null;
    const user = db
      .prepare('SELECT id, name, email, handle, avatar, session_version FROM users WHERE id = ?')
      .get(payload.sub) as
      | {
          id: string;
          name: string;
          email: string;
          handle: string | null;
          avatar: string | null;
          session_version: number;
        }
      | undefined;
    if (!user) return null;
    if (Number(user.session_version ?? 0) !== Number(payload.ver ?? 0)) return null;
    return {
      type: 'user',
      id: user.id,
      name: user.name,
      email: user.email,
      ...(user.handle ? { handle: user.handle } : {}),
      ...(user.avatar ? { avatar: user.avatar } : {}),
    };
  } catch {
    return null;
  }
}

export function readSessionToken(req: { headers: { cookie?: string } }): string {
  const header = req.headers.cookie;
  if (!header) return '';
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

export function setSessionCookie(res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (IS_PRODUCTION) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : readSessionToken(req);
  const principal = token ? resolveToken(token) : null;
  if (!principal) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.principal = principal;
  next();
}
