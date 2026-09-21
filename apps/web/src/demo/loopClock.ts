/**
 * LoopClock — the frame-driven timeline that powers the landing's
 * annotator spread: a single bounded loop (beats inside one timeline)
 * rather than a chapter deck.
 *
 * Framework-free: no React, DOM or window access at import or construction.
 * The host subscribes and renders `state.t` each frame; the clock owns
 * transport semantics:
 *  - `start()` begins the loop; under reduced-motion it stays paused so
 *    the host renders the finished frame for manual review.
 *  - `pause()` responds to Pause, click/tap on the stage and a hidden tab
 *    or offscreen scroll; only `resume()` returns to playback.
 *  - `seek()` jumps the timeline (chapter ticks) and, like the trial,
 *    resumes playback unless reduced-motion keeps it still.
 *  - `replay()` returns to t=0 playing.
 *  - The loop wraps cleanly: the host is responsible for the seam
 *    crossfade inside the timeline window.
 */
export type LoopStatus = "idle" | "playing" | "paused";

export interface LoopClockState {
  readonly status: LoopStatus;
  /** Milliseconds into the loop, [0, loopMs). */
  readonly t: number;
}

export interface LoopFrameSource {
  schedule(cb: (now: number) => void): unknown;
  cancel(handle: unknown): void;
}

export interface LoopClockOptions {
  /** Total loop length in ms. */
  readonly loopMs: number;
  /** Evaluated lazily whenever playback would (re)start. Default: false. */
  readonly prefersReducedMotion?: (() => boolean) | undefined;
  /** Injectable frame source + clock for tests; defaults to rAF. */
  readonly frame?: LoopFrameSource | undefined;
  readonly now?: (() => number) | undefined;
}

const defaultFrame: LoopFrameSource = {
  schedule: (cb) => requestAnimationFrame(cb),
  cancel: (h) => cancelAnimationFrame(h as number),
};

export class LoopClock {
  private readonly loopMs: number;
  private readonly frame: LoopFrameSource;
  private readonly reducedMotion: () => boolean;
  private readonly now: () => number;
  private state: LoopClockState;
  private readonly listeners = new Set<(state: LoopClockState) => void>();
  private frameHandle: unknown = null;
  private lastNow: number | null = null;
  /** True when a hide/offscreen pause is what stopped playback. */
  private autoPaused = false;

  constructor(options: LoopClockOptions) {
    if (options.loopMs <= 0) {
      throw new Error("LoopClock requires a positive loopMs");
    }
    this.loopMs = options.loopMs;
    this.frame = options.frame ?? defaultFrame;
    this.now = options.now ?? (() => performance.now());
    this.reducedMotion = options.prefersReducedMotion ?? (() => false);
    this.state = { status: "idle", t: 0 };
  }

  getState(): LoopClockState {
    return this.state;
  }

  subscribe(listener: (state: LoopClockState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Auto-play entry point; reduced-motion keeps the loop paused at 0. */
  start(): void {
    if (this.state.status !== "idle") return;
    if (this.reducedMotion()) {
      this.setState({ status: "paused", t: 0 });
      return;
    }
    this.lastNow = null;
    this.setState({ status: "playing", t: 0 });
    this.schedule();
  }

  /** Pause mid-beat — Pause control, stage click/tap, hidden tab. */
  pause(): void {
    if (this.state.status !== "playing") return;
    this.cancelFrame();
    this.autoPaused = false;
    this.setState({ ...this.state, status: "paused" });
  }

  /** Explicit Play — the only way back to playback. */
  resume(): void {
    if (this.state.status !== "paused") return;
    if (this.reducedMotion()) return;
    this.autoPaused = false;
    this.lastNow = null;
    this.setState({ ...this.state, status: "playing" });
    this.schedule();
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else this.resume();
  }

  /**
   * Jump the timeline to `ms` (chapter ticks). Playback continues — the
   * trial's rail seeks then keeps playing — unless reduced-motion is set.
   */
  seek(ms: number): void {
    if (this.state.status === "idle") return;
    const t = Math.min(Math.max(ms, 0), this.loopMs - 1);
    if (this.state.status === "paused") {
      const status: LoopStatus = this.reducedMotion() ? "paused" : "playing";
      this.setState({ status, t });
      if (status === "playing") {
        this.lastNow = null;
        this.schedule();
      }
      return;
    }
    this.setState({ ...this.state, t });
    this.lastNow = null;
  }

  /** Explicit restart — back to t=0 playing. */
  replay(): void {
    if (this.state.status === "idle") return;
    this.cancelFrame();
    if (this.reducedMotion()) {
      this.setState({ status: "paused", t: 0 });
      return;
    }
    this.lastNow = null;
    this.setState({ status: "playing", t: 0 });
    this.schedule();
  }

  /** Host hook: a hidden tab pauses; becoming visible resumes only if the
      pause was automatic. */
  notifyVisibility(visible: boolean): void {
    this.autoGate(!visible);
  }

  /** Host hook: scrolled offscreen pauses; returning resumes only if the
      pause was automatic. */
  notifyViewport(visible: boolean): void {
    this.autoGate(!visible);
  }

  dispose(): void {
    this.cancelFrame();
    this.listeners.clear();
  }

  private autoGate(hidden: boolean): void {
    if (hidden) {
      if (this.state.status === "playing") {
        this.cancelFrame();
        this.autoPaused = true;
        this.setState({ ...this.state, status: "paused" });
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      this.resume();
    }
  }

  private setState(next: LoopClockState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private schedule(): void {
    this.cancelFrame();
    this.frameHandle = this.frame.schedule((now) => this.tick(now));
  }

  private tick(now: number): void {
    this.frameHandle = null;
    if (this.state.status !== "playing") return;
    const dt = this.lastNow === null ? 0 : Math.max(0, now - this.lastNow);
    this.lastNow = now;
    const t = (this.state.t + dt) % this.loopMs;
    this.setState({ ...this.state, t });
    if (this.state.status === "playing") this.schedule();
  }

  private cancelFrame(): void {
    if (this.frameHandle !== null) {
      this.frame.cancel(this.frameHandle);
      this.frameHandle = null;
    }
  }
}
