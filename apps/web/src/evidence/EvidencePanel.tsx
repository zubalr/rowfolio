/**
 * EvidencePanel — the evidence content composed entirely from contract objects
 * and Provenance-service output.
 *
 * Layout, in the order the spec asks a reviewer to inspect:
 *   finding context (title + scope + caveats) → per-proof calculation trace
 *   with the service-evaluated result → contributing metric inputs → exact
 *   source rows per unique selection (paged, raw→clean inline) → excluded
 *   records → approved transformations → source-file fingerprint.
 *
 * No arithmetic lives here: `services.evaluateProof` is the only source of a
 * recomputed value, and the stored `proof.result` is shown alongside it with
 * an explicit verified/mismatch state.
 */
import { useMemo } from "react";
import type {
  Metric,
  NormalizedTable,
  Provenance,
  QualityIssue,
  RowSelection,
} from "@rowfolio/contracts";
import type { I18n, MessageKey } from "@rowfolio/i18n";
import { Bidi, cx, Icon, Section } from "@rowfolio/ui";
import { ExpressionTrace, type TraceContext } from "./ExpressionTrace.tsx";
import {
  expressionOperands,
  formatMetricValue,
  formatProofResult,
  formatScope,
  issuesByCell,
  metricCaveats,
  metricForProof,
  resultsAgree,
  resolveEvidenceSubject,
  selectionCaveats,
  subjectCaveats,
  subjectSelections,
  subjectTransformIds,
  type EvidenceCaveat,
} from "./model.ts";
import { SourceRowsTable } from "./SourceRowsTable.tsx";
import { EvidenceBadge } from "./EvidenceBadge.tsx";
import { metricUnitLabel } from "../workspace/format.ts";
import {
  EVIDENCE_PAGE_SIZE,
  type EvidenceBundle,
  type EvidenceServices,
} from "./types.ts";

export interface EvidencePanelProps {
  bundle: EvidenceBundle;
  services: EvidenceServices;
  i18n: I18n;
  /** Rows fetched per service page (default 50 per the design spec). */
  pageSize?: number;
  /** Hard cap on rendered rows; provenance may cover more. */
  maxRows?: number;
}

const DEFAULT_MAX_ROWS = 500;

function CaveatLine({ caveat, i18n }: { caveat: EvidenceCaveat; i18n: I18n }) {
  return (
    <span className={cx("rf-evidence__caveat", `rf-evidence__caveat--${caveat.tone}`)}>
      <Icon name={caveat.tone === "warning" ? "warning" : "info"} size={16} />
      <span>{i18n.tSafe(caveat.messageKey as MessageKey)}</span>
    </span>
  );
}

function ResultLine({
  proof,
  services,
  table,
  metrics,
  contextProofs,
  i18n,
}: {
  proof: Provenance;
  services: EvidenceServices;
  table: NormalizedTable;
  metrics: readonly Metric[];
  contextProofs: readonly Provenance[];
  i18n: I18n;
}) {
  const evaluated = services.evaluateProof(proof, table, metrics, contextProofs);
  const formatted = formatProofResult(i18n, proof, metrics);
  if (evaluated.value === null || evaluated.reasonKey !== null) {
    // Prefer the proof's authored reason key (localized copy); fall back to the
    // evaluator's diagnostic code when the proof carries none.
    const reason = proof.reasonKey ?? evaluated.reasonKey;
    return (
      <div className="rf-evidence__result">
        <span className="rf-evidence__equals" aria-hidden="true">
          =
        </span>
        <span className="rf-evidence__undefined">{i18n.t("common.undefined")}</span>
        {reason !== null ? (
          <CaveatLine caveat={{ id: "reason", messageKey: reason, tone: "warning" }} i18n={i18n} />
        ) : null}
      </div>
    );
  }
  const verified = resultsAgree(evaluated.value, proof.result);
  return (
    <div className="rf-evidence__result" data-testid="evidence-result">
      <span className="rf-evidence__equals" aria-hidden="true">
        =
      </span>
      <Bidi dir="ltr" className="rf-evidence__exact">
        {evaluated.value}
      </Bidi>
      {formatted !== null ? (
        <span className="rf-evidence__headline-value">{formatted}</span>
      ) : null}
      {verified ? (
        <span className="rf-evidence__verified">
          <Icon name="check" size={16} />
          {i18n.t("common.verified")}
        </span>
      ) : (
        <CaveatLine
          caveat={{ id: "mismatch", messageKey: "error.SCHEMA_MISMATCH", tone: "warning" }}
          i18n={i18n}
        />
      )}
    </div>
  );
}

function InputsList({
  proofs,
  ctx,
}: {
  proofs: readonly Provenance[];
  ctx: TraceContext;
}) {
  const { i18n } = ctx;
  const seen = new Set<string>();
  const metrics: Metric[] = [];
  for (const proof of proofs) {
    for (const id of expressionOperands(proof.expression).metricIds) {
      if (!seen.has(id)) {
        seen.add(id);
        const m = ctx.metricsById.get(id);
        if (m !== undefined) metrics.push(m);
      }
    }
  }
  if (metrics.length === 0) return null;
  return (
    <dl className="rf-evidence__inputs">
      {metrics.map((m) => {
        const label = i18n.has(m.labelKey as MessageKey)
          ? i18n.t(m.labelKey as MessageKey)
          : m.labelKey;
        const formatted = formatMetricValue(i18n, m);
        return (
          <div className="rf-evidence__input" key={m.id}>
            <dt>{label}</dt>
            <dd>
              {formatted !== null ? (
                <>
                  <Bidi dir="ltr" className="rf-evidence__num">
                    {formatted}
                  </Bidi>
                  {metricUnitLabel(m.unit, (k) => i18n.tSafe(k as MessageKey)) !== null ? (
                    <Bidi dir="ltr" className="rf-evidence__unit">
                      {metricUnitLabel(m.unit, (k) => i18n.tSafe(k as MessageKey))}
                    </Bidi>
                  ) : null}
                </>
              ) : (
                <span className="rf-evidence__undefined">{i18n.t("common.undefined")}</span>
              )}
              <span className="rf-evidence__eligibility">
                {i18n.formatInteger(m.eligibleRows)}
                {" / "}
                {i18n.plural("count.records", m.totalRows)}
              </span>
              {metricCaveats(m).map((c) => (
                <CaveatLine caveat={c} i18n={i18n} key={c.id} />
              ))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function TransformList({ issues, i18n }: { issues: readonly QualityIssue[]; i18n: I18n }) {
  if (issues.length === 0) return null;
  return (
    <ul className="rf-evidence__transforms">
      {issues.map((q) => (
        <li key={q.id} className="rf-evidence__transform">
          <Bidi dir="ltr" className="rf-evidence__id">
            R{q.sourceRow}
          </Bidi>
          <span className="rf-evidence__change">
            {q.original !== null ? (
              <s className="rf-evidence__cell-original">
                <Bidi dir="auto">{q.original}</Bidi>
              </s>
            ) : null}
            {q.normalized !== null ? (
              <Bidi dir="auto">{q.normalized}</Bidi>
            ) : (
              <span className="rf-evidence__empty">·</span>
            )}
          </span>
          <span className="rf-evidence__transform-status">
            {i18n.tSafe(q.messageKey as MessageKey)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function EvidencePanel({
  bundle,
  services,
  i18n,
  pageSize = EVIDENCE_PAGE_SIZE,
  maxRows = DEFAULT_MAX_ROWS,
}: EvidencePanelProps) {
  const subject = useMemo(() => resolveEvidenceSubject(bundle), [bundle]);
  const selections = useMemo(() => subjectSelections(subject), [subject]);
  const cellIssues = useMemo(() => issuesByCell(bundle.table), [bundle.table]);
  const rowIssues = useMemo(() => {
    const map = new Map<number, QualityIssue[]>();
    for (const q of bundle.table.qualityIssues) {
      const list = map.get(q.sourceRow);
      if (list === undefined) map.set(q.sourceRow, [q]);
      else list.push(q);
    }
    return map;
  }, [bundle.table]);
  const transformIssues = useMemo(() => {
    const wanted = new Set(subjectTransformIds(subject));
    return bundle.table.qualityIssues.filter((q) => wanted.has(q.id));
  }, [bundle.table, subject]);
  const ctx: TraceContext = useMemo(
    () => ({
      i18n,
      metricsById: new Map<string, Metric>(bundle.snapshot.metrics.map((m) => [m.id, m])),
      selectionsById: new Map<string, RowSelection>(selections.map((s) => [s.id, s])),
      table: bundle.table,
    }),
    [i18n, bundle.snapshot.metrics, selections, bundle.table],
  );
  const caveats = subjectCaveats(subject);
  const sourceRef = bundle.table.sourceRef;
  // Sections that would render a bare heading (descriptive findings carry no
  // proofs, no operand metrics, no transforms) are omitted entirely — the
  // panel shows only what there is to see.
  const hasInputs = subject.proofs.some((proof) =>
    expressionOperands(proof.expression).metricIds.some((id) => ctx.metricsById.has(id)),
  );

  return (
    <div className="rf-evidence" data-testid="evidence-panel">
      <header className="rf-evidence__header">
        <EvidenceBadge findingId={subject.finding.id} label={sourceRef.sheetName} />
        <p className="rf-evidence__finding">{i18n.t(subject.finding.titleKey as MessageKey)}</p>
        <p className="rf-evidence__scope">{formatScope(i18n, subject.finding.scope)}</p>
        {caveats.length > 0 ? (
          <div className="rf-evidence__caveats" role="note">
            {caveats.map((c) => (
              <CaveatLine caveat={c} i18n={i18n} key={c.id} />
            ))}
          </div>
        ) : null}
      </header>

      {subject.proofs.length > 0 ? (
        <Section
          title={i18n.t("evidence.calculation")}
          headingLevel={3}
          className="rf-evidence__section"
        >
          {subject.proofs.map((proof) => {
          const metric = metricForProof(subject.metrics, proof.id);
            return (
              <article className="rf-evidence__proof" key={proof.id}>
                {metric !== undefined ? (
                  <header className="rf-evidence__proof-head">
                    <h4 className="rf-evidence__proof-title">
                      {i18n.has(metric.labelKey as MessageKey)
                        ? i18n.t(metric.labelKey as MessageKey)
                        : metric.labelKey}
                    </h4>
                  </header>
                ) : null}
                <ExpressionTrace expression={proof.expression} ctx={ctx} />
                <ResultLine
                  proof={proof}
                  services={services}
                  table={bundle.table}
                  metrics={bundle.snapshot.metrics}
                  contextProofs={bundle.snapshot.provenance}
                  i18n={i18n}
                />
                <p className="rf-evidence__method">
                  {i18n.t("common.method")}:{" "}
                  <Bidi dir="ltr" className="rf-evidence__id">
                    {proof.precision}-digit · {proof.rounding} · policy {proof.policyVersion}
                  </Bidi>
                </p>
              </article>
            );
          })}
        </Section>
      ) : null}

      {hasInputs ? (
        <Section
          title={i18n.t("evidence.inputs")}
          headingLevel={3}
          className="rf-evidence__section"
        >
          <InputsList proofs={subject.proofs} ctx={ctx} />
        </Section>
      ) : null}

      {selections.map((selection) => (
        <Section
          key={selection.id}
          title={i18n.t("evidence.sourceRows")}
          ariaLabel={i18n.t("evidence.sourceRows")}
          headingLevel={3}
          className="rf-evidence__section"
        >
          <div className="rf-evidence__selection-head">
            <span className="rf-evidence__spans">
              {selection.spans.map((span) => (
                <Bidi dir="ltr" className="rf-evidence__num" key={`${span.start}-${span.end}`}>
                  {span.start === span.end ? `R${span.start}` : `R${span.start}-R${span.end}`}
                </Bidi>
              ))}
            </span>
            <span className="rf-evidence__operand-note">
              {i18n.plural("count.records", selection.rowCount)}
            </span>
          </div>
          {selectionCaveats(selection, bundle.table).map((c) => (
            <CaveatLine caveat={c} i18n={i18n} key={c.id} />
          ))}
          <SourceRowsTable
            table={bundle.table}
            selection={selection}
            services={services}
            issueByCell={cellIssues}
            issueByRow={rowIssues}
            i18n={i18n}
            pageSize={pageSize}
            maxRows={maxRows}
          />
        </Section>
      ))}

      {transformIssues.length > 0 ? (
        <Section
          title={i18n.t("evidence.transformations")}
          headingLevel={3}
          className="rf-evidence__section"
        >
          <TransformList issues={transformIssues} i18n={i18n} />
        </Section>
      ) : null}

      <footer className="rf-evidence__fingerprint">
        <h4 className="rf-evidence__fingerprint-title">{i18n.t("evidence.hash")}</h4>
        <dl className="rf-evidence__fingerprint-grid">
          <div>
            <dt>{i18n.t("common.source")}</dt>
            <dd>
              <Bidi dir="auto" className="rf-evidence__filename">
                {sourceRef.workbookName}
              </Bidi>
            </dd>
          </div>
          <div>
            <dt>{i18n.t("common.sheet")}</dt>
            <dd>
              <Bidi dir="auto" className="rf-evidence__filename">
                {sourceRef.sheetName}
              </Bidi>
            </dd>
          </div>
        </dl>
        <details className="rf-evidence__tech">
          <summary>{i18n.t("common.technicalDetails")}</summary>
          <dl className="rf-evidence__fingerprint-grid">
            <div>
              <dt>SHA-256</dt>
              <dd>
                <Bidi dir="ltr" className="rf-evidence__hash">
                  {sourceRef.sourceHash}
                </Bidi>
              </dd>
            </div>
          </dl>
          <p className="rf-evidence__hash-note">{i18n.t("evidence.hashNote")}</p>
        </details>
      </footer>
    </div>
  );
}
