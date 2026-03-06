<script setup lang="ts">
defineProps<{
  label: string;
  relativeLabel: string;
  ageInDays: number;
  weekLabel: string;
}>();
</script>

<template>
  <div class="day-divider">
    <div class="day-divider__inner">
      <div class="day-divider__left">
        <span
          class="day-divider__label"
          :class="ageInDays === 0 ? 'day-divider__label--today' : ''"
        >
          {{ label }}
        </span>
        <span v-if="relativeLabel" class="day-divider__relative">{{
          relativeLabel
        }}</span>
      </div>
      <span v-if="weekLabel" class="day-divider__week">{{ weekLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.day-divider {
  position: sticky;
  top: 0;
  z-index: 20;
  /* Fade to transparent at the bottom so cards sliding under look natural */
  background: linear-gradient(to bottom, var(--bg-deep) 70%, transparent 100%);
  padding: 0.6rem 0 0.8rem;
  /* Stretch slightly past the list column so the background covers full width */
  margin-left: -0.5rem;
  margin-right: -0.5rem;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}

.day-divider__inner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-dim);
  padding-bottom: 0.45rem;
  gap: 0.75rem;
}

.day-divider__left {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  min-width: 0;
}

.day-divider__label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.04em;
  text-transform: capitalize;
  flex-shrink: 0;
}

.day-divider__label--today {
  color: var(--neon-cyan);
  text-shadow: 0 0 8px rgba(0, 240, 255, 0.45);
}

.day-divider__relative {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-style: italic;
  white-space: nowrap;
}

.day-divider__week {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
