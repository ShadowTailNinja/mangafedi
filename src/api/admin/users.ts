import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware.js'
import {
  adminListUsers, adminUpdateUser, banUser, unbanUser
} from '../../services/admin.js'
import type { User } from '../../db/schema.js'

const app = new Hono()

// GET /api/v1/admin/users
app.get('/', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50'), 100)
  const offset = parseInt(c.req.query('offset') ?? '0')
  const result = await adminListUsers(admin, { limit, offset })
  return c.json(result)
})

const updateSchema = z.object({
  role: z.enum(['user', 'uploader', 'moderator', 'admin']).optional(),
  isBanned: z.boolean().optional(),
  banReason: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
})

// PATCH /api/v1/admin/users/:id
app.patch('/:id', requireAuth, requireRole('admin'), zValidator('json', updateSchema), async (c) => {
  const admin = c.get('user') as User
  const targetId = c.req.param('id')
  const updates = c.req.valid('json')
  const updated = await adminUpdateUser(admin, targetId, updates)
  return c.json(updated)
})

// POST /api/v1/admin/users/:id/ban
app.post('/:id/ban', requireAuth, requireRole('admin'), zValidator('json', z.object({
  reason: z.string().min(1).max(500),
})), async (c) => {
  const admin = c.get('user') as User
  const targetId = c.req.param('id')
  const { reason } = c.req.valid('json')
  const updated = await banUser(admin, targetId, reason)
  return c.json(updated)
})

// POST /api/v1/admin/users/:id/unban
app.post('/:id/unban', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const targetId = c.req.param('id')
  const updated = await unbanUser(admin, targetId)
  return c.json(updated)
})

export { app as usersAdminRoutes }
