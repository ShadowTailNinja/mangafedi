import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { remoteInstanceHealth } from '../db/schema.js'

export async function shouldAttemptDelivery(domain: string): Promise<boolean> {
  const health = await db.replica
    .select()
    .from(remoteInstanceHealth)
    .where(eq(remoteInstanceHealth.domain, domain))
    .limit(1)

  if (!health[0]?.backoffUntil) return true
  return health[0].backoffUntil < new Date()
}

export async function recordDeliveryResult(domain: string, success: boolean): Promise<void> {
  if (success) {
    await db.primary.insert(remoteInstanceHealth)
      .values({ domain, consecutiveFailures: 0, lastSuccessAt: new Date() })
      .onConflictDoUpdate({
        target: remoteInstanceHealth.domain,
        set: { consecutiveFailures: 0, lastSuccessAt: new Date(), backoffUntil: null }
      })
  } else {
    const rows = await db.replica
      .select()
      .from(remoteInstanceHealth)
      .where(eq(remoteInstanceHealth.domain, domain))
      .limit(1)

    const failures = (rows[0]?.consecutiveFailures ?? 0) + 1
    const backoffMinutes = [1, 5, 30, 120, 1440][Math.min(failures - 1, 4)] ?? 1440
    const backoffUntil = new Date(Date.now() + backoffMinutes * 60_000)

    await db.primary.insert(remoteInstanceHealth)
      .values({ domain, consecutiveFailures: failures, backoffUntil, lastAttemptAt: new Date() })
      .onConflictDoUpdate({
        target: remoteInstanceHealth.domain,
        set: { consecutiveFailures: failures, backoffUntil, lastAttemptAt: new Date() }
      })
  }
}
