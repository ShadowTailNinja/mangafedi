/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { Layout } from '../layout.js'
import { getInstanceConfig } from '../../db/queries/admin.js'
import { registerUser } from '../../services/users.js'
import { verifyPassword, createSession, deleteSession, sessionCookieOptions } from '../../lib/auth.js'
import { getUserByEmail } from '../../db/queries/users.js'
import { AppError } from '../../lib/errors.js'

const authWeb = new Hono()

authWeb.get('/login', async (c) => {
  const instanceCfg = await getInstanceConfig()
  const error = c.req.query('error')
  return c.html(
    <Layout title="Login" instanceCfg={instanceCfg}>
      <div class="auth-form">
        <h1>Login</h1>
        {error && <p class="error">{decodeURIComponent(error)}</p>}
        <form method="post">
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required />
          </div>
          <button type="submit" class="btn btn-primary">Login</button>
          <p><a href="/auth/register">Create account</a></p>
        </form>
      </div>
    </Layout>
  )
})

authWeb.post('/login', async (c) => {
  const body = await c.req.formData()
  const email = body.get('email')?.toString() ?? ''
  const password = body.get('password')?.toString() ?? ''

  try {
    const user = await getUserByEmail(email)
    if (!user || !await verifyPassword(password, user.passwordHash)) {
      throw new AppError('AUTH_REQUIRED', 'Invalid email or password', 401)
    }
    if (user.isBanned) {
      throw new AppError('FORBIDDEN', 'Account suspended', 403)
    }
    const sessionId = await createSession(user.id)
    setCookie(c, sessionCookieOptions.name, sessionId, {
      httpOnly: sessionCookieOptions.httpOnly,
      secure: sessionCookieOptions.secure,
      sameSite: sessionCookieOptions.sameSite,
      maxAge: sessionCookieOptions.maxAge,
      path: sessionCookieOptions.path,
    })
    return c.redirect('/')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Login failed'
    return c.redirect(`/auth/login?error=${encodeURIComponent(msg)}`)
  }
})

authWeb.get('/register', async (c) => {
  const instanceCfg = await getInstanceConfig()
  const error = c.req.query('error')
  return c.html(
    <Layout title="Register" instanceCfg={instanceCfg}>
      <div class="auth-form">
        <h1>Create Account</h1>
        {error && <p class="error">{decodeURIComponent(error)}</p>}
        <form method="post">
          <div class="form-group">
            <label for="username">Username</label>
            <input type="text" id="username" name="username" required minlength={3} maxlength={30} pattern="[a-zA-Z0-9_-]+" />
          </div>
          <div class="form-group">
            <label for="email">Email</label>
            <input type="email" id="email" name="email" required />
          </div>
          <div class="form-group">
            <label for="password">Password</label>
            <input type="password" id="password" name="password" required minlength={8} />
          </div>
          <button type="submit" class="btn btn-primary">Create Account</button>
          <p><a href="/auth/login">Already have an account?</a></p>
        </form>
      </div>
    </Layout>
  )
})

authWeb.post('/register', async (c) => {
  const body = await c.req.formData()
  try {
    const { user, mnemonic } = await registerUser({
      username: body.get('username')?.toString() ?? '',
      email: body.get('email')?.toString() ?? '',
      password: body.get('password')?.toString() ?? '',
    })
    const sessionId = await createSession(user.id)
    setCookie(c, sessionCookieOptions.name, sessionId, {
      httpOnly: sessionCookieOptions.httpOnly,
      secure: sessionCookieOptions.secure,
      sameSite: sessionCookieOptions.sameSite,
      maxAge: sessionCookieOptions.maxAge,
      path: sessionCookieOptions.path,
    })
    const instanceCfg = await getInstanceConfig()
    return c.html(
      <Layout title="Welcome!" instanceCfg={instanceCfg}>
        <div class="auth-form">
          <h1>Welcome, {user.username}!</h1>
          <div class="seed-phrase-box">
            <h2>⚠️ Save Your Seed Phrase</h2>
            <p>This is your portable identity key. It will <strong>never be shown again</strong>. Save it securely.</p>
            <code class="mnemonic">{mnemonic}</code>
            <p>With this phrase, you can recover your account and claim your content on any MangaFedi instance.</p>
          </div>
          <a href="/browse" class="btn btn-primary">Start Browsing</a>
        </div>
      </Layout>
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration failed'
    return c.redirect(`/auth/register?error=${encodeURIComponent(msg)}`)
  }
})

authWeb.get('/logout', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const sessionId = getCookie(c, 'mangafedi_session')
  if (sessionId) await deleteSession(sessionId)
  deleteCookie(c, 'mangafedi_session')
  return c.redirect('/')
})

authWeb.post('/logout', async (c) => {
  const { getCookie } = await import('hono/cookie')
  const sessionId = getCookie(c, 'mangafedi_session')
  if (sessionId) await deleteSession(sessionId)
  deleteCookie(c, 'mangafedi_session')
  return c.redirect('/')
})

export { authWeb as authWebRoutes }
