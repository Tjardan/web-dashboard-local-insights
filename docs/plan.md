# DevPulse — Local Project Insights Dashboard

## Projectdoel

DevPulse is een lokaal, file-based web dashboard dat inzicht geeft in alle activiteit over meerdere ontwikkelprojecten heen. Het aggregeert commits, VS Code Copilot chatsessies, file changes en in de toekomst Teams/Email communicatie in een enkele, real-time gefilterde interface. Het doel is om ontwikkelaars en teams een helikopterview te geven over hun werkstroom zonder afhankelijk te zijn van een backend of cloud service.

De tool is bedoeld voor lokaal gebruik door individuele ontwikkelaars en teamgenoten (cloneable via GitHub). Op termijn publicatie naar een GitHub feed.

## Kernfunctionaliteiten

- **Dashboard View** — Overzicht van alle projecten met statistieken (commits, chats, files) als geanimeerde neon tegels
- **Timeline View** — Cross-project activiteitenstroom met alle bronnen gecombineerd, chronologisch gesorteerd
- **Project Detail View** — Gedetailleerd overzicht per project met alle entries
- **Chat Sessions View** — Dedicated view per project voor Copilot chatsessies met uitklapbare prompts en summaries
- **Settings View** — Beheer root folders (projectbronnen) en toggle data sources via de UI
- **Source Filtering** — Real-time in/uitschakelbare bronnen in elke view
- **Connector Systeem** — Plugin-architectuur voor eenvoudig toevoegen van nieuwe bronnen

## Technische stack

| Onderdeel   | Keuze                              | Reden                                               |
| ----------- | ---------------------------------- | --------------------------------------------------- |
| Frontend    | Vue 3 + Composition API            | Reactive, TypeScript-friendly, snel                 |
| Taal        | TypeScript 5 (strict)              | Type safety, betere DX                              |
| Build       | Vite 6                             | Snelle dev server, HMR, optimized builds            |
| State       | Pinia                              | Officiële Vue state management, simpel en type-safe |
| Routing     | Vue Router 4                       | SPA routing met animated transitions                |
| Utilities   | @vueuse/core                       | Reactive utilities, localStorage, observers         |
| Styling     | Custom CSS                         | Cyberpunk/neon dark theme, geen framework overhead  |
| Data        | File-based (localStorage)          | Geen backend, puur lokaal                           |
| Integraties | MCP (GitHub, VS Code Chat History) | Commits en chat data via MCP servers                |

## Architectuuroverzicht

```
┌─────────────────────────────────────────────────────────┐
│                    Vue 3 SPA (Vite)                     │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │Dashboard │  │ Timeline │  │ Project  │  │Settings│  │
│  │  View    │  │   View   │  │  Views   │  │  View  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───┬────┘  │
│       │              │             │             │       │
│  ┌────┴──────────────┴─────────────┴─────────────┴────┐  │
│  │              Pinia Stores (projects, settings)      │  │
│  └────────────────────────┬───────────────────────────┘  │
│                           │                              │
│  ┌────────────────────────┴───────────────────────────┐  │
│  │            Connector Registry (extensible)          │  │
│  ├──────────┬──────────┬──────────┬──────────┬────────┤  │
│  │  Git     │  Chat    │  File    │  Teams   │ Email  │  │
│  │ Commits  │ History  │ Changes  │ (future) │(future)│  │
│  └──────────┴──────────┴──────────┴──────────┴────────┘  │
│                           │                              │
│  ┌────────────────────────┴───────────────────────────┐  │
│  │           MCP Servers (GitHub, Chat History)        │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │         localStorage (settings, cache)              │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Settings** → Gebruiker configureert root folders en enabled sources
2. **Project Discovery** → Root folders worden gescand (1 niveau diep) voor projectmappen
3. **Connector Fetch** → Elke enabled connector haalt entries op per project
4. **Validation** → Elke entry wordt gevalideerd via `connector.validate()`
5. **Store** → Geldige entries worden opgeslagen in Pinia store
6. **Reactive Views** → Alle views reageren real-time op source toggles

### Connector Interface

```typescript
interface SourceConnector {
  type: SourceType; // 'commit' | 'chat' | 'file-change' | ...
  label: string; // Weergavenaam
  color: string; // CSS variable naam
  icon: string; // Lucide icon naam
  enabled: boolean;
  fetch(project): Promise<InsightEntry[]>;
  validate(entry): ValidationResult;
}
```

Nieuwe bronnen toevoegen = nieuw bestand in `src/connectors/` + registreren.

## Implementatiefasen

### Fase 1 — MVP (Fundament)

- [x] Project setup (Vue 3 + Vite + TypeScript + Pinia)
- [x] Routing met animated page transitions
- [x] Cyberpunk/neon dark theme CSS
- [x] AppShell met sidebar navigatie
- [x] Settings view (root folders CRUD, source toggles)
- [x] Dashboard view (project grid met stats)
- [x] Timeline view (cross-project stream)
- [x] Project detail view
- [x] Chat sessions view (uitklapbaar met summary)
- [x] Source filter component (real-time toggle)
- [x] Generic connector registry en types
- [x] Skeleton loading placeholders
- [ ] npm install en dev server validatie

### Fase 2 — MCP Integratie

- [x] Git Commit connector via local git log (Vite API plugin)
- [x] File Change connector via git log --name-status (Vite API plugin)
- [x] Project auto-discovery vanuit root folders (Vite dev server middleware)
- [x] VS Code Chat History connector via @devpulse/chat-mcp workspace package
- [x] Monorepo structuur: packages/chat-mcp als gedeeld workspace package
- [x] Real data in alle views

### Fase 3 — Polish & UX

- [ ] Animated neon tile entrance effects (staggered)
- [ ] Voortgangsindicatoren bij data loading
- [x] Zoekfunctie in timeline en chats (BM25 + hybrid vector search via SearchView)
- [ ] Keyboard shortcuts
- [ ] Responsive layout (mobile-friendly sidebar)
- [ ] Error handling en retry UI

### Fase 3b — Search Verbetering

- [x] BM25 zoekopdrachten op chatsessies indexeren op title + beschrijving
- [x] Hybrid search: BM25 + vector embeddings (GitHub Models)
- [x] RAG Ask-functie met tijdvenster context (commits + volledige chatsessies)
- [x] **Chat inhoud volledig geïndexeerd in BM25** — user prompts + AI antwoorden (strip `<thinking>` en tool calls)
  - `buildIndexableText()` in `packages/chat-mcp/src/formatter.ts` indexeert **alle** beurten
  - Recap-delta zit niet in de index maar in `buildLLMContext()` — die snijdt af bij de laatste `/compact` om de LLM-context klein te houden (commit 7e0fb5e)
  - Beide indices bijgewerkt: browser-side (`src/search/index-builder.ts`) én chat-mcp server-side (`packages/chat-mcp/src/search-tools.ts`)
  - Content gewicht ×1 (lager dan title ×3) voor correcte ranking
- [x] `devpulse_index_status` rapporteert de data in plaats van de cacheleeftijd; `since` filtert vóór de topK-slice
- [x] Nieuwe projecten lopen automatisch mee: workspace-cache in `storage.ts` heeft een TTL

### Fase 3c — SessionProvider (voorwaarde voor een tweede chatbron)

`packages/chat-mcp` gaat uit van één opslagformaat: `STORAGE_ROOT` is een enkele const en
`ensureIndex()` roept `listSessions()` hard aan. Zolang dat zo is, wordt elke extra bron een tweede
hardcoded pad. Deze fase haalt die aanname eruit.

- [x] `SessionProvider`-interface met `listSessions()` / `readSession()`; `copilotProvider` en `claudeProvider` in `providers.ts`
- [x] Bron meenemen in de cachesleutel van `ensureIndex()`; `source`-parameter op `devpulse_search` (`copilot` | `claude` | `all`) en een `source`-veld op elk resultaat
- [x] Documentsleutel `${source}:${id}` zodat twee bronnen in één BM25-index geen ID's delen
- [x] **Opstarttijd: index persistent cachen op schijf** — [`session-cache.ts`](../packages/chat-mcp/src/session-cache.ts). Gemeten: **20,9 s → 0,75 s** voor 864 sessies in een vers proces
  - De cache-eenheid is één **sessiebestand**, gestempeld met mtime + grootte. Een gewijzigde chat wordt opnieuw geparsed, de andere 800 worden als kale JSON teruggelezen. Een cache van de héle index zou bij elk nieuw chatbericht in zijn geheel vervallen
  - Locatie is een **gebruikersmap** (`%LOCALAPPDATA%\devpulse\sessions`, `~/.cache/devpulse/sessions`), niet `.devpulse-cache/` in de repo: de MCP-server staat op user-scope geregistreerd en erft de cwd van de host, dus een cwd-relatief pad strooit kopieën door elke projectmap. `DEVPULSE_CACHE_DIR` overschrijft, `DEVPULSE_SESSION_CACHE=0` zet hem uit
  - `parse()` bouwt **altijd** de `indexableText`, ook als de aanroeper die niet vroeg — de cache is gedeeld, en een aanroeper die hem oversloeg zou hem voor de index vergiftigen. Strippen gebeurt bij teruggave
  - Entries dragen een `CACHE_VERSION`; die moet omhoog zodra `SessionSummary` of een formatter andere tekst gaat opleveren
  - De workspace-naam en het pad komen bij Copilot uit `workspace.json` en worden ná de cache overlayd: die kunnen veranderen zonder dat de mtime van de sessie meebeweegt

### Fase 3d — Testdekking

Tot nu toe was `vue-tsc -b` de enige geautomatiseerde verificatie, en die vangt geen van de bugs
die hier daadwerkelijk zijn gevonden: een `since`-filter dat ná de topK-slice werkte, een
workspace-cache die nooit verviel, een padvergelijking die `\` en `/` door elkaar haalde. Het zijn
stuk voor stuk gedragsfouten in pure functies over data die je met de hand niet reproduceert.

- [x] **vitest opgezet** — [vitest.config.ts](../vitest.config.ts), `npm test` / `npm run test:watch`. Tests als `*.test.ts` naast de code, environment `node`, draaiend tegen `src/` van de packages zodat er niet eerst gebouwd hoeft te worden. 82 tests in ~0,8 s
- [x] BM25: tokenizer (camelCase-splitsing, stopwoorden), ranking-volgorde, veldgewichten, IDF-voorkeur voor het zeldzame woord, `add`/`remove`/`buildFromDocuments`
- [x] `readFullSnapshot`: het replayen van snapshot-plus-patches — responses die vervángen in plaats van aanvullen, een patch op een request uit een latere patch, `customTitle`, het `result`-blok waar `/compact` in landt, een half weggeschreven laatste regel
- [x] `buildClaudeTurns`: wat er níét in de index hoort (`tool_result`, `isSidechain`, de negen harness-tags), het vouwen van meerdere assistant-records in één beurt, en `claudeSessionTitle`
- [x] `buildIndexableText` vs. `buildLLMContext`: de index neemt álles, recap-delta geldt alleen voor de LLM-context. Dit onderscheid is eerder verkeerd gedocumenteerd geweest
- [x] De sessie-parsecache: invalidatie op mtime én grootte, `CACHE_VERSION`, een kapot weggeschreven entry, het onthouden van een onbruikbaar bestand, en de prune
- [x] `chatSessionUrl`: het strippen van de `claude:`-prefix — precies de bug die drie views stil Claude-sessies liet laten vallen
- [ ] Connectors, stores en de Vite API-plugin. Die hebben echte opslag of een DOM nodig; verificatie loopt daar nog via de browser

### Fase 4 — Uitbreiding Bronnen

- [x] **Claude Code-chats als tweede chatbron** — `claudeProvider` in de MCP, `claude-chat`-connector in het dashboard, oranje badge, uitklapbaar in de timeline
  - Opslag: `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` — platte append-only JSONL, géén snapshot-met-patches zoals VS Code. Projectpad uit het `cwd`-veld, niet uit de mapnaam (die is lossy bij worktrees)
  - Geïndexeerd: alleen `user:text` en `assistant:text`. `tool_result` (bestandsinhoud, shell-output), `thinking`, `tool_use`, `image` en de harness-injecties (`<system-reminder>`, `<ide_opened_file>`, …) blijven eruit; `isSidechain: true` wordt overgeslagen
  - Gemeten: 50 sessies, 1,6 MB indexeerbare tekst, 0,8 s om te lezen. 46 ervan vallen onder een ontdekt project; de rest zijn scratch-workspaces en een UNC-pad
  - Gedeelde chatlogica staat in `src/utils/chat-source.ts`; een derde bron moet daar in `CHAT_SOURCES`
  - Nog open: **worktree-sessies vallen onder hun hoofdproject** omdat het pad-filter op substring matcht (`d:\Anta\runner.worktrees\afh` telt mee bij `runner`). Dat is nu wenselijk, maar als `discover-projects` ooit worktrees apart ontdekt, botsen de twee
- [ ] Teams communicatie connector (voorbereid)
- [ ] Email communicatie connector (voorbereid)
- [ ] Output generatie (rapporten, samenvattingen)
- [ ] Export functionaliteit (JSON, Markdown)
- [ ] Connector configuratie per project

### Fase 5 — Distributie

- [ ] README met setup instructies
- [ ] GitHub Actions CI (lint, type-check, build)
- [ ] npm package publicatie naar GitHub Packages
- [ ] Versie management en changelog

## Openstaande vragen

- Hoe worden MCP servers bereikbaar gemaakt vanuit de browser runtime? (Waarschijnlijk via een thin local node process of VS Code extension host)
- Welke Teams/Email API's worden uiteindelijk gebruikt?
- Wil je per-project connector configuratie (bijv. specifieke branches/remotes)?
- Moet er caching zijn voor offline gebruik van eerder opgehaalde data?
