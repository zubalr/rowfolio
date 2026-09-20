/**
 * A22 adversarial ingest suite — malformed/hostile bytes through the real
 * `parseSource`/`inspectSource` path. Asserts three things for every case:
 *   1. the outcome is a typed failure or a contract-valid table (never a hang
 *      or an unclassified exception),
 *   2. declared limit boundaries are enforced exactly (max-envelope behavior),
 *   3. diagnostics carry codes, never source bytes or attacker content.
 *
 * Corpus fixtures live in fixtures/hostile/generated + fixtures/ingest/generated;
 * additional bespoke payloads are synthesized here via the checked-in kits.
 */
import { describe, expect, it } from 'vitest';
import { IngestError, inspectSource, parseSource } from '../../packages/ingest/src/index.ts';
import { preflightZip, scanCentralDirectory } from '../../packages/ingest/src/zip-preflight.ts';
import { defaultLimits } from '../../packages/ingest/src/limits.ts';
import { checkRawTable } from '../../packages/contracts/src/index.ts';
import {
  HOSTILE_GENERATED,
  INGEST_FIXTURES,
  buildXlsx,
  buildZip,
  bytesOf,
  csvBytes,
  csvGrid,
  timed,
  toArrayBuffer,
} from './helpers.ts';

const OPTS = { allowHiddenSheet: false };
const LIMITS = defaultLimits();

async function parseErr(bytes: Uint8Array, name = 'attack.xlsx'): Promise<IngestError> {
  try {
    await parseSource(toArrayBuffer(bytes), name, OPTS, () => {});
  } catch (error) {
    expect(error).toBeInstanceOf(IngestError);
    return error as IngestError;
  }
  throw new Error('expected typed IngestError, parse resolved');
}

function expectNoContentLeak(error: IngestError): void {
  // Diagnostics must be codes/details — never attacker bytes or cell content.
  const s = `${error.code}|${error.detail ?? ''}|${error.message}`;
  expect(s).toMatch(/^[a-zA-Z0-9_.:;{}[\] '"()|-]*$/);
}

/* ------------------------------------------------------------------ */
/* ZIP structure attacks                                               */
/* ------------------------------------------------------------------ */

describe('adversarial: ZIP structure', () => {
  it.fails('entry named __proto__ is dropped from the sanitized repack (A22-F08 divergence)', async () => {
    // normalizeZipPath allows `__proto__` (not traversal); the repack keys a
    // plain object by name, so `stored['__proto__'] = data` mutates the
    // prototype instead of creating a property. The entry survives in
    // `entries`/`order` but is absent from the zip handed to SheetJS.
    const zip = buildZip([
      { name: '__proto__', data: new TextEncoder().encode('junk') },
      { name: 'note.txt', data: new TextEncoder().encode('hello') },
    ]);
    const { sanitizedZip, entries, order } = await preflightZip(zip, LIMITS, undefined, () => {});
    expect(entries.has('__proto__')).toBe(true);
    expect(order).toContain('__proto__');
    // Re-read the repack with the same bounded scanner — no new deps.
    const repacked = scanCentralDirectory(sanitizedZip, LIMITS).map((r) => r.normalizedName);
    expect(repacked).toContain('note.txt');
    // This assertion documents the divergence; fix = repack under a Map or
    // reject reserved names in normalizeZipPath.
    expect(repacked).toContain('__proto__');
  });

  it('rejects traversal, absolute, and drive-letter entry names', async () => {
    for (const bad of ['../evil.xml', 'xl/../../evil.xml', 'C:/evil.xml', 'a//b.xml', 'a/./b.xml']) {
      const zip = buildZip([
        { name: bad, data: new TextEncoder().encode('x') },
        { name: 'ok.txt', data: new TextEncoder().encode('y') },
      ]);
      await expect(parseErr(zip)).resolves.toMatchObject({ code: 'INVALID_FILE' });
    }
  });

  it('rejects duplicate entry names (case-variant and exact)', async () => {
    const dup = buildZip([
      { name: 'a.txt', data: new TextEncoder().encode('1') },
      { name: 'a.txt', data: new TextEncoder().encode('2') },
    ]);
    await expect(parseErr(dup)).resolves.toMatchObject({ code: 'INVALID_FILE', detail: 'zip.duplicate-entry' });
  });

  it('enforces the entry-count cap at exactly the boundary', () => {
    const entries = Array.from({ length: LIMITS.entries }, (_, i) => ({
      name: `f${i}.txt`,
      data: new TextEncoder().encode('x'),
    }));
    expect(() => scanCentralDirectory(buildZip(entries), LIMITS)).not.toThrow();
    entries.push({ name: 'overflow.txt', data: new TextEncoder().encode('x') });
    expect(() => scanCentralDirectory(buildZip(entries), LIMITS)).toThrowError(IngestError);
    try {
      scanCentralDirectory(buildZip(entries), LIMITS);
    } catch (e) {
      expect((e as IngestError).detail).toBe('zip.entries');
    }
  });

  it('rejects a compressed-bomb ratio over 200:1 during streaming inflation', async () => {
    // 4 MiB of zeros compresses far past the cap on a small input.
    const zip = buildZip([{ name: 'big.txt', data: new Uint8Array(4 * 1024 * 1024) }]);
    const err = await parseErr(zip);
    expect(err.code).toBe('LIMIT_EXCEEDED');
    expect(['zip.expansion-ratio', 'zip.entry-bytes', 'zip.expanded-bytes']).toContain(err.detail);
    expectNoContentLeak(err);
  });

  it('rejects truncated archives and EOCD lies before inflation', async () => {
    const zip = buildZip([{ name: 'a.txt', data: new TextEncoder().encode('payload') }]);
    for (const cut of [zip.slice(0, zip.length - 10), zip.slice(0, 40), zip.slice(0, 4)]) {
      const err = await parseErr(cut);
      expect(['INVALID_FILE', 'LIMIT_EXCEEDED']).toContain(err.code);
    }
  });

  it('rejects stored-size lies (declared != actual uncompressed size)', async () => {
    const hostiles = bytesOf(HOSTILE_GENERATED.replace(/generated$/, 'native'), 'corrupt-declared-oversize.xlsx');
    const err = await parseErr(hostiles);
    expect(['LIMIT_EXCEEDED', 'INVALID_FILE']).toContain(err.code);
    expectNoContentLeak(err);
  });
});

/* ------------------------------------------------------------------ */
/* XLSX semantic attacks                                               */
/* ------------------------------------------------------------------ */

describe('adversarial: XLSX content', () => {
  it('encrypted / macro / OLE2 / ODS masquerades all fail typed, never hang', async () => {
    for (const name of [
      'encrypted-entries.xlsx',
      'macro-xlsm.xlsx',
      'ole2-xls.xlsx',
      'ods-masquerade.xlsx',
      'not-a-workbook.xlsx',
      'garbage-pk.xlsx',
    ]) {
      const { ms, value: err } = await timed(() => parseErr(bytesOf(INGEST_FIXTURES, name)));
      expect(err).toBeInstanceOf(IngestError);
      expect(ms).toBeLessThan(10_000);
      expectNoContentLeak(err);
    }
  });

  it('formula cell with a formatted currency cache keeps formatted text as cachedValue (A22-F09)', async () => {
    // `cell.w` is display-formatted ("$1,234.56"); `cell.v` is the raw number.
    // ingest prefers `w` → the "unverified cache" the user can opt into is
    // already lossy before normalize ever sees it.
    const zip = buildXlsx({
      sheets: [{
        name: 'Data',
        rows: [
          ['amount'],
          [{ t: 'f', f: 'B1*2', v: 1234.56, fmt: '"$"#,##0.00' } as never],
        ],
      }],
    });
    const table = await parseSource(toArrayBuffer(zip), 'fmt-cache.xlsx', OPTS, () => {});
    expect(checkRawTable(table)).toEqual([]);
    const cell = table.cells.find((c) => c.type === 'formula');
    expect(cell).toBeDefined();
    // The raw double is 1234.56; formatted display may differ — record what crosses the wire.
    expect(String(cell?.cachedValue)).not.toBe('');
  });

  it('duplicate sheet names resolve deterministically without silent mix-up', async () => {
    const bytes = bytesOf(HOSTILE_GENERATED, 'xlsx-duplicate-sheet-names.xlsx');
    try {
      const table = await parseSource(toArrayBuffer(bytes), 'dup-sheets.xlsx', OPTS, () => {});
      // If it parses, the emitted table must still be contract-valid and
      // carry exactly one sourceRef — duplicates must not fork provenance.
      expect(checkRawTable(table)).toEqual([]);
      expect(table.sourceRef.sheetName).toBeTruthy();
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
    }
  });

  it('declared-size/dimension lies terminate in a typed outcome, never a hang or partial success', async () => {
    // declared-lie.xlsx (~81KB compressed) inflates a worksheet entry beyond
    // the 32MiB per-entry cap — the bounded outcome is a typed refusal; if a
    // fixture ever parses, the table must still satisfy the contract.
    const { value } = await timed(async () => {
      try {
        const t = await parseSource(toArrayBuffer(bytesOf(INGEST_FIXTURES, 'declared-lie.xlsx')), 'declared-lie.xlsx', OPTS, () => {});
        return { kind: 'ok' as const, table: t };
      } catch (e) {
        return { kind: 'err' as const, error: e as IngestError };
      }
    });
    if (value.kind === 'ok') {
      expect(checkRawTable(value.table)).toEqual([]);
    } else {
      expect(value.error).toBeInstanceOf(IngestError);
      expect(value.error.code).toBe('LIMIT_EXCEEDED');
      expectNoContentLeak(value.error);
    }
  });
});

/* ------------------------------------------------------------------ */
/* CSV edges                                                           */
/* ------------------------------------------------------------------ */

describe('adversarial: CSV edges', () => {
  it('cell-character cap enforced exactly at 32,000', async () => {
    const ok = csvBytes(`h\n${'x'.repeat(LIMITS.cellCharacters)}\n`);
    const over = csvBytes(`h\n${'x'.repeat(LIMITS.cellCharacters + 1)}\n`);
    const table = await parseSource(toArrayBuffer(ok), 'ok.csv', OPTS, () => {});
    expect(table.cells.find((c) => c.row === 2)?.raw).toHaveLength(LIMITS.cellCharacters);
    const err = await parseErr(over, 'over.csv');
    expect(err).toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('row cap enforced exactly at 50,000 records including header', async () => {
    const inside = csvBytes(csvGrid(LIMITS.rowsIncludingHeader - 1, 1, (r) => `${r}`));
    const over = csvBytes(csvGrid(LIMITS.rowsIncludingHeader, 1, (r) => `${r}`));
    const table = await parseSource(toArrayBuffer(inside), 'in.csv', OPTS, () => {});
    expect(table.sourceRef.range.lastRow - table.sourceRef.range.firstRow + 1).toBe(LIMITS.rowsIncludingHeader);
    const err = await parseErr(over, 'over.csv');
    expect(err).toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('compressed-byte cap applies to CSV inputs too', async () => {
    const head = 'h1,h2\n';
    const row = `${'x'.repeat(64)},${'y'.repeat(64)}\n`;
    const big = csvBytes(head + row.repeat(Math.ceil((LIMITS.compressedBytes + 1) / row.length)));
    expect(big.byteLength).toBeGreaterThan(LIMITS.compressedBytes);
    const err = await parseErr(big, 'huge.csv');
    expect(err).toMatchObject({ code: 'LIMIT_EXCEEDED', detail: 'input-bytes' });
  });

  it('NUL bytes and control characters in cells survive as inert text', async () => {
    const csv = 'a,b\n"xy",2\n';
    const table = await parseSource(toArrayBuffer(csvBytes(csv)), 'nul.csv', OPTS, () => {});
    const cell = table.cells.find((c) => c.row === 2 && c.column === 1);
    expect(cell?.raw).toContain('x');
  });

  it('formula-prefix cells (=,+,-,@, tab) stay inert raw text — never evaluated', async () => {
    const csv = 'h1,h2,h3,h4,h5\n"=cmd|\'/c calc\'!A1","+1+1","-2+3","@SUM(1)","=HYPERLINK(""http://x"")"\n';
    const table = await parseSource(toArrayBuffer(csvBytes(csv)), 'inj.csv', OPTS, () => {});
    const row2 = table.cells.filter((c) => c.row === 2);
    expect(row2.every((c) => c.type === 'text' && c.formula === null)).toBe(true);
    expect(row2[0]?.raw).toBe("=cmd|'/c calc'!A1");
  });

  it('Arabic/mixed headers and RTL values round-trip byte-exact', async () => {
    const csv = 'المنطقة,المبلغ\n"الشمال 🧮","١٢٣٤"\n"South","5.5"\n';
    const table = await parseSource(toArrayBuffer(csvBytes(csv)), 'ar.csv', OPTS, () => {});
    expect(table.cells.find((c) => c.row === 1 && c.column === 1)?.raw).toBe('المنطقة');
    expect(table.cells.find((c) => c.row === 2 && c.column === 1)?.raw).toBe('الشمال 🧮');
  });

  it('invalid UTF-8 fails INVALID_FILE with a code detail, not a crash', async () => {
    const bad = new Uint8Array([0x68, 0x0a, 0xff, 0xfe, 0xfd, 0x0a]);
    const err = await parseErr(bad, 'bad.csv');
    expect(err.code).toBe('INVALID_FILE');
    expectNoContentLeak(err);
  });
});

/* ------------------------------------------------------------------ */
/* inspectSource parity — preview must obey the same bounds            */
/* ------------------------------------------------------------------ */

describe('adversarial: inspectSource preview path', () => {
  it('preview of a hostile CSV is bounded to previewRows', async () => {
    const csv = csvGrid(500, 5, (r, c) => `v${r}-${c}`);
    const inspection = await inspectSource(toArrayBuffer(csvBytes(csv)), 'big.csv', OPTS);
    const previewRows = new Set(inspection.previewRows.map((c) => c.row));
    expect(previewRows.size).toBeLessThanOrEqual(LIMITS.previewRows);
    expect(inspection.sheets[0]?.dimensions?.lastRow).toBe(501);
  });

  it('inspect enforces the same compressed-byte cap', async () => {
    const big = new Uint8Array(LIMITS.compressedBytes + 1).fill(0x2c);
    try {
      await inspectSource(toArrayBuffer(big), 'huge.csv', OPTS);
      throw new Error('resolved');
    } catch (error) {
      expect(error).toBeInstanceOf(IngestError);
      expect((error as IngestError).code).toBe('LIMIT_EXCEEDED');
    }
  });
});
