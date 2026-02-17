import {
  createChapter, getChapterById, getChaptersBySeriesId,
  updateChapter, softDeleteChapter, getPagesByChapterId
} from '../db/queries/chapters.js'
import { NotFoundError, ForbiddenError } from '../lib/errors.js'
import type { User, Chapter } from '../db/schema.js'

export function computeSortOrder(chapterNumber: string): number {
  const asFloat = parseFloat(chapterNumber)
  if (!isNaN(asFloat)) return asFloat

  const lower = chapterNumber.toLowerCase()
  if (lower.startsWith('ex'))     return 10000 + (parseInt(lower.slice(2)) || 0)
  if (lower.includes('side'))     return 15000
  if (lower.includes('omake'))    return 20000
  if (lower.includes('special'))  return 25000
  return 99999
}

export async function createNewChapter(
  uploader: User,
  seriesId: string,
  data: {
    chapterNumber: string
    volumeNumber?: string
    title?: string
    language?: string
  }
): Promise<Chapter> {
  const sortOrder = computeSortOrder(data.chapterNumber)
  return createChapter({
    seriesId,
    chapterNumber: data.chapterNumber,
    volumeNumber: data.volumeNumber,
    title: data.title,
    language: data.language ?? 'en',
    sortOrder,
    uploaderId: uploader.id,
  })
}

export { getChapterById, getChaptersBySeriesId, updateChapter, getPagesByChapterId }
