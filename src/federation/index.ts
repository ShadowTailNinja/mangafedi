import { createFederation } from '@fedify/fedify'
import { PostgresKvStore, PostgresMessageQueue } from '@fedify/postgres'
import postgres from 'postgres'
import { config } from '../config.js'

let _federation: ReturnType<typeof createFederation> | null = null

export function getFederation() {
  if (!_federation) {
    throw new Error('Federation not initialized. Call initFederation() first.')
  }
  return _federation
}

export async function initFederation() {
  // V3: Direct Postgres connection for LISTEN/NOTIFY – bypasses PgBouncer
  const queueClient = postgres(config.db.queueUrl, { max: 2, idle_timeout: 0 })

  const kvStore = new PostgresKvStore(queueClient)
  const queue = new PostgresMessageQueue(queueClient)

  _federation = createFederation({
    kv: kvStore,
    queue,
    allowPrivateAddress: config.nodeEnv !== 'production',
  })

  // Actor dispatchers
  const { setupActorDispatchers } = await import('./actors.js')
  await setupActorDispatchers(_federation)

  // Inbox listeners
  const { setupInboxListeners } = await import('./inbox.js')
  await setupInboxListeners(_federation)

  console.log('✓ Federation initialized')
  return _federation
}
