import { describe, expect, it } from "vitest";
import { createFormatters } from "../../../packages/i18n/src/index.ts";

const en = createFormatters("en-US-u-nu-latn");
const ar = createFormatters("ar-QA-u-nu-arab");
const arLatn = createFormatters("ar-QA-u-nu-latn");

describe("formatDate — Gregorian calendar in every locale", () => {
  it("English medium date", () => {
    expect(en.formatDate("2026-06-30")).toBe("Jun 30, 2026");
    expect(en.formatDate("2026-06-30", { dateStyle: "long" })).toBe("June 30, 2026");
    expect(en.formatDate("2026-06-30", { dateStyle: "short" })).toBe("6/30/26");
  });

  it("Arabic renders Gregorian (not Hijri) dates in Arabic-Indic digits", () => {
    const out = ar.formatDate("2026-06-30");
    // ar-QA gregory medium: "٣٠‏/٠٦‏/٢٠٢٦" with possible bidi marks around slashes
    const stripped = out.replace(/[\u200E\u200F\u061C]/gu, "");
    expect(stripped).toBe("٣٠/٠٦/٢٠٢٦");
    // Hijri year for mid-2026 is 1447-1448 — must never appear
    expect(out).not.toContain("١٤٤٧");
    expect(out).not.toContain("١٤٤٨");
    expect(out).not.toContain("1447");
    expect(out).not.toContain("1448");
  });

  it("Arabic long date names the Gregorian month", () => {
    expect(ar.formatDate("2026-06-30", { dateStyle: "long" })).toBe("٣٠ يونيو ٢٠٢٦");
  });

  it("Arabic + Latin digits preference", () => {
    const stripped = arLatn.formatDate("2026-06-30").replace(/[\u200E\u200F\u061C]/gu, "");
    expect(stripped).toBe("30/06/2026");
  });
});

describe("formatMonth / formatDateRange", () => {
  it("month buckets render month+year only", () => {
    expect(en.formatMonth("2026-06")).toBe("Jun 2026");
    expect(ar.formatMonth("2026-06")).toBe("يونيو ٢٠٢٦");
  });

  it("date ranges use formatRange", () => {
    const r = en.formatDateRange("2026-01-01", "2026-06-30");
    expect(r).toContain("Jun");
    expect(r).toContain("Jan");
  });

  it("rejects impossible Gregorian dates", () => {
    for (const bad of ["2026-02-29", "2025-02-29", "2026-13-01", "2026-00-10", "not-a-date", "06/30/2026"]) {
      expect(() => en.formatDate(bad), bad).toThrowError(
        expect.objectContaining({ code: "invalid-date" }),
      );
    }
    // leap year edge
    expect(en.formatDate("2024-02-29")).toBe("Feb 29, 2024");
    expect(en.formatDate("2000-02-29")).toBe("Feb 29, 2000");
  });

  it("rejects malformed month buckets", () => {
    expect(() => en.formatMonth("2026-13")).toThrowError(
      expect.objectContaining({ code: "invalid-date" }),
    );
    expect(() => en.formatMonth("2026-06-30")).toThrowError(
      expect.objectContaining({ code: "invalid-date" }),
    );
  });
});
