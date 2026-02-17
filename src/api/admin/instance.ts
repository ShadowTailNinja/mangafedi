import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware.js'
import {
  getAdminInstanceConfig, patchInstanceConfig, adminGetStats
} from '../../services/admin.js'
import type { User } from '../../db/schema.js'

const app = new Hono()

// GET /api/v1/admin/instance
app.get('/', requireAuth, requireRole('admin'), async (c) => {
  const cfg = await getAdminInstanceConfig()
  return c.json(cfg)
})

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  termsUrl: z.string().url().optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  defaultLanguage: z.string().length(2).optional(),
  allowNsfw: z.boolean().optional(),
  requireEmailVerification: z.boolean().optional(),
  maxSeriesPerUser: z.number().int().min(1).max(1000).optional(),
  allowedContentTypes: z.array(z.string()).optional(),
  customCss: z.string().max(50000).optional(),
  announcement: z.string().max(1000).optional(),
})

// PATCH /api/v1/admin/instance
app.patch('/', requireAuth, requireRole('admin'), zValidator('json', patchSchema), async (c) => {
  const admin = c.get('user') as User
  const updates = c.req.valid('json')
  const cfg = await patchInstanceConfig(admin, updates)
  return c.json(cfg)
})

// GET /api/v1/admin/stats
app.get('/stats', requireAuth, requireRole('admin'), async (c) => {
  const admin = c.get('user') as User
  const stats = await adminGetStats(admin)
  return c.json(stats)
})

export { app as instanceAdminRoutes }
