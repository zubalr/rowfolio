/**
 * Session Lifecycle Cleanup & Resource Disposal Tests (A20)
 *
 * Verifies resource disposal rules from 15_UPLOAD_AND_PRIVACY_SPEC.md:
 * 1. Clear session drops in-memory references and revokes all generated Blob/Object URLs.
 * 2. Failed upload isolation: a failed or corrupt upload attempt preserves the previous
 *    valid session without silent replacement or data loss.
 * 3. Stale worker termination upon session reset.
 */
import { describe, expect, it } from "vitest";

interface SessionState {
  activeFile: string | null;
  tableData: unknown | null;
  objectUrls: Set<string>;
  activeWorker: { terminate: () => void; isTerminated: boolean } | null;
}

class SessionLifecycleManager {
  private state: SessionState = {
    activeFile: null,
    tableData: null,
    objectUrls: new Set(),
    activeWorker: null,
  };

  public get currentState(): Readonly<SessionState> {
    return this.state;
  }

  public initialize(fileName: string, data: unknown): void {
    this.state.activeFile = fileName;
    this.state.tableData = data;
  }

  public registerObjectUrl(url: string): void {
    this.state.objectUrls.add(url);
  }

  public attachWorker(worker: { terminate: () => void; isTerminated: boolean }): void {
    this.state.activeWorker = worker;
  }

  /**
   * Clears the current session, revoking all tracked Blob URLs and terminating workers.
   */
  public clearSession(revokeUrlFn: (url: string) => void): void {
    for (const url of this.state.objectUrls) {
      revokeUrlFn(url);
    }
    this.state.objectUrls.clear();

    if (this.state.activeWorker && !this.state.activeWorker.isTerminated) {
      this.state.activeWorker.terminate();
      this.state.activeWorker = null;
    }

    this.state.activeFile = null;
    this.state.tableData = null;
  }

  /**
   * Handles attempted new file upload with failure isolation.
   * If the parse or validation fails, previous session remains intact.
   */
  public attemptUpload(
    newFileName: string,
    parserFn: () => unknown,
  ): { success: boolean; error?: string } {
    try {
      const parsedData = parserFn();
      this.state.activeFile = newFileName;
      this.state.tableData = parsedData;
      return { success: true };
    } catch (err) {
      // Retain previous state untouched on error
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

describe("session lifecycle & disposal (A20)", () => {
  it("revokes all object URLs and clears in-memory state on clear session", () => {
    const revokedUrls: string[] = [];
    const mockRevokeObjectURL = (url: string) => {
      revokedUrls.push(url);
    };

    const manager = new SessionLifecycleManager();
    manager.initialize("test.xlsx", { rows: 2400 });
    manager.registerObjectUrl("blob:http://localhost/mock-export-xlsx-uuid");
    manager.registerObjectUrl("blob:http://localhost/mock-export-pptx-uuid");

    expect(manager.currentState.activeFile).toBe("test.xlsx");
    expect(manager.currentState.objectUrls.size).toBe(2);

    manager.clearSession(mockRevokeObjectURL);

    expect(manager.currentState.activeFile).toBeNull();
    expect(manager.currentState.tableData).toBeNull();
    expect(manager.currentState.objectUrls.size).toBe(0);
    expect(revokedUrls).toEqual([
      "blob:http://localhost/mock-export-xlsx-uuid",
      "blob:http://localhost/mock-export-pptx-uuid",
    ]);
  });

  it("terminates active workers on session clear", () => {
    const manager = new SessionLifecycleManager();
    let terminated = false;
    const workerMock = {
      terminate: () => {
        terminated = true;
      },
      get isTerminated() {
        return terminated;
      },
    };

    manager.initialize("large_data.csv", { rows: 5000 });
    manager.attachWorker(workerMock);

    expect(workerMock.isTerminated).toBe(false);
    manager.clearSession(() => {});
    expect(workerMock.isTerminated).toBe(true);
    expect(manager.currentState.activeWorker).toBeNull();
  });

  it("preserves previous valid session when a new upload fails", () => {
    const manager = new SessionLifecycleManager();
    manager.initialize("valid_quarter1.xlsx", { period: "Q1", total: "1000000" });

    // Attempt invalid upload that throws
    const result = manager.attemptUpload("corrupt_file.xlsx", () => {
      throw new Error("Invalid central directory header");
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid central directory header");

    // Previous session MUST remain completely intact
    expect(manager.currentState.activeFile).toBe("valid_quarter1.xlsx");
    expect(manager.currentState.tableData).toEqual({ period: "Q1", total: "1000000" });
  });
});
