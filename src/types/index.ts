/* ═══════════════════════════════════════════════════════════
   Core types — generic, extensible data model
   ═══════════════════════════════════════════════════════════ */

/** Known source types — extensible via string union */
export type SourceType = 'commit' | 'chat' | 'file-change' | 'teams' | 'email' | (string & {})

/** Metadata attached to any insight entry */
export interface EntryMeta {
  /** Source type for filtering & display */
  source: SourceType
  /** ISO-8601 timestamp */
  timestamp: string
  /** Human-readable title */
  title: string
  /** Optional longer description / summary */
  description?: string
  /** Arbitrary key-value metadata for connectors */
  extra?: Record<string, unknown>
}

/** A single insight entry (commit, chat, file change, etc.) */
export interface InsightEntry {
  /** Unique ID (e.g. commit SHA, chat session ID, file path hash) */
  id: string
  /** Project this entry belongs to */
  projectId: string
  /** Core metadata */
  meta: EntryMeta
  /** Raw payload from the source connector */
  payload: unknown
}

/** Validation result for an entry */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** A registered source connector */
export interface SourceConnector {
  /** Unique type identifier */
  type: SourceType
  /** Human-readable label */
  label: string
  /** Neon color CSS variable name */
  color: string
  /** Icon name (lucide) */
  icon: string
  /** Whether this source is currently enabled */
  enabled: boolean
  /** Fetch entries for a project */
  fetch(project: ProjectConfig): Promise<InsightEntry[]>
  /** Validate a single entry */
  validate(entry: InsightEntry): ValidationResult
}

/** Project configuration (stored in settings.json) */
export interface ProjectConfig {
  /** Derived ID (kebab-case of folder name) */
  id: string
  /** Display name */
  name: string
  /** Absolute path to project root */
  path: string
  /** Git remote URL if available */
  gitRemote?: string
  /** Default branch */
  defaultBranch?: string
}

/** Root folder configuration */
export interface RootFolder {
  /** Absolute path to scan for projects */
  path: string
  /** User-defined label */
  label: string
}

/** App settings (persisted to local JSON) */
export interface AppSettings {
  rootFolders: RootFolder[]
  enabledSources: Record<SourceType, boolean>
}

/** Chat session from VS Code chat history */
export interface ChatSession {
  id: string
  title: string
  createdAt: string
  lastMessageAt: string
  messageCount: number
  summary?: string
  messages: ChatMessage[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

/** Git commit */
export interface GitCommit {
  sha: string
  message: string
  author: string
  date: string
  files: string[]
}
