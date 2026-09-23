# fixtures/ingest

Deterministic, synthetic fixture corpus for `@rowfolio/ingest` — regenerated
and hash-verified by the generator:

```bash
node fixtures/ingest/generate.mjs          # regenerate generated/ + manifest.json
node fixtures/ingest/generate.mjs --check  # verify committed bytes match manifest
```

- `zipkit.mjs` — zero-dependency ZIP writer (node:zlib + hand-rolled headers)
  able to emit bytes real libraries refuse: forged encryption flags, path
  traversal, duplicate entries, declared-size lies, wrong compression methods.
- `xlsxkit.mjs` — minimal real OOXML assembler (workbook.xml/rels/sheets/
  styles/sharedStrings) supporting hidden sheets, merges, date systems,
  formula cells with and without caches, external links and macro markers.
- `generated/` — committed binaries, one per case, hashed in
  `generated/manifest.json` (sha256 + byte size + note).
- `sample-*` coverage lives under `fixtures/sample/` (oracle-owned, A02);
  this directory only covers ingest edge cases.

Nothing here is real user data; all strings are synthetic.
