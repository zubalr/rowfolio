/**
 * Exact-decimal module — the contract's arithmetic surface. All values are
 * canonical decimal strings; no float ever crosses the contract boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  isCanonicalDecimal,
  isDecimal,
  isIntegerDecimal,
  isMultipleOfStep,
  isZeroDecimal,
  multiplyDecimal,
  normalizeDecimalString,
  significantDigits,
  subtractDecimal,
  withinSignificantDigitLimit,
  DecimalArithmeticError,
  PRECISION,
} from '../../packages/contracts/src/index.ts';

describe('decimal syntax', () => {
  it.each(['0', '1', '-1', '0.5', '-0.5', '123456789.987654321', '881000.00', '0.001'])(
    'accepts %j',
    (v) => expect(isDecimal(v)).toBe(true),
  );
  it.each(['1e6', '1.2.3', 'abc', '12,5', '', 'NaN', 'Infinity', '-0', '0x10', ' 1', '1 ', '.5', '5.', '+1', '007'])(
    'rejects %j',
    (v) => expect(isDecimal(v)).toBe(false),
  );
  it.each(['0', '-1', '0.5'])('canonical: %j', (v) => expect(isCanonicalDecimal(v)).toBe(true));
  it.each(['01', '1.230', '-0.00'])('non-canonical: %j', (v) => expect(isCanonicalDecimal(v)).toBe(false));
});

describe('significant digits', () => {
  it('counts digits correctly', () => {
    expect(significantDigits('0')).toBe(1);
    expect(significantDigits('0.001')).toBe(1);
    expect(significantDigits('881000.00')).toBe(8);
    expect(significantDigits('123.456')).toBe(6);
  });
  it('enforces the input limit of 30', () => {
    expect(withinSignificantDigitLimit('1'.repeat(30), 30)).toBe(true);
    expect(withinSignificantDigitLimit('1'.repeat(31), 30)).toBe(false);
    expect(withinSignificantDigitLimit('0.' + '0'.repeat(29) + '1', 30)).toBe(true);
  });
});

describe('comparison and normalization', () => {
  it('numeric equality ignores trailing zeros', () => {
    expect(compareDecimal('4860000.00', '4860000')).toBe(0);
    expect(compareDecimal('0.1', '0.10')).toBe(0);
    expect(compareDecimal('-1', '1')).toBe(-1);
    expect(compareDecimal('2', '1.999')).toBe(1);
  });
  it('normalize strips trailing zeros and folds -0', () => {
    expect(normalizeDecimalString('1.230')).toBe('1.23');
    expect(normalizeDecimalString('4860000.00')).toBe('4860000');
    expect(normalizeDecimalString('-0.00')).toBe('0');
  });
  it('predicates', () => {
    expect(isZeroDecimal('0.00')).toBe(true);
    expect(isZeroDecimal('0.01')).toBe(false);
    expect(isIntegerDecimal('4860000.00')).toBe(true);
    expect(isIntegerDecimal('0.5')).toBe(false);
  });
});

describe('exact arithmetic', () => {
  it('add/subtract/multiply are exact', () => {
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(addDecimal('881000.00', '-81000.005')).toBe('799999.995');
    expect(subtractDecimal('1', '0.999')).toBe('0.001');
    expect(multiplyDecimal('1.1', '1.1')).toBe('1.21');
    expect(multiplyDecimal('-2', '3.5')).toBe('-7');
  });
  it('divide terminates exactly when possible', () => {
    expect(divideDecimal('1', '4')).toBe('0.25');
    expect(divideDecimal('4860000.00', '100')).toBe('48600');
  });
  it('divide rounds HALF_UP at precision 40 for non-terminating quotients', () => {
    const q = divideDecimal('1', '3');
    expect(q).toBe('0.' + '3'.repeat(40));
    const q2 = divideDecimal('2', '3');
    expect(q2).toBe('0.' + '6'.repeat(39) + '7');
    expect(PRECISION).toBe(40);
  });
  it('divide by zero throws DecimalArithmeticError', () => {
    expect(() => divideDecimal('1', '0')).toThrow(DecimalArithmeticError);
    expect(() => divideDecimal('1', '0.00')).toThrow(DecimalArithmeticError);
  });
  it('step multiples', () => {
    expect(isMultipleOfStep('0.20', '0.001')).toBe(true);
    expect(isMultipleOfStep('0.1001', '0.001')).toBe(false);
    expect(isMultipleOfStep('-0.05', '0.001')).toBe(true);
    expect(isMultipleOfStep('0', '0.001')).toBe(true);
  });
});
