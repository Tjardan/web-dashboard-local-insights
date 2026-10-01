<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { computed, ref, onMounted, nextTick } from "vue";
import { useProjectsStore } from "@/stores/projects";
import ChatTurn from "@/components/ChatTurn.vue";
import type { InsightEntry } from "@/types";
import { chatSessionUrl, isChatEntry } from "@/utils/chat-source";

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

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();

const projectId = computed(() => route.params.id as string);

const chatEntries = computed(() =>
  projectsStore
    .entriesForProject(projectId.value)
    .filter((e) => isChatEntry(e))
    .sort(
      (a, b) =>
        new Date(b.meta.timestamp).getTime() -
        new Date(a.meta.timestamp).getTime(),
    ),
);

const expandedChat = ref<string | null>(null);
const loadedSessions = ref<Record<string, ParsedSession>>({});
const loadingSession = ref<string | null>(null);

async function toggleChat(entry: InsightEntry) {
  if (expandedChat.value === entry.id) {
    expandedChat.value = null;
    return;
  }
  expandedChat.value = entry.id;
  await loadSession(entry);
}

/**
 * Takes the whole entry, not just an ID: the URL needs the source as well, and
 * a Claude entry's `id` carries a `claude:` prefix the API does not accept.
 */
async function loadSession(entry: InsightEntry) {
  const id = entry.id;
  if (loadedSessions.value[id]) return;
  loadingSession.value = id;
  try {
    const res = await fetch(chatSessionUrl(entry));
    if (res.ok) {
      const session = (await res.json()) as ParsedSession;
      // Normalize: older compiled package versions may omit toolCalls
      session.turns = session.turns.map((t) => ({
        ...t,
        toolCalls: t.toolCalls ?? [],
      }));
      loadedSessions.value[id] = session;
    }
  } catch (err) {
    console.warn(`[ChatsView] Failed to load session ${id}:`, err);
  } finally {
    loadingSession.value = null;
  }
}

onMounted(async () => {
  const targetSession = route.query.session as string | undefined;
  if (!targetSession) return;
  const entry = chatEntries.value.find((e) => e.id === targetSession);
  if (!entry) return;
  expandedChat.value = targetSession;
  await loadSession(entry);
  await nextTick();
  const el = document.querySelector<HTMLElement>(
    `[data-session-id="${CSS.escape(targetSession)}"]`,
  );
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
});

const copiedSession = ref<string | null>(null);

async function copySessionMarkdown(id: string) {
  const session = loadedSessions.value[id];
  if (!session) return;
  const lines: string[] = [];
  lines.push(`# ${session.title}`, "");
  for (const turn of session.turns) {
    lines.push("---", "");
    lines.push(
      `## Turn ${turn.turnIndex + 1}${turn.modelId ? ` · \`${turn.modelId}\`` : ""}`,
      "",
    );
    if (turn.userMessage) {
      lines.push("**User:**", "", turn.userMessage, "");
    }
    if ((turn.toolCalls ?? []).length > 0) {
      for (const tc of turn.toolCalls) {
        lines.push(`> ⚙ \`${tc.label}\``);
      }
      lines.push("");
    }
    if (turn.aiResponse) {
      lines.push("**Copilot:**", "", turn.aiResponse, "");
    }
  }
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copiedSession.value = id;
    setTimeout(() => {
      copiedSession.value = null;
    }, 2200);
  } catch {
    // clipboard unavailable
  }
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString("nl-NL", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <div class="chats-view">
    <header class="chats-view__header">
      <button class="back-btn" @click="router.push(`/project/${projectId}`)">
        ← Back to project
      </button>
      <h1 class="chats-view__title">
        <span class="glow-text">Copilot Chats</span>
      </h1>
      <p class="chats-view__subtitle">
        {{ chatEntries.length }} sessions found
      </p>
    </header>

    <div v-if="chatEntries.length === 0" class="chats-view__empty neon-card">
      <div class="empty-icon glow-text">◈</div>
      <h2>No chat sessions found</h2>
      <p>Copilot chat sessions for this project will appear here.</p>
    </div>

    <div v-else class="chats-view__list">
      <div
        v-for="entry in chatEntries"
        :key="entry.id"
        :data-session-id="entry.id"
        class="chat-session neon-card"
        :class="{ 'chat-session--expanded': expandedChat === entry.id }"
      >
        <div class="chat-session__header" @click="toggleChat(entry)">
          <div class="chat-session__meta">
            <h3 class="chat-session__title">{{ entry.meta.title }}</h3>
            <span class="chat-session__date">{{
              formatDate(entry.meta.timestamp)
            }}</span>
          </div>
          <button
            class="chat-session__chevron-btn"
            :aria-label="expandedChat === entry.id ? 'Inklappen' : 'Uitklappen'"
          >
            <svg
              class="chat-session__chevron"
              :class="{
                'chat-session__chevron--open': expandedChat === entry.id,
              }"
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M3 5.5L8 10.5L13 5.5"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>

        <!-- Description (always visible) -->
        <div v-if="entry.meta.description" class="chat-session__summary">
          {{ entry.meta.description }}
        </div>

        <!-- Expanded turns -->
        <Transition name="expand">
          <div
            v-if="expandedChat === entry.id"
            class="chat-session__messages"
            @click.stop
          >
            <div
              v-if="loadingSession === entry.id"
              class="chat-session__loading"
            >
              Loading…
            </div>
            <template v-else-if="loadedSessions[entry.id]">
              <div class="chat-session__copy-bar">
                <button
                  class="copy-md-btn"
                  @click.stop="copySessionMarkdown(entry.id)"
                >
                  {{
                    copiedSession === entry.id
                      ? "✓ Gekopieerd!"
                      : "⎘ Kopieer als Markdown"
                  }}
                </button>
              </div>
              <ChatTurn
                v-for="turn in loadedSessions[entry.id].turns"
                :key="turn.turnIndex"
                :turn="turn"
                :initiallyExpanded="turn.turnIndex === 0"
              />
            </template>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chats-view__header {
  margin-bottom: 1.5rem;
}

.back-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0.3rem 0;
  margin-bottom: 1rem;
  transition: color 0.2s ease;
}

.back-btn:hover {
  color: var(--neon-cyan);
}

.chats-view__title {
  font-size: 1.8rem;
  font-weight: 800;
}

.chats-view__subtitle {
  color: var(--text-secondary);
  font-size: 0.85rem;
  margin-top: 0.3rem;
}

.chats-view__empty {
  text-align: center;
  padding: 3rem;
  max-width: 400px;
}

.chats-view__empty .empty-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.chats-view__empty h2 {
  margin-bottom: 0.5rem;
}

.chats-view__empty p {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.chats-view__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  max-width: 1200px;
}

.chat-session {
  cursor: default;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

/* Override neon-card hover: darken instead of lighten for better text contrast */
.chat-session:hover {
  background: #0e0e1a;
  transform: none;
}

.chat-session__header {
  cursor: pointer;
}

.chat-session__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.chat-session__title {
  font-size: 0.95rem;
  font-weight: 600;
  margin-bottom: 0.2rem;
}

.chat-session__date {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.chat-session__chevron-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  background: rgba(0, 240, 255, 0.06);
  border: 1px solid rgba(0, 240, 255, 0.2);
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

.chat-session__header:hover .chat-session__chevron-btn {
  background: rgba(0, 240, 255, 0.12);
  border-color: rgba(0, 240, 255, 0.45);
}

.chat-session--expanded .chat-session__chevron-btn {
  background: rgba(0, 240, 255, 0.12);
  border-color: rgba(0, 240, 255, 0.45);
}

.chat-session__chevron {
  color: var(--text-muted);
  display: block;
  flex-shrink: 0;
  transition:
    transform 0.25s var(--ease-out-expo),
    color 0.2s ease;
  transform: rotate(0deg);
}

.chat-session__chevron--open {
  transform: rotate(180deg);
  color: var(--neon-cyan);
}

.chat-session__summary {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: rgba(0, 240, 255, 0.04);
  border-left: 2px solid var(--neon-cyan);
  border-radius: 0 var(--radius) var(--radius) 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.chat-session__messages {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.chat-session__loading {
  color: var(--text-secondary);
  font-size: 0.85rem;
  padding: 0.5rem 0;
}

/* Divider between turns */
.chat-session__messages > *:not(:last-child) {
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-dim);
}

/* Expand transition */
.expand-enter-active,
.expand-leave-active {
  transition:
    opacity 0.3s var(--ease-out-expo),
    transform 0.35s var(--ease-out-expo);
}

.expand-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}

.expand-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

/* ── Copy-as-markdown bar ── */
.chat-session__copy-bar {
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
</style>
