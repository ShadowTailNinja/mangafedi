import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { apiVersionHeader } from './middleware.js'
import { authRoutes } from './auth.js'
import { seriesRoutes } from './series.js'
import { chaptersRoutes } from './chapters.js'
import { commentsRoutes } from './comments.js'
import { usersRoutes } from './users.js'
import { searchRoutes } from './search.js'
import { libraryRoutes } from './library.js'
import { progressRoutes } from './progress.js'
import { adminRoutes } from './admin/index.js'
import { uploadRoutes } from './upload.js'
import { getInstanceConfig } from '../db/queries/admin.js'
import { submitDmca } from '../services/admin.js'
import { config } from '../config.js'

const api = new Hono()

// Add version header to all API responses
api.use('*', apiVersionHeader())

// GET /api/v1/instance
api.get('/instance', async (c) => {
  const cfg = await getInstanceConfig()
  return c.json({
    name: cfg.name,
    description: cfg.description,
    version: '1.0.0',
    baseUrl: config.baseUrl,
    features: {
      registration: config.features.registration,
      federation: config.features.federation,
      upload: config.features.upload,
      archiveUpload: config.features.archiveUpload,
    },
    allowNsfw: cfg.allowNsfw,
    allowedContentTypes: cfg.allowedContentTypes,
    contactEmail: cfg.contactEmail,
    termsUrl: cfg.termsUrl,
    announcement: cfg.announcement || undefined,
  })
})

// POST /api/v1/dmca — public, no auth required
api.post('/dmca',
  zValidator('json', z.object({
    complainantName: z.string().min(1).max(200),
    complainantEmail: z.string().email(),
    targetType: z.enum(['series', 'chapter', 'comment']),
    targetId: z.string(),
    targetUrl: z.string().url(),
    description: z.string().min(10).max(5000),
  })),
  async (c) => {
    const data = c.req.valid('json')
    const takedown = await submitDmca(data)
    return c.json(takedown, 201)
  }
)

api.route('/auth', authRoutes)
api.route('/series', seriesRoutes)
api.route('', chaptersRoutes)       // /series/:slug/chapters, /chapters/:id
api.route('', commentsRoutes)       // /chapters/:id/comments, /comments/:id
api.route('/users', usersRoutes)
api.route('/search', searchRoutes)
api.route('/library', libraryRoutes)
api.route('/progress', progressRoutes)  // /progress/:chapterId, /progress/series/:slug
api.route('/upload', uploadRoutes)
api.route('/admin', adminRoutes)

// ActivityPub namespace document
api.get('/ns', (c) => {
  c.header('Content-Type', 'application/ld+json')
  return c.json({
    '@context': {
      manga: `${config.baseUrl}/ns#`,
      MangaChapter: 'manga:MangaChapter',
      MangaSeries: 'manga:MangaSeries',
      ScanlationGroup: 'manga:ScanlationGroup',
      chapterNumber: 'manga:chapterNumber',
      volumeNumber: 'manga:volumeNumber',
      pageCount: 'manga:pageCount',
      readingDirection: 'manga:readingDirection',
      contentType: 'manga:contentType',
      seriesActor: 'manga:seriesActor',
      portableKeyFingerprint: 'manga:portableKeyFingerprint',
    }
  })
})

export { api }
