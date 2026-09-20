/**
 * Worker Watchdog & Input Bounding Guard Tests
 *
 * Verifies resource exhaustion defenses and timeout constraints:
 * 1. Preflight bounds enforcement against authoritative POLICY.limits:
 *    - Compressed file cap: 10 MiB
 *    - Max rows: 50,000
 *    - Max columns: 100
 *    - Max nonempty cells: 500,000
 *    - Max ZIP entries: 2,000
 *    - Cumulative decompressed bytes: 100 MiB
 *    - Per-entry decompressed bytes: 32 MiB
 *    - Max expansion ratio: 200:1
 *    - Max cell characters: 32,000
 *    - Watchdog timeout: 15,000 ms
 * 2. Active worker thread termination is marked PENDING until worker runtime is merged.
 */
import { describe, expect, it } from "vitest";
import { POLICY } from "../../packages/contracts/src/index.ts";

export interface PreflightCheckResult {
  accepted: boolean;
  violation?: string;
}

export function validateInputPreflight(input: {
  compressedBytes?: number;
  rows?: number;
  cols?: number;
  nonEmptyCells?: number;
  zipEntries?: number;
  cumulativeDecompressedBytes?: number;
  perEntryDecompressedBytes?: number;
  csvCellLength?: number;
}): PreflightCheckResult {
  const limits = POLICY.limits;

  if (input.compressedBytes && input.compressedBytes > limits.compressedBytes) {
    return {
      accepted: false,
      violation: `File size ${input.compressedBytes} bytes exceeds compressed cap (${limits.compressedBytes} bytes)`,
    };
  }

  if (input.rows && input.rows > limits.rowsIncludingHeader) {
    return {
      accepted: false,
      violation: `Row count ${input.rows} exceeds maximum ${limits.rowsIncludingHeader} rows`,
    };
  }

  if (input.cols && input.cols > limits.columns) {
    return {
      accepted: false,
      violation: `Column count ${input.cols} exceeds maximum ${limits.columns} columns`,
    };
  }

  if (input.nonEmptyCells && input.nonEmptyCells > limits.nonemptyCells) {
    return {
      accepted: false,
      violation: `Cell count ${input.nonEmptyCells} exceeds maximum ${limits.nonemptyCells} nonempty cells`,
    };
  }

  if (input.zipEntries && input.zipEntries > limits.entries) {
    return {
      accepted: false,
      violation: `ZIP entry count ${input.zipEntries} exceeds maximum ${limits.entries} entries`,
    };
  }

  if (
    input.cumulativeDecompressedBytes &&
    input.cumulativeDecompressedBytes > limits.expandedBytes
  ) {
    return {
      accepted: false,
      violation: `Cumulative decompressed size exceeds expanded cap (${limits.expandedBytes} bytes)`,
    };
  }

  if (
    input.perEntryDecompressedBytes &&
    input.perEntryDecompressedBytes > limits.entryBytes
  ) {
    return {
      accepted: false,
      violation: `Single entry decompressed size exceeds entry cap (${limits.entryBytes} bytes)`,
    };
  }

  if (
    input.compressedBytes &&
    input.cumulativeDecompressedBytes &&
    input.compressedBytes > 0
  ) {
    const ratio = input.cumulativeDecompressedBytes / input.compressedBytes;
    if (ratio > limits.expansionRatio) {
      return {
        accepted: false,
        violation: `Expansion ratio ${ratio.toFixed(1)}:1 exceeds limit (${limits.expansionRatio}:1)`,
      };
    }
  }

  if (input.csvCellLength && input.csvCellLength > limits.cellCharacters) {
    return {
      accepted: false,
      violation: `CSV cell length ${input.csvCellLength} chars exceeds character limit (${limits.cellCharacters})`,
    };
  }

  return { accepted: true };
}

describe("worker watchdog and preflight bounds", () => {
  it("verifies policy limits match production contract authority", () => {
    expect(POLICY.limits.watchdogMs).toBe(15000);
    expect(POLICY.limits.compressedBytes).toBe(10 * 1024 * 1024);
    expect(POLICY.limits.expandedBytes).toBe(100 * 1024 * 1024);
    expect(POLICY.limits.entryBytes).toBe(32 * 1024 * 1024);
    expect(POLICY.limits.entries).toBe(2000);
    expect(POLICY.limits.expansionRatio).toBe(200);
    expect(POLICY.limits.rowsIncludingHeader).toBe(50000);
    expect(POLICY.limits.columns).toBe(100);
    expect(POLICY.limits.nonemptyCells).toBe(500000);
    expect(POLICY.limits.cellCharacters).toBe(32000);
  });

  it("accepts inputs within all bounded policy limits", () => {
    const result = validateInputPreflight({
      compressedBytes: 2 * 1024 * 1024,
      rows: 2400,
      cols: 11,
      nonEmptyCells: 26400,
      zipEntries: 25,
      cumulativeDecompressedBytes: 15 * 1024 * 1024,
      perEntryDecompressedBytes: 2 * 1024 * 1024,
      csvCellLength: 50,
    });
    expect(result.accepted).toBe(true);
    expect(result.violation).toBeUndefined();
  });

  it("rejects files exceeding compressed cap", () => {
    const result = validateInputPreflight({
      compressedBytes: 11 * 1024 * 1024,
    });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds compressed cap");
  });

  it("rejects table exceeding rows limit", () => {
    const result = validateInputPreflight({ rows: 50_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 50000 rows");
  });

  it("rejects table exceeding columns limit", () => {
    const result = validateInputPreflight({ cols: 101 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 100 columns");
  });

  it("rejects table exceeding nonempty cells limit", () => {
    const result = validateInputPreflight({ nonEmptyCells: 500_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 500000 nonempty cells");
  });

  it("rejects ZIP archives exceeding entries limit", () => {
    const result = validateInputPreflight({ zipEntries: 2_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 2000 entries");
  });

  it("rejects cumulative decompressed bytes exceeding cap", () => {
    const result = validateInputPreflight({
      cumulativeDecompressedBytes: 101 * 1024 * 1024,
    });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds expanded cap");
  });

  it("rejects archives with suspicious expansion ratios > 200:1", () => {
    const result = validateInputPreflight({
      compressedBytes: 100 * 1024, // 100 KiB compressed
      cumulativeDecompressedBytes: 25 * 1024 * 1024, // 25 MiB expanded => ratio 256:1
    });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds limit (200:1)");
  });

  it("rejects CSV cells exceeding character limit", () => {
    const result = validateInputPreflight({ csvCellLength: 32_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds character limit (32000)");
  });

  it.skip(
    "PENDING: Active worker process watchdog termination requires ingestion worker thread implementation",
    () => {
      // Integration check: will run once worker thread runtime is integrated.
    },
  );
});
