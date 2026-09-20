/**
 * Independent OOXML package inspector (tooling/test).
 *
 * Consumes the zip.ts reader and a small tolerant XML tokenizer to check
 * the package-level invariants from 18_TEST_STRATEGY §Native outputs:
 *  - [Content_Types].xml present and format-appropriate main part exists;
 *  - every .rels part parses and every relationship either resolves to an
 *    existing package part or is explicitly TargetMode="External" — and
 *    external relationships are reported as errors (no external content
 *    may ride inside an export/upload);
 *  - macro-bearing and embedded-binary parts are flagged.
 *
 * The tokenizer is a pull scanner over elements/attributes, not a
 * validating XML parser — sufficient for the small, well-formed markup of
 * .rels and [Content_Types].xml while still reporting gross corruption.
 */
import { finding, hasCode, type Finding } from './findings.ts';
import { extractEntry, loadPolicyLimits, type ZipEntry, type ZipRead } from './zip.ts';

export interface XmlTag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
}

/** Tokenize XML into start/empty/close tags. Throws {offset} on malformed markup. */
export function scanXml(text: string): XmlTag[] {
  const tags: XmlTag[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) throw new Error(`unterminated comment at ${lt}`);
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) throw new Error(`unterminated declaration at ${lt}`);
      i = end + 1;
      continue;
    }
    const closing = text[lt + 1] === '/';
    let j = lt + (closing ? 2 : 1);
    const nameStart = j;
    while (j < n && !/[\s/>]/.test(text[j]!)) j += 1;
    const name = text.slice(nameStart, j);
    if (name.length === 0) {
      const nextCode = text.charCodeAt(lt + 1);
      if (text[lt + 1] === '<' || (nextCode >= 0 && nextCode <= 8)) throw new Error(`bad tag at ${lt}`);
      // stray '<' in text — treat as text and move on
      i = lt + 1;
      continue;
    }
    const attrs: Record<string, string> = {};
    let malformed: string | null = null;
    for (;;) {
      while (j < n && /\s/.test(text[j]!)) j += 1;
      if (j >= n) {
        malformed = 'unterminated tag';
        break;
      }
      if (text.startsWith('/>', j)) {
        j += 2;
        break;
      }
      if (text[j] === '>') {
        j += 1;
        break;
      }
      const aStart = j;
      while (j < n && !/[\s=/>]/.test(text[j]!)) j += 1;
      const aName = text.slice(aStart, j);
      while (j < n && /\s/.test(text[j]!)) j += 1;
      if (text[j] !== '=') {
        malformed = `attribute ${aName} missing '='`;
        break;
      }
      j += 1;
      while (j < n && /\s/.test(text[j]!)) j += 1;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") {
        malformed = `attribute ${aName} missing quote`;
        break;
      }
      j += 1;
      const vStart = j;
      while (j < n && text[j] !== quote) j += 1;
      if (j >= n) {
        malformed = `attribute ${aName} unterminated`;
        break;
      }
      attrs[aName] = text.slice(vStart, j);
      j += 1;
    }
    if (malformed) throw new Error(`${malformed} at ${lt}`);
    tags.push({ name, attrs, closing });
    i = j;
  }
  return tags;
}

export function localName(tag: string): string {
  const i = tag.lastIndexOf(':');
  return i < 0 ? tag : tag.slice(i + 1);
}

/** Resolve a relationship Target relative to the part that owns the .rels. */
export function resolveRelationshipTarget(relsPartName: string, target: string): string | null {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return null; // absolute URI — external by nature
  // "/xl/_rels/workbook.xml.rels" owns "xl/workbook.xml" → base dir "xl/"
  const ownerDir = relsPartName.replace(/(^|\/)_rels\/[^/]+\.rels$/, '$1');
  const joined = target.startsWith('/') ? target.slice(1) : ownerDir + target;
  const out: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null; // escapes the package root
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

export interface PackageReport {
  kind: 'ooxml-xlsx' | 'ooxml-pptx' | 'ooxml-other' | 'zip-generic';
  parts: string[];
  findings: Finding[];
}

const RELS_RE = /(^|\/)_rels\/[^/]+\.rels$/;
const MACRO_PART_RE = /vbaProject|activeX|ctrlProp/i;
const EMBEDDED_BINARY_RE = /\.(bin|oleObject|o)$/i;

export function inspectPackage(zip: ZipRead, bytes: Uint8Array): PackageReport {
  const findings: Finding[] = [...zip.findings];
  const parts = zip.entries.map((e) => e.name);
  const partSet = new Set(parts);
  const limits = loadPolicyLimits();

  const byName = new Map<string, ZipEntry>(zip.entries.map((e) => [e.name, e]));

  const readText = (name: string): { text: string | null; findings: Finding[] } => {
    const e = byName.get(name);
    if (!e) return { text: null, findings: [] };
    const r = extractEntry(bytes, e, limits);
    if (r.data === null) return { text: null, findings: r.findings };
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(r.data), findings: r.findings };
  };

  // --- [Content_Types].xml ---------------------------------------------------
  if (!partSet.has('[Content_Types].xml')) {
    findings.push(finding('ooxml.missing-content-types', 'error', '[Content_Types].xml is absent — not an OOXML package'));
    return { kind: 'zip-generic', parts, findings };
  }
  const ct = readText('[Content_Types].xml');
  findings.push(...ct.findings);
  if (ct.text === null) {
    return { kind: 'zip-generic', parts, findings };
  }
  let ctTags: XmlTag[];
  try {
    ctTags = scanXml(ct.text);
  } catch (err) {
    findings.push(finding('ooxml.bad-xml', 'error', `[Content_Types].xml: ${(err as Error).message}`, '[Content_Types].xml'));
    return { kind: 'ooxml-other', parts, findings };
  }
  const contentTypes = ctTags
    .filter((t) => localName(t.name) === 'Override' || localName(t.name) === 'Default')
    .map((t) => String(t.attrs['ContentType'] ?? ''));
  const kind = contentTypes.some((c) => c.includes('spreadsheetml'))
    ? 'ooxml-xlsx'
    : contentTypes.some((c) => c.includes('presentationml'))
      ? 'ooxml-pptx'
      : 'ooxml-other';
  if (contentTypes.some((c) => c.includes('macroEnabled'))) {
    findings.push(finding('ooxml.macro-content', 'error', 'macroEnabled content type declared', '[Content_Types].xml'));
  }

  // --- required main part ----------------------------------------------------
  if (kind === 'ooxml-xlsx' && !partSet.has('xl/workbook.xml')) {
    findings.push(finding('ooxml.missing-main-part', 'error', 'xl/workbook.xml absent from spreadsheet package'));
  }
  if (kind === 'ooxml-pptx' && !partSet.has('ppt/presentation.xml')) {
    findings.push(finding('ooxml.missing-main-part', 'error', 'ppt/presentation.xml absent from presentation package'));
  }

  // --- macro / embedded binary parts -----------------------------------------
  for (const name of parts) {
    if (MACRO_PART_RE.test(name)) {
      findings.push(finding('ooxml.macro-part', 'error', 'macro/ActiveX part present', name));
    } else if (EMBEDDED_BINARY_RE.test(name) && !name.endsWith('printerSettings.bin')) {
      findings.push(finding('ooxml.embedded-binary', 'warning', 'embedded binary part', name));
    }
    if (/externalLinks?\//i.test(name)) {
      findings.push(finding('ooxml.external-link-part', 'warning', 'externalLink part present', name));
    }
  }

  // --- relationships ----------------------------------------------------------
  for (const name of parts) {
    if (!RELS_RE.test(name)) continue;
    const r = readText(name);
    findings.push(...r.findings);
    if (r.text === null) continue;
    let tags: XmlTag[];
    try {
      tags = scanXml(r.text);
    } catch (err) {
      findings.push(finding('ooxml.bad-xml', 'error', `${(err as Error).message}`, name));
      continue;
    }
    for (const t of tags) {
      if (localName(t.name) !== 'Relationship' || t.closing) continue;
      const target = String(t.attrs['Target'] ?? '');
      const targetMode = t.attrs['TargetMode'];
      const id = t.attrs['Id'] ?? '?';
      if (targetMode === 'External' || resolveRelationshipTarget(name, target) === null) {
        findings.push(
          finding('ooxml.external-relationship', 'error', `relationship ${id} targets external resource ${JSON.stringify(target)}`, name),
        );
        continue;
      }
      const resolved = resolveRelationshipTarget(name, target);
      if (resolved !== null && !partSet.has(resolved)) {
        findings.push(
          finding(
            'ooxml.unresolved-relationship',
            'error',
            `relationship ${id} resolves to missing part ${JSON.stringify(resolved)}`,
            name,
          ),
        );
      }
    }
  }

  return { kind, parts, findings };
}

export const ooxmlHasCode = hasCode;
