import { z } from 'zod';
import { parseInput } from '../../lib/errors.ts';
import {
  currencyCodeSchema,
  financialDateSchema,
  formatRateE8,
  parseInverseRateE8,
} from '../../lib/financial-values.ts';
import type { FxRateProvider, FxRateRequest } from './fx.service.ts';

export const FRANKFURTER_SOURCE = 'frankfurter';
export const LAUNCH_FX_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'AED',
  'CAD',
  'AUD',
  'SGD',
  'JPY',
  'CHF',
] as const;

const rowSchema = z.tuple([financialDateSchema, z.literal('INR'), currencyCodeSchema, z.string()]);

export class FrankfurterProvider implements FxRateProvider {
  readonly source = FRANKFURTER_SOURCE;
  private readonly fetcher: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher;
  }

  fetchDailyRates({ rateOn, baseCurrencyCodes, quoteCurrencyCode }: FxRateRequest) {
    const query = new URLSearchParams({
      base: quoteCurrencyCode,
      quotes: baseCurrencyCodes.join(','),
    });
    if (rateOn !== undefined) {
      query.set('date', rateOn);
    }
    return this.fetchRates(query);
  }

  fetchHistoricalRates({
    from,
    to,
    baseCurrencyCodes,
  }: {
    from: string;
    to: string;
    baseCurrencyCodes: readonly string[];
  }) {
    return this.fetchRates(
      new URLSearchParams({ base: 'INR', quotes: baseCurrencyCodes.join(','), from, to }),
    );
  }

  private async fetchRates(query: URLSearchParams) {
    const url = new URL('https://api.frankfurter.dev/v2/rates.csv');
    url.search = query.toString();

    const response = await this.fetcher(url, {
      headers: { accept: 'text/csv' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Frankfurter returned HTTP ${response.status}`);
    }
    const [header, ...rows] = (await response.text()).trim().split(/\r?\n/);
    if (header !== 'date,base,quote,rate') {
      throw new Error('Frankfurter returned an unexpected rates CSV header');
    }

    // One base-INR request covers every pair; invert the source decimal before rounding.
    return rows.map((row) => {
      const [publishedOn, base, quote, rate] = parseInput(rowSchema, row.split(','));
      return {
        rateOn: publishedOn,
        baseCurrencyCode: quote,
        quoteCurrencyCode: base,
        rate: formatRateE8(parseInverseRateE8(rate)),
      };
    });
  }
}
