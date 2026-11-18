import { randomUUID } from 'node:crypto';
import type { ValuationFxIssueDto, ValuationFxRateDto } from '@welyt/shared';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../../db/client.ts';
import { currencies, fxRates, type FxRateRecord } from '../../db/schema.ts';
import { fieldValidationError, parseInput } from '../../lib/errors.ts';
import {
  FX_RATE_SCALE,
  assertNotFuture,
  currencyCodeSchema,
  financialDateSchema,
  formatRateE8,
  indiaBusinessDate,
  parseRateE8,
  resolveAsOfDate,
} from '../../lib/financial-values.ts';

const foreignCurrencyCodeSchema = currencyCodeSchema.refine((code) => code !== 'INR', {
  message: 'An INR conversion requires a non-INR base currency',
});
const manualRateSchema = z.strictObject({
  baseCurrencyCode: foreignCurrencyCodeSchema,
  rateOn: financialDateSchema,
  rate: z.string(),
});
const providerQuotesSchema = z.array(
  manualRateSchema.extend({ quoteCurrencyCode: z.literal('INR') }),
);
const refreshInputSchema = z.strictObject({
  rateOn: financialDateSchema.optional(),
  baseCurrencyCodes: z
    .array(foreignCurrencyCodeSchema)
    .min(1)
    .refine(
      (codes) => new Set(codes).size === codes.length,
      'Request each base currency only once',
    ),
});
export const fxProviderSourceSchema = z
  .string()
  .trim()
  .min(1)
  .refine((source) => source !== 'manual', 'The manual source is reserved for user overrides');

export type ManualFxRateInput = z.input<typeof manualRateSchema>;

export interface FxRateRequest {
  rateOn?: string;
  baseCurrencyCodes: readonly string[];
  quoteCurrencyCode: 'INR';
}

export interface FxRateProvider {
  readonly source: string;
  fetchDailyRates(request: FxRateRequest): Promise<unknown>;
}

type RateWriteStatus = 'inserted' | 'revised' | 'unchanged';

export type FxRefreshResult = { baseCurrencyCode: string } & (
  { status: RateWriteStatus; rateOn: string } | { status: 'missing' }
);

export type StoredFxRateLookup =
  | { status: 'missing' }
  | { status: 'stale'; rateOn: string; ageDays: number }
  | { status: 'same_day' | 'carried_forward'; rate: FxRateRecord; ageDays: number };

export type FxRateLookup = StoredFxRateLookup | { status: 'not_required' };

type RateWrite = Omit<FxRateRecord, 'id' | 'quoteCurrencyCode' | 'retiredAt'>;
type FxReader = Pick<AppDatabase, 'select'>;
type FxDb = Pick<AppDatabase, 'select' | 'insert' | 'update'>;

function assertSupportedCurrency(db: FxReader, baseCurrencyCode: string): void {
  const currency = db
    .select({ code: currencies.code })
    .from(currencies)
    .where(eq(currencies.code, baseCurrencyCode))
    .get();
  if (!currency) {
    throw fieldValidationError('baseCurrencyCode', 'Unsupported FX base currency');
  }
}

function currentRateScope(baseCurrencyCode: string, source: string, userId: string | null) {
  return and(
    eq(fxRates.baseCurrencyCode, baseCurrencyCode),
    eq(fxRates.quoteCurrencyCode, 'INR'),
    eq(fxRates.source, source),
    userId === null ? isNull(fxRates.userId) : eq(fxRates.userId, userId),
    isNull(fxRates.retiredAt),
  );
}

function storeRate(db: FxDb, values: RateWrite): { status: RateWriteStatus; rate: FxRateRecord } {
  const existing = db
    .select()
    .from(fxRates)
    .where(
      and(
        currentRateScope(values.baseCurrencyCode, values.source, values.userId),
        eq(fxRates.rateOn, values.rateOn),
      ),
    )
    .get();
  if (existing?.rateE8 === values.rateE8) {
    return { status: 'unchanged', rate: existing };
  }
  if (existing) {
    db.update(fxRates)
      .set({ retiredAt: values.createdAt })
      .where(eq(fxRates.id, existing.id))
      .run();
  }
  const rate = db
    .insert(fxRates)
    .values({ ...values, id: randomUUID(), quoteCurrencyCode: 'INR' })
    .returning()
    .get();
  return { status: existing ? 'revised' : 'inserted', rate };
}

function latestRate(
  db: FxReader,
  baseCurrencyCode: string,
  source: string,
  userId: string | null,
  asOf: string,
): FxRateRecord | undefined {
  return db
    .select()
    .from(fxRates)
    .where(and(currentRateScope(baseCurrencyCode, source, userId), lte(fxRates.rateOn, asOf)))
    .orderBy(desc(fxRates.rateOn))
    .limit(1)
    .get();
}

export function lookupStoredFxRate(
  db: FxReader,
  userId: string,
  baseCurrencyCode: string,
  asOf: string,
  providerSource: string | null,
): StoredFxRateLookup {
  const shared =
    providerSource === null
      ? undefined
      : latestRate(db, baseCurrencyCode, providerSource, null, asOf);
  const override = latestRate(db, baseCurrencyCode, 'manual', userId, asOf);
  const rate = override && (!shared || override.rateOn >= shared.rateOn) ? override : shared;
  if (!rate) {
    return { status: 'missing' };
  }

  const ageDays = (Date.parse(asOf) - Date.parse(rate.rateOn)) / 86_400_000;
  if (ageDays > 7) {
    return { status: 'stale', rateOn: rate.rateOn, ageDays };
  }
  return { status: ageDays === 0 ? 'same_day' : 'carried_forward', rate, ageDays };
}

type StoredFxValuation =
  | { paise: bigint; fxRate: ValuationFxRateDto; issue: null }
  | { paise: null; fxRate: null; issue: ValuationFxIssueDto };

export function valueInrFromStoredFx(
  amountHundredths: bigint,
  lookup: StoredFxRateLookup,
): StoredFxValuation {
  if (lookup.status === 'missing') {
    return { paise: null, fxRate: null, issue: { reason: 'missing_fx_rate' } };
  }
  if (lookup.status === 'stale') {
    return {
      paise: null,
      fxRate: null,
      issue: { reason: 'stale_fx_rate', rateOn: lookup.rateOn, ageDays: lookup.ageDays },
    };
  }
  const { id, rateOn, rateE8, source, fetchedAt } = lookup.rate;
  const scaled = amountHundredths * BigInt(rateE8);
  const magnitude = scaled < 0n ? -scaled : scaled;
  const rounded = (magnitude + FX_RATE_SCALE / 2n) / FX_RATE_SCALE;
  return {
    paise: scaled < 0n ? -rounded : rounded,
    fxRate: { id, rateOn, rate: formatRateE8(rateE8), source, fetchedAt, ageDays: lookup.ageDays },
    issue: null,
  };
}

export class FxService {
  private readonly db: AppDatabase;
  private readonly provider: FxRateProvider;
  private readonly source: string;
  private readonly now: () => Date;

  constructor(db: AppDatabase, provider: FxRateProvider, now: () => Date = () => new Date()) {
    this.db = db;
    this.provider = provider;
    this.source = parseInput(fxProviderSourceSchema, provider.source);
    this.now = now;
  }

  async refreshDailyRates(
    rateOn: string,
    baseCurrencyCodes: readonly string[],
  ): Promise<FxRefreshResult[]> {
    return this.refreshRates(baseCurrencyCodes, parseInput(financialDateSchema, rateOn));
  }

  async refreshLatestRates(baseCurrencyCodes: readonly string[]): Promise<FxRefreshResult[]> {
    return this.refreshRates(baseCurrencyCodes);
  }

  private async refreshRates(
    baseCurrencyCodes: readonly string[],
    rateOn?: string,
  ): Promise<FxRefreshResult[]> {
    const request = parseInput(refreshInputSchema, { rateOn, baseCurrencyCodes });
    if (request.rateOn !== undefined) {
      assertNotFuture(request.rateOn, indiaBusinessDate(this.now()), 'rateOn');
    }
    for (const code of request.baseCurrencyCodes) {
      assertSupportedCurrency(this.db, code);
    }

    const raw = await this.provider.fetchDailyRates({
      baseCurrencyCodes: request.baseCurrencyCodes,
      quoteCurrencyCode: 'INR',
      ...(request.rateOn === undefined ? {} : { rateOn: request.rateOn }),
    });
    const fetched = this.now();
    const fetchedAt = fetched.toISOString();
    const today = indiaBusinessDate(fetched);
    const requested = new Set(request.baseCurrencyCodes);
    const rates = new Map<string, { rateOn: string; rateE8: number }>();
    for (const quote of parseInput(providerQuotesSchema, raw)) {
      if (
        (request.rateOn !== undefined && quote.rateOn !== request.rateOn) ||
        !requested.has(quote.baseCurrencyCode)
      ) {
        throw fieldValidationError(
          'rates',
          'FX quote does not match the requested date or currency pair',
        );
      }
      if (rates.has(quote.baseCurrencyCode)) {
        throw fieldValidationError('rates', 'FX provider returned more than one quote for a pair');
      }
      assertNotFuture(quote.rateOn, today, 'rateOn');
      rates.set(quote.baseCurrencyCode, { rateOn: quote.rateOn, rateE8: parseRateE8(quote.rate) });
    }

    return this.db.transaction(
      (tx) =>
        request.baseCurrencyCodes.map((baseCurrencyCode): FxRefreshResult => {
          const quote = rates.get(baseCurrencyCode);
          if (!quote) {
            return { baseCurrencyCode, status: 'missing' };
          }
          const { status } = storeRate(tx, {
            baseCurrencyCode,
            ...quote,
            source: this.source,
            userId: null,
            fetchedAt,
            createdAt: fetchedAt,
          });
          return { baseCurrencyCode, status, rateOn: quote.rateOn };
        }),
      { behavior: 'immediate' },
    );
  }

  setManualRate(userId: string, input: ManualFxRateInput): FxRateRecord {
    const { baseCurrencyCode, rateOn, rate } = parseInput(manualRateSchema, input);
    const instant = this.now();
    assertNotFuture(rateOn, indiaBusinessDate(instant), 'rateOn');
    const rateE8 = parseRateE8(rate);

    return this.db.transaction(
      (tx) => {
        assertSupportedCurrency(tx, baseCurrencyCode);
        return storeRate(tx, {
          baseCurrencyCode,
          rateOn,
          rateE8,
          source: 'manual',
          userId,
          fetchedAt: null,
          createdAt: instant.toISOString(),
        }).rate;
      },
      { behavior: 'immediate' },
    );
  }

  lookupRate(userId: string, baseCurrencyCode: string, asOf?: string): FxRateLookup {
    const code = parseInput(currencyCodeSchema, baseCurrencyCode);
    const cutoff = resolveAsOfDate(asOf, this.now());
    if (code === 'INR') {
      return { status: 'not_required' };
    }

    return this.db.transaction((tx): FxRateLookup => {
      assertSupportedCurrency(tx, code);
      return lookupStoredFxRate(tx, userId, code, cutoff, this.source);
    });
  }
}
