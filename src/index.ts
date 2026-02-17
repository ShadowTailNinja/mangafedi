import { config } from './config.js'
import { testConnection, ensureInstanceConfigExists, db } from './db/index.js'

async function main() {
  console.log(`MangaFedi starting in ${config.runMode} mode...`)

  // 1. Test DB connection
  await testConnection()

  // 2. Run migrations
  const { migrate } = await import('drizzle-orm/postgres-js/migrator')
  await migrate(db.primary, { migrationsFolder: './migrations' })
  console.log('✓ Migrations applied')

  // 3. Ensure instance config row exists
  await ensureInstanceConfigExists()

  // 4. Initialize federation (if enabled)
  if (config.features.federation && (config.runMode === 'all' || config.runMode === 'web')) {
    const { initFederation } = await import('./federation/index.js')
    await initFederation()
  }

  // 5. Start web server
  if (config.runMode === 'web' || config.runMode === 'all') {
    const { buildApp, startWebServer } = await import('./webServer.js')
    const app = buildApp()
    await startWebServer(app)
    console.log(`✓ Web server listening on :${config.port}`)
  }

  // 6. Start background worker
  if (config.runMode === 'worker' || config.runMode === 'all') {
    const { startWorker } = await import('./worker/index.js')
    await startWorker()
    console.log('✓ Background worker started')
  }

  console.log('✓ MangaFedi ready')
}

main().catch((err) => {
  console.error('Fatal startup error:', err)
  process.exit(1)
})
