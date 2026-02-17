import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, rateLimitByUser } from './middleware.js'
import { getCommentsByChapterId, createComment, softDeleteComment, getCommentById } from '../db/queries/comments.js'
import { getChapterById } from '../services/chapters.js'
import { submitReport } from '../services/admin.js'
import { NotFoundError, ForbiddenError } from '../lib/errors.js'
import type { User } from '../db/schema.js'
import { config } from '../config.js'

// 10 comments per minute per authenticated user
const commentRateLimit = rateLimitByUser(10, 60_000)

const commentsRoutes = new Hono()

// GET /api/v1/chapters/:id/comments
commentsRoutes.get('/chapters/:id/comments', async (c) => {
  const ch = await getChapterById(c.req.param('id'))
  if (!ch) throw new NotFoundError('Chapter')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100)
  const items = await getCommentsByChapterId(ch.id, limit)
  return c.json({ items })
})

// POST /api/v1/chapters/:id/comments
commentsRoutes.post('/chapters/:id/comments', requireAuth, commentRateLimit,
  zValidator('json', z.object({ content: z.string().min(1).max(5000) })),
  async (c) => {
    const user = c.get('user') as User
    const ch = await getChapterById(c.req.param('id'))
    if (!ch) throw new NotFoundError('Chapter')
    const { content } = c.req.valid('json')

    const comment = await createComment({
      chapterId: ch.id,
      authorId: user.id,
      authorActorUri: user.actorUri,
      authorUsername: user.username,
      authorDisplayName: user.displayName,
      portableKeyFingerprint: user.portableKeyFingerprint,
      content,
      isLocal: true,
    })

    return c.json(comment, 201)
  }
)

// DELETE /api/v1/comments/:id
commentsRoutes.delete('/comments/:id', requireAuth, async (c) => {
  const user = c.get('user') as User
  const comment = await getCommentById(c.req.param('id'))
  if (!comment) throw new NotFoundError('Comment')

  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  const canDelete = comment.authorId === user.id || (hierarchy[user.role] ?? 0) >= 2
  if (!canDelete) throw new ForbiddenError()

  await softDeleteComment(comment.id)
  return c.json({ success: true })
})

// POST /api/v1/comments/:id/report
commentsRoutes.post('/comments/:id/report', requireAuth,
  zValidator('json', z.object({
    reason: z.string().min(1).max(200),
    details: z.string().max(2000).optional(),
  })),
  async (c) => {
    const user = c.get('user') as User
    const comment = await getCommentById(c.req.param('id'))
    if (!comment) throw new NotFoundError('Comment')
    const { reason, details } = c.req.valid('json')
    const report = await submitReport(user, { targetType: 'comment', targetId: comment.id, reason, details })
    return c.json(report, 201)
  }
)

export { commentsRoutes }
