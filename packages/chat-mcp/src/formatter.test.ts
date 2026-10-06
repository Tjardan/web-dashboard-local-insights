import { describe, it, expect } from "vitest";
import {
  buildIndexableText,
  buildLLMContext,
  buildTurns,
  detectLastRecapTurn,
  extractSnippet,
} from "./formatter.js";
import type { ConversationTurn, RawChatRequest } from "./types.js";

/**
 * The split between buildIndexableText and buildLLMContext is the easiest thing
 * in this package to get backwards, and the documentation has described it
 * wrongly before: the index takes *everything*, recap-delta applies only to the
 * context handed to a model. The one exception is a session over the index
 * cap, where the index falls back to recap-delta too, so that the newest part
 * survives. These tests are the record of which is which.
 */

function turn(
  userMessage: string,
  aiResponse: string,
  compactSummary?: string,
): ConversationTurn {
  return {
    turnIndex: 0,
    timestamp: "2026-10-01T10:00:00.000Z",
    userMessage,
    aiResponse,
    modelId: "gpt-4o",
    toolCalls: [],
    ...(compactSummary === undefined ? {} : { compactSummary }),
  };
}

describe("buildTurns", () => {
  it("renders markdown content and leaves tool calls out of the text", () => {
    const requests: RawChatRequest[] = [
      {
        timestamp: 1759312800000,
        message: { text: "lees het bestand" },
        modelId: "gpt-4o",
        response: [
          { kind: "markdownContent", value: "Even kijken." },
          {
            kind: "toolInvocationSerialized",
            toolId: "vscode.read_file",
            invocationMessage: "Reading src/App.vue",
          },
          { kind: "markdownContent", value: "Gevonden." },
        ],
      },
    ];

    const [t] = buildTurns(requests);
    expect(t?.userMessage).toBe("lees het bestand");
    expect(t?.aiResponse).toBe("Even kijken.\n\nGevonden.");
    expect(t?.toolCalls).toHaveLength(1);
    expect(t?.toolCalls[0]?.toolId).toBe("vscode.read_file");
  });

  it("wraps thinking in tags so the index can strip it", () => {
    const [t] = buildTurns([
      {
        message: { text: "vraag" },
        response: [
          { kind: "thinking", value: "intern" },
          { kind: "markdownContent", value: "antwoord" },
        ],
      },
    ]);

    expect(t?.aiResponse).toBe("<thinking>\nintern\n</thinking>\n\nantwoord");
  });

  it("falls back to message parts when there is no plain text", () => {
    const [t] = buildTurns([
      {
        message: { parts: [{ text: "deel een " }, { text: "deel twee" }] },
        response: [],
      },
    ]);

    expect(t?.userMessage).toBe("deel een deel twee");
  });

  it("numbers turns in order and survives a request without a response", () => {
    const turns = buildTurns([
      { message: { text: "een" } },
      { message: { text: "twee" }, response: [] },
    ]);

    expect(turns.map((t) => t.turnIndex)).toEqual([0, 1]);
    expect(turns[0]?.aiResponse).toBe("");
  });
});

describe("buildIndexableText", () => {
  it("indexes every turn, not just the ones after a compact", () => {
    const text = buildIndexableText([
      turn("oude vraag", "oud antwoord"),
      turn("compact", "", "<analysis>intern</analysis><summary>korte recap</summary>"),
      turn("nieuwe vraag", "nieuw antwoord"),
    ]);

    expect(text).toContain("oude vraag");
    expect(text).toContain("oud antwoord");
    expect(text).toContain("nieuwe vraag");
  });

  it("adds the compact summary without dropping the turns it replaced", () => {
    const text = buildIndexableText([
      turn("oude vraag", "oud antwoord"),
      turn("compact", "", "<analysis>intern</analysis><summary>korte recap</summary>"),
    ]);

    expect(text).toContain("korte recap");
    expect(text).toContain("oude vraag");
    // <analysis> is model reasoning and stays out
    expect(text).not.toContain("intern");
  });

  it("strips thinking blocks", () => {
    const text = buildIndexableText([
      turn("vraag", "voor <thinking>geheim redeneren</thinking> na"),
    ]);

    expect(text).not.toContain("geheim redeneren");
    expect(text).toContain("vraag");
  });

  it("caps very long sessions at the front and says so", () => {
    // The newest part is what people search for, so the oldest part goes
    const text = buildIndexableText([
      turn("eerste vraag", "woord ".repeat(30_000)),
      turn("laatste vraag", "recent besluit"),
    ]);

    expect(text.length).toBeLessThanOrEqual(100_000);
    expect(text.startsWith("[…begin gekort voor index]")).toBe(true);
    expect(text).toContain("recent besluit");
    expect(text).not.toContain("eerste vraag");
  });

  it("starts the kept tail at a word boundary", () => {
    const text = buildIndexableText([turn("v", "abcdefghij ".repeat(20_000))]);
    const body = text.split("\n")[1] ?? "";

    expect(body.startsWith("abcdefghij")).toBe(true);
  });

  it("keeps the summary and the turns after the compact when a session is too long", () => {
    const text = buildIndexableText([
      turn("oude vraag", "oud ".repeat(30_000)),
      turn("compact", "", "<analysis>intern</analysis><summary>korte recap</summary>"),
      turn("nieuwe vraag", "gefilterd via dispatch"),
    ]);

    expect(text.length).toBeLessThanOrEqual(100_000);
    expect(text.startsWith("[…begin gekort voor index]\nkorte recap\n")).toBe(true);
    expect(text).toContain("gefilterd via dispatch");
    expect(text).not.toContain("oude vraag");
    expect(text).not.toContain("intern");
  });

  it("keeps the summary and the tail when even the turns after the compact do not fit", () => {
    const text = buildIndexableText([
      turn("oude vraag", "oud antwoord"),
      turn("compact", "", "<summary>korte recap</summary>"),
      turn("eerste na compact", "na ".repeat(40_000)),
      turn("laatste vraag", "gefilterd via dispatch"),
    ]);

    expect(text.length).toBeLessThanOrEqual(100_000);
    expect(text).toContain("korte recap");
    expect(text).toContain("gefilterd via dispatch");
    expect(text).not.toContain("eerste na compact");
  });

  it("caps an oversized summary so the newest turns still get room", () => {
    const text = buildIndexableText([
      turn("compact", "", `<summary>${"recap ".repeat(30_000)}</summary>`),
      turn("laatste vraag", "gefilterd via dispatch"),
    ]);

    expect(text.length).toBeLessThanOrEqual(100_000);
    expect(text).toContain("gefilterd via dispatch");
  });

  it("returns an empty string for a session with nothing in it", () => {
    expect(buildIndexableText([])).toBe("");
    expect(buildIndexableText([turn("  ", "  ")])).toBe("");
  });
});

describe("detectLastRecapTurn", () => {
  it("finds the last compact, not the first", () => {
    const turns = [
      turn("a", "", "<summary>eerste</summary>"),
      turn("b", ""),
      turn("c", "", "<summary>tweede</summary>"),
      turn("d", ""),
    ];

    expect(detectLastRecapTurn(turns)).toBe(2);
  });

  it("ignores a summary field without a <summary> block", () => {
    expect(detectLastRecapTurn([turn("a", "", "<analysis>alleen dit</analysis>")])).toBe(
      null,
    );
  });

  it("returns null when no compact happened", () => {
    expect(detectLastRecapTurn([turn("a", "b")])).toBe(null);
  });
});

describe("buildLLMContext", () => {
  it("cuts everything before the last compact — this is where recap-delta lives", () => {
    const context = buildLLMContext([
      turn("oude vraag", "oud antwoord"),
      turn("compact", "", "<summary>korte recap</summary>"),
      turn("nieuwe vraag", "nieuw antwoord"),
    ]);

    expect(context).toContain("korte recap");
    expect(context).toContain("nieuwe vraag");
    expect(context).not.toContain("oude vraag");
  });

  it("keeps the compact turn itself, which holds what followed the summary", () => {
    const context = buildLLMContext([
      turn("oude vraag", "oud antwoord"),
      turn("", "verder na de compact", "<summary>korte recap</summary>"),
    ]);

    expect(context).toBe("korte recap\nA: verder na de compact");
  });

  it("keeps all turns when there was no compact", () => {
    const context = buildLLMContext([
      turn("eerste", "een"),
      turn("tweede", "twee"),
    ]);

    expect(context).toContain("eerste");
    expect(context).toContain("tweede");
  });
});

describe("extractSnippet", () => {
  it("centres the snippet on the match and marks both cuts", () => {
    const text = `${"a".repeat(200)} naaldwoord ${"b".repeat(200)}`;
    const snippet = extractSnippet(text, "naaldwoord", 20);

    expect(snippet).toContain("naaldwoord");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(extractSnippet("De Cache Is Warm", "cache", 5)).toContain("Cache");
  });

  it("falls back to the opening of the text when the query is absent", () => {
    const snippet = extractSnippet("regel een\nregel twee", "kubernetes", 10);

    expect(snippet).toBe("regel een regel twee");
    expect(snippet).not.toContain("\n");
  });
});
