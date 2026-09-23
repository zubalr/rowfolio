import { useState } from 'react';
import { Button, Field, Section } from '@rowfolio/ui';
import { ChartFigure } from '@rowfolio/charts';
import type { I18n, MessageKey } from '@rowfolio/i18n';
import { useI18n, useServices, useSessionState } from '../app/context.tsx';
import { formatDecimal } from './format.ts';
import { chartLocalization } from './chartLocalization.ts';
import { scenarioChartSpec } from './stageModel.ts';

/**
 * Scenario panel — "What if operating costs change?" The typed value is a
 * percent; submit sends the canonical fraction decimal to the scenario op.
 * Only the committed result renders; the in-flight request is guarded.
 */
export function ScenarioPanel() {
  const i18n = useI18n();
  const { controller } = useServices();
  const state = useSessionState();
  const scenario = state.scenario;
  const pending = state.scenarioRequestId !== null;
  const [validationKey, setValidationKey] = useState<string | null>(null);

  const onSubmit = async () => {
    const parsed = parsePercentInput(i18n, state.scenarioInput);
    if (parsed === null) {
      setValidationKey('scenario.invalid');
      return;
    }
    setValidationKey(null);
    await controller.submitScenario(parsed);
  };

  const marginMetric = scenario?.metrics.find((m) => m.labelKey === 'metric.margin');
  const contributionMetric = scenario?.metrics.find((m) => m.labelKey === 'metric.contribution');
  // Baseline margin lives in the committed analysis snapshot, not the result.
  const baselineMargin = state.active?.snapshot.metrics.find((m) => m.labelKey === 'metric.margin') ?? null;
  const scenarioChart =
    scenario !== null && state.active !== null
      ? scenarioChartSpec(state.active.snapshot, scenario)
      : null;

  return (
    <Section title={i18n.tSafe('scenario.title' as MessageKey)}>
      <p className="rf-quiet">{i18n.tSafe('scenario.question' as MessageKey)}</p>
      <div className="rf-scenario-row">
        <Field
          label={i18n.tSafe('scenario.costChange' as MessageKey)}
          unit="%"
          error={validationKey ? i18n.tSafe(validationKey as MessageKey) : undefined}
          inputProps={{
            ['data-testid' as never]: 'scenario-cost-input',
            inputMode: 'decimal',
            value: state.scenarioInput,
            onChange: (e) => controller.setScenarioInput(e.target.value),
            disabled: pending,
            dir: 'ltr',
          }}
        />
        <Button variant="primary" onClick={() => void onSubmit()} disabled={pending}>
          {i18n.tSafe('scenario.question' as MessageKey)}
        </Button>
        {scenario && (
          <button type="button" className="rf-linkbtn" onClick={() => controller.resetScenario()}>
            {i18n.tSafe('action.reset' as MessageKey)}
          </button>
        )}
      </div>
      {scenario && (
        <div className="rf-scenario-result" data-testid="scenario-result">
          <p data-testid="scenario-value">
            {i18n.tSafe('scenario.result' as MessageKey, {
              baseline:
                baselineMargin?.value != null
                  ? formatDecimal(i18n, baselineMargin.value, baselineMargin.unit)
                  : i18n.tSafe('common.notAvailable' as MessageKey),
              scenario:
                marginMetric?.value != null
                  ? formatDecimal(i18n, marginMetric.value, marginMetric.unit)
                  : i18n.tSafe('common.notAvailable' as MessageKey),
              delta: marginDelta(i18n, scenario),
            })}
          </p>
          {scenarioChart !== null ? (
            <ChartFigure
              spec={scenarioChart}
              localization={chartLocalization(i18n)}
              emphasisKey="scenario"
            />
          ) : null}
          {contributionMetric?.value != null && (
            <p className="rf-quiet">
              {i18n.tSafe('metric.contribution' as MessageKey)}:{' '}
              {formatDecimal(i18n, contributionMetric.value, contributionMetric.unit)}
            </p>
          )}
          <p className="rf-quiet rf-scenario-assumptions">
            {i18n.tSafe('scenario.assumption.mechanical' as MessageKey)}{' '}
            {i18n.tSafe('scenario.assumption.revenueFixed' as MessageKey)}
          </p>
        </div>
      )}
    </Section>
  );
}

function marginDelta(i18n: I18n, scenario: import('@rowfolio/contracts').ScenarioResult): string {
  const delta = scenario.metrics.find((m) => m.labelKey === 'metric.marginDelta');
  if (delta?.value != null) {
    return formatDecimal(i18n, delta.value, delta.unit);
  }
  return i18n.tSafe('common.notAvailable' as MessageKey);
}

/**
 * Parse a typed percent ("8", "+8%", "-5.5") to a canonical fraction decimal
 * ("0.08"). Rejects values outside [-20%, +30%] or finer than 0.1%.
 */
export function parsePercentInput(i18n: I18n, text: string): string | null {
  const trimmed = text.trim().replace(/%$/, '').replace(/^%/, '');
  if (trimmed === '') return null;
  let decimal: string;
  try {
    decimal = i18n.parseDecimal(trimmed);
  } catch {
    return null;
  }
  // percent → fraction: divide by 100 exactly (two decimal places).
  const fraction = shiftDecimal(decimal, -2);
  if (fraction === null) return null;
  // Range [-0.20, 0.30] and step multiple of 0.001.
  const num = Number(fraction);
  if (!Number.isFinite(num) || num < -0.2 || num > 0.3) return null;
  if (Math.abs(num * 1000 - Math.round(num * 1000)) > 1e-9) return null;
  return fraction;
}

/** Decimal shift by power of ten on canonical decimal strings. */
function shiftDecimal(value: string, places: number): string | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value);
  if (!m) return null;
  const sign = m[1] ?? '';
  const intPart = m[2] ?? '0';
  const fracPart = m[3] ?? '';
  const digits = (intPart + fracPart).replace(/^0+/, '') || '0';
  const pointPos = intPart.length + places;
  let out: string;
  if (pointPos <= 0) {
    out = '0.' + '0'.repeat(-pointPos) + digits;
  } else if (pointPos >= digits.length) {
    out = digits + '0'.repeat(pointPos - digits.length);
  } else {
    out = digits.slice(0, pointPos) + '.' + digits.slice(pointPos);
  }
  return (sign === '-' && out !== '0' ? '-' : '') + out;
}
