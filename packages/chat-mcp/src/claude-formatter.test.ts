import { describe, it, expect } from "vitest";
import {
  askUserAnswerText,
  buildClaudeTurns,
  claudeSessionTitle,
  compactSummaryText,
  stripInjectedBlocks,
} from "./claude-formatter.js";
import {
  buildIndexableText,
  buildLLMContext,
  detectLastRecapTurn,
} from "./formatter.js";
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

// The exact shapes Claude Code writes, taken from real session logs

const COMPACT_TEXT = [
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.",
  "",
  "Summary:",
  "1. Primary Request and Intent:",
  "   - alphatest herbaseren op release/8.1",
  "",
  "If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: C:\\Users\\x\\.claude\\projects\\p\\s.jsonl",
  "Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary.",
].join("\n");

function compactSummary(): ClaudeRecord {
  return {
    type: "user",
    isCompactSummary: true,
    timestamp: "2026-10-02T16:10:09.903Z",
    message: { role: "user", content: COMPACT_TEXT },
  };
}

function askQuestion(id: string): ClaudeRecord {
  return assistant([
    {
      type: "tool_use",
      id,
      name: "AskUserQuestion",
      input: { questions: [{ question: "Hoe pakken we dit op?" }] },
    },
  ]);
}

function toolResult(id: string, content: unknown): ClaudeRecord {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content }],
    },
  };
}

describe("compactSummaryText", () => {
  it("keeps the summary and drops the boilerplate around it", () => {
    expect(compactSummaryText(COMPACT_TEXT)).toBe(
      "1. Primary Request and Intent:\n   - alphatest herbaseren op release/8.1",
    );
  });
});

describe("askUserAnswerText", () => {
  it("keeps question and answer from the older wording", () => {
    expect(
      askUserAnswerText(
        'Your questions have been answered: "Hoe pakken we dit op?"="Eerst alleen onderzoeken". You can now continue with these answers in mind.',
      ),
    ).toBe('"Hoe pakken we dit op?"="Eerst alleen onderzoeken"');
  });

  it("keeps question and answer from the newer wording", () => {
    expect(
      askUserAnswerText(
        'The user answered: "Welke laag?"="In A7 zelf", "Wanneer?"="Nu". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.',
      ),
    ).toBe('"Welke laag?"="In A7 zelf", "Wanneer?"="Nu"');
  });

  it("accepts content as an array of text blocks", () => {
    expect(
      askUserAnswerText([
        { type: "text", text: 'The user answered: "V?"="A". Read the answers carefully.' },
      ]),
    ).toBe('"V?"="A"');
  });

  it("returns null when the user dismissed the question", () => {
    expect(
      askUserAnswerText("The user doesn't want to proceed with this tool use."),
    ).toBe(null);
  });
});

describe("buildClaudeTurns — compact", () => {
  const records = [
    user("oude vraag"),
    assistant([{ type: "text", text: "oud antwoord" }]),
    compactSummary(),
    assistant([{ type: "text", text: "verder na de compact" }]),
    user("nieuwe vraag"),
    assistant([{ type: "text", text: "nieuw antwoord" }]),
  ];

  it("moves the summary to compactSummary instead of reading it as a prompt", () => {
    const turns = buildClaudeTurns(records);

    expect(turns).toHaveLength(3);
    expect(turns[1]?.userMessage).toBe("");
    expect(turns[1]?.compactSummary).toContain("alphatest herbaseren");
    expect(turns[1]?.aiResponse).toBe("verder na de compact");
    expect(turns.some((t) => t.userMessage.includes("being continued"))).toBe(false);
  });

  it("is found by the shared recap detection", () => {
    const turns = buildClaudeTurns(records);

    expect(detectLastRecapTurn(turns)).toBe(1);
    const context = buildLLMContext(turns);
    expect(context).toContain("alphatest herbaseren");
    expect(context).toContain("verder na de compact");
    expect(context).not.toContain("oude vraag");
  });

  it("indexes the summary without its boilerplate", () => {
    const text = buildIndexableText(buildClaudeTurns(records));

    expect(text).toContain("alphatest herbaseren");
    expect(text).toContain("oude vraag");
    expect(text).not.toContain("being continued");
    expect(text).not.toContain("read the full transcript");
  });

  it("finds a term that only appears after the compact in a session over the cap", () => {
    const turns = buildClaudeTurns([
      user("oude vraag"),
      assistant([{ type: "text", text: "oud ".repeat(40_000) }]),
      compactSummary(),
      user("hoe gaat de dispatch?"),
      assistant([{ type: "text", text: "lang ".repeat(40_000) }]),
      user("besluit"),
      assistant([{ type: "text", text: "alleen gefilterd opvragen" }]),
    ]);
    const text = buildIndexableText(turns);

    expect(text).toContain("gefilterd");
    expect(text).toContain("alphatest herbaseren");
    expect(text).not.toContain("oude vraag");
  });
});

describe("buildClaudeTurns — AskUserQuestion", () => {
  it("keeps the answer, with its question, in the turn where it was given", () => {
    const turns = buildClaudeTurns([
      user("pak het issue op"),
      askQuestion("q1"),
      toolResult(
        "q1",
        'The user answered: "Hoe pakken we dit op?"="Alleen gefilterd opvragen". Read the answers carefully.',
      ),
      assistant([{ type: "text", text: "Dan doe ik dat." }]),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.aiResponse).toBe(
      '**User answered:** "Hoe pakken we dit op?"="Alleen gefilterd opvragen"\n\nDan doe ik dat.',
    );
    expect(buildIndexableText(turns)).toContain("gefilterd");
  });

  it("still drops an ordinary tool_result in the same session", () => {
    const turns = buildClaudeTurns([
      user("lees en vraag"),
      assistant([{ type: "tool_use", id: "r1", name: "Read", input: {} }]),
      toolResult("r1", 'The user answered: "nep"="geen vraag"'),
      askQuestion("q1"),
      toolResult("q1", 'The user answered: "V?"="echt antwoord". Read the answers carefully.'),
    ]);
    const text = buildIndexableText(turns);

    expect(text).toContain("echt antwoord");
    expect(text).not.toContain("geen vraag");
  });

  it("drops a dismissed question", () => {
    const turns = buildClaudeTurns([
      user("vraag"),
      askQuestion("q1"),
      toolResult("q1", "The user doesn't want to proceed with this tool use."),
    ]);

    expect(turns[0]?.aiResponse).toBe("");
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
