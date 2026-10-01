import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionSummary } from "./types.js";

/**
 * The cache decides whether a session gets reparsed, so a wrong answer here is
 * invisible: searches keep working and quietly return yesterday's text. Every
 * test below is about one way the stamp can go stale.
 *
 * The module reads its location once at import time, so each test gets a fresh
 * temp directory and a fresh module instance — that also resets the internal
 * bookkeeping that prune() leans on.
 */

let dir: string;

type CacheModule = typeof import("./session-cache.js");

async function freshCache(env: Record<string, string> = {}): Promise<CacheModule> {
  vi.resetModules();
  process.env["DEVPULSE_CACHE_DIR"] = dir;
  delete process.env["DEVPULSE_SESSION_CACHE"];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  return import("./session-cache.js");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "devpulse-cache-test-"));
});

afterEach(async () => {
  delete process.env["DEVPULSE_CACHE_DIR"];
  delete process.env["DEVPULSE_SESSION_CACHE"];
  await rm(dir, { recursive: true, force: true });
});

function summary(id: string, text = "inhoud"): SessionSummary {
  return {
    id,
    source: "claude",
    title: `titel ${id}`,
    workspace: "runner",
    workspacePath: "d:\\Anta\\runner",
    creationDate: "2026-10-01T10:00:00.000Z",
    lastModified: "2026-10-01T11:00:00.000Z",
    messageCount: 2,
    totalChars: text.length,
    indexableText: text,
  };
}

describe("withSessionCache", () => {
  it("parses once and serves the cached copy after that", async () => {
    const { withSessionCache } = await freshCache();
    const parse = vi.fn(async () => summary("s1"));
    const stamp = { mtimeMs: 1000, size: 50 };

    const first = await withSessionCache("claude", "/a/s1.jsonl", stamp, parse);
    const second = await withSessionCache("claude", "/a/s1.jsonl", stamp, parse);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second?.indexableText).toBe("inhoud");
  });

  it("reparses when the mtime moved", async () => {
    const { withSessionCache } = await freshCache();
    const parse = vi
      .fn()
      .mockResolvedValueOnce(summary("s1", "oud"))
      .mockResolvedValueOnce(summary("s1", "nieuw"));

    await withSessionCache("claude", "/a/s1.jsonl", { mtimeMs: 1000, size: 50 }, parse);
    const after = await withSessionCache(
      "claude",
      "/a/s1.jsonl",
      { mtimeMs: 2000, size: 50 },
      parse,
    );

    expect(parse).toHaveBeenCalledTimes(2);
    expect(after?.indexableText).toBe("nieuw");
  });

  it("reparses when only the size changed", async () => {
    // A fast edit can land inside the same millisecond, so size is checked too.
    const { withSessionCache } = await freshCache();
    const parse = vi.fn(async () => summary("s1"));

    await withSessionCache("claude", "/a/s1.jsonl", { mtimeMs: 1000, size: 50 }, parse);
    await withSessionCache("claude", "/a/s1.jsonl", { mtimeMs: 1000, size: 90 }, parse);

    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("keeps separate entries per source and per file", async () => {
    const { withSessionCache } = await freshCache();
    const stamp = { mtimeMs: 1000, size: 50 };

    const a = await withSessionCache("claude", "/a/s1.jsonl", stamp, async () =>
      summary("claude-sessie"),
    );
    const b = await withSessionCache("copilot", "/a/s1.jsonl", stamp, async () =>
      summary("copilot-sessie"),
    );
    const c = await withSessionCache("claude", "/a/s2.jsonl", stamp, async () =>
      summary("tweede"),
    );

    expect([a?.id, b?.id, c?.id]).toEqual([
      "claude-sessie",
      "copilot-sessie",
      "tweede",
    ]);
  });

  it("remembers that a file holds no usable session", async () => {
    // Otherwise every empty or corrupt log is reparsed on every single run.
    const { withSessionCache } = await freshCache();
    const parse = vi.fn(async () => undefined);
    const stamp = { mtimeMs: 1000, size: 0 };

    expect(await withSessionCache("claude", "/a/leeg.jsonl", stamp, parse)).toBe(
      undefined,
    );
    expect(await withSessionCache("claude", "/a/leeg.jsonl", stamp, parse)).toBe(
      undefined,
    );
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("treats an unreadable entry as a miss and heals it", async () => {
    const { withSessionCache } = await freshCache();
    const stamp = { mtimeMs: 1000, size: 50 };
    await withSessionCache("claude", "/a/s1.jsonl", stamp, async () => summary("s1"));

    const [name] = await readdir(join(dir, "sessions", "claude"));
    const path = join(dir, "sessions", "claude", name!);
    await writeFile(path, "{half geschre", "utf8");

    const parse = vi.fn(async () => summary("s1", "opnieuw"));
    const healed = await withSessionCache("claude", "/a/s1.jsonl", stamp, parse);

    expect(parse).toHaveBeenCalledTimes(1);
    expect(healed?.indexableText).toBe("opnieuw");
    // and the broken file was replaced, not left behind
    expect(JSON.parse(await readFile(path, "utf8")).summary.indexableText).toBe(
      "opnieuw",
    );
  });

  it("ignores an entry written by an older cache version", async () => {
    const { withSessionCache } = await freshCache();
    const stamp = { mtimeMs: 1000, size: 50 };
    await withSessionCache("claude", "/a/s1.jsonl", stamp, async () => summary("s1"));

    const [name] = await readdir(join(dir, "sessions", "claude"));
    const path = join(dir, "sessions", "claude", name!);
    const entry = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...entry, v: entry.v - 1 }), "utf8");

    const parse = vi.fn(async () => summary("s1"));
    await withSessionCache("claude", "/a/s1.jsonl", stamp, parse);

    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("parses every time when the cache is switched off", async () => {
    const { withSessionCache } = await freshCache({ DEVPULSE_SESSION_CACHE: "0" });
    const parse = vi.fn(async () => summary("s1"));
    const stamp = { mtimeMs: 1000, size: 50 };

    await withSessionCache("claude", "/a/s1.jsonl", stamp, parse);
    await withSessionCache("claude", "/a/s1.jsonl", stamp, parse);

    expect(parse).toHaveBeenCalledTimes(2);
    await expect(readdir(join(dir, "sessions"))).rejects.toThrow();
  });
});

describe("pruneSessionCache", () => {
  it("drops entries for sessions that were not seen this pass", async () => {
    const { withSessionCache, pruneSessionCache } = await freshCache();
    const stamp = { mtimeMs: 1000, size: 50 };
    for (const n of ["s1", "s2", "s3"]) {
      await withSessionCache("claude", `/a/${n}.jsonl`, stamp, async () => summary(n));
    }
    expect(await readdir(join(dir, "sessions", "claude"))).toHaveLength(3);

    // A new module instance: only s1 is visited, so s2 and s3 are gone.
    const next = await freshCache();
    await next.withSessionCache("claude", "/a/s1.jsonl", stamp, async () =>
      summary("s1"),
    );
    await next.pruneSessionCache("claude");

    expect(await readdir(join(dir, "sessions", "claude"))).toHaveLength(1);
  });

  it("leaves the cache alone when nothing was scanned", async () => {
    // A guard against wiping the whole cache on a run that found no sessions,
    // for instance because the storage root was temporarily unreachable.
    const { withSessionCache } = await freshCache();
    await withSessionCache("claude", "/a/s1.jsonl", { mtimeMs: 1, size: 1 }, async () =>
      summary("s1"),
    );

    const next = await freshCache();
    await next.pruneSessionCache("claude");

    expect(await readdir(join(dir, "sessions", "claude"))).toHaveLength(1);
  });

  it("does not touch another source's entries", async () => {
    const { withSessionCache, pruneSessionCache } = await freshCache();
    const stamp = { mtimeMs: 1000, size: 50 };
    await withSessionCache("copilot", "/a/c1.jsonl", stamp, async () => summary("c1"));
    await withSessionCache("claude", "/a/s1.jsonl", stamp, async () => summary("s1"));

    const next = await freshCache();
    await next.withSessionCache("claude", "/a/s1.jsonl", stamp, async () =>
      summary("s1"),
    );
    await next.pruneSessionCache("claude");

    expect(await readdir(join(dir, "sessions", "copilot"))).toHaveLength(1);
  });
});

describe("withoutIndexableText", () => {
  it("removes the field entirely rather than blanking it", async () => {
    const { withoutIndexableText } = await freshCache();
    const lean = withoutIndexableText(summary("s1"));

    expect("indexableText" in lean).toBe(false);
    expect(lean.title).toBe("titel s1");
  });

  it("passes through a summary that never had one", async () => {
    const { withoutIndexableText } = await freshCache();
    const { indexableText: _drop, ...bare } = summary("s1");

    expect(withoutIndexableText(bare)).toBe(bare);
  });
});
