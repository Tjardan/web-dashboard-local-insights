/**
 * File Changes Connector
 * Tracks file modifications per project via git log --name-status.
 */
import type { SourceConnector, ProjectConfig, InsightEntry, ValidationResult } from '@/types'

interface FileChangeEntry {
  id: string
  commitSha: string
  date: string
  status: string
  filePath: string
  commitMessage: string
}

const statusLabels: Record<string, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
}

export const fileChangeConnector: SourceConnector = {
  type: 'file-change',
  label: 'File Changes',
  color: '--neon-purple',
  icon: 'file-diff',
  enabled: true,

  async fetch(project: ProjectConfig, since?: string): Promise<InsightEntry[]> {
    try {
      const params = new URLSearchParams({ path: project.path })
      if (since) params.set('since', since)
      else params.set('limit', '30')
      const res = await fetch(`/api/git-file-changes?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const changes: FileChangeEntry[] = await res.json()

      return changes.map(c => ({
        id: c.id,
        projectId: project.id,
        meta: {
          source: 'file-change' as const,
          timestamp: c.date,
          title: c.filePath,
          description: `${statusLabels[c.status] ?? c.status} — ${c.commitMessage}`,
          extra: { commitSha: c.commitSha, status: c.status },
        },
        payload: c,
      }))
    } catch (err) {
      console.warn(`[FileChangeConnector] Failed for ${project.name}:`, err)
      return []
    }
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = []
    if (!entry.id) errors.push('Missing entry ID')
    if (!entry.meta.timestamp) errors.push('Missing timestamp')
    if (!entry.meta.title) errors.push('Missing file path')
    return { valid: errors.length === 0, errors }
  },
}
