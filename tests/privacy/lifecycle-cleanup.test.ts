/**
 * Session Lifecycle & Worker Transport Cleanup Tests
 *
 * Verifies production contracts for worker communication and session lifecycle:
 * 1. Worker transport envelope validation (checkWorkerEnvelope, packEnvelope).
 * 2. Binary isolation: binary buffers never ride inside JSON messages (zero base64/ArrayBuffer serialization).
 * 3. Stale worker response classification (classifyWorkerResponse).
 * 4. Live browser Object URL revocation is marked PENDING until UI is integrated.
 */
import { describe, expect, it } from "vitest";
import {
  checkWorkerEnvelope,
  packEnvelope,
  classifyWorkerResponse,
  PROTOCOL_VERSION,
} from "../../packages/contracts/src/index.ts";
import type { WorkerRequest } from "../../packages/contracts/src/index.ts";

describe("session lifecycle and worker transport contracts", () => {
  it("validates compliant worker request envelope with detached binary slot", () => {
    const rawBuffer = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer; // PK zip header
    const request: WorkerRequest = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "req-001",
      sessionId: "sess-001",
      revision: 1,
      operation: "ingest",
      payload: {
        sourceName: "sample_operations.xlsx",
        format: "xlsx",
        byteLength: rawBuffer.byteLength,
        binarySlot: "source",
      },
    };

    const { envelope, transfer } = packEnvelope(request, [{ slot: "source", buffer: rawBuffer }]);
    const issues = checkWorkerEnvelope(envelope);

    expect(issues).toEqual([]);
    expect(envelope.binaries.length).toBe(1);
    expect(envelope.binaries[0]?.slot).toBe("source");
    expect(transfer.length).toBe(1);
  });

  it("rejects worker envelope when binary data is missing from transferable slots", () => {
    const malformedEnvelope = {
      message: {
        protocolVersion: PROTOCOL_VERSION,
        requestId: "req-002",
        sessionId: "sess-001",
        revision: 1,
        operation: "ingest",
        payload: {
          sourceName: "sample_operations.xlsx",
          format: "xlsx",
          byteLength: 4,
          binarySlot: "source",
        },
      },
      binaries: "invalid-binaries-not-array",
    };

    const issues = checkWorkerEnvelope(malformedEnvelope as unknown as Parameters<typeof checkWorkerEnvelope>[0]);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.rule === "envelope.binaries")).toBe(true);
  });

  it("detects and flags stale worker responses across session revisions", () => {
    const staleResponse = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: "req-stale",
      sessionId: "sess-001",
      revision: 1, // Stale revision
      kind: "progress" as const,
      stage: "parse" as const,
      fraction: 0.5,
    };

    const expectedContext = {
      requestId: "req-stale",
      sessionId: "sess-001",
      revision: 2, // Active revision advanced
    };

    const freshness = classifyWorkerResponse(staleResponse, expectedContext);
    expect(freshness).toBe("stale");
  });

  it.skip(
    "PENDING: Live browser Object URL revocation and worker pool teardown requires application UI integration",
    () => {
      // Integration check: will run in Playwright once application app shell is integrated.
    },
  );
});
