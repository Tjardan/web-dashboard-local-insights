import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type { AppSettings, RootFolder, SourceType } from "@/types";

const SETTINGS_KEY = "devpulse-settings";

/** One-time migration: wipe file-change cache entries and remove dead source key */
function migrateSettings(): void {
  try {
    // Remove stale file-change browser cache slices
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("devpulse:entries:") && k.endsWith(":file-change"))
        toDelete.push(k);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
    // Remove file-change from stored enabledSources
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppSettings;
      if ("file-change" in (parsed.enabledSources ?? {})) {
        delete (parsed.enabledSources as Record<string, unknown>)[
          "file-change"
        ];
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(parsed));
      }
    }
  } catch {
    /* non-fatal */
  }
}

migrateSettings();

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw) as AppSettings;
  } catch {
    /* ignore parse errors */
  }
  return {
    rootFolders: [],
    enabledSources: {
      commit: true,
      chat: true,
    },
    untrackedProjects: [],
  };
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>(loadSettings());

  const rootFolders = computed(() => settings.value.rootFolders);
  const enabledSources = computed(() => settings.value.enabledSources);

  function addRootFolder(folder: RootFolder) {
    if (settings.value.rootFolders.some((f) => f.path === folder.path)) return;
    settings.value.rootFolders.push(folder);
    saveSettings(settings.value);
  }

  function removeRootFolder(path: string) {
    settings.value.rootFolders = settings.value.rootFolders.filter(
      (f) => f.path !== path,
    );
    saveSettings(settings.value);
  }

  function updateRootFolder(oldPath: string, folder: RootFolder) {
    const idx = settings.value.rootFolders.findIndex((f) => f.path === oldPath);
    if (idx !== -1) {
      settings.value.rootFolders[idx] = folder;
      saveSettings(settings.value);
    }
  }

  function toggleSource(source: SourceType, enabled?: boolean) {
    settings.value.enabledSources[source] =
      enabled ?? !settings.value.enabledSources[source];
    saveSettings(settings.value);
  }

  function isSourceEnabled(source: SourceType): boolean {
    return settings.value.enabledSources[source] !== false;
  }

  function toggleProjectTracking(projectId: string) {
    const current = settings.value.untrackedProjects ?? [];
    if (current.includes(projectId)) {
      settings.value.untrackedProjects = current.filter(
        (id) => id !== projectId,
      );
    } else {
      settings.value.untrackedProjects = [...current, projectId];
    }
    saveSettings(settings.value);
  }

  function isProjectTracked(projectId: string): boolean {
    return !(settings.value.untrackedProjects ?? []).includes(projectId);
  }

  return {
    settings,
    rootFolders,
    enabledSources,
    addRootFolder,
    removeRootFolder,
    updateRootFolder,
    toggleSource,
    isSourceEnabled,
    toggleProjectTracking,
    isProjectTracked,
  };
});
