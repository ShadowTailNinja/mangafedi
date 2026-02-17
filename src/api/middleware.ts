import { cors } from 'hono/cors'
import { getCookie } from 'hono/cookie'
import type { Context, Next } from 'hono'
import { config } from '../config.js'
import { validateSession, validateApiToken } from '../lib/auth.js'
import type { User } from '../db/schema.js'

// ─── IN-MEMORY RATE LIMITER ───────────────────────────────────────────────────
// No Redis dependency — uses a Map with TTL. Compatible with single-process
// deployments. When running multiple app containers, each tracks its own window.
// For multi-instance deployments, replace with a Redis-backed counter at scale.

interface RateLimitEntry {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

// Purge stale entries every minute to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) rateLimitStore.delete(key)
  }
}, 60_000)

export function rateLimit(opts: {
  /** Maximum requests allowed in the window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
  /** Function to extract the rate limit key from the request */
  keyFn: (c: Context) => string
}) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const key = opts.keyFn(c)
    const now = Date.now()
    let entry = rateLimitStore.get(key)

    if (entry === undefined || entry.resetAt < now) {
      entry = { count: 1, resetAt: now + opts.windowMs }
      rateLimitStore.set(key, entry)
    } else {
      entry.count += 1
    }

    if (entry.count > opts.limit) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000)
      c.header('Retry-After', String(retryAfter))
      c.header('X-RateLimit-Limit', String(opts.limit))
      c.header('X-RateLimit-Remaining', '0')
      c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
      return c.json({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
    }

    c.header('X-RateLimit-Limit', String(opts.limit))
    c.header('X-RateLimit-Remaining', String(Math.max(0, opts.limit - entry.count)))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
    return next()
  }
}

/** Rate limit by client IP address (for auth endpoints) */
export const rateLimitByIp = (limit: number, windowMs: number) =>
  rateLimit({
    limit,
    windowMs,
    keyFn: (c) => {
      const forwarded = c.req.header('X-Forwarded-For')
      const ip = forwarded ? forwarded.split(',')[0]?.trim() : 'unknown'
      return `ip:${ip ?? 'unknown'}`
    },
  })

/** Rate limit by authenticated user ID (for user actions) */
export const rateLimitByUser = (limit: number, windowMs: number) =>
  rateLimit({
    limit,
    windowMs,
    keyFn: (c) => {
      const user = c.get('user') as User | undefined
      return `user:${user?.id ?? 'anon'}`
    },
  })

export const apiCors = cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['X-Api-Version'],
})

export const authCors = cors({
  origin: config.baseUrl,
  credentials: true,
})

export async function resolveUser(c: Context): Promise<User | null> {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return validateApiToken(authHeader.slice(7))
  }
  const sessionId = getCookie(c, 'mangafedi_session')
  if (sessionId) {
    const row = await validateSession(sessionId)
    return row?.user ?? null
  }
  return null
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const user = await resolveUser(c)
  if (!user) {
    return c.json({ error: 'Authentication required', code: 'AUTH_REQUIRED' }, 401)
  }
  if (user.isBanned) {
    return c.json({ error: 'Account suspended', code: 'FORBIDDEN' }, 403)
  }
  c.set('user', user)
  return next()
}

export async function optionalAuth(c: Context, next: Next): Promise<Response | void> {
  const user = await resolveUser(c)
  if (user && !user.isBanned) {
    c.set('user', user)
  }
  return next()
}

export function requireRole(role: 'uploader' | 'moderator' | 'admin') {
  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get('user') as User | undefined
    if (!user || (hierarchy[user.role] ?? 0) < (hierarchy[role] ?? 99)) {
      return c.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, 403)
    }
    return next()
  }
}

export function apiVersionHeader() {
  return async (c: Context, next: Next): Promise<Response | void> => {
    await next()
    c.res.headers.set('X-Api-Version', '1.0.0')
  }
}
