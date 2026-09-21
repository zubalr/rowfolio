import { describe, expect, it } from "vitest";
import { PresentationController, type PresentationScheduler } from "./presentation.ts";

const CHAPTERS = [
  { id: "result", dwellMs: 5000 },
  { id: "transform", dwellMs: 7000 },
  { id: "report", dwellMs: 9000 },
];

function fakeScheduler() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 0;
  const scheduler: PresentationScheduler = {
    setTimeout(fn, ms) {
      const id = ++nextId;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    scheduler,
    advance(ms: number) {
      // Fire every armed timer whose deadline falls inside the window; the
      // controller arms at most one dwell at a time.
      const ready = [...pending.entries()].filter(([, t]) => t.ms <= ms);
      for (const [id, t] of ready) {
        pending.delete(id);
        t.fn();
      }
    },
    pendingCount: () => pending.size,
  };
}

describe("PresentationController", () => {
  it("auto-starts playing on the initial chapter and arms the dwell", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    const st = c.getState();
    expect(st.status).toBe("playing");
    expect(st.chapterIndex).toBe(0);
    expect(st.autoAdvance).toBe(true);
    expect(s.pendingCount()).toBe(1);
  });

  it("advances through chapters on dwell and holds on the last", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    s.advance(5000);
    expect(c.getState().chapterIndex).toBe(1);
    s.advance(7000);
    expect(c.getState().chapterIndex).toBe(2);
    expect(c.getState().status).toBe("playing");
    s.advance(9000);
    const st = c.getState();
    expect(st.status).toBe("held");
    expect(st.chapterIndex).toBe(2);
    expect(st.autoAdvance).toBe(false);
    expect(s.pendingCount()).toBe(0);
  });

  it("never loops: after held, no further dwell is armed", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    s.advance(5000);
    s.advance(7000);
    s.advance(9000);
    s.advance(60000);
    expect(c.getState().status).toBe("held");
    expect(c.getState().chapterIndex).toBe(2);
  });

  it("pause stops auto-advance; only resume restarts it", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.pause();
    expect(c.getState().status).toBe("paused");
    s.advance(60000);
    expect(c.getState().chapterIndex).toBe(0); // never advanced while paused
    c.resume();
    expect(c.getState().status).toBe("playing");
    s.advance(5000);
    expect(c.getState().chapterIndex).toBe(1);
  });

  it("hidden tab pauses and never auto-resumes", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.notifyVisibility(false);
    expect(c.getState().status).toBe("paused");
    c.notifyVisibility(true);
    expect(c.getState().status).toBe("paused");
    s.advance(60000);
    expect(c.getState().chapterIndex).toBe(0);
  });

  it("manual interaction outside the transport pauses", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.notifyInteraction();
    expect(c.getState().status).toBe("paused");
  });

  it("next/back navigate and preserve play intent", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.next();
    expect(c.getState().chapterIndex).toBe(1);
    expect(c.getState().status).toBe("playing");
    c.pause();
    c.back();
    expect(c.getState().chapterIndex).toBe(0);
    expect(c.getState().status).toBe("paused");
  });

  it("next while playing onto the last chapter settles into held", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.next();
    c.next();
    expect(c.getState().status).toBe("held");
    expect(c.getState().chapterIndex).toBe(2);
    c.next(); // no-op at the end
    expect(c.getState().chapterIndex).toBe(2);
  });

  it("back from held returns to a paused earlier chapter", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.next();
    c.next();
    expect(c.getState().status).toBe("held");
    c.back();
    expect(c.getState().status).toBe("paused");
    expect(c.getState().chapterIndex).toBe(1);
  });

  it("replay restarts playing from the first chapter", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    s.advance(5000);
    s.advance(7000);
    s.advance(9000);
    c.replay();
    expect(c.getState().status).toBe("playing");
    expect(c.getState().chapterIndex).toBe(0);
    s.advance(5000);
    expect(c.getState().chapterIndex).toBe(1);
  });

  it("resume from held replays the deck", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    s.advance(5000);
    s.advance(7000);
    s.advance(9000);
    c.resume();
    expect(c.getState().status).toBe("playing");
    expect(c.getState().chapterIndex).toBe(0);
  });

  it("goToChapter jumps to a labeled chapter", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.pause();
    c.goToChapter(2);
    expect(c.getState().chapterIndex).toBe(2);
    expect(c.getState().status).toBe("paused");
  });

  it("under reduced-motion, start opens paused and dwell never arms", () => {
    const s = fakeScheduler();
    const c = new PresentationController({
      chapters: CHAPTERS,
      scheduler: s.scheduler,
      prefersReducedMotion: () => true,
    });
    c.start();
    expect(c.getState().status).toBe("paused");
    expect(c.getState().autoAdvance).toBe(false);
    s.advance(60000);
    expect(c.getState().chapterIndex).toBe(0); // manual advance only
  });

  it("under reduced-motion, Play performs one manual advance and stays paused", () => {
    const s = fakeScheduler();
    const c = new PresentationController({
      chapters: CHAPTERS,
      scheduler: s.scheduler,
      prefersReducedMotion: () => true,
    });
    c.start();
    c.resume();
    expect(c.getState().status).toBe("paused");
    expect(c.getState().chapterIndex).toBe(1);
    s.advance(60000);
    expect(c.getState().chapterIndex).toBe(1);
  });

  it("initialIndex restores a preserved chapter", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler, initialIndex: 1 });
    c.start();
    expect(c.getState().chapterIndex).toBe(1);
  });

  it("a superseded dwell can never advance a newer chapter", () => {
    const s = fakeScheduler();
    const c = new PresentationController({ chapters: CHAPTERS, scheduler: s.scheduler });
    c.start();
    c.next(); // cancels chapter-0 dwell, arms chapter-1 dwell
    s.advance(5000); // stale timer window — only the live dwell can fire
    expect(c.getState().chapterIndex).toBe(1);
  });
});
