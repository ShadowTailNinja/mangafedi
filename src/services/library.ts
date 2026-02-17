import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { library, readingProgress } from '../db/schema.js'
import { sql } from 'drizzle-orm'
import type { LibraryEntry, User } from '../db/schema.js'
import { AppError } from '../lib/errors.js'

const progressBuffer = new Map<string, { userId: string; chapterId: string; pageNumber: number }>()

export async function getLibrary(userId: string): Promise<LibraryEntry[]> {
  return db.replica.select().from(library).where(eq(library.userId, userId))
}

export async function addToLibrary(userId: string, seriesId: string, status = 'reading'): Promise<LibraryEntry> {
  const rows = await db.primary.insert(library)
    .values({ userId, seriesId, status })
    .onConflictDoUpdate({
      target: [library.userId, library.seriesId],
      set: { status, updatedAt: new Date() }
    })
    .returning()
  return rows[0]!
}

export async function updateLibraryStatus(userId: string, seriesId: string, status: string): Promise<LibraryEntry> {
  const rows = await db.primary
    .update(library)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(library.userId, userId), eq(library.seriesId, seriesId)))
    .returning()
  if (!rows[0]) throw new AppError('NOT_FOUND', 'Library entry not found', 404)
  return rows[0]
}

export async function removeFromLibrary(userId: string, seriesId: string): Promise<void> {
  await db.primary.delete(library)
    .where(and(eq(library.userId, userId), eq(library.seriesId, seriesId)))
}

export function bufferProgressUpdate(userId: string, chapterId: string, pageNumber: number): void {
  progressBuffer.set(`${userId}:${chapterId}`, { userId, chapterId, pageNumber })
}

// Flush progress buffer every 5 seconds
setInterval(async () => {
  if (progressBuffer.size === 0) return
  const updates = Array.from(progressBuffer.values())
  progressBuffer.clear()
  await db.primary.insert(readingProgress).values(updates)
    .onConflictDoUpdate({
      target: [readingProgress.userId, readingProgress.chapterId],
      set: { pageNumber: sql`excluded.page_number`, updatedAt: new Date() }
    })
    .catch(console.error)
}, 5000)

export async function getProgress(userId: string, chapterId: string) {
  const rows = await db.replica
    .select()
    .from(readingProgress)
    .where(and(eq(readingProgress.userId, userId), eq(readingProgress.chapterId, chapterId)))
    .limit(1)
  return rows[0] ?? null
}
