import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth, requireRole } from './middleware.js'
import { getSeriesForSlug } from '../services/series.js'
import { createNewChapter } from '../services/chapters.js'
import { db } from '../db/index.js'
import { uploadSessions, pages, chapters } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { generatePresignedUploadUrl } from '../storage/index.js'
import { pageStorageKey, archiveSessionStorageKey } from '../storage/keys.js'
import { AppError } from '../lib/errors.js'
import { config } from '../config.js'
import type { User } from '../db/schema.js'

const uploadRoutes = new Hono()

// POST /api/v1/upload/chapter-init – individual page upload
uploadRoutes.post('/chapter-init', requireAuth, requireRole('uploader'),
  zValidator('json', z.object({
    seriesSlug: z.string(),
    chapterNumber: z.string(),
    pageCount: z.number().int().min(1).max(500),
    filenames: z.array(z.string()),
  })),
  async (c) => {
    if (!config.features.upload) throw new AppError('UPLOAD_DISABLED', 'Uploads are disabled', 403)
    const user = c.get('user') as User
    const { seriesSlug, chapterNumber, pageCount, filenames } = c.req.valid('json')

    const s = await getSeriesForSlug(seriesSlug)
    const chapter = await createNewChapter(user, s.id, { chapterNumber })

    // Create upload session
    const sessionRows = await db.primary.insert(uploadSessions).values({
      userId: user.id,
      chapterId: chapter.id,
      uploadType: 'individual',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600_000), // 1 hour
    }).returning()
    const session = sessionRows[0]!

    // Pre-create page records
    const maxBytes = config.images.maxUploadMb * 1024 * 1024
    const presignedUrls: Array<{ pageNumber: number; url: string }> = []

    for (let i = 0; i < Math.min(filenames.length, pageCount); i++) {
      const filename = filenames[i] ?? `page-${i + 1}.jpg`
      const ext = filename.split('.').pop() ?? 'jpg'
      const storageKey = pageStorageKey(chapter.id, i + 1, 'original', ext)

      await db.primary.insert(pages).values({
        chapterId: chapter.id,
        pageNumber: i + 1,
        originalStorageKey: storageKey,
        processingStatus: 'pending',
      })

      const url = await generatePresignedUploadUrl(storageKey, `image/${ext === 'jpg' ? 'jpeg' : ext}`, maxBytes)
      presignedUrls.push({ pageNumber: i + 1, url })
    }

    return c.json({ sessionId: session.id, presignedUrls }, 201)
  }
)

// POST /api/v1/upload/chapter-confirm
uploadRoutes.post('/chapter-confirm', requireAuth,
  zValidator('json', z.object({ sessionId: z.string().uuid() })),
  async (c) => {
    const user = c.get('user') as User
    const { sessionId } = c.req.valid('json')

    const sessionRows = await db.primary.select().from(uploadSessions)
      .where(eq(uploadSessions.id, sessionId)).limit(1)
    const session = sessionRows[0]
    if (!session || session.userId !== user.id) throw new AppError('NOT_FOUND', 'Session not found', 404)
    if (session.status !== 'pending') throw new AppError('VALIDATION_ERROR', 'Session already confirmed', 422)

    await db.primary.update(uploadSessions)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(uploadSessions.id, sessionId))

    // Enqueue imageProcess job for each page
    // In production, these would be queued via Fedify/worker
    if (session.chapterId) {
      const pageRows = await db.primary.select().from(pages)
        .where(eq(pages.chapterId, session.chapterId))

      // Queue processing (simplified – in production use federation queue)
      const { processPage } = await import('../worker/jobs/imageProcess.js')
      Promise.all(pageRows.map(p =>
        processPage(p.id).catch(async (err: unknown) => {
          const isAppError = err instanceof Error && 'status' in err
          if (isAppError && (err as { status: number }).status < 500) return
          throw err
        })
      )).catch(console.error)
    }

    return c.json({ success: true, status: 'processing' })
  }
)

// POST /api/v1/upload/archive-init
uploadRoutes.post('/archive-init', requireAuth, requireRole('uploader'),
  zValidator('json', z.object({
    seriesSlug: z.string(),
    chapterNumber: z.string(),
    filename: z.string(),
    fileSizeBytes: z.number().int().positive(),
  })),
  async (c) => {
    if (!config.features.archiveUpload) throw new AppError('UPLOAD_DISABLED', 'Archive uploads are disabled', 403)
    const user = c.get('user') as User
    const { seriesSlug, chapterNumber, filename, fileSizeBytes } = c.req.valid('json')

    const maxBytes = config.archive.maxUploadMb * 1024 * 1024
    if (fileSizeBytes > maxBytes) {
      throw new AppError('ARCHIVE_TOO_LARGE', `Archive exceeds ${config.archive.maxUploadMb}MB limit`, 413)
    }

    const s = await getSeriesForSlug(seriesSlug)
    const chapter = await createNewChapter(user, s.id, { chapterNumber })

    const sessionRows = await db.primary.insert(uploadSessions).values({
      userId: user.id,
      chapterId: chapter.id,
      uploadType: 'archive',
      status: 'pending',
      expiresAt: new Date(Date.now() + 3600_000),
    }).returning()
    const session = sessionRows[0]!

    const ext = filename.split('.').pop() ?? 'zip'
    const archiveKey = archiveSessionStorageKey(session.id, ext)

    await db.primary.update(uploadSessions)
      .set({ archiveStorageKey: archiveKey, updatedAt: new Date() })
      .where(eq(uploadSessions.id, session.id))

    const presignedUrl = await generatePresignedUploadUrl(archiveKey, 'application/zip', fileSizeBytes)

    return c.json({ sessionId: session.id, presignedUrl }, 201)
  }
)

// POST /api/v1/upload/archive-confirm
uploadRoutes.post('/archive-confirm', requireAuth,
  zValidator('json', z.object({ sessionId: z.string().uuid() })),
  async (c) => {
    const user = c.get('user') as User
    const { sessionId } = c.req.valid('json')

    const sessionRows = await db.primary.select().from(uploadSessions)
      .where(eq(uploadSessions.id, sessionId)).limit(1)
    const session = sessionRows[0]
    if (!session || session.userId !== user.id) throw new AppError('NOT_FOUND', 'Session not found', 404)
    if (session.status !== 'pending') throw new AppError('VALIDATION_ERROR', 'Session already confirmed', 422)

    await db.primary.update(uploadSessions)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(uploadSessions.id, sessionId))

    // Enqueue archiveIngest job
    const { processArchive } = await import('../worker/jobs/archiveIngest.js')
    processArchive(sessionId).catch(console.error)

    return c.json({ success: true, status: 'processing' })
  }
)

// GET /api/v1/upload/status/:sessionId
uploadRoutes.get('/status/:sessionId', requireAuth, async (c) => {
  const user = c.get('user') as User
  const sessionId = c.req.param('sessionId')

  const sessionRows = await db.replica.select().from(uploadSessions)
    .where(eq(uploadSessions.id, sessionId)).limit(1)
  const session = sessionRows[0]
  if (!session || session.userId !== user.id) throw new AppError('NOT_FOUND', 'Session not found', 404)

  let pageStatuses: Array<{ pageNumber: number; status: string }> = []
  if (session.chapterId && session.uploadType === 'individual') {
    const pageRows = await db.replica.select({
      pageNumber: pages.pageNumber,
      processingStatus: pages.processingStatus,
    }).from(pages).where(eq(pages.chapterId, session.chapterId))
    pageStatuses = pageRows.map(p => ({ pageNumber: p.pageNumber, status: p.processingStatus }))
  }

  return c.json({
    sessionId: session.id,
    status: session.status,
    uploadType: session.uploadType,
    errorMessage: session.errorMessage,
    pages: pageStatuses,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  })
})

export { uploadRoutes }
