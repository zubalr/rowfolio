import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * Rowfolio import-boundary policy.
 *
 * The architecture (static shell, isolated workers, pure computation packages)
 * is enforced here. Heavy parser/export libraries may be imported only by the
 * packages that own them; pure packages never see React, Vite, the network or
 * the filesystem. The landing entry must never eagerly reach parser or export
 * libraries — the bundle-level check lives in scripts/audit-static.mjs.
 */

const SRC = ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"];

// Server frameworks, telemetry/analytics SDKs, model SDKs and cloud services are
// banned repository-wide for application source. The product has no backend.
const FORBIDDEN_RUNTIME = [
  "express",
  "fastify",
  "koa",
  "hono",
  "next",
  "openai",
  "@anthropic-ai/*",
  "@google-ai/*",
  "@google/generative-ai",
  "firebase",
  "firebase/*",
  "@firebase/*",
  "@supabase/*",
  "aws-sdk",
  "@aws-sdk/*",
  "@sentry/*",
  "posthog-*",
  "@posthog/*",
  "@segment/*",
  "mixpanel*",
  "@amplitude/*",
  "applicationinsights",
  "zod-to-json-schema",
];

const NODE_BUILTINS = [
  "node:*",
  "fs",
  "path",
  "os",
  "http",
  "https",
  "net",
  "tls",
  "child_process",
  "worker_threads",
  "fs/promises",
  "stream",
  "zlib",
  "crypto",
  "util",
];

// Deep-import / relative-escape bans that apply to every source file.
const BOUNDARY_PATTERNS = ["@rowfolio/*/*", "**/packages/**", "**/apps/**"];

const pure = (patterns) => ({
  files: patterns,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["react", "react-dom", "react/*", "vite", "vitest", ...BOUNDARY_PATTERNS],
            message: "Pure computation packages must not import UI or build tooling.",
          },
        ],
      },
    ],
  },
});

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.vite/**",
      "coverage/**",
      "vendor/**",
      "**/*.min.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: SRC,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [...FORBIDDEN_RUNTIME, ...NODE_BUILTINS, ...BOUNDARY_PATTERNS],
              message:
                "Forbidden for browser application source: no server frameworks, no telemetry/model SDKs, no Node builtins, no deep package imports.",
            },
          ],
        },
      ],
    },
  },
  // Pure computation packages: no parsing/export/UI/network dependencies at all.
  pure([
    "packages/contracts/**/*.ts",
    "packages/normalize/**/*.ts",
    "packages/analysis/**/*.ts",
    "packages/provenance/**/*.ts",
    "packages/scenario/**/*.ts",
    "packages/export-model/**/*.ts",
    "packages/i18n/**/*.ts",
  ]),
  {
    files: [
      "packages/contracts/**/*.ts",
      "packages/normalize/**/*.ts",
      "packages/analysis/**/*.ts",
      "packages/provenance/**/*.ts",
      "packages/scenario/**/*.ts",
      "packages/export-model/**/*.ts",
      "packages/i18n/**/*.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "react",
                "react-dom",
                "react/*",
                "vite",
                "vitest",
                "xlsx",
                "exceljs",
                "pptxgenjs",
                "papaparse",
                "fflate",
                "d3-*",
                "motion",
                "motion/*",
                ...NODE_BUILTINS,
                ...FORBIDDEN_RUNTIME,
                ...BOUNDARY_PATTERNS,
              ],
              message:
                "Pure packages must stay free of parser, export, UI, framework and platform dependencies.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/ingest/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "exceljs", "pptxgenjs", "d3-*", "motion", "motion/*", ...NODE_BUILTINS, ...BOUNDARY_PATTERNS],
              message: "ingest owns parsing (xlsx/papaparse/fflate); it must not import export or UI libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/export-xlsx/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "xlsx", "papaparse", "pptxgenjs", "d3-*", "motion", "motion/*", ...NODE_BUILTINS, ...BOUNDARY_PATTERNS],
              message: "export-xlsx is the sole ExcelJS consumer; parser/PPTX/UI libraries are forbidden here.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/export-pptx/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*", "xlsx", "papaparse", "exceljs", "d3-*", "motion", "motion/*", ...NODE_BUILTINS, ...BOUNDARY_PATTERNS],
              message: "export-pptx is the sole PptxGenJS consumer; parser/XLSX/UI libraries are forbidden here.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/ui/**/*.ts", "packages/ui/**/*.tsx", "packages/charts/**/*.ts", "packages/charts/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["xlsx", "exceljs", "pptxgenjs", "papaparse", "fflate", ...NODE_BUILTINS, ...BOUNDARY_PATTERNS],
              message: "Presentation packages must not reach parser or export libraries.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/landing/**/*.ts", "apps/web/src/landing/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "xlsx",
                "exceljs",
                "pptxgenjs",
                "papaparse",
                "fflate",
                "d3-*",
                "@rowfolio/ingest",
                "@rowfolio/export-xlsx",
                "@rowfolio/export-pptx",
                "@rowfolio/export-model",
                "@rowfolio/analysis",
                "@rowfolio/scenario",
                "@rowfolio/normalize",
                "@rowfolio/provenance",
                ...NODE_BUILTINS,
                ...BOUNDARY_PATTERNS,
              ],
              message:
                "The landing entry must not eagerly import parser, export, analysis or chart libraries — they load after explicit intent.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.{mjs,ts}", "*.config.{mjs,ts}", "apps/web/vite.config.ts", "vitest.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["apps/**/*.ts", "apps/**/*.tsx", "packages/ui/**/*.tsx", "packages/charts/**/*.tsx"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["packages/ingest/**/*.ts", "packages/export-xlsx/**/*.ts", "packages/export-pptx/**/*.ts", "apps/web/src/workers/**/*.ts"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "tests/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
