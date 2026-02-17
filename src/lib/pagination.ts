export interface CursorData {
  createdAt: string
  id: string
}

export interface PaginatedResult<T> {
  items: T[]
  nextCursor: string | null
  hasMore: boolean
}

export function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (typeof decoded.createdAt === 'string' && typeof decoded.id === 'string') {
      return decoded as CursorData
    }
    return null
  } catch {
    return null
  }
}

export function buildPaginatedResult<T extends { id: string; createdAt: Date }>(
  items: T[],
  limit: number
): PaginatedResult<T> {
  const hasMore = items.length > limit
  const resultItems = hasMore ? items.slice(0, limit) : items
  const lastItem = resultItems[resultItems.length - 1]

  const nextCursor = hasMore && lastItem
    ? encodeCursor({ createdAt: lastItem.createdAt.toISOString(), id: lastItem.id })
    : null

  return { items: resultItems, nextCursor, hasMore }
}
