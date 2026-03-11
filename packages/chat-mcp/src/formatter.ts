import type {
  RawChatRequest,
  RawResponseItem,
  ConversationTurn,
  ToolCallInfo,
} from "./types.js";

// ─── Response item rendering ─────────────────────────────────────────────────

/** Render a response item to text, returns null for tool calls (handled separately) */
function renderResponseItem(item: RawResponseItem): string | null {
  switch (item.kind) {
    case "markdownContent":
      return (item.value as string | undefined) ?? "";

    case "thinking": {
      const text = (item.value as string | undefined) ?? "";
      if (!text.trim()) return null;
      return `<thinking>\n${text}\n</thinking>`;
    }

    // Tool calls are extracted separately — exclude from text
    case "toolInvocationSerialized":
      return null;

    case "progressMessage":
      return null;

    case "reference":
    case "inlineReference":
      return null;

    case "mcpServersStarting":
      return null;

    default: {
      const val = item["value"] ?? item["text"];
      if (typeof val === "string" && val.trim()) return val;
      return null;
    }
  }
}

/** Strip markdown-style links from a label string.
 * Replaces `[text](url)` with `text`, and `[](url)` with the filename from url. */
function cleanLabel(raw: string): string {
  return raw
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_, text: string, url: string) => {
      if (text.trim()) return text.trim();
      // Empty link text: derive a short name from the URL/path
      try {
        const decoded = decodeURIComponent(url.replace(/^file:\/\/\//, ""));
        return decoded.split(/[\\/]/).pop() ?? url;
      } catch {
        return url;
      }
    })
    .trim();
}

/** Extract a ToolCallInfo from a toolInvocationSerialized response item */
function extractToolCall(item: RawResponseItem): ToolCallInfo {
  const toolId = (item.toolId as string | undefined) ?? "";

  // ── Label ────────────────────────────────────────────────────────────────
  const rawMsg = item.invocationMessage;
  let rawLabel = "";
  if (typeof rawMsg === "string") {
    rawLabel = rawMsg.trim();
  } else if (
    rawMsg !== null &&
    rawMsg !== undefined &&
    typeof rawMsg === "object"
  ) {
    const v = (rawMsg as Record<string, unknown>)["value"];
    if (typeof v === "string") rawLabel = v.trim();
  }

  // ── Args ─────────────────────────────────────────────────────────────────
  let args: Record<string, unknown> | null = null;

  const rawSpec = item.toolSpecificData;
  if (
    rawSpec !== null &&
    rawSpec !== undefined &&
    typeof rawSpec === "object" &&
    !Array.isArray(rawSpec)
  ) {
    const spec = rawSpec as Record<string, unknown>;

    if (spec["kind"] === "terminal") {
      // Terminal tools: invocationMessage is always ""; use command as label
      // and extract a clean, human-readable args subset.
      const cmdLine = (
        spec["commandLine"] as Record<string, unknown> | undefined
      )?.["original"] as string | undefined;
      const cwdPath = (spec["cwd"] as Record<string, unknown> | undefined)?.[
        "fsPath"
      ] as string | undefined;
      const lang = spec["language"] as string | undefined;
      const durationMs = (
        spec["terminalCommandState"] as Record<string, unknown> | undefined
      )?.["duration"] as number | undefined;

      if (!rawLabel && cmdLine) rawLabel = cmdLine;

      const entry: Record<string, unknown> = {};
      if (cmdLine) entry["command"] = cmdLine;
      if (cwdPath) entry["cwd"] = cwdPath;
      if (lang) entry["language"] = lang;
      if (durationMs !== undefined && durationMs > 0)
        entry["duration_ms"] = durationMs;
      args = Object.keys(entry).length > 0 ? entry : null;
    } else {
      // Round-trip through JSON to strip any non-serializable values (BigInt,
      // circular refs, deeply nested structures) that would crash JSON.stringify
      // later when the server serialises the API response.
      try {
        args = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
      } catch {
        args = null;
      }
    }
  }

  // Fallback: resultDetails.input — MCP tools store their input args here as a
  // JSON string (e.g. {"url":"..."} for navigate, {"uid":"1_27"} for click).
  const rdRaw = item["resultDetails"];
  if (
    !args &&
    rdRaw !== null &&
    rdRaw !== undefined &&
    typeof rdRaw === "object" &&
    !Array.isArray(rdRaw)
  ) {
    const rd = rdRaw as Record<string, unknown>;
    const rdInput = rd["input"];
    if (
      typeof rdInput === "string" &&
      rdInput.trim() &&
      rdInput !== "{}" &&
      rdInput !== "null"
    ) {
      try {
        const parsed = JSON.parse(rdInput) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          Object.keys(parsed as object).length > 0
        ) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        /* not valid JSON */
      }
    }
  }

  // Last fallback: URIs from invocationMessage (copilot_readFile, findTextInFiles, …)
  // Gives a file-path args object so the ▸ details button becomes available.
  if (
    !args &&
    rawMsg !== null &&
    rawMsg !== undefined &&
    typeof rawMsg === "object"
  ) {
    const uris = (rawMsg as Record<string, unknown>)["uris"] as
      | Record<string, unknown>
      | undefined;
    if (uris && Object.keys(uris).length > 0) {
      const paths = Object.values(uris)
        .map(
          (u) =>
            (u as Record<string, unknown>)?.["fsPath"] as string | undefined,
        )
        .filter((p): p is string => !!p);
      if (paths.length) {
        args = { files: paths.length === 1 ? paths[0] : paths };
      }
    }
  }

  // ── Result summary ────────────────────────────────────────────────────────
  // Surface a concise text summary of what the tool returned.
  let result: string | undefined;

  if (rdRaw !== null && rdRaw !== undefined) {
    if (Array.isArray(rdRaw) && (rdRaw as unknown[]).length > 0) {
      // copilot_findTextInFiles / copilot_findFiles — array of URI match objects
      const names = (rdRaw as unknown[])
        .map(
          (r) =>
            (
              (r as Record<string, unknown>)?.["uri"] as
                | Record<string, unknown>
                | undefined
            )?.["fsPath"] as string | undefined,
        )
        .filter((p): p is string => !!p)
        .map((p) => p.split(/[/\\]/).pop() ?? p);
      if (names.length) {
        result = `Found in: ${names.slice(0, 5).join(", ")}${names.length > 5 ? ` +${names.length - 5} more` : ""}`;
      }
    } else if (!Array.isArray(rdRaw) && typeof rdRaw === "object") {
      const rd = rdRaw as Record<string, unknown>;
      const outputs = rd["output"] as unknown[] | undefined;
      if (Array.isArray(outputs)) {
        for (const o of outputs) {
          const obj = o as Record<string, unknown>;
          // Skip binary outputs (images, etc.)
          if (
            obj["mimeType"] &&
            !(obj["mimeType"] as string).startsWith("text")
          )
            continue;
          if (obj["isText"] !== true) continue;
          const text = obj["value"] as string | undefined;
          if (text?.trim()) {
            const trimmed = text.trim();
            result =
              trimmed.length > 250 ? trimmed.slice(0, 250) + "…" : trimmed;
            break;
          }
        }
      }
    }
  }

  const label = rawLabel
    ? cleanLabel(rawLabel) || toolId || "tool call"
    : toolId || "tool call";

  return { toolId, label, args, result };
}

// ─── Turn builder ────────────────────────────────────────────────────────────

export function buildTurns(requests: RawChatRequest[]): ConversationTurn[] {
  return requests.map((req, i) => {
    const userMessage =
      req.message?.text?.trim() ??
      req.message?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ??
      "";

    const responseItems = req.response ?? [];

    const textParts: string[] = responseItems
      .map(renderResponseItem)
      .filter((s): s is string => s !== null && s.length > 0);

    const toolCalls: ToolCallInfo[] = responseItems
      .filter((item) => item.kind === "toolInvocationSerialized")
      .map(extractToolCall);

    const aiResponse = textParts.join("\n\n");
    const ts = req.timestamp ? new Date(req.timestamp).toISOString() : "";
    const compactSummary = req.result?.metadata?.summary?.text ?? undefined;

    return {
      turnIndex: i,
      timestamp: ts,
      userMessage,
      aiResponse,
      modelId: req.modelId ?? "",
      toolCalls,
      compactSummary,
    };
  });
}

// ─── Formatted markdown rendering ────────────────────────────────────────────

export function formatSessionAsMarkdown(
  title: string,
  workspace: string,
  creationDate: string,
  turns: ConversationTurn[],
  responderUsername = "GitHub Copilot",
): string {
  const lines: string[] = [
    `# ${title}`,
    `**Workspace:** ${workspace}`,
    `**Created:** ${creationDate}`,
    `**Turns:** ${turns.length}`,
    "",
    "---",
    "",
  ];

  for (const turn of turns) {
    const ts = turn.timestamp ? ` _(${turn.timestamp})_` : "";
    lines.push(`## Turn ${turn.turnIndex + 1}${ts}`);
    lines.push("");
    lines.push(`**User:**`);
    lines.push("");
    lines.push(turn.userMessage || "_empty_");
    lines.push("");
    lines.push(`**${responderUsername}:**`);
    lines.push("");
    lines.push(turn.aiResponse || "_no response_");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Indexable text extraction ───────────────────────────────────────────────

const THINKING_STRIP_RE = /<thinking>[\s\S]*?<\/thinking>/g;

/**
 * VS Code Copilot emits structured <analysis>…</analysis><summary>…</summary>
 * blocks when it compacts a session (the /compact command or auto-triggered when
 * the context window fills up). We detect these to identify a genuine compact turn.
 *
 * Only the <summary> block is indexed — <analysis> contains internal model
 * reasoning and is intentionally excluded.
 */
const SUMMARY_BLOCK_RE = /<summary>([\s\S]*?)<\/summary>/;

/**
 * Extract the plain text content of the <summary> block from a VS Code /compact
 * response. The full response (result.metadata.summary) contains both
 * <analysis>…</analysis> (internal reasoning) and <summary>…</summary>.
 * Returns only the <summary> text, or null if none found.
 */
function extractRecapContent(compactSummary: string): string | null {
  const summary = SUMMARY_BLOCK_RE.exec(compactSummary)?.[1]?.trim() ?? "";
  return summary || null;
}

/**
 * Detect the last turn where VS Code ran /compact (result.metadata.summary
 * contains a <summary>…</summary> block). Returns the turn index, or null.
 */
export function detectLastRecapTurn(turns: ConversationTurn[]): number | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const cs = turns[i].compactSummary;
    if (cs && extractRecapContent(cs) !== null) {
      return i;
    }
  }
  return null;
}

/** Safety cap: max chars of indexable text per session. */
const INDEXABLE_TEXT_MAX_CHARS = 100_000;

/**
 * Build a plain-text representation of a chat session suitable for BM25 indexing.
 * Always indexes ALL turns so the full session is searchable regardless of /compact.
 * Compact summaries are also included so their condensed content is indexed too.
 * Safety cap at INDEXABLE_TEXT_MAX_CHARS characters.
 */
export function buildIndexableText(turns: ConversationTurn[]): string {
  const parts: string[] = [];

  for (const t of turns) {
    if (t.userMessage.trim()) parts.push(t.userMessage.trim());
    const ai = t.aiResponse.replace(THINKING_STRIP_RE, "").trim();
    if (ai) parts.push(ai);
    // Also include compact summary content so it's indexed
    if (t.compactSummary) {
      const summary = extractRecapContent(t.compactSummary);
      if (summary) parts.push(summary);
    }
  }

  const text = parts.join("\n");
  if (text.length <= INDEXABLE_TEXT_MAX_CHARS) return text;
  return text.slice(0, INDEXABLE_TEXT_MAX_CHARS) + "\n[…gekort voor index]";
}

/**
 * Build token-efficient context to pass to an LLM for a retrieved session.
 * Applies recap-delta: if a /compact turn exists at index N, returns only the
 * <summary> content + all turns after N — skipping the verbose pre-compact history.
 * Falls back to all turns when no /compact is present.
 * Safety cap at LLM_CONTEXT_MAX_CHARS characters.
 */
const LLM_CONTEXT_MAX_CHARS = 50_000;

export function buildLLMContext(turns: ConversationTurn[]): string {
  const recapIdx = detectLastRecapTurn(turns);
  const parts: string[] = [];

  if (recapIdx !== null) {
    const recapContent = extractRecapContent(turns[recapIdx].compactSummary ?? "");
    if (recapContent) parts.push(recapContent);
    for (let i = recapIdx + 1; i < turns.length; i++) {
      const t = turns[i];
      if (t.userMessage.trim()) parts.push(`Q: ${t.userMessage.trim()}`);
      const ai = t.aiResponse.replace(THINKING_STRIP_RE, "").trim();
      if (ai) parts.push(`A: ${ai}`);
    }
  } else {
    for (const t of turns) {
      if (t.userMessage.trim()) parts.push(`Q: ${t.userMessage.trim()}`);
      const ai = t.aiResponse.replace(THINKING_STRIP_RE, "").trim();
      if (ai) parts.push(`A: ${ai}`);
    }
  }

  const text = parts.join("\n");
  if (text.length <= LLM_CONTEXT_MAX_CHARS) return text;
  return text.slice(0, LLM_CONTEXT_MAX_CHARS) + "\n[…gekort voor context]";
}

// ─── Snippet extraction ──────────────────────────────────────────────────────

export function extractSnippet(
  text: string,
  query: string,
  radius = 120,
): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2).replace(/\n/g, " ");
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).replace(/\n/g, " ") + suffix;
}
