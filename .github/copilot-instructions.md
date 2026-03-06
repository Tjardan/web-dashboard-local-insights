# DevPulse — Web Dashboard for Local Project Insights

## Project Overview

Vue 3 + TypeScript + Vite dashboard that aggregates insights from local development projects:
commits, VS Code Copilot chats, file changes, and future sources (Teams, Email).
Pure file-based, local-only — no backend server.

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
Connectors are registered via `registerSourceConnector()` and must implement:

- `fetch(project)` — returns `InsightEntry[]`
- `validate(entry)` — returns `ValidationResult`

New sources (Teams, Email, etc.) are added by creating a new connector file and registering it.

### Data Model

- `InsightEntry` — generic entry with `EntryMeta` (source, timestamp, title, description, extra)
- `ProjectConfig` — project metadata (id, name, path, git info)
- `AppSettings` — persisted to localStorage (root folders, enabled sources)

All entries carry `meta.source: SourceType` for filtering and `payload: unknown` for raw data.

### Views

| Route                | View             | Purpose                          |
| -------------------- | ---------------- | -------------------------------- |
| `/`                  | DashboardView    | Project grid with stats          |
| `/timeline`          | TimelineView     | Cross-project activity stream    |
| `/project/:id`       | ProjectView      | Single project detail            |
| `/project/:id/chats` | ProjectChatsView | Copilot chat sessions            |
| `/settings`          | SettingsView     | Root folders & source management |

### MCP Integrations

- **vscode-chat-history**: Chat sessions via `mcp_vscode-chat-h_*` tools
- **GitHub**: Commits and repo info via `mcp_github_*` tools

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

- Target ES2022, strict mode, no `any`
- Use `unknown` + narrowing over `any`
- Interfaces over type aliases for object shapes
- PascalCase for types/interfaces, camelCase for variables/functions

### Vue Components

- Always use `<script setup lang="ts">`
- Props via `defineProps<T>()`, emits via `defineEmits<T>()`
- Scoped styles only
- Components in `src/components/`, views in `src/views/`

### Styling

- Dark mode only, cyberpunk/neon aesthetic
- CSS custom properties in `:root` (see `src/assets/main.css`)
- Neon accents: cyan (#00f0ff), magenta (#ff00aa), purple (#8b5cf6), green (#39ff14)
- Use `.neon-card`, `.neon-btn`, `.neon-badge`, `.neon-toggle` utility classes
- Animated transitions on all page navigations
- Skeleton loading placeholders with glow animation

### File Organization

```
src/
  assets/       — Global CSS
  components/   — Reusable UI components
  connectors/   — Data source connectors
  router/       — Vue Router config
  stores/       — Pinia stores
  types/        — TypeScript interfaces
  views/        — Route-level view components
```

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
3. Register in store initialization
4. Add a `neon-badge--{type}` CSS class with appropriate color
