import { createElement, Fragment, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
// `./fonts` is a declared subpath export of @rowfolio/ui (see
// packages/ui/package.json exports); the deep-path lint pattern cannot see
// export maps. Lease + rule narrowing requested in the PR body.
// eslint-disable-next-line no-restricted-imports
import "@rowfolio/ui/fonts";
import { App } from "./app/App.tsx";
import { createAppServices } from "./app/services.ts";
import { analyticsBeforeSend } from "./app/analytics.ts";
import "./app/app.css";

// Composition root: i18n + session controller + Blob URL registry. The real
// landing (`LandingApp`), upload (`UploadFlow`) and evidence surfaces resolve
// through lazy feature slots, and all heavy work sits behind lazy boundaries
// (workspace chunk, workers, engines) so the entry stays light — enforced by
// scripts/audit-static.ts and the bundle-budget audit.
const host = document.getElementById("root");
if (host) {
  const children: ReactElement[] = [
    createElement(App, { services: createAppServices() }),
  ];
  if (import.meta.env.PROD && import.meta.env.VITE_VERCEL_ENV === "production") {
    const { Analytics } = await import("@vercel/analytics/react");
    children.push(
      createElement(Analytics, { mode: "production", beforeSend: analyticsBeforeSend }),
    );
  }
  createRoot(host).render(createElement(Fragment, null, ...children));
}
