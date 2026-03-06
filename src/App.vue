<script setup lang="ts">
import { RouterView } from "vue-router";
import { onMounted } from "vue";
import AppShell from "@/components/AppShell.vue";
import { useProjectsStore } from "@/stores/projects";
import {
  gitCommitConnector,
  chatHistoryConnector,
  registerSourceConnector,
} from "@/connectors";

const projectsStore = useProjectsStore();

// Register all connectors (both in store and global registry)
for (const connector of [gitCommitConnector, chatHistoryConnector]) {
  projectsStore.registerConnector(connector);
  registerSourceConnector(connector);
}

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
