/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import { getSeriesForSlug } from '../../services/series.js'
import { getChapterById, getPagesByChapterId, getChaptersBySeriesId } from '../../services/chapters.js'
import { NotFoundError } from '../../lib/errors.js'
import { config } from '../../config.js'
import { pagePublicUrl } from '../../storage/keys.js'
import type { InstanceConfig, User } from '../../db/schema.js'

const reader = new Hono()

reader.get('/:slug/chapters/:chapterId', async (c) => {
  const slug = c.req.param('slug')
  const chapterId = c.req.param('chapterId')

  const [s, chapter] = await Promise.all([
    getSeriesForSlug(slug),
    getChapterById(chapterId),
  ])
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const currentUser = c.get('user') as User | undefined

  if (!chapter) throw new NotFoundError('Chapter')

  // Load all chapters to find adjacent ones efficiently
  const [pages, allChapters] = await Promise.all([
    getPagesByChapterId(chapter.id),
    getChaptersBySeriesId(s.id, { limit: 500 }),
  ])

  const chapterIndex = allChapters.findIndex(ch => ch.id === chapter.id)
  const prevChapter = chapterIndex > 0 ? (allChapters[chapterIndex - 1] ?? null) : null
  const nextChapter = chapterIndex >= 0 && chapterIndex < allChapters.length - 1
    ? (allChapters[chapterIndex + 1] ?? null)
    : null

  const completePages = pages.filter(
    p => p.processingStatus === 'complete' && p.webpStorageKey !== null && p.mobileStorageKey !== null
  )

  const readerData = {
    chapterId: chapter.id,
    seriesSlug: s.slug,
    pages: completePages.map(p => ({
      pageNumber: p.pageNumber,
      fullUrl: pagePublicUrl(config.storage.publicUrl, p.webpStorageKey!, p.version),
      mobileUrl: pagePublicUrl(config.storage.publicUrl, p.mobileStorageKey!, p.version),
      width: p.width,
      height: p.height,
      blurhash: p.blurhash,
    })),
    readingDirection: s.readingDirection,
    nextChapterId: nextChapter?.id ?? null,
    prevChapterId: prevChapter?.id ?? null,
    progressUrl: '/api/v1/progress',
    chapterTitle: `${s.title} Ch. ${chapter.chapterNumber}`,
  }

  const chapterLabel = chapter.title
    ? `Ch. ${chapter.chapterNumber}: ${chapter.title}`
    : `Chapter ${chapter.chapterNumber}`

  return c.html(
    <Layout
      title={`${s.title} — ${chapterLabel}`}
      instanceCfg={instanceCfg}
      currentUser={currentUser}
    >
      <div id="reader">
        <div class="reader-header" style="display:flex;justify-content:space-between;align-items:center;padding:.5rem;background:var(--color-surface);margin-bottom:.5rem">
          <div>
            <a href={`/series/${s.slug}`}>{s.title}</a>
            {' — '}
            {chapterLabel}
          </div>
          <div style="display:flex;gap:.5rem">
            {prevChapter !== null && (
              <a href={`/series/${s.slug}/chapters/${prevChapter.id}`} class="btn">
                ← Ch. {prevChapter.chapterNumber}
              </a>
            )}
            {nextChapter !== null && (
              <a href={`/series/${s.slug}/chapters/${nextChapter.id}`} class="btn">
                Ch. {nextChapter.chapterNumber} →
              </a>
            )}
          </div>
        </div>
        {completePages.length === 0 ? (
          <p style="text-align:center;padding:2rem;color:var(--color-text-muted)">
            This chapter is still being processed. Please check back shortly.
          </p>
        ) : (
          <>
            <div id="reader-pages" />
            <div class="reader-controls">
              <button id="prev-page" class="btn">&#9664;</button>
              <span id="page-indicator">1 / {completePages.length}</span>
              <button id="next-page" class="btn">&#9654;</button>
              <button id="toggle-mode" class="btn">Strip</button>
            </div>
          </>
        )}
      </div>
      <script
        dangerouslySetInnerHTML={{
          __html: `window.READER_DATA = ${JSON.stringify(readerData)};`
        }}
      />
      <script src="/reader.js" />
    </Layout>
  )
})

export { reader as readerRoutes }
