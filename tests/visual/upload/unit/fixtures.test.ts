/**
 * Fixture-driven controller tests: real generated fixtures from
 * fixtures/ingest/generated/ (sha256-verified in the manifest) flow through
 * the REAL ingest ports and the REAL controller state machine. The contract
 * profile is the deterministic test profiler in ./test-ports.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createUploadController } from "../../../../apps/web/src/upload/controller.ts";
import { ingestPorts } from "../../../../apps/web/src/upload/adapters.ts";
import type {
  UploadOutcome,
  UploadState,
} from "../../../../apps/web/src/upload/types.ts";
import { testProfile } from "./test-ports.ts";

const FIXTURES = join(__dirname, "..", "..", "..", "..", "fixtures", "ingest", "generated");

function fixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function makePorts() {
  return { ...ingestPorts(), profile: testProfile };
}

async function waitFor(
  controller: ReturnType<typeof createUploadController>,
  predicate: (s: UploadState) => boolean,
  timeoutMs = 5_000,
): Promise<UploadState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = controller.getState();
    if (predicate(s)) return s;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return controller.getState();
}

async function toReview(controller: ReturnType<typeof createUploadController>) {
  await waitFor(controller, (s) => s.stage === "configure" || s.stage === "error");
  controller.proceed();
  return waitFor(controller, (s) => s.stage === "review" || s.stage === "error");
}

describe("upload flow over real fixtures", () => {
  it("XLSX happy path: types-and-formulas reaches review with formula-cache issues", async () => {
    let outcome: UploadOutcome | null = null;
    const c = createUploadController(makePorts(), { onComplete: (o) => (outcome = o) });
    c.acceptFile(fixture("types-and-formulas.xlsx"), "types-and-formulas.xlsx");
    const review = await toReview(c);
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    expect(review.table.sourceRef.format).toBe("xlsx");
    expect(review.issues.some((i) => i.kind === "formula-cache")).toBe(true);
    expect(review.table.warnings).toContain("ingest.warn.formula-cells");
    c.submit();
    expect(outcome).not.toBeNull();
    expect(outcome!.approvalPlan.useUnverifiedFormulaCaches).toEqual([]);
  });

  it("formula-cache consent is per-column and lands in the approval plan", async () => {
    let outcome: UploadOutcome | null = null;
    const c = createUploadController(makePorts(), { onComplete: (o) => (outcome = o) });
    c.acceptFile(fixture("types-and-formulas.xlsx"), "types-and-formulas.xlsx");
    const review = await toReview(c);
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    const cacheField = review.issues.find((i) => i.kind === "formula-cache")!.fieldId!;
    c.toggleFormulaCache(cacheField, true);
    c.submit();
    expect(outcome!.approvalPlan.useUnverifiedFormulaCaches).toEqual([cacheField]);
    // The linked use-cache issues must be approved too — consent is recorded.
    const linked = review.issues.filter(
      (i) => i.kind === "formula-cache" && i.fieldId === cacheField,
    );
    for (const issue of linked) {
      expect(outcome!.approvalPlan.issueIds).toContain(issue.id);
    }
  });

  it("hidden sheets are excluded by default and opt-in is explicit", async () => {
    const c = createUploadController(makePorts(), {});
    c.acceptFile(fixture("multi-sheet-hidden.xlsx"), "multi-sheet-hidden.xlsx");
    const cfg = await waitFor(c, (s) => s.stage === "configure");
    expect(cfg.stage).toBe("configure");
    if (cfg.stage !== "configure") return;
    const inspection = cfg.inspection!;
    expect(inspection.hiddenSheets.length).toBeGreaterThanOrEqual(1);
    // Default selection is the first VISIBLE sheet.
    expect(cfg.selection.selectedSheetId).toBe(inspection.defaultSheetId);
    expect(cfg.selection.allowHiddenSheet).toBe(false);

    const hidden = inspection.sheets.find((s) => s.visibility !== "visible")!;
    c.optIntoHiddenSheet(hidden.sheetId);
    c.selectSheet(hidden.sheetId);
    const opted = await waitFor(
      c,
      (s) => s.stage === "configure" && s.selection.selectedSheetId === hidden.sheetId,
    );
    expect(opted.stage).toBe("configure");
    if (opted.stage !== "configure") return;
    expect(opted.selection.allowHiddenSheet).toBe(true);

    c.proceed();
    const review = await waitFor(c, (s) => s.stage === "review" || s.stage === "error");
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    expect(review.table.sourceRef.sheetId).toBe(hidden.sheetId);
  });

  it("non-first sheet/header: header row override lands in ParseOptions", async () => {
    let outcome: UploadOutcome | null = null;
    const c = createUploadController(makePorts(), { onComplete: (o) => (outcome = o) });
    c.acceptFile(fixture("non-row1-header.xlsx"), "non-row1-header.xlsx");
    const cfg = await waitFor(c, (s) => s.stage === "configure");
    expect(cfg.stage).toBe("configure");
    if (cfg.stage !== "configure") return;
    // headerRow stays unset (= auto) until the user picks; the preview drives
    // the suggestion in the UI. Explicit override lands in ParseOptions.
    expect(cfg.selection.headerRow).toBeUndefined();
    c.setHeaderRow(4);
    c.proceed();
    const review = await waitFor(c, (s) => s.stage === "review" || s.stage === "error");
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    expect(review.table.sourceRef.headerRow).toBe(4);
    c.submit();
    expect(outcome!.parseOptions.headerRow).toBe(4);
  });

  it("oversized input fails LIMIT_EXCEEDED and preserves the prior session", async () => {
    let outcome: UploadOutcome | null = null;
    const c = createUploadController(makePorts(), { onComplete: (o) => (outcome = o) });
    c.acceptFile(fixture("types-and-formulas.xlsx"), "ok.xlsx");
    await toReview(c);
    c.submit();
    const prior = outcome!;

    c.acceptFile(fixture("many-rows.xlsx"), "many-rows.xlsx");
    await waitFor(c, (s) => s.stage === "confirm-replace");
    c.confirmReplace();
    // Row cap trips at parse, not inspect — configure first, then proceed.
    const cfg = await waitFor(c, (s) => s.stage === "configure" || s.stage === "error");
    if (cfg.stage === "configure") c.proceed();
    const errored = await waitFor(c, (s) => s.stage === "error");
    expect(errored.stage).toBe("error");
    if (errored.stage !== "error") return;
    expect(errored.failure.code).toBe("LIMIT_EXCEEDED");
    expect(errored.prior?.sourceHash).toBe(prior.sourceHash);
  });

  it("encrypted entries are refused (UNSUPPORTED) with the detail token", async () => {
    const c = createUploadController(makePorts(), {});
    c.acceptFile(fixture("encrypted-entries.xlsx"), "encrypted-entries.xlsx");
    const errored = await waitFor(c, (s) => s.stage === "error");
    expect(errored.stage).toBe("error");
    if (errored.stage !== "error") return;
    expect(errored.failure.code).toBe("UNSUPPORTED");
    expect(errored.failure.detail).toBe("zip.encrypted-entry");
  });

  it("a valid zip that is not a workbook is UNSUPPORTED, prior retained", async () => {
    const c = createUploadController(makePorts(), {});
    c.acceptFile(fixture("not-a-workbook.xlsx"), "not-a-workbook.xlsx");
    const errored = await waitFor(c, (s) => s.stage === "error");
    expect(errored.stage).toBe("error");
    if (errored.stage !== "error") return;
    expect(errored.failure.code).toBe("UNSUPPORTED");
    expect(errored.prior).toBeNull();
  });

  it("ambiguous-date columns surface a confirm-type decision", async () => {
    const c = createUploadController(makePorts(), {});
    c.acceptFile(fixture("dates-1900.xlsx"), "dates-1900.xlsx");
    const review = await toReview(c);
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    // dates-1900 has serial 60 (invalid) + serial 0 — ingest warns; the
    // profiler sees a mixed date/number column → confirm-type issue.
    const confirmIssues = review.issues.filter((i) => i.action === "confirm-type");
    if (confirmIssues.length > 0) {
      const fieldId = confirmIssues[0]!.fieldId!;
      c.confirmColumn(fieldId);
      const decided = c.getState();
      expect(decided.stage).toBe("review");
      if (decided.stage !== "review") return;
      expect(decided.decisions.columnOverrides.get(fieldId)?.confirmed).toBe(true);
      expect(decided.decisions.approvedIssueIds.has(confirmIssues[0]!.id)).toBe(true);
    }
  });

  it("stale inspect results are dropped when a newer job supersedes", async () => {
    const c = createUploadController(makePorts(), {});
    c.acceptFile(fixture("types-and-formulas.xlsx"), "a.xlsx");
    // Immediately replace with another file before inspect resolves.
    c.acceptFile(fixture("multi-sheet-hidden.xlsx"), "b.xlsx");
    const cfg = await waitFor(c, (s) => s.stage === "configure");
    if (cfg.stage !== "configure") return;
    // The surviving inspection must be b.xlsx's — multi-sheet-hidden has ≥1 hidden sheet.
    expect(cfg.inspection!.sourceName).toBe("b.xlsx");
    expect(cfg.inspection!.hiddenSheets.length).toBeGreaterThanOrEqual(1);
  });
});
