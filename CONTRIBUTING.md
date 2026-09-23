# Contributing to Rowfolio

Thanks for your interest in contributing. This document covers how to set up
the workspace, the project's engineering conventions, and the expectations for
every change.

## Setup

```sh
corepack enable            # provides pnpm 12
pnpm install --frozen-lockfile
pnpm test                  # Vitest unit/contract suites
pnpm typecheck
pnpm lint
pnpm build
```

Python-based fixture tooling needs only Python 3.11+ with the standard
library (see `tooling/test/corpus/README.md`).

## Ground rules

- **Local processing.** The product processes user spreadsheets in the
  browser. Never introduce a runtime service, accounts or remote inference.
  There is no AI API key and no backend. The one permitted exception is
  Vercel Web Analytics on production builds only: coarse pageview counts
  (`beforeSend` reduces every URL to origin + an allowlisted route token,
  custom events are dropped). Never add telemetry, error reporting, or
  custom analytics payloads.
- **Numerical truth.** Analytical values cross package boundaries as finite
  decimal strings. Rounding happens only at named display/export boundaries.
  Source coordinates are one-based physical worksheet positions.
- **Contracts are authority.** `packages/contracts/source/` defines the wire
  schemas, policy values and the translation-key manifest. Do not fork types
  or invent a second definition of a contract object.
- **Tests are gates.** A failing test is a failure, not something to loosen
  or delete. Generated fixtures are committed next to their generator and
  must regenerate byte-identically; explain any difference.
- **Synthetic data only.** Fixtures and samples use invented entities. Never
  commit real personal or business data, credentials, or private reports.
- **Stay in scope.** Ownership of paths is coordinated explicitly. If your
  change needs to touch shared configuration (root manifests, lockfile,
  tsconfig, lint config), propose the exact patch to the maintainers instead
  of committing across boundaries. Do not reformat files you are not
  otherwise changing.

## Making changes

1. Branch from the current default branch and keep the change focused.
2. Add or extend tests for every behavior change, including regressions for
   fixed defects.
3. Run `pnpm test`, `pnpm typecheck` and `pnpm lint` before committing.
4. Commit in small, coherent units with plain, descriptive messages
   (conventional prefixes such as `feat`, `fix`, `docs`, `test`, `chore` are
   appreciated). No internal identifiers in commit messages.
5. In the pull request, state: what changed and why; exact commands run and
   their results; known limitations; any generated-file differences.

## Generated artifacts

Fixtures under `fixtures/` and expectations under `tests/unit/i18n/generated/`
are generated and committed. Regenerate them with the documented tooling
commands rather than editing by hand, and include the regeneration command in
the PR when they change.

## Reporting issues

Open a GitHub issue with a minimal reproduction using synthetic data. For
security-sensitive reports, see [SECURITY.md](SECURITY.md) — please do not
attach real spreadsheets or personal data; a synthetic equivalent is always
sufficient.
