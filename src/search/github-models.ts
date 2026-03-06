/**
 * GitHub Models API client.
 *
 * Provides two capabilities:
 *   1. Text embeddings  — via `text-embedding-3-small` (1536-dim)
 *   2. Chat completions — via `gpt-4o-mini` (fast, cheap) or configurable model
 *
 * The API is OpenAI-compatible, hosted at https://models.inference.ai.azure.com
 * Authentication: GitHub Personal Access Token (read:models scope sufficient).
 *
 * Token is stored only in localStorage under key `devpulse-gh-token` and is
 * never sent to any server other than models.inference.ai.azure.com.
 */

export const GITHUB_MODELS_ENDPOINT = "https://models.inference.ai.azure.com";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const CHAT_MODEL_DEFAULT = "gpt-4o-mini";

// ─── Model catalogue ─────────────────────────────────────────────────────────

export interface ChatModelInfo {
  /** API model id */
  id: string;
  /** Short display label */
  label: string;
  /** Provider / family */
  provider: string;
  /** Hard input-token limit enforced by GitHub Models */
  inputTokenLimit: number;
  /** Recommended max output tokens */
  outputTokenLimit: number;
  /** Characters ≈ tokens × 4 (conservative) */
  inputCharLimit: number;
  /** Brief capability note shown in the picker */
  note: string;
}

/**
 * GitHub Models per-request token limits (confirmed empirically, March 2026).
 * These are hard API caps — unrelated to subscription tier.
 * Copilot Pro/Enterprise only increases rate limits (req/min), not context size.
 *
 * inputCharLimit = floor(inputTokenLimit * 3.5) — conservative char-to-token
 * ratio that leaves headroom for system prompt + answer wrapper.
 */
export const CHAT_MODELS: ChatModelInfo[] = [
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

export function getChatModel(id: string): ChatModelInfo {
  return CHAT_MODELS.find((m) => m.id === id) ?? CHAT_MODELS[0];
}

// ─── Token management ─────────────────────────────────────────────────────────

const TOKEN_KEY = "devpulse-gh-token";

export function getGithubToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setGithubToken(token: string): void {
  // Basic validation: GitHub PATs start with ghp_ or github_pat_
  if (token && !/^(ghp_|github_pat_|ghs_)/.test(token)) {
    throw new Error("Token does not look like a GitHub Personal Access Token");
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
 * Send a chat completion request to GitHub Models.
 * Returns the full assistant message content.
 */
export async function chatComplete(
  messages: ChatMessage[],
  opts: ChatCompletionOptions = {},
): Promise<ChatCompletionResult> {
  const token = getGithubToken();
  if (!token)
    throw new Error("GitHub token not configured — set it in Settings");

  const response = await fetch(`${GITHUB_MODELS_ENDPOINT}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: opts.model ?? CHAT_MODEL_DEFAULT,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub Models chat failed (${response.status}): ${body}`);
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
