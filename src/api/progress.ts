import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from './middleware.js'
import { bufferProgressUpdate, getProgress } from '../services/library.js'
import { getChaptersBySeriesId } from '../services/chapters.js'
import { getSeriesForSlug } from '../services/series.js'
import { db } from '../db/index.js'
import { readingProgress, chapters } from '../db/schema.js'
import { eq, and, inArray } from 'drizzle-orm'
import type { User } from '../db/schema.js'

const progressRoutes = new Hono()

// GET /api/v1/progress/:chapterId
progressRoutes.get('/:chapterId', requireAuth, async (c) => {
  const user = c.get('user') as User
  const chapterId = c.req.param('chapterId')
  const progress = await getProgress(user.id, chapterId)
  return c.json(progress ?? { pageNumber: 0, completed: false })
})

// POST /api/v1/progress
progressRoutes.post('/', requireAuth,
  zValidator('json', z.object({
    chapterId: z.string().uuid(),
    pageNumber: z.number().int().min(1),
  })),
  async (c) => {
    const user = c.get('user') as User
    const { chapterId, pageNumber } = c.req.valid('json')
    bufferProgressUpdate(user.id, chapterId, pageNumber)
    return c.json({ success: true })
  }
)

// GET /api/v1/progress/series/:slug
// Returns reading progress for all chapters in a series for the current user
progressRoutes.get('/series/:slug', requireAuth, async (c) => {
  const user = c.get('user') as User
  const slug = c.req.param('slug')
  const series = await getSeriesForSlug(slug)
  const chapterList = await getChaptersBySeriesId(series.id, { limit: 500 })
  const chapterIds = chapterList.map(ch => ch.id)

  if (chapterIds.length === 0) {
    return c.json({ items: [] })
  }

  const progressRows = await db.replica
    .select()
    .from(readingProgress)
    .where(
      and(
        eq(readingProgress.userId, user.id),
        inArray(readingProgress.chapterId, chapterIds)
      )
    )

  return c.json({ items: progressRows })
})

export { progressRoutes }
