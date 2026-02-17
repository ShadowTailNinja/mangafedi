import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { config } from '../config.js'
import * as schema from './schema.js'

// App DB – routed through PgBouncer (transaction mode)
const primaryClient = postgres(config.db.primaryUrl, { max: 10 })
const replicaClient = postgres(config.db.replicaUrl ?? config.db.primaryUrl, { max: 10 })

// Queue DB – DIRECT connection to Postgres (bypasses PgBouncer)
// Required for LISTEN/NOTIFY (used by @fedify/postgres queue)
const queueClient = postgres(config.db.queueUrl, {
  max: 2,
  idle_timeout: 0, // Keep connections alive for LISTEN
})

export const db = {
  primary: drizzle(primaryClient, { schema }),
  replica: drizzle(replicaClient, { schema }),
  queue: drizzle(queueClient, { schema }),
}

export type Db = typeof db.primary

export async function testConnection(): Promise<void> {
  try {
    await db.primary.execute(sql`SELECT 1`)
    console.log('✓ Database connection established')
  } catch (e) {
    console.error('✗ Database connection failed:', e)
    process.exit(1)
  }
}

export async function ensureInstanceConfigExists(): Promise<void> {
  const { instanceConfig } = await import('./schema.js')
  const existing = await db.primary.select().from(instanceConfig).limit(1)
  if (existing.length === 0) {
    await db.primary.insert(instanceConfig).values({ id: 1 })
    console.log('✓ Instance config initialized')
  }
}
