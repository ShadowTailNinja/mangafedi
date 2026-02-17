import type { Federation } from '@fedify/fedify'
import { Follow, Undo, Create, Note, Delete, Like, Accept } from '@fedify/fedify'
import { db } from '../db/index.js'
import { seriesFollows, series } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { getSeriesByActorUri } from '../db/queries/series.js'
import { createComment, softDeleteComment } from '../db/queries/comments.js'
import { getChapterById } from '../db/queries/chapters.js'
import { isDomainBlocked } from '../db/queries/admin.js'
import { AppError } from '../lib/errors.js'

export async function setupInboxListeners(federation: Federation<unknown>) {
  // Follow series
  federation.setInboxListeners('/users/{username}/inbox', '/inbox')
    .on(Follow, async (ctx, follow) => {
      const actor = follow.actorId
      const object = follow.objectId
      if (!actor || !object) return

      // Check if follower domain is blocked
      const domain = actor.hostname
      if (await isDomainBlocked(domain)) return

      const s = await getSeriesByActorUri(object.href)
      if (!s || s.isDeleted) return

      await db.primary.insert(seriesFollows)
        .values({
          seriesId: s.id,
          followerActorUri: actor.href,
          followerInboxUri: `${actor.href}/inbox`,
          isLocal: false,
        })
        .onConflictDoNothing()

      // Send Accept
      const accept = new Accept({ actor: new URL(s.actorUri), object: follow })
      // ctx.sendActivity would be used here with Fedify
    })
    .on(Undo, async (ctx, undo) => {
      const actor = undo.actorId
      const object = await undo.getObject()
      if (!actor || !(object instanceof Follow)) return

      const objectUri = object.objectId
      if (!objectUri) return

      const s = await getSeriesByActorUri(objectUri.href)
      if (!s) return

      await db.primary.delete(seriesFollows)
        .where(and(
          eq(seriesFollows.seriesId, s.id),
          eq(seriesFollows.followerActorUri, actor.href),
        ))
    })
    .on(Create, async (ctx, create) => {
      const object = await create.getObject()
      const actor = create.actorId
      if (!actor || !object) return

      // Check domain blocks
      if (await isDomainBlocked(actor.hostname)) return

      if (object instanceof Note) {
        const replyToId = object.replyTargetIds?.[0]
        if (!replyToId) return

        // Resolve the chapter from the replyToId URL by extracting the UUID.
        // Chapter ActivityPub IDs follow the pattern: .../chapters/{uuid}
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
        const uuidMatch = replyToId.href.match(uuidPattern)
        if (!uuidMatch) return

        const chapter = await getChapterById(uuidMatch[0])
        if (!chapter) return

        const content = object.content?.toString() ?? ''
        const authorName = actor.href.split('/').pop() ?? 'remote'

        await createComment({
          chapterId: chapter.id,
          authorActorUri: actor.href,
          authorUsername: authorName,
          authorDisplayName: authorName,
          content,
          ...(object.id && { activityUri: object.id.href }),
          isLocal: false,
        })
      }
    })
    .on(Delete, async (ctx, deleteActivity) => {
      const objectId = deleteActivity.objectId
      if (!objectId) return

      // Try to find and soft-delete local comment with this activity URI
      const { db: dbInst } = await import('../db/index.js')
      const { comments } = await import('../db/schema.js')
      const rows = await dbInst.primary
        .select()
        .from(comments)
        .where(eq(comments.activityUri, objectId.href))
        .limit(1)

      if (rows[0]) {
        await softDeleteComment(rows[0].id)
      }
    })
    .on(Like, async (ctx, like) => {
      // Store like – future feature
    })
}
