/**
 * Hybrid search — fuses BM25+ lexical scores with cosine semantic scores.
 *
 * Fusion strategy: Reciprocal Rank Fusion (RRF) weighted by confidence.
 * RRF(d) = Σ_r  weight_r / (k + rank_r(d))
 *
 * where k = 60 (standard RRF constant), and:
 *   - bm25 weight  = α  (default 0.5)
 *   - semantic weight = (1-α)  (default 0.5)
 *
 * When the GitHub token is not configured, the hybrid search gracefully
 * falls back to BM25-only mode.
 */

import { BM25Index } from "./bm25";
import { VectorStore } from "./vector-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HybridResult {
  id: string;
  /** Fused RRF score */
  score: number;
  /** Individual component scores (for debugging) */
  bm25Score?: number;
  semanticScore?: number;
  /** Which modes contributed */
  mode: "hybrid" | "bm25-only" | "semantic-only";
}

export interface HybridSearchOptions {
  topK?: number;
  /** BM25 weight [0..1], semantic weight is (1-alpha). Default 0.5 */
  alpha?: number;
  /** RRF k constant. Default 60 */
  rrfK?: number;
}

// ─── RRF fusion ───────────────────────────────────────────────────────────────

function rrfFuse(
  bm25Results: Array<{ id: string; score: number }>,
  semanticResults: Array<{ id: string; score: number }>,
  alpha: number,
  rrfK: number,
  topK: number,
): HybridResult[] {
  const scores = new Map<
    string,
    { rrf: number; bm25?: number; semantic?: number }
  >();

  const bm25Weight = alpha;
  const semanticWeight = 1 - alpha;

  bm25Results.forEach(({ id, score }, rank) => {
    const contribution = bm25Weight / (rrfK + rank + 1);
    const entry = scores.get(id) ?? { rrf: 0 };
    entry.rrf += contribution;
    entry.bm25 = score;
    scores.set(id, entry);
  });

  semanticResults.forEach(({ id, score }, rank) => {
    const contribution = semanticWeight / (rrfK + rank + 1);
    const entry = scores.get(id) ?? { rrf: 0 };
    entry.rrf += contribution;
    entry.semantic = score;
    scores.set(id, entry);
  });

  const hasBm25 = bm25Results.length > 0;
  const hasSemantic = semanticResults.length > 0;

  return [...scores.entries()]
    .map(([id, s]) => ({
      id,
      score: s.rrf,
      bm25Score: s.bm25,
      semanticScore: s.semantic,
      mode: (hasBm25 && hasSemantic
        ? "hybrid"
        : hasSemantic
          ? "semantic-only"
          : "bm25-only") as HybridResult["mode"],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ─── Exact match boost ────────────────────────────────────────────────────────

/**
 * Computes an additive score boost for results where the query (or its tokens)
 * appear as a concentrated phrase rather than spread across the document.
 *
 * Tiered bonuses (applied additively):
 *   +0.30  exact phrase in title
 *   +0.15  exact phrase in description/body
 *   +0.08  all query tokens present in title (no phrase match needed)
 *
 * The caller is responsible for providing the text fields.
 */
export function exactMatchBoost(
  title: string,
  description: string,
  query: string,
): number {
  if (!query.trim()) return 0;
  const q = query.toLowerCase().trim();
  const t = title.toLowerCase();
  const d = description.toLowerCase();

  if (t.includes(q)) return 0.3;
  if (d.includes(q)) return 0.15;

  // All query tokens present in title (phrase not required)
  const tokens = q.split(/\s+/).filter((tok) => tok.length > 1);
  if (tokens.length > 1 && tokens.every((tok) => t.includes(tok))) return 0.08;

  return 0;
}

// ─── HybridSearchEngine ───────────────────────────────────────────────────────

export class HybridSearchEngine {
  constructor(
    private readonly bm25: BM25Index,
    private readonly vectorStore: VectorStore,
  ) {}

  /**
   * Search using both BM25 and semantic layers.
   * `queryEmbedding` is optional — if omitted, falls back to BM25 only.
   */
  search(
    query: string,
    queryEmbedding: number[] | null,
    opts: HybridSearchOptions = {},
  ): HybridResult[] {
    const topK = opts.topK ?? 20;
    const alpha = opts.alpha ?? 0.5;
    const rrfK = opts.rrfK ?? 60;

    // Retrieve more candidates than topK to give RRF enough to work with
    const candidateK = Math.max(topK * 3, 60);

    const bm25Results = this.bm25.search(query, candidateK);
    const semanticResults = queryEmbedding
      ? this.vectorStore.search(queryEmbedding, candidateK)
      : [];

    if (bm25Results.length === 0 && semanticResults.length === 0) return [];

    return rrfFuse(bm25Results, semanticResults, alpha, rrfK, topK);
  }
}
