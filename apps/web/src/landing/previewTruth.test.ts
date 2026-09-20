/**
 * Guards the landing preview against fixture drift: every displayed number
 * must reconcile with the independent oracle (fixtures/golden/oracle_report.json)
 * and the golden source spans — never with a value typed into a component.
 * Decimal comparisons use compareDecimal so differing display scales
 * (e.g. "6000000" vs "6000000.00") still mean the same value.
 * Fixture bytes come through bundler `?raw`/JSON imports — node builtins are
 * banned inside src/landing by the lazy-boundary lint rule.
 */
import { describe, expect, it } from "vitest";
import { compareDecimal, type Decimal } from "@rowfolio/contracts";
import oracleJson from "../../../../fixtures/golden/oracle_report.json";
import spansJson from "../../../../fixtures/golden/expected_source_spans.json";
import csv from "../../../../fixtures/sample/sample_operations.csv?raw";
import { LANDING_TRUTH } from "./previewTruth.ts";

const oracle = oracleJson as Record<string, unknown>;
const spans = spansJson as { northJuneRevenue: { spans: { start: number; end: number }[] } };
const csvLines = csv.split("\n");

const eq = (actual: Decimal | null, expected: unknown) => {
  expect(actual).not.toBeNull();
  expect(compareDecimal(actual as Decimal, String(expected))).toBe(0);
};

describe("LANDING_TRUTH", () => {
  it("matches the independent oracle headline figures exactly", () => {
    eq(LANDING_TRUTH.northJune.revenue, oracle["northJuneRevenue"]);
    eq(LANDING_TRUTH.northJune.targetRevenue, oracle["northJuneTarget"]);
    // Below target ⇒ gap shown as a positive share of target (11.9%).
    eq(LANDING_TRUTH.northJune.targetGapRatio, "0.119");
    eq(LANDING_TRUTH.northJune.downtimeMay, oracle["northMayDowntime"]);
    eq(LANDING_TRUTH.northJune.downtimeJune, oracle["northJuneDowntime"]);
    eq(LANDING_TRUTH.northJune.downtimeChangeRatio, oracle["downtimeChangeRatio"]);
    eq(LANDING_TRUTH.northJune.ordersChangeRatio, oracle["northOrderChangeRatio"]);
    eq(LANDING_TRUTH.june.revenue, oracle["juneRevenue"]);
    eq(LANDING_TRUTH.june.operatingCost, oracle["juneCost"]);
    eq(LANDING_TRUTH.june.baselineContribution, oracle["baseContribution"]);
    eq(LANDING_TRUTH.june.baselineMargin, oracle["baseMargin"]);
  });

  it("reproduces the +8% cost scenario arithmetic (margin 25% → 19%)", () => {
    const s = LANDING_TRUTH.computeScenario("0.08");
    eq(s.scenarioCost, "4860000");
    eq(s.contribution, oracle["scenarioContribution"]);
    eq(s.margin, oracle["scenarioMargin"]);
  });

  it("pins the headline finding to the golden physical source span", () => {
    const span = LANDING_TRUTH.northJune.sourceSpan;
    expect(span.sheet).toBe("Operations");
    expect([{ start: span.start, end: span.end }]).toEqual(spans.northJuneRevenue.spans);
  });

  it("excerpt rows are verbatim physical CSV rows 1802–1807", () => {
    LANDING_TRUTH.excerpt.forEach((cells, i) => {
      const line = csvLines[LANDING_TRUTH.northJune.sourceSpan.start - 1 + i];
      expect(line).toBeDefined();
      expect(line?.startsWith(cells.join(","))).toBe(true);
    });
  });

  it("honours the scenario contract bounds", () => {
    eq(LANDING_TRUTH.scenario.minRatio, "-0.2");
    eq(LANDING_TRUTH.scenario.maxRatio, "0.3");
    eq(LANDING_TRUTH.scenario.stepRatio, "0.001");
    const max = LANDING_TRUTH.computeScenario(LANDING_TRUTH.scenario.maxRatio);
    eq(max.margin, "0.025");
  });
});
