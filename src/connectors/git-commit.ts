/**
 * Git Commits Connector
 * Fetches commit history via local git log (Vite dev server API).
 */
import type { SourceConnector, ProjectConfig, InsightEntry, ValidationResult } from '@/types'

interface GitLogEntry {
  sha: string
  author: string
  date: string
  message: string
}

export const gitCommitConnector: SourceConnector = {
  type: 'commit',
  label: 'Git Commits',
  color: '--neon-green',
  icon: 'git-commit-horizontal',
  enabled: true,

  async fetch(project: ProjectConfig, since?: string): Promise<InsightEntry[]> {
    try {
      const params = new URLSearchParams({ path: project.path })
      if (since) params.set('since', since)
      else params.set('limit', '50')
      const res = await fetch(`/api/git-log?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const commits: GitLogEntry[] = await res.json()

      return commits.map(c => ({
        id: c.sha,
        projectId: project.id,
        meta: {
          source: 'commit' as const,
          timestamp: c.date,
          title: c.message,
          description: `by ${c.author}`,
          extra: { author: c.author, sha: c.sha },
        },
        payload: c,
      }))
    } catch (err) {
      console.warn(`[GitConnector] Failed for ${project.name}:`, err)
      return []
    }
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = []
    if (!entry.id) errors.push('Missing commit SHA')
    if (!entry.meta.timestamp) errors.push('Missing commit date')
    if (!entry.meta.title) errors.push('Missing commit message')
    return { valid: errors.length === 0, errors }
  },
}
