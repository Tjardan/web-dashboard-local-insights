<script setup lang="ts">
const props = defineProps<{
  lines?: number
  height?: string
}>()

const lineCount = props.lines ?? 3
</script>

<template>
  <div class="skeleton-card neon-card">
    <div class="skeleton-card__header">
      <div class="skeleton" style="width: 70px; height: 20px;" />
      <div class="skeleton" style="width: 50px; height: 14px;" />
    </div>
    <div
      v-for="i in lineCount"
      :key="i"
      class="skeleton"
      :style="{
        width: i === lineCount ? '60%' : '100%',
        height: height ?? '14px',
        marginBottom: '0.5rem',
      }"
    />
  </div>
</template>

<style scoped>
.skeleton-card {
  padding: 1.2rem 1.5rem;
  pointer-events: none;
}

.skeleton-card__header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1rem;
}
</style>
