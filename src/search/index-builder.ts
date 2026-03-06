/**
 * Search index builder — converts InsightEntry[] to BM25 + vector documents.
 *
 * Field weighting:
 *   commit:  title (message)  ×3 | author ×1  | file paths ×1
 *   chat:    title            ×3 | description ×2
 *
 * The text passed to the vector store is a richer natural-language
 * representation (title + description + key metadata), suitable for
 * semantic embedding.
 */

import type { InsightEntry } from "@/types";
import type { BM25Document } from "./bm25";
import type { VectorDocument } from "./vector-store";
import { contentHash } from "./vector-store";

// ─── BM25 document construction ───────────────────────────────────────────────

export function entryToBM25Doc(entry: InsightEntry): BM25Document {
  const { meta, payload } = entry;

  if (meta.source === "commit") {
    const p = payload as {
      author?: string;
      files?: Array<{ path: string }>;
    } | null;
    return {
      id: entry.id,
      fields: [
        { text: meta.title, weight: 3 },
        { text: meta.description ?? "", weight: 1 },
        { text: p?.author ?? "", weight: 1 },
        { text: (p?.files ?? []).map((f) => f.path).join(" "), weight: 1 },
        { text: entry.projectId.replace(/-/g, " "), weight: 2 },
      ],
    };
  }

  if (meta.source === "chat") {
    return {
      id: entry.id,
      fields: [
        { text: meta.title, weight: 3 },
        { text: meta.description ?? "", weight: 2 },
        { text: entry.projectId.replace(/-/g, " "), weight: 2 },
      ],
    };
  }

  // Generic fallback
  return {
    id: entry.id,
    fields: [
      { text: meta.title, weight: 2 },
      { text: meta.description ?? "", weight: 1 },
      { text: entry.projectId.replace(/-/g, " "), weight: 1 },
    ],
  };
}

// ─── Vector document construction ────────────────────────────────────────────

export function entryToVectorDoc(entry: InsightEntry): VectorDocument {
  const { meta, payload } = entry;

  let text: string;

  if (meta.source === "commit") {
    const p = payload as {
      author?: string;
      files?: Array<{ path: string }>;
    } | null;
    const fileSummary = (p?.files ?? [])
      .slice(0, 20)
      .map((f) => f.path)
      .join(", ");
    text = [
      `Project: ${entry.projectId}`,
      `Type: git commit`,
      `Message: ${meta.title}`,
      meta.description ? `Author: ${meta.description}` : "",
      fileSummary ? `Files changed: ${fileSummary}` : "",
      `Date: ${meta.timestamp}`,
    ]
      .filter(Boolean)
      .join("\n");
  } else if (meta.source === "chat") {
    text = [
      `Project: ${entry.projectId}`,
      `Type: Copilot chat session`,
      `Title: ${meta.title}`,
      meta.description ? `Summary: ${meta.description}` : "",
      `Date: ${meta.timestamp}`,
    ]
      .filter(Boolean)
      .join("\n");
  } else {
    text = [
      `Project: ${entry.projectId}`,
      `Type: ${meta.source}`,
      `Title: ${meta.title}`,
      meta.description ?? "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return {
    id: entry.id,
    text,
    hash: contentHash(text),
  };
}

// ─── Batch conversion ─────────────────────────────────────────────────────────

export function entriesToBM25Docs(entries: InsightEntry[]): BM25Document[] {
  return entries.map(entryToBM25Doc);
}

export function entriesToVectorDocs(entries: InsightEntry[]): VectorDocument[] {
  return entries.map(entryToVectorDoc);
}
