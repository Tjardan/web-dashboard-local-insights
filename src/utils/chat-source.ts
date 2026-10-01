/**
 * Helpers for dealing with the two chat sources as one category.
 *
 * Copilot and Claude Code sessions are separate connectors with their own
 * entries and filter toggles, but almost everything that consumes them — the
 * timeline detail view, the dashboard counters, the RAG context builder —
 * cares only that something is a chat. Centralising that here keeps a third
 * source from needing another round of `source === "chat" || …` edits.
 */
import type { InsightEntry, SourceType } from "@/types";

/** Every source that represents an AI chat session. */
export const CHAT_SOURCES: readonly SourceType[] = ["chat", "claude-chat"];

export function isChatSource(source: SourceType): boolean {
  return CHAT_SOURCES.includes(source);
}

export function isChatEntry(entry: InsightEntry): boolean {
  return isChatSource(entry.meta.source);
}

/**
 * Build the /api/chat-session URL for a chat entry.
 *
 * Claude entry IDs are prefixed (`claude:<uuid>`) so they cannot collide with
 * Copilot ones in a shared index; the API wants the bare ID plus a source, so
 * the prefix is stripped here. `meta.extra.sessionId` holds the same value and
 * is preferred when present.
 */
export function chatSessionUrl(entry: InsightEntry): string {
  const extra = entry.meta.extra ?? {};
  const sessionId =
    (extra["sessionId"] as string | undefined) ??
    entry.id.replace(/^claude:/, "");
  const source = entry.meta.source === "claude-chat" ? "claude" : "copilot";
  return `/api/chat-session?id=${encodeURIComponent(sessionId)}&source=${source}`;
}
