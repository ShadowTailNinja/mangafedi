import { eq, and, desc, asc, lt, gt } from 'drizzle-orm'
import { db } from '../index.js'
import { chapters, pages } from '../schema.js'
import type { Chapter, Page, NewChapter } from '../schema.js'

export async function getChapterById(id: string): Promise<Chapter | null> {
  const rows = await db.replica
    .select()
    .from(chapters)
    .where(and(eq(chapters.id, id), eq(chapters.isDeleted, false)))
    .limit(1)
  return rows[0] ?? null
}

export async function getChaptersBySeriesId(
  seriesId: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<Chapter[]> {
  return db.replica
    .select()
    .from(chapters)
    .where(and(eq(chapters.seriesId, seriesId), eq(chapters.isDeleted, false)))
    .orderBy(asc(chapters.sortOrder))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0)
}

export async function getPagesByChapterId(chapterId: string): Promise<Page[]> {
  return db.replica
    .select()
    .from(pages)
    .where(eq(pages.chapterId, chapterId))
    .orderBy(asc(pages.pageNumber))
}

export async function createChapter(data: NewChapter): Promise<Chapter> {
  const rows = await db.primary.insert(chapters).values(data).returning()
  return rows[0]!
}

export async function updateChapter(id: string, data: Partial<Chapter>): Promise<Chapter> {
  const rows = await db.primary
    .update(chapters)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(chapters.id, id))
    .returning()
  return rows[0]!
}

export async function softDeleteChapter(id: string): Promise<void> {
  await db.primary
    .update(chapters)
    .set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(chapters.id, id))
}

export async function getAdjacentChapters(
  seriesId: string,
  sortOrder: number
): Promise<{ prev: Chapter | null; next: Chapter | null }> {
  const [prevRows, nextRows] = await Promise.all([
    db.replica.select().from(chapters)
      .where(and(
        eq(chapters.seriesId, seriesId),
        eq(chapters.isDeleted, false),
        lt(chapters.sortOrder, sortOrder),
      ))
      .orderBy(desc(chapters.sortOrder))
      .limit(1),
    db.replica.select().from(chapters)
      .where(and(
        eq(chapters.seriesId, seriesId),
        eq(chapters.isDeleted, false),
        gt(chapters.sortOrder, sortOrder),
      ))
      .orderBy(asc(chapters.sortOrder))
      .limit(1),
  ])

  return {
    prev: prevRows[0] ?? null,
    next: nextRows[0] ?? null,
  }
}
