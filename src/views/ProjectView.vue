<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { computed } from "vue";
import { useProjectsStore } from "@/stores/projects";
import SourceFilter from "@/components/SourceFilter.vue";
import TimelineGroup from "@/components/TimelineGroup.vue";
import TimelineDayDivider from "@/components/TimelineDayDivider.vue";
import { buildDaySections } from "@/utils/timeline-grouping";

const route = useRoute();
const router = useRouter();
const projectsStore = useProjectsStore();

const projectId = computed(() => route.params.id as string);
const project = computed(() =>
  projectsStore.projects.find((p) => p.id === projectId.value),
);
const entries = computed(() =>
  projectsStore
    .entriesForProject(projectId.value)
    .sort(
      (a, b) =>
        new Date(b.meta.timestamp).getTime() -
        new Date(a.meta.timestamp).getTime(),
    ),
);

const daySections = computed(() => buildDaySections(entries.value));

function openChats() {
  router.push(`/project/${projectId.value}/chats`);
}
</script>

<template>
  <div class="project-view">
    <header class="project-view__header">
      <button class="back-btn" @click="router.push('/')">← Back</button>

      <div v-if="project" class="project-view__info">
        <h1 class="project-view__title glow-text">{{ project.name }}</h1>
        <p class="project-view__path">{{ project.path }}</p>
        <div v-if="project.gitRemote" class="project-view__remote">
          <span class="neon-badge neon-badge--commit">git</span>
          <span>{{ project.gitRemote }}</span>
        </div>
      </div>

      <div v-else class="project-view__not-found">
        <h1>Project not found</h1>
      </div>
    </header>

    <div class="project-view__actions">
      <button class="neon-btn" @click="openChats">
        <span>◈ View Chats</span>
      </button>
      <button
        class="neon-btn neon-btn--magenta"
        @click="projectsStore.fetchProject(projectId)"
      >
        <span>↻ Refresh</span>
      </button>
    </div>

    <SourceFilter />

    <div class="project-view__entries">
      <template v-if="entries.length === 0">
        <div class="project-view__empty neon-card">
          <p>No activity found for this project with current source filters.</p>
        </div>
      </template>
      <template v-else>
        <div
          v-for="section in daySections"
          :key="section.dateKey"
          class="project-view__day-section"
        >
          <TimelineDayDivider
            :label="section.label"
            :relativeLabel="section.relativeLabel"
            :ageInDays="section.ageInDays"
            :weekLabel="section.weekLabel"
          />
          <div class="project-view__section-entries">
            <TimelineGroup
              v-for="group in section.groups"
              :key="group.id"
              :group="group"
            />
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.project-view__header {
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

.project-view__title {
  font-size: 1.8rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.project-view__path {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: "Cascadia Code", "Fira Code", monospace;
  margin-top: 0.3rem;
}

.project-view__remote {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.project-view__actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.project-view__entries {
  display: flex;
  flex-direction: column;
  max-width: 720px;
}

.project-view__day-section {
  display: flex;
  flex-direction: column;
}

.project-view__section-entries {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-bottom: 1rem;
}

.project-view__empty {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}
</style>
