/**
 * ExpressionTrace — the accessible structured rendering of a proof's
 * expression tree.
 *
 * The tree renders as nested lists (never untrusted HTML and never an
 * evaluated formula string): operator glyphs are international math symbols,
 * metric operands show their contract-stored localized values, and
 * selection/issue operands show verbatim IDs as isolated LTR islands. Only
 * values that already exist on the contract graph are displayed — leaf
 * metrics/literals carry their own value, and the evaluated root result is
 * supplied by the Provenance service, not recomputed here.
 */
import type { ReactNode } from "react";
import type { Expression, Metric, NormalizedTable, RowSelection } from "@rowfolio/contracts";
import type { I18n, MessageKey } from "@rowfolio/i18n";
import { Bidi, cx, Icon } from "@rowfolio/ui";
import { formatDecimalForUnit, spanTokens } from "./model.ts";
import { metricUnitLabel } from "../workspace/format.ts";

export interface TraceContext {
  i18n: I18n;
  /** All snapshot metrics (operand refs may point outside the finding). */
  metricsById: ReadonlyMap<string, Metric>;
  /** Every selection declared by the subject's proofs. */
  selectionsById: ReadonlyMap<string, RowSelection>;
  table: NormalizedTable;
}

const OP_GLYPH: Record<string, string> = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
  sum: "Σ",
  "count-rows": "n",
  "count-issues": "n",
};

function MetricOperand({ metricId, ctx }: { metricId: string; ctx: TraceContext }) {
  const { i18n } = ctx;
  const metric = ctx.metricsById.get(metricId);
  if (metric === undefined) {
    return (
      <span className="rf-evidence__operand rf-evidence__operand--missing">
        <Icon name="warning" size={16} />
        <Bidi dir="ltr" className="rf-evidence__id">
          {metricId}
        </Bidi>
        <span className="rf-evidence__operand-note">{i18n.t("common.notAvailable")}</span>
      </span>
    );
  }
  const label = i18n.has(metric.labelKey as MessageKey)
    ? i18n.t(metric.labelKey as MessageKey)
    : metric.labelKey;
  const value =
    metric.status === "defined" && metric.value !== null
      ? metric.unit.kind === "currency" && metric.unit.currency !== null
        ? i18n.formatCurrency(metric.value, metric.unit.currency)
        : formatDecimalForUnit(i18n, metric.value, metric.unit.kind)
      : null;
  return (
    <span className="rf-evidence__operand">
      <span className="rf-evidence__operand-label">{label}</span>
      {value !== null ? (
        <Bidi dir="ltr" className="rf-evidence__num">
          {value}
        </Bidi>
      ) : (
        <span className="rf-evidence__undefined" title={i18n.tSafe(metric.reasonKey as MessageKey)}>
          ·
        </span>
      )}
      {metricUnitLabel(metric.unit) !== null ? (
        <Bidi dir="ltr" className="rf-evidence__unit">
          {metricUnitLabel(metric.unit)}
        </Bidi>
      ) : null}
    </span>
  );
}

function SelectionOperand({
  selectionId,
  fieldId,
  ctx,
}: {
  selectionId: string;
  fieldId: string | null;
  ctx: TraceContext;
}) {
  const { i18n } = ctx;
  const selection = ctx.selectionsById.get(selectionId);
  if (selection === undefined) {
    return (
      <span className="rf-evidence__operand rf-evidence__operand--missing">
        <Icon name="warning" size={16} />
        <Bidi dir="ltr" className="rf-evidence__id">
          {selectionId}
        </Bidi>
      </span>
    );
  }
  const field = fieldId !== null ? ctx.table.columns.find((c) => c.id === fieldId) : undefined;
  return (
    <span className="rf-evidence__operand">
      {field !== undefined ? (
        <Bidi dir="auto" className="rf-evidence__operand-label">
          {field.label}
        </Bidi>
      ) : fieldId !== null ? (
        <Bidi dir="ltr" className="rf-evidence__id">
          {fieldId}
        </Bidi>
      ) : null}
      <Bidi dir="ltr" className="rf-evidence__id">
        {selection.id}
      </Bidi>
      <span className="rf-evidence__spans">
        {spanTokens(selection).map((token) => (
          <Bidi dir="ltr" className="rf-evidence__num" key={token}>
            {token}
          </Bidi>
        ))}
      </span>
      <span className="rf-evidence__operand-note">
        {i18n.plural("count.records", selection.rowCount)}
      </span>
    </span>
  );
}

function TraceNode({ node, ctx }: { node: Expression; ctx: TraceContext }) {
  const { i18n } = ctx;
  let line: ReactNode;
  let children: ReactNode = null;
  switch (node.op) {
    case "literal":
      line = (
        <Bidi dir="ltr" className="rf-evidence__num">
          {node.value}
        </Bidi>
      );
      break;
    case "metric":
      line = <MetricOperand metricId={node.metricId} ctx={ctx} />;
      break;
    case "sum":
      line = <SelectionOperand selectionId={node.selectionId} fieldId={node.fieldId} ctx={ctx} />;
      break;
    case "count-rows":
      line = <SelectionOperand selectionId={node.selectionId} fieldId={null} ctx={ctx} />;
      break;
    case "count-issues":
      line = (
        <span className="rf-evidence__operand">
          <span className="rf-evidence__operand-label">{i18n.t("quality.issues")}</span>
          <Bidi dir="ltr" className="rf-evidence__num">
            {i18n.formatInteger(node.issueIds.length)}
          </Bidi>
        </span>
      );
      break;
    case "add":
    case "subtract":
    case "multiply":
    case "divide":
      children = (
        <ul className="rf-evidence__trace-branch">
          <TraceNode node={node.left} ctx={ctx} />
          <TraceNode node={node.right} ctx={ctx} />
        </ul>
      );
      line = null;
      break;
  }
  const glyph = OP_GLYPH[node.op];
  return (
    <li className="rf-evidence__trace-node">
      <span className="rf-evidence__trace-line">
        {glyph !== undefined ? (
          <span className={cx("rf-evidence__op", node.op === "count-issues" && "rf-evidence__op--issues")} aria-hidden="true" dir="ltr">
            {glyph}
          </span>
        ) : null}
        {line}
      </span>
      {children}
    </li>
  );
}

export function ExpressionTrace({ expression, ctx }: { expression: Expression; ctx: TraceContext }) {
  return (
    <ul className="rf-evidence__trace" data-testid="evidence-trace">
      <TraceNode node={expression} ctx={ctx} />
    </ul>
  );
}
