import { describe, expect, it } from "vitest";
import {
  setWorkspaceIntent,
  takeWorkspaceIntent,
  type WorkspaceIntent,
} from "./pendingUpload.ts";

describe("workspace intent handoff", () => {
  it("carries the requested download format on the sample intent", () => {
    const intent: WorkspaceIntent = { kind: "sample", download: "pptx" };
    setWorkspaceIntent(intent);
    expect(takeWorkspaceIntent()).toEqual({ kind: "sample", download: "pptx" });
  });

  it("is consumed once", () => {
    setWorkspaceIntent({ kind: "sample", download: "xlsx" });
    takeWorkspaceIntent();
    expect(takeWorkspaceIntent()).toBeNull();
  });

  it("keeps download optional — plain sample intents still resolve", () => {
    setWorkspaceIntent({ kind: "sample" });
    const intent = takeWorkspaceIntent();
    expect(intent?.kind).toBe("sample");
    if (intent?.kind === "sample") {
      expect(intent.download).toBeUndefined();
    }
  });
});
