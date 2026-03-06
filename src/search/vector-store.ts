/**
 * Semantic vector store — in-memory, cosine similarity.
 *
 * Stores document embeddings (1536-dim float32 from text-embedding-3-small)
 * and provides fast nearest-neighbour search using cosine similarity.
 *
 * Persistence: serialized to localStorage under `devpulse-vector-index` so
 * embeddings survive page reloads and don't need to be recomputed.
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

// ─── Persistence ──────────────────────────────────────────────────────────────

const STORAGE_KEY = "devpulse-vector-index";
const MAX_STORED_DOCS = 5000; // guard against localStorage quota

interface PersistedIndex {
  version: number;
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
  private dirty = false;

  constructor() {
    this.loadFromStorage();
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
    const toEmbed: VectorDocument[] = [];

    for (const doc of docs) {
      const existing = this.entries.get(doc.id);
      if (!existing || existing.hash !== doc.hash) {
        toEmbed.push(doc);
      }
    }

    if (toEmbed.length === 0) return 0;

    // Remove docs that are no longer in the input set
    const inputIds = new Set(docs.map((d) => d.id));
    for (const id of this.entries.keys()) {
      if (!inputIds.has(id)) this.entries.delete(id);
    }

    // Embed in batches of 96 (API limit), reporting progress
    const BATCH = 96;
    let indexed = 0;

    for (let i = 0; i < toEmbed.length; i += BATCH) {
      const batch = toEmbed.slice(i, i + BATCH);
      const embeddings = await embed(batch.map((d) => d.text));

      for (let j = 0; j < batch.length; j++) {
        const doc = batch[j];
        this.entries.set(doc.id, { ...doc, embedding: embeddings[j] });
        indexed++;
      }

      onProgress?.(indexed, toEmbed.length);
    }

    this.dirty = true;
    this.pruneToLimit();
    this.saveToStorage();
    return indexed;
  }

  /** Upsert a single already-embedded entry (used by server-side index loading) */
  upsert(entry: VectorEntry): void {
    this.entries.set(entry.id, entry);
    this.dirty = true;
  }

  /** Remove a document by id */
  remove(id: string): void {
    if (this.entries.delete(id)) this.dirty = true;
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

  private saveToStorage(): void {
    if (!this.dirty) return;
    try {
      const data: PersistedIndex = {
        version: 1,
        entries: [...this.entries.values()].map((e) => ({
          id: e.id,
          text: e.text,
          hash: e.hash,
          embedding: e.embedding,
        })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.dirty = false;
    } catch {
      // localStorage quota exceeded — silently ignore
    }
  }

  private loadFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedIndex;
      if (data.version !== 1) return;
      for (const e of data.entries) {
        this.entries.set(e.id, e);
      }
    } catch {
      // Corrupted storage — start fresh
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  clearStorage(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.entries.clear();
    this.dirty = false;
  }

  private pruneToLimit(): void {
    if (this.entries.size <= MAX_STORED_DOCS) return;
    // Remove oldest entries (by insertion order)
    const toRemove = this.entries.size - MAX_STORED_DOCS;
    let removed = 0;
    for (const id of this.entries.keys()) {
      if (removed >= toRemove) break;
      this.entries.delete(id);
      removed++;
    }
  }
}

// ─── Content hash export ──────────────────────────────────────────────────────

export { contentHash };
