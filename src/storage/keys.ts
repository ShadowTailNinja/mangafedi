export function pageStorageKey(
  chapterId: string,
  pageNumber: number,
  variant: 'original' | 'full' | 'mobile',
  ext = 'webp'
): string {
  const padded = String(pageNumber).padStart(3, '0')
  const filename = variant === 'original' ? `original.${ext}` : `${variant}.webp`
  return `chapters/${chapterId}/pages/${padded}/${filename}`
}

export function coverStorageKey(
  seriesId: string,
  variant: 'original' | 'full' | 'thumb',
  ext = 'webp'
): string {
  const filename = variant === 'original' ? `original.${ext}` : `${variant}.webp`
  return `series/${seriesId}/covers/${filename}`
}

export function archiveSessionStorageKey(sessionId: string, ext = 'zip'): string {
  return `uploads/sessions/${sessionId}/archive.${ext}`
}

export function pagePublicUrl(publicBase: string, storageKey: string, version = 1): string {
  const vParam = version > 1 ? `?v=${version}` : ''
  return `${publicBase}/${storageKey}${vParam}`
}

export function coverPublicUrl(publicBase: string, storageKey: string, version = 1): string {
  const vParam = version > 1 ? `?v=${version}` : ''
  return `${publicBase}/${storageKey}${vParam}`
}
