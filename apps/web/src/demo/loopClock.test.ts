import { describe, expect, it } from "vitest";
import { LoopClock, type LoopFrameSource } from "./loopClock.ts";

/** Manual frame pump: each `advance(ms)` fires the armed frame once. */
function fakeFrame() {
  let pending: ((now: number) => void) | null = null;
  let now = 0;
  const frame: LoopFrameSource = {
    schedule(cb) {
      pending = cb;
      return cb;
    },
    cancel() {
      pending = null;
    },
  };
  return {
    frame,
    now: () => now,
    /** Run `ms` of frames at ~60fps, emitting clock time forward. */
    advance(ms: number) {
      const steps = Math.ceil(ms / 16);
      for (let i = 0; i < steps; i += 1) {
        const cb = pending;
        pending = null;
        if (cb === null) return;
        now += 16;
        cb(now);
      }
    },
    pendingCount: () => (pending === null ? 0 : 1),
  };
}

function clock(opts: { loopMs?: number; reduced?: () => boolean } = {}) {
  const f = fakeFrame();
  const c = new LoopClock({
    loopMs: opts.loopMs ?? 12000,
    frame: f.frame,
    now: f.now,
    prefersReducedMotion: opts.reduced ?? (() => false),
  });
  return { c, f };
}

describe("LoopClock", () => {
  it("starts idle, then plays from t=0 on start()", () => {
    const { c, f } = clock();
    expect(c.getState().status).toBe("idle");
    c.start();
    expect(c.getState().status).toBe("playing");
    f.advance(500);
    expect(c.getState().t).toBeGreaterThan(400);
    expect(f.pendingCount()).toBe(1);
  });

  it("wraps at loopMs so the loop never holds dead frames", () => {
    const { c, f } = clock({ loopMs: 200 });
    c.start();
    f.advance(500);
    expect(c.getState().t).toBeLessThan(200);
    expect(c.getState().status).toBe("playing");
  });

  it("pause freezes the timeline; resume continues from the same t", () => {
    const { c, f } = clock();
    c.start();
    f.advance(400);
    const t = c.getState().t;
    c.pause();
    expect(c.getState().status).toBe("paused");
    expect(f.pendingCount()).toBe(0);
    c.resume();
    f.advance(400);
    expect(c.getState().t).toBeGreaterThan(t);
  });

  it("toggle flips play state for click/Space/tap", () => {
    const { c } = clock();
    c.start();
    c.toggle();
    expect(c.getState().status).toBe("paused");
    c.toggle();
    expect(c.getState().status).toBe("playing");
  });

  it("seek jumps the timeline and resumes playback", () => {
    const { c } = clock();
    c.start();
    c.pause();
    c.seek(3400);
    expect(c.getState().t).toBe(3400);
    expect(c.getState().status).toBe("playing");
  });

  it("replay returns to t=0 playing", () => {
    const { c, f } = clock();
    c.start();
    f.advance(2000);
    c.replay();
    expect(c.getState().t).toBe(0);
    expect(c.getState().status).toBe("playing");
  });

  it("a hidden tab pauses and auto-resumes only when visible again", () => {
    const { c } = clock();
    c.start();
    c.notifyVisibility(false);
    expect(c.getState().status).toBe("paused");
    c.notifyVisibility(true);
    expect(c.getState().status).toBe("playing");
  });

  it("a user pause is not undone by the tab becoming visible", () => {
    const { c } = clock();
    c.start();
    c.pause();
    c.notifyVisibility(false);
    c.notifyVisibility(true);
    expect(c.getState().status).toBe("paused");
  });

  it("scrolled offscreen pauses and auto-resumes on return", () => {
    const { c } = clock();
    c.start();
    c.notifyViewport(false);
    expect(c.getState().status).toBe("paused");
    c.notifyViewport(true);
    expect(c.getState().status).toBe("playing");
  });

  it("reduced motion never plays: start/seek/replay stay paused", () => {
    const { c } = clock({ reduced: () => true });
    c.start();
    expect(c.getState().status).toBe("paused");
    c.seek(3400);
    expect(c.getState().status).toBe("paused");
    expect(c.getState().t).toBe(3400);
    c.resume();
    expect(c.getState().status).toBe("paused");
    c.replay();
    expect(c.getState().status).toBe("paused");
  });

  it("dispose cancels the armed frame", () => {
    const { c, f } = clock();
    c.start();
    c.dispose();
    expect(f.pendingCount()).toBe(0);
  });
});
