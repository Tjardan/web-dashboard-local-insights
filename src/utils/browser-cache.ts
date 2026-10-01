/**
 * Browser-side cache for InsightEntry arrays, one slice per project+source.
 * Allows instant display of previously loaded data on page reload, and provides
 * the `cachedAt` timestamp for incremental API fetches.
 *
 * Persistence: IndexedDB (devpulse-entry-cache / slices). This used to be
 * localStorage, but chat entries carry `meta.extra.indexableText` — up to
 * 100 000 characters per session — so a handful of tracked projects blew past
 * the 5 MB quota. Writes then failed silently and those projects lost their
 * cache entirely, re-fetching everything on every reload. IndexedDB has no
 * practical size limit and stores structured clones, so no JSON round-trip.
 *
 * Migration: any existing localStorage slices are moved on first use and then
 * removed, mirroring what the vector store does.
 *
 * All functions are async. The store is opened lazily and shared.
 */
import type { InsightEntry } from "@/types";

export interface BrowserCacheEntry {
  /** ISO-8601 — when this cache slice was last written */
  cachedAt: string;
  entries: InsightEntry[];
}

/** Row shape in the object store — BrowserCacheEntry plus its key fields */
interface SliceRow extends BrowserCacheEntry {
  /** `${projectId}:${source}` — the object store's keyPath */
  key: string;
  projectId: string;
  source: string;
}

const IDB_NAME = "devpulse-entry-cache";
const IDB_VERSION = 1;
const STORE_SLICES = "slices";

/** Legacy localStorage prefix, still read once for migration */
const LS_PREFIX = "devpulse:entries:";

function sliceKey(projectId: string, source: string): string {
  return `${projectId}:${source}`;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SLICES)) {
        db.createObjectStore(STORE_SLICES, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_SLICES, "readonly")
      .objectStore(STORE_SLICES)
      .getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_SLICES, "readonly")
      .objectStore(STORE_SLICES)
      .get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, row: SliceRow): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_SLICES, "readwrite")
      .objectStore(STORE_SLICES)
      .put(row);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDeleteMany(db: IDBDatabase, keys: string[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_SLICES, "readwrite");
    const store = tx.objectStore(STORE_SLICES);
    for (const k of keys) store.delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Lazy shared connection + one-time localStorage migration ────────────────

let dbPromise: Promise<IDBDatabase | null> | undefined;

/**
 * Move any surviving localStorage slices into IndexedDB, then drop them.
 *
 * Slices that previously hit the quota simply were not written, so this
 * recovers whatever did fit and nothing is lost that wasn't already gone.
 */
async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
  const legacyKeys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LS_PREFIX)) legacyKeys.push(k);
    }
  } catch {
    return; // localStorage unavailable — nothing to migrate
  }
  if (legacyKeys.length === 0) return;

  for (const k of legacyKeys) {
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const parsed = JSON.parse(raw) as BrowserCacheEntry;
        // key format: devpulse:entries:<projectId>:<source>
        const [projectId, source] = k.slice(LS_PREFIX.length).split(":");
        if (projectId && source) {
          await idbPut(db, {
            key: sliceKey(projectId, source),
            projectId,
            source,
            cachedAt: parsed.cachedAt,
            entries: parsed.entries ?? [],
          });
        }
      }
    } catch {
      // Skip a corrupt slice — it will simply be re-fetched
    }
    try {
      localStorage.removeItem(k);
    } catch {
      /* non-fatal */
    }
  }
  console.info(
    `[BrowserCache] Migrated ${legacyKeys.length} cache slice(s) from localStorage to IndexedDB`,
  );
}

function getDB(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await openDB();
        await migrateFromLocalStorage(db);
        return db;
      } catch (err) {
        // Private browsing or a blocked store — the app still works, just
        // without a cache, so every load becomes a full fetch.
        console.warn("[BrowserCache] IndexedDB unavailable:", err);
        return null;
      }
    })();
  }
  return dbPromise;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Read cached entries for one project+source slice. */
export async function readBrowserCache(
  projectId: string,
  source: string,
): Promise<BrowserCacheEntry | null> {
  const db = await getDB();
  if (!db) return null;
  try {
    const row = await idbGet<SliceRow>(db, sliceKey(projectId, source));
    return row ? { cachedAt: row.cachedAt, entries: row.entries } : null;
  } catch {
    return null;
  }
}

/** Persist a set of entries for one project+source slice. */
export async function writeBrowserCache(
  projectId: string,
  source: string,
  entries: InsightEntry[],
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    await idbPut(db, {
      key: sliceKey(projectId, source),
      projectId,
      source,
      cachedAt: new Date().toISOString(),
      entries,
    });
  } catch (err) {
    console.warn("[BrowserCache] Write failed:", err);
  }
}

/**
 * Read ALL cached InsightEntry objects across all projects and sources.
 * Used for instant population of the store on startup.
 */
export async function readAllCachedEntries(): Promise<InsightEntry[]> {
  const db = await getDB();
  if (!db) return [];
  try {
    const rows = await idbGetAll<SliceRow>(db);
    return rows.flatMap((r) => r.entries ?? []);
  } catch {
    return []; // Partial results are fine; a full fetch follows anyway
  }
}

/**
 * Validate a `since` timestamp before passing it to the API.
 * Returns undefined (= full fetch) when the value is corrupt, in the future,
 * or otherwise untrustworthy.
 */
export function sanitizeSince(cachedAt: string | undefined): string | undefined {
  if (!cachedAt) return undefined;
  const t = new Date(cachedAt).getTime();
  if (isNaN(t)) return undefined;
  // If cachedAt is more than 60 s in the future, treat as invalid (clock skew)
  if (t > Date.now() + 60_000) return undefined;
  return cachedAt;
}

/**
 * Remove cached entries for project IDs that are no longer known.
 * Call after project discovery so stale projects don't accumulate.
 */
export async function pruneObsoleteProjects(
  knownProjectIds: Set<string>,
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    const rows = await idbGetAll<SliceRow>(db);
    const obsolete = rows
      .filter((r) => !knownProjectIds.has(r.projectId))
      .map((r) => r.key);
    await idbDeleteMany(db, obsolete);
  } catch (err) {
    console.warn("[BrowserCache] Prune failed:", err);
  }
}

/** Remove cached entries. Optionally scoped to a single project. */
export async function clearBrowserCache(projectId?: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    const rows = await idbGetAll<SliceRow>(db);
    const keys = rows
      .filter((r) => !projectId || r.projectId === projectId)
      .map((r) => r.key);
    await idbDeleteMany(db, keys);
  } catch (err) {
    console.warn("[BrowserCache] Clear failed:", err);
  }
}
