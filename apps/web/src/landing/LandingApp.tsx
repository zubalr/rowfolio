/**
 * LandingApp — presentation-first entry (brief authority): a compact
 * identity + language header, then one dominant presentation stage that
 * plays the spreadsheet → chart → report story automatically. The working
 * product stays one click away through the masthead's persistent workspace
 * entry and the end-of-scene actions.
 *
 * Below the stage, the real working specimen (PreviewLoader lazy chunk)
 * keeps the four-beat demonstration and its e2e testids; a short hand band
 * carries Check-the-data / Upload / Guide.
 *
 * No parser/export/chart library is reachable from this graph, and nothing
 * touches `window` at module scope, so the entry stays prerender-safe.
 */
import { Suspense, lazy, useRef, useState } from "react";
import { Button, Icon, SkipLink } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { landingCopy } from "./copy.ts";
import type { PendingDemoAction } from "./PreviewLoader.tsx";
import { PresentationStage } from "./PresentationStage.tsx";
import { persistLocaleChoice } from "./i18n.ts";
import { scrollToId, siblingLocaleHref, workspaceHref } from "./routes.ts";
import { setWorkspaceIntent } from "./pendingUpload.ts";
import "./landing.css";

const PreviewLoader = lazy(() => import("./PreviewLoader.tsx"));

const UPLOAD_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface LandingAppProps {
  readonly i18n: I18n;
}

const STEPS = [
  { key: "spot", action: "reveal" },
  { key: "inspect", action: "evidence" },
  { key: "assume", action: "scenario" },
  { key: "brief", action: "briefing" },
] as const;

export function LandingApp({ i18n }: LandingAppProps) {
  const [pendingDemo, setPendingDemo] = useState<PendingDemoAction | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);

  const requestDemo = (action: PendingDemoAction) => {
    setPendingDemo(action);
    scrollToId("demo");
  };
  const exploreSample = () => {
    setWorkspaceIntent({ kind: "sample" });
    requestDemo("explore");
  };
  const startGuide = () => {
    setWorkspaceIntent({ kind: "guide" });
    requestDemo("guide");
  };
  const openWorkspace = () => {
    setWorkspaceIntent({ kind: "sample" });
    window.location.hash = workspaceHref();
  };
  const pickUpload = () => uploadInput.current?.click();
  const onFileChosen = (file: File | undefined) => {
    if (file === undefined) return;
    // The file stays in memory only — the workspace session claims the
    // intent on the workspace route; nothing is parsed on the landing.
    setWorkspaceIntent({ kind: "upload", file });
    window.location.hash = workspaceHref();
  };

  return (
    <>
      <SkipLink targetId="#main">{i18n.t("a11y.skip")}</SkipLink>

      <header className="rf-masthead">
        <a className="rf-brand" href={i18n.locale === "ar" ? "/ar/" : "/"}>
          <span className="rf-brand__mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {i18n.t("brand.name")}
        </a>
        <nav className="rf-nav" aria-label="Rowfolio">
          <a href="#demo">{i18n.t("nav.demo")}</a>
          <a href="https://github.com/zubalr/rowfolio" rel="noopener noreferrer">
            {i18n.t("nav.github")}
          </a>
          <a
            className="rf-lang"
            href={siblingLocaleHref(i18n.locale)}
            lang={i18n.locale === "ar" ? "en" : "ar"}
            onClick={(e) => {
              // Carry the presentation chapter across the locale switch —
              // it lives in the landing hash (`#/pres-ch=N`), no storage.
              // Modified clicks keep the native href (new tab/window).
              const h = window.location.hash;
              const carry = h.startsWith("#/pres-ch") ? h : "";
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
                if (carry !== "") {
                  e.currentTarget.href = e.currentTarget.href.split("#")[0]! + carry;
                }
                persistLocaleChoice(i18n, i18n.locale === "ar" ? "en" : "ar");
                return;
              }
              e.preventDefault();
              persistLocaleChoice(i18n, i18n.locale === "ar" ? "en" : "ar");
              window.location.assign(e.currentTarget.href.split("#")[0]! + carry);
            }}
          >
            {i18n.localeName(i18n.locale === "ar" ? "en" : "ar")}
          </a>
          <Button
            variant="secondary"
            iconEnd="arrow-end"
            onClick={openWorkspace}
            className="rf-masthead__ws"
          >
            {landingCopy(i18n.locale, "pres.openWorkspace")}
          </Button>
        </nav>
      </header>

      <main id="main">
        {/* The presentation — auto-playing first screen. */}
        <PresentationStage i18n={i18n} />

        {/* The large working specimen — real mechanism, real values. */}
        <Suspense
          fallback={
            <section className="rf-stage rf-ledger" id="demo" aria-labelledby="rf-preview-title">
              <header className="rf-stage__head">
                <div>
                  <h2 id="rf-preview-title" className="rf-stage__title">
                    {i18n.t("workspace.findings")}
                  </h2>
                  <span className="rf-skeleton" aria-hidden="true" style={{ inlineSize: "12em", marginBlockStart: "0.5em" }} />
                </div>
              </header>
              <span className="rf-skeleton" aria-hidden="true" style={{ blockSize: "15em", inlineSize: "min(38em, 100%)" }} />
            </section>
          }
        >
          <PreviewLoader
            i18n={i18n}
            pendingAction={pendingDemo}
            onActionHandled={() => setPendingDemo(null)}
          />
        </Suspense>

        {/* Staged demonstration — each beat is one sentence and one action. */}
        <section className="rf-steps" aria-labelledby="rf-steps-title">
          <h2 id="rf-steps-title" className="rf-steps__title">
            {landingCopy(i18n.locale, "demo.band.title")}
          </h2>
          <ol className="rf-steps__list">
            {STEPS.map((step, i) => (
              <li className="rf-steps__step" key={step.key}>
                <span className="rf-steps__num" aria-hidden="true">
                  {`0${i + 1}`}
                </span>
                <h3 className="rf-steps__name">{landingCopy(i18n.locale, `demo.step.${step.key}.title`)}</h3>
                <p className="rf-steps__body">{landingCopy(i18n.locale, `demo.step.${step.key}.body`)}</p>
                <Button
                  variant="secondary"
                  iconEnd="arrow-end"
                  onClick={() => requestDemo(step.action)}
                >
                  {landingCopy(i18n.locale, `demo.step.${step.key}.action`)}
                </Button>
              </li>
            ))}
          </ol>
        </section>

        {/* The hand-off: what a viewer does next, in their verbs. */}
        <section className="rf-hand" aria-labelledby="rf-hand-title">
          <h2 id="rf-hand-title" className="rf-hand__title">
            {landingCopy(i18n.locale, "pres.hand.title")}
          </h2>
          <p className="rf-hand__body">{landingCopy(i18n.locale, "pres.hand.body")}</p>
          <div className="rf-hand__actions">
            <Button variant="primary" iconEnd="arrow-end" onClick={exploreSample} data-testid="cta-demo">
              {landingCopy(i18n.locale, "pres.checkData")}
            </Button>
            <Button variant="secondary" icon="upload" onClick={pickUpload} data-testid="cta-upload">
              {i18n.t("action.upload")}
            </Button>
            <Button variant="ghost" onClick={startGuide} data-testid="cta-guide">
              {i18n.t("action.startGuide")}
            </Button>
          </div>
          <input
            ref={uploadInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            hidden
            data-testid="upload-input"
            onChange={(event) => onFileChosen(event.currentTarget.files?.[0])}
          />
        </section>

        {/* Closing — privacy note and the return to product. */}
        <section className="rf-close" aria-labelledby="rf-close-title">
          <h2 id="rf-close-title">{landingCopy(i18n.locale, "landing.close.title")}</h2>
          <p className="rf-close__body">{landingCopy(i18n.locale, "landing.close.body")}</p>
          <div className="rf-close__actions">
            <Button variant="primary" iconEnd="arrow-end" onClick={openWorkspace}>
              {landingCopy(i18n.locale, "pres.openWorkspace")}
            </Button>
            <Button variant="secondary" onClick={pickUpload}>
              {i18n.t("action.upload")}
            </Button>
          </div>
        </section>
      </main>

      <footer className="rf-footer">
        <p>
          <Icon name="check" size={16} /> {i18n.t("common.verified")} · {i18n.t("privacy.short")}
        </p>
        <p className="rf-footer__muted">{i18n.t("privacy.assets")}</p>
      </footer>
    </>
  );
}
