/**
 * Browser-side localStorage cache for InsightEntry arrays.
 * Allows instant display of previously loaded data on page reload,
 * and provides the `cachedAt` timestamp for incremental API fetches.
 */
import type { InsightEntry } from '@/types'

export interface BrowserCacheEntry {
  /** ISO-8601 — when this cache slice was last written */
  cachedAt: string
  entries: InsightEntry[]
}

const PREFIX = 'devpulse:entries:'

function key(projectId: string, source: string): string {
  return `${PREFIX}${projectId}:${source}`
}

/** Read cached entries for one project+source slice. */
export function readBrowserCache(projectId: string, source: string): BrowserCacheEntry | null {
  try {
    const raw = localStorage.getItem(key(projectId, source))
    if (!raw) return null
    return JSON.parse(raw) as BrowserCacheEntry
  } catch {
    return null
  }
}

/** Persist a set of entries for one project+source slice. */
export function writeBrowserCache(
  projectId: string,
  source: string,
  entries: InsightEntry[],
): void {
  try {
    const entry: BrowserCacheEntry = { cachedAt: new Date().toISOString(), entries }
    localStorage.setItem(key(projectId, source), JSON.stringify(entry))
  } catch (err) {
    // Can throw when localStorage quota is exceeded — non-fatal
    console.warn('[BrowserCache] Write failed (quota?):', err)
  }
}

/**
 * Read ALL cached InsightEntry objects across all projects and sources.
 * Used for instant population of the store on startup.
 */
export function readAllCachedEntries(): InsightEntry[] {
  const result: InsightEntry[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(PREFIX)) continue
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const parsed = JSON.parse(raw) as BrowserCacheEntry
      result.push(...parsed.entries)
    }
  } catch {
    // Ignore — partial results are fine
  }
  return result
}

/**
 * Validate a `since` timestamp before passing it to the API.
 * Returns undefined (= full fetch) when the value is corrupt, in the future,
 * or otherwise untrustworthy.
 */
export function sanitizeSince(cachedAt: string | undefined): string | undefined {
  if (!cachedAt) return undefined
  const t = new Date(cachedAt).getTime()
  if (isNaN(t)) return undefined
  // If cachedAt is more than 60 s in the future, treat as invalid (clock skew)
  if (t > Date.now() + 60_000) return undefined
  return cachedAt
}

/**
 * Remove cached entries for project IDs that are no longer known.
 * Call after project discovery so stale projects don't accumulate.
 */
export function pruneObsoleteProjects(knownProjectIds: Set<string>): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(PREFIX)) keys.push(k)
  }
  for (const k of keys) {
    // key format: devpulse:entries:<projectId>:<source>
    const withoutPrefix = k.slice(PREFIX.length)
    const projectId = withoutPrefix.split(':')[0]
    if (projectId && !knownProjectIds.has(projectId)) {
      localStorage.removeItem(k)
    }
  }
}

/**
 * Remove cached entries. Optionally scoped to a single project.
 */
export function clearBrowserCache(projectId?: string): void {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith(PREFIX)) keys.push(k)
  }
  for (const k of keys) {
    if (!projectId || k.startsWith(`${PREFIX}${projectId}:`)) {
      localStorage.removeItem(k)
    }
  }
}
