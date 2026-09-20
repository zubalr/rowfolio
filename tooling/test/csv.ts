/**
 * Minimal independent CSV scanner (tooling/test) — RFC-4180-style
 * tokenizer used only to detect hostile-input shapes (formula-prefix
 * cells, oversized cells, ragged rows). Not a production parser;
 * Papa Parse owns CSV parsing in packages/ingest.
 */
import { finding, type Finding } from './findings.ts';
import { loadPolicyLimits } from './zip.ts';

export interface CsvScan {
  rows: string[][];
  findings: Finding[];
}

const FORMULA_PREFIX = /^[\t\r ]*[=+\-@]/;

export function scanCsv(text: string, opts: { maxRows?: number } = {}): CsvScan {
  const findings: Finding[] = [];
  const limits = loadPolicyLimits();
  const maxRows = opts.maxRows ?? limits.rowsIncludingHeader;
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      endField();
      i += 1;
      continue;
    }
    if (c === '\n') {
      endRow();
      i += 1;
      continue;
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (c.charCodeAt(0) === 0) {
      findings.push(finding('csv.binary-bytes', 'error', `NUL byte at offset ${i}`));
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (inQuotes) {
    findings.push(finding('csv.unterminated-quote', 'error', 'file ends inside a quoted field'));
  }
  if (field.length > 0 || row.length > 0) endRow();

  if (rows.length > maxRows) {
    findings.push(finding('csv.row-limit', 'error', `${rows.length} rows exceeds limit ${maxRows}`));
  }

  const width = rows[0]?.length ?? 0;
  rows.forEach((r, ri) => {
    if (ri > 0 && r.length !== width) {
      findings.push(finding('csv.ragged-row', 'warning', `row ${ri + 1}: ${r.length} fields vs header ${width}`));
    }
    for (const cell of r) {
      if (cell.length > limits.cellCharacters) {
        findings.push(
          finding('csv.cell-overflow', 'error', `row ${ri + 1}: cell ${cell.length} chars exceeds ${limits.cellCharacters}`),
        );
      }
      if (FORMULA_PREFIX.test(cell)) {
        findings.push(
          finding('csv.formula-prefix', 'warning', `row ${ri + 1}: cell starts with formula-active character`, cell.slice(0, 24)),
        );
      }
    }
  });

  return { rows, findings };
}
