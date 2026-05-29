import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { resolve, relative, join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

const root = import.meta.dirname;

function walkDir(dir, base) {
  const entries = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walkDir(full, base));
    } else {
      entries.push("/" + relative(base, full).replace(/\\/g, "/"));
    }
  }
  return entries;
}

function injectPrecache() {
  const distDir = resolve(root, "dist");
  const files = walkDir(distDir, distDir);
  const precacheUrls = files
    .filter((f) => f !== "/sw.js" && !f.startsWith("/.vite"))
    .sort();
  const version = createHash("sha1")
    .update(JSON.stringify(precacheUrls))
    .digest("hex")
    .slice(0, 8);
  const swPath = resolve(distDir, "sw.js");
  let sw = readFileSync(swPath, "utf-8");
  sw = sw.replace("__PRECACHE_URLS__", JSON.stringify(precacheUrls));
  sw = sw.replace("__VERSION__", version);
  writeFileSync(swPath, sw);
  console.log(`[precache] Injected ${precacheUrls.length} URLs into sw.js (v${version})`);
}

export default defineConfig({
  plugins: [
    basicSsl(),
    {
      name: "inject-precache",
      apply: "build",
      closeBundle: injectPrecache,
    },
  ],
  server: { open: false, host: "127.0.0.1" },
  optimizeDeps: {
    exclude: ["./core/pkg/e2e_core.js"],
  },
  resolve: {
    alias: {
      leaflet: resolve(root, "leaflet-shim.js"),
      "leaflet-draw": resolve(root, "leaflet-shim.js"),
      "leaflet.markercluster": resolve(root, "leaflet-shim.js"),
      path: resolve(root, "path-shim.js"),
      util: resolve(root, "util-shim.js"),
    },
  },
  build: {
    target: "esnext",
  },
  define: {
    "process.env": "{}",
    "process.cwd": "(() => '/')",
    "process.platform": "'browser'",
    "process.version": "'v0.0.0'",
  },
});
