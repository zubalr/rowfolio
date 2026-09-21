/**
 * ReviewPanel — the conservative post-parse review ("What we recognized").
 * Everything shown is bound to the real RawTable plus the contract profile
 * (`proposedColumns`, `issues`). Nothing is applied silently: duplicates and
 * category mappings are candidates until approved, formula caches stay
 * excluded unless opted in per column, and the capability summary states
 * plainly what the table can and cannot support.
 */
import { Button, Icon, Section } from "@rowfolio/ui";
import type { I18n } from "@rowfolio/i18n";
import type { Column, QualityIssue, RawTable } from "@rowfolio/contracts";
import type { SourceInspection } from "@rowfolio/ingest";
import type { UploadDecisions, UploadSelection } from "./types.ts";
import {
  ambiguityKind,
  deriveCapabilities,
  effectiveColumns,
  groupIssues,
  pendingColumns,
  previewModel,
  sampleValues,
  warningMessageKey,
} from "./derive.ts";
import { PreviewGrid } from "./PreviewGrid.tsx";

/** First rows of the parsed table for the review preview (bounded). */
const REVIEW_PREVIEW_ROWS = 12;

function parsedPreview(table: RawTable) {
  const headerRow = table.sourceRef.headerRow;
  const maxRow = Math.min(table.sourceRef.range.lastRow, headerRow + REVIEW_PREVIEW_ROWS);
  return previewModel(table.cells.filter((c) => c.row >= headerRow && c.row <= maxRow));
}

export interface ReviewPanelProps {
  i18n: I18n;
  table: RawTable;
  inspection: SourceInspection;
  selection: UploadSelection;
  proposedColumns: readonly Column[];
  issues: readonly QualityIssue[];
  decisions: UploadDecisions;
  onToggleIssue(issueId: string, approved: boolean): void;
  onConfirmColumn(columnId: string): void;
  onDowngradeColumn(columnId: string): void;
  onToggleCache(fieldId: string, enabled: boolean): void;
  onBack(): void;
  onSubmit(): void;
}

function ColumnConfirm({
  i18n,
  column,
  table,
  onConfirm,
  onDowngrade,
}: {
  i18n: I18n;
  column: Column;
  table: RawTable;
  onConfirm(): void;
  onDowngrade(): void;
}) {
  const kind = ambiguityKind(column);
  const hint =
    kind === "date"
      ? i18n.t("upload.ambiguousDate")
      : kind === "number"
        ? i18n.t("upload.ambiguousNumber")
        : i18n.t("common.unknown");
  const samples = sampleValues(table.cells, column.sourceColumn, 3);
  return (
    <div className="rf-upload__colconfirm" data-testid={`col-confirm-${column.id}`}>
      <div className="rf-upload__colconfirm-head">
        <bdi dir="auto" className="rf-upload__issue-title">
          {column.label}
        </bdi>
        <bdi dir="ltr" className="rf-upload__badge">
          {column.type}
        </bdi>
        <select
          aria-label={column.label}
          defaultValue="unconfirmed"
          onChange={(event) => {
            if (event.target.value === "proposed") onConfirm();
            else if (event.target.value === "text") onDowngrade();
          }}
          data-testid={`col-select-${column.id}`}
        >
          <option value="unconfirmed">{i18n.t("common.unknown")}</option>
          <option value="proposed">{column.type}</option>
          <option value="text">text</option>
        </select>
      </div>
      <span className="rf-upload__meta">{hint}</span>
      {samples.length > 0 ? (
        <span className="rf-upload__issue-detail">
          {samples.map((sample) => (
            <bdi key={sample} dir="auto" className="rf-upload__cell">
              {sample}
            </bdi>
          ))}
        </span>
      ) : null}
    </div>
  );
}

function IssueChecklist({
  i18n,
  issues,
  decisions,
  onToggle,
  testId,
}: {
  i18n: I18n;
  issues: readonly QualityIssue[];
  decisions: UploadDecisions;
  onToggle(issueId: string, approved: boolean): void;
  testId: string;
}) {
  return (
    <ul className="rf-upload__sheets" data-testid={testId}>
      {issues.map((issue) => (
        <li key={issue.id} className="rf-upload__issue">
          <input
            type="checkbox"
            checked={decisions.approvedIssueIds.has(issue.id)}
            onChange={(event) => onToggle(issue.id, event.target.checked)}
            aria-label={i18n.tSafe(issue.messageKey)}
            data-testid={`${testId}-${issue.id}`}
          />
          <div className="rf-upload__issue-body">
            <span className="rf-upload__issue-title">{i18n.tSafe(issue.messageKey)}</span>
            <span className="rf-upload__issue-detail">
              <bdi dir="ltr" className="rf-mono">
                R{issue.sourceRow}
              </bdi>
              {issue.original !== null ? (
                <bdi dir="auto" className="rf-upload__cell">
                  {issue.original}
                </bdi>
              ) : null}
              {issue.normalized !== null ? (
                <>
                  <span aria-hidden="true">→</span>
                  <bdi dir="auto" className="rf-upload__cell">
                    {issue.normalized}
                  </bdi>
                </>
              ) : null}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReviewPanel({
  i18n,
  table,
  inspection,
  selection,
  proposedColumns,
  issues,
  decisions,
  onToggleIssue,
  onConfirmColumn,
  onDowngradeColumn,
  onToggleCache,
  onBack,
  onSubmit,
}: ReviewPanelProps) {
  const groups = groupIssues(issues);
  const columns = effectiveColumns(proposedColumns, decisions);
  const pending = pendingColumns(proposedColumns, decisions);
  const caps = deriveCapabilities(columns, issues, decisions, table.warnings);
  const sheet = inspection.sheets.find((s) => s.sheetId === selection.selectedSheetId);
  const dataRows = table.sourceRef.range.lastRow - table.sourceRef.headerRow;
  const tablePreview = parsedPreview(table);

  // Formula-cache issues are keyed by fieldId; group consent per column.
  const cacheFieldIds = [
    ...new Set(
      groups.formulaCache
        .map((issue) => issue.fieldId)
        .filter((id): id is string => id !== null),
    ),
  ];

  return (
    <div data-testid="review-panel">
      <Section title={i18n.t("upload.range")} headingLevel={3}>
        <p className="rf-upload__meta" data-testid="review-table-summary">
          {sheet ? <bdi dir="auto">{sheet.name}</bdi> : null}
          {" · "}
          <bdi dir="ltr" className="rf-mono">
            R{table.sourceRef.headerRow}
          </bdi>
          {" · "}
          {i18n.plural("count.records", dataRows)}
        </p>
        <div className="rf-upload__preview">
          <PreviewGrid i18n={i18n} preview={tablePreview} headerRow={table.sourceRef.headerRow} testId="review-preview" />
        </div>
      </Section>

      {pending.length > 0 ? (
        <Section title={i18n.t("common.unknown")} headingLevel={3}>
          {pending.map((column) => (
            <ColumnConfirm
              key={column.id}
              i18n={i18n}
              column={column}
              table={table}
              onConfirm={() => onConfirmColumn(column.id)}
              onDowngrade={() => onDowngradeColumn(column.id)}
            />
          ))}
        </Section>
      ) : null}

      {groups.duplicateGroups.length > 0 ? (
        <Section title={i18n.t("quality.duplicate")} headingLevel={3}>
          <p className="rf-upload__meta">{i18n.t("upload.duplicateWarning")}</p>
          {groups.duplicateGroups.map((group) => (
            <div key={group.canonicalSourceRow} className="rf-upload__issue">
              <input
                type="checkbox"
                checked={group.issues.every((issue) => decisions.approvedIssueIds.has(issue.id))}
                onChange={(event) => {
                  for (const issue of group.issues) {
                    onToggleIssue(issue.id, event.target.checked);
                  }
                }}
                aria-label={`R${group.canonicalSourceRow}`}
                data-testid={`dup-group-${group.canonicalSourceRow}`}
              />
              <div className="rf-upload__issue-body">
                <span className="rf-upload__issue-detail">
                  {group.issues.map((issue) => (
                    <bdi key={issue.id} dir="ltr" className="rf-mono">
                      R{issue.sourceRow}
                    </bdi>
                  ))}
                  <span aria-hidden="true">→</span>
                  <bdi dir="ltr" className="rf-mono">
                    R{group.canonicalSourceRow}
                  </bdi>
                </span>
              </div>
            </div>
          ))}
        </Section>
      ) : null}

      {groups.category.length > 0 ? (
        <Section title={i18n.t("quality.category")} headingLevel={3}>
          <IssueChecklist
            i18n={i18n}
            issues={groups.category}
            decisions={decisions}
            onToggle={onToggleIssue}
            testId="issue-category"
          />
        </Section>
      ) : null}

      {groups.missing.length > 0 ? (
        <Section title={i18n.t("quality.missing")} headingLevel={3}>
          <p className="rf-upload__meta">
            {i18n.plural("count.records", groups.missing.length)}
            {" · "}
            {i18n.t("quality.noImputation")}
          </p>
        </Section>
      ) : null}

      {cacheFieldIds.length > 0 ? (
        <Section title={i18n.t("limitations.cache")} headingLevel={3}>
          {cacheFieldIds.map((fieldId) => {
            const column = proposedColumns.find((c) => c.id === fieldId);
            return (
              <div key={fieldId} className="rf-upload__cache">
                <input
                  type="checkbox"
                  checked={decisions.cacheColumns.has(fieldId)}
                  onChange={(event) => onToggleCache(fieldId, event.target.checked)}
                  aria-label={i18n.t("upload.cacheConsent")}
                  data-testid={`cache-${fieldId}`}
                />
                <div className="rf-upload__issue-body">
                  <span className="rf-upload__issue-title">
                    {i18n.t("upload.cacheConsent")}
                  </span>
                  <span className="rf-upload__issue-detail">
                    <bdi dir="auto" className="rf-upload__cell">
                      {column?.label ?? fieldId}
                    </bdi>
                  </span>
                </div>
              </div>
            );
          })}
        </Section>
      ) : null}

      {groups.other.length > 0 ? (
        <Section title={i18n.t("quality.issues")} headingLevel={3}>
          <ul className="rf-upload__warnings">
            {groups.other.map((issue) => (
              <li key={issue.id} className="rf-upload__warning">
                <Icon name="info" />
                <span>{i18n.tSafe(issue.messageKey)}</span>
                <bdi dir="ltr" className="rf-mono">
                  R{issue.sourceRow}
                </bdi>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={i18n.t("common.status")} headingLevel={3}>
        <ul className="rf-upload__capabilities" data-testid="capability-summary">
          {!caps.hasDateAxis ? (
            <li className="rf-upload__capability">
              <Icon name="info" />
              {i18n.t("upload.noTime")}
            </li>
          ) : null}
          {!caps.hasAdditiveMeasure ? (
            <li className="rf-upload__capability">
              <Icon name="info" />
              {i18n.t("upload.noMeasures")}
            </li>
          ) : null}
          {caps.missingCount > 0 ? (
            <li className="rf-upload__capability">
              <Icon name="info" />
              {i18n.t("limitations.missingRetained")}
            </li>
          ) : null}
          {caps.hasFormulaCells ? (
            <li className="rf-upload__capability">
              <Icon name="warning" />
              {i18n.t("limitations.cache")}
            </li>
          ) : null}
          {caps.unresolvedCount > 0 ? (
            <li className="rf-upload__capability">
              <Icon name="warning" />
              {i18n.t("quality.unresolved")}
              {" · "}
              <bdi dir="ltr" className="rf-mono">
                {i18n.formatInteger(caps.unresolvedCount)}
              </bdi>
            </li>
          ) : null}
          {table.warnings.map((code) => {
            const key = warningMessageKey(code);
            return (
              <li key={code} className="rf-upload__capability">
                <Icon name="info" />
                <span>{key ? i18n.t(key) : i18n.t("quality.issues")}</span>
                {!key ? <code className="rf-upload__code">{code}</code> : null}
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="rf-upload__actions">
        <button type="button" className="rf-linkbtn" onClick={onBack} data-testid="review-back">
          {i18n.t("action.back")}
        </button>
        <Button variant="primary" onClick={onSubmit} data-testid="review-submit">
          {i18n.t("action.approve")}
        </Button>
      </div>
    </div>
  );
}
