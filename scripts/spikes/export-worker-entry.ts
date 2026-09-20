import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";

// Spike worker: proves the pinned export libraries bundle as a strict-CSP
// module worker and actually produce valid ZIP-native output off-thread.
// Not application code — packages/export-xlsx and packages/export-pptx own the
// real adapters.
function toArrayBuffer(value: unknown): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  }
  throw new Error(`unexpected buffer type: ${Object.prototype.toString.call(value)}`);
}

self.onmessage = async () => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("probe");
    sheet.getCell("A1").value = "probe";
    sheet.getCell("B1").value = 1;
    const xlsx = toArrayBuffer(await workbook.xlsx.writeBuffer());

    const deck = new PptxGenJS();
    const slide = deck.addSlide();
    slide.addText("probe", { x: 0.5, y: 0.5, w: 2, h: 0.5 });
    const pptx = toArrayBuffer(await deck.write({ outputType: "arraybuffer" }));

    (self as unknown as Worker).postMessage({ ok: true, xlsx, pptx }, [xlsx, pptx]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
