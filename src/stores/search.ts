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
import {
  embedOne,
  chatComplete,
  hasGithubToken,
  getChatModel,
  CHAT_MODEL_DEFAULT,
} from "@/search/github-models";
import type { InsightEntry } from "@/types";
import type { HybridResult } from "@/search/hybrid";
import type { ChatMessage } from "@/search/github-models";

// ─── Result type ──────────────────────────────────────────────────────────────

export interface SearchResult extends HybridResult {
  entry: InsightEntry;
}

export type SearchMode = "bm25-only" | "hybrid" | "semantic-only";

export interface AskContextStats {
  commits: number;
  chats: number;
  /** Days used for time-window filtering; null = search-based RAG fallback */
  timeRangeDays: number | null;
  contextChars: number;
  wasTrimmed: boolean;
  /** Input token budget used for context (derived from model limits) */
  contextBudgetChars: number;
}

export interface AskResult {
  answer: string;
  /** Entries used as context — InsightEntry for direct access without search scores */
  sources: InsightEntry[];
  model: string;
  tokensUsed: number;
  contextStats: AskContextStats;
}

// Minimal types for /api/chat-session JSON response
interface ApiChatTurn {
  turnIndex: number;
  timestamp: string;
  userMessage: string;
  aiResponse: string;
}

interface ApiChatSession {
  id: string;
  title: string;
  turns: ApiChatTurn[];
}

// ── Context helpers ───────────────────────────────────────────────────────────

/** Strip Claude thinking blocks that the formatter wraps in <thinking>…</thinking> */
const THINKING_RE = /<thinking>[\s\S]*?<\/thinking>/g;
function stripThinking(text: string): string {
  return text.replace(THINKING_RE, "").trim();
}

/** Format ISO timestamp as nl-NL short date */
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Trim session turn text to maxChars using a 1/3-start + 2/3-end strategy.
 * Keeps the beginning (setup/context) and the end (latest/most relevant turns),
 * dropping the middle only when the budget is exceeded.
 */
function trimSession(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const startBudget = Math.floor(maxChars / 3);
  const endBudget = maxChars - startBudget;
  return `${text.slice(0, startBudget)}\n[...ingekort...]\n${text.slice(text.length - endBudget)}`;
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
  const askChatProgress = ref(0); // chat sessions fetched so far
  const askChatTotal = ref(0); // total chat sessions to fetch this ask

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
   * Natural language Q&A using Retrieval-Augmented Generation.
   *
   * When `timeRangeDays` is given: collects ALL entries in that window, fetches
   * full chat-session content (thinking stripped), then applies a 60 000-char
   * budget with a 1/3-start + 2/3-end trim per session when needed.
   *
   * Without `timeRangeDays`: falls back to top-15 hybrid-search results
   * (previous behaviour, used when "Alles" is selected in the UI).
   */
  async function ask(
    prompt: string,
    projectFilter?: string,
    timeRangeDays?: number,
    modelId: string = CHAT_MODEL_DEFAULT,
  ): Promise<AskResult> {
    isAsking.value = true;
    askError.value = null;
    askChatProgress.value = 0;
    askChatTotal.value = 0;

    try {
      // ── Time-window based context collection ───────────────────────────────
      // Resolve model info once — drives the context budget
      const modelInfo = getChatModel(modelId);
      // Reserve ~2 000 chars for system prompt + question; rest is context budget
      const RESERVE_CHARS = 2_000;
      const CONTEXT_BUDGET = Math.max(
        0,
        modelInfo.inputCharLimit - RESERVE_CHARS,
      );

      if (timeRangeDays !== undefined) {
        const now = new Date();
        const cutoff = new Date(now);
        cutoff.setDate(cutoff.getDate() - timeRangeDays);

        let candidates = _allEntries.filter(
          (e) => new Date(e.meta.timestamp) >= cutoff,
        );
        if (projectFilter) {
          candidates = candidates.filter((e) => e.projectId === projectFilter);
        }
        // Oldest first so the AI reads context chronologically
        candidates.sort(
          (a, b) =>
            new Date(a.meta.timestamp).getTime() -
            new Date(b.meta.timestamp).getTime(),
        );

        const commitEntries = candidates.filter(
          (e) => e.meta.source === "commit",
        );
        const chatEntries = candidates.filter((e) => e.meta.source === "chat");

        // Commits are small — always include fully
        const commitsBlock = commitEntries
          .map(
            (e) =>
              `[COMMIT] ${fmtDate(e.meta.timestamp)} — ${e.projectId}: ${e.meta.title}${e.meta.description ? ` (${e.meta.description})` : ""}`,
          )
          .join("\n");

        // Fetch full chat sessions in parallel
        askChatTotal.value = chatEntries.length;
        const sessionResults = await Promise.allSettled(
          chatEntries.map(async (e) => {
            const res = await fetch(
              `/api/chat-session?id=${encodeURIComponent(e.id)}`,
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const session = (await res.json()) as ApiChatSession;
            askChatProgress.value++;
            return { entry: e, session };
          }),
        );

        // Format each session: strip thinking, join turns
        const rawChatBlocks: Array<{ entry: InsightEntry; text: string }> = [];
        for (const r of sessionResults) {
          if (r.status === "rejected") continue;
          const { entry, session } = r.value;
          const header = `[CHAT] ${fmtDate(entry.meta.timestamp)} — ${entry.projectId}: "${session.title}"`;
          const turnText = (session.turns ?? [])
            .map((t) => {
              const u = t.userMessage.trim();
              const a = stripThinking(t.aiResponse).trim();
              const lines: string[] = [];
              if (u) lines.push(`User: ${u}`);
              if (a) lines.push(`AI: ${a}`);
              return lines.join("\n");
            })
            .filter(Boolean)
            .join("\n");
          rawChatBlocks.push({ entry, text: `${header}\n${turnText}` });
        }

        // ── Budget: derived from selected model's token limit ────────────────
        const TOTAL_BUDGET = CONTEXT_BUDGET;
        const chatBudget = Math.max(0, TOTAL_BUDGET - commitsBlock.length);
        const perSessionBudget =
          rawChatBlocks.length > 0
            ? Math.floor(chatBudget / rawChatBlocks.length)
            : chatBudget;

        let wasTrimmed = false;
        const trimmedChatBlocks = rawChatBlocks.map(({ text }) => {
          if (text.length <= perSessionBudget) return text;
          wasTrimmed = true;
          return trimSession(text, perSessionBudget);
        });

        const chatBlock = trimmedChatBlocks.join("\n\n");
        const context = [commitsBlock, chatBlock].filter(Boolean).join("\n\n");

        const startDate = cutoff.toLocaleDateString("nl-NL");
        const endDate = now.toLocaleDateString("nl-NL");
        const contextSummary = [
          commitEntries.length > 0
            ? `${commitEntries.length} commit${commitEntries.length !== 1 ? "s" : ""}`
            : "",
          rawChatBlocks.length > 0
            ? `${rawChatBlocks.length} chat${rawChatBlocks.length !== 1 ? "s" : ""}`
            : "",
        ]
          .filter(Boolean)
          .join(", ");

        const messages: ChatMessage[] = [
          {
            role: "system",
            content: `Je bent een behulpzame assistent die een ontwikkelaar helpt inzicht te krijgen in hun werkzaamheden.
Je analyseert activiteiten van de afgelopen ${timeRangeDays} dag${timeRangeDays !== 1 ? "en" : ""} (${startDate} t/m ${endDate}).
Geef altijd een concreet, gestructureerd antwoord in het Nederlands.
Verwijs specifiek naar projectnamen, data en details uit de context.
Groepeer bij overzichtsvragen per dag of per project voor overzichtelijkheid.
Als je iets niet kunt beantwoorden op basis van de context, zeg dat dan eerlijk.`,
          },
          {
            role: "user",
            content: `Context (${contextSummary || "geen entries"}):\n${context || "(geen entries gevonden in dit tijdvenster)"}\n\nVraag: ${prompt}`,
          },
        ];

        const completion = await chatComplete(messages, {
          model: modelId,
          temperature: 0.3,
          maxTokens: modelInfo.outputTokenLimit,
        });

        const contextStats: AskContextStats = {
          commits: commitEntries.length,
          chats: rawChatBlocks.length,
          timeRangeDays,
          contextChars: context.length,
          wasTrimmed,
          contextBudgetChars: CONTEXT_BUDGET,
        };

        const result: AskResult = {
          answer: completion.content,
          sources: [...commitEntries, ...rawChatBlocks.map((b) => b.entry)],
          model: completion.model,
          tokensUsed: completion.usage.total_tokens,
          contextStats,
        };

        askHistory.value.unshift({ prompt, result });
        return result;
      }

      // ── Fallback: search-based RAG (no time window — "Alles" option) ────────
      const contextResults = await search(prompt, 15);
      const filtered = projectFilter
        ? contextResults.filter((r) => r.entry.projectId === projectFilter)
        : contextResults;

      // For search-based fallback, slice proportional to budget (1 entry ≈ 200 chars)
      const fallbackSliceSize = Math.min(
        Math.floor(CONTEXT_BUDGET / 200),
        filtered.length,
      );

      const context = filtered
        .slice(0, fallbackSliceSize)
        .map((r) => {
          const e = r.entry;
          const date = fmtDate(e.meta.timestamp);
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
          content: `Je bent een behulpzame assistent die een ontwikkelaar helpt inzicht te krijgen in hun projecten.
Geef altijd een concreet, gestructureerd antwoord in het Nederlands.
Verwijs specifiek naar projectnamen, data en details uit de context.
Als je iets niet kunt beantwoorden op basis van de context, zeg dat dan eerlijk.

Huidige datum: ${new Date().toLocaleDateString("nl-NL")}`,
        },
        {
          role: "user",
          content: `Context uit het dashboard (meest relevante entries):\n${context || "(geen relevante entries gevonden)"}\n\nVraag: ${prompt}`,
        },
      ];

      const completion = await chatComplete(messages, {
        model: modelId,
        temperature: 0.3,
        maxTokens: modelInfo.outputTokenLimit,
      });

      const fallbackSlice = filtered.slice(0, fallbackSliceSize);
      const contextStats: AskContextStats = {
        commits: fallbackSlice.filter((r) => r.entry.meta.source === "commit")
          .length,
        chats: fallbackSlice.filter((r) => r.entry.meta.source === "chat")
          .length,
        timeRangeDays: null,
        contextChars: context.length,
        wasTrimmed: false,
        contextBudgetChars: CONTEXT_BUDGET,
      };

      const result: AskResult = {
        answer: completion.content,
        sources: fallbackSlice.map((r) => r.entry),
        model: completion.model,
        tokensUsed: completion.usage.total_tokens,
        contextStats,
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
    askChatProgress,
    askChatTotal,
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
