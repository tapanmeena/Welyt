import type { AccountValuationDto, AccountsValuationDto } from '@welyt/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client.ts';
import { accountObservations, accounts } from '../../db/schema.ts';
import { parseInput } from '../../lib/errors.ts';
import {
  FX_RATE_SCALE,
  formatHundredths,
  formatRateE8,
  indiaFiscalWindow,
  resolveAsOfDate,
} from '../../lib/financial-values.ts';
import {
  fxProviderSourceSchema,
  lookupStoredFxRate,
  type StoredFxRateLookup,
} from '../fx/fx.service.ts';
import { currentObservationsAsOf } from './accounts.service.ts';

export type AccountValuation = AccountValuationDto;
export type AccountsValuation = AccountsValuationDto;

function convertToInrPaise(hundredths: bigint, rateE8: number): bigint {
  const scaled = hundredths * BigInt(rateE8);
  const magnitude = scaled < 0n ? -scaled : scaled;
  const rounded = (magnitude + FX_RATE_SCALE / 2n) / FX_RATE_SCALE;
  return scaled < 0n ? -rounded : rounded;
}

export class AccountsValuationService {
  private readonly db: AppDatabase;
  private readonly providerSource: string | null;
  private readonly now: () => Date;

  constructor(db: AppDatabase, providerSource: string | null, now: () => Date = () => new Date()) {
    this.db = db;
    this.providerSource =
      providerSource === null ? null : parseInput(fxProviderSourceSchema, providerSource);
    this.now = now;
  }

  valueAccounts(userId: string, asOf?: string): AccountsValuation {
    const cutoff = resolveAsOfDate(asOf, this.now());
    return this.db.transaction((tx) => {
      const latestObservationId = tx
        .select({ id: accountObservations.id })
        .from(accountObservations)
        .where(currentObservationsAsOf(accounts.id, cutoff))
        .orderBy(desc(accountObservations.observedOn))
        .limit(1);
      const rows = tx
        .select({
          accountId: accounts.id,
          name: accounts.name,
          currencyCode: accounts.currencyCode,
          observation: {
            id: accountObservations.id,
            observedOn: accountObservations.observedOn,
            balanceHundredths: accountObservations.balanceHundredths,
          },
        })
        .from(accounts)
        .leftJoin(accountObservations, eq(accountObservations.id, latestObservationId))
        .where(
          and(
            eq(accounts.userId, userId),
            isNull(accounts.archivedAt),
            eq(accounts.inNetWorth, true),
          ),
        )
        .orderBy(accounts.id)
        .all();

      const ratesByCurrency = new Map<string, StoredFxRateLookup>();
      const unavailable = { inrBalance: null, fxRate: null };
      let subtotal = 0n;
      const valuations = rows.map(({ observation, ...account }): AccountValuation => {
        if (!observation) {
          return {
            ...account,
            ...unavailable,
            snapshot: null,
            issue: { reason: 'missing_snapshot' },
          };
        }

        const snapshot = {
          id: observation.id,
          observedOn: observation.observedOn,
          balance: formatHundredths(observation.balanceHundredths),
        };
        let paise = BigInt(observation.balanceHundredths);
        let fxRate: AccountValuation['fxRate'] = null;
        if (account.currencyCode !== 'INR' && paise !== 0n) {
          let lookup = ratesByCurrency.get(account.currencyCode);
          if (!lookup) {
            lookup = lookupStoredFxRate(
              tx,
              userId,
              account.currencyCode,
              cutoff,
              this.providerSource,
            );
            ratesByCurrency.set(account.currencyCode, lookup);
          }
          if (lookup.status === 'missing') {
            return { ...account, ...unavailable, snapshot, issue: { reason: 'missing_fx_rate' } };
          }
          if (lookup.status === 'stale') {
            const { rateOn, ageDays } = lookup;
            return {
              ...account,
              ...unavailable,
              snapshot,
              issue: { reason: 'stale_fx_rate', rateOn, ageDays },
            };
          }
          const { id, rateOn, rateE8, source, fetchedAt } = lookup.rate;
          paise = convertToInrPaise(paise, rateE8);
          fxRate = {
            id,
            rateOn,
            rate: formatRateE8(rateE8),
            source,
            fetchedAt,
            ageDays: lookup.ageDays,
          };
        }

        subtotal += paise;
        return { ...account, snapshot, inrBalance: formatHundredths(paise), fxRate, issue: null };
      });

      const complete = valuations.every((valuation) => valuation.issue === null);
      const knownSubtotalInr = formatHundredths(subtotal);
      return {
        asOf: cutoff,
        fiscalYear: indiaFiscalWindow(cutoff),
        reportingCurrencyCode: 'INR',
        accounts: valuations,
        complete,
        knownSubtotalInr,
        totalInr: complete ? knownSubtotalInr : null,
      };
    });
  }
}
