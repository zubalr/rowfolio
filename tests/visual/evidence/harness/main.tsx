/**
 * Evidence visual harness — mounts the real `EvidenceDialog` behind a
 * "Show me why" trigger so Playwright exercises genuine open/close/focus
 * semantics. Fixture data comes from the validated contract examples through
 * `support/scenarios.ts`; services are the reference adapter (real contract
 * evaluator), never stubs.
 *
 * Query: ?scenario=<EvidenceScenario>&lang=en|ar
 */
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createI18n, type I18n } from "@rowfolio/i18n";
import { directionOf } from "@rowfolio/ui";
import "@rowfolio/ui/fonts";
import "../../../../apps/web/src/evidence/evidence.css";
import { EvidenceDialog } from "../../../../apps/web/src/evidence/index.ts";
import { scenarioFixture, type EvidenceScenario } from "../support/fixtures.ts";
import { referenceServices } from "../support/services.ts";
import "./harness.css";

const params = new URLSearchParams(location.search);
const locale = params.get("lang") === "ar" ? "ar" : "en";
const scenario = (params.get("scenario") ?? "revenue-gap") as EvidenceScenario;
document.documentElement.lang = locale;
document.documentElement.dir = directionOf(locale);

function Harness() {
  const i18n: I18n = useMemo(() => createI18n({ locale }), []);
  const { bundle } = useMemo(() => scenarioFixture(scenario), []);
  const services = useMemo(
    () => referenceServices(bundle.table, bundle.snapshot.provenance),
    [bundle],
  );
  const [open, setOpen] = useState(false);
  return (
    <div className="harness__page">
      <p className="harness__finding">{i18n.t("finding.north.title")}</p>
      <button
        type="button"
        className="harness__trigger"
        data-testid="open-evidence"
        onClick={() => setOpen(true)}
      >
        {i18n.t("action.showWhy")}
      </button>
      <button type="button" data-testid="after-evidence">
        After
      </button>
      <EvidenceDialog
        open={open}
        onClose={() => setOpen(false)}
        bundle={bundle}
        services={services}
        i18n={i18n}
      />
    </div>
  );
}

const host = document.getElementById("root");
if (host === null) throw new Error("harness root missing");
createRoot(host).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
