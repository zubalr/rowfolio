import { describe, expect, it } from "vitest";
import { directionOf, isRtl } from "./direction.ts";

describe("direction helpers", () => {
  it("maps locales to writing direction", () => {
    expect(directionOf("en")).toBe("ltr");
    expect(directionOf("ar")).toBe("rtl");
    expect(isRtl("en")).toBe(false);
    expect(isRtl("ar")).toBe(true);
  });
});
