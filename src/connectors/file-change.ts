/**
 * File Changes Connector
 * Tracks file modifications per project via git diff / status.
 */
import type { SourceConnector, ProjectConfig, InsightEntry, ValidationResult } from '@/types'

export const fileChangeConnector: SourceConnector = {
  type: 'file-change',
  label: 'File Changes',
  color: '--neon-purple',
  icon: 'file-diff',
  enabled: true,

  async fetch(project: ProjectConfig): Promise<InsightEntry[]> {
    // TODO: Parse git diff / git log --name-status for file changes
    console.info(`[FileChangeConnector] Would fetch file changes for ${project.name}`)
    return []
  },

  validate(entry: InsightEntry): ValidationResult {
    const errors: string[] = []
    if (!entry.id) errors.push('Missing entry ID')
    if (!entry.meta.timestamp) errors.push('Missing timestamp')
    if (!entry.meta.title) errors.push('Missing file path')
    return { valid: errors.length === 0, errors }
  },
}
