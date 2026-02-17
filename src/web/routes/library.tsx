/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import { getLibrary } from '../../services/library.js'
import { getSeriesById } from '../../db/queries/series.js'
import { config } from '../../config.js'
import { coverStorageKey, coverPublicUrl } from '../../storage/keys.js'
import type { InstanceConfig, User, LibraryEntry, Series } from '../../db/schema.js'

const libraryWeb = new Hono()

libraryWeb.get('/', async (c) => {
  const currentUser = c.get('user') as User | undefined
  if (!currentUser) {
    return c.redirect('/auth/login?return=/library')
  }
  const instanceCfg = c.get('instanceCfg') as InstanceConfig

  const entries = await getLibrary(currentUser.id)

  // Fetch series details for each entry
  const seriesMap = new Map<string, Series>()
  await Promise.all(
    entries.map(async (entry: LibraryEntry) => {
      const s = await getSeriesById(entry.seriesId)
      if (s) seriesMap.set(entry.seriesId, s)
    })
  )

  const statusOrder: Record<string, number> = {
    reading: 0, plan_to_read: 1, on_hold: 2, completed: 3, dropped: 4,
  }

  const grouped = new Map<string, Array<{ entry: LibraryEntry; series: Series }>>()
  for (const entry of entries) {
    const s = seriesMap.get(entry.seriesId)
    if (!s) continue
    const status = entry.status
    if (!grouped.has(status)) grouped.set(status, [])
    grouped.get(status)!.push({ entry, series: s })
  }

  const statusLabels: Record<string, string> = {
    reading: 'Reading',
    plan_to_read: 'Plan to Read',
    on_hold: 'On Hold',
    completed: 'Completed',
    dropped: 'Dropped',
  }

  const sortedStatuses = Array.from(grouped.keys()).sort(
    (a, b) => (statusOrder[a] ?? 99) - (statusOrder[b] ?? 99)
  )

  return c.html(
    <Layout
      title="My Library"
      instanceCfg={instanceCfg}
      currentUser={currentUser}
    >
      <h1>My Library</h1>
      {entries.length === 0 ? (
        <p style="color:var(--color-text-muted)">
          Your library is empty. <a href="/browse">Browse series</a> to add some.
        </p>
      ) : (
        sortedStatuses.map(status => {
          const group = grouped.get(status) ?? []
          if (group.length === 0) return null
          return (
            <section key={status} style="margin-bottom:2rem">
              <h2 style="margin-bottom:.75rem">{statusLabels[status] ?? status} ({group.length})</h2>
              <div class="series-grid">
                {group.map(({ entry, series: s }) => {
                  const thumbKey = coverStorageKey(s.id, 'thumb')
                  const thumbUrl = s.coverStorageKey
                    ? coverPublicUrl(config.storage.publicUrl, thumbKey, s.coverVersion)
                    : null
                  return (
                    <a href={`/series/${s.slug}`} class="series-card" key={entry.seriesId}>
                      {thumbUrl !== null ? (
                        <img src={thumbUrl} alt={s.title} loading="lazy" />
                      ) : (
                        <div class="series-card-placeholder" />
                      )}
                      <div class="series-card-body">
                        <div class="series-card-title">{s.title}</div>
                        <div class="series-card-meta">{s.chapterCount} ch · {s.contentType}</div>
                      </div>
                    </a>
                  )
                })}
              </div>
            </section>
          )
        })
      )}
    </Layout>
  )
})

export { libraryWeb as libraryWebRoutes }
