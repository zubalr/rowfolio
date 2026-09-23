/**
 * ZIP preflight: hostile and malformed containers must fail with typed,
 * actionable errors before any unbounded inflation happens.
 */
import { describe, it } from 'vitest';
import { parseSource } from '../../../packages/ingest/src/index.ts';
import { expectIngestError, fixtureBytes, toArrayBuffer } from './helpers.ts';

const NOOP = () => {};
const OPTS = { allowHiddenSheet: false };

const p = (name: string) => parseSource(toArrayBuffer(fixtureBytes(name)), name, OPTS, NOOP);

describe('zip preflight: rejections', () => {
  it('rejects OLE2 containers (real XLS) even with .xlsx name', async () => {
    await expectIngestError(p('ole2-xls.xlsx'), 'UNSUPPORTED', 'ole2-container');
  });

  it('rejects forged encrypted entries (GP flag bit0)', async () => {
    await expectIngestError(p('encrypted-entries.xlsx'), 'UNSUPPORTED', 'zip.encrypted-entry');
  });

  it('rejects macro-enabled packages', async () => {
    await expectIngestError(p('macro-xlsm.xlsx'), 'UNSUPPORTED', 'xlsx.macro-enabled');
  });

  it('rejects ODS masquerading as xlsx', async () => {
    await expectIngestError(p('ods-masquerade.xlsx'), 'UNSUPPORTED', 'xlsx.ods-masquerade');
  });

  it('rejects ZIPs that are not workbooks', async () => {
    await expectIngestError(p('not-a-workbook.xlsx'), 'UNSUPPORTED', 'xlsx.not-a-workbook');
  });

  it('rejects path traversal entries', async () => {
    await expectIngestError(p('path-traversal.xlsx'), 'INVALID_FILE', 'zip.path-traversal');
  });

  it('rejects duplicate normalized entry names', async () => {
    await expectIngestError(p('dup-entry.xlsx'), 'INVALID_FILE', 'zip.duplicate-entry');
  });

  it('rejects >2000 entries', async () => {
    await expectIngestError(p('too-many-entries.xlsx'), 'LIMIT_EXCEEDED', 'zip.entries');
  });

  it('rejects truncated archives', async () => {
    await expectIngestError(p('truncated-zip.xlsx'), 'INVALID_FILE');
  });

  it('rejects PK-magic garbage with no EOCD', async () => {
    await expectIngestError(p('garbage-pk.xlsx'), 'INVALID_FILE', 'zip.eocd-missing');
  });

  it('rejects non-XML workbook parts', async () => {
    await expectIngestError(p('malformed-xml.xlsx'), 'INVALID_FILE');
  });
});

describe('zip preflight: expansion bombs', () => {
  it('halts a deflate bomb at the actual expanded-bytes cap', async () => {
    // ~80MiB of zeros declared honestly — exceeds the 32MiB per-entry cap.
    await expectIngestError(p('bomb.xlsx'), 'LIMIT_EXCEEDED');
  });

  it('halts when the CD size lies (declared 4, actual 80MiB)', async () => {
    // Declared sizes are attacker-controlled; the streaming counter must catch it.
    await expectIngestError(p('declared-lie.xlsx'), 'LIMIT_EXCEEDED');
  });
});
