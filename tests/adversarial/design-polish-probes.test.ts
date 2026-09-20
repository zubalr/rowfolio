/**
 * Adversarial probes for the design-polish delta (landing/guide/dashboard
 * polish + new tooling/capture harness + display-path changes).
 *
 * Coverage:
 *  - input boundaries on the new capture tooling (env-var → shell/path)
 *  - egress surface of new/changed modules (tooling + touched app files)
 *  - hostile-decimal handling on the new formatting paths
 *    (formatPercentAbs options param, findingBody param interpolation)
 *
 * All cases are regression locks — the four originally-demonstrated
 * defects (harness env injection, path joins, validate-before-strip,
 * percent magnitude) are fixed on integration.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createI18n } from '../../packages/i18n/src/index.ts';
import { formatDecimal, formatInteger, formatPercentAbs } from '../../apps/web/src/workspace/format.ts';
import { findingBody } from '../../apps/web/src/workspace/findingCopy.ts';
import type { AnalysisSnapshot, Decimal, Finding, Metric, Scope } from '../../packages/contracts/src/types.ts';
import { I18nError } from '../../packages/i18n/src/index.ts';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;
const CAPTURE_DIR = join(REPO_ROOT, 'tooling/capture');
const CAPTURE_SCRIPTS = ['design-capture.mjs', 'design-record.mjs', 'design-simulate.mjs', 'capture.ts'];

/* ------------------------------------------------------------------ */
/* Input boundary: env-var → shell/path                                 */
/* ------------------------------------------------------------------ */

describe('adversarial: capture-harness env boundaries', () => {
  it('REPO env var must not alter the shell structure of the harness exec call', () => {
    // design-capture.mjs runs `execSync(`git -C ${REPO} rev-parse HEAD`)`
    // with REPO straight from the environment — a metachar-laden REPO
    // injects a second command into the developer's shell.
    const marker = '/tmp/RF_HARNESS_INJ';
    rmSync(marker, { force: true });
    rmSync('/tmp;touch', { recursive: true, force: true }); // litter from the OUT join
    const child = spawnSync(
      process.execPath,
      [join(CAPTURE_DIR, 'design-capture.mjs')],
      {
        env: { ...process.env, REPO: '/tmp;touch /tmp/RF_HARNESS_INJ;#', SKIP_A: '1' },
        timeout: 30_000,
      },
    );
    // The harness is expected to die (no dev server / chromium); the marker
    // must not exist either way.
    void child;
    expect(existsSync(marker)).toBe(false);
  });

  it('REPO env path joins must be consistent (no ${REPO}x interpolations)', () => {
    // `${REPO}tooling/...` (no separator) vs `${REPO}/apps/...` — whichever
    // convention the operator uses for REPO, one of the joins is wrong:
    // REPO=/x → OUT=/xtooling/... , or REPO=/x/ → SAMPLE=/x//apps/...
    for (const name of CAPTURE_SCRIPTS) {
      const src = readFileSync(join(CAPTURE_DIR, name), 'utf8');
      expect(src, `${name}: bare \${REPO} join (missing separator)`).not.toMatch(/\$\{REPO\}[^/}]/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Egress surface of new/changed modules                                */
/* ------------------------------------------------------------------ */

const EGRESS_PRIMITIVES =
  /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource|navigator\.send|axios|node:http|node:https|node:net|node:tls|\.request\s*\(/;
const REMOTE_URL = /https?:\/\/[^\s'"`)\]]+/g;
const URL_ALLOWLIST = /^https?:\/\/(localhost|127\.0\.0\.1|example\.com)/;
const CODE_PRIMITIVES = /dangerouslySetInnerHTML|innerHTML\s*=|eval\s*\(|new\s+Function/;

/** Every file this branch adds or touches in app + tooling. */
const DELTA_FILES = [
  'apps/web/src/evidence/EvidencePanel.tsx',
  'apps/web/src/landing/PreviewStage.tsx',
  'apps/web/src/landing/landing.css',
  'apps/web/src/workspace/KpiStrip.tsx',
  'apps/web/src/workspace/findingCopy.ts',
  'apps/web/src/workspace/format.ts',
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

describe('adversarial: egress surface of design-polish modules', () => {
  it('capture tooling makes no outbound network calls beyond the operator-supplied URL', () => {
    const offenders: string[] = [];
    for (const file of walk(CAPTURE_DIR)) {
      if (!/\.(mjs|ts|js)$/.test(file)) continue;
      const src = readFileSync(file, 'utf8');
      if (EGRESS_PRIMITIVES.test(src)) offenders.push(`${file}: network primitive`);
      for (const url of src.match(REMOTE_URL) ?? []) {
        if (!URL_ALLOWLIST.test(url)) offenders.push(`${file}: ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('changed app modules introduce no egress primitives, remote URLs, or HTML sinks', () => {
    const offenders: string[] = [];
    for (const rel of DELTA_FILES) {
      const src = readFileSync(join(REPO_ROOT, rel), 'utf8');
      if (EGRESS_PRIMITIVES.test(src)) offenders.push(`${rel}: network primitive`);
      if (CODE_PRIMITIVES.test(src)) offenders.push(`${rel}: code-injection sink`);
      for (const url of src.match(REMOTE_URL) ?? []) {
        if (!URL_ALLOWLIST.test(url)) offenders.push(`${rel}: ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Display-path hostile inputs (new options param + param interpolation) */
/* ------------------------------------------------------------------ */

const i18nEn = createI18n({ locale: 'en' });
const i18nAr = createI18n({ locale: 'ar' });

describe('adversarial: workspace formatting boundaries', () => {
  it('non-canonical decimals are refused with typed I18nError on the new percent path', () => {
    for (const bad of ['abc', '', '1e5', '.5', '5.', 'NaN', '0,5', '١٢٣', '01', '5..0']) {
      const attempt = () => formatPercentAbs(i18nEn, bad as Decimal, { maxFractionDigits: 1 });
      expect(attempt, `input ${JSON.stringify(bad)}`).toThrowError(I18nError);
      expect(attempt, `input ${JSON.stringify(bad)}`).toThrowError(/decimal/i);
    }
  });

  it('formatPercentAbs strips sign and applies fraction bound deterministically', () => {
    expect(formatPercentAbs(i18nEn, '-0.119' as Decimal, { maxFractionDigits: 1 })).toBe(
      formatPercentAbs(i18nEn, '0.119' as Decimal, { maxFractionDigits: 1 }),
    );
    // 11.9% with maxFractionDigits:1 — never emits a raw input string.
    expect(formatPercentAbs(i18nEn, '-0.119' as Decimal, { maxFractionDigits: 1 })).toBe('11.9%');
    // Huge magnitudes stay exact-string deterministic, not scientific.
    const huge = formatPercentAbs(i18nEn, '-99999999999999999999.9' as Decimal);
    expect(huge).not.toMatch(/e\+|NaN|undefined/i);
    expect(formatPercentAbs(i18nAr, '-0.55' as Decimal)).toBe(formatPercentAbs(i18nAr, '-0.55' as Decimal));
  });

  it('formatPercentAbs must validate the input before stripping its sign', () => {
    // stripSign runs BEFORE formatPercent's canonical check: '--1' → '-1' →
    // renders '100%', and '-0' → '0' → '0%'. Non-canonical strings silently
    // format instead of throwing — the input boundary is bypassed by the
    // wrapper.
    expect(() => formatPercentAbs(i18nEn, '--1' as Decimal)).toThrowError(I18nError);
    expect(() => formatPercentAbs(i18nEn, '-0' as Decimal)).toThrowError(I18nError);
  });

  it('formatPercent must not drop a magnitude on single-fraction-digit inputs (percent-shift defect)', () => {
    // i18n `shiftForPercent` concatenates integer+fraction digits and pads
    // LEFT to integer.length+2 — with a 1-digit fraction the padding lands
    // the decimal point one place early, so the rendered percent is 10x
    // small: '0.5' → '5%' (correct: '50%'), '1.5' → '15%' (correct:
    // '150%'), '0.9' → '9%'. Values with ≥2 fraction digits are unaffected
    // ('0.55' → '55%'). This path feeds findings copy, KpiStrip and
    // EvidencePanel — a real falsified-output surface.
    expect(i18nEn.formatPercent('0.5' as Decimal)).toBe('50%');
    expect(i18nEn.formatPercent('1.5' as Decimal)).toBe('150%');
    expect(i18nEn.formatPercent('0.9' as Decimal)).toBe('90%');
  });

  it('formatInteger refuses fractional input (EvidencePanel eligibleRows path)', () => {
    expect(() => formatInteger(i18nEn, '10.5' as Decimal)).toThrowError(I18nError);
    expect(formatInteger(i18nEn, '2000000' as Decimal)).toMatch(/2/);
  });

  it('formatDecimal on unknown-kind units falls back to plain number (no label leak)', () => {
    const out = formatDecimal(i18nEn, '42.5' as Decimal, { kind: 'unknown', label: 'units??', currency: null });
    expect(out).toBe('42.5');
    expect(out).not.toContain('units??');
  });

  it('findingBody only interpolates metrics the finding actually claims', () => {
    const scope: Scope = {
      tableId: 't1',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      regions: [],
      complete: true,
      coverageNoteKey: 'scope.full',
    };
    const metric = (id: string, value: Decimal | null): Metric => ({
      id,
      labelKey: 'metric.x',
      value,
      status: value === null ? 'undefined' : 'defined',
      reasonKey: null,
      unit: { kind: 'ratio', label: '', currency: null },
      scope,
      eligibleRows: 0,
      totalRows: 0,
      provenanceId: 'p',
      warnings: [],
    });
    const snapshot = {
      metrics: [
        metric('north-target-gap', '0.119' as Decimal),
        metric('north-orders-change', '0.55' as Decimal), // present but NOT claimed
      ],
    } as unknown as AnalysisSnapshot;
    const finding = {
      id: 'finding-north-1',
      ruleId: 'r',
      kind: 'target-gap',
      severity: 'attention',
      titleKey: 'finding.north.title',
      bodyKey: 'finding.north.body',
      metricIds: ['north-target-gap'], // claims gap only — orders must stay uninterpolated
      provenanceIds: [],
      qualityIssueIds: [],
      scope,
      rank: { classPriority: 1, coverage: '0' as Decimal, magnitude: '0' as Decimal },
      chartId: null,
      limitations: [],
    } as Finding;
    const body = findingBody(i18nEn, snapshot, finding);
    // tSafe falls back to the generic error text when a planned param is
    // missing — either way the unclaimed metric's value never appears.
    expect(body).not.toContain('55%');

    const claimed = { ...finding, metricIds: ['north-target-gap', 'north-orders-change'] } as Finding;
    const fullBody = findingBody(i18nEn, snapshot, claimed);
    expect(fullBody).toContain('11.9%');
    expect(fullBody).toContain('55%');
  });
});
