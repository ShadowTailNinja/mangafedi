/**
 * Phase 9 – Portable Identity & Data Recovery
 *
 * Account recovery: re-derive keypair from mnemonic, create new account,
 * link old actor URIs, send Update(Person) with alsoKnownAs.
 *
 * Series claim: verify series fingerprint matches mnemonic, re-create
 * actor on this instance, send Update(Application) to followers.
 */

import {
  isValidMnemonic, derivePortableKeypair, generateUserMnemonic,
  encryptPrivateKey
} from '../lib/crypto.js'
import { hashPassword, generateRsaKeypairAsync } from '../lib/auth.js'
import {
  getUserByFingerprint, createUser, updateUser
} from '../db/queries/users.js'
import {
  getUserByUsername, getUserByEmail
} from '../db/queries/users.js'
import { getSeriesByFingerprint } from '../db/queries/series.js'
import { db } from '../db/index.js'
import { series, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { AppError, NotFoundError, GoneError } from '../lib/errors.js'
import { config } from '../config.js'
import type { User, Series } from '../db/schema.js'
import { generateSlug, ensureUniqueSlug } from '../db/queries/series.js'

// ─── ACCOUNT RECOVERY (Phase 9.1) ────────────────────────────────────────────

export interface RecoveryResult {
  user: User
  mnemonic: string
  isNewAccount: boolean
  previousActorUris: string[]
}

export async function recoverAccount(opts: {
  mnemonic: string
  newUsername: string
  newEmail: string
  newPassword: string
}): Promise<RecoveryResult> {
  if (!isValidMnemonic(opts.mnemonic)) {
    throw new AppError('INVALID_MNEMONIC', 'Invalid BIP-39 mnemonic phrase', 400)
  }

  const { publicKey: portablePublicKey, fingerprint } = await derivePortableKeypair(opts.mnemonic)

  // Check username/email availability
  const existingUsername = await getUserByUsername(opts.newUsername)
  if (existingUsername) {
    throw new AppError('VALIDATION_ERROR', 'Username already taken', 422)
  }
  const existingEmail = await getUserByEmail(opts.newEmail)
  if (existingEmail) {
    throw new AppError('VALIDATION_ERROR', 'Email already registered', 422)
  }

  // Find previous user record by fingerprint
  const previousUser = await getUserByFingerprint(fingerprint)

  let previousActorUris: string[] = []
  if (previousUser) {
    previousActorUris = [
      previousUser.actorUri,
      ...previousUser.knownActorUris,
    ]
  }

  // Generate fresh ActivityPub keypair for new account
  const { publicKey: rsaPublicKey, privateKey: rsaPrivateKey } = await generateRsaKeypairAsync()
  const encryptedPrivateKey = encryptPrivateKey(rsaPrivateKey, config.security.sessionSecret)

  const actorUri = `${config.baseUrl}/users/${opts.newUsername}`
  const inboxUri = `${config.baseUrl}/users/${opts.newUsername}/inbox`

  // Create the new user account
  const newUser = await createUser({
    username: opts.newUsername,
    email: opts.newEmail,
    passwordHash: await hashPassword(opts.newPassword),
    displayName: opts.newUsername,
    actorUri,
    inboxUri,
    publicKey: rsaPublicKey,
    privateKey: encryptedPrivateKey,
    portablePublicKey,
    portableKeyFingerprint: fingerprint,
    knownActorUris: previousActorUris,
    role: 'user',
  })

  // If there was a previous user, mark them inactive so their actor URI redirects
  if (previousUser) {
    await updateUser(previousUser.id, {
      isActive: false,
      knownActorUris: [...(previousUser.knownActorUris ?? []), actorUri],
    })
  }

  return {
    user: newUser,
    mnemonic: opts.mnemonic,
    isNewAccount: !previousUser,
    previousActorUris,
  }
}

// ─── SERIES CLAIM (Phase 9.2) ─────────────────────────────────────────────────

export interface SeriesClaimResult {
  series: Series
  previousActorUris: string[]
  isNewActor: boolean
}

export async function claimSeries(opts: {
  mnemonic: string
  uploader: User
}): Promise<SeriesClaimResult> {
  if (!isValidMnemonic(opts.mnemonic)) {
    throw new AppError('INVALID_MNEMONIC', 'Invalid BIP-39 mnemonic phrase', 400)
  }

  const { publicKey: portablePublicKey, fingerprint } = await derivePortableKeypair(opts.mnemonic)

  // Find series by fingerprint – must exist and not be tombstoned
  // V3: tombstoned series have knownActorUris = [] and cannot be re-claimed
  const matchingSeries = await getSeriesByFingerprint(fingerprint)

  if (matchingSeries.length === 0) {
    throw new AppError('NOT_FOUND', 'No series found for this mnemonic', 404)
  }

  // Use the first matching series (most recent in case of multiple)
  const existingSeries = matchingSeries[0]!

  if (existingSeries.isDeleted) {
    throw new GoneError('Series has been tombstoned and cannot be claimed')
  }

  // Build the previous known URIs
  const previousActorUris = [
    existingSeries.actorUri,
    ...(existingSeries.knownActorUris ?? []),
  ]

  // Check if we need to create a new actor on this instance
  const isNewActor = !existingSeries.actorUri.startsWith(config.baseUrl)

  let updatedSeries: Series

  if (isNewActor) {
    // Migrate actor to this instance
    const baseSlug = await generateSlug(existingSeries.title)
    const newSlug = await ensureUniqueSlug(baseSlug)
    const newActorUri = `${config.baseUrl}/series/${newSlug}`

    updatedSeries = (await db.primary
      .update(series)
      .set({
        uploaderId: opts.uploader.id,
        actorUri: newActorUri,
        slug: newSlug,
        knownActorUris: previousActorUris,
        portablePublicKey,
        portableKeyFingerprint: fingerprint,
        updatedAt: new Date(),
      })
      .where(eq(series.id, existingSeries.id))
      .returning())[0]!
  } else {
    // Series is already on this instance – just update ownership
    updatedSeries = (await db.primary
      .update(series)
      .set({
        uploaderId: opts.uploader.id,
        knownActorUris: previousActorUris,
        portablePublicKey,
        portableKeyFingerprint: fingerprint,
        updatedAt: new Date(),
      })
      .where(eq(series.id, existingSeries.id))
      .returning())[0]!
  }

  return {
    series: updatedSeries,
    previousActorUris,
    isNewActor,
  }
}
