/**
 * Git Commits Connector
 * Fetches commit history via GitHub MCP or local git log parsing.
 */
import type { SourceConnector, ProjectConfig, InsightEntry, ValidationResult } from '@/types'

export const gitCommitConnector: SourceConnector = {
  type: 'commit',
  label: 'Git Commits',
  color: '--neon-green',
  icon: 'git-commit-horizontal',
  enabled: true,

  async fetch(project: ProjectConfig): Promise<InsightEntry[]> {
    // TODO: Integrate with GitHub MCP tools to fetch commit history
    // For now, return placeholder data structure
    console.info(`[GitConnector] Would fetch commits for ${project.name} at ${project.path}`)
    return []
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = []
    if (!entry.id) errors.push('Missing commit SHA')
    if (!entry.meta.timestamp) errors.push('Missing commit date')
    if (!entry.meta.title) errors.push('Missing commit message')
    return { valid: errors.length === 0, errors }
  },
}
