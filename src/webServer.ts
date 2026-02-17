import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { AppError } from './lib/errors.js'
import { config } from './config.js'

export function buildApp(): Hono {
  const app = new Hono()

  // Global error handler – V3 requirement
  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: err.message, code: err.code },
        err.status as never
      )
    }
    console.error('[unhandled error]', err)
    return c.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      500
    )
  })

  // Security headers
  app.use('*', async (c, next) => {
    await next()
    c.res.headers.set('X-Content-Type-Options', 'nosniff')
    c.res.headers.set('X-Frame-Options', 'DENY')
    c.res.headers.set('X-XSS-Protection', '1; mode=block')
    c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (c.req.path.startsWith('/api/')) {
      // Strict CSP for API – not HTML
    } else {
      c.res.headers.set(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' " + config.storage.publicUrl + " data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';"
      )
    }
  })

  return app
}

export async function startWebServer(app: Hono): Promise<void> {
  const { api } = await import('./api/index.js')
  const { webApp } = await import('./web/index.js')
  const { nodeinfoRoutes } = await import('./api/nodeinfo.js')

  // Mount order: federation (handled by Fedify integration) → API → web
  if (config.features.federation) {
    try {
      const { getFederation } = await import('./federation/index.js')
      const { federation: fedifyMiddleware } = await import('@fedify/hono')
      const fed = getFederation()
      app.use(fedifyMiddleware(fed, () => ({})))
    } catch {
      console.warn('Federation not initialized – skipping AP handler')
    }
  }

  app.route('', nodeinfoRoutes)
  app.route('/api/v1', api)
  app.route('', webApp)

  // 404 handler
  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    }
    return c.html('<h1>404 Not Found</h1>', 404)
  })

  return new Promise((resolve) => {
    serve(
      { fetch: app.fetch, port: config.port },
      () => resolve()
    )
  })
}
