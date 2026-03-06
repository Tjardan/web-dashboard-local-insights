/**
 * Server-side file cache for DevPulse API endpoints.
 * Stores JSON payloads in .devpulse-cache/ keyed by a SHA-256 hash.
 * Runs on the Node.js side (Vite dev server) only.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const CACHE_DIR = resolve(process.cwd(), '.devpulse-cache')

export interface CacheEntry<T> {
  cachedAt: string // ISO-8601
  data: T
}

function keyToPath(key: string): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24)
  return join(CACHE_DIR, `${hash}.json`)
}

/** Read a cache entry. Returns null on miss or corrupt file. */
export function cacheRead<T>(key: string): CacheEntry<T> | null {
  try {
    return JSON.parse(readFileSync(keyToPath(key), 'utf8')) as CacheEntry<T>
  } catch {
    return null
  }
}

/** Write data to the file cache. Returns the cachedAt ISO timestamp. */
export function cacheWrite<T>(key: string, data: T): string {
  const cachedAt = new Date().toISOString()
  try {
    // Always call mkdirSync with recursive — avoids TOCTOU race when cache dir is deleted
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(keyToPath(key), JSON.stringify({ cachedAt, data }))
  } catch (err) {
    console.warn('[DevPulse Cache] Write failed:', err)
  }
  return cachedAt
}

/** True when a cache entry was written within the last `ttlSeconds` seconds. */
export function isCacheFresh(entry: CacheEntry<unknown>, ttlSeconds: number): boolean {
  return Date.now() - new Date(entry.cachedAt).getTime() < ttlSeconds * 1000
}
