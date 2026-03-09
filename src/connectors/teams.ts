/**
 * Microsoft Teams Connector
 * Fetches channel messages (sent by me) and chat messages via Microsoft Graph API.
 * Auth: OAuth 2.0 PKCE flow — tokens stored server-side by the Vite API plugin.
 * Incremental sync via Graph delta queries (managed server-side).
 * This is a global connector — not scoped to a single project.
 */
import type {
  SourceConnector,
  ProjectConfig,
  InsightEntry,
  ValidationResult,
} from "@/types";

interface TeamsMessagePayload {
  id: string;
  kind: "channel" | "chat";
  body: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  teamId?: string;
  teamName?: string;
  channelId?: string;
  channelName?: string;
  chatId?: string;
  chatName?: string;
  replyCount: number;
  webUrl?: string;
}

function buildTitle(msg: TeamsMessagePayload): string {
  const raw = msg.body.trim();
  return raw.length > 120 ? raw.slice(0, 117) + "…" : raw || "(empty message)";
}

function buildDescription(msg: TeamsMessagePayload): string {
  if (msg.kind === "channel") {
    const where = `#${msg.channelName ?? "channel"} @ ${msg.teamName ?? "team"}`;
    return msg.replyCount > 0
      ? `${where} · ${msg.replyCount} repl${msg.replyCount === 1 ? "y" : "ies"}`
      : where;
  }
  return `Chat: ${msg.chatName ?? "1-on-1"}`;
}

export const teamsConnector: SourceConnector = {
  type: "teams",
  label: "Microsoft Teams",
  color: "--neon-yellow",
  icon: "message-circle",
  enabled: false,
  global: true,

  async fetch(
    _project: ProjectConfig,
    since?: string,
  ): Promise<InsightEntry[]> {
    try {
      const params = new URLSearchParams();
      if (since) params.set("since", since);
      const res = await fetch(`/api/teams/messages?${params}`);

      if (res.status === 401) {
        // Not authenticated — skip silently (user hasn't connected Teams yet)
        return [];
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const messages: TeamsMessagePayload[] = await res.json();

      return messages.map((m) => ({
        id: m.id,
        projectId: "_teams",
        meta: {
          source: "teams" as const,
          // Use lastModifiedDateTime so threads with new replies bubble up
          timestamp: m.lastModifiedDateTime,
          title: buildTitle(m),
          description: buildDescription(m),
          extra: {
            kind: m.kind,
            teamId: m.teamId,
            teamName: m.teamName,
            channelId: m.channelId,
            channelName: m.channelName,
            chatId: m.chatId,
            chatName: m.chatName,
            replyCount: m.replyCount,
            webUrl: m.webUrl,
            createdDateTime: m.createdDateTime,
          },
        },
        payload: m,
      }));
    } catch (err) {
      console.warn("[TeamsConnector] Failed:", err);
      return [];
    }
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = [];
    if (!entry.id) errors.push("Missing message ID");
    if (!entry.meta.timestamp) errors.push("Missing timestamp");
    if (!entry.meta.title) errors.push("Missing title");
    return { valid: errors.length === 0, errors };
  },
};
