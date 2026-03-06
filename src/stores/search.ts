/**
 * Search store — orchestrates BM25, vector store, hybrid engine, and AI chat.
 *
 * Lifecycle:
 *   1. rebuildBM25Index()     — instant, triggered whenever entries change
 *   2. rebuildVectorIndex()   — async, calls GitHub Models, skips unchanged docs
 *   3. search(query)          — hybrid BM25 + semantic (or BM25-only if no token)
 *   4. ask(prompt)            — RAG: search top-K, feed context to gpt-4o-mini
 */

import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { BM25Index } from "@/search/bm25";
import { VectorStore } from "@/search/vector-store";
import { HybridSearchEngine } from "@/search/hybrid";
import { entriesToBM25Docs, entriesToVectorDocs } from "@/search/index-builder";
import { embedOne, chatComplete, hasGithubToken } from "@/search/github-models";
import type { InsightEntry } from "@/types";
import type { HybridResult } from "@/search/hybrid";
import type { ChatMessage } from "@/search/github-models";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SearchResult extends HybridResult {
  entry: InsightEntry;
}

export type SearchMode = "bm25-only" | "hybrid" | "semantic-only";

export interface AskResult {
  answer: string;
  sources: SearchResult[];
  model: string;
  tokensUsed: number;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useSearchStore = defineStore("search", () => {
  // ── Engines ─────────────────────────────────────────────────────────────────
  const bm25 = new BM25Index();
  const vectorStore = new VectorStore();
  const engine = new HybridSearchEngine(bm25, vectorStore);

  // ── State ───────────────────────────────────────────────────────────────────
  const isIndexingBM25 = ref(false);
  const isIndexingVectors = ref(false);
  const vectorIndexProgress = ref(0);
  const vectorIndexTotal = ref(0);
  const vectorIndexError = ref<string | null>(null);

  const bm25DocCount = ref(0);
  const vectorDocCount = ref(0);

  const query = ref("");
  const results = ref<SearchResult[]>([]);
  const isSearching = ref(false);

  const askHistory = ref<Array<{ prompt: string; result: AskResult }>>([]);
  const isAsking = ref(false);
  const askError = ref<string | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const hasToken = computed(() => hasGithubToken());
  const searchMode = computed<SearchMode>(() =>
    hasToken.value && vectorDocCount.value > 0 ? "hybrid" : "bm25-only",
  );
  const isReady = computed(() => bm25DocCount.value > 0);

  // ── BM25 index management ────────────────────────────────────────────────────

  function rebuildBM25Index(entries: InsightEntry[]): void {
    isIndexingBM25.value = true;
    const docs = entriesToBM25Docs(entries);
    bm25.buildFromDocuments(docs);
    bm25DocCount.value = bm25.size;
    isIndexingBM25.value = false;
  }

  // ── Vector index management ──────────────────────────────────────────────────

  async function rebuildVectorIndex(entries: InsightEntry[]): Promise<void> {
    if (!hasGithubToken()) return;
    isIndexingVectors.value = true;
    vectorIndexError.value = null;
    vectorIndexProgress.value = 0;

    const docs = entriesToVectorDocs(entries);
    vectorIndexTotal.value = docs.length;

    try {
      await vectorStore.indexDocuments(docs, (indexed, total) => {
        vectorIndexProgress.value = indexed;
        vectorIndexTotal.value = total;
      });
      vectorDocCount.value = vectorStore.size;
    } catch (err) {
      vectorIndexError.value = err instanceof Error ? err.message : String(err);
    } finally {
      isIndexingVectors.value = false;
    }
  }

  function clearVectorIndex(): void {
    vectorStore.clearStorage();
    vectorDocCount.value = 0;
  }

  // ── Search ───────────────────────────────────────────────────────────────────

  /** All entries from the projects store — set by the watcher in App.vue */
  let _allEntries: InsightEntry[] = [];

  function setEntries(entries: InsightEntry[]): void {
    _allEntries = entries;
  }

  /** Entry lookup map for result enrichment */
  function getEntry(id: string): InsightEntry | undefined {
    return _allEntries.find((e) => e.id === id);
  }

  async function search(q: string, topK = 20): Promise<SearchResult[]> {
    if (!q.trim()) {
      results.value = [];
      return [];
    }

    isSearching.value = true;
    query.value = q;

    try {
      let queryEmbedding: number[] | null = null;
      if (hasGithubToken() && vectorDocCount.value > 0) {
        try {
          queryEmbedding = await embedOne(q);
        } catch {
          // fall back to BM25-only silently
        }
      }

      const raw = engine.search(q, queryEmbedding, { topK });
      const enriched: SearchResult[] = [];

      for (const r of raw) {
        const entry = getEntry(r.id);
        if (entry) enriched.push({ ...r, entry });
      }

      results.value = enriched;
      return enriched;
    } finally {
      isSearching.value = false;
    }
  }

  // ── RAG Ask ──────────────────────────────────────────────────────────────────

  /**
   * Natural language Q&A over indexed entries using Retrieval-Augmented Generation.
   * Retrieves top-15 hybrid results, formats them as context, then calls gpt-4o-mini.
   */
  async function ask(
    prompt: string,
    projectFilter?: string,
  ): Promise<AskResult> {
    isAsking.value = true;
    askError.value = null;

    try {
      // Retrieve relevant context
      const contextResults = await search(prompt, 15);
      const filtered = projectFilter
        ? contextResults.filter((r) => r.entry.projectId === projectFilter)
        : contextResults;

      const context = filtered
        .slice(0, 12)
        .map((r) => {
          const e = r.entry;
          const date = new Date(e.meta.timestamp).toLocaleString("nl-NL", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          });
          if (e.meta.source === "commit") {
            return `[COMMIT] ${date} — ${e.projectId}: ${e.meta.title}${e.meta.description ? ` (${e.meta.description})` : ""}`;
          }
          if (e.meta.source === "chat") {
            return `[CHAT] ${date} — ${e.projectId}: ${e.meta.title}${e.meta.description ? ` | ${e.meta.description}` : ""}`;
          }
          return `[${e.meta.source.toUpperCase()}] ${date} — ${e.projectId}: ${e.meta.title}`;
        })
        .join("\n");

      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `Je bent een behulpzame assistent die een ontwikkelaar helpt inzicht te krijgen in hun projecten op basis van git commits en Copilot chat sessies.
Geef altijd een concreet, gestructureerd antwoord in het Nederlands.
Verwijs specifiek naar projectnamen, data en details uit de context.
Als je iets niet kunt beantwoorden op basis van de context, zeg dat dan eerlijk.

Huidige datum: ${new Date().toLocaleDateString("nl-NL")}`,
        },
        {
          role: "user",
          content: `Context uit het dashboard (meest relevante entries):
${context || "(geen relevante entries gevonden)"}

Vraag: ${prompt}`,
        },
      ];

      const completion = await chatComplete(messages, {
        model: "gpt-4o-mini",
        temperature: 0.3,
        maxTokens: 2048,
      });

      const result: AskResult = {
        answer: completion.content,
        sources: filtered.slice(0, 12),
        model: completion.model,
        tokensUsed: completion.usage.total_tokens,
      };

      askHistory.value.unshift({ prompt, result });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      askError.value = msg;
      throw err;
    } finally {
      isAsking.value = false;
    }
  }

  function clearHistory(): void {
    askHistory.value = [];
  }

  return {
    // State
    isIndexingBM25,
    isIndexingVectors,
    vectorIndexProgress,
    vectorIndexTotal,
    vectorIndexError,
    bm25DocCount,
    vectorDocCount,
    query,
    results,
    isSearching,
    askHistory,
    isAsking,
    askError,
    // Derived
    hasToken,
    searchMode,
    isReady,
    // Actions
    rebuildBM25Index,
    rebuildVectorIndex,
    clearVectorIndex,
    setEntries,
    search,
    ask,
    clearHistory,
  };
});
