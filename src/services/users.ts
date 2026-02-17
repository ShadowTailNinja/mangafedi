import {
  getUserById, getUserByUsername, getUserByEmail, createUser,
  updateUser, getUserByFingerprint
} from '../db/queries/users.js'
import { hashPassword, generateRsaKeypairAsync } from '../lib/auth.js'
import { generateUserMnemonic, derivePortableKeypair, encryptPrivateKey } from '../lib/crypto.js'
import { NotFoundError, AppError } from '../lib/errors.js'
import { config } from '../config.js'
import type { User } from '../db/schema.js'

export async function registerUser(data: {
  username: string
  email: string
  password: string
  displayName?: string
}): Promise<{ user: User; mnemonic: string }> {
  if (!config.features.registration) {
    throw new AppError('REGISTRATION_CLOSED', 'Registration is closed on this instance', 403)
  }

  const existingUsername = await getUserByUsername(data.username)
  if (existingUsername) throw new AppError('VALIDATION_ERROR', 'Username already taken', 422)

  const existingEmail = await getUserByEmail(data.email)
  if (existingEmail) throw new AppError('VALIDATION_ERROR', 'Email already registered', 422)

  const mnemonic = generateUserMnemonic()
  const { publicKey: portablePublicKey, fingerprint } = await derivePortableKeypair(mnemonic)
  const { publicKey: rsaPublicKey, privateKey: rsaPrivateKey } = await generateRsaKeypairAsync()
  const encryptedPrivateKey = encryptPrivateKey(rsaPrivateKey, config.security.sessionSecret)

  const actorUri = `${config.baseUrl}/users/${data.username}`
  const inboxUri = `${config.baseUrl}/users/${data.username}/inbox`

  const user = await createUser({
    username: data.username,
    email: data.email,
    passwordHash: await hashPassword(data.password),
    displayName: data.displayName ?? data.username,
    actorUri,
    inboxUri,
    publicKey: rsaPublicKey,
    privateKey: encryptedPrivateKey,
    portablePublicKey,
    portableKeyFingerprint: fingerprint,
    role: 'user',
  })

  return { user, mnemonic }
}

export async function getUserProfile(username: string): Promise<User> {
  const user = await getUserByUsername(username)
  if (!user) throw new NotFoundError('User')
  return user
}

export { getUserById, getUserByFingerprint, updateUser }
