function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns HTML string with occurrences of each query word wrapped in
 * <mark class="hl">. Input text is HTML-escaped before matching to prevent
 * XSS through highlight injection.
 */
export function highlightText(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text);
  const words = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    // Escape HTML first so the regex operates on the same string as the output
    .map((w) => escapeRegex(escapeHtml(w)));
  if (words.length === 0) return escapeHtml(text);
  const pattern = new RegExp(`(${words.join("|")})`, "gi");
  return escapeHtml(text).replace(pattern, '<mark class="hl">$1</mark>');
}

/**
 * Extracts a snippet of surrounding context from the first candidate text
 * that contains a query word. Returns an HTML string with <mark class="hl">
 * wrapping the match, or null if no match is found in any candidate.
 *
 * @param candidates  Ordered list of { text, prefix? }. First match wins.
 *                    Optional `prefix` (e.g. "Bestand") is prepended as a label.
 * @param query       Space-separated search query words.
 * @param windowChars Characters of context to show on each side of the match.
 */
export function extractSnippet(
  candidates: Array<{ text: string; prefix?: string }>,
  query: string,
  windowChars = 90,
): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const pattern = new RegExp(`(${words.map(escapeRegex).join("|")})`, "i");

  for (const { text, prefix } of candidates) {
    if (!text) continue;
    const m = pattern.exec(text);
    if (!m) continue;

    const half = Math.floor(windowChars / 2);
    const rawStart = Math.max(0, m.index - half);
    const rawEnd = Math.min(text.length, m.index + m[0].length + half);
    const slice =
      (rawStart > 0 ? "…" : "") +
      text.slice(rawStart, rawEnd) +
      (rawEnd < text.length ? "…" : "");

    const highlighted = highlightText(slice, query);
    return prefix
      ? `<span class="snippet-prefix">${escapeHtml(prefix)}</span> ${highlighted}`
      : highlighted;
  }
  return null;
}
