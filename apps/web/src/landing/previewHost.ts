/**
 * PreviewDemoHost — binds the reusable DemoController to the landing
 * preview surface. `perform` maps each semantic guide action to the same
 * preview action a manual control dispatches; `waitReady` resolves only
 * when the preview reducer has actually reached the named state (or the
 * watchdog times out — the controller then shows a typed error).
 */
import type { DemoActionKind, DemoHost, DemoReadiness } from "../demo/controller.ts";
import type { PreviewAction, PreviewState } from "./previewState.ts";

/** One real readiness signal per guide step, satisfied by preview state. */
export function readinessFor(state: PreviewState): ReadonlySet<DemoReadiness> {
  const ready = new Set<DemoReadiness>();
  ready.add("stage"); // the preview surface is statically rendered
  if (state.revealed) ready.add("findings");
  if (state.evidenceOpen) ready.add("evidence");
  if (state.scenarioRatio !== "0") ready.add("scenario");
  if (state.briefingReady) ready.add("briefing");
  return ready;
}

interface Waiter {
  readonly signal: DemoReadiness;
  readonly resolve: (ready: boolean) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class PreviewDemoHost implements DemoHost {
  private satisfied: ReadonlySet<DemoReadiness> = new Set();
  private waiters: Waiter[] = [];

  constructor(
    private readonly dispatch: (action: PreviewAction) => void,
    private readonly onFocusStage: () => void,
    private readonly onFocusResults: () => void,
  ) {}

  /** Called by the React owner whenever preview state changes. */
  publish(state: PreviewState): void {
    this.satisfied = readinessFor(state);
    const remaining: Waiter[] = [];
    for (const waiter of this.waiters) {
      if (this.satisfied.has(waiter.signal)) {
        clearTimeout(waiter.timer);
        waiter.resolve(true);
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }

  perform(action: DemoActionKind): void {
    switch (action) {
      case "focus-stage":
        this.onFocusStage();
        this.dispatch({ type: "reveal" });
        break;
      case "reveal-findings":
        this.dispatch({ type: "reveal" });
        break;
      case "open-evidence":
        this.dispatch({ type: "open-evidence" });
        break;
      case "apply-scenario":
        this.dispatch({ type: "set-scenario", ratio: "0.08" });
        break;
      case "prepare-briefing":
        this.dispatch({ type: "prepare-briefing" });
        break;
      case "complete":
        break;
      case "reset":
        this.dispatch({ type: "reset" });
        break;
    }
  }

  waitReady(signal: DemoReadiness, timeoutMs: number): Promise<boolean> {
    if (this.satisfied.has(signal)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== resolve);
        resolve(false);
      }, timeoutMs);
      this.waiters.push({ signal, resolve, timer });
    });
  }

  focusResults(): void {
    this.onFocusResults();
  }
}
