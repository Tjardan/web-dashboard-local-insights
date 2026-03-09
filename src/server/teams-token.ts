/**
 * Server-side storage for Microsoft Teams OAuth tokens and Graph API delta links.
 * Files are kept in .devpulse-cache/ — accessible only on the Node.js side (Vite dev server).
 */
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const CACHE_DIR = resolve(process.cwd(), ".devpulse-cache");
const TOKEN_FILE = join(CACHE_DIR, "teams-token.json");
const DELTA_FILE = join(CACHE_DIR, "teams-delta.json");

export interface TeamsTokenData {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 */
  expiresAt: string;
  userId: string;
  userEmail: string;
  displayName: string;
  clientId: string;
  tenantId: string;
}

export interface ChannelDelta {
  deltaLink: string;
  updatedAt: string;
}

export interface ChatDelta {
  deltaLink: string;
  updatedAt: string;
}

export interface DeltaLinks {
  /** Keyed by "{teamId}/{channelId}" */
  channels: Record<string, ChannelDelta>;
  /** Keyed by chatId */
  chats: Record<string, ChatDelta>;
}

function ensureCacheDir(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
}

export function readToken(): TeamsTokenData | null {
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf8")) as TeamsTokenData;
  } catch {
    return null;
  }
}

export function writeToken(token: TeamsTokenData): void {
  ensureCacheDir();
  writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
}

export function clearToken(): void {
  try {
    unlinkSync(TOKEN_FILE);
  } catch {
    /* already gone */
  }
  try {
    unlinkSync(DELTA_FILE);
  } catch {
    /* already gone */
  }
}

export function readDeltaLinks(): DeltaLinks {
  try {
    return JSON.parse(readFileSync(DELTA_FILE, "utf8")) as DeltaLinks;
  } catch {
    return { channels: {}, chats: {} };
  }
}

export function writeDeltaLinks(delta: DeltaLinks): void {
  ensureCacheDir();
  writeFileSync(DELTA_FILE, JSON.stringify(delta, null, 2));
}
