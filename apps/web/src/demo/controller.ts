/**
 * DemoController — the reusable guided-demo state machine.
 *
 * Framework-free: no React, DOM or window access at import or construction.
 * The host application owns the UI; the controller drives it through
 * `DemoHost.perform` with the SAME semantic action identifiers a manual
 * control dispatches, then awaits a real readiness predicate via
 * `DemoHost.waitReady` — never a fixed timer.
 *
 * Rules implemented (storyboard "Guided mode" + "Replay"):
 *  - Opt-in only: nothing runs before `start()`.
 *  - Suggested dwell per step; explicit Back/Next overrides immediately.
 *  - `pause()`/`notifyInteraction()`/`notifyVisibility(false)` pause the guide;
 *    it never resumes without an explicit `resume()` call.
 *  - `exit()` (Escape or Exit control) leaves results untouched.
 *  - `replay()` stops the guide, asks the host to restore the trusted
 *    baseline and moves focus to the results heading; language is not
 *    the controller's concern and is never reset.
 *  - Reduced motion: steps never auto-advance while
 *    `prefersReducedMotion()` is true — the user steps explicitly.
 *  - Readiness watchdog: a step that never becomes ready surfaces a typed
 *    `step-timeout` error instead of a false pass.
 */
import type { MessageKey } from "@rowfolio/i18n";

/** Semantic actions dispatched to the host — shared with manual controls. */
export type DemoActionKind =
  | "focus-stage"
  | "reveal-findings"
  | "open-evidence"
  | "apply-scenario"
  | "prepare-briefing"
  | "complete"
  | "reset";

/** Named readiness signals the host resolves; never fabricated timers. */
export type DemoReadiness =
  | "stage"
  | "findings"
  | "evidence"
  | "scenario"
  | "briefing";

export interface GuideStep {
  readonly id: string;
  /** Existing catalog key rendered as the step caption + announcement. */
  readonly captionKey: MessageKey;
  readonly action: DemoActionKind;
  /** Signal awaited before dwelling; null means immediate. */
  readonly ready: DemoReadiness | null;
  /** Suggested dwell (ms) before auto-advance; explicit controls override. */
  readonly dwellMs: number;
}

/** Steps + dwells (4, 6, 7, 7, 8, 6 s). */
export const GUIDE_STEPS: readonly GuideStep[] = [
  { id: "intro", captionKey: "common.prepared", action: "focus-stage", ready: "stage", dwellMs: 4000 },
  { id: "findings", captionKey: "workspace.findings", action: "reveal-findings", ready: "findings", dwellMs: 6000 },
  { id: "evidence", captionKey: "evidence.title", action: "open-evidence", ready: "evidence", dwellMs: 7000 },
  { id: "scenario", captionKey: "scenario.title", action: "apply-scenario", ready: "scenario", dwellMs: 7000 },
  { id: "briefing", captionKey: "export.title", action: "prepare-briefing", ready: "briefing", dwellMs: 8000 },
  { id: "complete", captionKey: "a11y.completed", action: "complete", ready: null, dwellMs: 6000 },
];

export interface DemoHost {
  /** Dispatch a semantic application action (same as a manual control). */
  perform(action: DemoActionKind): void | Promise<void>;
  /**
   * Resolve `true` once `signal` is reached, `false` on timeout. Implement
   * against real application state — never a fixed delay.
   */
  waitReady(signal: DemoReadiness, timeoutMs: number): Promise<boolean>;
  /** Focus the results heading after a replay reset. */
  focusResults?(): void;
}

export interface DemoScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type GuideStatus = "idle" | "running" | "paused" | "complete" | "error";

export interface GuideState {
  readonly status: GuideStatus;
  /** Index into GUIDE_STEPS; -1 while idle. */
  readonly stepIndex: number;
  /** True while awaiting the host's readiness predicate for this step. */
  readonly awaitingReady: boolean;
  /** Auto-advance armed (running, not reduced-motion, not last step). */
  readonly autoAdvance: boolean;
  readonly errorCode: "step-timeout" | null;
}

export interface DemoControllerOptions {
  readonly host: DemoHost;
  /** Evaluated lazily each time a dwell would be armed. Default: false. */
  readonly prefersReducedMotion?: (() => boolean) | undefined;
  /** Injectable timers for tests; defaults to globalThis timers. */
  readonly scheduler?: DemoScheduler | undefined;
  /** Readiness watchdog per step (default 10_000 ms). */
  readonly stepTimeoutMs?: number | undefined;
}

const defaultScheduler: DemoScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as Parameters<typeof clearTimeout>[0]),
};

export const INITIAL_GUIDE_STATE: GuideState = {
  status: "idle",
  stepIndex: -1,
  awaitingReady: false,
  autoAdvance: false,
  errorCode: null,
};

export class DemoController {
  private readonly host: DemoHost;
  private readonly scheduler: DemoScheduler;
  private readonly reducedMotion: () => boolean;
  private readonly stepTimeoutMs: number;
  private state: GuideState = INITIAL_GUIDE_STATE;
  private readonly listeners = new Set<(state: GuideState) => void>();
  private dwellHandle: unknown = null;
  /** Monotonic token so stale async completions never advance a newer step. */
  private epoch = 0;

  constructor(options: DemoControllerOptions) {
    this.host = options.host;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.reducedMotion = options.prefersReducedMotion ?? (() => false);
    this.stepTimeoutMs = options.stepTimeoutMs ?? 10_000;
  }

  getState(): GuideState {
    return this.state;
  }

  subscribe(listener: (state: GuideState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Opt-in entry point — the guide never starts on its own. */
  start(): void {
    this.epoch += 1;
    this.clearDwell();
    void this.enterStep(0, this.epoch);
  }

  /** Pause mid-guide; also the response to manual interaction / tab hide. */
  pause(): void {
    if (this.state.status !== "running") return;
    this.epoch += 1;
    this.clearDwell();
    this.setState({ ...this.state, status: "paused", awaitingReady: false, autoAdvance: false });
  }

  /** Explicit user consent is the only way back to auto-advance. */
  resume(): void {
    if (this.state.status !== "paused") return;
    const epoch = (this.epoch += 1);
    this.setState({ ...this.state, status: "running" });
    this.armDwell(this.state.stepIndex, epoch);
  }

  /** Exit the guide (Escape/Exit) — preserves whatever results exist. */
  exit(): void {
    this.epoch += 1;
    this.clearDwell();
    this.setState(INITIAL_GUIDE_STATE);
  }

  /** Manual override: jump to the next/previous step immediately. */
  next(): void {
    if (this.state.status !== "running" && this.state.status !== "paused") return;
    const target = Math.min(this.state.stepIndex + 1, GUIDE_STEPS.length - 1);
    const paused = this.state.status === "paused";
    const epoch = (this.epoch += 1);
    this.clearDwell();
    void this.enterStep(target, epoch, paused);
  }

  back(): void {
    if (this.state.status !== "running" && this.state.status !== "paused") return;
    const target = Math.max(this.state.stepIndex - 1, 0);
    const paused = this.state.status === "paused";
    const epoch = (this.epoch += 1);
    this.clearDwell();
    void this.enterStep(target, epoch, paused);
  }

  /**
   * Replay: stop the guide and timers, restore the trusted baseline through
   * the host (sample snapshot, headline finding, zeroed scenario, closed
   * evidence, cleared file state), then focus the results heading.
   */
  async replay(): Promise<void> {
    this.epoch += 1;
    this.clearDwell();
    this.setState(INITIAL_GUIDE_STATE);
    await this.host.perform("reset");
    this.host.focusResults?.();
  }

  /** Host hook: user interacted manually outside the guide controls. */
  notifyInteraction(): void {
    this.pause();
  }

  /** Host hook: tab hidden pauses; becoming visible never auto-resumes. */
  notifyVisibility(visible: boolean): void {
    if (!visible) this.pause();
  }

  dispose(): void {
    this.exit();
    this.listeners.clear();
  }

  private setState(next: GuideState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private clearDwell(): void {
    if (this.dwellHandle !== null) {
      this.scheduler.clearTimeout(this.dwellHandle);
      this.dwellHandle = null;
    }
  }

  private async enterStep(index: number, epoch: number, stayPaused = false): Promise<void> {
    const step = GUIDE_STEPS[index];
    if (step === undefined) return;
    this.clearDwell();
    this.setState({
      status: stayPaused ? "paused" : "running",
      stepIndex: index,
      awaitingReady: step.ready !== null,
      autoAdvance: false,
      errorCode: null,
    });

    await this.host.perform(step.action);
    if (epoch !== this.epoch) return; // superseded while dispatching

    if (step.ready !== null) {
      const ready = await this.host.waitReady(step.ready, this.stepTimeoutMs);
      if (epoch !== this.epoch) return;
      if (!ready) {
        this.setState({ ...this.state, status: "error", awaitingReady: false, errorCode: "step-timeout" });
        return;
      }
      this.setState({ ...this.state, awaitingReady: false });
    }

    if (this.state.status === "running") {
      this.armDwell(index, epoch);
    }
  }

  private armDwell(index: number, epoch: number): void {
    if (this.state.status !== "running" || this.state.stepIndex !== index) return;
    const isLast = index >= GUIDE_STEPS.length - 1;
    const step = GUIDE_STEPS[index];
    if (step === undefined || isLast) {
      this.setState({ ...this.state, status: isLast ? "complete" : this.state.status, autoAdvance: false });
      return;
    }
    if (this.reducedMotion()) {
      // Reduced motion: no auto-advance — the user steps explicitly.
      this.setState({ ...this.state, autoAdvance: false });
      return;
    }
    this.setState({ ...this.state, autoAdvance: true });
    this.dwellHandle = this.scheduler.setTimeout(() => {
      if (epoch !== this.epoch) return;
      void this.enterStep(index + 1, epoch);
    }, step.dwellMs);
  }
}
