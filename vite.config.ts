import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";
import { devPulseApiPlugin } from "./src/server/api-plugin";

export default defineConfig({
  plugins: [vue(), devPulseApiPlugin()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    open: true,
  },
});
