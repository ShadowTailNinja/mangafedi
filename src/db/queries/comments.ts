import { eq, and, desc, isNull } from 'drizzle-orm'
import { db } from '../index.js'
import { comments } from '../schema.js'
import type { Comment } from '../schema.js'

export async function getCommentsByChapterId(
  chapterId: string,
  limit: number
): Promise<Comment[]> {
  return db.replica
    .select()
    .from(comments)
    .where(and(eq(comments.chapterId, chapterId), eq(comments.isDeleted, false)))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
}

export async function getCommentsByFingerprint(
  fingerprint: string,
  limit: number
): Promise<Comment[]> {
  return db.replica
    .select()
    .from(comments)
    .where(and(
      eq(comments.portableKeyFingerprint, fingerprint),
      eq(comments.isDeleted, false)
    ))
    .orderBy(desc(comments.createdAt))
    .limit(limit)
}

export async function createComment(data: {
  chapterId: string
  authorId?: string
  authorActorUri: string
  authorUsername: string
  authorDisplayName: string
  portableKeyFingerprint?: string
  content: string
  activityUri?: string
  isLocal: boolean
}): Promise<Comment> {
  const rows = await db.primary.insert(comments).values(data).returning()
  return rows[0]!
}

export async function softDeleteComment(id: string): Promise<void> {
  await db.primary
    .update(comments)
    .set({ isDeleted: true, deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(comments.id, id))
}

export async function getCommentById(id: string): Promise<Comment | null> {
  const rows = await db.replica.select().from(comments).where(eq(comments.id, id)).limit(1)
  return rows[0] ?? null
}
