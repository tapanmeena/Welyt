<!-- markdownlint-disable-file -->
---
description: 'Database implementation plan for snapshot-only Accounts & Cash with daily FX rates.'
applyTo: '.copilot-tracking/plans/2026-11-18/accounts-cash-v1-plan.instructions.md'
---

# Accounts & Cash v1 database plan

## User requests

- Plan Accounts & Cash as the first financial milestone. Use snapshot-only accounts and one
  current balance per account per date. These choices come from the milestone discussion and
  the planning answers.
- Default reporting to INR, support non-INR accounts, and store daily FX rates separately from
  account balances. These choices come from the milestone discussion and the planning answers.
- Use India's April–March financial year, store money to two decimal places, and do not offer
  backup restore in v1. These choices come from the milestone discussion.
- Use published daily rates rather than intraday quotes. The FX rollout discussion approved
  Frankfurter v2 for USD, EUR, GBP, AED, CAD, AUD, SGD, JPY, and CHF.

## Scope and dependencies

Build the SQLite schema, migration, and backend operations for recording, correcting, and
valuing account balances. The [financial model](../../../model.md) defines the product rules.
The [repository guidance](../../../.github/copilot-instructions.md) and Task Plan skill govern
the handoff. Reuse the existing [Drizzle schema](../../../apps/api/src/db/schema.ts),
[database client](../../../apps/api/src/db/client.ts), and [API test setup](../../../apps/api/src/__tests__).
The client already enables foreign keys; account ownership uses the existing `users.id`.

Defer movements, transfers, reconciliation, cash restrictions, funds held for others, and
default accounts by purpose. Also defer other modules, module toggles, exports and restore,
and transactional FX (`AppliedFx`). This plan does not add mobile screens, public API routes,
or a full Home implementation. It supplies the account and INR valuation data those consumers
will need.

## Planned schema

All columns below are required unless described as nullable. Use snake_case in SQLite and
camelCase in TypeScript. Use server-generated text IDs for financial records and UTC timestamps
for creation and lifecycle changes. Use India-local calendar dates (`YYYY-MM-DD`) for
observations and report cutoffs; keep those separate from UTC creation time.

### Currencies and accounts

- `currencies`: `code` (ISO 4217 primary key), `name`, `minor_units`, `created_at`. Use a
  curated fiat catalog with zero to two minor units. A currency needing three or more
  fractional digits cannot be stored faithfully under the v1 money rule.
- `accounts`: `id`, `user_id` (FK to `users`), `name`, `kind`, `currency_code` (FK to
  `currencies`, default `INR`), `in_net_worth` (boolean, default true), `created_at`,
  `updated_at`, and nullable `purpose`, `notes`, and `archived_at`. `purpose` is descriptive
  only. Derive status from `archived_at`. All accounts use snapshot-only tracking; do not
  add a mode switch or a separate user reporting-currency preference for this milestone.
- Allow `bank`, `cash`, `ewallet`, and `brokerage_cash` with a SQLite check on `kind`. Reject
  blank names, allow legitimately repeated names, and index owner-scoped lists with
  `(user_id, archived_at, id)`. Restrict deletes on financial parents. Account currency
  is immutable through the account write service; never reinterpret an observation by
  changing its currency.

### Account observations

- `account_observations`: `id`, `account_id` (FK to `accounts`), `observed_on`,
  `balance_hundredths` (signed INTEGER in the account's currency), `source` (`manual` in
  v1), `created_at`, and nullable `notes`, `retired_at`, and `replaces_observation_id`.
  Ownership and currency come from the account, not from caller-supplied values.
- A partial unique index on `(account_id, observed_on) WHERE retired_at IS NULL` both
  enforces one current observation per date and supports the latest-on-or-before lookup.
  Use a same-account composite FK `(account_id, replaces_observation_id)` and a unique
  replacement reference to prevent cross-account corrections or branching replacements.
  Back the FK with a unique `(account_id, id)` parent key.
- Validate real calendar dates in `Asia/Kolkata`. Allow backdated entries but reject future
  dates. The fiscal year starts April 1 inclusive and ends the following April 1 exclusive.
  Derive the fiscal window from the reporting date; do not persist a fiscal-year label on
  each snapshot.
- A normal write on an occupied date is a conflict, not an overwrite. A correction names
  the current observation, retires it, and inserts its replacement in one transaction. A
  correction can change the date if the target date is unoccupied. A stale correction or
  collision must roll back. Preserve the old row in history and do not create a movement.
- Archive accounts without removing their observations. Keep history readable to its owner
  and block new or corrected snapshots on archived accounts. An account with no observation
  has an unknown balance, not zero.

### Daily FX rates

- `fx_rates`: `id`, `base_currency_code` and `quote_currency_code` (FKs to `currencies`),
  `rate_on` (the provider's effective date for published quotes), `rate_e8` (positive INTEGER
  at eight fractional digits), `source` (provider key or `manual`), `created_at`, and
  nullable `fetched_at`, `user_id` (FK to `users`), and `retired_at`.
- Store INR per one unit of the foreign currency, not the inverse. Check that the quote is
  `INR` and the base is different. INR accounts do not require a self-rate. Provider rows
  are shared (`user_id` is null, `fetched_at` required). Manual rows have an owner and no
  feed fetch timestamp; database checks enforce the distinction.
- Use separate partial unique indexes for current provider rows `(source, base_currency_code,
  quote_currency_code, rate_on)` and current manual rows `(user_id, base_currency_code,
  quote_currency_code, rate_on)`. These also support on-or-before lookups. A nullable user
  in one common uniqueness key would not prevent duplicate provider rows in SQLite.
- A backend job fetches the latest published Frankfurter rates at startup and at 22:00 in
  `Asia/Kolkata`. It validates each quote's date, direction, and rate before persisting it. Do not fetch FX in
  account reads, send user data to the provider, or invent weekend/holiday rows. Repeating
  the same rate is a no-op. A changed quote for the same key retires the previous version and
  inserts the new version atomically. On feed failure keep existing observations and report
  the failed refresh. Keep manual overrides private and do not overwrite provider rows.

## Money and reporting rules

- Accept money as a decimal string, normalize to two places, and reject inputs with more
  than two fractional digits or nonzero digits below the currency's smallest unit. Preserve zero and signed
  balances. Check `typeof(value) = 'integer'` and enforce the safe JavaScript integer range
  for the stored balance and rate columns. Use exact integer arithmetic for parsing,
  conversion, and summing; do not parse financial amounts as JavaScript floats.
- Normalize exact source rates once to eight places, rounding ties away from zero. Reject a
  rate that is invalid, out of range, or rounds to zero. Eight places apply to FX only,
  not to the underlying two-decimal balances.
- For a report date, select the latest non-retired observation on or before that date for
  each currently active, included account. Value all selected balances using rates as of the
  report date, not the snapshot date. Show both dates. The fiscal year labels the report but
  does not exclude older snapshots. Never rewrite a native balance when FX moves.
- Select the newest eligible rate date on or before the report date,
  with the requesting user's override winning on the same date. Use the configured
  provider only for shared rates. A rate carried forward by one to seven calendar days
  is usable but labeled with its age. Older or absent rates are unavailable. Do not use
  a future rate or assume a rate of 1 for a foreign currency.
- Multiply balance hundredths by `rate_e8`, divide by `100000000`, and round once per
  account to the nearest INR paise, ties away from zero. Use `BigInt` in calculations
  and return decimal strings. Sum the displayed account values. A recorded zero needs
  no conversion. If any included balance or required rate is unavailable, return a known
  subtotal and explicit missing/stale reasons, not a complete total.

## Implementation checklist

### Phase 1: Schema and migration

<!-- parallelizable: false -->

- [x] Add the four tables, key and check constraints, and indexes to the existing SQLite
  schema. Seed INR as reference data only; use non-INR fixture currencies in tests until
  the launch catalog is approved.
- [x] Generate an additive migration with `pnpm run api:db:generate`. Keep the generated
  SQL and Drizzle metadata with the schema change and preserve the existing auth migration.
- [x] Test fresh migration and upgrade from the existing auth-only schema, with a pre-existing
  user and foreign keys enabled. Use in-memory or temporary SQLite, not the local app database.

Implemented in [0001_accounts_cash_v1.sql](../../../apps/api/drizzle/0001_accounts_cash_v1.sql)
and verified by [accounts-schema.test.ts](../../../apps/api/src/__tests__/accounts-schema.test.ts).
All 17 API tests, API type-check, lint, build, and the Drizzle migration history check passed.

### Phase 2: Account and snapshot operations

<!-- parallelizable: true -->

- [x] After Phase 1, add owner-scoped account create, update, list and archive operations,
  plus observation record, correct, history and latest-as-of queries. Keep financial dates
  separate from timestamps and validate the money boundary before storage.
- [x] Test two-user isolation, date boundaries, exact decimal inputs, duplicates, atomic
  corrections (including wrong-date corrections), and history after archiving.

Implemented in [accounts.service.ts](../../../apps/api/src/modules/accounts/accounts.service.ts)
and verified by [accounts.test.ts](../../../apps/api/src/__tests__/accounts.test.ts).
All 23 API tests passed. API type-check, lint, build, and targeted formatting also passed.

### Phase 3: FX handler and rates

<!-- parallelizable: true -->

- [x] After Phase 1, implement the date-based rate lookup, manual override writes, and the
  ingest handler against deterministic fixtures.
- [x] Test deduplication, corrections, failed refreshes, override isolation and precedence,
  no look-ahead, and the seven-day carry-forward boundary.

Implemented in [fx.service.ts](../../../apps/api/src/modules/fx/fx.service.ts)
and verified by [fx.test.ts](../../../apps/api/src/__tests__/fx.test.ts).
All 16 FX, account, and schema tests passed. API type-check, lint, build, and targeted
formatting also passed. The live provider and scheduler were added in the rollout below.

### Phase 4: INR valuation and validation

<!-- parallelizable: false -->

- [x] After Phases 2 and 3, combine the as-of snapshot and FX queries into an account
  valuation result with native amounts, INR values, applied rate provenance, completeness,
  and missing-data reasons.
- [x] Prove that a changed daily rate changes a foreign account's INR valuation without
  changing its snapshot. Cover rounding for both signs, aggregate precision, zero versus
  unknown, an archived/excluded account, and a missing or stale foreign rate. Run `pnpm test`
  and the affected workspace type-check and lint commands. Existing auth behavior must pass.

Implemented in [accounts-valuation.service.ts](../../../apps/api/src/modules/accounts/accounts-valuation.service.ts)
and verified by [accounts.test.ts](../../../apps/api/src/__tests__/accounts.test.ts).
All 32 API tests passed, including auth regressions. API type-check, lint, build, and
targeted formatting also passed.

### Daily FX rollout

<!-- parallelizable: false -->

- [x] Seed the approved currencies through the additive
  [0002_seed_launch_currencies.sql](../../../apps/api/drizzle/0002_seed_launch_currencies.sql)
  migration. INR remains the reporting currency and account default.
- [x] Batch the approved currency codes in one request to [Frankfurter v2](https://frankfurter.dev/).
  Use the published per-pair date and invert the source decimal before rounding to eight
  places. Do not send account or user data.
- [x] Schedule ingestion in the API background job and allow opting out with `FX_AUTO_REFRESH`.
  Leave saved rates intact when a refresh fails.
- [x] Verify with fixtures and an in-memory API startup against the live provider. All 34
  API tests passed. The live run stored all nine rates and valued a USD balance in INR.

## Planning notes

- Use scaled SQLite integers rather than floating-point columns or decimal text for persisted
  v1 amounts. Integer checks and exact arithmetic preserve cents/paise while allowing signed
  balances and keeping rate precision independent of money precision.
- Use a separate rate table rather than storing converted balances alongside snapshots. A
  rate correction affects reporting without changing an account observation.
- The launch uses Frankfurter's blended reference rates for reporting, not transaction
  execution. Stored observations accumulate from launch; historical backfill is deferred.
  Reports keep missing coverage explicit until a usable rate is available.
