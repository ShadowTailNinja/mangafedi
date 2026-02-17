/**
 * Phase 8 – Admin & Moderation Services
 */

import {
  getInstanceConfig, updateInstanceConfig,
  listReports, createReport, resolveReport,
  listTakedowns, createTakedown, actionTakedown,
  listInstanceBlocks, createInstanceBlock, deleteInstanceBlock,
  getFederationHealth, getAdminStats,
} from '../db/queries/admin.js'
import { getUserById, updateUser, listUsers, countUsers } from '../db/queries/users.js'
import { getSeriesById } from '../db/queries/series.js'
import { getCommentById, softDeleteComment } from '../db/queries/comments.js'
import { deleteFromStorage } from '../storage/index.js'
import { NotFoundError, ForbiddenError, AppError } from '../lib/errors.js'
import type { User, InstanceConfig } from '../db/schema.js'

// ─── INSTANCE CONFIG ──────────────────────────────────────────────────────────

export async function getAdminInstanceConfig(): Promise<InstanceConfig> {
  return getInstanceConfig()
}

export async function patchInstanceConfig(
  admin: User,
  updates: Partial<InstanceConfig>
): Promise<InstanceConfig> {
  assertAdmin(admin)
  // Disallow changing id
  const { id: _id, ...safeUpdates } = updates as InstanceConfig & { id?: number }
  return updateInstanceConfig(safeUpdates)
}

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

export async function adminListUsers(
  admin: User,
  opts: { limit: number; offset: number }
): Promise<{ users: User[]; total: number }> {
  assertAdmin(admin)
  const [userList, total] = await Promise.all([
    listUsers(opts),
    countUsers(),
  ])
  return { users: userList, total }
}

export async function adminUpdateUser(
  admin: User,
  targetUserId: string,
  updates: {
    role?: string
    isBanned?: boolean
    banReason?: string
    isActive?: boolean
  }
): Promise<User> {
  assertAdmin(admin)
  const target = await getUserById(targetUserId)
  if (!target) throw new NotFoundError('User')

  // Prevent self-demotion
  if (targetUserId === admin.id && updates.role && updates.role !== 'admin') {
    throw new AppError('FORBIDDEN', 'Cannot change your own admin role', 403)
  }

  return updateUser(targetUserId, updates)
}

export async function banUser(
  admin: User,
  targetUserId: string,
  reason: string
): Promise<User> {
  assertAdmin(admin)
  const target = await getUserById(targetUserId)
  if (!target) throw new NotFoundError('User')

  return updateUser(targetUserId, {
    isBanned: true,
    banReason: reason,
    isActive: false,
  })
}

export async function unbanUser(admin: User, targetUserId: string): Promise<User> {
  assertAdmin(admin)
  const target = await getUserById(targetUserId)
  if (!target) throw new NotFoundError('User')

  return updateUser(targetUserId, {
    isBanned: false,
    banReason: undefined,
    isActive: true,
  })
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────

export async function adminListReports(
  requestor: User,
  opts: { limit: number; offset: number; status?: string }
) {
  assertModOrAdmin(requestor)
  return listReports(opts)
}

export async function submitReport(
  reporter: User | null,
  data: {
    targetType: string
    targetId: string
    reason: string
    details?: string
  }
) {
  return createReport({
    reporterId: reporter?.id,
    ...data,
  })
}

export async function adminResolveReport(
  moderator: User,
  reportId: string,
  resolution: string
) {
  assertModOrAdmin(moderator)
  return resolveReport(reportId, moderator.id, resolution)
}

// ─── DMCA TAKEDOWNS ───────────────────────────────────────────────────────────

export async function submitDmca(data: {
  complainantName: string
  complainantEmail: string
  targetType: string
  targetId: string
  targetUrl: string
  description: string
}) {
  return createTakedown(data)
}

export async function adminListTakedowns(
  admin: User,
  opts: { limit: number; offset: number; status?: string }
) {
  assertAdmin(admin)
  return listTakedowns(opts)
}

export async function adminActionTakedown(
  admin: User,
  takedownId: string,
  notes: string
) {
  assertAdmin(admin)
  const takedown = (await listTakedowns({ limit: 1, offset: 0 })).find(t => t.id === takedownId)
  if (!takedown) throw new NotFoundError('Takedown')

  const result = await actionTakedown(takedownId, admin.id, notes)

  // Action the target content
  if (takedown.targetType === 'series') {
    const s = await getSeriesById(takedown.targetId)
    if (s) {
      const { softDeleteSeries } = await import('../db/queries/series.js')
      await softDeleteSeries(takedown.targetId)
    }
  } else if (takedown.targetType === 'comment') {
    await softDeleteComment(takedown.targetId)
  }

  return result
}

// ─── FEDERATION BLOCKS ────────────────────────────────────────────────────────

export async function adminListBlocks(admin: User) {
  assertAdmin(admin)
  return listInstanceBlocks()
}

export async function adminAddBlock(admin: User, domain: string, reason: string) {
  assertAdmin(admin)
  if (!isValidDomain(domain)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid domain format', 422)
  }
  return createInstanceBlock(domain, reason, admin.id)
}

export async function adminRemoveBlock(admin: User, domain: string) {
  assertAdmin(admin)
  return deleteInstanceBlock(domain)
}

export async function adminGetFederationHealth(admin: User) {
  assertAdmin(admin)
  return getFederationHealth()
}

export async function adminGetStats(admin: User) {
  assertAdmin(admin)
  return getAdminStats()
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function assertAdmin(user: User): void {
  if (user.role !== 'admin') throw new ForbiddenError()
}

function assertModOrAdmin(user: User): void {
  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  if ((hierarchy[user.role] ?? 0) < 2) throw new ForbiddenError()
}

function isValidDomain(domain: string): boolean {
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i
  return domainRegex.test(domain)
}

export { getInstanceConfig }
