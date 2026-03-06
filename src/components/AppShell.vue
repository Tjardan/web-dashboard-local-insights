<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { computed } from "vue";
import { useSettingsStore } from "@/stores/settings";

const route = useRoute();
const router = useRouter();
const settingsStore = useSettingsStore();

const navItems = [
  { path: "/", label: "Dashboard", icon: "⬡" },
  { path: "/timeline", label: "Timeline", icon: "◈" },
  { path: "/search", label: "Search", icon: "⊛" },
  { path: "/settings", label: "Settings", icon: "⚙" },
];

const currentPath = computed(() => route.path);

function navigate(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="app-shell">
    <div class="grid-bg" />

    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar__logo" @click="navigate('/')">
        <span class="logo-icon glow-text">◆</span>
        <span class="logo-text">
          <span class="glow-text">Dev</span
          ><span class="glow-text--magenta">Pulse</span>
        </span>
      </div>

      <nav class="sidebar__nav">
        <button
          v-for="item in navItems"
          :key="item.path"
          class="nav-item"
          :class="{ 'nav-item--active': currentPath === item.path }"
          @click="navigate(item.path)"
        >
          <span class="nav-item__icon">{{ item.icon }}</span>
          <span class="nav-item__label">{{ item.label }}</span>
          <span v-if="currentPath === item.path" class="nav-item__indicator" />
        </button>
      </nav>

      <div class="sidebar__footer">
        <button
          class="theme-toggle"
          :title="`Switch theme (current: ${settingsStore.activeTheme})`"
          @click="
            settingsStore.setTheme(
              settingsStore.activeTheme === 'cyberpunk'
                ? 'sys-nexus'
                : 'cyberpunk',
            )
          "
        >
          <span class="theme-toggle__icon">{{
            settingsStore.activeTheme === "cyberpunk" ? "◆" : "■"
          }}</span>
          <span class="theme-toggle__label">{{
            settingsStore.activeTheme === "cyberpunk"
              ? "CYBERPUNK"
              : "SYS:NEXUS"
          }}</span>
        </button>
        <span class="sidebar__version">v0.1.0</span>
      </div>
    </aside>

    <!-- Main content -->
    <main class="main-content">
      <div
        class="content-wrapper"
        :style="
          route.meta.fullWidth
            ? {}
            : { maxWidth: settingsStore.maxContentWidth + 'px' }
        "
      >
        <slot />
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  min-height: 100vh;
}

.sidebar {
  width: var(--sidebar-width);
  background: var(--bg-surface);
  border-right: 1px solid var(--border-dim);
  display: flex;
  flex-direction: column;
  padding: 1.5rem 1rem;
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 100;
}

.sidebar__logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem;
  margin-bottom: 2rem;
  cursor: pointer;
  user-select: none;
}

.logo-icon {
  font-size: 1.8rem;
  line-height: 1;
}

.logo-text {
  font-size: 1.4rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.sidebar__nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.7rem 0.8rem;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.9rem;
  font-weight: 500;
  border-radius: var(--radius);
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.nav-item:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.04);
}

.nav-item--active {
  color: var(--neon-cyan);
  background: rgba(0, 240, 255, 0.06);
}

.nav-item__icon {
  font-size: 1.1rem;
  width: 1.5rem;
  text-align: center;
}

.nav-item__indicator {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 60%;
  background: var(--neon-cyan);
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px var(--neon-cyan);
}

.sidebar__footer {
  padding-top: 1rem;
  border-top: 1px solid var(--border-dim);
}

.sidebar__version {
  font-size: 0.7rem;
  color: var(--text-muted);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.main-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  padding: 2rem;
  min-height: 100vh;
}

.content-wrapper {
  width: 100%;
}

.theme-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.45rem 0.6rem;
  margin-bottom: 0.6rem;
  border: 1px solid var(--border-dim);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}

.theme-toggle:hover {
  border-color: var(--neon-cyan);
  color: var(--neon-cyan);
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.15);
}

.theme-toggle__icon {
  font-size: 0.75rem;
  flex-shrink: 0;
}

.theme-toggle__label {
  flex: 1;
}
</style>
