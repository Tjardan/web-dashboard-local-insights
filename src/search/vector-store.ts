/**
 * Semantic vector store — in-memory, cosine similarity.
 *
 * Stores document embeddings (1536-dim float32 from text-embedding-3-small)
 * and provides fast nearest-neighbour search using cosine similarity.
 *
 * Persistence: stored in IndexedDB (devpulse-vector-store / entries).
 * Embeddings are kept as Float32Array structured clones — ~6 KB/doc instead
 * of ~18 KB JSON, and there is no quota issue (browsers allow hundreds of MB).
 *
 * Migration: any existing localStorage data is migrated on first init() and
 * then deleted from localStorage.
 *
 * Incremental updates: only re-embeds documents whose content hash has changed
 * since the last indexing run, keeping API calls minimal.
 */

import { embed } from "./github-models";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VectorDocument {
  id: string;
  /** The text that was embedded */
  text: string;
  /** Simple content hash for change detection */
  hash: string;
}

export interface VectorEntry extends VectorDocument {
  embedding: number[];
}

export interface SemanticResult {
  id: string;
  score: number; // cosine similarity [0..1]
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────

const IDB_NAME = "devpulse-vector-store";
const IDB_VERSION = 1;
const STORE_ENTRIES = "entries";
const STORE_META = "meta";
const MAX_STORED_DOCS = 5000;

/** Open (and upgrade) the IndexedDB database */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(
  db: IDBDatabase,
  storeName: string,
  value: unknown,
  key?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    const req = key !== undefined ? store.put(value, key) : store.put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbClear(db: IDBDatabase, storeName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Row shape stored in the entries object store */
interface IDBEntryRow {
  id: string;
  text: string;
  hash: string;
  /** Float32Array stored as a structured clone (compact binary, no JSON overhead) */
  embedding: Float32Array;
}

// ─── localStorage migration helpers ──────────────────────────────────────────

const LS_LEGACY_KEY = "devpulse-vector-index";

interface LegacyPersistedIndex {
  version: number;
  indexedAt?: string;
  entries: Array<{
    id: string;
    text: string;
    hash: string;
    embedding: number[];
  }>;
}

function contentHash(text: string): string {
  // Fast djb2-style hash, good enough for change detection
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
    h >>>= 0; // keep as 32-bit unsigned
  }
  return h.toString(36);
}

// ─── Vector store ─────────────────────────────────────────────────────────────

export class VectorStore {
  private entries = new Map<string, VectorEntry>();
  private _indexedAt: string | null = null;
  private _db: IDBDatabase | null = null;
  /** Resolves once the IndexedDB is open and all persisted entries are loaded */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this._init();
  }

  private async _init(): Promise<void> {
    try {
      this._db = await openDB();
      await this._migrateFromLocalStorage();
      await this._loadFromIDB();
    } catch (err) {
      console.warn(
        "[VectorStore] IndexedDB init failed, running in-memory only:",
        err,
      );
    }
  }

  /** One-time migration: import existing localStorage JSON into IndexedDB then delete it */
  private async _migrateFromLocalStorage(): Promise<void> {
    if (!this._db) return;
    const raw = localStorage.getItem(LS_LEGACY_KEY);
    if (!raw) return;
    try {
      const data = JSON.parse(raw) as LegacyPersistedIndex;
      if (data.version === 1 && Array.isArray(data.entries)) {
        for (const e of data.entries) {
          const row: IDBEntryRow = {
            id: e.id,
            text: e.text,
            hash: e.hash,
            embedding: new Float32Array(e.embedding),
          };
          await idbPut(this._db, STORE_ENTRIES, row);
        }
        if (data.indexedAt) {
          await idbPut(this._db, STORE_META, data.indexedAt, "indexedAt");
        }
        console.info(
          `[VectorStore] Migrated ${data.entries.length} entries from localStorage → IndexedDB`,
        );
      }
    } catch {
      // Corrupted legacy data — ignore
    } finally {
      localStorage.removeItem(LS_LEGACY_KEY);
    }
  }

  private async _loadFromIDB(): Promise<void> {
    if (!this._db) return;
    const rows = await idbGetAll<IDBEntryRow>(this._db, STORE_ENTRIES);
    for (const row of rows) {
      this.entries.set(row.id, {
        id: row.id,
        text: row.text,
        hash: row.hash,
        embedding: Array.from(row.embedding),
      });
    }
    this._indexedAt =
      (await idbGet<string>(this._db, STORE_META, "indexedAt")) ?? null;
  }

  get indexedAt(): string | null {
    return this._indexedAt;
  }

  // ── Cosine similarity ──────────────────────────────────────────────────────

  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  // ── Indexing ───────────────────────────────────────────────────────────────

  /**
   * Incrementally index documents. Only calls the embedding API for docs
   * whose text has changed (or that are new). Returns the count of re-embedded docs.
   *
   * Pass `onProgress` to receive incremental updates (useful for UI progress bar).
   */
  async indexDocuments(
    docs: VectorDocument[],
    onProgress?: (indexed: number, total: number) => void,
  ): Promise<number> {
    await this.ready;
    const toEmbed: VectorDocument[] = [];

    for (const doc of docs) {
      const existing = this.entries.get(doc.id);
      if (!existing || existing.hash !== doc.hash) {
        toEmbed.push(doc);
      }
    }

    // Remove docs that are no longer in the input set
    const inputIds = new Set(docs.map((d) => d.id));
    const toRemove: string[] = [];
    for (const id of this.entries.keys()) {
      if (!inputIds.has(id)) {
        this.entries.delete(id);
        toRemove.push(id);
      }
    }
    if (this._db) {
      for (const id of toRemove) {
        await idbDelete(this._db, STORE_ENTRIES, id);
      }
    }

    if (toEmbed.length === 0) return 0;

    // Embed in batches of 96 (API limit), reporting progress
    const BATCH = 96;
    let indexed = 0;

    for (let i = 0; i < toEmbed.length; i += BATCH) {
      const batch = toEmbed.slice(i, i + BATCH);
      const embeddings = await embed(batch.map((d) => d.text));

      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j];
        const entry: VectorEntry = { ...doc, embedding: embeddings[j] };
        this.entries.set(doc.id, entry);
        if (this._db) {
          const row: IDBEntryRow = {
            id: doc.id,
            text: doc.text,
            hash: doc.hash,
            embedding: new Float32Array(embeddings[j]),
          };
          await idbPut(this._db, STORE_ENTRIES, row);
        }
        indexed++;
      }

      onProgress?.(indexed, toEmbed.length);
    }

    this._indexedAt = new Date().toISOString();
    if (this._db) {
      await idbPut(this._db, STORE_META, this._indexedAt, "indexedAt");
    }
    this._pruneToLimit();
    return indexed;
  }

  /**
   * Dry-run staleness check: returns how many docs would be re-embedded or
   * removed if indexDocuments() were called now, without hitting the API.
   */
  checkStaleness(docs: VectorDocument[]): {
    toEmbed: number;
    toRemove: number;
  } {
    let toEmbed = 0;
    for (const doc of docs) {
      const existing = this.entries.get(doc.id);
      if (!existing || existing.hash !== doc.hash) toEmbed++;
    }
    const inputIds = new Set(docs.map((d) => d.id));
    let toRemove = 0;
    for (const id of this.entries.keys()) {
      if (!inputIds.has(id)) toRemove++;
    }
    return { toEmbed, toRemove };
  }

  /** Upsert a single already-embedded entry (used by server-side index loading) */
  upsert(entry: VectorEntry): void {
    this.entries.set(entry.id, entry);
    if (this._db) {
      const row: IDBEntryRow = {
        id: entry.id,
        text: entry.text,
        hash: entry.hash,
        embedding: new Float32Array(entry.embedding),
      };
      idbPut(this._db, STORE_ENTRIES, row).catch(() => undefined);
    }
  }

  /** Remove a document by id */
  remove(id: string): void {
    if (this.entries.delete(id) && this._db) {
      idbDelete(this._db, STORE_ENTRIES, id).catch(() => undefined);
    }
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  /**
   * Find the topK most similar documents to a query embedding.
   * Expects a pre-computed query embedding (call `embedOne(query)` first).
   */
  search(queryEmbedding: number[], topK = 20): SemanticResult[] {
    if (this.entries.size === 0) return [];

    const results: SemanticResult[] = [];
    for (const entry of this.entries.values()) {
      const score = VectorStore.cosineSimilarity(
        queryEmbedding,
        entry.embedding,
      );
      results.push({ id: entry.id, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  get size(): number {
    return this.entries.size;
  }

  get allIds(): string[] {
    return [...this.entries.keys()];
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  async clearStorage(): Promise<void> {
    this.entries.clear();
    this._indexedAt = null;
    if (this._db) {
      await idbClear(this._db, STORE_ENTRIES);
      await idbDelete(this._db, STORE_META, "indexedAt");
    }
    // Also clean up any leftover localStorage data
    localStorage.removeItem(LS_LEGACY_KEY);
  }

  private _pruneToLimit(): void {
    if (this.entries.size <= MAX_STORED_DOCS) return;
    const toRemove = this.entries.size - MAX_STORED_DOCS;
    let removed = 0;
    for (const id of this.entries.keys()) {
      if (removed >= toRemove) break;
      this.entries.delete(id);
      if (this._db) {
        idbDelete(this._db, STORE_ENTRIES, id).catch(() => undefined);
      }
      removed++;
    }
  }
}

// ─── Content hash export ──────────────────────────────────────────────────────

export { contentHash };
