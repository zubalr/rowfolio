/**
 * LandingApp — the bilingual product-entry page (A12), composed as an
 * editorial operations studio: compact nav and a single headline over a
 * large working specimen of the product mechanism (source rows → regional
 * comparison → evidence → scenario → briefing), then the four-beat staged
 * demonstration, then the privacy close. Warm ivory reading surfaces, deep
 * ink evidence stage, cobalt data, amber assumption layer.
 *
 * The whole demo payload — preview stage, fixture-derived truth and the
 * DemoController wiring — sits behind the `PreviewLoader` lazy chunk so
 * first paint only ships the shell; CTA clicks are forwarded as a one-shot
 * `pendingAction` the loader honors even if it mounts after the click.
 *
 * No parser/export/chart library is reachable from this graph, and nothing
 * touches `window` at module scope, so the entry stays prerender-safe.
 */
import { Suspense, lazy, useRef, useState } from "react";
import { Button, Icon, SkipLink } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import type { PendingDemoAction } from "./PreviewLoader.tsx";
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
          <button type="button" className="rf-nav__link" onClick={openWorkspace}>
            {i18n.t("action.openWorkspace")}
          </button>
          <a href="https://github.com/zubalr/rowfolio" rel="noopener noreferrer">
            {i18n.t("nav.github")}
          </a>
          <a
            className="rf-lang"
            href={siblingLocaleHref(i18n.locale)}
            lang={i18n.locale === "ar" ? "en" : "ar"}
            onClick={() => persistLocaleChoice(i18n, i18n.locale === "ar" ? "en" : "ar")}
          >
            {i18n.localeName(i18n.locale === "ar" ? "en" : "ar")}
          </a>
        </nav>
      </header>

      <main id="main">
        <section className="rf-hero" aria-labelledby="rf-hero-title">
          <span className="rf-hero__eyebrow">{i18n.t("common.local")}</span>
          <h1 id="rf-hero-title" className="rf-hero__title">
            {i18n.t("hero.title")}
          </h1>
          <p className="rf-hero__body">{i18n.t("hero.body")}</p>
          <div className="rf-hero__actions">
            <Button variant="primary" iconEnd="arrow-end" onClick={exploreSample} data-testid="cta-demo">
              {i18n.t("action.tryDemo")}
            </Button>
            <Button variant="secondary" icon="upload" onClick={pickUpload} data-testid="cta-upload">
              {i18n.t("action.upload")}
            </Button>
            <Button variant="secondary" onClick={startGuide} data-testid="cta-guide">
              {i18n.t("action.startGuide")}
            </Button>
          </div>
          <p className="rf-hero__proof">{i18n.t("privacy.short")}</p>
          <input
            ref={uploadInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            hidden
            data-testid="upload-input"
            onChange={(event) => onFileChosen(event.currentTarget.files?.[0])}
          />
        </section>

        {/* The large working specimen — real mechanism, real values. */}
        <Suspense
          fallback={
            <section className="rf-stage" id="demo" aria-labelledby="rf-preview-title">
              <header className="rf-stage__head">
                <div>
                  <h2 id="rf-preview-title" className="rf-stage__title">
                    {i18n.t("workspace.findings")}
                  </h2>
                </div>
              </header>
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
            {i18n.t("demo.band.title")}
          </h2>
          <ol className="rf-steps__list">
            {STEPS.map((step, i) => (
              <li className="rf-steps__step" key={step.key}>
                <span className="rf-steps__num" aria-hidden="true">
                  {`0${i + 1}`}
                </span>
                <h3 className="rf-steps__name">{i18n.t(`demo.step.${step.key}.title`)}</h3>
                <p className="rf-steps__body">{i18n.t(`demo.step.${step.key}.body`)}</p>
                <Button
                  variant="secondary"
                  iconEnd="arrow-end"
                  onClick={() => requestDemo(step.action)}
                >
                  {i18n.t(`demo.step.${step.key}.action`)}
                </Button>
              </li>
            ))}
          </ol>
        </section>

        {/* Closing — privacy note and the return to product. */}
        <section className="rf-close" aria-labelledby="rf-close-title">
          <h2 id="rf-close-title">{i18n.t("landing.close.title")}</h2>
          <p className="rf-close__body">{i18n.t("landing.close.body")}</p>
          <div className="rf-close__actions">
            <Button variant="primary" iconEnd="arrow-end" onClick={exploreSample}>
              {i18n.t("action.tryDemo")}
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
