import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Fixture app for the evidence surface (owned path tests/visual/evidence).
 *
 * Workspace packages and React resolve through explicit aliases: tests/* is
 * not a pnpm workspace member, so bare specifiers do not resolve from here on
 * their own. Aliases point at the real package sources and the app's own
 * react install — the harness exercises production code, not a copy.
 */
const appModules = fileURLToPath(new URL("../../../../apps/web/node_modules", import.meta.url));
const packagesDir = fileURLToPath(new URL("../../../../packages", import.meta.url));

export default defineConfig({
  // Config lives in the harness dir; `root` must resolve absolutely because the
  // webServer command runs from the repo root.
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: [
      { find: /^react$/, replacement: `${appModules}/react` },
      { find: /^react\/(.*)$/, replacement: `${appModules}/react/$1` },
      { find: /^react-dom\/(.*)$/, replacement: `${appModules}/react-dom/$1` },
      { find: /^react-dom$/, replacement: `${appModules}/react-dom` },
      { find: /^@rowfolio\/ui\/fonts$/, replacement: `${packagesDir}/ui/src/fonts.ts` },
      {
        find: /^@rowfolio\/([^/]+)$/,
        replacement: `${packagesDir}/$1/src/index.ts`,
      },
    ],
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
