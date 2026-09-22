/**
 * Native presentation writer: a PptxGenJS adapter over a validated
 * ExportModel. Six authored, native editable compositions (see
 * `layouts.ts`) render exact model values with localized human labels —
 * never dashboard screenshots, generated prose, or raw ID lists. Charts
 * are native objects fed with the model's chart values; Arabic decks are
 * separate compositions (right-aligned, RTL paragraphs, unmirrored
 * chronology).
 *
 * Latin text stays on portable Arial; Arabic runs declare an
 * Arabic-capable face (IBM Plex Sans Arabic) as their complex-script
 * font. No embedded fonts, no remote images, no external relationships.
 * Content that cannot fit its box fails with a typed error instead of
 * clipping.
 */
import PptxGenJS from 'pptxgenjs';
import { assertExportModel, DESIGN_TOKENS, sha256Hex } from '@rowfolio/contracts';
import type { ExportArtifact, ExportModel } from '@rowfolio/contracts';
import { isSampleModel, renderSlide, type LayoutContext } from './layouts.ts';

/**
 * Build progress callback. Structural mirror of the contract `Progress`
 * type (deep workspace imports are forbidden by repo convention).
 */
export type Progress = (stage: string, fraction: number | null) => void;

/** Native build output: metadata plus out-of-band bytes. */
export interface BuiltArtifact {
  readonly metadata: ExportArtifact;
  readonly bytes: ArrayBuffer;
}

export class ExportPptxError extends Error {
  readonly code: 'layout-overflow' | 'invalid-model' | 'unsupported-chart';
  constructor(code: ExportPptxError['code'], message: string) {
    super(message);
    this.name = 'ExportPptxError';
    this.code = code;
  }
}

const MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Contract-assigned builder signature, mirrored locally (deep workspace imports are forbidden by repo convention). */
type BuildPresentation = (model: ExportModel, progress: Progress) => Promise<BuiltArtifact>;

export const buildPresentation: BuildPresentation = async (
  model: ExportModel,
  progress: Progress,
): Promise<BuiltArtifact> => {
  progress('model', 0.05);
  assertExportModel(model);
  // Six pages when a scenario is committed, five without — the scenario
  // page is omitted rather than shipped with nothing to say.
  const expectedSlides = model.scenario !== null && model.scenario.status === 'defined' ? 6 : 5;
  if (model.slides.length !== expectedSlides) {
    throw new ExportPptxError('invalid-model', `expected ${expectedSlides} slide descriptors, got ${model.slides.length}`);
  }

  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE';
  pptx.author = 'Rowfolio';
  pptx.title = model.slides[0]?.title ?? 'Rowfolio briefing';

  const rtl = model.locale === 'ar';
  // Theme declares the portable Latin face; Arabic-capable complex-script
  // faces ride on each run via layouts' FONT_AR. Presentation-level rtl
  // hints RTL-aware viewers (it does not mirror geometry or digit shaping).
  pptx.theme = {
    headFontFace: DESIGN_TOKENS.font.deck,
    bodyFontFace: DESIGN_TOKENS.font.deck,
  };
  pptx.rtlMode = rtl;
  const chartById = new Map(model.charts.map((c) => [c.id, c] as const));
  const metricById = new Map(model.metrics.map((m) => [m.id, m] as const));
  for (const scenarioMetric of model.scenario?.metrics ?? []) {
    if (!metricById.has(scenarioMetric.id)) metricById.set(scenarioMetric.id, scenarioMetric);
  }
  const findingById = new Map(model.findings.map((f) => [f.id, f] as const));
  const sample = isSampleModel(model);

  progress('layout', 0.2);

  model.slides.forEach((slide, index) => {
    const ctx: LayoutContext = {
      deck: pptx.addSlide(),
      model,
      slide,
      locale: model.locale,
      rtl,
      align: rtl ? 'right' : 'left',
      metricById,
      chartById,
      findingById,
      isSample: sample,
    };
    renderSlide(ctx);
    progress('charts', 0.2 + (0.6 * (index + 1)) / model.slides.length);
  });

  progress('package', null);
  const bytes = (await pptx.write({ outputType: 'arraybuffer' })) as ArrayBuffer;
  const sha256 = await sha256Hex(new Uint8Array(bytes));
  progress('ready', 1);
  return {
    metadata: {
      exportId: model.exportId,
      format: 'pptx',
      mime: MIME,
      filename: `rowfolio-${model.exportId}.pptx`,
      byteLength: bytes.byteLength,
      sha256,
      binarySlot: 'deck',
    },
    bytes,
  };
};

export { RED } from './layouts.ts';
