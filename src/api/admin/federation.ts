import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware.js'
import {
  adminListBlocks, adminAddBlock, adminRemoveBlock,
  adminGetFederationHealth
} from '../../services/admin.js'
import type { User } from '../../db/schema.js'

const app = new Hono()

// GET /api/v1/admin/federation/blocks
app.get('/blocks', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const blocks = await adminListBlocks(admin)
  return c.json({ items: blocks })
})

// POST /api/v1/admin/federation/blocks
app.post('/blocks', requireAuth, requireRole('admin'),
  zValidator('json', z.object({
    domain: z.string().min(3).max(253),
    reason: z.string().max(500).default(''),
  })),
  async (c) => {
    const admin = c.get('user') as User
    const { domain, reason } = c.req.valid('json')
    const block = await adminAddBlock(admin, domain, reason)
    return c.json(block, 201)
  }
)

// DELETE /api/v1/admin/federation/blocks/:domain
app.delete('/blocks/:domain', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const domain = c.req.param('domain')
  await adminRemoveBlock(admin, domain)
  return c.json({ success: true })
})

// GET /api/v1/admin/federation/health
app.get('/health', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const health = await adminGetFederationHealth(admin)
  return c.json({ items: health })
})

export { app as federationAdminRoutes }
