import { Hono } from 'hono'
import { browseRoutes } from './routes/browse.js'
import { seriesWebRoutes } from './routes/series.js'
import { readerRoutes } from './routes/reader.js'
import { authWebRoutes } from './routes/auth.js'
import { adminWebRoutes } from './routes/admin.js'
import { userWebRoutes } from './routes/user.js'
import { libraryWebRoutes } from './routes/library.js'
import { uploadWebRoutes } from './routes/upload.js'
import { webMiddleware } from './middleware.js'

const web = new Hono()

// Resolve session and instance config once for all web routes
web.use('*', webMiddleware)

// Serve static files (Caddy handles these in production, but serve as fallback)
web.get('/style.css', async (c) => {
  const { readFile } = await import('node:fs/promises')
  try {
    const css = await readFile('./public/style.css', 'utf8')
    c.header('Content-Type', 'text/css')
    c.header('Cache-Control', 'public, max-age=86400')
    return c.body(css)
  } catch {
    return c.notFound()
  }
})

web.get('/reader.js', async (c) => {
  const { readFile } = await import('node:fs/promises')
  try {
    const js = await readFile('./public/reader.js', 'utf8')
    c.header('Content-Type', 'application/javascript')
    c.header('Cache-Control', 'public, max-age=86400')
    return c.body(js)
  } catch {
    return c.notFound()
  }
})

// Home page redirect to browse
web.get('/', (c) => c.redirect('/browse'))

web.route('/browse', browseRoutes)
web.route('/series', seriesWebRoutes)
web.route('/series', readerRoutes)
web.route('/auth', authWebRoutes)
web.route('/admin', adminWebRoutes)
web.route('/users', userWebRoutes)
web.route('/library', libraryWebRoutes)
web.route('/upload', uploadWebRoutes)

export { web as webApp }
