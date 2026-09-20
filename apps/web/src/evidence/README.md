# `apps/web/src/evidence` — evidence dialog and source browser

The evidence surface renders **only Provenance-service output**. Every number a
reviewer sees is either (a) stored on the contract object (`proof.result`,
`metric.value`, ledger `original`/`normalized` cells) or (b) returned by the
injected services — this package performs no metric arithmetic of its own.

## Public API

```tsx
import { EvidenceDialog } from "../../evidence/index.ts"; // or the app alias

<EvidenceDialog
  open={open}
  onClose={() => setOpen(false)}
  bundle={{ snapshot, table, findingId }}
  services={{ evaluateProof, readEvidencePage }}
  i18n={i18n}
/>
```

- `EvidenceServices` mirrors the `packages/provenance` signatures published in
  `contracts/INTERFACES.md` (v1.0.0): `evaluateProof(proof, table, metrics)` and
  `readEvidencePage(table, selection, offset, pageSize)`. The interfaces live in
  `packages/contracts/src/interfaces.ts` and are mirrored in `types.ts` until
  the contracts package re-exports them at the root (deep imports are banned by
  ESLint — see PR body change request).
- `EvidenceBundle` is the immutable input set: the analysis snapshot, the
  normalized table, and the finding whose evidence is shown. References that do
  not resolve raise a typed `EvidenceError`, never a silent empty render.
- `EvidencePanel` is exported for embedders that want the content without the
  modal chrome.

## What the panel shows

1. **Finding context** — title, scope (period/regions/coverage note), sheet,
   plus caveat lines for partial coverage and declared limitations.
2. **Calculation** — each proof's expression rendered as an accessible
   structured trace (nested lists of operator glyphs + operand references;
   never untrusted HTML or a reconstructed formula string), followed by the
   service-evaluated result at full precision, the rounded display value, and
   an explicit verified / undefined-with-reason / version-mismatch state.
3. **Contributing values** — every metric operand across the proofs with its
   localized stored value, unit and eligible/total row count, caveats inline.
4. **Exact source rows** — one paged browser per unique selection. Pages are
   fetched via `readEvidencePage` (50 rows/page default, append on
   "Show more rows"). Canonical spans are rendered as exact disjoint tokens
   (`R1802–R1901 · R2200`), never collapsed into one misleading range. Cell
   values are verbatim; ledger-approved raw→clean changes render as
   `<s>original</s> normalized`. Excluded row IDs are listed under the table.
5. **Approved changes** — ledger entries carried by `proof.transformIds`.
6. **Source fingerprint** — workbook name, sheet name, SHA-256, and the
   "identifies bytes, not business truth" caveat.

## Semantics honoured

- `Dialog` (`surface="ink"`, `placement="drawer"`) gives the modal: inert
  background, Escape close, focus trap, initial focus on the heading, focus
  restoration to the trigger, scroll lock. Drawer is 560px end-anchored on
  desktop and a full-height sheet under 768px.
- All IDs, formulas, signed numerics and ISO-ish strings are rendered inside
  `dir="ltr"` islands (`<Bidi>`); user content (labels, sheet names) is
  `dir="auto"`.
- Missing/cache/partial-coverage caveats sit beside the value or selection
  they affect.
- No state escapes: rows come from the service each render pass; nothing is
  cached across opens.
