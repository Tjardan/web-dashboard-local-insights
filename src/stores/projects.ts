import { defineStore } from "pinia";
import { ref, computed } from "vue";
import type {
  ProjectConfig,
  InsightEntry,
  SourceConnector,
  SourceType,
} from "@/types";
import { useSettingsStore } from "./settings";
import {
  readBrowserCache,
  writeBrowserCache,
  readAllCachedEntries,
  pruneObsoleteProjects,
  sanitizeSince,
} from "@/utils/browser-cache";

export const useProjectsStore = defineStore("projects", () => {
  const projects = ref<ProjectConfig[]>([]);
  const entries = ref<InsightEntry[]>([]);
  const loading = ref(false);
  const loadingProjects = ref<Set<string>>(new Set());
  const connectors = ref<Map<SourceType, SourceConnector>>(new Map());

  const settingsStore = useSettingsStore();

  // Generation counter — incremented on every loadAll() call.
  // Each call captures its own seq; after every await it checks
  // loadSeq === seq to bail if a newer call has superseded it.
  let loadSeq = 0;

  /** Register a source connector */
  function registerConnector(connector: SourceConnector) {
    connectors.value.set(connector.type, connector);
  }

  /** Projects sorted by name, excluding untracked */
  const sortedProjects = computed(() =>
    [...projects.value]
      .filter((p) => settingsStore.isProjectTracked(p.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** Filtered entries based on enabled sources and tracked projects */
  const filteredEntries = computed(() =>
    entries.value.filter(
      (e) =>
        settingsStore.isSourceEnabled(e.meta.source) &&
        // Virtual project IDs (e.g. "_teams") are always visible when source is enabled
        (e.projectId.startsWith("_") ||
          settingsStore.isProjectTracked(e.projectId)),
    ),
  );

  /** Entries for a specific project, filtered */
  function entriesForProject(projectId: string) {
    return filteredEntries.value.filter((e) => e.projectId === projectId);
  }

  /** Timeline entries sorted by timestamp (newest first) */
  const timelineEntries = computed(() =>
    [...filteredEntries.value].sort(
      (a, b) =>
        new Date(b.meta.timestamp).getTime() -
        new Date(a.meta.timestamp).getTime(),
    ),
  );

  /** Discover projects by scanning root folders via the local API. */
  async function discoverProjects() {
    const folders = settingsStore.rootFolders;
    if (folders.length === 0) {
      projects.value = [];
      return;
    }
    try {
      const params = new URLSearchParams({
        rootFolders: JSON.stringify(folders),
      });
      const res = await fetch(`/api/discover-projects?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      projects.value = await res.json();
    } catch (err) {
      console.warn("[DevPulse] Project discovery failed:", err);
    }
  }

  /**
   * Two-phase load:
   *   1. Instantly populate from browser localStorage cache (zero latency)
   *   2. Discover projects (server file-cache: 5 min TTL)
   *   3. Incremental fetch per project × connector — parallel, progressive
   *      Each project card reveals as soon as all its connectors return.
   *
   * Navigation-safe: a generation counter (loadSeq) cancels any in-flight
   * load the moment a newer loadAll() call starts (e.g. from settings change).
   */
  async function loadAll() {
    const seq = ++loadSeq;
    loading.value = true;
    try {
      // Phase 1 — show stale-while-revalidate data immediately
      const cached = readAllCachedEntries();
      if (cached.length > 0) {
        entries.value = cached;
      }

      // Phase 2 — discover projects (server file-cache: 5 min TTL)
      await discoverProjects();
      if (loadSeq !== seq) return;

      // One-time migration: switch existing installs to opt-in tracking model.
      // New installs already have trackedProjects: [] from loadSettings() default.
      settingsStore.migrateToOptInTracking(projects.value.map((p) => p.id));

      // Prune localStorage entries for projects that no longer exist,
      // and remove their stale entries from the live store.
      const knownIds = new Set(projects.value.map((p) => p.id));
      // Keep virtual project IDs for global connectors (e.g. "_teams") from being pruned
      for (const [type, connector] of connectors.value) {
        if (connector.global) knownIds.add(`_${type}`);
      }
      pruneObsoleteProjects(knownIds);
      entries.value = entries.value.filter((e) => knownIds.has(e.projectId));

      // Phase 3 — parallel per-project progressive fetch
      // Only tracked projects are fetched; untracked ones load on first track.
      // Each project independently fetches all its connectors and reveals
      // its card the moment it finishes (instead of all revealing at once).
      const trackedProjects = projects.value.filter((p) =>
        settingsStore.isProjectTracked(p.id),
      );
      loadingProjects.value = new Set(trackedProjects.map((p) => p.id));

      await Promise.all(
        trackedProjects.map(async (project) => {
          for (const [type, connector] of connectors.value) {
            if (!settingsStore.isSourceEnabled(type)) continue;
            if (loadSeq !== seq) return;

            const cache = readBrowserCache(project.id, type);
            // Sanitize: treat future timestamps and corrupt values as a full fetch
            const since = sanitizeSince(cache?.cachedAt);

            try {
              const fresh = await connector.fetch(project, since);
              if (loadSeq !== seq) return;

              // Validate new entries
              const valid = fresh.filter((e) => connector.validate(e).valid);

              if (cache) {
                // Merge: deduplicate by id, new entries win on conflict
                const merged = new Map(cache.entries.map((e) => [e.id, e]));
                for (const e of valid) merged.set(e.id, e);
                const mergedArr = [...merged.values()];
                writeBrowserCache(project.id, type, mergedArr);
                // Splice this project+source slice into the live store
                entries.value = [
                  ...entries.value.filter(
                    (e) =>
                      !(e.projectId === project.id && e.meta.source === type),
                  ),
                  ...mergedArr,
                ];
              } else {
                writeBrowserCache(project.id, type, valid);
                entries.value = [...entries.value, ...valid];
              }
            } catch (err) {
              console.warn(
                `[DevPulse] Connector ${type} failed for ${project.name}:`,
                err,
              );
            }
          }

          // All connectors done for this project — reveal its card
          if (loadSeq === seq) {
            loadingProjects.value = new Set(
              [...loadingProjects.value].filter((id) => id !== project.id),
            );
          }
        }),
      );

      // Phase 4 — global connectors (not project-scoped, e.g. Teams, Email)
      // Called once per sync cycle; entries use projectId "_<type>"
      for (const [type, connector] of connectors.value) {
        if (!connector.global) continue;
        if (!settingsStore.isSourceEnabled(type)) continue;
        if (loadSeq !== seq) return;

        const virtualProjectId = `_${type}`;
        const cache = readBrowserCache(virtualProjectId, type);
        const since = sanitizeSince(cache?.cachedAt);
        const virtualProject: import("@/types").ProjectConfig = {
          id: virtualProjectId,
          name: connector.label,
          path: "",
        };

        try {
          const fresh = await connector.fetch(virtualProject, since);
          if (loadSeq !== seq) return;

          const valid = fresh.filter((e) => connector.validate(e).valid);

          if (cache) {
            const merged = new Map(cache.entries.map((e) => [e.id, e]));
            for (const e of valid) merged.set(e.id, e);
            const mergedArr = [...merged.values()];
            writeBrowserCache(virtualProjectId, type, mergedArr);
            entries.value = [
              ...entries.value.filter(
                (e) =>
                  !(e.projectId === virtualProjectId && e.meta.source === type),
              ),
              ...mergedArr,
            ];
          } else {
            writeBrowserCache(virtualProjectId, type, valid);
            entries.value = [...entries.value, ...valid];
          }
        } catch (err) {
          console.warn(`[DevPulse] Global connector ${type} failed:`, err);
        }
      }
    } finally {
      // Only clear the global loading flag if we are still the active load.
      // A superseded load must NOT clear the flag set by the newer call.
      if (loadSeq === seq) {
        loading.value = false;
      }
    }
  }

  /**
   * Toggle tracking for a project.  When a project is newly tracked and has
   * no cached data yet, automatically triggers a first-time fetch so the card
   * populates immediately without requiring a full loadAll().
   */
  async function trackProject(projectId: string) {
    const wasTracked = settingsStore.isProjectTracked(projectId);
    settingsStore.toggleProjectTracking(projectId);
    const isNowTracked = settingsStore.isProjectTracked(projectId);

    if (!wasTracked && isNowTracked) {
      const project = projects.value.find((p) => p.id === projectId);
      if (!project) return;

      // Check if any connector already has a cache entry for this project.
      const hasCachedData = [...connectors.value.keys()].some(
        (type) => readBrowserCache(projectId, type) !== null,
      );

      if (!hasCachedData) {
        // First time ever tracked — show skeleton while fetching.
        loadingProjects.value = new Set([...loadingProjects.value, projectId]);
        await fetchProject(projectId);
        loadingProjects.value = new Set(
          [...loadingProjects.value].filter((id) => id !== projectId),
        );
      }
      // If there is a cache, data is already in the store (loaded at startup
      // from readAllCachedEntries). filteredEntries will include it immediately.
    }
  }

  /** Refresh a single project (full re-fetch, updates browser cache). */
  async function fetchProject(projectId: string) {
    const project = projects.value.find((p) => p.id === projectId);
    if (!project) return;

    for (const [type, connector] of connectors.value) {
      if (!settingsStore.isSourceEnabled(type)) continue;
      try {
        const fresh = await connector.fetch(project); // no `since` → full fetch
        const valid = fresh.filter((e) => connector.validate(e).valid);
        writeBrowserCache(project.id, type, valid);
        entries.value = [
          ...entries.value.filter(
            (e) => !(e.projectId === projectId && e.meta.source === type),
          ),
          ...valid,
        ];
      } catch (err) {
        console.warn(
          `[DevPulse] Connector ${type} failed for ${project.name}:`,
          err,
        );
      }
    }
  }

  return {
    projects,
    entries,
    loading,
    loadingProjects,
    connectors,
    sortedProjects,
    filteredEntries,
    timelineEntries,
    entriesForProject,
    registerConnector,
    trackProject,
    fetchProject,
    discoverProjects,
    loadAll,
  };
});
