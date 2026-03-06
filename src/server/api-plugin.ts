/**
 * Vite server plugin — local API endpoints for filesystem & git access.
 * Runs on the Node.js dev server, NOT in the browser.
 */
import type { Plugin } from "vite";
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, normalize } from "node:path";
import { listSessions, readSession } from "@devpulse/chat-mcp";
import { cacheRead, cacheWrite, isCacheFresh } from "./cache.js";

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
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
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

export function devPulseApiPlugin(): Plugin {
  return {
    name: "devpulse-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
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
          try {
            // Incremental: get all sessions, filter by lastModified > since
            if (since) {
              const sessions = await listSessions({
                workspaceFilter,
                sort: "newest",
              });
              return sendJson(
                res,
                sessions.filter((s) => s.lastModified > since),
              );
            }

            // Full fetch — server cache (TTL 2 min), chat files change frequently
            const ck = `chat-sessions:${workspaceFilter ?? ""}`;
            const cached = cacheRead<unknown[]>(ck);
            if (cached && isCacheFresh(cached, 120)) {
              return sendJson(res, cached.data);
            }

            const sessions = await listSessions({
              workspaceFilter,
              sort: "newest",
              limit: limit ? parseInt(limit, 10) : undefined,
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
          try {
            const session = await readSession(sessionId);
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

        next();
      });
    },
  };
}
