import {
  financialDateSchema,
  formatScaledDecimal,
  indiaBusinessDate,
  parseDecimalHundredths,
} from '@welyt/shared';
import { fieldValidationError, parseInput } from './errors.ts';

export {
  currencyCodeSchema,
  financialDateSchema,
  formatHundredths,
  indiaBusinessDate,
  indiaFiscalWindow,
} from '@welyt/shared';
export const FX_RATE_SCALE = 100_000_000n;

export function assertNotFuture(date: string, today: string, field: string): void {
  if (date > today) {
    throw fieldValidationError(field, 'Date cannot be in the future in India');
  }
}

export function resolveAsOfDate(asOf: string | undefined, now: Date): string {
  const today = indiaBusinessDate(now);
  const cutoff = asOf === undefined ? today : parseInput(financialDateSchema, asOf);
  assertNotFuture(cutoff, today, 'asOf');
  return cutoff;
}

const ratePattern = /^(\d{1,8})(?:\.(\d+))?$/;
const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export function parseBalanceHundredths(balance: string, minorUnits: number): number {
  return parseAmountHundredths(balance, minorUnits, 'balance');
}

export function parseAmountHundredths(value: string, minorUnits: number, field: string): number {
  const label = field === 'balance' ? 'balance' : 'amount';
  const parsed = parseDecimalHundredths(value);
  if (!parsed) {
    throw fieldValidationError(
      field,
      `Enter a signed decimal ${label} with up to two fractional digits`,
    );
  }

  const { fraction, hundredths } = parsed;
  if (/[1-9]/.test(fraction.slice(minorUnits))) {
    throw fieldValidationError(
      field,
      `The ${label} exceeds the precision of the ${field === 'balance' ? 'account currency' : 'currency'}`,
    );
  }

  if (hundredths < -maxSafeInteger || hundredths > maxSafeInteger) {
    throw fieldValidationError(field, `The ${label} exceeds the supported range`);
  }
  return Number(hundredths);
}

export function formatRateE8(rateE8: number): string {
  return formatScaledDecimal(BigInt(rateE8), FX_RATE_SCALE, 8);
}

function checkedRateE8(rounded: bigint): number {
  if (rounded < 1n || rounded > maxSafeInteger) {
    throw fieldValidationError(
      'rate',
      'The FX rate is outside the supported range at eight decimal places',
    );
  }
  return Number(rounded);
}

export function parseRateE8(rate: string): number {
  const match = ratePattern.exec(rate);
  const whole = match?.[1];
  if (!whole) {
    throw fieldValidationError('rate', 'Enter a positive decimal FX rate');
  }
  const fraction = match?.[2] ?? '';
  const scaled = BigInt(whole) * FX_RATE_SCALE + BigInt(fraction.slice(0, 8).padEnd(8, '0'));
  return checkedRateE8(scaled + (fraction.charAt(8) >= '5' ? 1n : 0n));
}

export function parseInverseRateE8(rate: string): number {
  const match = ratePattern.exec(rate);
  const whole = match?.[1];
  const fraction = match?.[2] ?? '';
  if (!whole || fraction.length > 30) {
    throw fieldValidationError('rate', 'Enter a positive decimal FX rate');
  }
  const denominator = BigInt(`${whole}${fraction}`);
  if (denominator === 0n) {
    throw fieldValidationError('rate', 'Enter a positive decimal FX rate');
  }
  const numerator = FX_RATE_SCALE * 10n ** BigInt(fraction.length);
  return checkedRateE8((numerator + denominator / 2n) / denominator);
}
