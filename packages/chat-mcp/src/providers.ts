/**
 * Registry of chat sources.
 *
 * Adding a third assistant means writing a SessionProvider and listing it here;
 * nothing else in the package needs to know it exists.
 */

import type { ChatSource, SessionProvider } from "./types.js";
import { copilotProvider } from "./storage.js";
import { claudeProvider } from "./claude-storage.js";

export const PROVIDERS: readonly SessionProvider[] = [
  copilotProvider,
  claudeProvider,
];

export function getProvider(source: ChatSource): SessionProvider | undefined {
  return PROVIDERS.find((p) => p.source === source);
}

/**
 * Resolve a source selector to the providers to query.
 * "all" (or nothing) means every source that has readable sessions here, so a
 * machine without Claude Code installed simply returns Copilot results.
 */
export async function resolveProviders(
  source?: ChatSource | "all",
): Promise<SessionProvider[]> {
  if (source && source !== "all") {
    const p = getProvider(source);
    return p ? [p] : [];
  }
  const available = await Promise.all(
    PROVIDERS.map(async (p) => ((await p.isAvailable()) ? p : null)),
  );
  return available.filter((p): p is SessionProvider => p !== null);
}
