import {
  getSeriesBySlug, getSeriesById, createSeries, updateSeries, softDeleteSeries,
  generateSlug, ensureUniqueSlug, countSeriesByUploader, listSeries, searchSeries,
  getSeriesByFingerprint,
} from '../db/queries/series.js'
import { getInstanceConfig } from '../db/queries/admin.js'
import { NotFoundError, ForbiddenError, AppError, GoneError } from '../lib/errors.js'
import type { User, Series } from '../db/schema.js'
import { config } from '../config.js'

export function inferReadingDirection(contentType: string): 'rtl' | 'ltr' {
  switch (contentType) {
    case 'manga': return 'rtl'
    case 'manhwa': return 'ltr'
    case 'manhua': return 'ltr'
    default: return 'rtl'
  }
}

export async function createNewSeries(
  uploader: User,
  data: {
    title: string
    description?: string
    contentType: string
    status?: string
    language?: string
    tags?: string[]
    isNsfw?: boolean
  }
): Promise<Series> {
  const instanceCfg = await getInstanceConfig()

  const count = await countSeriesByUploader(uploader.id)
  if (count >= instanceCfg.maxSeriesPerUser) {
    throw new AppError('FORBIDDEN', `Maximum series limit (${instanceCfg.maxSeriesPerUser}) reached`, 403)
  }

  if (!instanceCfg.allowedContentTypes.includes(data.contentType)) {
    throw new AppError('VALIDATION_ERROR', `Content type '${data.contentType}' not allowed`, 422)
  }

  if (data.isNsfw && !instanceCfg.allowNsfw) {
    throw new AppError('FORBIDDEN', 'NSFW content is not allowed on this instance', 403)
  }

  const baseSlug = await generateSlug(data.title)
  const slug = await ensureUniqueSlug(baseSlug)
  const actorUri = `${config.baseUrl}/series/${slug}`
  const readingDirection = inferReadingDirection(data.contentType)

  return createSeries({
    slug,
    title: data.title,
    description: data.description ?? '',
    contentType: data.contentType,
    status: data.status ?? 'ongoing',
    readingDirection,
    language: data.language ?? instanceCfg.defaultLanguage,
    tags: data.tags ?? [],
    isNsfw: data.isNsfw ?? false,
    uploaderId: uploader.id,
    actorUri,
  })
}

export async function getSeriesForSlug(slug: string): Promise<Series> {
  const s = await getSeriesBySlug(slug)
  if (!s) throw new NotFoundError('Series')
  if (s.isDeleted) throw new GoneError('Series has been removed')
  return s
}

export async function deleteSeries(seriesId: string, requestor: User): Promise<void> {
  const s = await getSeriesById(seriesId)
  if (!s) throw new NotFoundError('Series')

  const hierarchy: Record<string, number> = { user: 0, uploader: 1, moderator: 2, admin: 3 }
  const userLevel = hierarchy[requestor.role] ?? 0

  if (s.uploaderId !== requestor.id && userLevel < 3) {
    throw new ForbiddenError()
  }

  await softDeleteSeries(seriesId)
  // Federation: send Delete(Application) tombstone – handled by caller
}

export { listSeries, searchSeries, getSeriesBySlug, getSeriesById, updateSeries, getSeriesByFingerprint }
