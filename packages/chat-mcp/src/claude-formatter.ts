/**
 * Turns Claude Code JSONL records into the same ConversationTurn[] shape the
 * VS Code reader produces, so everything downstream — buildIndexableText,
 * buildLLMContext, extractSnippet, the BM25 index, the UI — stays shared.
 *
 * What is indexed and what is dropped:
 *
 *   kept     user text blocks, assistant text blocks
 *   dropped  tool_result  — holds entire file contents and shell output. At
 *                           7 500 records against 390 real prompts this is the
 *                           bulk of the data; indexing it would fill the
 *                           100 000-char cap with file dumps and wreck BM25
 *                           ranking, since every document would share the same
 *                           vocabulary.
 *   dropped  thinking     — internal reasoning, wrapped in <thinking> tags so
 *                           the existing strip regex in formatter.ts removes it
 *   dropped  tool_use     — surfaced as ToolCallInfo instead, like VS Code
 *   dropped  image        — not text
 *
 * Harness-injected blocks (<system-reminder>, <ide_opened_file>, …) are
 * stripped from user text as well. They are not something the user wrote, they
 * repeat verbatim across hundreds of sessions, and leaving them in would skew
 * IDF for every term they contain.
 */

import type {
  ClaudeContentBlock,
  ClaudeRecord,
  ConversationTurn,
  ToolCallInfo,
} from "./types.js";

// ─── Harness injections ──────────────────────────────────────────────────────

/**
 * Wrapper elements Claude Code injects into the user turn. Content inside them
 * comes from the tool, not the person, so it is removed entirely.
 *
 * `pasted_content` is deliberately absent: the user did paste that, so only its
 * tags are dropped and the text is kept.
 */
const INJECTED_TAGS = [
  "system-reminder",
  "ide_opened_file",
  "ide_selection",
  "ide_diagnostics",
  "command-name",
  "command-message",
  "command-args",
  "local-command-stdout",
  "local-command-stderr",
];

const INJECTED_RE = new RegExp(
  `<(${INJECTED_TAGS.join("|")})>[\\s\\S]*?</\\1>`,
  "gi",
);
/** An injected block left unclosed by a truncated write */
const INJECTED_OPEN_RE = new RegExp(`<(${INJECTED_TAGS.join("|")})>[\\s\\S]*$`, "i");
const PASTED_TAG_RE = /<\/?pasted_content[^>]*>/gi;

export function stripInjectedBlocks(text: string): string {
  return text
    .replace(INJECTED_RE, " ")
    .replace(INJECTED_OPEN_RE, " ")
    .replace(PASTED_TAG_RE, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// ─── Content block helpers ───────────────────────────────────────────────────

function blocksOf(rec: ClaudeRecord): ClaudeContentBlock[] {
  const content = rec.message?.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content;
  return [];
}

function textOf(blocks: ClaudeContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => (typeof b.text === "string" ? b.text : ""))
    .join("\n")
    .trim();
}

function thinkingOf(blocks: ClaudeContentBlock[]): string {
  const parts = blocks
    .filter((b) => b.type === "thinking")
    .map((b) => {
      const v = b.thinking ?? b.text;
      return typeof v === "string" ? v.trim() : "";
    })
    .filter(Boolean);
  return parts.length ? `<thinking>\n${parts.join("\n\n")}\n</thinking>` : "";
}

function toolCallsOf(blocks: ClaudeContentBlock[]): ToolCallInfo[] {
  return blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({
      toolId: typeof b.name === "string" ? b.name : "",
      label: typeof b.name === "string" ? b.name : "tool call",
      args:
        b.input && typeof b.input === "object" && !Array.isArray(b.input)
          ? (b.input as Record<string, unknown>)
          : null,
    }));
}

/** True for a record that is a tool result being fed back, not a person typing. */
function isToolResultRecord(blocks: ClaudeContentBlock[]): boolean {
  return blocks.some((b) => b.type === "tool_result");
}

// ─── Turn builder ────────────────────────────────────────────────────────────

/**
 * Walk the records in order, opening a turn on each real user prompt and
 * folding every assistant message up to the next prompt into it.
 *
 * Sidechain records (`isSidechain: true`) come from subagents running under a
 * turn, not from the conversation itself. They are skipped so a subagent's
 * output is not attributed to the user's exchange.
 */
export function buildClaudeTurns(records: ClaudeRecord[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;
  const aiParts: string[] = [];

  const flush = () => {
    if (!current) return;
    current.aiResponse = aiParts.join("\n\n").trim();
    turns.push(current);
    aiParts.length = 0;
    current = null;
  };

  for (const rec of records) {
    if (rec.isSidechain === true) continue;
    if (rec.type !== "user" && rec.type !== "assistant") continue;
    if (!rec.message) continue;

    const blocks = blocksOf(rec);

    if (rec.type === "user") {
      if (isToolResultRecord(blocks)) continue; // tool output, not a prompt
      const prompt = stripInjectedBlocks(textOf(blocks));
      if (!prompt) continue; // nothing left once injections are removed

      flush();
      current = {
        turnIndex: turns.length,
        timestamp:
          typeof rec.timestamp === "string" ? rec.timestamp : "",
        userMessage: prompt,
        aiResponse: "",
        modelId: "",
        toolCalls: [],
      };
      continue;
    }

    // assistant — may arrive as several records per turn
    if (!current) continue; // assistant output before any prompt: ignore

    const text = textOf(blocks);
    if (text) aiParts.push(text);
    const thinking = thinkingOf(blocks);
    if (thinking) aiParts.push(thinking);

    current.toolCalls.push(...toolCallsOf(blocks));
    if (!current.modelId && typeof rec.message.model === "string") {
      current.modelId = rec.message.model;
    }
  }

  flush();
  return turns;
}

// ─── Title ───────────────────────────────────────────────────────────────────

/**
 * Claude Code writes the session title into the log itself, as `ai-title` or
 * `custom-title` records appended over time — the last one wins. A user-set
 * `custom-title` takes precedence over the generated one. Falls back to the
 * first prompt, matching how the VS Code side derives a title.
 */
export function claudeSessionTitle(
  records: ClaudeRecord[],
  turns: ConversationTurn[],
): string {
  let aiTitle = "";
  let customTitle = "";

  for (const rec of records) {
    if (rec.type === "ai-title" && typeof rec.aiTitle === "string") {
      aiTitle = rec.aiTitle;
    } else if (
      rec.type === "custom-title" &&
      typeof rec.customTitle === "string"
    ) {
      customTitle = rec.customTitle;
    }
  }

  const title = customTitle || aiTitle;
  if (title.trim()) return title.trim().slice(0, 60);
  return turns[0]?.userMessage.slice(0, 60) ?? "Untitled";
}
