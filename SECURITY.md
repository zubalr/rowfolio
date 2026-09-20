# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's "Report a
vulnerability" feature on this repository (Security → Advisories → New
draft security advisory). Please do not open a public issue for anything you
believe is exploitable.

Include:

- a description of the issue and its impact;
- the steps or input needed to reproduce it, using **synthetic data only** —
  never attach real spreadsheets or personal information;
- the commit you tested against and the browser/OS where it applies.

Maintainers respond to acknowledge reports and will coordinate disclosure and
credit with you.

## Scope

Rowfolio is a browser-local application: spreadsheets are parsed and analyzed
in the browser, and the specification excludes accounts, backends, analytics,
remote inference and any transmission of user file contents. Security-relevant
areas therefore include:

- **Ingestion safety.** Uploaded CSV and XLSX are untrusted input. Relevant
  defenses include compressed/expanded byte and entry bounds, rejection of
  encrypted or macro-enabled packages, treating formula cells as inert data,
  and never executing content from a file. Bounded synthetic edge-case
  fixtures live in `fixtures/hostile/generated/`.
- **Client-side execution.** A strict content security policy, no remote
  code, and no injection of user strings into executable contexts (formulas,
  HTML, URLs).
- **Data containment.** Uploaded contents must not leak into storage, URLs,
  logs, exports of other sessions, or public artifacts such as screenshots.

Out of scope: the hosting of the static site itself, and any behavior of
third-party spreadsheet applications opening exported files beyond what our
own tests cover.

## Supported versions

The project is in development; only the latest default branch receives
security fixes. There is no released version yet.

## Policy

- Dependency changes go through review with pinned versions and license
  checks; unspecified upgrades are not merged silently.
- Test fixtures must be safe by construction: no zip bombs, no
  resource-exhaustion payloads, no real personal data.
- A fix for a security report includes a regression test before the issue is
  closed.
