/**
 * Upload harness entry — mounts the real UploadFlow for ?lang=en|ar.
 * The contract profile is the deterministic test profiler (same logic as the
 * vitest suite); when @rowfolio/normalize lands this port binds to it instead.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@rowfolio/ui/fonts";
import { createI18n, directionOf } from "@rowfolio/i18n";
import type { Locale } from "@rowfolio/contracts";
import { UploadFlow, ingestPorts } from "../../../../apps/web/src/upload/index.ts";
import { testProfile } from "../unit/test-ports.ts";

const params = new URLSearchParams(location.search);
const locale: Locale = params.get("lang") === "ar" ? "ar" : "en";
document.documentElement.lang = locale;
document.documentElement.dir = directionOf(locale);

const i18n = createI18n({ locale });
const ports = { ...ingestPorts(), profile: testProfile };

const host = document.getElementById("root");
if (!host) throw new Error("harness root missing");

createRoot(host).render(
  <StrictMode>
    <UploadFlow
      i18n={i18n}
      ports={ports}
      onComplete={(outcome) => {
        // Deterministic completion marker for specs — provenance, not content.
        const marker = document.createElement("output");
        marker.dataset.testid = "upload-complete";
        marker.dataset.sourceHash = outcome.sourceHash;
        marker.dataset.format = outcome.table.sourceRef.format;
        document.body.append(marker);
      }}
    />
  </StrictMode>,
);
