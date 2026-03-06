<script setup lang="ts">
import { useProjectsStore } from '@/stores/projects'
import { useRouter } from 'vue-router'
import SourceFilter from '@/components/SourceFilter.vue'
import SkeletonCard from '@/components/SkeletonCard.vue'

const projectsStore = useProjectsStore()
const router = useRouter()

function openProject(id: string) {
  router.push(`/project/${id}`)
}
</script>

<template>
  <div class="dashboard">
    <header class="dashboard__header">
      <h1 class="dashboard__title">
        <span class="glow-text">Dashboard</span>
      </h1>
      <p class="dashboard__subtitle">Your local project insights at a glance</p>
    </header>

    <SourceFilter />

    <!-- Loading state -->
    <div v-if="projectsStore.loading" class="dashboard__grid">
      <SkeletonCard v-for="i in 6" :key="i" :lines="4" />
    </div>

    <!-- Empty state -->
    <div v-else-if="projectsStore.sortedProjects.length === 0" class="dashboard__empty">
      <div class="empty-state neon-card">
        <div class="empty-state__icon glow-text">◇</div>
        <h2>No projects found</h2>
        <p>Add root folders in <strong>Settings</strong> to scan for projects.</p>
        <button class="neon-btn" @click="router.push('/settings')">
          <span>⚙ Open Settings</span>
        </button>
      </div>
    </div>

    <!-- Project grid -->
    <div v-else class="dashboard__grid">
      <div
        v-for="project in projectsStore.sortedProjects"
        :key="project.id"
        class="project-tile neon-card"
        @click="openProject(project.id)"
      >
        <div class="project-tile__header">
          <h3 class="project-tile__name">{{ project.name }}</h3>
          <span v-if="project.gitRemote" class="project-tile__git">⬡</span>
        </div>

        <p class="project-tile__path">{{ project.path }}</p>

        <div class="project-tile__stats">
          <span class="stat">
            <span class="stat__value glow-text">
              {{ projectsStore.entriesForProject(project.id).filter(e => e.meta.source === 'commit').length }}
            </span>
            <span class="stat__label">commits</span>
          </span>
          <span class="stat">
            <span class="stat__value glow-text--magenta">
              {{ projectsStore.entriesForProject(project.id).filter(e => e.meta.source === 'chat').length }}
            </span>
            <span class="stat__label">chats</span>
          </span>
          <span class="stat">
            <span class="stat__value" style="text-shadow: 0 0 8px rgba(139,92,246,0.6);">
              {{ projectsStore.entriesForProject(project.id).filter(e => e.meta.source === 'file-change').length }}
            </span>
            <span class="stat__label">files</span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard__header {
  margin-bottom: 1.5rem;
}

.dashboard__title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.dashboard__subtitle {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-top: 0.3rem;
}

.dashboard__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.project-tile {
  cursor: pointer;
}

.project-tile__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.project-tile__name {
  font-size: 1.05rem;
  font-weight: 700;
}

.project-tile__git {
  color: var(--neon-green);
  font-size: 1.2rem;
}

.project-tile__path {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
  margin-bottom: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-tile__stats {
  display: flex;
  gap: 1.5rem;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.stat__value {
  font-size: 1.4rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.stat__label {
  font-size: 0.65rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.dashboard__empty {
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
  margin-bottom: 1.5rem;
}
</style>
