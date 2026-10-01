import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type {
  RawSessionSnapshot,
  SessionSummary,
  WorkspaceInfo,
  ParsedSession,
  RawChatRequest,
} from "./types.js";
import { buildTurns, buildIndexableText } from "./formatter.js";

// ─── Platform-aware storage root ────────────────────────────────────────────

function resolveStorageRoot(): string {
  switch (process.platform) {
    case "win32": {
      const appdata = process.env["APPDATA"];
      if (!appdata) throw new Error("APPDATA environment variable is not set");
      return join(appdata, "Code", "User", "workspaceStorage");
    }
    case "darwin":
      return join(
        homedir(),
        "Library",
        "Application Support",
        "Code",
        "User",
        "workspaceStorage",
      );
    default:
      return join(homedir(), ".config", "Code", "User", "workspaceStorage");
  }
}

export const STORAGE_ROOT = resolveStorageRoot();

// ─── Workspace resolution ────────────────────────────────────────────────────

function decodeVscodeUri(raw: string): string {
  try {
    // file:///d%3A/Anta/project → D:/Anta/project
    const url = new URL(raw);
    // On Windows url.pathname starts with /d:/…, strip leading slash
    let decoded = decodeURIComponent(url.pathname);
    if (process.platform === "win32" && decoded.startsWith("/")) {
      decoded = decoded.slice(1);
    }
    return decoded;
  } catch {
    return raw;
  }
}

async function readWorkspaceInfo(
  hash: string,
): Promise<WorkspaceInfo | undefined> {
  const workspaceJsonPath = join(STORAGE_ROOT, hash, "workspace.json");
  try {
    const raw = await readFile(workspaceJsonPath, "utf8");
    const data = JSON.parse(raw) as Record<string, string>;
    const uri = data["folder"] ?? data["workspace"] ?? "";
    const path = decodeVscodeUri(uri);
    const name =
      basename(path).replace(/\.code-workspace$/, "") || hash.slice(0, 8);
    return { hash, name, path };
  } catch {
    return undefined;
  }
}

// ─── In-memory workspace cache ───────────────────────────────────────────────

/**
 * The set of workspaces is cached per process, but only for WORKSPACE_CACHE_TTL_MS.
 *
 * Both hosts of this module are long-lived: the MCP server runs for as long as
 * the editor window, the Vite dev server for as long as `npm run dev`. Without a
 * TTL, a workspace that VS Code creates after that process started stays
 * invisible until the host restarts — a newly opened project would simply never
 * appear in the index. Refreshing costs one readdir plus a small read per
 * workspace, so a short TTL is cheap.
 */
let workspaceCache: Map<string, WorkspaceInfo> | undefined;
let workspaceCachedAt = 0;
const WORKSPACE_CACHE_TTL_MS = 60 * 1000; // 1 minute

async function getWorkspaceCache(): Promise<Map<string, WorkspaceInfo>> {
  if (workspaceCache && Date.now() - workspaceCachedAt < WORKSPACE_CACHE_TTL_MS) {
    return workspaceCache;
  }

  const cache = new Map<string, WorkspaceInfo>();
  let entries: string[] = [];
  try {
    const dirents = await readdir(STORAGE_ROOT, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return cache;
  }

  await Promise.all(
    entries.map(async (hash) => {
      const info = await readWorkspaceInfo(hash);
      if (info) cache.set(hash, info);
    }),
  );

  workspaceCache = cache;
  workspaceCachedAt = Date.now();
  return cache;
}

/** Force the next getWorkspaceCache() call to rescan, ignoring the TTL. */
export function invalidateWorkspaceCache(): void {
  workspaceCache = undefined;
  workspaceCachedAt = 0;
}

// ─── JSONL parsing ───────────────────────────────────────────────────────────

/**
 * Reads a JSONL session file and reconstructs the full snapshot by applying
 * all patches.
 */
export async function readFullSnapshot(
  filePath: string,
): Promise<RawSessionSnapshot | undefined> {
  try {
    const text = await readFile(filePath, "utf8");
    const lines = text.split("\n");
    const firstLine = lines[0];
    if (!firstLine?.trim()) return undefined;
    const firstParsed = JSON.parse(firstLine) as {
      kind: number;
      v: RawSessionSnapshot;
    };
    if (firstParsed.kind !== 0) return undefined;

    const snapshot = firstParsed.v;
    if (!snapshot.requests) snapshot.requests = [];

    const latestResponses = new Map<number, unknown[]>();
    const latestResults = new Map<number, RawChatRequest["result"]>();

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      let patch: { kind: number; k: (string | number)[]; v: unknown };
      try {
        patch = JSON.parse(line) as typeof patch;
      } catch {
        continue;
      }

      if (patch.kind === 2) {
        const k = patch.k;
        if (k.length === 1 && k[0] === "requests") {
          const incoming = patch.v as RawChatRequest[];
          for (const req of incoming) {
            snapshot.requests.push(req);
          }
        } else if (
          k.length === 3 &&
          k[0] === "requests" &&
          k[2] === "response"
        ) {
          latestResponses.set(k[1] as number, patch.v as unknown[]);
        }
      } else if (patch.kind === 1) {
        const k = patch.k;
        if (k.length === 1 && k[0] === "customTitle") {
          snapshot.customTitle = patch.v as string;
        } else if (k.length === 3 && k[0] === "requests" && k[2] === "result") {
          latestResults.set(
            k[1] as number,
            patch.v as RawChatRequest["result"],
          );
        }
      }
    }

    for (const [idx, response] of latestResponses) {
      if (snapshot.requests[idx]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (snapshot.requests[idx] as any).response = response;
      }
    }

    for (const [idx, result] of latestResults) {
      if (snapshot.requests[idx]) {
        snapshot.requests[idx].result = result;
      }
    }

    return snapshot;
  } catch {
    return undefined;
  }
}

// ─── Session file discovery ──────────────────────────────────────────────────

interface SessionFile {
  filePath: string;
  sessionId: string;
  workspaceInfo: WorkspaceInfo;
  mtime: Date;
}

async function discoverSessionFiles(
  workspaceFilter?: string,
): Promise<SessionFile[]> {
  const wsCache = await getWorkspaceCache();

  const workspaces = workspaceFilter
    ? [...wsCache.values()].filter(
        (ws) =>
          ws.name.toLowerCase().includes(workspaceFilter.toLowerCase()) ||
          ws.path.toLowerCase().includes(workspaceFilter.toLowerCase()),
      )
    : [...wsCache.values()];

  const results: SessionFile[] = [];

  await Promise.all(
    workspaces.map(async (ws) => {
      const chatDir = join(STORAGE_ROOT, ws.hash, "chatSessions");
      if (!existsSync(chatDir)) return;
      let files: string[] = [];
      try {
        files = (await readdir(chatDir)).filter((f) => f.endsWith(".jsonl"));
      } catch {
        return;
      }
      await Promise.all(
        files.map(async (file) => {
          const filePath = join(chatDir, file);
          try {
            const info = await stat(filePath);
            results.push({
              filePath,
              sessionId: file.replace(/\.jsonl$/, ""),
              workspaceInfo: ws,
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

// ─── Public API ──────────────────────────────────────────────────────────────

export interface ListSessionsOptions {
  workspaceFilter?: string;
  since?: string;
  until?: string;
  sort?: "newest" | "oldest";
  limit?: number;
  offset?: number;
  /** When true, populate SessionSummary.indexableText with stripped turn content for BM25 indexing. */
  includeIndexableText?: boolean;
}

export async function listSessions(
  opts: ListSessionsOptions = {},
): Promise<SessionSummary[]> {
  const files = await discoverSessionFiles(opts.workspaceFilter);

  const summaries: SessionSummary[] = [];

  await Promise.all(
    files.map(async ({ filePath, sessionId, workspaceInfo, mtime }) => {
      const snapshot = await readFullSnapshot(filePath);
      if (!snapshot || !snapshot.requests?.length) return;

      let turns;
      try {
        turns = buildTurns(snapshot.requests);
      } catch (err) {
        console.warn(
          `[chat-mcp] Failed to parse session ${sessionId} in ${workspaceInfo.name}:`,
          (err as Error).message,
        );
        return;
      }

      const totalChars = turns.reduce((acc, t) => {
        return acc + t.userMessage.length + t.aiResponse.length;
      }, 0);

      let indexableText: string | undefined;
      if (opts.includeIndexableText) {
        try {
          indexableText = buildIndexableText(turns);
        } catch {
          // Silently skip — one bad session won't break the index
        }
      }

      const rawTitle =
        snapshot.customTitle ??
        snapshot.requests[0]?.message?.text ??
        undefined;
      const title =
        typeof rawTitle === "string"
          ? rawTitle.slice(0, 60)
          : (turns[0]?.userMessage?.slice(0, 60) ?? "Untitled");

      summaries.push({
        id: snapshot.sessionId ?? sessionId,
        title,
        workspace: workspaceInfo.name,
        workspacePath: workspaceInfo.path,
        creationDate: snapshot.creationDate
          ? new Date(snapshot.creationDate).toISOString()
          : "",
        lastModified: mtime.toISOString(),
        messageCount: snapshot.requests.length,
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
}

// ─────────────────────────────────────────────────────────────────────────────

export interface ReadSessionOptions {
  fromTurn?: number;
  toTurn?: number;
  firstTurns?: number;
  lastTurns?: number;
  page?: number;
  pageSize?: number;
}

export async function readSession(
  sessionId: string,
  opts: ReadSessionOptions = {},
): Promise<ParsedSession | undefined> {
  const wsCache = await getWorkspaceCache();
  let filePath: string | undefined;
  let workspaceInfo: WorkspaceInfo | undefined;
  let mtime: Date | undefined;

  for (const ws of wsCache.values()) {
    const candidate = join(
      STORAGE_ROOT,
      ws.hash,
      "chatSessions",
      `${sessionId}.jsonl`,
    );
    if (existsSync(candidate)) {
      filePath = candidate;
      workspaceInfo = ws;
      try {
        mtime = (await stat(candidate)).mtime;
      } catch {
        mtime = new Date(0);
      }
      break;
    }
  }

  if (!filePath || !workspaceInfo) return undefined;

  const snapshot = await readFullSnapshot(filePath);
  if (!snapshot) return undefined;

  let turns = buildTurns(snapshot.requests ?? []);

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
    id: snapshot.sessionId ?? sessionId,
    title:
      snapshot.customTitle ?? turns[0]?.userMessage.slice(0, 60) ?? "Untitled",
    workspace: workspaceInfo.name,
    workspacePath: workspaceInfo.path,
    creationDate: snapshot.creationDate
      ? new Date(snapshot.creationDate).toISOString()
      : "",
    lastModified: mtime?.toISOString() ?? "",
    responderUsername: snapshot.responderUsername ?? "GitHub Copilot",
    turns,
  };
}
