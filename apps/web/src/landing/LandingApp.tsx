/**
 * LandingApp — the presentation-first entry (owner-approved revamp): a
 * compact identity + language header, then a hero where the H1, the
 * explanation, the actions and the controllable walkthrough all fit the
 * first viewport. Below it, one finished-output section with the real
 * report previews and downloads, then the product invitation with the
 * own-file action and the privacy note.
 *
 * The working product is one click away: "Explore the example" opens the
 * prepared analysis, "Use your own spreadsheet" carries a real file, and
 * the downloads fire the real export pipeline through the workspace
 * intent seam. Nothing touches `window` at module scope — the entry stays
 * prerender-safe.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, SkipLink } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { PresentationController, type PresentationState } from "../demo/presentation.ts";
import { landingCopy } from "./copy.ts";
import {
  PresentationStage,
  WALKTHROUGH_STEPS,
  readStoredStep,
} from "./PresentationStage.tsx";
import { SAMPLE_EXPORT_MODEL, findingSlide } from "./sampleExportModel.ts";
import { SlidePreview, WorkbookPreview } from "../briefing/SlidePreview.tsx";
// SlidePreview's component stylesheet is owned by the export dialog — the
// landing must import it directly or the previews render unstyled.
import "../briefing/export.css";
import { persistLocaleChoice } from "./i18n.ts";
import { siblingLocaleHref, workspaceHref, scrollToId, navigateToWorkspace } from "./routes.ts";
import { setWorkspaceIntent, type IntentDownload } from "./pendingUpload.ts";
import { prefersReducedMotion } from "./useReducedMotion.ts";
import "./landing.css";

const UPLOAD_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface LandingAppProps {
  readonly i18n: I18n;
}

export function LandingApp({ i18n }: LandingAppProps) {
  const uploadInput = useRef<HTMLInputElement>(null);

  // The shared walkthrough controller — the hero's Watch/Replay action and
  // the stage's own transport drive the same instance.
  const controller = useMemo(
    () =>
      new PresentationController({
        chapters: WALKTHROUGH_STEPS,
        prefersReducedMotion,
        initialIndex: readStoredStep(),
      }),
    [],
  );
  const [presState, setPresState] = useState<PresentationState>(controller.getState());
  useEffect(() => controller.subscribe(setPresState), [controller]);
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  const exploreSample = () => {
    setWorkspaceIntent({ kind: "sample" });
    navigateToWorkspace();
  };
  const openWorkspace = () => {
    setWorkspaceIntent({ kind: "sample" });
    window.location.hash = workspaceHref();
  };
  const download = (format: IntentDownload) => {
    setWorkspaceIntent({ kind: "sample", download: format });
    navigateToWorkspace();
  };
  const watch = () => {
    // "Watch how it works" starts/resumes the walkthrough; once it holds
    // the finished report the same action replays it.
    controller.resume();
    scrollToId("how-it-works");
  };
  const pickUpload = () => uploadInput.current?.click();
  const onFileChosen = (file: File | undefined) => {
    if (file === undefined) return;
    // The file stays in memory only — the workspace session claims the
    // intent on the workspace route; nothing is parsed on the landing.
    setWorkspaceIntent({ kind: "upload", file });
    window.location.hash = workspaceHref();
  };

  const model = SAMPLE_EXPORT_MODEL[i18n.locale];
  const otherLocale = i18n.locale === "ar" ? "en" : "ar";
  const altModel = SAMPLE_EXPORT_MODEL[otherLocale];
  const held = presState.status === "held";

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
          <a href="#how-it-works">{i18n.t("nav.demo")}</a>
          <a href="https://github.com/zubalr/rowfolio" rel="noopener noreferrer">
            {i18n.t("nav.github")}
          </a>
          <a
            className="rf-lang"
            href={siblingLocaleHref(i18n.locale)}
            lang={i18n.locale === "ar" ? "en" : "ar"}
            onClick={(event) => {
              // Locale links must not re-resolve mid-click: persisting the
              // choice flips `i18n.locale`, which swaps this anchor's href
              // before the browser follows it. Capture the target first and
              // navigate explicitly; modified clicks keep the live href.
              // The walkthrough step rides the landing hash (`#/pres-ch=N`)
              // across the switch — no storage writes.
              const h = window.location.hash;
              const carry = h.startsWith("#/pres-ch") ? h : "";
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                if (carry !== "") {
                  event.currentTarget.href = event.currentTarget.href.split("#")[0]! + carry;
                }
                return;
              }
              event.preventDefault();
              const target = siblingLocaleHref(i18n.locale);
              persistLocaleChoice(i18n, i18n.locale === "ar" ? "en" : "ar");
              window.location.assign(target + carry);
            }}
          >
            {i18n.localeName(i18n.locale === "ar" ? "en" : "ar")}
          </a>
          <Button
            variant="secondary"
            iconEnd="arrow-end"
            onClick={exploreSample}
            className="rf-masthead__ws"
            data-testid="cta-demo"
          >
            {landingCopy(i18n.locale, "pres.explore")}
          </Button>
        </nav>
      </header>

      <main id="main">
        {/* Hero — the walkthrough IS the first screen. */}
        <section className="rf-hero" id="how-it-works" aria-labelledby="rf-hero-title">
          <div className="rf-hero__copy">
            <h1 className="rf-hero__title" id="rf-hero-title">
              {landingCopy(i18n.locale, "pres.title")}
            </h1>
            <p className="rf-hero__body">{landingCopy(i18n.locale, "pres.body")}</p>
            <p className="rf-hero__credit">{landingCopy(i18n.locale, "pres.credit")}</p>
            <div className="rf-hero__actions">
              <Button
                variant="primary"
                onClick={watch}
                data-testid="cta-watch"
              >
                {held
                  ? landingCopy(i18n.locale, "pres.replay")
                  : landingCopy(i18n.locale, "pres.watch")}
              </Button>
              <Button variant="secondary" iconEnd="arrow-end" onClick={exploreSample} data-testid="cta-explore">
                {landingCopy(i18n.locale, "pres.explore")}
              </Button>
              <button type="button" className="rf-hero__ownfile" onClick={pickUpload} data-testid="cta-upload">
                {landingCopy(i18n.locale, "pres.useOwn")}
              </button>
            </div>
            <p className="rf-hero__note">{landingCopy(i18n.locale, "pres.sampleNote")}</p>
          </div>

          <PresentationStage i18n={i18n} controller={controller} />
        </section>

        {/* The finished output — real previews of the real artifacts. */}
        <section className="rf-output" aria-labelledby="rf-output-title">
          <div className="rf-output__head">
            <h2 className="rf-output__title" id="rf-output-title">
              {landingCopy(i18n.locale, "pres.output.title")}
            </h2>
            <p className="rf-output__body">{landingCopy(i18n.locale, "pres.output.body")}</p>
          </div>
          <div className="rf-output__previews">
            <figure className="rf-output__fig">
              <div className="rf-output__preview">
                <SlidePreview model={model} slide={findingSlide(model)} />
              </div>
              <figcaption className="rf-output__cap">
                {i18n.localeName(i18n.locale)} · {landingCopy(i18n.locale, "pres.output.slides", { n: model.slides.length })}
              </figcaption>
            </figure>
            <figure className="rf-output__fig">
              <div className="rf-output__preview" dir={otherLocale === "ar" ? "rtl" : "ltr"}>
                <SlidePreview model={altModel} slide={findingSlide(altModel)} />
              </div>
              <figcaption className="rf-output__cap">{i18n.localeName(otherLocale)}</figcaption>
            </figure>
            <figure className="rf-output__fig rf-output__fig--book">
              <div className="rf-output__preview">
                <WorkbookPreview model={model} />
              </div>
              <figcaption className="rf-output__cap">{landingCopy(i18n.locale, "pres.output.workbook")}</figcaption>
            </figure>
          </div>
          <div className="rf-output__actions">
            <Button variant="primary" icon="download" onClick={() => download("pptx")} data-testid="output-download-pptx">
              {landingCopy(i18n.locale, "pres.downloadPptx")}
            </Button>
            <Button variant="secondary" icon="download" onClick={() => download("xlsx")} data-testid="output-download-xlsx">
              {landingCopy(i18n.locale, "pres.downloadXlsx")}
            </Button>
          </div>
        </section>

        {/* The invitation — the visitor's own file, with honest limits. */}
        <section className="rf-invite" aria-labelledby="rf-invite-title">
          <h2 className="rf-invite__title" id="rf-invite-title">
            {landingCopy(i18n.locale, "pres.invite.title")}
          </h2>
          <p className="rf-invite__body">{landingCopy(i18n.locale, "pres.invite.body")}</p>
          <div className="rf-invite__actions">
            <Button variant="primary" icon="upload" onClick={pickUpload}>
              {landingCopy(i18n.locale, "pres.useOwn")}
            </Button>
            <Button variant="secondary" iconEnd="arrow-end" onClick={openWorkspace}>
              {landingCopy(i18n.locale, "pres.explore")}
            </Button>
          </div>
          <p className="rf-invite__help">{landingCopy(i18n.locale, "pres.uploadHelp")}</p>
          <input
            ref={uploadInput}
            type="file"
            accept={UPLOAD_ACCEPT}
            hidden
            data-testid="upload-input"
            onChange={(event) => onFileChosen(event.currentTarget.files?.[0])}
          />
        </section>
      </main>

      <footer className="rf-footer">
        <p>
          <Icon name="check" size={16} /> {i18n.t("common.verified")} · {i18n.t("privacy.short")}
        </p>
        <p className="rf-footer__muted">{landingCopy(i18n.locale, "pres.credit")}</p>
      </footer>
    </>
  );
}
