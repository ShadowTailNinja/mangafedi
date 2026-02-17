import sharp from 'sharp'
import { encode } from 'blurhash'
import { config } from '../../config.js'
import { AppError } from '../../lib/errors.js'
import { downloadFromStorage, uploadToStorage } from '../../storage/index.js'
import { db } from '../../db/index.js'
import { pages } from '../../db/schema.js'
import { eq } from 'drizzle-orm'

export async function processPage(pageId: string): Promise<void> {
  const pageRows = await db.replica.select().from(pages).where(eq(pages.id, pageId)).limit(1)
  const page = pageRows[0]
  if (!page) throw new AppError('NOT_FOUND', `Page ${pageId} not found`, 404)

  const originalBuffer = await downloadFromStorage(page.originalStorageKey)

  const metadata = await sharp(originalBuffer).metadata()
  const inputWidth = metadata.width ?? 0
  const inputHeight = metadata.height ?? 0

  if (inputWidth > config.images.maxDimensionPx || inputHeight > config.images.maxDimensionPx) {
    await db.primary.update(pages).set({ processingStatus: 'failed' }).where(eq(pages.id, pageId))
    throw new AppError(
      'PROCESSING_FAILED',
      `Image (${inputWidth}x${inputHeight}) exceeds ${config.images.maxDimensionPx}px limit`,
      400
    )
  }

  const image = sharp(originalBuffer, {
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

  const baseKey = page.originalStorageKey.replace(/\/original\.[^/]+$/, '')
  const fullKey = `${baseKey}/full.webp`
  const mobileKey = `${baseKey}/mobile.webp`

  await Promise.all([
    uploadToStorage(fullKey, fullWebp, 'image/webp'),
    uploadToStorage(mobileKey, mobileWebp, 'image/webp'),
  ])

  await db.primary.update(pages).set({
    webpStorageKey: fullKey,
    mobileStorageKey: mobileKey,
    width: inputWidth,
    height: inputHeight,
    blurhash,
    processingStatus: 'complete',
  }).where(eq(pages.id, pageId))
}
