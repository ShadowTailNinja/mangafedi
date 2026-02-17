import { eq, and, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../index.js'
import { users, apiTokens } from '../schema.js'
import type { User, NewUser } from '../schema.js'

export async function getUserById(id: string): Promise<User | null> {
  const rows = await db.replica.select().from(users).where(eq(users.id, id)).limit(1)
  return rows[0] ?? null
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const rows = await db.replica.select().from(users).where(eq(users.username, username)).limit(1)
  return rows[0] ?? null
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db.replica.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0] ?? null
}

export async function getUserByFingerprint(fingerprint: string): Promise<User | null> {
  const rows = await db.replica
    .select()
    .from(users)
    .where(eq(users.portableKeyFingerprint, fingerprint))
    .limit(1)
  return rows[0] ?? null
}

export async function createUser(data: NewUser): Promise<User> {
  const rows = await db.primary.insert(users).values(data).returning()
  return rows[0]!
}

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const rows = await db.primary
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()
  return rows[0]!
}

export async function listUsers(opts: {
  limit: number
  offset: number
  role?: string
}): Promise<User[]> {
  const conditions: SQL[] = []
  if (opts.role) conditions.push(eq(users.role, opts.role))
  return db.primary
    .select()
    .from(users)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .limit(opts.limit)
    .offset(opts.offset)
}

export async function countUsers(): Promise<number> {
  const result = await db.replica.select({ count: sql<number>`count(*)` }).from(users)
  return result[0]?.count ?? 0
}

export async function getUserApiTokens(userId: string) {
  return db.replica.select().from(apiTokens).where(eq(apiTokens.userId, userId))
}

export async function deleteApiToken(tokenId: string, userId: string): Promise<void> {
  await db.primary.delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
}
