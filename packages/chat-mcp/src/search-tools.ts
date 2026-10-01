/**
 * DevPulse Search MCP tools.
 *
 * Backs the two tools exposed by mcp-server.ts:
 *
 *   devpulse_search        → searchBM25()
 *     BM25+ lexical search over all chat sessions, optionally filtered by
 *     workspace. Fast, no API key required.
 *
 *   devpulse_index_status  → getIndexStatus()
 *     Index stats. Builds the index first, so it never reports "unavailable"
 *     for an index that a search would have built anyway.
 *
 * The index is built lazily and rebuilt whenever it is older than
 * INDEX_TTL_MS — both entry points go through ensureIndex(), so a search
 * always returns current data regardless of what the cache held before.
 *
 * Usage from MCP host (VS Code mcp config):
 *   {
 *     "name": "devpulse",
 *     "command": "node",
 *     "args": ["packages/chat-mcp/dist/mcp-server.js"],
 *     "cwd": "<workspace>"
 *   }
 */

import { BM25Index, type BM25Document } from "./bm25.js";
import { listSessions } from "./storage.js";
import { extractSnippet } from "./formatter.js";

// ─── In-memory index (per workspace-filter, rebuilt on TTL expiry) ────────────

interface IndexedEntry {
  id: string;
  workspacePath: string;
  workspaceName: string;
  title: string;
  creationDate: string;
  lastModified: string;
  messageCount: number;
  /** Stripped turn content (user messages + AI answers, no thinking/tool calls) for BM25 + snippet extraction */
  text: string;
}

interface IndexCache {
  entries: IndexedEntry[];
  bm25: BM25Index;
  indexedAt: Date;
}

/**
 * Separate index cache per workspace filter key.
 * Key "" = no filter (all workspaces). Any other string = filtered workspace.
 * This ensures a workspace-filtered search never reuses a global (unfiltered) index.
 */
const indexCaches = new Map<string, IndexCache>();
const INDEX_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function ensureIndex(workspaceFilter?: string): Promise<IndexCache> {
  const key = workspaceFilter?.trim().toLowerCase() ?? "";
  const now = new Date();
  const cached = indexCaches.get(key);
  if (cached && now.getTime() - cached.indexedAt.getTime() < INDEX_TTL_MS) {
    return cached;
  }

  const sessions = await listSessions({
    workspaceFilter,
    sort: "newest",
    includeIndexableText: true,
  });

  const entries: IndexedEntry[] = sessions.map((s) => ({
    id: s.id,
    workspacePath: s.workspacePath,
    workspaceName: s.workspace,
    title: s.title,
    creationDate: s.creationDate,
    lastModified: s.lastModified,
    messageCount: s.messageCount,
    text: s.indexableText ?? s.title,
  }));

  const docs: BM25Document[] = entries.map((e) => ({
    id: e.id,
    fields: [
      { text: e.title, weight: 3 },
      { text: e.workspaceName, weight: 2 },
      { text: e.text, weight: 1 },
    ],
  }));

  const idx = new BM25Index();
  idx.buildFromDocuments(docs);

  const cache: IndexCache = { entries, bm25: idx, indexedAt: now };
  indexCaches.set(key, cache);
  return cache;
}

// ─── Tool: devpulse_search_bm25 ──────────────────────────────────────────────

export interface SearchBM25Params {
  query: string;
  workspaceFilter?: string;
  topK?: number;
  since?: string;
  /** When true, include the session's indexable text (all turns, thinking and tool calls stripped) in each result */
  includeContent?: boolean;
  /** Max chars of content to include per session (default 8000) */
  contentMaxChars?: number;
}

export interface SearchBM25Result {
  id: string;
  score: number;
  title: string;
  workspace: string;
  workspacePath: string;
  creationDate: string;
  lastModified: string;
  messageCount: number;
  snippet?: string;
  /** Session content — only present when includeContent=true */
  content?: string;
}

export async function searchBM25(
  params: SearchBM25Params,
): Promise<SearchBM25Result[]> {
  const cache = await ensureIndex(params.workspaceFilter);

  const topK = params.topK ?? 6;
  const contentMaxChars = params.contentMaxChars ?? 8000;

  // When a date filter is active, retrieve a wider candidate set: the filter is
  // applied per result, so slicing to topK first would let older-but-higher-scoring
  // sessions crowd out the matches that actually fall inside the window.
  const candidateK = params.since ? Math.max(topK * 5, 50) : topK;
  const results = cache.bm25.search(params.query, candidateK);

  const enriched: SearchBM25Result[] = [];

  for (const r of results) {
    if (enriched.length >= topK) break;

    const entry = cache.entries.find((e) => e.id === r.id);
    if (!entry) continue;

    // Optional date filter
    if (params.since && entry.lastModified < params.since) continue;

    enriched.push({
      id: entry.id,
      score: r.score,
      title: entry.title,
      workspace: entry.workspaceName,
      workspacePath: entry.workspacePath,
      creationDate: entry.creationDate,
      lastModified: entry.lastModified,
      messageCount: entry.messageCount,
      snippet:
        entry.text !== entry.title
          ? extractSnippet(entry.text, params.query, 160)
          : undefined,
      content:
        params.includeContent && entry.text !== entry.title
          ? entry.text.slice(0, contentMaxChars)
          : undefined,
    });
  }

  return enriched;
}

// ─── Tool: devpulse_index_status ─────────────────────────────────────────────

export interface IndexStatusResult {
  /** Number of indexed chat sessions */
  docCount: number;
  /** Number of distinct workspaces those sessions came from */
  workspaceCount: number;
  /** When this index was built (ISO-8601) */
  indexedAt: string;
  /** lastModified of the most recently touched session on disk (ISO-8601), or null when empty */
  newestSessionAt: string | null;
}

/**
 * Report on the global (unfiltered) index, building it first when needed.
 *
 * Deliberately does NOT report cache age as staleness. The index is lazily
 * built per process and rebuilt on TTL expiry by ensureIndex(), so a cold or
 * expired cache says nothing about the data — it only means no search has run
 * yet in this process. Reporting that as "stale"/"unavailable" was misleading:
 * callers saw a warning while searches returned fully current results.
 *
 * After the await below the index is current by construction, so the numbers
 * describe the data rather than the cache.
 */
export async function getIndexStatus(): Promise<IndexStatusResult> {
  const cache = await ensureIndex();

  // entries are sorted newest-first by listSessions({ sort: "newest" })
  const newestSessionAt = cache.entries[0]?.lastModified ?? null;

  return {
    docCount: cache.bm25.size,
    workspaceCount: new Set(cache.entries.map((e) => e.workspacePath)).size,
    indexedAt: cache.indexedAt.toISOString(),
    newestSessionAt,
  };
}
