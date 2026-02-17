import type { Context, Next } from 'hono'
import { getInstanceConfig } from '../db/queries/admin.js'
import { resolveUser } from '../api/middleware.js'
import type { User } from '../db/schema.js'

/**
 * Load instance config and optionally resolve the logged-in user.
 * Applied globally to all web routes.
 */
export async function webMiddleware(c: Context, next: Next): Promise<Response | void> {
  const [cfg, user] = await Promise.all([
    getInstanceConfig(),
    resolveUser(c),
  ])
  c.set('instanceCfg', cfg)
  if (user && !user.isBanned) {
    c.set('user', user)
  }
  return next()
}

/**
 * Redirect unauthenticated users to /auth/login.
 * Must be used after webMiddleware.
 */
export async function webRequireAuth(c: Context, next: Next): Promise<Response | void> {
  const user = c.get('user') as User | undefined
  if (!user) {
    const returnTo = encodeURIComponent(c.req.path)
    return c.redirect(`/auth/login?return=${returnTo}`)
  }
  return next()
}

/**
 * Require a minimum role for web routes.
 * Returns 403 HTML on failure.
 */
export function webRequireRole(role: 'uploader' | 'moderator' | 'admin') {
  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  return async (c: Context, next: Next): Promise<Response | void> => {
    const user = c.get('user') as User | undefined
    if (!user || (hierarchy[user.role] ?? 0) < (hierarchy[role] ?? 99)) {
      return c.html('<h1>403 — Forbidden</h1><p>You do not have permission to access this page.</p>', 403)
    }
    return next()
  }
}
