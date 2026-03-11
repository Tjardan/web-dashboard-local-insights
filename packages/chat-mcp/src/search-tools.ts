/**
 * DevPulse Search MCP tools.
 *
 * Exposes three MCP-callable tools that VS Code Copilot can invoke:
 *
 *   devpulse_search_bm25
 *     BM25+ lexical search over all chat sessions for a workspace.
 *     Fast, no API key required.
 *
 *   devpulse_search_ask
 *     RAG: BM25 retrieval + GitHub Models gpt-4o-mini answer.
 *     Requires GitHub PAT passed as `githubToken`.
 *
 *   devpulse_index_status
 *     Returns current index stats (doc count, workspaces scanned, etc.)
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
import { listSessions, readSession } from "./storage.js";
import { extractSnippet, buildLLMContext } from "./formatter.js";

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
}

export async function searchBM25(
  params: SearchBM25Params,
): Promise<SearchBM25Result[]> {
  const cache = await ensureIndex(params.workspaceFilter);

  const topK = params.topK ?? 10;
  const results = cache.bm25.search(params.query, topK);

  const enriched: SearchBM25Result[] = [];

  for (const r of results) {
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
    });
  }

  return enriched;
}

// ─── Tool: devpulse_search_ask ───────────────────────────────────────────────

export interface SearchAskParams {
  prompt: string;
  /** GitHub PAT for GitHub Models API */
  githubToken: string;
  workspaceFilter?: string;
  topK?: number;
  model?: string;
}

export interface SearchAskResult {
  answer: string;
  model: string;
  tokensUsed: number;
  sources: SearchBM25Result[];
}

export async function searchAsk(
  params: SearchAskParams,
): Promise<SearchAskResult> {
  // 1. BM25 retrieval
  const sources = await searchBM25({
    query: params.prompt,
    workspaceFilter: params.workspaceFilter,
    topK: params.topK ?? 12,
  });

  // 2. For top-5 results, read full session content for richer context
  const contextParts: string[] = [];
  for (const src of sources.slice(0, 5)) {
    try {
      const session = await readSession(src.id);
      if (!session) continue;
      const snippet = buildLLMContext(session.turns)
        .slice(0, 2000);
      const date = new Date(src.lastModified).toLocaleDateString("nl-NL");
      contextParts.push(
        `[CHAT ${date} — ${src.workspace}] ${src.title}\n${snippet}`,
      );
    } catch {
      contextParts.push(`[CHAT — ${src.workspace}] ${src.title}`);
    }
  }

  // Add remaining sources as title-only context
  for (const src of sources.slice(5)) {
    const date = new Date(src.lastModified).toLocaleDateString("nl-NL");
    contextParts.push(`[CHAT ${date} — ${src.workspace}] ${src.title}`);
  }

  const context = contextParts.join("\n\n");

  // 3. GitHub Models chat completion
  const ENDPOINT = "https://models.inference.ai.azure.com";
  const response = await fetch(`${ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.githubToken}`,
    },
    body: JSON.stringify({
      model: params.model ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Je bent een behulpzame assistent die een ontwikkelaar helpt inzicht te krijgen in hun projecten op basis van Copilot chat sessies.
Geef altijd een concreet, gestructureerd antwoord in het Nederlands.
Verwijs specifiek naar projectnamen, data en details uit de context.
Als je iets niet kunt beantwoorden op basis van de context, zeg dat dan eerlijk.

Huidige datum: ${new Date().toLocaleDateString("nl-NL")}`,
        },
        {
          role: "user",
          content: `Context (meest relevante chat sessies):\n${context || "(geen relevante sessies gevonden)"}\n\nVraag: ${params.prompt}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub Models error (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };

  return {
    answer: data.choices[0]?.message?.content ?? "",
    model: data.model,
    tokensUsed: data.usage.total_tokens,
    sources,
  };
}

// ─── Tool: devpulse_index_status ─────────────────────────────────────────────

export interface IndexStatusResult {
  docCount: number;
  indexedAt: string | null;
  isStale: boolean;
}

export function getIndexStatus(): IndexStatusResult {
  const now = new Date();
  // Report on the global (unfiltered) cache entry, falling back to the most recently built one
  const global = indexCaches.get("");
  const latest =
    global ??
    [...indexCaches.values()].sort(
      (a, b) => b.indexedAt.getTime() - a.indexedAt.getTime(),
    )[0];

  const isStale =
    !latest || now.getTime() - latest.indexedAt.getTime() > INDEX_TTL_MS;

  return {
    docCount: latest?.bm25.size ?? 0,
    indexedAt: latest?.indexedAt.toISOString() ?? null,
    isStale,
  };
}
