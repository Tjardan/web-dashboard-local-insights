# DevPulse — Web Dashboard for Local Project Insights

## Project Overview

Vue 3 + TypeScript + Vite dashboard that aggregates insights from local development projects:
git commits, VS Code Copilot chats, Microsoft Teams messages, and future sources (Email).
Local-only — no separate backend service and no cloud storage.

"No backend" does not mean "browser only": filesystem, git and Graph API access run on the
Node.js side, inside the Vite dev server (`src/server/api-plugin.ts`, mounted via
`configureServer` on `/api/*`). Consequence: **the app only works under `npm run dev`.**
`vite build` emits a static bundle without that middleware, so `npm run preview` shows the UI
with no data.

See `CLAUDE.md` in the repo root for the deeper architecture notes (caching layers, search
pipeline, AI providers).

## Tech Stack

- **Framework**: Vue 3 (Composition API, `<script setup>`)
- **Language**: TypeScript 5.x (strict mode)
- **Build**: Vite 6
- **State**: Pinia stores
- **Routing**: Vue Router 4
- **Utilities**: @vueuse/core
- **Styling**: Custom CSS (no framework), cyberpunk/neon dark theme

## Architecture

### Connector System

All data sources are implemented as `SourceConnector` instances in `src/connectors/`.
Each connector implements:

- `fetch(project, since?)` — returns `InsightEntry[]`; `since` (ISO-8601) enables incremental sync
- `validate(entry)` — returns `ValidationResult`

Registration happens in **one** place: the loop at the top of `src/App.vue`, which puts every
connector in both the Pinia store (`projectsStore.registerConnector`) and the global registry
(`registerSourceConnector`). A connector that is not in that loop is never called.

Connectors marked `global: true` (e.g. `teams`) are not project-scoped. They are called once per
sync cycle with a synthetic `ProjectConfig`, and their entries use an underscore-prefixed
projectId (`_teams`). Those virtual IDs bypass the `trackedProjects` filter in
`projectsStore.filteredEntries`.

Current connectors: `git-commit`, `chat-history`, `teams` (Graph API, OAuth PKCE, needs an Azure
AD app registration) and `teams-file` (reads a JSON export from a Power Automate flow — no IT
permissions required). `file-change` still exists as a `SourceType` and in the default settings,
but has **no connector** — `src/stores/settings.ts` migrates the leftover key away.

### Data Model

- `InsightEntry` — generic entry with `EntryMeta` (source, timestamp, title, description, extra)
- `ProjectConfig` — project metadata (id, name, path, git info)
- `AppSettings` — persisted to localStorage (root folders, enabled sources)

All entries carry `meta.source: SourceType` for filtering and `payload: unknown` for raw data.

### Views

| Route                   | View              | Purpose                          |
| ----------------------- | ----------------- | -------------------------------- |
| `/`                     | DashboardView     | Project grid with stats          |
| `/timeline`             | TimelineView      | Cross-project activity stream    |
| `/search`               | SearchView        | Hybrid search + RAG chat         |
| `/project/:id`          | ProjectView       | Single project detail            |
| `/project/:id/chats`    | ProjectChatsView  | Copilot chat sessions            |
| `/settings`             | SettingsView      | Root folders & source management |
| `/auth/teams/callback`  | TeamsCallbackView | OAuth PKCE redirect target       |

All routes are lazy-loaded and carry a `meta.transition` name used by the `<Transition>` in
`App.vue`.

### Local API endpoints

The dashboard reads **no MCP tools** — every connector calls the local Vite plugin over `fetch`.
Endpoints in `src/server/api-plugin.ts`:

`/api/discover-projects`, `/api/git-log`, `/api/chat-sessions`, `/api/chat-session`,
`/api/copilot-proxy/chat/completions`, `/api/search-ask`, `/api/teams-file`,
`/api/teams/auth/{status,token,revoke}`, `/api/teams/messages`.

MCP runs in the other direction: `packages/chat-mcp` **is** an MCP server (`bin: devpulse-mcp` →
`dist/mcp-server.js`, JSON-RPC over stdio) exposing `devpulse_search` and `devpulse_index_status`
to VS Code Copilot. The dev-server imports the same package as a plain library.

## Monorepo & Build Rules

### Package `@devpulse/chat-mcp`

`packages/chat-mcp` is a **compiled TypeScript package**. It publishes from `dist/`, not `src/`.
The Vite dev server imports it as a regular Node.js module — it always loads `dist/index.js`.

**Critical rule**: after editing any file in `packages/chat-mcp/src/`, you MUST rebuild before
the changes take effect at runtime. Forgetting this causes silent runtime crashes in the app
(e.g. missing fields, `undefined` where arrays are expected).

```bash
# Rebuild once
npm run build:packages

# Or keep it running in watch mode alongside the dev server
# (use VS Code task "Dev (watch + vite)" which does both)
npm run build:packages:watch
```

When modifying `packages/chat-mcp`:

1. Edit source files in `packages/chat-mcp/src/`
2. Run `npm run build:packages` (or confirm watch mode is active)
3. Restart `npm run dev` if the Vite plugin has cached the old module
4. Add `?? []` / `?? null` fallbacks in consumer code for any new optional fields —
   guards against stale `dist/` during development

`npm run dev` pre-builds the package automatically (`build:packages && vite`).
For active package development, prefer the **"Dev (watch + vite)"** VS Code task (`Ctrl+Shift+B`).

## Code Conventions

### TypeScript

- Strict mode, no `any` — use `unknown` + narrowing instead
- Target: ES2020 for app code (`tsconfig.app.json`), ES2022 for `packages/*` and `vite.config.ts`
- `noUnusedLocals` and `noUnusedParameters` are on: an unused import or parameter fails the build
- Interfaces over type aliases for object shapes
- PascalCase for types/interfaces, camelCase for variables/functions

There is no linter and no test runner. `npm run build` (which runs `vue-tsc -b`) is the only
automated check — run it after every change.

### Vue Components

- Always use `<script setup lang="ts">`
- Props via `defineProps<T>()`, emits via `defineEmits<T>()`
- Scoped styles only
- Components in `src/components/`, views in `src/views/`

### Styling

- Dark mode only, cyberpunk/neon aesthetic
- CSS custom properties in `:root` (see `src/assets/main.css`)
- Neon accents: cyan (#00f0ff), magenta (#ff00aa), purple (#8b5cf6), green (#39ff14)
- Two themes, switched via `data-theme` on `<html>` from a `watchEffect` in `App.vue`:
  `cyberpunk` (default) and `sys-nexus` (overrides later in `main.css`; `examples/sys_nexus/`
  is the reference mockup). A new token needs a value in both.
- Use `.neon-card`, `.neon-btn`, `.neon-badge`, `.neon-toggle` utility classes
- Animated transitions on all page navigations
- Skeleton loading placeholders with glow animation

### File Organization

```
src/
  assets/       — Global CSS (both themes)
  components/   — Reusable UI components
  connectors/   — Data source connectors
  router/       — Vue Router config
  search/       — BM25 re-export, vector store, hybrid fusion, AI clients
  server/       — Node.js only: Vite API plugin, file cache, Teams token storage
  stores/       — Pinia stores (projects, settings, search)
  types/        — TypeScript interfaces
  utils/        — Browser cache, git remote parsing, PKCE, timeline grouping
  views/        — Route-level view components
```

Nothing in `src/server/` may be imported from browser code, and nothing outside it may use
`node:` built-ins.

## Important Patterns

### Source Filtering

Source toggles in `SourceFilter.vue` update `settingsStore.enabledSources`,
which reactively filters `projectsStore.filteredEntries` and `timelineEntries`.
All views react immediately when sources are toggled.

### Entry Validation

Every `InsightEntry` passes through `connector.validate()` before being added to the store.
Invalid entries are silently dropped with a console warning.

### Extensibility

To add a new source:

1. Create `src/connectors/my-source.ts` implementing `SourceConnector`
2. Export from `src/connectors/index.ts`
3. Add it to the registration loop in `src/App.vue`
4. Add a `neon-badge--{type}` CSS class with appropriate color
5. If the source needs filesystem or network access that the browser cannot do, add an
   `/api/…` endpoint in `src/server/api-plugin.ts` and `fetch` it from the connector

### Search & BM25 Indexing

The BM25+ implementation lives in **exactly one place**: `packages/search-shared/src/index.ts`.
Both `src/search/bm25.ts` and `packages/chat-mcp/src/bm25.ts` are re-exports — change the
tokenizer, the stop words or the scoring there, never in a re-export.

Both the browser-side BM25 index (`src/search/`) and the chat-mcp server-side index
(`packages/chat-mcp/src/search-tools.ts`) index actual **chat turn content** — not just titles.

**How chat content enters the index:**

1. `listSessions({ includeIndexableText: true })` — calls `buildIndexableText()` per session
2. `buildIndexableText()` strips `<thinking>…</thinking>` blocks and excludes tool calls
3. **Recap-delta strategy**: `detectLastRecapTurn()` scans turns for the last user message
   asking for a summary/recap (Dutch + English keywords, ≤ 300 chars, sessions with 8+ turns).
   If found, only indexes the summary AI response + all subsequent turns.
   If not found, indexes all turns (user messages + stripped AI responses).
4. Hard cap: 100,000 chars per session to prevent runaway memory
5. Text is stored in `SessionSummary.indexableText` and passed through:
   - API: `GET /api/chat-sessions` → connector → `meta.extra.indexableText`
   - BM25 field weight 1 (lower than title ×3, workspace/project ×2)
   - Vector doc: first 2,000 chars appended for semantic search

**Field weights for chat entries:**

| Field                          | Weight |
| ------------------------------ | ------ |
| title                          | ×3     |
| description                    | ×2     |
| projectId                      | ×2     |
| turn content (`indexableText`) | ×1     |

**Cache key**: `/api/chat-sessions` uses server cache key `chat-sessions-v2:{filter}` (TTL 2 min).
If you change the shape of `indexableText`, bump the cache key version to avoid stale responses.

### Caching

Three independent layers — stale data after a change usually means you invalidated the wrong one:

| Layer         | Where                                  | Invalidate by                        |
| ------------- | -------------------------------------- | ------------------------------------ |
| Server files  | `.devpulse-cache/` (`src/server/cache.ts`) | Bumping the version in the cache key |
| Browser       | localStorage, `devpulse:entries:{project}:{source}` | Clearing the slice; `cachedAt` doubles as the `since` for incremental fetches |
| Embeddings    | IndexedDB `devpulse-vector-store`      | Content hash changes per document    |

`.devpulse-cache/` also holds the Teams OAuth tokens and Graph delta links
(`src/server/teams-token.ts`). It is gitignored and must stay that way.
