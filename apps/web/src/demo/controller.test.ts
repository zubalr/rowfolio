/**
 * Unit tests for the guided-demo state machine — injected clock and host,
 * no DOM. Covers the storyboard rules: opt-in start, dwell-ordered
 * auto-advance, manual-interaction pause, visibility pause without
 * auto-resume, Back/Next override, Escape-style exit preserving host state,
 * replay reset semantics and the readiness watchdog.
 */
import { describe, expect, it } from "vitest";
import {
  DemoController,
  GUIDE_STEPS,
  type DemoActionKind,
  type DemoHost,
  type DemoReadiness,
  type GuideState,
} from "./controller.ts";

class FakeScheduler {
  private timers: { fn: () => void; ms: number }[] = [];
  setTimeout = (fn: () => void, ms: number) => {
    const handle = { fn, ms };
    this.timers.push(handle);
    return handle;
  };
  clearTimeout = (handle: unknown) => {
    this.timers = this.timers.filter((t) => t !== handle);
  };
  /** Fire every armed timer (dwell steps). */
  flush() {
    const pending = this.timers;
    this.timers = [];
    for (const t of pending) t.fn();
  }
  get armed() {
    return this.timers.length;
  }
}

class FakeHost implements DemoHost {
  actions: DemoActionKind[] = [];
  ready: Record<DemoReadiness, boolean> = {
    stage: true,
    findings: true,
    evidence: true,
    scenario: true,
    briefing: true,
  };
  /** When set, waitReady hangs until released — watchdog test hook. */
  held: DemoReadiness | null = null;
  focused = 0;

  async perform(action: DemoActionKind) {
    this.actions.push(action);
  }
  waitReady(signal: DemoReadiness, timeoutMs: number): Promise<boolean> {
    void timeoutMs;
    if (this.held === signal) return new Promise(() => {});
    return Promise.resolve(this.ready[signal]);
  }
  focusResults() {
    this.focused += 1;
  }
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function settle() {
  await tick();
  await tick();
}

function make(overrides?: {
  reducedMotion?: boolean;
  stepTimeoutMs?: number;
  host?: FakeHost;
}) {
  const scheduler = new FakeScheduler();
  const host = overrides?.host ?? new FakeHost();
  const controller = new DemoController({
    host,
    scheduler,
    prefersReducedMotion: () => overrides?.reducedMotion ?? false,
    stepTimeoutMs: overrides?.stepTimeoutMs,
  });
  const seen: GuideState[] = [];
  controller.subscribe((s) => seen.push(s));
  return { scheduler, host, controller, seen };
}

describe("DemoController", () => {
  it("stays idle until explicitly started (opt-in only)", () => {
    const { controller, host } = make();
    expect(controller.getState().status).toBe("idle");
    expect(host.actions).toEqual([]);
  });

  it("walks steps in order, dispatching the semantic action per step", async () => {
    const { controller, host, scheduler } = make();
    controller.start();
    await settle();
    expect(controller.getState().stepIndex).toBe(0);
    expect(host.actions).toEqual(["focus-stage"]);

    scheduler.flush(); // intro dwell → findings
    await settle();
    expect(controller.getState().stepIndex).toBe(1);
    expect(host.actions).toEqual(["focus-stage", "reveal-findings"]);
  });

  it("completes after the final step and stops scheduling", async () => {
    const { controller, scheduler } = make();
    controller.start();
    await settle();
    for (let i = 0; i < GUIDE_STEPS.length; i += 1) {
      scheduler.flush();
      await settle();
    }
    expect(controller.getState().status).toBe("complete");
    expect(scheduler.armed).toBe(0);
  });

  it("never auto-advances under reduced motion — explicit Next steps", async () => {
    const { controller, scheduler } = make({ reducedMotion: true });
    controller.start();
    await settle();
    expect(controller.getState().autoAdvance).toBe(false);
    scheduler.flush();
    await settle();
    expect(controller.getState().stepIndex).toBe(0); // dwell did not advance
    controller.next();
    await settle();
    expect(controller.getState().stepIndex).toBe(1);
  });

  it("pauses on manual interaction and resumes only via resume()", async () => {
    const { controller, scheduler } = make();
    controller.start();
    await settle();
    controller.notifyInteraction();
    expect(controller.getState().status).toBe("paused");
    scheduler.flush();
    await settle();
    expect(controller.getState().stepIndex).toBe(0); // no advance while paused
    controller.resume();
    await settle();
    scheduler.flush();
    await settle();
    expect(controller.getState().stepIndex).toBe(1);
  });

  it("pauses when the tab hides and does not auto-resume on visible", async () => {
    const { controller, scheduler } = make();
    controller.start();
    await settle();
    controller.notifyVisibility(false);
    expect(controller.getState().status).toBe("paused");
    controller.notifyVisibility(true);
    expect(controller.getState().status).toBe("paused");
    expect(scheduler.armed).toBe(0);
  });

  it("Back/Next override immediately, including while paused", async () => {
    const { controller, host } = make();
    controller.start();
    await settle();
    controller.next();
    await settle();
    expect(controller.getState().stepIndex).toBe(1);
    controller.pause();
    controller.next();
    await settle();
    expect(controller.getState().stepIndex).toBe(2);
    expect(controller.getState().status).toBe("paused");
    controller.back();
    await settle();
    expect(controller.getState().stepIndex).toBe(1);
    expect(host.actions).toEqual([
      "focus-stage",
      "reveal-findings",
      "open-evidence",
      "reveal-findings",
    ]);
  });

  it("exit preserves host results (no reset dispatched)", async () => {
    const { controller, host } = make();
    controller.start();
    await settle();
    controller.next();
    await settle();
    controller.exit();
    expect(controller.getState().status).toBe("idle");
    expect(host.actions).not.toContain("reset");
  });

  it("replay dispatches reset, returns to idle and focuses results", async () => {
    const { controller, host } = make();
    controller.start();
    await settle();
    await controller.replay();
    expect(controller.getState().status).toBe("idle");
    expect(host.actions.at(-1)).toBe("reset");
    expect(host.focused).toBe(1);
  });

  it("surfaces a typed timeout when readiness never arrives", async () => {
    const host = new FakeHost();
    host.waitReady = () => Promise.resolve(false); // watchdog fired inside host
    const { controller } = make({ host });
    controller.start();
    await settle();
    expect(controller.getState().status).toBe("error");
    expect(controller.getState().errorCode).toBe("step-timeout");
  });

  it("ignores stale readiness resolutions after exit", async () => {
    const host = new FakeHost();
    const releases: ((v: boolean) => void)[] = [];
    host.waitReady = () =>
      new Promise<boolean>((resolve) => {
        releases.push(resolve);
      });
    const { controller } = make({ host });
    controller.start();
    await settle();
    controller.exit();
    for (const release of releases) release(true); // late resolution must not resurrect the guide
    await settle();
    expect(controller.getState().status).toBe("idle");
  });
});
