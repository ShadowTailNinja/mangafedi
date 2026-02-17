/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { Layout } from '../layout.js'
import { getUserProfile } from '../../services/users.js'
import { getCommentsByFingerprint } from '../../db/queries/comments.js'
import type { InstanceConfig, User } from '../../db/schema.js'

const userWeb = new Hono()

userWeb.get('/:username', async (c) => {
  const username = c.req.param('username')
  const profile = await getUserProfile(username)
  const instanceCfg = c.get('instanceCfg') as InstanceConfig
  const currentUser = c.get('user') as User | undefined

  // Show recent comments if profile has a portable key fingerprint
  const recentComments = profile.portableKeyFingerprint
    ? await getCommentsByFingerprint(profile.portableKeyFingerprint, 20)
    : []

  return c.html(
    <Layout
      title={profile.displayName}
      instanceCfg={instanceCfg}
      currentUser={currentUser}
    >
      <article>
        <div style="display:flex;gap:1rem;align-items:flex-start;margin-bottom:1.5rem">
          <div>
            <h1 style="margin-bottom:.25rem">{profile.displayName}</h1>
            <p style="color:var(--color-text-muted)">@{profile.username}</p>
            {profile.bio ? <p style="margin-top:.5rem">{profile.bio}</p> : null}
            <p style="margin-top:.5rem;font-size:.85rem;color:var(--color-text-muted)">
              Role: {profile.role}
              {' · '}
              Joined: {profile.createdAt.toLocaleDateString()}
            </p>
          </div>
        </div>

        {recentComments.length > 0 ? (
          <>
            <h2>Recent Comments</h2>
            <div style="display:flex;flex-direction:column;gap:.75rem;margin-top:.75rem">
              {recentComments.map(comment => (
                <div
                  key={comment.id}
                  style="border:1px solid var(--color-border);border-radius:4px;padding:.75rem"
                >
                  <p style="white-space:pre-wrap">{comment.content}</p>
                  <p style="font-size:.8rem;color:var(--color-text-muted);margin-top:.25rem">
                    {comment.createdAt.toLocaleDateString()}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </article>
    </Layout>
  )
})

export { userWeb as userWebRoutes }
