import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware.js'
import {
  adminListReports, adminResolveReport,
  adminListTakedowns, adminActionTakedown, submitDmca
} from '../../services/admin.js'
import type { User } from '../../db/schema.js'

const app = new Hono()

// GET /api/v1/admin/reports
app.get('/', requireAuth, requireRole('moderator'), async (c) => {
  const mod = c.get('user') as User
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const status = c.req.query('status')
  const reports = await adminListReports(mod, { limit, offset, status })
  return c.json({ items: reports })
})

// POST /api/v1/admin/reports/:id/resolve
app.post('/:id/resolve', requireAuth, requireRole('moderator'),
  zValidator('json', z.object({ resolution: z.string().min(1).max(1000) })),
  async (c) => {
    const mod = c.get('user') as User
    const reportId = c.req.param('id')
    const { resolution } = c.req.valid('json')
    const report = await adminResolveReport(mod, reportId, resolution)
    return c.json(report)
  }
)

// ─── DMCA ─────────────────────────────────────────────────────────────────────

// POST /api/v1/dmca (public)
app.post('/dmca', zValidator('json', z.object({
  complainantName: z.string().min(1).max(200),
  complainantEmail: z.string().email(),
  targetType: z.enum(['series', 'chapter', 'comment']),
  targetId: z.string().uuid(),
  targetUrl: z.string().url(),
  description: z.string().min(10).max(5000),
})), async (c) => {
  const data = c.req.valid('json')
  const takedown = await submitDmca(data)
  return c.json(takedown, 201)
})

// GET /api/v1/admin/takedowns
app.get('/takedowns', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const status = c.req.query('status')
  const items = await adminListTakedowns(admin, { limit, offset, status })
  return c.json({ items })
})

// PATCH /api/v1/admin/takedowns/:id
app.patch('/takedowns/:id', requireAuth, requireRole('admin'),
  zValidator('json', z.object({ notes: z.string().max(2000).default('') })),
  async (c) => {
    const admin = c.get('user') as User
    const id = c.req.param('id')
    const { notes } = c.req.valid('json')
    const result = await adminActionTakedown(admin, id, notes)
    return c.json(result)
  }
)

export { app as reportsAdminRoutes }
