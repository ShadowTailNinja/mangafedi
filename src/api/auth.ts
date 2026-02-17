import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, rateLimitByIp } from './middleware.js'
import { registerUser } from '../services/users.js'
import { recoverAccount } from '../services/identity.js'
import {
  verifyPassword, createSession, deleteSession,
  generateApiToken, sessionCookieOptions
} from '../lib/auth.js'
import { getUserByEmail, getUserApiTokens, deleteApiToken } from '../db/queries/users.js'
import { AppError } from '../lib/errors.js'
import type { User } from '../db/schema.js'

// 10 auth attempts per minute per IP — prevents brute force
const authRateLimit = rateLimitByIp(10, 60_000)

const auth = new Hono()

// POST /api/v1/auth/register
auth.post('/register', authRateLimit, zValidator('json', z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100).optional(),
})), async (c) => {
  const data = c.req.valid('json')
  const { user, mnemonic } = await registerUser(data)
  const sessionId = await createSession(user.id)

  setCookie(c, sessionCookieOptions.name, sessionId, {
    httpOnly: sessionCookieOptions.httpOnly,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
    maxAge: sessionCookieOptions.maxAge,
    path: sessionCookieOptions.path,
  })

  // Return mnemonic ONCE – client must save it
  return c.json({
    user: sanitizeUser(user),
    mnemonic,
    warning: 'Save your seed phrase – it will not be shown again.',
  }, 201)
})

// POST /api/v1/auth/login
auth.post('/login', authRateLimit, zValidator('json', z.object({
  email: z.string().email(),
  password: z.string(),
})), async (c) => {
  const { email, password } = c.req.valid('json')
  const user = await getUserByEmail(email)

  if (!user || !await verifyPassword(password, user.passwordHash)) {
    throw new AppError('AUTH_REQUIRED', 'Invalid credentials', 401)
  }

  if (user.isBanned) {
    throw new AppError('FORBIDDEN', `Account suspended: ${user.banReason ?? 'No reason given'}`, 403)
  }

  const sessionId = await createSession(user.id)
  setCookie(c, sessionCookieOptions.name, sessionId, {
    httpOnly: sessionCookieOptions.httpOnly,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
    maxAge: sessionCookieOptions.maxAge,
    path: sessionCookieOptions.path,
  })

  return c.json({ user: sanitizeUser(user) })
})

// POST /api/v1/auth/logout
auth.post('/logout', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const sessionId = getCookie(c, 'mangafedi_session')
  if (sessionId) await deleteSession(sessionId)
  deleteCookie(c, 'mangafedi_session')
  return c.json({ success: true })
})

// GET /api/v1/auth/me
auth.get('/me', requireAuth, (c) => {
  const user = c.get('user') as User
  return c.json({ user: sanitizeUser(user) })
})

// POST /api/v1/auth/recover – Phase 9
auth.post('/recover', authRateLimit, zValidator('json', z.object({
  mnemonic: z.string(),
  newUsername: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_-]+$/),
  newEmail: z.string().email(),
  newPassword: z.string().min(8).max(128),
})), async (c) => {
  const data = c.req.valid('json')
  const result = await recoverAccount({
    mnemonic: data.mnemonic,
    newUsername: data.newUsername,
    newEmail: data.newEmail,
    newPassword: data.newPassword,
  })

  const sessionId = await createSession(result.user.id)
  setCookie(c, sessionCookieOptions.name, sessionId, {
    httpOnly: sessionCookieOptions.httpOnly,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
    maxAge: sessionCookieOptions.maxAge,
    path: sessionCookieOptions.path,
  })

  return c.json({
    user: sanitizeUser(result.user),
    isNewAccount: result.isNewAccount,
    previousActorUris: result.previousActorUris,
  })
})

// POST /api/v1/auth/tokens
auth.post('/tokens', requireAuth, zValidator('json', z.object({
  name: z.string().min(1).max(100),
  expiresAt: z.string().datetime().optional(),
})), async (c) => {
  const user = c.get('user') as User
  const { name, expiresAt } = c.req.valid('json')
  const token = await generateApiToken(user.id, name, expiresAt ? new Date(expiresAt) : undefined)
  return c.json({ token, name, warning: 'Save this token – it will not be shown again.' }, 201)
})

// DELETE /api/v1/auth/tokens/:id
auth.delete('/tokens/:id', requireAuth, async (c) => {
  const user = c.get('user') as User
  const tokenId = c.req.param('id')
  await deleteApiToken(tokenId, user.id)
  return c.json({ success: true })
})

// GET /api/v1/auth/tokens
auth.get('/tokens', requireAuth, async (c) => {
  const user = c.get('user') as User
  const tokens = await getUserApiTokens(user.id)
  return c.json({
    items: tokens.map(t => ({
      id: t.id,
      name: t.name,
      lastUsedAt: t.lastUsedAt,
      expiresAt: t.expiresAt,
      createdAt: t.createdAt,
    }))
  })
})

function sanitizeUser(user: User) {
  const { passwordHash, privateKey, portablePublicKey, ...safe } = user
  void passwordHash; void privateKey; void portablePublicKey
  return safe
}

export { auth as authRoutes }
