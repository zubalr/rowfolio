/**
 * PreviewLoader — the lazy boundary for the landing's demo payload.
 *
 * Loaded via `React.lazy` from `LandingApp` so first paint stays light: the
 * prepared-sample truth (fixture JSON), the stage, the guide bar, the Motion
 * layer and the DemoController wiring all live behind this chunk.
 *
 * Landing chrome (CTA buttons, the four demonstration steps) talks to this
 * component through a one-shot `pendingAction` prop, so a click that lands
 * while the chunk is still loading is honored on mount rather than dropped.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import type { I18n } from "@rowfolio/i18n";
import { DemoController, GuideBar, GUIDE_STEPS, type GuideState } from "../demo/index.ts";
import { LANDING_TRUTH } from "./previewTruth.ts";
import { PREVIEW_IDLE, previewReducer } from "./previewState.ts";
import { PreviewDemoHost } from "./previewHost.ts";
import { PreviewStage } from "./PreviewStage.tsx";
import { focusById, scrollToId, workspaceHref } from "./routes.ts";
import { setWorkspaceIntent } from "./pendingUpload.ts";
import { prefersReducedMotion, useReducedMotion } from "./useReducedMotion.ts";

const GuideHighlight = lazy(() => import("./GuideHighlight.tsx"));

export type PendingDemoAction =
  | "explore"
  | "guide"
  | "reveal"
  | "evidence"
  | "scenario"
  | "briefing";

export interface PreviewLoaderProps {
  readonly i18n: I18n;
  /** Action requested by landing chrome; consumed once, then cleared. */
  readonly pendingAction: PendingDemoAction | null;
  readonly onActionHandled: () => void;
}

export default function PreviewLoader({
  i18n,
  pendingAction,
  onActionHandled,
}: PreviewLoaderProps) {
  const truth = LANDING_TRUTH;
  const [preview, dispatch] = useReducer(previewReducer, PREVIEW_IDLE);
  const [arrivalKey, setArrivalKey] = useState(0);
  const reducedMotion = useReducedMotion();

  const { controller, host } = useMemo(() => {
    const previewHost = new PreviewDemoHost(
      dispatch,
      () => scrollToId("demo"),
      () => focusById("rf-preview-title"),
    );
    return {
      host: previewHost,
      controller: new DemoController({ host: previewHost, prefersReducedMotion }),
    };
  }, []);

  const [guide, setGuide] = useState<GuideState>(controller.getState());
  useEffect(() => controller.subscribe(setGuide), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);

  // The host's readiness predicates track real preview state.
  useEffect(() => {
    host.publish(preview);
  }, [host, preview]);

  // Manual pointer/keyboard interaction outside the guide controls pauses
  // the guide; Escape exits it; a hidden tab pauses without auto-resume.
  useEffect(() => {
    const isGuideControl = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-guide-controls]") !== null;
    const onPointer = (event: Event) => {
      if (!isGuideControl(event.target)) controller.notifyInteraction();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.exit();
        return;
      }
      if (!isGuideControl(event.target)) controller.notifyInteraction();
    };
    const onVisibility = () => controller.notifyVisibility(!document.hidden);
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [controller]);

  // Chrome-level actions land here, whether the chunk was already mounted
  // or still loading when the user clicked.
  useEffect(() => {
    if (pendingAction === null) return;
    if (pendingAction === "guide") {
      controller.start();
    } else if (pendingAction === "evidence") {
      dispatch({ type: "open-evidence" });
    } else if (pendingAction === "scenario") {
      dispatch({ type: "set-scenario", ratio: "0.08" });
    } else if (pendingAction === "briefing") {
      dispatch({ type: "prepare-briefing" });
    } else {
      dispatch({ type: "reveal" });
    }
    scrollToId("demo");
    onActionHandled();
  }, [pendingAction, controller, onActionHandled]);

  // Reveal (from idle) replays the authored arrival sequence once.
  const prevRevealed = useRef(preview.revealed);
  useEffect(() => {
    if (preview.revealed && !prevRevealed.current) {
      setArrivalKey((k) => k + 1);
    }
    prevRevealed.current = preview.revealed;
  }, [preview.revealed]);

  // Replay resets the specimen to baseline then re-reveals it, which
  // replays the authored arrival sequence once (arrivalKey increments).
  const replay = () =>
    void controller.replay().then(() => dispatch({ type: "reveal" }));
  const manualInteraction = () => controller.notifyInteraction();
  const openWorkspace = useCallback(() => {
    setWorkspaceIntent({ kind: "sample" });
    window.location.hash = workspaceHref();
  }, []);

  const guideRunning = guide.status === "running" || guide.status === "paused";
  // The bar stays mounted through "complete"/"error" so its final caption and
  // typed error remain visible; it unmounts only when the guide is idle.
  const guideVisible = guide.status !== "idle";
  const guideStepId =
    guide.stepIndex >= 0 && guide.stepIndex < GUIDE_STEPS.length
      ? (GUIDE_STEPS[guide.stepIndex]?.id ?? null)
      : null;

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <PreviewStage
          truth={truth}
          i18n={i18n}
          state={preview}
          dispatch={dispatch}
          arrivalKey={arrivalKey}
          guideStep={guideRunning ? guideStepId : null}
          guideVisible={guideVisible}
          onManualInteraction={manualInteraction}
          onReplay={replay}
          onOpenWorkspace={openWorkspace}
        >
          <GuideBar controller={controller} i18n={i18n} onOpenWorkspace={openWorkspace} />
        </PreviewStage>

        {!reducedMotion && guideVisible && guideStepId !== null ? (
          <Suspense fallback={null}>
            <GuideHighlight stepId={guideStepId} />
          </Suspense>
        ) : null}
      </LazyMotion>
    </MotionConfig>
  );
}
