/**
 * Minimal XML scanning for OOXML package metadata. This is NOT a general
 * XML parser — it reads the small, machine-generated package parts
 * (workbook.xml, .rels, content types, sheet <dimension>) needed for sheet
 * listing and classification. Sheet data itself goes through SheetJS.
 */

/** Attributes of a single XML tag; both quote styles; namespace prefixes kept. */
export function parseAttrs(tagInner: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tagInner)) !== null) {
    const key = m[1] ?? '';
    const raw = m[3] ?? m[4] ?? '';
    attrs[key] = xmlDecode(raw);
  }
  return attrs;
}

/** Iterate `<tag ...>` elements whose local name matches `localName` (any ns prefix). */
export function* elements(xml: string, localName: string): Generator<Record<string, string>> {
  const re = new RegExp(`<(?:[A-Za-z0-9_]+:)?${localName}\\b([^>]*?)/?>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    yield parseAttrs(m[1] ?? '');
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

export function xmlDecode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (whole, ent: string) => {
    if (ent.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ent.slice(2), 16));
    if (ent.startsWith('#')) return String.fromCodePoint(Number.parseInt(ent.slice(1), 10));
    return ENTITIES[ent] ?? whole;
  });
}

/** A1-style cell ref → 1-based {row, column}; null when not a cell ref. */
export function cellRefToCoords(ref: string): { row: number; column: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?([0-9]+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  const letters = (m[1] ?? '').toUpperCase();
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = Number.parseInt(m[2] ?? '', 10);
  if (!Number.isFinite(row) || col < 1) return null;
  return { row, column: col };
}

/** `<dimension ref="A1:K2418">` or `ref="B2"` → 1-based bounds; null when absent. */
export function parseDimensionRef(
  ref: string | undefined,
): { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number } | null {
  if (!ref) return null;
  const [a, b] = ref.split(':');
  const start = a ? cellRefToCoords(a) : null;
  const end = b ? cellRefToCoords(b) : start;
  if (!start || !end) return null;
  return {
    firstRow: Math.min(start.row, end.row),
    lastRow: Math.max(start.row, end.row),
    firstColumn: Math.min(start.column, end.column),
    lastColumn: Math.max(start.column, end.column),
  };
}

/** Resolve a relationship Target relative to the rels owner's directory. */
export function resolveTarget(ownerDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (ownerDir === '' ? target : `${ownerDir}/${target}`).split('/');
  const out: string[] = [];
  for (const seg of parts) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}
