<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import type { EntryGroup } from "@/utils/timeline-grouping";
import type { InsightEntry } from "@/types";
import { useProjectsStore } from "@/stores/projects";
import { buildCommitUrl } from "@/utils/git-remote";
import TimelineEntry from "./TimelineEntry.vue";

const props = defineProps<{
  group: EntryGroup;
}>();

const router = useRouter();
const projectsStore = useProjectsStore();

const expanded = ref(false);

// Per-entry files toggle (key = entry.id)
const openFiles = ref<Record<string, boolean>>({});

function toggleFiles(id: string) {
  openFiles.value[id] = !openFiles.value[id];
}

function navigateEntry(entry: InsightEntry) {
  if (entry.meta.source === "chat") {
    const sessionId = entry.meta.extra?.sessionId as string | undefined;
    const dest = sessionId
      ? `/project/${entry.projectId}/chats?session=${encodeURIComponent(sessionId)}`
      : `/project/${entry.projectId}/chats`;
    router.push(dest);
  }
}

function getCommitUrl(entry: InsightEntry): string | null {
  if (entry.meta.source !== "commit") return null;
  const sha = entry.meta.extra?.sha as string | undefined;
  if (!sha) return null;
  const project = projectsStore.projects.find((p) => p.id === entry.projectId);
  return buildCommitUrl(project?.gitRemote, sha);
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

interface CommitFile {
  status: string;
  path: string;
}

function getFiles(entry: InsightEntry): CommitFile[] {
  const f = entry.meta.extra?.files;
  return Array.isArray(f) ? (f as CommitFile[]) : [];
}

const badgeClass: Record<string, string> = {
  commit: "neon-badge--commit",
  chat: "neon-badge--chat",
  teams: "neon-badge--teams",
  email: "neon-badge--email",
};

const sourceLabel: Record<string, string> = {
  commit: "commit",
  chat: "chat",
  teams: "teams",
  email: "e-mail",
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
  <!-- Single entry: render as normal timeline card -->
  <TimelineEntry v-if="group.entries.length === 1" :entry="group.entries[0]" />

  <!-- Multiple consecutive entries: collapsible group -->
  <div v-else class="entry-group neon-card">
    <!-- Header — always visible, click to toggle -->
    <div class="entry-group__header" @click="expanded = !expanded">
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
        <span
          class="entry-group__chevron"
          :class="{ 'entry-group__chevron--open': expanded }"
        >
          ▾
        </span>
      </div>
    </div>

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
        <div
          v-for="entry in group.entries"
          :key="entry.id"
          class="entry-group__item"
          :class="{
            'entry-group__item--clickable': entry.meta.source === 'chat',
          }"
          @click="navigateEntry(entry)"
        >
          <!-- Item header: time + link -->
          <div class="entry-group__item-header">
            <div class="entry-group__item-links">
              <a
                v-if="getCommitUrl(entry)"
                :href="getCommitUrl(entry)!"
                target="_blank"
                rel="noopener noreferrer"
                class="entry-group__item-link"
                title="Open commit"
                @click.stop
                >↗</a
              >
              <button
                v-else-if="entry.meta.source === 'commit'"
                class="entry-group__item-link"
                title="Ga naar project"
                @click.stop="router.push(`/project/${entry.projectId}`)"
              >
                ⬡
              </button>
              <span
                v-if="entry.meta.source === 'chat'"
                class="entry-group__item-link entry-group__item-link--chat"
                >›</span
              >
            </div>
            <span class="entry-group__item-time">{{
              formatTime(entry.meta.timestamp)
            }}</span>
          </div>

          <p class="entry-group__item-title">{{ entry.meta.title }}</p>
          <p v-if="entry.meta.description" class="entry-group__item-desc">
            {{ entry.meta.description }}
          </p>

          <!-- File list toggle for commits -->
          <div
            v-if="getFiles(entry).length > 0"
            class="entry-group__item-files"
          >
            <button
              class="entry-group__item-files-toggle"
              @click.stop="toggleFiles(entry.id)"
            >
              <span
                class="entry-group__item-files-chevron"
                :class="{ open: openFiles[entry.id] }"
                >▾</span
              >
              {{ getFiles(entry).length }} bestand{{
                getFiles(entry).length !== 1 ? "en" : ""
              }}
            </button>
            <Transition name="group-collapse">
              <ul
                v-if="openFiles[entry.id]"
                class="entry-group__item-files-list"
              >
                <li
                  v-for="f in getFiles(entry)"
                  :key="f.path"
                  class="entry-group__item-file"
                >
                  <span
                    class="entry-group__item-file-status"
                    :style="{
                      color: statusColor[f.status] ?? 'var(--text-muted)',
                    }"
                    >{{ statusIcon[f.status] ?? f.status }}</span
                  >
                  <span class="entry-group__item-file-path">{{ f.path }}</span>
                </li>
              </ul>
            </Transition>
          </div>

          <span class="entry-group__item-project">{{ entry.projectId }}</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
/* ── Group card ─────────────────────────────────────────── */
.entry-group {
  padding: 1rem 1.5rem;
  cursor: default;
}

/* ── Header ─────────────────────────────────────────────── */
.entry-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
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

.entry-group__chevron {
  font-size: 0.8rem;
  color: var(--text-muted);
  line-height: 1;
  transition: transform 0.25s var(--ease-out-expo);
  display: inline-block;
}

.entry-group__chevron--open {
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

/* ── Collapse / expand transitions ─────────────────────── */
.group-collapse-enter-active,
.group-collapse-leave-active,
.group-expand-enter-active,
.group-expand-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s var(--ease-out-expo);
  overflow: hidden;
}

.group-collapse-enter-from,
.group-collapse-leave-to,
.group-expand-enter-from,
.group-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
