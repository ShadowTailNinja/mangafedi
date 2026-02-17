/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import { getSeriesForSlug } from '../../services/series.js'
import { getChaptersBySeriesId } from '../../services/chapters.js'
import { config } from '../../config.js'
import { coverStorageKey, coverPublicUrl } from '../../storage/keys.js'
import type { InstanceConfig, User } from '../../db/schema.js'

const seriesWeb = new Hono()

seriesWeb.get('/:slug', async (c) => {
  const slug = c.req.param('slug')
  const s = await getSeriesForSlug(slug)
  const chapterList = await getChaptersBySeriesId(s.id, { limit: 500 })
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const currentUser = c.get('user') as User | undefined

  const coverUrl = s.coverStorageKey
    ? coverPublicUrl(config.storage.publicUrl, coverStorageKey(s.id, 'full'), s.coverVersion)
    : null

  return c.html(
    <Layout
      title={s.title}
      instanceCfg={instanceCfg}
      currentUser={currentUser}
    >
      <article class="series-detail">
        <div style="display:flex;gap:1.5rem;margin-bottom:1.5rem;flex-wrap:wrap">
          {coverUrl !== null ? (
            <img
              src={coverUrl}
              alt={s.title}
              style="width:180px;border-radius:4px;object-fit:cover;flex-shrink:0"
            />
          ) : null}
          <div>
            <h1 style="margin-bottom:.5rem">{s.title}</h1>
            <p style="color:var(--color-text-muted);margin-bottom:.5rem">
              {s.contentType} · {s.status} · {s.language}
              {' · '}{s.chapterCount} chapters
              {' · '}{s.followerCount} followers
            </p>
            {s.description ? <p>{s.description}</p> : null}
            <p style="margin-top:.75rem">
              <a
                href={`/series/${s.slug}/chapters/${chapterList[0]?.id ?? ''}`}
                class="btn btn-primary"
              >
                Start Reading
              </a>
            </p>
          </div>
        </div>
        <h2>Chapters</h2>
        {chapterList.length === 0 ? (
          <p style="color:var(--color-text-muted)">No chapters yet.</p>
        ) : (
          <table class="chapter-list">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Pages</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {chapterList.map(ch => (
                <tr key={ch.id}>
                  <td>Ch. {ch.chapterNumber}</td>
                  <td>
                    <a href={`/series/${s.slug}/chapters/${ch.id}`}>
                      {ch.title ?? `Chapter ${ch.chapterNumber}`}
                    </a>
                  </td>
                  <td>{ch.pageCount > 0 ? ch.pageCount : '—'}</td>
                  <td>{ch.publishedAt.toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </Layout>
  )
})

export { seriesWeb as seriesWebRoutes }
