/**
 * scripts/createAdmin.ts
 * Creates the initial admin user.
 * Reads ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD from env or prompts interactively.
 * Prints the generated seed phrase once to stdout – the admin must record it.
 * Exits with code 1 if an admin already exists (idempotent-safe).
 */

import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/index.js'
import { users } from '../src/db/schema.js'
import { hashPassword, generateRsaKeypairAsync } from '../src/lib/auth.js'
import { generateUserMnemonic, derivePortableKeypair, encryptPrivateKey } from '../src/lib/crypto.js'
import { config } from '../src/config.js'

async function createAdmin() {
  // Check if admin already exists
  const existing = await db.primary
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1)

  if (existing.length > 0) {
    console.error('An admin user already exists. Exiting.')
    process.exit(1)
  }

  let username: string
  let email: string
  let password: string

  if (process.env['ADMIN_USERNAME'] && process.env['ADMIN_EMAIL'] && process.env['ADMIN_PASSWORD']) {
    username = process.env['ADMIN_USERNAME']
    email = process.env['ADMIN_EMAIL']
    password = process.env['ADMIN_PASSWORD']
  } else {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    username = await rl.question('Admin username: ')
    email = await rl.question('Admin email: ')
    password = await rl.question('Admin password: ')
    rl.close()
  }

  if (!username || !email || !password) {
    console.error('Username, email, and password are required.')
    process.exit(1)
  }

  const mnemonic = generateUserMnemonic()
  const { publicKey: portablePublicKey, fingerprint } = await derivePortableKeypair(mnemonic)
  const { publicKey: rsaPublicKey, privateKey: rsaPrivateKey } = await generateRsaKeypairAsync()
  const encryptedPrivateKey = encryptPrivateKey(rsaPrivateKey, config.security.sessionSecret)

  const actorUri = `${config.baseUrl}/users/${username}`
  const inboxUri = `${config.baseUrl}/users/${username}/inbox`

  await db.primary.insert(users).values({
    username,
    email,
    passwordHash: await hashPassword(password),
    displayName: username,
    role: 'admin',
    actorUri,
    inboxUri,
    publicKey: rsaPublicKey,
    privateKey: encryptedPrivateKey,
    portablePublicKey,
    portableKeyFingerprint: fingerprint,
  })

  console.log('\n✓ Admin user created:', username)
  console.log('\n⚠️  SAVE THIS SEED PHRASE – it will not be shown again:\n')
  console.log(`  ${mnemonic}\n`)
  console.log('This phrase allows you to recover your admin account and content on any MangaFedi instance.')

  process.exit(0)
}

createAdmin().catch((err) => {
  console.error('Failed to create admin:', err)
  process.exit(1)
})
