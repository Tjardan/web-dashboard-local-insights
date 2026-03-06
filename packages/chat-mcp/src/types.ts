// ─── Raw JSONL on-disk types ────────────────────────────────────────────────

export interface RawResponseItem {
  kind: string;
  value?: string;
  text?: string;
  // Thinking blocks
  id?: string;
  // Tool invocations
  invocationMessage?: string;
  toolSpecificData?: unknown;
  toolCallId?: string;
  toolId?: string;
  isComplete?: boolean;
  // References
  reference?: unknown;
  // Nested items (e.g. markdownContent inside inlineReference)
  [key: string]: unknown;
}

export interface RawMessage {
  text?: string;
  parts?: Array<{ text?: string; kind?: string }>;
}

export interface RawChatRequest {
  requestId?: string;
  timestamp?: number;
  message?: RawMessage;
  response?: RawResponseItem[];
  modelId?: string;
  agent?: { id?: string; name?: string; fullName?: string };
  result?: {
    timings?: { firstProgress?: number; totalElapsed?: number };
    metadata?: { codeBlocks?: unknown[] };
  };
}

/** The `kind:0` snapshot line of a JSONL session file */
export interface RawSessionSnapshot {
  version?: number;
  sessionId?: string;
  creationDate?: number;
  customTitle?: string;
  initialLocation?: string;
  responderUsername?: string;
  requesterUsername?: string;
  requests?: RawChatRequest[];
  hasPendingEdits?: boolean;
}

/** A `kind:1` patch line (metadata-only, e.g. result timings, followups) */
export interface RawSessionPatch {
  kind: 1;
  k: string[];
  v: unknown;
}

// ─── Parsed / domain types ──────────────────────────────────────────────────

/**
 * Lightweight session descriptor — returned by list tools.
 * Intentionally minimal to keep token counts low.
 */
export interface SessionSummary {
  id: string;
  title: string;
  workspace: string;
  workspacePath: string;
  creationDate: string; // ISO string
  lastModified: string; // ISO string (file mtime)
  messageCount: number;
  /** Approximate character length of all message text (user + AI) */
  totalChars: number;
}

/**
 * One turn in a conversation: a user prompt and the AI response.
 */
export interface ConversationTurn {
  turnIndex: number;
  timestamp: string; // ISO string or ''
  userMessage: string;
  aiResponse: string;
  modelId: string;
}

/**
 * Full parsed conversation — returned by read tools.
 */
export interface ParsedSession {
  id: string;
  title: string;
  workspace: string;
  workspacePath: string;
  creationDate: string;
  lastModified: string;
  responderUsername: string;
  turns: ConversationTurn[];
}

/** Workspace folder info derived from VS Code workspaceStorage */
export interface WorkspaceInfo {
  hash: string;
  name: string;
  path: string;
}
