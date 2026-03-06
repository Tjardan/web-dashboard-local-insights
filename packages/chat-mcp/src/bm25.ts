/**
 * BM25+ search engine — pure TypeScript Node.js build, zero dependencies.
 *
 * Identical algorithm to src/search/bm25.ts in the frontend.
 * Kept as a separate copy in the package so the MCP server has no build dependency
 * on the Vue frontend.
 */

export interface BM25Document {
  id: string;
  fields: BM25Field[];
}

export interface BM25Field {
  text: string;
  weight?: number;
}

export interface BM25Result {
  id: string;
  score: number;
}

const STOP_WORDS = new Set([
  "de",
  "het",
  "een",
  "van",
  "in",
  "op",
  "aan",
  "met",
  "voor",
  "is",
  "zijn",
  "was",
  "dat",
  "dit",
  "die",
  "er",
  "the",
  "a",
  "an",
  "of",
  "on",
  "at",
  "to",
  "for",
  "are",
  "be",
  "it",
  "and",
  "or",
  "not",
  "by",
  "from",
  "as",
  "if",
  "that",
  "this",
  "with",
  "has",
  "have",
  "had",
  "but",
  "so",
  "yet",
  "nor",
]);

export function tokenize(text: string): string[] {
  const expanded = text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return expanded
    .toLowerCase()
    .replace(/[^a-z0-9\s_\-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export class BM25Index {
  private readonly k1: number;
  private readonly b: number;
  private readonly delta: number;
  private docTf = new Map<string, Map<string, number>>();
  private docLengths = new Map<string, number>();
  private invertedIndex = new Map<string, Set<string>>();
  private docCount = 0;
  private avgDocLength = 0;

  constructor(k1 = 1.2, b = 0.75, delta = 1.0) {
    this.k1 = k1;
    this.b = b;
    this.delta = delta;
  }

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
        if (!this.invertedIndex.has(token))
          this.invertedIndex.set(token, new Set());
        this.invertedIndex.get(token)!.add(doc.id);
      }
    }

    if (this.docCount > 0) {
      let total = 0;
      for (const len of this.docLengths.values()) total += len;
      this.avgDocLength = total / this.docCount;
    }
  }

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
}
