import { config } from '../config.js'
import { db } from '../db/index.js'
import { sessions, uploadSessions } from '../db/schema.js'
import { lt } from 'drizzle-orm'

export async function startWorker() {
  console.log('✓ Background worker started')

  // Hourly cleanup
  setInterval(async () => {
    await runCleanup()
  }, 60 * 60 * 1000)

  // Run immediately on start
  await runCleanup()
}

async function runCleanup() {
  try {
    const now = new Date()

    // Delete expired sessions
    await db.primary.delete(sessions).where(lt(sessions.expiresAt, now))

    // Delete expired upload sessions
    await db.primary.delete(uploadSessions).where(lt(uploadSessions.expiresAt, now))

    console.log(`[worker] Cleanup complete at ${now.toISOString()}`)
  } catch (err) {
    console.error('[worker] Cleanup failed:', err)
  }
}
