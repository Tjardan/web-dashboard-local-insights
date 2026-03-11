/**
 * BM25+ search engine — pure TypeScript, zero dependencies.
 *
 * Shared between the DevPulse frontend (Vite/browser) and the
 * @devpulse/chat-mcp MCP server (Node.js).
 *
 * BM25+ improves on classic BM25 by adding a lower-bound δ on
 * term-frequency contribution, preventing terms in long documents from
 * being penalized too harshly.
 *
 * Formula per term t in document d:
 *   score += IDF(t) * [ (tf * (k1+1)) / (tf + k1*(1-b+b*|d|/avgdl)) + δ ]
 *
 * where IDF = log((N - df + 0.5) / (df + 0.5) + 1)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BM25Document {
  id: string;
  /** All searchable text fields concatenated or individually weighted */
  fields: BM25Field[];
}

export interface BM25Field {
  text: string;
  /** Weight multiplier for this field (e.g. title = 2, body = 1) */
  weight?: number;
}

export interface BM25Result {
  id: string;
  score: number;
}

export interface BM25Options {
  /** Term-frequency saturation parameter (default 0.9) */
  k1?: number;
  /** Length normalization parameter (default 0.75) */
  b?: number;
  /** Lower-bound delta for BM25+ (default 1.0) */
  delta?: number;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Lightweight tokenizer: lowercase, strip punctuation, split on whitespace.
 * Handles camelCase / PascalCase splitting and removes stop words.
 */
export const STOP_WORDS = new Set([
  // Dutch
  "de",
  "het",
  "een",
  "van",
  "in",
  "op",
  "aan",
  "met",
  "voor",
  "naar",
  "is",
  "zijn",
  "was",
  "waren",
  "wordt",
  "worden",
  "dat",
  "dit",
  "die",
  "er",
  "ook",
  "als",
  "maar",
  "dan",
  "nog",
  "wel",
  "niet",
  "ze",
  "te",
  "om",
  "bij",
  "uit",
  "over",
  "door",
  "we",
  "ik",
  "je",
  "jij",
  "hij",
  "zij",
  "het",
  "ze",
  "ons",
  "hun",
  "mij",
  // English — articles, prepositions, conjunctions
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "by",
  "from",
  "as",
  "into",
  "onto",
  "up",
  "down",
  "about",
  "with",
  "without",
  "and",
  "or",
  "nor",
  "but",
  "so",
  "yet",
  "if",
  "than",
  "then",
  // English — common auxiliary / copula verbs
  "are",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "shall",
  "should",
  "could",
  "can",
  "may",
  "might",
  "must",
  // English — pronouns / determiners
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "all",
  "any",
  "each",
  "few",
  "more",
  "most",
  "some",
  "such",
  "no",
  "they",
  "their",
  "them",
  "our",
  "you",
  "your",
  "he",
  "she",
  "am",
  "i",
  "my",
  // English — other high-frequency noise words in dev content
  "not",
  "just",
  "also",
  "how",
  "when",
  "where",
  "which",
  "who",
]);

export function tokenize(text: string): string[] {
  // Split camelCase/PascalCase: "myFunction" → "my function"
  const expanded = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");

  return expanded
    .toLowerCase()
    .replace(/[^a-z0-9\s_\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

// ─── BM25 Index ───────────────────────────────────────────────────────────────

export class BM25Index {
  private readonly k1: number;
  private readonly b: number;
  private readonly delta: number;

  /** doc id → token frequency map */
  private docTf = new Map<string, Map<string, number>>();
  /** doc id → total weighted token count */
  private docLengths = new Map<string, number>();
  /** token → set of doc ids containing it */
  private invertedIndex = new Map<string, Set<string>>();
  /** total number of documents */
  private docCount = 0;
  /** average document length */
  private avgDocLength = 0;

  constructor(opts: BM25Options = {}) {
    this.k1 = opts.k1 ?? 0.9;
    this.b = opts.b ?? 0.75;
    this.delta = opts.delta ?? 1.0;
  }

  /** Add or replace a document in the index */
  add(doc: BM25Document): void {
    if (this.docTf.has(doc.id)) {
      this.remove(doc.id);
    }

    const tf = new Map<string, number>();
    let length = 0;

    for (const field of doc.fields) {
      const w = field.weight ?? 1;
      const tokens = tokenize(field.text);
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + w);
        length += w;
      }
    }

    this.docTf.set(doc.id, tf);
    this.docLengths.set(doc.id, length);
    this.docCount++;

    for (const token of tf.keys()) {
      let set = this.invertedIndex.get(token);
      if (!set) {
        set = new Set();
        this.invertedIndex.set(token, set);
      }
      set.add(doc.id);
    }

    this.recalcAvgLength();
  }

  /** Remove a document from the index */
  remove(id: string): void {
    const tf = this.docTf.get(id);
    if (!tf) return;

    for (const token of tf.keys()) {
      this.invertedIndex.get(token)?.delete(id);
    }

    this.docTf.delete(id);
    this.docLengths.delete(id);
    this.docCount = Math.max(0, this.docCount - 1);
    this.recalcAvgLength();
  }

  /** Bulk-replace the entire index. Much faster than individual adds. */
  buildFromDocuments(docs: BM25Document[]): void {
    this.docTf.clear();
    this.docLengths.clear();
    this.invertedIndex.clear();
    this.docCount = 0;
    this.avgDocLength = 0;

    for (const doc of docs) {
      const tf = new Map<string, number>();
      let length = 0;

      for (const field of doc.fields) {
        const w = field.weight ?? 1;
        const tokens = tokenize(field.text);
        for (const token of tokens) {
          tf.set(token, (tf.get(token) ?? 0) + w);
          length += w;
        }
      }

      this.docTf.set(doc.id, tf);
      this.docLengths.set(doc.id, length);
      this.docCount++;

      for (const token of tf.keys()) {
        let set = this.invertedIndex.get(token);
        if (!set) {
          set = new Set();
          this.invertedIndex.set(token, set);
        }
        set.add(doc.id);
      }
    }

    this.recalcAvgLength();
  }

  /** Search and return results sorted by score (highest first) */
  search(query: string, topK = 20): BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docCount === 0) return [];

    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const matchingDocs = this.invertedIndex.get(token);
      if (!matchingDocs || matchingDocs.size === 0) continue;

      const df = matchingDocs.size;
      const idf = Math.log((this.docCount - df + 0.5) / (df + 0.5) + 1);

      for (const docId of matchingDocs) {
        const tf = this.docTf.get(docId)?.get(token) ?? 0;
        const docLen = this.docLengths.get(docId) ?? 0;
        const norm =
          (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + (this.b * docLen) / this.avgDocLength));
        scores.set(docId, (scores.get(docId) ?? 0) + idf * (norm + this.delta));
      }
    }

    return [...scores.entries()]
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get size(): number {
    return this.docCount;
  }

  private recalcAvgLength(): void {
    if (this.docCount === 0) {
      this.avgDocLength = 0;
      return;
    }
    let total = 0;
    for (const len of this.docLengths.values()) total += len;
    this.avgDocLength = total / this.docCount;
  }
}
