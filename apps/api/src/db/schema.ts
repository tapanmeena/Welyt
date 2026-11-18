import { ACCOUNT_KINDS, DEBT_MODES } from '@welyt/shared';
import { inArray, sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const AUTH_CHALLENGE_PURPOSES = ['email_verification', 'password_reset'] as const;
export type AuthChallengePurpose = (typeof AUTH_CHALLENGE_PURPOSES)[number];

const maxSafeInteger = sql.raw(String(Number.MAX_SAFE_INTEGER));

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    debtMode: text('debt_mode', { enum: DEBT_MODES }).notNull().default('remaining_emis'),
    emailVerifiedAt: text('email_verified_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [uniqueIndex('users_email_unique_idx').on(table.email)],
);

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: text('family_id').notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    deviceName: text('device_name'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    lastUsedAt: text('last_used_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('auth_sessions_refresh_hash_unique_idx').on(table.refreshTokenHash),
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_family_id_idx').on(table.familyId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ],
);

export const authChallenges = sqliteTable(
  'auth_challenges',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose', { enum: AUTH_CHALLENGE_PURPOSES }).notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: text('expires_at').notNull(),
    consumedAt: text('consumed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('auth_challenges_user_purpose_idx').on(table.userId, table.purpose),
    index('auth_challenges_expires_at_idx').on(table.expiresAt),
  ],
);

export const currencies = sqliteTable(
  'currencies',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    minorUnits: integer('minor_units').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check('currencies_code_check', sql`${table.code} glob '[A-Z][A-Z][A-Z]'`),
    check(
      'currencies_minor_units_check',
      sql`typeof(${table.minorUnits}) = 'integer' and ${table.minorUnits} between 0 and 2`,
    ),
  ],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: ACCOUNT_KINDS }).notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .default('INR')
      .references(() => currencies.code, { onDelete: 'restrict' }),
    inNetWorth: integer('in_net_worth', { mode: 'boolean' }).notNull().default(true),
    purpose: text('purpose'),
    notes: text('notes'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('accounts_owner_archive_idx').on(table.userId, table.archivedAt, table.id),
    check('accounts_name_check', sql`trim(${table.name}, char(9, 10, 11, 12, 13, 32)) <> ''`),
    check('accounts_kind_check', inArray(table.kind, [...ACCOUNT_KINDS]).inlineParams()),
    check('accounts_in_net_worth_check', sql`${table.inNetWorth} in (0, 1)`),
  ],
);

export const accountObservations = sqliteTable(
  'account_observations',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'restrict' }),
    observedOn: text('observed_on').notNull(),
    balanceHundredths: integer('balance_hundredths').notNull(),
    source: text('source', { enum: ['manual'] }).notNull(),
    notes: text('notes'),
    retiredAt: text('retired_at'),
    replacesObservationId: text('replaces_observation_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('account_observations_current_date_idx')
      .on(table.accountId, table.observedOn)
      .where(sql`${table.retiredAt} is null`),
    uniqueIndex('account_observations_account_id_id_idx').on(table.accountId, table.id),
    uniqueIndex('account_observations_replacement_idx').on(table.replacesObservationId),
    foreignKey({
      name: 'account_observations_same_account_replacement_fk',
      columns: [table.accountId, table.replacesObservationId],
      foreignColumns: [table.accountId, table.id],
    }).onDelete('restrict'),
    check(
      'account_observations_date_check',
      sql`date(${table.observedOn}, '+0 days') is ${table.observedOn}`,
    ),
    check(
      'account_observations_balance_check',
      sql`typeof(${table.balanceHundredths}) = 'integer' and ${table.balanceHundredths} between -${maxSafeInteger} and ${maxSafeInteger}`,
    ),
    check('account_observations_source_check', sql`${table.source} = 'manual'`),
    check(
      'account_observations_no_self_replacement_check',
      sql`${table.replacesObservationId} <> ${table.id}`,
    ),
  ],
);

export const fxRates = sqliteTable(
  'fx_rates',
  {
    id: text('id').primaryKey(),
    baseCurrencyCode: text('base_currency_code')
      .notNull()
      .references(() => currencies.code, { onDelete: 'restrict' }),
    quoteCurrencyCode: text('quote_currency_code')
      .notNull()
      .references(() => currencies.code, { onDelete: 'restrict' }),
    rateOn: text('rate_on').notNull(),
    rateE8: integer('rate_e8').notNull(),
    source: text('source').notNull(),
    fetchedAt: text('fetched_at'),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    retiredAt: text('retired_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('fx_rates_current_provider_idx')
      .on(table.source, table.baseCurrencyCode, table.quoteCurrencyCode, table.rateOn)
      .where(sql`${table.userId} is null and ${table.retiredAt} is null`),
    uniqueIndex('fx_rates_current_manual_idx')
      .on(table.userId, table.baseCurrencyCode, table.quoteCurrencyCode, table.rateOn)
      .where(sql`${table.userId} is not null and ${table.retiredAt} is null`),
    check(
      'fx_rates_pair_check',
      sql`${table.quoteCurrencyCode} = 'INR' and ${table.baseCurrencyCode} <> ${table.quoteCurrencyCode}`,
    ),
    check('fx_rates_date_check', sql`date(${table.rateOn}, '+0 days') is ${table.rateOn}`),
    check(
      'fx_rates_rate_check',
      sql`typeof(${table.rateE8}) = 'integer' and ${table.rateE8} between 1 and ${maxSafeInteger}`,
    ),
    check(
      'fx_rates_source_check',
      sql`(
        (${table.source} = 'manual' and ${table.userId} is not null and ${table.fetchedAt} is null)
        or (${table.source} <> 'manual' and trim(${table.source}) <> '' and ${table.userId} is null and ${table.fetchedAt} is not null)
      )`,
    ),
  ],
);

export const incomeReceipts = sqliteTable(
  'income_receipts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    receivedDate: text('received_date').notNull(),
    type: text('type').notNull(),
    source: text('source').notNull(),
    currencyCode: text('currency_code')
      .notNull()
      .references(() => currencies.code, { onDelete: 'restrict' }),
    amountHundredths: integer('amount_hundredths').notNull(),
    grossHundredths: integer('gross_hundredths'),
    tdsHundredths: integer('tds_hundredths'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    retiredAt: text('retired_at'),
    archivedAt: text('archived_at'),
    replacesReceiptId: text('replaces_receipt_id'),
  },
  (table) => [
    index('income_receipts_owner_date_idx').on(table.userId, table.receivedDate, table.id),
    uniqueIndex('income_receipts_owner_id_idx').on(table.userId, table.id),
    uniqueIndex('income_receipts_replacement_idx').on(table.replacesReceiptId),
    foreignKey({
      name: 'income_receipts_same_owner_replacement_fk',
      columns: [table.userId, table.replacesReceiptId],
      foreignColumns: [table.userId, table.id],
    }).onDelete('restrict'),
    check(
      'income_receipts_date_check',
      sql`date(${table.receivedDate}, '+0 days') is ${table.receivedDate}`,
    ),
    check(
      'income_receipts_type_check',
      sql`trim(${table.type}, char(9, 10, 11, 12, 13, 32)) <> ''`,
    ),
    check(
      'income_receipts_source_check',
      sql`trim(${table.source}, char(9, 10, 11, 12, 13, 32)) <> ''`,
    ),
    check(
      'income_receipts_amount_check',
      sql`typeof(${table.amountHundredths}) = 'integer' and ${table.amountHundredths} between 1 and ${maxSafeInteger}`,
    ),
    check(
      'income_receipts_gross_check',
      sql`${table.grossHundredths} is null or (
        typeof(${table.grossHundredths}) = 'integer' and
        ${table.grossHundredths} between ${table.amountHundredths} and ${maxSafeInteger}
      )`,
    ),
    check(
      'income_receipts_tds_check',
      sql`${table.tdsHundredths} is null or (
        typeof(${table.tdsHundredths}) = 'integer' and
        ${table.tdsHundredths} between 0 and ${maxSafeInteger} and
        (${table.grossHundredths} is null or ${table.tdsHundredths} <= ${table.grossHundredths} - ${table.amountHundredths})
      )`,
    ),
    check(
      'income_receipts_inactive_state_check',
      sql`${table.retiredAt} is null or ${table.archivedAt} is null`,
    ),
    check(
      'income_receipts_no_self_replacement_check',
      sql`${table.replacesReceiptId} <> ${table.id}`,
    ),
  ],
);

export type UserRecord = typeof users.$inferSelect;
export type NewUserRecord = typeof users.$inferInsert;
export type AuthSessionRecord = typeof authSessions.$inferSelect;
export type NewAuthSessionRecord = typeof authSessions.$inferInsert;
export type AuthChallengeRecord = typeof authChallenges.$inferSelect;
export type NewAuthChallengeRecord = typeof authChallenges.$inferInsert;
export type CurrencyRecord = typeof currencies.$inferSelect;
export type NewCurrencyRecord = typeof currencies.$inferInsert;
export type AccountRecord = typeof accounts.$inferSelect;
export type NewAccountRecord = typeof accounts.$inferInsert;
export type AccountObservationRecord = typeof accountObservations.$inferSelect;
export type NewAccountObservationRecord = typeof accountObservations.$inferInsert;
export type FxRateRecord = typeof fxRates.$inferSelect;
export type NewFxRateRecord = typeof fxRates.$inferInsert;
export type IncomeReceiptRecord = typeof incomeReceipts.$inferSelect;
