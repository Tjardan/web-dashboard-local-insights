/**
 * VS Code Chat History Connector
 * Fetches chat sessions via the local Vite API plugin (reads JSONL storage directly).
 */
import type { SourceConnector, ProjectConfig, InsightEntry, ValidationResult } from '@/types'

interface SessionSummary {
  id: string
  title: string
  workspace: string
  workspacePath: string
  creationDate: string
  lastModified: string
  messageCount: number
  totalChars: number
}

export const chatHistoryConnector: SourceConnector = {
  type: 'chat',
  label: 'Copilot Chats',
  color: '--neon-cyan',
  icon: 'message-square',
  enabled: true,

  async fetch(project: ProjectConfig, since?: string): Promise<InsightEntry[]> {
    try {
      const params = new URLSearchParams({ workspace: project.path })
      if (since) params.set('since', since)
      else params.set('limit', '100')
      const res = await fetch(`/api/chat-sessions?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sessions: SessionSummary[] = await res.json()

      return sessions.map(s => ({
        id: s.id,
        projectId: project.id,
        meta: {
          source: 'chat' as const,
          timestamp: s.lastModified,
          title: s.title,
          description: `${s.messageCount} messages · ${Math.round(s.totalChars / 1000)}k chars`,
          extra: {
            sessionId: s.id,
            workspace: s.workspace,
            workspacePath: s.workspacePath,
            creationDate: s.creationDate,
            messageCount: s.messageCount,
          },
        },
        payload: s,
      }))
    } catch (err) {
      console.warn(`[ChatConnector] Failed for ${project.name}:`, err)
      return []
    }
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = []
    if (!entry.id) errors.push('Missing chat session ID')
    if (!entry.meta.timestamp) errors.push('Missing chat timestamp')
    if (!entry.meta.title) errors.push('Missing chat title')
    return { valid: errors.length === 0, errors }
  },
}
