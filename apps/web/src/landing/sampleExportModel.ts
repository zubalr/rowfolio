/**
 * The golden contract ExportModels — the exact serialized models the
 * contract suite binds to the sample workbook's source hash and the
 * export writers consume. Scene 6 renders these through the same
 * SlidePreview/WorkbookPreview the export dialog uses, so the previewed
 * deck cannot drift from the downloadable artifact.
 */
import type { ExportModel, SlideModel } from "@rowfolio/contracts";
import modelEnJson from "../../../../tests/contract/fixtures/export-model.en.default.example.json";
import modelArJson from "../../../../tests/contract/fixtures/export-model.ar.default.example.json";

export const SAMPLE_EXPORT_MODEL: Record<"en" | "ar", ExportModel> = {
  en: modelEnJson as unknown as ExportModel,
  ar: modelArJson as unknown as ExportModel,
};

/** The finding slide — the June-North finding the presentation tells. */
export function findingSlide(model: ExportModel): SlideModel {
  return model.slides.find((s) => s.kind === "finding") ?? model.slides[0]!;
}
