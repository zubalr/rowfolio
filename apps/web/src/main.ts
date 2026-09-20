import { createElement } from "react";
import { createRoot } from "react-dom/client";
// `./fonts` is a declared subpath export of @rowfolio/ui (see
// packages/ui/package.json exports); the deep-path lint pattern cannot see
// export maps. Lease + rule narrowing requested in the PR body.
// eslint-disable-next-line no-restricted-imports
import "@rowfolio/ui/fonts";
// Deep imports (not the barrel) so the lazy preview payload stays out of
// the entry chunk — index.ts re-exports preview modules with top-level work.
import { LandingApp } from "./landing/LandingApp.tsx";
import { createLandingI18n } from "./landing/i18n.ts";
import "./landing/landing.css";

// App entry: mounts the bilingual landing on both static locale entries
// (/ and /ar/). The workspace route (#/workspace) is composed by the app
// session layer; pending intents are handed over via src/landing/pendingUpload.
const host = document.getElementById("root");
if (host) {
  const i18n = createLandingI18n();
  createRoot(host).render(createElement(LandingApp, { i18n }));
}
