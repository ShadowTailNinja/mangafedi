import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from './middleware.js'
import { createNewChapter, getChapterById, getChaptersBySeriesId, getPagesByChapterId } from '../services/chapters.js'
import { getSeriesForSlug } from '../services/series.js'
import { NotFoundError } from '../lib/errors.js'
import type { User } from '../db/schema.js'

const chaptersRoutes = new Hono()

// GET /api/v1/series/:slug/chapters
chaptersRoutes.get('/series/:slug/chapters', async (c) => {
  const s = await getSeriesForSlug(c.req.param('slug'))
  const chs = await getChaptersBySeriesId(s.id)
  return c.json({ items: chs })
})

// GET /api/v1/chapters/:id
chaptersRoutes.get('/:id', async (c) => {
  const ch = await getChapterById(c.req.param('id'))
  if (!ch) throw new NotFoundError('Chapter')
  return c.json(ch)
})

// GET /api/v1/chapters/:id/pages
chaptersRoutes.get('/:id/pages', async (c) => {
  const ch = await getChapterById(c.req.param('id'))
  if (!ch) throw new NotFoundError('Chapter')
  const pp = await getPagesByChapterId(ch.id)
  return c.json({ items: pp })
})

// POST /api/v1/series/:slug/chapters
chaptersRoutes.post('/series/:slug/chapters', requireAuth, requireRole('uploader'),
  zValidator('json', z.object({
    chapterNumber: z.string().min(1).max(20),
    volumeNumber: z.string().max(10).optional(),
    title: z.string().max(200).optional(),
    language: z.string().length(2).optional(),
  })),
  async (c) => {
    const user = c.get('user') as User
    const s = await getSeriesForSlug(c.req.param('slug'))
    const data = c.req.valid('json')
    const ch = await createNewChapter(user, s.id, data)
    return c.json(ch, 201)
  }
)

export { chaptersRoutes }
