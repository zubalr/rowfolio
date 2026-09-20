/**
 * PreviewLoader — the lazy boundary for the landing's demo payload.
 *
 * Loaded via `React.lazy` from `LandingApp` so first paint stays light: the
 * prepared-sample truth (fixture JSON), the stage, the guide bar and the
 * DemoController wiring all live behind this chunk. The Motion overlay is a
 * second nested lazy boundary so the animation library only downloads when
 * a guide is actually running.
 *
 * Landing chrome (CTA buttons) talks to this component through a one-shot
 * `pendingAction` prop, so a click that lands while the chunk is still
 * loading is honored on mount rather than dropped.
 */
import { Suspense, lazy, useEffect, useMemo, useReducer, useState } from "react";
import type { I18n } from "@rowfolio/i18n";
import { DemoController, GuideBar, GUIDE_STEPS, type GuideState } from "../demo/index.ts";
import { LANDING_TRUTH } from "./previewTruth.ts";
import { PREVIEW_IDLE, previewReducer } from "./previewState.ts";
import { PreviewDemoHost } from "./previewHost.ts";
import { PreviewStage } from "./PreviewStage.tsx";
import { focusById, scrollToId } from "./routes.ts";
import { prefersReducedMotion, useReducedMotion } from "./useReducedMotion.ts";

const GuideHighlight = lazy(() => import("./GuideHighlight.tsx"));

export type PendingDemoAction = "explore" | "guide";

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

  // Chrome-level CTAs land here, whether the chunk was already mounted or
  // still loading when the user clicked.
  useEffect(() => {
    if (pendingAction === null) return;
    if (pendingAction === "guide") {
      controller.start();
    } else {
      dispatch({ type: "reveal" });
    }
    scrollToId("demo");
    onActionHandled();
  }, [pendingAction, controller, onActionHandled]);

  const replay = () => void controller.replay();
  const manualInteraction = () => controller.notifyInteraction();

  const guideRunning = guide.status === "running" || guide.status === "paused";
  // The bar stays mounted through "complete"/"error" so its final caption and
  // typed error remain visible; it unmounts only when the guide is idle.
  const guideVisible = guide.status !== "idle";
  const guideStepId =
    guide.stepIndex >= 0 && guide.stepIndex < GUIDE_STEPS.length
      ? (GUIDE_STEPS[guide.stepIndex]?.id ?? null)
      : null;

  return (
    <>
      <PreviewStage
        truth={truth}
        i18n={i18n}
        state={preview}
        dispatch={dispatch}
        guideStep={guideRunning ? guideStepId : null}
        guideVisible={guideVisible}
        onManualInteraction={manualInteraction}
        onReplay={replay}
      >
        <GuideBar controller={controller} i18n={i18n} />
      </PreviewStage>

      {!reducedMotion && guideVisible && guideStepId !== null ? (
        <Suspense fallback={null}>
          <GuideHighlight stepId={guideStepId} />
        </Suspense>
      ) : null}
    </>
  );
}
