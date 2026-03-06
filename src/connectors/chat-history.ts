/**
 * VS Code Chat History Connector
 * Fetches chat sessions via vscode-chat-history MCP.
 */
import type { SourceConnector, ProjectConfig, InsightEntry, ValidationResult } from '@/types'

export const chatHistoryConnector: SourceConnector = {
  type: 'chat',
  label: 'Copilot Chats',
  color: '--neon-cyan',
  icon: 'message-square',
  enabled: true,

  async fetch(project: ProjectConfig): Promise<InsightEntry[]> {
    // TODO: Integrate with vscode-chat-history MCP to fetch chat sessions
    // Will use mcp_vscode-chat-h_list_sessions, mcp_vscode-chat-h_read_session, etc.
    console.info(`[ChatConnector] Would fetch chats for ${project.name}`)
    return []
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = []
    if (!entry.id) errors.push('Missing chat session ID')
    if (!entry.meta.timestamp) errors.push('Missing chat timestamp')
    if (!entry.meta.title) errors.push('Missing chat title')
    return { valid: errors.length === 0, errors }
  },
}
