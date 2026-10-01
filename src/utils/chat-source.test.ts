import { describe, it, expect } from "vitest";
import { chatSessionUrl, isChatEntry, isChatSource } from "./chat-source";
import type { InsightEntry, SourceType } from "@/types";

/**
 * Three views compared `source === "chat"` directly and silently dropped every
 * Claude session as a result. These helpers exist so that cannot happen again,
 * and the URL builder is where the `claude:` prefix gets undone — a mistake
 * there shows up as a 404 on expanding a chat, not as a type error.
 */

function entry(
  source: SourceType,
  id: string,
  extra?: Record<string, unknown>,
): InsightEntry {
  return {
    id,
    projectId: "web-dashboard-local-insights",
    meta: {
      source,
      timestamp: "2026-10-01T10:00:00.000Z",
      title: "een sessie",
      ...(extra === undefined ? {} : { extra }),
    },
    payload: null,
  };
}

describe("isChatSource", () => {
  it("accepts both chat backends", () => {
    expect(isChatSource("chat")).toBe(true);
    expect(isChatSource("claude-chat")).toBe(true);
  });

  it("rejects everything else", () => {
    for (const s of ["commit", "file-change", "teams", "email"] as SourceType[]) {
      expect(isChatSource(s)).toBe(false);
    }
  });
});

describe("isChatEntry", () => {
  it("reads the source off the entry", () => {
    expect(isChatEntry(entry("claude-chat", "claude:abc"))).toBe(true);
    expect(isChatEntry(entry("commit", "a1b2c3"))).toBe(false);
  });
});

describe("chatSessionUrl", () => {
  it("strips the claude: prefix the API does not accept", () => {
    const url = chatSessionUrl(entry("claude-chat", "claude:abc-123"));

    expect(url).toBe("/api/chat-session?id=abc-123&source=claude");
  });

  it("prefers the bare id from meta.extra when it is there", () => {
    const url = chatSessionUrl(
      entry("claude-chat", "claude:abc-123", { sessionId: "abc-123" }),
    );

    expect(url).toBe("/api/chat-session?id=abc-123&source=claude");
  });

  it("maps a Copilot entry to the copilot source", () => {
    expect(chatSessionUrl(entry("chat", "sess-9"))).toBe(
      "/api/chat-session?id=sess-9&source=copilot",
    );
  });

  it("encodes an id that would otherwise break the query string", () => {
    expect(chatSessionUrl(entry("chat", "a b&c"))).toBe(
      "/api/chat-session?id=a%20b%26c&source=copilot",
    );
  });
});
