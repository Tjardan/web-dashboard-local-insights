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
    metadata?: {
      codeBlocks?: unknown[];
      /** Full model response from a /compact call — contains <analysis>…</analysis><summary>…</summary>. */
      summary?: { toolCallRoundId?: string; text?: string };
    };
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

// ─── Raw Claude Code JSONL types ────────────────────────────────────────────

/** One content block of a Claude message (Anthropic API shape). */
export interface ClaudeContentBlock {
  type: string;
  /** text blocks */
  text?: string;
  /** thinking blocks (some writers use `text` instead) */
  thinking?: string;
  /** tool_use blocks */
  name?: string;
  input?: unknown;
  /** tool_result blocks */
  tool_use_id?: string;
  content?: unknown;
  [key: string]: unknown;
}

/**
 * One line of a Claude Code session log.
 *
 * The file mixes conversation records (`user`, `assistant`) with bookkeeping
 * (`ai-title`, `queue-operation`, `file-history-snapshot`, `atis-latch`, …),
 * so `type` must always be checked before reading anything else.
 */
export interface ClaudeRecord {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  /** Working directory the session ran in — the project path */
  cwd?: string;
  gitBranch?: string;
  /** True for records produced by a subagent rather than the main thread */
  isSidechain?: boolean;
  /**
   * True for the `user` record Claude Code writes after a compact: its content
   * is the summary of everything before it, not something the user typed.
   */
  isCompactSummary?: boolean;
  message?: {
    role?: string;
    model?: string;
    content?: string | ClaudeContentBlock[];
    [key: string]: unknown;
  };
  /** `ai-title` records */
  aiTitle?: string;
  /** `custom-title` records */
  customTitle?: string;
  [key: string]: unknown;
}

// ─── Parsed / domain types ──────────────────────────────────────────────────

/** Which assistant produced a chat session. */
export type ChatSource = "copilot" | "claude";

/**
 * Lightweight session descriptor — returned by list tools.
 * Intentionally minimal to keep token counts low.
 */
export interface SessionSummary {
  id: string;
  /**
   * Which assistant this session came from. IDs are only unique within a
   * source, so anything merging sources keys on `${source}:${id}`.
   */
  source: ChatSource;
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
  /**
   * Full /compact response text from result.metadata.summary.
   * Contains <analysis>…</analysis><summary>…</summary> when VS Code ran /compact.
   * The Claude reader wraps its compact summary in the same <summary> block, so
   * the recap detection in formatter.ts works for both sources.
   */
  compactSummary?: string;
}

/**
 * Full parsed conversation — returned by read tools.
 */
export interface ParsedSession {
  id: string;
  source: ChatSource;
  title: string;
  workspace: string;
  workspacePath: string;
  creationDate: string;
  lastModified: string;
  responderUsername: string;
  turns: ConversationTurn[];
}

// ─── Provider abstraction ───────────────────────────────────────────────────

export interface ListSessionsOptions {
  /** Match against workspace name or path (substring, case-insensitive) */
  workspaceFilter?: string;
  since?: string;
  until?: string;
  sort?: "newest" | "oldest";
  limit?: number;
  offset?: number;
  /** When true, populate SessionSummary.indexableText for BM25 indexing. */
  includeIndexableText?: boolean;
}

export interface ReadSessionOptions {
  fromTurn?: number;
  toTurn?: number;
  firstTurns?: number;
  lastTurns?: number;
  page?: number;
  pageSize?: number;
}

/**
 * One chat backend — VS Code Copilot, Claude Code, …
 *
 * Both store their sessions as JSONL on disk but share nothing beyond that:
 * different directory layouts, different record shapes, different ways of
 * naming the project a session belongs to. This interface is the seam, so
 * search-tools and the API can stay unaware of which one they are talking to.
 */
export interface SessionProvider {
  readonly source: ChatSource;
  /** Human-readable name, used in tool output and the UI */
  readonly label: string;
  /** False when this assistant leaves no readable sessions on this machine */
  isAvailable(): Promise<boolean>;
  listSessions(opts?: ListSessionsOptions): Promise<SessionSummary[]>;
  readSession(
    sessionId: string,
    opts?: ReadSessionOptions,
  ): Promise<ParsedSession | undefined>;
}

/** Workspace folder info derived from VS Code workspaceStorage */
export interface WorkspaceInfo {
  hash: string;
  name: string;
  path: string;
}
