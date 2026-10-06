/**
 * Persistent parse cache for chat sessions.
 *
 * Why this exists: the first tool call in a fresh MCP process cost ~19 s, and
 * virtually all of it was the Copilot side — 812 sessions in ~19 s against 50
 * Claude sessions in 0,8 s. The difference is the format, not the volume: a VS
 * Code session file is a snapshot plus a stream of patches that has to be
 * replayed per session before a single turn can be read. That work only depends
 * on the bytes on disk, so it never has to happen twice.
 *
 * The unit of caching is therefore **one session file**, stamped with its mtime
 * and size. A session that was touched is reparsed; the other 800 are read back
 * as plain JSON. That beats caching the whole index, which any single new chat
 * message would invalidate in full.
 *
 * Location: a user-level cache directory, not `.devpulse-cache/` in the repo.
 * The MCP server is registered at user scope and inherits the host's working
 * directory, so a cwd-relative path would scatter a copy of this cache through
 * every project folder you happen to open.
 *
 * Both hosts — the MCP server and the Vite dev server — share the files. A
 * concurrent write is survivable by construction: entries are written to a
 * temporary name and renamed into place, and anything unreadable or stale is
 * simply treated as a miss and reparsed.
 */

import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import type { ChatSource, SessionSummary } from "./types.js";

/**
 * Bump whenever the shape of SessionSummary changes, or when the formatters
 * start producing different text for the same input. Without that, a change to
 * buildIndexableText() would keep serving yesterday's text for every session
 * that happens not to be touched again.
 */
const CACHE_VERSION = 2;

interface CacheEntry {
  v: number;
  mtimeMs: number;
  size: number;
  /**
   * null means "this file holds no usable session". Cached deliberately: a
   * malformed or empty log would otherwise be reparsed on every single run.
   */
  summary: SessionSummary | null;
}

/** The identity of a file's contents, as far as this cache is concerned. */
export interface FileStamp {
  mtimeMs: number;
  size: number;
}

export function resolveCacheRoot(): string {
  const override = process.env["DEVPULSE_CACHE_DIR"];
  if (override && override.trim()) return join(override.trim(), "sessions");

  if (process.platform === "win32") {
    const local = process.env["LOCALAPPDATA"];
    if (local) return join(local, "devpulse", "sessions");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "devpulse", "sessions");
  }
  const xdg = process.env["XDG_CACHE_HOME"];
  const base = xdg && xdg.trim() ? xdg.trim() : join(homedir(), ".cache");
  return join(base, "devpulse", "sessions");
}

export const CACHE_ROOT = resolveCacheRoot();

/** Escape hatch for debugging a suspected stale-cache problem. */
const ENABLED = process.env["DEVPULSE_SESSION_CACHE"] !== "0";

function fileNameFor(filePath: string): string {
  return `${createHash("sha256").update(filePath).digest("hex").slice(0, 24)}.json`;
}

function dirFor(source: ChatSource): string {
  return join(CACHE_ROOT, source);
}

/** mkdir is idempotent but still a syscall; one per source per process is enough. */
const dirReady = new Map<ChatSource, Promise<void>>();

function ensureDir(source: ChatSource): Promise<void> {
  let pending = dirReady.get(source);
  if (!pending) {
    pending = mkdir(dirFor(source), { recursive: true }).then(
      () => undefined,
      () => undefined, // a cache that cannot be written is still a working app
    );
    dirReady.set(source, pending);
  }
  return pending;
}

/**
 * Every cache file name this process has produced or confirmed, per source.
 * pruneSessionCache() deletes what is not in here, so it must only ever grow.
 */
const seen = new Map<ChatSource, Set<string>>();

function markSeen(source: ChatSource, name: string): void {
  let set = seen.get(source);
  if (!set) {
    set = new Set();
    seen.set(source, set);
  }
  set.add(name);
}

async function readEntry(
  path: string,
  stamp: FileStamp,
): Promise<CacheEntry | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return undefined;
  }
  let entry: CacheEntry;
  try {
    entry = JSON.parse(raw) as CacheEntry;
  } catch {
    return undefined; // torn write — the reparse below rewrites it
  }
  if (entry.v !== CACHE_VERSION) return undefined;
  if (entry.mtimeMs !== stamp.mtimeMs || entry.size !== stamp.size) {
    return undefined;
  }
  return entry;
}

async function writeEntry(
  source: ChatSource,
  path: string,
  entry: CacheEntry,
): Promise<void> {
  await ensureDir(source);
  // Rename is atomic within a directory, so a reader never sees half a file
  // even when the other host is writing the same session at the same moment.
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(entry), "utf8");
    await rename(tmp, path);
  } catch {
    try {
      await unlink(tmp);
    } catch {
      // nothing to clean up
    }
  }
}

/**
 * Return the parsed summary for one session file, parsing it only when the
 * cached copy is missing or no longer matches the file on disk.
 *
 * `parse` must produce the *complete* summary including `indexableText`, even
 * when the caller did not ask for it: the cache is shared between callers, and
 * one that skipped the text would poison it for the index.
 */
export async function withSessionCache(
  source: ChatSource,
  filePath: string,
  stamp: FileStamp,
  parse: () => Promise<SessionSummary | undefined>,
): Promise<SessionSummary | undefined> {
  if (!ENABLED) return parse();

  const name = fileNameFor(filePath);
  const path = join(dirFor(source), name);
  markSeen(source, name);

  const hit = await readEntry(path, stamp);
  if (hit) return hit.summary ?? undefined;

  const summary = await parse();
  await writeEntry(source, path, {
    v: CACHE_VERSION,
    mtimeMs: stamp.mtimeMs,
    size: stamp.size,
    summary: summary ?? null,
  });
  return summary;
}

/** Guards against pruning twice in one process — once is enough. */
const pruned = new Set<ChatSource>();

/**
 * Drop cache files for sessions that no longer exist.
 *
 * Only safe to call after a pass that looked at *every* session of this source:
 * anything not seen is taken to be gone. A filtered listing has no business
 * calling this, and the providers only do so when no workspace filter was given.
 */
export async function pruneSessionCache(source: ChatSource): Promise<void> {
  if (!ENABLED || pruned.has(source)) return;
  pruned.add(source);

  const keep = seen.get(source);
  if (!keep || keep.size === 0) return; // nothing scanned — don't wipe the cache

  let files: string[];
  try {
    files = await readdir(dirFor(source));
  } catch {
    return;
  }

  await Promise.all(
    files
      .filter((f) => f.endsWith(".json") && !keep.has(f))
      .map((f) =>
        unlink(join(dirFor(source), f)).catch(() => {
          // another process got there first, or the file is locked
        }),
      ),
  );
}

/** Drop a summary's indexable text for callers that did not ask for it. */
export function withoutIndexableText(s: SessionSummary): SessionSummary {
  if (s.indexableText === undefined) return s;
  const { indexableText: _unused, ...rest } = s;
  return rest;
}
