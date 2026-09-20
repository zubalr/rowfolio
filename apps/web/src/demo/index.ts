/**
 * @module demo — reusable guided-demo controller for Rowfolio (A12).
 *
 * `DemoController` is host-agnostic and framework-free: any application
 * surface (landing preview today; the workspace reducer once A11 lands)
 * implements `DemoHost` and gets pause/stop/interrupt-safe guided
 * walkthroughs plus replay. `GuideBar` is the shared control surface.
 */
export {
  DemoController,
  GUIDE_STEPS,
  INITIAL_GUIDE_STATE,
} from "./controller.ts";
export type {
  DemoActionKind,
  DemoControllerOptions,
  DemoHost,
  DemoReadiness,
  DemoScheduler,
  GuideState,
  GuideStatus,
  GuideStep,
} from "./controller.ts";
export { GuideBar } from "./GuideBar.tsx";
export type { GuideBarProps } from "./GuideBar.tsx";
