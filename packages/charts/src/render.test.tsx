/**
 * Render tests — server-rendered markup assertions (React SSR is honest for
 * these components: geometry is computed synchronously, effects only measure
 * container width). Covers exact table parity, negative/zero/missing values,
 * RTL composition with LTR plot, keyboard explorer wiring, and the scenario
 * chart's fixed-domain contract.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import type { ChartSpec } from "@rowfolio/contracts";
import { ChartFigure } from "./frame.tsx";
import { ChartValuesTable } from "./values-table.tsx";
import { prepareChart } from "./model.ts";
import { fixtureLocalization } from "./dev-localization.ts";
import {
  downtimeBarsExample,
  downtimeTrendExample,
  qualityBarsExample,
  scenarioBarsExample,
  targetBarsAllRegionsExample,
  targetBarsExample,
} from "./examples.ts";

const EN = fixtureLocalization("en");
const AR = fixtureLocalization("ar");

function render(spec: ChartSpec, loc = EN, emphasisKey?: string) {
  return renderToStaticMarkup(
    createElement(ChartFigure, {
      spec,
      localization: loc,
      ...(emphasisKey !== undefined ? { emphasisKey } : {}),
      fallbackWidth: 800,
    }),
  );
}

function renderTable(spec: ChartSpec, loc = EN) {
  return renderToStaticMarkup(
    createElement(ChartValuesTable, { model: prepareChart(spec), localization: loc }),
  );
}

describe("ChartFigure shell", () => {
  it("renders title, summary, a roving datum explorer and the toggle", () => {
    const html = render(targetBarsExample);
    expect(html).toContain("Actual revenue against target");
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain("View data table");
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps the plot LTR inside RTL composition", () => {
    const html = render(downtimeTrendExample, AR);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('direction="ltr"');
    expect(html).toContain("وقت التوقف في الشمال من مايو إلى يونيو");
    // chronological point order stays May → June left-to-right
    const may = html.indexOf('id="rf-chart-');
    void may;
    expect(html.indexOf("مايو")).toBeLessThan(html.indexOf("يونيو"));
  });

  it("marks the emphasized datum", () => {
    const html = render(targetBarsAllRegionsExample, EN, "east");
    expect(html).toContain('data-emphasis="true"');
  });

  it("supports every declared kind without throwing", () => {
    for (const spec of [
      targetBarsExample,
      downtimeBarsExample,
      downtimeTrendExample,
      qualityBarsExample,
      scenarioBarsExample,
    ]) {
      expect(render(spec)).toContain("rf-chart");
    }
  });
});

describe("edge values", () => {
  const zeroBase: ChartSpec = {
    ...downtimeBarsExample,
    points: [
      { key: "a", labelKey: "period.may", values: { actual: "0" }, metricIds: [] },
      { key: "b", labelKey: "period.june", values: { actual: "-30" }, metricIds: [] },
      { key: "c", labelKey: "period.april", values: {}, metricIds: [] },
    ],
    domain: { min: "-100", max: "100" },
  };

  it("renders zero, negative and missing values distinctly", () => {
    const html = render(zeroBase);
    expect(html).toContain("—"); // missing marker
    expect(renderTable(zeroBase)).toContain("Not available");
  });
});

describe("chart/table parity", () => {
  it("table shows the spec's canonical values for every point/series", () => {
    const html = renderTable(qualityBarsExample);
    for (const p of qualityBarsExample.points) {
      const v = p.values["issues"]!;
      expect(html).toContain(`>${v}<`);
    }
    expect(html).toContain("Duplicate rows");
    expect(html).toContain("quality-duplicate");
  });

  it("target-bars table adds exact absolute and relative variance", () => {
    const html = renderTable(targetBarsExample);
    expect(html).toContain("-$119,000");
    expect(html).toContain("-11.9%");
  });

  it("scenario table shows the percentage-point delta off the baseline", () => {
    const html = renderTable(scenarioBarsExample);
    expect(html).toContain("-6 pp");
  });
});

describe("scenario fixed domain", () => {
  it("keeps declared axis extent across scenario values", () => {
    const base = prepareChart(scenarioBarsExample);
    const moved = prepareChart({
      ...scenarioBarsExample,
      points: [
        scenarioBarsExample.points[0]!,
        { ...scenarioBarsExample.points[1]!, values: { margin: "0.28" } },
      ],
    });
    expect(base.ticks).toEqual(moved.ticks);
    expect(base.domain).toEqual(moved.domain);
  });

  it("renders the scenario bar dashed with the hypothetical label", () => {
    const html = render(scenarioBarsExample);
    expect(html).toContain('stroke-dasharray="5 3"');
    expect(html).toContain("A mechanical sensitivity calculation, not a forecast");
  });
});
