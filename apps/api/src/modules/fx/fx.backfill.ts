import { randomUUID } from 'node:crypto';
import { and, between, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../../db/client.ts';
import { currencies, fxRates } from '../../db/schema.ts';
import { fieldValidationError, parseInput } from '../../lib/errors.ts';
import {
  assertNotFuture,
  financialDateSchema,
  indiaBusinessDate,
  parseRateE8,
} from '../../lib/financial-values.ts';
import {
  FRANKFURTER_SOURCE,
  LAUNCH_FX_CURRENCIES,
  type FrankfurterProvider,
} from './frankfurter.provider.ts';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 31;
const backfillOptionsSchema = z.strictObject({
  from: financialDateSchema,
  to: financialDateSchema,
  dryRun: z.boolean().default(false),
});

type BackfillOptions = z.input<typeof backfillOptionsSchema>;

interface CurrencyCoverage {
  currencyCode: string;
  firstRateOn: string | null;
  lastRateOn: string | null;
  available: number;
  existing: number;
  newRates: number;
}

export interface FxBackfillSummary {
  daysChecked: number;
  currencies: CurrencyCoverage[];
}

export class FxBackfillError extends Error {
  readonly summary: FxBackfillSummary;

  constructor(from: string, to: string, summary: FxBackfillSummary, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`Historical FX backfill failed for ${from} through ${to}: ${message}`, { cause });
    this.name = 'FxBackfillError';
    this.summary = summary;
  }
}

function rateKey({
  baseCurrencyCode,
  rateOn,
}: {
  baseCurrencyCode: string;
  rateOn: string;
}): string {
  return `${baseCurrencyCode}:${rateOn}`;
}

function utcDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export async function backfillFrankfurterRates(
  db: AppDatabase,
  provider: FrankfurterProvider,
  options: BackfillOptions,
  now: () => Date = () => new Date(),
): Promise<FxBackfillSummary> {
  const { from, to, dryRun } = parseInput(backfillOptionsSchema, options);
  if (from > to) {
    throw fieldValidationError('from', 'The from date must not be after the to date');
  }
  assertNotFuture(to, indiaBusinessDate(now()), 'to');

  const codes = ['INR', ...LAUNCH_FX_CURRENCIES];
  const present = new Set(
    db
      .select({ code: currencies.code })
      .from(currencies)
      .where(inArray(currencies.code, codes))
      .all()
      .map(({ code }) => code),
  );
  const missingCodes = codes.filter((code) => !present.has(code));
  if (missingCodes.length) {
    throw new Error(
      `Missing currencies: ${missingCodes.join(', ')}. Apply the API migrations first.`,
    );
  }

  const coverage = new Map<string, CurrencyCoverage>(
    LAUNCH_FX_CURRENCIES.map((currencyCode) => [
      currencyCode,
      { currencyCode, firstRateOn: null, lastRateOn: null, available: 0, existing: 0, newRates: 0 },
    ]),
  );
  const summary: FxBackfillSummary = { daysChecked: 0, currencies: [...coverage.values()] };
  const finalDay = Date.parse(to);

  for (let first = Date.parse(from); first <= finalDay; first += WINDOW_DAYS * DAY_MS) {
    const last = Math.min(first + (WINDOW_DAYS - 1) * DAY_MS, finalDay);
    const windowFrom = utcDate(first);
    const windowTo = utcDate(last);

    try {
      const quotes = await provider.fetchHistoricalRates({
        from: windowFrom,
        to: windowTo,
        baseCurrencyCodes: LAUNCH_FX_CURRENCIES,
      });
      const fetchedAt = now().toISOString();
      const seen = new Set<string>();
      const validated = quotes.map((quote) => {
        const stats = coverage.get(quote.baseCurrencyCode);
        if (
          !stats ||
          quote.quoteCurrencyCode !== 'INR' ||
          quote.rateOn < windowFrom ||
          quote.rateOn > windowTo
        ) {
          throw fieldValidationError(
            'rates',
            'FX quote does not match the requested date range or pair',
          );
        }
        const key = rateKey(quote);
        if (seen.has(key)) {
          throw fieldValidationError('rates', `Duplicate historical FX quote for ${key}`);
        }
        seen.add(key);
        return { ...quote, key, stats, rateE8: parseRateE8(quote.rate) };
      });

      const existing = db.transaction(
        (tx) => {
          const currentKeys = new Set(
            tx
              .select({ baseCurrencyCode: fxRates.baseCurrencyCode, rateOn: fxRates.rateOn })
              .from(fxRates)
              .where(
                and(
                  eq(fxRates.source, FRANKFURTER_SOURCE),
                  eq(fxRates.quoteCurrencyCode, 'INR'),
                  inArray(fxRates.baseCurrencyCode, LAUNCH_FX_CURRENCIES),
                  isNull(fxRates.userId),
                  isNull(fxRates.retiredAt),
                  between(fxRates.rateOn, windowFrom, windowTo),
                ),
              )
              .all()
              .map(rateKey),
          );
          if (!dryRun) {
            const missing = validated.filter(({ key }) => !currentKeys.has(key));
            if (missing.length) {
              tx.insert(fxRates)
                .values(
                  missing.map(({ baseCurrencyCode, rateOn, rateE8 }) => ({
                    id: randomUUID(),
                    baseCurrencyCode,
                    quoteCurrencyCode: 'INR',
                    rateOn,
                    rateE8,
                    source: FRANKFURTER_SOURCE,
                    userId: null,
                    fetchedAt,
                    createdAt: fetchedAt,
                  })),
                )
                .run();
            }
          }
          return currentKeys;
        },
        { behavior: dryRun ? 'deferred' : 'immediate' },
      );

      for (const { key, rateOn, stats } of validated) {
        stats.available++;
        if (existing.has(key)) stats.existing++;
        else stats.newRates++;
        if (stats.firstRateOn === null || rateOn < stats.firstRateOn) stats.firstRateOn = rateOn;
        if (stats.lastRateOn === null || rateOn > stats.lastRateOn) stats.lastRateOn = rateOn;
      }
      summary.daysChecked += (last - first) / DAY_MS + 1;
    } catch (error) {
      throw new FxBackfillError(windowFrom, windowTo, summary, error);
    }
  }

  return summary;
}
