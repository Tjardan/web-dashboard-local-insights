#!/usr/bin/env node
/**
 * DevPulse MCP Server (stdio transport).
 *
 * Exposes search and AI tools to VS Code Copilot via the Model Context Protocol.
 *
 * Add to VS Code settings (mcp.json or .vscode/mcp.json):
 * {
 *   "servers": {
 *     "devpulse": {
 *       "type": "stdio",
 *       "command": "node",
 *       "args": ["${workspaceFolder}/packages/chat-mcp/dist/mcp-server.js"]
 *     }
 *   }
 * }
 *
 * Tools exposed:
 *   devpulse_search         — BM25 lexical search over chats (with optional full content)
 *   devpulse_index_status   — Index statistics
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP spec).
 */

import { searchBM25, getIndexStatus } from "./search-tools.js";

// ─── Token estimation ──────────────────────────────────────────────────────────

/**
 * Rough token estimate: 1 token ≈ 4 characters (works well for mixed Dutch/English/code).
 * Not exact — use for context-window budgeting only.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── JSON-RPC types ────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function respond(id: string | number | null, result: unknown): void {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(response) + "\n");
}

function respondError(
  id: string | number | null,
  code: number,
  message: string,
): void {
  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
  process.stdout.write(JSON.stringify(response) + "\n");
}

// ─── MCP capability definitions ───────────────────────────────────────────────

const SERVER_INFO = {
  name: "devpulse",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "devpulse_search",
    description:
      "USE THIS TOOL to search through VS Code Copilot chat history. BM25+ lexical search — no API key or token required. Returns the top matching chat sessions with title, date, workspace, relevance score and optional full session content. Use this whenever the user asks about past chats, previous bugs, decisions, solutions or anything from chat history. For analysis or summarisation, set includeContent=true so the calling LLM can work directly with session content — no separate AI call needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (Dutch or English)",
        },
        workspaceFilter: {
          type: "string",
          description: "Filter by workspace name or path (optional)",
        },
        topK: {
          type: "number",
          description: "Maximum results to return (default 6)",
        },
        since: {
          type: "string",
          description:
            "ISO-8601 date — only include sessions modified after this date (optional)",
        },
        includeContent: {
          type: "boolean",
          description:
            "When true, include the session content (recap-delta indexable text) in each result. Use this when you need to analyse or summarise what was discussed. The calling LLM handles the analysis — no token required.",
        },
        contentMaxChars: {
          type: "number",
          description:
            "Max characters of content to include per session when includeContent=true (default 8000)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "devpulse_index_status",
    description:
      "Returns search index statistics: document count, last indexed timestamp, and whether the index is stale.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ─── Request routing ───────────────────────────────────────────────────────────

async function handleRequest(req: JsonRpcRequest): Promise<void> {
  const { id, method, params } = req;

  switch (method) {
    case "initialize": {
      respond(id, {
        protocolVersion: "2024-11-05",
        serverInfo: SERVER_INFO,
        capabilities: { tools: {} },
      });
      return;
    }

    case "notifications/initialized": {
      // No response needed for notifications
      return;
    }

    case "tools/list": {
      respond(id, { tools: TOOLS });
      return;
    }

    case "tools/call": {
      const { name, arguments: args } = params as {
        name: string;
        arguments: Record<string, unknown>;
      };

      try {
        switch (name) {
          case "devpulse_search": {
            const results = await searchBM25({
              query: String(args["query"] ?? ""),
              workspaceFilter: args["workspaceFilter"] as string | undefined,
              topK: args["topK"] as number | undefined,
              since: args["since"] as string | undefined,
              includeContent: args["includeContent"] as boolean | undefined,
              contentMaxChars: args["contentMaxChars"] as number | undefined,
            });
            const resultsJson = JSON.stringify(results, null, 2);
            const searchOutput = JSON.stringify(
              {
                _meta: {
                  resultCount: results.length,
                  chars: resultsJson.length,
                  tokenEstimate: estimateTokens(resultsJson),
                },
                results,
              },
              null,
              2,
            );
            respond(id, {
              content: [{ type: "text", text: searchOutput }],
            });
            return;
          }

          case "devpulse_index_status": {
            const status = getIndexStatus();
            const statusJson = JSON.stringify(status, null, 2);
            const statusOutput = JSON.stringify(
              {
                _meta: {
                  chars: statusJson.length,
                  tokenEstimate: estimateTokens(statusJson),
                },
                ...status,
              },
              null,
              2,
            );
            respond(id, {
              content: [{ type: "text", text: statusOutput }],
            });
            return;
          }

          default:
            respondError(id, -32601, `Unknown tool: ${name}`);
        }
      } catch (err) {
        respondError(
          id,
          -32000,
          err instanceof Error ? err.message : String(err),
        );
      }
      return;
    }

    default:
      respondError(id, -32601, `Method not found: ${method}`);
  }
}

// ─── stdio transport ───────────────────────────────────────────────────────────

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      void handleRequest(req);
    } catch {
      respondError(null, -32700, "Parse error");
    }
  }
});

process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
