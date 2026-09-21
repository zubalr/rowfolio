import { useEffect, useMemo, useState } from 'react';
import type { Metric, NormalizedRow, NormalizedTable, Provenance } from '@rowfolio/contracts';

/** Structural twin of contracts/interfaces EvidencePage (declaration module). */
interface EvidencePage {
  rows: readonly NormalizedRow[];
  offset: number;
  total: number;
  nextOffset: number | null;
}
import { Dialog } from '@rowfolio/ui';
import type { I18n, MessageKey } from '@rowfolio/i18n';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import { AdapterUnavailableError, loadProvenance } from '../workers/adapters.ts';
import { findingTitle } from './findingCopy.ts';

const PAGE_SIZE = 50;

/**
 * Evidence drawer — dark ink surface. For the selected finding: each claimed
 * provenance is verified (`evaluateProof`) and its source-row selection is
 * paged through `readEvidencePage` — one-based physical source rows, exact.
 */
export function EvidencePanel() {
  const i18n = useI18n();
  const { controller } = useServices();
  const state = useSessionState();
  const findingId = state.evidenceFindingId;
  const active = state.active;

  const finding = active?.snapshot.findings.find((f) => f.id === findingId) ?? null;
  const proofs = useMemo(() => {
    if (!active || !finding) return [];
    const ids = new Set(finding.provenanceIds);
    return active.snapshot.provenance.filter((p) => ids.has(p.id));
  }, [active, finding]);

  return (
    <Dialog
      open={state.evidenceOpen && finding !== null}
      onClose={() => controller.closeEvidence()}
      title={finding ? `${i18n.tSafe('evidence.title' as MessageKey)}` : ''}
      closeLabel={i18n.tSafe('a11y.closeEvidence' as MessageKey)}
      surface="ink"
      placement="drawer"
    >
      {finding && active && (
        <>
          <p className="rf-evidence-finding">{findingTitle(i18n, finding)}</p>
          <EvidenceBody
            i18n={i18n}
            proofs={proofs}
            table={active.table}
            metrics={active.snapshot.metrics}
            allProofs={active.snapshot.provenance}
            sourceHash={active.source.hash}
          />
        </>
      )}
    </Dialog>
  );
}

function EvidenceBody({
  i18n,
  proofs,
  table,
  metrics,
  allProofs,
  sourceHash,
}: {
  i18n: I18n;
  proofs: readonly Provenance[];
  table: NormalizedTable;
  metrics: readonly Metric[];
  /** Every snapshot proof — composite expressions resolve sibling metric
   *  refs through proofs the finding itself does not list. */
  allProofs: readonly Provenance[];
  sourceHash: string;
}) {
  const [proofResults, setProofResults] = useState<Map<string, { value: string | null; reasonKey: string | null }> | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setProofResults(null);
    setProofError(null);
    void (async () => {
      try {
        const mod = await loadProvenance();
        const out = new Map<string, { value: string | null; reasonKey: string | null }>();
        for (const proof of proofs) {
          const evaluated = mod.evaluateProof(
            proof as never,
            table as never,
            metrics as never,
            allProofs as never,
          ) as {
            value: string | null;
            reasonKey: string | null;
          };
          out.set(proof.id, evaluated);
        }
        if (alive) setProofResults(out);
      } catch (error) {
        if (alive) setProofError(error instanceof AdapterUnavailableError ? 'pending' : 'error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [proofs, table, metrics, allProofs]);

  return (
    <div className="rf-evidence">
      <div className="rf-evidence-hash">
        <span className="rf-evidence-label">{i18n.tSafe('evidence.hash' as MessageKey)}</span>
        <code className="rf-hash" dir="ltr">{sourceHash}</code>
        <span className="rf-quiet">{i18n.tSafe('evidence.hashNote' as MessageKey)}</span>
      </div>

      {proofs.length === 0 && <p>{i18n.tSafe('empty.noSelection' as MessageKey)}</p>}
      {proofs.map((proof) => (
        <ProofBlock key={proof.id} i18n={i18n} proof={proof} table={table} result={proofResults?.get(proof.id) ?? null} unavailable={proofError} />
      ))}
    </div>
  );
}

function ProofBlock({
  i18n,
  proof,
  table,
  result,
  unavailable,
}: {
  i18n: I18n;
  proof: Provenance;
  table: NormalizedTable;
  result: { value: string | null; reasonKey: string | null } | null;
  unavailable: string | null;
}) {
  const [pages, setPages] = useState<Map<string, EvidencePage>>(new Map());
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPages(new Map());
    setPageError(null);
    void (async () => {
      try {
        const mod = await loadProvenance();
        const out = new Map<string, EvidencePage>();
        for (const selection of proof.selections) {
          const page = mod.readEvidencePage(table as never, selection as never, 0, PAGE_SIZE) as EvidencePage;
          out.set(selection.id, page);
        }
        if (alive) setPages(new Map(out));
      } catch (error) {
        if (alive) setPageError(error instanceof AdapterUnavailableError ? 'pending' : 'error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [proof, table]);

  return (
    <section className="rf-proof">
      <header className="rf-proof-head">
        <span className="rf-evidence-label">{i18n.tSafe('evidence.calculation' as MessageKey)}</span>
        <ExpressionView expression={proof.expression} />
        {result !== null && (
          <span className="rf-proof-result" dir="ltr">
            {result.value ?? i18n.tSafe('common.undefined' as MessageKey)}
          </span>
        )}
        {unavailable === 'pending' && <span className="rf-quiet">…</span>}
      </header>

      {proof.selections.map((selection) => (
        <SelectionTable
          key={selection.id}
          i18n={i18n}
          page={pages.get(selection.id) ?? null}
          error={pageError}
        />
      ))}

      {proof.transformIds.length > 0 && (
        <p className="rf-quiet">
          {i18n.tSafe('evidence.transformations' as MessageKey)}: {proof.transformIds.length}
        </p>
      )}
    </section>
  );
}

function ExpressionView({ expression }: { expression: Provenance['expression'] }) {
  return <code className="rf-expression" dir="ltr">{describeExpression(expression)}</code>;
}

function describeExpression(expr: Provenance['expression']): string {
  switch (expr.op) {
    case 'literal':
      return String(expr.value);
    case 'metric':
      return `metric(${expr.metricId})`;
    case 'sum':
      return `sum(${expr.fieldId} @ ${expr.selectionId})`;
    case 'count-rows':
      return `count-rows(${expr.selectionId})`;
    case 'count-issues':
      return `count-issues(${expr.issueIds.length})`;
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide': {
      const sym = { add: '+', subtract: '−', multiply: '×', divide: '÷' }[expr.op];
      return `(${describeExpression(expr.left)} ${sym} ${describeExpression(expr.right)})`;
    }
    default:
      return '?';
  }
}

function SelectionTable({
  i18n,
  page,
  error,
}: {
  i18n: I18n;
  page: EvidencePage | null;
  error: string | null;
}) {
  if (error === 'pending') {
    return <p className="rf-quiet">{i18n.tSafe('evidence.noRows' as MessageKey)}</p>;
  }
  if (!page) return null;
  if (page.rows.length === 0) {
    return <p className="rf-quiet">{i18n.tSafe('evidence.noRows' as MessageKey)}</p>;
  }
  return (
    <div className="rf-evidence-rows">
      <span className="rf-evidence-label">{i18n.tSafe('evidence.sourceRows' as MessageKey)}</span>
      <table className="rf-evidence-table">
        <thead>
          <tr>
            <th dir="ltr">R#</th>
            <th>{i18n.tSafe('common.normalized' as MessageKey)}</th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row: NormalizedRow) => (
            <tr key={row.id} data-testid="evidence-source-row">
              <td className="rf-src-row" dir="ltr">R{row.sourceRow}</td>
              <td className="rf-src-values" dir="ltr">
                {Object.values(row.values).slice(0, 4).map((v, i) => (
                  <span key={i} className="rf-src-val">{v === null ? '—' : String(v)}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="rf-quiet" dir="ltr">
        {i18n.tSafe('evidence.more' as MessageKey, {
          start: String(page.offset + 1),
          end: String(page.offset + page.rows.length),
          total: String(page.total),
        })}
      </p>
    </div>
  );
}
