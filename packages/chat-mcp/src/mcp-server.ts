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
 *   devpulse_search         — BM25 lexical search over chats
 *   devpulse_ask            — RAG + GitHub Models AI answer
 *   devpulse_index_status   — Index statistics
 *
 * Protocol: JSON-RPC 2.0 over stdin/stdout (MCP spec).
 */

import { searchBM25, searchAsk, getIndexStatus } from "./search-tools.js";

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
      "BM25+ lexical search over VS Code Copilot chat sessions. Fast, no API key required. Returns top-K matching sessions with score.",
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
          description: "Maximum results to return (default 10)",
        },
        since: {
          type: "string",
          description:
            "ISO-8601 date — only include sessions modified after this date (optional)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "devpulse_ask",
    description:
      "RAG-based AI Q&A over Copilot chat sessions. Retrieves relevant sessions via BM25, then generates a structured answer using GitHub Models (gpt-4o-mini). Requires a GitHub Personal Access Token.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Natural language question about your chats/commits (Dutch or English)",
        },
        githubToken: {
          type: "string",
          description: "GitHub Personal Access Token (ghp_ or github_pat_)",
        },
        workspaceFilter: {
          type: "string",
          description: "Filter context by workspace name or path (optional)",
        },
        topK: {
          type: "number",
          description: "Number of sessions to use as context (default 12)",
        },
        model: {
          type: "string",
          description: "GitHub Models model ID (default: gpt-4o-mini)",
        },
      },
      required: ["prompt", "githubToken"],
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
            });
            respond(id, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(results, null, 2),
                },
              ],
            });
            return;
          }

          case "devpulse_ask": {
            const result = await searchAsk({
              prompt: String(args["prompt"] ?? ""),
              githubToken: String(args["githubToken"] ?? ""),
              workspaceFilter: args["workspaceFilter"] as string | undefined,
              topK: args["topK"] as number | undefined,
              model: args["model"] as string | undefined,
            });
            respond(id, {
              content: [
                {
                  type: "text",
                  text: `${result.answer}\n\n---\n_Model: ${result.model} · ${result.tokensUsed} tokens · ${result.sources.length} bronnen_`,
                },
              ],
            });
            return;
          }

          case "devpulse_index_status": {
            const status = getIndexStatus();
            respond(id, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(status, null, 2),
                },
              ],
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
