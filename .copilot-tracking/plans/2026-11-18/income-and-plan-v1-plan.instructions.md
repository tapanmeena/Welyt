<!-- markdownlint-disable-file -->
---
description: 'Implementation plan for historical FX backfill, actual income receipts, and later monthly planning.'
applyTo: '.copilot-tracking/plans/2026-11-18/income-and-plan-v1-plan.instructions.md'
---

# Income & Plan implementation plan

## User requests

- Plan Income & Plan before implementation. Source: the workspace discussion selecting
  the first suggested next step.
- Fetch historical daily FX from the provider API and save it. Report income in INR
  using rates for the date the income was received. Source: the income reporting
  choices confirmed during planning.
- Start the historical FX backfill on April 1, 2020, or use the first available date
  for any currency without a rate on that date. Source: the implementation request.

## Scope and dependencies

Release actual receipts and financial-year history after adding a historical FX importer.
Monthly forecasting and allocations follow as a separate milestone. Recording income
must work without an account and must not adjust snapshot-only balances or the Home
cash total.

Follow the [Income & Plan model](../../../model.md#income--plan),
[repository guidance](../../../.github/copilot-instructions.md), and Task Plan workflow.
Reuse the [currency catalog and FX tables](../../../apps/api/src/db/schema.ts),
[India date and exact decimal helpers](../../../apps/api/src/lib/financial-values.ts),
and [verified-user route pattern](../../../apps/api/src/modules/accounts/accounts.routes.ts).

[Frankfurter v2](https://frankfurter.dev/#time-series) supports bounded `from` and `to`
queries and CSV output. A read-only sample for April 1 through April 3, 2020 returned 27
dated quotes across USD, EUR, GBP, AED, CAD, AUD, SGD, JPY, and CHF.

## Implementation checklist

### Phase 1: Backfill stored daily FX

<!-- parallelizable: false -->

- [x] Extend the [Frankfurter adapter](../../../apps/api/src/modules/fx/frankfurter.provider.ts)
  to request `/v2/rates.csv` with `base=INR`, the supported foreign currencies in `quotes`,
  and inclusive `from` and `to` dates. Request bounded chunks of up to 31 calendar days.
  Reuse strict CSV validation and exact reciprocal calculation: store INR per one unit
  of foreign currency at the existing eight-decimal scale.
- [x] Add an operator-run API workspace command with explicit date bounds and an optional
  dry run. Reject invalid or future India-local dates before contacting the provider.
  Do not run backfill at startup, from an income read, or as a public write endpoint.
- [x] Validate each full chunk before writing. Reject unknown pairs, dates outside the
  request, invalid rates, and duplicate pair/date rows. Store each actual provider date
  and the fetch timestamp in the existing `fx_rates` table. Do not generate rows for
  dates Frankfurter did not return.
- [x] Insert missing shared Frankfurter rows by currency pair and `rateOn` in a transaction.
  Skip any already-current row for that source and date, even if the historical quote
  differs; leave manual overrides and the daily refresh job unchanged. An interrupted
  import retains completed chunks. Report the failed date range and counts by currency
  so the operator can retry without duplicating rates.
- [x] Test malformed and interrupted batches, reruns, existing daily rows, and user-owned
  overrides against disposable SQLite. Test a bounded live import into a disposable
  database. Once verified, run the approved range into the configured API database and
  report actual coverage and gaps.

Phase 1 added `pnpm run api:fx:backfill`. The local import saved 21,798 rates across all
nine currencies from April 1, 2020 through November 17, 2026, the last completed day
in `Asia/Kolkata`. Every pair had a rate for every day in that range, so no lead-in was
needed. The nine existing November 18 rates remained present. All 42 API tests, API
type-check, lint, and build passed. A bounded live import and its read-only preview
were also verified in disposable SQLite.

### Phase 2: Store and expose actual receipts

<!-- parallelizable: false -->

- [ ] Add one additive Drizzle migration for `income_receipts` and the shared Zod contracts.
  Store a generated ID, owner, India-local `receivedDate`, type, source text, currency,
  actual amount received, optional gross, optional TDS, notes, and UTC creation time.
  Reuse `users` and `currencies` foreign keys. Do not add an account or movement link.
- [ ] Store money as integer hundredths; accept and return decimal strings. The received
  amount must be positive, dates cannot be future India dates, and inputs must honor the
  currency's minor units. Gross and TDS describe the same receipt and remain optional;
  TDS cannot be negative.
  When gross is provided, it cannot be below the net receipt; when both are provided, TDS
  cannot exceed the difference. Other deductions may exist, so do not infer missing amounts.
- [ ] Allow distinct receipts on the same date, even with identical amounts. Correct a
  current receipt by retiring it and inserting a linked replacement atomically. Enforce
  same-user replacement references and one successor per version. Archive mistaken
  receipts without deleting history. Only current, non-archived rows count in totals.
  Index owner and received date for fiscal history.
- [ ] Register verified-user list, create, correct, and archive routes under `/income`.
  Take the owner from the token, not request data. Return not-found for other owners'
  records and conflict for corrections against a superseded or archived receipt.
  Preserve existing auth and Accounts data during migration.

### Phase 3: Deliver INR income history

<!-- parallelizable: false -->

- [ ] Default to the current Indian financial year; use April 1 inclusive through the next
  April 1 exclusive, and group history by calendar month. Show original currency and
  amount alongside the INR valuation. A correction that changes the receipt date moves
  the amount to the new month and financial year without counting the original.
- [ ] Use the [stored FX lookup](../../../apps/api/src/modules/fx/fx.service.ts) as of each
  receipt date, not the current date or the reporting period end. Apply the existing
  precedence rules: latest eligible rate, own manual override on a same-date tie, and at
  most seven calendar days of carry-forward. INR needs no FX lookup. Never fetch rates
  while reading receipts.
- [ ] Round each converted receipt to INR paise before summing with exact arithmetic, as in
  Accounts valuation. Return the rate date, source, and age when applicable. When any
  required rate is missing or stale, expose the affected receipts and the known INR
  subtotal, not a complete total. Preserve the native receipt even outside FX coverage.
- [ ] Add a protected Income & Plan screen with receipt entry, correction, and financial-year
  history. Show gross and TDS as optional details, not as the amount received. Keep Home
  cash and Accounts balances unchanged after recording or correcting income.
- [ ] Cover year boundaries, owner isolation, exact amounts, duplicate-looking receipts,
  correction history, FX completeness, and unchanged snapshots with Fastify integration
  tests. Run workspace type-check and a mobile smoke test using the existing dev client.

## Success criteria

- A repeat backfill inserts no duplicate rows and does not change existing quotes.
- USD 2.00 with a receipt-date rate of INR 81.25 values to INR 162.50 even if today's
  quote differs. Combining it with INR 100.00 yields INR 262.50. An additional receipt
  without a usable rate leaves INR 262.50 as a subtotal and identifies the missing item.
- Multiple receipts on one day remain distinct. Corrections and archives retain history
  without double-counting, and none of these writes changes account snapshots.

## Monthly planning follow-up

Plan calendar-month forecasts and allocations separately after receipts are usable.
Start with manually entered forecasts and commitments; make copying a prior month
explicit and preserve past plan revisions. Decide how effective-dated salary or EMI
assumptions are applied before adding those features. Forecasts, saving allocations,
and commitments never create receipts or cash movements. Keep restore, categorized
expense tracking, budget-versus-actual reporting, and links to other financial modules
out of the initial release.
