<script setup lang="ts">
import { ref } from "vue";
import type { EntryGroup } from "@/utils/timeline-grouping";
import TimelineEntry from "./TimelineEntry.vue";

const { group, searchQuery, focusedEntryId } = defineProps<{
  group: EntryGroup;
  searchQuery?: string;
  focusedEntryId?: string;
}>();

const expanded = ref(false);

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
  "claude-chat": "neon-badge--claude-chat",
  teams: "neon-badge--teams",
  email: "neon-badge--email",
};

const sourceLabel: Record<string, string> = {
  commit: "commit",
  chat: "chat",
  "claude-chat": "claude",
  teams: "teams",
  email: "e-mail",
};
</script>

<template>
  <!-- Single entry: render as normal timeline card -->
  <TimelineEntry
    v-if="group.entries.length === 1"
    :entry="group.entries[0]"
    :searchQuery="searchQuery"
    :focusedEntryId="focusedEntryId"
  />

  <!-- Multiple consecutive entries: collapsible group -->
  <div
    v-else
    class="entry-group neon-card"
    :class="{ 'entry-group--collapsed': !expanded }"
    @click="!expanded && (expanded = true)"
  >
    <!-- Header -->
    <div class="entry-group__header">
      <div class="entry-group__meta">
        <span class="neon-badge" :class="badgeClass[group.source] ?? ''">
          {{ group.source }}
        </span>
        <span class="entry-group__count">
          {{ group.entries.length }}×
          {{ sourceLabel[group.source] ?? group.source }}
        </span>
      </div>
      <div class="entry-group__right">
        <span class="entry-group__time">{{ formatTime(group.timestamp) }}</span>
      </div>
    </div>

    <!-- Body: positioned container so leave-transitions can float without reserving space -->
    <div class="entry-group__body">
      <!-- Collapsed preview -->
      <Transition name="group-collapse">
        <div v-if="!expanded" class="entry-group__preview">
          <div
            v-for="entry in group.entries.slice(0, 3)"
            :key="entry.id"
            class="entry-group__preview-row"
          >
            <span class="entry-group__preview-dot">·</span>
            <span class="entry-group__preview-text" :title="entry.meta.title">
              {{ entry.meta.title }}
            </span>
          </div>
          <div v-if="group.entries.length > 3" class="entry-group__overflow">
            +{{ group.entries.length - 3 }} meer
          </div>
        </div>
      </Transition>

      <!-- Expanded: full entry cards inlined -->
      <Transition name="group-expand">
        <div v-if="expanded" class="entry-group__expanded">
          <TimelineEntry
            v-for="entry in group.entries"
            :key="entry.id"
            :entry="entry"
            :searchQuery="searchQuery"
            :focusedEntryId="focusedEntryId"
          />
        </div>
      </Transition>
    </div>

    <!-- Full-width expand / collapse bar -->
    <button
      class="entry-group__expand-bar"
      :class="{ 'entry-group__expand-bar--open': expanded }"
      @click.stop="expanded = !expanded"
    >
      <svg
        class="entry-group__expand-chevron"
        :class="{ 'entry-group__expand-chevron--open': expanded }"
        width="13" height="8"
        viewBox="0 0 13 8"
        fill="none"
        aria-hidden="true"
      >
        <path d="M1 1L6.5 7L12 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>{{ expanded ? "Inklappen" : `Bekijken (${group.entries.length})` }}</span>
    </button>
  </div>
</template>

<style scoped>
/* ── Group card ─────────────────────────────────────────── */
.entry-group {
  padding: 1rem 1.5rem;
  cursor: default;
}

.entry-group--collapsed {
  cursor: pointer;
}

.entry-group--collapsed:hover .entry-group__count {
  color: var(--neon-cyan);
}

.entry-group--collapsed:hover .entry-group__expand-bar {
  background: rgba(0, 240, 255, 0.09);
  border-top-color: rgba(0, 240, 255, 0.28);
  color: var(--neon-cyan);
}

/* ── Header ─────────────────────────────────────────────── */
.entry-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
}

.entry-group__meta {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.entry-group__count {
  font-size: 0.78rem;
  color: var(--text-secondary);
  font-weight: 500;
}

.entry-group__right {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.entry-group__time {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

/* ── Group expand / collapse bar ────────────────────────── */
.entry-group__expand-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  width: calc(100% + 3rem);
  margin: 0.75rem -1.5rem -1rem;
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

.entry-group__expand-bar:hover {
  background: rgba(0, 240, 255, 0.09);
  border-top-color: rgba(0, 240, 255, 0.28);
  color: var(--neon-cyan);
}

.entry-group__expand-bar--open {
  background: rgba(0, 240, 255, 0.06);
  border-top-color: rgba(0, 240, 255, 0.22);
  color: var(--neon-cyan);
}

.entry-group__expand-chevron {
  color: currentColor;
  flex-shrink: 0;
  transition: transform 0.25s var(--ease-out-expo);
}

.entry-group__expand-chevron--open {
  transform: rotate(180deg);
}

/* ── Collapsed preview ──────────────────────────────────── */
.entry-group__preview {
  margin-top: 0.55rem;
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
}

.entry-group__preview-row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.entry-group__preview-dot {
  color: var(--text-muted);
  flex-shrink: 0;
  line-height: 1.5;
}

.entry-group__preview-text {
  font-size: 0.78rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-family: "Cascadia Code", "Fira Code", monospace;
}

.entry-group__overflow {
  font-size: 0.7rem;
  color: var(--neon-cyan);
  opacity: 0.7;
  margin-top: 0.15rem;
}

/* ── Expanded entries ───────────────────────────────────── */
.entry-group__expanded {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.entry-group__item {
  padding: 0.65rem 0.85rem;
  background: var(--bg-surface);
  border-radius: var(--radius);
  border: 1px solid var(--border-dim);
}

.entry-group__item--clickable {
  cursor: pointer;
  transition: border-color 0.2s ease;
}

.entry-group__item--clickable:hover {
  border-color: rgba(0, 240, 255, 0.25);
}

.entry-group__item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25rem;
}

.entry-group__item-links {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.entry-group__item-link {
  font-size: 0.72rem;
  color: var(--text-muted);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.2s ease;
}

.entry-group__item-link:hover,
.entry-group__item--clickable:hover .entry-group__item-link--chat {
  color: var(--neon-cyan);
}

.entry-group__item-time {
  font-size: 0.66rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.entry-group__item-title {
  font-size: 0.87rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 0.25rem;
}

.entry-group__item-desc {
  font-size: 0.77rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 0.25rem;
}

/* ── File list inside expanded item ────────────────────── */
.entry-group__item-files {
  margin-top: 0.3rem;
  margin-bottom: 0.3rem;
}

.entry-group__item-files-toggle {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.entry-group__item-files-toggle:hover {
  color: var(--neon-purple);
}

.entry-group__item-files-chevron {
  font-size: 0.65rem;
  display: inline-block;
  transition: transform 0.2s var(--ease-out-expo);
}

.entry-group__item-files-chevron.open {
  transform: rotate(180deg);
}

.entry-group__item-files-list {
  list-style: none;
  margin-top: 0.3rem;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.entry-group__item-file {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.entry-group__item-file-status {
  font-size: 0.65rem;
  font-weight: 700;
  flex-shrink: 0;
  width: 1rem;
  text-align: center;
}

.entry-group__item-file-path {
  font-size: 0.72rem;
  color: var(--text-secondary);
  font-family: "Cascadia Code", "Fira Code", monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.entry-group__item-project {
  font-size: 0.66rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ── Body: positioned so absolute-leaving children don't escape ── */
.entry-group__body {
  position: relative;
}

/* ── Collapse / expand transitions ─────────────────────── */
/* Enter: slide + fade in */
.group-collapse-enter-active,
.group-expand-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s var(--ease-out-expo);
}

.group-collapse-enter-from,
.group-expand-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

/* Leave: float above layout — no space reserved, no jump */
.group-collapse-leave-active,
.group-expand-leave-active {
  position: absolute;
  width: 100%;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.group-collapse-leave-to,
.group-expand-leave-to {
  opacity: 0;
}
</style>
