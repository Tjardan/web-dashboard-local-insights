<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { getAllConnectors } from '@/connectors'
import type { RootFolder } from '@/types'

const settingsStore = useSettingsStore()
const connectors = getAllConnectors()

const newFolderPath = ref('')
const newFolderLabel = ref('')
const editingFolder = ref<string | null>(null)
const editPath = ref('')
const editLabel = ref('')

function addFolder() {
  const path = newFolderPath.value.trim()
  const label = newFolderLabel.value.trim() || path.split(/[\\/]/).pop() || path
  if (!path) return

  settingsStore.addRootFolder({ path, label })
  newFolderPath.value = ''
  newFolderLabel.value = ''
}

function startEdit(folder: RootFolder) {
  editingFolder.value = folder.path
  editPath.value = folder.path
  editLabel.value = folder.label
}

function saveEdit(oldPath: string) {
  settingsStore.updateRootFolder(oldPath, {
    path: editPath.value.trim(),
    label: editLabel.value.trim(),
  })
  editingFolder.value = null
}

function cancelEdit() {
  editingFolder.value = null
}

function removeFolder(path: string) {
  settingsStore.removeRootFolder(path)
}
</script>

<template>
  <div class="settings">
    <header class="settings__header">
      <h1 class="settings__title glow-text">Settings</h1>
    </header>

    <!-- Root Folders -->
    <section class="settings__section">
      <h2 class="section__title">
        <span class="section__icon">📁</span>
        Root Folders
      </h2>
      <p class="section__desc">
        Directories to scan for projects (one level deep, not recursive).
      </p>

      <div class="folder-list">
        <div
          v-for="folder in settingsStore.rootFolders"
          :key="folder.path"
          class="folder-item neon-card"
        >
          <!-- View mode -->
          <template v-if="editingFolder !== folder.path">
            <div class="folder-item__info">
              <span class="folder-item__label">{{ folder.label }}</span>
              <span class="folder-item__path">{{ folder.path }}</span>
            </div>
            <div class="folder-item__actions">
              <button class="icon-btn" title="Edit" @click="startEdit(folder)">✎</button>
              <button class="icon-btn icon-btn--danger" title="Remove" @click="removeFolder(folder.path)">✕</button>
            </div>
          </template>

          <!-- Edit mode -->
          <template v-else>
            <div class="folder-edit">
              <input
                v-model="editLabel"
                class="neon-input"
                placeholder="Label"
              />
              <input
                v-model="editPath"
                class="neon-input"
                placeholder="Path"
              />
              <div class="folder-edit__actions">
                <button class="neon-btn" @click="saveEdit(folder.path)"><span>Save</span></button>
                <button class="neon-btn neon-btn--magenta" @click="cancelEdit"><span>Cancel</span></button>
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- Add new folder -->
      <div class="add-folder neon-card">
        <h3>Add Root Folder</h3>
        <div class="add-folder__form">
          <input
            v-model="newFolderPath"
            class="neon-input"
            placeholder="D:\Projects"
            @keyup.enter="addFolder"
          />
          <input
            v-model="newFolderLabel"
            class="neon-input"
            placeholder="Label (optional)"
            @keyup.enter="addFolder"
          />
          <button class="neon-btn" @click="addFolder">
            <span>+ Add</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Source Connectors -->
    <section class="settings__section">
      <h2 class="section__title">
        <span class="section__icon">⚡</span>
        Source Connectors
      </h2>
      <p class="section__desc">
        Enable or disable data sources. Changes apply immediately.
      </p>

      <div class="connectors-list">
        <div
          v-for="connector in connectors"
          :key="connector.type"
          class="connector-item neon-card"
        >
          <div class="connector-item__info">
            <span
              class="connector-item__dot"
              :style="{ background: `var(${connector.color})` }"
            />
            <div>
              <span class="connector-item__label">{{ connector.label }}</span>
              <span class="connector-item__type">{{ connector.type }}</span>
            </div>
          </div>

          <label class="neon-toggle">
            <input
              type="checkbox"
              :checked="settingsStore.isSourceEnabled(connector.type)"
              @change="settingsStore.toggleSource(connector.type)"
            />
            <span class="slider" />
          </label>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings__header {
  margin-bottom: 2rem;
}

.settings__title {
  font-size: 2rem;
  font-weight: 800;
}

.settings__section {
  margin-bottom: 2.5rem;
  max-width: 700px;
}

.section__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.1rem;
  font-weight: 700;
  margin-bottom: 0.3rem;
}

.section__icon {
  font-size: 1.2rem;
}

.section__desc {
  color: var(--text-secondary);
  font-size: 0.82rem;
  margin-bottom: 1rem;
}

.folder-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.folder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.2rem;
}

.folder-item__info {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.folder-item__label {
  font-weight: 600;
  font-size: 0.9rem;
}

.folder-item__path {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}

.folder-item__actions {
  display: flex;
  gap: 0.5rem;
}

.icon-btn {
  background: none;
  border: 1px solid var(--border-dim);
  color: var(--text-secondary);
  width: 30px;
  height: 30px;
  border-radius: var(--radius);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  border-color: var(--neon-cyan);
  color: var(--neon-cyan);
}

.icon-btn--danger:hover {
  border-color: var(--neon-magenta);
  color: var(--neon-magenta);
}

.folder-edit {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.folder-edit__actions {
  display: flex;
  gap: 0.5rem;
}

.neon-input {
  width: 100%;
  padding: 0.6rem 0.8rem;
  font-size: 0.85rem;
  background: var(--bg-input);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius);
  color: var(--text-primary);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  font-family: inherit;
}

.neon-input:focus {
  border-color: var(--neon-cyan);
  box-shadow: 0 0 8px rgba(0, 240, 255, 0.15);
}

.neon-input::placeholder {
  color: var(--text-muted);
}

.add-folder {
  padding: 1.2rem;
}

.add-folder h3 {
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--text-secondary);
}

.add-folder__form {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}

.add-folder__form .neon-input {
  flex: 1;
}

.connectors-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.connector-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.2rem;
}

.connector-item__info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.connector-item__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.connector-item__label {
  font-weight: 600;
  font-size: 0.9rem;
  display: block;
}

.connector-item__type {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: 'Cascadia Code', 'Fira Code', monospace;
}
</style>
