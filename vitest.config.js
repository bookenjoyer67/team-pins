import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [resolve(root, "tests/setup.js")],
    testTimeout: 15000,
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
  },
  resolve: {
    alias: {
      path: resolve(root, "path-shim.js"),
      util: resolve(root, "util-shim.js"),
      leaflet: resolve(root, "leaflet-shim.js"),
      "leaflet-draw": resolve(root, "leaflet-shim.js"),
      "leaflet.markercluster": resolve(root, "leaflet-shim.js"),
    },
  },
  define: {
    "process.env": "{}",
    "process.cwd": "(() => '/')",
    "process.platform": "'browser'",
    "process.version": "'v0.0.0'",
  },
});
