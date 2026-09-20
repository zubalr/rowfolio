import { defineConfig } from "vite";

/**
 * Fixture/story gallery for @rowfolio/ui — a self-contained Vite app used by
 * the visual tests in tests/visual/ui. It renders every primitive across
 * locale, surface and state combinations; it is not a product route.
 *
 * JSX runs through the default oxc transform (react-jsx per tsconfig) —
 * no @vitejs/plugin-react needed for this fixture app.
 */
export default defineConfig({
  root: "gallery",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 4531,
    strictPort: true,
  },
  preview: {
    port: 4531,
    strictPort: true,
  },
});
