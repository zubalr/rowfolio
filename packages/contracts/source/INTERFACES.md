# Public interfaces and semantic contract
Version 1.0.0. JSON Schema in `rowfolio.schema.json` is the wire authority. `types.ts` is generated and structurally typechecks payloads; it cannot encode arithmetic, referential integrity or every range invariant. Runtime refinements below are mandatory. Local `.invalid` schema IDs are identifiers only: validators resolve the checked-in schema registry and must not fetch them over the network.

## Package entry points
```ts
// All imported names below come from generated contracts/types.ts.
// Binary data is transferred out of band, never encoded inside JSON.
type BinarySlots = ReadonlyMap<string, ArrayBuffer>;
type Progress = (stage: string, fraction: number | null) => void;
interface ParseOptions { selectedSheetId?: string; headerRow?: number; firstColumn?: number; lastColumn?: number; allowHiddenSheet: boolean; }
interface ApprovalPlan { issueIds: readonly string[]; columns: readonly Column[]; useUnverifiedFormulaCaches: readonly string[]; }
interface AnalysisOptions { version: '1.0.0'; confirmedScope: Scope; samplePolicyId: string | null; }
interface EvidencePage { rows: readonly NormalizedRow[]; offset: number; total: number; nextOffset: number | null; }
interface BuiltArtifact { metadata: ExportArtifact; bytes: ArrayBuffer; }

// packages/ingest — worker entry supervises timeout/cancellation.
parseSource(bytes: ArrayBuffer, sourceName: string, options: ParseOptions, progress: Progress): Promise<RawTable>;
// A raw-sheet listing/preview uses the same bounded preflight; never parse twice unbounded.

// packages/normalize
profileTable(raw: RawTable): { proposedColumns: Column[]; issues: QualityIssue[] };
normalizeTable(raw: RawTable, approvals: ApprovalPlan): NormalizedTable;

// packages/provenance
evaluateProof(proof: Provenance, table: NormalizedTable, metrics: readonly Metric[]): { value: Decimal | null; reasonKey: string | null };
readEvidencePage(table: NormalizedTable, selection: RowSelection, offset: number, pageSize: number): EvidencePage;

// packages/analysis
analyze(table: NormalizedTable, options: AnalysisOptions): AnalysisSnapshot;

// packages/scenario
runScenario(snapshot: AnalysisSnapshot, definition: ScenarioDefinition, costChange: Decimal): ScenarioResult;

// packages/export-model
buildExportModel(snapshot: AnalysisSnapshot, table: NormalizedTable, scenario: ScenarioResult | null, locale: Locale, numberingSystem: 'latn' | 'arab', createdAt: string): ExportModel;

// packages/export-xlsx and packages/export-pptx respectively
buildWorkbook(model: ExportModel, progress: Progress): Promise<BuiltArtifact>;
buildPresentation(model: ExportModel, progress: Progress): Promise<BuiltArtifact>;
```

The declarations above describe module functions, not a single global namespace to paste verbatim. A01 emits importable declaration modules during bootstrap. Extra internal helpers are allowed; public signatures change only through the contract process. `Decimal` in signatures is the generated decimal-string type, not a Decimal.js instance. Workers instantiate the arithmetic library internally. UI components consume these types through props and never call a separate analytical implementation.

## Worker transport
Validate metadata against WorkerRequest/WorkerResponse schemas. The actual `postMessage` envelope is `{ message, binaries: Array<{slot, buffer}> }`; the transferable list contains those buffers. Validate slot uniqueness, required slot presence and exact byteLength against metadata. No ArrayBuffer serialization to JSON, no base64. A worker may retain raw tables keyed by rawTableId within one session for normalization; disposal/termination clears that session. Payloads referring to unknown tables fail. Every response echoes protocolVersion/requestId/sessionId/revision. Unknown/old messages are ignored by the UI after diagnostics that contain no source values. Hard cancellation terminates and recreates the worker; a cancelled promise is not sufficient to stop a synchronous parser.

## Semantic refinements beyond JSON Schema
- Source/selected ranges are ordered; header belongs to selected source sheet; source row/column coordinates are one-based physical addresses. Row IDs bind sheet ordinal and original physical row, never display position.
- Row spans are sorted, disjoint, nonadjacent canonical spans with start≤end. Sum of lengths equals rowCount. Fields and sourceRef IDs exist. Selected rows actually exist in the source/normalized table according to the operation. Exclusions remain in the source ledger and cannot also contribute.
- Normalized row value keys exactly match column IDs. Identifiers remain text; numeric values satisfy declared scale/range and input significant-digit policy. No NaN, Infinity, exponent notation or negative zero in canonical output. Date strings validate as real Gregorian dates; calendar entries are unique.
- Metric IDs, finding IDs, chart IDs, proof IDs and quality issue IDs are unique in their namespace. References resolve. Proof metric graphs are acyclic. Result status `defined` requires a finite decimal and null reason; `undefined` requires null value and a reason key. eligibleRows≤totalRows. A ratio cannot silently divide by zero. Scope and shared masks must match operands.
- `sum` expressions evaluate field values over the exact selection; `count-rows` counts that exact row set; `count-issues` counts unique IDs in the transformation/quality ledger. A count of quality issues is not necessarily a count of affected rows. `literal` is reserved for explicit scenario constants or declared constants, not a way to bypass calculation of source facts. Never `eval` expression strings.
- Scope start≤end, unit/currency compatibility and period completeness must be confirmed. Raw source labels are not translated into semantic roles without approval. Currency uses a three-letter code; validate actual supported Intl code/meaning rather than assuming any three letters is a valid business unit.
- Finding metric/proof/quality IDs resolve to the same source and normalization revision. Every numeric placeholder maps to a metric or a quality summary/count with ledger evidence. Ranking uses documented deterministic priority then coverage, magnitude and stable ID; never random order.
- Scenario fraction is within [-0.20,0.30] and an exact multiple of 0.001; no silent clamping. Baseline ID matches; required metrics are defined with compatible units/shared masks; factor applied after aggregate. A nonpositive revenue disables margin. Negative costs disable this recipe.
- Export source hash/table revision/analysis ID agree. Scenario baseline matches. Slides refer only to baseline + scenario metric/proof/chart IDs. Exactly five sheet IDs and six unique slide IDs. No external content, unknown formula or unsafe sheet/table name. Locale formatting never changes numerical values.
- Quality summary raw/retained/resolved/unresolved counts reconcile with actual data/ledger; each issue has one status. `rawRows - retainedRows` is excluded row count, not total issue count.
- Progress fraction is monotonic **within a stage**, nullable for unknown serialization work; stage transition may reset fraction. This avoids false global-progress precision. Final ready is a success result, not a timed animation.

## Identity and canonical serialization
Canonical JSON recursively sorts object keys, preserves array order, encodes UTF-8 without whitespace and forbids nonfinite numbers. Normalize decimal strings to nonexponent form; preserve declared money display scale separately. Hash domain includes explicit schema/policy version, column roles/units, approved transformations, selected source range and normalized values. `sourceHash` is SHA-256 of original bytes; `normalizationRevision` is a semantic hash; analysisId additionally binds rule version/scope; scenarioId binds baseline and assumptions; exportId binds locale/template/scenario. Source names are display metadata, not a license to transmit private content.

The reference example binder uses an explicitly recorded canonical payload of columns, normalized rows, policy and approved issue IDs. It is a planning fixture, not the final production hash implementation. A01/A02 must migrate/rebind all examples together if the production canonical payload adds required semantic metadata. Do not silently accept mismatched hash algorithms under the same version.

## Localization contract
Flat dot-separated keys in `locales/en.json` and `locales/ar.json`; identical key and placeholder sets. Curly placeholders are typed/interpolated as text or safe React nodes, never HTML. Counted-noun variants use suffixes `.zero/.one/.two/.few/.many/.other` and `Intl.PluralRules`. Original spreadsheet cell values are escaped, direction-isolated and never used as translation keys. Unknown keys fail tests; user-visible fallback shows a generic localized error rather than raw internal stack/cell content.
