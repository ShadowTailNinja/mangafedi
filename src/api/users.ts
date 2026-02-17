import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from './middleware.js'
import { getUserProfile, updateUser } from '../services/users.js'
import type { User } from '../db/schema.js'

const usersRoutes = new Hono()

// GET /api/v1/users/:username
usersRoutes.get('/:username', async (c) => {
  const user = await getUserProfile(c.req.param('username'))
  const { passwordHash, privateKey, portablePublicKey, email, ...safe } = user
  void passwordHash; void privateKey; void portablePublicKey; void email
  return c.json(safe)
})

// PATCH /api/v1/users/me
usersRoutes.patch('/me', requireAuth,
  zValidator('json', z.object({
    displayName: z.string().min(1).max(100).optional(),
    bio: z.string().max(1000).optional(),
  })),
  async (c) => {
    const user = c.get('user') as User
    const updates = c.req.valid('json')
    const updated = await updateUser(user.id, updates)
    const { passwordHash, privateKey, portablePublicKey, ...safe } = updated
    void passwordHash; void privateKey; void portablePublicKey
    return c.json(safe)
  }
)

export { usersRoutes }
