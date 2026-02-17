import { Hono } from 'hono'
import { searchSeries } from '../services/series.js'
import { AppError } from '../lib/errors.js'

const searchRoutes = new Hono()

// GET /api/v1/search?q=&type=
searchRoutes.get('/', async (c) => {
  const q = c.req.query('q')?.trim()
  if (!q || q.length < 2) {
    throw new AppError('VALIDATION_ERROR', 'Search query must be at least 2 characters', 422)
  }

  const type = c.req.query('type') ?? 'series'
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20'), 50)

  if (type === 'series') {
    const results = await searchSeries(q, limit)
    return c.json({ items: results, type: 'series' })
  }

  return c.json({ items: [], type })
})

export { searchRoutes }
