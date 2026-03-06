<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed, ref } from 'vue'
import { useProjectsStore } from '@/stores/projects'

interface ConversationTurn {
  turnIndex: number
  timestamp: string
  userMessage: string
  aiResponse: string
  modelId: string
}

interface ParsedSession {
  id: string
  title: string
  turns: ConversationTurn[]
}

const route = useRoute()
const router = useRouter()
const projectsStore = useProjectsStore()

const projectId = computed(() => route.params.id as string)

const chatEntries = computed(() =>
  projectsStore.entriesForProject(projectId.value)
    .filter(e => e.meta.source === 'chat')
    .sort((a, b) => new Date(b.meta.timestamp).getTime() - new Date(a.meta.timestamp).getTime())
)

const expandedChat = ref<string | null>(null)
const loadedSessions = ref<Record<string, ParsedSession>>({})
const loadingSession = ref<string | null>(null)

async function toggleChat(id: string) {
  if (expandedChat.value === id) {
    expandedChat.value = null
    return
  }
  expandedChat.value = id
  if (!loadedSessions.value[id]) {
    loadingSession.value = id
    try {
      const res = await fetch(`/api/chat-session?id=${encodeURIComponent(id)}`)
      if (res.ok) {
        loadedSessions.value[id] = await res.json() as ParsedSession
      }
    } catch (err) {
      console.warn(`[ChatsView] Failed to load session ${id}:`, err)
    } finally {
      loadingSession.value = null
    }
  }
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
      <p class="chats-view__subtitle">{{ chatEntries.length }} sessions found</p>
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
        class="chat-session neon-card"
        :class="{ 'chat-session--expanded': expandedChat === entry.id }"
        @click="toggleChat(entry.id)"
      >
        <div class="chat-session__header">
          <div class="chat-session__meta">
            <h3 class="chat-session__title">{{ entry.meta.title }}</h3>
            <span class="chat-session__date">{{ formatDate(entry.meta.timestamp) }}</span>
          </div>
          <span class="chat-session__chevron">
            {{ expandedChat === entry.id ? '▾' : '▸' }}
          </span>
        </div>

        <!-- Description (always visible) -->
        <div v-if="entry.meta.description" class="chat-session__summary">
          {{ entry.meta.description }}
        </div>

        <!-- Expanded turns -->
        <Transition name="expand">
          <div v-if="expandedChat === entry.id" class="chat-session__messages">
            <div v-if="loadingSession === entry.id" class="chat-session__loading">
              Loading…
            </div>
            <template v-else-if="loadedSessions[entry.id]">
              <div
                v-for="turn in loadedSessions[entry.id].turns"
                :key="turn.turnIndex"
                class="chat-turn"
              >
                <div class="chat-message chat-message--user">
                  <span class="chat-message__role">user</span>
                  <div class="chat-message__content">{{ turn.userMessage }}</div>
                </div>
                <div class="chat-message chat-message--assistant">
                  <span class="chat-message__role">copilot</span>
                  <div class="chat-message__content">{{ turn.aiResponse }}</div>
                </div>
              </div>
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
  max-width: 800px;
}

.chat-session {
  cursor: pointer;
  transition: all 0.3s var(--ease-out-expo);
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
  font-size: 0.7rem;
  color: var(--text-muted);
}

.chat-session__chevron {
  color: var(--text-muted);
  font-size: 1rem;
  transition: color 0.2s ease;
}

.chat-session--expanded .chat-session__chevron {
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
  gap: 0.6rem;
}

.chat-message {
  padding: 0.6rem 0.8rem;
  border-radius: var(--radius);
  font-size: 0.8rem;
  line-height: 1.5;
}

.chat-message--user {
  background: rgba(255, 0, 170, 0.06);
  border-left: 2px solid var(--neon-magenta);
}

.chat-message--assistant {
  background: rgba(0, 240, 255, 0.04);
  border-left: 2px solid var(--neon-cyan);
}

.chat-message__role {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  margin-bottom: 0.3rem;
  display: block;
}

.chat-message__content {
  color: var(--text-secondary);
  white-space: pre-wrap;
}

.chat-session__loading {
  color: var(--text-muted);
  font-size: 0.8rem;
  padding: 0.5rem 0;
}

.chat-turn {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-dim);
}

.chat-turn:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

/* Expand transition */
.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s var(--ease-out-expo);
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}
</style>
