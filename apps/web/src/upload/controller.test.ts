/**
 * Controller state-machine tests, driven end to end through the REAL ingest
 * ports (inspectSource/parseSource on in-memory CSV bytes). The only injected
 * collaborator is the contract `ProfileTable` — packages/normalize is not yet
 * merged, so tests supply a deterministic profiler; production wiring is the
 * same port signature.
 */
import { describe, expect, it } from "vitest";
import type { Column, QualityIssue, RawTable } from "@rowfolio/contracts";
import { createUploadController } from "./controller.ts";
import type { UploadOutcome, UploadPorts, UploadState } from "./types.ts";
import { ingestPorts } from "./adapters.ts";

function csvBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/** Minimal deterministic profiler for tests: propose a column per source
 * column, type by the dominant physical cell type; flag duplicates. */
function testProfile(raw: RawTable): { proposedColumns: Column[]; issues: QualityIssue[] } {
  const { headerRow, range } = raw.sourceRef;
  const proposedColumns: Column[] = [];
  for (let c = range.firstColumn; c <= range.lastColumn; c++) {
    const header = raw.cells.find((cell) => cell.row === headerRow && cell.column === c);
    const body = raw.cells.filter(
      (cell) => cell.row > headerRow && cell.column === c && cell.type !== "blank",
    );
    const counts = new Map<string, number>();
    for (const cell of body) counts.set(cell.type, (counts.get(cell.type) ?? 0) + 1);
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const type: Column["type"] =
      dominant === "number" ? "decimal" : dominant === "date" ? "date" : dominant === "boolean" ? "boolean" : "text";
    proposedColumns.push({
      id: `f${c}`,
      sourceColumn: c,
      label:
        header === undefined || header.raw === null
          ? `C${c}`
          : typeof header.raw === "boolean"
            ? header.raw
              ? "true"
              : "false"
            : header.raw,
      type,
      role: type === "date" ? "date" : type === "decimal" ? "measure" : "dimension",
      unit: { kind: "unknown", label: "", currency: null },
      additive: type === "decimal",
      confirmed: false,
      nullable: body.length < range.lastRow - headerRow,
    });
  }
  const issues: QualityIssue[] = [];
  const seen = new Map<string, number>();
  for (let r = headerRow + 1; r <= range.lastRow; r++) {
    const key = raw.cells
      .filter((cell) => cell.row === r)
      .map((cell) => cell.raw)
      .join("");
    const prior = seen.get(key);
    if (prior !== undefined) {
      issues.push({
        id: `dup-${r}`,
        kind: "duplicate",
        sourceRefId: raw.id,
        sourceRow: r,
        fieldId: null,
        original: key,
        normalized: null,
        status: "proposed",
        action: "exclude-row",
        approval: "none",
        canonicalSourceRow: prior,
        messageKey: "quality.duplicate",
      });
    } else {
      seen.set(key, r);
    }
  }
  return { proposedColumns, issues };
}

function makePorts(): UploadPorts {
  return { ...ingestPorts(), profile: testProfile };
}

const CSV = "city,sales\nRiyadh,10\nJeddah,20\n";

/** Poll the controller until the predicate holds or the timeout elapses. */
async function waitFor(
  controller: ReturnType<typeof createUploadController>,
  predicate: (s: UploadState) => boolean,
  timeoutMs = 2_000,
): Promise<UploadState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = controller.getState();
    if (predicate(s)) return s;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return controller.getState();
}

/** Bytes that can never be a supported source: PK zip magic with no valid
 * archive behind it → INVALID_FILE at zip preflight. */
const BAD_ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xde, 0xad]).buffer;

async function driveToReview(
  controller: ReturnType<typeof createUploadController>,
  csv = CSV,
): Promise<UploadState> {
  controller.acceptFile(csvBytes(csv), "t.csv");
  await waitFor(controller, (s) => s.stage === "configure" || s.stage === "error");
  controller.proceed();
  return waitFor(controller, (s) => s.stage === "review" || s.stage === "error");
}

describe("upload controller", () => {
  it("CSV happy path: idle → configure → review → committed outcome", async () => {
    let outcome: UploadOutcome | null = null;
    const controller = createUploadController(makePorts(), {
      onComplete: (o) => {
        outcome = o;
      },
    });
    const review = await driveToReview(controller);
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    expect(review.table.sourceRef.format).toBe("csv");
    expect(review.proposedColumns.map((c) => c.label)).toEqual(["city", "sales"]);

    controller.submit();
    expect(controller.getState().stage).toBe("idle");
    expect(outcome).not.toBeNull();
    expect(outcome!.table.sourceRef.workbookName).toBe("t.csv");
    expect(outcome!.approvalPlan.columns.length).toBe(2);
    expect(outcome!.approvalPlan.issueIds).toEqual([]);
    // Deterministic provenance: same bytes → same source hash.
    expect(outcome!.sourceHash).toBe(outcome!.inspection.sourceHash);
    expect(outcome!.sourceHash.length).toBe(64);
  });

  it("duplicate issues ride the approval plan only when checked", async () => {
    let outcome: UploadOutcome | null = null;
    const controller = createUploadController(makePorts(), {
      onComplete: (o) => {
        outcome = o;
      },
    });
    const dupCsv = "a,b\nx,1\nx,1\n";
    const review = await driveToReview(controller, dupCsv);
    expect(review.stage).toBe("review");
    if (review.stage !== "review") return;
    expect(review.issues.filter((i) => i.kind === "duplicate")).toHaveLength(1);
    const dup = review.issues[0]!;

    controller.submit();
    expect(outcome!.approvalPlan.issueIds).toEqual([]); // unchecked → not approved

    // Round two: check it, then submit.
    controller.acceptFile(csvBytes(dupCsv), "t2.csv");
    await waitFor(controller, (s) => s.stage === "confirm-replace");
    controller.confirmReplace();
    await waitFor(controller, (s) => s.stage === "configure");
    controller.proceed();
    await waitFor(controller, (s) => s.stage === "review");
    controller.toggleIssue(dup.id, true);
    controller.submit();
    expect(outcome!.approvalPlan.issueIds).toContain(dup.id);
  });

  it("invalid input lands in error and preserves a prior valid session", async () => {
    let outcome: UploadOutcome | null = null;
    const controller = createUploadController(makePorts(), {
      onComplete: (o) => {
        outcome = o;
      },
    });
    await driveToReview(controller);
    controller.submit();
    const prior = outcome!;

    controller.acceptFile(BAD_ZIP, "junk.xlsx");
    await waitFor(controller, (s) => s.stage === "confirm-replace");
    controller.confirmReplace();
    const errored = await waitFor(controller, (s) => s.stage === "error");
    expect(errored.stage).toBe("error");
    if (errored.stage !== "error") return;
    expect(errored.failure.code).toBe("INVALID_FILE");
    expect(errored.prior?.sourceHash).toBe(prior.sourceHash);

    controller.cancel();
    const idle = controller.getState();
    expect(idle.stage).toBe("idle");
    expect(idle.prior?.sourceHash).toBe(prior.sourceHash);
  });

  it("a new file while a session is live requires explicit replace consent", async () => {
    let outcome: UploadOutcome | null = null;
    const controller = createUploadController(makePorts(), {
      onComplete: (o) => {
        outcome = o;
      },
    });
    await driveToReview(controller);
    controller.submit();

    controller.acceptFile(csvBytes("q\n1\n"), "next.csv");
    expect(controller.getState().stage).toBe("confirm-replace");

    controller.declineReplace();
    const idle = controller.getState();
    expect(idle.stage).toBe("idle");
    expect(idle.prior?.sourceHash).toBe(outcome!.sourceHash);

    controller.acceptFile(csvBytes("q\n1\n"), "next.csv");
    expect(controller.getState().stage).toBe("confirm-replace");
    controller.confirmReplace();
    await waitFor(controller, (s) => s.stage === "configure");
    expect(controller.getState().stage).toBe("configure");
  });

  it("ambiguous CSV asks for a delimiter instead of guessing", async () => {
    const controller = createUploadController(makePorts(), {});
    // comma and semicolon are both uniform → ingest throws AMBIGUOUS_INPUT.
    controller.acceptFile(csvBytes("a,b;c\n1,2;3\n"), "amb.csv");
    const state = await waitFor(controller, (s) => s.stage === "configure" || s.stage === "error");
    expect(state.stage).toBe("configure");
    if (state.stage !== "configure") return;
    expect(state.needsDelimiter).toBe(true);
    expect(state.inspection).toBeNull();

    controller.chooseDelimiter(";");
    const ready = await waitFor(
      controller,
      (s) => s.stage === "configure" && !s.needsDelimiter || s.stage === "error",
    );
    expect(ready.stage).toBe("configure");
    if (ready.stage !== "configure") return;
    expect(ready.needsDelimiter).toBe(false);
    expect(ready.inspection).not.toBeNull();
  });

  it("cancel during inspect returns to idle without touching prior", async () => {
    let outcome: UploadOutcome | null = null;
    const controller = createUploadController(makePorts(), {
      onComplete: (o) => {
        outcome = o;
      },
    });
    await driveToReview(controller);
    controller.submit();

    controller.acceptFile(csvBytes("x\n1\n"), "n.csv");
    expect(controller.getState().stage).toBe("confirm-replace");
    controller.confirmReplace();
    controller.cancel(); // abort mid-inspect
    const idle = await waitFor(controller, (s) => s.stage === "idle");
    expect(idle.stage).toBe("idle");
    expect(idle.prior?.sourceHash).toBe(outcome!.sourceHash);
  });

  it("retry re-runs the failed inspect step", async () => {
    const controller = createUploadController(makePorts(), {});
    controller.acceptFile(BAD_ZIP, "bad.xlsx");
    const first = await waitFor(controller, (s) => s.stage === "error");
    expect(first.stage).toBe("error");
    controller.retry();
    const again = await waitFor(controller, (s) => s.stage === "error");
    expect(again.stage).toBe("error"); // same bytes — honest error, no fake pass
    controller.cancel();
    expect(controller.getState().stage).toBe("idle");
  });
});
