# Capture tooling

Screenshot capture for release-candidate media. The tool records exactly what
it captured — URL, commit, viewport, user agent, timestamp, image hash and
dimensions — so any released screenshot or clip can be tied to the build it
came from.

Captures are **never committed**: generated media stays in
`tooling/capture/captures/` (git-ignored) or at a private path outside the
repository.

## Usage

```sh
node tooling/capture/capture.ts \
  --url https://<candidate-host>/en/ \
  --commit "$(git rev-parse HEAD)" \
  --out tooling/capture/captures \
  --name landing-en-desktop
```

Options: `--viewport WxH` (default `1440x1000`), `--full-page`,
`--timeout-ms` (default `30000`), `--name` (output basename). The URL and the
commit are always explicit inputs — the tool never starts a server, guesses a
URL, or invents provenance.

First-time browser setup (already satisfied on machines with Playwright
browsers installed):

```sh
pnpm exec playwright install chromium
```

## Rules for release media

- Capture only from the shipped candidate build (or a local build of it), and
  record that commit. Do not present prototype or design-preview captures as
  the released application.
- No real spreadsheets, personal data, credentials or private paths in any
  frame; use the bundled synthetic sample or other synthetic content.
- Captions and on-screen text must be legible in the captured viewport; check
  English and Arabic captures side by side.
- Keep the raw captures private until release review approves them.

## Known limitation

This tool captures static screenshots only. Video clips and multi-viewport
journeys are driven manually with the same metadata conventions until
dedicated recording support lands.
