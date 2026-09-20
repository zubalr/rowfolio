# Vendored dependencies

## `xlsx-0.20.3.tgz` — SheetJS Community Edition 0.20.3

- **Upstream:** https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz (the authoritative
  SheetJS CDN; the public npm `xlsx` registry entry is stale at 0.18.5 — never
  install `xlsx` from the registry by name)
- **Package name installed:** `xlsx` (via `file:../../vendor/xlsx-0.20.3.tgz`
  in `packages/ingest/package.json`)
- **License:** Apache-2.0 (license text inside the tarball at `package/LICENSE`;
  reproduced in `THIRD_PARTY_NOTICES.md`)
- **SHA-256 of this tarball:** `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`
- **pnpm lockfile integrity (sha512):** `sha512-oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==`
- **Fetched:** 2026-09-20, from the official CDN over TLS.
- **Consumer:** `@rowfolio/ingest` only. All other packages are banned from
  importing `xlsx` by `eslint.config.mjs`.
- **Re-verify:** `sha256sum vendor/xlsx-0.20.3.tgz` must equal the SHA-256 above.
  `pnpm audit:licenses` re-checks this automatically.
