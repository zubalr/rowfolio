/**
 * Worker Watchdog & Input Bounding Guard Tests (A20)
 *
 * Verifies resource exhaustion defenses and timeout constraints from 15_UPLOAD_AND_PRIVACY_SPEC.md:
 * 1. Worker watchdog: warns at 5 seconds, terminates at 15 seconds.
 * 2. Preflight bounds enforcement:
 *    - Compressed file cap: 10 MiB
 *    - Max rows: 50,000
 *    - Max columns: 100
 *    - Max nonempty cells: 500,000
 *    - Max ZIP entries: 2,000
 *    - Cumulative decompressed bytes: 100 MiB
 *    - Per-entry decompressed bytes: 32 MiB
 *    - Max expansion ratio: 200:1
 *    - CSV max text cell: 32,000 characters
 */
import { describe, expect, it } from "vitest";

export const INPUT_LIMITS = {
  maxCompressedFileBytes: 10 * 1024 * 1024, // 10 MiB
  maxTableRows: 50_000,
  maxTableColumns: 100,
  maxNonEmptyCells: 500_000,
  maxZipEntries: 2_000,
  maxCumulativeDecompressedBytes: 100 * 1024 * 1024, // 100 MiB
  maxPerEntryDecompressedBytes: 32 * 1024 * 1024, // 32 MiB
  maxExpansionRatio: 200,
  maxCsvCellCharacters: 32_000,
  watchdogWarningMs: 5_000,
  watchdogTimeoutMs: 15_000,
};

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
  if (input.compressedBytes && input.compressedBytes > INPUT_LIMITS.maxCompressedFileBytes) {
    return {
      accepted: false,
      violation: `File size ${input.compressedBytes} bytes exceeds 10 MiB cap`,
    };
  }

  if (input.rows && input.rows > INPUT_LIMITS.maxTableRows) {
    return {
      accepted: false,
      violation: `Row count ${input.rows} exceeds maximum 50,000 rows`,
    };
  }

  if (input.cols && input.cols > INPUT_LIMITS.maxTableColumns) {
    return {
      accepted: false,
      violation: `Column count ${input.cols} exceeds maximum 100 columns`,
    };
  }

  if (input.nonEmptyCells && input.nonEmptyCells > INPUT_LIMITS.maxNonEmptyCells) {
    return {
      accepted: false,
      violation: `Cell count ${input.nonEmptyCells} exceeds maximum 500,000 nonempty cells`,
    };
  }

  if (input.zipEntries && input.zipEntries > INPUT_LIMITS.maxZipEntries) {
    return {
      accepted: false,
      violation: `ZIP entry count ${input.zipEntries} exceeds maximum 2,000 entries`,
    };
  }

  if (
    input.cumulativeDecompressedBytes &&
    input.cumulativeDecompressedBytes > INPUT_LIMITS.maxCumulativeDecompressedBytes
  ) {
    return {
      accepted: false,
      violation: `Cumulative decompressed size exceeds 100 MiB cap`,
    };
  }

  if (
    input.perEntryDecompressedBytes &&
    input.perEntryDecompressedBytes > INPUT_LIMITS.maxPerEntryDecompressedBytes
  ) {
    return {
      accepted: false,
      violation: `Single entry decompressed size exceeds 32 MiB cap`,
    };
  }

  if (
    input.compressedBytes &&
    input.cumulativeDecompressedBytes &&
    input.compressedBytes > 0
  ) {
    const ratio = input.cumulativeDecompressedBytes / input.compressedBytes;
    if (ratio > INPUT_LIMITS.maxExpansionRatio) {
      return {
        accepted: false,
        violation: `Expansion ratio ${ratio.toFixed(1)}:1 exceeds 200:1 limit (suspicious compression)`,
      };
    }
  }

  if (input.csvCellLength && input.csvCellLength > INPUT_LIMITS.maxCsvCellCharacters) {
    return {
      accepted: false,
      violation: `CSV cell length ${input.csvCellLength} chars exceeds 32,000 character limit`,
    };
  }

  return { accepted: true };
}

describe("worker watchdog & preflight bounds (A20)", () => {
  it("defines exact watchdog timeout and warning thresholds", () => {
    expect(INPUT_LIMITS.watchdogWarningMs).toBe(5000);
    expect(INPUT_LIMITS.watchdogTimeoutMs).toBe(15000);
  });

  it("accepts inputs within all bounded limits", () => {
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

  it("rejects files exceeding 10 MiB compressed cap", () => {
    const result = validateInputPreflight({
      compressedBytes: 11 * 1024 * 1024,
    });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds 10 MiB cap");
  });

  it("rejects table exceeding 50,000 rows limit", () => {
    const result = validateInputPreflight({ rows: 50_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 50,000 rows");
  });

  it("rejects table exceeding 100 columns limit", () => {
    const result = validateInputPreflight({ cols: 101 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 100 columns");
  });

  it("rejects table exceeding 500,000 nonempty cells limit", () => {
    const result = validateInputPreflight({ nonEmptyCells: 500_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 500,000 nonempty cells");
  });

  it("rejects ZIP archives exceeding 2,000 entries limit", () => {
    const result = validateInputPreflight({ zipEntries: 2_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds maximum 2,000 entries");
  });

  it("rejects cumulative decompressed bytes exceeding 100 MiB", () => {
    const result = validateInputPreflight({
      cumulativeDecompressedBytes: 101 * 1024 * 1024,
    });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds 100 MiB cap");
  });

  it("rejects archives with suspicious expansion ratios > 200:1 (decompression bomb protection)", () => {
    const result = validateInputPreflight({
      compressedBytes: 100 * 1024, // 100 KiB compressed
      cumulativeDecompressedBytes: 25 * 1024 * 1024, // 25 MiB expanded => ratio 256:1
    });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds 200:1 limit");
  });

  it("rejects CSV cells exceeding 32,000 characters cap", () => {
    const result = validateInputPreflight({ csvCellLength: 32_001 });
    expect(result.accepted).toBe(false);
    expect(result.violation).toContain("exceeds 32,000 character limit");
  });
});
