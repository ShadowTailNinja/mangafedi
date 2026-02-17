import { eq, and, desc, lt, sql, ilike, or } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { db } from '../index.js'
import { series, chapters } from '../schema.js'
import type { Series, NewSeries } from '../schema.js'

export async function getSeriesBySlug(slug: string): Promise<Series | null> {
  const rows = await db.replica
    .select()
    .from(series)
    .where(and(eq(series.slug, slug), eq(series.isDeleted, false)))
    .limit(1)
  return rows[0] ?? null
}

export async function getSeriesById(id: string): Promise<Series | null> {
  const rows = await db.replica
    .select()
    .from(series)
    .where(eq(series.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function getSeriesByActorUri(actorUri: string): Promise<Series | null> {
  const rows = await db.replica
    .select()
    .from(series)
    .where(eq(series.actorUri, actorUri))
    .limit(1)
  return rows[0] ?? null
}

export async function listSeries(opts: {
  limit: number
  cursor?: { createdAt: string; id: string }
  contentType?: string
  uploaderId?: string
}): Promise<Series[]> {
  const conditions: SQL[] = [eq(series.isDeleted, false)]

  if (opts.contentType) conditions.push(eq(series.contentType, opts.contentType))
  if (opts.uploaderId) conditions.push(eq(series.uploaderId, opts.uploaderId))
  if (opts.cursor) conditions.push(lt(series.createdAt, new Date(opts.cursor.createdAt)))

  return db.replica
    .select()
    .from(series)
    .where(and(...conditions))
    .orderBy(desc(series.createdAt))
    .limit(opts.limit)
}

export async function searchSeries(q: string, limit: number): Promise<Series[]> {
  return db.replica
    .select()
    .from(series)
    .where(and(
      eq(series.isDeleted, false),
      or(
        ilike(series.title, `%${q}%`),
        ilike(series.description, `%${q}%`),
      )
    ))
    .limit(limit)
}

export async function createSeries(data: NewSeries): Promise<Series> {
  const rows = await db.primary.insert(series).values(data).returning()
  return rows[0]!
}

export async function updateSeries(id: string, data: Partial<Series>): Promise<Series> {
  const rows = await db.primary
    .update(series)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(series.id, id))
    .returning()
  return rows[0]!
}

export async function softDeleteSeries(id: string): Promise<void> {
  await db.primary
    .update(series)
    .set({
      isDeleted: true,
      deletedAt: new Date(),
      knownActorUris: [], // V3: prevents re-binding to tombstoned actor
      updatedAt: new Date(),
    })
    .where(eq(series.id, id))
}

export async function generateSlug(title: string): Promise<string> {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'untitled'
}

export async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  let slug = baseSlug
  let counter = 1
  while (true) {
    const existing = await db.replica
      .select({ id: series.id })
      .from(series)
      .where(eq(series.slug, slug))
      .limit(1)
    if (existing.length === 0) return slug
    slug = `${baseSlug}-${counter++}`
  }
}

export async function countSeriesByUploader(uploaderId: string): Promise<number> {
  const result = await db.replica
    .select({ count: sql<number>`count(*)` })
    .from(series)
    .where(and(eq(series.uploaderId, uploaderId), eq(series.isDeleted, false)))
  return result[0]?.count ?? 0
}

export async function getSeriesByFingerprint(fingerprint: string): Promise<Series[]> {
  return db.replica
    .select()
    .from(series)
    .where(and(
      eq(series.portableKeyFingerprint, fingerprint),
      eq(series.isDeleted, false)
    ))
}
