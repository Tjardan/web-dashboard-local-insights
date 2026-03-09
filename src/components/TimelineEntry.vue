<script setup lang="ts">
import { ref, computed, watchEffect, nextTick } from "vue";
import { useRouter } from "vue-router";
import type { InsightEntry } from "@/types";
import { useProjectsStore } from "@/stores/projects";
import { buildCommitUrl } from "@/utils/git-remote";
import { highlightText, extractSnippet } from "@/utils/highlight-text";
import ChatTurn from "@/components/ChatTurn.vue";

const props = defineProps<{
  entry: InsightEntry;
  searchQuery?: string;
  /** When set to this entry's id, auto-expand the chat inline. */
  focusedEntryId?: string;
}>();

const router = useRouter();
const projectsStore = useProjectsStore();

// Commit file list is open by default; stays open during search
const filesOpen = ref(props.entry.meta.source === "commit");

watchEffect(() => {
  if (props.entry.meta.source === "commit" && props.searchQuery?.trim()) {
    filesOpen.value = true;
  }
});

const project = computed(() =>
  projectsStore.projects.find((p) => p.id === props.entry.projectId),
);

interface CommitFile {
  status: string;
  path: string;
}

const commitFiles = computed<CommitFile[]>(() => {
  const f = props.entry.meta.extra?.files;
  return Array.isArray(f) ? (f as CommitFile[]) : [];
});

const commitUrl = computed(() => {
  if (props.entry.meta.source !== "commit") return null;
  const sha = props.entry.meta.extra?.sha as string | undefined;
  return sha ? buildCommitUrl(project.value?.gitRemote, sha) : null;
});

// ── Highlighting helpers ────────────────────────────────────
const titleHtml = computed(() =>
  props.searchQuery
    ? highlightText(props.entry.meta.title, props.searchQuery)
    : null,
);
const descHtml = computed(() =>
  props.searchQuery && props.entry.meta.description
    ? highlightText(props.entry.meta.description, props.searchQuery)
    : null,
);

/** Snippet showing the surrounding context of the first matched word. */
const snippetHtml = computed((): string | null => {
  const q = props.searchQuery;
  if (!q?.trim()) return null;
  // Don't show snippet when the match is already fully visible in title/desc
  const titleMatch = !!props.entry.meta.title
    .toLowerCase()
    .match(new RegExp(q.trim().split(/\s+/).join("|"), "i"));
  if (titleMatch) return null; // title already highlighted above, no extra snippet needed

  if (props.entry.meta.source === "commit") {
    // File paths are indexed but not shown in title/desc — show matching path
    const fileCandidates = commitFiles.value.map((f) => ({
      text: f.path,
      prefix: "Bestand",
    }));
    return extractSnippet(
      [{ text: props.entry.meta.description ?? "" }, ...fileCandidates],
      q,
    );
  }

  return extractSnippet(
    [
      { text: props.entry.meta.description ?? "" },
      { text: props.entry.projectId.replace(/-/g, " ") },
    ],
    q,
  );
});

// ── Inline chat session expansion ───────────────────────────
interface ToolCallInfo {
  toolId: string;
  label: string;
  args: Record<string, unknown> | null;
  result?: string;
}
interface ConversationTurn {
  turnIndex: number;
  timestamp: string;
  userMessage: string;
  aiResponse: string;
  modelId: string;
  toolCalls: ToolCallInfo[];
}
interface ParsedSession {
  id: string;
  title: string;
  turns: ConversationTurn[];
}

const sessionId = computed(
  () => props.entry.meta.extra?.sessionId as string | undefined,
);
const isExpanded = ref(false);
const loadedSession = ref<ParsedSession | null>(null);
const isLoadingSession = ref(false);
const copiedSession = ref(false);

async function loadSession(id: string) {
  if (loadedSession.value) return;
  isLoadingSession.value = true;
  try {
    const res = await fetch(`/api/chat-session?id=${encodeURIComponent(id)}`);
    if (res.ok) {
      const session = (await res.json()) as ParsedSession;
      session.turns = session.turns.map((t) => ({
        ...t,
        toolCalls: t.toolCalls ?? [],
      }));
      loadedSession.value = session;
    }
  } catch (err) {
    console.warn(`[TimelineEntry] Failed to load session ${id}:`, err);
  } finally {
    isLoadingSession.value = false;
  }
}

async function toggleChat() {
  if (!sessionId.value) return;
  isExpanded.value = !isExpanded.value;
  if (isExpanded.value) await loadSession(sessionId.value);
}

// Auto-expand this chat when it becomes the focused search result
watchEffect(() => {
  if (
    props.focusedEntryId === props.entry.id &&
    props.entry.meta.source === "chat" &&
    !isExpanded.value
  ) {
    toggleChat();
  }
});

/**
 * Index of the first turn that contains the search query.
 * Used for initiallyExpanded and auto-scrolling.
 */
const matchingTurnIdx = computed((): number => {
  if (!loadedSession.value || !props.searchQuery?.trim()) return 0;
  const words = props.searchQuery.trim().split(/\s+/).filter(Boolean);
  const pattern = new RegExp(
    words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "i",
  );
  const idx = loadedSession.value.turns.findIndex(
    (t) => pattern.test(t.userMessage) || pattern.test(t.aiResponse),
  );
  return idx >= 0 ? idx : 0;
});

/** After a session loads with an active query, scroll the matching turn into view. */
async function scrollToMatchingTurn() {
  if (!props.searchQuery?.trim() || matchingTurnIdx.value === 0) return;
  await nextTick();
  const el = document.querySelector<HTMLElement>(
    `[data-session-id="${CSS.escape(sessionId.value ?? "")}"] [data-turn-idx="${matchingTurnIdx.value}"]`,
  );
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copySessionMarkdown() {
  const session = loadedSession.value;
  if (!session) return;
  const lines: string[] = [`# ${session.title}`, ""];
  for (const turn of session.turns) {
    lines.push("---", "");
    lines.push(
      `## Turn ${turn.turnIndex + 1}${turn.modelId ? ` · \`${turn.modelId}\`` : ""}`,
      "",
    );
    if (turn.userMessage) lines.push("**User:**", "", turn.userMessage, "");
    if ((turn.toolCalls ?? []).length > 0) {
      for (const tc of turn.toolCalls) lines.push(`> ⚙ \`${tc.label}\``);
      lines.push("");
    }
    if (turn.aiResponse) lines.push("**Copilot:**", "", turn.aiResponse, "");
  }
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copiedSession.value = true;
    setTimeout(() => (copiedSession.value = false), 2200);
  } catch {
    /* clipboard unavailable */
  }
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "zojuist";
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}u`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("nl-NL", { month: "short", day: "numeric" });
}

const badgeClass: Record<string, string> = {
  commit: "neon-badge--commit",
  chat: "neon-badge--chat",
  teams: "neon-badge--teams",
  email: "neon-badge--email",
};

const statusIcon: Record<string, string> = {
  A: "✚",
  M: "●",
  D: "✕",
  R: "→",
  C: "⧉",
};
const statusColor: Record<string, string> = {
  A: "var(--neon-green)",
  M: "var(--neon-cyan)",
  D: "var(--neon-magenta)",
  R: "var(--neon-yellow)",
  C: "var(--neon-purple)",
};
</script>

<template>
  <div
    class="timeline-entry neon-card"
    :class="{
      'timeline-entry--clickable': entry.meta.source === 'chat',
      'timeline-entry--expanded': entry.meta.source === 'chat' && isExpanded,
    }"
    :data-session-id="sessionId ?? undefined"
    @click="entry.meta.source === 'chat' ? toggleChat() : undefined"
  >
    <div class="timeline-entry__header">
      <div class="timeline-entry__header-left">
        <span class="neon-badge" :class="badgeClass[entry.meta.source] ?? ''">
          {{ entry.meta.source }}
        </span>
        <!-- External link for commits -->
        <a
          v-if="commitUrl"
          :href="commitUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="timeline-entry__commit-chip"
          title="Open commit in browser"
          @click.stop
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 2h6v6M2 8l6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Open commit
        </a>
        <!-- Fallback: navigate to project when no remote -->
        <button
          v-else-if="entry.meta.source === 'commit'"
          class="timeline-entry__commit-chip"
          title="Ga naar project"
          @click.stop="router.push(`/project/${entry.projectId}`)"
        >
          ⬡ Project
        </button>
      </div>
      <div class="timeline-entry__header-right">
        <span class="timeline-entry__time">{{
          formatTime(entry.meta.timestamp)
        }}</span>
      </div>
    </div>

    <!-- Title row -->
    <div class="timeline-entry__title-row">
      <h3
        v-if="titleHtml"
        class="timeline-entry__title"
        v-html="titleHtml"
      />
      <h3 v-else class="timeline-entry__title">{{ entry.meta.title }}</h3>
    </div>

    <!-- Description: highlighted when searchQuery is set -->
    <p
      v-if="descHtml"
      class="timeline-entry__desc"
      v-html="descHtml"
    />
    <p v-else-if="entry.meta.description" class="timeline-entry__desc">
      {{ entry.meta.description }}
    </p>

    <!-- Match context snippet (only in search mode, when match is NOT in title) -->
    <div
      v-if="snippetHtml"
      class="timeline-entry__snippet"
      v-html="snippetHtml"
    />

    <!-- File list for commits (list only — toggle is in the title row) -->
    <div v-if="commitFiles.length > 0" class="timeline-entry__files">
      <Transition name="files-expand">
        <ul v-if="filesOpen" class="timeline-entry__files-list">
          <li
            v-for="f in commitFiles"
            :key="f.path"
            class="timeline-entry__file"
          >
            <span
              class="timeline-entry__file-status"
              :style="{ color: statusColor[f.status] ?? 'var(--text-muted)' }"
              >{{ statusIcon[f.status] ?? f.status }}</span
            >
            <span class="timeline-entry__file-path">{{ f.path }}</span>
          </li>
        </ul>
      </Transition>
    </div>

    <div class="timeline-entry__footer">
      <span class="timeline-entry__project">{{ entry.projectId }}</span>
    </div>

    <!-- Expand bar for commit file list -->
    <button
      v-if="commitFiles.length > 0"
      class="timeline-entry__expand-bar"
      :class="{ 'timeline-entry__expand-bar--open': filesOpen }"
      @click.stop="filesOpen = !filesOpen"
    >
      <svg
        class="timeline-entry__expand-chevron"
        :class="{ 'timeline-entry__expand-chevron--open': filesOpen }"
        width="13" height="8"
        viewBox="0 0 13 8"
        fill="none"
        aria-hidden="true"
      >
        <path d="M1 1L6.5 7L12 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>{{ filesOpen ? "Inklappen" : `${commitFiles.length} bestand${commitFiles.length !== 1 ? 'en' : ''}` }}</span>
    </button>

    <!-- Expand bar for chat entries -->
    <button
      v-if="entry.meta.source === 'chat'"
      class="timeline-entry__expand-bar"
      :class="{ 'timeline-entry__expand-bar--open': isExpanded }"
      @click.stop="toggleChat()"
    >
      <svg
        class="timeline-entry__expand-chevron"
        :class="{ 'timeline-entry__expand-chevron--open': isExpanded }"
        width="13" height="8"
        viewBox="0 0 13 8"
        fill="none"
        aria-hidden="true"
      >
        <path d="M1 1L6.5 7L12 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>{{ isExpanded ? "Inklappen" : "Chat lezen" }}</span>
    </button>

    <!-- ── Inline chat session expansion ──────────────────── -->
    <Transition name="chat-expand">
      <div
        v-if="entry.meta.source === 'chat' && isExpanded"
        class="timeline-entry__session"
        :data-session-id="sessionId ?? undefined"
        @click.stop
      >
        <div v-if="isLoadingSession" class="timeline-entry__session-loading">
          Laden…
        </div>
        <template v-else-if="loadedSession">
          <div class="timeline-entry__session-copy-bar">
            <button
              class="copy-md-btn"
              @click.stop="copySessionMarkdown"
            >
              {{ copiedSession ? "✓ Gekopieerd!" : "⎘ Kopieer als Markdown" }}
            </button>
          </div>
          <div
            v-for="turn in loadedSession.turns"
            :key="turn.turnIndex"
            :data-turn-idx="turn.turnIndex"
          >
            <ChatTurn
              :turn="turn"
              :initiallyExpanded="turn.turnIndex === matchingTurnIdx"
              :searchQuery="searchQuery"
              @vue:mounted="turn.turnIndex === matchingTurnIdx && matchingTurnIdx !== 0 ? scrollToMatchingTurn() : null"
            />
          </div>
        </template>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.timeline-entry {
  padding: 1.2rem 1.5rem;
  position: relative; /* anchor for absolutely-positioned leave transitions */
}

.timeline-entry--clickable {
  cursor: pointer;
  border-left: 3px solid rgba(0, 240, 255, 0.18);
  transition: all 0.3s var(--ease-out-expo), border-left-color 0.2s;
}

.timeline-entry--clickable:hover {
  border-left-color: rgba(0, 240, 255, 0.55);
}

.timeline-entry--expanded {
  border-color: rgba(0, 240, 255, 0.35);
  border-left-color: var(--neon-cyan) !important;
  box-shadow: 0 0 0 1px rgba(0, 240, 255, 0.12);
}

/* ── Header ──────────────────────────────────────────────── */
.timeline-entry__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}

.timeline-entry__header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.timeline-entry__header-right {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.timeline-entry__time {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

/* Commit action chip */
.timeline-entry__commit-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.55rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--neon-green);
  background: rgba(57, 255, 20, 0.07);
  border: 1px solid rgba(57, 255, 20, 0.3);
  border-radius: 4px;
  cursor: pointer;
  text-decoration: none;
  font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}

.timeline-entry__commit-chip:hover {
  background: rgba(57, 255, 20, 0.14);
  border-color: rgba(57, 255, 20, 0.7);
  color: var(--neon-green);
}

/* ── Title row ───────────────────────────────────────────── */
.timeline-entry__title-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin-bottom: 0.4rem;
}

.timeline-entry__title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  flex: 1;
  min-width: 0;
}

.timeline-entry__desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 0.45rem;
}

/* ── File list ───────────────────────────────────────────── */
.timeline-entry__files {
  margin-top: 0.4rem;
  margin-bottom: 0.45rem;
  position: relative;
}

.timeline-entry__files-list {
  list-style: none;
  margin-top: 0.35rem;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  padding-left: 0.2rem;
}

.timeline-entry__file {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  min-width: 0;
}

.timeline-entry__file-status {
  font-size: 0.7rem;
  font-weight: 700;
  flex-shrink: 0;
  width: 1rem;
  text-align: center;
}

.timeline-entry__file-path {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: "Cascadia Code", "Fira Code", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

/* ── Footer ──────────────────────────────────────────────── */
.timeline-entry__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.45rem;
}

.timeline-entry__project {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── Chat expand bar ─────────────────────────────────────── */
.timeline-entry__expand-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: calc(100% + 3rem);
  margin: 0.75rem -1.5rem -1.2rem;
  padding: 0.55rem 1.5rem;
  background: rgba(0, 240, 255, 0.04);
  border: none;
  border-top: 1px solid rgba(0, 240, 255, 0.1);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  letter-spacing: 0.03em;
  transition: background 0.2s, color 0.2s, border-top-color 0.2s;
}

.timeline-entry__expand-bar:hover {
  background: rgba(0, 240, 255, 0.09);
  border-top-color: rgba(0, 240, 255, 0.28);
  color: var(--neon-cyan);
}

.timeline-entry__expand-bar--open {
  background: rgba(0, 240, 255, 0.06);
  border-top-color: rgba(0, 240, 255, 0.22);
  color: var(--neon-cyan);
}

.timeline-entry__expand-chevron {
  color: currentColor;
  flex-shrink: 0;
  transition: transform 0.25s var(--ease-out-expo);
}

.timeline-entry__expand-chevron--open {
  transform: rotate(180deg);
}

/* ── Match context snippet ───────────────────────────────── */
.timeline-entry__snippet {
  margin-top: 0.4rem;
  padding: 0.4rem 0.65rem;
  background: rgba(255, 230, 0, 0.05);
  border-left: 2px solid rgba(255, 230, 0, 0.35);
  border-radius: 0 var(--radius) var(--radius) 0;
  font-size: 0.78rem;
  color: var(--text-secondary);
  line-height: 1.55;
  word-break: break-word;
}

/* ── Files transition ────────────────────────────────────── */
.files-expand-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s var(--ease-out-expo);
}

.files-expand-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

/* Leave: float — no space reserved, footer/bar don't jump */
.files-expand-leave-active {
  position: absolute;
  width: 100%;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.files-expand-leave-to {
  opacity: 0;
}

/* ── Inline chat session ─────────────────────────────────── */
.timeline-entry__session {
  margin-top: 1rem;
  border-top: 1px solid var(--border-dim);
  padding-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.timeline-entry__session > *:not(:last-child) {
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-dim);
}

.timeline-entry__session-loading {
  font-size: 0.85rem;
  color: var(--text-secondary);
  padding: 0.5rem 0;
}

.timeline-entry__session-copy-bar {
  display: flex;
  justify-content: flex-end;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--border-dim);
  margin-bottom: 0.35rem;
}

.copy-md-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.28rem 0.75rem;
  background: rgba(0, 240, 255, 0.06);
  border: 1px solid rgba(0, 240, 255, 0.22);
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.78rem;
  color: rgba(0, 240, 255, 0.8);
  transition:
    background 0.15s,
    border-color 0.15s,
    color 0.15s;
  white-space: nowrap;
}

.copy-md-btn:hover {
  background: rgba(0, 240, 255, 0.12);
  border-color: rgba(0, 240, 255, 0.45);
  color: var(--neon-cyan);
}

/* Expand transition */
.chat-expand-enter-active {
  transition:
    opacity 0.3s var(--ease-out-expo),
    transform 0.35s var(--ease-out-expo);
}

.chat-expand-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

/* Leave: float — card shrinks immediately, session fades in place */
.chat-expand-leave-active {
  position: absolute;
  width: 100%;
  pointer-events: none;
  transition: opacity 0.2s ease;
}

.chat-expand-leave-to {
  opacity: 0;
}
</style>
