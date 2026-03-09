<script setup lang="ts">
import { ref, computed } from "vue";
import { useProjectsStore } from "@/stores/projects";
import { useSettingsStore } from "@/stores/settings";
import { useRouter } from "vue-router";
import SourceFilter from "@/components/SourceFilter.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";

const projectsStore = useProjectsStore();
const settingsStore = useSettingsStore();
const router = useRouter();

const showUntracked = ref(false);

/** All projects to display: tracked ones always, untracked appended when toggle is on. */
const visibleProjects = computed(() => {
  if (!showUntracked.value) return projectsStore.sortedProjects;
  const untracked = [...projectsStore.projects]
    .filter((p) => !settingsStore.isProjectTracked(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...projectsStore.sortedProjects, ...untracked];
});

function openProject(id: string) {
  router.push(`/project/${id}`);
}
</script>

<template>
  <div class="dashboard">
    <header class="dashboard__header">
      <div>
        <h1 class="dashboard__title">
          <span class="glow-text">Dashboard</span>
        </h1>
        <p class="dashboard__subtitle">
          Your local project insights at a glance
        </p>
      </div>
      <button
        v-if="
          projectsStore.projects.some(
            (p) => !settingsStore.isProjectTracked(p.id),
          )
        "
        class="show-untracked-btn"
        :class="{ 'show-untracked-btn--active': showUntracked }"
        @click="showUntracked = !showUntracked"
      >
        <span>{{
          showUntracked ? "▣ hide untracked" : "□ show untracked"
        }}</span>
      </button>
    </header>

    <SourceFilter />

    <!-- Loading skeletons: only before projects are discovered -->
    <div
      v-if="projectsStore.loading && visibleProjects.length === 0"
      class="dashboard__grid"
    >
      <SkeletonCard v-for="i in 6" :key="i" :lines="4" />
    </div>

    <!-- Empty state -->
    <div v-else-if="visibleProjects.length === 0" class="dashboard__empty">
      <div class="empty-state neon-card">
        <div class="empty-state__icon glow-text">◇</div>
        <h2>No projects found</h2>
        <p>
          Add root folders in <strong>Settings</strong> to scan for projects.
        </p>
        <button class="neon-btn" @click="router.push('/settings')">
          <span>⚙ Open Settings</span>
        </button>
      </div>
    </div>

    <!-- Project grid: always shown once projects are known.
         Each card shows a skeleton until its own fetch completes.
         Untracked cards are appended (dimmed) when the toggle is on. -->
    <div v-else class="dashboard__grid">
      <template v-for="project in visibleProjects" :key="project.id">
        <SkeletonCard
          v-if="
            settingsStore.isProjectTracked(project.id) &&
            projectsStore.loadingProjects.has(project.id) &&
            projectsStore.entriesForProject(project.id).length === 0
          "
          :lines="4"
        />
        <div
          v-else
          class="project-tile neon-card"
          :class="{
            'project-tile--untracked': !settingsStore.isProjectTracked(
              project.id,
            ),
          }"
          @click="openProject(project.id)"
        >
          <div class="project-tile__header">
            <h3 class="project-tile__name">{{ project.name }}</h3>
            <!-- track/untrack action — sits left of the git indicator slot -->
            <button
              class="project-tile__track-btn"
              :class="{
                'project-tile__track-btn--visible':
                  !settingsStore.isProjectTracked(project.id),
              }"
              :title="
                settingsStore.isProjectTracked(project.id)
                  ? 'Hide from dashboard and timeline'
                  : 'Show in dashboard and timeline'
              "
              @click.stop="projectsStore.trackProject(project.id)"
            >
              {{
                settingsStore.isProjectTracked(project.id) ? "untrack" : "track"
              }}
            </button>
            <!-- fixed-width slot keeps ⬡ pinned top-right on every card -->
            <span class="project-tile__git-slot">
              <span
                v-if="project.gitRemote"
                class="project-tile__git"
                :data-tooltip="`Verbonden met git remote:\n${project.gitRemote}`"
                >⬡</span
              >
            </span>
          </div>

          <p class="project-tile__path">{{ project.path }}</p>

          <div class="project-tile__stats">
            <span class="stat-group stat-group--green">
              <span class="stat">
                <span class="stat__value glow-text--green">
                  {{
                    projectsStore
                      .entriesForProject(project.id)
                      .filter((e) => e.meta.source === "commit").length
                  }}
                </span>
                <span class="stat__label">commits</span>
              </span>
              <span class="stat-group__divider">·</span>
              <span class="stat">
                <span class="stat__value glow-text--green">
                  {{
                    projectsStore
                      .entriesForProject(project.id)
                      .filter((e) => e.meta.source === "commit")
                      .reduce(
                        (sum, e) =>
                          sum +
                          ((e.meta.extra?.files as unknown[])?.length ?? 0),
                        0,
                      )
                  }}
                </span>
                <span class="stat__label">files</span>
              </span>
            </span>
            <span class="stat-group stat-group--cyan">
              <span class="stat">
                <span class="stat__value glow-text">
                  {{
                    projectsStore
                      .entriesForProject(project.id)
                      .filter((e) => e.meta.source === "chat").length
                  }}
                </span>
                <span class="stat__label">chats</span>
              </span>
              <span class="stat-group__divider">·</span>
              <span class="stat">
                <span class="stat__value glow-text">
                  {{
                    projectsStore
                      .entriesForProject(project.id)
                      .filter((e) => e.meta.source === "chat")
                      .reduce(
                        (sum, e) =>
                          sum + ((e.meta.extra?.messageCount as number) ?? 0),
                        0,
                      )
                  }}
                </span>
                <span class="stat__label">turns</span>
              </span>
            </span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dashboard__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
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

.show-untracked-btn {
  flex-shrink: 0;
  align-self: center;
  background: none;
  border: 1px solid var(--border-dim);
  color: var(--text-muted);
  font-size: 0.72rem;
  font-family: inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.35rem 0.7rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
  white-space: nowrap;
}

.show-untracked-btn:hover,
.show-untracked-btn--active {
  border-color: var(--neon-cyan);
  color: var(--neon-cyan);
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

.project-tile--untracked {
  opacity: 0.45;
}

.project-tile--untracked:hover {
  opacity: 0.8;
}

.project-tile__header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.project-tile__name {
  flex: 1;
  min-width: 0;
  font-size: 1.05rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* track/untrack pill — hidden by default, revealed on card hover */
.project-tile__track-btn {
  opacity: 0;
  flex-shrink: 0;
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  font-size: 0.65rem;
  font-family: inherit;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 0.2rem 0.4rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition:
    opacity 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.project-tile:hover .project-tile__track-btn {
  opacity: 1;
}

/* On untracked cards the 'track' button is always visible */
.project-tile__track-btn--visible {
  opacity: 1 !important;
  border-color: var(--border-dim);
  color: var(--neon-cyan);
}

.project-tile__track-btn:hover {
  border-color: var(--neon-magenta);
  color: var(--neon-magenta);
}

/* fixed-width slot keeps ⬡ pinned at the right edge on every card */
.project-tile__git-slot {
  flex-shrink: 0;
  width: 1.4rem;
  display: flex;
  justify-content: center;
}

.project-tile__git {
  color: var(--neon-green);
  font-size: 1.2rem;
  position: relative;
  cursor: default;
}

.project-tile__git::after {
  content: attr(data-tooltip);
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: 20rem;
  max-width: 90vw;
  padding: 0.5rem 0.75rem;
  background: rgba(5, 10, 20, 0.95);
  border: 1px solid var(--neon-green);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.72rem;
  font-family: "Cascadia Code", "Fira Code", monospace;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  box-shadow: 0 0 12px rgba(57, 255, 20, 0.25);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
  z-index: 100;
}

.project-tile__git:hover::after {
  opacity: 1;
}

.project-tile__path {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: "Cascadia Code", "Fira Code", monospace;
  margin-bottom: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-tile__stats {
  display: flex;
  gap: 1.25rem;
  align-items: center;
  justify-content: space-between;
}

.stat-group {
  flex: 1;
  justify-content: center;
}

.stat-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  border: 1px solid transparent;
}

.stat-group--green {
  border-color: rgba(57, 255, 20, 0.15);
  background: rgba(57, 255, 20, 0.04);
}

.stat-group--cyan {
  border-color: rgba(0, 240, 255, 0.15);
  background: rgba(0, 240, 255, 0.04);
}

.stat-group__divider {
  color: var(--text-muted);
  font-size: 0.9rem;
  opacity: 0.5;
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
