import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  AppSettings,
  AppTheme,
  RootFolder,
  SourceType,
  TeamsConfig,
} from "@/types";

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
  // Fresh install: start in opt-in mode with no projects tracked yet.
  return {
    rootFolders: [],
    enabledSources: {
      commit: true,
      chat: true,
      "file-change": true,
      teams: false,
      email: false,
    },
    untrackedProjects: [],
    trackedProjects: [],
    maxContentWidth: 1200,
  };
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>(loadSettings());

  const rootFolders = computed(() => settings.value.rootFolders);
  const enabledSources = computed(() => settings.value.enabledSources);
  const maxContentWidth = computed(
    () => settings.value.maxContentWidth ?? 1200,
  );
  const activeTheme = computed<AppTheme>(
    () => settings.value.activeTheme ?? "cyberpunk",
  );

  function setMaxContentWidth(width: number) {
    settings.value.maxContentWidth = Math.max(600, Math.min(3840, width));
    saveSettings(settings.value);
  }

  function setTheme(theme: AppTheme) {
    settings.value.activeTheme = theme;
    saveSettings(settings.value);
  }

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
    if (settings.value.trackedProjects !== undefined) {
      // Opt-in model: add/remove from tracked list
      const current = settings.value.trackedProjects;
      settings.value.trackedProjects = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
    } else {
      // Legacy opt-out model
      const current = settings.value.untrackedProjects ?? [];
      settings.value.untrackedProjects = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
    }
    saveSettings(settings.value);
  }

  function isProjectTracked(projectId: string): boolean {
    if (settings.value.trackedProjects !== undefined) {
      return settings.value.trackedProjects.includes(projectId);
    }
    // Legacy fallback (existing installs before migration runs)
    return !(settings.value.untrackedProjects ?? []).includes(projectId);
  }

  /**
   * One-time migration from opt-out to opt-in tracking model.
   * Called after project discovery so we have the full project list.
   * - Already-migrated installs (trackedProjects defined): no-op.
   * - Existing installs: preserves current tracked state, then any future
   *   newly-discovered project defaults to untracked (not in trackedProjects).
   */
  function migrateToOptInTracking(allProjectIds: string[]) {
    if (settings.value.trackedProjects !== undefined) return;
    // Reconstruct which projects were explicitly tracked under the old model
    settings.value.trackedProjects = allProjectIds.filter(
      (id) => !(settings.value.untrackedProjects ?? []).includes(id),
    );
    saveSettings(settings.value);
  }

  function updateTeamsConfig(config: TeamsConfig) {
    settings.value.teamsConfig = config;
    saveSettings(settings.value);
  }

  function clearTeamsConfig() {
    settings.value.teamsConfig = undefined;
    saveSettings(settings.value);
  }

  function updateTeamsFilePath(path: string) {
    settings.value.teamsFilePath = path || undefined;
    saveSettings(settings.value);
  }

  return {
    settings,
    rootFolders,
    enabledSources,
    maxContentWidth,
    activeTheme,
    addRootFolder,
    removeRootFolder,
    updateRootFolder,
    toggleSource,
    isSourceEnabled,
    toggleProjectTracking,
    isProjectTracked,
    migrateToOptInTracking,
    updateTeamsConfig,
    clearTeamsConfig,
    updateTeamsFilePath,
    setMaxContentWidth,
    setTheme,
  };
});
