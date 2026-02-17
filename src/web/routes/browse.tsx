/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import { listSeries, searchSeries } from '../../services/series.js'
import { config } from '../../config.js'
import { coverStorageKey, coverPublicUrl } from '../../storage/keys.js'
import type { InstanceConfig, User } from '../../db/schema.js'

const browse = new Hono()

browse.get('/', async (c) => {
  const q = c.req.query('q') ?? ''
  const contentType = c.req.query('type')
  const seriesList = await (q.trim()
    ? searchSeries(q.trim(), 40)
    : listSeries({ limit: 40, contentType }))
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const currentUser = c.get('user') as User | undefined

  const pageTitle = q ? `Search: ${q}` : 'Browse'

  return c.html(
    <Layout title={pageTitle} instanceCfg={instanceCfg} currentUser={currentUser}>
      <div style="margin-bottom:1.5rem">
        <h1>{q ? `Results for "${q}"` : 'Browse'}</h1>
        <form method="get" action="/browse" style="display:flex;gap:.5rem;margin-top:.75rem">
          <input
            type="text"
            name="q"
            placeholder="Search series..."
            value={q}
            style="flex:1"
          />
          <button type="submit" class="btn btn-primary">Search</button>
        </form>
        <div class="filter-tabs" style="margin-top:.75rem;display:flex;gap:.5rem">
          <a href="/browse" class={!contentType && !q ? 'btn btn-primary' : 'btn'}>All</a>
          <a href="/browse?type=manga" class={contentType === 'manga' ? 'btn btn-primary' : 'btn'}>Manga</a>
          <a href="/browse?type=manhwa" class={contentType === 'manhwa' ? 'btn btn-primary' : 'btn'}>Manhwa</a>
          <a href="/browse?type=manhua" class={contentType === 'manhua' ? 'btn btn-primary' : 'btn'}>Manhua</a>
        </div>
      </div>
      {seriesList.length === 0 ? (
        <p style="color:var(--color-text-muted)">No series found.</p>
      ) : (
        <div class="series-grid">
          {seriesList.map(s => {
            // Derive thumbnail URL from series ID rather than storing multiple keys
            const thumbKey = coverStorageKey(s.id, 'thumb')
            const thumbUrl = s.coverStorageKey
              ? coverPublicUrl(config.storage.publicUrl, thumbKey, s.coverVersion)
              : null
            return (
              <a href={`/series/${s.slug}`} class="series-card" key={s.id}>
                {thumbUrl !== null ? (
                  <img src={thumbUrl} alt={s.title} loading="lazy" />
                ) : (
                  <div class="series-card-placeholder" />
                )}
                <div class="series-card-body">
                  <div class="series-card-title">{s.title}</div>
                  <div class="series-card-meta">{s.contentType} · {s.chapterCount} ch</div>
                </div>
              </a>
            )
          })}
        </div>
      )}
    </Layout>
  )
})

export { browse as browseRoutes }
