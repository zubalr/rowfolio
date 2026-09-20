# tooling/test — independent inspectors and checkers

Dependency-free Node (`node:zlib`, `node:crypto`, `node:fs` only) and a
stdlib-only Python twin. No `package.json` on purpose: this directory is
not a pnpm workspace member (adding it to the workspace would require a
lockfile entry, which belongs to the root-config owner). Everything runs
directly under Node ≥22 via native TypeScript type-stripping.

See `docs/qa/test-harness.md` for the full harness guide.

## Modules

| File | Purpose |
| --- | --- |
| `findings.ts` | `Finding {code, severity, path?, detail}` + predicates |
| `zip.ts` | Independent ZIP reader: EOCD/CD/local-header parse, bounded `inflateRawSync` (entry bytes, expanded bytes, ratio, count from `policy.json`), CRC verification |
| `ooxml.ts` | OOXML package scan: content types, relationships, macro parts, embedded binaries, external/unresolved relationships |
| `cfb.ts` | OLE2 compound-file detector (encrypted .xls/.xlsx legacy container) |
| `csv.ts` | RFC-4180 scanner: formula-prefix injection, cell/row overflow, ragged rows, NUL bytes |
| `envelope.ts` | Worker response shape + freshness (`current`/`stale`/`invalid`), progress monotonicity, binary-slot envelope checks |
| `locale.ts` | Catalog parity: missing/extra keys, placeholder sets, empty values; contract manifest coverage |
| `metrics.ts` | Scale-preserving decimal normalize + exact oracle comparison (`MetricMismatch`) |
| `mutate.ts` | Byte-level mutation builders for planted-defect tests |
| `inspect.ts` | Dispatcher (CFB → ZIP/OOXML → unknown) + `inspectFile`/`inspectBytes` CLI |
| `run_corpus.ts` | Manifest-driven corpus verifier; `--write` emits deterministic `corpus-report.json` |
| `selfcheck.ts` | Battery: every planted mutation must produce its finding |
| `inspect_native.py` | Python stdlib twin of the ZIP/OOXML/CFB checks (cross-oracle) |
| `tests/` | `python3 -m unittest` suite for `inspect_native.py` |

## Finding codes

Namespaced `area.code`, e.g. `zip.crc-mismatch`, `zip.entry-count`,
`ooxml.external-relationship`, `cfb.encryption-marker`,
`csv.formula-prefix`, `envelope.stale`, `locale.missing-key`,
`metric.mismatch`, `inspect.unknown-signature`. Severity: `error` (must
fail) or `warning` (informational; allowed extras on dirty fixtures).

## CLIs

```
node tooling/test/inspect.ts <file...> [--require-clean]
node tooling/test/run_corpus.ts [--write]
node tooling/test/selfcheck.ts
python3 tooling/test/inspect_native.py <file> [--json] [--require-clean]
```

Exit 0 = clean/all detected; 1 = findings or missed expectations.
JSON reports on stdout; human summary on stderr.
