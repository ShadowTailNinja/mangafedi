/** @jsxImportSource hono/jsx */
import type { FC, PropsWithChildren } from 'hono/jsx'
import type { InstanceConfig } from '../db/schema.js'

interface LayoutProps extends PropsWithChildren {
  title: string
  instanceCfg: InstanceConfig
  currentUser?: { username: string; displayName?: string; role: string } | null | undefined
}

export const Layout: FC<LayoutProps> = ({ children, title, instanceCfg, currentUser }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — {instanceCfg.name}</title>
      <link rel="stylesheet" href="/style.css" />
      {instanceCfg.customCss ? (
        <style dangerouslySetInnerHTML={{ __html: instanceCfg.customCss }} />
      ) : null}
    </head>
    <body>
      <header class="site-header">
        <nav>
          <a href="/" class="site-title">{instanceCfg.name}</a>
          <a href="/browse">Browse</a>
          {currentUser !== null && currentUser !== undefined ? (
            <>
              <a href="/library">Library</a>
              <a href={`/users/${currentUser.username}`}>
                {currentUser.displayName ?? currentUser.username}
              </a>
              {currentUser.role === 'uploader' || currentUser.role === 'admin' || currentUser.role === 'moderator' ? (
                <a href="/upload">Upload</a>
              ) : null}
              {currentUser.role === 'admin' || currentUser.role === 'moderator' ? (
                <a href="/admin">Admin</a>
              ) : null}
              <form method="post" action="/auth/logout" style="display:inline">
                <button type="submit" style="background:none;border:none;color:var(--color-primary);cursor:pointer;font-size:inherit;padding:0">
                  Logout
                </button>
              </form>
            </>
          ) : (
            <>
              <a href="/auth/login">Login</a>
              <a href="/auth/register">Register</a>
            </>
          )}
        </nav>
        {instanceCfg.announcement ? (
          <div class="announcement">{instanceCfg.announcement}</div>
        ) : null}
      </header>
      <main>{children}</main>
      <footer>
        <p>
          Powered by MangaFedi
          {' · '}
          <a href="/api/v1/instance">API</a>
          {' · '}
          <a href="/nodeinfo/2.0">NodeInfo</a>
        </p>
      </footer>
    </body>
  </html>
)
