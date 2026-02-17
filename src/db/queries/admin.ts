import { eq, and, desc, sql, lt, gt } from 'drizzle-orm'
import { db } from '../index.js'
import {
  instanceConfig, users, reports, dmcaTakedowns,
  instanceBlocks, remoteInstanceHealth
} from '../schema.js'
import type {
  InstanceConfig, Report, DmcaTakedown, InstanceBlock
} from '../schema.js'
import { instanceConfigCache, TTL } from '../../lib/cache.js'

const INSTANCE_CONFIG_CACHE_KEY = 'instance_config'

export async function getInstanceConfig(): Promise<InstanceConfig> {
  const cached = instanceConfigCache.get(INSTANCE_CONFIG_CACHE_KEY) as InstanceConfig | undefined
  if (cached) return cached

  const rows = await db.replica.select().from(instanceConfig).where(eq(instanceConfig.id, 1)).limit(1)
  const cfg = rows[0]
  if (!cfg) throw new Error('Instance config not found')
  instanceConfigCache.set(INSTANCE_CONFIG_CACHE_KEY, cfg, TTL.INSTANCE_CONFIG)
  return cfg
}

export async function updateInstanceConfig(data: Partial<InstanceConfig>): Promise<InstanceConfig> {
  const rows = await db.primary
    .update(instanceConfig)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(instanceConfig.id, 1))
    .returning()
  const updated = rows[0]!
  instanceConfigCache.invalidate(INSTANCE_CONFIG_CACHE_KEY)
  return updated
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────

export async function listReports(opts: {
  limit: number
  offset: number
  status?: string
}): Promise<Report[]> {
  const q = db.primary
    .select()
    .from(reports)
    .orderBy(desc(reports.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)

  if (opts.status) {
    return q.where(eq(reports.status, opts.status))
  }
  return q
}

export async function createReport(data: {
  reporterId?: string
  targetType: string
  targetId: string
  reason: string
  details?: string
}): Promise<Report> {
  const rows = await db.primary.insert(reports).values({
    reporterId: data.reporterId,
    targetType: data.targetType,
    targetId: data.targetId,
    reason: data.reason,
    details: data.details ?? '',
  }).returning()
  return rows[0]!
}

export async function resolveReport(
  reportId: string,
  resolvedById: string,
  resolution: string
): Promise<Report> {
  const rows = await db.primary
    .update(reports)
    .set({
      status: 'resolved',
      resolvedById,
      resolvedAt: new Date(),
      resolution,
    })
    .where(eq(reports.id, reportId))
    .returning()
  return rows[0]!
}

// ─── DMCA TAKEDOWNS ───────────────────────────────────────────────────────────

export async function listTakedowns(opts: {
  limit: number
  offset: number
  status?: string
}): Promise<DmcaTakedown[]> {
  const q = db.primary
    .select()
    .from(dmcaTakedowns)
    .orderBy(desc(dmcaTakedowns.createdAt))
    .limit(opts.limit)
    .offset(opts.offset)

  if (opts.status) {
    return q.where(eq(dmcaTakedowns.status, opts.status))
  }
  return q
}

export async function createTakedown(data: {
  complainantName: string
  complainantEmail: string
  targetType: string
  targetId: string
  targetUrl: string
  description: string
}): Promise<DmcaTakedown> {
  const rows = await db.primary.insert(dmcaTakedowns).values(data).returning()
  return rows[0]!
}

export async function actionTakedown(
  id: string,
  actionedById: string,
  notes: string
): Promise<DmcaTakedown> {
  const rows = await db.primary
    .update(dmcaTakedowns)
    .set({
      status: 'actioned',
      actionedById,
      actionedAt: new Date(),
      notes,
    })
    .where(eq(dmcaTakedowns.id, id))
    .returning()
  return rows[0]!
}

// ─── INSTANCE BLOCKS ──────────────────────────────────────────────────────────

export async function listInstanceBlocks(): Promise<InstanceBlock[]> {
  return db.replica.select().from(instanceBlocks).orderBy(desc(instanceBlocks.createdAt))
}

export async function createInstanceBlock(
  domain: string,
  reason: string,
  blockedById: string
): Promise<InstanceBlock> {
  const rows = await db.primary.insert(instanceBlocks).values({
    domain: domain.toLowerCase(),
    reason,
    blockedById,
  }).returning()
  return rows[0]!
}

export async function deleteInstanceBlock(domain: string): Promise<void> {
  await db.primary
    .delete(instanceBlocks)
    .where(eq(instanceBlocks.domain, domain.toLowerCase()))
}

export async function isDomainBlocked(domain: string): Promise<boolean> {
  const rows = await db.replica
    .select({ domain: instanceBlocks.domain })
    .from(instanceBlocks)
    .where(eq(instanceBlocks.domain, domain.toLowerCase()))
    .limit(1)
  return rows.length > 0
}

// ─── FEDERATION HEALTH ────────────────────────────────────────────────────────

export async function getFederationHealth() {
  return db.replica
    .select()
    .from(remoteInstanceHealth)
    .orderBy(desc(remoteInstanceHealth.consecutiveFailures))
    .limit(100)
}

export async function getAdminStats() {
  const [userCount, seriesCount, reportCount] = await Promise.all([
    db.replica.select({ count: sql<number>`count(*)` }).from(users),
    db.replica.select({ count: sql<number>`count(*)` }).from(
      (await import('../schema.js')).series
    ),
    db.replica
      .select({ count: sql<number>`count(*)` })
      .from(reports)
      .where(eq(reports.status, 'pending')),
  ])

  return {
    totalUsers: userCount[0]?.count ?? 0,
    totalSeries: seriesCount[0]?.count ?? 0,
    pendingReports: reportCount[0]?.count ?? 0,
  }
}
