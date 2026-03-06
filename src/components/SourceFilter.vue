<script setup lang="ts">
import type { SourceType } from '@/types'
import { useSettingsStore } from '@/stores/settings'
import { getAllConnectors } from '@/connectors'

const settingsStore = useSettingsStore()
const connectors = getAllConnectors()

function toggleSource(type: SourceType) {
  settingsStore.toggleSource(type)
}
</script>

<template>
  <div class="source-filter">
    <span class="source-filter__label">Sources</span>
    <div class="source-filter__items">
      <button
        v-for="connector in connectors"
        :key="connector.type"
        class="source-chip"
        :class="{
          'source-chip--active': settingsStore.isSourceEnabled(connector.type),
        }"
        :style="{
          '--chip-color': `var(${connector.color})`,
        }"
        @click="toggleSource(connector.type)"
      >
        <span class="source-chip__dot" />
        <span>{{ connector.label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.source-filter {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0;
}

.source-filter__label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  white-space: nowrap;
}

.source-filter__items {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.source-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--bg-card);
  border: 1px solid var(--border-dim);
  border-radius: 20px;
  cursor: pointer;
  transition: all 0.25s ease;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.source-chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);
  transition: all 0.25s ease;
}

.source-chip--active {
  color: var(--chip-color);
  border-color: var(--chip-color);
  background: color-mix(in srgb, var(--chip-color) 8%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--chip-color) 20%, transparent);
}

.source-chip--active .source-chip__dot {
  background: var(--chip-color);
  box-shadow: 0 0 6px var(--chip-color);
}

.source-chip:hover:not(.source-chip--active) {
  border-color: var(--chip-color);
  color: var(--text-secondary);
}
</style>
