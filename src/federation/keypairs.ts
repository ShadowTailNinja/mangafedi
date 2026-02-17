import { decryptPrivateKey } from '../lib/crypto.js'
import { config } from '../config.js'
import type { User, Series } from '../db/schema.js'

export function getUserPrivateKey(user: User): string {
  return decryptPrivateKey(user.privateKey, config.security.sessionSecret)
}

export function getKeyPairForUser(user: User) {
  return {
    publicKey: user.publicKey,
    privateKey: getUserPrivateKey(user),
  }
}
