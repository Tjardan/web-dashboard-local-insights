/**
 * AI provider client — GitHub Models + GitHub Copilot API.
 *
 * Provides two capabilities:
 *   1. Text embeddings  — via `text-embedding-3-small` on GitHub Models (1536-dim)
 *   2. Chat completions — two endpoints:
 *        • GitHub Models:  https://models.inference.ai.azure.com  (GPT-4o, Llama, …)
 *        • Copilot API:    /api/copilot-proxy  (→ @github/copilot-sdk, Claude family)
 *          The proxy uses the SDK — auth via GITHUB_TOKEN env var on the server.
 *
 * Authentication: GitHub PAT in localStorage used for GitHub Models only.
 */

export const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com";
/** Local Vite proxy that uses @github/copilot-sdk server-side (avoids CORS). */
export const COPILOT_ENDPOINT = "/api/copilot-proxy";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const CHAT_MODEL_DEFAULT = "claude-sonnet-4.6";

// ─── Model catalogue ─────────────────────────────────────────────────────────

export interface ChatModelInfo {
  /** API model id */
  id: string;
  /** Short display label */
  label: string;
  /** Provider / family */
  provider: string;
  /** Hard input-token limit enforced by the API */
  inputTokenLimit: number;
  /** Recommended max output tokens */
  outputTokenLimit: number;
  /** Characters ≈ tokens × 4 (conservative) */
  inputCharLimit: number;
  /** Brief capability note shown in the picker */
  note: string;
  /**
   * Override endpoint for this model.
   * Absent → GITHUB_MODELS_ENDPOINT. Set to COPILOT_ENDPOINT for Claude models.
   */
  endpoint?: string;
}

// ─── Claude models via GitHub Copilot SDK ────────────────────────────────────
//
// Routed via /api/copilot-proxy which uses @github/copilot-sdk on the server.
// Auth: gh CLI (same as robomo) — no githubToken needed in the browser.
// Available model IDs confirmed via client.listModels() on 2026-03-07:
//   claude-sonnet-4.6, claude-sonnet-4.5, claude-haiku-4.5,
//   claude-opus-4.6, claude-opus-4.5
export const CLAUDE_MODELS: ChatModelInfo[] = [
  {
    id: "claude-sonnet-4.6",
    label: "Claude Sonnet 4.6",
    provider: "Anthropic",
    inputTokenLimit: 200_000,
    outputTokenLimit: 16_000,
    inputCharLimit: Math.floor(200_000 * 3.5),
    note: "Actueel standaard Copilot model",
    endpoint: COPILOT_ENDPOINT,
  },
  {
    id: "claude-opus-4.6",
    label: "Claude Opus 4.6",
    provider: "Anthropic",
    inputTokenLimit: 200_000,
    outputTokenLimit: 32_000,
    inputCharLimit: Math.floor(200_000 * 3.5),
    note: "Krachtigst",
    endpoint: COPILOT_ENDPOINT,
  },
  {
    id: "claude-haiku-4.5",
    label: "Claude Haiku 4.5",
    provider: "Anthropic",
    inputTokenLimit: 200_000,
    outputTokenLimit: 8_192,
    inputCharLimit: Math.floor(200_000 * 3.5),
    note: "Snel",
    endpoint: COPILOT_ENDPOINT,
  },
];

// ─── GitHub Models — per-request token limits ────────────────────────────────
//
// Confirmed empirically (March 2026). These are hard API caps unrelated to
// subscription. Copilot Pro/Enterprise only raises rate limits, not context size.
//
// inputCharLimit = floor(inputTokenLimit * 3.5) — conservative char-to-token
// ratio that leaves headroom for system prompt + answer wrapper.
export const GITHUB_CHAT_MODELS: ChatModelInfo[] = [
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "OpenAI",
    inputTokenLimit: 8_192, // confirmed via 413 error
    outputTokenLimit: 2_048,
    inputCharLimit: Math.floor(8_192 * 3.5),
    note: "Snel & goedkoop",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "OpenAI",
    inputTokenLimit: 16_000, // confirmed via 413 error: "Max size: 16000 tokens"
    outputTokenLimit: 4_096,
    inputCharLimit: Math.floor(16_000 * 3.5),
    note: "Sterk redeneren",
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    provider: "OpenAI",
    inputTokenLimit: 4_000, // confirmed by user
    outputTokenLimit: 1_000,
    inputCharLimit: Math.floor(4_000 * 3.5),
    note: "Reasoning model",
  },
  {
    id: "o1-mini",
    label: "o1-mini",
    provider: "OpenAI",
    inputTokenLimit: 4_000, // confirmed by user
    outputTokenLimit: 1_000,
    inputCharLimit: Math.floor(4_000 * 3.5),
    note: "Redeneermodel",
  },
  {
    id: "Phi-4",
    label: "Phi-4",
    provider: "Microsoft",
    inputTokenLimit: 8_192, // confirmed by user (8k)
    outputTokenLimit: 2_048,
    inputCharLimit: Math.floor(8_192 * 3.5),
    note: "Klein & efficiënt",
  },
  {
    id: "DeepSeek-R1",
    label: "DeepSeek R1",
    provider: "DeepSeek",
    inputTokenLimit: 4_000, // confirmed by user
    outputTokenLimit: 1_000,
    inputCharLimit: Math.floor(4_000 * 3.5),
    note: "Open reasoning model",
  },
  {
    id: "Llama-3.3-70B-Instruct",
    label: "Llama 3.3 70B",
    provider: "Meta",
    inputTokenLimit: 16_000, // confirmed by user (16k)
    outputTokenLimit: 4_096,
    inputCharLimit: Math.floor(16_000 * 3.5),
    note: "Open source",
  },
];

/** All available chat models — Claude (Copilot) first, then GitHub Models. */
export const CHAT_MODELS: ChatModelInfo[] = [...CLAUDE_MODELS, ...GITHUB_CHAT_MODELS];

/** Look up a model by id; falls back to Claude 3.5 Haiku (the default). */
export function getChatModel(id: string): ChatModelInfo {
  return CHAT_MODELS.find((m) => m.id === id) ?? CLAUDE_MODELS[2];
}

// ─── Token management ─────────────────────────────────────────────────────────

const TOKEN_KEY = "devpulse-gh-token";

export function getGithubToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setGithubToken(token: string): void {
  // Warn on obviously wrong formats, but don't block — Copilot tokens may
  // differ from classic PAT formats and the API will return a clear 401.
  if (token && !/^(ghp_|github_pat_|ghs_)/.test(token)) {
    console.warn(
      "[DevPulse] Token does not start with a known GitHub PAT prefix — proceeding anyway.",
    );
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearGithubToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasGithubToken(): boolean {
  return !!getGithubToken();
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  input: string | string[];
  model?: string;
}

export interface EmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

/**
 * Request embeddings from GitHub Models API.
 * Batches are automatically split to ≤96 inputs (API limit).
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const token = getGithubToken();
  if (!token)
    throw new Error("GitHub token not configured — set it in Settings");
  if (texts.length === 0) return [];

  const BATCH_SIZE = 96;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input: batch,
        model: EMBEDDING_MODEL,
      } satisfies EmbeddingRequest),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `GitHub Models embeddings failed (${response.status}): ${body}`,
      );
    }

    const data: EmbeddingResponse = await response.json();
    // Ensure ordering matches input
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    results.push(...sorted.map((d) => d.embedding));
  }

  return results;
}

/** Embed a single text string */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  if (!vec) throw new Error("Empty embedding response");
  return vec;
}

// ─── Chat completions ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Stream the response (default false) */
  stream?: false;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Send a chat completion request.
 * Claude models are routed via /api/copilot-proxy (PAT → Copilot token exchange).
 * All other models go directly to GitHub Models.
 */
export async function chatComplete(
  messages: ChatMessage[],
  opts: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const token = getGithubToken();
  if (!token)
    throw new Error("GitHub token niet geconfigureerd — stel in via Settings");

  const modelId = opts.model ?? CHAT_MODEL_DEFAULT;
  const modelInfo = getChatModel(modelId);
  const endpoint = modelInfo.endpoint ?? GITHUB_MODELS_ENDPOINT;

  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const providerLabel = endpoint.includes("copilot-proxy") ? "Copilot API" : "GitHub Models";
    throw new Error(`${providerLabel} chat failed (${response.status}): ${body}`);
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

  const content = data.choices[0]?.message?.content ?? "";
  return { content, model: data.model, usage: data.usage };
}
