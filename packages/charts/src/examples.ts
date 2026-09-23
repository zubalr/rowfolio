/**
 * Versioned examples — contract v1.0.0 `ChartSpec` fixtures mirroring
 * `tests/contract/fixtures/analysis-snapshot.example.json` plus the scenario
 * chart from `fixtures/export-model.en.example.json`. Tests and the visual
 * gallery consume these; they are the fixed-sample truth, not mocks of it.
 */
import type { ChartSpec, Scope } from "@rowfolio/contracts";

const NORTH_SCOPE: Scope = {
  tableId: "operations-v1",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  regions: ["North"],
  complete: true,
  coverageNoteKey: "coverage.scheduledComplete",
};

const ALL_SCOPE: Scope = {
  tableId: "operations-v1",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  regions: [],
  complete: true,
  coverageNoteKey: "coverage.scheduledComplete",
};

const QUALITY_SCOPE: Scope = {
  tableId: "operations-v1",
  periodStart: null,
  periodEnd: null,
  regions: [],
  complete: true,
  coverageNoteKey: "coverage.allSource",
};

export const CHART_SPEC_VERSION = "1.0.0" as const;

export const targetBarsExample: ChartSpec = {
  id: "chart-north-target",
  kind: "target-bars",
  titleKey: "chart.north.title",
  summaryKey: "chart.north.summary",
  unit: { kind: "currency", label: "USD", currency: "USD" },
  series: [
    { id: "actual", labelKey: "common.actual", semantic: "observed" },
    { id: "target", labelKey: "common.target", semantic: "target" },
  ],
  points: [
    {
      key: "north",
      labelKey: "region.North",
      values: { actual: "881000", target: "1000000" },
      metricIds: ["north-june-revenue", "north-june-target"],
    },
  ],
  domain: { min: "0", max: "1100000" },
  chronology: "not-temporal",
  scope: NORTH_SCOPE,
  provenanceIds: ["north-june-revenue-proof", "north-june-target-proof"],
};

/** Six-region variant used to exercise the multi-category layout. */
export const targetBarsAllRegionsExample: ChartSpec = {
  ...targetBarsExample,
  id: "chart-all-regions-target",
  points: [
    {
      key: "north",
      labelKey: "region.North",
      values: { actual: "881000", target: "1000000" },
      metricIds: ["north-june-revenue", "north-june-target"],
    },
    {
      key: "south",
      labelKey: "region.South",
      values: { actual: "1240000", target: "1150000" },
      metricIds: ["south-june-revenue", "south-june-target"],
    },
    {
      key: "east",
      labelKey: "region.East",
      values: { actual: "1030000", target: "1100000" },
      metricIds: ["east-june-revenue", "east-june-target"],
    },
    {
      key: "west",
      labelKey: "region.West",
      values: { actual: "980000", target: "1000000" },
      metricIds: ["west-june-revenue", "west-june-target"],
    },
    {
      key: "central",
      labelKey: "region.Central",
      values: { actual: "1125000", target: "1050000" },
      metricIds: ["central-june-revenue", "central-june-target"],
    },
    {
      key: "coast",
      labelKey: "region.Coast",
      values: { actual: "744000", target: "800000" },
      metricIds: ["coast-june-revenue", "coast-june-target"],
    },
  ],
  scope: ALL_SCOPE,
};

export const downtimeTrendExample: ChartSpec = {
  id: "chart-downtime-trend",
  kind: "line",
  titleKey: "chart.downtime.title",
  summaryKey: "chart.downtime.summary",
  unit: { kind: "minutes", label: "minutes", currency: null },
  series: [{ id: "actual", labelKey: "common.actual", semantic: "observed" }],
  points: [
    {
      key: "2026-03",
      labelKey: "period.march",
      values: { actual: "1040" },
      metricIds: ["north-march-downtime"],
    },
    {
      key: "2026-04",
      labelKey: "period.april",
      values: { actual: "1120" },
      metricIds: ["north-april-downtime"],
    },
    {
      key: "2026-05",
      labelKey: "period.may",
      values: { actual: "1194" },
      metricIds: ["north-may-downtime"],
    },
    {
      key: "2026-06",
      labelKey: "period.june",
      values: { actual: "1565" },
      metricIds: ["north-june-downtime"],
    },
  ],
  domain: { min: "0", max: "1800" },
  chronology: "ltr",
  scope: NORTH_SCOPE,
  provenanceIds: [
    "north-march-downtime-proof",
    "north-april-downtime-proof",
    "north-may-downtime-proof",
    "north-june-downtime-proof",
  ],
};

export const downtimeBarsExample: ChartSpec = {
  id: "chart-downtime",
  kind: "bars",
  titleKey: "chart.downtime.title",
  summaryKey: "chart.downtime.summary",
  unit: { kind: "minutes", label: "minutes", currency: null },
  series: [{ id: "actual", labelKey: "common.actual", semantic: "observed" }],
  points: [
    {
      key: "2026-05",
      labelKey: "period.may",
      values: { actual: "1194" },
      metricIds: ["north-may-downtime"],
    },
    {
      key: "2026-06",
      labelKey: "period.june",
      values: { actual: "1565" },
      metricIds: ["north-june-downtime"],
    },
  ],
  domain: { min: "0", max: "1800" },
  chronology: "ltr",
  scope: NORTH_SCOPE,
  provenanceIds: ["north-may-downtime-proof", "north-june-downtime-proof"],
};

export const qualityBarsExample: ChartSpec = {
  id: "chart-quality",
  kind: "quality-bars",
  titleKey: "chart.quality.title",
  summaryKey: "chart.quality.summary",
  unit: { kind: "count", label: "records", currency: null },
  series: [{ id: "issues", labelKey: "quality.issues", semantic: "attention" }],
  points: [
    {
      key: "duplicate",
      labelKey: "quality.duplicate",
      values: { issues: "17" },
      metricIds: ["quality-duplicate"],
    },
    {
      key: "category",
      labelKey: "quality.category",
      values: { issues: "7" },
      metricIds: ["quality-category"],
    },
    {
      key: "missing",
      labelKey: "quality.missing",
      values: { issues: "5" },
      metricIds: ["quality-missing"],
    },
  ],
  domain: { min: "0", max: "20" },
  chronology: "not-temporal",
  scope: QUALITY_SCOPE,
  provenanceIds: ["quality-duplicate-proof", "quality-category-proof", "quality-missing-proof"],
};

export const scenarioBarsExample: ChartSpec = {
  id: "chart-scenario",
  kind: "scenario-bars",
  titleKey: "chart.scenario.title",
  summaryKey: "chart.scenario.summary",
  unit: { kind: "ratio", label: "fraction", currency: null },
  series: [{ id: "margin", labelKey: "metric.margin", semantic: "scenario" }],
  points: [
    {
      key: "baseline",
      labelKey: "common.baseline",
      values: { margin: "0.25" },
      metricIds: ["june-margin"],
    },
    {
      key: "scenario",
      labelKey: "common.scenario",
      values: { margin: "0.19" },
      metricIds: ["scenario-margin"],
    },
  ],
  domain: { min: "0", max: "0.30" },
  chronology: "not-temporal",
  scope: ALL_SCOPE,
  provenanceIds: ["june-margin-proof", "scenario-margin-proof"],
};

export const CHART_EXAMPLES: readonly ChartSpec[] = [
  targetBarsExample,
  targetBarsAllRegionsExample,
  downtimeTrendExample,
  downtimeBarsExample,
  qualityBarsExample,
  scenarioBarsExample,
];
