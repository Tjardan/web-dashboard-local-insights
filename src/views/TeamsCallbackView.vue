<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";

const router = useRouter();
const status = ref<"processing" | "success" | "error">("processing");
const message = ref("Verwerken van Microsoft-authenticatie…");

onMounted(async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    if (error) {
      throw new Error(errorDescription ?? error);
    }
    if (!code) {
      throw new Error("Geen autorisatiecode ontvangen van Microsoft.");
    }

    const codeVerifier = sessionStorage.getItem("teams_pkce_verifier");
    const clientId = sessionStorage.getItem("teams_client_id");
    const tenantId = sessionStorage.getItem("teams_tenant_id");
    const redirectUri = sessionStorage.getItem("teams_redirect_uri");

    if (!codeVerifier || !clientId || !tenantId || !redirectUri) {
      throw new Error(
        "PKCE-session verlopen of onjuist. Start de autorisatie opnieuw vanuit Instellingen.",
      );
    }

    // Exchange the code for tokens via the Vite API plugin (server-side)
    const res = await fetch("/api/teams/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, codeVerifier, redirectUri, clientId, tenantId }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
        error: string;
      };
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }

    const data = (await res.json()) as { displayName: string; userEmail: string };

    // Clean up session storage
    sessionStorage.removeItem("teams_pkce_verifier");
    sessionStorage.removeItem("teams_client_id");
    sessionStorage.removeItem("teams_tenant_id");
    sessionStorage.removeItem("teams_redirect_uri");

    status.value = "success";
    message.value = `Verbonden als ${data.displayName} (${data.userEmail}). Doorsturen…`;

    setTimeout(() => router.push("/settings"), 1500);
  } catch (err) {
    status.value = "error";
    message.value = `Authenticatie mislukt: ${(err as Error).message}`;
  }
});
</script>

<template>
  <div class="callback">
    <div class="callback__card neon-card">
      <div class="callback__icon" :class="`callback__icon--${status}`">
        <span v-if="status === 'processing'">⟳</span>
        <span v-else-if="status === 'success'">✓</span>
        <span v-else>✕</span>
      </div>
      <h1 class="callback__title glow-text">Microsoft Teams</h1>
      <p class="callback__message">{{ message }}</p>
      <button
        v-if="status === 'error'"
        class="neon-btn"
        @click="$router.push('/settings')"
      >
        <span>Terug naar Instellingen</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.callback {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.callback__card {
  max-width: 420px;
  width: 100%;
  padding: 2.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.2rem;
}

.callback__icon {
  font-size: 2.5rem;
  line-height: 1;
}

.callback__icon--processing {
  color: var(--neon-cyan);
  animation: spin 1s linear infinite;
}
.callback__icon--success { color: var(--neon-green); }
.callback__icon--error   { color: var(--neon-magenta); }

.callback__title {
  font-size: 1.4rem;
  margin: 0;
}

.callback__message {
  color: var(--text-secondary);
  line-height: 1.5;
  margin: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
