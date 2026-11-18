import { z } from 'zod';
import { fieldValidationError } from './errors.ts';

export const financialDateSchema = z.iso.date();
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code');
export const FX_RATE_SCALE = 100_000_000n;

const indiaDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Kolkata',
  calendar: 'iso8601',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function indiaBusinessDate(instant: Date): string {
  const parts = indiaDateFormatter.formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Unable to format the India business date');
  }
  return `${year.padStart(4, '0')}-${month}-${day}`;
}

export function assertNotFuture(date: string, today: string, field: string): void {
  if (date > today) {
    throw fieldValidationError(field, 'Date cannot be in the future in India');
  }
}

const balancePattern = /^(-?)(0|[1-9]\d{0,13})(?:\.(\d{1,2}))?$/;
const ratePattern = /^(\d{1,8})(?:\.(\d+))?$/;
const maxSafeInteger = BigInt(Number.MAX_SAFE_INTEGER);

export function parseBalanceHundredths(balance: string, minorUnits: number): number {
  const match = balancePattern.exec(balance);
  const whole = match?.[2];
  if (!whole) {
    throw fieldValidationError(
      'balance',
      'Enter a signed decimal balance with up to two fractional digits',
    );
  }

  const fraction = match?.[3] ?? '';
  if (/[1-9]/.test(fraction.slice(minorUnits))) {
    throw fieldValidationError(
      'balance',
      'The balance exceeds the precision of the account currency',
    );
  }

  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (hundredths > maxSafeInteger) {
    throw fieldValidationError('balance', 'The balance exceeds the supported range');
  }
  return Number(match?.[1] === '-' ? -hundredths : hundredths);
}

export function formatHundredths(hundredths: number | bigint): string {
  const value = BigInt(hundredths);
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}

export function parseRateE8(rate: string): number {
  const match = ratePattern.exec(rate);
  const whole = match?.[1];
  if (!whole) {
    throw fieldValidationError('rate', 'Enter a positive decimal FX rate');
  }
  const fraction = match?.[2] ?? '';
  const scaled = BigInt(whole) * FX_RATE_SCALE + BigInt(fraction.slice(0, 8).padEnd(8, '0'));
  const rounded = scaled + (fraction.charAt(8) >= '5' ? 1n : 0n);
  if (rounded < 1n || rounded > maxSafeInteger) {
    throw fieldValidationError(
      'rate',
      'The FX rate is outside the supported range at eight decimal places',
    );
  }
  return Number(rounded);
}
