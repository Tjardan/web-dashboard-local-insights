<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useProjectsStore } from "@/stores/projects";
import { getAllConnectors } from "@/connectors";
import type { RootFolder } from "@/types";
import { generateCodeVerifier, generateCodeChallenge, buildMsAuthUrl } from "@/utils/pkce";

const settingsStore = useSettingsStore();
const projectsStore = useProjectsStore();
const connectors = getAllConnectors();

const newFolderPath = ref("");
const newFolderLabel = ref("");
const editingFolder = ref<string | null>(null);
const editPath = ref("");
const editLabel = ref("");

// ── Teams auth state ────────────────────────────────────────────────────────
const teamsClientId = ref(settingsStore.settings.teamsConfig?.clientId ?? "");
const teamsTenantId = ref(settingsStore.settings.teamsConfig?.tenantId ?? "common");
const teamsAuth = ref<{ authenticated: boolean; userEmail?: string; displayName?: string } | null>(null);
const teamsAuthLoading = ref(false);

// ── Teams Power Automate file state ─────────────────────────────────────────
const teamsFilePath = ref(settingsStore.settings.teamsFilePath ?? "");
const teamsFileMode = ref<"graph" | "file">(
  settingsStore.settings.teamsFilePath ? "file" : "graph",
);

async function refreshTeamsAuthStatus() {
  try {
    const res = await fetch("/api/teams/auth/status");
    teamsAuth.value = await res.json();
  } catch {
    teamsAuth.value = { authenticated: false };
  }
}

async function connectTeams() {
  const clientId = teamsClientId.value.trim();
  const tenantId = teamsTenantId.value.trim() || "common";
  if (!clientId) return;

  settingsStore.updateTeamsConfig({ clientId, tenantId });

  teamsAuthLoading.value = true;
  try {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const redirectUri = `${window.location.origin}/auth/teams/callback`;

    // Persist PKCE state across the redirect
    sessionStorage.setItem("teams_pkce_verifier", verifier);
    sessionStorage.setItem("teams_client_id", clientId);
    sessionStorage.setItem("teams_tenant_id", tenantId);
    sessionStorage.setItem("teams_redirect_uri", redirectUri);

    const authUrl = buildMsAuthUrl({
      clientId,
      tenantId,
      redirectUri,
      codeChallenge: challenge,
      scopes: ["User.Read", "ChannelMessage.Read.All", "Chat.Read", "offline_access"],
    });

    window.location.href = authUrl;
  } finally {
    teamsAuthLoading.value = false;
  }
}

async function disconnectTeams() {
  await fetch("/api/teams/auth/revoke", { method: "POST" });
  teamsAuth.value = { authenticated: false };
}

function saveTeamsFilePath() {
  settingsStore.updateTeamsFilePath(teamsFilePath.value.trim());
}

onMounted(() => {
  refreshTeamsAuthStatus();
});

function addFolder() {
  const path = newFolderPath.value.trim();
  const label =
    newFolderLabel.value.trim() || path.split(/[\\/]/).pop() || path;
  if (!path) return;

  settingsStore.addRootFolder({ path, label });
  newFolderPath.value = "";
  newFolderLabel.value = "";
  projectsStore.loadAll();
}

function startEdit(folder: RootFolder) {
  editingFolder.value = folder.path;
  editPath.value = folder.path;
  editLabel.value = folder.label;
}

function saveEdit(oldPath: string) {
  settingsStore.updateRootFolder(oldPath, {
    path: editPath.value.trim(),
    label: editLabel.value.trim(),
  });
  editingFolder.value = null;
}

function cancelEdit() {
  editingFolder.value = null;
}

function removeFolder(path: string) {
  settingsStore.removeRootFolder(path);
  projectsStore.loadAll();
}
</script>

<template>
  <div class="settings">
    <header class="settings__header">
      <h1 class="settings__title glow-text">Settings</h1>
    </header>

    <!-- Theme -->
    <section class="settings__section">
      <h2 class="section__title">
        <span class="section__icon">◈</span>
        Theme
      </h2>
      <p class="section__desc">
        Choose a visual theme for the dashboard. Your preference is saved
        automatically.
      </p>

      <div class="theme-grid">
        <button
          class="theme-card"
          :class="{
            'theme-card--active': settingsStore.activeTheme === 'cyberpunk',
          }"
          @click="settingsStore.setTheme('cyberpunk')"
        >
          <div class="theme-card__header">
            <span class="theme-card__name">◆ CYBERPUNK</span>
            <span
              v-if="settingsStore.activeTheme === 'cyberpunk'"
              class="neon-badge neon-badge--chat"
              >ACTIVE</span
            >
          </div>
          <p class="theme-card__desc">
            Neon glow on deep black. Rounded cards, Inter font.
          </p>
          <div class="theme-swatches">
            <span class="swatch" style="background: #0a0a0f" />
            <span class="swatch" style="background: #1a1a2e" />
            <span class="swatch" style="background: #00f0ff" />
            <span class="swatch" style="background: #ff00aa" />
            <span class="swatch" style="background: #8b5cf6" />
          </div>
        </button>

        <button
          class="theme-card"
          :class="{
            'theme-card--active': settingsStore.activeTheme === 'sys-nexus',
          }"
          @click="settingsStore.setTheme('sys-nexus')"
        >
          <div class="theme-card__header">
            <span class="theme-card__name">■ SYS:NEXUS</span>
            <span
              v-if="settingsStore.activeTheme === 'sys-nexus'"
              class="neon-badge neon-badge--chat"
              >ACTIVE</span
            >
          </div>
          <p class="theme-card__desc">
            Navy terminal aesthetic. Sharp edges, mono font, CRT vignette.
          </p>
          <div class="theme-swatches">
            <span class="swatch" style="background: #030810" />
            <span class="swatch" style="background: #0d1e35" />
            <span class="swatch" style="background: #00f5ff" />
            <span class="swatch" style="background: #ff00aa" />
            <span class="swatch" style="background: #00ff88" />
          </div>
        </button>
      </div>
    </section>

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
              <button class="icon-btn" title="Edit" @click="startEdit(folder)">
                ✎
              </button>
              <button
                class="icon-btn icon-btn--danger"
                title="Remove"
                @click="removeFolder(folder.path)"
              >
                ✕
              </button>
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
              <input v-model="editPath" class="neon-input" placeholder="Path" />
              <div class="folder-edit__actions">
                <button class="neon-btn" @click="saveEdit(folder.path)">
                  <span>Save</span>
                </button>
                <button class="neon-btn neon-btn--magenta" @click="cancelEdit">
                  <span>Cancel</span>
                </button>
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

    <!-- Microsoft Teams -->
    <section class="settings__section">
      <h2 class="section__title">
        <span class="section__icon">💬</span>
        Microsoft Teams
      </h2>
      <p class="section__desc">
        Kies hoe je Teams-berichten worden opgehaald.
      </p>

      <!-- Mode tabs -->
      <div class="teams-tabs">
        <button
          class="teams-tab"
          :class="{ 'teams-tab--active': teamsFileMode === 'file' }"
          @click="teamsFileMode = 'file'"
        >
          📄 Power Automate (aanbevolen)
        </button>
        <button
          class="teams-tab"
          :class="{ 'teams-tab--active': teamsFileMode === 'graph' }"
          @click="teamsFileMode = 'graph'"
        >
          🔐 Graph API (Azure AD)
        </button>
      </div>

      <!-- ── Power Automate tab ── -->
      <div v-if="teamsFileMode === 'file'" class="neon-card teams-config">
        <p class="teams-config__hint" style="margin:0">
          Een Power Automate-flow schrijft je berichten als JSON-bestand naar OneDrive. De OneDrive sync-client
          plaatst het bestand lokaal op je schijf. Vul hieronder het lokale pad in.
        </p>

        <div class="teams-config__row">
          <label class="teams-config__label">Lokaal bestandspad</label>
          <input
            v-model="teamsFilePath"
            class="neon-input"
            placeholder="C:\Users\jij\OneDrive\DevPulse\teams-messages.json"
            autocomplete="off"
            spellcheck="false"
            @keyup.enter="saveTeamsFilePath"
          />
          <p class="teams-config__hint">
            Verwacht JSON-formaat: <code class="inline-code">{ "exportedAt": "...", "messages": [...] }</code>
          </p>
        </div>

        <div class="teams-config__actions">
          <button
            class="neon-btn"
            :disabled="!teamsFilePath.trim()"
            @click="saveTeamsFilePath"
          >
            <span>Pad opslaan</span>
          </button>
          <span
            v-if="settingsStore.settings.teamsFilePath"
            class="neon-badge neon-badge--teams-file"
          >
            ✓ OPGESLAGEN
          </span>
        </div>

        <!-- Power Automate flow instructie -->
        <details class="pa-guide">
          <summary class="pa-guide__toggle">Hoe stel ik de Power Automate-flow in?</summary>
          <div class="pa-guide__body">
            <ol class="pa-guide__steps">
              <li>Ga naar <a href="https://make.powerautomate.com" target="_blank" rel="noopener" class="link">make.powerautomate.com</a> en log in met je werkaccount.</li>
              <li>Klik <strong>+ Maken → Geplande cloudstroom</strong>. Kies een interval (bijv. elk uur).</li>
              <li>Voeg actie toe: <strong>Microsoft Teams – Get messages from a channel</strong>. Kies je team en kanaal. Herhaal voor meerdere kanalen.</li>
              <li>Voeg actie toe: <strong>Microsoft Teams – Get messages from a chat</strong> voor 1-op-1 chats.</li>
              <li>
                Voeg actie toe: <strong>OneDrive – Create file</strong>.<br />
                Pad: <code class="inline-code">/DevPulse/teams-messages.json</code><br />
                Inhoud: stel de volgende JSON samen met de <em>Select</em>-actie:
                <pre class="pa-guide__code">{
  "exportedAt": "@{utcNow()}",
  "messages": @{
    union(
      /* kanaalberichten */
      body('Get_channel_messages')?['value'],
      /* chatberichten */
      body('Get_chat_messages')?['value']
    )
  }
}</pre>
              </li>
              <li>Veld-mapping per bericht (gebruik <em>Select</em>): <code class="inline-code">id</code>, <code class="inline-code">body/content</code> als <code class="inline-code">body</code>, <code class="inline-code">createdDateTime</code>, <code class="inline-code">lastModifiedDateTime</code>, <code class="inline-code">kind</code> = "channel"/"chat", <code class="inline-code">channelName</code>, <code class="inline-code">teamName</code>, <code class="inline-code">chatName</code>.</li>
              <li>Sla de flow op en voer hem eenmalig handmatig uit. OneDrive sync plaatst het bestand vervolgens automatisch op je lokale schijf.</li>
            </ol>
          </div>
        </details>
      </div>

      <!-- ── Graph API tab ── -->
      <div v-else class="teams-graph-section">
        <p class="section__desc" style="margin-bottom:0.75rem">
          Vereist een Azure AD app-registratie. Heeft je organisatie IT-beheerders nodig?
          Gebruik dan de Power Automate-methode.
        </p>

        <!-- Auth status banner -->
        <div
          v-if="teamsAuth?.authenticated"
          class="teams-status teams-status--connected neon-card"
        >
          <span class="teams-status__dot" />
          <div class="teams-status__info">
            <span class="teams-status__name">{{ teamsAuth.displayName }}</span>
            <span class="teams-status__email">{{ teamsAuth.userEmail }}</span>
          </div>
          <button class="neon-btn neon-btn--magenta" @click="disconnectTeams">
            <span>Verwijder verbinding</span>
          </button>
        </div>

        <!-- Config form -->
        <div v-else class="neon-card teams-config">
          <div class="teams-config__row">
            <label class="teams-config__label">Application (Client) ID</label>
            <input
              v-model="teamsClientId"
              class="neon-input"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="teams-config__row">
            <label class="teams-config__label">Directory (Tenant) ID</label>
            <input
              v-model="teamsTenantId"
              class="neon-input"
              placeholder="common"
              autocomplete="off"
              spellcheck="false"
            />
            <p class="teams-config__hint">
              Gebruik <code class="inline-code">common</code> of je Tenant ID.
              Redirect URI voor Azure:
              <code class="inline-code">{{ `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'}/auth/teams/callback` }}</code>
            </p>
          </div>
          <button
            class="neon-btn"
            :disabled="!teamsClientId.trim() || teamsAuthLoading"
            @click="connectTeams"
          >
            <span>{{ teamsAuthLoading ? "Bezig…" : "Verbinden met Teams" }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Projects -->
    <section v-if="projectsStore.projects.length > 0" class="settings__section">
      <h2 class="section__title">
        <span class="section__icon">◈</span>
        Projects
      </h2>
      <p class="section__desc">
        Untracked projects are hidden from the dashboard and timeline. Toggle
        them here to restore visibility.
      </p>

      <div class="connectors-list">
        <div
          v-for="project in [...projectsStore.projects].sort((a, b) =>
            a.name.localeCompare(b.name),
          )"
          :key="project.id"
          class="connector-item neon-card"
          :class="{
            'connector-item--untracked': !settingsStore.isProjectTracked(
              project.id,
            ),
          }"
        >
          <div class="connector-item__info">
            <div>
              <span class="connector-item__label">{{ project.name }}</span>
              <span class="connector-item__type">{{ project.path }}</span>
            </div>
          </div>

          <label class="neon-toggle">
            <input
              type="checkbox"
              :checked="settingsStore.isProjectTracked(project.id)"
              @change="settingsStore.toggleProjectTracking(project.id)"
            />
            <span class="slider" />
          </label>
        </div>
      </div>
    </section>

    <!-- Appearance -->
    <section class="settings__section">
      <h2 class="section__title">
        <span class="section__icon">🎨</span>
        Appearance
      </h2>
      <p class="section__desc">
        Adjust the maximum width of the content area across all pages.
      </p>

      <div class="neon-card width-control">
        <div class="width-control__row">
          <label class="width-control__label">Content max-width</label>
          <span class="width-control__value neon-badge neon-badge--chat">
            {{ settingsStore.maxContentWidth }}px
          </span>
        </div>
        <input
          type="range"
          class="width-slider"
          min="600"
          max="2400"
          step="100"
          :value="settingsStore.maxContentWidth"
          @input="
            settingsStore.setMaxContentWidth(
              Number(($event.target as HTMLInputElement).value),
            )
          "
        />
        <div class="width-presets">
          <button
            v-for="preset in [800, 1000, 1200, 1440, 1920]"
            :key="preset"
            class="neon-btn width-preset-btn"
            :class="{
              'neon-btn--active': settingsStore.maxContentWidth === preset,
            }"
            @click="settingsStore.setMaxContentWidth(preset)"
          >
            <span>{{ preset }}</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.width-control {
  padding: 1rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.width-control__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.width-control__label {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.width-control__value {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.width-slider {
  width: 100%;
  accent-color: var(--neon-cyan);
  cursor: pointer;
}

.width-presets {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.width-preset-btn {
  font-size: 0.75rem;
  padding: 0.25rem 0.6rem;
  opacity: 0.7;
  transition: opacity 0.15s ease;
}

.width-preset-btn.neon-btn--active {
  opacity: 1;
  box-shadow: 0 0 8px var(--neon-cyan);
}
.settings__header {
  margin-bottom: 2rem;
}

.settings__title {
  font-size: 2rem;
  font-weight: 800;
}

.settings__section {
  margin-bottom: 2.5rem;
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
  font-family: "Cascadia Code", "Fira Code", monospace;
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
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
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
  font-family: "Cascadia Code", "Fira Code", monospace;
}

.connector-item--untracked {
  opacity: 0.5;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}

.theme-card {
  appearance: none;
  -webkit-appearance: none;
  background: var(--bg-card);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  transition: all 0.25s ease;
  position: relative;
  overflow: hidden;
}

.theme-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-neon);
  transform: translateY(-2px);
  box-shadow: var(--glow-cyan);
}

.theme-card--active {
  border-color: var(--neon-cyan) !important;
  box-shadow: var(--glow-cyan) !important;
}

.theme-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.theme-card__name {
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--text-primary);
}

.theme-card__desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.theme-swatches {
  display: flex;
  gap: 6px;
  margin-top: 0.25rem;
}

.swatch {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  display: inline-block;
  flex-shrink: 0;
}

/* ── Teams section ───────────────────────────────────────── */
.teams-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.teams-tab {
  padding: 0.4rem 1rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.82rem;
  transition: border-color 0.15s, color 0.15s;
}

.teams-tab:hover {
  border-color: var(--neon-yellow);
  color: var(--text-primary);
}

.teams-tab--active {
  border-color: var(--neon-yellow);
  color: var(--neon-yellow);
  background: rgba(255, 230, 0, 0.06);
}

.teams-graph-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.teams-config__actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.pa-guide {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 1rem;
  margin-top: 0.5rem;
}

.pa-guide__toggle {
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--neon-cyan);
  user-select: none;
  list-style: none;
}

.pa-guide__toggle::-webkit-details-marker { display: none; }

.pa-guide__body {
  margin-top: 0.75rem;
}

.pa-guide__steps {
  padding-left: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  font-size: 0.82rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.pa-guide__steps li strong {
  color: var(--text-primary);
}

.pa-guide__code {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 0.6rem 0.8rem;
  font-size: 0.78rem;
  font-family: monospace;
  white-space: pre;
  overflow-x: auto;
  margin: 0.4rem 0 0;
  color: var(--neon-green);
}
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
}

.teams-status--connected {
  border-color: var(--neon-green);
}

.teams-status__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--neon-green);
  flex-shrink: 0;
  box-shadow: 0 0 8px var(--neon-green);
}

.teams-status__info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.teams-status__name {
  font-weight: 600;
  font-size: 0.9rem;
}

.teams-status__email {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.teams-config {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.25rem;
}

.teams-config__row {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.teams-config__label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.teams-config__hint {
  font-size: 0.78rem;
  color: var(--text-secondary);
  margin: 0;
}

.inline-code {
  font-family: monospace;
  background: rgba(255, 255, 255, 0.08);
  padding: 0.1em 0.35em;
  border-radius: 3px;
  font-size: 0.9em;
}

.link {
  color: var(--neon-cyan);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
</style>
