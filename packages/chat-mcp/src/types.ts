// ─── Raw JSONL on-disk types ────────────────────────────────────────────────

export interface RawResponseItem {
  kind: string;
  value?: string;
  text?: string;
  // Thinking blocks
  id?: string;
  // Tool invocations
  // invocationMessage can be a plain string (custom/MCP tools) or an object
  // {value: string, supportThemeIcons: boolean, ...} (VS Code built-in tools)
  invocationMessage?: string | Record<string, unknown>;
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
  /**
   * Stripped, BM25-ready text: user messages + AI answers (no thinking/tool calls).
   * Only populated when listSessions() is called with includeIndexableText: true.
   */
  indexableText?: string;
}

/**
 * A single tool invocation extracted from an AI response.
 */
export interface ToolCallInfo {
  /** Internal tool identifier (e.g. "vscode.read_file") */
  toolId: string;
  /** Human-readable label from invocationMessage (e.g. "Reading file src/app.ts") */
  label: string;
  /** Structured args: from toolSpecificData, resultDetails.input (MCP), or invocationMessage.uris */
  args: Record<string, unknown> | null;
  /** Brief text summary of the tool's output/result (from resultDetails) */
  result?: string;
}

/**
 * One turn in a conversation: a user prompt and the AI response.
 */
export interface ConversationTurn {
  turnIndex: number;
  timestamp: string; // ISO string or ''
  userMessage: string;
  /** AI text response (markdownContent + thinking blocks; tool calls excluded) */
  aiResponse: string;
  modelId: string;
  /** Tool invocations extracted from this turn's response */
  toolCalls: ToolCallInfo[];
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
