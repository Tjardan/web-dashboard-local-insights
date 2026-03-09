/**
 * Microsoft Teams connector — Power Automate file-based variant.
 *
 * Leest een lokaal JSON-bestand dat door een Power Automate-flow wordt aangemaakt via
 * OneDrive sync. Geen Azure AD app-registratie of IT-rechten nodig.
 *
 * Verwacht JSON-formaat (ingesteld als output van de Power Automate flow):
 * {
 *   "exportedAt": "2026-03-07T10:00:00Z",
 *   "messages": [
 *     {
 *       "id": "unieke-id",
 *       "kind": "channel" | "chat",
 *       "body": "platte tekst van het bericht",
 *       "createdDateTime": "2026-03-07T09:00:00Z",
 *       "lastModifiedDateTime": "2026-03-07T09:00:00Z",
 *       "teamName": "Naam van het team",          // alleen bij kind=channel
 *       "channelName": "Naam van het kanaal",      // alleen bij kind=channel
 *       "chatName": "John Doe",                    // alleen bij kind=chat
 *       "replyCount": 0,
 *       "webUrl": "https://..."                   // optioneel
 *     }
 *   ]
 * }
 */
import type {
  SourceConnector,
  ProjectConfig,
  InsightEntry,
  ValidationResult,
} from "@/types";
import { useSettingsStore } from "@/stores/settings";

interface TeamsFileMessage {
  id: string;
  kind: "channel" | "chat";
  body: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  teamName?: string;
  channelName?: string;
  chatName?: string;
  replyCount?: number;
  webUrl?: string;
}

function buildTitle(msg: TeamsFileMessage): string {
  const raw = msg.body.trim();
  return raw.length > 120 ? raw.slice(0, 117) + "…" : raw || "(leeg bericht)";
}

function buildDescription(msg: TeamsFileMessage): string {
  if (msg.kind === "channel") {
    const where = `#${msg.channelName ?? "kanaal"} @ ${msg.teamName ?? "team"}`;
    const replies = msg.replyCount ?? 0;
    return replies > 0
      ? `${where} · ${replies} repl${replies === 1 ? "y" : "ies"}`
      : where;
  }
  return `Chat: ${msg.chatName ?? "1-op-1"}`;
}

export const teamsFileConnector: SourceConnector = {
  type: "teams-file",
  label: "Teams (Power Automate)",
  color: "--neon-yellow",
  icon: "file-json",
  enabled: false,
  global: true,

  async fetch(
    _project: ProjectConfig,
    since?: string,
  ): Promise<InsightEntry[]> {
    // Get filePath from settings at fetch-time (reactive)
    const settings = useSettingsStore();
    const filePath = settings.settings.teamsFilePath;
    if (!filePath) return [];

    try {
      const params = new URLSearchParams({ path: filePath });
      const res = await fetch(`/api/teams-file?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as {
        exportedAt: string | null;
        messages: TeamsFileMessage[];
      };

      let messages = data.messages ?? [];

      // Filter on lastModifiedDateTime when doing an incremental fetch
      if (since) {
        messages = messages.filter((m) => m.lastModifiedDateTime > since);
      }

      return messages.map((m) => ({
        id: `teams-file-${m.id}`,
        projectId: "_teams-file",
        meta: {
          source: "teams-file" as const,
          timestamp: m.lastModifiedDateTime,
          title: buildTitle(m),
          description: buildDescription(m),
          extra: {
            kind: m.kind,
            teamName: m.teamName,
            channelName: m.channelName,
            chatName: m.chatName,
            replyCount: m.replyCount ?? 0,
            webUrl: m.webUrl,
            createdDateTime: m.createdDateTime,
          },
        },
        payload: m,
      }));
    } catch (err) {
      console.warn("[TeamsFileConnector] Failed:", err);
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
