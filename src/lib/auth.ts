import bcrypt from 'bcrypt'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '../db/index.js'
import { users, sessions, apiTokens } from '../db/schema.js'
import { eq, and, gt, or, isNull } from 'drizzle-orm'
import { AppError } from './errors.js'
import type { User } from '../db/schema.js'

const BCRYPT_ROUNDS = 12
const SESSION_EXPIRY_DAYS = 30
export const SESSION_COOKIE_NAME = 'mangafedi_session'

// V3: ONLY use async bcrypt variants. Sync variants block the event loop.
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateSessionId(): string {
  return randomBytes(32).toString('hex')
}

export async function createSession(userId: string): Promise<string> {
  const id = generateSessionId()
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 86_400_000)
  await db.primary.insert(sessions).values({ id, userId, expiresAt })
  return id
}

export async function validateSession(sessionId: string): Promise<{ user: User; expiresAt: Date } | null> {
  const rows = await db.replica
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(
      eq(sessions.id, sessionId),
      gt(sessions.expiresAt, new Date())
    ))
    .limit(1)
  return rows[0] ?? null
}

export async function validateApiToken(rawToken: string): Promise<User | null> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const rows = await db.replica
    .select({ user: users })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(and(
      eq(apiTokens.tokenHash, tokenHash),
      or(
        isNull(apiTokens.expiresAt),
        gt(apiTokens.expiresAt, new Date())
      )
    ))
    .limit(1)

  if (rows[0]) {
    // Non-blocking background update of last_used_at
    db.primary.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.tokenHash, tokenHash))
      .catch(() => {})
  }

  return rows[0]?.user ?? null
}

export async function deleteSession(sessionId: string): Promise<void> {
  await db.primary.delete(sessions).where(eq(sessions.id, sessionId))
}

export async function generateApiToken(userId: string, name: string, expiresAt?: Date): Promise<string> {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  await db.primary.insert(apiTokens).values({
    userId,
    name,
    tokenHash,
    expiresAt: expiresAt ?? null,
  })
  return rawToken
}

export const sessionCookieOptions = {
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
  maxAge: SESSION_EXPIRY_DAYS * 86_400,
  path: '/',
}

export function generateRsaKeypair(): { publicKey: string; privateKey: string } {
  throw new AppError('INTERNAL_ERROR', 'Use generateRsaKeypairAsync', 500)
}

export async function generateRsaKeypairAsync(): Promise<{ publicKey: string; privateKey: string }> {
  const { generateKeyPair } = await import('node:crypto')
  return new Promise((resolve, reject) => {
    generateKeyPair('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    }, (err, publicKey, privateKey) => {
      if (err) reject(err)
      else resolve({ publicKey, privateKey })
    })
  })
}
