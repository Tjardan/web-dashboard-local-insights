<script setup lang="ts">
import { ref, watch, computed, onMounted } from "vue";
import { useSearchStore } from "@/stores/search";
import { useProjectsStore } from "@/stores/projects";
import { useRouter } from "vue-router";
import type { AskResult } from "@/stores/search";
import {
  setGithubToken,
  clearGithubToken,
  getGithubToken,
} from "@/search/github-models";

const searchStore = useSearchStore();
const projectsStore = useProjectsStore();
const router = useRouter();

// ── Tab ────────────────────────────────────────────────────────────────────────
const activeTab = ref<"search" | "ask">("search");

// ── Search ─────────────────────────────────────────────────────────────────────
const queryInput = ref("");
const projectFilter = ref<string>("");
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

watch(queryInput, (q) => {
  if (searchTimeout) clearTimeout(searchTimeout);
  if (!q.trim()) {
    searchStore.results.splice(0);
    return;
  }
  searchTimeout = setTimeout(() => {
    searchStore.search(q, 30);
  }, 220);
});

const filteredResults = computed(() => {
  if (!projectFilter.value) return searchStore.results;
  return searchStore.results.filter(
    (r) => r.entry.projectId === projectFilter.value,
  );
});

// ── Ask ────────────────────────────────────────────────────────────────────────
const askInput = ref("");
const askFilter = ref<string>("");
const lastAskResult = ref<AskResult | null>(null);

async function submitAsk() {
  if (!askInput.value.trim() || searchStore.isAsking) return;
  try {
    lastAskResult.value = await searchStore.ask(
      askInput.value,
      askFilter.value || undefined,
    );
  } catch {
    // error is stored in searchStore.askError
  }
}

// ── Index status ───────────────────────────────────────────────────────────────
async function triggerVectorIndex() {
  await searchStore.rebuildVectorIndex(projectsStore.filteredEntries);
}

// ── Token config ───────────────────────────────────────────────────────────────
const showTokenField = ref(false);
const tokenInput = ref("");
const tokenError = ref("");

const currentToken = computed(() => getGithubToken());

function saveTokenDirect() {
  tokenError.value = "";
  try {
    setGithubToken(tokenInput.value.trim());
    showTokenField.value = false;
    tokenInput.value = "";
    // Reactive update — reload page to re-evaluate hasToken
    window.location.reload();
  } catch (e) {
    tokenError.value = e instanceof Error ? e.message : String(e);
  }
}

function removeToken() {
  clearGithubToken();
  window.location.reload();
}

// ── Source badge color ─────────────────────────────────────────────────────────
const sourceColors: Record<string, string> = {
  commit: "var(--neon-green)",
  chat: "var(--neon-cyan)",
  "file-change": "var(--neon-purple)",
};

function sourceColor(s: string): string {
  return sourceColors[s] ?? "var(--neon-yellow)";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function openProject(id: string) {
  router.push(`/project/${id}`);
}

function openChat(projectId: string, sessionId: unknown) {
  if (typeof sessionId === "string") {
    router.push(
      `/project/${projectId}/chats?session=${encodeURIComponent(sessionId)}`,
    );
  } else {
    router.push(`/project/${projectId}/chats`);
  }
}

// ── Initial BM25 build on mount ────────────────────────────────────────────────
onMounted(() => {
  if (
    searchStore.bm25DocCount === 0 &&
    projectsStore.filteredEntries.length > 0
  ) {
    searchStore.rebuildBM25Index(projectsStore.filteredEntries);
    searchStore.setEntries(projectsStore.filteredEntries);
  }
});

watch(
  () => projectsStore.filteredEntries,
  (entries) => {
    searchStore.rebuildBM25Index(entries);
    searchStore.setEntries(entries);
  },
  { deep: false },
);
</script>

<template>
  <div class="search-view">
    <!-- Header -->
    <header class="search-view__header">
      <div>
        <h1 class="search-view__title">
          <span class="glow-text">◈ Search</span>
        </h1>
        <p class="search-view__subtitle">
          BM25 lexical + semantic hybrid over commits &amp; chats
        </p>
      </div>

      <!-- Index status badges -->
      <div class="index-status">
        <span class="index-badge index-badge--bm25">
          BM25 · {{ searchStore.bm25DocCount }} docs
        </span>
        <span
          class="index-badge"
          :class="
            searchStore.vectorDocCount > 0
              ? 'index-badge--vector'
              : 'index-badge--dim'
          "
        >
          Vector · {{ searchStore.vectorDocCount }} docs
        </span>
        <span
          class="index-badge"
          :class="
            searchStore.searchMode === 'hybrid'
              ? 'index-badge--hybrid'
              : 'index-badge--dim'
          "
        >
          {{ searchStore.searchMode }}
        </span>
      </div>
    </header>

    <!-- GitHub Token banner -->
    <div v-if="!searchStore.hasToken" class="token-banner neon-card">
      <div class="token-banner__content">
        <span class="token-banner__icon">⚠</span>
        <div>
          <strong>Geen GitHub token geconfigureerd</strong>
          <p>
            Voeg een GitHub PAT toe voor semantisch zoeken
            (text-embedding-3-small) en AI Q&amp;A (gpt-4o-mini) via GitHub
            Models.
          </p>
        </div>
      </div>
      <button
        class="neon-btn neon-btn--cyan"
        @click="showTokenField = !showTokenField"
      >
        Token instellen
      </button>
    </div>

    <div
      v-if="searchStore.hasToken && !showTokenField"
      class="token-configured neon-card"
    >
      <span class="token-configured__label">
        GitHub Models ✓ &nbsp;
        <span class="token-mask">{{ currentToken?.slice(0, 8) }}••••</span>
      </span>
      <div class="token-configured__actions">
        <button
          class="neon-btn neon-btn--sm"
          :disabled="searchStore.isIndexingVectors"
          @click="triggerVectorIndex"
        >
          <span v-if="searchStore.isIndexingVectors">
            Indexing {{ searchStore.vectorIndexProgress }}/{{
              searchStore.vectorIndexTotal
            }}…
          </span>
          <span v-else>↺ Rebuild vector index</span>
        </button>
        <button
          class="neon-btn neon-btn--sm neon-btn--dim"
          @click="searchStore.clearVectorIndex()"
        >
          Clear vectors
        </button>
        <button
          class="neon-btn neon-btn--sm neon-btn--dim"
          @click="removeToken"
        >
          Remove token
        </button>
      </div>
    </div>

    <!-- Token input form -->
    <div v-if="showTokenField" class="token-form neon-card">
      <label class="token-form__label">GitHub Personal Access Token</label>
      <p class="token-form__hint">
        Create a token at
        <strong>github.com → Settings → Developer settings → PAT</strong>.
        Scopes: geen — publieke modellen zijn gratis toegankelijk.
      </p>
      <div class="token-form__row">
        <input
          v-model="tokenInput"
          type="password"
          id="token-input"
          name="github-token"
          class="neon-input"
          placeholder="ghp_..."
          @keydown.enter="saveTokenDirect"
        />
        <button class="neon-btn neon-btn--cyan" @click="saveTokenDirect">
          Opslaan
        </button>
        <button
          class="neon-btn neon-btn--dim"
          @click="
            showTokenField = false;
            tokenInput = '';
          "
        >
          Annuleer
        </button>
      </div>
      <p v-if="tokenError" class="token-form__error">{{ tokenError }}</p>
    </div>

    <!-- Vector index progress bar -->
    <div v-if="searchStore.isIndexingVectors" class="vector-progress">
      <div
        class="vector-progress__bar"
        :style="{
          width:
            searchStore.vectorIndexTotal > 0
              ? `${(searchStore.vectorIndexProgress / searchStore.vectorIndexTotal) * 100}%`
              : '0%',
        }"
      />
      <span
        >Embeddings genereren: {{ searchStore.vectorIndexProgress }} /
        {{ searchStore.vectorIndexTotal }}</span
      >
    </div>

    <p v-if="searchStore.vectorIndexError" class="vector-error">
      ⚠ Vector index fout: {{ searchStore.vectorIndexError }}
    </p>

    <!-- Tabs -->
    <div class="search-tabs">
      <button
        class="search-tab"
        :class="{ 'search-tab--active': activeTab === 'search' }"
        @click="activeTab = 'search'"
      >
        🔍 Zoeken
      </button>
      <button
        class="search-tab"
        :class="{ 'search-tab--active': activeTab === 'ask' }"
        @click="activeTab = 'ask'"
        :disabled="!searchStore.hasToken"
        :title="!searchStore.hasToken ? 'Vereist GitHub token' : ''"
      >
        ✦ AI Inzicht
      </button>
    </div>

    <!-- ─── Search tab ──────────────────────────────────────────────────────── -->
    <div v-if="activeTab === 'search'" class="search-panel">
      <div class="search-controls">
        <div class="search-input-wrap">
          <span class="search-icon">◈</span>
          <input
            v-model="queryInput"
            id="search-input"
            name="search"
            class="search-input"
            type="text"
            placeholder="Zoek commits, chats, auteurs, bestanden…"
            autofocus
          />
          <span v-if="searchStore.isSearching" class="search-spinner">⟳</span>
        </div>

        <select
          v-model="projectFilter"
          id="project-filter"
          name="project"
          class="neon-select"
        >
          <option value="">Alle projecten</option>
          <option
            v-for="p in projectsStore.sortedProjects"
            :key="p.id"
            :value="p.id"
          >
            {{ p.name }}
          </option>
        </select>
      </div>

      <!-- Results -->
      <div v-if="filteredResults.length > 0" class="search-results">
        <div class="search-results__meta">
          {{ filteredResults.length }} resultaten
          <span class="mode-badge">{{ searchStore.searchMode }}</span>
        </div>

        <div
          v-for="result in filteredResults"
          :key="result.id"
          class="result-card neon-card"
          @click="
            result.entry.meta.source === 'chat'
              ? openChat(
                  result.entry.projectId,
                  result.entry.meta.extra?.sessionId,
                )
              : openProject(result.entry.projectId)
          "
        >
          <div class="result-card__top">
            <span
              class="result-source"
              :style="{
                color: sourceColor(result.entry.meta.source),
                borderColor: sourceColor(result.entry.meta.source),
              }"
              >{{ result.entry.meta.source }}</span
            >
            <span class="result-project">{{ result.entry.projectId }}</span>
            <span class="result-date">{{
              formatDate(result.entry.meta.timestamp)
            }}</span>
            <span class="result-score">{{ result.score.toFixed(4) }}</span>
          </div>

          <h3 class="result-title">{{ result.entry.meta.title }}</h3>
          <p v-if="result.entry.meta.description" class="result-desc">
            {{ result.entry.meta.description }}
          </p>

          <div
            v-if="
              result.bm25Score !== undefined ||
              result.semanticScore !== undefined
            "
            class="result-scores"
          >
            <span
              v-if="result.bm25Score !== undefined"
              class="score-pill score-pill--bm25"
            >
              BM25 {{ result.bm25Score.toFixed(3) }}
            </span>
            <span
              v-if="result.semanticScore !== undefined"
              class="score-pill score-pill--semantic"
            >
              cos {{ result.semanticScore.toFixed(3) }}
            </span>
          </div>
        </div>
      </div>

      <div
        v-else-if="queryInput && !searchStore.isSearching"
        class="no-results"
      >
        <span class="no-results__icon">◇</span>
        <p>
          Geen resultaten voor "<strong>{{ queryInput }}</strong
          >"
        </p>
      </div>

      <div v-else-if="!queryInput" class="search-hint">
        <p>
          Typ om te zoeken door {{ searchStore.bm25DocCount }} entries (commits
          + chats)
        </p>
      </div>
    </div>

    <!-- ─── Ask tab ────────────────────────────────────────────────────────── -->
    <div v-if="activeTab === 'ask'" class="ask-panel">
      <div class="ask-controls">
        <select
          v-model="askFilter"
          id="ask-filter"
          name="ask-project"
          class="neon-select"
        >
          <option value="">Alle projecten</option>
          <option
            v-for="p in projectsStore.sortedProjects"
            :key="p.id"
            :value="p.id"
          >
            {{ p.name }}
          </option>
        </select>

        <div class="ask-input-wrap">
          <textarea
            v-model="askInput"
            id="ask-input"
            name="ask"
            class="ask-input"
            rows="3"
            placeholder="Bijv: Geef een overzicht van alle wijzigingen en chats omtrent de stijling van het filterpaneel deze week."
            @keydown.ctrl.enter="submitAsk"
          />
          <div class="ask-input-footer">
            <span class="ask-hint">Ctrl+Enter om te verzenden</span>
            <button
              class="neon-btn neon-btn--magenta"
              :disabled="!askInput.trim() || searchStore.isAsking"
              @click="submitAsk"
            >
              <span v-if="searchStore.isAsking">⟳ Bezig…</span>
              <span v-else>✦ Vraag AI</span>
            </button>
          </div>
        </div>
      </div>

      <p v-if="searchStore.askError" class="ask-error">
        ⚠ {{ searchStore.askError }}
      </p>

      <!-- Last answer -->
      <div v-if="lastAskResult" class="ask-result neon-card">
        <div class="ask-result__header">
          <span class="ask-result__model">{{ lastAskResult.model }}</span>
          <span class="ask-result__tokens"
            >{{ lastAskResult.tokensUsed }} tokens</span
          >
        </div>
        <div class="ask-result__answer">{{ lastAskResult.answer }}</div>

        <details class="ask-result__sources">
          <summary>{{ lastAskResult.sources.length }} bronnen gebruikt</summary>
          <div
            v-for="src in lastAskResult.sources"
            :key="src.id"
            class="ask-source"
          >
            <span
              class="result-source"
              :style="{
                color: sourceColor(src.entry.meta.source),
                borderColor: sourceColor(src.entry.meta.source),
              }"
              >{{ src.entry.meta.source }}</span
            >
            <span class="ask-source__title">{{ src.entry.meta.title }}</span>
            <span class="ask-source__project">{{ src.entry.projectId }}</span>
            <span class="ask-source__date">{{
              formatDate(src.entry.meta.timestamp)
            }}</span>
          </div>
        </details>
      </div>

      <!-- History -->
      <div v-if="searchStore.askHistory.length > 1" class="ask-history">
        <div class="ask-history__header">
          <span>Geschiedenis</span>
          <button
            class="neon-btn neon-btn--sm neon-btn--dim"
            @click="searchStore.clearHistory()"
          >
            Wissen
          </button>
        </div>
        <div
          v-for="item in searchStore.askHistory.slice(1)"
          :key="item.prompt"
          class="history-item neon-card"
          @click="
            lastAskResult = item.result;
            askInput = item.prompt;
          "
        >
          <p class="history-item__prompt">{{ item.prompt }}</p>
          <p class="history-item__preview">
            {{ item.result.answer.slice(0, 120) }}…
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-view {
  padding: 2rem;
  max-width: 900px;
  margin: 0 auto;
}

.search-view__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.search-view__title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.03em;
}

.search-view__subtitle {
  color: var(--text-secondary);
  font-size: 0.875rem;
  margin-top: 0.25rem;
}

/* ── Index status ─────────────────────────────────────────────────────────── */
.index-status {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.index-badge {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
  border: 1px solid;
}

.index-badge--bm25 {
  color: var(--neon-green);
  border-color: rgba(57, 255, 20, 0.4);
  background: rgba(57, 255, 20, 0.07);
}

.index-badge--vector {
  color: var(--neon-magenta);
  border-color: rgba(255, 0, 170, 0.4);
  background: rgba(255, 0, 170, 0.07);
}

.index-badge--hybrid {
  color: var(--neon-cyan);
  border-color: rgba(0, 240, 255, 0.4);
  background: rgba(0, 240, 255, 0.07);
}

.index-badge--dim {
  color: var(--text-muted);
  border-color: var(--border-dim);
}

/* ── Token banner ──────────────────────────────────────────────────────────── */
.token-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  border-color: rgba(255, 230, 0, 0.3);
}

.token-banner__content {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;
}

.token-banner__icon {
  color: var(--neon-yellow);
  font-size: 1.2rem;
  flex-shrink: 0;
}

.token-banner p {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-top: 0.2rem;
}

.token-configured {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1.25rem;
  margin-bottom: 1rem;
  border-color: rgba(57, 255, 20, 0.25);
  flex-wrap: wrap;
}

.token-configured__label {
  color: var(--neon-green);
  font-size: 0.85rem;
  font-weight: 600;
}

.token-mask {
  color: var(--text-muted);
  font-family: monospace;
}

.token-configured__actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

/* ── Token form ────────────────────────────────────────────────────────────── */
.token-form {
  padding: 1.25rem;
  margin-bottom: 1rem;
}

.token-form__label {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-secondary);
  display: block;
  margin-bottom: 0.5rem;
}

.token-form__hint {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

.token-form__row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.token-form__error {
  color: var(--neon-magenta);
  font-size: 0.8rem;
  margin-top: 0.5rem;
}

/* ── Vector progress ───────────────────────────────────────────────────────── */
.vector-progress {
  background: var(--bg-card);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius);
  padding: 0.75rem 1rem;
  margin-bottom: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  position: relative;
  overflow: hidden;
}

.vector-progress__bar {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  background: rgba(255, 0, 170, 0.15);
  border-right: 2px solid var(--neon-magenta);
  transition: width 0.3s ease;
}

.vector-error {
  color: var(--neon-magenta);
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}

/* ── Tabs ──────────────────────────────────────────────────────────────────── */
.search-tabs {
  display: flex;
  gap: 0.25rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--border-dim);
  padding-bottom: 0;
}

.search-tab {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.6rem 1rem;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition:
    color 0.15s,
    border-color 0.15s;
  letter-spacing: 0.03em;
}

.search-tab:hover:not(:disabled) {
  color: var(--text-primary);
}

.search-tab--active {
  color: var(--neon-cyan);
  border-bottom-color: var(--neon-cyan);
}

.search-tab:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ── Search panel ──────────────────────────────────────────────────────────── */
.search-controls {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  align-items: center;
}

.search-input-wrap {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 0.875rem;
  color: var(--neon-cyan);
  font-size: 1rem;
  pointer-events: none;
}

.search-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-neon);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 1rem;
  padding: 0.65rem 2.5rem 0.65rem 2.25rem;
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.search-input:focus {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 0 3px rgba(0, 240, 255, 0.12);
}

.search-spinner {
  position: absolute;
  right: 0.875rem;
  color: var(--neon-cyan);
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.neon-select {
  background: var(--bg-input);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius);
  color: var(--text-primary);
  padding: 0.65rem 0.875rem;
  font-size: 0.875rem;
  outline: none;
  cursor: pointer;
  transition: border-color 0.15s;
}

.neon-select:focus {
  border-color: var(--neon-cyan);
}

/* ── Results ───────────────────────────────────────────────────────────────── */
.search-results__meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

.mode-badge {
  background: rgba(0, 240, 255, 0.08);
  color: var(--neon-cyan);
  border: 1px solid rgba(0, 240, 255, 0.25);
  border-radius: 999px;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.15rem 0.5rem;
}

.result-card {
  padding: 0.875rem 1rem;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s,
    transform 0.1s;
}

.result-card:hover {
  background: var(--bg-card-hover);
  border-color: rgba(0, 240, 255, 0.3);
  transform: translateX(2px);
}

.result-card__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.35rem;
}

.result-source {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  border: 1px solid;
}

.result-project {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.result-date {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-left: auto;
}

.result-score {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-family: monospace;
}

.result-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
  margin-bottom: 0.2rem;
}

.result-desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.result-scores {
  display: flex;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

.score-pill {
  font-size: 0.68rem;
  font-family: monospace;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  border: 1px solid;
}

.score-pill--bm25 {
  color: var(--neon-green);
  border-color: rgba(57, 255, 20, 0.3);
  background: rgba(57, 255, 20, 0.06);
}

.score-pill--semantic {
  color: var(--neon-magenta);
  border-color: rgba(255, 0, 170, 0.3);
  background: rgba(255, 0, 170, 0.06);
}

/* ── No results / hint ─────────────────────────────────────────────────────── */
.no-results,
.search-hint {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-muted);
}

.no-results__icon {
  font-size: 2.5rem;
  display: block;
  margin-bottom: 0.75rem;
  color: var(--neon-purple);
}

/* ── Ask panel ─────────────────────────────────────────────────────────────── */
.ask-controls {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
}

.ask-input-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ask-input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid rgba(255, 0, 170, 0.3);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 0.9rem;
  padding: 0.75rem 1rem;
  outline: none;
  resize: vertical;
  font-family: inherit;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
  line-height: 1.5;
}

.ask-input:focus {
  border-color: var(--neon-magenta);
  box-shadow: 0 0 0 3px rgba(255, 0, 170, 0.1);
}

.ask-input-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ask-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.ask-error {
  color: var(--neon-magenta);
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

/* ── Ask result ────────────────────────────────────────────────────────────── */
.ask-result {
  padding: 1.25rem;
  margin-bottom: 1.5rem;
  border-color: rgba(255, 0, 170, 0.25);
}

.ask-result__header {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: 0.75rem;
}

.ask-result__model {
  color: var(--neon-magenta);
  font-weight: 700;
  letter-spacing: 0.04em;
}

.ask-result__tokens {
  color: var(--text-muted);
}

.ask-result__answer {
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.ask-result__sources {
  margin-top: 1rem;
  border-top: 1px solid var(--border-dim);
  padding-top: 0.75rem;
}

.ask-result__sources summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  user-select: none;
  margin-bottom: 0.5rem;
}

.ask-source {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border-dim);
  font-size: 0.78rem;
  flex-wrap: wrap;
}

.ask-source__title {
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ask-source__project {
  color: var(--neon-purple);
  font-weight: 600;
}

.ask-source__date {
  color: var(--text-muted);
}

/* ── Ask history ───────────────────────────────────────────────────────────── */
.ask-history__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

.history-item {
  padding: 0.875rem 1rem;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition:
    background 0.15s,
    border-color 0.15s;
}

.history-item:hover {
  background: var(--bg-card-hover);
  border-color: rgba(255, 0, 170, 0.2);
}

.history-item__prompt {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.3rem;
}

.history-item__preview {
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.4;
}

/* ── Shared button variants ────────────────────────────────────────────────── */
.neon-btn--cyan {
  border-color: rgba(0, 240, 255, 0.5);
  color: var(--neon-cyan);
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.15);
}

.neon-btn--cyan:hover:not(:disabled) {
  background: rgba(0, 240, 255, 0.1);
  box-shadow: var(--glow-cyan);
}

.neon-btn--magenta {
  border-color: rgba(255, 0, 170, 0.5);
  color: var(--neon-magenta);
  box-shadow: 0 0 8px rgba(255, 0, 170, 0.15);
}

.neon-btn--magenta:hover:not(:disabled) {
  background: rgba(255, 0, 170, 0.1);
  box-shadow: var(--glow-magenta);
}

.neon-btn--dim {
  border-color: var(--border-dim);
  color: var(--text-muted);
}

.neon-btn--dim:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: rgba(255, 255, 255, 0.15);
}

.neon-btn--sm {
  font-size: 0.75rem;
  padding: 0.35rem 0.7rem;
}

.neon-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-neon);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 0.9rem;
  padding: 0.6rem 0.875rem;
  outline: none;
  font-family: monospace;
  transition: border-color 0.15s;
}

.neon-input:focus {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 0 3px rgba(0, 240, 255, 0.1);
}
</style>
