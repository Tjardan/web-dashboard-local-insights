<script setup lang="ts">
import { ref, computed } from "vue";
import { useRouter } from "vue-router";
import type { InsightEntry } from "@/types";
import { useProjectsStore } from "@/stores/projects";
import { buildCommitUrl } from "@/utils/git-remote";

const props = defineProps<{ entry: InsightEntry }>();

const router = useRouter();
const projectsStore = useProjectsStore();

const filesOpen = ref(false);

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

function handleClick() {
  if (props.entry.meta.source === "chat") {
    const sessionId = props.entry.meta.extra?.sessionId as string | undefined;
    const dest = sessionId
      ? `/project/${props.entry.projectId}/chats?session=${encodeURIComponent(sessionId)}`
      : `/project/${props.entry.projectId}/chats`;
    router.push(dest);
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
    :class="{ 'timeline-entry--clickable': entry.meta.source === 'chat' }"
    @click="handleClick"
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
          class="timeline-entry__ext-link"
          title="Open commit in browser"
          @click.stop
          >↗</a
        >
        <!-- Fallback: navigate to project when no remote -->
        <button
          v-else-if="entry.meta.source === 'commit'"
          class="timeline-entry__ext-link timeline-entry__ext-link--internal"
          title="Ga naar project"
          @click.stop="router.push(`/project/${entry.projectId}`)"
        >
          ⬡
        </button>
      </div>
      <span class="timeline-entry__time">{{
        formatTime(entry.meta.timestamp)
      }}</span>
    </div>

    <h3 class="timeline-entry__title">{{ entry.meta.title }}</h3>

    <p v-if="entry.meta.description" class="timeline-entry__desc">
      {{ entry.meta.description }}
    </p>

    <!-- File list for commits -->
    <div v-if="commitFiles.length > 0" class="timeline-entry__files">
      <button
        class="timeline-entry__files-toggle"
        @click.stop="filesOpen = !filesOpen"
      >
        <span class="timeline-entry__files-chevron" :class="{ open: filesOpen }"
          >▾</span
        >
        {{ commitFiles.length }} bestand{{
          commitFiles.length !== 1 ? "en" : ""
        }}
        gewijzigd
      </button>
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
      <span
        v-if="entry.meta.source === 'chat'"
        class="timeline-entry__chat-hint"
      >
        klik om te openen ›
      </span>
    </div>
  </div>
</template>

<style scoped>
.timeline-entry {
  padding: 1.2rem 1.5rem;
}

.timeline-entry--clickable {
  cursor: pointer;
}

.timeline-entry--clickable:hover .timeline-entry__chat-hint {
  color: var(--neon-cyan);
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

.timeline-entry__time {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

/* External / internal link icon */
.timeline-entry__ext-link {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-decoration: none;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  transition: color 0.2s ease;
}

.timeline-entry__ext-link:hover {
  color: var(--neon-cyan);
}

/* ── Body ────────────────────────────────────────────────── */
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
  margin-bottom: 0.45rem;
}

/* ── File list ───────────────────────────────────────────── */
.timeline-entry__files {
  margin-top: 0.4rem;
  margin-bottom: 0.45rem;
}

.timeline-entry__files-toggle {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.74rem;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

.timeline-entry__files-toggle:hover {
  color: var(--neon-purple);
}

.timeline-entry__files-chevron {
  font-size: 0.7rem;
  display: inline-block;
  transition: transform 0.2s var(--ease-out-expo);
}

.timeline-entry__files-chevron.open {
  transform: rotate(180deg);
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

.timeline-entry__chat-hint {
  font-size: 0.68rem;
  color: var(--text-muted);
  transition: color 0.2s ease;
}

/* ── Files transition ────────────────────────────────────── */
.files-expand-enter-active,
.files-expand-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s var(--ease-out-expo);
  overflow: hidden;
}

.files-expand-enter-from,
.files-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
