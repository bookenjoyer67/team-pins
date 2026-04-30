import { defineConfig } from "vite";
export default defineConfig({
  server: { open: true },
  optimizeDeps: {
    exclude: ["./core/pkg/e2e_core.js"],
  },
  build: {
    target: "esnext",
  },
});
