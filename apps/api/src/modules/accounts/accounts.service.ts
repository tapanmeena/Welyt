import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../../db/client.ts';
import {
  ACCOUNT_KINDS,
  accountObservations,
  accounts,
  currencies,
  type AccountObservationRecord,
  type AccountRecord,
} from '../../db/schema.ts';
import { fieldValidationError, parseInput } from '../../lib/errors.ts';
import {
  assertNotFuture,
  currencyCodeSchema,
  financialDateSchema,
  formatHundredths,
  indiaBusinessDate,
  parseBalanceHundredths,
} from '../../lib/financial-values.ts';

const accountMetadataSchema = z.strictObject({
  name: z.string().trim().min(1, 'Account name is required'),
  kind: z.enum(ACCOUNT_KINDS),
  inNetWorth: z.boolean().optional(),
  purpose: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
const createAccountSchema = accountMetadataSchema.extend({
  currencyCode: currencyCodeSchema.default('INR'),
});
const updateAccountSchema = accountMetadataSchema
  .partial()
  .refine((fields) => Object.values(fields).some((value) => value !== undefined), {
    message: 'Provide at least one account field to update',
  });
const balanceObservationSchema = z.strictObject({
  observedOn: financialDateSchema,
  balance: z.string(),
  notes: z.string().nullable().optional(),
});

export type CreateAccountInput = z.input<typeof createAccountSchema>;
export type UpdateAccountInput = z.input<typeof updateAccountSchema>;
export type BalanceObservationInput = z.input<typeof balanceObservationSchema>;

export type BalanceObservation = Omit<AccountObservationRecord, 'balanceHundredths'> & {
  balance: string;
  currencyCode: string;
};

type AccountsErrorCode =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_ARCHIVED'
  | 'OBSERVATION_NOT_FOUND'
  | 'OBSERVATION_NOT_CURRENT'
  | 'OBSERVATION_DATE_OCCUPIED';

export class AccountsError extends Error {
  readonly code: AccountsErrorCode;

  constructor(code: AccountsErrorCode, message: string) {
    super(message);
    this.name = 'AccountsError';
    this.code = code;
  }
}

type AccountsDb = Pick<AppDatabase, 'select' | 'update'>;

function ownedAccount(userId: string, accountId: string) {
  return and(eq(accounts.userId, userId), eq(accounts.id, accountId));
}

function requireAccount(db: AccountsDb, userId: string, accountId: string): AccountRecord {
  const account = db.select().from(accounts).where(ownedAccount(userId, accountId)).get();
  if (!account) {
    throw new AccountsError('ACCOUNT_NOT_FOUND', 'Account not found');
  }
  return account;
}

function assertActive(account: AccountRecord): void {
  if (account.archivedAt !== null) {
    throw new AccountsError('ACCOUNT_ARCHIVED', 'Archived accounts are read-only');
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
    throw new AccountsError('OBSERVATION_NOT_FOUND', 'Balance observation not found');
  }
  throw new AccountsError(
    'OBSERVATION_NOT_CURRENT',
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

  createAccount(userId: string, input: CreateAccountInput): AccountRecord {
    const values = parseInput(createAccountSchema, input);
    currencyMinorUnits(this.db, values.currencyCode);
    const timestamp = this.now().toISOString();
    return this.db
      .insert(accounts)
      .values({ ...values, id: randomUUID(), userId, createdAt: timestamp, updatedAt: timestamp })
      .returning()
      .get();
  }

  updateAccount(userId: string, accountId: string, input: UpdateAccountInput): AccountRecord {
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

  recordObservation(
    userId: string,
    accountId: string,
    input: BalanceObservationInput,
  ): BalanceObservation {
    return this.writeObservation(userId, accountId, input);
  }

  correctObservation(
    userId: string,
    accountId: string,
    observationId: string,
    input: BalanceObservationInput,
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
      const today = indiaBusinessDate(this.now());
      const cutoff = parseInput(financialDateSchema, asOf === undefined ? today : asOf);
      assertNotFuture(cutoff, today, 'asOf');
      const row = tx
        .select()
        .from(accountObservations)
        .where(
          and(
            eq(accountObservations.accountId, account.id),
            lte(accountObservations.observedOn, cutoff),
            isNull(accountObservations.retiredAt),
          ),
        )
        .orderBy(desc(accountObservations.observedOn))
        .limit(1)
        .get();
      return row ? mapObservation(row, account.currencyCode) : null;
    });
  }

  private writeObservation(
    userId: string,
    accountId: string,
    input: BalanceObservationInput,
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
            'OBSERVATION_DATE_OCCUPIED',
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
