<script setup lang="ts">
import { computed } from "vue";
import { useProjectsStore } from "@/stores/projects";
import SourceFilter from "@/components/SourceFilter.vue";
import TimelineGroup from "@/components/TimelineGroup.vue";
import TimelineDayDivider from "@/components/TimelineDayDivider.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import { buildDaySections } from "@/utils/timeline-grouping";

const projectsStore = useProjectsStore();
const daySections = computed(() =>
  buildDaySections(projectsStore.timelineEntries),
);
</script>

<template>
  <div class="timeline">
    <header class="timeline__header">
      <h1 class="timeline__title">
        <span class="glow-text--magenta">Timeline</span>
      </h1>
      <p class="timeline__subtitle">Cross-project activity stream</p>
    </header>

    <SourceFilter />

    <!-- Loading skeletons: only before any entries are available -->
    <div
      v-if="projectsStore.loading && projectsStore.timelineEntries.length === 0"
      class="timeline__list"
    >
      <SkeletonCard v-for="i in 8" :key="i" :lines="3" />
    </div>

    <!-- Empty state: loading done, still nothing -->
    <div
      v-else-if="projectsStore.timelineEntries.length === 0"
      class="timeline__empty"
    >
      <div class="empty-state neon-card">
        <div class="empty-state__icon glow-text--magenta">◈</div>
        <h2>No activity yet</h2>
        <p>
          Activity from all your projects will appear here as a unified stream.
        </p>
      </div>
    </div>

    <!-- Timeline with day sections -->
    <div v-else class="timeline__list">
      <div
        v-for="section in daySections"
        :key="section.dateKey"
        class="timeline__day-section"
      >
        <TimelineDayDivider
          :label="section.label"
          :relativeLabel="section.relativeLabel"
          :ageInDays="section.ageInDays"
          :weekLabel="section.weekLabel"
        />
        <div class="timeline__entries">
          <TimelineGroup
            v-for="group in section.groups"
            :key="group.id"
            :group="group"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline__header {
  margin-bottom: 1.5rem;
}

.timeline__title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.timeline__subtitle {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin-top: 0.3rem;
}

.timeline__list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1rem;
}

.timeline__day-section {
  display: flex;
  flex-direction: column;
}

.timeline__entries {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding-bottom: 1rem;
}

.timeline__empty {
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
}

/* List transition */
.list-enter-active,
.list-leave-active {
  transition: all 0.4s var(--ease-out-expo);
}

.list-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
