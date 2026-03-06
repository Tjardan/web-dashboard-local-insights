import type {
  RawChatRequest,
  RawResponseItem,
  ConversationTurn,
} from "./types.js";

// ─── Response item rendering ─────────────────────────────────────────────────

function renderResponseItem(item: RawResponseItem): string {
  switch (item.kind) {
    case "markdownContent":
      return (item.value as string | undefined) ?? "";

    case "thinking": {
      const text = (item.value as string | undefined) ?? "";
      if (!text.trim()) return "";
      return `<thinking>\n${text}\n</thinking>`;
    }

    case "toolInvocationSerialized": {
      const rawMsg = item.invocationMessage;
      const msg = typeof rawMsg === "string" ? rawMsg : "";
      const toolId = (item.toolId as string | undefined) ?? "";
      const label = msg.trim() || toolId || "tool call";
      return `[Tool: ${label}]`;
    }

    case "progressMessage":
      return "";

    case "reference":
    case "inlineReference":
      return "";

    case "mcpServersStarting":
      return "";

    default: {
      // Fallback: try to extract a text value
      const val = item["value"] ?? item["text"];
      if (typeof val === "string" && val.trim()) return val;
      return "";
    }
  }
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

    const responseItems: string[] = (req.response ?? [])
      .map(renderResponseItem)
      .filter((s) => s.length > 0);

    const aiResponse = responseItems.join("\n\n");

    const ts = req.timestamp ? new Date(req.timestamp).toISOString() : "";

    return {
      turnIndex: i,
      timestamp: ts,
      userMessage,
      aiResponse,
      modelId: req.modelId ?? "",
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
