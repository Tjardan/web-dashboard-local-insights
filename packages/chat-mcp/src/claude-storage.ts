/**
 * Claude Code session storage reader.
 *
 * Layout: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 *
 * Much simpler than the VS Code side: plain append-only JSONL, one JSON object
 * per line, no snapshot-plus-patches to replay. Every record carries its own
 * `cwd`, `sessionId` and `timestamp`.
 *
 * The directory name is a lossy encoding of the working directory
 * (`d--Anta-afas-help--worktrees-tbr-feature1`), so it cannot be decoded back
 * into a path reliably — both `\` and `.` collapse into `-`. The project path
 * is therefore read from the `cwd` field of the records themselves, and the
 * directory name is only used as a fallback label.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  ChatSource,
  ClaudeRecord,
  ListSessionsOptions,
  ParsedSession,
  ReadSessionOptions,
  SessionProvider,
  SessionSummary,
} from "./types.js";
import { buildClaudeTurns, claudeSessionTitle } from "./claude-formatter.js";
import { buildIndexableText } from "./formatter.js";

/**
 * Claude Code honours CLAUDE_CONFIG_DIR for a relocated config directory;
 * otherwise it is ~/.claude on every platform.
 */
export function resolveClaudeRoot(): string {
  const override = process.env["CLAUDE_CONFIG_DIR"];
  return join(override && override.trim() ? override : join(homedir(), ".claude"), "projects");
}

export const CLAUDE_ROOT = resolveClaudeRoot();

// ─── Session file discovery ──────────────────────────────────────────────────

interface ClaudeSessionFile {
  filePath: string;
  sessionId: string;
  /** Directory name under projects/ — the encoded cwd */
  dirName: string;
  mtime: Date;
}

async function discoverSessionFiles(): Promise<ClaudeSessionFile[]> {
  let dirs: string[];
  try {
    const dirents = await readdir(CLAUDE_ROOT, { withFileTypes: true });
    dirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return []; // Claude Code not installed, or no sessions yet
  }

  const results: ClaudeSessionFile[] = [];

  await Promise.all(
    dirs.map(async (dirName) => {
      const dirPath = join(CLAUDE_ROOT, dirName);
      let files: string[];
      try {
        files = (await readdir(dirPath)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        return;
      }
      await Promise.all(
        files.map(async (file) => {
          const filePath = join(dirPath, file);
          try {
            const info = await stat(filePath);
            results.push({
              filePath,
              sessionId: file.replace(/\.jsonl$/, ""),
              dirName,
              mtime: info.mtime,
            });
          } catch {
            // skip unreadable files
          }
        }),
      );
    }),
  );

  return results;
}

// ─── JSONL parsing ───────────────────────────────────────────────────────────

export interface ParsedClaudeFile {
  records: ClaudeRecord[];
  /** Working directory the session ran in, from the first record that has one */
  cwd: string;
  /** Earliest record timestamp (ISO), or '' */
  creationDate: string;
}

/**
 * Read one session file into its records.
 *
 * A malformed line is skipped rather than failing the file: these logs are
 * appended to while a session is live, so the last line can be a partial write.
 */
export async function readClaudeSessionFile(
  filePath: string,
): Promise<ParsedClaudeFile | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  const records: ClaudeRecord[] = [];
  let cwd = "";
  let creationDate = "";

  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let rec: ClaudeRecord;
    try {
      rec = JSON.parse(line) as ClaudeRecord;
    } catch {
      continue;
    }
    records.push(rec);
    if (!cwd && typeof rec.cwd === "string" && rec.cwd) cwd = rec.cwd;
    if (!creationDate && typeof rec.timestamp === "string" && rec.timestamp) {
      creationDate = rec.timestamp;
    }
  }

  if (records.length === 0) return undefined;
  return { records, cwd, creationDate };
}

/**
 * Turn the encoded directory name into something readable, for the rare case
 * where no record carries a cwd. Not a real path — only a label.
 */
function labelFromDirName(dirName: string): string {
  const parts = dirName.split("-").filter(Boolean);
  return parts[parts.length - 1] ?? dirName;
}

function workspaceNameFor(cwd: string, dirName: string): string {
  if (!cwd) return labelFromDirName(dirName);
  // basename() on a Windows path works here because cwd is always native
  return basename(cwd.replace(/[\\/]+$/, "")) || labelFromDirName(dirName);
}

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * Compare paths without caring about the separator.
 *
 * Claude Code stores a native Windows cwd (`d:\Anta\project`), while callers
 * tend to hand over a URI-ish path with forward slashes — the VS Code reader
 * needs that, because its workspace.json holds file:// URIs. Normalising both
 * sides keeps one filter working across the two providers.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function matchesWorkspace(
  filter: string | undefined,
  name: string,
  path: string,
): boolean {
  if (!filter) return true;
  const needle = normalizePath(filter);
  if (normalizePath(path).includes(needle)) return true;
  // The filter is often a full project path while `name` is just the folder,
  // so compare the name against the filter's last segment too.
  const lastSegment = needle.split("/").filter(Boolean).pop() ?? needle;
  return name.toLowerCase().includes(lastSegment);
}

export const claudeProvider: SessionProvider = {
  source: "claude" as ChatSource,
  label: "Claude Code",

  async isAvailable(): Promise<boolean> {
    try {
      await readdir(CLAUDE_ROOT);
      return true;
    } catch {
      return false;
    }
  },

  async listSessions(opts: ListSessionsOptions = {}): Promise<SessionSummary[]> {
    const files = await discoverSessionFiles();
    const summaries: SessionSummary[] = [];

    await Promise.all(
      files.map(async ({ filePath, sessionId, dirName, mtime }) => {
        const parsed = await readClaudeSessionFile(filePath);
        if (!parsed) return;

        const workspacePath = parsed.cwd;
        const workspace = workspaceNameFor(workspacePath, dirName);
        if (!matchesWorkspace(opts.workspaceFilter, workspace, workspacePath)) {
          return;
        }

        let turns;
        try {
          turns = buildClaudeTurns(parsed.records);
        } catch (err) {
          console.warn(
            `[chat-mcp] Failed to parse Claude session ${sessionId} in ${workspace}:`,
            (err as Error).message,
          );
          return;
        }
        if (turns.length === 0) return;

        const totalChars = turns.reduce(
          (acc, t) => acc + t.userMessage.length + t.aiResponse.length,
          0,
        );

        let indexableText: string | undefined;
        if (opts.includeIndexableText) {
          try {
            indexableText = buildIndexableText(turns);
          } catch {
            // One bad session must not break the index
          }
        }

        summaries.push({
          id: sessionId,
          source: "claude",
          title: claudeSessionTitle(parsed.records, turns),
          workspace,
          workspacePath,
          creationDate: parsed.creationDate,
          lastModified: mtime.toISOString(),
          messageCount: turns.length,
          totalChars,
          indexableText,
        });
      }),
    );

    const since = opts.since ? new Date(opts.since).getTime() : undefined;
    const until = opts.until ? new Date(opts.until).getTime() : undefined;
    let filtered = summaries.filter((s) => {
      const t = new Date(s.lastModified).getTime();
      if (since !== undefined && t < since) return false;
      if (until !== undefined && t > until) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const diff =
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime();
      return opts.sort === "oldest" ? -diff : diff;
    });

    const offset = opts.offset ?? 0;
    if (offset > 0) filtered = filtered.slice(offset);
    if (opts.limit !== undefined) filtered = filtered.slice(0, opts.limit);

    return filtered;
  },

  async readSession(
    sessionId: string,
    opts: ReadSessionOptions = {},
  ): Promise<ParsedSession | undefined> {
    const files = await discoverSessionFiles();
    const match = files.find((f) => f.sessionId === sessionId);
    if (!match) return undefined;

    const parsed = await readClaudeSessionFile(match.filePath);
    if (!parsed) return undefined;

    let turns = buildClaudeTurns(parsed.records);

    if (opts.fromTurn !== undefined || opts.toTurn !== undefined) {
      const from = opts.fromTurn ?? 0;
      const to = opts.toTurn !== undefined ? opts.toTurn + 1 : turns.length;
      turns = turns.slice(from, to);
    } else if (opts.firstTurns !== undefined) {
      turns = turns.slice(0, opts.firstTurns);
    } else if (opts.lastTurns !== undefined) {
      turns = turns.slice(-opts.lastTurns);
    } else if (opts.page !== undefined && opts.pageSize !== undefined) {
      const start = opts.page * opts.pageSize;
      turns = turns.slice(start, start + opts.pageSize);
    }

    return {
      id: sessionId,
      source: "claude",
      title: claudeSessionTitle(parsed.records, turns),
      workspace: workspaceNameFor(parsed.cwd, match.dirName),
      workspacePath: parsed.cwd,
      creationDate: parsed.creationDate,
      lastModified: match.mtime.toISOString(),
      responderUsername: "Claude",
      turns,
    };
  },
};
