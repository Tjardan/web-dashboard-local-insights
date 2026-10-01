/**
 * Claude Code Chat Connector
 *
 * Reads Claude Code sessions via the local Vite API plugin, which resolves them
 * through the `claude` SessionProvider in @devpulse/chat-mcp.
 *
 * Deliberately a separate connector rather than a flag on the Copilot one: the
 * two have their own entries, their own browser-cache slice and their own
 * filter toggle, so one can be switched off without touching the other.
 */
import type {
  SourceConnector,
  ProjectConfig,
  InsightEntry,
  ValidationResult,
} from "@/types";

interface ClaudeSessionSummary {
  id: string;
  source: "claude";
  title: string;
  workspace: string;
  workspacePath: string;
  creationDate: string;
  lastModified: string;
  messageCount: number;
  totalChars: number;
  indexableText?: string;
}

export const claudeChatConnector: SourceConnector = {
  type: "claude-chat",
  label: "Claude Code",
  color: "--neon-orange",
  icon: "sparkles",
  enabled: true,

  async fetch(project: ProjectConfig, since?: string): Promise<InsightEntry[]> {
    try {
      const params = new URLSearchParams({
        workspace: project.path,
        source: "claude",
      });
      if (since) params.set("since", since);
      else params.set("limit", "100");
      const res = await fetch(`/api/chat-sessions?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sessions: ClaudeSessionSummary[] = await res.json();

      return sessions.map((s) => ({
        // Prefix so a Claude and a Copilot session can never collide on ID
        id: `claude:${s.id}`,
        projectId: project.id,
        meta: {
          source: "claude-chat" as const,
          timestamp: s.lastModified,
          title: s.title,
          description: `${s.messageCount} turns · ${Math.round(s.totalChars / 1000)}k chars`,
          extra: {
            sessionId: s.id,
            chatSource: "claude",
            workspace: s.workspace,
            workspacePath: s.workspacePath,
            creationDate: s.creationDate,
            messageCount: s.messageCount,
            indexableText: s.indexableText,
          },
        },
        payload: s,
      }));
    } catch (err) {
      console.warn(`[ClaudeChatConnector] Failed for ${project.name}:`, err);
      return [];
    }
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = [];
    if (!entry.id) errors.push("Missing Claude session ID");
    if (!entry.meta.timestamp) errors.push("Missing Claude chat timestamp");
    if (!entry.meta.title) errors.push("Missing Claude chat title");
    return { valid: errors.length === 0, errors };
  },
};
