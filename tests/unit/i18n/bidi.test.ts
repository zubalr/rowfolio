import { describe, expect, it } from "vitest";
import {
  autoIsolateProps,
  BIDI,
  containsRtl,
  directionOf,
  isolateAuto,
  isolateLtr,
  isolateRtl,
  ltrIsolateProps,
  stripBidiControls,
} from "../../../packages/i18n/src/index.ts";

const { LRI, RLI, FSI, PDI } = BIDI;

describe("directionOf", () => {
  it("ar → rtl, en → ltr", () => {
    expect(directionOf("ar")).toBe("rtl");
    expect(directionOf("en")).toBe("ltr");
  });
});

describe("directional isolation helpers", () => {
  it("isolateLtr wraps Latin identifiers and formulas in LRI…PDI", () => {
    expect(isolateLtr("revenue_q2")).toBe(`${LRI}revenue_q2${PDI}`);
    expect(isolateLtr("=SUM(A1:A10)")).toBe(`${LRI}=SUM(A1:A10)${PDI}`);
    expect(isolateLtr("-0.0004")).toBe(`${LRI}-0.0004${PDI}`);
    expect(isolateLtr("2026-06-30")).toBe(`${LRI}2026-06-30${PDI}`);
  });

  it("isolateRtl wraps Arabic text in RLI…PDI", () => {
    expect(isolateRtl("الإيرادات")).toBe(`${RLI}الإيرادات${PDI}`);
  });

  it("isolateAuto uses FSI for first-strong detection", () => {
    expect(isolateAuto("Mixed كلام text")).toBe(`${FSI}Mixed كلام text${PDI}`);
  });

  it("ltrIsolateProps/autoIsolateProps return dir attributes", () => {
    expect(ltrIsolateProps()).toEqual({ dir: "ltr" });
    expect(autoIsolateProps()).toEqual({ dir: "auto" });
  });

  it("isolateLtr treats empty input safely", () => {
    expect(isolateLtr("")).toBe(`${LRI}${PDI}`);
  });
});

describe("containsRtl / stripBidiControls", () => {
  it("detects RTL characters", () => {
    expect(containsRtl("الإيرادات")).toBe(true);
    expect(containsRtl("Revenue")).toBe(false);
    expect(containsRtl("=SUM(A1)")).toBe(false);
  });

  it("strips bidi control characters from text", () => {
    const dirty = `Revenue${BIDI.LRI}${BIDI.RLI}${BIDI.FSI}${BIDI.PDI}${BIDI.ALM}${BIDI.LRM}${BIDI.RLM}`;
    expect(stripBidiControls(dirty)).toBe("Revenue");
  });
});
