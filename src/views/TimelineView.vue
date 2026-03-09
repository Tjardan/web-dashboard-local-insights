<script setup lang="ts">
import { computed, ref, watch, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useProjectsStore } from "@/stores/projects";
import { useSearchStore } from "@/stores/search";
import type { SourceType } from "@/types";
import SourceFilter from "@/components/SourceFilter.vue";
import TimelineGroup from "@/components/TimelineGroup.vue";
import TimelineDayDivider from "@/components/TimelineDayDivider.vue";
import TimelineEntry from "@/components/TimelineEntry.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import { buildDaySections } from "@/utils/timeline-grouping";

const route = useRoute();
const projectsStore = useProjectsStore();
const searchStore = useSearchStore();

// ── Local filters (from URL params, non-persisted) ──────────
const activeSourceFilter = ref<SourceType | null>(null);
const activeProjectFilter = ref<string | null>(null);

onMounted(() => {
  const s = route.query.source;
  const p = route.query.project;
  if (typeof s === "string" && s) activeSourceFilter.value = s as SourceType;
  if (typeof p === "string" && p) activeProjectFilter.value = p;
});

const displayedEntries = computed(() => {
  let entries = projectsStore.timelineEntries;
  if (activeSourceFilter.value)
    entries = entries.filter((e) => e.meta.source === activeSourceFilter.value);
  if (activeProjectFilter.value)
    entries = entries.filter(
      (e) => e.projectId === activeProjectFilter.value,
    );
  return entries;
});

const daySections = computed(() => buildDaySections(displayedEntries.value));

// ── Search ──────────────────────────────────────────────────
const searchQuery = ref("");
const isSearchMode = computed(() => searchQuery.value.trim().length > 0);
let searchDebounce: ReturnType<typeof setTimeout> | null = null;

watch(searchQuery, (q) => {
  if (searchDebounce) clearTimeout(searchDebounce);
  if (!q.trim()) {
    searchStore.results.splice(0);
    currentMatchIdx.value = -1;
    return;
  }
  searchDebounce = setTimeout(() => {
    searchStore.search(q, 50);
    currentMatchIdx.value = 0;
  }, 220);
});

const visibleResults = computed(() => {
  let results = searchStore.results;
  if (activeSourceFilter.value)
    results = results.filter(
      (r) => r.entry.meta.source === activeSourceFilter.value,
    );
  if (activeProjectFilter.value)
    results = results.filter(
      (r) => r.entry.projectId === activeProjectFilter.value,
    );
  return results;
});

// ── Search navigation ───────────────────────────────────────
const currentMatchIdx = ref(-1);

/** Entry id of the currently focused search result (drives auto-expand for chats). */
const focusedEntryId = computed(
  () => visibleResults.value[currentMatchIdx.value]?.entry.id ?? null,
);

watch(currentMatchIdx, (idx) => {
  if (idx < 0 || idx >= visibleResults.value.length) return;
  const el = document.querySelector<HTMLElement>(
    `[data-search-idx="${idx}"]`,
  );
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
});

function prevMatch() {
  if (visibleResults.value.length === 0) return;
  currentMatchIdx.value =
    (currentMatchIdx.value - 1 + visibleResults.value.length) %
    visibleResults.value.length;
}
function nextMatch() {
  if (visibleResults.value.length === 0) return;
  currentMatchIdx.value =
    (currentMatchIdx.value + 1) % visibleResults.value.length;
}

// Initialise BM25 index when timeline data is loaded
watch(
  () => projectsStore.filteredEntries,
  (entries) => {
    if (searchStore.bm25DocCount === 0 && entries.length > 0) {
      searchStore.rebuildBM25Index(entries);
      searchStore.setEntries(entries);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="timeline">
    <header class="timeline__header">
      <h1 class="timeline__title">
        <span class="glow-text--magenta">Timeline</span>
      </h1>
      <p class="timeline__subtitle">Cross-project activity stream</p>
    </header>

    <!-- ── Search bar ─────────────────────────────────────── -->
    <div class="timeline__search">
      <div class="timeline__search-input-wrap">
        <span class="timeline__search-icon">◈</span>
        <input
          v-model="searchQuery"
          type="text"
          class="timeline__search-input"
          placeholder="Zoek commits, chats, auteurs, bestanden…"
        />
        <button
          v-if="searchQuery"
          class="timeline__search-clear"
          title="Wis zoekopdracht"
          @click="searchQuery = ''"
        >
          ×
        </button>
      </div>
      <!-- Mode badge + result count + prev/next (only in search mode) -->
      <div v-if="isSearchMode" class="timeline__search-controls">
        <span class="mode-badge">{{ searchStore.searchMode }}</span>
        <span class="timeline__search-count"
          >{{ visibleResults.length }} resultaten</span
        >
        <button
          class="timeline__nav-btn"
          :disabled="visibleResults.length === 0"
          title="Vorig resultaat"
          @click="prevMatch"
        >
          ↑
        </button>
        <button
          class="timeline__nav-btn"
          :disabled="visibleResults.length === 0"
          title="Volgend resultaat"
          @click="nextMatch"
        >
          ↓
        </button>
        <span v-if="currentMatchIdx >= 0 && visibleResults.length > 0" class="timeline__match-pos">
          {{ currentMatchIdx + 1 }} / {{ visibleResults.length }}
        </span>
      </div>
    </div>

    <!-- ── Active local filters ───────────────────────────── -->
    <div
      v-if="activeSourceFilter || activeProjectFilter"
      class="timeline__active-filters"
    >
      <span class="timeline__filter-label">Gefilterd op:</span>
      <span v-if="activeSourceFilter" class="filter-chip">
        {{ activeSourceFilter }}
        <button
          class="filter-chip__remove"
          @click="activeSourceFilter = null"
        >×</button>
      </span>
      <span v-if="activeProjectFilter" class="filter-chip filter-chip--project">
        {{ activeProjectFilter }}
        <button
          class="filter-chip__remove"
          @click="activeProjectFilter = null"
        >×</button>
      </span>
    </div>

    <SourceFilter />

    <!-- ── Search results (flat list) ────────────────────── -->
    <div v-if="isSearchMode" class="timeline__list">
      <template v-if="visibleResults.length > 0">
        <div
          v-for="(result, i) in visibleResults"
          :key="result.id"
          :data-search-idx="i"
          :class="{ 'search-current-entry': i === currentMatchIdx }"
        >
          <TimelineEntry
            :entry="result.entry"
            :searchQuery="searchQuery"
            :focusedEntryId="focusedEntryId ?? undefined"
          />
        </div>
      </template>
      <div
        v-else-if="!searchStore.isSearching"
        class="timeline__empty"
      >
        <div class="empty-state neon-card">
          <div class="empty-state__icon glow-text--magenta">◇</div>
          <h2>Geen resultaten</h2>
          <p>Geen entries gevonden voor "<strong>{{ searchQuery }}</strong>"</p>
        </div>
      </div>
    </div>

    <!-- ── Browse mode (day sections) ────────────────────── -->
    <template v-else>
      <!-- Loading skeletons: only before any entries are available -->
      <div
        v-if="projectsStore.loading && displayedEntries.length === 0"
        class="timeline__list"
      >
        <SkeletonCard v-for="i in 8" :key="i" :lines="3" />
      </div>

      <!-- Empty state: loading done, still nothing -->
      <div
        v-else-if="displayedEntries.length === 0"
        class="timeline__empty"
      >
        <div class="empty-state neon-card">
          <div class="empty-state__icon glow-text--magenta">◈</div>
          <h2>No activity yet</h2>
          <p>
            Activity from all your projects will appear here as a unified stream.
          </p>
        </div>
      </div>

      <!-- Timeline with day sections -->
      <div v-else class="timeline__list">
        <div
          v-for="section in daySections"
          :key="section.dateKey"
          class="timeline__day-section"
        >
          <TimelineDayDivider
            :label="section.label"
            :relativeLabel="section.relativeLabel"
            :ageInDays="section.ageInDays"
            :weekLabel="section.weekLabel"
          />
          <div class="timeline__entries">
            <TimelineGroup
              v-for="group in section.groups"
              :key="group.id"
              :group="group"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.timeline__header {
  margin-bottom: 1rem;
}

.timeline__title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.timeline__subtitle {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-top: 0.3rem;
}

/* ── Search bar ──────────────────────────────────────────── */
.timeline__search {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.timeline__search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 200px;
  max-width: 560px;
  background: var(--bg-card);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius);
  transition: border-color 0.2s ease;
}

.timeline__search-input-wrap:focus-within {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 0 1px rgba(0, 240, 255, 0.18);
}

.timeline__search-icon {
  padding: 0 0.6rem 0 0.8rem;
  color: var(--text-muted);
  font-size: 0.85rem;
  line-height: 1;
  pointer-events: none;
}

.timeline__search-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 0.88rem;
  padding: 0.55rem 0;
}

.timeline__search-input::placeholder {
  color: var(--text-muted);
}

.timeline__search-clear {
  padding: 0 0.65rem;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1;
  transition: color 0.2s ease;
}

.timeline__search-clear:hover {
  color: var(--neon-cyan);
}

.timeline__search-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.mode-badge {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--neon-cyan);
  background: rgba(0, 240, 255, 0.1);
  border: 1px solid rgba(0, 240, 255, 0.25);
  border-radius: 4px;
  padding: 0.2rem 0.45rem;
}

.timeline__search-count {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.timeline__nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.8rem;
  height: 1.8rem;
  background: rgba(0, 240, 255, 0.06);
  border: 1px solid rgba(0, 240, 255, 0.22);
  border-radius: 5px;
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.85rem;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
}

.timeline__nav-btn:hover:not(:disabled) {
  background: rgba(0, 240, 255, 0.14);
  border-color: rgba(0, 240, 255, 0.45);
  color: var(--neon-cyan);
}

.timeline__nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.timeline__match-pos {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Active local filters ────────────────────────────────── */
.timeline__active-filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.25rem;
}

.timeline__filter-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.2rem 0.5rem 0.2rem 0.65rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--neon-cyan);
  background: rgba(0, 240, 255, 0.1);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 20px;
}

.filter-chip--project {
  color: var(--neon-purple);
  background: rgba(139, 92, 246, 0.1);
  border-color: rgba(139, 92, 246, 0.3);
}

.filter-chip__remove {
  background: none;
  border: none;
  cursor: pointer;
  color: currentColor;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
  opacity: 0.7;
  transition: opacity 0.15s;
}

.filter-chip__remove:hover {
  opacity: 1;
}

/* ── current search result highlight ────────────────────── */
.search-current-entry {
  outline: 2px solid rgba(0, 240, 255, 0.45);
  outline-offset: 2px;
  border-radius: var(--radius);
}

/* ── Timeline grid ───────────────────────────────────────── */
.timeline__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.timeline__day-section {
  display: flex;
  flex-direction: column;
}

.timeline__entries {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-bottom: 1rem;
}

.timeline__empty {
  display: flex;
  justify-content: center;
  padding-top: 4rem;
}

.empty-state {
  text-align: center;
  max-width: 400px;
  padding: 3rem;
}

.empty-state__icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.empty-state h2 {
  font-size: 1.2rem;
  margin-bottom: 0.5rem;
}

.empty-state p {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
</style>
