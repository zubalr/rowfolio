/**
 * PresentationController — the auto-playing chapter deck that powers the
 * landing's presentation-first stage.
 *
 * Framework-free: no React, DOM or window access at import or construction.
 * The host renders the chapter at `state.chapterIndex`; the controller owns
 * dwell-based auto-advance and the transport semantics:
 *  - `start()` begins playback (the landing calls it once the first scene is
 *    ready); under reduced-motion it arms nothing and waits paused —
 *    the same chapters, manually advanced.
 *  - `pause()` responds to Pause, manual interaction and a hidden tab;
 *    only `resume()` (an explicit Play) returns to auto-advance.
 *  - `next()`/`back()` navigate without changing play intent — while
 *    paused they stay paused, while playing the dwell re-arms.
 *  - The final chapter never auto-advances: the dwell completes into
 *    `held`, where the report waits for Replay or a workspace action.
 *  - Focus is never moved by the controller; scene changes are announced
 *    through the host's polite live region.
 */
export interface PresentationChapterDef {
  readonly id: string;
  /** Suggested time on this chapter before auto-advance; the held
      chapter's dwell decides when the "playing" status settles to "held". */
  readonly dwellMs: number;
}

export type PresentationStatus = "idle" | "playing" | "paused" | "held";

export interface PresentationState {
  readonly status: PresentationStatus;
  readonly chapterIndex: number;
  /** A dwell timer is armed and will advance on its own. */
  readonly autoAdvance: boolean;
}

export interface PresentationScheduler {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PresentationControllerOptions {
  readonly chapters: readonly PresentationChapterDef[];
  /** Evaluated lazily whenever a dwell would arm. Default: false. */
  readonly prefersReducedMotion?: (() => boolean) | undefined;
  /** Injectable timers for tests; defaults to globalThis timers. */
  readonly scheduler?: PresentationScheduler | undefined;
  /** Chapter to start on (e.g. a preserved position across a language
      switch). Clamped into range; defaults to 0. */
  readonly initialIndex?: number | undefined;
}

const defaultScheduler: PresentationScheduler = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as Parameters<typeof clearTimeout>[0]),
};

export class PresentationController {
  private readonly chapters: readonly PresentationChapterDef[];
  private readonly scheduler: PresentationScheduler;
  private readonly reducedMotion: () => boolean;
  private readonly initialIndex: number;
  private state: PresentationState;
  private readonly listeners = new Set<(state: PresentationState) => void>();
  private dwellHandle: unknown = null;
  /** Monotonic token so a superseded dwell can never advance a newer chapter. */
  private epoch = 0;

  constructor(options: PresentationControllerOptions) {
    if (options.chapters.length === 0) {
      throw new Error("PresentationController requires at least one chapter");
    }
    this.chapters = options.chapters;
    this.scheduler = options.scheduler ?? defaultScheduler;
    this.reducedMotion = options.prefersReducedMotion ?? (() => false);
    const initial = options.initialIndex ?? 0;
    this.initialIndex = Math.min(Math.max(initial, 0), options.chapters.length - 1);
    this.state = { status: "idle", chapterIndex: this.initialIndex, autoAdvance: false };
  }

  getState(): PresentationState {
    return this.state;
  }

  subscribe(listener: (state: PresentationState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Auto-start entry point — the presentation starts as soon as its first
   * scene is ready. Under reduced-motion it opens paused on the first
   * chapter for manual advance.
   */
  start(): void {
    if (this.state.status !== "idle") return;
    this.epoch += 1;
    const index = this.initialIndex;
    if (this.reducedMotion()) {
      this.setState({ status: "paused", chapterIndex: index, autoAdvance: false });
      return;
    }
    this.setState({ status: "playing", chapterIndex: index, autoAdvance: false });
    this.armDwell(index, this.epoch);
  }

  /** Pause mid-chapter — Pause control, manual interaction, hidden tab. */
  pause(): void {
    if (this.state.status !== "playing") return;
    this.epoch += 1;
    this.clearDwell();
    this.setState({ ...this.state, status: "paused", autoAdvance: false });
  }

  /**
   * Explicit Play — the only way back to auto-advance. From `held` it
   * replays from the first chapter; under reduced-motion it performs one
   * manual advance instead (auto-advance never arms).
   */
  resume(): void {
    if (this.state.status === "held") {
      this.replay();
      return;
    }
    if (this.state.status !== "paused") return;
    if (this.reducedMotion()) {
      this.next();
      return;
    }
    this.epoch += 1;
    this.setState({ ...this.state, status: "playing" });
    this.armDwell(this.state.chapterIndex, this.epoch);
  }

  /** Next chapter; at the end the presentation settles to `held`. */
  next(): void {
    if (this.state.status === "idle") return;
    const target = Math.min(this.state.chapterIndex + 1, this.chapters.length - 1);
    this.goTo(target);
  }

  /** Previous chapter; leaving `held` returns to a paused earlier chapter. */
  back(): void {
    if (this.state.status === "idle") return;
    const target = Math.max(this.state.chapterIndex - 1, 0);
    this.goTo(target);
  }

  /** Jump straight to a chapter (labeled chapter progress affordance). */
  goToChapter(index: number): void {
    if (this.state.status === "idle") return;
    const target = Math.min(Math.max(index, 0), this.chapters.length - 1);
    this.goTo(target);
  }

  /** Explicit restart — returns to the first chapter playing. */
  replay(): void {
    this.epoch += 1;
    this.clearDwell();
    if (this.reducedMotion()) {
      this.setState({ status: "paused", chapterIndex: 0, autoAdvance: false });
      return;
    }
    this.setState({ status: "playing", chapterIndex: 0, autoAdvance: false });
    this.armDwell(0, this.epoch);
  }

  /** Host hook: any interaction outside the transport pauses playback. */
  notifyInteraction(): void {
    this.pause();
  }

  /** Host hook: a hidden tab pauses; becoming visible never auto-resumes. */
  notifyVisibility(visible: boolean): void {
    if (!visible) this.pause();
  }

  dispose(): void {
    this.epoch += 1;
    this.clearDwell();
    this.listeners.clear();
  }

  private goTo(index: number): void {
    if (this.state.status === "held" && index >= this.state.chapterIndex) {
      // Already at the end; Next at the held chapter is a no-op.
      return;
    }
    this.epoch += 1;
    this.clearDwell();
    const atEnd = index === this.chapters.length - 1;
    // Playing onto the last chapter settles straight into held: the report
    // is the destination and there is nowhere further to advance. Leaving
    // held via Back returns to a paused earlier chapter.
    const status: PresentationStatus =
      this.state.status === "held" ? "paused" : atEnd && this.state.status === "playing" ? "held" : this.state.status;
    this.setState({ ...this.state, chapterIndex: index, status, autoAdvance: false });
    if (status === "playing") this.armDwell(index, this.epoch);
  }

  private setState(next: PresentationState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private clearDwell(): void {
    if (this.dwellHandle !== null) {
      this.scheduler.clearTimeout(this.dwellHandle);
      this.dwellHandle = null;
    }
  }

  private armDwell(index: number, epoch: number): void {
    const chapter = this.chapters[index];
    if (chapter === undefined) return;
    if (this.reducedMotion()) return;
    this.setState({ ...this.state, autoAdvance: true });
    this.dwellHandle = this.scheduler.setTimeout(() => {
      if (epoch !== this.epoch) return;
      this.dwellHandle = null;
      if (index >= this.chapters.length - 1) {
        // End of the deck — hold the finished report, no loop.
        this.setState({ status: "held", chapterIndex: index, autoAdvance: false });
        return;
      }
      this.setState({ ...this.state, chapterIndex: index + 1, autoAdvance: false });
      this.armDwell(index + 1, epoch);
    }, chapter.dwellMs);
  }
}
