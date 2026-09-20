import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Upload-review harness for tests/visual/upload — mounts the real UploadFlow
 * with the real ingest ports; not a product route.
 *
 * tests/ is not a pnpm workspace package, so the strict store cannot resolve
 * react/@rowfolio/* from here — aliases point at the workspace sources and
 * apps/web's dependency links (same versions the app builds with).
 */
const repo = fileURLToPath(new URL("../../../..", import.meta.url));
const web = `${repo}/apps/web/node_modules`;
const ui = `${repo}/packages/ui/node_modules`;

export default defineConfig({
  root: "gallery",
  resolve: {
    alias: {
      "react-dom/client": `${web}/react-dom/client.js`,
      "react-dom": `${web}/react-dom/index.js`,
      "react/jsx-runtime": `${web}/react/jsx-runtime.js`,
      "react/jsx-dev-runtime": `${web}/react/jsx-dev-runtime.js`,
      react: `${web}/react/index.js`,
      "@rowfolio/contracts": `${repo}/packages/contracts/src/index.ts`,
      "@rowfolio/i18n": `${repo}/packages/i18n/src/index.ts`,
      "@rowfolio/ingest": `${repo}/packages/ingest/src/index.ts`,
      "@fontsource/ibm-plex-sans": `${ui}/@fontsource/ibm-plex-sans`,
      "@fontsource/ibm-plex-sans-arabic": `${ui}/@fontsource/ibm-plex-sans-arabic`,
      "@fontsource/ibm-plex-mono": `${ui}/@fontsource/ibm-plex-mono`,
      "@rowfolio/ui/fonts": `${repo}/packages/ui/src/fonts.ts`,
      "@rowfolio/ui": `${repo}/packages/ui/src/index.ts`,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 4532,
    strictPort: true,
  },
  preview: {
    port: 4532,
    strictPort: true,
  },
});
