/**
 * LandingApp — the broadsheet entry: a hairline-framed page whose first
 * viewport is the spread (lead column + the single captioned stage running
 * the annotator loop in SpreadStage), then the finished-output plates with
 * real previews and downloads, then the own-file invitation.
 *
 * The working product is one click away: "Open Rowfolio" / "Explore the
 * example" open the prepared analysis, "Use your own spreadsheet" carries
 * a real file, and the downloads fire the real export pipeline through the
 * workspace intent seam. Nothing touches `window` at module scope — the
 * entry stays prerender-safe.
 */
import { useRef, useState } from "react";
import { Button, Icon, SkipLink } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import { exportFileName } from "@rowfolio/export-model";
import { landingCopy, type CopyKey } from "./copy.ts";
import { SpreadStage } from "./SpreadStage.tsx";
import { SAMPLE_EXPORT_MODEL, findingSlide } from "./sampleExportModel.ts";
import { MiniReport, WorkbookMini } from "../demo/MiniReport.tsx";
import { persistLocaleChoice } from "./i18n.ts";
import { siblingLocaleHref, workspaceHref, navigateToWorkspace } from "./routes.ts";
import { setWorkspaceIntent, type IntentDownload } from "./pendingUpload.ts";
import "./landing.css";

const UPLOAD_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const EXPORT_MIME: Record<IntentDownload, string> = {
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Short purpose labels for the viewer's pane tabs, keyed by slide kind. */
const PANE_KIND_KEY: Record<string, CopyKey> = {
  summary: "pane.summary",
  kpis: "pane.glance",
  finding: "pane.finding",
  scenario: "pane.costs",
  quality: "pane.quality",
  methodology: "pane.method",
};

export interface LandingAppProps {
  readonly i18n: I18n;
}

export function LandingApp({ i18n }: LandingAppProps) {
  const uploadInput = useRef<HTMLInputElement>(null);

  const exploreSample = () => {
    setWorkspaceIntent({ kind: "sample" });
    navigateToWorkspace();
  };
  const openWorkspace = () => {
    setWorkspaceIntent({ kind: "sample" });
    window.location.hash = workspaceHref();
  };
  // Downloads are real and in place: the same builders the workspace
  // export pipeline runs produce the bytes here, saved under the real
  // export filename — a download button downloads, nothing else.
  const [exporting, setExporting] = useState<IntentDownload | null>(null);
  const download = async (format: IntentDownload) => {
    if (exporting !== null) return;
    setExporting(format);
    try {
      const built =
        format === "pptx"
          ? await (await import("@rowfolio/export-pptx")).buildPresentation(model, () => {})
          : await (await import("@rowfolio/export-xlsx")).buildWorkbook(model, () => {});
      const url = URL.createObjectURL(new Blob([built.bytes], { type: EXPORT_MIME[format] }));
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(model, format);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } finally {
      setExporting(null);
    }
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

  // The output section is ONE report viewer: a pane for every slide in
  // the real deck plus the workbook, navigated by text tabs — never a
  // grid of equal-weight identical previews. It opens on the finding
  // slide (the story the walkthrough tells), and the other locale's
  // artifact appears only when its labeled variant is picked.
  const [paneSel, setPaneSel] = useState<number | "workbook">(() =>
    model.slides.findIndex((s) => s === findingSlide(model)),
  );
  const [altView, setAltView] = useState(false);
  const viewModel = altView ? altModel : model;
  const viewLocale = altView ? otherLocale : i18n.locale;
  const activeSlide =
    paneSel === "workbook" ? null : viewModel.slides[Math.min(paneSel, viewModel.slides.length - 1)]!;

  return (
    // `.rf-landing-root` scopes the landing's chrome rules so they cannot
    // leak onto the app-shell masthead when both stylesheets are loaded.
    <div className="rf-landing-root">
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
        <span className="rf-masthead__tag">{landingCopy(i18n.locale, "nav.tag")}</span>
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
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                return;
              }
              event.preventDefault();
              const href = siblingLocaleHref(i18n.locale);
              persistLocaleChoice(i18n, i18n.locale === "ar" ? "en" : "ar");
              window.location.assign(href);
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
        {/* The spread IS the first screen: slim hero + the one stage. */}
        <SpreadStage i18n={i18n} onOpen={exploreSample} onDownload={download} />

        {/* The finished output — real previews of the real artifacts. */}
        <section className="rf-output" aria-labelledby="rf-output-title">
          <header className="rf-output__head">
            <p className="rf-secmark">
              <i aria-hidden="true" />
              {landingCopy(i18n.locale, "pres.output.title")}
            </p>
            <h2 className="rf-output__title" id="rf-output-title">
              {landingCopy(i18n.locale, "pres.output.title")}
            </h2>
            <p className="rf-output__body">{landingCopy(i18n.locale, "pres.output.body")}</p>
          </header>
          <div className="rf-output__viewer">
            <div className="rf-output__pane" dir={viewLocale === "ar" ? "rtl" : "ltr"}>
              {activeSlide === null ? (
                <WorkbookMini model={viewModel} />
              ) : (
                <MiniReport model={viewModel} slide={activeSlide} />
              )}
            </div>
            <div className="rf-output__nav" role="tablist" aria-label={landingCopy(i18n.locale, "pres.output.nav")}>
              {viewModel.slides.map((s, i) => (
                <button
                  key={`${s.kind}-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={paneSel === i}
                  className={`rf-opane${paneSel === i ? " rf-opane--on" : ""}`}
                  onClick={() => setPaneSel(i)}
                >
                  {landingCopy(i18n.locale, PANE_KIND_KEY[s.kind] ?? "pane.summary")}
                </button>
              ))}
              <button
                type="button"
                role="tab"
                aria-selected={paneSel === "workbook"}
                className={`rf-opane${paneSel === "workbook" ? " rf-opane--on" : ""}`}
                onClick={() => setPaneSel("workbook")}
              >
                {landingCopy(i18n.locale, "pres.output.workbook")}
              </button>
              <button
                type="button"
                className="rf-opane rf-opane--alt"
                aria-pressed={altView}
                onClick={() => setAltView((v) => !v)}
              >
                {i18n.localeName(otherLocale)}
              </button>
            </div>
            <p className="rf-output__cap">
              {i18n.localeName(viewLocale)} ·{" "}
              {landingCopy(i18n.locale, "pres.output.slides", { n: viewModel.slides.length })}
            </p>
          </div>
          <div className="rf-output__actions">
            <Button
              variant="primary"
              icon="download"
              disabled={exporting !== null}
              onClick={() => void download("pptx")}
              data-testid="output-download-pptx"
            >
              {landingCopy(i18n.locale, "pres.downloadPptx")}
            </Button>
            <Button
              variant="secondary"
              icon="download"
              disabled={exporting !== null}
              onClick={() => void download("xlsx")}
              data-testid="output-download-xlsx"
            >
              {landingCopy(i18n.locale, "pres.downloadXlsx")}
            </Button>
          </div>
        </section>

        {/* The invitation — the visitor's own file, with honest limits. */}
        <section className="rf-invite" aria-labelledby="rf-invite-title">
          <p className="rf-secmark">
            <i aria-hidden="true" />
            {landingCopy(i18n.locale, "pres.useOwn")}
          </p>
          <h2 className="rf-invite__title" id="rf-invite-title">
            {landingCopy(i18n.locale, "pres.invite.title")}
          </h2>
          <p className="rf-invite__body">{landingCopy(i18n.locale, "pres.invite.body")}</p>
          <div className="rf-invite__actions">
            <Button variant="primary" icon="upload" onClick={pickUpload} data-testid="cta-upload">
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
    </div>
  );
}
