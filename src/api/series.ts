import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole, rateLimitByUser } from './middleware.js'
import {
  createNewSeries, getSeriesForSlug, deleteSeries,
  listSeries, searchSeries, updateSeries
} from '../services/series.js'
import { claimSeries } from '../services/identity.js'
import type { User } from '../db/schema.js'

const seriesRoutes = new Hono()

// 5 new series per day per uploader — prevents spam
const seriesCreateRateLimit = rateLimitByUser(5, 24 * 60 * 60 * 1000)

// GET /api/v1/series
seriesRoutes.get('/', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 100)
  const contentType = c.req.query('contentType')
  const result = await listSeries({ limit, contentType })
  return c.json({ items: result })
})

// GET /api/v1/series/:slug
seriesRoutes.get('/:slug', async (c) => {
  const s = await getSeriesForSlug(c.req.param('slug'))
  return c.json(s)
})

const createSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  contentType: z.enum(['manga', 'manhwa', 'manhua']),
  status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled']).optional(),
  language: z.string().length(2).optional(),
  tags: z.array(z.string()).max(20).optional(),
  isNsfw: z.boolean().optional(),
})

// POST /api/v1/series
seriesRoutes.post('/', requireAuth, requireRole('uploader'), seriesCreateRateLimit,
  zValidator('json', createSchema), async (c) => {
    const user = c.get('user') as User
    const data = c.req.valid('json')
    const s = await createNewSeries(user, data)
    return c.json(s, 201)
  }
)

// PATCH /api/v1/series/:slug
seriesRoutes.patch('/:slug', requireAuth, zValidator('json', createSchema.partial()), async (c) => {
  const user = c.get('user') as User
  const s = await getSeriesForSlug(c.req.param('slug'))
  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  if (s.uploaderId !== user.id && (hierarchy[user.role] ?? 0) < 2) {
    return c.json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403)
  }
  const updated = await updateSeries(s.id, c.req.valid('json'))
  return c.json(updated)
})

// DELETE /api/v1/series/:slug
seriesRoutes.delete('/:slug', requireAuth, async (c) => {
  const user = c.get('user') as User
  const s = await getSeriesForSlug(c.req.param('slug'))
  await deleteSeries(s.id, user)
  return c.json({ success: true })
})

// POST /api/v1/series/claim – Phase 9
seriesRoutes.post('/claim', requireAuth, requireRole('uploader'),
  zValidator('json', z.object({ mnemonic: z.string() })),
  async (c) => {
    const user = c.get('user') as User
    const { mnemonic } = c.req.valid('json')
    const result = await claimSeries({ mnemonic, uploader: user })
    return c.json(result)
  }
)

export { seriesRoutes }
