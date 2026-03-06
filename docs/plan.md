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

| Onderdeel        | Keuze                     | Reden |
|-----------------|---------------------------|-------|
| Frontend        | Vue 3 + Composition API   | Reactive, TypeScript-friendly, snel |
| Taal            | TypeScript 5 (strict)     | Type safety, betere DX |
| Build           | Vite 6                    | Snelle dev server, HMR, optimized builds |
| State           | Pinia                     | Officiële Vue state management, simpel en type-safe |
| Routing         | Vue Router 4              | SPA routing met animated transitions |
| Utilities       | @vueuse/core              | Reactive utilities, localStorage, observers |
| Styling         | Custom CSS                | Cyberpunk/neon dark theme, geen framework overhead |
| Data            | File-based (localStorage) | Geen backend, puur lokaal |
| Integraties     | MCP (GitHub, VS Code Chat History) | Commits en chat data via MCP servers |

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
  type: SourceType          // 'commit' | 'chat' | 'file-change' | ...
  label: string             // Weergavenaam
  color: string             // CSS variable naam
  icon: string              // Lucide icon naam
  enabled: boolean
  fetch(project): Promise<InsightEntry[]>
  validate(entry): ValidationResult
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
- [ ] Git Commit connector via GitHub MCP (`mcp_github_*`)
- [ ] VS Code Chat History connector via chat history MCP (`mcp_vscode-chat-h_*`)
- [ ] File Change connector via git diff parsing
- [ ] Project auto-discovery vanuit root folders (filesystem scan)
- [ ] Real data in alle views

### Fase 3 — Polish & UX
- [ ] Animated neon tile entrance effects (staggered)
- [ ] Voortgangsindicatoren bij data loading
- [ ] Zoekfunctie in timeline en chats
- [ ] Keyboard shortcuts
- [ ] Responsive layout (mobile-friendly sidebar)
- [ ] Error handling en retry UI

### Fase 4 — Uitbreiding Bronnen
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
