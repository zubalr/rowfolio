/**
 * LandingApp — the bilingual product-entry page (A12).
 *
 * Rendered by both static entries (`/` English, `/ar/` Arabic); document
 * lang/dir are already correct per entry, and the i18n provider is pinned
 * to them. Composition: masthead → hero with a legible miniature finding →
 * the interactive prepared-sample preview (driven manually or by the
 * reusable DemoController) → how-it-works → footer.
 *
 * No parser/export/chart library is reachable from this graph, and nothing
 * touches `window` at module scope, so the entry stays prerender-safe.
 */
import { Suspense, lazy, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Bidi, Button, Icon, SkipLink } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { DemoController, GuideBar, GUIDE_STEPS, type GuideState } from "../demo/index.ts";
import { LANDING_TRUTH } from "./previewTruth.ts";
import { PREVIEW_IDLE, previewReducer } from "./previewState.ts";
import { PreviewDemoHost } from "./previewHost.ts";
import { PreviewStage } from "./PreviewStage.tsx";
import { persistLocaleChoice } from "./i18n.ts";
import { focusById, scrollToId, siblingLocaleHref, workspaceHref } from "./routes.ts";
import { setWorkspaceIntent } from "./pendingUpload.ts";
import { prefersReducedMotion, useReducedMotion } from "./useReducedMotion.ts";

// Motion overlay is the single lazy boundary — it never lands in the entry
// chunk (scripts/audit-static.ts), and is skipped outright under reduced
// motion where the CSS `data-demo-active` outline is the instant fallback.
const GuideHighlight = lazy(() => import("./GuideHighlight.tsx"));

const UPLOAD_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface LandingAppProps {
  readonly i18n: I18n;
}

export function LandingApp({ i18n }: LandingAppProps) {
  const truth = LANDING_TRUTH;
  const [preview, dispatch] = useReducer(previewReducer, PREVIEW_IDLE);
  const reducedMotion = useReducedMotion();

  const { controller, host } = useMemo(() => {
    const previewHost = new PreviewDemoHost(
      dispatch,
      () => scrollToId("demo"),
      () => focusById("rf-preview-title"),
    );
    return {
      host: previewHost,
      controller: new DemoController({ host: previewHost, prefersReducedMotion }),
    };
  }, []);

  const [guide, setGuide] = useState<GuideState>(controller.getState());
  useEffect(() => controller.subscribe(setGuide), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);

  // The host's readiness predicates track real preview state.
  useEffect(() => {
    host.publish(preview);
  }, [host, preview]);

  // Manual pointer/keyboard interaction outside the guide controls pauses
  // the guide; Escape exits it; a hidden tab pauses without auto-resume.
  useEffect(() => {
    const isGuideControl = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-guide-controls]") !== null;
    const onPointer = (event: Event) => {
      if (!isGuideControl(event.target)) controller.notifyInteraction();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.exit();
        return;
      }
      if (!isGuideControl(event.target)) controller.notifyInteraction();
    };
    const onVisibility = () => controller.notifyVisibility(!document.hidden);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [controller]);

  const uploadInput = useRef<HTMLInputElement>(null);

  const exploreSample = () => {
    setWorkspaceIntent({ kind: "sample" });
    dispatch({ type: "reveal" });
    scrollToId("demo");
  };
  const startGuide = () => {
    setWorkspaceIntent({ kind: "guide" });
    scrollToId("demo");
    controller.start();
  };
  const pickUpload = () => uploadInput.current?.click();
  const onFileChosen = (file: File | undefined) => {
    if (file === undefined) return;
    // The file stays in memory only — the workspace session claims the
    // intent on the workspace route; nothing is parsed on the landing.
    setWorkspaceIntent({ kind: "upload", file });
    window.location.hash = workspaceHref();
  };
  const replay = () => void controller.replay();
  const manualInteraction = () => controller.notifyInteraction();

  const guideRunning = guide.status === "running" || guide.status === "paused";
  // The bar stays mounted through "complete"/"error" so its final caption and
  // typed error remain visible; it unmounts only when the guide is idle.
  const guideVisible = guide.status !== "idle";
  const guideStepId =
    guide.stepIndex >= 0 && guide.stepIndex < GUIDE_STEPS.length
      ? GUIDE_STEPS[guide.stepIndex]?.id ?? null
      : null;

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
          <a href="#how">{i18n.t("nav.how")}</a>
          <button type="button" className="rf-nav__link" onClick={exploreSample}>
            {i18n.t("nav.demo")}
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
          <div className="rf-hero__copy">
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
          </div>

          {/* Legible miniature finding — the 0–4 s storyboard beat. */}
          <div className="rf-mini" data-rf-surface="ink" data-testid="hero-mini">
            <span className="rf-mini__eyebrow">{i18n.t("common.prepared")}</span>
            <p className="rf-mini__figure">
              <Bidi dir="ltr" className="rf-numeric">
                {i18n.formatInteger(truth.northJune.revenue)}
              </Bidi>
              <span className="rf-mini__unit">
                {" "}
                USD · {i18n.t("region.North")} · {i18n.t("period.june2026")}
              </span>
            </p>
            <p className="rf-mini__delta">
              <Bidi dir="ltr" className="rf-numeric">
                −{i18n.formatPercent(truth.northJune.targetGapRatio, {
                  minFractionDigits: 0,
                  maxFractionDigits: 1,
                })}
              </Bidi>{" "}
              {i18n.t("metric.targetGap")}
            </p>
          </div>
        </section>

        <PreviewStage
          truth={truth}
          i18n={i18n}
          state={preview}
          dispatch={dispatch}
          guideStep={guideRunning ? guideStepId : null}
          guideVisible={guideVisible}
          onManualInteraction={manualInteraction}
          onReplay={replay}
        >
          <GuideBar controller={controller} i18n={i18n} />
        </PreviewStage>

        {!reducedMotion && guideVisible && guideStepId !== null ? (
          <Suspense fallback={null}>
            <GuideHighlight stepId={guideStepId} />
          </Suspense>
        ) : null}

        <section className="rf-how" id="how" aria-label={i18n.t("nav.how")}>
          <div className="rf-how__step">
            <span className="rf-how__num" aria-hidden="true">
              01
            </span>
            <h3>{i18n.t("upload.title")}</h3>
            <p>{i18n.t("upload.types")}</p>
          </div>
          <div className="rf-how__step">
            <span className="rf-how__num" aria-hidden="true">
              02
            </span>
            <h3>{i18n.t("workspace.findings")}</h3>
            <p>{i18n.t("evidence.title")}</p>
          </div>
          <div className="rf-how__step">
            <span className="rf-how__num" aria-hidden="true">
              03
            </span>
            <h3>{i18n.t("export.title")}</h3>
            <p>{i18n.t("export.preview")}</p>
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
