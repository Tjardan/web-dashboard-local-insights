<script setup lang="ts">
import type { InsightEntry } from '@/types'

defineProps<{
  entry: InsightEntry
}>()

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const badgeClass: Record<string, string> = {
  commit: 'neon-badge--commit',
  chat: 'neon-badge--chat',
  'file-change': 'neon-badge--file',
  teams: 'neon-badge--teams',
  email: 'neon-badge--email',
}
</script>

<template>
  <div class="timeline-entry neon-card">
    <div class="timeline-entry__header">
      <span class="neon-badge" :class="badgeClass[entry.meta.source] ?? ''">
        {{ entry.meta.source }}
      </span>
      <span class="timeline-entry__time">{{ formatTime(entry.meta.timestamp) }}</span>
    </div>

    <h3 class="timeline-entry__title">{{ entry.meta.title }}</h3>

    <p v-if="entry.meta.description" class="timeline-entry__desc">
      {{ entry.meta.description }}
    </p>

    <div class="timeline-entry__project">
      {{ entry.projectId }}
    </div>
  </div>
</template>

<style scoped>
.timeline-entry {
  padding: 1.2rem 1.5rem;
}

.timeline-entry__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.6rem;
}

.timeline-entry__time {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.timeline-entry__title {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 0.4rem;
  line-height: 1.4;
}

.timeline-entry__desc {
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 0.6rem;
}

.timeline-entry__project {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
</style>
