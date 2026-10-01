import { describe, it, expect } from "vitest";
import {
  buildClaudeTurns,
  claudeSessionTitle,
  stripInjectedBlocks,
} from "./claude-formatter.js";
import type { ClaudeRecord } from "./types.js";

/**
 * These tests pin down what ends up in the search index, which is the part of
 * the Claude reader with real consequences: a `tool_result` that slips through
 * fills the 100k cap with file dumps, and a harness injection that slips
 * through repeats verbatim across hundreds of sessions and skews the IDF.
 */

function user(text: string, extra: Partial<ClaudeRecord> = {}): ClaudeRecord {
  return {
    type: "user",
    timestamp: "2026-10-01T10:00:00.000Z",
    message: { role: "user", content: [{ type: "text", text }] },
    ...extra,
  };
}

function assistant(
  blocks: Array<Record<string, unknown>>,
  extra: Partial<ClaudeRecord> = {},
): ClaudeRecord {
  return {
    type: "assistant",
    timestamp: "2026-10-01T10:00:01.000Z",
    message: { role: "assistant", model: "claude-opus-5", content: blocks },
    ...extra,
  } as ClaudeRecord;
}

describe("stripInjectedBlocks", () => {
  it("removes a harness injection and keeps the user's own words", () => {
    const text =
      "<system-reminder>Follow the rules in CLAUDE.md</system-reminder>\nwat staat er in de cache?";
    expect(stripInjectedBlocks(text)).toBe("wat staat er in de cache?");
  });

  it("removes every injected tag it knows about", () => {
    const text = [
      "<ide_opened_file>src/App.vue</ide_opened_file>",
      "<ide_selection>const x = 1</ide_selection>",
      "<ide_diagnostics>no errors</ide_diagnostics>",
      "<command-name>/compact</command-name>",
      "<command-message>compact</command-message>",
      "<command-args>samenvatten</command-args>",
      "<local-command-stdout>864 docs</local-command-stdout>",
      "<local-command-stderr>warning</local-command-stderr>",
      "echte vraag",
    ].join("\n");
    expect(stripInjectedBlocks(text)).toBe("echte vraag");
  });

  it("drops an unclosed injection left by a truncated write", () => {
    const text = "echte vraag\n<system-reminder>afgekapt tijdens schrijven";
    expect(stripInjectedBlocks(text)).toBe("echte vraag");
  });

  it("unwraps pasted content instead of discarding it", () => {
    // The user really did paste this, so the text belongs in the index — only
    // the wrapper tags go.
    const text = '<pasted_content id="abc">stacktrace regel 1</pasted_content>';
    expect(stripInjectedBlocks(text)).toBe("stacktrace regel 1");
  });

  it("leaves ordinary text alone", () => {
    expect(stripInjectedBlocks("gewoon een zin")).toBe("gewoon een zin");
  });
});

describe("buildClaudeTurns", () => {
  it("pairs a prompt with the assistant answer that follows it", () => {
    const turns = buildClaudeTurns([
      user("hoe werkt de cache?"),
      assistant([{ type: "text", text: "Per sessiebestand." }]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.userMessage).toBe("hoe werkt de cache?");
    expect(turns[0]?.aiResponse).toBe("Per sessiebestand.");
    expect(turns[0]?.modelId).toBe("claude-opus-5");
    expect(turns[0]?.turnIndex).toBe(0);
  });

  it("folds several assistant records into one turn", () => {
    const turns = buildClaudeTurns([
      user("vraag"),
      assistant([{ type: "text", text: "eerste deel" }]),
      assistant([{ type: "tool_use", name: "Read", input: { file: "a.ts" } }]),
      assistant([{ type: "text", text: "tweede deel" }]),
      user("volgende vraag"),
      assistant([{ type: "text", text: "antwoord" }]),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.aiResponse).toBe("eerste deel\n\ntweede deel");
    expect(turns[0]?.toolCalls).toHaveLength(1);
    expect(turns[0]?.toolCalls[0]?.toolId).toBe("Read");
    expect(turns[1]?.turnIndex).toBe(1);
  });

  it("skips tool_result records, which are output and not a prompt", () => {
    const turns = buildClaudeTurns([
      user("lees het bestand"),
      assistant([{ type: "tool_use", name: "Read", input: {} }]),
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "export const CACHE_ROOT = …",
            },
          ],
        },
      },
      assistant([{ type: "text", text: "Gelezen." }]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.userMessage).toBe("lees het bestand");
    expect(turns[0]?.aiResponse).toBe("Gelezen.");
    // The file contents must not have leaked into the indexable text
    expect(JSON.stringify(turns)).not.toContain("CACHE_ROOT");
  });

  it("skips sidechain records so a subagent is not read as the user", () => {
    const turns = buildClaudeTurns([
      user("zoek het uit"),
      assistant([{ type: "text", text: "Ik start een subagent." }]),
      user("subagent-prompt", { isSidechain: true }),
      assistant([{ type: "text", text: "subagent-antwoord" }], {
        isSidechain: true,
      }),
      assistant([{ type: "text", text: "Klaar." }]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.aiResponse).toBe("Ik start een subagent.\n\nKlaar.");
  });

  it("drops a prompt that is nothing but a harness injection", () => {
    const turns = buildClaudeTurns([
      user("<system-reminder>context</system-reminder>"),
      assistant([{ type: "text", text: "genegeerd" }]),
      user("echte vraag"),
      assistant([{ type: "text", text: "antwoord" }]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.userMessage).toBe("echte vraag");
  });

  it("wraps thinking so the shared formatter can strip it later", () => {
    // buildIndexableText() removes <thinking>…</thinking>; the tag is what
    // keeps reasoning out of the index while leaving it readable in the UI.
    const turns = buildClaudeTurns([
      user("vraag"),
      assistant([
        { type: "thinking", thinking: "intern redeneren" },
        { type: "text", text: "antwoord" },
      ]),
    ]);

    expect(turns[0]?.aiResponse).toBe(
      "antwoord\n\n<thinking>\nintern redeneren\n</thinking>",
    );
  });

  it("ignores assistant output that arrives before any prompt", () => {
    const turns = buildClaudeTurns([
      assistant([{ type: "text", text: "wees" }]),
      user("vraag"),
      assistant([{ type: "text", text: "antwoord" }]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.aiResponse).toBe("antwoord");
  });

  it("ignores bookkeeping records entirely", () => {
    const turns = buildClaudeTurns([
      { type: "file-history-snapshot", snapshot: { files: ["a.ts"] } },
      { type: "queue-operation" },
      user("vraag"),
      assistant([{ type: "text", text: "antwoord" }]),
    ]);

    expect(turns).toHaveLength(1);
  });

  it("accepts a plain string as message content", () => {
    const turns = buildClaudeTurns([
      { type: "user", message: { role: "user", content: "kale string" } },
      {
        type: "assistant",
        message: { role: "assistant", content: "ook kaal" },
      },
    ]);

    expect(turns[0]?.userMessage).toBe("kale string");
    expect(turns[0]?.aiResponse).toBe("ook kaal");
  });

  it("returns nothing for a log without a single prompt", () => {
    expect(buildClaudeTurns([])).toEqual([]);
    expect(buildClaudeTurns([{ type: "ai-title", aiTitle: "iets" }])).toEqual(
      [],
    );
  });
});

describe("claudeSessionTitle", () => {
  const turns = buildClaudeTurns([
    user("een hele lange eerste prompt die als titel moet dienen"),
  ]);

  it("prefers a user-set title over the generated one", () => {
    const records: ClaudeRecord[] = [
      { type: "ai-title", aiTitle: "Gegenereerd" },
      { type: "custom-title", customTitle: "Zelf gekozen" },
    ];
    expect(claudeSessionTitle(records, turns)).toBe("Zelf gekozen");
  });

  it("prefers a user-set title even when the generated one came last", () => {
    const records: ClaudeRecord[] = [
      { type: "custom-title", customTitle: "Zelf gekozen" },
      { type: "ai-title", aiTitle: "Gegenereerd" },
    ];
    expect(claudeSessionTitle(records, turns)).toBe("Zelf gekozen");
  });

  it("takes the last title of a kind, since they are appended over time", () => {
    const records: ClaudeRecord[] = [
      { type: "ai-title", aiTitle: "Eerste poging" },
      { type: "ai-title", aiTitle: "Betere titel" },
    ];
    expect(claudeSessionTitle(records, turns)).toBe("Betere titel");
  });

  it("falls back to the first prompt, capped at 60 characters", () => {
    const title = claudeSessionTitle([], turns);
    expect(title).toBe("een hele lange eerste prompt die als titel moet dienen");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("falls back to Untitled when there is nothing at all", () => {
    expect(claudeSessionTitle([], [])).toBe("Untitled");
  });
});
