/**
 * Import-time safety: static prerender entries cannot
 * touch `window`/`document` at module scope. Vitest runs this file in the
 * node environment — importing the barrels must not throw.
 */
import { describe, expect, it } from "vitest";

describe("landing/demo module import safety", () => {
  it("landing barrel imports without a DOM", async () => {
    await expect(import("./index.ts")).resolves.toBeTruthy();
  });

  it("demo barrel imports without a DOM", async () => {
    await expect(import("../demo/index.ts")).resolves.toBeTruthy();
  });
});
