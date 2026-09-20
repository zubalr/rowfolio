/**
 * Chart story matrix — every kind across locales and edge cases. Drives the
 * visual/a11y suite in tests/visual/charts. Specs are the versioned contract
 * examples (src/examples.ts) plus edge variants declared inline.
 */
import type { ChartSpec } from "@rowfolio/contracts";
import { ChartFigure } from "../src/frame.tsx";
import type { ChartLocalization } from "../src/localization.ts";
import type { FixtureLocale } from "../src/dev-localization.ts";
import { AR_LONG_LABELS } from "../src/dev-localization.ts";
import {
  downtimeBarsExample,
  downtimeTrendExample,
  qualityBarsExample,
  scenarioBarsExample,
  targetBarsAllRegionsExample,
  targetBarsExample,
} from "../src/examples.ts";

const edgeSpec: ChartSpec = {
  ...downtimeBarsExample,
  id: "chart-edge",
  points: [
    { key: "neg", labelKey: "period.march", values: { actual: "-45" }, metricIds: ["m-neg"] },
    { key: "zero", labelKey: "period.april", values: { actual: "0" }, metricIds: ["m-zero"] },
    { key: "missing", labelKey: "period.may", values: {}, metricIds: ["m-miss"] },
    { key: "big", labelKey: "period.june", values: { actual: "1565" }, metricIds: ["m-big"] },
  ],
  domain: { min: "-200", max: "1800" },
};

const longArabicSpec: ChartSpec = {
  ...qualityBarsExample,
  id: "chart-quality-long",
  points: qualityBarsExample.points.map((p) => ({ ...p })),
};

export function Gallery({
  locale,
  localization,
}: {
  locale: FixtureLocale;
  localization: ChartLocalization;
}) {
  const ar = locale === "ar";
  return (
    <div className="cg">
      <header className="cg__mast">
        <span className="cg__brand">Rowfolio · charts</span>
        <nav aria-label="Locale">
          <a href="?lang=en" lang="en" data-active={!ar || undefined}>
            English
          </a>
          <a href="?lang=ar" lang="ar" data-active={ar || undefined}>
            العربية
          </a>
        </nav>
      </header>

      <section data-story="target-single">
        <ChartFigure spec={targetBarsExample} localization={localization} />
      </section>

      <section data-story="target-regions">
        <ChartFigure
          spec={targetBarsAllRegionsExample}
          localization={localization}
          emphasisKey="north"
        />
      </section>

      <section data-story="downtime-trend">
        <ChartFigure spec={downtimeTrendExample} localization={localization} />
      </section>

      <section data-story="downtime-bars">
        <ChartFigure spec={downtimeBarsExample} localization={localization} />
      </section>

      <section data-story="quality">
        <ChartFigure spec={qualityBarsExample} localization={localization} />
      </section>

      <section data-story="quality-long-labels">
        <ChartFigure
          spec={longArabicSpec}
          localization={{
            ...localization,
            t: (key, params) => AR_LONG_LABELS[key] ?? localization.t(key, params),
          }}
        />
      </section>

      <section data-story="scenario">
        <ChartFigure spec={scenarioBarsExample} localization={localization} />
      </section>

      <section data-story="edge">
        <ChartFigure spec={edgeSpec} localization={localization} />
      </section>
    </div>
  );
}
