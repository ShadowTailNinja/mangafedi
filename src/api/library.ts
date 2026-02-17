import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from './middleware.js'
import { getLibrary, addToLibrary, updateLibraryStatus, removeFromLibrary, bufferProgressUpdate, getProgress } from '../services/library.js'
import type { User } from '../db/schema.js'

const libraryRoutes = new Hono()

libraryRoutes.get('/', requireAuth, async (c) => {
  const user = c.get('user') as User
  const items = await getLibrary(user.id)
  return c.json({ items })
})

libraryRoutes.post('/', requireAuth,
  zValidator('json', z.object({
    seriesId: z.string().uuid(),
    status: z.enum(['reading', 'completed', 'plan_to_read', 'dropped', 'on_hold']).optional(),
  })),
  async (c) => {
    const user = c.get('user') as User
    const { seriesId, status } = c.req.valid('json')
    const entry = await addToLibrary(user.id, seriesId, status)
    return c.json(entry, 201)
  }
)

libraryRoutes.patch('/:seriesId', requireAuth,
  zValidator('json', z.object({
    status: z.enum(['reading', 'completed', 'plan_to_read', 'dropped', 'on_hold']),
  })),
  async (c) => {
    const user = c.get('user') as User
    const { status } = c.req.valid('json')
    const entry = await updateLibraryStatus(user.id, c.req.param('seriesId'), status)
    return c.json(entry)
  }
)

libraryRoutes.delete('/:seriesId', requireAuth, async (c) => {
  const user = c.get('user') as User
  await removeFromLibrary(user.id, c.req.param('seriesId'))
  return c.json({ success: true })
})

// Progress
libraryRoutes.get('/progress/:chapterId', requireAuth, async (c) => {
  const user = c.get('user') as User
  const progress = await getProgress(user.id, c.req.param('chapterId'))
  return c.json(progress ?? { pageNumber: 0 })
})

libraryRoutes.post('/progress', requireAuth,
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

export { libraryRoutes }
