import type { Federation } from '@fedify/fedify'
import { Person, Application, PropertyValue, CryptographicKey, importSpki, importPem } from '@fedify/fedify'
import { getUserByUsername } from '../db/queries/users.js'
import { getSeriesBySlug } from '../db/queries/series.js'
import { config } from '../config.js'
import { decryptPrivateKey } from '../lib/crypto.js'
import { db } from '../db/index.js'
import { seriesFollows } from '../db/schema.js'
import { eq, sql } from 'drizzle-orm'

export async function setupActorDispatchers(federation: Federation<unknown>) {
  // User actors
  federation.setActorDispatcher('/users/{username}', async (ctx, username) => {
    const user = await getUserByUsername(username)
    if (!user || !user.isActive) return null

    const publicCryptoKey = await importSpki(user.publicKey)
    const key = new CryptographicKey({
      id: new URL(`${user.actorUri}#main-key`),
      owner: new URL(user.actorUri),
      publicKey: publicCryptoKey,
    })
    return new Person({
      id: new URL(user.actorUri),
      name: user.displayName,
      preferredUsername: user.username,
      url: new URL(`${config.baseUrl}/users/${user.username}`),
      ...(user.bio && { summary: user.bio }),
      inbox: new URL(user.inboxUri),
      outbox: new URL(`${config.baseUrl}/users/${user.username}/outbox`),
      followers: new URL(`${config.baseUrl}/users/${user.username}/followers`),
      following: new URL(`${config.baseUrl}/users/${user.username}/following`),
      publicKey: key,
      attachments: [
        new PropertyValue({
          name: 'Instance',
          value: config.baseUrl,
        }),
      ],
    })
  })
    .setKeyPairsDispatcher(async (ctx, username) => {
      const user = await getUserByUsername(username)
      if (!user) return []
      const rawPrivateKey = decryptPrivateKey(user.privateKey, config.security.sessionSecret)
      const [publicKey, privateKey] = await Promise.all([
        importSpki(user.publicKey),
        importPem(rawPrivateKey),
      ])
      return [{ publicKey, privateKey }]
    })

  // Series actors (Application type)
  federation.setActorDispatcher('/series/{slug}', async (ctx, slug) => {
    const s = await getSeriesBySlug(slug)
    if (!s || s.isDeleted) return null

    return new Application({
      id: new URL(s.actorUri),
      name: s.title,
      preferredUsername: s.slug,
      url: new URL(`${config.baseUrl}/series/${s.slug}`),
      ...(s.description && { summary: s.description }),
      inbox: new URL(`${config.baseUrl}/series/${s.slug}/inbox`),
      outbox: new URL(`${config.baseUrl}/series/${s.slug}/outbox`),
      followers: new URL(`${config.baseUrl}/series/${s.slug}/followers`),
    })
  })

  // Series followers collection
  federation.setFollowersDispatcher('/series/{slug}/followers', async (ctx, slug) => {
    const s = await getSeriesBySlug(slug)
    if (!s) return null

    const follows = await db.replica
      .select({ followerActorUri: seriesFollows.followerActorUri })
      .from(seriesFollows)
      .where(eq(seriesFollows.seriesId, s.id))

    const { OrderedCollection } = await import('@fedify/fedify')
    return new OrderedCollection({
      totalItems: follows.length,
      items: follows.map(f => new URL(f.followerActorUri)),
    })
  })
}
