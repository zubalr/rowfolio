# Privacy

**Status: specification and review posture.** The behaviors described here
are contract and test targets for the implementation; the test suites in this
repository (including the privacy gates run before any release) are what make
them verifiable claims.

## The short version

Your spreadsheet is processed in this browser. Rowfolio does not upload its
contents.

## What this means

- **No accounts, no sign-in.** There is nothing to register for.
- **Local processing.** Parsing, analysis, scenarios and export generation
  run in your browser. Opening a spreadsheet does not send its contents — or
  its filename — anywhere.
- **No analytics or telemetry.** The application loads no analytics, error
  reporting, ad or remote-inference services, and ships no AI integration.
- **Nothing persisted.** An analysis session lives in memory. Clearing the
  session or closing the tab ends it; the next visit starts empty. Only an
  interface preference (language and digit style) is kept in local storage.
  Uploaded content never enters storage, URLs, logs or error payloads, and
  dataset state is never encoded in a link.
- **Exports are generated locally.** Workbook and presentation files are
  built in the browser from your session. Exported hyperlinks never embed
  upload contents.

## Honest boundaries

- The site itself must be served from somewhere: your browser fetches the
  application's static files (HTML, scripts, styles, fonts, the bundled
  sample) from its host. Standard request metadata your browser or network
  exposes to that host is outside the application's control and outside the
  local-processing promise above.
- Clearing a session drops in-memory data, but browsers and operating
  systems manage their own memory; no software can promise forensic erasure
  of RAM.
- Nothing in the application can prevent what you choose to do with an
  exported file after downloading it.

## Technical enforcement

The build enforces a strict content security policy (`default-src 'self'`,
no remote code, no `unsafe-eval`, no third-party embeds). Automated browser
tests intercept network traffic and assert that no request after load carries
file contents, including same-origin requests; a canary value uploaded in a
test must never appear in any URL, request body, storage or console output.
