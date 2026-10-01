import { describe, it, expect } from "vitest";
import { BM25Index, tokenize, type BM25Document } from "./index.js";

describe("tokenize", () => {
  it("lowercases and drops punctuation", () => {
    expect(tokenize("Hello, World!")).toEqual(["hello", "world"]);
  });

  it("splits camelCase and PascalCase so identifiers stay searchable", () => {
    expect(tokenize("buildIndexableText")).toEqual([
      "build",
      "indexable",
      "text",
    ]);
    // An acronym run keeps its last capital with the following word
    expect(tokenize("HTTPServer")).toEqual(["http", "server"]);
  });

  it("keeps underscores and hyphens, which carry meaning in code", () => {
    expect(tokenize("chat_session devpulse-mcp")).toEqual([
      "chat_session",
      "devpulse-mcp",
    ]);
  });

  it("drops stop words and single characters", () => {
    // "a" and "of" are stop words, "x" is too short to be useful
    expect(tokenize("a list of x files")).toEqual(["list", "files"]);
  });

  it("returns nothing for a query made entirely of stop words", () => {
    expect(tokenize("how is the and or")).toEqual([]);
  });
});

/** Shorthand: one unweighted body field. */
function doc(id: string, text: string): BM25Document {
  return { id, fields: [{ text }] };
}

describe("BM25Index.search", () => {
  it("returns only documents that contain a query term", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([
      doc("a", "the vite dev server hosts the api plugin"),
      doc("b", "pinia stores hold the entries"),
    ]);

    expect(idx.search("vite").map((r) => r.id)).toEqual(["a"]);
  });

  it("sorts by score, highest first", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([
      doc("once", "the cache is written once"),
      doc("twice", "cache the cache so the cache is warm"),
      doc("none", "unrelated text about routing"),
    ]);

    const scores = idx.search("cache").map((r) => r.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(idx.search("cache")[0]?.id).toBe("twice");
  });

  it("ranks a weighted field above an unweighted one", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([
      {
        id: "in-title",
        fields: [
          { text: "indexing claude sessions", weight: 3 },
          { text: "filler text of comparable length here", weight: 1 },
        ],
      },
      {
        id: "in-body",
        fields: [
          { text: "filler title of comparable length", weight: 3 },
          { text: "indexing claude sessions", weight: 1 },
        ],
      },
    ]);

    expect(idx.search("claude")[0]?.id).toBe("in-title");
  });

  it("favours the rarer of two query terms through IDF", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([
      doc("common-only", "session session session"),
      doc("rare-only", "bm25 ranking"),
      doc("filler-1", "session notes"),
      doc("filler-2", "session log"),
      doc("filler-3", "session list"),
    ]);

    // "session" appears in four of five documents, "bm25" in one, so the
    // document holding the rare term must win despite the lower term count.
    expect(idx.search("session bm25")[0]?.id).toBe("rare-only");
  });

  it("respects topK", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments(
      Array.from({ length: 10 }, (_, i) => doc(`d${i}`, "cache entry")),
    );

    expect(idx.search("cache", 3)).toHaveLength(3);
  });

  it("returns nothing for an unknown term or an empty index", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([doc("a", "vite")]);

    expect(idx.search("kubernetes")).toEqual([]);
    expect(idx.search("")).toEqual([]);
    expect(new BM25Index().search("vite")).toEqual([]);
  });
});

describe("BM25Index mutation", () => {
  it("replaces a document instead of double-counting it", () => {
    const idx = new BM25Index();
    idx.add(doc("a", "cache"));
    idx.add(doc("a", "routing"));

    expect(idx.size).toBe(1);
    expect(idx.search("cache")).toEqual([]);
    expect(idx.search("routing").map((r) => r.id)).toEqual(["a"]);
  });

  it("removes a document from the inverted index too", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([doc("a", "cache"), doc("b", "cache")]);
    idx.remove("a");

    expect(idx.size).toBe(1);
    expect(idx.search("cache").map((r) => r.id)).toEqual(["b"]);
  });

  it("starts from empty on every buildFromDocuments", () => {
    const idx = new BM25Index();
    idx.buildFromDocuments([doc("a", "cache")]);
    idx.buildFromDocuments([doc("b", "routing")]);

    expect(idx.size).toBe(1);
    expect(idx.search("cache")).toEqual([]);
  });
});
