# Capture tooling

Screenshot capture for release-candidate media. The tool records exactly what
it captured — URL, commit, viewport, user agent, timestamp, image hash and
dimensions — so any released screenshot or clip can be tied to the build it
came from.

Captures are **never committed**: generated media stays in
`tooling/capture/captures/` (git-ignored) or at a private path outside the
repository.

## Usage

Single shot:

```sh
node tooling/capture/capture.ts \
  --url https://<candidate-host>/en/ \
  --commit "$(git rev-parse HEAD)" \
  --out tooling/capture/captures \
  --name landing-en-desktop
```

Scripted journeys (one PNG + metadata record per step; a step whose control
never appears records an explicit `*-UNAVAILABLE.json` marker together with a
`*-STATE.png` of the stuck screen):

```sh
node tooling/capture/capture.ts --url http://127.0.0.1:4543 \
  --commit "$(git rev-parse HEAD)" --out tooling/capture/captures \
  --journey landing --locale ar --viewport 320x700

node tooling/capture/capture.ts --url http://127.0.0.1:4543 \
  --commit "$(git rev-parse HEAD)" --out tooling/capture/captures \
  --journey upload --locale en --viewport 1440x1000 \
  --upload-file /private/path/synthetic.csv
```

Journeys: `landing` (hero → live preview → evidence → scenario → briefing),
`guide` (guided walkthrough), `workspace-sample` (staged upload review of a
workbook against `#/workspace`), `upload` (landing file intent → analyzed
workspace → evidence → scenario → export). Options: `--viewport WxH`
(default `1440x1000`), `--locale en|ar`, `--upload-file`,
`--reduced-motion`, `--keyboard-probe` (records the focused element in each
step's metadata), `--timeout-ms` (default `30000`). The URL and the commit
are always explicit inputs — the tool never starts a server, guesses a URL,
or invents provenance.

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

Journeys capture stills per step. Video clips, scroll-linked states and
hover-only styling need manual drives under the same metadata conventions
until recording support lands.
