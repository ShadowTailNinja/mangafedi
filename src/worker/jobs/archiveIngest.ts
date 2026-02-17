import unzipper from 'unzipper'
import { encode } from 'blurhash'
import sharp from 'sharp'
import path from 'node:path'
import { config } from '../../config.js'
import { AppError } from '../../lib/errors.js'
import { downloadFromStorage, uploadToStorage } from '../../storage/index.js'
import { db } from '../../db/index.js'
import { pages, uploadSessions, chapters } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

const SKIP_PATTERNS = [
  /^__MACOSX\//i,
  /\.DS_Store$/i,
  /Thumbs\.db$/i,
  /ComicInfo\.xml$/i,
  /^\./,          // hidden files
]

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif)$/i

const MAGIC_BYTES: Array<{ bytes: number[]; mask?: number[] }> = [
  { bytes: [0xFF, 0xD8, 0xFF] },                    // JPEG
  { bytes: [0x89, 0x50, 0x4E, 0x47] },              // PNG
  { bytes: [0x52, 0x49, 0x46, 0x46] },              // WEBP (RIFF)
  { bytes: [0x47, 0x49, 0x46] },                     // GIF
]

function isValidImageMagicBytes(buffer: Buffer): boolean {
  return MAGIC_BYTES.some(magic =>
    magic.bytes.every((byte, i) => buffer[i] === byte)
  )
}

function safePath(entryName: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, entryName)
  if (!resolved.startsWith(path.resolve(baseDir))) {
    throw new AppError('VALIDATION_ERROR', `Zip-slip attempt: ${entryName}`, 400)
  }
  return resolved
}

export async function processArchive(sessionId: string): Promise<void> {
  const sessionRows = await db.primary
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.id, sessionId))
    .limit(1)

  const session = sessionRows[0]
  if (!session) throw new AppError('NOT_FOUND', 'Upload session not found', 404)
  if (!session.archiveStorageKey) throw new AppError('VALIDATION_ERROR', 'No archive key on session', 400)
  if (!session.chapterId) throw new AppError('VALIDATION_ERROR', 'No chapter on session', 400)

  const archiveBuffer = await downloadFromStorage(session.archiveStorageKey)
  const directory = await unzipper.Open.buffer(archiveBuffer)

  const imageEntries = directory.files
    .filter(entry => {
      if (entry.type !== 'File') return false
      // Zip-slip protection
      try { safePath(entry.path, '/tmp') } catch { return false }
      if (SKIP_PATTERNS.some(p => p.test(entry.path))) return false
      return IMAGE_EXTENSIONS.test(entry.path)
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))

  if (imageEntries.length > config.archive.maxPages) {
    await db.primary.update(uploadSessions)
      .set({ status: 'failed', errorMessage: `Archive has ${imageEntries.length} images, max is ${config.archive.maxPages}`, updatedAt: new Date() })
      .where(eq(uploadSessions.id, sessionId))
    throw new AppError('ARCHIVE_TOO_MANY_PAGES',
      `Archive has ${imageEntries.length} images, max is ${config.archive.maxPages}`, 422)
  }

  let processedCount = 0

  // Process SEQUENTIALLY to bound peak memory usage
  for (let i = 0; i < imageEntries.length; i++) {
    const entry = imageEntries[i]!
    const buffer = await entry.buffer()

    if (!isValidImageMagicBytes(buffer)) {
      console.warn(`[archiveIngest] Non-image magic bytes in entry: ${entry.path} – skipping`)
      continue
    }

    const metadata = await sharp(buffer).metadata()
    const inputWidth = metadata.width ?? 0
    const inputHeight = metadata.height ?? 0

    if (inputWidth > config.images.maxDimensionPx || inputHeight > config.images.maxDimensionPx) {
      console.warn(`[archiveIngest] Entry ${entry.path} exceeds dimension limit – skipping`)
      continue
    }

    const pageNumber = i + 1
    const baseKey = `chapters/${session.chapterId}/pages/${String(pageNumber).padStart(3, '0')}`
    const ext = entry.path.split('.').pop() ?? 'jpg'
    const originalKey = `${baseKey}/original.${ext}`

    const image = sharp(buffer, {
      limitInputPixels: config.images.maxDimensionPx * config.images.maxDimensionPx,
    })

    const [fullWebp, mobileWebp] = await Promise.all([
      image.clone()
        .resize({ width: Math.min(inputWidth, 2000), withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer(),
      image.clone()
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer(),
    ])

    const tiny = await image.clone()
      .resize(64, 64, { fit: 'inside' })
      .raw()
      .ensureAlpha()
      .toBuffer({ resolveWithObject: true })

    const blurhash = encode(
      new Uint8ClampedArray(tiny.data),
      tiny.info.width,
      tiny.info.height,
      4, 4
    )

    const fullKey = `${baseKey}/full.webp`
    const mobileKey = `${baseKey}/mobile.webp`

    await Promise.all([
      uploadToStorage(originalKey, buffer, `image/${ext === 'jpg' ? 'jpeg' : ext}`),
      uploadToStorage(fullKey, fullWebp, 'image/webp'),
      uploadToStorage(mobileKey, mobileWebp, 'image/webp'),
    ])

    await db.primary.insert(pages).values({
      chapterId: session.chapterId,
      pageNumber,
      originalStorageKey: originalKey,
      webpStorageKey: fullKey,
      mobileStorageKey: mobileKey,
      width: inputWidth,
      height: inputHeight,
      blurhash,
      processingStatus: 'complete',
    })

    processedCount++
  }

  // Update chapter page count and session status
  await db.primary.update(chapters)
    .set({ pageCount: processedCount, updatedAt: new Date() })
    .where(eq(chapters.id, session.chapterId))

  await db.primary.update(uploadSessions)
    .set({ status: 'complete', updatedAt: new Date() })
    .where(eq(uploadSessions.id, sessionId))

  console.log(`[archiveIngest] Session ${sessionId}: processed ${processedCount} pages`)
}
