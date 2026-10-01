# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

DevPulse — een lokaal Vue 3 + Vite dashboard dat activiteit uit meerdere projecten op deze machine
samenbrengt: git commits, VS Code Copilot-chatsessies en Teams-berichten. Geen eigen backend: de
Node-kant is de Vite dev-server. Zie [docs/plan.md](docs/plan.md) voor het functionele plan en
[.github/copilot-instructions.md](.github/copilot-instructions.md) voor code- en stijlconventies
(die blijven leidend voor opmaak, naamgeving en de neon-CSS-klassen).

## Commando's

```bash
npm run dev              # build:packages + vite dev op poort 5173 (strictPort, opent browser)
npm run build            # build:packages + vue-tsc -b + vite build  — dit is de typecheck
npm run build:packages   # bouwt search-shared en chat-mcp naar dist/
npm run preview          # serveert dist/ (let op: zonder API-plugin, zie hieronder)
```

Er is **geen testrunner en geen linter** geconfigureerd. `npm run build` (via `vue-tsc -b`) is de
enige geautomatiseerde verificatie — draai die na elke wijziging.
[scripts/test-chat.mjs](scripts/test-chat.mjs) is een ad-hoc debugscript tegen
`packages/chat-mcp/dist/`, geen test.

Dagelijks werken gaat via de VS Code-taak **"Dev (watch + vite)"** (`Ctrl+Shift+B`): die draait
`tsc --watch` op `packages/chat-mcp` parallel aan de vite dev-server.

## Architectuur

### Twee runtimes in één repo

De scheiding tussen browser en Node is het belangrijkste om te snappen:

- **Browser** — alles onder `src/` behalve `src/server/`. Geen filesystem, geen git, geen secrets.
- **Node** — [src/server/api-plugin.ts](src/server/api-plugin.ts), een Vite-plugin die via
  `configureServer` middleware op `/api/*` hangt. Hier draaien `git log`, `readdir`, de
  Graph API-calls en de Copilot SDK.

Daaruit volgt: **de app werkt alleen onder de dev-server.** `vite build` levert een statische bundel
zonder die middleware; `npm run preview` toont dus een UI zonder data.

De `/api`-endpoints (alle in `api-plugin.ts`): `discover-projects`, `git-log`, `chat-sessions`,
`chat-session`, `copilot-proxy/chat/completions`, `search-ask`, `teams-file`,
`teams/auth/{status,token,revoke}`, `teams/messages`.

### Connectors

Elke bron is een `SourceConnector` (zie [src/types/index.ts](src/types/index.ts)) met `fetch()` en
`validate()`. Registratie gebeurt op één plek: de lus boven in
[src/App.vue](src/App.vue#L28-L31) zet elke connector zowel in de Pinia-store als in de globale
registry. Een nieuwe bron toevoegen betekent: bestand in `src/connectors/`, export uit
`index.ts`, opnemen in die lus, en een `neon-badge--{type}` CSS-klasse.

Connectors met `global: true` (zoals `teams`) zijn niet projectgebonden: ze krijgen één synthetisch
`ProjectConfig` en hun entries dragen een projectId met underscore-prefix (`_teams`). Die virtuele
ID's omzeilen het `trackedProjects`-filter in `projectsStore.filteredEntries`.

Er zijn twee Teams-connectors naast elkaar: `teams` (Graph API, OAuth PKCE, vereist een Azure
AD-registratie) en `teams-file` (leest een JSON-export van een Power Automate-flow, geen
IT-rechten nodig).

Net zo zijn er twee chat-connectors: `chat` (VS Code Copilot) en `claude-chat` (Claude Code). Ze
delen bijna alles wat erop volgt, dus die gemeenschappelijkheid staat op één plek:
[src/utils/chat-source.ts](src/utils/chat-source.ts) met `CHAT_SOURCES`, `isChatSource()` en
`chatSessionUrl()`. **Voeg je een derde chatbron toe, zet hem dan in `CHAT_SOURCES`** — de takken in
[src/search/index-builder.ts](src/search/index-builder.ts) hangen eraan, en een bron die daar
doorvalt naar de generieke tak verliest stilletjes zijn `indexableText`, oftewel vrijwel alles wat
hem doorzoekbaar maakt.

Claude-entry-ID's dragen een `claude:`-prefix zodat ze nooit botsen met een Copilot-sessie in
dezelfde index; `meta.extra.sessionId` houdt de kale ID vast en `chatSessionUrl()` zet dat weer om
naar `/api/chat-session?id=…&source=…`.

### Caching — drie lagen, allemaal apart te invalideren

1. **Server** — [src/server/cache.ts](src/server/cache.ts) schrijft JSON naar `.devpulse-cache/`,
   bestandsnaam is een SHA-256 van de cachesleutel. TTL wordt per endpoint meegegeven
   (`discover-projects` 5 min, `chat-sessions` 2 min). **Verander je de vorm van een payload, bump
   dan de versie in de sleutel** (`chat-sessions-v3:{source}:{limit}:{filter}`), anders serveer je
   stale data. Zet elke parameter die het antwoord verandert in die sleutel: toen `source` er nog
   niet in zat, bleef een leeg Claude-resultaat twee minuten lang hangen en leek de bron kapot.
2. **Browser** — [src/utils/browser-cache.ts](src/utils/browser-cache.ts), IndexedDB
   (`devpulse-entry-cache`) per `project:source`-slice. De `cachedAt` is tevens het `since`-argument
   voor incrementele fetches. Stond ooit in localStorage, maar chat-entries dragen hun
   `indexableText` mee (tot 100.000 tekens per sessie) en dat loopt met een stuk of negen projecten
   over de 5 MB heen; de write faalde dan stil en juist de grootste projecten verloren hun cache.
   De API is daarom **async** — elke aanroep in `projects.ts` moet `await`, met een `loadSeq`-check
   erna zodat een achterhaalde laadronde de store niet alsnog overschrijft. Oude localStorage-slices
   worden bij de eerste aanroep overgezet.
3. **Vector-embeddings** — IndexedDB (`devpulse-vector-store`), zie
   [src/search/vector-store.ts](src/search/vector-store.ts). Alleen documenten met een gewijzigde
   contenthash worden opnieuw ge-embed.

`.devpulse-cache/` bevat ook de Teams-OAuth-tokens en Graph delta-links
([src/server/teams-token.ts](src/server/teams-token.ts)) — de map staat in `.gitignore` en hoort
daar te blijven.

### Zoeken

Hybride: BM25+ lexicaal, gefuseerd met semantische cosine-scores via Reciprocal Rank Fusion
([src/search/hybrid.ts](src/search/hybrid.ts)). Zonder GitHub-token (localStorage) valt het terug op
BM25-only — dat is een ondersteund pad, geen foutpad.

De BM25-implementatie staat op precies één plek: `packages/search-shared`. Zowel
`src/search/bm25.ts` als `packages/chat-mcp/src/bm25.ts` zijn re-exports. Pas de tokenizer of de
scoring daar aan, nooit in een van de re-exports.

`src/stores/search.ts` orkestreert de levenscyclus: BM25-index wordt reactief herbouwd zodra
`filteredEntries` verandert (watcher in `App.vue`), de vectorindex apart en asynchroon.

### AI-providers

Twee endpoints achter één clientmodule ([src/search/github-models.ts](src/search/github-models.ts)):

- **GitHub Models** (`models.inference.ai.azure.com`) — embeddings en GPT/Llama-modellen,
  geauthenticeerd met een PAT uit localStorage.
- **Copilot SDK** via `/api/copilot-proxy` — de Claude-familie. De SDK authenticeert server-side via
  de `gh` CLI. **Geef de client geen expliciete `githubToken` mee**: een ruwe PAT laat `listModels`
  met een 400 falen, de native auth-flow werkt wel.

## Monorepo-regel die je gaat vergeten

`packages/chat-mcp` en `packages/search-shared` worden **vanuit `dist/` geladen**, niet vanuit
`src/`. De symlinks in `node_modules/@devpulse/` wijzen naar de packagemap; de Vite-server importeert
`dist/index.js` als gewoon Node-module.

Na elke wijziging in `packages/*/src/` dus eerst `npm run build:packages` (of de watch-taak), anders
draait de app stilletjes op oude code — typisch zichtbaar als `undefined` waar een array wordt
verwacht. Heeft de Vite-plugin de oude module al gecached, dan is een herstart van `npm run dev`
nodig. Zet in consumercode `?? []` / `?? null` op nieuwe optionele velden als vangnet.

`packages/chat-mcp` is daarnaast een zelfstandige MCP-server (`bin: devpulse-mcp` →
`dist/mcp-server.js`, JSON-RPC over stdio) die `devpulse_search` en `devpulse_index_status`
aanbiedt aan VS Code Copilot. De serverkant van het dashboard importeert dezelfde package als
bibliotheek.

Dat dubbelgebruik heeft één scherpe rand: de MCP spreekt **newline-gescheiden JSON-RPC over stdout**.
Eén `console.log` ergens in `packages/chat-mcp` breekt dat protocol stil, terwijl diezelfde regel aan
de Vite-kant volkomen ongevaarlijk is. Log in deze package daarom uitsluitend met `console.warn` of
`console.error` — die gaan naar stderr.

De index van de MCP-server is **lui en per proces**: `ensureIndex()` bouwt hem bij de eerste
tool-call en ververst hem na 5 minuten; de workspace-lijst eronder heeft een eigen TTL van 1 minuut,
zodat een workspace die ná het starten van de server is aangemaakt alsnog meekomt. De eerste call in
een vers proces kost daardoor ~20 s (862 sessies parsen), daarna is het milliseconden. Vrijwel al die
tijd gaat naar de Copilot-kant: 812 sessies in ~19 s, tegen 50 Claude-sessies in 0,8 s — het
replayen van de snapshot-plus-patches is duur. Persistent cachen staat op de rol in
[docs/plan.md](docs/plan.md) (fase 3c).

De `source`-parameter zit óók in de cachesleutel van `ensureIndex()`, zodat een zoekactie met één
bron nooit een gecombineerde index hergebruikt.

## Chat-indexering

`listSessions({ includeIndexableText: true })` bouwt per sessie de te indexeren tekst op met
`buildIndexableText()` ([packages/chat-mcp/src/formatter.ts](packages/chat-mcp/src/formatter.ts)):
**alle** turns, met `<thinking>`-blokken en tool-calls eruit. Harde grens van 100.000 tekens per
sessie. Compact-samenvattingen gaan er als extra tekst bij in, maar vervángen de turns niet.

De **recap-delta-strategie** zit níét in de index, alleen in `buildLLMContext()` — die snijdt bij de
laatste `/compact` af om de LLM-context klein te houden. `detectLastRecapTurn()` zoekt daarvoor
`<summary>`-blokken die VS Code bij een compact schrijft; het heeft niets met een tekenlimiet of een
minimum aantal turns te maken. De splitsing is bewust (commit 7e0fb5e): volledig indexeren,
token-efficiënt samenvatten.

De tekst reist via `GET /api/chat-sessions` → connector → `meta.extra.indexableText` naar de
BM25-index (gewicht ×1, tegenover titel ×3 en description/projectId ×2) en de eerste 2.000 tekens
gaan mee in het vectordocument.

### Twee chatbronnen achter één `SessionProvider`

Chatsessies komen van schijf, niet van een API, en er zijn twee bronnen met niets gemeen behalve dat
het JSONL is. Ze zitten achter de `SessionProvider`-interface
([packages/chat-mcp/src/types.ts](packages/chat-mcp/src/types.ts)), geregistreerd in
[providers.ts](packages/chat-mcp/src/providers.ts):

| bron | opslag | formaat |
| --- | --- | --- |
| `copilot` | `%APPDATA%\Code\User\workspaceStorage\<hash>\chatSessions\` | snapshot (`kind:0`) plus patches die je moet replayen; projectpad via `workspace.json` |
| `claude` | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | plat append-only; projectpad staat als `cwd` op elk record |

Lees het Claude-projectpad **uit het `cwd`-veld**, niet uit de mapnaam: die codering is lossy
(`\` en `.` worden allebei `-`), dus `d--Anta-afas-help--worktrees-tbr-feature1` valt niet eenduidig
terug te rekenen. Honoreer `CLAUDE_CONFIG_DIR` als die gezet is.

Wat er bij Claude wél en niet geïndexeerd wordt, staat in
[claude-formatter.ts](packages/chat-mcp/src/claude-formatter.ts). De belangrijkste regel: **`tool_result`
gaat eruit.** Die blokken bevatten volledige bestandsinhoud en shell-output en zijn met ~7.500 stuks
tegenover 390 echte prompts verreweg het grootste deel van de data; indexeer je ze, dan vult de
100k-cap zich met file-dumps en stort de BM25-ranking in omdat elk document dezelfde woordenschat
krijgt. Hetzelfde geldt voor de harness-injecties (`<system-reminder>`, `<ide_opened_file>`, …): die
zijn niet door de gebruiker getypt en herhalen zich letterlijk over honderden sessies, wat de IDF
scheeftrekt. `isSidechain: true` wordt overgeslagen — dat zijn subagents, niet het gesprek.

Beide providers leveren dezelfde `ConversationTurn[]`, zodat `buildIndexableText`, `buildLLMContext`,
`extractSnippet` en de hele UI bronagnostisch blijven. In de gedeelde BM25-index is de documentsleutel
`${source}:${id}`, want sessie-ID's zijn alleen binnen hun eigen bron uniek.

`devpulse_search` neemt een `source`-parameter (`all` | `copilot` | `claude`) en elk resultaat draagt
zijn `source`. Een bron zonder leesbare sessies op deze machine wordt bij `all` simpelweg
overgeslagen.

## Thema's

Twee thema's, geschakeld via `data-theme` op `<html>` vanuit een `watchEffect` in `App.vue`:
`cyberpunk` (standaard) en `sys-nexus`. Beide zijn CSS-custom-properties in
[src/assets/main.css](src/assets/main.css); `examples/sys_nexus/` is de referentie-mockup waar het
tweede thema op gebaseerd is.
