import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ProjectConfig, InsightEntry, SourceConnector, SourceType } from '@/types'
import { useSettingsStore } from './settings'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectConfig[]>([])
  const entries = ref<InsightEntry[]>([])
  const loading = ref(false)
  const connectors = ref<Map<SourceType, SourceConnector>>(new Map())

  const settingsStore = useSettingsStore()

  /** Register a source connector */
  function registerConnector(connector: SourceConnector) {
    connectors.value.set(connector.type, connector)
  }

  /** Projects sorted by name */
  const sortedProjects = computed(() =>
    [...projects.value].sort((a, b) => a.name.localeCompare(b.name))
  )

  /** Filtered entries based on enabled sources */
  const filteredEntries = computed(() =>
    entries.value.filter(e => settingsStore.isSourceEnabled(e.meta.source))
  )

  /** Entries for a specific project, filtered */
  function entriesForProject(projectId: string) {
    return filteredEntries.value.filter(e => e.projectId === projectId)
  }

  /** Timeline entries sorted by timestamp (newest first) */
  const timelineEntries = computed(() =>
    [...filteredEntries.value].sort(
      (a, b) => new Date(b.meta.timestamp).getTime() - new Date(a.meta.timestamp).getTime()
    )
  )

  /** Fetch all entries for all projects from all enabled connectors */
  async function fetchAll() {
    loading.value = true
    try {
      const allEntries: InsightEntry[] = []

      for (const project of projects.value) {
        for (const [type, connector] of connectors.value) {
          if (!settingsStore.isSourceEnabled(type)) continue
          try {
            const projectEntries = await connector.fetch(project)
            // Validate entries
            for (const entry of projectEntries) {
              const result = connector.validate(entry)
              if (result.valid) {
                allEntries.push(entry)
              }
            }
          } catch (err) {
            console.warn(`[DevPulse] Connector ${type} failed for ${project.name}:`, err)
          }
        }
      }

      entries.value = allEntries
    } finally {
      loading.value = false
    }
  }

  /** Fetch entries for a single project */
  async function fetchProject(projectId: string) {
    const project = projects.value.find(p => p.id === projectId)
    if (!project) return

    // Remove old entries for this project
    entries.value = entries.value.filter(e => e.projectId !== projectId)

    for (const [type, connector] of connectors.value) {
      if (!settingsStore.isSourceEnabled(type)) continue
      try {
        const projectEntries = await connector.fetch(project)
        for (const entry of projectEntries) {
          const result = connector.validate(entry)
          if (result.valid) {
            entries.value.push(entry)
          }
        }
      } catch (err) {
        console.warn(`[DevPulse] Connector ${type} failed for ${project.name}:`, err)
      }
    }
  }

  return {
    projects,
    entries,
    loading,
    connectors,
    sortedProjects,
    filteredEntries,
    timelineEntries,
    entriesForProject,
    registerConnector,
    fetchAll,
    fetchProject,
  }
})
