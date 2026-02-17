class TtlCache<T> {
  private store = new Map<string, { value: T; expiresAt: number }>()

  set(key: string, value: T, ttlMs: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  invalidate(key: string) {
    this.store.delete(key)
  }

  invalidateAll() {
    this.store.clear()
  }
}

export const instanceConfigCache = new TtlCache<unknown>()
export const seriesCache = new TtlCache<unknown>()
export const webfingerCache = new TtlCache<unknown>()

// Cache TTLs (ms)
export const TTL = {
  INSTANCE_CONFIG: 30_000,    // 30s
  SERIES: 60_000,             // 60s
  CHAPTER_PAGES: 300_000,     // 5min
  WEBFINGER: 300_000,         // 5min
} as const
