<script setup lang="ts">
import { RouterView } from "vue-router";
import { onMounted, watch } from "vue";
import AppShell from "@/components/AppShell.vue";
import { useProjectsStore } from "@/stores/projects";
import { useSearchStore } from "@/stores/search";
import {
  gitCommitConnector,
  chatHistoryConnector,
  registerSourceConnector,
} from "@/connectors";

const projectsStore = useProjectsStore();
const searchStore = useSearchStore();

// Register all connectors (both in store and global registry)
for (const connector of [gitCommitConnector, chatHistoryConnector]) {
  projectsStore.registerConnector(connector);
  registerSourceConnector(connector);
}

// Rebuild BM25 index reactively whenever filtered entries change
watch(
  () => projectsStore.filteredEntries,
  (entries) => {
    if (entries.length > 0) {
      searchStore.rebuildBM25Index(entries);
      searchStore.setEntries(entries);
    }
  },
  { deep: false },
);

// Discover projects and fetch data on mount
onMounted(() => {
  projectsStore.loadAll();
});
</script>

<template>
  <AppShell>
    <RouterView v-slot="{ Component, route }">
      <Transition
        :name="(route.meta.transition as string) ?? 'fade'"
        mode="out-in"
      >
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </AppShell>
</template>
