import { defineConfig } from "vite";

/**
 * Fixture gallery for @rowfolio/charts — a self-contained Vite app used by
 * the visual suite in tests/visual/charts. It renders every chart kind across
 * locale, edge-case and viewport combinations; it is not a product route.
 */
export default defineConfig({
  root: "gallery",
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
