import { randomUUID } from 'node:crypto';
import {
  ACCOUNTS_ERROR_CODES,
  balanceObservationSchema,
  createAccountSchema,
  updateAccountSchema,
  type AccountsErrorCode,
  type BalanceSnapshotDto,
  type CurrencyDto,
} from '@welyt/shared';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import type { AppDatabase } from '../../db/client.ts';
import {
  accountObservations,
  accounts,
  currencies,
  type AccountObservationRecord,
  type AccountRecord,
} from '../../db/schema.ts';
import { AppError, fieldValidationError, parseInput } from '../../lib/errors.ts';
import {
  assertNotFuture,
  formatHundredths,
  indiaBusinessDate,
  parseBalanceHundredths,
  resolveAsOfDate,
} from '../../lib/financial-values.ts';

export type {
  CreateAccountInput,
  UpdateAccountInput,
  BalanceObservationInput,
} from '@welyt/shared';
export type BalanceObservation = BalanceSnapshotDto;

const accountErrorStatus: Record<AccountsErrorCode, 404 | 409> = {
  ACCOUNT_NOT_FOUND: 404,
  ACCOUNT_ARCHIVED: 409,
  OBSERVATION_NOT_FOUND: 404,
  OBSERVATION_NOT_CURRENT: 409,
  OBSERVATION_DATE_OCCUPIED: 409,
};

export class AccountsError extends AppError {
  constructor(code: AccountsErrorCode, message: string) {
    super(accountErrorStatus[code], code, message);
    this.name = 'AccountsError';
  }
}

type AccountsDb = Pick<AppDatabase, 'select' | 'update'>;

function ownedAccount(userId: string, accountId: string) {
  return and(eq(accounts.userId, userId), eq(accounts.id, accountId));
}

export function currentObservationsAsOf(accountId: string | typeof accounts.id, asOf: string) {
  return and(
    eq(accountObservations.accountId, accountId),
    lte(accountObservations.observedOn, asOf),
    isNull(accountObservations.retiredAt),
  );
}

function requireAccount(db: AccountsDb, userId: string, accountId: string): AccountRecord {
  const account = db.select().from(accounts).where(ownedAccount(userId, accountId)).get();
  if (!account) {
    throw new AccountsError(ACCOUNTS_ERROR_CODES.ACCOUNT_NOT_FOUND, 'Account not found');
  }
  return account;
}

function assertActive(account: AccountRecord): void {
  if (account.archivedAt !== null) {
    throw new AccountsError(
      ACCOUNTS_ERROR_CODES.ACCOUNT_ARCHIVED,
      'Archived accounts are read-only',
    );
  }
}

function currencyMinorUnits(db: AccountsDb, currencyCode: string): number {
  const currency = db
    .select({ minorUnits: currencies.minorUnits })
    .from(currencies)
    .where(eq(currencies.code, currencyCode))
    .get();
  if (!currency) {
    throw fieldValidationError('currencyCode', 'Unsupported account currency');
  }
  return currency.minorUnits;
}

function mapObservation(row: AccountObservationRecord, currencyCode: string): BalanceObservation {
  const { balanceHundredths, ...observation } = row;
  return { ...observation, currencyCode, balance: formatHundredths(balanceHundredths) };
}

function retireObservation(db: AccountsDb, accountId: string, id: string, retiredAt: string): void {
  const target = and(eq(accountObservations.accountId, accountId), eq(accountObservations.id, id));
  const result = db
    .update(accountObservations)
    .set({ retiredAt })
    .where(and(target, isNull(accountObservations.retiredAt)))
    .run();
  if (result.changes === 1) {
    return;
  }
  const existing = db
    .select({ id: accountObservations.id })
    .from(accountObservations)
    .where(target)
    .get();
  if (!existing) {
    throw new AccountsError(
      ACCOUNTS_ERROR_CODES.OBSERVATION_NOT_FOUND,
      'Balance observation not found',
    );
  }
  throw new AccountsError(
    ACCOUNTS_ERROR_CODES.OBSERVATION_NOT_CURRENT,
    'Balance observation has already been corrected',
  );
}

export class AccountsService {
  private readonly db: AppDatabase;
  private readonly now: () => Date;

  constructor(db: AppDatabase, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  listCurrencies(): CurrencyDto[] {
    return this.db
      .select({
        code: currencies.code,
        name: currencies.name,
        minorUnits: currencies.minorUnits,
      })
      .from(currencies)
      .orderBy(currencies.code)
      .all();
  }

  createAccount(userId: string, input: unknown): AccountRecord {
    const values = parseInput(createAccountSchema, input);
    currencyMinorUnits(this.db, values.currencyCode);
    const timestamp = this.now().toISOString();
    return this.db
      .insert(accounts)
      .values({ ...values, id: randomUUID(), userId, createdAt: timestamp, updatedAt: timestamp })
      .returning()
      .get();
  }

  updateAccount(userId: string, accountId: string, input: unknown): AccountRecord {
    return this.db.transaction(
      (tx) => {
        assertActive(requireAccount(tx, userId, accountId));
        const values = parseInput(updateAccountSchema, input);
        return tx
          .update(accounts)
          .set({ ...values, updatedAt: this.now().toISOString() })
          .where(ownedAccount(userId, accountId))
          .returning()
          .get();
      },
      { behavior: 'immediate' },
    );
  }

  listAccounts(
    userId: string,
    { includeArchived = false }: { includeArchived?: boolean } = {},
  ): AccountRecord[] {
    return this.db
      .select()
      .from(accounts)
      .where(
        and(eq(accounts.userId, userId), includeArchived ? undefined : isNull(accounts.archivedAt)),
      )
      .orderBy(accounts.id)
      .all();
  }

  archiveAccount(userId: string, accountId: string): AccountRecord {
    return this.db.transaction(
      (tx) => {
        const account = requireAccount(tx, userId, accountId);
        if (account.archivedAt !== null) {
          return account;
        }
        const timestamp = this.now().toISOString();
        return tx
          .update(accounts)
          .set({ archivedAt: timestamp, updatedAt: timestamp })
          .where(ownedAccount(userId, accountId))
          .returning()
          .get();
      },
      { behavior: 'immediate' },
    );
  }

  recordObservation(userId: string, accountId: string, input: unknown): BalanceObservation {
    return this.writeObservation(userId, accountId, input);
  }

  correctObservation(
    userId: string,
    accountId: string,
    observationId: string,
    input: unknown,
  ): BalanceObservation {
    if (typeof observationId !== 'string' || observationId.length === 0) {
      throw fieldValidationError('observationId', 'Choose a balance observation to correct');
    }
    return this.writeObservation(userId, accountId, input, observationId);
  }

  listObservations(userId: string, accountId: string): BalanceObservation[] {
    return this.db.transaction((tx) => {
      const account = requireAccount(tx, userId, accountId);
      return tx
        .select()
        .from(accountObservations)
        .where(eq(accountObservations.accountId, account.id))
        .orderBy(
          desc(accountObservations.observedOn),
          desc(isNull(accountObservations.retiredAt)),
          desc(accountObservations.createdAt),
          desc(accountObservations.id),
        )
        .all()
        .map((row) => mapObservation(row, account.currencyCode));
    });
  }

  getLatestObservation(
    userId: string,
    accountId: string,
    asOf?: string,
  ): BalanceObservation | null {
    return this.db.transaction((tx) => {
      const account = requireAccount(tx, userId, accountId);
      const cutoff = resolveAsOfDate(asOf, this.now());
      const row = tx
        .select()
        .from(accountObservations)
        .where(currentObservationsAsOf(account.id, cutoff))
        .orderBy(desc(accountObservations.observedOn))
        .limit(1)
        .get();
      return row ? mapObservation(row, account.currencyCode) : null;
    });
  }

  private writeObservation(
    userId: string,
    accountId: string,
    input: unknown,
    replacesObservationId?: string,
  ): BalanceObservation {
    return this.db.transaction(
      (tx) => {
        const account = requireAccount(tx, userId, accountId);
        assertActive(account);
        const { observedOn, balance, notes } = parseInput(balanceObservationSchema, input);
        const instant = this.now();
        assertNotFuture(observedOn, indiaBusinessDate(instant), 'observedOn');
        const balanceHundredths = parseBalanceHundredths(
          balance,
          currencyMinorUnits(tx, account.currencyCode),
        );
        const timestamp = instant.toISOString();

        if (replacesObservationId !== undefined) {
          retireObservation(tx, account.id, replacesObservationId, timestamp);
        }
        const occupied = tx
          .select({ id: accountObservations.id })
          .from(accountObservations)
          .where(
            and(
              eq(accountObservations.accountId, account.id),
              eq(accountObservations.observedOn, observedOn),
              isNull(accountObservations.retiredAt),
            ),
          )
          .get();
        if (occupied) {
          throw new AccountsError(
            ACCOUNTS_ERROR_CODES.OBSERVATION_DATE_OCCUPIED,
            'A balance already exists for that date',
          );
        }

        const row = tx
          .insert(accountObservations)
          .values({
            id: randomUUID(),
            accountId: account.id,
            observedOn,
            balanceHundredths,
            notes,
            source: 'manual',
            replacesObservationId,
            createdAt: timestamp,
          })
          .returning()
          .get();
        return mapObservation(row, account.currencyCode);
      },
      { behavior: 'immediate' },
    );
  }
}
