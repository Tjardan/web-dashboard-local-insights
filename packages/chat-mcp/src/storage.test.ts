import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFullSnapshot } from "./storage.js";

/**
 * The VS Code side does not store a session; it stores a snapshot plus a stream
 * of patches that have to be replayed in order. That replay is the single most
 * fragile piece of this package — it is driven entirely by key paths that only
 * exist as data — and it needs real files to exercise, so these tests write
 * fixtures to a temp directory.
 */

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "devpulse-storage-test-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let seq = 0;

/** Write a .jsonl fixture and return its path. */
async function fixture(lines: unknown[]): Promise<string> {
  const path = join(dir, `session-${seq++}.jsonl`);
  await writeFile(path, lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return path;
}

function request(text: string, response: unknown[] = []) {
  return {
    requestId: `r${text.length}`,
    timestamp: 1759312800000,
    message: { text },
    response,
    modelId: "gpt-4o",
  };
}

const snapshot = (requests: unknown[] = []) => ({
  kind: 0,
  v: {
    version: 3,
    sessionId: "abc-123",
    creationDate: 1759312800000,
    requests,
  },
});

describe("readFullSnapshot", () => {
  it("reads a session that is nothing but a snapshot line", async () => {
    const path = await fixture([snapshot([request("eerste vraag")])]);
    const snap = await readFullSnapshot(path);

    expect(snap?.sessionId).toBe("abc-123");
    expect(snap?.requests).toHaveLength(1);
    expect(snap?.requests?.[0]?.message?.text).toBe("eerste vraag");
  });

  it("appends requests from a kind:2 patch", async () => {
    const path = await fixture([
      snapshot([request("eerste")]),
      { kind: 2, k: ["requests"], v: [request("tweede")] },
      { kind: 2, k: ["requests"], v: [request("derde")] },
    ]);
    const snap = await readFullSnapshot(path);

    expect(snap?.requests?.map((r) => r.message?.text)).toEqual([
      "eerste",
      "tweede",
      "derde",
    ]);
  });

  it("replaces a response rather than appending to it", async () => {
    // A streaming answer is rewritten on every chunk, so the last patch for a
    // given index wins. Appending here would duplicate the whole answer.
    const path = await fixture([
      snapshot([request("vraag", [{ kind: "markdownContent", value: "Ant" }])]),
      {
        kind: 2,
        k: ["requests", 0, "response"],
        v: [{ kind: "markdownContent", value: "Antwo" }],
      },
      {
        kind: 2,
        k: ["requests", 0, "response"],
        v: [{ kind: "markdownContent", value: "Antwoord." }],
      },
    ]);
    const snap = await readFullSnapshot(path);

    expect(snap?.requests?.[0]?.response).toEqual([
      { kind: "markdownContent", value: "Antwoord." },
    ]);
  });

  it("applies a patched response to a request that arrived in a later patch", async () => {
    const path = await fixture([
      snapshot([request("eerste")]),
      { kind: 2, k: ["requests"], v: [request("tweede")] },
      {
        kind: 2,
        k: ["requests", 1, "response"],
        v: [{ kind: "markdownContent", value: "op de tweede" }],
      },
    ]);
    const snap = await readFullSnapshot(path);

    expect(snap?.requests?.[1]?.response).toEqual([
      { kind: "markdownContent", value: "op de tweede" },
    ]);
  });

  it("picks up a customTitle set after the fact", async () => {
    const path = await fixture([
      snapshot([request("vraag")]),
      { kind: 1, k: ["customTitle"], v: "Zelf gekozen titel" },
    ]);

    expect((await readFullSnapshot(path))?.customTitle).toBe(
      "Zelf gekozen titel",
    );
  });

  it("applies a kind:1 result patch, which is where /compact lands", async () => {
    const path = await fixture([
      snapshot([request("vraag")]),
      {
        kind: 1,
        k: ["requests", 0, "result"],
        v: { metadata: { summary: { text: "<summary>samenvatting</summary>" } } },
      },
    ]);
    const snap = await readFullSnapshot(path);

    expect(snap?.requests?.[0]?.result?.metadata?.summary?.text).toBe(
      "<summary>samenvatting</summary>",
    );
  });

  it("ignores a patch pointing at a request that does not exist", async () => {
    const path = await fixture([
      snapshot([request("vraag")]),
      { kind: 2, k: ["requests", 9, "response"], v: [{ kind: "x" }] },
    ]);

    await expect(readFullSnapshot(path)).resolves.toBeDefined();
  });

  it("skips a malformed trailing line instead of failing the file", async () => {
    // A live session is appended to while it is being read, so the last line
    // can be half-written.
    const path = join(dir, "torn.jsonl");
    await writeFile(
      path,
      [
        JSON.stringify(snapshot([request("vraag")])),
        '{"kind":2,"k":["requests"],"v":[{"message',
      ].join("\n"),
      "utf8",
    );

    expect((await readFullSnapshot(path))?.requests).toHaveLength(1);
  });

  it("returns undefined for a file that does not open with a snapshot", async () => {
    const path = await fixture([{ kind: 2, k: ["requests"], v: [] }]);
    expect(await readFullSnapshot(path)).toBeUndefined();
  });

  it("returns undefined for an empty or missing file", async () => {
    const empty = join(dir, "empty.jsonl");
    await writeFile(empty, "", "utf8");

    expect(await readFullSnapshot(empty)).toBeUndefined();
    expect(await readFullSnapshot(join(dir, "bestaat-niet.jsonl"))).toBe(
      undefined,
    );
  });

  it("gives a snapshot without requests an empty array, not undefined", async () => {
    const path = await fixture([
      { kind: 0, v: { sessionId: "leeg", creationDate: 1759312800000 } },
    ]);

    expect((await readFullSnapshot(path))?.requests).toEqual([]);
  });
});
