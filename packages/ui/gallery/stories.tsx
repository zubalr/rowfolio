/**
 * Story matrix — every primitive across state, surface and locale.
 * Drives the visual/a11y suite in tests/visual/ui.
 */
import { useState } from "react";
import {
  Bidi,
  Button,
  DataTable,
  Dialog,
  Field,
  Metric,
  MetricStrip,
  Section,
  SkipLink,
  Status,
} from "../src/index.ts";
import {
  metrics,
  stages,
  strings,
  tableColumns,
  tableRows,
  type GalleryLocale,
} from "./fixtures.ts";

export function Gallery({ locale }: { locale: GalleryLocale }) {
  const s = strings[locale];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [centerOpen, setCenterOpen] = useState(false);
  const [fieldValue, setFieldValue] = useState("8");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const rows = tableRows();

  return (
    <div className="gallery">
      <SkipLink targetId="#main">{s.skip}</SkipLink>
      <header className="gallery__masthead">
        <span className="gallery__brand">Rowfolio</span>
        <nav aria-label="Locale">
          <a href="?lang=en" lang="en" data-active={locale === "en" || undefined}>
            English
          </a>
          <a href="?lang=ar" lang="ar" data-active={locale === "ar" || undefined}>
            العربية
          </a>
        </nav>
      </header>

      <div className="gallery__wrap" id="main" tabIndex={-1}>
        <p className="gallery__eyebrow">{s.eyebrow}</p>
        <h1 className="gallery__title">{s.pageTitle}</h1>
        <p className="gallery__intro">{s.intro}</p>

        <Section title={s.actions} eyebrow="01" meta="44px targets · focus ring 3px/3px">
          <div className="gallery__row" data-story="buttons">
            <Button variant="primary" iconEnd="arrow-end">
              {s.showWhy}
            </Button>
            <Button variant="secondary" iconEnd="arrow-end">
              {s.moreRows}
            </Button>
            <Button variant="attention" icon="warning">
              {s.cancel}
            </Button>
            <Button variant="secondary" icon="close" label={s.close} />
            <Button variant="primary" disabled>
              {s.save}
            </Button>
            <Button variant="secondary" icon="download">
              {s.save}
            </Button>
          </div>
        </Section>

        <Section title={s.fields} eyebrow="02">
          <div className="gallery__fields" data-story="fields">
            <Field
              label={s.costField}
              unit="%"
              help={s.costHelp}
              required
              inputProps={{
                type: "number",
                min: -20,
                max: 30,
                step: 0.1,
                value: fieldValue,
                onChange: (e) => {
                  setFieldValue(e.target.value);
                  setFieldError(null);
                },
              }}
            />
            <Field
              label={s.costField}
              unit="%"
              error={s.costError}
              inputProps={{ type: "number", defaultValue: "42", min: -20, max: 30 }}
            />
            <Field
              label={s.costField}
              help={s.costHelp}
              inputProps={{ type: "number", disabled: true, placeholder: "—" }}
            />
            <button
              type="button"
              className="rf-btn rf-btn--secondary"
              onClick={() => setFieldError(s.costError)}
              data-testid="trigger-field-error"
            >
              {locale === "en" ? "Validate field" : "تحقق من الحقل"}
            </button>
            <Field
              label={s.costField}
              error={fieldError ?? undefined}
              inputProps={{
                type: "number",
                value: fieldValue,
                onChange: (e) => setFieldValue(e.target.value),
              }}
            />
          </div>
        </Section>

        <Section title={s.metrics} eyebrow="03">
          <MetricStrip label={s.kpiLabel}>
            {metrics[locale].map((m) => (
              <Metric
                key={m.id}
                label={m.label}
                value={m.value}
                unit={
                  m.unitLabel
                    ? { kind: "currency", label: m.unitLabel, currency: m.unitLabel }
                    : undefined
                }
                status="defined"
                delta={m.delta}
                footer={
                  m.id === "revenue" ? (
                    <Button variant="secondary" iconEnd="arrow-end" onClick={() => setDialogOpen(true)}>
                      {s.showWhy}
                    </Button>
                  ) : undefined
                }
              />
            ))}
            <Metric
              label={s.downtime}
              value={null}
              status="undefined"
              reasonLabel={s.undefinedReason}
            />
          </MetricStrip>
        </Section>

        <Section title={s.status} eyebrow="04">
          <div className="gallery__stack" data-story="status">
            <Status kind="loading" title={s.processing} stages={stages(s)} currentStage="profile" />
            <Status kind="success" title={s.ready} />
            <Status kind="error" title={s.invalidFile} actions={<Button variant="secondary">{s.retry}</Button>}>
              {s.retryBody}
            </Status>
            <Status kind="empty" title={s.noFindings} />
          </div>
        </Section>

        <Section title={s.table} eyebrow="05">
          <DataTable
            caption={s.tableCaption}
            columns={tableColumns(s)}
            rows={rows}
            scrollLabel={s.scrollRegion}
            pageSize={12}
            moreLabel={s.moreRows}
            rangeLabel={(a, b, total) =>
              locale === "ar" ? `الصفوف ${a}–${b} من أصل ${total}` : `Rows ${a}–${b} of ${total}`
            }
            emptyState={<Status kind="empty" title={s.noFindings} />}
          />
          <p className="gallery__note">
            <Bidi dir="auto">
              {locale === "ar"
                ? "معرّف الموقع N-01 يبقى لاتينيًا داخل نص عربي."
                : "Site ID stays LTR inside prose."}
            </Bidi>{" "}
            <Bidi dir="ltr" className="rf-mono">
              S0 · R1802:R1901 · n=100
            </Bidi>
          </p>
        </Section>

        <Section title={s.dialog} eyebrow="06">
          <div className="gallery__row">
            <Button variant="primary" onClick={() => setDialogOpen(true)}>
              {s.openPanel}
            </Button>
            <Button variant="secondary" onClick={() => setCenterOpen(true)}>
              {s.openCenter}
            </Button>
          </div>
        </Section>
      </div>

      <Dialog
        open={centerOpen}
        onClose={() => setCenterOpen(false)}
        title={s.retry}
        closeLabel={s.close}
        testId="center-dialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCenterOpen(false)}>
              {s.back}
            </Button>
            <Button variant="primary" onClick={() => setCenterOpen(false)}>
              {s.retry}
            </Button>
          </>
        }
      >
        <p>{s.retryBody}</p>
      </Dialog>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={s.evidenceTitle}
        description={s.evidenceDesc}
        closeLabel={s.close}
        surface="ink"
        placement="drawer"
        testId="evidence-dialog"
        footer={
          <Button variant="secondary" onClick={() => setDialogOpen(false)}>
            {s.close}
          </Button>
        }
      >
        <div className="gallery__evidence">
          <p className="gallery__evidence-label">{s.calcLabel}</p>
          <p className="rf-mono gallery__formula" dir="ltr">
            (881,000 − 1,000,000) ÷ 1,000,000
          </p>
          <p className="gallery__evidence-label">{s.inputsLabel}</p>
          <table className="rf-table">
            <tbody>
              <tr>
                <td>{locale === "ar" ? "إيرادات يونيو" : "June revenue"}</td>
                <td data-align="end">
                  <Bidi dir="ltr" className="rf-mono">
                    881,000
                  </Bidi>
                </td>
              </tr>
              <tr>
                <td>{s.target}</td>
                <td data-align="end">
                  <Bidi dir="ltr" className="rf-mono">
                    1,000,000
                  </Bidi>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="gallery__evidence-label">{s.sourceRowsLabel}</p>
          <p className="rf-mono" dir="ltr">
            S0 · R1802:R1901 · n=100
          </p>
          <p className="gallery__evidence-label">{s.hashLabel}</p>
          <p className="rf-mono gallery__hash" dir="ltr">
            SHA-256 5a3f9d…
          </p>
          <p className="gallery__note">{s.hashNote}</p>
          <Status kind="warning" title={s.scenarioNote} />
        </div>
      </Dialog>
    </div>
  );
}
