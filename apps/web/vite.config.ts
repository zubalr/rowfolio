import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * Emits `.vite/module-map.json` recording which source modules ended up in each
 * emitted chunk. scripts/audit-static.mjs uses it to prove the landing entry
 * graph contains no parser/export/analysis modules (see 07_ARCHITECTURE.md:
 * "Landing must not eagerly import SheetJS, ExcelJS, PptxGenJS or D3").
 */
function moduleMapPlugin(): Plugin {
  return {
    name: "rowfolio-module-map",
    apply: "build",
    generateBundle(_options, bundle) {
      const map: Record<string, string[]> = {};
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type === "chunk") {
          map[fileName] = Object.keys(chunk.modules).sort();
        }
      }
      this.emitFile({
        type: "asset",
        fileName: ".vite/module-map.json",
        source: JSON.stringify(map),
      });
    },
  };
}

// Static multi-page build: `/` is the English landing entry and `/ar/` the
// Arabic one, per 02_PRODUCT_SPEC.md / 19_DEPLOYMENT_AND_COST.md. The workspace
// is client-rendered under `#/workspace` on the same entries; no server routing
// or server-side rendering exists.
export default defineConfig({
  appType: "mpa",
  // Vercel sets VERCEL_ENV at build time (production|preview|development);
  // expose it so analytics mounts only on production deployments.
  define: {
    "import.meta.env.VITE_VERCEL_ENV": JSON.stringify(process.env.VERCEL_ENV ?? ""),
  },
  plugins: [react(), moduleMapPlugin()],
  build: {
    manifest: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: "index.html",
        ar: "ar/index.html",
      },
    },
  },
});
