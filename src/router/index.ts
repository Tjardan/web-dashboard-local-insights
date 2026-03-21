import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "dashboard",
      component: () => import("@/views/DashboardView.vue"),
      meta: { transition: "slide-up", fullWidth: true },
    },
    {
      path: "/timeline",
      name: "timeline",
      component: () => import("@/views/TimelineView.vue"),
      meta: { transition: "slide-left" },
    },
    {
      path: "/search",
      name: "search",
      component: () => import("@/views/SearchView.vue"),
      meta: { transition: "slide-left" },
    },
    {
      path: "/project/:id",
      name: "project",
      component: () => import("@/views/ProjectView.vue"),
      meta: { transition: "slide-left" },
    },
    {
      path: "/project/:id/chats",
      name: "project-chats",
      component: () => import("@/views/ProjectChatsView.vue"),
      meta: { transition: "slide-left" },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/views/SettingsView.vue"),
      meta: { transition: "fade" },
    },
    {
      path: "/auth/teams/callback",
      name: "teams-callback",
      component: () => import("@/views/TeamsCallbackView.vue"),
      meta: { transition: "fade" },
    },
  ],
});

export default router;
