/**
 * Vite server plugin — local API endpoints for filesystem & git access.
 * Runs on the Node.js dev server, NOT in the browser.
 * @package @devpulse/chat-mcp v2
 */
import type { Plugin } from "vite";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { getProvider, type ChatSource } from "@devpulse/chat-mcp";
import { cacheRead, cacheWrite, isCacheFresh } from "./cache.js";
import {
  readToken,
  writeToken,
  clearToken,
  readDeltaLinks,
  writeDeltaLinks,
  type TeamsTokenData,
} from "./teams-token.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @github/copilot-sdk is a JS-only package without bundled types
import type { SessionConfig } from "@github/copilot-sdk";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      },
    );
  });
}

/**
 * True when `git log` failed only because the repository has no commits yet.
 *
 * A freshly initialised repo is a perfectly normal state, and since projects
 * are discovered by looking for a .git directory it does get picked up like
 * any other. Without this check the endpoint answers 500 and the project card
 * shows an error instead of simply being empty.
 */
function isEmptyRepoError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("does not have any commits yet") ||
    msg.includes("bad default revision 'HEAD'")
  );
}

// ── Microsoft Teams / Graph API helpers ──────────────────────────────────────

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Strip HTML tags from a Teams message body */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exchange auth code or refresh token for access/refresh tokens. */
async function graphTokenRequest(
  tenantId: string,
  params: Record<string, string>,
): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token request failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>;
}

/** Return a valid access token, refreshing if expired. Throws if unauthenticated. */
async function getValidAccessToken(): Promise<{
  token: string;
  userId: string;
}> {
  const stored = readToken();
  if (!stored) throw new Error("Not authenticated with Microsoft Teams");

  // Refresh 60 seconds before actual expiry to avoid races
  if (new Date(stored.expiresAt).getTime() - 60_000 > Date.now()) {
    return { token: stored.accessToken, userId: stored.userId };
  }

  const tokens = await graphTokenRequest(stored.tenantId, {
    grant_type: "refresh_token",
    refresh_token: stored.refreshToken,
    client_id: stored.clientId,
    scope: "User.Read ChannelMessage.Read.All Chat.Read offline_access",
  });

  const updated: TeamsTokenData = {
    ...stored,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
  writeToken(updated);
  return { token: updated.accessToken, userId: updated.userId };
}

/** GET from Graph API, following @odata.nextLink pages. */
async function graphGetAll<T>(
  accessToken: string,
  startUrl: string,
): Promise<{ items: T[]; deltaLink: string | undefined }> {
  const items: T[] = [];
  let nextUrl: string | undefined = startUrl;
  let deltaLink: string | undefined;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 410) {
      // Delta link expired — signal caller to fall back
      throw Object.assign(new Error("Delta link expired (410)"), {
        code: "DELTA_EXPIRED",
      });
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API error (${res.status}): ${body}`);
    }
    const data = (await res.json()) as {
      value: T[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    items.push(...(data.value ?? []));
    nextUrl = data["@odata.nextLink"];
    if (data["@odata.deltaLink"]) deltaLink = data["@odata.deltaLink"];
  }
  return { items, deltaLink };
}

interface GraphTeam {
  id: string;
  displayName: string;
}

interface GraphChannel {
  id: string;
  displayName: string;
}

interface GraphMessageBody {
  contentType: "html" | "text";
  content: string;
}

interface GraphMessageFrom {
  user?: { id: string; displayName?: string };
}

interface GraphMessage {
  id: string;
  replyToId?: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  deletedDateTime?: string;
  subject?: string;
  body: GraphMessageBody;
  from?: GraphMessageFrom;
  webUrl?: string;
  /** Populated by caller — not in Graph response */
  _teamId?: string;
  _teamName?: string;
  _channelId?: string;
  _channelName?: string;
  _chatId?: string;
  _chatName?: string;
  _kind?: "channel" | "chat";
}

interface GraphChat {
  id: string;
  chatType: "oneOnOne" | "group" | "meeting";
  topic?: string;
  members?: Array<{ displayName?: string; userId?: string }>;
}

/** Build a human-readable name for a chat. */
function chatDisplayName(chat: GraphChat, myUserId: string): string {
  if (chat.topic) return chat.topic;
  if (chat.chatType === "oneOnOne" && chat.members) {
    const other = chat.members.find((m) => m.userId !== myUserId);
    return other?.displayName ?? "1-on-1 Chat";
  }
  if (chat.members && chat.members.length > 0) {
    return chat.members
      .filter((m) => m.userId !== myUserId)
      .map((m) => m.displayName ?? "?")
      .join(", ");
  }
  return "Group Chat";
}

function toKebab(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Check if a directory contains a .git folder */
async function isGitRepo(dirPath: string): Promise<boolean> {
  try {
    const s = await stat(join(dirPath, ".git"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

/** Get git remote URL (if any) */
async function getGitRemote(dirPath: string): Promise<string | undefined> {
  try {
    const out = await exec("git", ["remote", "get-url", "origin"], dirPath);
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Get default branch name */
async function getDefaultBranch(dirPath: string): Promise<string | undefined> {
  try {
    const out = await exec(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      dirPath,
    );
    return out.trim() || undefined;
  } catch {
    return undefined;
  }
}

function sendJson(
  res: import("http").ServerResponse,
  data: unknown,
  status = 200,
) {
  // Serialize BEFORE writeHead so a stringify failure doesn't leave headers
  // half-sent (which would cause a second "headers already sent" throw).
  let body: string;
  try {
    body = JSON.stringify(data);
  } catch {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":"Response serialization failed"}');
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

function sendError(
  res: import("http").ServerResponse,
  message: string,
  status = 400,
) {
  sendJson(res, { error: message }, status);
}

/** Parse `git log --format=%H§§§%an§§§%aI§§§%s --name-status` output into commit objects (with file list). */
function parseGitLog(raw: string, sep: string) {
  type Commit = {
    sha: string;
    author: string;
    date: string;
    message: string;
    files: { status: string; path: string }[];
  };
  const commits: Commit[] = [];
  let cur: Commit | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.includes(sep)) {
      if (cur) commits.push(cur);
      const [sha, author, date, ...msgParts] = trimmed.split(sep);
      cur = { sha, author, date, message: msgParts.join(sep), files: [] };
    } else {
      const m = trimmed.match(/^([AMDRC])\t(.+)$/);
      if (m && cur) cur.files.push({ status: m[1], path: m[2] });
    }
  }
  if (cur) commits.push(cur);
  return commits;
}

// ── Copilot SDK client ────────────────────────────────────────────────────────
// Uses @github/copilot-sdk (same as robomo/agent-studio).
// Auth is handled by the SDK via GITHUB_TOKEN env var or the gh CLI.
// The client is lazily initialised on first use and kept alive for the
// lifetime of the Vite dev-server process.

let copilotClient: CopilotClient | null = null;

async function getCopilotClient(): Promise<CopilotClient> {
  if (copilotClient) return copilotClient;
  // Do NOT pass githubToken — use the gh CLI auth (same as robomo/agent-studio).
  // Passing a raw PAT causes 400 on listModels; the SDK's native auth flow works.
  copilotClient = new CopilotClient({ logLevel: "warning" });
  await copilotClient.start();
  console.log("[copilot-sdk] Client started");
  return copilotClient;
}

export function devPulseApiPlugin(): Plugin {
  return {
    name: "devpulse-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = new URL(req.url ?? "", "http://localhost");

          // ── Discover projects ──────────────────────────────
          if (url.pathname === "/api/discover-projects") {
            try {
              const foldersParam = url.searchParams.get("rootFolders");
              if (!foldersParam)
                return sendError(res, "Missing rootFolders parameter");

              // Server-side cache (TTL 5 min) — project structure rarely changes
              const ck = `discover-projects:${foldersParam}`;
              const cached = cacheRead<unknown[]>(ck);
              if (cached && isCacheFresh(cached, 300)) {
                return sendJson(res, cached.data);
              }

              const rootFolders: { path: string; label: string }[] =
                JSON.parse(foldersParam);
              const projects: {
                id: string;
                name: string;
                path: string;
                gitRemote?: string;
                defaultBranch?: string;
              }[] = [];

              for (const folder of rootFolders) {
                const normalizedPath = normalize(folder.path);
                try {
                  const items = await readdir(normalizedPath, {
                    withFileTypes: true,
                  });
                  for (const item of items) {
                    if (!item.isDirectory() || item.name.startsWith("."))
                      continue;
                    const projectPath = join(normalizedPath, item.name);
                    const hasGit = await isGitRepo(projectPath);
                    if (!hasGit) continue;

                    const [gitRemote, defaultBranch] = await Promise.all([
                      getGitRemote(projectPath),
                      getDefaultBranch(projectPath),
                    ]);

                    projects.push({
                      id: toKebab(item.name),
                      name: item.name,
                      path: projectPath,
                      gitRemote,
                      defaultBranch,
                    });
                  }
                } catch (err) {
                  console.warn(
                    `[DevPulse API] Could not scan folder ${normalizedPath}:`,
                    err,
                  );
                }
              }

              cacheWrite(ck, projects);
              return sendJson(res, projects);
            } catch (err) {
              return sendError(
                res,
                `Discovery failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── Git log (commits) ─────────────────────────────
          if (url.pathname === "/api/git-log") {
            const projectPath = url.searchParams.get("path");
            const since = url.searchParams.get("since"); // ISO timestamp — incremental mode
            const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
            if (!projectPath) return sendError(res, "Missing path parameter");

            try {
              const normalizedPath = normalize(projectPath);
              const sep = "§§§";
              const format = [`%H`, `%an`, `%aI`, `%s`].join(sep);

              // Incremental: only commits after `since` (no server cache for these — git handles it)
              if (since) {
                const out = await exec(
                  "git",
                  [
                    "log",
                    `--after=${since}`,
                    `--format=${format}`,
                    "--no-merges",
                    "--name-status",
                  ],
                  normalizedPath,
                );
                return sendJson(res, parseGitLog(out, sep));
              }

              // Full fetch — use server cache (TTL 5 min)
              const ck = `git-log:${normalizedPath}`;
              const cached = cacheRead<ReturnType<typeof parseGitLog>>(ck);
              if (cached && isCacheFresh(cached, 300)) {
                return sendJson(res, cached.data);
              }

              const out = await exec(
                "git",
                [
                  "log",
                  `--max-count=${limit}`,
                  `--format=${format}`,
                  "--no-merges",
                  "--name-status",
                ],
                normalizedPath,
              );
              const commits = parseGitLog(out, sep);
              cacheWrite(ck, commits);
              return sendJson(res, commits);
            } catch (err) {
              // A repo without commits has no log — that is empty, not broken.
              if (isEmptyRepoError(err)) return sendJson(res, []);
              return sendError(
                res,
                `git log failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── List chat sessions for a workspace path ───────
          if (url.pathname === "/api/chat-sessions") {
            const rawFilter = url.searchParams.get("workspace") ?? undefined;
            // Normalize backslashes → forward slashes so VS Code URI paths match
            const workspaceFilter = rawFilter?.replace(/\\/g, "/");
            const since = url.searchParams.get("since"); // ISO timestamp — incremental mode
            const limit = url.searchParams.get("limit");
            // Which assistant's history to read; omitted means Copilot, so the
            // endpoint keeps answering older clients unchanged.
            const source = (url.searchParams.get("source") ??
              "copilot") as ChatSource;
            const provider = getProvider(source);
            if (!provider) return sendError(res, `Unknown source: ${source}`);
            try {
              // Incremental: get all sessions, filter by lastModified > since
              if (since) {
                const sessions = await provider.listSessions({
                  workspaceFilter,
                  sort: "newest",
                  includeIndexableText: true,
                });
                return sendJson(
                  res,
                  sessions.filter((s) => s.lastModified > since),
                );
              }

              // Full fetch — server cache (TTL 2 min), chat files change frequently.
              // Key carries source and limit: both change the payload, and v3
              // marks the added `source` field on every session.
              const ck = `chat-sessions-v3:${source}:${limit ?? ""}:${workspaceFilter ?? ""}`;
              const cached = cacheRead<unknown[]>(ck);
              if (cached && isCacheFresh(cached, 120)) {
                return sendJson(res, cached.data);
              }

              const sessions = await provider.listSessions({
                workspaceFilter,
                sort: "newest",
                limit: limit ? parseInt(limit, 10) : undefined,
                includeIndexableText: true,
              });
              cacheWrite(ck, sessions);
              return sendJson(res, sessions);
            } catch (err) {
              return sendError(
                res,
                `chat-sessions failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── Read a single chat session by ID ──────────────
          if (url.pathname === "/api/chat-session") {
            const sessionId = url.searchParams.get("id");
            if (!sessionId) return sendError(res, "Missing id parameter");
            const source = (url.searchParams.get("source") ??
              "copilot") as ChatSource;
            const provider = getProvider(source);
            if (!provider) return sendError(res, `Unknown source: ${source}`);
            try {
              const session = await provider.readSession(sessionId);
              if (!session)
                return sendError(res, `Session not found: ${sessionId}`, 404);
              return sendJson(res, session);
            } catch (err) {
              return sendError(
                res,
                `chat-session failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── Copilot SDK proxy ────────────────────────────────────────────────
          // Accepts OpenAI-format POST (model, messages[]) and routes through
          // @github/copilot-sdk — same auth path as robomo/agent-studio.
          // Token comes from GITHUB_TOKEN env var (or gh CLI); no PAT needed
          // in the browser request.
          if (
            url.pathname === "/api/copilot-proxy/chat/completions" &&
            req.method === "POST"
          ) {
            try {
              const rawBody = await new Promise<string>((resolve, reject) => {
                let data = "";
                req.on("data", (chunk: Buffer) => {
                  data += chunk.toString();
                });
                req.on("end", () => resolve(data));
                req.on("error", reject);
              });

              const { model, messages } = JSON.parse(rawBody) as {
                model: string;
                messages: Array<{ role: string; content: string }>;
              };

              // Split messages into system prompt + user prompt
              const systemMsg = messages
                .filter((m) => m.role === "system")
                .map((m) => m.content)
                .join("\n\n");
              const userMsg = messages
                .filter((m) => m.role === "user")
                .map((m) => m.content)
                .join("\n\n");

              const client = await getCopilotClient();

              // Note: do not set `model` in sessionConfig unless STUDIO_MODEL
              // is configured — the SDK validates the model ID via listModels()
              // and will throw 400 for IDs it doesn't recognise at that layer.
              // Let the SDK use its default (claude-sonnet-4.6) unless overridden.
              const studioModel = process.env.STUDIO_MODEL;
              const sessionConfig: SessionConfig = {
                clientName: "devpulse-ai",
                streaming: true,
                onPermissionRequest: approveAll,
              };
              if (studioModel) {
                sessionConfig.model = studioModel;
              }
              if (systemMsg) {
                sessionConfig.systemMessage = {
                  mode: "replace",
                  content: systemMsg,
                };
              }

              const session = await client.createSession(sessionConfig);
              console.log(
                `[copilot-sdk] Session created, model=${studioModel ?? "default"}, sending prompt...`,
              );

              const result = await session.sendAndWait({ prompt: userMsg });
              const content: string = result?.data?.content ?? "";
              console.log(
                `[copilot-sdk] Response received (${content.length} chars)`,
              );

              try {
                await session.destroy();
              } catch {
                /* ignore */
              }

              // Return in OpenAI-compatible format so chatComplete() works unchanged
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(
                JSON.stringify({
                  choices: [{ message: { role: "assistant", content } }],
                  model,
                  usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                  },
                }),
              );
              return;
            } catch (err) {
              return sendError(
                res,
                `Copilot SDK proxy failed: ${(err as Error).message}`,
                502,
              );
            }
          }

          // ── Server-side search/ask proxy ─────────────────
          // Accepts POST /api/search-ask with JSON body:
          //   { prompt: string, token: string, model?: string, maxTokens?: number }
          // The token is provided by the client and forwarded to GitHub Models.
          // This endpoint exists so MCP tools and server-side agents can call it.
          if (url.pathname === "/api/search-ask" && req.method === "POST") {
            try {
              const body = await new Promise<string>((resolve, reject) => {
                let data = "";
                req.on("data", (chunk: Buffer) => {
                  data += chunk.toString();
                });
                req.on("end", () => resolve(data));
                req.on("error", reject);
              });

              const { prompt, token, model, maxTokens, context } = JSON.parse(
                body,
              ) as {
                prompt: string;
                token: string;
                model?: string;
                maxTokens?: number;
                context?: string;
              };

              if (!prompt) return sendError(res, "Missing prompt");
              if (!token) return sendError(res, "Missing token");
              if (!/^(ghp_|github_pat_|ghs_)/.test(token)) {
                return sendError(res, "Invalid GitHub token format", 401);
              }

              const GITHUB_MODELS_ENDPOINT =
                "https://models.inference.ai.azure.com";
              const response = await fetch(
                `${GITHUB_MODELS_ENDPOINT}/chat/completions`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({
                    model: model ?? "gpt-4o-mini",
                    messages: [
                      {
                        role: "system",
                        content: `Je bent een behulpzame assistent die een ontwikkelaar helpt inzicht te krijgen in hun projecten op basis van git commits en Copilot chat sessies.
Geef altijd een concreet, gestructureerd antwoord in het Nederlands.
Verwijs specifiek naar projectnamen, data en details uit de context.
Als je iets niet kunt beantwoorden op basis van de context, zeg dat dan eerlijk.

Huidige datum: ${new Date().toLocaleDateString("nl-NL")}`,
                      },
                      ...(context
                        ? [
                            {
                              role: "user" as const,
                              content: `Context:\n${context}\n\nVraag: ${prompt}`,
                            },
                          ]
                        : [
                            {
                              role: "user" as const,
                              content: prompt,
                            },
                          ]),
                    ],
                    temperature: 0.3,
                    max_tokens: maxTokens ?? 2048,
                  }),
                },
              );

              if (!response.ok) {
                const errBody = await response.text();
                return sendError(
                  res,
                  `GitHub Models error (${response.status}): ${errBody}`,
                  502,
                );
              }

              const data = (await response.json()) as {
                choices: Array<{ message: { content: string } }>;
                model: string;
                usage: {
                  prompt_tokens: number;
                  completion_tokens: number;
                  total_tokens: number;
                };
              };

              return sendJson(res, {
                answer: data.choices[0]?.message?.content ?? "",
                model: data.model,
                usage: data.usage,
              });
            } catch (err) {
              return sendError(
                res,
                `search-ask failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── Teams (Power Automate file) ───────────────────────────────────
          // Reads a local JSON file exported by a Power Automate flow via OneDrive.
          if (url.pathname === "/api/teams-file") {
            const filePath = url.searchParams.get("path");
            if (!filePath) return sendError(res, "Missing path parameter");
            try {
              const { readFileSync } = await import("node:fs");
              const { normalize: normPath } = await import("node:path");
              const raw = readFileSync(normPath(filePath), "utf8");
              const parsed = JSON.parse(raw) as {
                exportedAt?: string;
                messages?: unknown[];
              };
              return sendJson(res, {
                exportedAt: parsed.exportedAt ?? null,
                messages: parsed.messages ?? [],
              });
            } catch (err) {
              return sendError(
                res,
                `teams-file read failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── Teams: check auth status ──────────────────────────────────────
          if (url.pathname === "/api/teams/auth/status") {
            const stored = readToken();
            if (!stored) return sendJson(res, { authenticated: false });
            return sendJson(res, {
              authenticated: true,
              userEmail: stored.userEmail,
              displayName: stored.displayName,
              expiresAt: stored.expiresAt,
            });
          }

          // ── Teams: exchange authorization code for tokens ─────────────────
          if (
            url.pathname === "/api/teams/auth/token" &&
            req.method === "POST"
          ) {
            try {
              const rawBody = await new Promise<string>((resolve, reject) => {
                let data = "";
                req.on("data", (chunk: Buffer) => {
                  data += chunk.toString();
                });
                req.on("end", () => resolve(data));
                req.on("error", reject);
              });
              const { code, codeVerifier, redirectUri, clientId, tenantId } =
                JSON.parse(rawBody) as {
                  code: string;
                  codeVerifier: string;
                  redirectUri: string;
                  clientId: string;
                  tenantId: string;
                };

              if (
                !code ||
                !codeVerifier ||
                !redirectUri ||
                !clientId ||
                !tenantId
              ) {
                return sendError(res, "Missing required parameters");
              }

              const tokens = await graphTokenRequest(tenantId, {
                grant_type: "authorization_code",
                code,
                client_id: clientId,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
                scope:
                  "User.Read ChannelMessage.Read.All Chat.Read offline_access",
              });

              // Fetch the user profile to store alongside the token
              const meRes = await fetch(`${GRAPH_BASE}/me`, {
                headers: { Authorization: `Bearer ${tokens.access_token}` },
              });
              if (!meRes.ok)
                throw new Error(`GET /me failed (${meRes.status})`);
              const me = (await meRes.json()) as {
                id: string;
                mail?: string;
                userPrincipalName?: string;
                displayName?: string;
              };

              writeToken({
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt: new Date(
                  Date.now() + tokens.expires_in * 1000,
                ).toISOString(),
                userId: me.id,
                userEmail: me.mail ?? me.userPrincipalName ?? "",
                displayName: me.displayName ?? "",
                clientId,
                tenantId,
              });

              return sendJson(res, {
                success: true,
                userEmail: me.mail ?? me.userPrincipalName ?? "",
                displayName: me.displayName ?? "",
              });
            } catch (err) {
              return sendError(
                res,
                `Teams auth failed: ${(err as Error).message}`,
                500,
              );
            }
          }

          // ── Teams: revoke stored token ────────────────────────────────────
          if (
            url.pathname === "/api/teams/auth/revoke" &&
            req.method === "POST"
          ) {
            clearToken();
            return sendJson(res, { success: true });
          }

          // ── Teams: fetch messages (channel + chat) ────────────────────────
          if (url.pathname === "/api/teams/messages") {
            try {
              const since = url.searchParams.get("since") ?? undefined;

              const { token, userId } = await getValidAccessToken();
              const delta = readDeltaLinks();

              type TeamsOutMessage = {
                id: string;
                kind: "channel" | "chat";
                body: string;
                createdDateTime: string;
                lastModifiedDateTime: string;
                teamId?: string;
                teamName?: string;
                channelId?: string;
                channelName?: string;
                chatId?: string;
                chatName?: string;
                replyCount: number;
                webUrl?: string;
              };

              const results: TeamsOutMessage[] = [];

              // ── Channel messages ──────────────────────────────────────────
              const { items: teams } = await graphGetAll<GraphTeam>(
                token,
                `${GRAPH_BASE}/me/joinedTeams`,
              );

              for (const team of teams) {
                const { items: channels } = await graphGetAll<GraphChannel>(
                  token,
                  `${GRAPH_BASE}/teams/${team.id}/channels`,
                );

                for (const channel of channels) {
                  const deltaKey = `${team.id}/${channel.id}`;
                  const storedDelta = delta.channels[deltaKey];
                  let startUrl: string;

                  if (storedDelta?.deltaLink) {
                    startUrl = storedDelta.deltaLink;
                  } else if (since) {
                    startUrl = `${GRAPH_BASE}/teams/${team.id}/channels/${channel.id}/messages/delta?$filter=lastModifiedDateTime%20ge%20'${encodeURIComponent(since)}'&$top=50`;
                  } else {
                    startUrl = `${GRAPH_BASE}/teams/${team.id}/channels/${channel.id}/messages/delta?$top=50`;
                  }

                  let items: GraphMessage[];
                  let newDeltaLink: string | undefined;

                  try {
                    ({ items, deltaLink: newDeltaLink } =
                      await graphGetAll<GraphMessage>(token, startUrl));
                  } catch (e) {
                    const err = e as Error & { code?: string };
                    if (err.code === "DELTA_EXPIRED") {
                      // Fall back to since-filter full fetch
                      const fallbackUrl = since
                        ? `${GRAPH_BASE}/teams/${team.id}/channels/${channel.id}/messages/delta?$filter=lastModifiedDateTime%20ge%20'${encodeURIComponent(since)}'&$top=50`
                        : `${GRAPH_BASE}/teams/${team.id}/channels/${channel.id}/messages/delta?$top=50`;
                      ({ items, deltaLink: newDeltaLink } =
                        await graphGetAll<GraphMessage>(token, fallbackUrl));
                    } else {
                      console.warn(
                        `[Teams] channel messages failed for ${team.displayName}/${channel.displayName}:`,
                        e,
                      );
                      continue;
                    }
                  }

                  if (newDeltaLink) {
                    delta.channels[deltaKey] = {
                      deltaLink: newDeltaLink,
                      updatedAt: new Date().toISOString(),
                    };
                  }

                  // Filter: top-level messages (replyToId absent) from me that are not deleted
                  const myTopLevel = items.filter(
                    (m) =>
                      !m.replyToId &&
                      !m.deletedDateTime &&
                      m.from?.user?.id === userId,
                  );

                  // Also collect replies in this batch that target my messages
                  const myTopLevelIds = new Set(myTopLevel.map((m) => m.id));
                  const replies = items.filter(
                    (m) =>
                      m.replyToId &&
                      myTopLevelIds.has(m.replyToId) &&
                      !m.deletedDateTime,
                  );
                  const replyCountMap = new Map<string, number>();
                  for (const r of replies) {
                    replyCountMap.set(
                      r.replyToId!,
                      (replyCountMap.get(r.replyToId!) ?? 0) + 1,
                    );
                  }

                  for (const m of myTopLevel) {
                    const bodyText =
                      m.body.contentType === "html"
                        ? stripHtml(m.body.content)
                        : m.body.content;

                    results.push({
                      id: `teams-ch-${m.id}`,
                      kind: "channel",
                      body: bodyText.slice(0, 500),
                      createdDateTime: m.createdDateTime,
                      lastModifiedDateTime: m.lastModifiedDateTime,
                      teamId: team.id,
                      teamName: team.displayName,
                      channelId: channel.id,
                      channelName: channel.displayName,
                      replyCount: replyCountMap.get(m.id) ?? 0,
                      webUrl: m.webUrl,
                    });
                  }
                }
              }

              // ── Chat messages ─────────────────────────────────────────────
              const { items: chats } = await graphGetAll<GraphChat>(
                token,
                `${GRAPH_BASE}/me/chats?$expand=members`,
              );

              for (const chat of chats) {
                if (chat.chatType === "meeting") continue; // skip meeting transcripts
                const chatName = chatDisplayName(chat, userId);
                const storedDelta = delta.chats[chat.id];
                let startUrl: string;

                if (storedDelta?.deltaLink) {
                  startUrl = storedDelta.deltaLink;
                } else if (since) {
                  startUrl = `${GRAPH_BASE}/me/chats/${chat.id}/messages/delta?$filter=lastModifiedDateTime%20ge%20'${encodeURIComponent(since)}'&$top=50`;
                } else {
                  startUrl = `${GRAPH_BASE}/me/chats/${chat.id}/messages/delta?$top=50`;
                }

                let chatMsgs: GraphMessage[];
                let newChatDeltaLink: string | undefined;

                try {
                  ({ items: chatMsgs, deltaLink: newChatDeltaLink } =
                    await graphGetAll<GraphMessage>(token, startUrl));
                } catch (e) {
                  const err = e as Error & { code?: string };
                  if (err.code === "DELTA_EXPIRED") {
                    const fallbackUrl = since
                      ? `${GRAPH_BASE}/me/chats/${chat.id}/messages/delta?$filter=lastModifiedDateTime%20ge%20'${encodeURIComponent(since)}'&$top=50`
                      : `${GRAPH_BASE}/me/chats/${chat.id}/messages/delta?$top=50`;
                    ({ items: chatMsgs, deltaLink: newChatDeltaLink } =
                      await graphGetAll<GraphMessage>(token, fallbackUrl));
                  } else {
                    console.warn(
                      `[Teams] chat messages failed for ${chatName}:`,
                      e,
                    );
                    continue;
                  }
                }

                if (newChatDeltaLink) {
                  delta.chats[chat.id] = {
                    deltaLink: newChatDeltaLink,
                    updatedAt: new Date().toISOString(),
                  };
                }

                const myChatMsgs = chatMsgs.filter(
                  (m) =>
                    !m.deletedDateTime &&
                    m.from?.user?.id === userId &&
                    m.body.content.trim() !== "",
                );

                for (const m of myChatMsgs) {
                  const bodyText =
                    m.body.contentType === "html"
                      ? stripHtml(m.body.content)
                      : m.body.content;

                  if (!bodyText.trim()) continue; // skip system/empty messages

                  results.push({
                    id: `teams-chat-${m.id}`,
                    kind: "chat",
                    body: bodyText.slice(0, 500),
                    createdDateTime: m.createdDateTime,
                    lastModifiedDateTime: m.lastModifiedDateTime,
                    chatId: chat.id,
                    chatName,
                    replyCount: 0,
                    webUrl: m.webUrl,
                  });
                }
              }

              // Persist updated delta links
              writeDeltaLinks(delta);

              return sendJson(res, results);
            } catch (err) {
              const e = err as Error & { message: string };
              if (e.message?.includes("Not authenticated")) {
                return sendError(
                  res,
                  "Not authenticated with Microsoft Teams",
                  401,
                );
              }
              return sendError(res, `Teams messages failed: ${e.message}`, 500);
            }
          }

          next();
        } catch (err) {
          console.error("[DevPulse API] Unhandled middleware error:", err);
          if (!res.headersSent) {
            sendError(
              res,
              `Internal server error: ${(err as Error).message ?? String(err)}`,
              500,
            );
          }
        }
      });
    },
  };
}
