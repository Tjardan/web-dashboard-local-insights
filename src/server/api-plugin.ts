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

/** Parse `git log --format=%H§§§%an§§§%aI§§§%s` output into commit objects. */
function parseGitLog(raw: string, sep: string) {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, author, date, ...msgParts] = line.split(sep);
      return { sha, author, date, message: msgParts.join(sep) };
    });
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
                ["log", `--after=${since}`, `--format=${format}`, "--no-merges"],
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
              ["log", `--max-count=${limit}`, `--format=${format}`, "--no-merges"],
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

        // ── Git file changes (recent) ─────────────────────
        if (url.pathname === "/api/git-file-changes") {
          const projectPath = url.searchParams.get("path");
          const since = url.searchParams.get("since"); // ISO timestamp — incremental mode
          const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
          if (!projectPath) return sendError(res, "Missing path parameter");

          try {
            const normalizedPath = normalize(projectPath);
            const sep = "§§§";
            const format = [`%H`, `%aI`, `%s`].join(sep);

            interface FileChange {
              id: string;
              commitSha: string;
              date: string;
              status: string;
              filePath: string;
              commitMessage: string;
            }

            function parseFileChanges(out: string): FileChange[] {
              const changes: FileChange[] = [];
              let currentSha = "";
              let currentDate = "";
              let currentMessage = "";

              for (const line of out.split("\n")) {
                if (!line.trim()) continue;
                if (line.includes(sep)) {
                  const parts = line.split(sep);
                  currentSha = parts[0];
                  currentDate = parts[1];
                  currentMessage = parts.slice(2).join(sep);
                  continue;
                }
                const match = line.match(/^([AMDRC])\t(.+)$/);
                if (match && currentSha) {
                  changes.push({
                    id: `${currentSha}-${match[2]}`,
                    commitSha: currentSha,
                    date: currentDate,
                    status: match[1],
                    filePath: match[2],
                    commitMessage: currentMessage,
                  });
                }
              }
              return changes;
            }

            // Incremental: only changes after `since`
            if (since) {
              const out = await exec(
                "git",
                ["log", `--after=${since}`, `--format=${format}`, "--name-status"],
                normalizedPath,
              );
              return sendJson(res, parseFileChanges(out));
            }

            // Full fetch — use server cache (TTL 5 min)
            const ck = `git-file-changes:${normalizedPath}`;
            const cached = cacheRead<FileChange[]>(ck);
            if (cached && isCacheFresh(cached, 300)) {
              return sendJson(res, cached.data);
            }

            const out = await exec(
              "git",
              ["log", `--max-count=${limit}`, `--format=${format}`, "--name-status"],
              normalizedPath,
            );
            const changes = parseFileChanges(out);
            cacheWrite(ck, changes);
            return sendJson(res, changes);
          } catch (err) {
            return sendError(
              res,
              `git file-changes failed: ${(err as Error).message}`,
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
              const sessions = await listSessions({ workspaceFilter, sort: "newest" });
              return sendJson(res, sessions.filter((s) => s.lastModified > since));
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

        next();
      });
    },
  };
}
