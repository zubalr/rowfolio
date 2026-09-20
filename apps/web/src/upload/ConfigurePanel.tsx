/**
 * ConfigurePanel — the bounded pre-parse review: visible-sheet selection,
 * hidden-sheet disclosure + explicit opt-in, CSV delimiter resolution with a
 * live preview, physical header-row confirmation over a source preview, and
 * ingestion disclosures. Everything shown here comes from `inspectSource` —
 * the same bounded preflight the parse step uses; nothing is reparsed
 * unbounded and no semantics are guessed.
 */
import { Button, Icon, Section } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import type { SheetInfo, SourceInspection } from "@rowfolio/ingest";
import type { CsvDelimiter, UploadProgress, UploadSelection } from "./types.ts";
import {
  previewModel,
  sheetChoices,
  suggestHeaderRow,
  warningMessageKey,
} from "./derive.ts";
import { PreviewGrid } from "./PreviewGrid.tsx";

const DELIMITERS: readonly { value: CsvDelimiter; glyph: string }[] = [
  { value: ",", glyph: "," },
  { value: "\t", glyph: "⇥" },
  { value: ";", glyph: ";" },
];

export interface ConfigurePanelProps {
  i18n: I18n;
  /** Null while a delimiter ambiguity blocks inspection. */
  inspection: SourceInspection | null;
  selection: UploadSelection;
  needsDelimiter: boolean;
  optedHiddenSheets: ReadonlySet<string>;
  progress: UploadProgress | null;
  onSelectSheet(sheetId: string): void;
  onOptIntoHidden(sheetId: string): void;
  onRevokeHidden(sheetId: string): void;
  onChooseDelimiter(delimiter: CsvDelimiter): void;
  onSetHeaderRow(row: number | undefined): void;
  onProceed(): void;
  onCancel(): void;
}

function SheetRow({
  i18n,
  info,
  checked,
  disabled,
  onSelect,
}: {
  i18n: I18n;
  info: SheetInfo;
  checked: boolean;
  disabled: boolean;
  onSelect(): void;
}) {
  return (
    <li className="rf-upload__sheet">
      <input
        type="radio"
        name="rf-upload-sheet"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-label={info.name}
        data-testid={`sheet-radio-${info.sheetId}`}
      />
      <bdi dir="auto" className="rf-upload__sheet-name">
        {info.name}
      </bdi>
      {info.visibility !== "visible" ? (
        <bdi dir="ltr" className="rf-upload__badge">
          {info.visibility}
        </bdi>
      ) : null}
      {info.dimensions ? (
        <bdi dir="ltr" className="rf-upload__sheet-dims">
          {i18n.formatInteger(info.dimensions.lastRow - info.dimensions.firstRow + 1)}×
          {i18n.formatInteger(info.dimensions.lastColumn - info.dimensions.firstColumn + 1)}
        </bdi>
      ) : null}
    </li>
  );
}

export function ConfigurePanel({
  i18n,
  inspection,
  selection,
  needsDelimiter,
  optedHiddenSheets,
  progress,
  onSelectSheet,
  onOptIntoHidden,
  onRevokeHidden,
  onChooseDelimiter,
  onSetHeaderRow,
  onProceed,
  onCancel,
}: ConfigurePanelProps) {
  const busy = progress !== null;

  // Delimiter ambiguity must resolve before anything else proceeds.
  if (needsDelimiter) {
    return (
      <Section title={i18n.t("error.AMBIGUOUS_INPUT")}>
        <div role="group" aria-label={i18n.t("error.AMBIGUOUS_INPUT")} className="rf-upload__actions" data-testid="delimiter-picker">
          {DELIMITERS.map((d) => (
            <Button
              key={d.value}
              variant="secondary"
              onClick={() => onChooseDelimiter(d.value)}
              disabled={busy}
              data-testid={`delimiter-${d.value === "\t" ? "tab" : d.value}`}
            >
              <bdi dir="ltr" className="rf-mono">
                {d.glyph}
              </bdi>
            </Button>
          ))}
          <Button variant="secondary" onClick={onCancel} data-testid="configure-cancel">
            {i18n.t("action.cancel")}
          </Button>
        </div>
      </Section>
    );
  }

  const sheets = inspection ? sheetChoices(inspection) : { visible: [], hidden: [] };
  const showSheetPicker = sheets.visible.length > 1 || sheets.hidden.length > 0;
  const preview = inspection ? previewModel(inspection.previewRows) : null;
  const suggestedHeader = inspection ? suggestHeaderRow(inspection) : undefined;
  const headerCandidates = inspection ? [...inspection.previewRowNumbers] : [];

  return (
    <div data-testid="configure-panel">
      {showSheetPicker && inspection ? (
        <Section title={i18n.t("upload.sheet")} headingLevel={3}>
          <ul className="rf-upload__sheets" data-testid="sheet-list">
            {sheets.visible.map(({ info }) => (
              <SheetRow
                key={info.sheetId}
                i18n={i18n}
                info={info}
                checked={selection.selectedSheetId === info.sheetId}
                disabled={busy}
                onSelect={() => onSelectSheet(info.sheetId)}
              />
            ))}
          </ul>
          {sheets.hidden.length > 0 ? (
            <div data-testid="hidden-sheets">
              <p className="rf-upload__meta">{i18n.t("upload.hidden")}</p>
              <ul className="rf-upload__sheets">
                {sheets.hidden.map(({ info }) => {
                  const optedIn = optedHiddenSheets.has(info.sheetId);
                  return (
                    <li key={info.sheetId} className="rf-upload__optin">
                      <input
                        type="checkbox"
                        checked={optedIn}
                        disabled={busy}
                        onChange={(event) => {
                          if (event.target.checked) {
                            onOptIntoHidden(info.sheetId);
                            onSelectSheet(info.sheetId);
                          } else {
                            onRevokeHidden(info.sheetId);
                          }
                        }}
                        aria-label={info.name}
                        data-testid={`hidden-optin-${info.sheetId}`}
                      />
                      <bdi dir="auto" className="rf-upload__sheet-name">
                        {info.name}
                      </bdi>
                      <bdi dir="ltr" className="rf-upload__badge">
                        {info.visibility}
                      </bdi>
                      {optedIn ? (
                        <input
                          type="radio"
                          name="rf-upload-sheet"
                          checked={selection.selectedSheetId === info.sheetId}
                          disabled={busy}
                          onChange={() => onSelectSheet(info.sheetId)}
                          aria-label={info.name}
                          data-testid={`sheet-radio-${info.sheetId}`}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Section>
      ) : null}

      {inspection ? (
        <Section title={i18n.t("upload.range")} headingLevel={3}>
          {preview && preview.rowNumbers.length > 0 ? (
            <>
              <div className="rf-upload__preview" data-testid="upload-preview">
                <PreviewGrid
                  i18n={i18n}
                  preview={preview}
                  headerRow={selection.headerRow ?? suggestedHeader}
                  testId="preview-grid"
                />
              </div>
              <div className="rf-upload__colconfirm">
                <label
                  className="rf-upload__meta"
                  htmlFor="rf-upload-header-row"
                >
                  {i18n.t("upload.range")}
                </label>
                <select
                  id="rf-upload-header-row"
                  value={selection.headerRow ?? suggestedHeader ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    onSetHeaderRow(Number.isInteger(value) && value > 0 ? value : undefined);
                  }}
                  data-testid="header-row-select"
                >
                  {headerCandidates.map((row) => (
                    <option key={row} value={row}>
                      R{row}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <p className="rf-upload__meta">{i18n.t("empty.noData")}</p>
          )}
        </Section>
      ) : null}

      {inspection && inspection.warnings.length > 0 ? (
        <ul className="rf-upload__warnings" data-testid="inspection-warnings">
          {inspection.warnings.map((code) => {
            const key = warningMessageKey(code);
            return (
              <li key={code} className="rf-upload__warning">
                <Icon name="warning" />
                <span>{key ? i18n.t(key) : i18n.t("quality.issues")}</span>
                {!key ? <code className="rf-upload__code">{code}</code> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="rf-upload__actions">
        <Button
          variant="primary"
          onClick={onProceed}
          disabled={busy || !inspection || needsDelimiter}
          data-testid="configure-proceed"
        >
          {i18n.t("action.approve")}
        </Button>
        <Button variant="secondary" onClick={onCancel} data-testid="configure-cancel">
          {i18n.t("action.cancel")}
        </Button>
      </div>
    </div>
  );
}
