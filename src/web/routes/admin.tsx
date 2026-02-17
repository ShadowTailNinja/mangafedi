/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import {
  getAdminInstanceConfig, adminListUsers, adminListReports,
  adminListTakedowns, adminListBlocks, adminGetFederationHealth,
  adminGetStats
} from '../../services/admin.js'
import { AppError } from '../../lib/errors.js'
import type { InstanceConfig, User } from '../../db/schema.js'

const adminWeb = new Hono()

// Guard middleware for all admin routes
adminWeb.use('/*', async (c, next) => {
  const user = c.get('user') as User | undefined
  if (!user || (user.role !== 'admin' && user.role !== 'moderator')) {
    return c.html(
      <Layout title="Forbidden" instanceCfg={c.get('instanceCfg') as InstanceConfig} currentUser={user ?? null}>
        <h1>403 Forbidden</h1>
        <p>Admin access required.</p>
      </Layout>,
      403
    )
  }
  return next()
})

// GET /admin
adminWeb.get('/', async (c) => {
  const user = c.get('user') as User
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const stats = await adminGetStats(user)

  return c.html(
    <Layout title="Admin" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Instance Administration</h1>
      <div class="admin-stats">
        <div class="stat-card">
          <span class="stat-value">{stats.totalUsers}</span>
          <span class="stat-label">Total Users</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{stats.totalSeries}</span>
          <span class="stat-label">Total Series</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">{stats.pendingReports}</span>
          <span class="stat-label">Pending Reports</span>
        </div>
      </div>
      <nav class="admin-nav">
        <a href="/admin/instance" class="btn">Instance Config</a>
        <a href="/admin/users" class="btn">Users</a>
        <a href="/admin/reports" class="btn">Reports</a>
        <a href="/admin/takedowns" class="btn">DMCA Takedowns</a>
        <a href="/admin/federation" class="btn">Federation</a>
      </nav>
    </Layout>
  )
})

// GET /admin/instance
adminWeb.get('/instance', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')
  const instanceCfg = await getAdminInstanceConfig()
  const successMsg = c.req.query('saved')

  return c.html(
    <Layout title="Instance Config" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Instance Configuration</h1>
      {successMsg && <p class="success">Settings saved.</p>}
      <form method="post" action="/admin/instance">
        <div class="form-group">
          <label>Instance Name</label>
          <input name="name" value={instanceCfg.name} required />
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description">{instanceCfg.description}</textarea>
        </div>
        <div class="form-group">
          <label>Contact Email</label>
          <input type="email" name="contactEmail" value={instanceCfg.contactEmail ?? ''} />
        </div>
        <div class="form-group">
          <label>Announcement Banner</label>
          <input name="announcement" value={instanceCfg.announcement} />
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="allowNsfw" value="true" checked={instanceCfg.allowNsfw} />
            {' '}Allow NSFW Content
          </label>
        </div>
        <div class="form-group">
          <label>
            <input type="checkbox" name="enableRegistration" value="true" />
            {' '}Open Registration (restart required to change)
          </label>
        </div>
        <div class="form-group">
          <label>Max Series Per User</label>
          <input type="number" name="maxSeriesPerUser" value={String(instanceCfg.maxSeriesPerUser)} min="1" max="1000" />
        </div>
        <div class="form-group">
          <label>Custom CSS</label>
          <textarea name="customCss" rows={10}>{instanceCfg.customCss}</textarea>
        </div>
        <button type="submit" class="btn btn-primary">Save Configuration</button>
      </form>
    </Layout>
  )
})

adminWeb.post('/instance', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')

  const body = await c.req.formData()
  const { updateInstanceConfig } = await import('../../db/queries/admin.js')
  await updateInstanceConfig({
    name: body.get('name')?.toString(),
    description: body.get('description')?.toString(),
    contactEmail: body.get('contactEmail')?.toString() || null,
    announcement: body.get('announcement')?.toString() ?? '',
    allowNsfw: body.get('allowNsfw') === 'true',
    maxSeriesPerUser: parseInt(body.get('maxSeriesPerUser')?.toString() ?? '50'),
    customCss: body.get('customCss')?.toString() ?? '',
  })
  return c.redirect('/admin/instance?saved=1')
})

// GET /admin/users
adminWeb.get('/users', async (c) => {
  const user = c.get('user') as User
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const offset = parseInt(c.req.query('offset') ?? '0')
  const { users: userList, total } = await adminListUsers(user, { limit: 50, offset })

  return c.html(
    <Layout title="Users" instanceCfg={instanceCfg} currentUser={user}>
      <h1>User Management ({total} total)</h1>
      <table class="chapter-list">
        <thead>
          <tr>
            <th>Username</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {userList.map(u => (
            <tr key={u.id}>
              <td><a href={`/users/${u.username}`}>{u.username}</a></td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.isBanned ? '🚫 Banned' : u.isActive ? '✓ Active' : '○ Inactive'}</td>
              <td>
                <a href={`/admin/users/${u.id}`} class="btn">Manage</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > 50 && (
        <div class="pagination">
          {offset > 0 && <a href={`/admin/users?offset=${offset - 50}`}>← Previous</a>}
          {offset + 50 < total && <a href={`/admin/users?offset=${offset + 50}`}>Next →</a>}
        </div>
      )}
    </Layout>
  )
})

// GET /admin/reports
adminWeb.get('/reports', async (c) => {
  const user = c.get('user') as User
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const status = c.req.query('status') ?? 'pending'
  const reports = await adminListReports(user, { limit: 50, offset: 0, status })

  return c.html(
    <Layout title="Reports" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Content Reports</h1>
      <div class="filter-tabs">
        <a href="?status=pending" class={status === 'pending' ? 'active' : ''}>Pending</a>
        <a href="?status=resolved" class={status === 'resolved' ? 'active' : ''}>Resolved</a>
      </div>
      {reports.length === 0 ? (
        <p>No {status} reports.</p>
      ) : (
        <table class="chapter-list">
          <thead>
            <tr>
              <th>Type</th>
              <th>Reason</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map(r => (
              <tr key={r.id}>
                <td>{r.targetType}</td>
                <td>{r.reason}</td>
                <td>{r.createdAt.toLocaleDateString()}</td>
                <td>
                  {r.status === 'pending' && (
                    <form method="post" action={`/admin/reports/${r.id}/resolve`} style="display:inline">
                      <input name="resolution" placeholder="Resolution note" required />
                      <button type="submit" class="btn">Resolve</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  )
})

adminWeb.post('/reports/:id/resolve', async (c) => {
  const user = c.get('user') as User
  const body = await c.req.formData()
  const resolution = body.get('resolution')?.toString() ?? 'Resolved by moderator'
  const { adminResolveReport } = await import('../../services/admin.js')
  await adminResolveReport(user, c.req.param('id'), resolution)
  return c.redirect('/admin/reports')
})

// GET /admin/takedowns
adminWeb.get('/takedowns', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const status = c.req.query('status')
  const takedowns = await adminListTakedowns(user, { limit: 50, offset: 0, status })

  return c.html(
    <Layout title="DMCA Takedowns" instanceCfg={instanceCfg} currentUser={user}>
      <h1>DMCA Takedown Requests</h1>
      <div class="filter-tabs">
        <a href="?status=pending">Pending</a>
        <a href="?status=actioned">Actioned</a>
      </div>
      {takedowns.length === 0 ? (
        <p>No takedown requests.</p>
      ) : (
        <table class="chapter-list">
          <thead>
            <tr>
              <th>Complainant</th>
              <th>Target</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {takedowns.map(t => (
              <tr key={t.id}>
                <td>{t.complainantName}</td>
                <td>{t.targetType}: {t.targetId}</td>
                <td>{t.status}</td>
                <td>{t.createdAt.toLocaleDateString()}</td>
                <td>
                  {t.status === 'pending' && (
                    <form method="post" action={`/admin/takedowns/${t.id}/action`} style="display:inline">
                      <button type="submit" class="btn btn-danger">Action</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Layout>
  )
})

adminWeb.post('/takedowns/:id/action', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')
  const body = await c.req.formData()
  const notes = body.get('notes')?.toString() ?? ''
  const { adminActionTakedown } = await import('../../services/admin.js')
  await adminActionTakedown(user, c.req.param('id'), notes)
  return c.redirect('/admin/takedowns')
})

// GET /admin/federation
adminWeb.get('/federation', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const [blocks, health] = await Promise.all([
    adminListBlocks(user),
    adminGetFederationHealth(user),
  ])

  return c.html(
    <Layout title="Federation" instanceCfg={instanceCfg} currentUser={user}>
      <h1>Federation Management</h1>

      <section>
        <h2>Instance Blocks</h2>
        <form method="post" action="/admin/federation/block" class="inline-form">
          <input name="domain" placeholder="example.social" required />
          <input name="reason" placeholder="Reason (optional)" />
          <button type="submit" class="btn btn-danger">Block Domain</button>
        </form>
        {blocks.length === 0 ? <p>No blocked instances.</p> : (
          <table class="chapter-list">
            <thead><tr><th>Domain</th><th>Reason</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>
              {blocks.map(b => (
                <tr key={b.id}>
                  <td>{b.domain}</td>
                  <td>{b.reason}</td>
                  <td>{b.createdAt.toLocaleDateString()}</td>
                  <td>
                    <form method="post" action={`/admin/federation/unblock/${b.domain}`} style="display:inline">
                      <button type="submit" class="btn btn-danger">Unblock</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Federation Health Dashboard</h2>
        {health.length === 0 ? <p>No remote instance data yet.</p> : (
          <table class="chapter-list">
            <thead><tr><th>Domain</th><th>Failures</th><th>Last Success</th><th>Backoff Until</th></tr></thead>
            <tbody>
              {health.map(h => (
                <tr key={h.domain}>
                  <td>{h.domain}</td>
                  <td>{h.consecutiveFailures}</td>
                  <td>{h.lastSuccessAt?.toLocaleDateString() ?? '—'}</td>
                  <td>{h.backoffUntil ? h.backoffUntil.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Layout>
  )
})

adminWeb.post('/federation/block', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')
  const body = await c.req.formData()
  const domain = body.get('domain')?.toString() ?? ''
  const reason = body.get('reason')?.toString() ?? ''
  await adminAddBlock(user, domain, reason)
  return c.redirect('/admin/federation')
})

adminWeb.post('/federation/unblock/:domain', async (c) => {
  const user = c.get('user') as User
  if (user.role !== 'admin') return c.redirect('/admin')
  const { adminRemoveBlock } = await import('../../services/admin.js')
  await adminRemoveBlock(user, c.req.param('domain'))
  return c.redirect('/admin/federation')
})

// ─── helpers import fix ───────────────────────────────────────────────────────
async function adminAddBlock(user: User, domain: string, reason: string) {
  const { adminAddBlock: fn } = await import('../../services/admin.js')
  return fn(user, domain, reason)
}

export { adminWeb as adminWebRoutes }
