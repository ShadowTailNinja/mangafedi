/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import { listSeries } from '../../services/series.js'
import { createNewSeries } from '../../services/series.js'
import { AppError } from '../../lib/errors.js'
import type { InstanceConfig, User } from '../../db/schema.js'
import { config } from '../../config.js'

const uploadWeb = new Hono()

// Guard: uploader role required for all upload routes
uploadWeb.use('/*', async (c, next) => {
  const user = c.get('user') as User | undefined

  if (!user) {
    return c.redirect(`/auth/login?return=${encodeURIComponent(c.req.path)}`)
  }

  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  if ((hierarchy[user.role] ?? 0) < 1) {
    return c.html(
      <Layout title="Forbidden" instanceCfg={c.get('instanceCfg') as InstanceConfig} currentUser={user}>
        <h1>403 — Forbidden</h1>
        <p>You need uploader privileges to access this page. Contact an admin.</p>
      </Layout>,
      403
    )
  }

  return next()
})

// GET /upload — landing: list series you own + links to create new / upload chapter
uploadWeb.get('/', async (c) => {
  const user = c.get('user') as User
  const instanceCfg = c.get('instanceCfg') as InstanceConfig

  const mySeries = await listSeries({ limit: 100, uploaderId: user.id })

  return c.html(
    <Layout title="Upload" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Upload</h1>
      <div style="display:flex;gap:1rem;margin-bottom:2rem;flex-wrap:wrap">
        <a href="/upload/series/new" class="btn btn-primary">+ New Series</a>
      </div>

      {mySeries.length === 0 ? (
        <p style="color:var(--color-text-muted)">
          You haven't created any series yet. <a href="/upload/series/new">Create one to get started.</a>
        </p>
      ) : (
        <>
          <h2 style="margin-bottom:.75rem">Your Series</h2>
          <table class="chapter-list">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Chapters</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mySeries.map(s => (
                <tr key={s.id}>
                  <td><a href={`/series/${s.slug}`}>{s.title}</a></td>
                  <td>{s.contentType}</td>
                  <td>{s.chapterCount}</td>
                  <td>
                    <a href={`/upload/chapter/${s.slug}`} class="btn">
                      + Chapter
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Layout>
  )
})

// GET /upload/series/new — create series form
uploadWeb.get('/series/new', async (c) => {
  const user = c.get('user') as User
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const error = c.req.query('error')

  const allowedTypes = instanceCfg.allowedContentTypes as string[]

  return c.html(
    <Layout title="New Series" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Create New Series</h1>
      {error ? <p class="error" style="color:var(--color-danger)">{decodeURIComponent(error)}</p> : null}
      <form method="post" action="/upload/series/new">
        <div class="form-group">
          <label for="title">Title *</label>
          <input type="text" id="title" name="title" required maxlength={200} />
        </div>
        <div class="form-group">
          <label for="description">Description</label>
          <textarea id="description" name="description" rows={4} maxlength={5000} />
        </div>
        <div class="form-group">
          <label for="contentType">Content Type *</label>
          <select id="contentType" name="contentType" required>
            {allowedTypes.map(t => (
              <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
            ))}
          </select>
        </div>
        <div class="form-group">
          <label for="status">Status</label>
          <select id="status" name="status">
            <option value="ongoing">Ongoing</option>
            <option value="completed">Completed</option>
            <option value="hiatus">Hiatus</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div class="form-group">
          <label for="language">Original Language (2-letter code)</label>
          <input type="text" id="language" name="language" placeholder="en" maxlength={2} />
        </div>
        {instanceCfg.allowNsfw ? (
          <div class="form-group">
            <label>
              <input type="checkbox" name="isNsfw" value="true" />
              {' '}NSFW / Mature content
            </label>
          </div>
        ) : null}
        <button type="submit" class="btn btn-primary">Create Series</button>
      </form>
    </Layout>
  )
})

// POST /upload/series/new — handle creation
uploadWeb.post('/series/new', async (c) => {
  const user = c.get('user') as User
  try {
    const body = await c.req.formData()
    const s = await createNewSeries(user, {
      title: body.get('title')?.toString() ?? '',
      description: body.get('description')?.toString(),
      contentType: body.get('contentType')?.toString() ?? 'manga',
      status: body.get('status')?.toString(),
      language: body.get('language')?.toString() || undefined,
      isNsfw: body.get('isNsfw') === 'true',
    })
    return c.redirect(`/series/${s.slug}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create series'
    return c.redirect(`/upload/series/new?error=${encodeURIComponent(msg)}`)
  }
})

// GET /upload/chapter/:seriesSlug — chapter upload form
uploadWeb.get('/chapter/:seriesSlug', async (c) => {
  const user = c.get('user') as User
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const seriesSlug = c.req.param('seriesSlug')
  const error = c.req.query('error')

  return c.html(
    <Layout title="Upload Chapter" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Upload Chapter</h1>
      <p style="color:var(--color-text-muted);margin-bottom:1rem">
        Series: <a href={`/series/${seriesSlug}`}>{seriesSlug}</a>
      </p>
      {error ? <p class="error" style="color:var(--color-danger)">{decodeURIComponent(error)}</p> : null}

      <div style="display:flex;gap:1rem;flex-wrap:wrap">
        <section style="flex:1;min-width:280px;border:1px solid var(--color-border);border-radius:4px;padding:1rem">
          <h2>Archive Upload (CBZ / ZIP)</h2>
          <p style="font-size:.9rem;color:var(--color-text-muted);margin-bottom:.75rem">
            Upload a CBZ/ZIP archive containing all page images. Maximum {config.archive.maxUploadMb} MB,
            up to {config.archive.maxPages} pages.
          </p>
          <div id="archive-form">
            <div class="form-group">
              <label for="arch-chapter">Chapter Number *</label>
              <input type="text" id="arch-chapter" placeholder="1, 1.5, ex1, special" required />
            </div>
            <div class="form-group">
              <label for="arch-volume">Volume (optional)</label>
              <input type="text" id="arch-volume" placeholder="1" />
            </div>
            <div class="form-group">
              <label for="arch-title">Chapter Title (optional)</label>
              <input type="text" id="arch-title" placeholder="The Beginning" />
            </div>
            <div class="form-group">
              <label for="arch-file">Archive File *</label>
              <input type="file" id="arch-file" accept=".cbz,.zip" required />
            </div>
            <div id="arch-progress" style="display:none;margin-top:.5rem">
              <p id="arch-status">Uploading...</p>
            </div>
            <button type="button" id="arch-submit" class="btn btn-primary"
              onclick={`handleArchiveUpload('${seriesSlug}')`}
            >
              Upload Archive
            </button>
          </div>
        </section>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        async function handleArchiveUpload(seriesSlug) {
          const chapterNumber = document.getElementById('arch-chapter').value.trim();
          const volumeNumber = document.getElementById('arch-volume').value.trim();
          const title = document.getElementById('arch-title').value.trim();
          const file = document.getElementById('arch-file').files[0];
          const status = document.getElementById('arch-status');
          const progressEl = document.getElementById('arch-progress');
          const btn = document.getElementById('arch-submit');

          if (!chapterNumber || !file) {
            alert('Chapter number and file are required.');
            return;
          }

          btn.disabled = true;
          progressEl.style.display = 'block';
          status.textContent = 'Initiating upload...';

          try {
            // 1. Init archive upload
            const initRes = await fetch('/api/v1/upload/archive-init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                seriesSlug,
                chapterNumber,
                volumeNumber: volumeNumber || undefined,
                title: title || undefined,
                filename: file.name,
                fileSizeBytes: file.size,
              }),
            });
            if (!initRes.ok) {
              const err = await initRes.json();
              throw new Error(err.error || 'Init failed');
            }
            const { sessionId, presignedUrl } = await initRes.json();

            // 2. Upload to S3
            status.textContent = 'Uploading archive to storage...';
            const uploadRes = await fetch(presignedUrl, {
              method: 'PUT',
              body: file,
              headers: { 'Content-Type': 'application/octet-stream' },
            });
            if (!uploadRes.ok) throw new Error('S3 upload failed');

            // 3. Confirm
            status.textContent = 'Processing archive...';
            const confirmRes = await fetch('/api/v1/upload/archive-confirm', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId }),
            });
            if (!confirmRes.ok) {
              const err = await confirmRes.json();
              throw new Error(err.error || 'Confirm failed');
            }

            // 4. Poll status
            status.textContent = 'Processing pages... (this may take a moment)';
            let attempts = 0;
            const poll = setInterval(async () => {
              attempts++;
              const statusRes = await fetch('/api/v1/upload/status/' + sessionId);
              const data = await statusRes.json();
              if (data.status === 'complete') {
                clearInterval(poll);
                status.textContent = 'Done! Redirecting...';
                window.location.href = '/series/' + seriesSlug;
              } else if (data.status === 'failed') {
                clearInterval(poll);
                throw new Error('Processing failed: ' + (data.errorMessage || 'Unknown error'));
              } else if (attempts > 120) {
                clearInterval(poll);
                status.textContent = 'Processing is taking longer than expected. Check series page later.';
              } else {
                status.textContent = 'Processing... (' + (data.processedPages || 0) + ' pages done)';
              }
            }, 3000);
          } catch (err) {
            status.textContent = 'Error: ' + err.message;
            btn.disabled = false;
          }
        }
      `}} />
    </Layout>
  )
})

export { uploadWeb as uploadWebRoutes }
